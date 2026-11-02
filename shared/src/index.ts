/**
 * Domain vocabulary shared by the server and the web app.
 * Adding a new status/method/platform here makes it available everywhere.
 */

export const PAYMENT_STATUSES = ['paid', 'partial', 'unpaid'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  paid: 'Paid in full',
  partial: 'Partially paid',
  unpaid: 'Unpaid (COD)',
};

export const PAYMENT_METHODS = ['cash', 'esewa', 'khalti', 'bank', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  esewa: 'eSewa',
  khalti: 'Khalti',
  bank: 'Bank transfer',
  other: 'Other',
};

export const FULFILLMENT_STATUSES = ['pending', 'sent'] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

/**
 * Overall lifecycle of an order. `returned`: every piece came back. (An exchange keeps the order
 * `active`, since the replacement still has to go out; `exchanged` is kept for older data.)
 */
export const ORDER_STATES = ['active', 'cancelled', 'returned', 'exchanged'] as const;
export type OrderState = (typeof ORDER_STATES)[number];

/** Optional after-sale actions on an order: pieces coming back, with or without a replacement. */
export const RETURN_KINDS = ['return', 'exchange'] as const;
export type ReturnKind = (typeof RETURN_KINDS)[number];

export const ORDER_STATE_LABELS: Record<OrderState, string> = {
  active: 'Active',
  cancelled: 'Cancelled',
  returned: 'Returned',
  exchanged: 'Exchanged',
};

/** Where an order came from. Every order records one of these. */
export const PLATFORMS = ['tiktok', 'facebook', 'instagram', 'whatsapp'] as const;
export type Platform = (typeof PLATFORMS)[number];

/**
 * One size per piece on an order line, as shown on orders and invoices: ["42", "42", "41"] → "42 ×2, 41".
 * Blank sizes are left out.
 */
export function sizeSummary(sizes: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const s of sizes.map((x) => x.trim()).filter(Boolean)) counts.set(s, (counts.get(s) ?? 0) + 1);
  return [...counts].map(([s, n]) => (n > 1 ? `${s} ×${n}` : s)).join(', ');
}

/**
 * Optional stitching measurements for an order item. Each one is its own field; values are free
 * text (e.g. "34", "34.5"), so they're never locked to preset sizes. Sizes (S, M, 42…) stay as they are.
 */
export const MEASUREMENTS = [
  { key: 'bust', label: 'Bust size' },
  { key: 'waist', label: 'Waist size' },
  { key: 'hip', label: 'Hip size' },
  { key: 'pant_length', label: 'Pant length' },
  { key: 'underarm', label: 'Underarm round' },
  { key: 'chest', label: 'Chest size' },
  { key: 'neck', label: 'Neck size' },
] as const;
export type MeasurementKey = (typeof MEASUREMENTS)[number]['key'];
export type Measurements = Partial<Record<MeasurementKey, string>>;

/** Only the measurements that have a value, in the standard order; null when there are none. */
export function cleanMeasurements(m: Measurements | null | undefined): Measurements | null {
  if (!m) return null;
  const out: Measurements = {};
  for (const { key } of MEASUREMENTS) {
    const v = m[key]?.trim();
    if (v) out[key] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** "Bust 34 · Waist 28" – for invoices and messages. */
export function measurementSummary(m: Measurements | null | undefined, sep = ' · '): string {
  const c = cleanMeasurements(m);
  if (!c) return '';
  return MEASUREMENTS.filter(({ key }) => c[key]).map(({ key, label }) => `${label.replace(/ size$/, '')} ${c[key]}`).join(sep);
}

/** What a supplier bill was for. Teams can add their own types on top of these. */
export const RECEIPT_TYPE_PRESETS = ['Fabric', 'Stitching', 'Ready-made', 'Thread'] as const;

/** Labels for every platform value an order can hold, including ones no longer offered for new orders. */
export const PLATFORM_LABELS: Record<string, string> = {
  tiktok: 'TikTok',
  facebook: 'Facebook',
  instagram: 'Instagram',
  whatsapp: 'WhatsApp',
  'walk-in': 'Walk-in', // older orders only
  other: 'Other', // older orders only
};

export const platformLabel = (p: string | null | undefined) => (p ? (PLATFORM_LABELS[p] ?? p) : 'Unknown');

/** Why a stock count changed. `return` / `exchange`: pieces put back (or replacements taken) after a sale. */
export const STOCK_REASONS = ['order', 'order_edit', 'order_cancel', 'manual', 'restock', 'return', 'exchange'] as const;
export type StockReason = (typeof STOCK_REASONS)[number];

export const BUSINESS_TIMEZONE = 'Asia/Kathmandu';

/** 1 → "1st", 2 → "2nd", 3 → "3rd", 11 → "11th", 22 → "22nd". */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/** Round to 2 decimals (rupees + paisa) to avoid floating point drift. */
export function money(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function derivePaymentStatus(total: number, paid: number): PaymentStatus {
  const t = money(total);
  const p = money(paid);
  if (t <= 0 || p >= t) return 'paid';
  return p > 0 ? 'partial' : 'unpaid';
}

export function formatNPR(n: number): string {
  const v = money(n);
  return 'Rs ' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/** `YYYY-MM-DD` for "now" in the business timezone (Nepal). */
export function todayInBusinessTz(now: Date = new Date()): string {
  return localDate(now);
}

export function localDate(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  return parts; // en-CA formats as YYYY-MM-DD
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Live-update event names pushed from the server to every signed-in device. */
export const LIVE_EVENTS = {
  stock: 'stock.changed',
  catalog: 'catalog.changed',
  order: 'order.changed',
  customer: 'customer.changed',
  payment: 'payment.changed',
  receipt: 'receipt.changed',
  alert: 'alert.created',
} as const;
export type LiveEventName = (typeof LIVE_EVENTS)[keyof typeof LIVE_EVENTS];

export interface LiveEvent {
  type: LiveEventName;
  /** User who caused the change (null for system, e.g. eSewa callback). */
  actor: { id: number; name: string } | null;
  ids?: number[];
  message?: string;
  /** For alert events. */
  severity?: 'info' | 'warning' | 'critical';
  at: string;
}
