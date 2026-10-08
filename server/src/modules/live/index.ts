import { Router } from 'express';
import type { AppModule } from '../../core/context.js';
import { streamEvents } from '../../core/events.js';

/** GET /api/live – Server-Sent Events stream that keeps both phones in sync. */
export const liveModule: AppModule = {
  name: 'live',
  routes(ctx) {
    const r = Router();
    r.get('/', (_req, res) => streamEvents(ctx.bus, res));
    return r;
  },
};
