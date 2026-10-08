import crypto from 'node:crypto';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import type { AppContext, AppModule } from '../../core/context.js';
import { service } from '../../core/context.js';
import { clientIp, HttpError, idParam, parse } from '../../core/http.js';
import { PasskeyService } from './passkeys.js';
import { AuthService, DEVICE_COOKIE, ROLES, SESSION_COOKIE, type ClientInfo } from './service.js';

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

export const requireOwner: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== 'owner') return next(new HttpError(403, 'Only an owner can do this'));
  next();
};

const zPassword = z.string().min(8, 'password needs at least 8 characters').max(200);
const zUsername = z.string().trim().min(2).max(40);

export const authModule: AppModule = {
  name: 'auth',
  public: true,
  init(ctx) {
    const auth = new AuthService(ctx);
    ctx.services.auth = auth;
    ctx.services.passkeys = new PasskeyService(ctx);
    auth.seedInitialUsers();
  },
  routes(ctx) {
    const r = Router();
    const auth = () => service<AuthService>(ctx, 'auth');
    const passkeys = () => service<PasskeyService>(ctx, 'passkeys');
    const cookieBase = { httpOnly: true, sameSite: 'lax' as const, secure: ctx.config.cookieSecure, path: '/' };

    const client = (req: Request, res: Response): ClientInfo => {
      let deviceId: string = req.cookies?.[DEVICE_COOKIE];
      if (!deviceId || !/^[A-Za-z0-9_-]{16,64}$/.test(deviceId)) deviceId = crypto.randomBytes(16).toString('base64url');
      res.cookie(DEVICE_COOKIE, deviceId, { ...cookieBase, maxAge: 5 * 365 * 86_400_000 });
      return { ip: clientIp(req), userAgent: req.get('user-agent') ?? '', deviceId };
    };
    const signIn = (res: Response, result: { token: string; expires: Date; user: unknown }) => {
      res.cookie(SESSION_COOKIE, result.token, { ...cookieBase, expires: result.expires });
      res.json({ user: result.user });
    };

    // ── First-run setup: create the first owner from the app (no command line needed) ──
    r.get('/setup', (_req, res) => res.json({ needsSetup: auth().userCount() === 0 }));
    r.post('/setup', (req, res) => {
      const b = parse(z.object({ code: z.string(), username: zUsername, displayName: z.string().trim().min(1).max(80), password: zPassword }), req.body);
      if (auth().userCount() > 0) throw new HttpError(409, 'Setup is already done – please sign in.');
      const code = auth().setupCode;
      if (!code || b.code.trim() !== code) throw new HttpError(403, 'Wrong setup code. It is printed in the server log.');
      const { id } = auth().createUser(b.username, b.displayName, b.password, 'owner');
      signIn(res, auth().startSession(auth().getUser(id), client(req, res), 'password'));
    });

    // ── Password login (fallback) ──
    r.post('/login', async (req, res) => {
      const body = parse(z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(200) }), req.body);
      signIn(res, await auth().login({ ...body, ...client(req, res) }));
    });

    // ── Biometric login (passkeys) ──
    r.post('/passkey/login/options', async (_req, res) => res.json(await passkeys().loginOptions()));
    r.post('/passkey/login', async (req, res) => {
      const b = parse(z.object({ challengeId: z.string(), response: z.any() }), req.body);
      signIn(res, await passkeys().login(b.challengeId, b.response, client(req, res)));
    });
    r.get('/passkeys', requireAuth, (req, res) => res.json({ passkeys: passkeys().list(req.user!.id) }));
    r.post('/passkeys/options', requireAuth, async (req, res) => res.json(await passkeys().registrationOptions(req.user!)));
    r.post('/passkeys', requireAuth, async (req, res) => {
      const b = parse(z.object({ challengeId: z.string(), response: z.any() }), req.body);
      await passkeys().register(req.user!, b.challengeId, b.response, req.get('user-agent') ?? '');
      res.status(201).json({ ok: true });
    });
    r.delete('/passkeys/:id', requireAuth, (req, res) => {
      passkeys().remove(req.user!, idParam(req));
      res.json({ ok: true });
    });

    r.get('/me', requireAuth, (req, res) => {
      const u = req.user!;
      const team = ctx.db.prepare('SELECT id, username, display_name AS displayName, role FROM users WHERE active = 1 ORDER BY id').all();
      res.json({ user: { id: u.id, username: u.username, displayName: u.displayName, role: u.role }, team });
    });

    r.post('/logout', requireAuth, (req, res) => {
      auth().logout(req.user!.sessionId);
      res.clearCookie(SESSION_COOKIE, cookieBase);
      res.json({ ok: true });
    });

    r.post('/password', requireAuth, async (req, res) => {
      const body = parse(z.object({ current: z.string().min(1), next: zPassword }), req.body);
      await auth().changePassword(req.user!, body.current, body.next);
      res.json({ ok: true });
    });

    // ── Team: everyone can see it; owners add members, reset passwords, switch accounts off ──
    r.get('/team', requireAuth, (_req, res) => res.json({ team: auth().team() }));
    r.post('/team', requireAuth, requireOwner, (req, res) => {
      const b = parse(z.object({ username: zUsername, displayName: z.string().trim().min(1).max(80), password: zPassword, role: z.enum(ROLES).default('member') }), req.body);
      res.status(201).json({ id: auth().addMember(req.user!, b) });
    });
    r.patch('/team/:id', requireAuth, requireOwner, (req, res) => {
      const b = parse(
        z.object({ displayName: z.string().trim().min(1).max(80).optional(), role: z.enum(ROLES).optional(), active: z.boolean().optional(), password: zPassword.optional() }),
        req.body,
      );
      auth().updateMember(req.user!, idParam(req), b);
      res.json({ ok: true });
    });
    return r;
  },
};
