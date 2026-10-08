import { Router } from 'express';
import { z } from 'zod';
import type { AppModule } from '../../core/context.js';
import { service } from '../../core/context.js';
import { idParam, notFound, parse } from '../../core/http.js';
import { DEVICE_COOKIE } from '../auth/service.js';
import { AlertService } from './service.js';

export const securityModule: AppModule = {
  name: 'security',
  init(ctx) {
    ctx.services.alerts = new AlertService(ctx);
  },
  routes(ctx) {
    const r = Router();
    const alerts = () => service<AlertService>(ctx, 'alerts');

    r.get('/alerts', (req, res) => {
      res.json({ alerts: alerts().list(req.user!.id), unread: alerts().unreadCount(req.user!.id) });
    });
    r.post('/alerts/read', (req, res) => {
      alerts().markAllRead(req.user!.id);
      res.json({ ok: true });
    });

    r.get('/push/key', (_req, res) => res.json({ publicKey: alerts().vapidPublicKey }));
    r.post('/push/subscribe', (req, res) => {
      const body = parse(
        z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) }),
        req.body,
      );
      alerts().saveSubscription(req.user!.id, body);
      res.json({ ok: true });
    });
    r.post('/push/unsubscribe', (req, res) => {
      const body = parse(z.object({ endpoint: z.string() }), req.body);
      alerts().removeSubscription(body.endpoint);
      res.json({ ok: true });
    });

    // Signed-in devices for the whole team – anyone can sign out a device they don't recognise.
    r.get('/sessions', (req, res) => {
      const rows = ctx.db
        .prepare(
          `SELECT s.id, s.ip, s.user_agent, s.created_at, s.last_seen_at, u.display_name AS user_name
             FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.expires_at > ? ORDER BY s.last_seen_at DESC`,
        )
        .all(new Date().toISOString())
        .map((s: any) => ({ ...s, current: s.id === req.user!.sessionId }));
      res.json({ sessions: rows });
    });
    r.delete('/sessions/:id', (req, res) => {
      const id = idParam(req);
      const s = ctx.db.prepare('SELECT s.id, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?').get(id) as
        | { id: number; display_name: string }
        | undefined;
      if (!s) throw notFound('Session not found');
      ctx.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
      alerts().raise('session_revoked', 'info', `${req.user!.displayName} signed out one of ${s.display_name}'s devices.`, {}, req.user!.id);
      res.json({ ok: true });
    });

    // Trusted devices: devices that have signed in successfully before. Their sign-ins are silent.
    r.get('/devices', (_req, res) => {
      const rows = ctx.db
        .prepare(
          `SELECT d.user_id, d.device_id, d.label, d.first_seen, u.display_name AS user_name,
                  (SELECT MAX(s.last_seen_at) FROM sessions s WHERE s.user_id = d.user_id AND s.device_id = d.device_id) AS last_seen_at
             FROM known_devices d JOIN users u ON u.id = d.user_id
            ORDER BY u.display_name, d.first_seen DESC`,
        )
        .all()
        .map((d: any) => ({ ...d, current: d.user_id === _req.user!.id && d.device_id === _req.cookies?.[DEVICE_COOKIE] }));
      res.json({ devices: rows });
    });
    // Forget a device: it is signed out, and its next sign-in notifies everyone again.
    r.post('/devices/forget', (req, res) => {
      const b = parse(z.object({ user_id: z.number().int(), device_id: z.string().min(1).max(100) }), req.body);
      const d = ctx.db
        .prepare('SELECT d.label, u.display_name FROM known_devices d JOIN users u ON u.id = d.user_id WHERE d.user_id = ? AND d.device_id = ?')
        .get(b.user_id, b.device_id) as { label: string; display_name: string } | undefined;
      if (!d) throw notFound('Device not found');
      ctx.db.transaction(() => {
        ctx.db.prepare('DELETE FROM known_devices WHERE user_id = ? AND device_id = ?').run(b.user_id, b.device_id);
        ctx.db.prepare('DELETE FROM sessions WHERE user_id = ? AND device_id = ?').run(b.user_id, b.device_id);
      })();
      alerts().raise('device_forgotten', 'info', `${req.user!.displayName} removed ${d.display_name}'s ${d.label} from trusted devices.`, {}, req.user!.id);
      res.json({ ok: true });
    });

    r.get('/activity', (_req, res) => {
      const rows = ctx.db
        .prepare(
          `SELECT a.id, a.action, a.entity, a.entity_id, a.meta, a.created_at, u.display_name AS user_name
             FROM activity_log a LEFT JOIN users u ON u.id = a.user_id
            ORDER BY a.id DESC LIMIT 100`,
        )
        .all();
      res.json({ activity: rows });
    });
    return r;
  },
};
