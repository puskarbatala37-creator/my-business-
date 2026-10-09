import { describe, expect, it } from 'vitest';
import { login, seedCatalog, setup, w } from './helpers.js';

const customer = { name: 'Sita Sharma', phone: '9841234567', address: 'Baneshwor, Kathmandu' };

async function ready() {
  const s = setup();
  const teza = w(await login(s.app, 'teza', 'password-teza'));
  const partner = w(await login(s.app, 'partner', 'password-partner'));
  const cat = await seedCatalog(teza);
  return { ...s, teza, partner, cat };
}

const stockOf = async (api: any, id: number) => (await api.get(`/api/catalog/variants/${id}`)).body.stock;

describe('orders & stock', () => {
  it('rejects unauthenticated and header-less writes', async () => {
    const { app } = await ready();
    const request = (await import('supertest')).default;
    expect((await request(app).get('/api/orders')).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ username: 'teza', password: 'x' })).status).toBe(403);
  });

  it('creates an invoice, decreases stock and records partial payment', async () => {
    const { teza, partner, cat } = await ready();
    const res = await teza.post('/api/orders', {
      customer,
      platform: 'instagram',
      delivery_charge: 150,
      items: [{ variant_id: cat.red, quantity: 2, size: 'Free', unit_price: 3500 }],
      payment: { status: 'partial', amount: 2000, method: 'esewa' },
      notes: 'Fall & pico please',
      delivery_due_date: '2026-10-12',
      prep_time_days: 2,
    });
    expect(res.status).toBe(201);
    expect(res.body.invoice_no).toMatch(/^SLAY-\d{4}-0001$/);
    expect(res.body.total).toBe(7150);
    expect(res.body.amount_paid).toBe(2000);
    expect(res.body.balance_due).toBe(5150);
    expect(res.body.payment_status).toBe('partial');
    expect(res.body.items[0].unit_cost).toBe(1800);
    // The partner sees the new stock immediately.
    expect(await stockOf(partner, cat.red)).toBe(1);

    const second = await partner.post('/api/orders', { platform: 'instagram', customer, items: [{ variant_id: cat.blue, quantity: 1, unit_price: 3500 }], payment: { status: 'paid', method: 'cash' } });
    expect(second.body.invoice_no).toMatch(/-0002$/);
    expect(second.body.payment_status).toBe('paid');
    // Same phone → same customer, with order history.
    expect(second.body.customer.id).toBe(res.body.customer.id);
    expect(second.body.customer_history).toHaveLength(1);
  });

  it('prevents double-selling the last unit', async () => {
    const { teza, partner, cat } = await ready();
    const a = await teza.post('/api/orders', { platform: 'instagram', customer, items: [{ variant_id: cat.blue, quantity: 1, unit_price: 3500 }] });
    expect(a.status).toBe(201);
    const b = await partner.post('/api/orders', { platform: 'instagram', customer: { name: 'Gita', phone: '9800000000' }, items: [{ variant_id: cat.blue, quantity: 1, unit_price: 3500 }] });
    expect(b.status).toBe(409);
    expect(b.body.code).toBe('out_of_stock');
    expect(await stockOf(teza, cat.blue)).toBe(0);
    // Nothing half-saved: no customer "Gita" order
    const list = await teza.get('/api/orders');
    expect(list.body.orders).toHaveLength(1);
  });

  it('adjusts stock when an order is edited or cancelled', async () => {
    const { teza, partner, cat } = await ready();
    const o = (await teza.post('/api/orders', { platform: 'instagram', customer, items: [{ variant_id: cat.red, quantity: 1, unit_price: 3500 }] })).body;
    expect(await stockOf(teza, cat.red)).toBe(2);
    const edited = await teza.put(`/api/orders/${o.id}`, {
      platform: 'instagram', version: o.version,
      customer: { ...customer, id: o.customer.id },
      items: [
        { id: o.items[0].id, variant_id: cat.red, quantity: 3, unit_price: 3400 },
        { variant_id: cat.blue, quantity: 1, unit_price: 3500 },
      ],
    });
    expect(edited.status).toBe(200);
    expect(await stockOf(teza, cat.red)).toBe(0);
    expect(await stockOf(teza, cat.blue)).toBe(0);
    expect(edited.body.total).toBe(3 * 3400 + 3500);

    // Partner editing with the old version is refused instead of overwriting.
    const stale = await partner.put(`/api/orders/${o.id}`, { platform: 'instagram', version: o.version, customer, items: [{ variant_id: cat.red, quantity: 1, unit_price: 1 }] });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('stale_version');

    const cancelled = await teza.post(`/api/orders/${o.id}/cancel`, { reason: 'customer changed mind' });
    expect(cancelled.body.state).toBe('cancelled');
    expect(await stockOf(teza, cat.red)).toBe(3);
    expect(await stockOf(teza, cat.blue)).toBe(1);
  });

  it('payments update the status, and marking sent works', async () => {
    const { teza, cat } = await ready();
    const o = (await teza.post('/api/orders', { platform: 'instagram', customer, items: [{ variant_id: cat.red, quantity: 1, unit_price: 3000 }] })).body;
    expect(o.payment_status).toBe('unpaid');
    const p1 = (await teza.post(`/api/orders/${o.id}/payments`, { amount: 1000, method: 'cash' })).body;
    expect(p1.payment_status).toBe('partial');
    expect(p1.balance_due).toBe(2000);
    const p2 = (await teza.post(`/api/orders/${o.id}/payments`, { amount: 2000, method: 'bank' })).body;
    expect(p2.payment_status).toBe('paid');
    const sent = (await teza.patch(`/api/orders/${o.id}`, { fulfillment_status: 'sent', tracking_number: 'NCM-12345' })).body;
    expect(sent.fulfillment_status).toBe('sent');
    expect(sent.tracking_number).toBe('NCM-12345');
    expect(sent.sent_at).toBeTruthy();
    const pending = await teza.get('/api/orders?fulfillment=pending');
    expect(pending.body.orders).toHaveLength(0);
  });

  it('dashboard totals daily / monthly / six months', async () => {
    const { teza, cat, ctx } = await ready();
    await teza.post('/api/orders', { platform: 'instagram', customer, items: [{ variant_id: cat.red, quantity: 1, unit_price: 3000 }], payment: { status: 'paid', method: 'cash' } });
    const old = await teza.post('/api/orders', { platform: 'instagram', customer, order_date: '2020-01-01', items: [{ variant_id: cat.red, quantity: 1, unit_price: 9999 }] });
    expect(old.status).toBe(201);
    const d = (await teza.get('/api/dashboard')).body;
    expect(d.today.sales).toBe(3000);
    expect(d.today.gross_profit).toBe(1200);
    expect(d.month.sales).toBe(3000);
    expect(d.six_months.sales).toBe(3000);
    expect(d.months).toHaveLength(12); // the chart shows a year by default
    expect((await teza.get('/api/dashboard?chart=6')).body.months).toHaveLength(6);
    expect(d.outstanding.amount).toBe(9999);
    void ctx;
  });

  it('profit leaves out delivery charges and counts discounts', async () => {
    const { teza, cat } = await ready();
    // Sells for 3000 + 150 delivery − 200 discount = 2950; the sari cost 1800.
    await teza.post('/api/orders', {
      platform: 'tiktok',
      customer,
      delivery_charge: 150,
      discount: 200,
      items: [{ variant_id: cat.red, quantity: 1, unit_price: 3000 }],
      payment: { status: 'paid', method: 'cash' },
    });
    const d = (await teza.get('/api/dashboard')).body;
    expect(d.today.sales).toBe(2950);
    expect(d.today.gross_profit).toBe(1000); // 3000 − 200 − 1800
  });

  it('stores and searches supplier receipts', async () => {
    const { teza } = await ready();
    const r = await teza.post('/api/receipts', { photo: '/uploads/bill.jpg', supplier: 'Asan fabric store', amount: 12500, category: 'fabric' });
    expect(r.status).toBe(201);
    expect(r.body.captured_at).toBeTruthy();
    const found = (await teza.get('/api/receipts?q=asan')).body;
    expect(found.count).toBe(1);
    expect(found.total).toBe(12500);
    expect((await teza.get('/api/receipts?q=nothing')).body.count).toBe(0);
  });
});
