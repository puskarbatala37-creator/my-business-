import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Empty, FulfillmentBadge, PaymentBadge, PlatformBadge, Sheet, Spinner, TopBar, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { npr, shortDate } from '../../lib/format';
import type { Customer, HistoryRow } from '../../lib/types';
import { useDebounced } from '../orders/OrdersPage';

export function CustomersPage() {
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const list = useQuery({ queryKey: ['customers', q], queryFn: () => api.get<{ customers: Customer[] }>(`/api/customers?q=${encodeURIComponent(q)}`) });
  return (
    <>
      <TopBar title="Customers" back="/more" />
      <main className="page">
        <div className="search" style={{ margin: '12px 0' }}>
          <Icon name="search" size={20} />
          <input className="input" type="search" placeholder="Name, phone or social handle" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {list.isLoading ? (
          <Spinner />
        ) : !list.data?.customers.length ? (
          <Empty>No customers found. They are added automatically with orders.</Empty>
        ) : (
          <div className="list">
            {list.data.customers.map((c) => (
              <Link key={c.id} to={`/customers/${c.id}`} className="list-item">
                <div className="grow">
                  <div className="strong">{c.name}</div>
                  <div className="small muted">
                    {c.phone || c.social_handle || '—'} · {c.order_count} order{c.order_count === 1 ? '' : 's'}
                    {c.last_order_date && ` · last ${shortDate(c.last_order_date)}`}
                  </div>
                </div>
                <div className="right">
                  <div className="num small">{npr(c.total_spent ?? 0)}</div>
                  {!!c.balance_due && c.balance_due > 0 && <div className="badge bad">{npr(c.balance_due)} due</div>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

export function CustomerPage() {
  const { id } = useParams();
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: ['customer', Number(id)], queryFn: () => api.get<{ customer: Customer; orders: (HistoryRow & { balance_due?: number })[] }>(`/api/customers/${id}`) });
  if (!q.data) return <Spinner />;
  const { customer: c, orders } = q.data;
  const active = orders.filter((o) => o.state === 'active');
  const spent = active.reduce((s, o) => s + o.total, 0);
  const due = active.reduce((s, o) => s + Math.max(0, o.total - o.amount_paid), 0);
  return (
    <>
      <TopBar
        title={c.name}
        back
        actions={
          <button className="icon-btn" aria-label="Edit customer" onClick={() => setEditing(true)}>
            <Icon name="edit" />
          </button>
        }
      />
      <main className="page stack" style={{ paddingTop: 12 }}>
        <section className="card stack" style={{ gap: 6 }}>
          {c.phone && (
            <a href={`tel:${c.phone}`} className="row" style={{ color: 'inherit' }}>
              <Icon name="phone" size={16} /> {c.phone}
            </a>
          )}
          {c.address && <div className="small">{c.address}</div>}
          {c.social_handle && <div className="small muted">@{c.social_handle.replace(/^@/, '')}</div>}
          {c.notes && <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{c.notes}</div>}
        </section>
        <div className="stats">
          <div className="stat">
            <div className="label">Orders</div>
            <div className="value">{active.length}</div>
          </div>
          <div className="stat">
            <div className="label">Spent</div>
            <div className="value">{npr(spent)}</div>
          </div>
          <div className="stat">
            <div className="label">Owes</div>
            <div className="value" style={{ color: due > 0 ? 'var(--bad)' : undefined }}>
              {npr(due)}
            </div>
          </div>
        </div>
        <Link to="/orders/new" state={{ customerId: c.id }} className="btn primary block">
          New order for {c.name.split(' ')[0]}
        </Link>
        <div className="section-title">
          <h2>Order history</h2>
        </div>
        <div className="list">
          {orders.map((o) => (
            <Link key={o.id} to={`/orders/${o.id}`} className="list-item">
              <div className="grow">
                <div className="row between">
                  <span className="strong small">
                    {o.invoice_no} · {shortDate(o.order_date)}
                  </span>
                  <span className="num strong">{npr(o.total)}</span>
                </div>
                <div className="small muted ellipsis">{o.items_summary}</div>
                <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
                  <PlatformBadge platform={o.platform} />
                  <PaymentBadge status={o.payment_status} balance={o.total - o.amount_paid} />
                  <FulfillmentBadge status={o.fulfillment_status} state={o.state} />
                </div>
              </div>
            </Link>
          ))}
          {!orders.length && <Empty>No orders yet.</Empty>}
        </div>
      </main>
      {editing && <EditCustomer c={c} onClose={() => setEditing(false)} />}
    </>
  );
}

function EditCustomer({ c, onClose }: { c: Customer; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ name: c.name, phone: c.phone ?? '', address: c.address, social_handle: c.social_handle, notes: c.notes });
  const field = (k: keyof typeof f, label: string, type = 'text') => (
    <label className="field">
      {label}
      {k === 'notes' ? (
        <textarea className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      ) : (
        <input className="input" type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      )}
    </label>
  );
  return (
    <Sheet title="Edit customer" onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.patch(`/api/customers/${c.id}`, { ...f, phone: f.phone || null });
            qc.invalidateQueries({ queryKey: ['customer'] });
            qc.invalidateQueries({ queryKey: ['customers'] });
            onClose();
          } catch (err) {
            toast((err as Error).message, true);
          }
        }}
      >
        {field('name', 'Name')}
        {field('phone', 'Phone', 'tel')}
        {field('address', 'Address')}
        {field('social_handle', 'Social handle')}
        {field('notes', 'Notes (sizes, preferences…)')}
        <button className="btn primary block">Save</button>
      </form>
    </Sheet>
  );
}
