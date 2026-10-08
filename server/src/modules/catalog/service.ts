import { LIVE_EVENTS, money, type StockReason } from '@slay/shared';
import type { AppContext, AuthUser } from '../../core/context.js';
import { actorOf, logActivity, service } from '../../core/context.js';
import { badRequest, conflict, notFound } from '../../core/http.js';
import type { AlertService } from '../security/service.js';

export interface VariantRow {
  id: number;
  product_id: number;
  color: string;
  sku: string | null;
  stock: number;
  cost: number;
  price: number;
  photo: string | null;
  voice_aliases: string;
  archived: number;
}

export interface VariantInput {
  color: string;
  sku?: string | null;
  stock?: number;
  cost?: number;
  price?: number;
  photo?: string | null;
  voice_aliases?: string;
}

const LARGE_MANUAL_REDUCTION = 10;

export class CatalogService {
  constructor(private ctx: AppContext) {}

  private get db() {
    return this.ctx.db;
  }

  tree(includeArchived = false) {
    const cats = this.db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all() as any[];
    const products = this.db
      .prepare(`SELECT * FROM products ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY name`)
      .all() as any[];
    const variants = this.db
      .prepare(`SELECT * FROM variants ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY color`)
      .all() as VariantRow[];
    const byProduct = new Map<number, VariantRow[]>();
    for (const v of variants) {
      if (!byProduct.has(v.product_id)) byProduct.set(v.product_id, []);
      byProduct.get(v.product_id)!.push(v);
    }
    return cats.map((c) => ({
      ...c,
      products: products
        .filter((p) => p.category_id === c.id)
        .map((p) => ({ ...p, variants: byProduct.get(p.id) ?? [] })),
    }));
  }

  getVariant(id: number) {
    const v = this.db
      .prepare(
        `SELECT v.*, p.name AS product_name, p.category_id, c.name AS category_name
           FROM variants v JOIN products p ON p.id = v.product_id JOIN categories c ON c.id = p.category_id
          WHERE v.id = ?`,
      )
      .get(id) as (VariantRow & { product_name: string; category_id: number; category_name: string }) | undefined;
    if (!v) throw notFound('Product colour not found');
    return v;
  }

  createCategory(name: string, voiceAliases = '') {
    try {
      const row = this.db.prepare('INSERT INTO categories (name, voice_aliases) VALUES (?, ?) RETURNING *').get(name, voiceAliases);
      this.changed();
      return row;
    } catch (e: any) {
      if (String(e.message).includes('UNIQUE')) throw conflict(`A category called "${name}" already exists`);
      throw e;
    }
  }

  updateCategory(id: number, patch: { name?: string; voice_aliases?: string; sort_order?: number }) {
    this.updateRow('categories', id, patch);
    this.changed();
  }

  deleteCategory(id: number) {
    const n = (this.db.prepare('SELECT COUNT(*) AS n FROM products WHERE category_id = ?').get(id) as { n: number }).n;
    if (n > 0) throw conflict('Move or remove the products in this category first');
    this.db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    this.changed();
  }

  createProduct(
    input: { category_id: number; name: string; description?: string; sizes?: string; voice_aliases?: string; variants?: VariantInput[] },
    user: AuthUser,
  ) {
    const id = this.db.transaction(() => {
      const cat = this.db.prepare('SELECT id FROM categories WHERE id = ?').get(input.category_id);
      if (!cat) throw badRequest('Category not found');
      const p = this.db
        .prepare('INSERT INTO products (category_id, name, description, sizes, voice_aliases) VALUES (?, ?, ?, ?, ?) RETURNING id')
        .get(input.category_id, input.name, input.description ?? '', input.sizes ?? '', input.voice_aliases ?? '') as { id: number };
      for (const v of input.variants ?? []) this.insertVariant(p.id, v, user);
      return p.id;
    })();
    logActivity(this.ctx, user.id, 'product_created', 'product', id, { name: input.name });
    this.changed(user);
    return id;
  }

  updateProduct(id: number, patch: Record<string, unknown>, user: AuthUser) {
    this.updateRow('products', id, patch);
    this.changed(user);
  }

  addVariant(productId: number, input: VariantInput, user: AuthUser) {
    const exists = this.db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
    if (!exists) throw notFound('Product not found');
    const id = this.db.transaction(() => this.insertVariant(productId, input, user))();
    this.changed(user, [id]);
    return id;
  }

