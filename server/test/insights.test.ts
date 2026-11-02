import { todayInBusinessTz } from '@slay/shared';
import { describe, expect, it } from 'vitest';
import { login, seedCatalog, setup, w } from './helpers.js';

describe('insights for a period', () => {
  it('ranks designs, colours, types and platforms; repeat rate; profit; best per platform', async () => {
    const s = setup();
    const teza = w(await login(s.app, 'teza', 'password-teza'));
    const sari = await seedCatalog(teza); // Banarasi Silk sari: Red ×3, Blue ×1 – cost 1800
    const lehengaCat = (await teza.get('/api/catalog')).body.categories.find((c: any) => c.name === 'Lehenga');
    await teza.post('/api/catalog/products', {
      category_id: lehengaCat.id,
      name: 'Bridal Lehenga',
      variants: [
        { color: 'Maroon', stock: 10, cost: 5000, price: 9000 },
        { color: 'Gold', stock: 5, cost: 5000, price: 9000 },
      ],
    });
    const leh = (await teza.get('/api/catalog')).body.categories.find((c: any) => c.name === 'Lehenga').products[0].variants;
    const maroon = leh.find((v: any) => v.color === 'Maroon').id;
    const gold = leh.find((v: any) => v.color === 'Gold').id;
    const today = todayInBusinessTz();
    const order = (platform: string, phone: string, items: any[], extra: object = {}) =>
      teza.post('/api/orders', { customer: { name: `C ${phone}`, phone }, platform, items, ...extra }).then((r: any) => {
        expect(r.status).toBe(201);
        return r.body;
      });

    // TikTok: maroon lehenga ×3 (two customers, one of them returning), gold ×1
    await order('tiktok', '9800000001', [{ variant_id: maroon, quantity: 2, unit_price: 9000 }], { delivery_charge: 150 });
    await order('tiktok', '9800000002', [{ variant_id: maroon, quantity: 1, unit_price: 9000 }]);
    await order('tiktok', '9800000001', [{ variant_id: gold, quantity: 1, unit_price: 9000 }]); // 2nd order of 9800000001
    // Instagram: red sari ×2
    await order('instagram', '9800000003', [{ variant_id: sari.red, quantity: 2, unit_price: 3500 }]);
    // Facebook: blue sari ×1, then cancelled → not counted
    const cancelled = await order('facebook', '9800000004', [{ variant_id: sari.blue, quantity: 1, unit_price: 3500 }]);
    await teza.post(`/api/orders/${cancelled.id}/cancel`, {});
    // An order outside the period doesn't count
    await order('whatsapp', '9800000005', [{ variant_id: sari.red, quantity: 1, unit_price: 3500 }], { order_date: '2020-01-01' });

    const r = await teza.get(`/api/insights?from=${today}&to=${today}`);
    expect(r.status).toBe(200);
    const d = r.body;
    expect(d.totals).toMatchObject({ orders: 4, pieces: 6 });
    // sales = 18150 + 9000 + 9000 + 7000 = 43150; profit = sales − delivery − cost = 43150 − 150 − (4×5000 + 2×1800) = 19400
    expect(d.totals.sales).toBe(43150);
    expect(d.totals.profit).toBe(19400);
    expect(d.totals.profit_per_order).toBe(4850);

    expect(d.designs[0]).toMatchObject({ name: 'Bridal Lehenga', pieces: 4, sales: 36000, profit: 16000 });
    expect(d.designs[1]).toMatchObject({ name: 'Banarasi Silk', pieces: 2 });
    expect(d.colours.map((c: any) => [c.name, c.pieces])).toEqual([['Maroon', 3], ['Red', 2], ['Gold', 1]]);
    expect(d.types.map((t: any) => [t.name, t.pieces])).toEqual([['Lehenga', 4], ['Sari', 2]]);
    expect(d.platforms.map((p: any) => [p.platform, p.orders, p.sales])).toEqual([['tiktok', 3, 36150], ['instagram', 1, 7000]]);
    expect(d.repeat).toMatchObject({ orders: 4, repeat_orders: 1, rate: 25, customers: 3, returning_customers: 1 });

    const tiktok = d.by_platform.find((p: any) => p.platform === 'tiktok');
    expect(tiktok.best).toMatchObject({ design: 'Bridal Lehenga', color: 'Maroon', category: 'Lehenga', pieces: 3 });
    const insta = d.by_platform.find((p: any) => p.platform === 'instagram');
    expect(insta.best).toMatchObject({ design: 'Banarasi Silk', color: 'Red', pieces: 2 });
  });

  it('returned pieces don’t count as sold; an empty period is fine; bad dates are refused', async () => {
    const s = setup();
    const teza = w(await login(s.app, 'teza', 'password-teza'));
    const cat = await seedCatalog(teza);
    const o = (await teza.post('/api/orders', { customer: { name: 'R', phone: '9800000009' }, platform: 'tiktok', items: [{ variant_id: cat.red, quantity: 2, unit_price: 3500 }] })).body;
    await teza.post(`/api/orders/${o.id}/returns`, { kind: 'return', version: o.version, lines: [{ item_id: o.items[0].id, quantity: 1, restock: true }] });
    const today = todayInBusinessTz();
    const d = (await teza.get(`/api/insights?from=${today}`)).body;
    expect(d.designs[0]).toMatchObject({ name: 'Banarasi Silk', pieces: 1, sales: 3500 });
    const empty = (await teza.get('/api/insights?from=2001-01-01&to=2001-01-31')).body;
    expect(empty).toMatchObject({ totals: { orders: 0, profit_per_order: 0 }, designs: [], repeat: { rate: 0 } });
    expect((await teza.get(`/api/insights?from=${today}&to=2001-01-01`)).status).toBe(400);
  });
});
