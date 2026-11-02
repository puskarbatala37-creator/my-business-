import { addDays, platformLabel, todayInBusinessTz } from '@slay/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loading, Seg, TopBar } from '../../components/ui';
import { api } from '../../lib/api';
import { npr, shortDate } from '../../lib/format';
import { monthStart } from '../../lib/periods';

interface Ranked {
  name: string;
  pieces: number;
  sales: number;
  profit: number;
}
interface Insights {
  from: string;
  to: string;
  totals: { orders: number; sales: number; profit: number; profit_per_order: number; pieces: number };
  designs: Ranked[];
  colours: Ranked[];
  types: Ranked[];
  platforms: { platform: string; orders: number; sales: number; profit: number }[];
  repeat: { orders: number; repeat_orders: number; rate: number; customers: number; returning_customers: number };
  by_platform: {
    platform: string;
    best: { design: string; color: string; category: string; pieces: number; sales: number } | null;
    design: Ranked | null;
    colour: Ranked | null;
    type: Ranked | null;
  }[];
}

type PeriodKey = 'week' | 'month' | '3m' | 'custom';

/** The week starts on Sunday (as in Nepal). */
function weekStart(today: string) {
  const day = new Date(today + 'T00:00:00Z').getUTCDay(); // 0 = Sunday
  return addDays(today, -day);
}

function range(key: PeriodKey, today: string, custom: { from: string; to: string }) {
  if (key === 'week') return { from: weekStart(today), to: today };
  if (key === 'month') return { from: monthStart(today), to: today };
  if (key === '3m') return { from: monthStart(today, 2), to: today };
  return custom;
}

const pcs = (n: number) => `${n} pc${n === 1 ? '' : 's'}`;

