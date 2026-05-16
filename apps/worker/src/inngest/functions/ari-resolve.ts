/**
 * Shared ARI resolution helpers — the "what is the desired Channex state
 * right now" logic, extracted so the global flusher can build ONE batched
 * payload across many properties instead of one call per property.
 *
 *   - resolveAvailabilityValues: occupied days (from bookings) → /availability
 *   - resolveRateValues:         effective rate + min-stay  → /restrictions
 *
 * Both return Channex bulk-update entries already compacted into contiguous
 * same-state spans, so a 500-day change for 50 rooms is still a handful of
 * array entries in a single API call.
 */
import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import {
  bookings,
  channexProperties,
  properties,
  rateOverrides,
  type Database,
} from '@cm/db';
import type { AvailabilityUpdate, RestrictionUpdate } from '@cm/channex';

/** A per-(property,kind) merged date window to recompute. dateTo EXCLUSIVE. */
export interface DirtyRange {
  tenantId: string;
  propertyId: string;
  from: string; // YYYY-MM-DD inclusive
  to: string; // YYYY-MM-DD EXCLUSIVE
}

export interface PropertyMapping {
  propertyId: string;
  tenantId: string;
  channexPropertyId: string;
  channexRoomTypeId: string;
  channexRatePlanId: string;
  defaultRateCents: number | null;
  defaultMinStay: number;
}

