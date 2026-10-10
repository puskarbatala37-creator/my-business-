import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { login, setup, w } from './helpers.js';

/** Replaces the SMS provider with one that records messages, so tests can read the codes. */
function captureSms(ctx: any) {
  const sent: { to: string; text: string }[] = [];
  ctx.services.sms = { configured: true, send: async (to: string, text: string) => void sent.push({ to, text }) };
  const lastCode = () => sent.at(-1)?.text.match(/\b(\d{6})\b/)?.[1] ?? '';
  return { sent, lastCode };
}

const post = (app: any, url: string, body: object) => request(app).post(url).set('x-slay', '1').send(body);

describe('email sign-in', () => {
  it('signs in with the email address, in any letter case', async () => {
    const { app } = setup();
    expect((await post(app, '/api/auth/login', { email: 'TEZA@Example.com', password: 'password-teza' })).status).toBe(200);
    expect((await post(app, '/api/auth/login', { email: 'teza', password: 'password-teza' })).status).toBe(401);
    const me = (await (await login(app, 'teza', 'password-teza')).get('/api/auth/me')).body;
    expect(me.user).toMatchObject({ email: 'teza@example.com', phone: '9841000001', missing: [] });
  });

  it('first-run setup needs an email; the mobile number is optional', async () => {
    const { createApp } = await import('../src/app.js');
    const { loadConfig } = await import('../src/config.js');
    const { ctx, app } = createApp(loadConfig({ dbFile: ':memory:', appUrl: 'http://slay.test', webDist: '/x', initialUsers: '' }));
    const code = (ctx.services.auth as any).setupCode;
    const base = { code, displayName: 'Teza', password: 'teza-pass-1' };
    expect((await post(app, '/api/auth/setup', { ...base, email: 'nope', phone: '9841234567' })).status).toBe(400);
    // A number that is given must be a real mobile number.
    expect((await post(app, '/api/auth/setup', { ...base, email: 'teza@example.com', phone: '12345' })).body.error).toContain('valid mobile number');
    // No phone at all (or an empty field) is fine.
    const ok = await post(app, '/api/auth/setup', { ...base, email: 'Teza@Example.com', phone: '' });
    expect(ok.status).toBe(200);
    expect(ok.body.user.email).toBe('teza@example.com');
  });

  it('team members are added by email; phone is optional for the owner to fill in', async () => {
    const { app } = setup();
    const teza = w(await login(app, 'teza', 'password-teza'));
    expect((await teza.post('/api/auth/team', { email: 'sita@example.com', displayName: 'Sita', password: 'sita-pass-1', phone: '123' })).status).toBe(400);
    expect((await teza.post('/api/auth/team', { email: 'sita@example.com', displayName: 'Sita', password: 'sita-pass-1' })).status).toBe(201);
    const sita = w(await login(app, 'sita@example.com', 'sita-pass-1'));
    // Nothing to add before using the app; a phone can be added (or removed) later.
    expect((await sita.get('/api/auth/me')).body.user.missing).toEqual([]);
    expect((await sita.patch('/api/auth/profile', { phone: '+61 412 345 678' })).body.user.phone).toBe('+61412345678');
    expect((await sita.patch('/api/auth/profile', { phone: '' })).body.user.phone).toBeNull();
  });

  it('self sign-up works without a phone number', async () => {
    const { app } = setup();
    const teza = w(await login(app, 'teza', 'password-teza'));
    await teza.put('/api/auth/team/signup-mode', { mode: 'open' });
    const r = await post(app, '/api/auth/signup', { email: 'gita@example.com', displayName: 'Gita', password: 'gita-pass-1' });
    expect(r.status).toBeLessThan(300);
  });
});

