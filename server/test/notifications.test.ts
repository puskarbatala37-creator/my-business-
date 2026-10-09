import request from 'supertest';
import webpush from 'web-push';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { login, setup, w } from './helpers.js';

const sub = (n: number) => ({ endpoint: `https://push.example/phone-${n}`, keys: { p256dh: `key${n}`, auth: `auth${n}` } });
const settle = () => new Promise((r) => setTimeout(r, 20));

function capturePushes() {
  const sent: { endpoint: string; payload: any; options: any }[] = [];
  vi.spyOn(webpush, 'sendNotification').mockImplementation(async (s: any, payload: any, options: any) => {
    sent.push({ endpoint: s.endpoint, payload: JSON.parse(payload), options });
    return { statusCode: 201, body: '', headers: {} };
  });
  return sent;
}
/** A brand-new device signing in raises a security notification. */
const newDeviceSignIn = (app: any) => request(app).post('/api/auth/login').set('x-slay', '1').send({ email: 'teza@example.com', password: 'password-teza' });

afterEach(() => vi.restoreAllMocks());

describe('security push notifications', () => {
  it('reach every signed-in phone, urgently, even when the app is closed', async () => {
    const { app } = setup();
    const teza = w(await login(app, 'teza', 'password-teza'));
    const partner = w(await login(app, 'partner', 'password-partner'));
    expect((await teza.post('/api/security/push/subscribe', sub(1))).status).toBe(200);
    expect((await partner.post('/api/security/push/subscribe', sub(2))).status).toBe(200);
    const sent = capturePushes();
    await newDeviceSignIn(app);
    await settle();
    expect(sent.map((s) => s.endpoint).sort()).toEqual([sub(1).endpoint, sub(2).endpoint]);
    expect(sent[0].payload.title).toContain('security');
    expect(sent[0].payload.body).toContain('signed in from a device not used before');
    expect(sent[0].payload.url).toBe('/more/security');
    expect(sent[0].options).toMatchObject({ urgency: 'high', TTL: 86400 });
  });

  it('can be switched off per person (and switching off is logged for the team)', async () => {
    const { app } = setup();
    const teza = w(await login(app, 'teza', 'password-teza'));
    const partner = w(await login(app, 'partner', 'password-partner'));
    await teza.post('/api/security/push/subscribe', sub(1));
    await partner.post('/api/security/push/subscribe', sub(2));
    expect((await partner.get('/api/security/notifications')).body).toMatchObject({ push: true, email: true, phones: 1 });

    const off = await partner.put('/api/security/notifications', { push: false });
    expect(off.body).toMatchObject({ push: false, email: true });
    const sent = capturePushes();
    await newDeviceSignIn(app);
    await settle();
    expect(sent.map((s) => s.endpoint)).toEqual([sub(1).endpoint]);

    const log = (await teza.get('/api/security/alerts')).body.alerts;
    const change = log.find((a: any) => a.kind === 'notifications_changed');
    expect(change.message).toBe('Partner turned phone security notifications off.');
    expect(change.severity).toBe('info'); // logged, not itself a notification

    await partner.put('/api/security/notifications', { push: true });
    sent.length = 0;
    await newDeviceSignIn(app);
    await settle();
    expect(sent).toHaveLength(2);
  });

  it('stop on a phone once it signs out, and never go to switched-off accounts', async () => {
    const { app } = setup();
    const teza = w(await login(app, 'teza', 'password-teza'));
    const partner = w(await login(app, 'partner', 'password-partner'));
    await teza.post('/api/security/push/subscribe', sub(1));
    await partner.post('/api/security/push/subscribe', sub(2));
    await teza.post('/api/auth/logout');
    expect((await partner.get('/api/security/notifications')).body.phones).toBe(1);

    const sent = capturePushes();
    await newDeviceSignIn(app);
    await settle();
    expect(sent.map((s) => s.endpoint)).toEqual([sub(2).endpoint]);

    const owner = w(await login(app, 'teza', 'password-teza'));
    const partnerId = (await owner.get('/api/auth/team')).body.team.find((u: any) => u.email === 'partner@example.com').id;
    await owner.patch(`/api/auth/team/${partnerId}`, { active: false });
    sent.length = 0;
    await newDeviceSignIn(app);
    await settle();
    expect(sent).toHaveLength(0);
  });

  it('sends a test notification only to your own phones, and removes phones that uninstalled', async () => {
    const { app, ctx } = setup();
    const teza = w(await login(app, 'teza', 'password-teza'));
    const partner = w(await login(app, 'partner', 'password-partner'));
    await teza.post('/api/security/push/subscribe', sub(1));
    await partner.post('/api/security/push/subscribe', sub(2));
    const sent = capturePushes();
    expect((await teza.post('/api/security/push/test')).body.sent).toBe(1);
    expect(sent.map((s) => s.endpoint)).toEqual([sub(1).endpoint]);

    // Someone else can't remove your phone.
    await partner.post('/api/security/push/unsubscribe', { endpoint: sub(1).endpoint });
    expect((await teza.get('/api/security/notifications')).body.phones).toBe(1);

    vi.spyOn(webpush, 'sendNotification').mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }));
    expect((await teza.post('/api/security/push/test')).body.sent).toBe(0);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint = ?').get(sub(1).endpoint)).toEqual({ n: 0 });
  });

  it('respects the email choice too', async () => {
    const s = setup();
    const mails: string[][] = [];
    s.ctx.services.mail = { configured: true, send: async (to: string[]) => void mails.push(to) };
    const partner = w(await login(s.app, 'partner', 'password-partner'));
    expect((await partner.get('/api/security/notifications')).body.emailAvailable).toBe(true);
    await partner.put('/api/security/notifications', { email: false });
    await newDeviceSignIn(s.app);
    await settle();
    expect(mails.at(-1)).toEqual(['teza@example.com']);
  });
});
