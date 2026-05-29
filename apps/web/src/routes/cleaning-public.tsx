/**
 * Public read-only calendar shared with cleaning staff.
 * Lives at `/cal/:slug` — no auth, no navigation back into the app.
 *
 * The slug is opaque (24-byte random base64url). When the operator
 * "regenerates" or toggles a calendar offline, the route returns NOT_FOUND.
 *
 * Reuses the operator-facing Calendar grid component but drops every
 * editing affordance (no onSelectRange, no onSyncProperty). Booking clicks
 * open a custom read-only sheet that only renders the fields the operator
 * explicitly enabled in the calendar config.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import {
  addDays,
  startOfDay,
  subDays,
  format,
  differenceInCalendarDays,
} from 'date-fns';
import { de } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Lock, Loader2, X } from 'lucide-react';
import { cn } from '@cm/ui';

import { Brand } from '../components/Brand';
import { Button } from '../components/ui/Button';
import { Calendar, formatISODate } from './calendar/Calendar';
import { formatMoney } from '../lib/format-money';
import { trpc } from '../lib/trpc';

const VIEWPORT_DAYS = 30;

export function PublicCleaningCalendarPage() {
  const { slug } = useParams({ strict: false }) as { slug: string };

  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const start = useMemo(() => subDays(anchor, 3), [anchor]);
  const end = useMemo(() => addDays(start, VIEWPORT_DAYS), [start]);

  const q = trpc.cleaningCalendars.getPublic.useQuery(
    {
      slug,
      from: formatISODate(start),
      to: formatISODate(end),
    },
    { retry: false, staleTime: 60_000 },
  );

  const [detailId, setDetailId] = useState<string | null>(null);

  // ── Loading / error states ──────────────────────────────────────────────
  if (q.isLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-canvas">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (q.isError || !q.data) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-canvas px-6 text-center">
        <Lock className="h-8 w-8 text-muted" strokeWidth={1.5} />
        <h1 className="display mt-4 text-[26px] text-ink">
          Diese Seite ist nicht (mehr) erreichbar
        </h1>
        <p className="mt-2 text-[14px] text-muted max-w-md leading-relaxed">
          Der Link wurde entweder erneuert, deaktiviert oder gelöscht. Bitte
          frag deinen Vermieter nach einer neuen URL.
        </p>
      </div>
    );
  }

  const cal = q.data.calendar;
  const properties = q.data.properties;
  const bookingsForCalendar = q.data.bookings.map((b) => ({
    id: b.id,
    propertyId: b.propertyId,
    source: b.source as
      | 'internal'
      | 'airbnb'
      | 'booking_com'
      | 'expedia'
      | 'other_ota'
      | 'block',
    status: b.status,
    guestName: b.guestName,
    checkin: b.checkin,
    checkout: b.checkout,
    priceCents: b.priceCents ? BigInt(b.priceCents) : null,
    currency: b.currency ?? 'EUR',
  }));

  // Adapt properties to Calendar's expected shape (it needs defaultRateCents
  // for cell formatting — we stub since prices aren't shown anyway).
  const propsForCalendar = properties.map((p) => ({
    id: p.id,
    name: p.name,
    groupId: null,
    defaultRateCents: 0n,
    defaultMinStay: 1,
    currency: 'EUR',
  }));

  const detailBooking =
    detailId != null
      ? q.data.bookings.find((b) => b.id === detailId) ?? null
      : null;
  const detailProperty =
    detailBooking != null
      ? properties.find((p) => p.id === detailBooking.propertyId) ?? null
      : null;

  return (
    <div className="min-h-dvh bg-canvas grain flex flex-col text-ink">
      {/* Header — slim, no nav back into the app */}
      <header className="border-b border-line bg-surface/80 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10 py-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Brand showText={false} />
            <div className="min-w-0">
              <div className="display text-[15px] sm:text-[17px] font-medium text-ink leading-tight truncate">
                {cal.name}
              </div>
              <div className="text-[11px] text-muted leading-tight">
                Reinigungs-Übersicht
              </div>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-sunken text-muted text-[10.5px] uppercase tracking-wider font-semibold flex-shrink-0">
            <Lock className="h-3 w-3" strokeWidth={2.5} />
            Read-only
          </span>
        </div>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10 pb-3 flex items-center justify-between gap-2">
          <div className="text-[12.5px] text-muted">
            {format(start, 'd. MMMM', { locale: de })} –{' '}
            {format(end, 'd. MMMM yyyy', { locale: de })}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAnchor((d) => subDays(d, 14))}
              iconLeft={<ChevronLeft className="h-4 w-4" />}
              aria-label="Vorheriger Zeitraum"
            >
              <span className="hidden sm:inline">Vorher</span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAnchor(startOfDay(new Date()))}
            >
              Heute
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAnchor((d) => addDays(d, 14))}
              iconRight={<ChevronRight className="h-4 w-4" />}
              aria-label="Nächster Zeitraum"
            >
              <span className="hidden sm:inline">Nachher</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 min-w-0 overflow-x-auto">
        <Calendar
          start={start}
          dayCount={VIEWPORT_DAYS}
          groups={[]}
          properties={propsForCalendar}
          bookings={bookingsForCalendar}
          onBookingClick={(id) => setDetailId(id)}
        />
      </main>

      {detailBooking && (
        <BookingDetailModal
          booking={detailBooking}
          propertyName={detailProperty?.name ?? '—'}
          showFlags={cal}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}

// ─── Read-only booking detail sheet ─────────────────────────────────────────

interface ShowFlags {
  showGuestName: boolean;
  showGuestCount: boolean;
  showGuestPhone: boolean;
  showGuestEmail: boolean;
  showNotes: boolean;
  showHostNotes: boolean;
  showPrice: boolean;
  showBookingCode: boolean;
}

interface PublicBooking {
  id: string;
  propertyId: string;
  source: string;
  status: string;
  guestName: string | null;
  guestCount: number | null;
  guestPhone: string | null;
  guestEmail: string | null;
  notes: string | null;
  hostNotes: string | null;
  checkin: string;
  checkout: string;
  checkinTime: string | null;
  checkoutTime: string | null;
  priceCents: bigint | number | null;
  currency: string | null;
  bookingCode: string | null;
}

function BookingDetailModal({
  booking,
  propertyName,
  showFlags,
  onClose,
}: {
  booking: PublicBooking;
  propertyName: string;
  showFlags: ShowFlags;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const nights = Math.max(
    1,
    differenceInCalendarDays(
      new Date(`${booking.checkout}T00:00:00`),
      new Date(`${booking.checkin}T00:00:00`),
    ),
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:px-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" />
      <div
        className="relative w-full sm:max-w-[460px] bg-surface rounded-t-2xl sm:rounded-xl shadow-lg border border-line animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-6 pt-6 pb-4">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted font-medium">
              {propertyName}
            </div>
            <h2 className="display text-[20px] font-medium text-ink leading-tight truncate mt-1">
              {showFlags.showGuestName && booking.guestName
                ? booking.guestName
                : 'Buchung'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-ink p-1"
            aria-label="Schließen"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 pb-6 space-y-3.5 text-[13.5px]">
          <DetailRow label="Aufenthalt">
            <div className="text-ink">
              {format(new Date(`${booking.checkin}T00:00:00`), 'EEE d. MMM yyyy', {
                locale: de,
              })}
              {' → '}
              {format(new Date(`${booking.checkout}T00:00:00`), 'EEE d. MMM yyyy', {
                locale: de,
              })}
              <span className="ml-2 text-muted">· {nights} Nächte</span>
            </div>
          </DetailRow>

          {(booking.checkinTime || booking.checkoutTime) && (
            <DetailRow label="Zeiten">
              <span className="num text-ink">
                {booking.checkinTime ?? '—'} → {booking.checkoutTime ?? '—'}
              </span>
            </DetailRow>
          )}

          {showFlags.showGuestCount && booking.guestCount != null && (
            <DetailRow label="Gäste">
              <span className="num text-ink">{booking.guestCount}</span>
            </DetailRow>
          )}
          {showFlags.showGuestPhone && booking.guestPhone && (
            <DetailRow label="Telefon">
              <a
                href={`tel:${booking.guestPhone}`}
                className="text-ink underline-offset-2 hover:underline"
              >
                {booking.guestPhone}
              </a>
            </DetailRow>
          )}
          {showFlags.showGuestEmail && booking.guestEmail && (
            <DetailRow label="E-Mail">
              <a
                href={`mailto:${booking.guestEmail}`}
                className="text-ink underline-offset-2 hover:underline truncate inline-block max-w-full"
              >
                {booking.guestEmail}
              </a>
            </DetailRow>
          )}
          {showFlags.showPrice && booking.priceCents != null && (
            <DetailRow label="Preis">
              <span className="num text-ink">
                {formatMoney(
                  typeof booking.priceCents === 'bigint'
                    ? Number(booking.priceCents)
                    : booking.priceCents,
                  booking.currency,
                )}
              </span>
            </DetailRow>
          )}
          {showFlags.showBookingCode && booking.bookingCode && (
            <DetailRow label="Buchungscode">
              <span className="num font-mono text-ink">{booking.bookingCode}</span>
            </DetailRow>
          )}
          {showFlags.showNotes && booking.notes && (
            <DetailRow label="Notiz Gast">
              <div className="text-ink leading-relaxed whitespace-pre-line">
                {booking.notes}
              </div>
            </DetailRow>
          )}
          {showFlags.showHostNotes && booking.hostNotes && (
            <DetailRow label="Notiz Host">
              <div className="text-ink leading-relaxed whitespace-pre-line">
                {booking.hostNotes}
              </div>
            </DetailRow>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted font-medium">
        {label}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}
