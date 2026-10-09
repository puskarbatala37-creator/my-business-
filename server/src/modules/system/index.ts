import { Router } from 'express';
import { z } from 'zod';
import type { AppModule } from '../../core/context.js';
import { service } from '../../core/context.js';
import { HttpError, parse } from '../../core/http.js';
import { requireOwner } from '../auth/index.js';
import type { AuthService } from '../auth/service.js';
import type { MailService } from '../messaging/mail.js';
import { normalizeMobile, type SmsService } from '../messaging/sms.js';
import type { AlertService } from '../security/service.js';

/** Each owner may send a few test messages an hour (texts cost money). */
const TEST_LIMIT = 5;

/**
 * Setup check (owners only): what this server has configured, plus buttons that send a real test
 * text message and email, so each outside service can be confirmed working after deployment.
 */
export const systemModule: AppModule = {
  name: 'system',
  routes(ctx) {
    const r = Router();
    r.use(requireOwner);
    const sent = new Map<string, number[]>();
    const allow = (key: string) => {
      const now = Date.now();
      const recent = (sent.get(key) ?? []).filter((t) => now - t < 60 * 60 * 1000);
      if (recent.length >= TEST_LIMIT) throw new HttpError(429, `That's ${TEST_LIMIT} tests this hour – try again later.`);
      sent.set(key, [...recent, now]);
    };

    r.get('/status', (req, res) => {
      const { config } = ctx;
      const sms = service<SmsService>(ctx, 'sms');
      const mail = service<MailService>(ctx, 'mail');
      const me = service<AuthService>(ctx, 'auth').getUser(req.user!.id);
      res.json({
        appUrl: config.appUrl,
        https: config.appUrl.startsWith('https://'),
        sms: { provider: config.sms.provider, configured: sms.configured, from: config.sms.provider === 'sparrow' ? config.sms.sparrowFrom : config.sms.provider === 'twilio' ? config.sms.twilioFrom : '' },
        email: { configured: mail.configured },
        push: { phones: service<AlertService>(ctx, 'alerts').preferences(req.user!.id).phones },
        esewa: config.esewa.mode,
        voiceServer: !!config.transcribe.apiKey,
        myPhone: me?.phone ?? null,
      });
    });

    r.post('/test-sms', async (req, res) => {
      const sms = service<SmsService>(ctx, 'sms');
      if (!sms.configured) throw new HttpError(400, 'No text-message service is set up on the server yet (SMS_PROVIDER).');
      const body = parse(z.object({ to: z.string().optional() }), req.body);
      const me = service<AuthService>(ctx, 'auth').getUser(req.user!.id);
      const to = normalizeMobile(body.to?.trim() || me?.phone || '');
      if (!to) throw new HttpError(400, 'Enter a valid mobile number (98XXXXXXXX).');
      allow(`sms:${req.user!.id}`);
      try {
        await sms.send(to, `Slay test message: text messages are set up correctly. (${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kathmandu' })})`);
      } catch (e) {
        throw new HttpError(502, (e as Error).message);
      }
      res.json({ ok: true, to });
    });

    r.post('/test-email', async (req, res) => {
      const mail = service<MailService>(ctx, 'mail');
      if (!mail.configured) throw new HttpError(400, 'Email sending is not set up on the server yet (SMTP_URL).');
      const email = service<AuthService>(ctx, 'auth').getUser(req.user!.id).email;
      if (!email) throw new HttpError(400, 'Your account has no email address.');
      allow(`email:${req.user!.id}`);
      try {
        await mail.send([email], 'Slay test email', 'Email is set up correctly – security notifications will arrive like this.');
      } catch (e) {
        throw new HttpError(502, `Sending failed: ${(e as Error).message}`);
      }
      res.json({ ok: true, to: email });
    });
    return r;
  },
};