/** Adds one day to a YYYY-MM-DD string. UTC-safe. */
export function addDayStr(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

/** Subtracts one day from a YYYY-MM-DD string. UTC-safe. */
export function prevDayStr(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

interface Span {
  from: string;
  toInclusive: string;
  occupied: boolean;
}

/**
 * Walks [from, toExclusive) and groups consecutive same-state (occupied vs
 * free) days into spans. Channex bulk endpoints take a date_from/date_to
 * range per entry, so this keeps payloads tiny.
 */
export function compactSpans(
  from: string,
  toExclusive: string,
  occupied: Set<string>,
): Span[] {
  const spans: Span[] = [];
  let cursor = from;
  if (cursor >= toExclusive) return spans;

  let runStart = cursor;
  let runState = occupied.has(cursor);

  while (cursor < toExclusive) {
    const state = occupied.has(cursor);
    if (state !== runState) {
      spans.push({ from: runStart, toInclusive: prevDayStr(cursor), occupied: runState });
      runStart = cursor;
      runState = state;
    }
    cursor = addDayStr(cursor);
  }
  spans.push({ from: runStart, toInclusive: prevDayStr(toExclusive), occupied: runState });
  return spans;
}

/**
 * Resolve Channex property/room/rate IDs + rate defaults for a set of
 * internal property IDs, in one query. Properties without a Channex mapping
 * are simply absent from the returned map (caller treats as skipped).
 */
export async function loadMappings(
  db: Database,
  propertyIds: string[],
): Promise<Map<string, PropertyMapping>> {
  if (propertyIds.length === 0) return new Map();
  const rows = await db
    .select({
      propertyId: properties.id,
      tenantId: properties.tenantId,
      channexPropertyId: channexProperties.channexPropertyId,
      channexRoomTypeId: channexProperties.channexRoomTypeId,
      channexRatePlanId: channexProperties.channexRatePlanId,
      defaultRateCents: properties.defaultRateCents,
      defaultMinStay: properties.defaultMinStay,
    })
    .from(properties)
    .innerJoin(channexProperties, eq(channexProperties.id, properties.channexPropertyRef))
    .where(inArray(properties.id, propertyIds));

  const map = new Map<string, PropertyMapping>();
  for (const r of rows) {
    map.set(r.propertyId, {
      propertyId: r.propertyId,
      tenantId: r.tenantId,
      channexPropertyId: r.channexPropertyId,
      channexRoomTypeId: r.channexRoomTypeId,
      channexRatePlanId: r.channexRatePlanId,
      defaultRateCents: r.defaultRateCents != null ? Number(r.defaultRateCents) : null,
      defaultMinStay: r.defaultMinStay,
    });
  }
  return map;
}

/**
 * Build /availability bulk entries for every dirty range whose property has
 * a Channex mapping. Occupied = any active booking/block overlapping the day.
 */
export async function resolveAvailabilityValues(
  db: Database,
  ranges: DirtyRange[],
  mappings: Map<string, PropertyMapping>,
): Promise<AvailabilityUpdate[]> {
  const out: AvailabilityUpdate[] = [];
  for (const r of ranges) {
    const m = mappings.get(r.propertyId);
    if (!m) continue;

    const overlapping = await db
      .select({ checkin: bookings.checkin, checkout: bookings.checkout })
      .from(bookings)
      .where(
        and(
          eq(bookings.tenantId, r.tenantId),
          eq(bookings.propertyId, r.propertyId),
          inArray(bookings.status, ['confirmed', 'synced', 'pending_sync', 'blocked']),
          lt(bookings.checkin, r.to),
          gte(bookings.checkout, r.from),
        ),
      );

    const occupied = new Set<string>();
    for (const b of overlapping) {
      for (
        let d = b.checkin > r.from ? b.checkin : r.from;
        d < (b.checkout < r.to ? b.checkout : r.to);
        d = addDayStr(d)
      ) {
        occupied.add(d);
      }
    }

    for (const s of compactSpans(r.from, r.to, occupied)) {
      out.push({
        property_id: m.channexPropertyId,
        room_type_id: m.channexRoomTypeId,
        date_from: s.from,
        date_to: s.toInclusive,
        availability: s.occupied ? 0 : 1,
      });
    }
  }
  return out;
}

/** Per-day effective rate/restriction state, before span-compaction. */
interface DayRate {
  rate: number | null;
  minStay: number;
  maxStay: number | null;
  closedToArrival: boolean | null;
  closedToDeparture: boolean | null;
  stopSell: boolean | null;
}

/** Stable key for "are these two days identical?" span grouping. */
function dayRateKey(d: DayRate): string {
  return [
    d.rate,
    d.minStay,
    d.maxStay,
    d.closedToArrival,
    d.closedToDeparture,
    d.stopSell,
  ].join('|');
}

/**
 * Build /restrictions bulk entries for every dirty 'rates' range whose
 * property has a Channex mapping.
 *
 * Per-day resolution: each day's effective value = rate_overrides row for
 * that day, falling back to the property default. Consecutive identical days
 * are compacted into one span entry, so a 365-day change is still a small
 * handful of array entries inside the single batched POST /restrictions.
 */
export async function resolveRateValues(
  db: Database,
  ranges: DirtyRange[],
  mappings: Map<string, PropertyMapping>,
): Promise<RestrictionUpdate[]> {
  const out: RestrictionUpdate[] = [];

  for (const r of ranges) {
    const m = mappings.get(r.propertyId);
    if (!m || !m.channexRatePlanId) continue;

    // Load only the overrides inside this window, indexed by day.
    const overrides = await db
      .select({
        date: rateOverrides.date,
        rateCents: rateOverrides.rateCents,
        minStay: rateOverrides.minStay,
        maxStay: rateOverrides.maxStay,
        closedToArrival: rateOverrides.closedToArrival,
        closedToDeparture: rateOverrides.closedToDeparture,
        stopSell: rateOverrides.stopSell,
      })
      .from(rateOverrides)
      .where(
        and(
          eq(rateOverrides.propertyId, r.propertyId),
          gte(rateOverrides.date, r.from),
          lt(rateOverrides.date, r.to),
        ),
      );
    const byDay = new Map(overrides.map((o) => [o.date, o]));

    const effectiveAt = (day: string): DayRate => {
      const o = byDay.get(day);
      return {
        rate:
          o?.rateCents != null
            ? Number(o.rateCents)
            : m.defaultRateCents, // may be null → entry omits `rate`
        minStay: o?.minStay ?? m.defaultMinStay,
        maxStay: o?.maxStay ?? null,
        closedToArrival: o?.closedToArrival ?? null,
        closedToDeparture: o?.closedToDeparture ?? null,
        stopSell: o?.stopSell ?? null,
      };
    };

    // Walk [from,to), grouping consecutive identical days into spans.
    let runStart = r.from;
    let runDay = effectiveAt(r.from);
    let runKey = dayRateKey(runDay);

    const flush = (start: string, endExclusive: string, d: DayRate) => {
      const entry: RestrictionUpdate = {
        property_id: m.channexPropertyId,
        rate_plan_id: m.channexRatePlanId,
        date_from: start,
        date_to: prevDayStr(endExclusive), // Channex date_to is inclusive
        min_stay_arrival: d.minStay,
        min_stay_through: d.minStay,
      };
      if (d.rate != null) entry.rate = d.rate;
      if (d.maxStay != null) entry.max_stay = d.maxStay;
      if (d.closedToArrival != null) entry.closed_to_arrival = d.closedToArrival;
      if (d.closedToDeparture != null) entry.closed_to_departure = d.closedToDeparture;
      if (d.stopSell != null) entry.stop_sell = d.stopSell;
      out.push(entry);
    };

    for (let cursor = addDayStr(r.from); cursor < r.to; cursor = addDayStr(cursor)) {
      const day = effectiveAt(cursor);
      const key = dayRateKey(day);
      if (key !== runKey) {
        flush(runStart, cursor, runDay);
        runStart = cursor;
        runDay = day;
        runKey = key;
      }
    }
    flush(runStart, r.to, runDay);
  }

  return out;
}
