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
  type ReturnKind,
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

export interface RefundInput {
  amount: number;
  method: PaymentMethod;
  note?: string;
}

export interface ReturnInput {
  /** `return`: pieces come back. `exchange`: pieces come back and replacement items go out. */
  kind: ReturnKind;
  reason?: string;
  /** Which pieces came back, and whether each goes back into stock. */
  lines: { item_id: number; quantity: number; restock: boolean }[];
  /** Exchange only: what the customer gets instead. */
  replacements?: OrderItemInput[];
  /** Money given back now (optional – it can also be recorded later). */
  refund?: RefundInput | null;
  version: number;
}

export interface CancelOptions {
  /** Put the order's pieces back in stock (default). Off for made-to-order pieces already cut. */
  restock?: boolean;
  refund?: RefundInput | null;
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
  /** `due`: orders where money is owed back to the customer. */
  refund?: 'due';
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
    if (f.refund === 'due') where.push(`o.amount_paid > CASE WHEN o.state = 'cancelled' THEN 0 ELSE o.total END + 0.001`);
    if (f.from) (where.push('o.order_date >= ?'), args.push(f.from));
    if (f.to) (where.push('o.order_date <= ?'), args.push(f.to));
    if (f.customer_id) (where.push('o.customer_id = ?'), args.push(f.customer_id));
    const from = `FROM orders o JOIN customers c ON c.id = o.customer_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;

    const limit = Math.min(f.limit ?? 50, 200);
    const offset = f.offset ?? 0;
    const rows = this.db
      .prepare(
        `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone,
                (SELECT SUM(quantity - returned_qty) FROM order_items i WHERE i.order_id = o.id) AS item_count,
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
    const returns = (
      this.db
        .prepare(`SELECT r.*, u.display_name AS created_by_name FROM order_returns r LEFT JOIN users u ON u.id = r.created_by WHERE r.order_id = ? ORDER BY r.id`)
        .all(id) as any[]
    ).map((r) => ({
      ...r,
      items: this.db
        .prepare(
          `SELECT ri.order_item_id, ri.quantity, ri.restocked, i.product_name, i.color, i.size FROM order_return_items ri
             JOIN order_items i ON i.id = ri.order_item_id WHERE ri.return_id = ? ORDER BY ri.id`,
        )
        .all(r.id),
      replacements: (items as any[]).filter((i) => i.return_id === r.id).map((i) => ({ id: i.id, product_name: i.product_name, color: i.color, size: i.size, quantity: i.quantity })),
      refunded: money(-((payments as any[]).filter((p) => p.return_id === r.id).reduce((n, p) => n + p.amount, 0))),
    }));
    const refunded = money(-(payments as any[]).filter((p) => p.amount < 0).reduce((n, p) => n + p.amount, 0));
    const customer = this.customers.get(order.customer_id);
    const history = this.customers.history(order.customer_id, 20).filter((o: any) => o.id !== id);
    return { ...withBalance(order), refunded, customer, items, payments, returns, customer_history: history };
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
        if (old.returned_qty > 0) throw badRequest(`${old.product_name} (${old.color}) has a return recorded, so it can’t be removed from the order.`);
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
        if (old.returned_qty > 0 && (old.variant_id !== item.variant_id || item.quantity !== old.quantity)) {
          throw badRequest(`${old.product_name} (${old.color}) has a return recorded, so its product and quantity can’t be changed. Record another return or exchange instead.`);
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

  /**
   * Cancels an order. By default the pieces go back into stock; turn that off for made-to-order
   * pieces that were already cut. A refund can be recorded at the same time (or later).
   */
  cancel(id: number, reason: string, user: AuthUser, opts: CancelOptions = {}) {
    const restock = opts.restock ?? true;
    const order = this.db.transaction(() => {
      const o = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as any;
      if (!o) throw notFound('Order not found');
      if (o.state !== 'active') throw conflict(`This order is already ${o.state}.`);
      const items = this.db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id) as any[];
      const variantIds: number[] = [];
      if (restock) {
        for (const i of items) {
          const pieces = i.quantity - i.returned_qty; // pieces already returned were dealt with then
          if (i.variant_id && pieces > 0) {
            this.catalog.give(i.variant_id, pieces, 'order_cancel', user.id, id, i.id);
            variantIds.push(i.variant_id);
          }
        }
      }
      const lines = [o.notes, reason ? `Cancelled: ${reason}` : '', restock ? '' : 'Pieces not put back in stock.'].filter(Boolean);
      this.db.prepare(`UPDATE orders SET state = 'cancelled', notes = ?, version = version + 1, updated_at = ? WHERE id = ?`).run(lines.join('\n'), new Date().toISOString(), id);
      const refunded = opts.refund ? this.insertRefund(id, opts.refund, null, user) : 0;
      return { ...o, variantIds, refunded };
    })();
    logActivity(this.ctx, user.id, 'order_cancelled', 'order', id, { reason, restock, refunded: order.refunded || undefined });
    if (order.amount_paid > 0) {
      const refundNote = order.refunded ? ` Rs ${order.refunded} was refunded.` : ' No refund recorded yet.';
      this.alerts.raise('paid_order_cancelled', 'warning', `${user.displayName} cancelled order ${order.invoice_no}, which had Rs ${order.amount_paid} paid.${refundNote}`, {}, user.id);
    }
    const since = new Date(Date.now() - 3600_000).toISOString();
    const recent = (this.db.prepare(`SELECT COUNT(*) AS n FROM activity_log WHERE action = 'order_cancelled' AND user_id = ? AND created_at >= ?`).get(user.id, since) as { n: number }).n;
    if (recent >= 5) {
      this.alerts.raiseOnce(`bulk_cancel:${user.id}`, 60, 'bulk_cancellations', 'warning', `Unusual activity: ${user.displayName} cancelled ${recent} orders in the last hour.`, {}, user.id);
    }
    this.publish(user, [id], order.variantIds, `${user.displayName} cancelled ${order.invoice_no}`);
    if (order.refunded) this.ctx.bus.publish(LIVE_EVENTS.payment, { actor: actorOf(user), ids: [id] });
    return this.get(id);
  }

