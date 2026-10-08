import type { Request } from 'express';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: unknown) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, 'bad_request', details);
export const notFound = (what = 'Not found') => new HttpError(404, what, 'not_found');
export const conflict = (msg: string, code = 'conflict', details?: unknown) => new HttpError(409, msg, code, details);

/** Parse `req.body` (or another value) with a zod schema, throwing a 400 with readable messages. */
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) {
    const msg = r.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ` : '') + i.message).join('; ');
    throw badRequest(msg, r.error.issues);
  }
  return r.data;
}

export function idParam(req: Request, name = 'id'): number {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`Invalid ${name}`);
  return n;
}

export function clientIp(req: Request): string {
  return (req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

// Reusable schema pieces
export const zMoney = z.coerce.number().min(0).max(100_000_000);
export const zText = (max = 2000) => z.string().trim().max(max);
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
