import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { addDays, format } from 'date-fns';
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
import { PropertyRail, GroupHeader, type SyncState } from './PropertyRail';
import { formatMoney } from '../../lib/format-money';

export interface PropertySyncInfo {
  state: SyncState;
  lastSyncRelative: string | null;
  lastError: string | null;
}

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

export interface SelectionResult {
  propertyId: string;
  checkin: string;  // YYYY-MM-DD
  checkout: string; // YYYY-MM-DD (day after the last selected day)
}

/** Effective per-day override for a single cell. */
export interface OverrideCell {
  rateCents: number | null;
  minStay: number | null;
  stopSell: boolean | null;
}

interface Props {
  start: Date;
  dayCount: number;
  groups: Group[];
  properties: Property[];
  bookings: Booking[];
  /** Sync status per propertyId. Missing entries render as 'idle'. */
  syncByProperty?: Map<string, PropertySyncInfo>;
  /** Per-day rate/restriction overrides, keyed propertyId → dayIdx → cell. */
  overridesByProperty?: Map<string, Map<number, OverrideCell>>;
  onSelectRange?: (result: SelectionResult) => void;
  onBookingClick?: (bookingId: string) => void;
  onSyncProperty?: (propertyId: string) => void;
  /** propertyIds whose sync-button should appear disabled (mutation in flight). */
  pendingSyncProperties?: Set<string>;
  /**
   * Make "today" markedly more visible (stronger fill + accent + a bolder
   * vertical line) AND auto-center today in the viewport whenever the range
   * changes. Used by the shared public cleaning calendar, where staff scan for
   * the current day at a glance and the "Heute" button must land on it (esp.
   * on mobile). The operator view leaves this off.
   */
  emphasizeToday?: boolean;
}

interface PendingSelection {
  propertyId: string;
  startDay: number;
  endDay: number;
}

const LONG_PRESS_MS = 300;

