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
import { bookings, channexProperties, properties, type Database } from '@cm/db';
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

/**
 * Build /restrictions bulk entries (rate + min-stay) for every dirty range
 * whose property has a Channex mapping and a configured default rate.
 *
 * Phase 9a: property-level default rate + min-stay over the whole range.
 * Phase 9b will layer per-day rate_overrides on top (still compacted).
 */
export function resolveRateValues(
  ranges: DirtyRange[],
  mappings: Map<string, PropertyMapping>,
): RestrictionUpdate[] {
  const out: RestrictionUpdate[] = [];
  for (const r of ranges) {
    const m = mappings.get(r.propertyId);
    if (!m || m.defaultRateCents == null || !m.channexRatePlanId) continue;
    out.push({
      property_id: m.channexPropertyId,
      rate_plan_id: m.channexRatePlanId,
      date_from: r.from,
      date_to: prevDayStr(r.to), // Channex date_to is inclusive
      rate: m.defaultRateCents,
      min_stay_arrival: m.defaultMinStay,
      min_stay_through: m.defaultMinStay,
    });
  }
  return out;
}
