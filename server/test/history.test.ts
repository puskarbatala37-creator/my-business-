import { addDays, todayInBusinessTz } from '@slay/shared';
import { describe, expect, it } from 'vitest';
import { login, seedCatalog, setup, w } from './helpers.js';

const customer = { name: 'Rina Karki', phone: '9851098765' };

/** Orders today, ~8 months ago, ~14 months ago and 3 years ago. */
async function withOldOrders() {
  const s = setup();
  const teza = w(await login(s.app, 'teza', 'password-teza'));
  const cat = await seedCatalog(teza);
  await teza.post('/api/catalog/variants/' + cat.red + '/stock', { delta: 20, reason: 'restock' });
  const today = todayInBusinessTz();
  const dates = { today, eightMonths: addDays(today, -240), fourteenMonths: addDays(today, -425), threeYears: addDays(today, -1100) };
  const prices = { today: 1000, eightMonths: 2000, fourteenMonths: 3000, threeYears: 4000 };
  for (const k of Object.keys(dates) as (keyof typeof dates)[]) {
    const r = await teza.post('/api/orders', {
      platform: 'tiktok',
      customer,
      order_date: dates[k],
      items: [{ variant_id: cat.red, quantity: 1, unit_price: prices[k] }],
      payment: { status: 'paid', method: 'cash' },
    });
    expect(r.status).toBe(201);
  }
  return { teza, dates };
}

describe('sales and history go back as far as the data does', () => {
  it('dashboard: 12 months and all-time totals, chart for every month', async () => {
    const { teza, dates } = await withOldOrders();
    const d = (await teza.get('/api/dashboard')).body;
    expect(d.six_months.sales).toBe(1000);
    expect(d.twelve_months.sales).toBe(3000); // today + 8 months ago
    expect(d.all_time).toMatchObject({ from: dates.threeYears, sales: 10000, orders: 4 });
    expect(d.months).toHaveLength(12);
    const all = (await teza.get('/api/dashboard?chart=all')).body.months;
    expect(all[0].month).toBe(dates.threeYears.slice(0, 7));
    expect(all.at(-1).month).toBe(dates.today.slice(0, 7));
    expect(all.reduce((n: number, m: any) => n + m.sales, 0)).toBe(10000);
    expect(all.length).toBeGreaterThanOrEqual(36);
  });

  it('sales for any dates, however old', async () => {
    const { teza, dates } = await withOldOrders();
    const old = (await teza.get(`/api/dashboard/period?from=${dates.threeYears}&to=${dates.fourteenMonths}`)).body;
    expect(old).toMatchObject({ orders: 2, sales: 7000, collected: 7000 });
    const everything = (await teza.get('/api/dashboard/period')).body;
    expect(everything).toMatchObject({ from: dates.threeYears, to: dates.today, orders: 4, sales: 10000 });
    const backwards = await teza.get(`/api/dashboard/period?from=${dates.today}&to=${dates.threeYears}`);
    expect(backwards.status).toBe(400);
    expect(backwards.body.error).toMatch(/after the “to” date/);
  });

  it('order search and customer history include orders years old', async () => {
    const { teza, dates } = await withOldOrders();
    const all = (await teza.get('/api/orders')).body;
    expect(all.summary).toMatchObject({ count: 4, total: 10000 });
    const oldOnly = (await teza.get(`/api/orders?from=${dates.threeYears}&to=${dates.threeYears}`)).body;
    expect(oldOnly.orders).toHaveLength(1);
    expect(oldOnly.orders[0].total).toBe(4000);
    const byName = (await teza.get('/api/orders?q=Rina')).body;
    expect(byName.summary.count).toBe(4);
    const c = byName.orders[0].customer_id;
    expect((await teza.get(`/api/customers/${c}`)).body.orders).toHaveLength(4);
  });
});
