import { useMemo, useState } from 'react';
import {
  addDays,
  differenceInCalendarDays,
  formatDistanceToNow,
  startOfDay,
  format,
  subDays,
} from 'date-fns';
import { de } from 'date-fns/locale';
import { CalendarDays, ChevronLeft, ChevronRight, Tag } from 'lucide-react';
import { toast } from 'sonner';

import { PageHeader } from './_dashboard';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { cn } from '@cm/ui';
import {
  Calendar,
  formatISODate,
  type OverrideCell,
  type PropertySyncInfo,
  type SelectionResult,
} from './calendar/Calendar';
import type { SyncState } from './calendar/PropertyRail';
import { NewBookingDialog, type EditingBooking } from './calendar/NewBookingDialog';
import { RateEditorDialog, type RateSelection } from './calendar/RateEditorDialog';
import { BookingDetailSheet } from './calendar/BookingDetailSheet';
import { trpc } from '../lib/trpc';
import { useSyncJobsRealtime, useBookingsRealtime } from '../lib/realtime';

type CalendarMode = 'bookings' | 'rates';

const VIEWPORT_DAYS = 60;

export function CalendarPage() {
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const start = useMemo(() => subDays(anchor, 7), [anchor]);
  const end = useMemo(() => addDays(start, VIEWPORT_DAYS), [start]);

  const [mode, setMode] = useState<CalendarMode>('bookings');
  const [newBooking, setNewBooking] = useState<SelectionResult | null>(null);
  const [rateSelection, setRateSelection] = useState<RateSelection | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingBooking | null>(null);

  const utils = trpc.useUtils();
  const meQ = trpc.me.current.useQuery();
  const groupsQ = trpc.propertyGroups.list.useQuery();
  const propsQ = trpc.properties.list.useQuery();
  const bookingsQ = trpc.bookings.listByRange.useQuery({
    from: formatISODate(start),
    to: formatISODate(end),
  });
  const syncStatusQ = trpc.sync.statusByProperty.useQuery();
  const overridesQ = trpc.rates.listByRangeAll.useQuery({
    from: formatISODate(start),
    to: formatISODate(end),
  });

  const tenant = meQ.data?.memberships[0];
  const pricelabsMode = tenant?.rateSource === 'pricelabs';

  // In PriceLabs mode the real per-day prices live in Channex (PriceLabs writes
  // them). Read them back (server-cached/paced) so the calendar shows the true
  // prices instead of our static default. Disabled in PMS mode.
  const externalRatesQ = trpc.rates.channexEffectiveRates.useQuery(
    { from: formatISODate(start), to: formatISODate(end) },
    { enabled: pricelabsMode, refetchOnWindowFocus: false, staleTime: 5 * 60_000 },
  );

  // Subscribe to live sync_jobs changes for the current tenant.
  useSyncJobsRealtime(tenant?.tenantId);
  // Subscribe to live booking changes so inbound OTA bookings (webhook →
  // ingest → DB) appear in the calendar automatically, without a reload.
  useBookingsRealtime(tenant?.tenantId);

  // propertyIds with an in-flight trigger mutation — disable their buttons.
  const [pendingSyncProps, setPendingSyncProps] = useState<Set<string>>(new Set());
  const triggerSync = trpc.sync.triggerProperty.useMutation({
    onMutate: ({ propertyId }) => {
      setPendingSyncProps((s) => new Set(s).add(propertyId));
    },
    onSettled: (_d, _e, { propertyId }) => {
      setPendingSyncProps((s) => {
        const next = new Set(s);
        next.delete(propertyId);
        return next;
      });
    },
    onSuccess: () => {
      toast.success('Sync gestartet');
      void utils.sync.statusByProperty.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // Build the per-property sync info map for the calendar grid
  const syncByProperty = useMemo(() => {
    const map = new Map<string, PropertySyncInfo>();
    for (const row of syncStatusQ.data ?? []) {
      if (!row.propertyId) continue;
      const state = mapDbStatusToUi(row.status);
      const ts = row.finishedAt ?? row.startedAt ?? row.scheduledAt;
      map.set(row.propertyId, {
        state,
        lastSyncRelative: ts
          ? formatDistanceToNow(ts, { locale: de, addSuffix: true })
          : null,
        lastError: row.error ?? null,
      });
    }
    return map;
  }, [syncStatusQ.data]);

  // propertyId → dayIdx → effective override cell, for the grid.
  const overridesByProperty = useMemo(() => {
    const map = new Map<string, Map<number, OverrideCell>>();
    for (const o of overridesQ.data ?? []) {
      const idx = differenceInCalendarDays(new Date(`${o.date}T00:00:00`), start);
      if (idx < 0 || idx >= VIEWPORT_DAYS) continue;
      let inner = map.get(o.propertyId);
      if (!inner) {
        inner = new Map();
        map.set(o.propertyId, inner);
      }
      inner.set(idx, {
        rateCents: o.rateCents != null ? Number(o.rateCents) : null,
        minStay: o.minStay,
        stopSell: o.stopSell,
      });
    }
    return map;
  }, [overridesQ.data, start]);

  // propertyId → dayIdx → effective Channex (PriceLabs) rate in cents.
  const externalRatesByProperty = useMemo(() => {
    const map = new Map<string, Map<number, number>>();
    for (const r of externalRatesQ.data ?? []) {
      const idx = differenceInCalendarDays(new Date(`${r.date}T00:00:00`), start);
      if (idx < 0 || idx >= VIEWPORT_DAYS) continue;
      let inner = map.get(r.propertyId);
      if (!inner) {
        inner = new Map();
        map.set(r.propertyId, inner);
      }
      inner.set(idx, r.rateCents);
    }
    return map;
  }, [externalRatesQ.data, start]);

  const isLoading = groupsQ.isLoading || propsQ.isLoading || bookingsQ.isLoading;

  const properties = useMemo(
    () =>
      (propsQ.data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        groupId: p.groupId,
        defaultRateCents: p.defaultRateCents,
        defaultCleaningFeeCents: p.defaultCleaningFeeCents,
        defaultMinStay: p.defaultMinStay,
        currency: p.currency ?? tenant?.defaultCurrency ?? 'EUR',
      })),
    [propsQ.data, tenant?.defaultCurrency],
  );

  const bookings = useMemo(
    () =>
      (bookingsQ.data ?? []).map((b) => ({
        id: b.id,
        propertyId: b.propertyId,
        source: b.source,
        status: b.status,
        guestName: b.guestName,
        guestPhone: b.guestPhone,
        guestEmail: b.guestEmail,
        guestCount: b.guestCount,
        checkin: b.checkin,
        checkout: b.checkout,
        checkinTime: b.checkinTime,
        checkoutTime: b.checkoutTime,
        nightlyRateCents: b.nightlyRateCents,
        cleaningFeeCents: b.cleaningFeeCents,
        cityTaxCents: b.cityTaxCents,
        cityTaxRateBp: b.cityTaxRateBp,
        priceCents: b.priceCents,
        currency: b.currency,
        notes: b.notes,
        channexBookingId: b.channexBookingId,
        otaName: b.otaName,
        autoReviewEnabled: b.autoReviewEnabled,
      })),
    [bookingsQ.data],
  );

  const detailBooking = useMemo(
    () => (detailId ? bookings.find((b) => b.id === detailId) ?? null : null),
    [detailId, bookings],
  );
  const detailProperty = useMemo(
    () =>
      detailBooking
        ? properties.find((p) => p.id === detailBooking.propertyId) ?? null
        : null,
    [detailBooking, properties],
  );

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle={`${format(start, 'd. MMMM', { locale: de })} – ${format(end, 'd. MMMM yyyy', { locale: de })}`}
        action={
          <div className="flex items-center gap-2.5">
            <div
              className="inline-flex rounded-lg border border-line bg-surface p-0.5"
              role="tablist"
              aria-label="Calendar mode"
            >
              {(
                [
                  { id: 'bookings' as const, label: 'Buchungen', icon: CalendarDays },
                  { id: 'rates' as const, label: 'Preise', icon: Tag },
                ]
              ).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={mode === id}
                  onClick={() => setMode(id)}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[7px]',
                    'text-[13px] font-medium transition-colors',
                    mode === id
                      ? 'bg-brand text-white shadow-sm'
                      : 'text-muted hover:text-ink hover:bg-sunken',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                  {label}
                </button>
              ))}
            </div>
            <div className="h-5 w-px bg-line" aria-hidden />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAnchor((d) => subDays(d, 30))}
              iconLeft={<ChevronLeft className="h-4 w-4" />}
              aria-label="Previous month"
            >
              Prev
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAnchor(startOfDay(new Date()))}
            >
              Today
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAnchor((d) => addDays(d, 30))}
              iconRight={<ChevronRight className="h-4 w-4" />}
              aria-label="Next month"
            >
              Next
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <div className="px-8 py-7 space-y-3">
          <Skeleton className="h-10 w-full" />
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : (
        <Calendar
          start={start}
          dayCount={VIEWPORT_DAYS}
          groups={groupsQ.data ?? []}
          properties={properties}
          bookings={bookings}
          syncByProperty={syncByProperty}
          overridesByProperty={overridesByProperty}
          externalRatesByProperty={externalRatesByProperty}
          pendingSyncProperties={pendingSyncProps}
          onSelectRange={(r) =>
            mode === 'rates'
              ? setRateSelection({
                  propertyId: r.propertyId,
                  from: r.checkin,
                  to: r.checkout,
                })
              : setNewBooking(r)
          }
          onBookingClick={(id) => setDetailId(id)}
          onSyncProperty={(propertyId) => triggerSync.mutate({ propertyId })}
        />
      )}

      <NewBookingDialog
        open={!!newBooking || !!editing}
        initial={newBooking}
        editing={editing}
        properties={properties}
        defaultCityTaxRateBp={tenant?.defaultCityTaxRateBp ?? 500}
        defaultCheckinTime={tenant?.defaultCheckinTime ?? '15:00'}
        defaultCheckoutTime={tenant?.defaultCheckoutTime ?? '11:00'}
        defaultCurrency={tenant?.defaultCurrency ?? 'EUR'}
        onClose={() => {
          setNewBooking(null);
          setEditing(null);
        }}
        onCreated={() => {
          utils.bookings.listByRange.invalidate();
          setNewBooking(null);
        }}
        onUpdated={() => {
          utils.bookings.listByRange.invalidate();
          setEditing(null);
        }}
      />

      <RateEditorDialog
        open={!!rateSelection}
        selection={rateSelection}
        propertyName={
          rateSelection
            ? properties.find((p) => p.id === rateSelection.propertyId)?.name ?? null
            : null
        }
        propertyCurrency={
          rateSelection
            ? properties.find((p) => p.id === rateSelection.propertyId)?.currency ??
              tenant?.defaultCurrency ??
              null
            : null
        }
        pricelabsManaged={pricelabsMode}
        onClose={() => setRateSelection(null)}
        onSaved={() => {
          utils.rates.listByRangeAll.invalidate();
          setRateSelection(null);
        }}
      />

      <BookingDetailSheet
        booking={detailBooking}
        propertyName={detailProperty?.name ?? null}
        onClose={() => setDetailId(null)}
        onDeleted={() => {
          utils.bookings.listByRange.invalidate();
          setDetailId(null);
        }}
        onEdit={(b) => {
          setEditing({
            id: b.id,
            source: b.source,
            propertyId: b.propertyId,
            checkin: b.checkin,
            checkout: b.checkout,
            checkinTime: b.checkinTime,
            checkoutTime: b.checkoutTime,
            guestCount: b.guestCount,
            guestName: b.guestName,
            guestPhone: b.guestPhone,
            nightlyRateCents: b.nightlyRateCents,
            cleaningFeeCents: b.cleaningFeeCents,
            notes: b.notes,
            autoReviewEnabled: b.autoReviewEnabled,
          });
          setDetailId(null);
        }}
      />
    </>
  );
}

/**
 * Translate the DB `sync_jobs.status` string into the UI's 4-state model.
 * `queued` and `running` both render as "running" because the button never
 * stays in a queued state long enough to be meaningful.
 */
function mapDbStatusToUi(status: string): SyncState {
  switch (status) {
    case 'queued':
    case 'running':
      return 'running';
    case 'success':
      return 'success';
    case 'failed':
    case 'cancelled':
      return 'error';
    default:
      return 'idle';
  }
}
