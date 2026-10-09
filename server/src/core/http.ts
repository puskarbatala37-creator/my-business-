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
  if (!r.success) throw badRequest(friendlyIssue(r.error.issues[0]), r.error.issues);
  return r.data;
}

/** What each field is called on screen, for error messages. */
const FIELD_LABELS: Record<string, string> = {
  name: 'Name', displayName: 'Name', phone: 'Mobile number', email: 'Email', password: 'Password', next: 'New password',
  current: 'Current password', code: 'Code', address: 'Address', social_handle: 'Social media name', notes: 'Notes',
  quantity: 'Quantity', unit_price: 'Price', price: 'Selling price', cost: 'Cost', stock: 'Stock', set: 'Count', delta: 'Stock change',
  amount: 'Amount', delivery_charge: 'Delivery charge', discount: 'Discount', order_date: 'Order date',
  delivery_due_date: 'Delivery date', prep_time_days: 'Prep time', tracking_number: 'Tracking number', variant_id: 'Product',
  category_id: 'Category', color: 'Colour', sizes: 'Sizes', size: 'Size', supplier: 'Supplier', category: 'Type',
  method: 'Payment method', platform: 'Where the order came from', photo: 'Photo', items: 'Items', reason: 'Reason',
};

/**
 * Turns a validation problem into one plain sentence a shop owner understands, e.g.
 * "Item 2: Price must be a number" instead of "items.1.unit_price: Invalid input: expected number".
 */
export function friendlyIssue(issue: z.core.$ZodIssue | undefined): string {
  if (!issue) return 'Please check the form and try again.';
  const path = issue.path.map(String);
  const field = [...path].reverse().find((p) => !/^\d+$/.test(p)) ?? '';
  const label = FIELD_LABELS[field] ?? (field ? field.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'This');
  const itemIdx = path[0] === 'items' && /^\d+$/.test(path[1] ?? '') ? Number(path[1]) + 1 : null;
  const prefix = itemIdx ? `Item ${itemIdx}: ` : '';
  const i = issue as any;
  // A message written for people in the schema itself is used as is.
  if (!/^(Invalid|Too (small|big)|expected )/i.test(issue.message)) return prefix + issue.message.replace(/^./, (c) => c.toUpperCase());
  let text: string;
  switch (issue.code) {
    case 'too_small':
      text = i.origin === 'string' ? (Number(i.minimum) <= 1 ? `${label} is required` : `${label} needs at least ${i.minimum} characters`)
        : i.origin === 'array' ? `Add at least ${i.minimum} ${label.toLowerCase()}`
        : `${label} can't be less than ${i.minimum}`;
      break;
    case 'too_big':
      text = i.origin === 'string' ? `${label} is too long (at most ${i.maximum} characters)`
        : i.origin === 'array' ? `Too many ${label.toLowerCase()} (at most ${i.maximum})`
        : `${label} can't be more than ${Number(i.maximum).toLocaleString('en-IN')}`;
      break;
    case 'invalid_type':
      text = /received (undefined|null)/.test(issue.message) ? `${label} is required` : i.expected === 'number' ? `${label} must be a number` : `${label} isn't valid`;
      break;
    case 'invalid_format':
      text = i.format === 'email' ? 'Enter a valid email address, e.g. name@gmail.com' : i.format === 'regex' && /date/i.test(field) ? `${label} isn't a valid date` : `${label} isn't valid`;
      break;
    case 'invalid_value':
      text = `Choose a ${label.toLowerCase()} from the list`;
      break;
    default:
      text = `${label} isn't valid`;
  }
  return prefix + text;
}

export function idParam(req: Request, name = 'id'): number {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n <= 0) throw badRequest('This link isn’t valid. Go back and try again.');
  return n;
}

export function clientIp(req: Request): string {
  return (req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

// Reusable schema pieces
export const zMoney = z.coerce.number().min(0).max(100_000_000);
export const zText = (max = 2000) => z.string().trim().max(max);
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date');
