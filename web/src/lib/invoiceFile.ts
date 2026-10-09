import { PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS, platformLabel } from '@slay/shared';
import { WORDMARK } from '../components/BrandMark';
import { longDate, npr } from './format';
import type { OrderDetail } from './types';

/**
 * Turns an order into a ready-to-send invoice file – a PNG image or a one-page PDF – right on the
 * phone, with no internet needed. The invoice is drawn with the phone's own fonts, so customer
 * names in Nepali (Devanagari) come out correctly in both.
 */

const W = 1240; // A4 width at 150 dpi
const A4_H = 1754;
const M = 90; // page margin
const FONT = `system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans Devanagari', 'Noto Sans', sans-serif`;
const C = { text: '#1f1a1c', muted: '#6b6166', rule: '#e8dfe2', head: '#fbe4ec', accent: '#b0154f', sparkle: '#e9a93b', good: '#1d7a46' };

type Ctx = CanvasRenderingContext2D;

function font(ctx: Ctx, size: number, weight = 400) {
  ctx.font = `${weight} ${size}px ${FONT}`;
}

/** Splits text into lines that fit `width` (breaking long words if needed). */
function wrap(ctx: Ctx, text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= width) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      line = word;
      while (ctx.measureText(line).width > width && line.length > 1) {
        let i = line.length - 1;
        while (i > 1 && ctx.measureText(line.slice(0, i)).width > width) i--;
        out.push(line.slice(0, i));
        line = line.slice(i);
      }
    }
    out.push(line);
  }
  return out;
}

/** Draws the invoice and returns where the content ends. */
function draw(ctx: Ctx, o: OrderDetail): number {
  const right = W - M;
  const text = (s: string, x: number, y: number, size: number, opts: { weight?: number; color?: string; align?: CanvasTextAlign } = {}) => {
    font(ctx, size, opts.weight);
    ctx.fillStyle = opts.color ?? C.text;
    ctx.textAlign = opts.align ?? 'left';
    ctx.fillText(s, x, y);
  };
  const rule = (y: number) => {
    ctx.fillStyle = C.rule;
    ctx.fillRect(M, y, W - 2 * M, 2);
  };
  ctx.textBaseline = 'alphabetic';

  // Header: wordmark on the left, invoice details on the right.
  const markW = 230;
  const s = markW / WORDMARK.width;
  ctx.save();
  ctx.translate(M - 14, M - 20);
  ctx.scale(s, s);
  ctx.fillStyle = C.sparkle;
  ctx.fill(new Path2D(WORDMARK.sparkle));
  ctx.translate(...WORDMARK.lettersAt);
  ctx.fillStyle = C.accent;
  ctx.fill(new Path2D(WORDMARK.letters));
  ctx.restore();

  let y = M + 20;
  text('INVOICE', right, y, 24, { weight: 700, color: C.muted, align: 'right' });
  y += 44;
  text(o.invoice_no, right, y, 34, { weight: 700, align: 'right' });
  y += 40;
  text(longDate(o.order_date), right, y, 24, { color: C.muted, align: 'right' });
  y += 34;
  text(`Ordered via ${platformLabel(o.platform)}`, right, y, 24, { color: C.muted, align: 'right' });
  y = Math.max(y, M + WORDMARK.height * s) + 36;
  rule(y);

  // Bill to
  y += 56;
  text('BILL TO', M, y, 22, { weight: 700, color: C.muted });
  y += 40;
  text(o.customer.name, M, y, 30, { weight: 600 });
  font(ctx, 24);
  for (const line of [o.customer.phone ?? '', ...(o.customer.address ? wrap(ctx, o.customer.address, 620) : [])].filter(Boolean)) {
    y += 34;
    text(line, M, y, 24, { color: C.muted });
  }

  // Items table
  const col = { qty: 820, price: 990, amount: right };
  y += 50;
  ctx.fillStyle = C.head;
  ctx.fillRect(M, y, W - 2 * M, 56);
  const headY = y + 37;
  text('Item', M + 18, headY, 22, { weight: 700 });
  text('Qty', col.qty, headY, 22, { weight: 700, align: 'right' });
  text('Price', col.price, headY, 22, { weight: 700, align: 'right' });
  text('Amount', col.amount - 18, headY, 22, { weight: 700, align: 'right' });
  y += 56;
  for (const i of o.items) {
    font(ctx, 26, 500);
    const name = wrap(ctx, `${i.product_name} – ${i.color}`, col.qty - M - 110);
    let rowY = y + 42;
    text(String(i.quantity), col.qty, rowY, 26, { align: 'right' });
    text(npr(i.unit_price), col.price, rowY, 26, { align: 'right' });
    text(npr(i.quantity * i.unit_price), col.amount - 18, rowY, 26, { weight: 600, align: 'right' });
    name.forEach((l, k) => text(l, M + 18, rowY + k * 34, 26, { weight: 500 }));
    rowY += (name.length - 1) * 34;
    if (i.size) {
      font(ctx, 22);
      for (const l of wrap(ctx, `${i.sizes ? 'Sizes' : 'Size'} ${i.size}`, col.qty - M - 110)) {
        rowY += 32;
        text(l, M + 18, rowY, 22, { color: C.muted });
      }
    }
    y = rowY + 26;
    rule(y);
  }

  // Totals
  const row = (label: string, value: string, opts: { bold?: boolean; color?: string } = {}) => {
    y += 46;
    text(label, col.price, y, opts.bold ? 28 : 24, { weight: opts.bold ? 700 : 400, color: opts.bold ? C.text : C.muted, align: 'right' });
    text(value, col.amount - 18, y, opts.bold ? 28 : 24, { weight: opts.bold ? 700 : 500, color: opts.color, align: 'right' });
  };
  y += 6;
  if (o.delivery_charge > 0) row('Delivery', npr(o.delivery_charge));
  if (o.discount > 0) row('Discount', `−${npr(o.discount)}`);
  row('Total', npr(o.total), { bold: true });
  const methods = [...new Set(o.payments.map((p) => PAYMENT_METHOD_LABELS[p.method]))].join(', ');
  row(`Paid${methods ? ` (${methods})` : ''}`, npr(o.amount_paid), { color: o.amount_paid > 0 ? C.good : undefined });
  if (o.balance_due > 0) row(o.payment_status === 'unpaid' ? 'Cash on delivery' : 'Balance due', npr(o.balance_due), { bold: true, color: C.accent });
  else row('Fully paid', '✓', { bold: true, color: C.good });

  // Status, tracking, notes
  y += 60;
  rule(y);
  y += 46;
  text(`Status: ${PAYMENT_STATUS_LABELS[o.payment_status]}${o.tracking_number ? `  ·  Tracking no: ${o.tracking_number}` : ''}`, M, y, 24, { color: C.muted });
  if (o.notes) {
    font(ctx, 24);
    for (const l of wrap(ctx, `Notes: ${o.notes}`, W - 2 * M)) {
      y += 34;
      text(l, M, y, 24, { color: C.muted });
    }
  }
  y += 80;
  text('Thank you for shopping with Slay!', W / 2, y, 26, { weight: 600, color: C.accent, align: 'center' });
  return y + M;
}

