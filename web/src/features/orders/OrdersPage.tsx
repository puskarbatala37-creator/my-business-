import { addDays, PLATFORMS, platformLabel, todayInBusinessTz } from '@slay/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { HeaderActions } from '../../components/Layout';
import { useCatalog } from '../../components/VariantPicker';
import { Empty, FulfillmentBadge, PaymentBadge, PlatformBadge, Sheet, Spinner, Thumb, TopBar } from '../../components/ui';
import { api, qs } from '../../lib/api';
import { npr, shortDate } from '../../lib/format';
import type { OrderSearchResult, OrderSummary } from '../../lib/types';

/** Quick status views. Each maps to URL parameters, so the dashboard can link straight into them. */
const STATUS = [
  { key: 'all', label: 'All', params: {} },
  { key: 'to-send', label: 'To send', params: { fulfillment: 'pending' } },
  { key: 'sent', label: 'Sent', params: { fulfillment: 'sent' } },
  { key: 'open', label: 'Money due', params: { payment: 'open' } },
  { key: 'unpaid', label: 'COD', params: { payment: 'unpaid' } },
  { key: 'partial', label: 'Partial', params: { payment: 'partial' } },
  { key: 'paid', label: 'Paid', params: { payment: 'paid' } },
  { key: 'cancelled', label: 'Cancelled', params: { state: 'cancelled' } },
] as const;
const STATUS_KEYS = ['fulfillment', 'payment', 'state'];

/** Order date shortcuts; "custom" uses the From / To dates. */
function datePresets(today: string) {
  const monthStart = today.slice(0, 8) + '01';
  const [y, m] = today.split('-').map(Number);
  const sixMonths = new Date(Date.UTC(y, m - 1 - 5, 1)).toISOString().slice(0, 10);
  return [
    { key: 'today', label: 'Today', from: today, to: today },
    { key: 'yesterday', label: 'Yesterday', from: addDays(today, -1), to: addDays(today, -1) },
    { key: '7d', label: 'Last 7 days', from: addDays(today, -6), to: today },
    { key: 'month', label: 'This month', from: monthStart, to: today },
    { key: '6m', label: 'Last 6 months', from: sixMonths, to: today },
  ];
}

export function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function OrderRow({ o }: { o: OrderSummary }) {
  return (
    <Link to={`/orders/${o.id}`} className="list-item">
      <Thumb src={o.thumb} />
      <div className="grow">
        <div className="row between">
          <span className="strong ellipsis">{o.customer_name}</span>
          <span className="strong num nowrap">{npr(o.total)}</span>
        </div>
        <div className="small muted ellipsis">{o.items_summary}</div>
        <div className="tiny muted" style={{ marginTop: 2 }}>
          {o.invoice_no} · {shortDate(o.order_date)}
          {o.categories ? ` · ${o.categories.split(',').join(', ')}` : ''}
        </div>
        <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
          <PlatformBadge platform={o.platform} />
          <PaymentBadge status={o.payment_status} balance={o.balance_due} />
          <FulfillmentBadge status={o.fulfillment_status} state={o.state} />
        </div>
      </div>
    </Link>
  );
}

