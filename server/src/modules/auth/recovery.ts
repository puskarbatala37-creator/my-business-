import crypto from 'node:crypto';
import type { AppContext, AuthUser } from '../../core/context.js';
import { logActivity, service } from '../../core/context.js';
import { HttpError } from '../../core/http.js';
import { getSetting, setSetting } from '../../db/index.js';
import type { MailService } from '../messaging/mail.js';
import { maskPhone, type SmsService } from '../messaging/sms.js';
import type { AlertService } from '../security/service.js';
import type { AuthService, ClientInfo, UserRow } from './service.js';

type Purpose = 'recover' | 'verify_phone';

const CODE_MINUTES = 10;
const MAX_TRIES = 5;
const RESEND_SECONDS = 60;
const MAX_SENDS_PER_HOUR = 5;

/** "te•••@gmail.com" – enough to recognise your own address, not enough to reveal it. */
export const maskEmail = (e: string) => {
  const [name, domain] = e.split('@');
  return `${name.slice(0, 2)}${'•'.repeat(Math.max(1, name.length - 2))}@${domain}`;
};

/**
 * One-time 6-digit codes: account recovery ("Forgot password?") – sent to the account's email,
 * or by SMS when no email service is set up – and confirming a phone number (SMS). Codes are stored only as a keyed hash, expire
 * after 10 minutes, allow 5 tries and are rate-limited.
 */
export class RecoveryService {
  private secret: string;

  constructor(private ctx: AppContext) {
    let s = getSetting(ctx.db, 'code_secret');
    if (!s) {
      s = crypto.randomBytes(32).toString('hex');
      setSetting(ctx.db, 'code_secret', s);
    }
    this.secret = s;
  }

  private get auth() {
    return service<AuthService>(this.ctx, 'auth');
  }
  private get sms() {
    return service<SmsService>(this.ctx, 'sms');
  }
  private get alerts() {
    return service<AlertService>(this.ctx, 'alerts');
  }
  private get mail() {
    return service<MailService>(this.ctx, 'mail');
  }

  /**
   * Where a recovery code for this person goes: their email when an email service is set up
   * (the main way), otherwise their phone by SMS. Null when neither can reach them.
   */
  private recoveryChannel(u: UserRow): { via: 'email'; to: string } | { via: 'sms'; to: string } | null {
    if (u.email && (this.mail.configured || this.ctx.config.showCodesOnScreen)) return { via: 'email', to: u.email };
    if (u.phone && this.auth.smsReady) return { via: 'sms', to: u.phone };
    return null;
  }

  /** Whether "Forgot password?" can send codes at all on this server. */
  get recoveryReady() {
    return this.mail.configured || this.auth.smsReady;
  }

  private hash(userId: number, purpose: Purpose, code: string) {
    return crypto.createHmac('sha256', this.secret).update(`${userId}:${purpose}:${code}`).digest('hex');
  }

  private async issue(u: UserRow, purpose: Purpose, text: (code: string) => string, channel: { via: 'email' | 'sms'; to: string } = { via: 'sms', to: u.phone! }) {
    const { db } = this.ctx;
    const now = Date.now();
    const recent = db
      .prepare('SELECT created_at FROM one_time_codes WHERE user_id = ? AND purpose = ? AND created_at >= ? ORDER BY id DESC')
      .all(u.id, purpose, new Date(now - 3600_000).toISOString()) as { created_at: string }[];
    if (recent.length && now - Date.parse(recent[0].created_at) < RESEND_SECONDS * 1000) {
      throw new HttpError(429, 'A code was just sent. Please wait a minute before asking for another.');
    }
    if (recent.length >= MAX_SENDS_PER_HOUR) throw new HttpError(429, 'Too many codes requested. Please try again in an hour.');

    const code = crypto.randomInt(100000, 1000000).toString();
    db.transaction(() => {
      db.prepare('UPDATE one_time_codes SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL').run(new Date().toISOString(), u.id, purpose);
      db.prepare('INSERT INTO one_time_codes (user_id, purpose, code_hash, phone, expires_at) VALUES (?, ?, ?, ?, ?)').run(
        u.id,
        purpose,
        this.hash(u.id, purpose, code),
        channel.to, // where the code went (a phone number or an email address)
        new Date(now + CODE_MINUTES * 60_000).toISOString(),
      );
    })();
    if (channel.via === 'email') {
      if (this.mail.configured) await this.mail.send([channel.to], 'Your Slay code', text(code));
    } else await this.sms.send(channel.to, text(code));
    return {
      to: channel.via === 'email' ? maskEmail(channel.to) : maskPhone(channel.to),
      via: channel.via,
      ...(this.ctx.config.showCodesOnScreen ? { demo_code: code } : {}),
    };
  }

