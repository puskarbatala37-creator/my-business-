import { describe, expect, it } from 'vitest';
import { login, seedCatalog, setup, w } from './helpers.js';

const customer = { name: 'Rina Karki', phone: '9851098765' };
const stockOf = async (api: any, id: number) => (await api.get(`/api/catalog/variants/${id}`)).body.stock;

describe('a different size for each piece', () => {
  it('keeps two kurtas of different sizes on one order line', async () => {
    const s = setup();
    const teza = w(await login(s.app, 'teza', 'password-teza'));
    const cat = await seedCatalog(teza);
    const res = await teza.post('/api/orders', {
      customer,
      platform: 'tiktok',
      items: [{ variant_id: cat.red, quantity: 2, sizes: ['42', '41'], unit_price: 3500 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ quantity: 2, sizes: ['42', '41'], size: '42, 41' });
    expect(res.body.total).toBe(7000);
    expect(await stockOf(teza, cat.red)).toBe(1); // 3 - 2, taken once for the line

    // Edit: three pieces now, two of them 42 – summary groups them; stock follows the quantity.
    const id = res.body.id;
    const line = res.body.items[0];
    const edited = await teza.put(`/api/orders/${id}`, {
      customer,
      platform: 'tiktok',
      version: res.body.version,
      items: [{ id: line.id, variant_id: cat.red, quantity: 3, sizes: ['42', '41', '42'], unit_price: 3500 }],
    });
    expect(edited.status).toBe(200);
    expect(edited.body.items[0]).toMatchObject({ quantity: 3, sizes: ['42', '41', '42'], size: '42 ×2, 41' });
    expect(await stockOf(teza, cat.red)).toBe(0);

    // All the same again → stored as a plain size.
    const same = await teza.put(`/api/orders/${id}`, {
      customer,
      platform: 'tiktok',
      version: edited.body.version,
      items: [{ id: line.id, variant_id: cat.red, quantity: 2, sizes: ['40', '40'], unit_price: 3500 }],
    });
    expect(same.body.items[0]).toMatchObject({ quantity: 2, sizes: null, size: '40' });
  });

  it('needs exactly one size per piece', async () => {
    const s = setup();
    const teza = w(await login(s.app, 'teza', 'password-teza'));
    const cat = await seedCatalog(teza);
    const res = await teza.post('/api/orders', { customer, platform: 'tiktok', items: [{ variant_id: cat.red, quantity: 2, sizes: ['42'], unit_price: 3500 }] });
    expect(res.status).toBe(400);
    expect(await stockOf(teza, cat.red)).toBe(3);
  });
});
