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

/**
 * One way of writing each phone number, so the same customer is always recognised:
 * "+977 984-123 4567", "00977 9841234567", "977-9841234567" and "9841234567" → "9841234567".
 * Numbers from other countries keep their country code: "+61 412 345 678" / "0061412345678" → "+61412345678".
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d))).trim();
  let digits = s.replace(/\D/g, '');
  let international = s.startsWith('+');
  if (!international && digits.startsWith('00')) {
    international = true; // 00 = international dialling prefix
    digits = digits.slice(2);
  }
  if (!digits) return null;
  if (digits.startsWith('977') && (international || digits.length === 13)) return digits.slice(3); // Nepal
  return international ? `+${digits}` : digits;
}

/**
 * A rough "sounds like" key for names, so different spellings of the same name meet:
 * "Sita" / "Seeta", "Pooja" / "Puja", "Laxmi" / "Lakshmi", "Shrestha" / "Srestha".
 */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z\u0900-\u097f\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) =>
      w
        .replace(/ksh|x/g, 'ks')
        .replace(/ee|ii|y(?=[^aeiou]|$)/g, 'i')
        .replace(/oo|uu/g, 'u')
        .replace(/aa/g, 'a')
        .replace(/w/g, 'v')
        .replace(/ph/g, 'f')
        .replace(/([bcdgjkpst])h/g, '$1')
        .replace(/sh/g, 's')
        .replace(/(.)\1+/g, '$1'),
    )
    .join(' ');
}

/** Order number for an order within its customer's history: 1 = first order. Cancelled orders don't count. */
export const CUSTOMER_ORDER_NO_SQL = `(SELECT COUNT(*) FROM orders o2 WHERE o2.customer_id = o.customer_id AND o2.state <> 'cancelled'
    AND (o2.order_date < o.order_date OR (o2.order_date = o.order_date AND o2.id <= o.id)))`;

export class CustomerService {
  constructor(private ctx: AppContext) {}

  /**
   * Re-writes saved phone numbers in today's one format (e.g. "00977…" saved by an older version),
   * so they match new orders. A number that would then clash with another customer is left alone.
   */
  normalizeSavedPhones() {
    const rows = this.ctx.db.prepare(`SELECT id, phone FROM customers WHERE phone IS NOT NULL AND phone <> ''`).all() as { id: number; phone: string }[];
    let fixed = 0;
    for (const r of rows) {
      const p = normalizePhone(r.phone);
      if (!p || p === r.phone) continue;
      if (this.ctx.db.prepare('SELECT 1 FROM customers WHERE phone = ? AND id <> ?').get(p, r.id)) continue;
      this.ctx.db.prepare('UPDATE customers SET phone = ? WHERE id = ?').run(p, r.id);
      fixed++;
    }
    return fixed;
  }

  /**
   * Customers whose name sounds like this one (a hint only – names are spelled many ways, so a
   * customer is only ever matched automatically by phone number).
   */
  similarByName(name: string, limit = 3) {
    const key = nameKey(name);
    if (key.replace(/\s/g, '').length < 3) return [];
    const first = key.split(' ')[0];
    const rows = this.ctx.db
      .prepare(
        `SELECT c.id, c.name, c.phone, COUNT(o.id) AS order_count, MAX(o.order_date) AS last_order_date
           FROM customers c LEFT JOIN orders o ON o.customer_id = c.id AND o.state <> 'cancelled'
          GROUP BY c.id`,
      )
      .all() as { id: number; name: string; phone: string | null; order_count: number; last_order_date: string | null }[];
    return rows
      .map((r) => {
        const k = nameKey(r.name);
        // Same full name, or same first name when only one name was typed.
        const score = k === key ? 2 : key.includes(' ') ? 0 : k.split(' ')[0] === first ? 1 : 0;
        return { ...r, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || b.order_count - a.order_count)
      .slice(0, limit)
      .map(({ score: _s, ...r }) => r);
  }

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
                ${CUSTOMER_ORDER_NO_SQL} AS customer_order_no,
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
