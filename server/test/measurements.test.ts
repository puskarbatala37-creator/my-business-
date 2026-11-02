import { measurementSummary } from '@slay/shared';
import { describe, expect, it } from 'vitest';
import { login, seedCatalog, setup, w } from './helpers.js';

const customer = { name: 'Rina Karki', phone: '9851098765' };

describe('custom stitching measurements per item', () => {
  it('each item keeps its own separate measurements; sizes stay as they are', async () => {
    const s = setup();
    const teza = w(await login(s.app, 'teza', 'password-teza'));
    const cat = await seedCatalog(teza);
    const r = await teza.post('/api/orders', {
      customer,
      platform: 'instagram',
      items: [
        { variant_id: cat.red, quantity: 1, size: 'M', unit_price: 3500, measurements: { bust: '34', waist: ' 28.5 ', hip: '', neck: '13' } },
        { variant_id: cat.blue, quantity: 1, size: '40', unit_price: 3500, measurements: { pant_length: '39', underarm: '12', chest: '36' } },
      ],
    });
    expect(r.status).toBe(201);
    const [a, b] = r.body.items;
    expect(a).toMatchObject({ size: 'M', measurements: { bust: '34', waist: '28.5', neck: '13' } });
    expect(a.measurements).not.toHaveProperty('hip'); // empty ones are left out
    expect(b).toMatchObject({ size: '40', measurements: { pant_length: '39', underarm: '12', chest: '36' } });
    expect(measurementSummary(a.measurements)).toBe('Bust 34 · Waist 28.5 · Neck 13');

    // Edit: change one value, clear the other item's measurements entirely.
    const e = await teza.put(`/api/orders/${r.body.id}`, {
      customer,
      platform: 'instagram',
      version: r.body.version,
      items: [
        { id: a.id, variant_id: cat.red, quantity: 1, size: 'M', unit_price: 3500, measurements: { bust: '35', waist: '28.5', neck: '13' } },
        { id: b.id, variant_id: cat.blue, quantity: 1, size: '40', unit_price: 3500, measurements: null },
      ],
    });
    expect(e.status).toBe(200);
    expect(e.body.items[0].measurements).toEqual({ bust: '35', waist: '28.5', neck: '13' });
    expect(e.body.items[1].measurements).toBeNull();
  });

  it('orders without measurements work as before; unknown measurement names are refused', async () => {
    const s = setup();
    const teza = w(await login(s.app, 'teza', 'password-teza'));
    const cat = await seedCatalog(teza);
    const plain = await teza.post('/api/orders', { customer, platform: 'tiktok', items: [{ variant_id: cat.red, quantity: 1, size: 'L', unit_price: 3000 }] });
    expect(plain.body.items[0].measurements).toBeNull();
    const bad = await teza.post('/api/orders', { customer, platform: 'tiktok', items: [{ variant_id: cat.red, quantity: 1, unit_price: 3000, measurements: { shoulder: '15' } }] });
    expect(bad.status).toBe(400);
  });
});
