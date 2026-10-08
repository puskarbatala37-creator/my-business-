import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { AppContext, AuthUser } from '../../core/context.js';
import { logActivity, service } from '../../core/context.js';
import { conflict, HttpError, notFound } from '../../core/http.js';
import { maskPhone, normalizeMobile, type SmsService } from '../messaging/sms.js';
import type { AlertService } from '../security/service.js';

export const SESSION_COOKIE = 'slay_session';
export const DEVICE_COOKIE = 'slay_device';

export const ROLES = ['owner', 'member'] as const;
export type Role = (typeof ROLES)[number];

const FAILS_BEFORE_ALERT = 3;
const FAILS_BEFORE_LOCK = 5;
const LOCK_MINUTES = 15;
const IP_WINDOW_MINUTES = 15;
const IP_MAX_ATTEMPTS = 20;

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

export interface UserRow {
  id: number;
  /** Login name. For accounts created since email login, the same as `email`. */
  username: string;
  email: string | null;
  phone: string | null;
  phone_verified_at: string | null;
  display_name: string;
  password_hash: string;
  failed_attempts: number;
  locked_until: string | null;
  role: Role;
  active: number;
}

export interface ClientInfo {
  ip: string;
  userAgent: string;
  deviceId: string;
}

export function describeDevice(ua: string): string {
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'unknown device';
  const browser = /CriOS|Chrome/.test(ua) ? 'Chrome' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'browser';
  return `${browser} on ${os}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(raw: string): string {
  const e = raw.trim().toLowerCase();
  if (!EMAIL_RE.test(e) || e.length > 254) throw new HttpError(400, 'Enter a valid email address, e.g. name@gmail.com');
  return e;
}

export function requireMobile(raw: string): string {
  const p = normalizeMobile(raw);
  if (!p) throw new HttpError(400, 'Enter a valid mobile number, e.g. 98XXXXXXXX (or +country code for numbers outside Nepal)');
  return p;
}

export interface NewUser {
  email: string;
  displayName: string;
  password: string;
  role?: Role;
  phone?: string | null;
  createdBy?: number | null;
}

export class AuthService {
  /** One-time code shown in the server log while no account exists (first-run setup in the app). */
  readonly setupCode: string | null;

  constructor(private ctx: AppContext) {
    this.setupCode = this.userCount() === 0 ? crypto.randomInt(100000, 999999).toString() : null;
  }

  private get alerts() {
    return service<AlertService>(this.ctx, 'alerts');
  }

  userCount() {
    return (this.ctx.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  }

  get smsReady() {
    return service<SmsService>(this.ctx, 'sms').configured || this.ctx.config.showCodesOnScreen;
  }

  /** Accounts sign in with their email address; the phone number is for recovery codes. */
  createUser(input: NewUser) {
    const email = normalizeEmail(input.email);
    if (!input.displayName.trim()) throw new HttpError(400, 'Name is required');
    if (input.password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
    this.assertEmailFree(email);
    const phone = input.phone ? requireMobile(input.phone) : null;
    const hash = bcrypt.hashSync(input.password, 12);
    return this.ctx.db
      .prepare('INSERT INTO users (username, email, phone, display_name, password_hash, role, created_by) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id')
      .get(email, email, phone, input.displayName.trim(), hash, input.role ?? 'member', input.createdBy ?? null) as { id: number };
  }

  private assertEmailFree(email: string, exceptUserId = 0) {
    const taken = this.ctx.db.prepare('SELECT id FROM users WHERE (email = ? OR username = ?) AND id <> ?').get(email, email, exceptUserId);
    if (taken) throw conflict(`${email} is already used by another account`);
  }

  findByLogin(identifier: string) {
    const id = identifier.trim();
    return this.ctx.db.prepare('SELECT * FROM users WHERE email = lower(?) OR username = ? ORDER BY email IS NULL LIMIT 1').get(id, id) as UserRow | undefined;
  }

  /** What the signed-in person still has to add before using the app. */
  profile(userId: number) {
    const u = this.getUser(userId);
    const missing: ('email' | 'phone' | 'verify_phone')[] = [];
    if (!u.email) missing.push('email');
    if (!u.phone) missing.push('phone');
    else if (!u.phone_verified_at && this.smsReady) missing.push('verify_phone');
    return {
      id: u.id,
      email: u.email,
      displayName: u.display_name,
      role: u.role,
      phone: u.phone,
      phoneVerified: !!u.phone_verified_at,
      missing,
    };
  }

  /** The signed-in person updates their own name, email or phone. */
  updateProfile(user: AuthUser, patch: { displayName?: string; email?: string; phone?: string }) {
    const u = this.getUser(user.id);
    const changes: string[] = [];
    this.ctx.db.transaction(() => {
      if (patch.displayName?.trim() && patch.displayName.trim() !== u.display_name) {
        this.ctx.db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(patch.displayName.trim(), u.id);
      }
      if (patch.email !== undefined) {
        const email = normalizeEmail(patch.email);
        if (email !== u.email) {
          this.assertEmailFree(email, u.id);
          this.ctx.db.prepare('UPDATE users SET email = ?, username = ? WHERE id = ?').run(email, email, u.id);
          changes.push(u.email ? `changed their sign-in email to ${email}` : `added the sign-in email ${email}`);
        }
      }
      if (patch.phone !== undefined) {
        const phone = requireMobile(patch.phone);
        if (phone !== u.phone) {
          this.ctx.db.prepare('UPDATE users SET phone = ?, phone_verified_at = NULL WHERE id = ?').run(phone, u.id);
          changes.push(`${u.phone ? 'changed' : 'added'} their recovery phone number (${maskPhone(phone)})`);
        }
      }
    })();
    if (changes.length) {
      // Changing where sign-in and recovery go to is how accounts get taken over – everyone is told.
      const first = !u.email || !u.phone;
      this.alerts.raise('account_details_changed', first ? 'info' : 'warning', `${u.display_name} ${changes.join(' and ')}.`, {}, u.id);
      logActivity(this.ctx, u.id, 'profile_updated', 'user', u.id, { changes });
    }
    return this.profile(u.id);
  }

  setPassword(userId: number, password: string) {
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
    const hash = bcrypt.hashSync(password, 12);
    this.ctx.db.prepare('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?').run(hash, userId);
  }

  /** Seeds owners from INITIAL_USERS="teza@gmail.com:Teza:password,…" when the DB has none. */
  seedInitialUsers() {
    const spec = this.ctx.config.initialUsers.trim();
    if (!spec || this.userCount() > 0) return;
    for (const entry of spec.split(',')) {
      const [email, displayName, ...pw] = entry.split(':');
      if (email && displayName && pw.length) this.createUser({ email, displayName, password: pw.join(':'), role: 'owner' });
    }
  }

  /** Records a failed sign-in for an IP (used by password and biometric login) and enforces the IP limit. */
  checkIpLimit(ip: string) {
    const since = new Date(Date.now() - IP_WINDOW_MINUTES * 60_000).toISOString();
    const n = (this.ctx.db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND success = 0 AND created_at >= ?').get(ip, since) as { n: number }).n;
    if (n >= IP_MAX_ATTEMPTS) {
      this.alerts.raiseOnce(`ip:${ip}`, 60, 'login_rate_limited', 'critical', `Login blocked: too many failed sign-in attempts from IP ${ip}.`, { ip });
      throw new HttpError(429, 'Too many attempts. Please wait 15 minutes and try again.');
    }
    return n;
  }

  recordAttempt(username: string, userId: number | null, client: ClientInfo, success: boolean) {
    this.ctx.db
      .prepare('INSERT INTO login_attempts (username, user_id, ip, user_agent, success) VALUES (?, ?, ?, ?, ?)')
      .run(username.slice(0, 100), userId, client.ip, client.userAgent.slice(0, 300), success ? 1 : 0);
  }

  async login(input: { email: string; password: string } & ClientInfo) {
    const { db } = this.ctx;
    const now = new Date();
    const ipAttempts = this.checkIpLimit(input.ip);

    const user = this.findByLogin(input.email);
    const record = (success: boolean) => this.recordAttempt(input.email, user?.id ?? null, input, success);

    if (user?.locked_until && user.locked_until > now.toISOString()) {
      record(false);
      this.alerts.raiseOnce(`locked:${user.id}`, LOCK_MINUTES, 'login_while_locked', 'critical', `Someone is still trying to sign in as ${user.display_name} while the account is locked (IP ${input.ip}).`, { ip: input.ip }, user.id);
      const mins = Math.ceil((Date.parse(user.locked_until) - now.getTime()) / 60_000);
      throw new HttpError(423, `Account locked after too many wrong passwords. Try again in ${mins} min.`);
    }

    const ok = await bcrypt.compare(input.password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) {
      record(false);
      if (user) {
        const fails = user.failed_attempts + 1;
        const lock = fails >= FAILS_BEFORE_LOCK ? new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString() : null;
        db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : fails, lock, user.id);
        if (lock) {
          this.alerts.raise('account_locked', 'critical', `${user.display_name}'s account was locked for ${LOCK_MINUTES} min after ${FAILS_BEFORE_LOCK} wrong passwords (IP ${input.ip}, ${describeDevice(input.userAgent)}).`, { ip: input.ip }, user.id);
        } else if (fails === FAILS_BEFORE_ALERT) {
          this.alerts.raise('failed_logins', 'warning', `${fails} wrong password attempts for ${user.display_name} (IP ${input.ip}, ${describeDevice(input.userAgent)}).`, { ip: input.ip }, user.id);
        }
      } else if (ipAttempts + 1 === 5) {
        this.alerts.raise('unknown_user_logins', 'warning', `Repeated sign-in attempts with unknown email addresses from IP ${input.ip} (last tried "${input.email.slice(0, 60)}").`, { ip: input.ip });
      }
      throw new HttpError(401, 'Wrong email or password');
    }
    if (!user.active) {
      record(false);
      this.alerts.raiseOnce(`disabled:${user.id}`, 60, 'disabled_account_login', 'warning', `Someone signed in with the correct password for ${user.display_name}, whose account is switched off (IP ${input.ip}).`, { ip: input.ip }, user.id);
      throw new HttpError(403, 'This account has been switched off. Ask an owner to turn it back on.');
    }

    record(true);
    db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);
    return this.startSession(user, input, 'password');
  }

  /**
   * Creates a session after a successful password or biometric check.
   * A device that has signed in successfully before is trusted: its everyday
   * sign-ins are not notified. Only a device's FIRST sign-in raises a notification.
   */
  startSession(user: UserRow, client: ClientInfo, method: 'password' | 'biometric') {
    const { db } = this.ctx;
    const trusted = db.prepare('SELECT 1 FROM known_devices WHERE user_id = ? AND device_id = ?').get(user.id, client.deviceId);
    if (!trusted) {
      const firstEver = !db.prepare('SELECT 1 FROM known_devices WHERE user_id = ?').get(user.id);
      db.prepare('INSERT OR IGNORE INTO known_devices (user_id, device_id, label) VALUES (?, ?, ?)').run(user.id, client.deviceId, describeDevice(client.userAgent));
      const device = `${describeDevice(client.userAgent)} (IP ${client.ip})`;
      this.alerts.raise(
        'new_device',
        'warning',
        firstEver
          ? `${user.display_name} signed in for the first time, on ${device}. If this wasn't them, sign that device out under Security.`
          : `${user.display_name} signed in from a device not used before: ${device}. If this wasn't them, sign that device out under Security.`,
        { ip: client.ip },
        user.id,
      );
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + this.ctx.config.sessionDays * 86_400_000);
    db.prepare('INSERT INTO sessions (token_hash, user_id, device_id, ip, user_agent, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(hashToken(token), user.id, client.deviceId, client.ip, client.userAgent.slice(0, 300), expires.toISOString());
    logActivity(this.ctx, user.id, 'login', 'user', user.id, { ip: client.ip, method });
    return { token, expires, user: { id: user.id, email: user.email ?? user.username, displayName: user.display_name, role: user.role } };
  }

  getUser(id: number) {
    const u = this.ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    if (!u) throw notFound('Team member not found');
    return u;
  }

  /** Resolves a session cookie to a user, or null. */
  authenticate(token: string | undefined): AuthUser | null {
    if (!token) return null;
    const row = this.ctx.db
      .prepare(
        `SELECT s.id AS session_id, s.last_seen_at, u.id, u.username, u.display_name, u.role
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
      )
      .get(hashToken(token), new Date().toISOString()) as any;
    if (!row) return null;
    if (Date.now() - Date.parse(row.last_seen_at) > 5 * 60_000) {
      this.ctx.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), row.session_id);
    }
    return { id: row.id, username: row.username, displayName: row.display_name, role: row.role, sessionId: row.session_id };
  }

  logout(sessionId: number) {
    this.ctx.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }

  async changePassword(user: AuthUser, current: string, next: string) {
    const row = this.ctx.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as { password_hash: string };
    if (!(await bcrypt.compare(current, row.password_hash))) throw new HttpError(400, 'Current password is wrong');
    this.setPassword(user.id, next);
    // Sign out every other device of this user.
    this.ctx.db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(user.id, user.sessionId);
    this.alerts.raise('password_changed', 'info', `${user.displayName} changed their password. Their other devices were signed out.`, {}, user.id);
    logActivity(this.ctx, user.id, 'password_changed', 'user', user.id);
  }

  // ── Team management ─────────────────────────────────────────────────

  team() {
    return this.ctx.db
      .prepare(
        `SELECT u.id, COALESCE(u.email, u.username) AS email, u.email IS NULL AS needs_email, u.phone IS NOT NULL AS has_phone,
                u.display_name AS displayName, u.role, u.active, u.created_at,
                (SELECT MAX(last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at,
                (SELECT COUNT(*) FROM passkeys p WHERE p.user_id = u.id) AS passkeys
           FROM users u ORDER BY u.active DESC, u.role = 'owner' DESC, u.display_name`,
      )
      .all()
      .map((u: any) => ({ ...u, active: !!u.active, needs_email: !!u.needs_email, has_phone: !!u.has_phone }));
  }

  addMember(by: AuthUser, input: { email: string; displayName: string; password: string; role: Role; phone?: string | null }) {
    const { id } = this.createUser({ ...input, createdBy: by.id });
    const email = normalizeEmail(input.email);
    logActivity(this.ctx, by.id, 'team_member_added', 'user', id, { email, role: input.role });
    this.alerts.raise('team_member_added', 'info', `${by.displayName} added ${input.displayName} (${email}) to the team as ${input.role === 'owner' ? 'an owner' : 'a team member'}.`, {}, by.id);
    return id;
  }

  updateMember(by: AuthUser, id: number, patch: { displayName?: string; email?: string; role?: Role; active?: boolean; password?: string }) {
    const u = this.getUser(id);
    const { db } = this.ctx;
    const ownersLeft = (excluding: number) =>
      (db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1 AND id <> ?`).get(excluding) as { n: number }).n;
    if (patch.active === false && id === by.id) throw new HttpError(400, "You can't switch off your own account");
    if (((patch.role && patch.role !== 'owner') || patch.active === false) && u.role === 'owner' && ownersLeft(id) === 0) {
      throw new HttpError(400, 'The team needs at least one owner');
    }
    db.transaction(() => {
      if (patch.displayName?.trim()) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(patch.displayName.trim(), id);
      if (patch.email !== undefined) {
        const email = normalizeEmail(patch.email);
        if (email !== u.email) {
          this.assertEmailFree(email, id);
          db.prepare('UPDATE users SET email = ?, username = ? WHERE id = ?').run(email, email, id);
        }
      }
      if (patch.role) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(patch.role, id);
      if (patch.active !== undefined) {
        db.prepare('UPDATE users SET active = ? WHERE id = ?').run(patch.active ? 1 : 0, id);
        // Switching someone off signs them out everywhere and removes their biometric logins.
        if (!patch.active) {
          db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
          db.prepare('DELETE FROM passkeys WHERE user_id = ?').run(id);
        }
      }
      if (patch.password) {
        this.setPassword(id, patch.password);
        if (id !== by.id) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      }
    })();
    const changes: string[] = [];
    if (patch.role && patch.role !== u.role) changes.push(`made them ${patch.role === 'owner' ? 'an owner' : 'a team member'}`);
    if (patch.active === false && u.active) changes.push('switched off their account');
    if (patch.active === true && !u.active) changes.push('switched their account back on');
    if (patch.password) changes.push('reset their password');
    if (patch.email && normalizeEmail(patch.email) !== u.email) changes.push(`changed their sign-in email to ${normalizeEmail(patch.email)}`);
    if (changes.length) {
      this.alerts.raise('team_member_changed', patch.email ? 'warning' : 'info', `${by.displayName} ${changes.join(' and ')} (${u.display_name}).`, {}, by.id);
    }
    logActivity(this.ctx, by.id, 'team_member_updated', 'user', id, { ...patch, password: patch.password ? '***' : undefined });
  }
}
