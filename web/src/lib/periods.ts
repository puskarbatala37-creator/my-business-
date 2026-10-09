import { addDays } from '@slay/shared';

export interface DatePreset {
  key: string;
  label: string;
  from: string;
  to: string;
}

/** First day of the month `monthsBack` months before `today`'s month. */
export function monthStart(today: string, monthsBack = 0) {
  const [y, m] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 - monthsBack, 1)).toISOString().slice(0, 10);
}

/**
 * Date shortcuts used for order search and sales totals. They're only shortcuts: "All time" (no dates)
 * and "Pick dates" reach any order, however old.
 */
export function datePresets(today: string): DatePreset[] {
  const year = Number(today.slice(0, 4));
  return [
    { key: 'today', label: 'Today', from: today, to: today },
    { key: 'yesterday', label: 'Yesterday', from: addDays(today, -1), to: addDays(today, -1) },
    { key: '7d', label: 'Last 7 days', from: addDays(today, -6), to: today },
    { key: 'month', label: 'This month', from: monthStart(today), to: today },
    { key: 'last-month', label: 'Last month', from: monthStart(today, 1), to: addDays(monthStart(today), -1) },
    { key: '6m', label: 'Last 6 months', from: monthStart(today, 5), to: today },
    { key: '12m', label: 'Last 12 months', from: monthStart(today, 11), to: today },
    { key: 'year', label: `This year (${year})`, from: `${year}-01-01`, to: today },
    { key: 'last-year', label: `Last year (${year - 1})`, from: `${year - 1}-01-01`, to: `${year - 1}-12-31` },
  ];
}
