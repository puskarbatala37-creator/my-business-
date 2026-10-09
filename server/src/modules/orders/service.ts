import {
  derivePaymentStatus,
  LIVE_EVENTS,
  money,
  sizeSummary,
  todayInBusinessTz,
  type FulfillmentStatus,
  type PaymentMethod,
  type PaymentStatus,
  type Platform,
} from '@slay/shared';
import type { AppContext, AuthUser } from '../../core/context.js';
import { actorOf, logActivity, service } from '../../core/context.js';
import { badRequest, conflict, notFound } from '../../core/http.js';
import { nextCounter } from '../../db/index.js';
import type { CatalogService } from '../catalog/service.js';
import type { CustomerInput, CustomerService } from '../customers/service.js';
import type { AlertService } from '../security/service.js';

export interface OrderItemInput {
  id?: number | null; // existing line when editing
  variant_id: number;
  size?: string;
  /** One size per piece when they differ, e.g. ["42", "41"] for two kurtas. */
  sizes?: string[] | null;
  quantity: number;
  unit_price: number;
  photo?: string | null; // defaults to the variant's photo
}

export interface OrderInput {
  customer: CustomerInput;
  order_date?: string;
  platform: Platform;
  payment_method?: PaymentMethod | null;
  delivery_charge?: number;
  discount?: number;
  notes?: string;
  tracking_number?: string;
  delivery_due_date?: string | null;
  prep_time_days?: number | null;
  fulfillment_status?: FulfillmentStatus;
  items: OrderItemInput[];
}

export interface OrderCreateInput extends OrderInput {
  /** What the customer has paid so far when the order is taken. */
  payment?: { status: PaymentStatus; amount?: number; method?: PaymentMethod | null };
}

export interface OrderListFilters {
  q?: string;
  /** Customer name only. */
  customer?: string;
  /** Product type, i.e. category name (e.g. "Sari"). */
  category?: string;
  platform?: Platform;
  fulfillment?: FulfillmentStatus;
  payment?: PaymentStatus | 'open';
  state?: string;
  from?: string;
  to?: string;
  customer_id?: number;
  limit?: number;
  offset?: number;
}

export class OrderService {
  constructor(private ctx: AppContext) {}

  private get db() {
    return this.ctx.db;
  }
  private get catalog() {
    return service<CatalogService>(this.ctx, 'catalog');
  }
  private get customers() {
    return service<CustomerService>(this.ctx, 'customers');
  }
  private get alerts() {
    return service<AlertService>(this.ctx, 'alerts');
  }

