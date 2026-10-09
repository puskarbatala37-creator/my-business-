import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, todayInBusinessTz, type PaymentMethod } from '@slay/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { FulfillmentBadge, MoneyInput, PaymentBadge, PlatformBadge, Sheet, Spinner, Thumb, TopBar, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { dateTime, longDate, npr, relativeDue, shortDate } from '../../lib/format';
import type { OrderDetail } from '../../lib/types';

interface PayRequest {
  id: number;
  token: string;
  amount: number;
  status: string;
  created_at: string;
}

export async function shareOrCopy(title: string, text: string, url?: string) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch {
      return 'cancelled';
    }
  }
  await navigator.clipboard.writeText(url ? `${text}\n${url}` : text);
  return 'copied';
}

export function OrderDetailPage() {
  const { id } = useParams();
  const orderId = Number(id);
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['order', orderId], queryFn: () => api.get<OrderDetail>(`/api/orders/${orderId}`) });
  const requests = useQuery({ queryKey: ['order', orderId, 'pay-requests'], queryFn: () => api.get<{ requests: PayRequest[] }>(`/api/payments/orders/${orderId}/requests`) });
  const [sheet, setSheet] = useState<null | 'pay' | 'send' | 'cancel'>(null);

  const update = (o: OrderDetail) => {
    qc.setQueryData(['order', orderId], o);
    qc.invalidateQueries({ queryKey: ['orders'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const run = useMutation({
    mutationFn: (fn: () => Promise<OrderDetail>) => fn(),
    onSuccess: (o) => {
      update(o);
      setSheet(null);
    },
    onError: (e) => toast((e as Error).message, true),
  });

  const o = q.data;
  if (!o) return <Spinner />;
  const active = o.state === 'active';
  const today = todayInBusinessTz();

  async function esewaLink() {
    try {
      const r = await api.post<{ url: string; amount: number }>('/api/payments/requests', { order_id: orderId, provider: 'esewa' });
      requests.refetch();
      const res = await shareOrCopy('Pay with eSewa', `Hi ${o!.customer.name.split(' ')[0]}, please pay ${npr(r.amount)} for order ${o!.invoice_no} with eSewa:`, r.url);
      if (res === 'copied') toast('Payment link copied – paste it in the chat');
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  return (
    <>
      <TopBar
        title={o.invoice_no}
        back="/orders"
        actions={
          active && (
            <button className="icon-btn" aria-label="Edit order" onClick={() => nav(`/orders/${orderId}/edit`)}>
              <Icon name="edit" />
            </button>
          )
        }
      />
      <main className="page stack" style={{ paddingTop: 12 }}>
        <section className="card stack">
          <div className="row between">
            <div>
              <div className="muted small">{longDate(o.order_date)}</div>
              <div className="strong" style={{ fontSize: 24 }}>
                {npr(o.total)}
              </div>
            </div>
            <div className="stack right" style={{ gap: 4, alignItems: 'flex-end' }}>
              <PlatformBadge platform={o.platform} />
              <PaymentBadge status={o.payment_status} />
              <FulfillmentBadge status={o.fulfillment_status} state={o.state} />
            </div>
          </div>
          <div className="grid-2">
            <div className="stat">
              <div className="label">Paid</div>
              <div className="value" style={{ color: 'var(--good)' }}>
                {npr(o.amount_paid)}
              </div>
            </div>
            <div className="stat">
              <div className="label">{o.payment_status === 'unpaid' ? 'Collect on delivery' : 'Still owed'}</div>
              <div className="value" style={{ color: o.balance_due > 0 ? 'var(--bad)' : undefined }}>
                {npr(o.balance_due)}
              </div>
            </div>
          </div>
          {(o.delivery_due_date || o.prep_time_days !== null) && (
            <div className="row wrap small">
              {o.delivery_due_date && (
                <span>
                  Delivery: <strong>{shortDate(o.delivery_due_date)}</strong>{' '}
                  {o.fulfillment_status === 'pending' && active && <span className={`badge ${o.delivery_due_date < today ? 'bad' : 'warn'}`}>{relativeDue(o.delivery_due_date, today)}</span>}
                </span>
              )}
              {o.prep_time_days !== null && (
                <span>
                  Prep: <strong>{o.prep_time_days} day{o.prep_time_days === 1 ? '' : 's'}</strong>
                </span>
              )}
            </div>
          )}
          {o.tracking_number && (
            <div className="small">
              Tracking: <strong className="num selectable">{o.tracking_number}</strong>
            </div>
          )}
          {active && (
            <div className="btn-row">
              {o.fulfillment_status === 'pending' ? (
                <button className="btn primary" onClick={() => setSheet('send')}>
                  <Icon name="send" size={18} /> Mark sent
                </button>
              ) : (
                <button className="btn" onClick={() => run.mutate(() => api.patch(`/api/orders/${orderId}`, { fulfillment_status: 'pending' }))}>
                  Back to pending
                </button>
              )}
              {o.balance_due > 0 && (
                <button className="btn" onClick={() => setSheet('pay')}>
                  <Icon name="wallet" size={18} /> Payment
                </button>
              )}
            </div>
          )}
          {active && o.balance_due > 0 && (
            <button className="btn block" onClick={esewaLink} style={{ borderColor: '#60bb46', color: '#3d8f2a' }}>
              Send eSewa payment link · {npr(o.balance_due)}
            </button>
          )}
          {requests.data?.requests.filter((r) => r.status === 'pending').map((r) => (
            <div key={r.id} className="row between small muted">
              <span>
                eSewa link for {npr(r.amount)} sent {dateTime(r.created_at)} – waiting
              </span>
              <button
                className="btn sm"
                onClick={async () => {
                  try {
                    await api.post(`/api/payments/requests/${r.token}/check`);
                    requests.refetch();
                    q.refetch();
                  } catch (e) {
                    toast((e as Error).message, true);
                  }
                }}
              >
                Check
              </button>
            </div>
          ))}
        </section>

        <section className="card stack">
          <div className="row between">
            <h2>{o.customer.name}</h2>
            <Link to={`/customers/${o.customer.id}`} className="small">
              Profile
            </Link>
          </div>
          {o.customer.phone && (
            <a href={`tel:${o.customer.phone}`} className="row small" style={{ color: 'inherit' }}>
              <Icon name="phone" size={16} /> {o.customer.phone}
            </a>
          )}
          {o.customer.address && <div className="small selectable">{o.customer.address}</div>}
          {o.customer.social_handle && <div className="small muted">@{o.customer.social_handle.replace(/^@/, '')}</div>}
        </section>

        <section>
          <div className="section-title">
            <h2>Items</h2>
          </div>
          <div className="list">
            {o.items.map((i) => (
              <div key={i.id} className="list-item">
                <Thumb src={i.photo} size="lg" />
                <div className="grow">
                  <div className="strong">{i.product_name}</div>
                  <div className="small">
                    {i.color}
                    {i.size && ` · Size ${i.size}`}
                  </div>
                  <div className="small muted num">
                    {i.quantity} × {npr(i.unit_price)}
                  </div>
                </div>
                <div className="strong num">{npr(i.quantity * i.unit_price)}</div>
              </div>
            ))}
          </div>
          <div className="card mt totals">
            <span className="muted">Items</span>
            <span className="right">{npr(o.subtotal)}</span>
            {o.delivery_charge > 0 && (
              <>
                <span className="muted">Delivery</span>
                <span className="right">{npr(o.delivery_charge)}</span>
              </>
            )}
            {o.discount > 0 && (
              <>
                <span className="muted">Discount</span>
                <span className="right">−{npr(o.discount)}</span>
              </>
            )}
            <span className="big">Total</span>
            <span className="big right">{npr(o.total)}</span>
          </div>
        </section>

        {o.notes && (
          <section className="card">
            <h3>Notes</h3>
            <div className="small" style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>
              {o.notes}
            </div>
          </section>
        )}

        {o.payments.length > 0 && (
          <section>
            <div className="section-title">
              <h2>Payments</h2>
            </div>
            <div className="list">
              {o.payments.map((p) => (
                <div key={p.id} className="list-item">
                  <div className="grow">
                    <div className="strong">
                      {npr(p.amount)} · {PAYMENT_METHOD_LABELS[p.method] ?? p.method}
                    </div>
                    <div className="tiny muted">
                      {dateTime(p.created_at)} · {p.created_by_name ?? (p.provider_ref ? `verified by eSewa (${p.provider_ref})` : 'system')}
                    </div>
                  </div>
                  {!p.provider_ref && active && (
                    <button
                      className="icon-btn"
                      aria-label="Remove payment"
                      onClick={() => confirm(`Remove the ${npr(p.amount)} payment?`) && run.mutate(() => api.del(`/api/orders/${orderId}/payments/${p.id}`))}
                    >
                      <Icon name="trash" size={18} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {o.customer_history.length > 0 && (
          <section>
            <div className="section-title">
              <h2>Previous orders by {o.customer.name.split(' ')[0]}</h2>
            </div>
            <div className="list">
              {o.customer_history.slice(0, 5).map((h) => (
                <Link key={h.id} to={`/orders/${h.id}`} className="list-item">
                  <div className="grow">
                    <div className="small strong">
                      {h.invoice_no} · {shortDate(h.order_date)}
                    </div>
                    <div className="tiny muted ellipsis">{h.items_summary}</div>
                  </div>
                  <span className="num small">{npr(h.total)}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <div className="btn-row">
          <Link className="btn" to={`/orders/${orderId}/invoice`}>
            <Icon name="print" size={18} /> Invoice
          </Link>
          {active && (
            <button className="btn danger" onClick={() => setSheet('cancel')}>
              Cancel order
            </button>
          )}
        </div>
        <div className="tiny muted center">
          Added by {o.created_by_name ?? '—'} · {dateTime(o.created_at)}
        </div>
      </main>

      {sheet === 'pay' && <PaymentSheet balance={o.balance_due} onClose={() => setSheet(null)} onSave={(amount, method) => run.mutate(() => api.post(`/api/orders/${orderId}/payments`, { amount, method }))} />}
      {sheet === 'send' && <SendSheet initial={o.tracking_number} onClose={() => setSheet(null)} onSave={(tracking) => run.mutate(() => api.patch(`/api/orders/${orderId}`, { fulfillment_status: 'sent', tracking_number: tracking }))} />}
      {sheet === 'cancel' && <CancelSheet onClose={() => setSheet(null)} onSave={(reason) => run.mutate(() => api.post(`/api/orders/${orderId}/cancel`, { reason }))} />}
    </>
  );
}

function PaymentSheet({ balance, onClose, onSave }: { balance: number; onClose: () => void; onSave: (amount: number, method: PaymentMethod) => void }) {
  const [amount, setAmount] = useState<number | ''>(balance);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  return (
    <Sheet title="Record payment" onClose={onClose}>
      <div className="stack">
        <label className="field">
          Amount received (owed: {npr(balance)})
          <MoneyInput value={amount} onChange={setAmount} autoFocus />
        </label>
        <div className="chips">
          {PAYMENT_METHODS.map((m) => (
            <button key={m} className={`chip ${method === m ? 'on' : ''}`} onClick={() => setMethod(m)}>
              {PAYMENT_METHOD_LABELS[m]}
            </button>
          ))}
        </div>
        <button className="btn primary block" disabled={!amount} onClick={() => onSave(Number(amount), method)}>
          Save payment
        </button>
      </div>
    </Sheet>
  );
}

function SendSheet({ initial, onClose, onSave }: { initial: string; onClose: () => void; onSave: (tracking: string) => void }) {
  const [tracking, setTracking] = useState(initial);
  return (
    <Sheet title="Mark as sent" onClose={onClose}>
      <div className="stack">
        <label className="field">
          Delivery tracking number (optional)
          <input className="input" autoFocus autoCapitalize="characters" value={tracking} onChange={(e) => setTracking(e.target.value)} />
        </label>
        <button className="btn primary block" onClick={() => onSave(tracking)}>
          Mark as sent
        </button>
      </div>
    </Sheet>
  );
}

function CancelSheet({ onClose, onSave }: { onClose: () => void; onSave: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Sheet title="Cancel order?" onClose={onClose}>
      <div className="stack">
        <div className="small muted">The items go back into stock. This cannot be undone.</div>
        <label className="field">
          Reason
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button className="btn primary block" style={{ background: 'var(--bad)', borderColor: 'var(--bad)' }} onClick={() => onSave(reason)}>
          Cancel order
        </button>
      </div>
    </Sheet>
  );
}
