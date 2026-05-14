import { useMemo, useState } from 'react';
import { addDays, startOfDay, format, subDays } from 'date-fns';
import { de } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { PageHeader } from './_dashboard';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { Calendar, formatISODate, type SelectionResult } from './calendar/Calendar';
import { NewBookingDialog } from './calendar/NewBookingDialog';
import { BookingDetailSheet } from './calendar/BookingDetailSheet';
import { trpc } from '../lib/trpc';

const VIEWPORT_DAYS = 60;

export function CalendarPage() {
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const start = useMemo(() => subDays(anchor, 7), [anchor]);
  const end = useMemo(() => addDays(start, VIEWPORT_DAYS), [start]);

  const [newBooking, setNewBooking] = useState<SelectionResult | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const meQ = trpc.me.current.useQuery();
  const groupsQ = trpc.propertyGroups.list.useQuery();
  const propsQ = trpc.properties.list.useQuery();
  const bookingsQ = trpc.bookings.listByRange.useQuery({
    from: formatISODate(start),
    to: formatISODate(end),
  });

  const tenant = meQ.data?.memberships[0];

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
        currency: 'EUR',
      })),
    [propsQ.data],
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
          <div className="flex items-center gap-1.5">
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
          onSelectRange={(r) => setNewBooking(r)}
          onBookingClick={(id) => setDetailId(id)}
        />
      )}

      <NewBookingDialog
        open={!!newBooking}
        initial={newBooking}
        properties={properties}
        defaultCityTaxRateBp={tenant?.defaultCityTaxRateBp ?? 500}
        defaultCheckinTime={tenant?.defaultCheckinTime ?? '15:00'}
        defaultCheckoutTime={tenant?.defaultCheckoutTime ?? '11:00'}
        onClose={() => setNewBooking(null)}
        onCreated={() => {
          utils.bookings.listByRange.invalidate();
          setNewBooking(null);
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
      />
    </>
  );
}