describe('confirming a phone number by SMS', () => {
  it('a phone number can be confirmed by SMS (optional – never blocks using the app)', async () => {
    const { app, ctx } = setup();
    const sms = captureSms(ctx);
    const teza = w(await login(app, 'teza', 'password-teza'));
    expect((await teza.get('/api/auth/me')).body.user).toMatchObject({ missing: [], phoneVerified: false });
    const sent = (await teza.post('/api/auth/profile/phone/send-code')).body;
    expect(sent.to).toBe('98•••••001');
    expect(sms.sent[0].to).toBe('9841000001');
    expect((await teza.post('/api/auth/profile/phone/send-code')).status).toBe(429); // wait a minute
    const wrong = await teza.post('/api/auth/profile/phone/verify', { code: sms.lastCode() === '111111' ? '222222' : '111111' });
    expect(wrong.body.error).toContain('4 tries left');
    const ok = await teza.post('/api/auth/profile/phone/verify', { code: sms.lastCode() });
    expect(ok.body.user).toMatchObject({ phoneVerified: true, missing: [] });
    // Changing the number makes it unconfirmed again – and tells the team.
    expect((await teza.patch('/api/auth/profile', { phone: '9811111111' })).body.user).toMatchObject({ phoneVerified: false, missing: [] });
    const partner = w(await login(app, 'partner', 'password-partner'));
    const alert = (await partner.get('/api/security/alerts')).body.alerts.find((a: any) => a.kind === 'account_details_changed');
    expect(alert).toMatchObject({ severity: 'warning' });
    expect(alert.message).toContain('phone number');
  });
});

function captureMail(ctx: any) {
  const sent: { to: string[]; subject: string; text: string }[] = [];
  ctx.services.mail = { configured: true, send: async (to: string[], subject: string, text: string) => void sent.push({ to, subject, text }) };
  const lastCode = () => sent.filter((m) => m.subject === 'Your Slay code').at(-1)?.text.match(/\b(\d{6})\b/)?.[1] ?? '';
  return { sent, lastCode };
}

describe('forgot password: recovery code by email (the main way)', () => {
  it('emails the code when email is set up – even with a phone on the account', async () => {
    const { app, ctx } = setup();
    const sms = captureSms(ctx);
    const mail = captureMail(ctx);
    const start = await post(app, '/api/auth/recover', { email: 'teza@example.com' });
    expect(start.status).toBe(200);
    expect(start.body.message).toMatch(/emailed/);
    expect(sms.sent).toHaveLength(0);
    const codeMail = mail.sent.find((m) => m.subject === 'Your Slay code')!;
    expect(codeMail.to).toEqual(['teza@example.com']);
    const good = await post(app, '/api/auth/recover/reset', { email: 'teza@example.com', code: mail.lastCode(), password: 'brand-new-pass' });
    expect(good.status).toBe(200);
    await login(app, 'teza', 'brand-new-pass');
    const partner = w(await login(app, 'partner', 'password-partner'));
    const alert = (await partner.get('/api/security/alerts')).body.alerts.find((a: any) => a.kind === 'password_recovered');
    expect(alert.message).toContain('te••@example.com');
  });

  it('works for an account with no phone number', async () => {
    const { app, ctx } = setup();
    const mail = captureMail(ctx);
    ctx.db.prepare(`UPDATE users SET phone = NULL WHERE email = 'teza@example.com'`).run();
    await post(app, '/api/auth/recover', { email: 'teza@example.com' });
    expect((await post(app, '/api/auth/recover/reset', { email: 'teza@example.com', code: mail.lastCode(), password: 'brand-new-pass' })).status).toBe(200);
  });

  it('says plainly when the server can send no codes at all', async () => {
    const { app, ctx } = setup();
    ctx.services.mail = { configured: false, send: async () => {} };
    ctx.services.sms = { configured: false, send: async () => {} };
    const r = await post(app, '/api/auth/recover', { email: 'teza@example.com' });
    expect(r.status).toBe(503);
    expect(r.body.error).toMatch(/Ask an owner to reset your password/);
  });
});

