import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { addDays, differenceInCalendarDays, format } from 'date-fns';
import { de } from 'date-fns/locale';
import { toast } from 'sonner';
import { Lock, User, Users } from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Label } from '../../components/ui/Label';
import { Switch } from '../../components/ui/Switch';
import { trpc } from '../../lib/trpc';
import { cn } from '@cm/ui';
import type { BookingSource } from './BookingBlock';

type Mode = 'guest' | 'block';

interface Property {
  id: string;
  name: string;
  groupId: string | null;
  defaultRateCents: bigint | number | null;
  defaultCleaningFeeCents?: bigint | number | null;
  defaultMinStay: number;
}

/** Subset of a Booking needed to pre-fill the edit form. */
export interface EditingBooking {
  id: string;
  source: BookingSource;
  propertyId: string;
  checkin: string;
  checkout: string;
  checkinTime?: string | null;
  checkoutTime?: string | null;
  guestCount?: number | null;
  guestName?: string | null;
  guestPhone?: string | null;
  nightlyRateCents?: bigint | null;
  cleaningFeeCents?: bigint | null;
  notes?: string | null;
  autoReviewEnabled?: boolean | null;
}

interface Props {
  open: boolean;
  /** Pre-filled selection from the calendar — used in CREATE mode. */
  initial: {
    propertyId: string;
    checkin: string;
    checkout: string;
  } | null;
  /** When present, the dialog is in EDIT mode and fields are pre-filled. */
  editing?: EditingBooking | null;
  properties: Property[];
  /** Tenant-default city-tax rate in basis points (e.g. 500 = 5%). */
  defaultCityTaxRateBp?: number;
  defaultCheckinTime?: string;
  defaultCheckoutTime?: string;
  onClose: () => void;
  onCreated: () => void;
  onUpdated?: () => void;
}

