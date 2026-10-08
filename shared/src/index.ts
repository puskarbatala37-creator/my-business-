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
 * Overall lifecycle of an order. `returned` / `exchanged` are reserved for the
 * future returns & exchanges feature – the data model already supports them.
 */
export const ORDER_STATES = ['active', 'cancelled', 'returned', 'exchanged'] as const;
export type OrderState = (typeof ORDER_STATES)[number];

export const PLATFORMS = ['instagram', 'facebook', 'tiktok', 'walk-in', 'other'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABELS: Record<Platform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  'walk-in': 'Walk-in',
  other: 'Other',
};

/** Why a stock count changed. `return` / `exchange` are reserved for later. */
export const STOCK_REASONS = ['order', 'order_edit', 'order_cancel', 'manual', 'restock', 'return', 'exchange'] as const;
export type StockReason = (typeof STOCK_REASONS)[number];

export const BUSINESS_TIMEZONE = 'Asia/Kathmandu';

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
  at: string;
}
