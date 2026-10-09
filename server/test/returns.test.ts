import { describe, expect, it } from 'vitest';
import { login, seedCatalog, setup, w } from './helpers.js';

const customer = { name: 'Rina Karki', phone: '9851098765' };
const stockOf = async (api: any, id: number) => (await api.get(`/api/catalog/variants/${id}`)).body.stock;

async function start() {
  const s = setup();
  const teza = w(await login(s.app, 'teza', 'password-teza'));
  const partner = w(await login(s.app, 'partner', 'password-partner'));
  const cat = await seedCatalog(teza);
  return { s, teza, partner, cat };
}

/** Two red saris (Rs 3500 each), paid in full. */
async function paidOrder(teza: any, cat: any) {
  const res = await teza.post('/api/orders', {
    customer,
    platform: 'tiktok',
    items: [{ variant_id: cat.red, quantity: 2, size: 'Free', unit_price: 3500 }],
    payment: { status: 'paid', method: 'esewa' },
  });
  expect(res.status).toBe(201);
  return res.body;
}

describe('returns, exchanges and refunds (optional)', () => {
  it('orders work exactly as before when nothing is returned', async () => {
    const { teza, cat } = await start();
    const o = await paidOrder(teza, cat);
    expect(o).toMatchObject({ total: 7000, amount_paid: 7000, balance_due: 0, refund_due: 0, refunded: 0, returns: [], state: 'active' });
    expect(o.items[0]).toMatchObject({ returned_qty: 0, restocked_qty: 0, status: 'sold' });
  });

  it('returns one piece without putting it back in stock (made to order), then refunds it', async () => {
    const { teza, partner, cat } = await start();
    const o = await paidOrder(teza, cat);
    expect(await stockOf(teza, cat.red)).toBe(1);

    const r = await teza.post(`/api/orders/${o.id}/returns`, {
      kind: 'return',
      reason: 'Did not fit',
      version: o.version,
      lines: [{ item_id: o.items[0].id, quantity: 1, restock: false }],
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ state: 'active', subtotal: 3500, total: 3500, amount_paid: 7000, refund_due: 3500, balance_due: 0 });
    expect(r.body.items[0]).toMatchObject({ quantity: 2, returned_qty: 1, restocked_qty: 0, status: 'sold' });
    expect(r.body.returns).toHaveLength(1);
    expect(r.body.returns[0]).toMatchObject({ kind: 'return', reason: 'Did not fit', created_by_name: expect.any(String) });
    expect(r.body.returns[0].items[0]).toMatchObject({ quantity: 1, restocked: 0 });
    expect(await stockOf(teza, cat.red)).toBe(1); // not resellable: stock unchanged

    // Can't return more than is left on the line.
    const tooMany = await teza.post(`/api/orders/${o.id}/returns`, { kind: 'return', version: r.body.version, lines: [{ item_id: o.items[0].id, quantity: 2, restock: false }] });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error).toMatch(/Only 1 of Banarasi Silk/);

    // Refund later: can't give back more than was paid.
    const over = await teza.post(`/api/orders/${o.id}/refunds`, { amount: 8000, method: 'esewa' });
    expect(over.status).toBe(400);
    expect(over.body.error).toMatch(/at most Rs 7000/);
    const refund = await teza.post(`/api/orders/${o.id}/refunds`, { amount: 3500, method: 'esewa', note: 'Sent back by eSewa' });
    expect(refund.status).toBe(201);
    expect(refund.body).toMatchObject({ amount_paid: 3500, refund_due: 0, refunded: 3500, payment_status: 'paid' });
    expect(refund.body.payments.at(-1)).toMatchObject({ amount: -3500, kind: 'refund', method: 'esewa', note: 'Sent back by eSewa' });

    // The partner is told about money going out.
    const alerts = (await partner.get('/api/security/alerts')).body.alerts;
    expect(alerts.some((a: any) => a.kind === 'refund_recorded' && /Rs 3500/.test(a.message))).toBe(true);

    // Dashboard: sales = what was kept; the unsold piece's cost still counts.
    const d = (await teza.get('/api/dashboard')).body;
    expect(d.today).toMatchObject({ sales: 3500, collected: 3500, cost: 3600 });
    expect(d.refunds_due.amount).toBe(0);
  });

  it('a full return with restock marks the order returned and puts stock back', async () => {
    const { teza, cat } = await start();
    const o = await paidOrder(teza, cat);
    const r = await teza.post(`/api/orders/${o.id}/returns`, {
      kind: 'return',
      version: o.version,
      lines: [{ item_id: o.items[0].id, quantity: 2, restock: true }],
      refund: { amount: 7000, method: 'cash' },
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ state: 'returned', total: 0, amount_paid: 0, refunded: 7000, refund_due: 0 });
    expect(r.body.items[0]).toMatchObject({ returned_qty: 2, restocked_qty: 2, status: 'returned' });
    expect(r.body.returns[0].refunded).toBe(7000);
    expect(await stockOf(teza, cat.red)).toBe(3);
    const ledger = (await teza.get(`/api/catalog/variants/${cat.red}/movements`)).body;
    if (Array.isArray(ledger?.movements)) expect(ledger.movements.some((m: any) => m.reason === 'return' && m.delta === 2)).toBe(true);

    // Nothing more to return; can't be edited; cost no longer counted.
    const again = await teza.post(`/api/orders/${o.id}/returns`, { kind: 'return', version: r.body.version, lines: [{ item_id: o.items[0].id, quantity: 1, restock: true }] });
    expect(again.status).toBe(409);
    const d = (await teza.get('/api/dashboard')).body;
    expect(d.today).toMatchObject({ sales: 0, cost: 0 });
  });

  it('exchanges a piece for another colour: replacement takes stock, price difference is owed', async () => {
    const { teza, cat } = await start();
    const o = await paidOrder(teza, cat);
    const r = await teza.post(`/api/orders/${o.id}/returns`, {
      kind: 'exchange',
      reason: 'Wanted blue',
      version: o.version,
      lines: [{ item_id: o.items[0].id, quantity: 1, restock: true }],
      replacements: [{ variant_id: cat.blue, quantity: 1, size: 'Free', unit_price: 4000 }],
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ state: 'active', total: 7500, amount_paid: 7000, balance_due: 500, refund_due: 0, payment_status: 'partial' });
    expect(r.body.items).toHaveLength(2);
    const replacement = r.body.items.find((i: any) => i.variant_id === cat.blue);
    expect(replacement.return_id).toBe(r.body.returns[0].id);
    expect(r.body.returns[0].replacements[0]).toMatchObject({ color: 'Blue', quantity: 1 });
    expect(await stockOf(teza, cat.red)).toBe(2); // 3 - 2 + 1 back
    expect(await stockOf(teza, cat.blue)).toBe(0); // replacement went out

    // Exchanging needs a replacement; out-of-stock replacement is refused and nothing changes.
    const none = await teza.post(`/api/orders/${o.id}/returns`, { kind: 'exchange', version: r.body.version, lines: [{ item_id: o.items[0].id, quantity: 1, restock: true }] });
    expect(none.status).toBe(400);
    const noStock = await teza.post(`/api/orders/${o.id}/returns`, {
      kind: 'exchange',
      version: r.body.version,
      lines: [{ item_id: o.items[0].id, quantity: 1, restock: true }],
      replacements: [{ variant_id: cat.blue, quantity: 1, unit_price: 3500 }],
    });
    expect(noStock.status).toBe(409);
    const after = (await teza.get(`/api/orders/${o.id}`)).body;
    expect(after.items.find((i: any) => i.id === o.items[0].id).returned_qty).toBe(1);
    expect(await stockOf(teza, cat.red)).toBe(2);

    // A line with a return can't have its quantity changed in the edit form.
    const edit = await teza.put(`/api/orders/${o.id}`, {
      customer,
      platform: 'tiktok',
      version: after.version,
      items: after.items.map((i: any) => ({ id: i.id, variant_id: i.variant_id, size: i.size, quantity: i.variant_id === cat.red ? 1 : i.quantity, unit_price: i.unit_price })),
    });
    expect(edit.status).toBe(400);
    expect(edit.body.error).toMatch(/has a return recorded/);
    // …but other edits keep working.
    const ok = await teza.put(`/api/orders/${o.id}`, {
      customer,
      platform: 'tiktok',
      version: after.version,
      notes: 'Exchanged for blue',
      items: after.items.map((i: any) => ({ id: i.id, variant_id: i.variant_id, size: i.size, quantity: i.quantity, unit_price: i.unit_price })),
    });
    expect(ok.status).toBe(200);
    expect(ok.body.total).toBe(7500);
  });

  it('a stale version is refused', async () => {
    const { teza, cat } = await start();
    const o = await paidOrder(teza, cat);
    const r = await teza.post(`/api/orders/${o.id}/returns`, { kind: 'return', version: o.version - 1, lines: [{ item_id: o.items[0].id, quantity: 1, restock: true }] });
    expect(r.status).toBe(409);
    expect(await stockOf(teza, cat.red)).toBe(1);
  });

  it('cancels with or without putting pieces back, and refunds at the same time or later', async () => {
    const { teza, partner, cat } = await start();
    // Already cut: don't put back in stock; refund part now.
    const o = await paidOrder(teza, cat);
    const c = await teza.post(`/api/orders/${o.id}/cancel`, { reason: 'Customer changed mind', restock: false, refund: { amount: 5000, method: 'esewa' } });
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ state: 'cancelled', amount_paid: 2000, refunded: 5000, refund_due: 2000, balance_due: 0 });
    expect(c.body.notes).toMatch(/Cancelled: Customer changed mind/);
    expect(c.body.notes).toMatch(/not put back in stock/);
    expect(await stockOf(teza, cat.red)).toBe(1);
    const d = (await teza.get('/api/dashboard')).body;
    expect(d.refunds_due).toMatchObject({ orders: 1, amount: 2000 });
    // The rest later.
    const later = await teza.post(`/api/orders/${o.id}/refunds`, { amount: 2000, method: 'cash' });
    expect(later.body).toMatchObject({ amount_paid: 0, refund_due: 0, refunded: 7000 });
    const alerts = (await partner.get('/api/security/alerts')).body.alerts;
    expect(alerts.some((a: any) => a.kind === 'paid_order_cancelled' && /Rs 5000 was refunded/.test(a.message))).toBe(true);

    // Default cancel still puts stock back (unchanged behaviour), no refund needed.
    const o2 = (await teza.post('/api/orders', { customer, platform: 'facebook', items: [{ variant_id: cat.red, quantity: 1, unit_price: 3500 }] })).body;
    expect(await stockOf(teza, cat.red)).toBe(0);
    const c2 = await teza.post(`/api/orders/${o2.id}/cancel`, {});
    expect(c2.body).toMatchObject({ state: 'cancelled', refund_due: 0 });
    expect(await stockOf(teza, cat.red)).toBe(1);

    // Refund on an unpaid order is refused.
    const nothing = await teza.post(`/api/orders/${o2.id}/refunds`, { amount: 100, method: 'cash' });
    expect(nothing.status).toBe(400);
    expect(nothing.body.error).toMatch(/Nothing has been paid/);
  });

  it('cancelling after a partial return only puts back the pieces still on the order', async () => {
    const { teza, cat } = await start();
    const o = await paidOrder(teza, cat);
    const r = await teza.post(`/api/orders/${o.id}/returns`, { kind: 'return', version: o.version, lines: [{ item_id: o.items[0].id, quantity: 1, restock: true }] });
    expect(await stockOf(teza, cat.red)).toBe(2);
    await teza.post(`/api/orders/${r.body.id}/cancel`, {});
    expect(await stockOf(teza, cat.red)).toBe(3); // not 4
  });

  it('payments must be positive – money going back is a refund', async () => {
    const { teza, cat } = await start();
    const o = await paidOrder(teza, cat);
    const neg = await teza.post(`/api/orders/${o.id}/payments`, { amount: -100, method: 'cash' });
    expect(neg.status).toBe(400);
  });

  it('products can be marked as returnable', async () => {
    const { teza, cat } = await start();
    const tree = async () => (await teza.get('/api/catalog')).body.categories.flatMap((c: any) => c.products).find((p: any) => p.id === cat.productId);
    expect((await tree()).returnable).toBe(0);
    await teza.patch(`/api/catalog/products/${cat.productId}`, { returnable: true });
    expect((await tree()).returnable).toBe(1);
  });
});
