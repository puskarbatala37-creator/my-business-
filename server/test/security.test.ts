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

  it('alerts on sign-in from a new device', async () => {
    const { app } = setup();
    const phone = request.agent(app);
    expect((await attempt(app, 'password-teza', phone)).status).toBe(200);
    // Same device again: no alert
    expect((await attempt(app, 'password-teza', phone)).status).toBe(200);
    const partner = w(await login(app, 'partner', 'password-partner'));
    expect((await partner.get('/api/security/alerts')).body.alerts.filter((a: any) => a.kind === 'new_device')).toHaveLength(0);
    // A different device
    await attempt(app, 'password-teza');
    const list = (await partner.get('/api/security/alerts')).body.alerts;
    expect(list.filter((a: any) => a.kind === 'new_device')).toHaveLength(1);
  });

  it('logout ends the session', async () => {
    const { app } = setup();
    const t = w(await login(app, 'teza', 'password-teza'));
    expect((await t.get('/api/auth/me')).status).toBe(200);
    await t.post('/api/auth/logout');
    expect((await t.get('/api/auth/me')).status).toBe(401);
  });
});
