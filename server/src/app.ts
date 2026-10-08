import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type ErrorRequestHandler } from 'express';
import type { Config } from './config.js';
import type { AppContext, AppModule } from './core/context.js';
import { EventBus } from './core/events.js';
import { HttpError } from './core/http.js';
import { openDatabase, type DB } from './db/index.js';
import { requireAuth, sessionMiddleware } from './modules/auth/index.js';
import { modules as defaultModules } from './modules/index.js';
import { serveUploads } from './modules/uploads/index.js';

export function createApp(config: Config, opts: { db?: DB; modules?: AppModule[] } = {}) {
  const ctx: AppContext = {
    config,
    db: opts.db ?? openDatabase(config.dbFile),
    bus: new EventBus(),
    services: {},
  };
  const modules = opts.modules ?? defaultModules;
  for (const m of modules) m.init?.(ctx);

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(sessionMiddleware(ctx));

  // CSRF defence: state-changing API calls must carry a custom header, which
  // browsers will not send cross-site without a CORS pre-flight we never allow.
  app.use('/api', (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('x-slay') !== '1') return next(new HttpError(403, 'Missing request header'));
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  for (const m of modules) {
    if (!m.routes) continue;
    const mount = `/api/${m.mount ?? m.name}`;
    if (m.public) app.use(mount, m.routes(ctx));
    else app.use(mount, requireAuth, m.routes(ctx));
  }
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  app.use('/uploads', requireAuth, serveUploads(config.uploadsDir));

  // Serve the built web app (single-page app) in production.
  if (fs.existsSync(path.join(config.webDist, 'index.html'))) {
    app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api|uploads).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(config.webDist, 'index.html'));
    });
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
      return;
    }
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Invalid JSON' });
      return;
    }
    if (err?.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: 'File is too large' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  };
  app.use(onError);

  const stops: (() => void)[] = [];
  const start = () => {
    for (const m of modules) {
      const stop = m.start?.(ctx);
      if (stop) stops.push(stop);
    }
  };
  const stop = () => stops.forEach((s) => s());
  return { app, ctx, start, stop };
}