  /** Checks a code; each wrong guess counts, and a code dies after 5 tries. */
  private check(u: UserRow, purpose: Purpose, code: string) {
    const { db } = this.ctx;
    const row = db
      .prepare('SELECT * FROM one_time_codes WHERE user_id = ? AND purpose = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1')
      .get(u.id, purpose) as { id: number; code_hash: string; attempts: number; expires_at: string } | undefined;
    const fail = (msg: string) => new HttpError(400, msg, 'bad_code');
    if (!row || row.expires_at < new Date().toISOString()) throw fail('This code has expired. Ask for a new one.');
    if (row.attempts >= MAX_TRIES) throw fail('Too many wrong tries. Ask for a new code.');
    const a = Buffer.from(this.hash(u.id, purpose, code.replace(/\s/g, '')));
    const b = Buffer.from(row.code_hash);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      db.prepare('UPDATE one_time_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
      const left = MAX_TRIES - row.attempts - 1;
      throw fail(left > 0 ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong tries. Ask for a new code.');
    }
    db.prepare('UPDATE one_time_codes SET used_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
  }

  // ── Confirming your own phone number (signed in) ──

  async sendPhoneCode(user: AuthUser) {
    const u = this.auth.getUser(user.id);
    if (!u.phone) throw new HttpError(400, 'Add your mobile number first');
    return this.issue(u, 'verify_phone', (c) => `Slay: your code to confirm this phone number is ${c}. It expires in ${CODE_MINUTES} minutes.`);
  }

  verifyPhone(user: AuthUser, code: string) {
    const u = this.auth.getUser(user.id);
    this.check(u, 'verify_phone', code);
    this.ctx.db.prepare('UPDATE users SET phone_verified_at = ? WHERE id = ?').run(new Date().toISOString(), u.id);
    logActivity(this.ctx, u.id, 'phone_verified', 'user', u.id);
    return this.auth.profile(u.id);
  }

  // ── "Forgot password?" (signed out) ──

  /**
   * Sends a recovery code to the account's email (or phone, if no email service is set up). The
   * reply never says whether the email exists, so the form can't be used to find out who has an account.
   */
  async start(email: string, client: ClientInfo) {
    this.auth.checkIpLimit(client.ip);
    if (!this.recoveryReady) {
      throw new HttpError(503, 'Password reset codes aren’t set up on this server yet. Ask an owner to reset your password under More → Team.', 'recovery_off');
    }
    const u = this.auth.findByLogin(email);
    const generic = {
      ok: true,
      message: this.mail.configured
        ? 'If this email belongs to an account, we have emailed it a 6-digit code. Check your inbox (and spam folder).'
        : 'If this email belongs to an account with a mobile number, we have sent a 6-digit code to that phone.',
    };
    const channel = u && u.active && !u.pending ? this.recoveryChannel(u) : null;
    if (!u || !channel) {
      this.auth.recordAttempt(email, u?.id ?? null, client, false);
      return generic;
    }
    const sent = await this.issue(
      u,
      'recover',
      (c) => `Slay: your account recovery code is ${c}. It expires in ${CODE_MINUTES} minutes. If you did not ask for it, tell your team.`,
      channel,
    );
    return { ...generic, ...('demo_code' in sent ? { demo_code: sent.demo_code, to: sent.to } : {}) };
  }

  async finish(input: { email: string; code: string; password: string }, client: ClientInfo) {
    this.auth.checkIpLimit(client.ip);
    const u = this.auth.findByLogin(input.email);
    if (!u || !u.active || u.pending) {
      this.auth.recordAttempt(input.email, u?.id ?? null, client, false);
      throw new HttpError(400, 'That code is not right. Ask for a new one.', 'bad_code');
    }
    const sentTo = (this.ctx.db.prepare(`SELECT phone FROM one_time_codes WHERE user_id = ? AND purpose = 'recover' ORDER BY id DESC LIMIT 1`).get(u.id) as { phone: string } | undefined)?.phone ?? '';
    const byEmail = sentTo.includes('@');
    try {
      this.check(u, 'recover', input.code);
    } catch (e) {
      this.auth.recordAttempt(input.email, u.id, client, false);
      throw e;
    }
    this.auth.setPassword(u.id, input.password); // also clears a lockout
    const { db } = this.ctx;
    // Whoever might have had access is signed out.
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    // A code by SMS also proved this person holds the phone.
    if (!byEmail) db.prepare('UPDATE users SET phone_verified_at = COALESCE(phone_verified_at, ?) WHERE id = ?').run(new Date().toISOString(), u.id);
    this.auth.recordAttempt(input.email, u.id, client, true);
    logActivity(this.ctx, u.id, 'password_recovered', 'user', u.id, { ip: client.ip });
    this.alerts.raise(
      'password_recovered',
      'warning',
      `${u.display_name} reset their password with a code sent to ${byEmail ? maskEmail(sentTo) : maskPhone(sentTo)}. All their other devices were signed out. If this wasn't them, switch the account off under Team.`,
      { ip: client.ip },
      u.id,
    );
    return this.auth.startSession(this.auth.getUser(u.id), client, 'password');
  }
}
