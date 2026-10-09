import { addDays, todayInBusinessTz } from '@slay/shared';
import { describe, expect, it } from 'vitest';
import { login, seedCatalog, setup, w } from './helpers.js';

async function ready() {
  const s = setup();
  const teza = w(await login(s.app, 'teza', 'password-teza'));
  const cat = await seedCatalog(teza); // Sari → Banarasi Silk (Red, Blue)
  const kurtaCat = (await teza.get('/api/catalog')).body.categories.find((c: any) => c.name === 'Kurta').id;
  await teza.post('/api/catalog/products', { category_id: kurtaCat, name: 'Kurta Set', variants: [{ color: 'Black', stock: 10, price: 1800 }] });
  const tree = (await teza.get('/api/catalog')).body.categories;
  const black = tree.find((c: any) => c.name === 'Kurta').products[0].variants[0].id;
  const today = todayInBusinessTz();
  const order = (customer: string, platform: string, variant: number, daysAgo: number) =>
    teza.post('/api/orders', { customer: { name: customer }, platform, order_date: addDays(today, -daysAgo), items: [{ variant_id: variant, quantity: 1, unit_price: 1000 }] });
  expect((await order('Sita Sharma', 'instagram', cat.red, 0)).status).toBe(201);
  await order('Gita Rai', 'whatsapp', black, 3);
  await order('Sita Sharma', 'tiktok', black, 40);
  await order('Rina Karki', 'facebook', cat.blue, 10);
  return { ...s, teza, today, kurtaCat };
}

const names = (r: any) => r.body.orders.map((o: any) => o.customer_name).sort();

describe('order history search', () => {
  it('every order must say which platform it came from', async () => {
    const { teza } = await ready();
    const tree = (await teza.get('/api/catalog')).body.categories;
    const red = tree[0].products[0].variants[0].id;
    const noPlatform = await teza.post('/api/orders', { customer: { name: 'X' }, items: [{ variant_id: red, quantity: 1, unit_price: 1 }] });
    expect(noPlatform.status).toBe(400);
    expect(noPlatform.body.error).toMatch(/choose where the order came from/i);
    expect((await teza.post('/api/orders', { customer: { name: 'X' }, platform: 'myspace', items: [{ variant_id: red, quantity: 1, unit_price: 1 }] })).status).toBe(400);
    const wa = (await teza.get('/api/orders?platform=whatsapp')).body.orders;
    expect(wa).toHaveLength(1);
    expect(wa[0].platform).toBe('whatsapp');
  });

  it('by customer name', async () => {
    const { teza } = await ready();
    const r = await teza.get('/api/orders?customer=sita');
    expect(names(r)).toEqual(['Sita Sharma', 'Sita Sharma']);
    expect(r.body.summary).toEqual({ count: 2, total: 2000, paid: 0 });
  });

  it('by order date (single day and range)', async () => {
    const { teza, today } = await ready();
    expect(names(await teza.get(`/api/orders?from=${today}&to=${today}`))).toEqual(['Sita Sharma']);
    expect(names(await teza.get(`/api/orders?from=${addDays(today, -14)}&to=${today}`))).toEqual(['Gita Rai', 'Rina Karki', 'Sita Sharma']);
  });

  it('by product type', async () => {
    const { teza } = await ready();
    expect(names(await teza.get('/api/orders?category=kurta'))).toEqual(['Gita Rai', 'Sita Sharma']);
    expect(names(await teza.get('/api/orders?category=Sari'))).toEqual(['Rina Karki', 'Sita Sharma']);
    // Typing a product type in the search box works too.
    expect(names(await teza.get('/api/orders?q=kurta'))).toEqual(['Gita Rai', 'Sita Sharma']);
    const row = (await teza.get('/api/orders?category=kurta')).body.orders[0];
    expect(row.categories).toBe('Kurta');
  });

  it('filters combine', async () => {
    const { teza, today } = await ready();
    expect(names(await teza.get(`/api/orders?customer=sita&category=Kurta`))).toEqual(['Sita Sharma']);
    expect(names(await teza.get(`/api/orders?customer=sita&category=Kurta&from=${addDays(today, -7)}`))).toEqual([]);
    expect(names(await teza.get(`/api/orders?category=Kurta&platform=whatsapp`))).toEqual(['Gita Rai']);
  });

  it('history keeps the product type even after the catalog is renamed', async () => {
    const { teza, kurtaCat } = await ready();
    await teza.patch(`/api/catalog/categories/${kurtaCat}`, { name: 'Kurta Suruwal' });
    expect(names(await teza.get('/api/orders?category=Kurta'))).toEqual(['Gita Rai', 'Sita Sharma']);
  });

  it('pages through long histories', async () => {
    const { teza } = await ready();
    const page1 = (await teza.get('/api/orders?limit=3')).body;
    expect(page1.orders).toHaveLength(3);
    expect(page1.has_more).toBe(true);
    const page2 = (await teza.get('/api/orders?limit=3&offset=3')).body;
    expect(page2.orders).toHaveLength(1);
    expect(page2.has_more).toBe(false);
  });
});