export function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const q = useDebounced(search.trim());
  const today = todayInBusinessTz();

  const statusKey =
    STATUS.find((s) => Object.entries(s.params).length && Object.entries(s.params).every(([k, v]) => params.get(k) === v))?.key ?? 'all';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const category = params.get('category') ?? '';
  const platform = params.get('platform') ?? '';

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  // Keep the typed search in the URL too, so Back returns to the same results.
  useEffect(() => {
    if ((params.get('q') ?? '') !== q) update({ q: q || null });
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const filterParams = {
    q,
    from,
    to,
    category,
    platform,
    ...Object.fromEntries(STATUS_KEYS.map((k) => [k, params.get(k) ?? ''])),
  };
  const PAGE = 40;
  const list = useInfiniteQuery({
    queryKey: ['orders', 'search', filterParams],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.get<OrderSearchResult>(`/api/orders${qs({ ...filterParams, limit: PAGE, offset: pageParam })}`),
    getNextPageParam: (last, pages) => (last.has_more ? pages.length * PAGE : undefined),
  });
  const orders = list.data?.pages.flatMap((p) => p.orders) ?? [];
  const summary = list.data?.pages[0]?.summary;

  const preset = datePresets(today).find((p) => p.from === from && p.to === to);
  const dateLabel = !from && !to ? '' : preset ? preset.label : from && to && from === to ? shortDate(from) : `${from ? shortDate(from) : '…'} – ${to ? shortDate(to) : '…'}`;
  const active = [
    dateLabel && { key: 'date', label: dateLabel, clear: () => update({ from: null, to: null }) },
    category && { key: 'category', label: category, clear: () => update({ category: null }) },
    platform && { key: 'platform', label: platformLabel(platform), clear: () => update({ platform: null }) },
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[];
  const anyFilter = active.length > 0 || !!q || statusKey !== 'all';

  return (
    <>
      <TopBar title="Orders" actions={<HeaderActions />} />
      <main className="page">
        <div className="stack" style={{ margin: '12px 0' }}>
          <div className="row" style={{ gap: 8 }}>
            <div className="search grow">
              <Icon name="search" size={20} />
              <input
                className="input"
                type="search"
                aria-label="Search orders"
                placeholder="Name, product, phone, invoice…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button type="button" className={`btn ${active.length ? 'primary' : ''}`} onClick={() => setFiltersOpen(true)} aria-label="Filter by date, product type or platform">
              <Icon name="filter" size={18} />
              {active.length ? active.length : 'Filters'}
            </button>
          </div>
          {active.length > 0 && (
            <div className="chips" aria-label="Active filters">
              {active.map((f) => (
                <button key={f.key} type="button" className="chip on" onClick={f.clear} aria-label={`Remove filter ${f.label}`}>
                  {f.label} ✕
                </button>
              ))}
            </div>
          )}
          <div className="chips">
            {STATUS.map((x) => (
              <button
                key={x.key}
                type="button"
                className={`chip ${statusKey === x.key ? 'on' : ''}`}
                onClick={() => update({ ...Object.fromEntries(STATUS_KEYS.map((k) => [k, null])), ...x.params })}
              >
                {x.label}
              </button>
            ))}
          </div>
          {summary && (
            <div className="row between small" aria-live="polite">
              <span className="muted">
                {summary.count} order{summary.count === 1 ? '' : 's'} · <span className="num">{npr(summary.total)}</span>
              </span>
              {anyFilter && (
                <button
                  type="button"
                  className="btn ghost sm"
                  style={{ minHeight: 28, padding: 0 }}
                  onClick={() => {
                    setSearch('');
                    setParams({}, { replace: true });
                  }}
                >
                  Clear all
                </button>
              )}
            </div>
          )}
        </div>
        {list.isLoading ? (
          <Spinner />
        ) : !orders.length ? (
          <Empty>
            {anyFilter ? 'No orders match this search.' : 'No orders here yet.'}
            {!anyFilter && (
              <div className="mt">
                <Link className="btn primary" to="/orders/new">
                  New order
                </Link>
              </div>
            )}
          </Empty>
        ) : (
          <>
            <div className="list">
              {orders.map((o) => (
                <OrderRow key={o.id} o={o} />
              ))}
            </div>
            {list.hasNextPage && (
              <button type="button" className="btn block mt" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                {list.isFetchingNextPage ? 'Loading…' : 'Show more orders'}
              </button>
            )}
          </>
        )}
      </main>
      {filtersOpen && (
        <FiltersSheet
          today={today}
          value={{ from, to, category, platform }}
          onApply={(v) => {
            update({ from: v.from || null, to: v.to || null, category: v.category || null, platform: v.platform || null });
            setFiltersOpen(false);
          }}
          onClose={() => setFiltersOpen(false)}
        />
      )}
    </>
  );
}

interface Filters {
  from: string;
  to: string;
  category: string;
  platform: string;
}

function FiltersSheet({ today, value, onApply, onClose }: { today: string; value: Filters; onApply: (f: Filters) => void; onClose: () => void }) {
  const [f, setF] = useState<Filters>(value);
  const catalog = useCatalog();
  const presets = datePresets(today);
  const presetKey = presets.find((p) => p.from === f.from && p.to === f.to)?.key ?? (f.from || f.to ? 'custom' : 'any');
  const [custom, setCustom] = useState(presetKey === 'custom');
  const categories = catalog.data?.categories.map((c) => c.name) ?? [];
  if (f.category && !categories.includes(f.category)) categories.push(f.category);

  return (
    <Sheet title="Filter orders" onClose={onClose}>
      <div className="stack">
        <section className="stack" style={{ gap: 8 }}>
          <h3>Order date</h3>
          <div className="chips" style={{ flexWrap: 'wrap' }}>
            <button type="button" className={`chip ${presetKey === 'any' && !custom ? 'on' : ''}`} onClick={() => (setCustom(false), setF({ ...f, from: '', to: '' }))}>
              Any date
            </button>
            {presets.map((p) => (
              <button key={p.key} type="button" className={`chip ${presetKey === p.key && !custom ? 'on' : ''}`} onClick={() => (setCustom(false), setF({ ...f, from: p.from, to: p.to }))}>
                {p.label}
              </button>
            ))}
            <button type="button" className={`chip ${custom ? 'on' : ''}`} onClick={() => setCustom(true)}>
              Pick dates
            </button>
          </div>
          {custom && (
            <div className="grid-2">
              <label className="field">
                From
                <input className="input" type="date" max={f.to || today} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
              </label>
              <label className="field">
                To
                <input className="input" type="date" min={f.from || undefined} max={today} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
              </label>
              <div className="tiny muted" style={{ gridColumn: '1 / -1' }}>
                For one day, pick the same date in both.
              </div>
            </div>
          )}
        </section>

        <section className="stack" style={{ gap: 8 }}>
          <h3>Product type</h3>
          <div className="chips" style={{ flexWrap: 'wrap' }}>
            <button type="button" className={`chip ${!f.category ? 'on' : ''}`} onClick={() => setF({ ...f, category: '' })}>
              All types
            </button>
            {categories.map((c) => (
              <button key={c} type="button" className={`chip ${f.category === c ? 'on' : ''}`} onClick={() => setF({ ...f, category: c })}>
                {c}
              </button>
            ))}
          </div>
        </section>

        <section className="stack" style={{ gap: 8 }}>
          <h3>Order came from</h3>
          <div className="chips" style={{ flexWrap: 'wrap' }}>
            <button type="button" className={`chip ${!f.platform ? 'on' : ''}`} onClick={() => setF({ ...f, platform: '' })}>
              All platforms
            </button>
            {PLATFORMS.map((p) => (
              <button key={p} type="button" className={`chip platform-${p} ${f.platform === p ? 'on' : ''}`} onClick={() => setF({ ...f, platform: p })}>
                <span className="platform-dot" aria-hidden="true" />
                {platformLabel(p)}
              </button>
            ))}
          </div>
        </section>

        <div className="btn-row">
          <button type="button" className="btn" onClick={() => (setCustom(false), setF({ from: '', to: '', category: '', platform: '' }))}>
            Reset
          </button>
          <button type="button" className="btn primary" onClick={() => onApply(f)}>
            Show orders
          </button>
        </div>
      </div>
    </Sheet>
  );
}
