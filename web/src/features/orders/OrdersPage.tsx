import { PLATFORM_LABELS } from '@slay/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { HeaderActions } from '../../components/Layout';
import { Empty, FulfillmentBadge, PaymentBadge, Spinner, Thumb, TopBar } from '../../components/ui';
import { api, qs } from '../../lib/api';
import { npr, shortDate } from '../../lib/format';
import type { OrderSummary } from '../../lib/types';

const FILTERS = [
  { key: 'all', label: 'All', params: {} },
  { key: 'to-send', label: 'To send', params: { fulfillment: 'pending' } },
  { key: 'sent', label: 'Sent', params: { fulfillment: 'sent' } },
  { key: 'open', label: 'Money due', params: { payment: 'open' } },
  { key: 'unpaid', label: 'COD', params: { payment: 'unpaid' } },
  { key: 'partial', label: 'Partial', params: { payment: 'partial' } },
  { key: 'paid', label: 'Paid', params: { payment: 'paid' } },
  { key: 'cancelled', label: 'Cancelled', params: { state: 'cancelled' } },
] as const;

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
          {o.invoice_no} · {shortDate(o.order_date)} · {PLATFORM_LABELS[o.platform]}
        </div>
        <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
          <PaymentBadge status={o.payment_status} balance={o.balance_due} />
          <FulfillmentBadge status={o.fulfillment_status} state={o.state} />
        </div>
      </div>
    </Link>
  );
}

export function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const initial =
    FILTERS.find((f) => Object.entries(f.params).length && Object.entries(f.params).every(([k, v]) => params.get(k) === v))?.key ?? 'all';
  const [filter, setFilter] = useState<string>(initial);
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebounced(search);
  const f = FILTERS.find((x) => x.key === filter)!;

  const list = useQuery({
    queryKey: ['orders', filter, q],
    queryFn: () => api.get<{ orders: OrderSummary[] }>(`/api/orders${qs({ ...f.params, q, limit: 100 })}`),
  });

  return (
    <>
      <TopBar title="Orders" actions={<HeaderActions />} />
      <main className="page">
        <div className="stack" style={{ margin: '12px 0' }}>
          <div className="search">
            <Icon name="search" size={20} />
            <input className="input" type="search" placeholder="Name, phone, invoice or tracking no." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="chips">
            {FILTERS.map((x) => (
              <button
                key={x.key}
                className={`chip ${filter === x.key ? 'on' : ''}`}
                onClick={() => {
                  setFilter(x.key);
                  setParams(x.params as Record<string, string>, { replace: true });
                }}
              >
                {x.label}
              </button>
            ))}
          </div>
        </div>
        {list.isLoading ? (
          <Spinner />
        ) : !list.data?.orders.length ? (
          <Empty>
            No orders here yet.
            <div className="mt">
              <Link className="btn primary" to="/orders/new">
                New order
              </Link>
            </div>
          </Empty>
        ) : (
          <div className="list">
            {list.data.orders.map((o) => (
              <OrderRow key={o.id} o={o} />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
