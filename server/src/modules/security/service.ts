import webpush from 'web-push';
import { LIVE_EVENTS } from '@slay/shared';
import type { AppContext } from '../../core/context.js';
import { getSetting, setSetting } from '../../db/index.js';
import type { MailService } from '../messaging/mail.js';

/**
 * - `warning` / `critical`: a security notification – a device signing in for the first
 *   time, or something suspicious (failed attempts, lockouts, unusual activity).
 *   Pushed to every team member's phone, shown as a toast and counted on the bell.
 * - `info`: routine activity, only recorded in the Security log (no notification).
 */
export type Severity = 'info' | 'warning' | 'critical';

export const isNotification = (s: Severity) => s !== 'info';

export interface AlertRow {
  id: number;
  kind: string;
  severity: Severity;
  message: string;
  meta: string | null;
  user_id: number | null;
  created_at: string;
}

/**
 * Raises security / unusual-activity alerts and delivers them to EVERY team member:
 *  - stored in the database (shown in the app's alert bell)
 *  - pushed live to every open device (SSE)
 *  - sent as Web Push notifications to subscribed phones (works when the app is closed)
 *  - emailed to every active team member (when SMTP_URL is set)
 *  - optionally POSTed to ALERT_WEBHOOK_URL (e.g. an ntfy.sh topic, Slack, Telegram bridge)
 */
export class AlertService {
  private vapid: { publicKey: string; privateKey: string };

  constructor(private ctx: AppContext) {
    const stored = getSetting(ctx.db, 'vapid_keys');
    if (stored) {
      this.vapid = JSON.parse(stored);
    } else {
      this.vapid = webpush.generateVAPIDKeys();
      setSetting(ctx.db, 'vapid_keys', JSON.stringify(this.vapid));
    }
    webpush.setVapidDetails(ctx.config.vapidSubject, this.vapid.publicKey, this.vapid.privateKey);
  }

  get vapidPublicKey() {
    return this.vapid.publicKey;
  }

  raise(kind: string, severity: Severity, message: string, meta: Record<string, unknown> = {}, userId: number | null = null) {
    const { db, bus } = this.ctx;
    const row = db
      .prepare('INSERT INTO security_alerts (kind, severity, message, meta, user_id) VALUES (?, ?, ?, ?, ?) RETURNING *')
      .get(kind, severity, message, JSON.stringify(meta), userId) as AlertRow;
    bus.publish(LIVE_EVENTS.alert, { actor: null, ids: [row.id], message, severity });
    if (isNotification(severity)) void this.deliver(row);
    return row;
  }

  /** Raise an alert unless an identical kind+key alert was raised within `withinMinutes`. */
  raiseOnce(key: string, withinMinutes: number, kind: string, severity: Severity, message: string, meta: Record<string, unknown> = {}, userId: number | null = null) {
    const since = new Date(Date.now() - withinMinutes * 60_000).toISOString();
    const dup = this.ctx.db
      .prepare(`SELECT 1 FROM security_alerts WHERE kind = ? AND json_extract(meta, '$.key') = ? AND created_at >= ?`)
      .get(kind, key, since);
    if (dup) return null;
    return this.raise(kind, severity, message, { ...meta, key }, userId);
  }

  /**
   * Phones that should get a notification: signed in right now, belonging to an active team
   * member who hasn't switched phone notifications off. (`userId` narrows it to one person.)
   */
  private subscriptions(userId?: number) {
    return this.ctx.db
      .prepare(
        `SELECT p.id, p.endpoint, p.keys FROM push_subscriptions p
           JOIN users u ON u.id = p.user_id
           JOIN sessions s ON s.id = p.session_id AND s.user_id = p.user_id
          WHERE u.active = 1 AND u.pending = 0 AND u.notify_push = 1 AND s.expires_at > ?
            AND (? IS NULL OR p.user_id = ?)`,
      )
      .all(new Date().toISOString(), userId ?? null, userId ?? null) as { id: number; endpoint: string; keys: string }[];
  }

