import {
  addDays,
  differenceInCalendarDays,
  format,
  isSameDay,
  isWeekend,
  parseISO,
  startOfDay,
} from 'date-fns';
import { de } from 'date-fns/locale';

/** Width of one day cell in px. Keep in sync with CSS grid template. */
export const DAY_W = 56;
/** Height of one apartment row in px. */
export const ROW_H = 56;
/** Width of the sticky left rail (property info). */
export const RAIL_W = 248;

/** Convert YYYY-MM-DD → local Date at midnight (timezone-safe). */
export function dateFromISO(s: string): Date {
  // parseISO interprets bare dates as local midnight in v3+. Good.
  return parseISO(s);
}

/** Today as YYYY-MM-DD (local). */
export function todayISO(): string {
  return format(startOfDay(new Date()), 'yyyy-MM-dd');
}

export function formatISODate(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

/**
 * Build an array of N consecutive Date objects starting at `start`.
 */
export function buildDays(start: Date, count: number): Date[] {
  const out: Date[] = [];
  for (let i = 0; i < count; i++) out.push(addDays(start, i));
  return out;
}

/** Group consecutive days into month spans, for the header strip. */
export function monthSpans(days: Date[]): Array<{
  label: string;
  startIdx: number;
  count: number;
}> {
  const out: Array<{ label: string; startIdx: number; count: number }> = [];
  let current: { label: string; startIdx: number; count: number } | null = null;
  for (let i = 0; i < days.length; i++) {
    const d = days[i]!;
    const label = format(d, 'MMMM yyyy', { locale: de });
    if (!current || current.label !== label) {
      if (current) out.push(current);
      current = { label, startIdx: i, count: 1 };
    } else {
      current.count++;
    }
  }
  if (current) out.push(current);
  return out;
}

export const weekdayLetter = (d: Date) => format(d, 'EEEEEE', { locale: de }).slice(0, 1);
export const dayNumber = (d: Date) => format(d, 'd');

export { addDays, differenceInCalendarDays, isSameDay, isWeekend };
