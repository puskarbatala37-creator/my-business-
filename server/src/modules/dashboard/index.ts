import { addDays, money, todayInBusinessTz } from '@slay/shared';
import { Router } from 'express';
import type { AppContext, AppModule } from '../../core/context.js';

function monthStart(isoDate: string, monthsBack: number) {
  const [y, m] = isoDate.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - monthsBack, 1));
  return d.toISOString().slice(0, 10);
}

export function dashboardSummary(ctx: AppContext, today = todayInBusinessTz()) {
  const { db } = ctx;
  const sales = (from: string, to: string) => {
    const r = db
      .prepare(
        `SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS sales, COALESCE(SUM(amount_paid), 0) AS collected,
                COALESCE(SUM(delivery_charge), 0) AS delivery,
                -- Pieces returned and put back in stock cost nothing; ones that couldn't be resold still do.
                COALESCE(SUM((SELECT SUM(i.unit_cost * (i.quantity - i.restocked_qty)) FROM order_items i WHERE i.order_id = o.id)), 0) AS cost
           FROM orders o WHERE state IN ('active', 'returned') AND order_date BETWEEN ? AND ?`,
      )
      .get(from, to) as any;
    return { orders: r.orders, sales: money(r.sales), collected: money(r.collected), cost: money(r.cost), 
      // Delivery charges are passed on to the courier, so they are not profit. (Discounts already lower the sales.)
      gross_profit: money(r.sales - r.delivery - r.cost) };
  };

  const thisMonth = monthStart(today, 0);
  const sixMonths = monthStart(today, 5);

  const byMonth = db
    .prepare(
      `SELECT substr(order_date, 1, 7) AS month, COUNT(*) AS orders, COALESCE(SUM(total), 0) AS sales
         FROM orders WHERE state IN ('active', 'returned') AND order_date >= ? GROUP BY month ORDER BY month`,
    )
    .all(sixMonths) as { month: string; orders: number; sales: number }[];
  const spendByMonth = db
    .prepare(
      `SELECT substr(datetime(captured_at, '+5 hours', '+45 minutes'), 1, 7) AS month, COALESCE(SUM(amount), 0) AS spent
         FROM receipts WHERE date(captured_at, '+5 hours', '+45 minutes') >= ? GROUP BY month`,
    )
    .all(sixMonths) as { month: string; spent: number }[];
  const months = Array.from({ length: 6 }, (_, i) => monthStart(today, 5 - i).slice(0, 7)).map((month) => {
    const s = byMonth.find((m) => m.month === month);
    const sp = spendByMonth.find((m) => m.month === month);
    return { month, orders: s?.orders ?? 0, sales: money(s?.sales ?? 0), receipts_spent: money(sp?.spent ?? 0) };
  });

  const weekFrom = addDays(today, -6);
  const byDay = db
    .prepare(`SELECT order_date AS date, COALESCE(SUM(total), 0) AS sales, COUNT(*) AS orders FROM orders WHERE state IN ('active', 'returned') AND order_date >= ? GROUP BY order_date`)
    .all(weekFrom) as { date: string; sales: number; orders: number }[];
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekFrom, i)).map((date) => {
    const d = byDay.find((x) => x.date === date);
    return { date, sales: money(d?.sales ?? 0), orders: d?.orders ?? 0 };
  });

  const outstanding = db
    .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total - amount_paid), 0) AS due FROM orders WHERE state = 'active' AND payment_status <> 'paid'`)
    .get() as any;
  // Money owed back to customers: paid on a cancelled order, or more paid than an order is worth after a return.
  const refundsDue = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(amount_paid - CASE WHEN state = 'cancelled' THEN 0 ELSE total END), 0) AS due FROM orders
        WHERE amount_paid > CASE WHEN state = 'cancelled' THEN 0 ELSE total END + 0.001`,
    )
    .get() as any;
  const toSend = db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE state = 'active' AND fulfillment_status = 'pending'`).get() as any;
  const dueSoon = db
    .prepare(
      `SELECT o.id, o.invoice_no, o.delivery_due_date, c.name AS customer_name FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.state = 'active' AND o.fulfillment_status = 'pending' AND o.delivery_due_date IS NOT NULL AND o.delivery_due_date <= ?
        ORDER BY o.delivery_due_date LIMIT 10`,
    )
    .all(addDays(today, 2));
  const lowStock = db
    .prepare(
      `SELECT v.id, v.color, v.stock, v.photo, p.name AS product_name FROM variants v JOIN products p ON p.id = v.product_id
        WHERE v.archived = 0 AND p.archived = 0 AND v.stock <= 1 ORDER BY v.stock, p.name LIMIT 12`,
    )
    .all();

  return {
    today: { date: today, ...sales(today, today) },
    month: { from: thisMonth, ...sales(thisMonth, today) },
    six_months: { from: sixMonths, ...sales(sixMonths, today) },
    months,
    days,
    outstanding: { orders: outstanding.n, amount: money(outstanding.due) },
    refunds_due: { orders: refundsDue.n, amount: money(refundsDue.due) },
    to_send: toSend.n,
    due_soon: dueSoon,
    low_stock: lowStock,
  };
}

export const dashboardModule: AppModule = {
  name: 'dashboard',
  routes(ctx) {
    const r = Router();
    r.get('/', (_req, res) => res.json(dashboardSummary(ctx)));
    return r;
  },
};
