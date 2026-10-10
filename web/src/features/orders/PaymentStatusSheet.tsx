import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, money, type PaymentMethod, type PaymentStatus } from '@slay/shared';
import { useState } from 'react';
import { FieldHead, MicButton } from '../../components/FieldVoice';
import { MoneyInput, Seg, Sheet } from '../../components/ui';
import { npr } from '../../lib/format';
import type { OrderDetail } from '../../lib/types';

export interface PaymentStatusBody {
  status: PaymentStatus;
  amount?: number;
  method: PaymentMethod;
}

/**
 * Change an order's payment status after it was taken: COD → Paid in full when the money arrives,
 * Partial → Paid in full, or fix a mistake. Shows exactly what will be recorded.
 */
export function PaymentStatusSheet({ order, saving, onClose, onSave }: { order: OrderDetail; saving: boolean; onClose: () => void; onSave: (b: PaymentStatusBody) => void }) {
  const [status, setStatus] = useState<PaymentStatus>(order.payment_status);
  const [amount, setAmount] = useState<number | ''>(order.payment_status === 'partial' ? order.amount_paid : '');
  const [method, setMethod] = useState<PaymentMethod>(order.payment_method ?? 'cash');
  const [error, setError] = useState<string | null>(null);
  const target = status === 'paid' ? Math.max(order.total, order.amount_paid) : status === 'unpaid' ? 0 : Number(amount) || 0;
  const delta = money(target - order.amount_paid);
  const unchanged = status === order.payment_status && delta === 0;

  return (
    <Sheet title="Payment status" onClose={onClose}>
      <div className="stack">
        <div className="small muted">
          Order total {npr(order.total)} · paid so far {npr(order.amount_paid)}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <MicButton label="Payment status" kind="payment_status" onValue={setStatus} />
          <div className="grow">
            <Seg
              value={status}
              onChange={setStatus}
              options={[
                { value: 'paid', label: 'Paid in full' },
                { value: 'partial', label: 'Partial' },
                { value: 'unpaid', label: 'COD' },
              ]}
            />
          </div>
        </div>
        {status === 'partial' && (
          <label className="field">
            <FieldHead text="Total paid so far">
              <MicButton label="Total paid so far" kind="money" onValue={setAmount} />
            </FieldHead>
            <MoneyInput value={amount} onChange={setAmount} autoFocus />
          </label>
        )}
        {delta > 0 && (
          <div className="field-group">
            <FieldHead text="Paid by">
              <MicButton label="Payment method" kind="payment_method" onValue={setMethod} />
            </FieldHead>
            <div className="chips" role="radiogroup" aria-label="Paid by">
              {PAYMENT_METHODS.map((m) => (
                <button key={m} type="button" role="radio" aria-checked={method === m} className={`chip ${method === m ? 'on' : ''}`} onClick={() => setMethod(m)}>
                  {PAYMENT_METHOD_LABELS[m]}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="small" role="status">
          {unchanged
            ? 'No change.'
            : delta > 0
              ? `Records ${npr(delta)} received${status === 'paid' ? ' – the order is then fully paid' : ''}.`
              : delta < 0
                ? `Takes ${npr(-delta)} off what was paid (shown as a correction under Payments; your partner is notified). To give money back to the customer, use Refund instead.`
                : 'Updates the status.'}
        </div>
        {error && (
          <div className="small" role="alert" style={{ color: 'var(--bad)' }}>
            {error}
          </div>
        )}
        <button
          type="button"
          className="btn primary block"
          disabled={saving || unchanged}
          onClick={() => {
            if (status === 'partial' && !(target > 0 && target < order.total)) return setError(`Enter how much has been paid in total – more than 0 and less than ${npr(order.total)}.`);
            setError(null);
            onSave({ status, ...(status === 'partial' ? { amount: target } : {}), method });
          }}
        >
          {saving ? 'Saving…' : 'Save payment status'}
        </button>
      </div>
    </Sheet>
  );
}
