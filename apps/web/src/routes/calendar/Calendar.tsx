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

  return (
    <div
      className="relative overflow-auto bg-canvas border-t border-line"
      style={{ height: 'calc(100dvh - 156px)' /* viewport minus header */ }}
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
  start,
  dayCount,
}: {
  property: Property;
  groupColor: string | undefined;
  days: Date[];
  todayIdx: number;
  bookings: Booking[];
  start: Date;
  dayCount: number;
}) {
  return (
    <div className="flex relative group/row">
      <PropertyRail name={property.name} groupColor={groupColor} />

      {/* Day cells */}
      <div className="relative flex" style={{ height: ROW_H }}>
        {days.map((d, i) => {
          const wknd = isWeekend(d);
          const isToday = i === todayIdx;
          return (
            <div
              key={i}
              className={cn(
                'border-r border-b border-line/60',
                wknd && 'bg-sunken/30',
                isToday && 'bg-brand-soft/40',
              )}
              style={{ width: DAY_W, height: ROW_H }}
            />
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

        {/* Booking blocks */}
        {bookings.map((b) => {
          const ci = dateFromISO(b.checkin);
          const co = dateFromISO(b.checkout);
          const startCol = Math.max(0, differenceInCalendarDays(ci, start));
          const lastCol = Math.min(dayCount, differenceInCalendarDays(co, start));
          const span = lastCol - startCol;
          if (span <= 0) return null; // outside the viewport
          return (
            <BookingBlock
              key={b.id}
              startCol={startCol}
              span={span}
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
