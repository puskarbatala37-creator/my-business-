import { describe, expect, it } from 'vitest';
import { login, setup, w } from './helpers.js';

async function ready() {
  const s = setup();
  const teza = w(await login(s.app, 'teza', 'password-teza'));
  const cats = (await teza.get('/api/catalog')).body.categories;
  return { ...s, teza, cats, id: (name: string) => cats.find((c: any) => c.name === name)?.id as number };
}

const stockOf = async (api: any, productId: number) => {
  const p = (await api.get('/api/catalog')).body.categories.flatMap((c: any) => c.products).find((x: any) => x.id === productId);
  return Object.fromEntries(p.variants.map((v: any) => [v.color, v.stock]));
};

describe('product types', () => {
  it('starts with Kurta, Sari and Lehenga (with Nepali voice words)', async () => {
    const { cats } = await ready();
    expect(cats.map((c: any) => c.name)).toEqual(['Kurta', 'Sari', 'Lehenga']);
    expect(cats[1].voice_aliases).toContain('साडी');
  });

  it('adds a new product type while adding a product, and reuses it by name', async () => {
    const { teza } = await ready();
    const r = await teza.post('/api/catalog/products', { new_category: 'Shawl', name: 'Pashmina', total_stock: 4, variants: [{ color: 'Cream' }] });
    expect(r.status).toBe(201);
    const again = await teza.post('/api/catalog/products', { new_category: 'shawl', name: 'Wool Shawl', total_stock: 2, variants: [{ color: 'Grey' }] });
    expect(again.status).toBe(201);
    const cats = (await teza.get('/api/catalog')).body.categories;
    expect(cats.map((c: any) => c.name)).toEqual(['Kurta', 'Sari', 'Lehenga', 'Shawl']);
    expect(cats[3].products).toHaveLength(2);
  });

  it('needs a category', async () => {
    const { teza } = await ready();
    const r = await teza.post('/api/catalog/products', { name: 'X', variants: [{ color: 'Red' }] });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('choose a category');
  });
});

describe('total stock when adding a product', () => {
  it('one colour gets the whole total', async () => {
    const { teza, id } = await ready();
    const r = await teza.post('/api/catalog/products', { category_id: id('Sari'), name: 'Banarasi', total_stock: 12, variants: [{ color: 'Red', price: 3500 }] });
    expect(await stockOf(teza, r.body.id)).toEqual({ Red: 12 });
  });

  it('several colours must add up to the total', async () => {
    const { teza, id } = await ready();
    const bad = await teza.post('/api/catalog/products', {
      category_id: id('Kurta'),
      name: 'Kurta Set',
      total_stock: 10,
      variants: [{ color: 'Black', stock: 6 }, { color: 'White', stock: 3 }],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('The colours add up to 9 pieces, but the total stock is 10. Make them match.');
    const ok = await teza.post('/api/catalog/products', {
      category_id: id('Kurta'),
      name: 'Kurta Set',
      total_stock: 10,
      variants: [{ color: 'Black', stock: 6 }, { color: 'White', stock: 4 }],
    });
    expect(await stockOf(teza, ok.body.id)).toEqual({ Black: 6, White: 4 });
  });

  it('the opening stock is recorded in the stock history', async () => {
    const { teza, id } = await ready();
    const r = await teza.post('/api/catalog/products', { category_id: id('Lehenga'), name: 'Bridal', total_stock: 3, variants: [{ color: 'Rani Pink' }] });
    const v = (await teza.get('/api/catalog')).body.categories.find((c: any) => c.name === 'Lehenga').products.find((p: any) => p.id === r.body.id).variants[0];
    const moves = (await teza.get(`/api/catalog/variants/${v.id}/movements`)).body.movements;
    expect(moves[0]).toMatchObject({ delta: 3, reason: 'restock', note: 'Opening stock' });
  });
});
