import crypto from 'node:crypto';
import { LIVE_EVENTS, money } from '@slay/shared';
import type { AppContext, AuthUser } from '../../core/context.js';
import { logActivity, service } from '../../core/context.js';
import { badRequest, conflict, notFound } from '../../core/http.js';
import type { OrderService } from '../orders/service.js';
import type { PaymentProvider, PaymentRequestRow, VerifiedPayment } from './provider.js';

const REQUEST_TTL_HOURS = 48;

export class OnlinePaymentService {
  private providers = new Map<string, PaymentProvider>();

  constructor(private ctx: AppContext) {}

  register(p: PaymentProvider) {
    this.providers.set(p.name, p);
  }

  provider(name: string) {
    const p = this.providers.get(name);
    if (!p) throw badRequest(`Payment provider ${name} is not available`);
    return p;
  }

  private get orders() {
    return service<OrderService>(this.ctx, 'orders');
  }

  /** Creates a shareable payment link for the order's remaining balance. */
  createRequest(orderId: number, providerName: string, user: AuthUser) {
    this.provider(providerName);
    const order = this.ctx.db.prepare('SELECT id, invoice_no, total, amount_paid, state FROM orders WHERE id = ?').get(orderId) as any;
    if (!order) throw notFound('Order not found');
    if (order.state !== 'active') throw conflict('Order is not active');
    const amount = money(order.total - order.amount_paid);
    if (amount <= 0) throw conflict('This order is already fully paid');
    const token = crypto.randomBytes(18).toString('base64url');
    const uuid = `${order.invoice_no}-${crypto.randomBytes(4).toString('hex')}`.replace(/[^A-Za-z0-9-]/g, '');
    this.ctx.db
      .prepare('INSERT INTO payment_requests (token, provider, order_id, amount, transaction_uuid, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(token, providerName, orderId, amount, uuid, user.id);
    logActivity(this.ctx, user.id, 'payment_link_created', 'order', orderId, { provider: providerName, amount });
    return { token, amount, url: `${this.ctx.config.appUrl}/pay/${token}` };
  }

  byToken(token: string) {
    const r = this.ctx.db.prepare('SELECT * FROM payment_requests WHERE token = ?').get(token) as PaymentRequestRow | undefined;
    if (!r) throw notFound('Payment link not found');
    return r;
  }

  forOrder(orderId: number) {
    return this.ctx.db
      .prepare('SELECT id, token, provider, amount, transaction_uuid, status, provider_ref, created_at, completed_at FROM payment_requests WHERE order_id = ? ORDER BY id DESC')
      .all(orderId);
  }

  /** Public summary shown to the customer on the payment page. */
  publicView(token: string) {
    const r = this.byToken(token);
    const o = this.ctx.db
      .prepare('SELECT o.invoice_no, o.total, o.amount_paid, c.name FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?')
      .get(r.order_id) as any;
    const expired = r.status === 'pending' && isExpired(r);
    const checkout =
      r.status === 'pending' && !expired
        ? this.provider(r.provider).checkout(r, {
            success: `${this.ctx.config.appUrl}/api/pay/${r.provider}/return?token=${encodeURIComponent(r.token)}`,
            failure: `${this.ctx.config.appUrl}/pay/${r.token}?result=failed`,
          })
        : null;
    return {
      provider: r.provider,
      invoice_no: o.invoice_no,
      customer_first_name: String(o.name).split(' ')[0],
      amount: r.amount,
      status: expired ? 'expired' : r.status,
      checkout,
    };
  }

  /** Handles the browser redirect back from the gateway. Never trusts it alone: always confirms server-to-server. */
  async handleReturn(token: string, query: Record<string, unknown>) {
    const r = this.byToken(token);
    if (r.status === 'complete') return r;
    const provider = this.provider(r.provider);
    const cb = provider.parseCallback(query);
    if (cb.transactionUuid !== r.transaction_uuid) throw badRequest('Transaction does not belong to this payment link');
    if (cb.amount < r.amount) throw badRequest('Paid amount does not match');
    return this.confirm(r);
  }

  /** Asks the gateway for the real status and completes the request when paid. */
  async confirm(r: PaymentRequestRow) {
    const verified = await this.provider(r.provider).checkStatus(r);
    if (verified.status === 'complete' && verified.amount >= r.amount) this.complete(r, verified);
    else if (verified.status === 'failed') this.ctx.db.prepare(`UPDATE payment_requests SET status = 'failed', raw_response = ? WHERE id = ? AND status = 'pending'`).run(JSON.stringify(verified.raw), r.id);
    return this.byToken(r.token);
  }

  private complete(r: PaymentRequestRow, v: VerifiedPayment) {
    const done = this.ctx.db.transaction(() => {
      const res = this.ctx.db
        .prepare(`UPDATE payment_requests SET status = 'complete', provider_ref = ?, raw_response = ?, completed_at = ? WHERE id = ? AND status IN ('pending', 'failed')`)
        .run(v.providerRef, JSON.stringify(v.raw), new Date().toISOString(), r.id);
      if (res.changes === 0) return false; // already recorded (idempotent)
      this.orders.addPayment(r.order_id, { amount: r.amount, method: r.provider as any, provider_ref: v.providerRef, note: `${r.provider} ${r.transaction_uuid}` }, null);
      return true;
    })();
    if (done) {
      const o = this.ctx.db.prepare('SELECT invoice_no FROM orders WHERE id = ?').get(r.order_id) as any;
      this.ctx.bus.publish(LIVE_EVENTS.payment, { actor: null, ids: [r.order_id], message: `eSewa payment of Rs ${r.amount} received for ${o.invoice_no}` });
    }
  }

  /** Background reconciliation: catches payments whose browser redirect never reached us. */
  async reconcilePending() {
    const rows = this.ctx.db.prepare(`SELECT * FROM payment_requests WHERE status = 'pending'`).all() as PaymentRequestRow[];
    for (const r of rows) {
      if (isExpired(r)) {
        this.ctx.db.prepare(`UPDATE payment_requests SET status = 'expired' WHERE id = ?`).run(r.id);
        continue;
      }
      try {
        await this.confirm(r);
      } catch (err) {
        console.warn(`[payments] status check failed for ${r.transaction_uuid}:`, (err as Error).message);
      }
    }
  }
}

function isExpired(r: PaymentRequestRow) {
  return Date.now() - Date.parse(r.created_at) > REQUEST_TTL_HOURS * 3600_000;
}
