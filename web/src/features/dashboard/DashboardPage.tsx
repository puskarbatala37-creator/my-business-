import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { HeaderActions } from '../../components/Layout';
import { Loading, Seg, Sheet, StockBadge, Thumb, TopBar } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { monthLabel, npr, relativeDue, shortDate } from '../../lib/format';
import { datePresets } from '../../lib/periods';
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
  twelve_months: Period & { from: string };
  /** Since the very first order (`from` is null before there are any). */
  all_time: Period & { from: string | null };
  months: { month: string; orders: number; sales: number; receipts_spent: number }[];
  days: { date: string; sales: number; orders: number }[];
  outstanding: { orders: number; amount: number };
  refunds_due: { orders: number; amount: number };
  to_send: number;
  due_soon: { id: number; invoice_no: string; delivery_due_date: string; customer_name: string }[];
  low_stock: { id: number; color: string; stock: number; photo: string | null; product_name: string }[];
}

const compact = (n: number) => (n >= 100000 ? `${(n / 100000).toFixed(1)}L` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(Math.round(n)));

/** Single-series bar chart. Tap a bar to see its exact value (the title names the series, so no legend). */
function Bars({ data, label }: { data: { key: string; label: string; value: number; sub?: string }[]; label: string }) {
  const [sel, setSel] = useState<string | null>(null);
  // Long ranges (all time) scroll sideways, starting at the latest month.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [data.length]);
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
      <div ref={scroller} className={`bars ${data.length > 12 ? 'scroll' : ''}`} role="img" aria-label={`${label}: ${data.map((d) => `${d.label} ${npr(d.value)}`).join(', ')}`}>
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
  const [chart, setChart] = useState<'6' | '12' | 'all'>('12');
  const q = useQuery({ queryKey: ['dashboard', chart], queryFn: () => api.get<Summary>(`/api/dashboard?chart=${chart}`), placeholderData: (prev) => prev });
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
                <Stat label="12 months" p={d.twelve_months} />
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
              {d.refunds_due.orders > 0 && (
                <Link to="/orders?refund=due&state=all" className="stat mt" style={{ color: 'inherit', display: 'block' }}>
                  <div className="label">To give back to customers</div>
                  <div className="value" style={{ color: 'var(--warn)' }}>
                    {npr(d.refunds_due.amount)}
                  </div>
                  <div className="sub">
                    {d.refunds_due.orders} order{d.refunds_due.orders === 1 ? '' : 's'} after a return or cancellation
                  </div>
                </Link>
              )}
            </div>

            <PeriodCard allTime={d.all_time} today={d.today.date} />

            <div className="card">
              <div className="stack" style={{ gap: 8, marginBottom: 8 }}>
                <span className="strong small">Sales per month</span>
                <Seg
                  value={chart}
                  onChange={setChart}
                  options={[
                    { value: '6', label: '6 months' },
                    { value: '12', label: '12 months' },
                    { value: 'all', label: 'All' },
                  ]}
                />
              </div>
              <Bars
                label={chart === 'all' ? `Since ${d.months[0] ? monthYear(d.months[0].month) : 'the start'}` : `Last ${chart} months`}
                data={d.months.map((m) => ({
                  key: m.month,
                  // Once the chart spans more than one year, January shows its year.
                  label: d.months.length > 12 && m.month.endsWith('-01') ? `${monthLabel(m.month)} ’${m.month.slice(2, 4)}` : monthLabel(m.month),
                  value: m.sales,
                  sub: `${monthYear(m.month)} · ${m.orders} order${m.orders === 1 ? '' : 's'}`,
                }))}
              />
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

const monthYear = (ym: string) => new Date(ym + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Sales, profit and money collected for any stretch of dates – all time by default, however far back. */
function PeriodCard({ allTime, today }: { allTime: Period & { from: string | null }; today: string }) {
  const presets = datePresets(today).filter((p) => ['month', 'last-month', '6m', '12m', 'year', 'last-year'].includes(p.key));
  const [range, setRange] = useState<{ from: string; to: string; label: string }>({ from: '', to: '', label: 'All time' });
  const [picking, setPicking] = useState(false);
  const all = !range.from && !range.to;
  const q = useQuery({
    queryKey: ['dashboard', 'period', range.from, range.to],
    queryFn: () => api.get<Period & { from: string; to: string }>(`/api/dashboard/period?${new URLSearchParams({ ...(range.from && { from: range.from }), ...(range.to && { to: range.to }) })}`),
    enabled: !all,
  });
  const p = all ? allTime : q.data;
  const since = all ? allTime.from : range.from;
  return (
    <div className="card mt">
      <div className="row between">
        <span className="strong small">Sales for any dates</span>
        <button type="button" className="btn sm" onClick={() => setPicking(true)} aria-label={`Change dates (now: ${range.label})`}>
          {range.label}
        </button>
      </div>
      <div className="tiny muted" style={{ marginTop: 2 }}>
        {all ? (since ? `Since the first order, ${shortDate(since)}` : 'No orders yet') : `${shortDate(range.from)} – ${shortDate(range.to)}`}
      </div>
      {!p ? (
        <div className="small muted mt">{q.error ? (q.error as Error).message : 'Adding up…'}</div>
      ) : (
        <div className="grid-2 mt">
          <div className="stat">
            <div className="label">Sales</div>
            <div className="value">{npr(p.sales)}</div>
            <div className="sub">
              {p.orders} order{p.orders === 1 ? '' : 's'}
            </div>
          </div>
          <div className="stat">
            <div className="label">Profit</div>
            <div className="value">{npr(p.gross_profit)}</div>
            <div className="sub">collected {npr(p.collected)}</div>
          </div>
        </div>
      )}
      <Link className="small" style={{ display: 'inline-block', marginTop: 8 }} to={`/orders?state=all${range.from ? `&from=${range.from}&to=${range.to}` : ''}`}>
        See these orders
      </Link>
      {picking && <PeriodSheet presets={presets} current={range} onClose={() => setPicking(false)} onPick={(r) => (setRange(r), setPicking(false))} today={today} />}
    </div>
  );
}

function PeriodSheet({
  presets,
  current,
  today,
  onPick,
  onClose,
}: {
  presets: { key: string; label: string; from: string; to: string }[];
  current: { from: string; to: string };
  today: string;
  onPick: (r: { from: string; to: string; label: string }) => void;
  onClose: () => void;
}) {
  const [from, setFrom] = useState(current.from);
  const [to, setTo] = useState(current.to || today);
  return (
    <Sheet title="Sales for which dates?" onClose={onClose}>
      <div className="stack">
        <div className="chips" style={{ flexWrap: 'wrap' }}>
          <button type="button" className={`chip ${!current.from ? 'on' : ''}`} onClick={() => onPick({ from: '', to: '', label: 'All time' })}>
            All time
          </button>
          {presets.map((p) => (
            <button key={p.key} type="button" className={`chip ${current.from === p.from && current.to === p.to ? 'on' : ''}`} onClick={() => onPick(p)}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid-2">
          <label className="field">
            From
            <input className="input" type="date" max={to || today} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            To
            <input className="input" type="date" min={from || undefined} max={today} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <button
          type="button"
          className="btn primary block"
          disabled={!from || !to || from > to}
          onClick={() => onPick({ from, to, label: from === to ? shortDate(from) : `${shortDate(from)} – ${shortDate(to)}` })}
        >
          Show these dates
        </button>
      </div>
    </Sheet>
  );
}