export function NewBookingDialog({
  open,
  initial,
  editing,
  properties,
  defaultCityTaxRateBp = 500,
  defaultCheckinTime = '15:00',
  defaultCheckoutTime = '11:00',
  onClose,
  onCreated,
  onUpdated,
}: Props) {
  const isEdit = !!editing;
  const externalSource = editing
    ? (editing.source === 'airbnb' ||
        editing.source === 'booking_com' ||
        editing.source === 'expedia' ||
        editing.source === 'other_ota')
    : false;
  const [mode, setMode] = useState<Mode>('guest');
  const [propertyId, setPropertyId] = useState('');
  const [checkin, setCheckin] = useState('');
  const [checkout, setCheckout] = useState('');
  const [checkinTime, setCheckinTime] = useState(defaultCheckinTime);
  const [checkoutTime, setCheckoutTime] = useState(defaultCheckoutTime);
  // String state so the field can be cleared / freely typed.
  // Parsed to a number on submit (fallback 1).
  const [guestCount, setGuestCount] = useState('2');

  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');

  // Money inputs are strings so user can type freely; parsed on submit
  const [nightlyEuro, setNightlyEuro] = useState('');
  const [cleaningEuro, setCleaningEuro] = useState('');

  const [notes, setNotes] = useState('');
  const [autoReview, setAutoReview] = useState(true);

  // Reset on open — handles both CREATE (from initial) and EDIT (from editing)
  useEffect(() => {
    if (!open) return;

    if (editing) {
      // EDIT mode — fill all fields from the existing booking
      setMode(editing.source === 'block' ? 'block' : 'guest');
      setPropertyId(editing.propertyId);
      setCheckin(editing.checkin);
      setCheckout(editing.checkout);
      setCheckinTime(editing.checkinTime ?? defaultCheckinTime);
      setCheckoutTime(editing.checkoutTime ?? defaultCheckoutTime);
      setGuestCount(String(editing.guestCount ?? 1));
      setGuestName(editing.guestName ?? '');
      setGuestPhone(editing.guestPhone ?? '');
      setNotes(editing.notes ?? '');
      setAutoReview(editing.autoReviewEnabled ?? true);
      setNightlyEuro(centsToEuroString(editing.nightlyRateCents ?? null));
      setCleaningEuro(centsToEuroString(editing.cleaningFeeCents ?? null));
      return;
    }

    if (!initial) return;

    // CREATE mode — apply selection + property defaults
    setMode('guest');
    setPropertyId(initial.propertyId);
    setCheckin(initial.checkin);
    setCheckout(initial.checkout);
    setCheckinTime(defaultCheckinTime);
    setCheckoutTime(defaultCheckoutTime);
    setGuestCount('2');
    setGuestName('');
    setGuestPhone('');
    setNotes('');
    setAutoReview(true);

    const prop = properties.find((p) => p.id === initial.propertyId);
    setNightlyEuro(centsToEuroString(prop?.defaultRateCents ?? null));
    setCleaningEuro(centsToEuroString(prop?.defaultCleaningFeeCents ?? null));
  }, [open, initial, editing, properties, defaultCheckinTime, defaultCheckoutTime]);

  const nights = useMemo(() => {
    if (!checkin || !checkout) return 0;
    return Math.max(0, differenceInCalendarDays(new Date(checkout), new Date(checkin)));
  }, [checkin, checkout]);

  const selectedProperty = useMemo(
    () => properties.find((p) => p.id === propertyId) ?? null,
    [properties, propertyId],
  );
  const minStay = selectedProperty?.defaultMinStay ?? 1;
  const minStayWarning = nights > 0 && nights < minStay;

  // ── Breakdown (live) ───────────────────────────────────────────────────
  const breakdown = useMemo(() => {
    const nightlyCents = euroStringToCents(nightlyEuro);
    const cleaningCents = euroStringToCents(cleaningEuro);
    if (nightlyCents == null || nights <= 0) {
      return null;
    }
    const lodgingCents = nightlyCents * nights;
    // City tax rounded half-up to nearest cent
    const cityTaxCents = Math.round((lodgingCents * defaultCityTaxRateBp) / 10000);
    const total = lodgingCents + (cleaningCents ?? 0) + cityTaxCents;
    return {
      nightlyCents,
      nights,
      lodgingCents,
      cleaningCents: cleaningCents ?? 0,
      cityTaxRateBp: defaultCityTaxRateBp,
      cityTaxCents,
      total,
    };
  }, [nightlyEuro, cleaningEuro, nights, defaultCityTaxRateBp]);

  const create = trpc.bookings.createInternal.useMutation({
    onSuccess: () => {
      toast.success(mode === 'block' ? 'Sperre gespeichert' : 'Buchung gespeichert');
      onCreated();
    },
    onError: (e) => toast.error(e.message),
  });

  const update = trpc.bookings.update.useMutation({
    onSuccess: () => {
      toast.success('Buchung aktualisiert');
      onUpdated?.();
    },
    onError: (e) => toast.error(e.message),
  });

  const submitting = create.isPending || update.isPending;

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!propertyId || !checkin || !checkout) return;
    if (nights <= 0) {
      toast.error('Check-out muss nach Check-in liegen');
      return;
    }

    const nightlyCents = euroStringToCents(nightlyEuro);
    const cleaningCents = euroStringToCents(cleaningEuro);

    // Parse guest count: empty/invalid → 1, clamp to [1, 50]
    const parsedGuestCount = (() => {
      const n = parseInt(guestCount, 10);
      if (!Number.isFinite(n) || n < 1) return 1;
      return Math.min(50, n);
    })();

    // ── EDIT MODE: dispatch update mutation ────────────────────────────
    if (isEdit && editing) {
      if (externalSource) {
        // External: only notes + auto-review can be changed
        update.mutate({
          id: editing.id,
          notes: notes.trim() || null,
          autoReviewEnabled: autoReview,
        });
        return;
      }
      // Internal/block: full update
      update.mutate({
        id: editing.id,
        propertyId,
        checkin,
        checkout,
        checkinTime,
        checkoutTime,
        guestCount: parsedGuestCount,
        guestName: mode === 'guest' ? (guestName.trim() || null) : null,
        guestPhone: mode === 'guest' ? (guestPhone.trim() || null) : null,
        nightlyRateCents: mode === 'guest' ? nightlyCents : null,
        cleaningFeeCents: mode === 'guest' ? cleaningCents : null,
        notes: notes.trim() || null,
        autoReviewEnabled: mode === 'guest' ? autoReview : false,
      });
      return;
    }

    // ── CREATE MODE ────────────────────────────────────────────────────
    create.mutate({
      propertyId,
      checkin,
      checkout,
      checkinTime,
      checkoutTime,
      guestCount: parsedGuestCount,
      isBlock: mode === 'block',
      ...(mode === 'guest' && guestName.trim() ? { guestName: guestName.trim() } : {}),
      ...(mode === 'guest' && guestPhone.trim() ? { guestPhone: guestPhone.trim() } : {}),
      ...(mode === 'guest' && nightlyCents != null ? { nightlyRateCents: nightlyCents } : {}),
      ...(mode === 'guest' && cleaningCents != null ? { cleaningFeeCents: cleaningCents } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(mode === 'guest' ? { autoReviewEnabled: autoReview } : {}),
      currency: 'EUR',
    });
  }

  if (!open || (!initial && !editing)) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:px-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" />
      <div
        className={cn(
          'relative w-full sm:max-w-[520px] bg-surface',
          'rounded-t-2xl sm:rounded-xl shadow-lg border border-line',
          'animate-fade-up max-h-[92dvh] overflow-y-auto',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-2">
          <h2 className="display text-[22px] font-medium text-ink">
            {isEdit
              ? externalSource
                ? 'OTA-Buchung bearbeiten'
                : mode === 'block'
                  ? 'Sperre bearbeiten'
                  : 'Buchung bearbeiten'
              : mode === 'block'
                ? 'Sperre anlegen'
                : 'Neue Buchung'}
          </h2>
          <p className="mt-1 text-[13px] text-muted">
            {externalSource
              ? 'Nur Notiz und Auto-Bewertung änderbar — Rest verwaltet die OTA.'
              : 'Lokal speichern — Channex-Sync folgt in Phase 5.'}
          </p>
        </div>

        <form onSubmit={submit} className="px-6 pb-6 pt-3 space-y-4">
          {/* Mode toggle — only in CREATE mode (editing mode is locked to source) */}
          {!isEdit && (
            <div className="grid grid-cols-2 gap-2 p-1 bg-sunken rounded-lg">
              <ModeTab
                active={mode === 'guest'}
                onClick={() => setMode('guest')}
                icon={<User className="h-3.5 w-3.5" />}
                label="Mit Gast"
              />
              <ModeTab
                active={mode === 'block'}
                onClick={() => setMode('block')}
                icon={<Lock className="h-3.5 w-3.5" />}
                label="Nur Sperre"
              />
            </div>
          )}

          {/* External summary — shown instead of editable fields for OTA bookings */}
          {externalSource && editing && (
            <div className="rounded-md border border-line bg-canvas/60 px-4 py-3 space-y-1.5 text-[12.5px]">
              <SummaryRow label="Apartment" value={
                properties.find((p) => p.id === editing.propertyId)?.name ?? '—'
              } />
              <SummaryRow
                label="Aufenthalt"
                value={
                  <>
                    <span className="num">{editing.checkin}</span>
                    {' → '}
                    <span className="num">{editing.checkout}</span>
                  </>
                }
              />
              {editing.guestName && (
                <SummaryRow label="Gast" value={editing.guestName} />
              )}
              {editing.guestCount != null && editing.guestCount > 0 && (
                <SummaryRow label="Gäste" value={<span className="num">{editing.guestCount}</span>} />
              )}
            </div>
          )}

          {/* Editable apartment selector — hidden for external bookings */}
          {!externalSource && (
            <div className="space-y-1.5">
              <Label htmlFor="bk-apt">Apartment</Label>
              <select
                id="bk-apt"
                value={propertyId}
                onChange={(e) => setPropertyId(e.target.value)}
                className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink focus:border-ink focus:outline-none"
              >
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!externalSource && (
          <>
          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bk-in">Check-in</Label>
              <Input
                id="bk-in"
                type="date"
                value={checkin}
                onChange={(e) => {
                  setCheckin(e.target.value);
                  // If the new checkin makes checkout invalid, nudge checkout
                  // to checkin+1 (smallest valid range). The min-stay rule
                  // is a soft warning — the user may legitimately want a
                  // shorter stay than the default.
                  if (checkout && checkout <= e.target.value) {
                    setCheckout(
                      format(addDays(new Date(e.target.value), 1), 'yyyy-MM-dd'),
                    );
                  }
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bk-out">Check-out</Label>
              <Input
                id="bk-out"
                type="date"
                value={checkout}
                onChange={(e) => setCheckout(e.target.value)}
                min={checkin}
              />
            </div>
          </div>

          {/* Times */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bk-in-time">Check-in Zeit</Label>
              <Input
                id="bk-in-time"
                type="time"
                value={checkinTime}
                onChange={(e) => setCheckinTime(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bk-out-time">Check-out Zeit</Label>
              <Input
                id="bk-out-time"
                type="time"
                value={checkoutTime}
                onChange={(e) => setCheckoutTime(e.target.value)}
              />
            </div>
          </div>

          {/* Nights summary */}
          {nights > 0 && (
            <div
              className={cn(
                'flex items-center justify-between text-[12.5px] -mt-1',
                minStayWarning ? 'text-warning' : 'text-muted',
              )}
            >
              <span>
                <span className="num">{nights}</span>{' '}
                {nights === 1 ? 'Nacht' : 'Nächte'}
                {checkin && (
                  <>
                    {' · '}
                    {format(new Date(checkin), 'EE d. MMM', { locale: de })}
                    {' → '}
                    {format(new Date(checkout), 'EE d. MMM', { locale: de })}
                  </>
                )}
              </span>
              {minStayWarning && (
                <span className="text-warning text-[11.5px]">
                  unter Mindestdauer ({minStay} D)
                </span>
              )}
            </div>
          )}

          {/* Guest fields */}
          {mode === 'guest' && (
            <>
              <div className="grid grid-cols-[1fr_auto] gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="bk-name">Gast</Label>
                  <Input
                    id="bk-name"
                    placeholder="Name (optional)"
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5 w-[110px]">
                  <Label htmlFor="bk-guests">Gäste</Label>
                  <div className="relative">
                    <Input
                      id="bk-guests"
                      type="text"
                      inputMode="numeric"
                      value={guestCount}
                      onChange={(e) => setGuestCount(e.target.value)}
                      className="pl-8 num"
                    />
                    <Users className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted pointer-events-none" />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="bk-phone">Handynummer</Label>
                <Input
                  id="bk-phone"
                  type="tel"
                  placeholder="+49 ..."
                  value={guestPhone}
                  onChange={(e) => setGuestPhone(e.target.value)}
                />
              </div>

              {/* Price inputs */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="bk-nightly">Übernachtungspreis</Label>
                  <EuroInput
                    id="bk-nightly"
                    value={nightlyEuro}
                    onChange={setNightlyEuro}
                  />
                  <div className="text-[10.5px] text-whisper mt-0.5">pro Nacht, inkl. MwSt.</div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bk-cleaning">Reinigung</Label>
                  <EuroInput
                    id="bk-cleaning"
                    value={cleaningEuro}
                    onChange={setCleaningEuro}
                  />
                  <div className="text-[10.5px] text-whisper mt-0.5">einmalig, inkl. MwSt.</div>
                </div>
              </div>

              {/* Breakdown */}
              {breakdown && (
                <div className="rounded-md border border-line bg-canvas/60 px-4 py-3 space-y-1.5">
                  <BreakdownRow
                    label="Übernachtung"
                    detail={
                      <>
                        <span className="num">{formatEuro(breakdown.nightlyCents)}</span>
                        {' × '}
                        <span className="num">{breakdown.nights}</span>{' '}
                        {breakdown.nights === 1 ? 'Nacht' : 'Nächte'}
                      </>
                    }
                    value={breakdown.lodgingCents}
                  />
                  {breakdown.cleaningCents > 0 && (
                    <BreakdownRow label="Reinigung" value={breakdown.cleaningCents} />
                  )}
                  <BreakdownRow
                    label="Übernachtungssteuer"
                    detail={
                      <span className="num">
                        {(breakdown.cityTaxRateBp / 100).toFixed(
                          breakdown.cityTaxRateBp % 100 === 0 ? 0 : 2,
                        )}
                        %
                      </span>
                    }
                    value={breakdown.cityTaxCents}
                  />
                  <div className="border-t border-line pt-2 mt-1 flex items-baseline justify-between">
                    <span className="text-[13px] font-semibold text-ink">Gesamtpreis</span>
                    <span className="display num text-[20px] font-medium text-ink">
                      {formatEuro(breakdown.total)}
                    </span>
                  </div>
                </div>
              )}
            </>
          )}
          </>
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="bk-notes">Notiz</Label>
            <textarea
              id="bk-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink resize-none focus:border-ink focus:outline-none"
              placeholder="optional"
            />
          </div>

          {/* Auto-review toggle — only for guest bookings, not pure blocks */}
          {mode === 'guest' && (
            <div className="flex items-start justify-between gap-4 rounded-md border border-line bg-canvas/60 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-ink">
                  Auto-Bewertung schreiben
                </div>
                <div className="mt-0.5 text-[11.5px] text-muted leading-snug">
                  Gast bekommt 3 Tage nach Abreise automatisch eine Bewertung geschrieben.
                </div>
              </div>
              <Switch checked={autoReview} onChange={setAutoReview} />
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>
              Abbrechen
            </Button>
            <Button
              type="submit"
              variant="brand"
              loading={submitting}
              disabled={
                externalSource
                  ? false
                  : !propertyId || !checkin || !checkout || nights <= 0
              }
            >
              {isEdit
                ? 'Aktualisieren'
                : mode === 'block'
                  ? 'Sperren'
                  : 'Speichern'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function ModeTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center justify-center gap-1.5 h-8 rounded-md text-[12.5px] font-medium',
        'transition-[background-color,color] duration-150',
        active ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function EuroInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        className="pl-7 num"
        placeholder="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-muted pointer-events-none">
        €
      </span>
    </div>
  );
}

function BreakdownRow({
  label,
  detail,
  value,
}: {
  label: string;
  detail?: React.ReactNode;
  value: number;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
      <div className="text-ink-soft">
        <span>{label}</span>
        {detail && <span className="ml-2 text-muted">{detail}</span>}
      </div>
      <span className="num text-ink">{formatEuro(value)}</span>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function centsToEuroString(cents: bigint | number | null | undefined): string {
  if (cents == null) return '';
  const v = (typeof cents === 'bigint' ? Number(cents) : cents) / 100;
  return Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2).replace(/\.?0+$/, '');
}

function euroStringToCents(s: string): number | null {
  const trimmed = s.trim().replace(',', '.');
  if (!trimmed) return null;
  const v = parseFloat(trimmed);
  if (!Number.isFinite(v) || v < 0) return null;
  return Math.round(v * 100);
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="text-ink">{value}</span>
    </div>
  );
}

function formatEuro(cents: number): string {
  const v = cents / 100;
  return `€${v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
