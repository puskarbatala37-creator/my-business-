import { describe, expect, it } from 'vitest';
import { login, setup, w } from './helpers.js';

const bill = (category: string) => ({ photo: '/uploads/bill.jpg', supplier: 'Shop', amount: 1000, category });

describe('supplier bill types', () => {
  it('offers the four presets, and lets the team add (and remove) their own', async () => {
    const { app } = setup();
    const teza = w(await login(app, 'teza', 'password-teza'));
    const partner = w(await login(app, 'partner', 'password-partner'));
    expect((await teza.get('/api/receipts/types')).body).toEqual({ presets: ['Fabric', 'Stitching', 'Ready-made', 'Thread'], custom: [] });

    const added = await teza.post('/api/receipts/types', { name: '  Packaging   bags ' });
    expect(added.status).toBe(201);
    expect(added.body.name).toBe('Packaging bags');
    // Shared with the whole team.
    const custom = (await partner.get('/api/receipts/types')).body.custom;
    expect(custom.map((t: any) => t.name)).toEqual(['Packaging bags']);

    // Same name in other capitalisation, or a preset, never makes a duplicate.
    expect((await partner.post('/api/receipts/types', { name: 'packaging BAGS' })).body.name).toBe('Packaging bags');
    expect((await partner.post('/api/receipts/types', { name: 'fabric' })).body.name).toBe('Fabric');
    expect((await partner.get('/api/receipts/types')).body.custom).toHaveLength(1);
    expect((await partner.post('/api/receipts/types', { name: '   ' })).status).toBe(400);

    // Saving a bill with a brand-new type adds it to the choices; presets are stored in their usual spelling.
    expect((await teza.post('/api/receipts', bill('Buttons & lace'))).body.category).toBe('Buttons & lace');
    expect((await teza.post('/api/receipts', bill('thread'))).body.category).toBe('Thread');
    const names = (await teza.get('/api/receipts/types')).body.custom.map((t: any) => t.name);
    expect(names).toEqual(['Buttons & lace', 'Packaging bags']);

    // Filter by type, any capitalisation.
    expect((await teza.get('/api/receipts?category=buttons%20%26%20lace')).body.count).toBe(1);

    // Removing a type keeps the bills that used it.
    const id = (await teza.get('/api/receipts/types')).body.custom.find((t: any) => t.name === 'Buttons & lace').id;
    expect((await partner.delete(`/api/receipts/types/${id}`)).status).toBe(200);
    expect((await teza.get('/api/receipts/types')).body.custom.map((t: any) => t.name)).toEqual(['Packaging bags']);
    expect((await teza.get('/api/receipts?q=lace')).body.receipts[0].category).toBe('Buttons & lace');
  });
});
