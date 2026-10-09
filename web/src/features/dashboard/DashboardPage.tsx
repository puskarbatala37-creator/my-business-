import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { HeaderActions } from '../../components/Layout';
import { Loading, StockBadge, Thumb, TopBar } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { monthLabel, npr, relativeDue, shortDate } from '../../lib/format';
import { daysSinceDownload, useBackups } from '../more/BackupsPage';

interface Period {
  orders: number;
  sales: number;
  collected: number;
  cost: number;
  gross_profit: number;
}
interface Summary {
  today: Period & { date: string };
  month: Period & { from: string };
  six_months: Period & { from: string };
  months: { month: string; orders: number; sales: number; receipts_spent: number }[];
  days: { date: string; sales: number; orders: number }[];
  outstanding: { orders: number; amount: number };
  to_send: number;
  due_soon: { id: number; invoice_no: string; delivery_due_date: string; customer_name: string }[];
  low_stock: { id: number; color: string; stock: number; photo: string | null; product_name: string }[];
}

const compact = (n: number) => (n >= 100000 ? `${(n / 100000).toFixed(1)}L` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(Math.round(n)));

/** Single-series bar chart. Tap a bar to see its exact value (the title names the series, so no legend). */
function Bars({ data, label }: { data: { key: string; label: string; value: number; sub?: string }[]; label: string }) {
  const [sel, setSel] = useState<string | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const selected = data.find((d) => d.key === sel) ?? data[data.length - 1];
  return (
    <div>
      <div className="row between small">
        <span className="muted">{label}</span>
        <span className="num">
          <span className="strong">{selected.label}</span> · {npr(selected.value)}
          {selected.sub ? <span className="muted"> · {selected.sub}</span> : null}
        </span>
      </div>
      <div className="bars" role="img" aria-label={`${label}: ${data.map((d) => `${d.label} ${npr(d.value)}`).join(', ')}`}>
        {data.map((d) => (
          <button key={d.key} type="button" className={`bar-col ${selected.key === d.key ? 'sel' : ''}`} onClick={() => setSel(d.key)} title={`${d.label}: ${npr(d.value)}`}>
            {d.value > 0 && selected.key === d.key && <span className="bar-value">{compact(d.value)}</span>}
            <div className="bar" style={{ height: `${(d.value / max) * 100}%`, opacity: selected.key === d.key ? 1 : 0.55 }} />
            <span className="bar-label">{d.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, p }: { label: string; p: Period }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{npr(p.sales)}</div>
      <div className="sub">
        {p.orders} order{p.orders === 1 ? '' : 's'}
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { me } = useAuth();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Summary>('/api/dashboard') });
  const d = q.data;
  // Owners: a weekly nudge to keep a copy of the data off the server.
  const backups = useBackups();
  const sinceBackup = daysSinceDownload(backups.data);
  const backupDue = !!backups.data && (sinceBackup === null || sinceBackup > 7);
  return (
    <>
      <TopBar title={`Hi, ${me?.user.displayName}`} actions={<HeaderActions />} />
      <main className="page">
        {backupDue && (
          <Link to="/more/backups" className="alert-banner warning" style={{ marginTop: 12 }}>
            <span>
              <strong>Save this week’s backup.</strong> {sinceBackup === null ? 'No copy has been saved off the server yet.' : `The last one was saved ${sinceBackup} days ago.`} Tap here –
              it takes a few seconds.
            </span>
          </Link>
        )}
        {!d ? (
          <Loading error={q.error} retry={q.refetch} what="sales summary" />
        ) : (
          <>
            <div className="section">
              <div className="section-title">
                <h2>Sales</h2>
              </div>
              <div className="stats">
                <Stat label="Today" p={d.today} />
                <Stat label="This month" p={d.month} />
                <Stat label="6 months" p={d.six_months} />
              </div>
              <div className="grid-2 mt">
                <div className="stat">
                  <div className="label">Profit this month</div>
                  <div className="value">{npr(d.month.gross_profit)}</div>
                  <div className="sub">sales − item cost, excl. delivery</div>
                </div>
                <Link to="/orders?payment=open" className="stat" style={{ color: 'inherit' }}>
                  <div className="label">Still to collect</div>
                  <div className="value">{npr(d.outstanding.amount)}</div>
                  <div className="sub">{d.outstanding.orders} unpaid / partial</div>
                </Link>
              </div>
            </div>

            <div className="card">
              <Bars label="Sales per month (last 6)" data={d.months.map((m) => ({ key: m.month, label: monthLabel(m.month), value: m.sales, sub: `${m.orders} order${m.orders === 1 ? "" : "s"}` }))} />
            </div>
            <div className="card mt">
              <Bars label="Sales per day (last 7)" data={d.days.map((x) => ({ key: x.date, label: shortDate(x.date).split(' ')[0], value: x.sales, sub: `${x.orders} order${x.orders === 1 ? "" : "s"}` }))} />
            </div>

            <div className="section">
              <div className="section-title">
                <h2>To do</h2>
              </div>
              <div className="list">
                <Link to="/orders?fulfillment=pending" className="list-item">
                  <div className="grow strong">Orders to send</div>
                  <span className="badge neutral">{d.to_send}</span>
                </Link>
                {d.due_soon.map((o) => (
                  <Link key={o.id} to={`/orders/${o.id}`} className="list-item">
                    <div className="grow">
                      <div className="strong">{o.customer_name}</div>
                      <div className="small muted">{o.invoice_no}</div>
                    </div>
                    <span className={`badge ${o.delivery_due_date < d.today.date ? 'bad' : 'warn'}`}>{relativeDue(o.delivery_due_date, d.today.date)}</span>
                  </Link>
                ))}
              </div>
            </div>

            {d.low_stock.length > 0 && (
              <div className="section">
                <div className="section-title">
                  <h2>Low stock</h2>
                  <Link to="/stock" className="small">
                    All stock
                  </Link>
                </div>
                <div className="list">
                  {d.low_stock.map((v) => (
                    <div key={v.id} className="list-item">
                      <Thumb src={v.photo} />
                      <div className="grow">
                        <div className="strong ellipsis">{v.product_name}</div>
                        <div className="small muted">{v.color}</div>
                      </div>
                      <StockBadge stock={v.stock} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
