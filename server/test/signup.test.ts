import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { login, setup, w } from './helpers.js';

const me = { email: 'Puskar@Gmail.com', displayName: 'Puskar', phone: '9812345678', password: 'my-own-pass-1' };
const post = (app: any, url: string, body: object) => request(app).post(url).set('x-slay', '1').send(body);

describe('creating your own account', () => {
  it('default: sign up, wait for an owner to approve, then sign in', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/auth/signup')).body.mode).toBe('approval');

    const r = await post(app, '/api/auth/signup', me);
    expect(r.status).toBe(202);
    expect(r.body.pending).toBe(true);
    // Not in yet – even with the right password.
    const early = await post(app, '/api/auth/login', { email: 'puskar@gmail.com', password: 'my-own-pass-1' });
    expect(early.status).toBe(403);
    expect(early.body.code).toBe('pending_approval');

    // Owners are told, and see the request under Team.
    const teza = w(await login(app, 'teza', 'password-teza'));
    const alert = (await teza.get('/api/security/alerts')).body.alerts.find((a: any) => a.kind === 'signup_request');
    expect(alert.message).toContain('Puskar (puskar@gmail.com) signed up and is waiting for approval');
    const pending = (await teza.get('/api/auth/team')).body.team.find((u: any) => u.pending);
    expect(pending).toMatchObject({ email: 'puskar@gmail.com', role: 'member', pending: true });
    // Pending people don't count as team yet.
    expect((await teza.get('/api/auth/me')).body.team.map((u: any) => u.email)).not.toContain('puskar@gmail.com');

    expect((await teza.post(`/api/auth/team/${pending.id}/approve`)).status).toBe(200);
    const puskar = w(await login(app, 'puskar@gmail.com', 'my-own-pass-1'));
    expect((await puskar.get('/api/auth/me')).body.user).toMatchObject({ email: 'puskar@gmail.com', role: 'member', phone: '9812345678' });
    expect((await puskar.get('/api/orders')).status).toBe(200);
  });

  it('an owner can decline a request', async () => {
    const { app } = setup();
    await post(app, '/api/auth/signup', me);
    const teza = w(await login(app, 'teza', 'password-teza'));
    const id = (await teza.get('/api/auth/team')).body.team.find((u: any) => u.pending).id;
    expect((await teza.post(`/api/auth/team/${id}/decline`)).status).toBe(200);
    expect((await teza.get('/api/auth/team')).body.team.some((u: any) => u.email === 'puskar@gmail.com')).toBe(false);
    expect((await post(app, '/api/auth/login', { email: 'puskar@gmail.com', password: 'my-own-pass-1' })).status).toBe(401);
    // Members can't approve.
    await post(app, '/api/auth/signup', me);
    const id2 = (await teza.get('/api/auth/team')).body.team.find((u: any) => u.pending).id;
    await teza.post('/api/auth/team', { email: 'sita@example.com', displayName: 'Sita', password: 'sita-pass-1' });
    const sita = w(await login(app, 'sita@example.com', 'sita-pass-1'));
    expect((await sita.post(`/api/auth/team/${id2}/approve`)).status).toBe(403);
  });

  it('open: anyone with the link joins straight away as a team member', async () => {
    const { app } = setup();
    const teza = w(await login(app, 'teza', 'password-teza'));
    expect((await teza.put('/api/auth/team/signup-mode', { mode: 'open' })).body.mode).toBe('open');
    const agent = request.agent(app);
    const r = await agent.post('/api/auth/signup').set('x-slay', '1').send(me);
    expect(r.status).toBe(201);
    expect((await agent.get('/api/auth/me')).body.user).toMatchObject({ email: 'puskar@gmail.com', role: 'member' });
    // Opening sign-ups and each new joiner are security notifications.
    const kinds = (await teza.get('/api/security/alerts')).body.alerts.filter((a: any) => a.severity !== 'info').map((a: any) => a.kind);
    expect(kinds).toEqual(expect.arrayContaining(['signup_mode_changed', 'signup_joined']));
  });

  it('closed: sign-ups are refused', async () => {
    const { app } = setup();
    const teza = w(await login(app, 'teza', 'password-teza'));
    await teza.put('/api/auth/team/signup-mode', { mode: 'closed' });
    const r = await post(app, '/api/auth/signup', me);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('signups_closed');
  });

  it('checks the details and blocks reusing an email', async () => {
    const { app } = setup();
    expect((await post(app, '/api/auth/signup', { ...me, email: 'nope' })).status).toBe(400);
    expect((await post(app, '/api/auth/signup', { ...me, phone: '123' })).status).toBe(400);
    expect((await post(app, '/api/auth/signup', { ...me, password: 'short' })).status).toBe(400);
    expect((await post(app, '/api/auth/signup', { ...me, email: 'TEZA@example.com' })).status).toBe(409);
  });

  it('limits sign-ups per connection', async () => {
    const { app } = setup();
    for (let i = 0; i < 5; i++) expect((await post(app, '/api/auth/signup', { ...me, email: `p${i}@gmail.com` })).status).toBe(202);
    expect((await post(app, '/api/auth/signup', { ...me, email: 'p9@gmail.com' })).status).toBe(429);
  });

  it('the very first account still needs the setup code', async () => {
    const { createApp } = await import('../src/app.js');
    const { loadConfig } = await import('../src/config.js');
    const { app } = createApp(loadConfig({ dbFile: ':memory:', appUrl: 'http://slay.test', webDist: '/x', initialUsers: '' }));
    expect((await request(app).get('/api/auth/signup')).body.mode).toBe('closed');
    expect((await post(app, '/api/auth/signup', me)).status).toBe(409);
  });
});
