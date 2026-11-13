import type { DashboardPeriod } from '@invoice/shared';

/**
 * UI/UX-07 Part 5: a visible, human-readable label for the dashboard's
 * currently selected period — "12 Nov 2026" for a single day, "Nov
 * 2026" for a whole calendar month, "28 Oct – 03 Nov 2026" for any
 * other custom range. Pure and deterministic (hand-rolled month
 * names, not `Intl`/`toLocaleDateString`) so it never depends on the
 * runtime's locale, and so it's unit-testable without a browser.
 */
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseIsoDate(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day };
}

function formatIsoDateHuman(iso: string): string {
  const { year, month, day } = parseIsoDate(iso);
  return `${String(day).padStart(2, '0')} ${MONTH_NAMES[month - 1]} ${year}`;
}

function isWholeCalendarMonth(from: string, to: string): boolean {
  const f = parseIsoDate(from);
  const t = parseIsoDate(to);
  if (f.year !== t.year || f.month !== t.month || f.day !== 1) return false;
  const lastDayOfMonth = new Date(f.year, f.month, 0).getDate();
  return t.day === lastDayOfMonth;
}

export function formatDashboardPeriodLabel(period: DashboardPeriod): string {
  if (period.from === period.to) return formatIsoDateHuman(period.from);
  if (isWholeCalendarMonth(period.from, period.to)) {
    const { year, month } = parseIsoDate(period.from);
    return `${MONTH_NAMES[month - 1]} ${year}`;
  }
  return `${formatIsoDateHuman(period.from)} – ${formatIsoDateHuman(period.to)}`;
}
