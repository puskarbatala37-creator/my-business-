import { Router } from 'express';
import { z } from 'zod';
import type { AppModule } from '../../core/context.js';
import { service } from '../../core/context.js';
import { idParam, parse, zText } from '../../core/http.js';
import { CustomerService } from './service.js';

export const zCustomer = z.object({
  id: z.coerce.number().int().positive().nullable().optional(),
  name: zText(120).min(1, 'customer name is required'),
  phone: zText(30).nullable().optional(),
  address: zText(500).optional(),
  social_handle: zText(120).optional(),
  notes: zText(2000).optional(),
});

export const customersModule: AppModule = {
  name: 'customers',
  init(ctx) {
    ctx.services.customers = new CustomerService(ctx);
  },
  routes(ctx) {
    const r = Router();
    const customers = () => service<CustomerService>(ctx, 'customers');

    r.get('/', (req, res) => res.json({ customers: customers().search(String(req.query.q ?? '')) }));
    r.get('/lookup', (req, res) => {
      const c = customers().findByPhone(String(req.query.phone ?? ''));
      res.json(c ? { customer: c, orders: customers().history(c.id, 10) } : { customer: null, orders: [] });
    });
    r.get('/:id', (req, res) => {
      const id = idParam(req);
      res.json({ customer: customers().get(id), orders: customers().history(id) });
    });
    r.post('/', (req, res) => {
      const b = parse(zCustomer.omit({ id: true }), req.body);
      res.status(201).json({ id: customers().create(b, req.user) });
    });
    r.patch('/:id', (req, res) => {
      const b = parse(zCustomer.omit({ id: true }).partial(), req.body);
      customers().update(idParam(req), b, req.user);
      res.json({ ok: true });
    });
    return r;
  },
};
