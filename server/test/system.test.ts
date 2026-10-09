import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { SmsService } from '../src/modules/messaging/sms.js';
import { login, setup, w } from './helpers.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('SMS providers (request format, against a fake server)', () => {
  const cfg = loadConfig({ dbFile: ':memory:' }).sms;
  it('Sparrow: posts token/from/to/text and reports its error message', async () => {
    const calls: { url: string; body: string }[] = [];
    const sms = new SmsService({ ...cfg, provider: 'sparrow', sparrowToken: 'tok', sparrowFrom: 'SLAY' }, (async (url: string, init: any) => {
      calls.push({ url, body: String(init.body) });
      return calls.length === 1 ? json(200, { count: 1, response_code: 200, response: '1 mesages has been queued' }) : json(403, { response_code: 1002, response: 'Invalid Token' });
    }) as any);
    await sms.send('9841000001', 'hello');
    expect(calls[0].url).toBe('https://api.sparrowsms.com/v2/sms/');
    expect(Object.fromEntries(new URLSearchParams(calls[0].body))).toEqual({ token: 'tok', from: 'SLAY', to: '9841000001', text: 'hello' });
    await expect(sms.send('9841000001', 'x')).rejects.toThrow('Sparrow SMS refused the message: Invalid Token (code 1002)');
  });
  it('Twilio: E.164 number, basic auth, and its error message', async () => {
    let req: any;
    const sms = new SmsService({ ...cfg, provider: 'twilio', twilioSid: 'AC1', twilioToken: 'secret', twilioFrom: '+15550001' }, (async (url: string, init: any) => {
      req = { url, init };
      return json(400, { code: 21211, message: "The 'To' number is not a valid phone number." });
    }) as any);
    await expect(sms.send('9841000001', 'hi')).rejects.toThrow("Twilio refused the message: The 'To' number is not a valid phone number. (code 21211)");
    expect(req.url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');
    expect(new URLSearchParams(String(req.init.body)).get('To')).toBe('+9779841000001');
    expect(req.init.headers.Authorization).toBe(`Basic ${Buffer.from('AC1:secret').toString('base64')}`);
  });
});

describe('setup check (owners only)', () => {
  it('shows what is configured and sends a test SMS to the owner’s own phone', async () => {
    const s = setup();
    const teza = w(await login(s.app, 'teza', 'password-teza'));
    // Team members can't use it.
    const member = await teza.post('/api/auth/team', { email: 'sita@example.com', displayName: 'Sita', password: 'sita-pass-1', role: 'member' });
    expect(member.status).toBe(201);
    const sita = w(await login(s.app, 'sita', 'sita-pass-1'));
    expect((await sita.get('/api/system/status')).status).toBe(403);
    expect((await sita.post('/api/system/test-sms')).status).toBe(403);

    const status = (await teza.get('/api/system/status')).body;
    expect(status).toMatchObject({ https: false, sms: { provider: 'log', configured: false }, email: { configured: false }, myPhone: '9841000001' });
    expect((await teza.post('/api/system/test-sms')).status).toBe(400); // no provider yet

    const texts: { to: string; text: string }[] = [];
    s.ctx.services.sms = { configured: true, send: async (to: string, text: string) => void texts.push({ to, text }) };
    const ok = await teza.post('/api/system/test-sms');
    expect(ok.body).toEqual({ ok: true, to: '9841000001' });
    expect(texts[0].text).toContain('Slay test message');
    expect((await teza.post('/api/system/test-sms', { to: '+977 9812345678' })).body.to).toBe('9812345678');
    expect((await teza.post('/api/system/test-sms', { to: '123' })).status).toBe(400);

    // A provider error is shown as is.
    s.ctx.services.sms = { configured: true, send: async () => { throw new Error('Sparrow SMS refused the message: Invalid Token (code 1002)'); } };
    const failed = await teza.post('/api/system/test-sms');
    expect(failed.status).toBe(502);
    expect(failed.body.error).toContain('Invalid Token');

    // At most 5 tests an hour: 3 sent so far (the invalid number didn't count), so 2 more, then refused.
    s.ctx.services.sms = { configured: true, send: async () => {} };
    expect((await teza.post('/api/system/test-sms')).status).toBe(200);
    expect((await teza.post('/api/system/test-sms')).status).toBe(200);
    const refused = await teza.post('/api/system/test-sms');
    expect(refused.status).toBe(429);
    expect(refused.body.error).toContain('5 tests this hour');
  });

  it('sends a test email to the owner', async () => {
    const s = setup();
    const teza = w(await login(s.app, 'teza', 'password-teza'));
    expect((await teza.post('/api/system/test-email')).status).toBe(400);
    const mails: string[][] = [];
    s.ctx.services.mail = { configured: true, send: async (to: string[]) => void mails.push(to) };
    expect((await teza.post('/api/system/test-email')).body).toEqual({ ok: true, to: 'teza@example.com' });
    expect(mails).toEqual([['teza@example.com']]);
  });
});
