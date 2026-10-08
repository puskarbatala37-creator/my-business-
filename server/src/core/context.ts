import type { Router } from 'express';
import type { Config } from '../config.js';
import type { DB } from '../db/index.js';
import type { EventBus } from './events.js';

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  sessionId: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export interface AppContext {
  config: Config;
  db: DB;
  bus: EventBus;
  /** Service registry – modules expose their services here for other modules. */
  services: Record<string, unknown>;
}

/**
 * A feature module. To add a feature, create a folder under `src/modules`,
 * export an AppModule and add it to `src/modules/index.ts`.
 */
export interface AppModule {
  name: string;
  /** Mounted at /api/<mount ?? name>. Routes require login unless `public` is true. */
  mount?: string;
  public?: boolean;
  /** Create services and put them on ctx.services (runs before any routes are built). */
  init?(ctx: AppContext): void;
  routes?(ctx: AppContext): Router;
  /** Background jobs; return a stop function. */
  start?(ctx: AppContext): (() => void) | void;
}

export function service<T>(ctx: AppContext, name: string): T {
  const s = ctx.services[name];
  if (!s) throw new Error(`Service "${name}" is not registered – check module order in modules/index.ts`);
  return s as T;
}

export function actorOf(user?: AuthUser) {
  return user ? { id: user.id, name: user.displayName } : null;
}

export function logActivity(
  ctx: AppContext,
  userId: number | null,
  action: string,
  entity?: string,
  entityId?: number | null,
  meta?: unknown,
) {
  ctx.db
    .prepare('INSERT INTO activity_log (user_id, action, entity, entity_id, meta) VALUES (?, ?, ?, ?, ?)')
    .run(userId, action, entity ?? null, entityId ?? null, meta === undefined ? null : JSON.stringify(meta));
}
