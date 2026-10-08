import { Router } from 'express';
import { z } from 'zod';
import type { AppModule } from '../../core/context.js';
import { service } from '../../core/context.js';
import { idParam, parse, zMoney, zText } from '../../core/http.js';
import { CatalogService } from './service.js';

const zPhoto = z.string().max(300).nullable().optional();
const zVariant = z.object({
  color: zText(80).min(1, 'colour is required'),
  sku: zText(80).nullable().optional(),
  stock: z.coerce.number().int().min(0).max(100000).optional(),
  cost: zMoney.optional(),
  price: zMoney.optional(),
  photo: zPhoto,
  voice_aliases: zText(500).optional(),
});

const zProduct = z.object({
  category_id: z.coerce.number().int().positive(),
  name: zText(120).min(1, 'name is required'),
  description: zText(2000).optional(),
  sizes: zText(300).optional(),
  voice_aliases: zText(500).optional(),
});

export const catalogModule: AppModule = {
  name: 'catalog',
  init(ctx) {
    ctx.services.catalog = new CatalogService(ctx);
  },
  routes(ctx) {
    const r = Router();
    const catalog = () => service<CatalogService>(ctx, 'catalog');

    r.get('/', (req, res) => res.json({ categories: catalog().tree(req.query.archived === '1') }));

    r.post('/categories', (req, res) => {
      const b = parse(z.object({ name: zText(80).min(1), voice_aliases: zText(500).optional() }), req.body);
      res.status(201).json(catalog().createCategory(b.name, b.voice_aliases));
    });
    r.patch('/categories/:id', (req, res) => {
      const b = parse(z.object({ name: zText(80).min(1).optional(), voice_aliases: zText(500).optional(), sort_order: z.number().int().optional() }), req.body);
      catalog().updateCategory(idParam(req), b);
      res.json({ ok: true });
    });
    r.delete('/categories/:id', (req, res) => {
      catalog().deleteCategory(idParam(req));
      res.json({ ok: true });
    });

    r.post('/products', (req, res) => {
      const b = parse(zProduct.extend({ variants: z.array(zVariant).max(50).optional() }), req.body);
      res.status(201).json({ id: catalog().createProduct(b, req.user!) });
    });
    r.patch('/products/:id', (req, res) => {
      const b = parse(zProduct.partial().extend({ archived: z.boolean().optional() }), req.body);
      catalog().updateProduct(idParam(req), b, req.user!);
      res.json({ ok: true });
    });
    r.post('/products/:id/variants', (req, res) => {
      const b = parse(zVariant, req.body);
      res.status(201).json({ id: catalog().addVariant(idParam(req), b, req.user!) });
    });

    r.get('/variants/:id', (req, res) => res.json(catalog().getVariant(idParam(req))));
    r.patch('/variants/:id', (req, res) => {
      const b = parse(zVariant.omit({ stock: true }).partial().extend({ archived: z.boolean().optional() }), req.body);
      catalog().updateVariant(idParam(req), b, req.user!);
      res.json({ ok: true });
    });
    r.post('/variants/:id/stock', (req, res) => {
      const b = parse(
        z
          .object({
            delta: z.coerce.number().int().min(-100000).max(100000).optional(),
            set: z.coerce.number().int().min(0).max(100000).optional(),
            reason: z.enum(['manual', 'restock']).default('manual'),
            note: zText(300).optional(),
          })
          .refine((v) => v.delta !== undefined || v.set !== undefined, 'delta or set is required'),
        req.body,
      );
      res.json(catalog().adjustStock(idParam(req), b, req.user!));
    });
    r.get('/variants/:id/movements', (req, res) => res.json({ movements: catalog().movements(idParam(req)) }));
    return r;
  },
};
