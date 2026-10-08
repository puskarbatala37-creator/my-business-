import { LIVE_EVENTS, money } from '@slay/shared';
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
  category: zText(80).optional(),
  notes: zText(2000).optional(),
});

/** Stock purchase receipts: photos of supplier bills, timestamped and searchable. */
export const receiptsModule: AppModule = {
  name: 'receipts',
  routes(ctx) {
    const r = Router();
    const { db } = ctx;

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
      if (q.category) (where.push('r.category = ?'), args.push(q.category));
      const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const receipts = db
        .prepare(`SELECT r.*, u.display_name AS created_by_name FROM receipts r LEFT JOIN users u ON u.id = r.created_by ${w} ORDER BY r.captured_at DESC LIMIT 300`)
        .all(...args);
      const total = (db.prepare(`SELECT COALESCE(SUM(amount), 0) AS t, COUNT(*) AS n FROM receipts r ${w}`).get(...args) as any);
      const categories = db.prepare(`SELECT DISTINCT category FROM receipts WHERE category <> '' ORDER BY category`).all().map((c: any) => c.category);
      res.json({ receipts, total: money(total.t), count: total.n, categories });
    });

    r.post('/', (req, res) => {
      const b = parse(zReceipt, req.body);
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
