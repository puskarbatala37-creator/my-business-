import { LIVE_EVENTS, money, RECEIPT_TYPE_PRESETS } from '@slay/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { AppModule } from '../../core/context.js';
import { actorOf, logActivity, service } from '../../core/context.js';
import { idParam, notFound, parse, zDate, zMoney, zText } from '../../core/http.js';
import type { AlertService } from '../security/service.js';

const zReceipt = z.object({
  photo: z.string().min(1, 'photo is required').max(300),
  captured_at: z.string().datetime({ offset: true }).optional(),
  supplier: zText(200).optional(),
  amount: zMoney.optional(),
  category: zText(40).optional(),
  notes: zText(2000).optional(),
});

const zTypeName = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(1, 'Type a name for the new type').max(40, 'Keep the type name under 40 characters'));

/** Stock purchase receipts: photos of supplier bills, timestamped and searchable. */
export const receiptsModule: AppModule = {
  name: 'receipts',
  routes(ctx) {
    const r = Router();
    const { db } = ctx;

    /**
     * The bill types to choose from: the presets, then the team's own. A name that matches an
     * existing type (any capitalisation) reuses it, so "fabric" and "Fabric" never become two types.
     */
    const types = () => ({
      presets: [...RECEIPT_TYPE_PRESETS],
      custom: db.prepare('SELECT id, name FROM receipt_types ORDER BY name COLLATE NOCASE').all() as { id: number; name: string }[],
    });
    const resolveType = (raw: string | undefined, userId: number) => {
      const name = raw?.trim().replace(/\s+/g, ' ') ?? '';
      if (!name) return '';
      const preset = RECEIPT_TYPE_PRESETS.find((p) => p.toLowerCase() === name.toLowerCase());
      if (preset) return preset;
      const existing = db.prepare('SELECT name FROM receipt_types WHERE name = ?').get(name) as { name: string } | undefined;
      if (existing) return existing.name;
      db.prepare('INSERT INTO receipt_types (name, created_by) VALUES (?, ?)').run(name, userId);
      return name;
    };

    r.get('/types', (_req, res) => res.json(types()));
    r.post('/types', (req, res) => {
      const { name } = parse(z.object({ name: zTypeName }), req.body);
      const saved = resolveType(name, req.user!.id);
      ctx.bus.publish(LIVE_EVENTS.receipt, { actor: actorOf(req.user), ids: [] });
      res.status(201).json({ name: saved, ...types() });
    });
    // Removes a type from the choices (e.g. a typo). Bills already saved with it keep their type.
    r.delete('/types/:id', (req, res) => {
      const id = idParam(req);
      if (!db.prepare('DELETE FROM receipt_types WHERE id = ?').run(id).changes) throw notFound('Type not found');
      ctx.bus.publish(LIVE_EVENTS.receipt, { actor: actorOf(req.user), ids: [] });
      res.json(types());
    });

    r.get('/', (req, res) => {
      const q = parse(z.object({ q: z.string().optional(), from: zDate.optional(), to: zDate.optional(), category: z.string().optional() }), req.query);
      const where: string[] = [];
      const args: unknown[] = [];
      if (q.q?.trim()) {
        const like = `%${q.q.trim()}%`;
        where.push('(r.supplier LIKE ? OR r.notes LIKE ? OR r.category LIKE ?)');
        args.push(like, like, like);
      }
      // captured_at is UTC; Nepal is UTC+05:45 – compare on local date.
      if (q.from) (where.push(`date(r.captured_at, '+5 hours', '+45 minutes') >= ?`), args.push(q.from));
      if (q.to) (where.push(`date(r.captured_at, '+5 hours', '+45 minutes') <= ?`), args.push(q.to));
      if (q.category) (where.push('r.category = ? COLLATE NOCASE'), args.push(q.category));
      const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const receipts = db
        .prepare(`SELECT r.*, u.display_name AS created_by_name FROM receipts r LEFT JOIN users u ON u.id = r.created_by ${w} ORDER BY r.captured_at DESC LIMIT 300`)
        .all(...args);
      const total = (db.prepare(`SELECT COALESCE(SUM(amount), 0) AS t, COUNT(*) AS n FROM receipts r ${w}`).get(...args) as any);
      res.json({ receipts, total: money(total.t), count: total.n });
    });

    r.post('/', (req, res) => {
      const b = parse(zReceipt, req.body);
      b.category = resolveType(b.category, req.user!.id);
      const row = db
        .prepare('INSERT INTO receipts (photo, captured_at, supplier, amount, category, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *')
        .get(b.photo, b.captured_at ? new Date(b.captured_at).toISOString() : new Date().toISOString(), b.supplier ?? '', money(b.amount ?? 0), b.category ?? '', b.notes ?? '', req.user!.id) as any;
      logActivity(ctx, req.user!.id, 'receipt_added', 'receipt', row.id, { amount: row.amount });
      ctx.bus.publish(LIVE_EVENTS.receipt, { actor: actorOf(req.user), ids: [row.id] });
      res.status(201).json(row);
    });

    r.patch('/:id', (req, res) => {
      const id = idParam(req);
      const b = parse(zReceipt.omit({ photo: true, captured_at: true }).partial(), req.body);
      const cur = db.prepare('SELECT * FROM receipts WHERE id = ?').get(id) as any;
      if (!cur) throw notFound('Receipt not found');
      if (b.category !== undefined) b.category = resolveType(b.category, req.user!.id);
      db.prepare('UPDATE receipts SET supplier = ?, amount = ?, category = ?, notes = ? WHERE id = ?').run(
        b.supplier ?? cur.supplier,
        b.amount !== undefined ? money(b.amount) : cur.amount,
        b.category ?? cur.category,
        b.notes ?? cur.notes,
        id,
      );
      ctx.bus.publish(LIVE_EVENTS.receipt, { actor: actorOf(req.user), ids: [id] });
      res.json({ ok: true });
    });

    r.delete('/:id', (req, res) => {
      const id = idParam(req);
      const cur = db.prepare('SELECT * FROM receipts WHERE id = ?').get(id) as any;
      if (!cur) throw notFound('Receipt not found');
      db.prepare('DELETE FROM receipts WHERE id = ?').run(id);
      logActivity(ctx, req.user!.id, 'receipt_deleted', 'receipt', id, cur);
      service<AlertService>(ctx, 'alerts').raise('receipt_deleted', 'info', `${req.user!.displayName} deleted a supplier receipt (${cur.supplier || 'no supplier'}, Rs ${cur.amount}).`, {}, req.user!.id);
      ctx.bus.publish(LIVE_EVENTS.receipt, { actor: actorOf(req.user), ids: [id] });
      res.json({ ok: true });
    });
    return r;
  },
};
