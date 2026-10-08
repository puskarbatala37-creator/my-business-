import {
  money,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  platformLabel,
  PLATFORMS,
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
import { VoiceInput } from '../../components/VoiceInput';
import { MoneyInput, PaymentBadge, PhotoInput, Seg, Spinner, Stepper, TopBar, useToast } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { npr, shortDate } from '../../lib/format';
import type { Customer, HistoryRow, OrderDetail, OrderDraft } from '../../lib/types';

interface Line {
  key: string;
  id?: number; // existing order_items.id (edit mode)
  variant_id: number | null;
  candidates?: number[];
  heard?: string;
  size: string;
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
    items: o.items.map((i) => ({ key: newKey(), id: i.id, variant_id: i.variant_id, size: i.size, quantity: i.quantity, unit_price: i.unit_price, photo: i.photo, reserved: i.quantity })),
    delivery_charge: o.delivery_charge || '',
    discount: o.discount || '',
    delivery_due_date: o.delivery_due_date ?? '',
    prep_time_days: o.prep_time_days ?? '',
    tracking_number: o.tracking_number,
    notes: o.notes,
    payment: { status: o.payment_status, amount: '', method: o.payment_method ?? 'cash' },
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
  const [saving, setSaving] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(!editing);
  const [warnings, setWarnings] = useState<string[]>([]);

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
      setLine(lineKey, { variant_id: p.variant.id, candidates: undefined, photo: p.variant.photo, unit_price: form.items.find((l) => l.key === lineKey)?.unit_price || p.variant.price });
    } else {
      setForm((f) => ({
        ...f,
        items: [...f.items, { key: newKey(), variant_id: p.variant.id, size: sizes.length === 1 ? sizes[0] : '', quantity: 1, unit_price: p.variant.price, photo: p.variant.photo, reserved: 0 }],
      }));
    }
    setPicker(null);
  }

  async function applyVoice(text: string) {
    if (!text) return;
    setParsing(true);
    try {
      const d = await api.post<OrderDraft>('/api/voice/parse', { text });
      setForm((f) => {
        const next = { ...f, customer: { ...f.customer }, payment: { ...f.payment } };
        if (d.customer.phone) next.customer.phone = d.customer.phone;
        if (d.customer.name) next.customer.name = d.customer.name;
        if (d.customer.address) next.customer.address = d.customer.address;
        if (d.items.length) {
          next.items = [
            ...f.items,
            ...d.items.map((it) => {
              const v = it.variant_id ? index.get(it.variant_id) : undefined;
              return {
                key: newKey(),
                variant_id: it.variant_id,
                candidates: it.variant_id ? undefined : it.candidates,
                heard: it.heard,
                size: it.size,
                quantity: it.quantity,
                unit_price: it.unit_price ?? v?.variant.price ?? '',
                photo: v?.variant.photo ?? null,
                reserved: 0,
              } as Line;
            }),
          ];
        }
        if (d.platform) next.platform = d.platform;
        if (d.payment.status) next.payment.status = d.payment.status;
        if (d.payment.amount !== undefined) next.payment.amount = d.payment.amount;
        if (d.payment.method) next.payment.method = d.payment.method;
        if (d.delivery_due_date) next.delivery_due_date = d.delivery_due_date;
        if (d.prep_time_days !== undefined) next.prep_time_days = d.prep_time_days;
        if (d.delivery_charge !== undefined) next.delivery_charge = d.delivery_charge;
        return next;
      });
      setWarnings(d.warnings);
      toast(d.items.length ? `Filled ${d.items.length} item${d.items.length > 1 ? 's' : ''} – check and save` : 'Filled what I understood – check the form');
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setParsing(false);
    }
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
    if (!editing && form.payment.status === 'partial' && !(paidNow > 0 && paidNow < total)) return toast('Enter how much was paid (less than the total)', true);
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
      items: form.items.map((l) => ({ id: l.id ?? null, variant_id: l.variant_id, size: l.size, quantity: l.quantity, unit_price: Number(l.unit_price), photo: l.photo })),
    };
    try {
      const saved = editing
        ? await api.put<OrderDetail>(`/api/orders/${id}`, { ...body, version: form.version })
        : await api.post<OrderDetail>('/api/orders', { ...body, payment: { status: form.payment.status, amount: paidNow, method: form.payment.method } });
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
        actions={
          !editing && (
            <button className={`icon-btn ${voiceOpen ? '' : ''}`} aria-label="Voice entry" onClick={() => setVoiceOpen((v) => !v)}>
              <Icon name="mic" />
            </button>
          )
        }
      />
      <main className="page stack" style={{ paddingTop: 12, paddingBottom: 90 }}>
        {voiceOpen && <VoiceInput onText={applyVoice} busy={parsing} />}
        {warnings.length > 0 && (
          <div className="alert-banner warning">
            <div>
              {warnings.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>
          </div>
        )}

        {/* Where the order came from – required */}
        <section className="card stack" id="order-source" aria-labelledby="order-source-title">
          <div className="row between">
            <h2 id="order-source-title">Order came from</h2>
            {!form.platform && <span className="badge warn">Required</span>}
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
            Phone
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
            Name
            <input className="input" autoComplete="off" value={form.customer.name} onChange={(e) => setCustomer({ name: e.target.value })} />
          </label>
          <label className="field">
            Delivery address
            <input className="input" autoComplete="off" value={form.customer.address} onChange={(e) => setCustomer({ address: e.target.value })} />
          </label>
          <label className="field">
            Social media name (TikTok, Facebook, Instagram or WhatsApp)
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
                      <>
                        <div className="small muted">Heard: “{l.heard}”</div>
                        <button type="button" className="btn sm primary" style={{ marginTop: 4 }} onClick={() => setPicker({ lineKey: l.key, only: l.candidates?.length ? l.candidates : undefined })}>
                          Choose product &amp; colour
                        </button>
                      </>
                    )}
                    {v && (
                      <button type="button" className="btn ghost sm" style={{ padding: 0, minHeight: 28 }} onClick={() => setPicker({ lineKey: l.key })}>
                        Change
                      </button>
                    )}
                  </div>
                  <button type="button" className="icon-btn" aria-label="Remove item" onClick={() => setForm((f) => ({ ...f, items: f.items.filter((x) => x.key !== l.key) }))}>
                    <Icon name="trash" size={18} />
                  </button>
                </div>
                <div className="grid-3" style={{ alignItems: 'end' }}>
                  <label className="field">
                    Qty
                    <Stepper value={l.quantity} onChange={(n) => setLine(l.key, { quantity: n })} />
                  </label>
                  <label className="field">
                    Size
                    {sizes.length > 1 ? (
                      <select className="input" value={l.size} onChange={(e) => setLine(l.key, { size: e.target.value })}>
                        <option value="">–</option>
                        {sizes.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                        {l.size && !sizes.includes(l.size) && <option>{l.size}</option>}
                      </select>
                    ) : (
                      <input className="input" value={l.size} onChange={(e) => setLine(l.key, { size: e.target.value })} placeholder="Free" />
                    )}
                  </label>
                  <label className="field">
                    Price each
                    <MoneyInput value={l.unit_price} onChange={(n) => setLine(l.key, { unit_price: n })} />
                  </label>
                </div>
              </div>
            );
          })}
          <button type="button" className="btn block" onClick={() => setPicker({})}>
            <Icon name="plus" size={18} /> Add item
          </button>
        </section>

        {/* Delivery */}
        <section className="card stack">
          <h2>Delivery</h2>
          <div className="grid-2">
            <label className="field">
              Delivery due
              <input className="input" type="date" value={form.delivery_due_date} onChange={(e) => set('delivery_due_date', e.target.value)} />
            </label>
            <label className="field">
              Prep time (days)
              <input className="input" inputMode="numeric" value={form.prep_time_days} onChange={(e) => set('prep_time_days', e.target.value === '' ? '' : Number(e.target.value.replace(/\D/g, '')))} />
            </label>
            <label className="field">
              Delivery charge
              <MoneyInput value={form.delivery_charge} onChange={(n) => set('delivery_charge', n)} />
            </label>
            <label className="field">
              Discount
              <MoneyInput value={form.discount} onChange={(n) => set('discount', n)} />
            </label>
          </div>
          <label className="field">
            Tracking number
            <input className="input" autoCapitalize="characters" value={form.tracking_number} onChange={(e) => set('tracking_number', e.target.value)} />
          </label>
          <label className="field">
            Order date
            <input className="input" type="date" value={form.order_date} onChange={(e) => set('order_date', e.target.value)} />
          </label>
        </section>

        {/* Payment */}
        <section className="card stack">
          <h2>Payment</h2>
          {editing ? (
            <div className="small muted">
              <PaymentBadge status={existing.data!.payment_status} balance={existing.data!.balance_due} /> · Record payments from the order screen.
            </div>
          ) : (
            <>
              <Seg
                value={form.payment.status}
                onChange={(s) => set('payment', { ...form.payment, status: s })}
                options={[
                  { value: 'paid', label: 'Paid in full' },
                  { value: 'partial', label: 'Partial' },
                  { value: 'unpaid', label: 'COD' },
                ]}
              />
              {form.payment.status === 'partial' && (
                <label className="field">
                  Amount paid now
                  <MoneyInput value={form.payment.amount} onChange={(n) => set('payment', { ...form.payment, amount: n })} />
                </label>
              )}
              {form.payment.status !== 'unpaid' && (
                <div className="chips">
                  {PAYMENT_METHODS.map((m) => (
                    <button type="button" key={m} className={`chip ${form.payment.method === m ? 'on' : ''}`} onClick={() => set('payment', { ...form.payment, method: m })}>
                      {PAYMENT_METHOD_LABELS[m]}
                    </button>
                  ))}
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
            Notes / custom requests
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
