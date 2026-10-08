import type { Config } from '../../config.js';

/** Phone numbers are stored as typed by the user, normalised: Nepali mobiles as 10 digits, others in +international form. */
export function normalizeMobile(raw: string): string | null {
  const devanagari = '०१२३४५६७८९';
  const s = raw.replace(/[०-९]/g, (d) => String(devanagari.indexOf(d))).replace(/[\s\-().]/g, '');
  const np = s.replace(/^(\+?977|00977)/, '');
  if (/^9[678]\d{8}$/.test(np)) return np; // Nepali mobile (NTC / Ncell / Smart)
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s; // any other country, international format
  return null;
}

/** "98•••••567" – enough to recognise your own number, not enough to reveal it. */
export const maskPhone = (p: string) => (p.length <= 5 ? '•••' : `${p.slice(0, 2)}${'•'.repeat(p.length - 5)}${p.slice(-3)}`);

const toE164 = (p: string) => (p.startsWith('+') ? p : `+977${p}`);

export interface SmsResult {
  sent: boolean;
  /** Demo preview only: the code, shown on screen. */
  code?: string;
}

/**
 * Sends text messages. Providers:
 *  - Sparrow SMS (Nepal) – SMS_PROVIDER=sparrow, SPARROW_SMS_TOKEN, SPARROW_SMS_FROM
 *  - Twilio (international) – SMS_PROVIDER=twilio, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
 *  - log (default) – prints the message in the server log, for testing before a provider is set up
 */
export class SmsService {
  constructor(private cfg: Config['sms'], private fetchImpl: typeof fetch = fetch) {}

  get configured() {
    return this.cfg.provider !== 'log';
  }

  async send(to: string, text: string): Promise<void> {
    if (this.cfg.provider === 'sparrow') {
      const body = new URLSearchParams({ token: this.cfg.sparrowToken, from: this.cfg.sparrowFrom, to: to.replace(/^\+977/, ''), text });
      const res = await this.fetchImpl('https://api.sparrowsms.com/v2/sms/', { method: 'POST', body, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`Sparrow SMS failed (HTTP ${res.status})`);
      return;
    }
    if (this.cfg.provider === 'twilio') {
      const body = new URLSearchParams({ To: toE164(to), From: this.cfg.twilioFrom, Body: text });
      const auth = Buffer.from(`${this.cfg.twilioSid}:${this.cfg.twilioToken}`).toString('base64');
      const res = await this.fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${this.cfg.twilioSid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}` },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Twilio SMS failed (HTTP ${res.status})`);
      return;
    }
    console.log(`[sms:log] to ${to}: ${text}`);
  }
}
