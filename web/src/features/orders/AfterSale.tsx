import { money, PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type PaymentMethod, type ReturnKind } from '@slay/shared';
import { useState } from 'react';
import { FieldHead, MicButton } from '../../components/FieldVoice';
import { Icon } from '../../components/Icon';
import { MoneyInput, Seg, Sheet, Stepper, Thumb, Toggle } from '../../components/ui';
import { useVariantIndex, VariantPicker, type PickedVariant } from '../../components/VariantPicker';
import { npr } from '../../lib/format';
import type { OrderDetail, OrderItem } from '../../lib/types';

/**
 * Optional after-sale actions on an order: return pieces, exchange them for something else,
 * give money back, or cancel. Nothing here is part of taking an order – it's only used when needed.
 */

export interface RefundBody {
  amount: number;
  method: PaymentMethod;
  note?: string;
}

export interface ReturnBody {
  kind: ReturnKind;
  reason: string;
  lines: { item_id: number; quantity: number; restock: boolean }[];
  replacements: { variant_id: number; quantity: number; size: string; unit_price: number; photo: string | null }[];
  refund: RefundBody | null;
  version: number;
}

const piecesLeft = (i: OrderItem) => i.quantity - i.returned_qty;

function MethodChips({ value, onChange, label = 'How the money was given back' }: { value: PaymentMethod; onChange: (m: PaymentMethod) => void; label?: string }) {
  return (
    <div className="field-group">
      <FieldHead text={label}>
        <MicButton label="Refund method" kind="payment_method" onValue={onChange} />
      </FieldHead>
      <div className="chips" role="radiogroup" aria-label={label}>
        {PAYMENT_METHODS.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={value === m} className={`chip ${value === m ? 'on' : ''}`} onClick={() => onChange(m)}>
            {PAYMENT_METHOD_LABELS[m]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Refund fields: shown inside the return and cancel sheets when money is owed back. */
function RefundFields({
  owed,
  max,
  on,
  setOn,
  amount,
  setAmount,
  method,
  setMethod,
}: {
  owed: number;
  max: number;
  on: boolean;
  setOn: (b: boolean) => void;
  amount: number | '';
  setAmount: (n: number | '') => void;
  method: PaymentMethod;
  setMethod: (m: PaymentMethod) => void;
}) {
  return (
    <div className="card stack" style={{ background: 'var(--surface-2)' }}>
      <Toggle
        label="Give money back now"
        sub={on ? `Up to ${npr(max)} can be refunded.` : 'You can record the refund later from the order.'}
        on={on}
        onChange={(v) => {
          setOn(v);
          if (v && !amount) setAmount(owed);
        }}
      />
      {on && (
        <>
          <label className="field">
            <FieldHead text="Amount given back">
              <MicButton label="Amount given back" kind="money" onValue={setAmount} />
            </FieldHead>
            <MoneyInput value={amount} onChange={setAmount} />
          </label>
          <MethodChips value={method} onChange={setMethod} />
        </>
      )}
    </div>
  );
}

function refundError(on: boolean, amount: number | '', max: number) {
  if (!on) return null;
  if (!(Number(amount) > 0)) return 'Enter how much was given back, or turn off “Give money back now”.';
  if (Number(amount) > max) return `You can refund at most ${npr(max)} – that’s all that has been paid.`;
  return null;
}

// ── Return / exchange ──

interface Replacement {
  key: string;
  picked: PickedVariant;
  quantity: number;
  size: string;
  unit_price: number | '';
}

export function ReturnSheet({ order, onClose, onSave, saving }: { order: OrderDetail; onClose: () => void; onSave: (b: ReturnBody) => void; saving: boolean }) {
  const { index } = useVariantIndex();
  const returnable = (i: OrderItem) => !!(i.variant_id && index.get(i.variant_id)?.product.returnable);
  const lines = order.items.filter((i) => piecesLeft(i) > 0);
  const [kind, setKind] = useState<ReturnKind>('return');
  const [qty, setQty] = useState<Record<number, number>>(() => (lines.length === 1 && lines[0].quantity === 1 ? { [lines[0].id]: 1 } : {}));
  const [restock, setRestock] = useState<Record<number, boolean>>({});
  const [reason, setReason] = useState('');
  const [replacements, setReplacements] = useState<Replacement[]>([]);
  const [picking, setPicking] = useState<number[] | true | null>(null);
  const [refundOn, setRefundOn] = useState(false);
  const [refundAmount, setRefundAmount] = useState<number | ''>('');
  const [method, setMethod] = useState<PaymentMethod>(order.payment_method || 'cash');
  const [error, setError] = useState<string | null>(null);

  const restockOf = (i: OrderItem) => restock[i.id] ?? returnable(i);
  const removed = money(lines.reduce((n, i) => n + (qty[i.id] ?? 0) * i.unit_price, 0));
  const added = kind === 'exchange' ? money(replacements.reduce((n, r) => n + r.quantity * (Number(r.unit_price) || 0), 0)) : 0;
  const newTotal = Math.max(0, money(order.total - removed + added));
  const owedBack = Math.max(0, money(order.amount_paid - newTotal));
  const owedMore = Math.max(0, money(newTotal - order.amount_paid));
  const pieces = Object.values(qty).reduce((n, q) => n + q, 0);

  const setRepl = (key: string, patch: Partial<Replacement>) => setReplacements((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  function addReplacement(p: PickedVariant) {
    const sizes = p.product.sizes.split(',').map((s) => s.trim()).filter(Boolean);
    // Same product in another size is the most common exchange: start from the returned line's size options.
    setReplacements((rs) => [...rs, { key: `${Date.now()}-${rs.length}`, picked: p, quantity: 1, size: sizes.length === 1 ? sizes[0] : '', unit_price: p.variant.price }]);
    setPicking(null);
  }

  function save() {
    const chosen = lines.filter((i) => (qty[i.id] ?? 0) > 0);
    if (!chosen.length) return setError('Choose how many pieces came back.');
    if (kind === 'exchange' && !replacements.length) return setError('Add what the customer gets instead.');
    if (kind === 'exchange' && replacements.some((r) => r.unit_price === '')) return setError('Enter a price for each replacement (0 if it’s free).');
    const refundErr = refundError(refundOn && owedBack > 0, refundAmount, order.amount_paid);
    if (refundErr) return setError(refundErr);
    setError(null);
    onSave({
      kind,
      reason: reason.trim(),
      lines: chosen.map((i) => ({ item_id: i.id, quantity: qty[i.id], restock: restockOf(i) })),
      replacements:
        kind === 'exchange'
          ? replacements.map((r) => ({ variant_id: r.picked.variant.id, quantity: r.quantity, size: r.size, unit_price: Number(r.unit_price) || 0, photo: r.picked.variant.photo }))
          : [],
      refund: refundOn && owedBack > 0 ? { amount: Number(refundAmount), method } : null,
      version: order.version,
    });
  }

  return (
    <>
      <Sheet title="Return or exchange" onClose={onClose}>
        <div className="stack">
          <Seg
            value={kind}
            onChange={setKind}
            options={[
              { value: 'return', label: 'Return' },
              { value: 'exchange', label: 'Exchange' },
            ]}
          />
          <div className="small muted">
            {kind === 'return' ? 'The customer sends pieces back.' : 'The customer sends pieces back and gets something else instead (another size, colour or product).'}
          </div>

          <div className="field-group">
            <span>Which pieces came back?</span>
            <div className="list">
              {lines.map((i) => {
                const q = qty[i.id] ?? 0;
                const can = returnable(i);
                return (
                  <div key={i.id} className="list-item" style={{ flexWrap: 'wrap' }}>
                    <Thumb src={i.photo} />
                    <div className="grow">
                      <div className="strong small">{i.product_name}</div>
                      <div className="tiny muted">
                        {i.color}
                        {i.size && ` · ${i.size}`} · {npr(i.unit_price)} each
                        {i.returned_qty > 0 && ` · ${i.returned_qty} already returned`}
                      </div>
                    </div>
                    <div aria-label={`Pieces of ${i.product_name} ${i.color} returned`} role="group">
                      <Stepper value={q} min={0} max={piecesLeft(i)} onChange={(n) => setQty((m) => ({ ...m, [i.id]: n }))} />
                    </div>
                    {q > 0 && (
                      <div style={{ flexBasis: '100%' }}>
                        <Toggle
                          label="Put back in stock"
                          sub={
                            restockOf(i)
                              ? `${q} piece${q === 1 ? '' : 's'} will be added back to ${i.color} stock.`
                              : can
                                ? 'Off: the pieces won’t be counted as stock again.'
                                : 'Made to order – usually can’t be resold once cut or altered.'
                          }
                          on={restockOf(i)}
                          onChange={(v) => setRestock((m) => ({ ...m, [i.id]: v }))}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {kind === 'exchange' && (
            <div className="field-group">
              <span>What the customer gets instead</span>
              {replacements.map((r) => {
                const sizes = r.picked.product.sizes.split(',').map((s) => s.trim()).filter(Boolean);
                const stock = r.picked.variant.stock;
                return (
                  <div key={r.key} className="card stack" style={{ background: 'var(--surface-2)' }}>
                    <div className="row between">
                      <div>
                        <div className="strong small">{r.picked.product.name}</div>
                        <div className="tiny muted">
                          {r.picked.variant.color} · {stock} in stock
                        </div>
                      </div>
                      <button type="button" className="icon-btn" aria-label={`Remove replacement ${r.picked.product.name}`} onClick={() => setReplacements((rs) => rs.filter((x) => x.key !== r.key))}>
                        <Icon name="x" size={18} />
                      </button>
                    </div>
                    <div className="grid-2">
                      <label className="field">
                        <FieldHead text="Size">
                          <MicButton label="Replacement size" kind="size" options={sizes} onValue={(v) => setRepl(r.key, { size: String(v) })} />
                        </FieldHead>
                        {sizes.length > 1 ? (
                          <select className="input" value={r.size} onChange={(e) => setRepl(r.key, { size: e.target.value })}>
                            <option value="">–</option>
                            {sizes.map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </select>
                        ) : (
                          <input className="input" value={r.size} onChange={(e) => setRepl(r.key, { size: e.target.value })} placeholder="Free" />
                        )}
                      </label>
                      <label className="field">
                        <FieldHead text="Price each">
                          <MicButton label="Replacement price" kind="money" onValue={(n) => setRepl(r.key, { unit_price: n })} />
                        </FieldHead>
                        <MoneyInput value={r.unit_price} onChange={(n) => setRepl(r.key, { unit_price: n })} />
                      </label>
                    </div>
                    <div className="row between small">
                      <span>Pieces</span>
                      <Stepper value={r.quantity} min={1} max={Math.max(1, stock)} onChange={(n) => setRepl(r.key, { quantity: n })} />
                    </div>
                  </div>
                );
              })}
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn grow" onClick={() => setPicking(true)}>
                  <Icon name="plus" size={18} /> Add replacement
                </button>
                <MicButton label="Replacement product" kind="product" onValue={(id) => index.get(id) && addReplacement(index.get(id)!)} onCandidates={(ids) => setPicking(ids)} />
              </div>
            </div>
          )}

          <label className="field">
            <FieldHead text="Reason (optional)">
              <MicButton label="Reason" kind="text" onValue={setReason} />
            </FieldHead>
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === 'exchange' ? 'e.g. Wanted a bigger size' : 'e.g. Damaged in delivery'} />
          </label>

          {pieces > 0 && (
            <div className="card totals">
              <span className="muted">Order was</span>
              <span className="right">{npr(order.total)}</span>
              <span className="muted">Order is now</span>
              <span className="right strong">{npr(newTotal)}</span>
              <span className="muted">Paid so far</span>
              <span className="right">{npr(order.amount_paid)}</span>
              {owedBack > 0 && (
                <>
                  <span className="big">To give back</span>
                  <span className="big right" style={{ color: 'var(--warn)' }}>
                    {npr(owedBack)}
                  </span>
                </>
              )}
              {owedMore > 0 && (
                <>
                  <span className="big">Customer still owes</span>
                  <span className="big right">{npr(owedMore)}</span>
                </>
              )}
            </div>
          )}
          {pieces > 0 && owedBack > 0 && (
            <RefundFields owed={owedBack} max={order.amount_paid} on={refundOn} setOn={setRefundOn} amount={refundAmount} setAmount={setRefundAmount} method={method} setMethod={setMethod} />
          )}

          {error && (
            <div className="small" role="alert" style={{ color: 'var(--bad)' }}>
              {error}
            </div>
          )}
          <button type="button" className="btn primary block" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : kind === 'exchange' ? 'Save exchange' : 'Save return'}
          </button>
        </div>
      </Sheet>
      {picking && (
        <VariantPicker
          title={Array.isArray(picking) ? 'Which one did you mean?' : 'Replacement'}
          only={Array.isArray(picking) ? picking : undefined}
          onPick={addReplacement}
          onClose={() => setPicking(null)}
        />
      )}
    </>
  );
}

// ── Refund on its own ──

export function RefundSheet({ order, onClose, onSave, saving }: { order: OrderDetail; onClose: () => void; onSave: (b: RefundBody) => void; saving: boolean }) {
  const [amount, setAmount] = useState<number | ''>(order.refund_due || '');
  const [method, setMethod] = useState<PaymentMethod>(order.payment_method || 'cash');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet title="Record a refund" onClose={onClose}>
      <div className="stack">
        <div className="small muted">
          {order.refund_due > 0 ? `${npr(order.refund_due)} is owed back to the customer. ` : ''}
          {npr(order.amount_paid)} has been paid on this order, so that’s the most you can refund.
        </div>
        <label className="field">
          <FieldHead text="Amount given back">
            <MicButton label="Amount given back" kind="money" onValue={setAmount} />
          </FieldHead>
          <MoneyInput value={amount} onChange={setAmount} autoFocus />
        </label>
        <MethodChips value={method} onChange={setMethod} />
        <label className="field">
          <FieldHead text="Note (optional)">
            <MicButton label="Refund note" kind="text" onValue={setNote} />
          </FieldHead>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Sent back by eSewa" />
        </label>
        {error && (
          <div className="small" role="alert" style={{ color: 'var(--bad)' }}>
            {error}
          </div>
        )}
        <button
          type="button"
          className="btn primary block"
          disabled={saving}
          onClick={() => {
            const err = refundError(true, amount, order.amount_paid);
            if (err) return setError(err);
            onSave({ amount: Number(amount), method, note: note.trim() });
          }}
        >
          {saving ? 'Saving…' : 'Save refund'}
        </button>
      </div>
    </Sheet>
  );
}

// ── Cancel ──

export interface CancelBody {
  reason: string;
  restock: boolean;
  refund: RefundBody | null;
}

export function CancelSheet({ order, onClose, onSave, saving }: { order: OrderDetail; onClose: () => void; onSave: (b: CancelBody) => void; saving: boolean }) {
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(true);
  const paid = order.amount_paid;
  const [refundOn, setRefundOn] = useState(false);
  const [amount, setAmount] = useState<number | ''>(paid);
  const [method, setMethod] = useState<PaymentMethod>(order.payment_method || 'cash');
  const [error, setError] = useState<string | null>(null);
  const pieces = order.items.reduce((n, i) => n + piecesLeft(i), 0);
  return (
    <Sheet title="Cancel order?" onClose={onClose}>
      <div className="stack">
        <div className="small muted">The order stays in your history marked “Cancelled”. This can’t be undone.</div>
        <label className="field">
          <FieldHead text="Reason (optional)">
            <MicButton label="Reason" kind="text" onValue={setReason} />
          </FieldHead>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer changed their mind" />
        </label>
        {pieces > 0 && (
          <Toggle
            label="Put the pieces back in stock"
            sub={restock ? `${pieces} piece${pieces === 1 ? '' : 's'} will be available to sell again.` : 'Off: for pieces already cut or altered that can’t be sold again.'}
            on={restock}
            onChange={setRestock}
          />
        )}
        {paid > 0 && (
          <>
            <div className="small">
              The customer has paid <strong>{npr(paid)}</strong> on this order.
            </div>
            <RefundFields owed={paid} max={paid} on={refundOn} setOn={setRefundOn} amount={amount} setAmount={setAmount} method={method} setMethod={setMethod} />
          </>
        )}
        {error && (
          <div className="small" role="alert" style={{ color: 'var(--bad)' }}>
            {error}
          </div>
        )}
        <button
          type="button"
          className="btn primary block"
          style={{ background: 'var(--bad)', borderColor: 'var(--bad)' }}
          disabled={saving}
          onClick={() => {
            const err = refundError(refundOn && paid > 0, amount, paid);
            if (err) return setError(err);
            onSave({ reason: reason.trim(), restock, refund: refundOn && paid > 0 ? { amount: Number(amount), method } : null });
          }}
        >
          {saving ? 'Cancelling…' : 'Cancel order'}
        </button>
      </div>
    </Sheet>
  );
}
