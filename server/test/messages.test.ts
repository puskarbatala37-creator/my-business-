import { describe, expect, it } from 'vitest';
import { login, seedCatalog, setup, w } from './helpers.js';

const customer = { name: 'Sita Sharma', phone: '9841234567' };

describe('error messages a shop owner sees', () => {
  it('form problems are one plain sentence, never field paths or validator jargon', async () => {
    const { app } = setup();
    const teza = w(await login(app, 'teza', 'password-teza'));
    const cat = await seedCatalog(teza);
    const msg = async (body: object) => (await teza.post('/api/orders', body)).body.error as string;

    expect(await msg({ customer: { ...customer, name: '' }, platform: 'tiktok', items: [{ variant_id: cat.red, quantity: 1, unit_price: 100 }] })).toBe('Customer name is required');
    expect(await msg({ customer, platform: 'tiktok', items: [{ variant_id: cat.red, quantity: 1, unit_price: 'abc' }] })).toBe('Item 1: Price must be a number');
    expect(await msg({ customer, platform: 'tiktok', items: [{ variant_id: cat.red, quantity: 0, unit_price: 100 }] })).toBe("Item 1: Quantity can't be less than 1");
    expect(await msg({ customer, platform: 'tiktok', items: [] })).toBe('Add at least one item');
    expect(await msg({ customer, platform: 'myspace', items: [{ variant_id: cat.red, quantity: 1, unit_price: 100 }] })).toMatch(/^Choose where the order came from/);
    expect(await msg({ customer, platform: 'tiktok', order_date: '9/10/2026', items: [{ variant_id: cat.red, quantity: 1, unit_price: 100 }] })).toBe('Enter a valid date');
    const all = [await msg({ customer: {}, platform: 'tiktok', items: [{}] })];
    for (const m of all) expect(m).not.toMatch(/expected|Invalid input|\w+\.\d+\.|undefined/);
  });

  it('running out of stock says what to do next', async () => {
    const { app } = setup();
    const teza = w(await login(app, 'teza', 'password-teza'));
    const cat = await seedCatalog(teza);
    const res = await teza.post('/api/orders', { customer, platform: 'tiktok', items: [{ variant_id: cat.blue, quantity: 3, unit_price: 3500 }] });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Only 1 left of Banarasi Silk (Blue). Lower the quantity, or add stock first under Stock.');
    await teza.post('/api/orders', { customer, platform: 'tiktok', items: [{ variant_id: cat.blue, quantity: 1, unit_price: 3500 }] });
    const out = await teza.post('/api/orders', { customer, platform: 'tiktok', items: [{ variant_id: cat.blue, quantity: 1, unit_price: 3500 }] });
    expect(out.body.error).toBe('Banarasi Silk (Blue) is out of stock. Remove it from the order, or add stock first under Stock.');
  });

  it('wrong password and unknown pages read plainly', async () => {
    const { app } = setup();
    const request = (await import('supertest')).default;
    const bad = await request(app).post('/api/auth/login').set('x-slay', '1').send({ email: 'teza@example.com', password: 'nope' });
    expect(bad.body.error).toBe('Wrong email or password');
    const teza = w(await login(app, 'teza', 'password-teza'));
    expect((await teza.get('/api/orders/abc')).body.error).toBe('This link isn’t valid. Go back and try again.');
    expect((await teza.get('/api/orders/999')).body.error).toBe('Order not found');
  });
});
