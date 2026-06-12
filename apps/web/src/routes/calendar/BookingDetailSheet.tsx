import { useEffect, useState } from 'react';
import { differenceInCalendarDays, format } from 'date-fns';
import { de } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  Calendar as CalIcon,
  Check,
  ChevronDown,
  Clock,
  Copy,
  Mail,
  MessageSquare,
  Pencil,
  Phone,
  Star,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { cn } from '@cm/ui';

import { Button } from '../../components/ui/Button';
import { Switch } from '../../components/ui/Switch';
import { formatMoney } from '../../lib/format-money';
import { trpc } from '../../lib/trpc';
import type { BookingSource } from './BookingBlock';
import { InvoiceSection } from './InvoiceSection';

interface Booking {
  id: string;
  propertyId: string;
  source: BookingSource;
  status: string;
  guestName: string | null;
  guestPhone?: string | null;
  guestEmail?: string | null;
  guestCount?: number | null;
  checkin: string;
  checkout: string;
  checkinTime?: string | null;
  checkoutTime?: string | null;
  nightlyRateCents?: bigint | null;
  cleaningFeeCents?: bigint | null;
  cityTaxCents?: bigint | null;
  cityTaxRateBp?: number | null;
  priceCents: bigint | null;
  currency: string;
  notes?: string | null;
  channexBookingId?: string | null;
  otaName?: string | null;
  autoReviewEnabled?: boolean | null;
}

interface Props {
  booking: Booking | null;
  propertyName: string | null;
  onClose: () => void;
  onDeleted: () => void;
  onEdit?: (booking: Booking) => void;
}

const SOURCE_META: Record<
  BookingSource,
  { label: string; badge: string; dot: string }
> = {
  internal:    { label: 'Intern',         badge: 'bg-[rgb(176_67_28_/_0.1)] text-[rgb(140_47_16)] border-[rgb(176_67_28_/_0.35)]',  dot: 'bg-brand' },
  airbnb:      { label: 'Airbnb',         badge: 'bg-[rgb(229_70_70_/_0.1)] text-[rgb(162_37_37)] border-[rgb(229_70_70_/_0.35)]', dot: 'bg-[rgb(229_70_70)]' },
  booking_com: { label: 'Booking.com',    badge: 'bg-[rgb(36_67_135_/_0.1)] text-[rgb(36_67_135)] border-[rgb(36_67_135_/_0.35)]', dot: 'bg-[rgb(36_67_135)]' },
  expedia:     { label: 'Expedia',        badge: 'bg-[rgb(252_201_45_/_0.12)] text-[rgb(120_92_18)] border-[rgb(176_135_30_/_0.35)]', dot: 'bg-[rgb(220_170_40)]' },
  other_ota:   { label: 'OTA',            badge: 'bg-sunken text-ink-soft border-line', dot: 'bg-muted' },
  block:       { label: 'Sperre',         badge: 'bg-sunken text-muted border-line', dot: 'bg-muted' },
};

const STATUS_META: Record<string, { label: string; className: string }> = {
  draft:        { label: 'Entwurf',        className: 'text-muted' },
  confirmed:    { label: 'Bestätigt',      className: 'text-positive' },
  pending_sync: { label: 'Sync ausstehend',className: 'text-warning' },
  synced:       { label: 'Synchronisiert', className: 'text-positive' },
  sync_failed:  { label: 'Sync fehlgeschlagen', className: 'text-danger' },
  cancelled:    { label: 'Storniert',      className: 'text-muted line-through' },
  blocked:      { label: 'Geblockt',       className: 'text-muted' },
};