describe('forgot password: recovery code by SMS (when no email service is set up)', () => {
  it('resets the password with the code and signs out every other device', async () => {
    const { app, ctx } = setup();
    const sms = captureSms(ctx);
    const oldDevice = w(await login(app, 'teza', 'password-teza'));

    const start = await post(app, '/api/auth/recover', { email: 'teza@example.com' });
    expect(start.status).toBe(200);
    expect(start.body.demo_code).toBeUndefined(); // codes are never shown on screen outside the demo
    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0].to).toBe('9841000001');

    const phone = request.agent(app);
    const bad = await phone.post('/api/auth/recover/reset').set('x-slay', '1').send({ email: 'teza@example.com', code: '000000', password: 'brand-new-pass' });
    expect(bad.status).toBe(400);
    const good = await phone.post('/api/auth/recover/reset').set('x-slay', '1').send({ email: 'teza@example.com', code: sms.lastCode(), password: 'brand-new-pass' });
    expect(good.status).toBe(200);
    expect((await phone.get('/api/auth/me')).status).toBe(200); // signed in
    expect((await oldDevice.get('/api/orders')).status).toBe(401); // everything else signed out
    expect((await post(app, '/api/auth/login', { email: 'teza@example.com', password: 'password-teza' })).status).toBe(401);
    await login(app, 'teza', 'brand-new-pass');
    // The same code can't be used twice.
    const again = await post(app, '/api/auth/recover/reset', { email: 'teza@example.com', code: sms.lastCode(), password: 'another-pass-1' });
    expect(again.status).toBe(400);
    const partner = w(await login(app, 'partner', 'password-partner'));
    expect((await partner.get('/api/security/alerts')).body.alerts.some((a: any) => a.kind === 'password_recovered' && a.severity === 'warning')).toBe(true);
  });

  it('does not reveal whether an email has an account', async () => {
    const { app, ctx } = setup();
    const sms = captureSms(ctx);
    const known = await post(app, '/api/auth/recover', { email: 'teza@example.com' });
    const unknown = await post(app, '/api/auth/recover', { email: 'nobody@example.com' });
    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
    expect(sms.sent).toHaveLength(1);
  });

  it('a code dies after 5 wrong tries, and works for a locked account', async () => {
    const { app, ctx } = setup();
    const sms = captureSms(ctx);
    for (let i = 0; i < 5; i++) await post(app, '/api/auth/login', { email: 'teza@example.com', password: 'wrong' });
    expect((await post(app, '/api/auth/login', { email: 'teza@example.com', password: 'password-teza' })).status).toBe(423); // locked
    await post(app, '/api/auth/recover', { email: 'teza@example.com' });
    const code = sms.lastCode();
    const wrong = code === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) await post(app, '/api/auth/recover/reset', { email: 'teza@example.com', code: wrong, password: 'brand-new-pass' });
    expect((await post(app, '/api/auth/recover/reset', { email: 'teza@example.com', code, password: 'brand-new-pass' })).body.error).toContain('Too many wrong tries');
  });

  it('a fresh code unlocks a locked account', async () => {
    const { app, ctx } = setup();
    const sms = captureSms(ctx);
    for (let i = 0; i < 5; i++) await post(app, '/api/auth/login', { email: 'teza@example.com', password: 'wrong' });
    await post(app, '/api/auth/recover', { email: 'teza@example.com' });
    expect((await post(app, '/api/auth/recover/reset', { email: 'teza@example.com', code: sms.lastCode(), password: 'brand-new-pass' })).status).toBe(200);
    await login(app, 'teza', 'brand-new-pass');
  });
});

describe('accounts created before email sign-in', () => {
  it('still sign in with the old username, then add an email once', async () => {
    const { app, ctx } = setup();
    const bcrypt = (await import('bcryptjs')).default;
    ctx.db.prepare(`INSERT INTO users (username, display_name, password_hash, role) VALUES ('ram', 'Ram', ?, 'member')`).run(bcrypt.hashSync('ram-pass-11', 4));
    const ram = w(request.agent(app));
    expect((await ram.post('/api/auth/login', { username: 'ram', password: 'ram-pass-11' })).status).toBe(200);
    expect((await ram.get('/api/auth/me')).body.user.missing).toEqual(['email']);
    expect((await ram.patch('/api/auth/profile', { email: 'teza@example.com' })).status).toBe(409); // taken
    expect((await ram.patch('/api/auth/profile', { email: 'Ram@Example.com', phone: '9812345678' })).body.user.missing).toEqual([]);
    await login(app, 'ram@example.com', 'ram-pass-11');
  });
});

describe('security notifications by email', () => {
  it('emails every active team member when a notification is raised', async () => {
    const { app, ctx } = setup();
    const mails: { to: string[]; subject: string }[] = [];
    ctx.services.mail = { configured: true, send: async (to: string[], subject: string) => void mails.push({ to, subject }) };
    for (let i = 0; i < 3; i++) await post(app, '/api/auth/login', { email: 'teza@example.com', password: 'wrong' });
    await new Promise((r) => setTimeout(r, 20));
    expect(mails).toHaveLength(1);
    expect(mails[0].to.sort()).toEqual(['partner@example.com', 'teza@example.com']);
    expect(mails[0].subject).toBe('Slay: security notification');
  });
});
