import { useMemo } from 'react';
import { cn } from '@cm/ui';
import {
  DAY_W,
  ROW_H,
  RAIL_W,
  buildDays,
  dateFromISO,
  differenceInCalendarDays,
  formatISODate,
  isSameDay,
  isWeekend,
  monthSpans,
  weekdayLetter,
  dayNumber,
} from './utils';
import { BookingBlock, type BookingSource } from './BookingBlock';
import { PropertyRail, GroupHeader } from './PropertyRail';

interface Group {
  id: string;
  name: string;
  color: string;
}

interface Property {
  id: string;
  name: string;
  groupId: string | null;
  defaultRateCents: bigint | number | null;
  defaultMinStay: number;
  currency?: string;
}

interface Booking {
  id: string;
  propertyId: string;
  source: BookingSource;
  status: string;
  guestName: string | null;
  checkin: string; // YYYY-MM-DD
  checkout: string;
  priceCents: bigint | null;
  currency: string;
}

interface Props {
  start: Date;
  dayCount: number;
  groups: Group[];
  properties: Property[];
  bookings: Booking[];
}

export function Calendar({ start, dayCount, groups, properties, bookings }: Props) {
  const days = useMemo(() => buildDays(start, dayCount), [start, dayCount]);
  const months = useMemo(() => monthSpans(days), [days]);
  const today = useMemo(() => new Date(), []);
  const todayIdx = useMemo(
    () => days.findIndex((d) => isSameDay(d, today)),
    [days, today],
  );

  const totalGridWidth = RAIL_W + dayCount * DAY_W;

  // Group properties by groupId, preserving group order; "Ungrouped" last
  const sections = useMemo(() => {
    const byGroup = new Map<string | null, Property[]>();
    for (const p of properties) {
      const key = p.groupId ?? null;
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key)!.push(p);
    }
    const out: Array<{ group: Group | null; items: Property[] }> = [];
    for (const g of groups) {
      const items = byGroup.get(g.id) ?? [];
      if (items.length > 0) out.push({ group: g, items });
    }
    const ungrouped = byGroup.get(null);
    if (ungrouped && ungrouped.length > 0) {
      out.push({ group: null, items: ungrouped });
    }
    return out;
  }, [groups, properties]);

  // Bucket bookings by property id for fast lookup
  const bookingsByProperty = useMemo(() => {
    const m = new Map<string, Booking[]>();
    for (const b of bookings) {
      if (!m.has(b.propertyId)) m.set(b.propertyId, []);
      m.get(b.propertyId)!.push(b);
    }
    return m;
  }, [bookings]);

  // Precompute occupied day-indices per property so we know which cells are
  // free (= eligible for showing rate + min-stay text).
  const occupiedByProperty = useMemo(() => {
    const m = new Map<string, Set<number>>();
    for (const b of bookings) {
      const ci = differenceInCalendarDays(dateFromISO(b.checkin), start);
      const co = differenceInCalendarDays(dateFromISO(b.checkout), start);
      const from = Math.max(0, ci);
      const to = Math.min(dayCount, co);
      if (to <= from) continue;
      if (!m.has(b.propertyId)) m.set(b.propertyId, new Set());
      const set = m.get(b.propertyId)!;
      for (let d = from; d < to; d++) set.add(d);
    }
    return m;
  }, [bookings, start, dayCount]);

  return (
    <div
      className={cn(
        'relative overflow-auto bg-canvas border-t border-line',
        // Mobile: subtract page header (156px) AND bottom tab bar (--mobile-bar-h).
        // Desktop: subtract header only.
        'h-[calc(100dvh-156px-var(--mobile-bar-h,0px))] md:h-[calc(100dvh-156px)]',
      )}
    >
      <div style={{ width: totalGridWidth }} className="min-w-full">
        {/* ── Header strip ─────────────────────────────────────────────── */}
        <DayHeader
          days={days}
          months={months}
          todayIdx={todayIdx}
        />

        {/* ── Property sections ───────────────────────────────────────── */}
        {sections.map((s) => (
          <section key={s.group?.id ?? 'ungrouped'}>
            {s.group && (
              <GroupHeader
                name={s.group.name}
                color={s.group.color}
                count={s.items.length}
                rightFill={dayCount * DAY_W}
              />
            )}
            {s.items.map((p) => (
              <PropertyRow
                key={p.id}
                property={p}
                groupColor={s.group?.color}
                days={days}
                todayIdx={todayIdx}
                bookings={bookingsByProperty.get(p.id) ?? []}
                occupied={occupiedByProperty.get(p.id) ?? new Set()}
                start={start}
                dayCount={dayCount}
              />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

// ─── Day header ───────────────────────────────────────────────────────────

function DayHeader({
  days,
  months,
  todayIdx,
}: {
  days: Date[];
  months: Array<{ label: string; startIdx: number; count: number }>;
  todayIdx: number;
}) {
  return (
    <div className="sticky top-0 z-20 bg-canvas/90 backdrop-blur-[3px] border-b border-line">
      {/* Month strip */}
      <div className="flex border-b border-line">
        <div
          className="sticky left-0 z-10 bg-canvas border-r border-line"
          style={{ width: RAIL_W, height: 30 }}
        />
        <div className="flex" style={{ height: 30 }}>
          {months.map((m) => (
            <div
              key={m.startIdx}
              className="flex items-end px-2.5 pb-1"
              style={{ width: m.count * DAY_W }}
            >
              <span className="display text-[12px] font-medium text-ink-soft tracking-tight">
                {m.label}
              </span>
            </div>
          ))}
        </div>
      </div>
      {/* Day strip */}
      <div className="flex">
        <div
          className="sticky left-0 z-10 bg-canvas border-r border-line"
          style={{ width: RAIL_W, height: 44 }}
        />
        <div className="flex" style={{ height: 44 }}>
          {days.map((d, i) => {
            const wknd = isWeekend(d);
            const isToday = i === todayIdx;
            return (
              <div
                key={i}
                className={cn(
                  'flex flex-col items-center justify-center border-r border-line/60',
                  wknd && 'bg-sunken/50',
                  isToday && 'bg-brand-soft',
                )}
                style={{ width: DAY_W }}
              >
                <span
                  className={cn(
                    'text-[9.5px] uppercase tracking-[0.06em] leading-none',
                    isToday ? 'text-brand font-semibold' : 'text-whisper',
                  )}
                >
                  {weekdayLetter(d)}
                </span>
                <span
                  className={cn(
                    'num text-[13.5px] mt-1 leading-none',
                    isToday ? 'text-brand font-semibold' : 'text-ink-soft',
                  )}
                >
                  {dayNumber(d)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Property row ─────────────────────────────────────────────────────────

function PropertyRow({
  property,
  groupColor,
  days,
  todayIdx,
  bookings,
  occupied,
  start,
  dayCount,
}: {
  property: Property;
  groupColor: string | undefined;
  days: Date[];
  todayIdx: number;
  bookings: Booking[];
  occupied: Set<number>;
  start: Date;
  dayCount: number;
}) {
  const rateLabel = formatRate(property.defaultRateCents, property.currency);
  const minStay = property.defaultMinStay;

  return (
    <div className="flex relative group/row">
      <PropertyRail name={property.name} groupColor={groupColor} />

      {/* Day cells */}
      <div className="relative flex" style={{ height: ROW_H }}>
        {days.map((d, i) => {
          const wknd = isWeekend(d);
          const isToday = i === todayIdx;
          const isFree = !occupied.has(i);
          return (
            <div
              key={i}
              className={cn(
                'flex flex-col items-center justify-center',
                'border-r border-b border-line/60',
                wknd && 'bg-sunken/30',
                isToday && 'bg-brand-soft/40',
              )}
              style={{ width: DAY_W, height: ROW_H }}
            >
              {isFree && rateLabel && (
                <span
                  className={cn(
                    'num text-[10.5px] leading-none',
                    isToday ? 'text-brand/70' : 'text-whisper',
                  )}
                >
                  {rateLabel}
                </span>
              )}
              {isFree && minStay > 1 && (
                <span
                  className={cn(
                    'text-[9px] leading-none mt-1 tracking-[0.04em]',
                    isToday ? 'text-brand/60' : 'text-whisper/70',
                  )}
                >
                  <span className="num">{minStay}</span> D
                </span>
              )}
            </div>
          );
        })}

        {/* Today vertical line — overlay across the row */}
        {todayIdx >= 0 && (
          <div
            aria-hidden
            className="absolute top-0 bottom-0 w-px bg-brand pointer-events-none opacity-30"
            style={{ left: todayIdx * DAY_W }}
          />
        )}

        {/* Booking blocks — half-cell semantics:
            Check-in at ~15:00 → block starts at middle of checkin cell.
            Check-out at ~11:00 → block ends at middle of checkout cell.
            A Thu→Sun stay therefore spans from mid-Thu to mid-Sun, occupying
            the right half of Thu, all of Fri+Sat, and the left half of Sun. */}
        {bookings.map((b) => {
          const ci = dateFromISO(b.checkin);
          const co = dateFromISO(b.checkout);
          const checkinIdx = differenceInCalendarDays(ci, start);
          const checkoutIdx = differenceInCalendarDays(co, start);

          let leftFrac = checkinIdx + 0.5;
          let rightFrac = checkoutIdx + 0.5;

          // Off-viewport entirely
          if (rightFrac <= 0 || leftFrac >= dayCount) return null;

          // Clip + track truncation so we render square edges where the block
          // continues beyond the visible range.
          const truncatedLeft = leftFrac < 0;
          const truncatedRight = rightFrac > dayCount;
          if (truncatedLeft) leftFrac = 0;
          if (truncatedRight) rightFrac = dayCount;

          const left = leftFrac * DAY_W;
          const width = (rightFrac - leftFrac) * DAY_W;

          return (
            <BookingBlock
              key={b.id}
              left={left}
              width={width}
              truncatedLeft={truncatedLeft}
              truncatedRight={truncatedRight}
              source={b.source}
              guestName={b.guestName}
              priceCents={b.priceCents}
              currency={b.currency}
            />
          );
        })}
      </div>
    </div>
  );
}

export { formatISODate };

function formatRate(
  cents: bigint | number | null | undefined,
  currency: string | undefined,
): string | null {
  if (cents == null) return null;
  const value = typeof cents === 'bigint' ? Number(cents) : cents;
  if (!Number.isFinite(value) || value < 0) return null;
  const symbol = !currency || currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency;
  const v = value / 100;
  // Tight format: "€80" for integer, "€79.5" for fractional, "€1.2k" for ≥1000
  if (v >= 1000) return `${symbol}${(v / 1000).toFixed(1)}k`;
  return `${symbol}${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)}`;
}