/** Sales insights for a chosen period: what sells, where, to whom, and what it earns. */
export function InsightsPage() {
  const today = todayInBusinessTz();
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [custom, setCustom] = useState({ from: monthStart(today, 1), to: today });
  const [draft, setDraft] = useState(custom);
  const r = range(period, today, custom);
  const q = useQuery({
    queryKey: ['insights', r.from, r.to],
    queryFn: () => api.get<Insights>(`/api/insights?from=${r.from}&to=${r.to}`),
    placeholderData: (prev) => prev,
  });
  const d = q.data;

  return (
    <>
      <TopBar title="Insights" back="/more" />
      <main className="page stack insights" style={{ paddingTop: 12 }}>
        <Seg
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'week', label: 'Week' },
            { value: 'month', label: 'Month' },
            { value: '3m', label: '3 months' },
            { value: 'custom', label: 'Dates' },
          ]}
        />
        {period === 'custom' && (
          <div className="card stack">
            <div className="grid-2">
              <label className="field">
                From
                <input className="input" type="date" max={draft.to || today} value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
              </label>
              <label className="field">
                To
                <input className="input" type="date" min={draft.from || undefined} max={today} value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
              </label>
            </div>
            <button type="button" className="btn primary block" disabled={!draft.from || !draft.to || draft.from > draft.to} onClick={() => setCustom(draft)}>
              Show these dates
            </button>
          </div>
        )}
        <div className="small muted" role="status">
          {shortDate(r.from)} – {shortDate(r.to)}
          {d && ` · ${d.totals.orders} order${d.totals.orders === 1 ? '' : 's'} · ${pcs(d.totals.pieces)} sold`}
        </div>

        {!d ? (
          <Loading error={q.error} retry={q.refetch} what="insights" />
        ) : d.totals.orders === 0 ? (
          <div className="card center muted">No orders in this period yet.</div>
        ) : (
          <>
            {/* 6. Profit */}
            <div className="grid-2">
              <div className="stat">
                <div className="label">Sales</div>
                <div className="value">{npr(d.totals.sales)}</div>
                <div className="sub">{d.totals.orders} orders</div>
              </div>
              <div className="stat">
                <div className="label">Total profit</div>
                <div className="value" style={{ color: d.totals.profit >= 0 ? 'var(--good)' : 'var(--bad)' }}>
                  {npr(d.totals.profit)}
                </div>
                <div className="sub">{npr(d.totals.profit_per_order)} per order</div>
              </div>
            </div>
            <div className="tiny muted" style={{ marginTop: -6 }}>
              Profit = what the items sold for, minus discounts and their cost price. Delivery charges aren’t counted (they go to the courier).
            </div>

            {/* 7. Combined: best on each platform */}
            <section className="card stack">
              <h2>Best seller on each platform</h2>
              {d.by_platform.map((p) => (
                <div key={p.platform} className="best-row">
                  <span className={`badge platform platform-${p.platform}`}>
                    <span className="platform-dot" aria-hidden="true" />
                    {platformLabel(p.platform)}
                  </span>
                  {p.best ? (
                    <div className="grow">
                      <div className="strong">
                        {p.best.color} {p.best.design} <span className="muted small">· {pcs(p.best.pieces)}</span>
                      </div>
                      <div className="tiny muted">
                        Top design {p.design?.name} · colour {p.colour?.name} · type {p.type?.name}
                      </div>
                    </div>
                  ) : (
                    <div className="grow small muted">Nothing sold</div>
                  )}
                </div>
              ))}
              {d.by_platform[0]?.best && (
                <div className="insight-callout">
                  {d.by_platform[0].best.color} {d.by_platform[0].best.category ? d.by_platform[0].best.category.toLowerCase() : d.by_platform[0].best.design}s sell best on{' '}
                  {platformLabel(d.by_platform[0].platform)}.
                </div>
              )}
            </section>

            {/* 4. Platforms */}
            <section className="card stack">
              <h2>Orders &amp; sales by platform</h2>
              <Bars
                rows={d.platforms.map((p) => ({ key: p.platform, label: platformLabel(p.platform), value: p.sales, right: npr(p.sales), sub: `${p.orders} order${p.orders === 1 ? '' : 's'} · profit ${npr(p.profit)}`, cls: `platform-${p.platform}` }))}
              />
            </section>

            {/* 5. Repeat customers */}
            <section className="card stack">
              <h2>Repeat customers</h2>
              <div className="row" style={{ gap: 14, alignItems: 'center' }}>
                <div className="repeat-rate num">{d.repeat.rate}%</div>
                <div className="grow small">
                  of orders came from returning customers
                  <div className="tiny muted">
                    {d.repeat.repeat_orders} of {d.repeat.orders} orders · {d.repeat.returning_customers} of {d.repeat.customers} customers had ordered before
                  </div>
                </div>
              </div>
              <div className="meter" role="img" aria-label={`${d.repeat.rate}% repeat orders`}>
                <div style={{ width: `${Math.min(100, d.repeat.rate)}%` }} />
              </div>
            </section>

            {/* 1–3. Best sellers */}
            <Ranking title="Best-selling designs" rows={d.designs} />
            <Ranking title="Best-selling colours" rows={d.colours} />
            <Ranking title="Best-selling product types" rows={d.types} />

            <Link to={`/orders?state=all&from=${d.from}&to=${d.to}`} className="btn block">
              See these orders
            </Link>
          </>
        )}
      </main>
    </>
  );
}

/** A ranked list with a bar for each row – pieces sold, with sales and profit underneath. */
function Ranking({ title, rows }: { title: string; rows: Ranked[] }) {
  if (!rows.length) return null;
  return (
    <section className="card stack">
      <h2>{title}</h2>
      <Bars
        ranked
        rows={rows.map((r) => ({ key: r.name, label: r.name, value: r.pieces, right: pcs(r.pieces), sub: `${npr(r.sales)} sales · ${npr(r.profit)} profit` }))}
      />
    </section>
  );
}

function Bars({ rows, ranked }: { rows: { key: string; label: string; value: number; right: string; sub: string; cls?: string }[]; ranked?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ol className={`hbars ${ranked ? 'ranked' : ''}`}>
      {rows.map((r, i) => (
        <li key={r.key} className={r.cls}>
          <div className="row between small">
            <span className="strong ellipsis">
              {ranked && <span className="rank">{i + 1}</span>}
              {!ranked && <span className="platform-dot" aria-hidden="true" style={{ display: 'inline-block', marginRight: 6 }} />}
              {r.label}
            </span>
            <span className="num strong nowrap">{r.right}</span>
          </div>
          <div className="hbar">
            <div style={{ width: `${Math.max(3, (r.value / max) * 100)}%` }} />
          </div>
          <div className="tiny muted">{r.sub}</div>
        </li>
      ))}
    </ol>
  );
}
