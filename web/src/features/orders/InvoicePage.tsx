import { PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS, platformLabel } from '@slay/shared';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Spinner, TopBar, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { longDate, npr } from '../../lib/format';
import type { OrderDetail } from '../../lib/types';
import { shareOrCopy } from './OrderDetailPage';

export function invoiceText(o: OrderDetail) {
  const lines = [
    `SLAY – Invoice ${o.invoice_no}`,
    `Date: ${longDate(o.order_date)}`,
    `Ordered via: ${platformLabel(o.platform)}`,
    `Customer: ${o.customer.name}${o.customer.phone ? ' (' + o.customer.phone + ')' : ''}`,
    '',
    ...o.items.map((i) => `• ${i.product_name} – ${i.color}${i.size ? ', size ' + i.size : ''}: ${i.quantity} × ${npr(i.unit_price)} = ${npr(i.quantity * i.unit_price)}`),
    '',
    o.delivery_charge ? `Delivery: ${npr(o.delivery_charge)}` : '',
    o.discount ? `Discount: −${npr(o.discount)}` : '',
    `Total: ${npr(o.total)}`,
    `Paid: ${npr(o.amount_paid)}`,
    o.balance_due > 0 ? `Balance due${o.payment_status === 'unpaid' ? ' (cash on delivery)' : ''}: ${npr(o.balance_due)}` : 'Fully paid – thank you!',
    o.tracking_number ? `Tracking no: ${o.tracking_number}` : '',
  ];
  return lines.filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

export function InvoicePage() {
  const { id } = useParams();
  const toast = useToast();
  const q = useQuery({ queryKey: ['order', Number(id)], queryFn: () => api.get<OrderDetail>(`/api/orders/${id}`) });
  const o = q.data;
  if (!o) return <Spinner />;
  return (
    <>
      <TopBar title="Invoice" back />
      <main className="page stack" style={{ paddingTop: 12 }}>
        <div className="btn-row no-print">
          <button
            className="btn"
            onClick={async () => {
              const r = await shareOrCopy(`Invoice ${o.invoice_no}`, invoiceText(o));
              if (r === 'copied') toast('Invoice copied – paste it in the chat');
            }}
          >
            <Icon name="share" size={18} /> Share
          </button>
          <button className="btn" onClick={() => window.print()}>
            <Icon name="print" size={18} /> Print / PDF
          </button>
        </div>
        <div className="invoice">
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <div>
              <div className="brand" style={{ fontSize: 30 }}>
                Slay
              </div>
            </div>
            <div className="right small">
              <div className="strong">Invoice {o.invoice_no}</div>
              <div>{longDate(o.order_date)}</div>
              <div>Ordered via {platformLabel(o.platform)}</div>
            </div>
          </div>
          <div className="hr" />
          <div className="small">
            <div className="strong">Bill to</div>
            <div>{o.customer.name}</div>
            {o.customer.phone && <div>{o.customer.phone}</div>}
            {o.customer.address && <div>{o.customer.address}</div>}
          </div>
          <table style={{ marginTop: 14 }}>
            <thead>
              <tr>
                <th>Item</th>
                <th className="r">Qty</th>
                <th className="r">Price</th>
                <th className="r">Amount</th>
              </tr>
            </thead>
            <tbody>
              {o.items.map((i) => (
                <tr key={i.id}>
                  <td>
                    {i.product_name} – {i.color}
                    {i.size && <div style={{ fontSize: 12, color: '#666' }}>Size {i.size}</div>}
                  </td>
                  <td className="r">{i.quantity}</td>
                  <td className="r">{npr(i.unit_price)}</td>
                  <td className="r">{npr(i.quantity * i.unit_price)}</td>
                </tr>
              ))}
              {o.delivery_charge > 0 && (
                <tr>
                  <td colSpan={3}>Delivery</td>
                  <td className="r">{npr(o.delivery_charge)}</td>
                </tr>
              )}
              {o.discount > 0 && (
                <tr>
                  <td colSpan={3}>Discount</td>
                  <td className="r">−{npr(o.discount)}</td>
                </tr>
              )}
              <tr>
                <td colSpan={3} className="strong">
                  Total
                </td>
                <td className="r strong">{npr(o.total)}</td>
              </tr>
              <tr>
                <td colSpan={3}>Paid{o.payments.length ? ` (${[...new Set(o.payments.map((p) => PAYMENT_METHOD_LABELS[p.method]))].join(', ')})` : ''}</td>
                <td className="r">{npr(o.amount_paid)}</td>
              </tr>
              <tr>
                <td colSpan={3} className="strong">
                  {o.payment_status === 'unpaid' ? 'Cash on delivery' : 'Balance due'}
                </td>
                <td className="r strong">{npr(o.balance_due)}</td>
              </tr>
            </tbody>
          </table>
          <div className="small" style={{ marginTop: 12 }}>
            Status: {PAYMENT_STATUS_LABELS[o.payment_status]}
            {o.tracking_number && <> · Tracking no: {o.tracking_number}</>}
          </div>
          {o.notes && <div className="small" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>Notes: {o.notes}</div>}
          <div className="small center" style={{ marginTop: 18, color: '#666' }}>
            Thank you for shopping with Slay!
          </div>
        </div>
      </main>
    </>
  );
}
