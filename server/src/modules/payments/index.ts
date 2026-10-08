import { Router } from 'express';
import { z } from 'zod';
import type { AppModule } from '../../core/context.js';
import { service } from '../../core/context.js';
import { idParam, parse } from '../../core/http.js';
import { EsewaProvider } from './esewa.js';
import { OnlinePaymentService } from './service.js';

const svc = (ctx: Parameters<NonNullable<AppModule['routes']>>[0]) => service<OnlinePaymentService>(ctx, 'onlinePayments');

/** Signed-in routes: create & inspect payment links. */
export const paymentsModule: AppModule = {
  name: 'payments',
  init(ctx) {
    const s = new OnlinePaymentService(ctx);
    s.register(new EsewaProvider(ctx.config.esewa));
    ctx.services.onlinePayments = s;
  },
  routes(ctx) {
    const r = Router();
    r.post('/requests', (req, res) => {
      const b = parse(z.object({ order_id: z.coerce.number().int().positive(), provider: z.enum(['esewa']).default('esewa') }), req.body);
      res.status(201).json(svc(ctx).createRequest(b.order_id, b.provider, req.user!));
    });
    r.get('/orders/:id/requests', (req, res) => res.json({ requests: svc(ctx).forOrder(idParam(req)) }));
    r.post('/requests/:token/check', async (req, res) => {
      const reqRow = svc(ctx).byToken(String(req.params.token));
      res.json(await svc(ctx).confirm(reqRow));
    });
    return r;
  },
  start(ctx) {
    const timer = setInterval(() => void svc(ctx).reconcilePending(), 3 * 60_000);
    timer.unref();
    return () => clearInterval(timer);
  },
};

/** Public routes used by the customer's payment page and the gateway redirect. */
export const payModule: AppModule = {
  name: 'pay',
  public: true,
  routes(ctx) {
    const r = Router();
    r.get('/:provider/return', async (req, res) => {
      const token = String(req.query.token ?? '');
      try {
        const result = await svc(ctx).handleReturn(token, req.query as Record<string, unknown>);
        res.redirect(`/pay/${encodeURIComponent(token)}?result=${result.status === 'complete' ? 'success' : 'pending'}`);
      } catch (err) {
        console.warn('[payments] return verification failed:', (err as Error).message);
        res.redirect(`/pay/${encodeURIComponent(token)}?result=failed`);
      }
    });
    r.get('/:token', (req, res) => res.json(svc(ctx).publicView(String(req.params.token))));
    return r;
  },
};