  /**
   * Records pieces coming back from the customer – a plain return, or an exchange where
   * replacement items go out instead. Each piece can go back into stock or not (made-to-order
   * pieces usually can't be resold). The order's value drops by the returned pieces; any money
   * the customer is then owed shows as "refund due" until a refund is recorded.
   */
  returnItems(id: number, input: ReturnInput, user: AuthUser) {
    const replacements = input.replacements ?? [];
    if (!input.lines.length) throw badRequest('Choose at least one piece that came back');
    if (input.kind === 'exchange' && !replacements.length) throw badRequest('Choose what the customer gets instead for the exchange');
    if (input.kind === 'return' && replacements.length) throw badRequest('Replacement items are only for exchanges');
    const result = this.db.transaction(() => {
      const o = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as any;
      if (!o) throw notFound('Order not found');
      if (o.version !== input.version) throw conflict('This order was just changed on the other phone. Reload it to see the latest version.', 'stale_version');
      if (o.state !== 'active') throw conflict(`This order is ${o.state}, so nothing more can be returned.`);
      const items = this.db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id) as any[];
      const seen = new Set<number>();
      const variantIds = new Set<number>();
      const ret = this.db
        .prepare('INSERT INTO order_returns (order_id, kind, reason, created_by) VALUES (?, ?, ?, ?) RETURNING id')
        .get(id, input.kind, input.reason?.trim() ?? '', user.id) as { id: number };
      let pieces = 0;
      let restocked = 0;
      for (const line of input.lines) {
        const item = items.find((i) => i.id === line.item_id);
        if (!item) throw badRequest('That item isn’t on this order');
        if (seen.has(item.id)) throw badRequest(`${item.product_name} (${item.color}) is listed twice`);
        seen.add(item.id);
        const left = item.quantity - item.returned_qty;
        if (line.quantity > left) {
          throw badRequest(left === 0 ? `${item.product_name} (${item.color}) has already been returned` : `Only ${left} of ${item.product_name} (${item.color}) can still be returned`);
        }
        const back = line.restock && item.variant_id ? line.quantity : 0;
        const returned = item.returned_qty + line.quantity;
        this.db
          .prepare('UPDATE order_items SET returned_qty = ?, restocked_qty = restocked_qty + ?, status = ? WHERE id = ?')
          .run(returned, back, returned === item.quantity ? (input.kind === 'exchange' ? 'exchanged' : 'returned') : item.status, item.id);
        this.db.prepare('INSERT INTO order_return_items (return_id, order_item_id, quantity, restocked) VALUES (?, ?, ?, ?)').run(ret.id, item.id, line.quantity, back);
        if (back) {
          this.catalog.give(item.variant_id, back, input.kind, user.id, id, item.id);
          variantIds.add(item.variant_id);
        }
        pieces += line.quantity;
        restocked += back;
      }
      for (const r of replacements) variantIds.add(this.insertItem(id, r, user.id, { reason: 'exchange', returnId: ret.id }));
      this.recalculate(id);
      const { kept } = this.db.prepare('SELECT COALESCE(SUM(quantity - returned_qty), 0) AS kept FROM order_items WHERE order_id = ?').get(id) as { kept: number };
      const state = kept === 0 ? 'returned' : 'active';
      this.db.prepare('UPDATE orders SET state = ?, version = version + 1, updated_at = ? WHERE id = ?').run(state, new Date().toISOString(), id);
      const refunded = input.refund ? this.insertRefund(id, input.refund, ret.id, user) : 0;
      return { returnId: ret.id, invoiceNo: o.invoice_no as string, variantIds: [...variantIds], pieces, restocked, refunded };
    })();
    logActivity(this.ctx, user.id, input.kind === 'exchange' ? 'items_exchanged' : 'items_returned', 'order', id, {
      return_id: result.returnId,
      pieces: result.pieces,
      restocked: result.restocked,
      replacements: replacements.length || undefined,
      refunded: result.refunded || undefined,
      reason: input.reason || undefined,
    });
    if (result.refunded) this.refundAlert(result.invoiceNo, result.refunded, user);
    const what = input.kind === 'exchange' ? 'an exchange' : `a return of ${result.pieces} piece${result.pieces === 1 ? '' : 's'}`;
    this.publish(user, [id], result.variantIds, `${user.displayName} recorded ${what} on ${result.invoiceNo}`);
    if (result.refunded) this.ctx.bus.publish(LIVE_EVENTS.payment, { actor: actorOf(user), ids: [id] });
    return this.get(id);
  }

  /** Money given back to the customer – on its own, e.g. later after a return or a cancellation. */
  refund(id: number, input: RefundInput, user: AuthUser) {
    const o = this.db.transaction(() => {
      const o = this.db.prepare('SELECT id, invoice_no FROM orders WHERE id = ?').get(id) as any;
      if (!o) throw notFound('Order not found');
      this.insertRefund(id, input, null, user);
      this.db.prepare('UPDATE orders SET version = version + 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
      return o;
    })();
    logActivity(this.ctx, user.id, 'refund_recorded', 'order', id, { amount: money(input.amount), method: input.method });
    this.refundAlert(o.invoice_no, money(input.amount), user);
    this.ctx.bus.publish(LIVE_EVENTS.payment, { actor: actorOf(user), ids: [id] });
    this.ctx.bus.publish(LIVE_EVENTS.order, { actor: actorOf(user), ids: [id], message: `${user.displayName} recorded a refund on ${o.invoice_no}` });
    return this.get(id);
  }

  /** A refund is a payment row with a negative amount, so "paid" always shows what the business kept. */
  private insertRefund(orderId: number, r: RefundInput, returnId: number | null, user: AuthUser) {
    const amount = money(r.amount);
    if (!(amount > 0)) throw badRequest('Enter how much was given back');
    const { paid } = this.db.prepare('SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE order_id = ?').get(orderId) as { paid: number };
    if (amount > money(paid)) {
      throw badRequest(money(paid) <= 0 ? 'Nothing has been paid on this order, so there is nothing to refund.' : `You can refund at most Rs ${money(paid)} – that’s all that has been paid on this order.`);
    }
    this.db
      .prepare(`INSERT INTO payments (order_id, amount, method, note, kind, return_id, created_by) VALUES (?, ?, ?, ?, 'refund', ?, ?)`)
      .run(orderId, -amount, r.method, r.note?.trim() ?? '', returnId, user.id);
    this.recalculate(orderId);
    return amount;
  }

  private refundAlert(invoiceNo: string, amount: number, user: AuthUser) {
    this.alerts.raise('refund_recorded', 'warning', `${user.displayName} recorded a refund of Rs ${amount} on order ${invoiceNo}.`, { invoice_no: invoiceNo, amount }, user.id);
  }

  addPayment(orderId: number, p: { amount: number; method: PaymentMethod; note?: string; provider_ref?: string | null }, user: AuthUser | null) {
    this.db.transaction(() => {
      const o = this.db.prepare('SELECT state FROM orders WHERE id = ?').get(orderId) as any;
      if (!o) throw notFound('Order not found');
      if (!(p.amount > 0)) throw badRequest('Enter the amount received. To give money back, use Refund.');
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
    logActivity(this.ctx, user.id, p.kind === 'refund' ? 'refund_removed' : 'payment_removed', 'order', orderId, { amount: p.amount, method: p.method });
    this.ctx.bus.publish(LIVE_EVENTS.order, { actor: actorOf(user), ids: [orderId] });
    return this.get(orderId);
  }

  private insertItem(orderId: number, item: OrderItemInput, userId: number, opts: { reason?: 'order' | 'exchange'; returnId?: number } = {}): number {
    const v = this.catalog.getVariant(item.variant_id);
    const row = this.db
      .prepare(
        `INSERT INTO order_items (order_id, variant_id, product_name, category_name, color, size, unit_sizes, quantity, unit_price, unit_cost, photo, return_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .get(orderId, v.id, v.product_name, v.category_name, v.color, ...lineSizes(item), item.quantity, money(item.unit_price), v.cost, item.photo || v.photo, opts.returnId ?? null) as { id: number };
    this.catalog.take(v.id, item.quantity, opts.reason ?? 'order', userId, orderId, row.id);
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
    // Returned pieces no longer count towards what the customer pays.
    const { subtotal } = this.db.prepare('SELECT COALESCE(SUM((quantity - returned_qty) * unit_price), 0) AS subtotal FROM order_items WHERE order_id = ?').get(orderId) as any;
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

/**
 * `balance_due`: what the customer still owes. `refund_due`: what the business owes back – more
 * paid than the order is now worth (after a return or exchange), or anything paid on a cancelled order.
 */
function withBalance<T extends { total: number; amount_paid: number; state?: string }>(o: T) {
  const worth = o.state === 'cancelled' ? 0 : o.total;
  return {
    ...o,
    balance_due: o.state === 'cancelled' ? 0 : Math.max(0, money(o.total - o.amount_paid)),
    refund_due: Math.max(0, money(o.amount_paid - worth)),
  };
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
