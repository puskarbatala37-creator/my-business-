import { describe, expect, it } from 'vitest';
import { login, seedCatalog, setup, w } from './helpers.js';

const customer = { name: 'Rina Karki', phone: '9851098765' };

async function start(payment: object) {
  const s = setup();
  const teza = w(await login(s.app, 'teza', 'password-teza'));
  const partner = w(await login(s.app, 'partner', 'password-partner'));
  const cat = await seedCatalog(teza);
  const o = (await teza.post('/api/orders', { customer, platform: 'tiktok', items: [{ variant_id: cat.red, quantity: 1, unit_price: 3000 }], payment })).body;
  return { s, teza, partner, o };
}

describe('changing an order’s payment status after it was taken', () => {
  it('COD → paid in full when the money arrives', async () => {
    const { teza, o } = await start({ status: 'unpaid' });
    expect(o).toMatchObject({ payment_status: 'unpaid', amount_paid: 0, balance_due: 3000 });
    const r = await teza.post(`/api/orders/${o.id}/payment-status`, { status: 'paid', method: 'cash' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ payment_status: 'paid', amount_paid: 3000, balance_due: 0, payment_method: 'cash' });
    expect(r.body.payments.at(-1)).toMatchObject({ amount: 3000, kind: 'payment', method: 'cash' });
    const d = (await teza.get('/api/dashboard')).body;
    expect(d.today.collected).toBe(3000);
    expect(d.outstanding.amount).toBe(0);
  });

  it('partial → paid adds only the rest; COD → partial records the amount', async () => {
    const { teza, o } = await start({ status: 'partial', amount: 1000, method: 'esewa' });
    const paid = (await teza.post(`/api/orders/${o.id}/payment-status`, { status: 'paid', method: 'khalti' })).body;
    expect(paid).toMatchObject({ payment_status: 'paid', amount_paid: 3000 });
    expect(paid.payments.at(-1)).toMatchObject({ amount: 2000, method: 'khalti' });

    const { teza: t2, o: o2 } = await start({ status: 'unpaid' });
    const part = (await t2.post(`/api/orders/${o2.id}/payment-status`, { status: 'partial', amount: 1200, method: 'cash' })).body;
    expect(part).toMatchObject({ payment_status: 'partial', amount_paid: 1200, balance_due: 1800 });
    const bad = await t2.post(`/api/orders/${o2.id}/payment-status`, { status: 'partial', amount: 3000 });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/less than 3000/);
  });

  it('lowering what was paid (a mistake) adds a correction and tells the team', async () => {
    const { teza, partner, o } = await start({ status: 'paid', method: 'cash' });
    const r = (await teza.post(`/api/orders/${o.id}/payment-status`, { status: 'partial', amount: 500 })).body;
    expect(r).toMatchObject({ payment_status: 'partial', amount_paid: 500, refunded: 0, refund_due: 0 });
    expect(r.payments.at(-1)).toMatchObject({ amount: -2500, kind: 'correction' });
    const cod = (await teza.post(`/api/orders/${o.id}/payment-status`, { status: 'unpaid' })).body;
    expect(cod).toMatchObject({ payment_status: 'unpaid', amount_paid: 0, balance_due: 3000 });
    const alerts = (await partner.get('/api/security/alerts')).body.alerts;
    expect(alerts.some((a: any) => a.kind === 'payment_reduced' && /removing Rs 2500/.test(a.message))).toBe(true);
  });

  it('a verified eSewa payment can’t be undone by changing the status', async () => {
    const { s, teza, o } = await start({ status: 'unpaid' });
    s.ctx.db.prepare(`INSERT INTO payments (order_id, amount, method, provider_ref) VALUES (?, 3000, 'esewa', 'REF1')`).run(o.id);
    (s.ctx.services.orders as any).recalculate(o.id);
    const r = await teza.post(`/api/orders/${o.id}/payment-status`, { status: 'unpaid' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/confirmed by eSewa/);
  });

  it('cancelled orders can’t change their payment status', async () => {
    const { teza, o } = await start({ status: 'unpaid' });
    await teza.post(`/api/orders/${o.id}/cancel`, {});
    expect((await teza.post(`/api/orders/${o.id}/payment-status`, { status: 'paid' })).status).toBe(409);
  });
});