export function BookingDetailSheet({
  booking,
  propertyName,
  onClose,
  onDeleted,
  onEdit,
}: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  // ESC to close + cleanup confirm state
  useEffect(() => {
    if (!booking) {
      setConfirmDelete(false);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmDelete) setConfirmDelete(false);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [booking, onClose, confirmDelete]);

  const del = trpc.bookings.delete.useMutation({
    onSuccess: () => {
      toast.success('Buchung gelöscht');
      onDeleted();
    },
    onError: (e) => toast.error(e.message),
  });

  // Real money figures (gross vs. payout vs. OTA commission), resolved
  // server-side from the Channex payload — see services/booking-amounts.ts.
  const financialsQ = trpc.bookings.byId.useQuery(
    { id: booking?.id ?? '' },
    { enabled: !!booking },
  );

  if (!booking) return null;

  const source = SOURCE_META[booking.source];
  const status = STATUS_META[booking.status] ?? { label: booking.status, className: 'text-muted' };
  const nights = differenceInCalendarDays(
    new Date(booking.checkout),
    new Date(booking.checkin),
  );
  const isExternal =
    booking.source === 'airbnb' ||
    booking.source === 'booking_com' ||
    booking.source === 'expedia' ||
    booking.source === 'other_ota';

  const price =
    booking.priceCents != null
      ? formatPrice(Number(booking.priceCents), booking.currency)
      : null;
  const perNight =
    booking.priceCents != null && nights > 0
      ? formatPrice(Number(booking.priceCents) / nights, booking.currency)
      : null;

  // For OTA bookings: show the guest-paid GROSS + OTA commission + payout,
  // not just the payout. Only when gross and payout genuinely differ.
  const fin = financialsQ.data?.financials ?? null;
  const payoutBreakdown =
    isExternal &&
    fin &&
    fin.grossCents != null &&
    fin.payoutCents != null &&
    fin.grossCents !== fin.payoutCents
      ? {
          gross: fin.grossCents,
          commission: fin.commissionCents,
          payout: fin.payoutCents,
          note: fin.note,
        }
      : null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-[2px] animate-fade-up"
        onClick={onClose}
      />

      {/* Sheet */}
      <aside
        className={cn(
          'fixed z-50 bg-surface border-l border-line shadow-lg',
          'inset-y-0 right-0 w-full sm:max-w-[440px]',
          'flex flex-col animate-fade-up',
        )}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-line">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span aria-hidden className={cn('h-2 w-2 rounded-sm', source.dot)} />
              <span className={cn('text-[10.5px] uppercase tracking-widest font-semibold px-1.5 py-0.5 rounded border', source.badge)}>
                {source.label}
              </span>
              <span className={cn('text-[11px] font-medium', status.className)}>
                {status.label}
              </span>
            </div>
            <h2 className="display text-[22px] font-medium text-ink leading-tight truncate">
              {booking.source === 'block' ? 'Sperre' : (booking.guestName ?? 'Unbekannter Gast')}
            </h2>
            {propertyName && (
              <div className="mt-1 text-[12.5px] text-muted truncate">
                {propertyName}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 h-8 w-8 rounded-md flex items-center justify-center text-muted hover:bg-sunken hover:text-ink transition-colors"
            aria-label="Schließen"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Dates */}
          <Section icon={<CalIcon className="h-4 w-4" />} label="Aufenthalt">
            <div className="flex items-baseline gap-3 mb-2">
              <DateBlock
                weekday={format(new Date(booking.checkin), 'EE', { locale: de })}
                day={format(new Date(booking.checkin), 'd')}
                month={format(new Date(booking.checkin), 'MMM yyyy', { locale: de })}
                time={booking.checkinTime ?? null}
              />
              <span className="text-whisper">→</span>
              <DateBlock
                weekday={format(new Date(booking.checkout), 'EE', { locale: de })}
                day={format(new Date(booking.checkout), 'd')}
                month={format(new Date(booking.checkout), 'MMM yyyy', { locale: de })}
                time={booking.checkoutTime ?? null}
              />
            </div>
            <div className="flex items-center gap-3 text-[12.5px] text-muted">
              <span>
                <span className="num">{nights}</span>{' '}
                {nights === 1 ? 'Nacht' : 'Nächte'}
              </span>
              {booking.guestCount != null && booking.guestCount > 0 && (
                <span className="flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  <span className="num">{booking.guestCount}</span>{' '}
                  {booking.guestCount === 1 ? 'Gast' : 'Gäste'}
                </span>
              )}
            </div>
          </Section>

          {/* Guest contact */}
          {booking.source !== 'block' && (booking.guestPhone || booking.guestEmail) && (
            <Section label="Kontakt">
              {booking.guestPhone && (
                <a
                  href={`tel:${booking.guestPhone}`}
                  className="flex items-center gap-2.5 text-[13.5px] text-ink hover:text-brand py-1.5 transition-colors"
                >
                  <Phone className="h-3.5 w-3.5 text-muted" />
                  <span className="num">{booking.guestPhone}</span>
                </a>
              )}
              {booking.guestEmail && (
                <a
                  href={`mailto:${booking.guestEmail}`}
                  className="flex items-center gap-2.5 text-[13.5px] text-ink hover:text-brand py-1.5 transition-colors"
                >
                  <Mail className="h-3.5 w-3.5 text-muted" />
                  <span>{booking.guestEmail}</span>
                </a>
              )}
            </Section>
          )}

          {/* Price */}
          {price && (
            <Section label="Preis">
              {/* Breakdown when we have the line items, fall back to total only */}
              {booking.nightlyRateCents != null ? (
                <div className="rounded-md border border-line bg-canvas/60 px-4 py-3 space-y-1.5">
                  <BreakdownRow
                    label="Übernachtung"
                    detail={
                      <>
                        <span className="num">
                          {formatPriceCents(Number(booking.nightlyRateCents), booking.currency)}
                        </span>
                        {' × '}
                        <span className="num">{nights}</span>{' '}
                        {nights === 1 ? 'Nacht' : 'Nächte'}
                      </>
                    }
                    valueCents={Number(booking.nightlyRateCents) * nights}
                    currency={booking.currency}
                  />
                  {booking.cleaningFeeCents != null && Number(booking.cleaningFeeCents) > 0 && (
                    <BreakdownRow
                      label="Reinigung"
                      valueCents={Number(booking.cleaningFeeCents)}
                      currency={booking.currency}
                    />
                  )}
                  {booking.cityTaxCents != null && Number(booking.cityTaxCents) > 0 && (
                    <BreakdownRow
                      label="Übernachtungssteuer"
                      detail={
                        booking.cityTaxRateBp != null ? (
                          <span className="num">
                            {(booking.cityTaxRateBp / 100).toFixed(
                              booking.cityTaxRateBp % 100 === 0 ? 0 : 2,
                            )}
                            %
                          </span>
                        ) : null
                      }
                      valueCents={Number(booking.cityTaxCents)}
                      currency={booking.currency}
                    />
                  )}
                  <div className="border-t border-line pt-2 mt-1 flex items-baseline justify-between">
                    <span className="text-[13px] font-semibold text-ink">Gesamt</span>
                    <span className="display num text-[22px] font-medium text-ink leading-none">
                      {price}
                    </span>
                  </div>
                </div>
              ) : payoutBreakdown ? (
                <div className="rounded-md border border-line bg-canvas/60 px-4 py-3 space-y-1.5">
                  <BreakdownRow
                    label="Brutto (Gast)"
                    valueCents={payoutBreakdown.gross}
                    currency={booking.currency}
                  />
                  {payoutBreakdown.commission != null && payoutBreakdown.commission > 0 && (
                    <BreakdownRow
                      label="OTA-Provision"
                      valueCents={payoutBreakdown.commission}
                      currency={booking.currency}
                    />
                  )}
                  <div className="border-t border-line pt-2 mt-1 flex items-baseline justify-between">
                    <span className="text-[13px] font-semibold text-ink">Auszahlung</span>
                    <span className="display num text-[20px] font-medium text-ink leading-none">
                      {formatPrice(payoutBreakdown.payout, booking.currency)}
                    </span>
                  </div>
                  {payoutBreakdown.note && (
                    <p className="text-[11px] text-whisper pt-1 leading-snug">
                      {payoutBreakdown.note}
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex items-baseline gap-3">
                  <span className="num text-[22px] text-ink leading-none">{price}</span>
                  {perNight && (
                    <span className="text-[12px] text-muted">
                      <span className="num">{perNight}</span> / Nacht
                    </span>
                  )}
                </div>
              )}
            </Section>
          )}

          {/* Invoice (guest-facing Rechnung) */}
          {booking.source !== 'block' && (
            <InvoiceSection bookingId={booking.id} guestName={booking.guestName} />
          )}

          {/* External booking metadata */}
          {isExternal && booking.otaName && (
            <Section label="OTA-Daten">
              <div className="text-[12.5px] text-muted space-y-0.5">
                <div>
                  Quelle: <span className="text-ink">{booking.otaName}</span>
                </div>
                {booking.channexBookingId && (
                  <div className="num truncate">
                    ID: {booking.channexBookingId}
                  </div>
                )}
                <div className="text-[11.5px] text-whisper mt-1">
                  Direkt-Bearbeitung erfolgt in {booking.otaName} oder Channex.
                </div>
              </div>
            </Section>
          )}

          {/* Notes */}
          {booking.notes && (
            <Section label="Notiz">
              <p className="text-[13.5px] text-ink-soft whitespace-pre-wrap leading-relaxed">
                {booking.notes}
              </p>
            </Section>
          )}

          {/* Message timeline (guest bookings only) */}
          {booking.source !== 'block' && (
            <MessagesSection bookingId={booking.id} />
          )}

          {/* Guest chat + AI drafts (guest bookings only) */}
          {booking.source !== 'block' && (
            <GuestChatSection bookingId={booking.id} />
          )}

          {/* Auto-review status (guest bookings only) */}
          {booking.source !== 'block' && booking.autoReviewEnabled != null && (
            <Section label="Automatisierung">
              <div className="flex items-center gap-2.5 text-[13px]">
                <span
                  className={cn(
                    'inline-flex items-center justify-center h-6 w-6 rounded-full flex-shrink-0',
                    booking.autoReviewEnabled
                      ? 'bg-brand-soft text-brand'
                      : 'bg-sunken text-muted',
                  )}
                >
                  <Star className="h-3 w-3" strokeWidth={2} />
                </span>
                <span className={booking.autoReviewEnabled ? 'text-ink' : 'text-muted'}>
                  {booking.autoReviewEnabled
                    ? 'Auto-Bewertung 3 Tage nach Abreise'
                    : 'Auto-Bewertung deaktiviert'}
                </span>
              </div>
            </Section>
          )}
        </div>

        {/* Footer actions */}
        <div className="border-t border-line px-6 py-4">
          {confirmDelete ? (
            <div className="space-y-2">
              <p className="text-[12.5px] text-ink-soft leading-snug">
                {isExternal
                  ? 'Buchung als storniert markieren? Die Tage werden auf den verbundenen Plattformen wieder freigegeben (Phase 5 führt den Sync aus).'
                  : 'Wirklich löschen?'}
              </p>
              <div className="flex items-center justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                  Abbrechen
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  loading={del.isPending}
                  onClick={() => del.mutate({ id: booking.id })}
                >
                  {isExternal ? 'Stornieren' : 'Löschen'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="danger"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                iconLeft={<Trash2 className="h-3.5 w-3.5" />}
              >
                {isExternal ? 'Stornieren' : 'Löschen'}
              </Button>
              {onEdit && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onEdit(booking)}
                  iconLeft={<Pencil className="h-3.5 w-3.5" />}
                >
                  Bearbeiten
                </Button>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function Section({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-whisper mb-2">
        {icon}
        {label}
      </div>
      {children}
    </section>
  );
}

const DISPATCH_ROLE_LABEL: Record<string, string> = {
  cleaner: 'Reinigung',
  handyman: 'Hausmeister',
  other: 'Team',
};

function GuestChatSection({ bookingId }: { bookingId: string }) {
  const utils = trpc.useUtils();
  const q = trpc.guestMessages.thread.useQuery({ bookingId });
  const invalidate = () => utils.guestMessages.thread.invalidate({ bookingId });
  const approve = trpc.guestMessages.approveDraft.useMutation({
    onSuccess: () => {
      void invalidate();
      toast.success('Gesendet');
    },
    onError: (e) => toast.error(e.message),
  });
  const dismiss = trpc.guestMessages.dismissDraft.useMutation({
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState('');

  const messages = q.data?.messages ?? [];
  const dispatches = q.data?.dispatches ?? [];
  const convo = messages.filter((m) => m.status !== 'draft' && m.status !== 'dismissed');
  const draft = messages.find((m) => m.status === 'draft');

  // Nothing ingested yet → don't render the section at all.
  if (!q.isLoading && convo.length === 0 && !draft && dispatches.length === 0) return null;

  const fmt = (d: string | Date | null) =>
    d ? format(new Date(d), 'dd.MM. HH:mm', { locale: de }) : '';

  return (
    <Section label="Gast-Chat (KI)" icon={<MessageSquare className="h-3.5 w-3.5" />}>
      {q.isLoading ? (
        <div className="h-16 w-full animate-pulse rounded-lg bg-sunken" />
      ) : (
        <>
          <div className="space-y-2">
            {convo.map((m) => {
              const mine = m.direction === 'outbound';
              return (
                <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                  <div
                    className={cn(
                      'max-w-[85%] rounded-lg px-3 py-2 text-[12.5px] leading-relaxed',
                      mine ? 'bg-brand-soft text-ink' : 'bg-sunken text-ink',
                    )}
                  >
                    {m.sender === 'ai' && (
                      <span className="mb-0.5 block text-[9.5px] font-medium uppercase tracking-wider text-brand">
                        KI
                      </span>
                    )}
                    <span className="whitespace-pre-wrap">{m.body}</span>
                    <span className="mt-1 block text-[10px] text-whisper">
                      {fmt(m.otaCreatedAt ?? m.createdAt)}
                      {m.status === 'failed' ? ' · fehlgeschlagen' : ''}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {draft && (
            <div className="mt-3 rounded-lg border border-brand/30 bg-brand-soft/30 p-3">
              <div className="text-[9.5px] font-medium uppercase tracking-wider text-brand">
                KI-Entwurf · zur Freigabe
              </div>
              {editing ? (
                <textarea
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  rows={4}
                  maxLength={4000}
                  autoFocus
                  className="mt-1.5 w-full resize-y rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] leading-relaxed text-ink focus:border-ink focus:outline-none"
                />
              ) : (
                <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink">
                  {draft.body}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {editing ? (
                  <>
                    <Button
                      size="sm"
                      variant="brand"
                      loading={approve.isPending}
                      disabled={draftText.trim().length === 0}
                      onClick={() => approve.mutate({ id: draft.id, body: draftText.trim() })}
                    >
                      Bearbeitet senden
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                      Abbrechen
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="brand"
                      loading={approve.isPending}
                      onClick={() => approve.mutate({ id: draft.id })}
                    >
                      Senden
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setDraftText(draft.body);
                        setEditing(true);
                      }}
                    >
                      Bearbeiten
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={dismiss.isPending}
                      onClick={() => dismiss.mutate({ id: draft.id })}
                    >
                      Verwerfen
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}

          {dispatches.length > 0 && (
            <div className="mt-3 space-y-1 border-t border-line pt-2">
              <div className="text-[10px] uppercase tracking-widest text-whisper">
                KI-Benachrichtigungen ans Team
              </div>
              {dispatches.map((d) => (
                <div key={d.id} className="flex items-start gap-1.5 text-[11.5px] text-ink-soft">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand" />
                  <span>
                    <span className="font-medium text-ink">
                      {DISPATCH_ROLE_LABEL[d.role] ?? d.role}
                    </span>{' '}
                    informiert: {d.summary}
                    {d.urgency ? ` (${d.urgency})` : ''}
                    {d.status !== 'sent' ? ` — ${d.status}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Section>
  );
}

const MSG_CHANNEL_LABEL: Record<string, string> = {
  sms: 'SMS',
  airbnb: 'Airbnb',
  booking_com: 'Booking.com',
  email: 'E-Mail',
};

const MSG_STATUS_META: Record<
  string,
  { label: string; group: 'sent' | 'planned' | 'failed' | 'off' | 'attention'; cls: string }
> = {
  delivered: { label: 'Zugestellt', group: 'sent', cls: 'text-positive' },
  sent: { label: 'Gesendet', group: 'sent', cls: 'text-positive' },
  sending: { label: 'Wird gesendet', group: 'planned', cls: 'text-warning' },
  queued: { label: 'In Warteschlange', group: 'planned', cls: 'text-warning' },
  // Due within the 2-day grace window → the next dispatch run sends it.
  pending: { label: 'Sendet in Kürze', group: 'planned', cls: 'text-warning' },
  planned: { label: 'Geplant', group: 'planned', cls: 'text-muted' },
  // Due longer ago than the grace window → will NOT auto-send; needs a manual send.
  overdue: { label: 'Überfällig – manuell senden', group: 'attention', cls: 'text-warning' },
  // No due time for this booking (e.g. a last-minute trigger that didn't qualify).
  skipped: { label: 'Nicht zutreffend', group: 'off', cls: 'text-muted' },
  failed: { label: 'Fehlgeschlagen', group: 'failed', cls: 'text-danger' },
  off: { label: 'Aus', group: 'off', cls: 'text-muted' },
};

const MSG_GROUP_ORDER: Array<{
  key: 'sent' | 'planned' | 'failed' | 'off' | 'attention';
  label: string;
}> = [
  { key: 'attention', label: 'Aktion nötig' },
  { key: 'planned', label: 'Geplant' },
  { key: 'sent', label: 'Gesendet' },
  { key: 'failed', label: 'Fehlgeschlagen' },
  { key: 'off', label: 'Inaktiv' },
];

function MessagesSection({ bookingId }: { bookingId: string }) {
  const utils = trpc.useUtils();
  const q = trpc.messages.timelineForBooking.useQuery({ bookingId });
  const setOverride = trpc.messages.setBookingOverride.useMutation({
    onSuccess: () => utils.messages.timelineForBooking.invalidate({ bookingId }),
    onError: (e) => toast.error(e.message),
  });
  const sendNow = trpc.messages.sendNow.useMutation({
    onSuccess: () => {
      utils.messages.timelineForBooking.invalidate({ bookingId });
      toast.success('Nachricht an den Gast gesendet.');
    },
    onError: (e) => toast.error(e.message),
  });

  // Which message previews are expanded, and which body was just copied.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  async function copyBody(key: string, body: string) {
    try {
      await navigator.clipboard.writeText(body);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1400);
      toast.success('Nachricht kopiert');
    } catch {
      toast.error('Kopieren fehlgeschlagen');
    }
  }

  return (
    <Section icon={<MessageSquare className="h-4 w-4" />} label="Nachrichten">
      {q.isLoading ? (
        <div className="text-[12.5px] text-muted">Lädt…</div>
      ) : !q.data || q.data.length === 0 ? (
        <p className="text-[12.5px] text-muted">
          Keine automatischen Nachrichten für diese Buchung.
        </p>
      ) : (
        <div className="space-y-3">
          {MSG_GROUP_ORDER.map(({ key, label }) => {
            const group = q.data!.filter(
              (i) => (MSG_STATUS_META[i.status]?.group ?? 'planned') === key,
            );
            if (group.length === 0) return null;
            return (
              <div key={key}>
                <div className="text-[10px] uppercase tracking-widest text-whisper mb-1.5">
                  {label}
                </div>
                <ul className="space-y-1.5">
                  {group.map((i) => {
                    const meta =
                      MSG_STATUS_META[i.status] ?? MSG_STATUS_META.planned!;
                    const when = i.at
                      ? format(new Date(i.at), 'd. MMM, HH:mm', { locale: de })
                      : null;
                    const togglable = i.templateId != null;
                    return (
                      <li
                        key={i.key}
                        className="rounded-md border border-line bg-canvas/60 px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium text-ink truncate flex-1">
                            {i.title}
                          </span>
                          <span className="text-[10px] uppercase tracking-wider text-muted">
                            {MSG_CHANNEL_LABEL[i.channel] ?? i.channel}
                          </span>
                          <span
                            className={cn(
                              'text-[11px] font-medium flex-shrink-0',
                              meta.cls,
                            )}
                          >
                            {meta.label}
                          </span>
                          {togglable && (
                            <Switch
                              size="sm"
                              checked={i.enabled}
                              disabled={setOverride.isPending}
                              onChange={(next) =>
                                setOverride.mutate({
                                  bookingId,
                                  templateId: i.templateId!,
                                  enabled: next,
                                })
                              }
                              aria-label="Für diese Buchung an/aus"
                            />
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted">
                          {i.trigger && <span className="num">{i.trigger}</span>}
                          {when && <span>· {when}</span>}
                          {i.overridden && (
                            <button
                              type="button"
                              className="text-brand hover:underline"
                              onClick={() =>
                                setOverride.mutate({
                                  bookingId,
                                  templateId: i.templateId!,
                                  enabled: null,
                                })
                              }
                            >
                              · Override · auf Apartment-Standard
                            </button>
                          )}
                          {/* Manual send — works for any template-backed,
                              sendable channel; re-send asks for confirmation. */}
                          {i.templateId &&
                            i.channel !== 'email' &&
                            i.status !== 'queued' &&
                            i.status !== 'sending' && (
                              <button
                                type="button"
                                className="text-brand hover:underline disabled:opacity-50"
                                disabled={sendNow.isPending}
                                onClick={() => {
                                  const alreadySent =
                                    i.status === 'sent' || i.status === 'delivered';
                                  if (
                                    alreadySent &&
                                    !window.confirm(
                                      'Diese Nachricht wurde bereits gesendet. Erneut an den Gast senden?',
                                    )
                                  )
                                    return;
                                  sendNow.mutate({
                                    bookingId,
                                    templateId: i.templateId!,
                                    force: alreadySent,
                                  });
                                }}
                              >
                                ·{' '}
                                {i.status === 'sent' || i.status === 'delivered'
                                  ? 'Erneut senden'
                                  : 'Jetzt senden'}
                              </button>
                            )}
                          {i.body && (
                            <button
                              type="button"
                              className="inline-flex items-center gap-0.5 text-muted hover:text-ink"
                              onClick={() => toggle(i.key)}
                              aria-expanded={expanded.has(i.key)}
                            >
                              <ChevronDown
                                className={cn(
                                  'h-3 w-3 transition-transform',
                                  expanded.has(i.key) && 'rotate-180',
                                )}
                                strokeWidth={2}
                              />
                              Vorschau
                            </button>
                          )}
                        </div>
                        {i.error && (
                          <div className="text-[11px] text-danger mt-1 num">
                            {i.error}
                          </div>
                        )}
                        {i.body && expanded.has(i.key) && (
                          <div className="mt-2 rounded-md border border-line bg-surface px-3 py-2.5">
                            <div className="mb-1.5 flex items-center justify-between gap-2">
                              <span className="text-[10px] uppercase tracking-widest text-whisper">
                                Vorschau
                              </span>
                              <button
                                type="button"
                                onClick={() => copyBody(i.key, i.body)}
                                className={cn(
                                  'inline-flex items-center gap-1 text-[11px] font-medium',
                                  copiedKey === i.key
                                    ? 'text-positive'
                                    : 'text-brand hover:underline',
                                )}
                              >
                                {copiedKey === i.key ? (
                                  <>
                                    <Check className="h-3 w-3" strokeWidth={2.5} /> Kopiert
                                  </>
                                ) : (
                                  <>
                                    <Copy className="h-3 w-3" strokeWidth={1.75} /> Kopieren
                                  </>
                                )}
                              </button>
                            </div>
                            <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-ink-soft">
                              {i.body}
                            </p>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function DateBlock({
  weekday,
  day,
  month,
  time,
}: {
  weekday: string;
  day: string;
  month: string;
  time: string | null;
}) {
  return (
    <div className="rounded-md border border-line px-3 py-2 bg-canvas min-w-[88px]">
      <div className="text-[10px] uppercase tracking-wider text-muted leading-none">
        {weekday}
      </div>
      <div className="num text-[20px] text-ink leading-none mt-1">{day}</div>
      <div className="text-[10.5px] text-muted leading-none mt-0.5">{month}</div>
      {time && (
        <div className="flex items-center gap-1 mt-1.5 text-[10.5px] text-muted">
          <Clock className="h-2.5 w-2.5" strokeWidth={2} />
          <span className="num">{time}</span>
        </div>
      )}
    </div>
  );
}

function BreakdownRow({
  label,
  detail,
  valueCents,
  currency,
}: {
  label: string;
  detail?: React.ReactNode;
  valueCents: number;
  currency: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
      <div className="text-ink-soft">
        <span>{label}</span>
        {detail && <span className="ml-2 text-muted">{detail}</span>}
      </div>
      <span className="num text-ink">{formatPriceCents(valueCents, currency)}</span>
    </div>
  );
}

function formatPrice(cents: number, currency: string): string {
  return formatMoney(cents, currency);
}

function formatPriceCents(cents: number, currency: string): string {
  return formatMoney(cents, currency);
}