  /** Sends a Web Push notification. It reaches the phone even when Slay is closed. */
  private async push(subs: { id: number; endpoint: string; keys: string }[], payload: Record<string, unknown>, urgent: boolean) {
    let delivered = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          // Kept for a day if the phone is off or has no signal; "high" wakes a sleeping phone.
          await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys) }, JSON.stringify(payload), {
            TTL: 24 * 60 * 60,
            urgency: urgent ? 'high' : 'normal',
          });
          delivered++;
        } catch (err: any) {
          // The phone uninstalled the app or turned notifications off in its settings.
          if (err?.statusCode === 404 || err?.statusCode === 410) this.ctx.db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
          else console.error('push failed', err?.statusCode ?? err);
        }
      }),
    );
    return delivered;
  }

  /** "Send a test notification" from the settings screen: only this person's signed-in phones. */
  async sendTest(userId: number) {
    return this.push(this.subscriptions(userId), { title: 'Slay notifications are working', body: 'You’ll get an alert like this if anything suspicious happens.', url: '/more/notifications', tag: 'slay-test' }, true);
  }

  private async deliver(alert: AlertRow) {
    await this.push(
      this.subscriptions(),
      {
        title: alert.severity === 'critical' ? 'Urgent: Slay security alert' : 'Slay security alert',
        body: alert.message,
        url: '/more/security',
        tag: `slay-alert-${alert.id}`,
        critical: alert.severity === 'critical',
        at: Date.parse(alert.created_at) || Date.now(),
      },
      true,
    );
    const mail = this.ctx.services.mail as MailService | undefined;
    const emails = mail?.configured
      ? (this.ctx.db.prepare(`SELECT email FROM users WHERE active = 1 AND pending = 0 AND notify_email = 1 AND email IS NOT NULL`).all() as { email: string }[])
      : [];
    const to = emails.map((u) => u.email);
    if (mail && to.length) {
      const subject = alert.severity === 'critical' ? 'Slay: urgent security alert' : 'Slay: security notification';
      const text = `${alert.message}\n\nOpen Slay → More → Security to see details or sign a device out.\n${this.ctx.config.appUrl}`;
      try {
        await mail.send(to, subject, text);
      } catch (err) {
        console.error('alert email failed', err);
      }
    }
    const hook = this.ctx.config.alertWebhookUrl;
    if (hook) {
      try {
        await fetch(hook, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain', Title: 'Slay security alert', Priority: alert.severity === 'critical' ? 'high' : 'default' },
          body: alert.message,
        });
      } catch (err) {
        console.error('alert webhook failed', err);
      }
    }
  }

  list(userId: number, limit = 50) {
    return this.ctx.db
      .prepare(
        `SELECT a.id, a.kind, a.severity, a.message, a.created_at, u.display_name AS user_name,
                (r.alert_id IS NOT NULL) AS read
           FROM security_alerts a
           LEFT JOIN users u ON u.id = a.user_id
           LEFT JOIN alert_reads r ON r.alert_id = a.id AND r.user_id = ?
          ORDER BY a.id DESC LIMIT ?`,
      )
      .all(userId, limit)
      .map((r: any) => ({ ...r, read: !!r.read }));
  }

  unreadCount(userId: number): number {
    const r = this.ctx.db
      .prepare(
        `SELECT COUNT(*) AS n FROM security_alerts a
          WHERE a.severity <> 'info' AND NOT EXISTS (SELECT 1 FROM alert_reads r WHERE r.alert_id = a.id AND r.user_id = ?)`,
      )
      .get(userId) as { n: number };
    return r.n;
  }

  markAllRead(userId: number) {
    this.ctx.db
      .prepare(
        `INSERT OR IGNORE INTO alert_reads (alert_id, user_id)
         SELECT id, ? FROM security_alerts`,
      )
      .run(userId);
  }

  /** Links this phone to the person signed in on it (and to that sign-in, so signing out stops it). */
  saveSubscription(userId: number, sessionId: number, userAgent: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
    this.ctx.db
      .prepare(
        `INSERT INTO push_subscriptions (user_id, session_id, user_agent, endpoint, keys) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, session_id = excluded.session_id,
           user_agent = excluded.user_agent, keys = excluded.keys`,
      )
      .run(userId, sessionId, userAgent.slice(0, 300), sub.endpoint, JSON.stringify(sub.keys));
  }

  removeSubscription(userId: number, endpoint: string) {
    this.ctx.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(endpoint, userId);
  }

  preferences(userId: number) {
    const u = this.ctx.db.prepare('SELECT notify_push, notify_email FROM users WHERE id = ?').get(userId) as { notify_push: number; notify_email: number };
    const mail = this.ctx.services.mail as MailService | undefined;
    return {
      push: !!u.notify_push,
      email: !!u.notify_email,
      emailAvailable: !!mail?.configured,
      phones: this.subscriptions(userId).length,
    };
  }

  setPreferences(userId: number, p: { push?: boolean; email?: boolean }) {
    if (p.push !== undefined) this.ctx.db.prepare('UPDATE users SET notify_push = ? WHERE id = ?').run(p.push ? 1 : 0, userId);
    if (p.email !== undefined) this.ctx.db.prepare('UPDATE users SET notify_email = ? WHERE id = ?').run(p.email ? 1 : 0, userId);
  }
}
