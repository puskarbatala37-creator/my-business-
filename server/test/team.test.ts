import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { service } from '../src/core/context.js';
import type { AuthService } from '../src/modules/auth/service.js';
import { login, seedCatalog, setup, w } from './helpers.js';

describe('team accounts', () => {
  it('an owner adds a new team member with just an email and password', async () => {
    const { app } = setup();
    const teza = w(await login(app, 'teza', 'password-teza'));
    const add = await teza.post('/api/auth/team', { email: 'sita@example.com', displayName: 'Sita', password: 'sita-pass-1' });
    expect(add.status).toBe(201);

    const sita = w(await login(app, 'sita', 'sita-pass-1'));
    const me = (await sita.get('/api/auth/me')).body;
    expect(me.user.role).toBe('member');
    expect(me.team).toHaveLength(3);

    // Members do the daily work…
    const cat = await seedCatalog(sita);
    const order = await sita.post('/api/orders', { platform: 'instagram', customer: { name: 'Gita' }, items: [{ variant_id: cat.red, quantity: 1, unit_price: 3500 }] });
    expect(order.status).toBe(201);
    // …but cannot manage the team.
    expect((await sita.post('/api/auth/team', { email: 'x1@example.com', displayName: 'X', password: 'xxxxxxxx' })).status).toBe(403);

    // Everyone is told a member was added.
    const alerts = (await sita.get('/api/security/alerts')).body.alerts;
    expect(alerts.some((a: any) => a.kind === 'team_member_added')).toBe(true);
  });

  it('rejects taken emails, invalid emails and short passwords', async () => {
    const { app } = setup();
    const teza = w(await login(app, 'teza', 'password-teza'));
    expect((await teza.post('/api/auth/team', { email: 'Partner@Example.com', displayName: 'P2', password: 'longenough' })).status).toBe(409);
    expect((await teza.post('/api/auth/team', { email: 'new@example.com', displayName: 'New', password: 'short' })).status).toBe(400);
    expect((await teza.post('/api/auth/team', { email: 'not-an-email', displayName: 'New', password: 'longenough' })).status).toBe(400);
  });

  it('switching a member off signs them out immediately; password resets work', async () => {
    const { app } = setup();
    const teza = w(await login(app, 'teza', 'password-teza'));
    const { id } = (await teza.post('/api/auth/team', { email: 'ram@example.com', displayName: 'Ram', password: 'ram-pass-11' })).body;
    const ram = w(await login(app, 'ram', 'ram-pass-11'));
    expect((await ram.get('/api/orders')).status).toBe(200);

    await teza.patch(`/api/auth/team/${id}`, { active: false });
    expect((await ram.get('/api/orders')).status).toBe(401);
    const again = await request(app).post('/api/auth/login').set('x-slay', '1').send({ email: 'ram@example.com', password: 'ram-pass-11' });
    expect(again.status).toBe(403);

    await teza.patch(`/api/auth/team/${id}`, { active: true, password: 'new-ram-pass' });
    await login(app, 'ram', 'new-ram-pass');
  });

  it('always keeps at least one owner, and you cannot switch yourself off', async () => {
    const { app } = setup();
    const teza = w(await login(app, 'teza', 'password-teza'));
    const team = (await teza.get('/api/auth/team')).body.team;
    const tezaId = team.find((u: any) => u.email === 'teza@example.com').id;
    const partnerId = team.find((u: any) => u.email === 'partner@example.com').id;
    expect((await teza.patch(`/api/auth/team/${tezaId}`, { active: false })).status).toBe(400);
    expect((await teza.patch(`/api/auth/team/${partnerId}`, { role: 'member' })).status).toBe(200);
    expect((await teza.patch(`/api/auth/team/${tezaId}`, { role: 'member' })).status).toBe(400);
  });
});

describe('first-run setup', () => {
  it('creates the first owner in the app with the setup code from the server log', async () => {
    const config = loadConfig({ dbFile: ':memory:', uploadsDir: path.join(os.tmpdir(), 'slay-test-uploads'), appUrl: 'http://slay.test', webDist: '/nonexistent', initialUsers: '' });
    const { app, ctx } = createApp(config);
    expect((await request(app).get('/api/auth/setup')).body.needsSetup).toBe(true);
    const code = service<AuthService>(ctx, 'auth').setupCode!;
    const body = { code: 'wrong', email: 'teza@example.com', displayName: 'Teza', phone: '9841234567', password: 'teza-pass-1' };
    expect((await request(app).post('/api/auth/setup').set('x-slay', '1').send(body)).status).toBe(403);
    const agent = request.agent(app);
    const ok = await agent.post('/api/auth/setup').set('x-slay', '1').send({ ...body, code });
    expect(ok.status).toBe(200);
    expect((await agent.get('/api/auth/me')).body.user.role).toBe('owner');
    // Can't be used again.
    expect((await request(app).post('/api/auth/setup').set('x-slay', '1').send({ ...body, code, email: 'evil@example.com' })).status).toBe(409);
  });
});

describe('biometric login endpoints', () => {
  it('issues one-time challenges and rejects unknown passkeys', async () => {
    const { app } = setup();
    const opts = (await request(app).post('/api/auth/passkey/login/options').set('x-slay', '1')).body;
    expect(opts.options.challenge).toBeTruthy();
    expect(opts.options.userVerification).toBe('required');
    const fake = { id: 'nope', rawId: 'nope', type: 'public-key', response: {}, clientExtensionResults: {} };
    const res = await request(app).post('/api/auth/passkey/login').set('x-slay', '1').send({ challengeId: opts.challengeId, response: fake });
    expect(res.status).toBe(401);
    // The challenge was consumed.
    const replay = await request(app).post('/api/auth/passkey/login').set('x-slay', '1').send({ challengeId: opts.challengeId, response: fake });
    expect(replay.status).toBe(400);

    const teza = w(await login(app, 'teza', 'password-teza'));
    const reg = (await teza.post('/api/auth/passkeys/options')).body;
    expect(reg.options.authenticatorSelection).toMatchObject({ authenticatorAttachment: 'platform', userVerification: 'required' });
    expect(reg.options.rp.id).toBe('slay.test');
  });
});
