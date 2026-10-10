import {
  money,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  platformLabel,
  PLATFORMS,
  sizeSummary,
  todayInBusinessTz,
  type PaymentMethod,
  type PaymentStatus,
  type Platform,
} from '@slay/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { useVariantIndex, VariantPicker, type PickedVariant } from '../../components/VariantPicker';
import { FieldHead, MicButton } from '../../components/FieldVoice';
import { MoneyInput, PaymentBadge, PhotoInput, Seg, Spinner, Stepper, TopBar, useToast } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { npr, shortDate } from '../../lib/format';
import type { Customer, HistoryRow, OrderDetail } from '../../lib/types';

interface Line {
  key: string;
  id?: number; // existing order_items.id (edit mode)
  variant_id: number | null;
  size: string;
  /** A size for each piece (e.g. two kurtas, 42 and 41); null = every piece is `size`. */
  sizes: string[] | null;
  quantity: number;
  unit_price: number | '';
  photo: string | null;
  /** Units of this variant this line already holds (edit mode) – they count as available. */
  reserved: number;
}

interface FormState {
  customer: { id?: number | null; name: string; phone: string; address: string; social_handle: string };
  /** Required – '' until someone picks where the order came from. */
  platform: Platform | '';
  order_date: string;
  items: Line[];
  delivery_charge: number | '';
  discount: number | '';
  delivery_due_date: string;
  prep_time_days: number | '';
  tracking_number: string;
  notes: string;
  payment: { status: PaymentStatus; amount: number | ''; method: PaymentMethod };
  version?: number;
}

const newKey = () => Math.random().toString(36).slice(2);

function emptyForm(): FormState {
  return {
    customer: { name: '', phone: '', address: '', social_handle: '' },
    platform: '',
    order_date: todayInBusinessTz(),
    items: [],
    delivery_charge: '',
    discount: '',
    delivery_due_date: '',
    prep_time_days: '',
    tracking_number: '',
    notes: '',
    payment: { status: 'unpaid', amount: '', method: 'cash' },
  };
}

function fromOrder(o: OrderDetail): FormState {
  return {
    customer: { id: o.customer.id, name: o.customer.name, phone: o.customer.phone ?? '', address: o.customer.address, social_handle: o.customer.social_handle },
    // Older orders may hold a source that is no longer offered – ask again when editing.
    platform: (PLATFORMS as readonly string[]).includes(o.platform) ? (o.platform as Platform) : '',
    order_date: o.order_date,
    items: o.items.map((i) => ({ key: newKey(), id: i.id, variant_id: i.variant_id, size: i.sizes ? '' : i.size, sizes: i.sizes, quantity: i.quantity, unit_price: i.unit_price, photo: i.photo, reserved: i.quantity })),
    delivery_charge: o.delivery_charge || '',
    discount: o.discount || '',
    delivery_due_date: o.delivery_due_date ?? '',
    prep_time_days: o.prep_time_days ?? '',
    tracking_number: o.tracking_number,
    notes: o.notes,
    payment: { status: o.payment_status, amount: o.payment_status === 'partial' ? o.amount_paid : '', method: o.payment_method ?? 'cash' },
    version: o.version,
  };
}

