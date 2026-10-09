import { LIVE_EVENTS } from '@slay/shared';
import type { AppContext, AuthUser } from '../../core/context.js';
import { actorOf } from '../../core/context.js';
import { conflict, notFound } from '../../core/http.js';

export interface CustomerInput {
  id?: number | null;
  name: string;
  phone?: string | null;
  address?: string;
  social_handle?: string;
  notes?: string;
}

const DEVANAGARI_DIGITS = '०१२३४५६७८९';

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d))).replace(/[^\d+]/g, '');
  s = s.replace(/^\+?977/, '');
  return s || null;
}

export class CustomerService {
  constructor(private ctx: AppContext) {}

  search(q: string, limit = 50) {
    const like = `%${q.trim()}%`;
    const phoneLike = `%${normalizePhone(q) ?? q.trim()}%`;
    return this.ctx.db
      .prepare(
        `SELECT c.*, COUNT(o.id) AS order_count,
                COALESCE(SUM(CASE WHEN o.state IN ('active', 'returned') THEN o.total END), 0) AS total_spent,
                COALESCE(SUM(CASE WHEN o.state = 'active' THEN MAX(o.total - o.amount_paid, 0) END), 0) AS balance_due,
                MAX(o.order_date) AS last_order_date
           FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
          WHERE ? = '' OR c.name LIKE ? OR c.phone LIKE ? OR c.social_handle LIKE ?
          GROUP BY c.id ORDER BY COALESCE(MAX(o.created_at), c.created_at) DESC LIMIT ?`,
      )
      .all(q.trim(), like, phoneLike, like, limit);
  }

  get(id: number) {
    const c = this.ctx.db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!c) throw notFound('Customer not found');
    return c as { id: number; name: string; phone: string | null; address: string; social_handle: string; notes: string };
  }

  findByPhone(phone: string) {
    const p = normalizePhone(phone);
    if (!p) return undefined;
    return this.ctx.db.prepare('SELECT * FROM customers WHERE phone = ?').get(p) as { id: number } | undefined;
  }

  /** Order history for a customer – newest first. Every order, however old, unless a limit is given. */
  history(customerId: number, limit = -1) {
    return this.ctx.db
      .prepare(
        `SELECT o.id, o.invoice_no, o.order_date, o.total, o.amount_paid, o.payment_status, o.fulfillment_status, o.state, o.platform,
                (SELECT GROUP_CONCAT(i.product_name || ' (' || i.color || ') ×' || i.quantity || CASE WHEN i.returned_qty > 0 THEN ' – ' || i.returned_qty || ' returned' ELSE '' END, ', ') FROM order_items i WHERE i.order_id = o.id) AS items_summary
           FROM orders o WHERE o.customer_id = ? ORDER BY o.order_date DESC, o.id DESC LIMIT ?`,
      )
      .all(customerId, limit);
  }

  create(input: CustomerInput, user?: AuthUser) {
    const phone = normalizePhone(input.phone);
    if (phone && this.findByPhone(phone)) throw conflict('A customer with this phone number already exists');
    const row = this.ctx.db
      .prepare('INSERT INTO customers (name, phone, address, social_handle, notes) VALUES (?, ?, ?, ?, ?) RETURNING id')
      .get(input.name, phone, input.address ?? '', input.social_handle ?? '', input.notes ?? '') as { id: number };
    this.ctx.bus.publish(LIVE_EVENTS.customer, { actor: actorOf(user), ids: [row.id] });
    return row.id;
  }

  update(id: number, input: Partial<CustomerInput>, user?: AuthUser) {
    const current = this.get(id);
    const phone = input.phone !== undefined ? normalizePhone(input.phone) : current.phone;
    if (phone && phone !== current.phone) {
      const other = this.findByPhone(phone);
      if (other && other.id !== id) throw conflict('Another customer already has this phone number');
    }
    this.ctx.db
      .prepare('UPDATE customers SET name = ?, phone = ?, address = ?, social_handle = ?, notes = ? WHERE id = ?')
      .run(input.name ?? current.name, phone, input.address ?? current.address, input.social_handle ?? current.social_handle, input.notes ?? current.notes, id);
    this.ctx.bus.publish(LIVE_EVENTS.customer, { actor: actorOf(user), ids: [id] });
  }

  /** Used when saving an order: reuse the customer (by id or phone) or create a new one. */
  resolve(input: CustomerInput, user?: AuthUser): number {
    if (input.id) {
      this.update(input.id, input, user);
      return input.id;
    }
    const existing = input.phone ? this.findByPhone(input.phone) : undefined;
    if (existing) {
      this.update(existing.id, input, user);
      return existing.id;
    }
    return this.create(input, user);
  }
}
