import { money, todayInBusinessTz } from '@slay/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext, AppModule } from '../../core/context.js';
import { badRequest, parse, zDate } from '../../core/http.js';
import { CUSTOMER_ORDER_NO_SQL } from '../customers/service.js';
import { salesBetween } from '../dashboard/index.js';

/**
 * Insights for any period: best-selling designs, colours and product types, sales by platform,
 * the repeat-customer rate, profit, and what sells best on each platform. Orders that count are
 * the ones that weren't cancelled; pieces that came back (returns) don't count as sold.
 */
const COUNTED = `o.state IN ('active', 'returned') AND o.order_date BETWEEN ? AND ?`;
/** Per order line: pieces kept, their value, and what they cost (unsold returned pieces still cost). */
const LINE = `(i.quantity - i.returned_qty) AS pieces, (i.quantity - i.returned_qty) * i.unit_price AS sales,
              i.unit_cost * (i.quantity - i.restocked_qty) AS cost`;

interface Ranked {
  name: string;
  pieces: number;
  sales: number;
  profit: number;
}

export function insights(ctx: AppContext, from: string, to: string) {
  const { db } = ctx;
  const lines = db
    .prepare(
      `SELECT o.platform, i.product_name, i.category_name, i.color, ${LINE}
         FROM order_items i JOIN orders o ON o.id = i.order_id
        WHERE ${COUNTED}`,
    )
    .all(from, to) as { platform: string; product_name: string; category_name: string; color: string; pieces: number; sales: number; cost: number }[];

  const rank = (key: (l: (typeof lines)[number]) => string, rows = lines): Ranked[] => {
    const m = new Map<string, Ranked>();
    for (const l of rows) {
      if (l.pieces <= 0 && l.cost <= 0) continue;
      const k = key(l).trim();
      if (!k) continue;
      // Colours typed as "maroon" and "Maroon" are the same colour.
      const id = k.toLowerCase();
      const r = m.get(id) ?? { name: k, pieces: 0, sales: 0, profit: 0 };
      r.pieces += l.pieces;
      r.sales += l.sales;
      r.profit += l.sales - l.cost;
      m.set(id, r);
    }
    return [...m.values()]
      .map((r) => ({ ...r, sales: money(r.sales), profit: money(r.profit) }))
      .filter((r) => r.pieces > 0)
      .sort((a, b) => b.pieces - a.pieces || b.sales - a.sales);
  };

  const platforms = db
    .prepare(
      `SELECT o.platform, COUNT(*) AS orders, COALESCE(SUM(o.total), 0) AS sales,
              COALESCE(SUM(o.total - o.delivery_charge - (SELECT COALESCE(SUM(i.unit_cost * (i.quantity - i.restocked_qty)), 0) FROM order_items i WHERE i.order_id = o.id)), 0) AS profit
         FROM orders o WHERE ${COUNTED} GROUP BY o.platform ORDER BY sales DESC`,
    )
    .all(from, to) as { platform: string; orders: number; sales: number; profit: number }[];

  const repeat = db
    .prepare(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(n >= 2), 0) AS repeat_orders,
              COUNT(DISTINCT customer_id) AS customers, COUNT(DISTINCT CASE WHEN n >= 2 THEN customer_id END) AS returning_customers
         FROM (SELECT o.customer_id, ${CUSTOMER_ORDER_NO_SQL} AS n FROM orders o WHERE ${COUNTED})`,
    )
    .get(from, to) as { orders: number; repeat_orders: number; customers: number; returning_customers: number };

  const totals = salesBetween(ctx, from, to);
  const byPlatform = [...new Set(lines.map((l) => l.platform))].map((platform) => {
    const rows = lines.filter((l) => l.platform === platform);
    const combo = rank((l) => `${l.color} ${l.product_name}`, rows)[0];
    const design = rank((l) => l.product_name, rows)[0];
    const colour = rank((l) => l.color, rows)[0];
    const type = rank((l) => l.category_name, rows)[0];
    // The design + colour pair that sold the most pieces on this platform.
    const top = combo ? rows.find((l) => `${l.color} ${l.product_name}`.trim().toLowerCase() === combo.name.toLowerCase()) : undefined;
    return {
      platform,
      best: combo && top ? { design: top.product_name, color: top.color, category: top.category_name, pieces: combo.pieces, sales: combo.sales } : null,
      design: design ?? null,
      colour: colour ?? null,
      type: type ?? null,
    };
  });

  return {
    from,
    to,
    totals: {
      orders: totals.orders,
      sales: totals.sales,
      profit: totals.gross_profit,
      profit_per_order: totals.orders ? money(totals.gross_profit / totals.orders) : 0,
      pieces: lines.reduce((n, l) => n + Math.max(0, l.pieces), 0),
    },
    designs: rank((l) => l.product_name).slice(0, 10),
    colours: rank((l) => l.color).slice(0, 10),
    types: rank((l) => l.category_name),
    platforms: platforms.map((p) => ({ ...p, sales: money(p.sales), profit: money(p.profit) })),
    repeat: { ...repeat, rate: repeat.orders ? Math.round((repeat.repeat_orders / repeat.orders) * 1000) / 10 : 0 },
    by_platform: byPlatform.sort((a, b) => (b.best?.pieces ?? 0) - (a.best?.pieces ?? 0)),
  };
}

export const insightsModule: AppModule = {
  name: 'insights',
  routes(ctx) {
    const r = Router();
    r.get('/', (req, res) => {
      const q = parse(z.object({ from: zDate, to: zDate.optional() }), req.query);
      const to = q.to ?? todayInBusinessTz();
      if (q.from > to) throw badRequest('The “from” date is after the “to” date. Swap them and try again.');
      res.json(insights(ctx, q.from, to));
    });
    return r;
  },
};
