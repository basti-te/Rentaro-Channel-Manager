import { useMemo, useState } from 'react';
import { addDays, startOfDay, format, subDays } from 'date-fns';
import { de } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { PageHeader } from './_dashboard';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { Calendar, formatISODate } from './calendar/Calendar';
import { trpc } from '../lib/trpc';

const VIEWPORT_DAYS = 60; // ~2 months visible

export function CalendarPage() {
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const start = useMemo(() => subDays(anchor, 7), [anchor]); // 1 week padding before today
  const end = useMemo(() => addDays(start, VIEWPORT_DAYS), [start]);

  const groupsQ = trpc.propertyGroups.list.useQuery();
  const propsQ = trpc.properties.list.useQuery();
  const bookingsQ = trpc.bookings.listByRange.useQuery({
    from: formatISODate(start),
    to: formatISODate(end),
  });

  const isLoading = groupsQ.isLoading || propsQ.isLoading || bookingsQ.isLoading;

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
          properties={(propsQ.data ?? []).map((p) => ({
            id: p.id,
            name: p.name,
            groupId: p.groupId,
            defaultRateCents: p.defaultRateCents,
            defaultMinStay: p.defaultMinStay,
            currency: 'EUR',
          }))}
          bookings={(bookingsQ.data ?? []).map((b) => ({
            id: b.id,
            propertyId: b.propertyId,
            source: b.source,
            status: b.status,
            guestName: b.guestName,
            checkin: b.checkin,
            checkout: b.checkout,
            priceCents: b.priceCents,
            currency: b.currency,
          }))}
        />
      )}
    </>
  );
}