  /**
   * Order / transaction history search. Every filter is optional and they combine:
   * text (customer name, phone, social handle, invoice no., tracking no., product, colour or product type),
   * order date range, product type, platform, payment and fulfilment status.
   */
  list(f: OrderListFilters) {
    const where: string[] = [];
    const args: unknown[] = [];
    const q = f.q?.trim();
    if (q) {
      const like = `%${q}%`;
      where.push(`(o.invoice_no LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR c.social_handle LIKE ? OR o.tracking_number LIKE ?
                   OR EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id
                              AND (i.product_name LIKE ? OR i.color LIKE ? OR i.category_name LIKE ?)))`);
      args.push(like, like, like, like, like, like, like, like);
    }
    if (f.customer?.trim()) (where.push('c.name LIKE ?'), args.push(`%${f.customer.trim()}%`));
    if (f.category?.trim()) {
      where.push('EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.category_name = ? COLLATE NOCASE)');
      args.push(f.category.trim());
    }
    if (f.platform) (where.push('o.platform = ?'), args.push(f.platform));
    if (f.fulfillment) (where.push('o.fulfillment_status = ?'), args.push(f.fulfillment));
    if (f.payment === 'open') where.push(`o.payment_status <> 'paid'`);
    else if (f.payment) (where.push('o.payment_status = ?'), args.push(f.payment));
    if (f.state && f.state !== 'all') (where.push('o.state = ?'), args.push(f.state));
    if (f.from) (where.push('o.order_date >= ?'), args.push(f.from));
    if (f.to) (where.push('o.order_date <= ?'), args.push(f.to));
    if (f.customer_id) (where.push('o.customer_id = ?'), args.push(f.customer_id));
    const from = `FROM orders o JOIN customers c ON c.id = o.customer_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;

    const limit = Math.min(f.limit ?? 50, 200);
    const offset = f.offset ?? 0;
    const rows = this.db
      .prepare(
        `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone,
                (SELECT SUM(quantity) FROM order_items i WHERE i.order_id = o.id) AS item_count,
                (SELECT photo FROM order_items i WHERE i.order_id = o.id AND photo IS NOT NULL ORDER BY i.id LIMIT 1) AS thumb,
                (SELECT GROUP_CONCAT(i.product_name || ' · ' || i.color, ', ') FROM order_items i WHERE i.order_id = o.id) AS items_summary,
                (SELECT GROUP_CONCAT(DISTINCT i.category_name) FROM order_items i WHERE i.order_id = o.id AND i.category_name <> '') AS categories
         ${from}
         ORDER BY o.order_date DESC, o.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset) as any[];
    const totals = this.db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(o.total), 0) AS total, COALESCE(SUM(o.amount_paid), 0) AS paid ${from}`).get(...args) as {
      n: number;
      total: number;
      paid: number;
    };
    return {
      orders: rows.map(withBalance),
      summary: { count: totals.n, total: money(totals.total), paid: money(totals.paid) },
      has_more: offset + rows.length < totals.n,
    };
  }

  get(id: number) {
    const order = this.db
      .prepare(
        `SELECT o.*, u.display_name AS created_by_name FROM orders o LEFT JOIN users u ON u.id = o.created_by WHERE o.id = ?`,
      )
      .get(id) as any;
    if (!order) throw notFound('Order not found');
    const items = this.db
      .prepare(
        `SELECT i.*, v.stock AS current_stock, v.product_id FROM order_items i LEFT JOIN variants v ON v.id = i.variant_id
          WHERE i.order_id = ? ORDER BY i.id`,
      )
      .all(id)
      .map((i: any) => ({ ...i, sizes: i.unit_sizes ? (JSON.parse(i.unit_sizes) as string[]) : null, unit_sizes: undefined }));
    const payments = this.db
      .prepare(`SELECT p.*, u.display_name AS created_by_name FROM payments p LEFT JOIN users u ON u.id = p.created_by WHERE p.order_id = ? ORDER BY p.id`)
      .all(id);
    const customer = this.customers.get(order.customer_id);
    const history = this.customers.history(order.customer_id, 20).filter((o: any) => o.id !== id);
    return { ...withBalance(order), customer, items, payments, customer_history: history };
  }

  create(input: OrderCreateInput, user: AuthUser) {
    if (!input.items.length) throw badRequest('Add at least one item');
    const result = this.db.transaction(() => {
      const customerId = this.customers.resolve(input.customer, user);
      const orderDate = input.order_date || todayInBusinessTz();
      const year = orderDate.slice(0, 4);
      const seq = nextCounter(this.db, `invoice:${year}`);
      const invoiceNo = `SLAY-${year}-${String(seq).padStart(4, '0')}`;
      const order = this.db
        .prepare(
          `INSERT INTO orders (invoice_no, customer_id, order_date, platform, payment_method, delivery_charge, discount, notes,
                               tracking_number, delivery_due_date, prep_time_days, fulfillment_status, sent_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .get(
          invoiceNo,
          customerId,
          orderDate,
          input.platform,
          input.payment?.method ?? input.payment_method ?? null,
          money(input.delivery_charge ?? 0),
          money(input.discount ?? 0),
          input.notes ?? '',
          input.tracking_number ?? '',
          input.delivery_due_date || null,
          input.prep_time_days ?? null,
          input.fulfillment_status ?? 'pending',
          input.fulfillment_status === 'sent' ? new Date().toISOString() : null,
          user.id,
        ) as { id: number };

      const variantIds: number[] = [];
      for (const item of input.items) variantIds.push(this.insertItem(order.id, item, user.id));
      const totals = this.recalculate(order.id);

      const p = input.payment;
      if (p && p.status !== 'unpaid') {
        const amount = p.status === 'paid' ? totals.total : money(p.amount ?? 0);
        if (p.status === 'partial' && (amount <= 0 || amount >= totals.total)) {
          throw badRequest('For a partial payment, enter an amount between 0 and the order total');
        }
        if (amount > 0) this.insertPayment(order.id, amount, p.method ?? 'cash', '', null, user.id);
        this.recalculate(order.id);
      }
      return { id: order.id, invoiceNo, variantIds };
    })();

    logActivity(this.ctx, user.id, 'order_created', 'order', result.id, { invoice_no: result.invoiceNo });
    this.publish(user, [result.id], result.variantIds, `${user.displayName} added order ${result.invoiceNo}`);
    return this.get(result.id);
  }

  update(id: number, input: OrderInput & { version: number }, user: AuthUser) {
    const touched = this.db.transaction(() => {
      const current = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as any;
      if (!current) throw notFound('Order not found');
      if (current.version !== input.version) {
        throw conflict('This order was just changed on the other phone. Reload it to see the latest version.', 'stale_version');
      }
      if (current.state !== 'active') throw conflict('Only active orders can be edited');
      if (!input.items.length) throw badRequest('An order needs at least one item');

      const customerId = this.customers.resolve(input.customer, user);
      const variantIds = new Set<number>();
      const existing = this.db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id) as any[];
      const keep = new Set(input.items.filter((i) => i.id).map((i) => i.id));

      // Lines removed from the order: put their stock back.
      for (const old of existing) {
        if (keep.has(old.id)) continue;
        if (old.variant_id) {
          this.catalog.give(old.variant_id, old.quantity, 'order_edit', user.id, id, old.id);
          variantIds.add(old.variant_id);
        }
        this.db.prepare('DELETE FROM order_items WHERE id = ?').run(old.id);
      }

      for (const item of input.items) {
        const old = item.id ? existing.find((e) => e.id === item.id) : undefined;
        if (item.id && !old) throw badRequest(`Item ${item.id} does not belong to this order`);
        if (!old) {
          variantIds.add(this.insertItem(id, item, user.id));
          continue;
        }
        if (old.variant_id !== item.variant_id) {
          if (old.variant_id) {
            this.catalog.give(old.variant_id, old.quantity, 'order_edit', user.id, id, old.id);
            variantIds.add(old.variant_id);
          }
          this.db.prepare('DELETE FROM order_items WHERE id = ?').run(old.id);
          variantIds.add(this.insertItem(id, { ...item, id: null }, user.id));
          continue;
        }
        const diff = item.quantity - old.quantity;
        if (diff > 0) this.catalog.take(item.variant_id, diff, 'order_edit', user.id, id, old.id);
        if (diff < 0) this.catalog.give(item.variant_id, -diff, 'order_edit', user.id, id, old.id);
        if (diff !== 0) variantIds.add(item.variant_id);
        this.db
          .prepare('UPDATE order_items SET size = ?, unit_sizes = ?, quantity = ?, unit_price = ?, photo = COALESCE(?, photo) WHERE id = ?')
          .run(...lineSizes(item), item.quantity, money(item.unit_price), item.photo ?? null, old.id);
      }

      const fulfillment = input.fulfillment_status ?? current.fulfillment_status;
      this.db
        .prepare(
          `UPDATE orders SET customer_id = ?, order_date = ?, platform = ?, payment_method = ?, delivery_charge = ?, discount = ?,
                  notes = ?, tracking_number = ?, delivery_due_date = ?, prep_time_days = ?, fulfillment_status = ?,
                  sent_at = CASE WHEN ? = 'sent' THEN COALESCE(sent_at, ?) ELSE NULL END,
                  version = version + 1, updated_at = ?
            WHERE id = ?`,
        )
        .run(
          customerId,
          input.order_date || current.order_date,
          input.platform,
          input.payment_method !== undefined ? input.payment_method : current.payment_method,
          money(input.delivery_charge ?? current.delivery_charge),
          money(input.discount ?? current.discount),
          input.notes ?? current.notes,
          input.tracking_number ?? current.tracking_number,
          input.delivery_due_date !== undefined ? input.delivery_due_date || null : current.delivery_due_date,
          input.prep_time_days !== undefined ? input.prep_time_days : current.prep_time_days,
          fulfillment,
          fulfillment,
          new Date().toISOString(),
          new Date().toISOString(),
          id,
        );
      this.recalculate(id);
      return [...variantIds];
    })();
    logActivity(this.ctx, user.id, 'order_updated', 'order', id);
    this.publish(user, [id], touched);
    return this.get(id);
  }

  /** Quick status changes from the order screen (mark as sent, add tracking number, notes). */
  patch(id: number, patch: { fulfillment_status?: FulfillmentStatus; tracking_number?: string; notes?: string }, user: AuthUser) {
    const current = this.db.prepare('SELECT id, invoice_no FROM orders WHERE id = ?').get(id) as any;
    if (!current) throw notFound('Order not found');
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE orders SET
           fulfillment_status = COALESCE(?, fulfillment_status),
           sent_at = CASE WHEN COALESCE(?, fulfillment_status) = 'sent' THEN COALESCE(sent_at, ?) ELSE NULL END,
           tracking_number = COALESCE(?, tracking_number),
           notes = COALESCE(?, notes),
           version = version + 1, updated_at = ?
         WHERE id = ?`,
      )
      .run(patch.fulfillment_status ?? null, patch.fulfillment_status ?? null, now, patch.tracking_number ?? null, patch.notes ?? null, now, id);
    logActivity(this.ctx, user.id, 'order_patched', 'order', id, patch);
    this.publish(user, [id], []);
    return this.get(id);
  }

  cancel(id: number, reason: string, user: AuthUser) {
    const order = this.db.transaction(() => {
      const o = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as any;
      if (!o) throw notFound('Order not found');
      if (o.state !== 'active') throw conflict('Order is already ' + o.state);
      const items = this.db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id) as any[];
      for (const i of items) if (i.variant_id) this.catalog.give(i.variant_id, i.quantity, 'order_cancel', user.id, id, i.id);
      const note = reason ? `${o.notes ? o.notes + '\n' : ''}Cancelled: ${reason}` : o.notes;
      this.db.prepare(`UPDATE orders SET state = 'cancelled', notes = ?, version = version + 1, updated_at = ? WHERE id = ?`).run(note, new Date().toISOString(), id);
      return { ...o, variantIds: items.map((i) => i.variant_id).filter(Boolean) as number[] };
    })();
    logActivity(this.ctx, user.id, 'order_cancelled', 'order', id, { reason });
    if (order.amount_paid > 0) {
      this.alerts.raise('paid_order_cancelled', 'warning', `${user.displayName} cancelled order ${order.invoice_no}, which had Rs ${order.amount_paid} paid.`, {}, user.id);
    }
    const since = new Date(Date.now() - 3600_000).toISOString();
    const recent = (this.db.prepare(`SELECT COUNT(*) AS n FROM activity_log WHERE action = 'order_cancelled' AND user_id = ? AND created_at >= ?`).get(user.id, since) as { n: number }).n;
    if (recent >= 5) {
      this.alerts.raiseOnce(`bulk_cancel:${user.id}`, 60, 'bulk_cancellations', 'warning', `Unusual activity: ${user.displayName} cancelled ${recent} orders in the last hour.`, {}, user.id);
    }
    this.publish(user, [id], order.variantIds, `${user.displayName} cancelled ${order.invoice_no}`);
    return this.get(id);
  }

  addPayment(orderId: number, p: { amount: number; method: PaymentMethod; note?: string; provider_ref?: string | null }, user: AuthUser | null) {
    this.db.transaction(() => {
      const o = this.db.prepare('SELECT state FROM orders WHERE id = ?').get(orderId) as any;
      if (!o) throw notFound('Order not found');
      if (p.amount === 0) throw badRequest('Amount must not be zero');
      this.insertPayment(orderId, money(p.amount), p.method, p.note ?? '', p.provider_ref ?? null, user?.id ?? null);
      this.db.prepare('UPDATE orders SET payment_method = COALESCE(payment_method, ?), version = version + 1, updated_at = ? WHERE id = ?').run(p.method, new Date().toISOString(), orderId);
      this.recalculate(orderId);
    })();
    logActivity(this.ctx, user?.id ?? null, 'payment_added', 'order', orderId, { amount: p.amount, method: p.method });
    this.ctx.bus.publish(LIVE_EVENTS.payment, { actor: actorOf(user ?? undefined), ids: [orderId] });
    this.ctx.bus.publish(LIVE_EVENTS.order, { actor: actorOf(user ?? undefined), ids: [orderId] });
    return this.get(orderId);
  }

  deletePayment(orderId: number, paymentId: number, user: AuthUser) {
    const p = this.db.prepare('SELECT * FROM payments WHERE id = ? AND order_id = ?').get(paymentId, orderId) as any;
    if (!p) throw notFound('Payment not found');
    if (p.method === 'esewa' && p.provider_ref) throw conflict('Verified eSewa payments cannot be removed');
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM payments WHERE id = ?').run(paymentId);
      this.db.prepare('UPDATE orders SET version = version + 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), orderId);
      this.recalculate(orderId);
    })();
    logActivity(this.ctx, user.id, 'payment_removed', 'order', orderId, { amount: p.amount, method: p.method });
    this.ctx.bus.publish(LIVE_EVENTS.order, { actor: actorOf(user), ids: [orderId] });
    return this.get(orderId);
  }

  private insertItem(orderId: number, item: OrderItemInput, userId: number): number {
    const v = this.catalog.getVariant(item.variant_id);
    const row = this.db
      .prepare(
        `INSERT INTO order_items (order_id, variant_id, product_name, category_name, color, size, unit_sizes, quantity, unit_price, unit_cost, photo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .get(orderId, v.id, v.product_name, v.category_name, v.color, ...lineSizes(item), item.quantity, money(item.unit_price), v.cost, item.photo || v.photo) as { id: number };
    this.catalog.take(v.id, item.quantity, 'order', userId, orderId, row.id);
    return v.id;
  }

  private insertPayment(orderId: number, amount: number, method: PaymentMethod, note: string, providerRef: string | null, userId: number | null) {
    this.db
      .prepare('INSERT INTO payments (order_id, amount, method, note, provider_ref, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(orderId, amount, method, note, providerRef, userId);
  }

  /** Recomputes totals & derived payment status from items and the payment ledger. */
  recalculate(orderId: number) {
    const o = this.db.prepare('SELECT delivery_charge, discount FROM orders WHERE id = ?').get(orderId) as any;
    const { subtotal } = this.db.prepare('SELECT COALESCE(SUM(quantity * unit_price), 0) AS subtotal FROM order_items WHERE order_id = ?').get(orderId) as any;
    const { paid } = this.db.prepare('SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE order_id = ?').get(orderId) as any;
    const total = Math.max(0, money(subtotal + o.delivery_charge - o.discount));
    const status = derivePaymentStatus(total, paid);
    this.db.prepare('UPDATE orders SET subtotal = ?, total = ?, amount_paid = ?, payment_status = ? WHERE id = ?').run(money(subtotal), total, money(paid), status, orderId);
    return { subtotal: money(subtotal), total, paid: money(paid), status };
  }

  private publish(user: AuthUser, orderIds: number[], variantIds: number[], message?: string) {
    this.ctx.bus.publish(LIVE_EVENTS.order, { actor: actorOf(user), ids: orderIds, message });
    if (variantIds.length) this.ctx.bus.publish(LIVE_EVENTS.stock, { actor: actorOf(user), ids: variantIds });
  }
}

function withBalance<T extends { total: number; amount_paid: number }>(o: T) {
  return { ...o, balance_due: Math.max(0, money(o.total - o.amount_paid)) };
}

/**
 * `size` always holds what to show ("42", or "42, 41" when pieces differ – also what search looks
 * at); `unit_sizes` keeps the size of each piece only when they actually differ.
 */
function lineSizes(item: OrderItemInput): [string, string | null] {
  const sizes = item.sizes?.length === item.quantity ? item.sizes.map((s) => s.trim()) : null;
  if (!sizes || new Set(sizes).size <= 1) return [sizes?.[0] ?? item.size ?? '', null];
  return [sizeSummary(sizes), JSON.stringify(sizes)];
}