/** The invoice as a canvas: A4 proportions, longer if there are many items. */
export async function invoiceCanvas(o: OrderDetail): Promise<HTMLCanvasElement> {
  await document.fonts?.ready;
  const measure = document.createElement('canvas');
  measure.width = W;
  measure.height = 6000;
  const height = Math.max(A4_H, Math.ceil(draw(measure.getContext('2d')!, o)));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, height);
  draw(ctx, o);
  return canvas;
}

const toBlob = (c: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the invoice file'))), type, quality));

export const invoiceFileName = (o: OrderDetail, ext: 'pdf' | 'png') => `Slay-invoice-${o.invoice_no}.${ext}`;

export async function invoicePng(o: OrderDetail): Promise<File> {
  return new File([await toBlob(await invoiceCanvas(o), 'image/png')], invoiceFileName(o, 'png'), { type: 'image/png' });
}

export async function invoicePdf(o: OrderDetail): Promise<File> {
  const canvas = await invoiceCanvas(o);
  const jpeg = new Uint8Array(await (await toBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer());
  return new File([pdfWithImage(jpeg, canvas.width, canvas.height)], invoiceFileName(o, 'pdf'), { type: 'application/pdf' });
}

/** A minimal, standards-compliant one-page PDF showing a JPEG across an A4-wide page. */
export function pdfWithImage(jpeg: Uint8Array, width: number, height: number): Blob {
  const pageW = 595.28; // A4 width in points
  const pageH = +((pageW * height) / width).toFixed(2);
  const enc = new TextEncoder();
  const content = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`;
  const objects: (string | Uint8Array)[][] = [
    ['<< /Type /Catalog /Pages 2 0 R >>'],
    ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`],
    [
      `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      jpeg,
      '\nendstream',
    ],
    [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`],
  ];
  const parts: Uint8Array[] = [];
  let offset = 0;
  const push = (p: string | Uint8Array) => {
    const bytes = typeof p === 'string' ? enc.encode(p) : p;
    parts.push(bytes);
    offset += bytes.length;
  };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(offset);
    push(`${i + 1} 0 obj\n`);
    body.forEach(push);
    push('\nendobj\n');
  });
  const xref = offset;
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}
