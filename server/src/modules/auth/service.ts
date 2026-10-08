import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { AppContext, AuthUser } from '../../core/context.js';
import { logActivity, service } from '../../core/context.js';
import { HttpError } from '../../core/http.js';
import type { AlertService } from '../security/service.js';

export const SESSION_COOKIE = 'slay_session';
export const DEVICE_COOKIE = 'slay_device';

const FAILS_BEFORE_ALERT = 3;
const FAILS_BEFORE_LOCK = 5;
const LOCK_MINUTES = 15;
const IP_WINDOW_MINUTES = 15;
const IP_MAX_ATTEMPTS = 20;

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  failed_attempts: number;
  locked_until: string | null;
}

export function describeDevice(ua: string): string {
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'unknown device';
  const browser = /CriOS|Chrome/.test(ua) ? 'Chrome' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'browser';
  return `${browser} on ${os}`;
}

export class AuthService {
  constructor(private ctx: AppContext) {}

  private get alerts() {
    return service<AlertService>(this.ctx, 'alerts');
  }

  createUser(username: string, displayName: string, password: string) {
    if (password.length < 8) throw new Error('Password must be at least 8 characters');
    const hash = bcrypt.hashSync(password, 12);
    return this.ctx.db
      .prepare('INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?) RETURNING id')
      .get(username.trim(), displayName.trim(), hash) as { id: number };
  }

  setPassword(userId: number, password: string) {
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
    const hash = bcrypt.hashSync(password, 12);
    this.ctx.db.prepare('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?').run(hash, userId);
  }

  /** Seeds users from INITIAL_USERS="teza:Teza:password,partner:Partner:password" when the DB has none. */
  seedInitialUsers() {
    const spec = this.ctx.config.initialUsers.trim();
    const count = (this.ctx.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
    if (!spec || count > 0) return;
    for (const entry of spec.split(',')) {
      const [username, displayName, ...pw] = entry.split(':');
      if (username && displayName && pw.length) this.createUser(username, displayName, pw.join(':'));
    }
  }

  async login(input: { username: string; password: string; ip: string; userAgent: string; deviceId: string }) {
    const { db } = this.ctx;
    const now = new Date();
    const since = new Date(now.getTime() - IP_WINDOW_MINUTES * 60_000).toISOString();

    const ipAttempts = (db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND success = 0 AND created_at >= ?').get(input.ip, since) as { n: number }).n;
    if (ipAttempts >= IP_MAX_ATTEMPTS) {
      this.alerts.raiseOnce(`ip:${input.ip}`, 60, 'login_rate_limited', 'critical', `Login blocked: too many failed sign-in attempts from IP ${input.ip}.`, { ip: input.ip });
      throw new HttpError(429, 'Too many attempts. Please wait 15 minutes and try again.');
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(input.username.trim()) as UserRow | undefined;
    const record = (success: boolean) =>
      db.prepare('INSERT INTO login_attempts (username, user_id, ip, user_agent, success) VALUES (?, ?, ?, ?, ?)').run(input.username.slice(0, 100), user?.id ?? null, input.ip, input.userAgent.slice(0, 300), success ? 1 : 0);

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
        this.alerts.raise('unknown_user_logins', 'warning', `Repeated sign-in attempts with unknown usernames from IP ${input.ip} (last tried "${input.username.slice(0, 40)}").`, { ip: input.ip });
      }
      throw new HttpError(401, 'Wrong username or password');
    }

    record(true);
    db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);

    const known = db.prepare('SELECT 1 FROM known_devices WHERE user_id = ? AND device_id = ?').get(user.id, input.deviceId);
    if (!known) {
      const hasAny = db.prepare('SELECT 1 FROM known_devices WHERE user_id = ?').get(user.id);
      db.prepare('INSERT OR IGNORE INTO known_devices (user_id, device_id, label) VALUES (?, ?, ?)').run(user.id, input.deviceId, describeDevice(input.userAgent));
      if (hasAny) {
        this.alerts.raise('new_device', 'warning', `${user.display_name} signed in from a new device: ${describeDevice(input.userAgent)} (IP ${input.ip}). If this wasn't them, sign that device out under Security.`, { ip: input.ip }, user.id);
      }
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const expires = new Date(now.getTime() + this.ctx.config.sessionDays * 86_400_000);
    db.prepare('INSERT INTO sessions (token_hash, user_id, device_id, ip, user_agent, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(hashToken(token), user.id, input.deviceId, input.ip, input.userAgent.slice(0, 300), expires.toISOString());
    logActivity(this.ctx, user.id, 'login', 'user', user.id, { ip: input.ip });
    return { token, expires, user: { id: user.id, username: user.username, displayName: user.display_name } };
  }

  /** Resolves a session cookie to a user, or null. */
  authenticate(token: string | undefined): AuthUser | null {
    if (!token) return null;
    const row = this.ctx.db
      .prepare(
        `SELECT s.id AS session_id, s.last_seen_at, u.id, u.username, u.display_name
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ? AND s.expires_at > ?`,
      )
      .get(hashToken(token), new Date().toISOString()) as any;
    if (!row) return null;
    if (Date.now() - Date.parse(row.last_seen_at) > 5 * 60_000) {
      this.ctx.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), row.session_id);
    }
    return { id: row.id, username: row.username, displayName: row.display_name, sessionId: row.session_id };
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
    this.alerts.raise('password_changed', 'warning', `${user.displayName} changed their password. Their other devices were signed out.`, {}, user.id);
    logActivity(this.ctx, user.id, 'password_changed', 'user', user.id);
  }
}
