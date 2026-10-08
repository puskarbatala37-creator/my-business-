import crypto from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { AppContext, AppModule } from '../../core/context.js';
import { service } from '../../core/context.js';
import { clientIp, HttpError, parse } from '../../core/http.js';
import { AuthService, DEVICE_COOKIE, SESSION_COOKIE } from './service.js';

/** Attaches req.user when a valid session cookie is present. */
export function sessionMiddleware(ctx: AppContext): RequestHandler {
  return (req, _res, next) => {
    const user = service<AuthService>(ctx, 'auth').authenticate(req.cookies?.[SESSION_COOKIE]);
    if (user) req.user = user;
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Please sign in', 'unauthenticated'));
  next();
};

export const authModule: AppModule = {
  name: 'auth',
  public: true,
  init(ctx) {
    const auth = new AuthService(ctx);
    ctx.services.auth = auth;
    auth.seedInitialUsers();
  },
  routes(ctx) {
    const r = Router();
    const auth = () => service<AuthService>(ctx, 'auth');
    const cookieBase = { httpOnly: true, sameSite: 'lax' as const, secure: ctx.config.cookieSecure, path: '/' };

    r.post('/login', async (req, res) => {
      const body = parse(z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(200) }), req.body);
      let deviceId: string = req.cookies?.[DEVICE_COOKIE];
      if (!deviceId || !/^[A-Za-z0-9_-]{16,64}$/.test(deviceId)) {
        deviceId = crypto.randomBytes(16).toString('base64url');
      }
      res.cookie(DEVICE_COOKIE, deviceId, { ...cookieBase, maxAge: 5 * 365 * 86_400_000 });
      const result = await auth().login({ ...body, ip: clientIp(req), userAgent: req.get('user-agent') ?? '', deviceId });
      res.cookie(SESSION_COOKIE, result.token, { ...cookieBase, expires: result.expires });
      res.json({ user: result.user });
    });

    r.get('/me', requireAuth, (req, res) => {
      const u = req.user!;
      const users = ctx.db.prepare('SELECT id, username, display_name AS displayName FROM users ORDER BY id').all();
      res.json({ user: { id: u.id, username: u.username, displayName: u.displayName }, team: users });
    });

    r.post('/logout', requireAuth, (req, res) => {
      auth().logout(req.user!.sessionId);
      res.clearCookie(SESSION_COOKIE, cookieBase);
      res.json({ ok: true });
    });

    r.post('/password', requireAuth, async (req, res) => {
      const body = parse(z.object({ current: z.string().min(1), next: z.string().min(8, 'at least 8 characters').max(200) }), req.body);
      await auth().changePassword(req.user!, body.current, body.next);
      res.json({ ok: true });
    });
    return r;
  },
};
