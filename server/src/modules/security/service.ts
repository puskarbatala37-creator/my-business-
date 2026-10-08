import webpush from 'web-push';
import { LIVE_EVENTS } from '@slay/shared';
import type { AppContext } from '../../core/context.js';
import { getSetting, setSetting } from '../../db/index.js';

export type Severity = 'info' | 'warning' | 'critical';

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
    void this.deliver(row);
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

  private async deliver(alert: AlertRow) {
    const subs = this.ctx.db.prepare('SELECT id, endpoint, keys FROM push_subscriptions').all() as {
      id: number;
      endpoint: string;
      keys: string;
    }[];
    const payload = JSON.stringify({ title: 'Slay security alert', body: alert.message, url: '/more/security' });
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys) }, payload, { TTL: 3600 });
        } catch (err: any) {
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            this.ctx.db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
          }
        }
      }),
    );
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
          WHERE NOT EXISTS (SELECT 1 FROM alert_reads r WHERE r.alert_id = a.id AND r.user_id = ?)`,
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

  saveSubscription(userId: number, sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
    this.ctx.db
      .prepare(
        `INSERT INTO push_subscriptions (user_id, endpoint, keys) VALUES (?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, keys = excluded.keys`,
      )
      .run(userId, sub.endpoint, JSON.stringify(sub.keys));
  }

  removeSubscription(endpoint: string) {
    this.ctx.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  }
}
