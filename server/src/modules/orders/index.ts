import { FULFILLMENT_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES, PLATFORMS } from '@slay/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { AppModule } from '../../core/context.js';
import { service } from '../../core/context.js';
import { idParam, parse, zDate, zMoney, zText } from '../../core/http.js';
import { zCustomer } from '../customers/index.js';
import { OrderService } from './service.js';

const zItem = z
  .object({
    id: z.coerce.number().int().positive().nullable().optional(),
    variant_id: z.coerce.number().int().positive(),
    size: zText(40).optional(),
    /** A size for each piece, when they differ (one entry per piece). */
    sizes: z.array(zText(40)).max(1000).nullable().optional(),
    quantity: z.coerce.number().int().min(1).max(1000),
    unit_price: zMoney,
    photo: z.string().max(300).nullable().optional(),
  })
  .refine((i) => !i.sizes || i.sizes.length === i.quantity, { message: 'give one size for each piece', path: ['sizes'] });

const zOrder = z.object({
  customer: zCustomer,
  order_date: zDate.optional(),
  // Required: every order records where it came from.
  platform: z.enum(PLATFORMS, { message: 'choose where the order came from (TikTok, Facebook, Instagram or WhatsApp)' }),
  payment_method: z.enum(PAYMENT_METHODS).nullable().optional(),
  delivery_charge: zMoney.optional(),
  discount: zMoney.optional(),
  notes: zText(4000).optional(),
  tracking_number: zText(120).optional(),
  delivery_due_date: zDate.nullable().optional().or(z.literal('')),
  prep_time_days: z.coerce.number().int().min(0).max(365).nullable().optional(),
  fulfillment_status: z.enum(FULFILLMENT_STATUSES).optional(),
  items: z.array(zItem).min(1, 'add at least one item').max(100),
});

export const ordersModule: AppModule = {
  name: 'orders',
  init(ctx) {
    ctx.services.orders = new OrderService(ctx);
  },
  routes(ctx) {
    const r = Router();
    const orders = () => service<OrderService>(ctx, 'orders');

    r.get('/', (req, res) => {
      const q = parse(
        z.object({
          q: z.string().max(200).optional(),
          customer: z.string().max(200).optional(),
          category: z.string().max(80).optional(),
          platform: z.enum(PLATFORMS).optional(),
          fulfillment: z.enum(FULFILLMENT_STATUSES).optional(),
          payment: z.enum([...PAYMENT_STATUSES, 'open']).optional(),
          state: z.string().optional().default('active'),
          from: zDate.optional(),
          to: zDate.optional(),
          customer_id: z.coerce.number().int().optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
          offset: z.coerce.number().int().min(0).optional(),
        }),
        req.query,
      );
      res.json(orders().list(q));
    });

    r.get('/:id', (req, res) => res.json(orders().get(idParam(req))));

    r.post('/', (req, res) => {
      const b = parse(
        zOrder.extend({
          payment: z
            .object({ status: z.enum(PAYMENT_STATUSES), amount: zMoney.optional(), method: z.enum(PAYMENT_METHODS).nullable().optional() })
            .optional(),
        }),
        req.body,
      );
      res.status(201).json(orders().create({ ...b, delivery_due_date: b.delivery_due_date || null }, req.user!));
    });

    r.put('/:id', (req, res) => {
      const b = parse(zOrder.extend({ version: z.coerce.number().int() }), req.body);
      res.json(orders().update(idParam(req), { ...b, delivery_due_date: b.delivery_due_date || null }, req.user!));
    });

    r.patch('/:id', (req, res) => {
      const b = parse(
        z.object({ fulfillment_status: z.enum(FULFILLMENT_STATUSES).optional(), tracking_number: zText(120).optional(), notes: zText(4000).optional() }),
        req.body,
      );
      res.json(orders().patch(idParam(req), b, req.user!));
    });

    r.post('/:id/cancel', (req, res) => {
      const b = parse(z.object({ reason: zText(500).optional().default('') }), req.body ?? {});
      res.json(orders().cancel(idParam(req), b.reason, req.user!));
    });

    r.post('/:id/payments', (req, res) => {
      const b = parse(
        z.object({ amount: z.coerce.number().min(-100_000_000).max(100_000_000), method: z.enum(PAYMENT_METHODS), note: zText(300).optional() }),
        req.body,
      );
      res.status(201).json(orders().addPayment(idParam(req), b, req.user!));
    });

    r.delete('/:id/payments/:paymentId', (req, res) => {
      res.json(orders().deletePayment(idParam(req), idParam(req, 'paymentId'), req.user!));
    });
    return r;
  },
};