export function OrderFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { index, isLoading: catalogLoading } = useVariantIndex();
  const existing = useQuery({ queryKey: ['order', Number(id)], queryFn: () => api.get<OrderDetail>(`/api/orders/${id}`), enabled: editing });

  const [form, setForm] = useState<FormState>(emptyForm);
  const [loaded, setLoaded] = useState(!editing);
  const [picker, setPicker] = useState<{ lineKey?: string; only?: number[] } | null>(null);
  /** Editing: the payment status is only changed when someone actually changes it here. */
  const [paymentTouched, setPaymentTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  // "New order for <customer>" from the customer screen.
  const location = useLocation();
  const presetCustomer = (location.state as { customerId?: number } | null)?.customerId;
  useEffect(() => {
    if (editing || !presetCustomer) return;
    api.get<{ customer: Customer }>(`/api/customers/${presetCustomer}`).then(({ customer: c }) =>
      setForm((f) => ({ ...f, customer: { id: c.id, name: c.name, phone: c.phone ?? '', address: c.address, social_handle: c.social_handle } })),
    );
  }, [editing, presetCustomer]);

  useEffect(() => {
    if (editing && existing.data && !loaded) {
      setForm(fromOrder(existing.data));
      setLoaded(true);
    }
  }, [editing, existing.data, loaded]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setCustomer = (patch: Partial<FormState['customer']>) => setForm((f) => ({ ...f, customer: { ...f.customer, ...patch } }));
  const setLine = (key: string, patch: Partial<Line>) => setForm((f) => ({ ...f, items: f.items.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  /** Changing the quantity keeps one size per piece: new pieces start with the last piece's size. */
  const setQuantity = (l: Line, quantity: number) => {
    if (!l.sizes) return setLine(l.key, { quantity });
    if (quantity < 2) return setLine(l.key, { quantity, sizes: null, size: l.sizes[0] ?? '' });
    const last = l.sizes[l.sizes.length - 1] ?? '';
    setLine(l.key, { quantity, sizes: Array.from({ length: quantity }, (_, i) => l.sizes![i] ?? last) });
  };

  // Returning customer lookup by phone → previous orders.
  const phoneDigits = form.customer.phone.replace(/\D/g, '').replace(/^977/, '');
  const lookup = useQuery({
    queryKey: ['customer-lookup', phoneDigits],
    queryFn: () => api.get<{ customer: Customer | null; orders: HistoryRow[] }>(`/api/customers/lookup?phone=${phoneDigits}`),
    enabled: phoneDigits.length >= 9,
  });
  useEffect(() => {
    const c = lookup.data?.customer;
    if (c && !form.customer.id) {
      setForm((f) => ({
        ...f,
        customer: { id: c.id, phone: f.customer.phone, name: f.customer.name || c.name, address: f.customer.address || c.address, social_handle: f.customer.social_handle || c.social_handle },
      }));
    }
  }, [lookup.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const subtotal = useMemo(() => money(form.items.reduce((s, l) => s + (Number(l.unit_price) || 0) * l.quantity, 0)), [form.items]);
  const total = Math.max(0, money(subtotal + (Number(form.delivery_charge) || 0) - (Number(form.discount) || 0)));
  const paidNow = form.payment.status === 'paid' ? total : form.payment.status === 'partial' ? Number(form.payment.amount) || 0 : 0;

  function addPicked(p: PickedVariant, lineKey?: string) {
    const sizes = p.product.sizes.split(',').map((s) => s.trim()).filter(Boolean);
    if (lineKey) {
      setLine(lineKey, { variant_id: p.variant.id, photo: p.variant.photo, unit_price: form.items.find((l) => l.key === lineKey)?.unit_price || p.variant.price });
    } else {
      setForm((f) => ({
        ...f,
        items: [...f.items, { key: newKey(), variant_id: p.variant.id, size: sizes.length === 1 ? sizes[0] : '', sizes: null, quantity: 1, unit_price: p.variant.price, photo: p.variant.photo, reserved: 0 }],
      }));
    }
    setPicker(null);
  }

  /** Voice picked a product (by its colour variant id) for a new or existing line. */
  function voiceProduct(variantId: number, lineKey?: string) {
    const p = index.get(variantId);
    if (p) addPicked(p, lineKey);
  }

  async function save() {
    if (!form.platform) {
      document.getElementById('order-source')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return toast('Choose where the order came from: TikTok, Facebook, Instagram or WhatsApp', true);
    }
    if (!form.customer.name.trim()) return toast('Add the customer name', true);
    if (!form.items.length) return toast('Add at least one item', true);
    if (form.items.some((l) => !l.variant_id)) return toast('Choose the colour for every item', true);
    if (form.items.some((l) => l.unit_price === '')) return toast('Enter a price for every item', true);
    if ((!editing || paymentTouched) && form.payment.status === 'partial' && !(paidNow > 0 && paidNow < total))
      return toast(editing ? 'Enter how much has been paid in total (less than the order total)' : 'Enter how much was paid (less than the total)', true);
    setSaving(true);
    const body = {
      customer: { ...form.customer, phone: form.customer.phone || null },
      platform: form.platform,
      order_date: form.order_date,
      delivery_charge: Number(form.delivery_charge) || 0,
      discount: Number(form.discount) || 0,
      delivery_due_date: form.delivery_due_date || null,
      prep_time_days: form.prep_time_days === '' ? null : Number(form.prep_time_days),
      tracking_number: form.tracking_number,
      notes: form.notes,
      payment_method: form.payment.status === 'unpaid' ? null : form.payment.method,
      items: form.items.map((l) => ({ id: l.id ?? null, variant_id: l.variant_id, size: l.size, sizes: l.sizes, quantity: l.quantity, unit_price: Number(l.unit_price), photo: l.photo })),
    };
    try {
      let saved = editing
        ? await api.put<OrderDetail>(`/api/orders/${id}`, { ...body, version: form.version })
        : await api.post<OrderDetail>('/api/orders', { ...body, payment: { status: form.payment.status, amount: paidNow, method: form.payment.method } });
      const paymentChanged =
        form.payment.status !== saved.payment_status || (form.payment.status === 'partial' && Number(form.payment.amount) !== saved.amount_paid);
      if (editing && paymentTouched && paymentChanged) {
        saved = await api.post<OrderDetail>(`/api/orders/${id}/payment-status`, {
          status: form.payment.status,
          amount: form.payment.status === 'partial' ? Number(form.payment.amount) : undefined,
          method: form.payment.method,
        });
      }
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['catalog'] });
      qc.setQueryData(['order', saved.id], saved);
      toast(editing ? 'Order updated' : `Saved ${saved.invoice_no}`);
      nav(`/orders/${saved.id}`, { replace: true });
    } catch (e) {
      const err = e as ApiError;
      toast(err.message, true);
      if (err.code === 'out_of_stock') qc.invalidateQueries({ queryKey: ['catalog'] });
      if (err.code === 'stale_version') {
        await existing.refetch();
        setLoaded(false);
      }
    } finally {
      setSaving(false);
    }
  }

  if (editing && (!loaded || catalogLoading)) return <Spinner />;
  const prevOrders = (lookup.data?.orders ?? []).filter((o) => o.id !== Number(id));

  return (
    <>
      <TopBar
        title={editing ? `Edit ${existing.data?.invoice_no ?? ''}` : 'New order'}
        back
      />
      <main className="page stack" style={{ paddingTop: 12, paddingBottom: 90 }}>
        <div className="voice-hint small muted">
          <Icon name="mic" size={16} /> Tap the mic next to any field and say just that – e.g. “October 10”, “42” or “black cotton kurta”.
        </div>

        {/* Where the order came from – required */}
        <section className="card stack" id="order-source" aria-labelledby="order-source-title">
          <div className="row between">
            <h2 id="order-source-title">Order came from</h2>
            <span className="row" style={{ gap: 8 }}>
              {!form.platform && <span className="badge warn">Required</span>}
              <MicButton label="Order source" kind="platform" onValue={(v) => set('platform', v)} />
            </span>
          </div>
          <div className="platform-picker" role="radiogroup" aria-labelledby="order-source-title">
            {PLATFORMS.map((p) => (
              <button
                type="button"
                key={p}
                role="radio"
                aria-checked={form.platform === p}
                className={`chip platform-${p} ${form.platform === p ? 'on' : ''}`}
                onClick={() => set('platform', p)}
              >
                <span className="platform-dot" aria-hidden="true" />
                {platformLabel(p)}
              </button>
            ))}
          </div>
        </section>

        {/* Customer */}
        <section className="card stack">
          <h2>Customer</h2>
          <label className="field">
            <FieldHead text="Phone">
              <MicButton label="Phone number" kind="phone" onValue={(v) => setCustomer({ phone: v, id: null })} />
            </FieldHead>
            <input className="input" type="tel" inputMode="tel" autoComplete="off" placeholder="98XXXXXXXX" value={form.customer.phone} onChange={(e) => setCustomer({ phone: e.target.value, id: null })} />
          </label>
          {lookup.data?.customer && (
            <div className="card tight" style={{ background: 'var(--surface-2)' }}>
              <div className="row between small">
                <span>
                  Returning customer · <strong>{prevOrders.length}</strong> previous order{prevOrders.length === 1 ? '' : 's'}
                </span>
                <Link to={`/customers/${lookup.data.customer.id}`} className="small">
                  History
                </Link>
              </div>
              {prevOrders.slice(0, 3).map((o) => (
                <div key={o.id} className="row between tiny muted" style={{ marginTop: 4 }}>
                  <span className="ellipsis grow">
                    {shortDate(o.order_date)} · {o.items_summary}
                  </span>
                  <span className="num">{npr(o.total)}</span>
                </div>
              ))}
            </div>
          )}
          <label className="field">
            <FieldHead text="Name">
              <MicButton label="Customer name" kind="name" onValue={(v) => setCustomer({ name: v })} />
            </FieldHead>
            <input className="input" autoComplete="off" value={form.customer.name} onChange={(e) => setCustomer({ name: e.target.value })} />
          </label>
          <label className="field">
            <FieldHead text="Delivery address">
              <MicButton label="Delivery address" kind="text" onValue={(v) => setCustomer({ address: v })} />
            </FieldHead>
            <input className="input" autoComplete="off" value={form.customer.address} onChange={(e) => setCustomer({ address: e.target.value })} />
          </label>
          <label className="field">
            <FieldHead text="Social media name (TikTok, Facebook, Instagram or WhatsApp)">
              <MicButton label="Social media name" kind="handle" onValue={(v) => setCustomer({ social_handle: v })} />
            </FieldHead>
            <input className="input" autoCapitalize="none" autoComplete="off" value={form.customer.social_handle} onChange={(e) => setCustomer({ social_handle: e.target.value })} />
          </label>
        </section>

        {/* Items */}
        <section className="card stack">
          <div className="row between">
            <h2>Items</h2>
            <span className="small muted num">{npr(subtotal)}</span>
          </div>
          {form.items.map((l) => {
            const v = l.variant_id ? index.get(l.variant_id) : undefined;
            const available = v ? v.variant.stock + l.reserved : 0;
            const sizes = v?.product.sizes.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
            return (
              <div key={l.key} className="card tight stack" style={{ gap: 10 }}>
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <PhotoInput value={l.photo} onChange={(p) => setLine(l.key, { photo: p })} width={64} height={64} label="Photo" />
                  <div className="grow">
                    {v ? (
                      <>
                        <div className="strong ellipsis">{v.product.name}</div>
                        <div className="small">
                          {v.variant.color}{' '}
                          <span className={available < l.quantity ? 'badge bad' : 'tiny muted'}>{available < l.quantity ? `only ${available} in stock` : `${available} available`}</span>
                        </div>
                      </>
                    ) : (
                      <button type="button" className="btn sm primary" style={{ marginTop: 4 }} onClick={() => setPicker({ lineKey: l.key })}>
                        Choose product &amp; colour
                      </button>
                    )}
                    <div className="row" style={{ gap: 6, marginTop: 2 }}>
                      {v && (
                        <button type="button" className="btn ghost sm" style={{ padding: 0, minHeight: 28 }} onClick={() => setPicker({ lineKey: l.key })}>
                          Change
                        </button>
                      )}
                      <MicButton
                        label="Product"
                        kind="product"
                        onValue={(id) => voiceProduct(id, l.key)}
                        onCandidates={(ids) => setPicker({ lineKey: l.key, only: ids })}
                      />
                    </div>
                  </div>
                  <button type="button" className="icon-btn" aria-label="Remove item" onClick={() => setForm((f) => ({ ...f, items: f.items.filter((x) => x.key !== l.key) }))}>
                    <Icon name="trash" size={18} />
                  </button>
                </div>
                <div className="grid-3" style={{ alignItems: 'end' }}>
                  <label className="field">
                    <FieldHead text="Qty">
                      <MicButton label="Quantity" kind="number" onValue={(n) => setQuantity(l, Math.max(1, Math.min(999, n)))} />
                    </FieldHead>
                    <Stepper value={l.quantity} onChange={(n) => setQuantity(l, n)} />
                  </label>
                  {l.sizes ? (
                    <div className="field-group">
                      <FieldHead text="Size" />
                      <div className="input" style={{ display: 'flex', alignItems: 'center', color: 'var(--text-2)', background: 'var(--surface-2)' }}>
                        {sizeSummary(l.sizes) || 'Each piece ↓'}
                      </div>
                    </div>
                  ) : (
                    <label className="field">
                      <FieldHead text="Size">
                        <MicButton label="Size" kind="size" options={sizes} onValue={(size) => setLine(l.key, { size })} />
                      </FieldHead>
                      <SizeInput sizes={sizes} value={l.size} onChange={(size) => setLine(l.key, { size })} />
                    </label>
                  )}
                  <label className="field">
                    <FieldHead text="Price each">
                      <MicButton label="Price" kind="money" onValue={(n) => setLine(l.key, { unit_price: n })} />
                    </FieldHead>
                    <MoneyInput value={l.unit_price} onChange={(n) => setLine(l.key, { unit_price: n })} />
                  </label>
                </div>
                {l.sizes && (
                  <div className="piece-sizes">
                    {l.sizes.map((s, i) => (
                      <label key={i} className="field">
                        <FieldHead text={`Piece ${i + 1}`}>
                          <MicButton
                            label={`Size of piece ${i + 1}`}
                            kind="size"
                            options={sizes}
                            onValue={(size) => setLine(l.key, { sizes: l.sizes!.map((x, j) => (j === i ? size : x)) })}
                          />
                        </FieldHead>
                        <SizeInput
                          sizes={sizes}
                          value={s}
                          onChange={(size) => setLine(l.key, { sizes: l.sizes!.map((x, j) => (j === i ? size : x)) })}
                        />
                      </label>
                    ))}
                  </div>
                )}
                {l.quantity > 1 && (
                  <button
                    type="button"
                    className="btn ghost sm"
                    style={{ alignSelf: 'flex-start', padding: 0, minHeight: 28, color: 'var(--accent)' }}
                    onClick={() =>
                      setLine(l.key, l.sizes ? { sizes: null, size: l.sizes[0] ?? '' } : { sizes: Array.from({ length: l.quantity }, () => l.size) })
                    }
                  >
                    {l.sizes ? 'Same size for every piece' : `Different size for each piece (${l.quantity} pieces)`}
                  </button>
                )}
              </div>
            );
          })}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn grow" onClick={() => setPicker({})}>
              <Icon name="plus" size={18} /> Add item
            </button>
            <MicButton label="Product to add" kind="product" onValue={(id) => voiceProduct(id)} onCandidates={(ids) => setPicker({ only: ids })} />
          </div>
        </section>

        {/* Delivery */}
        <section className="card stack">
          <h2>Delivery</h2>
          <div className="grid-2">
            <label className="field">
              <FieldHead text="Delivery due">
                <MicButton label="Delivery date" kind="date" prefer="future" onValue={(d) => set('delivery_due_date', d)} />
              </FieldHead>
              <input className="input" type="date" value={form.delivery_due_date} onChange={(e) => set('delivery_due_date', e.target.value)} />
            </label>
            <label className="field">
              <FieldHead text="Prep time (days)">
                <MicButton label="Prep time in days" kind="number" onValue={(n) => set('prep_time_days', n)} />
              </FieldHead>
              <input className="input" inputMode="numeric" value={form.prep_time_days} onChange={(e) => set('prep_time_days', e.target.value === '' ? '' : Number(e.target.value.replace(/\D/g, '')))} />
            </label>
            <label className="field">
              <FieldHead text="Delivery charge">
                <MicButton label="Delivery charge" kind="money" onValue={(n) => set('delivery_charge', n)} />
              </FieldHead>
              <MoneyInput value={form.delivery_charge} onChange={(n) => set('delivery_charge', n)} />
            </label>
            <label className="field">
              <FieldHead text="Discount">
                <MicButton label="Discount" kind="money" onValue={(n) => set('discount', n)} />
              </FieldHead>
              <MoneyInput value={form.discount} onChange={(n) => set('discount', n)} />
            </label>
          </div>
          <label className="field">
            <FieldHead text="Tracking number">
              <MicButton label="Tracking number" kind="tracking" onValue={(t) => set('tracking_number', t)} />
            </FieldHead>
            <input className="input" autoCapitalize="characters" value={form.tracking_number} onChange={(e) => set('tracking_number', e.target.value)} />
          </label>
          <label className="field">
            <FieldHead text="Order date">
              <MicButton label="Order date" kind="date" prefer="past" onValue={(d) => set('order_date', d)} />
            </FieldHead>
            <input className="input" type="date" value={form.order_date} onChange={(e) => set('order_date', e.target.value)} />
          </label>
        </section>

        {/* Payment */}
        <section className="card stack">
          <div className="section-head">
            <h2>Payment</h2>
            <MicButton label="Payment status" kind="payment_status" onValue={(st) => (setPaymentTouched(true), setForm((f) => ({ ...f, payment: { ...f.payment, status: st } })))} />
          </div>
          {editing && (
            <div className="small muted">
              Now: <PaymentBadge status={existing.data!.payment_status} balance={existing.data!.balance_due} /> · paid so far {npr(existing.data!.amount_paid)}. Change it
              below when the customer pays (e.g. COD → Paid in full).
            </div>
          )}
          {(
            <>
              <Seg
                value={form.payment.status}
                onChange={(s) => (setPaymentTouched(true), set('payment', { ...form.payment, status: s }))}
                options={[
                  { value: 'paid', label: 'Paid in full' },
                  { value: 'partial', label: 'Partial' },
                  { value: 'unpaid', label: 'COD' },
                ]}
              />
              {form.payment.status === 'partial' && (
                <label className="field">
                  <FieldHead text={editing ? 'Total paid so far' : 'Amount paid now'}>
                    <MicButton label="Amount paid" kind="money" onValue={(n) => (setPaymentTouched(true), setForm((f) => ({ ...f, payment: { ...f.payment, amount: n } })))} />
                  </FieldHead>
                  <MoneyInput value={form.payment.amount} onChange={(n) => (setPaymentTouched(true), set('payment', { ...form.payment, amount: n }))} />
                </label>
              )}
              {form.payment.status !== 'unpaid' && (
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <MicButton label="Payment method" kind="payment_method" onValue={(m) => (setPaymentTouched(true), setForm((f) => ({ ...f, payment: { ...f.payment, method: m } })))} />
                <div className="chips grow">
                  {PAYMENT_METHODS.map((m) => (
                    <button type="button" key={m} className={`chip ${form.payment.method === m ? 'on' : ''}`} onClick={() => (setPaymentTouched(true), set('payment', { ...form.payment, method: m }))}>
                      {PAYMENT_METHOD_LABELS[m]}
                    </button>
                  ))}
                </div>
                </div>
              )}
            </>
          )}
          <div className="totals">
            <span className="muted">Items</span>
            <span className="right">{npr(subtotal)}</span>
            {!!form.delivery_charge && (
              <>
                <span className="muted">Delivery</span>
                <span className="right">{npr(Number(form.delivery_charge))}</span>
              </>
            )}
            {!!form.discount && (
              <>
                <span className="muted">Discount</span>
                <span className="right">−{npr(Number(form.discount))}</span>
              </>
            )}
            <span className="big">Total</span>
            <span className="big right">{npr(total)}</span>
            {!editing && (
              <>
                <span className="muted">Paid now</span>
                <span className="right">{npr(paidNow)}</span>
                <span className="strong">Still to pay</span>
                <span className="strong right">{npr(Math.max(0, total - paidNow))}</span>
              </>
            )}
          </div>
        </section>

        <section className="card stack">
          <label className="field">
            <FieldHead text="Notes / custom requests">
              <MicButton label="Note" kind="text" onValue={(t) => setForm((f) => ({ ...f, notes: f.notes ? `${f.notes} ${t}` : t }))} />
            </FieldHead>
            <textarea className="input" value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="e.g. fall & pico, blouse stitching, gift wrap" />
          </label>
        </section>

        <div style={{ position: 'sticky', bottom: 'calc(var(--nav-h) + env(safe-area-inset-bottom) + 8px)' }}>
          <button className="btn primary block" onClick={save} disabled={saving} style={{ minHeight: 52, fontSize: 17 }}>
            {saving ? 'Saving…' : editing ? 'Save changes' : `Save order · ${npr(total)}`}
          </button>
        </div>
      </main>
      {picker && (
        <VariantPicker
          only={picker.only}
          title={picker.only ? 'Which one did you mean?' : 'Add item'}
          reserved={Object.fromEntries(form.items.filter((l) => l.variant_id && l.reserved).map((l) => [l.variant_id!, l.reserved]))}
          onPick={(p) => addPicked(p, picker.lineKey)}
          onClose={() => setPicker(null)}
        />
      )}
    </>
  );
}

/** A size: a dropdown of the product's sizes when it has several, otherwise free text. */
function SizeInput({ sizes, value, onChange }: { sizes: string[]; value: string; onChange: (size: string) => void }) {
  if (sizes.length > 1)
    return (
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">–</option>
        {sizes.map((s) => (
          <option key={s}>{s}</option>
        ))}
        {value && !sizes.includes(value) && <option>{value}</option>}
      </select>
    );
  return <input className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Free" />;
}