export function Calendar({
  start,
  dayCount,
  groups,
  properties,
  bookings,
  syncByProperty,
  overridesByProperty,
  onSelectRange,
  onBookingClick,
  onSyncProperty,
  pendingSyncProperties,
  emphasizeToday = false,
}: Props) {
  const days = useMemo(() => buildDays(start, dayCount), [start, dayCount]);
  const months = useMemo(() => monthSpans(days), [days]);
  const today = useMemo(() => new Date(), []);
  const todayIdx = useMemo(
    () => days.findIndex((d) => isSameDay(d, today)),
    [days, today],
  );

  // Auto-scroll today into view. Only active for `emphasizeToday` (the public
  // cleaning calendar); the operator view is left exactly as-is. Runs on mount
  // and whenever the range (`start`) changes — the "Heute" button always sets a
  // fresh anchor, so this re-centers even when today's index is unchanged
  // (the bug on mobile: tapping Heute did nothing). Centering only moves
  // anything when the grid overflows horizontally (mobile); on wide screens
  // the clamp keeps scrollLeft at 0.
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!emphasizeToday) return;
    const el = scrollRef.current;
    if (!el || todayIdx < 0) return;
    const visibleGrid = el.clientWidth - RAIL_W;
    const target = todayIdx * DAY_W - Math.max(0, (visibleGrid - DAY_W) / 2);
    el.scrollLeft = Math.max(0, target);
  }, [emphasizeToday, todayIdx, start, dayCount]);

  // ── Selection (click + drag, long-press on touch) ───────────────────────
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const pointerStateRef = useRef<{
    propertyId: string;
    startDay: number;
    pointerId: number;
    startedAt: number;
    longPressTimer: ReturnType<typeof setTimeout> | null;
    isTouch: boolean;
    /** True once the selection is committed by either drag movement or long-press */
    armed: boolean;
  } | null>(null);

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

  // ── Selection helpers ───────────────────────────────────────────────────

  function clampSelectionRange(propertyId: string, from: number, to: number) {
    const occupied = occupiedByProperty.get(propertyId);
    if (!occupied) return { from, to };
    // Walk outward from the start; stop at the first occupied day
    const direction = to >= from ? 1 : -1;
    let end = from;
    for (let i = from + direction; direction > 0 ? i <= to : i >= to; i += direction) {
      if (occupied.has(i)) break;
      end = i;
    }
    return direction > 0 ? { from, to: end } : { from: end, to: from };
  }

  function commitSelection() {
    const p = pending;
    pointerStateRef.current = null;
    setPending(null);
    if (!p || !onSelectRange) return;

    const from = Math.min(p.startDay, p.endDay);
    const to = Math.max(p.startDay, p.endDay);
    const property = properties.find((x) => x.id === p.propertyId);
    const minStay = property?.defaultMinStay ?? 1;

    // Calendar convention: the LAST selected cell is the checkout day, not
    // the last night. Dragging 8..11 = checkin 8, checkout 11 (3 nights).
    //
    // Drag is explicit — honor what the user dragged, no auto-bump to
    // minStay. Manual bookings often need to override the default min-stay
    // (it'll come from PriceLabs later).
    //
    // A single click (from === to) expresses no length, so we fall back to
    // minStay as a sensible suggestion. The user can shorten in the dialog.
    const lengthDays = from === to ? minStay : Math.max(to - from, 1);

    const checkinDate = addDays(start, from);
    const checkoutDate = addDays(checkinDate, lengthDays);

    onSelectRange({
      propertyId: p.propertyId,
      checkin: format(checkinDate, 'yyyy-MM-dd'),
      checkout: format(checkoutDate, 'yyyy-MM-dd'),
    });
  }

  function cancelSelection() {
    const state = pointerStateRef.current;
    if (state?.longPressTimer) clearTimeout(state.longPressTimer);
    pointerStateRef.current = null;
    setPending(null);
  }

  // Listen on window so pointerup outside cells still commits
  useEffect(() => {
    const onUp = () => {
      const state = pointerStateRef.current;
      if (!state) return;
      // Cancel timer in case it fires after up
      if (state.longPressTimer) clearTimeout(state.longPressTimer);

      const isClick = !state.armed; // never moved or long-pressed
      if (isClick) {
        // Treat as single-cell selection
        setPending({
          propertyId: state.propertyId,
          startDay: state.startDay,
          endDay: state.startDay,
        });
        // commitSelection reads `pending` state, so defer to next tick
        setTimeout(commitSelection, 0);
      } else {
        commitSelection();
      }
    };
    const onCancel = () => cancelSelection();
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [pending]);  // re-bind so closure sees latest pending

  function handleCellPointerDown(
    e: React.PointerEvent,
    propertyId: string,
    dayIdx: number,
  ) {
    const occupied = occupiedByProperty.get(propertyId);
    if (occupied?.has(dayIdx)) return; // ignore down on occupied cells

    const isTouch = e.pointerType === 'touch';
    const state = {
      propertyId,
      startDay: dayIdx,
      pointerId: e.pointerId,
      startedAt: Date.now(),
      isTouch,
      armed: false,
      longPressTimer: null as ReturnType<typeof setTimeout> | null,
    };

    if (isTouch) {
      // On touch, only arm the selection after a long-press, so normal
      // scrolling/tapping isn't hijacked.
      state.longPressTimer = setTimeout(() => {
        state.armed = true;
        setPending({ propertyId, startDay: dayIdx, endDay: dayIdx });
        // Haptic-ish nudge (optional)
        if ('vibrate' in navigator) navigator.vibrate?.(20);
      }, LONG_PRESS_MS);
    } else {
      // Mouse/pen: arm immediately; clicks are short, drags are long
      state.armed = false; // will be set true on first move
      setPending({ propertyId, startDay: dayIdx, endDay: dayIdx });
    }

    pointerStateRef.current = state;
  }

  function handleCellPointerEnter(
    _e: React.PointerEvent,
    propertyId: string,
    dayIdx: number,
  ) {
    const state = pointerStateRef.current;
    if (!state) return;
    if (state.propertyId !== propertyId) return; // selections stay in one row
    // On touch, only update once long-press has armed
    if (state.isTouch && !state.armed) return;
    state.armed = true;
    const { from, to } = clampSelectionRange(propertyId, state.startDay, dayIdx);
    setPending({
      propertyId,
      startDay: from === state.startDay ? from : to,
      endDay: from === state.startDay ? to : from,
    });
  }

  return (
    <div
      ref={scrollRef}
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
          emphasizeToday={emphasizeToday}
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
            {s.items.map((p) => {
              const rowPending =
                pending && pending.propertyId === p.id
                  ? {
                      from: Math.min(pending.startDay, pending.endDay),
                      to: Math.max(pending.startDay, pending.endDay),
                    }
                  : null;
              const sync = syncByProperty?.get(p.id);
              return (
                <PropertyRow
                  key={p.id}
                  property={p}
                  groupColor={s.group?.color}
                  days={days}
                  todayIdx={todayIdx}
                  emphasizeToday={emphasizeToday}
                  bookings={bookingsByProperty.get(p.id) ?? []}
                  occupied={occupiedByProperty.get(p.id) ?? new Set()}
                  overrides={overridesByProperty?.get(p.id)}
                  start={start}
                  dayCount={dayCount}
                  selectionRange={rowPending}
                  syncInfo={sync}
                  syncPending={pendingSyncProperties?.has(p.id) ?? false}
                  onCellPointerDown={handleCellPointerDown}
                  onCellPointerEnter={handleCellPointerEnter}
                  onBookingClick={onBookingClick}
                  onSyncClick={onSyncProperty ? () => onSyncProperty(p.id) : undefined}
                />
              );
            })}
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
  emphasizeToday,
}: {
  days: Date[];
  months: Array<{ label: string; startIdx: number; count: number }>;
  todayIdx: number;
  emphasizeToday: boolean;
}) {
  return (
    <div className="sticky top-0 z-30 bg-canvas/90 backdrop-blur-[3px] border-b border-line">
      {/* Month strip */}
      <div className="flex border-b border-line">
        <div
          className="sticky left-0 z-40 bg-canvas border-r border-line"
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
          className="sticky left-0 z-40 bg-canvas border-r border-line"
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
                  isToday &&
                    (emphasizeToday ? 'bg-brand/20 border-b-2 border-brand' : 'bg-brand-soft'),
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
  emphasizeToday,
  bookings,
  occupied,
  overrides,
  start,
  dayCount,
  selectionRange,
  syncInfo,
  syncPending,
  onCellPointerDown,
  onCellPointerEnter,
  onBookingClick,
  onSyncClick,
}: {
  property: Property;
  groupColor: string | undefined;
  days: Date[];
  todayIdx: number;
  emphasizeToday: boolean;
  bookings: Booking[];
  occupied: Set<number>;
  overrides: Map<number, OverrideCell> | undefined;
  start: Date;
  dayCount: number;
  selectionRange: { from: number; to: number } | null;
  syncInfo: PropertySyncInfo | undefined;
  syncPending: boolean;
  onCellPointerDown: (e: React.PointerEvent, propertyId: string, dayIdx: number) => void;
  onCellPointerEnter: (e: React.PointerEvent, propertyId: string, dayIdx: number) => void;
  onBookingClick?: (bookingId: string) => void;
  onSyncClick?: () => void;
}) {
  const defaultRateLabel = formatRate(property.defaultRateCents, property.currency);
  const defaultMinStay = property.defaultMinStay;

  return (
    <div className="flex relative group/row">
      <PropertyRail
        name={property.name}
        groupColor={groupColor}
        syncState={syncInfo?.state ?? 'idle'}
        lastSyncRelative={syncInfo?.lastSyncRelative ?? null}
        lastError={syncInfo?.lastError ?? null}
        syncDisabled={syncPending}
        onSyncClick={onSyncClick}
      />

      {/* Day cells */}
      <div className="relative flex select-none" style={{ height: ROW_H }}>
        {days.map((d, i) => {
          const wknd = isWeekend(d);
          const isToday = i === todayIdx;
          const isFree = !occupied.has(i);
          const inRange =
            selectionRange != null && i >= selectionRange.from && i <= selectionRange.to;

          // Effective per-day values: override wins over property default.
          const ov = overrides?.get(i);
          const hasRateOverride = ov?.rateCents != null;
          const rateLabel = hasRateOverride
            ? formatRate(ov!.rateCents, property.currency)
            : defaultRateLabel;
          const cellMinStay = ov?.minStay ?? defaultMinStay;
          const stopSell = ov?.stopSell === true;
          return (
            <div
              key={i}
              onPointerDown={(e) => {
                // Make this cell own the pointer so subsequent move/up events fire on it
                if (isFree) {
                  (e.target as Element).releasePointerCapture?.(e.pointerId);
                  onCellPointerDown(e, property.id, i);
                }
              }}
              onPointerEnter={(e) => onCellPointerEnter(e, property.id, i)}
              className={cn(
                'flex flex-col items-center justify-center',
                'border-r border-b border-line/60',
                wknd && 'bg-sunken/30',
                isToday && (emphasizeToday ? 'bg-brand/15' : 'bg-brand-soft/40'),
                isFree && 'cursor-pointer hover:bg-brand-soft/40 transition-colors',
                inRange && 'bg-brand-soft/80 hover:bg-brand-soft/80',
                stopSell && !inRange && 'bg-negative-soft/50',
              )}
              style={{ width: DAY_W, height: ROW_H, touchAction: 'pan-y' }}
            >
              {isFree && stopSell && !inRange && (
                <span className="text-[8.5px] uppercase tracking-[0.06em] leading-none text-negative font-semibold">
                  Stop
                </span>
              )}
              {isFree && rateLabel && !inRange && (
                <span
                  className={cn(
                    'num text-[10.5px] leading-none',
                    stopSell && 'mt-1',
                    hasRateOverride
                      ? 'text-ink-soft font-medium'
                      : isToday
                        ? 'text-brand/70'
                        : 'text-whisper',
                  )}
                >
                  {rateLabel}
                </span>
              )}
              {isFree && cellMinStay > 1 && !inRange && (
                <span
                  className={cn(
                    'text-[9px] leading-none mt-1 tracking-[0.04em]',
                    ov?.minStay != null
                      ? 'text-ink-soft/80'
                      : isToday
                        ? 'text-brand/60'
                        : 'text-whisper/70',
                  )}
                >
                  <span className="num">{cellMinStay}</span> D
                </span>
              )}
            </div>
          );
        })}

        {/* Today vertical line — overlay across the row. Bolder when emphasized. */}
        {todayIdx >= 0 && (
          <div
            aria-hidden
            className={cn(
              'absolute top-0 bottom-0 bg-brand pointer-events-none',
              emphasizeToday ? 'w-0.5 opacity-60' : 'w-px opacity-30',
            )}
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
              onClick={() => onBookingClick?.(b.id)}
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
  currency: string | null | undefined,
): string | null {
  if (cents == null) return null;
  const n = typeof cents === 'bigint' ? Number(cents) : cents;
  if (!Number.isFinite(n) || n < 0) return null;
  return formatMoney(n, currency, { tight: true });
}
