import { BUSINESS_TIMEZONE, formatNPR } from '@slay/shared';

export const npr = formatNPR;

/** "9 Oct" – with the year ("9 Oct 2024") when it isn't this year, so old orders are never mistaken for recent ones. */
export function shortDate(iso: string | null | undefined) {
  if (!iso) return '';
  const d = iso.length === 10 ? new Date(iso + 'T00:00:00+05:45') : new Date(iso);
  const year = (x: Date) => x.toLocaleDateString('en-GB', { year: 'numeric', timeZone: BUSINESS_TIMEZONE });
  const otherYear = year(d) !== year(new Date());
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(otherYear && { year: 'numeric' }), timeZone: BUSINESS_TIMEZONE });
}

export function longDate(iso: string | null | undefined) {
  if (!iso) return '';
  const d = iso.length === 10 ? new Date(iso + 'T00:00:00+05:45') : new Date(iso);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: BUSINESS_TIMEZONE });
}

export function dateTime(iso: string | null | undefined) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: BUSINESS_TIMEZONE });
}

export function monthLabel(ym: string) {
  return new Date(ym + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
}

/** Days from `today` to `date` (both YYYY-MM-DD): 0 = today, negative = past. */
export const daysUntil = (date: string, today: string) => Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);

/** "due in 2 days", "due tomorrow", "due today", "3 days overdue". */
export function relativeDue(date: string | null, today: string) {
  if (!date) return '';
  const diff = daysUntil(date, today);
  if (diff < 0) return `${-diff} day${diff === -1 ? '' : 's'} overdue`;
  if (diff === 0) return 'due today';
  if (diff === 1) return 'due tomorrow';
  return `due in ${diff} days`;
}

/** Badge colour for a delivery date: red when late, amber within 2 days, grey otherwise. */
export function dueTone(date: string, today: string) {
  const diff = daysUntil(date, today);
  return diff < 0 ? 'bad' : diff <= 2 ? 'warn' : 'neutral';
}
