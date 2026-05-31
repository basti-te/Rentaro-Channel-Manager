import { useEffect, useState, type FormEvent } from 'react';
import { addDays, differenceInCalendarDays, format } from 'date-fns';
import { de } from 'date-fns/locale';
import { toast } from 'sonner';
import { Tag } from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Label } from '../../components/ui/Label';
import { Switch } from '../../components/ui/Switch';
import { currencySymbol } from '../../lib/format-money';
import { trpc } from '../../lib/trpc';

export interface RateSelection {
  propertyId: string;
  /** YYYY-MM-DD inclusive. */
  from: string;
  /** YYYY-MM-DD EXCLUSIVE (day after the last selected day). */
  to: string;
}

interface Props {
  open: boolean;
  selection: RateSelection | null;
  propertyName: string | null;
  /** Effective currency for the property (property.currency ?? tenant default). */
  propertyCurrency: string | null;
  /**
   * Tenant uses PriceLabs (rateSource='pricelabs'). PriceLabs owns nightly
   * prices in Channex, so the rate field here is inert — we disable it and
   * show a hint. Min-stay / stop-sell stay editable (those remain PMS-driven).
   */
  pricelabsManaged?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Set or clear per-day rate / restriction overrides for a date range.
 * Only the fields the user fills are sent; the rest keep their existing
 * per-day values (or the property default). Writes via rates.setOverrides,
 * which enqueues an ARI dirty range — the global flusher pushes to Channex
 * within the debounce window.
 */
export function RateEditorDialog({
  open,
  selection,
  propertyName,
  propertyCurrency,
  pricelabsManaged = false,
  onClose,
  onSaved,
}: Props) {
  const symbol = currencySymbol(propertyCurrency);
  const [rate, setRate] = useState('');
  const [minStay, setMinStay] = useState('');
  const [stopSell, setStopSell] = useState(false);

  // Editable date range — initialised from the drag-selection but the user
  // can widen/narrow it directly in the dialog (handy for very long ranges
  // like a 500-day full-sync seed where dragging cells is impractical).
  // Both inputs are *inclusive* — first night and last night. We convert
  // `lastNight + 1` to the exclusive `to` only when calling the mutation,
  // because the rates API contract stores `to` as exclusive.
  const [editFrom, setEditFrom] = useState('');
  const [editLastNight, setEditLastNight] = useState('');

  // Reset fields whenever a fresh selection comes in.
  useEffect(() => {
    if (open && selection) {
      setRate('');
      setMinStay('');
      setStopSell(false);
      setEditFrom(selection.from);
      // selection.to is exclusive — display the inclusive last night.
      const last = addDays(new Date(`${selection.to}T00:00:00`), -1);
      setEditLastNight(format(last, 'yyyy-MM-dd'));
    }
  }, [open, selection?.propertyId, selection?.from, selection?.to]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const setOverrides = trpc.rates.setOverrides.useMutation({
    onSuccess: (r) => {
      toast.success(`${r.days} Tag(e) aktualisiert — Sync läuft`);
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });
  const clearOverrides = trpc.rates.clearOverrides.useMutation({
    onSuccess: () => {
      toast.success('Overrides entfernt — zurück auf Standard');
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  if (!open || !selection) return null;

  // Derive the effective range from the editable inputs. Returns null if the
  // user has cleared one of the inputs or set Last < First.
  const range = (() => {
    if (!editFrom || !editLastNight) return null;
    const f = new Date(`${editFrom}T00:00:00`);
    const l = new Date(`${editLastNight}T00:00:00`);
    if (Number.isNaN(f.getTime()) || Number.isNaN(l.getTime())) return null;
    if (l < f) return null;
    const nights = differenceInCalendarDays(l, f) + 1;
    const toExclusive = format(addDays(l, 1), 'yyyy-MM-dd');
    return { firstNight: f, lastNight: l, from: editFrom, toExclusive, nights };
  })();

  const rangeValid = range != null;
  const rangeLabel = range
    ? range.nights === 1
      ? format(range.firstNight, 'EEE d. MMM yyyy', { locale: de })
      : `${format(range.firstNight, 'd. MMM', { locale: de })} – ${format(range.lastNight, 'd. MMM yyyy', { locale: de })} · ${range.nights} Tage`
    : 'Zeitraum wählen';

  // In PriceLabs mode the rate AND min-stay fields are inert (PriceLabs owns
  // both) — never read typed values for them.
  const rateNum = pricelabsManaged || rate.trim() === '' ? null : Number(rate.replace(',', '.'));
  const rateValid = rateNum == null || (Number.isFinite(rateNum) && rateNum >= 0);
  const minStayNum = pricelabsManaged || minStay.trim() === '' ? null : Number(minStay);
  const minStayValid =
    minStayNum == null || (Number.isInteger(minStayNum) && minStayNum >= 1);

  const hasChange = rateNum != null || minStayNum != null || stopSell;
  const pending = setOverrides.isPending || clearOverrides.isPending;

  // Quick presets: set Last Night = First + N - 1. Disabled until First is set.
  const presets: Array<{ label: string; days: number }> = [
    { label: '+30 T', days: 30 },
    { label: '+90 T', days: 90 },
    { label: '+1 J', days: 365 },
    { label: '500 T', days: 500 },
  ];
  function applyPreset(days: number) {
    if (!editFrom) return;
    const f = new Date(`${editFrom}T00:00:00`);
    setEditLastNight(format(addDays(f, days - 1), 'yyyy-MM-dd'));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!selection || !range || !rateValid || !minStayValid || !hasChange) return;
    const values: Record<string, number | boolean> = {};
    if (rateNum != null) values.rateCents = Math.round(rateNum * 100);
    if (minStayNum != null) values.minStay = minStayNum;
    if (stopSell) values.stopSell = true;
    setOverrides.mutate({
      propertyId: selection.propertyId,
      from: range.from,
      to: range.toExclusive,
      values,
    });
  }

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
        <div className="px-6 pt-6 pb-2">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-brand" strokeWidth={1.75} />
            <h2 className="display text-[20px] font-medium text-ink">
              Preise & Restriktionen
            </h2>
          </div>
          <p className="mt-1 text-[12.5px] text-muted">
            <span className="font-medium text-ink">{propertyName ?? 'Apartment'}</span>
            {' · '}
            {rangeLabel}
          </p>
        </div>

        <form onSubmit={submit} className="px-6 pb-6 pt-4 space-y-4">
          {/* Editable date range — drag-selection seeds these but the user
              can fine-tune (or stretch to 500 days for a full sync). */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ro-from">Erste Nacht</Label>
                <Input
                  id="ro-from"
                  type="date"
                  value={editFrom}
                  onChange={(e) => setEditFrom(e.target.value)}
                  invalid={!rangeValid}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ro-last">Letzte Nacht</Label>
                <Input
                  id="ro-last"
                  type="date"
                  value={editLastNight}
                  min={editFrom || undefined}
                  onChange={(e) => setEditLastNight(e.target.value)}
                  invalid={!rangeValid}
                />
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-muted">Schnellwahl ab erster Nacht:</span>
              {presets.map(({ label, days }) => (
                <button
                  key={days}
                  type="button"
                  disabled={!editFrom}
                  onClick={() => applyPreset(days)}
                  className="text-[11px] px-1.5 py-0.5 rounded border border-line text-muted hover:bg-sunken hover:text-ink disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {pricelabsManaged && (
            <div className="rounded-lg border border-brand/30 bg-brand-soft/40 px-3.5 py-2.5">
              <p className="text-[12px] text-ink leading-relaxed">
                <span className="font-medium">PriceLabs verwaltet Preis und
                Aufenthaltsregeln.</span>{' '}
                Änderungen an Preis und Mindestaufenthalt wirken hier nicht —
                bitte in PriceLabs anpassen. Nur Stop-Sell (Komplettsperre)
                bleibt hier aktiv.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ro-rate">Preis / Nacht ({symbol})</Label>
              <Input
                id="ro-rate"
                inputMode="decimal"
                placeholder={pricelabsManaged ? 'von PriceLabs' : 'z. B. 89'}
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                disabled={pricelabsManaged}
                autoFocus={!pricelabsManaged}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ro-minstay">Min. Aufenthalt</Label>
              <Input
                id="ro-minstay"
                type="number"
                min={1}
                placeholder={pricelabsManaged ? 'von PriceLabs' : 'unverändert'}
                value={minStay}
                onChange={(e) => setMinStay(e.target.value)}
                disabled={pricelabsManaged}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-line px-3.5 py-3">
            <div>
              <div className="text-[13px] font-medium text-ink">Stop-Sell</div>
              <div className="text-[11.5px] text-muted">
                Zeitraum auf allen Kanälen sperren
              </div>
            </div>
            <Switch checked={stopSell} onChange={setStopSell} />
          </div>

          {!rangeValid && (
            <p className="text-[12px] text-negative">
              Bitte erste und letzte Nacht wählen (Letzte ≥ Erste).
            </p>
          )}
          {!rateValid && (
            <p className="text-[12px] text-negative">Ungültiger Preis.</p>
          )}
          {!minStayValid && (
            <p className="text-[12px] text-negative">
              Min. Aufenthalt muss eine ganze Zahl ≥ 1 sein.
            </p>
          )}

          <div className="flex items-center justify-between gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending || !range}
              onClick={() =>
                range &&
                clearOverrides.mutate({
                  propertyId: selection.propertyId,
                  from: range.from,
                  to: range.toExclusive,
                })
              }
            >
              Overrides löschen
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
                Abbrechen
              </Button>
              <Button
                type="submit"
                variant="brand"
                loading={setOverrides.isPending}
                disabled={
                  !hasChange || !rateValid || !minStayValid || !rangeValid || pending
                }
              >
                Speichern
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