  private insertVariant(productId: number, v: VariantInput, user: AuthUser): number {
    const row = this.db
      .prepare(
        `INSERT INTO variants (product_id, color, sku, stock, cost, price, photo, voice_aliases)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .get(productId, v.color, v.sku ?? null, v.stock ?? 0, money(v.cost ?? 0), money(v.price ?? 0), v.photo ?? null, v.voice_aliases ?? '') as { id: number };
    if ((v.stock ?? 0) > 0) this.recordMovement(row.id, v.stock!, 'restock', user.id, null, null, 'Opening stock');
    return row.id;
  }

  updateVariant(id: number, patch: Partial<VariantInput> & { archived?: boolean }, user: AuthUser) {
    const { stock: _ignored, ...rest } = patch as any; // stock only changes through adjustStock
    if (rest.cost !== undefined) rest.cost = money(rest.cost);
    if (rest.price !== undefined) rest.price = money(rest.price);
    if (rest.archived !== undefined) rest.archived = rest.archived ? 1 : 0;
    this.updateRow('variants', id, { ...rest, updated_at: new Date().toISOString() });
    this.changed(user, [id]);
  }

  /** Manual stock change: either a delta (+5 restock / -1 damaged) or an absolute count. */
  adjustStock(id: number, input: { delta?: number; set?: number; reason: 'manual' | 'restock'; note?: string }, user: AuthUser) {
    const result = this.db.transaction(() => {
      const v = this.getVariant(id);
      const delta = input.set !== undefined ? input.set - v.stock : (input.delta ?? 0);
      if (delta === 0) return { v, delta };
      if (v.stock + delta < 0) throw conflict(`Only ${v.stock} in stock`);
      this.db.prepare('UPDATE variants SET stock = stock + ?, updated_at = ? WHERE id = ?').run(delta, new Date().toISOString(), id);
      this.recordMovement(id, delta, input.reason, user.id, null, null, input.note ?? null);
      return { v, delta };
    })();
    if (result.delta !== 0) {
      logActivity(this.ctx, user.id, 'stock_adjusted', 'variant', id, { delta: result.delta, note: input.note });
      if (result.delta <= -LARGE_MANUAL_REDUCTION) {
        service<AlertService>(this.ctx, 'alerts').raise(
          'large_stock_reduction',
          'warning',
          `${user.displayName} manually removed ${-result.delta} units of ${result.v.product_name} (${result.v.color}) from stock.`,
          {},
          user.id,
        );
      }
      this.ctx.bus.publish(LIVE_EVENTS.stock, { actor: actorOf(user), ids: [id] });
    }
    return this.getVariant(id);
  }

  /**
   * Takes stock for an order line. Runs inside the caller's transaction; the
   * conditional UPDATE makes overselling impossible even if both partners sell
   * the last unit at the same moment.
   */
  take(variantId: number, qty: number, reason: StockReason, userId: number | null, orderId: number, orderItemId: number | null) {
    const res = this.db.prepare('UPDATE variants SET stock = stock - ?, updated_at = ? WHERE id = ? AND stock >= ?').run(qty, new Date().toISOString(), variantId, qty);
    if (res.changes === 0) {
      const v = this.getVariant(variantId);
      throw conflict(
        v.stock === 0 ? `${v.product_name} (${v.color}) is out of stock` : `Only ${v.stock} left of ${v.product_name} (${v.color})`,
        'out_of_stock',
        { variant_id: variantId, available: v.stock },
      );
    }
    this.recordMovement(variantId, -qty, reason, userId, orderId, orderItemId, null);
  }

  /** Puts stock back (order edited / cancelled, and later: returns). */
  give(variantId: number, qty: number, reason: StockReason, userId: number | null, orderId: number | null, orderItemId: number | null) {
    this.db.prepare('UPDATE variants SET stock = stock + ?, updated_at = ? WHERE id = ?').run(qty, new Date().toISOString(), variantId);
    this.recordMovement(variantId, qty, reason, userId, orderId, orderItemId, null);
  }

  movements(variantId: number) {
    return this.db
      .prepare(
        `SELECT m.*, u.display_name AS user_name, o.invoice_no FROM stock_movements m
           LEFT JOIN users u ON u.id = m.user_id LEFT JOIN orders o ON o.id = m.order_id
          WHERE m.variant_id = ? ORDER BY m.id DESC LIMIT 100`,
      )
      .all(variantId);
  }

  private recordMovement(variantId: number, delta: number, reason: StockReason, userId: number | null, orderId: number | null, orderItemId: number | null, note: string | null) {
    this.db
      .prepare('INSERT INTO stock_movements (variant_id, delta, reason, order_id, order_item_id, user_id, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(variantId, delta, reason, orderId, orderItemId, userId, note);
  }

  private updateRow(table: 'categories' | 'products' | 'variants', id: number, patch: Record<string, unknown>) {
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
    if (!entries.length) return;
    const sql = `UPDATE ${table} SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`;
    const res = this.db.prepare(sql).run(...entries.map(([, v]) => (typeof v === 'boolean' ? (v ? 1 : 0) : v)), id);
    if (res.changes === 0) throw notFound();
  }

  private changed(user?: AuthUser, ids?: number[]) {
    this.ctx.bus.publish(LIVE_EVENTS.catalog, { actor: actorOf(user), ids });
  }
}
