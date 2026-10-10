import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, todayInBusinessTz, type PaymentMethod } from '@slay/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CopySheet } from '../../components/CopySheet';
import { Icon } from '../../components/Icon';
import { FieldHead, MicButton } from '../../components/FieldVoice';
import { FulfillmentBadge, Loading, MoneyInput, PaymentBadge, PlatformBadge, Sheet, Spinner, Thumb, TopBar, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { dateTime, longDate, npr, relativeDue, shortDate } from '../../lib/format';
import { shareOrCopy } from '../../lib/share';
import type { OrderDetail, OrderItem } from '../../lib/types';
import { CancelSheet, RefundSheet, ReturnSheet } from './AfterSale';
import { PaymentStatusSheet } from './PaymentStatusSheet';

interface PayRequest {
  id: number;
  token: string;
  amount: number;
  status: string;
  created_at: string;
}

export function OrderDetailPage() {
  const { id } = useParams();
  const orderId = Number(id);
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['order', orderId], queryFn: () => api.get<OrderDetail>(`/api/orders/${orderId}`) });
  const requests = useQuery({ queryKey: ['order', orderId, 'pay-requests'], queryFn: () => api.get<{ requests: PayRequest[] }>(`/api/payments/orders/${orderId}/requests`) });
  const [sheet, setSheet] = useState<null | 'pay' | 'send' | 'cancel' | 'return' | 'refund' | 'status'>(null);
  const [manualCopy, setManualCopy] = useState<string | null>(null);

  const update = (o: OrderDetail) => {
    qc.setQueryData(['order', orderId], o);
    qc.invalidateQueries({ queryKey: ['orders'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const run = useMutation({
    mutationFn: (fn: () => Promise<OrderDetail>) => fn(),
    onSuccess: (o) => {
      update(o);
      qc.invalidateQueries({ queryKey: ['catalog'] }); // returns / cancellations can change stock
      setSheet(null);
    },
    onError: (e) => toast((e as Error).message, true),
  });

  const o = q.data;
  if (!o) return <Loading error={q.error} retry={q.refetch} what="order" />;
  const active = o.state === 'active';
  const today = todayInBusinessTz();
  const canReturn = active && o.items.some((i) => i.quantity - i.returned_qty > 0);

  async function esewaLink() {
    try {
      const r = await api.post<{ url: string; amount: number }>('/api/payments/requests', { order_id: orderId, provider: 'esewa' });
      requests.refetch();
      const message = `Hi ${o!.customer.name.split(' ')[0]}, please pay ${npr(r.amount)} for order ${o!.invoice_no} with eSewa:`;
      const res = await shareOrCopy('Pay with eSewa', message, r.url);
      if (res === 'copied') toast('Payment link copied – paste it in the chat');
      if (res === 'failed') setManualCopy(`${message}\n${r.url}`);
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
            {o.refund_due > 0 ? (
              <div className="stat">
                <div className="label">To give back</div>
                <div className="value" style={{ color: 'var(--warn)' }}>
                  {npr(o.refund_due)}
                </div>
              </div>
            ) : (
              <div className="stat">
                <div className="label">{o.payment_status === 'unpaid' ? 'Collect on delivery' : 'Still owed'}</div>
                <div className="value" style={{ color: o.balance_due > 0 ? 'var(--bad)' : undefined }}>
                  {npr(o.balance_due)}
                </div>
              </div>
            )}
          </div>
          {o.refunded > 0 && <div className="small muted">Refunded so far: {npr(o.refunded)}</div>}
          {o.refund_due > 0 && (
            <button className="btn block" onClick={() => setSheet('refund')}>
              <Icon name="wallet" size={18} /> Record refund · {npr(o.refund_due)}
            </button>
          )}
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
              <button className="btn" onClick={() => setSheet('status')}>
                <Icon name="edit" size={18} /> Payment status
              </button>
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
                    {i.size && ` · ${i.sizes ? 'Sizes' : 'Size'} ${i.size}`}
                  </div>
                  <div className="small muted num">
                    {i.quantity} × {npr(i.unit_price)}
                  </div>
                  <LineBadge item={i} />
                </div>
                <div className="right">
                  {i.returned_qty > 0 && <div className="tiny muted num" style={{ textDecoration: 'line-through' }}>{npr(i.quantity * i.unit_price)}</div>}
                  <div className="strong num">{npr((i.quantity - i.returned_qty) * i.unit_price)}</div>
                </div>
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

        {o.returns.length > 0 && (
          <section>
            <div className="section-title">
              <h2>Returns & exchanges</h2>
            </div>
            <div className="list">
              {o.returns.map((r) => (
                <div key={r.id} className="list-item">
                  <div className="grow">
                    <div className="strong small">
                      {r.kind === 'exchange' ? 'Exchange' : 'Return'} · {dateTime(r.created_at)}
                    </div>
                    <div className="small">
                      Back: {r.items.map((x) => `${x.product_name} (${x.color}) ×${x.quantity}${x.restocked ? (x.restocked === x.quantity ? ', back in stock' : `, ${x.restocked} back in stock`) : ', not restocked'}`).join('; ')}
                    </div>
                    {r.replacements.length > 0 && (
                      <div className="small">Instead: {r.replacements.map((x) => `${x.product_name} (${x.color}${x.size ? ` · ${x.size}` : ''}) ×${x.quantity}`).join('; ')}</div>
                    )}
                    {r.reason && <div className="small muted">“{r.reason}”</div>}
                    <div className="tiny muted">
                      {r.created_by_name ?? '—'}
                      {r.refunded > 0 && ` · refunded ${npr(r.refunded)}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

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
                      {p.kind === 'correction' ? `Correction −${npr(-p.amount)}` : p.amount < 0 ? `Refund −${npr(-p.amount)}` : npr(p.amount)}
                      {p.kind !== 'correction' && ` · ${PAYMENT_METHOD_LABELS[p.method] ?? p.method}`}
                    </div>
                    {p.note && (p.amount < 0 || p.note.startsWith('Payment status')) && <div className="small muted">{p.note}</div>}
                    <div className="tiny muted">
                      {dateTime(p.created_at)} · {p.created_by_name ?? (p.provider_ref ? `verified by eSewa (${p.provider_ref})` : 'system')}
                    </div>
                  </div>
                  {!p.provider_ref && (active || p.amount < 0) && (
                    <button
                      className="icon-btn"
                      aria-label={p.kind === 'correction' ? 'Remove correction' : p.amount < 0 ? 'Remove refund' : 'Remove payment'}
                      onClick={() =>
                        confirm(p.kind === 'correction' ? `Remove this correction? The ${npr(-p.amount)} counts as paid again.` : p.amount < 0 ? `Remove the ${npr(-p.amount)} refund? Only do this if it was recorded by mistake.` : `Remove the ${npr(p.amount)} payment?`) &&
                        run.mutate(() => api.del(`/api/orders/${orderId}/payments/${p.id}`))
                      }
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
        {/* Optional after-sale actions – only needed when a customer sends something back. */}
        {(canReturn || (o.amount_paid > 0 && o.refund_due === 0)) && (
          <div className="btn-row">
            {canReturn && (
              <button className="btn" onClick={() => setSheet('return')}>
                <Icon name="undo" size={18} /> Return / exchange
              </button>
            )}
            {o.amount_paid > 0 && o.refund_due === 0 && (
              <button className="btn" onClick={() => setSheet('refund')}>
                <Icon name="wallet" size={18} /> Refund
              </button>
            )}
          </div>
        )}
        <div className="tiny muted center">
          Added by {o.created_by_name ?? '—'} · {dateTime(o.created_at)}
        </div>
      </main>

      {sheet === 'pay' && <PaymentSheet balance={o.balance_due} onClose={() => setSheet(null)} onSave={(amount, method) => run.mutate(() => api.post(`/api/orders/${orderId}/payments`, { amount, method }))} />}
      {manualCopy && <CopySheet title="eSewa payment link" text={manualCopy} onClose={() => setManualCopy(null)} />}
      {sheet === 'send' && <SendSheet initial={o.tracking_number} onClose={() => setSheet(null)} onSave={(tracking) => run.mutate(() => api.patch(`/api/orders/${orderId}`, { fulfillment_status: 'sent', tracking_number: tracking }))} />}
      {sheet === 'cancel' && <CancelSheet order={o} saving={run.isPending} onClose={() => setSheet(null)} onSave={(b) => run.mutate(() => api.post(`/api/orders/${orderId}/cancel`, b))} />}
      {sheet === 'return' && (
        <ReturnSheet
          order={o}
          saving={run.isPending}
          onClose={() => setSheet(null)}
          onSave={(b) =>
            run.mutate(async () => {
              const res = await api.post<OrderDetail>(`/api/orders/${orderId}/returns`, b);
              toast(b.kind === 'exchange' ? 'Exchange saved' : 'Return saved');
              return res;
            })
          }
        />
      )}
      {sheet === 'status' && (
        <PaymentStatusSheet
          order={o}
          saving={run.isPending}
          onClose={() => setSheet(null)}
          onSave={(b) =>
            run.mutate(async () => {
              const res = await api.post<OrderDetail>(`/api/orders/${orderId}/payment-status`, b);
              toast('Payment status saved');
              return res;
            })
          }
        />
      )}
      {sheet === 'refund' && (
        <RefundSheet
          order={o}
          saving={run.isPending}
          onClose={() => setSheet(null)}
          onSave={(b) =>
            run.mutate(async () => {
              const res = await api.post<OrderDetail>(`/api/orders/${orderId}/refunds`, b);
              toast('Refund saved');
              return res;
            })
          }
        />
      )}
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
          <FieldHead text={`Amount received (owed: ${npr(balance)})`}>
            <MicButton label="Amount received" kind="money" onValue={setAmount} />
          </FieldHead>
          <MoneyInput value={amount} onChange={setAmount} autoFocus />
        </label>
        <div className="row" style={{ gap: 8 }}>
        <MicButton label="Payment method" kind="payment_method" onValue={setMethod} />
        <div className="chips grow">
          {PAYMENT_METHODS.map((m) => (
            <button key={m} className={`chip ${method === m ? 'on' : ''}`} onClick={() => setMethod(m)}>
              {PAYMENT_METHOD_LABELS[m]}
            </button>
          ))}
        </div>
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
          <FieldHead text="Delivery tracking number (optional)">
            <MicButton label="Tracking number" kind="tracking" onValue={setTracking} />
          </FieldHead>
          <input className="input" autoFocus autoCapitalize="characters" value={tracking} onChange={(e) => setTracking(e.target.value)} />
        </label>
        <button className="btn primary block" onClick={() => onSave(tracking)}>
          Mark as sent
        </button>
      </div>
    </Sheet>
  );
}

/** Shows when pieces of a line came back, or that it's an exchange replacement. */
function LineBadge({ item: i }: { item: OrderItem }) {
  if (i.return_id) return <span className="badge info">Exchange replacement</span>;
  if (!i.returned_qty) return null;
  const all = i.returned_qty === i.quantity;
  const word = i.status === 'exchanged' ? 'exchanged' : 'returned';
  return <span className="badge warn">{all ? word[0].toUpperCase() + word.slice(1) : `${i.returned_qty} of ${i.quantity} ${word}`}</span>;
}
