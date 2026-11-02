import { describe, expect, it } from 'vitest';
import { nameKey, normalizePhone } from '../src/modules/customers/service.js';
import { login, seedCatalog, setup, w } from './helpers.js';

describe('recognising the same customer', () => {
  it('one phone number however it is written', () => {
    for (const p of ['9841234567', '984-123-4567', '984 123 4567', '+977 9841234567', '+977-984-1234567', '00977 9841234567', '9779841234567', '९८४१२३४५६७']) {
      expect(normalizePhone(p), p).toBe('9841234567');
    }
    expect(normalizePhone('+61 412 345 678')).toBe('+61412345678');
    expect(normalizePhone('0061 412 345 678')).toBe('+61412345678');
    expect(normalizePhone('')).toBeNull();
  });

  it('names spelled differently sound the same', () => {
    expect(nameKey('Sita')).toBe(nameKey('Seeta'));
    expect(nameKey('Pooja Thapa')).toBe(nameKey('Puja Thapa'));
    expect(nameKey('Laxmi')).toBe(nameKey('Lakshmi'));
    expect(nameKey('Shrestha')).toBe(nameKey('Srestha'));
    expect(nameKey('Sita')).not.toBe(nameKey('Gita'));
  });
});

describe('repeat customer badge', () => {
  it('numbers each customer’s orders: 1st, 2nd, 3rd – matched by phone in any format', async () => {
    const s = setup();
    const teza = w(await login(s.app, 'teza', 'password-teza'));
    const cat = await seedCatalog(teza);
    await teza.post(`/api/catalog/variants/${cat.red}/stock`, { delta: 20, reason: 'restock' });
    const order = (phone: string, name: string, order_date?: string) =>
      teza.post('/api/orders', { customer: { name, phone }, platform: 'tiktok', order_date, items: [{ variant_id: cat.red, quantity: 1, unit_price: 3000 }] });

    const first = (await order('9841234567', 'Sita Sharma', '2026-01-05')).body;
    const second = (await order('+977 984-123-4567', 'Seeta Sharma', '2026-02-05')).body;
    const third = (await order('00977 9841234567', 'Sita', '2026-03-05')).body;
    const other = (await order('9800000000', 'Gita Rai', '2026-03-06')).body;
    expect(second.customer_id).toBe(first.customer_id); // same person, different spellings & formats
    expect(third.customer_id).toBe(first.customer_id);
    expect([first.customer_order_no, second.customer_order_no, third.customer_order_no, other.customer_order_no]).toEqual([1, 2, 3, 1]);

    const list = (await teza.get('/api/orders?state=all')).body.orders;
    expect(list.find((o: any) => o.id === third.id).customer_order_no).toBe(3);

    // A cancelled order doesn't count.
    await teza.post(`/api/orders/${second.id}/cancel`, {});
    expect((await teza.get(`/api/orders/${third.id}`)).body.customer_order_no).toBe(2);
    // Counted by order date, not by when it was typed in.
    const backdated = (await order('9841234567', 'Sita', '2025-12-01')).body;
    expect(backdated.customer_order_no).toBe(1);
    expect((await teza.get(`/api/orders/${first.id}`)).body.customer_order_no).toBe(2);
  });

  it('suggests a customer with a similar name (a hint only – no automatic match)', async () => {
    const s = setup();
    const teza = w(await login(s.app, 'teza', 'password-teza'));
    const cat = await seedCatalog(teza);
    await teza.post('/api/orders', { customer: { name: 'Seeta Sharma', phone: '9841234567' }, platform: 'tiktok', items: [{ variant_id: cat.red, quantity: 1, unit_price: 3000 }] });
    const hints = (await teza.get('/api/customers/similar?name=' + encodeURIComponent('Sita Sharma'))).body.customers;
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({ name: 'Seeta Sharma', phone: '9841234567', order_count: 1 });
    expect((await teza.get('/api/customers/similar?name=Gita')).body.customers).toHaveLength(0);
    // A new order with a different phone and similar name is still a new customer.
    const o = (await teza.post('/api/orders', { customer: { name: 'Sita Sharma', phone: '9811111111' }, platform: 'tiktok', items: [{ variant_id: cat.red, quantity: 1, unit_price: 3000 }] })).body;
    expect(o.customer_order_no).toBe(1);
  });

  it('old saved numbers are rewritten in the standard format on start', async () => {
    const s = setup();
    s.ctx.db.prepare(`INSERT INTO customers (name, phone) VALUES ('Old', '009779841111111')`).run();
    expect((s.ctx.services.customers as any).normalizeSavedPhones()).toBe(1);
    expect((s.ctx.db.prepare(`SELECT phone FROM customers WHERE name = 'Old'`).get() as any).phone).toBe('9841111111');
  });
});
