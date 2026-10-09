import { PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS, platformLabel } from '@slay/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BrandMark } from '../../components/BrandMark';
import { CopySheet } from '../../components/CopySheet';
import { Icon } from '../../components/Icon';
import { Sheet, Spinner, TopBar, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { longDate, npr } from '../../lib/format';
import { invoicePdf, invoicePng } from '../../lib/invoiceFile';
import { isIOS, isStandalone } from '../../lib/pwa';
import { saveFile, shareFile, shareOrCopy } from '../../lib/share';
import type { OrderDetail } from '../../lib/types';

export function invoiceText(o: OrderDetail) {
  const lines = [
    `SLAY – Invoice ${o.invoice_no}`,
    `Date: ${longDate(o.order_date)}`,
    `Ordered via: ${platformLabel(o.platform)}`,
    `Customer: ${o.customer.name}${o.customer.phone ? ' (' + o.customer.phone + ')' : ''}`,
    '',
    ...o.items.map((i) => `• ${i.product_name} – ${i.color}${i.size ? (i.sizes ? ', sizes ' : ', size ') + i.size : ''}: ${i.quantity} × ${npr(i.unit_price)} = ${npr(i.quantity * i.unit_price)}`),
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

type Format = 'pdf' | 'image';
const makeFile = (o: OrderDetail, f: Format) => (f === 'pdf' ? invoicePdf(o) : invoicePng(o));

/**
 * The PDF and picture are prepared as soon as the invoice opens: phones (iPhone especially) only
 * allow the share sheet straight after a tap, so the file must be ready by then.
 */
function useInvoiceFiles(o: OrderDetail | undefined) {
  const cache = useRef<{ key: string; files: Partial<Record<Format, Promise<File>>> }>({ key: '', files: {} });
  const key = o ? `${o.id}:${o.version}:${o.amount_paid}:${o.tracking_number}` : '';
  const get = (f: Format) => {
    if (cache.current.key !== key) cache.current = { key, files: {} };
    const files = cache.current.files;
    // A failed attempt isn't kept, so the next tap tries again.
    return (files[f] ??= makeFile(o!, f).catch((e) => {
      delete files[f];
      throw e;
    }));
  };
  useEffect(() => {
    if (!o) return;
    const t = setTimeout(() => {
      get('pdf').catch(() => {});
      get('image').catch(() => {});
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return get;
}

export function InvoicePage() {
  const { id } = useParams();
  const toast = useToast();
  const q = useQuery({ queryKey: ['order', Number(id)], queryFn: () => api.get<OrderDetail>(`/api/orders/${id}`) });
  const [sheet, setSheet] = useState<null | 'share' | 'save'>(null);
  const [busy, setBusy] = useState(false);
  const [manualCopy, setManualCopy] = useState<string | null>(null);
  const o = q.data;
  const fileFor = useInvoiceFiles(o);
  if (!o) return <Spinner />;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      setSheet(null);
    } catch (e) {
      toast((e as Error).message || 'Something went wrong – please try again', true);
    } finally {
      setBusy(false);
    }
  };

  /** Share as a PDF / picture (attach to WhatsApp, Instagram…), or as plain text. */
  const share = (what: Format | 'text') =>
    run(async () => {
      if (what === 'text') {
        const r = await shareOrCopy(`Invoice ${o.invoice_no}`, invoiceText(o));
        if (r === 'copied') toast('Invoice copied – paste it in the chat');
        if (r === 'failed') setManualCopy(invoiceText(o));
        return;
      }
      const file = await fileFor(what);
      const r = await shareFile(file, `Invoice ${o.invoice_no}`);
      if (r === 'failed') {
        // This browser can't attach files to a share: save it instead so it can be sent from the gallery / Downloads.
        const saved = await saveFile(file);
        toast(saved === 'failed' ? 'Couldn’t share or save here – try Share → Text message' : `Saved ${file.name} – attach it from your ${what === 'pdf' ? 'Downloads' : 'Downloads or gallery'}`, saved === 'failed');
      }
    });

  /** Saves a copy on this phone / computer. */
  const save = (what: Format) =>
    run(async () => {
      const file = await fileFor(what);
      const r = await saveFile(file);
      if (r === 'saved') toast(`Saved ${file.name}${isIOS ? '' : ' to Downloads'}`);
      if (r === 'failed') toast('Saving files isn’t allowed here – use Share instead', true);
    });

  const print = () => {
    // Inside another page (e.g. the preview) or an iPhone home-screen app, printing may be blocked:
    // the PDF can be printed from the phone's own viewer instead.
    const restricted = window.self !== window.top || (isIOS && isStandalone());
    window.print();
    if (restricted) toast('If the print screen didn’t open: tap Save → PDF, open it and print from there.');
  };

  return (
    <>
      <TopBar title="Invoice" back />
      <main className="page stack" style={{ paddingTop: 12 }}>
        <div className="invoice-actions no-print">
          <button className="btn" disabled={busy} onClick={() => setSheet('share')}>
            <Icon name="share" size={18} /> Share
          </button>
          <button className="btn" disabled={busy} onClick={print}>
            <Icon name="print" size={18} /> Print
          </button>
          <button className="btn" disabled={busy} onClick={() => setSheet('save')}>
            <Icon name="download" size={18} /> Save
          </button>
        </div>
        <div className="invoice">
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <div>
              <div className="brand" style={{ color: 'var(--accent)' }}>
                <BrandMark width={110} />
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
                    {i.size && <div style={{ fontSize: 12, color: '#666' }}>{i.sizes ? 'Sizes' : 'Size'} {i.size}</div>}
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
      {sheet === 'share' && (
        <Sheet title="Share invoice" onClose={() => setSheet(null)}>
          <div className="stack" style={{ gap: 8 }}>
            <Choice icon="orders" label="As a PDF" sub="Best for WhatsApp, Viber and email" busy={busy} onClick={() => share('pdf')} />
            <Choice icon="image" label="As a picture" sub="Best for Instagram, Messenger and TikTok" busy={busy} onClick={() => share('image')} />
            <Choice icon="send" label="As a text message" sub="The invoice details typed out" busy={busy} onClick={() => share('text')} />
          </div>
        </Sheet>
      )}
      {sheet === 'save' && (
        <Sheet title="Save a copy" onClose={() => setSheet(null)}>
          <div className="stack" style={{ gap: 8 }}>
            <Choice icon="orders" label="PDF" sub={isIOS ? 'Save to Files, or open and print' : 'Saved to Downloads – open it to print'} busy={busy} onClick={() => save('pdf')} />
            <Choice icon="image" label="Picture (PNG)" sub={isIOS ? 'Save to Photos or Files' : 'Saved to Downloads / your gallery'} busy={busy} onClick={() => save('image')} />
          </div>
        </Sheet>
      )}
      {manualCopy && <CopySheet title={`Invoice ${o.invoice_no}`} text={manualCopy} onClose={() => setManualCopy(null)} />}
    </>
  );
}

function Choice({ icon, label, sub, busy, onClick }: { icon: string; label: string; sub: string; busy: boolean; onClick: () => void }) {
  return (
    <button type="button" className="option row" style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }} disabled={busy} onClick={onClick}>
      <span className="thumb" style={{ width: 40, height: 40, color: 'var(--accent)' }}>
        <Icon name={icon} />
      </span>
      <span className="grow">
        <span className="strong" style={{ display: 'block' }}>
          {label}
        </span>
        <span className="small muted">{busy ? 'Preparing…' : sub}</span>
      </span>
    </button>
  );
}
