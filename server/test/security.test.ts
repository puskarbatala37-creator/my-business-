import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { login, setup, w } from './helpers.js';

const attempt = (app: any, password: string, agent = request.agent(app)) =>
  agent.post('/api/auth/login').set('x-slay', '1').send({ username: 'teza', password });

describe('security alerts', () => {
  it('alerts both users on repeated failures and locks the account', async () => {
    const { app } = setup();
    for (let i = 0; i < 3; i++) expect((await attempt(app, 'wrong')).status).toBe(401);
    const partner = w(await login(app, 'partner', 'password-partner'));
    let alerts = (await partner.get('/api/security/alerts')).body;
    expect(alerts.alerts.some((a: any) => a.kind === 'failed_logins')).toBe(true);
    expect(alerts.unread).toBeGreaterThan(0);

    await attempt(app, 'wrong');
    expect((await attempt(app, 'wrong')).status).toBe(401);
    // Locked now – even the right password is refused.
    expect((await attempt(app, 'password-teza')).status).toBe(423);
    alerts = (await partner.get('/api/security/alerts')).body;
    expect(alerts.alerts.some((a: any) => a.kind === 'account_locked')).toBe(true);
  });

  it('notifies on a device\'s first sign-in only – trusted devices sign in silently', async () => {
    const { app } = setup();
    const partner = w(await login(app, 'partner', 'password-partner'));
    const newDeviceAlerts = async () => (await partner.get('/api/security/alerts')).body.alerts.filter((a: any) => a.kind === 'new_device' && a.message.startsWith('Teza'));

    // First time ever on this phone → notification.
    const phone = request.agent(app);
    expect((await attempt(app, 'password-teza', phone)).status).toBe(200);
    expect(await newDeviceAlerts()).toHaveLength(1);
    expect((await newDeviceAlerts())[0].message).toContain('for the first time');

    // Same phone again (day-to-day) → trusted, no new notification.
    for (let i = 0; i < 3; i++) expect((await attempt(app, 'password-teza', phone)).status).toBe(200);
    expect(await newDeviceAlerts()).toHaveLength(1);

    // An unrecognised device → notification.
    await attempt(app, 'password-teza');
    const list = await newDeviceAlerts();
    expect(list).toHaveLength(2);
    expect(list[0].message).toContain('not used before');
  });

  it('a forgotten device is signed out and notifies again on its next sign-in', async () => {
    const { app } = setup();
    const phone = request.agent(app);
    await attempt(app, 'password-teza', phone);
    const teza = w(phone);
    const partner = w(await login(app, 'partner', 'password-partner'));
    const devices = (await partner.get('/api/security/devices')).body.devices;
    const tezaPhone = devices.find((d: any) => d.user_name === 'Teza');
    expect((await partner.post('/api/security/devices/forget', { user_id: tezaPhone.user_id, device_id: tezaPhone.device_id })).status).toBe(200);
    expect((await teza.get('/api/orders')).status).toBe(401);
    await attempt(app, 'password-teza', phone);
    const alerts = (await partner.get('/api/security/alerts')).body.alerts.filter((a: any) => a.kind === 'new_device' && a.message.startsWith('Teza'));
    expect(alerts).toHaveLength(2);
  });

  it('wrong passwords are still notified, even from a trusted device', async () => {
    const { app } = setup();
    const phone = request.agent(app);
    await attempt(app, 'password-teza', phone);
    for (let i = 0; i < 3; i++) await attempt(app, 'oops', phone);
    const partner = w(await login(app, 'partner', 'password-partner'));
    expect((await partner.get('/api/security/alerts')).body.alerts.some((a: any) => a.kind === 'failed_logins')).toBe(true);
  });

  it('routine activity is logged but is not a notification', async () => {
    const { app } = setup();
    const teza = w(await login(app, 'teza', 'password-teza'));
    const partner = w(await login(app, 'partner', 'password-partner'));
    await partner.post('/api/security/alerts/read');
    await teza.post('/api/auth/team', { username: 'sita', displayName: 'Sita', password: 'sita-pass-1' });
    await teza.post('/api/auth/password', { current: 'password-teza', next: 'new-teza-pass' });
    const res = (await partner.get('/api/security/alerts')).body;
    expect(res.alerts.find((a: any) => a.kind === 'team_member_added').severity).toBe('info');
    expect(res.alerts.find((a: any) => a.kind === 'password_changed').severity).toBe('info');
    expect(res.unread).toBe(0); // no badge, no push
  });

  it('logout ends the session', async () => {
    const { app } = setup();
    const t = w(await login(app, 'teza', 'password-teza'));
    expect((await t.get('/api/auth/me')).status).toBe(200);
    await t.post('/api/auth/logout');
    expect((await t.get('/api/auth/me')).status).toBe(401);
  });
});

describe('what actually gets sent to phones / the webhook', () => {
  it('sends for a first-time device, not for trusted-device sign-ins or routine activity', async () => {
    const { vi } = await import('vitest');
    const s = setup();
    s.ctx.config.alertWebhookUrl = 'https://hooks.example/slay';
    const sent: string[] = [];
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: any, init: any) => {
      sent.push(String(init?.body));
      return new Response('ok');
    });
    try {
      const phone = request.agent(s.app);
      await attempt(s.app, 'password-teza', phone); // first time on this phone
      await new Promise((r) => setTimeout(r, 20));
      expect(sent).toHaveLength(1);
      expect(sent[0]).toContain('for the first time');

      await attempt(s.app, 'password-teza', phone); // trusted
      await attempt(s.app, 'password-teza', phone); // trusted
      await w(phone).post('/api/auth/team', { username: 'sita', displayName: 'Sita', password: 'sita-pass-1' }); // routine
      await new Promise((r) => setTimeout(r, 20));
      expect(sent).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });
});
