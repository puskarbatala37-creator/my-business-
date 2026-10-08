/**
 * The real Slay server, running inside the browser for the demo preview.
 * Uses the same feature modules (orders, stock, payments, voice parser, security…)
 * against an in-browser SQLite database, and answers the app's /api calls directly.
 */
import type { Config } from '../../../server/src/config';
import type { AppContext, AppModule } from '../../../server/src/core/context';
import { service } from '../../../server/src/core/context';
import { EventBus } from '../../../server/src/core/events';
import { HttpError } from '../../../server/src/core/http';
import { openDatabase } from '../../../server/src/db';
import { authModule } from '../../../server/src/modules/auth/index';
import { SESSION_COOKIE, type AuthService } from '../../../server/src/modules/auth/service';
import { catalogModule } from '../../../server/src/modules/catalog/index';
import { customersModule } from '../../../server/src/modules/customers/index';
import { dashboardModule } from '../../../server/src/modules/dashboard/index';
import { messagingModule } from '../../../server/src/modules/messaging/index';
import { ordersModule } from '../../../server/src/modules/orders/index';
import { payModule, paymentsModule } from '../../../server/src/modules/payments/index';
import { receiptsModule } from '../../../server/src/modules/receipts/index';
import { securityModule } from '../../../server/src/modules/security/index';
import { voiceModule } from '../../../server/src/modules/voice/index';
import { demoUploadsModule, restoreFileUrls } from './uploads';
import { seedDemo } from './seed';

const modules: AppModule[] = [
  messagingModule,
  securityModule,
  authModule,
  catalogModule,
  customersModule,
  ordersModule,
  paymentsModule,
  payModule,
  receiptsModule,
  dashboardModule,
  voiceModule,
  demoUploadsModule,
];

const origin = location.origin;
const config: Config = {
  port: 0,
  dataDir: '/demo',
  dbFile: '/demo/slay.db',
  uploadsDir: '/demo/uploads',
  appUrl: origin,
  webDist: '',
  isProduction: false,
  trustProxy: false,
  cookieSecure: false,
  sessionDays: 30,
  initialUsers: '',
  esewa: {
    mode: 'test',
    productCode: 'EPAYTEST',
    secretKey: '8gBm/:&EnhH.1/q',
    formUrl: 'https://rc-epay.esewa.com.np/api/epay/main/v2/form',
    statusUrl: 'https://rc.esewa.com.np/api/epay/transaction/status/',
  },
  transcribe: { url: '', apiKey: '', model: '' },
  alertWebhookUrl: '',
  // No texts or emails leave the demo: one-time codes are shown on screen instead.
  sms: { provider: 'log', sparrowToken: '', sparrowFrom: '', twilioSid: '', twilioToken: '', twilioFrom: '' },
  mail: { smtpUrl: '', from: '' },
  showCodesOnScreen: true,
  vapidSubject: 'mailto:demo@example.com',
  webauthn: { rpName: 'Slay', rpID: location.hostname, origins: [origin] },
};

export async function startDemoServer(onChange: () => void) {
  const ctx: AppContext = { config, db: openDatabase(config.dbFile), bus: new EventBus(), services: {} };
  for (const m of modules) m.init?.(ctx);
  restoreFileUrls(ctx);
  // Demo data saved before email sign-in: give the sample accounts their demo emails and phones.
  for (const [name, phone] of [['teza', '9841000001'], ['partner', '9841000002']]) {
    ctx.db
      .prepare(`UPDATE users SET email = ?, username = ?, phone = COALESCE(phone, ?), phone_verified_at = COALESCE(phone_verified_at, ?) WHERE username = ? AND email IS NULL`)
      .run(`${name}@slay.demo`, `${name}@slay.demo`, phone, new Date().toISOString(), name);
  }
  const isNew = (ctx.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n === 0;
  if (isNew) await seedDemo(ctx);

  const routers = modules
    .filter((m) => m.routes)
    .map((m) => ({ prefix: `/api/${m.mount ?? m.name}`, isPublic: !!m.public, router: m.routes!(ctx) as any }));

  const cookies = new Map<string, string>();
  try {
    const saved = localStorage.getItem('slay.demo.session');
    if (saved) cookies.set(SESSION_COOKIE, saved);
  } catch {}

  async function handle(method: string, url: URL, body: unknown, headers: Headers) {
    const out = { status: 200, body: undefined as unknown };
    const req: any = {
      method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body,
      cookies: Object.fromEntries(cookies),
      ip: '127.0.0.1',
      socket: {},
      get: (h: string) => (h.toLowerCase() === 'user-agent' ? navigator.userAgent : headers.get(h) ?? undefined),
    };
    const res: any = {
      status(n: number) {
        out.status = n;
        return res;
      },
      json(b: unknown) {
        out.body = b;
        return res;
      },
      redirect(to: string) {
        out.body = { redirect: to };
      },
      cookie(name: string, value: string) {
        cookies.set(name, value);
        if (name === SESSION_COOKIE) {
          try {
            localStorage.setItem('slay.demo.session', value);
          } catch {}
        }
      },
      clearCookie(name: string) {
        cookies.delete(name);
        if (name === SESSION_COOKIE) {
          try {
            localStorage.removeItem('slay.demo.session');
          } catch {}
        }
      },
    };
    try {
      const user = service<AuthService>(ctx, 'auth').authenticate(cookies.get(SESSION_COOKIE));
      if (user) req.user = user;
      if (method !== 'GET' && headers.get('x-slay') !== '1') throw new HttpError(403, 'Missing request header');
      if (url.pathname === '/api/health') return { status: 200, body: { ok: true } };
      const r = routers.find((x) => url.pathname === x.prefix || url.pathname.startsWith(x.prefix + '/'));
      if (!r) throw new HttpError(404, 'Not found');
      if (!r.isPublic && !req.user) throw new HttpError(401, 'Please sign in', 'unauthenticated');
      req.path = url.pathname.slice(r.prefix.length) || '/';
      const handled = await r.router.handle(req, res);
      if (!handled) throw new HttpError(404, 'Not found');
    } catch (err) {
      if (err instanceof HttpError) {
        out.status = err.status;
        out.body = { error: err.message, code: err.code, details: err.details };
      } else {
        console.error(err);
        out.status = 500;
        out.body = { error: 'Something went wrong. Please try again.' };
      }
    }
    if (method !== 'GET') onChange();
    return out;
  }

  // Route the app's /api requests to the in-browser server.
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return realFetch(input as RequestInfo, init);
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: unknown = undefined;
    if (init?.body instanceof FormData) body = init.body;
    else if (typeof init?.body === 'string') body = JSON.parse(init.body);
    const r = await handle(method, url, body, new Headers(init?.headers));
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  };

  // Live updates: the app's EventSource('/api/live') listens to the in-browser event bus.
  class LiveSource {
    static CLOSED = 2;
    readyState = 1;
    onopen: (() => void) | null = null;
    onmessage: ((m: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    private off: () => void;
    constructor() {
      this.off = ctx.bus.subscribe((e) => this.onmessage?.({ data: JSON.stringify(e) }));
      setTimeout(() => this.onopen?.(), 0);
    }
    close() {
      this.readyState = 2;
      this.off();
    }
  }
  (window as any).EventSource = LiveSource;
  return ctx;
}
