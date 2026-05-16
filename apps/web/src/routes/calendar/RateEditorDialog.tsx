import { useEffect, useState, type FormEvent } from 'react';
import { addDays, differenceInCalendarDays, format } from 'date-fns';
import { de } from 'date-fns/locale';
import { toast } from 'sonner';
import { Tag } from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Label } from '../../components/ui/Label';
import { Switch } from '../../components/ui/Switch';
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
  onClose,
  onSaved,
}: Props) {
  const [rate, setRate] = useState('');
  const [minStay, setMinStay] = useState('');
  const [stopSell, setStopSell] = useState(false);

  // Reset fields whenever a fresh selection comes in.
  useEffect(() => {
    if (open) {
      setRate('');
      setMinStay('');
      setStopSell(false);
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

  const ci = new Date(`${selection.from}T00:00:00`);
  const nights = Math.max(
    1,
    differenceInCalendarDays(new Date(`${selection.to}T00:00:00`), ci),
  );
  const lastNight = addDays(ci, nights - 1);
  const rangeLabel =
    nights === 1
      ? format(ci, 'EEE d. MMM yyyy', { locale: de })
      : `${format(ci, 'd. MMM', { locale: de })} – ${format(lastNight, 'd. MMM yyyy', { locale: de })} · ${nights} Tage`;

  const rateNum = rate.trim() === '' ? null : Number(rate.replace(',', '.'));
  const rateValid = rateNum == null || (Number.isFinite(rateNum) && rateNum >= 0);
  const minStayNum = minStay.trim() === '' ? null : Number(minStay);
  const minStayValid =
    minStayNum == null || (Number.isInteger(minStayNum) && minStayNum >= 1);

  const hasChange = rateNum != null || minStayNum != null || stopSell;
  const pending = setOverrides.isPending || clearOverrides.isPending;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!selection || !rateValid || !minStayValid || !hasChange) return;
    const values: Record<string, number | boolean> = {};
    if (rateNum != null) values.rateCents = Math.round(rateNum * 100);
    if (minStayNum != null) values.minStay = minStayNum;
    if (stopSell) values.stopSell = true;
    setOverrides.mutate({
      propertyId: selection.propertyId,
      from: selection.from,
      to: selection.to,
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ro-rate">Preis / Nacht (€)</Label>
              <Input
                id="ro-rate"
                inputMode="decimal"
                placeholder="z. B. 89"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ro-minstay">Min. Aufenthalt</Label>
              <Input
                id="ro-minstay"
                type="number"
                min={1}
                placeholder="unverändert"
                value={minStay}
                onChange={(e) => setMinStay(e.target.value)}
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
              disabled={pending}
              onClick={() =>
                selection &&
                clearOverrides.mutate({
                  propertyId: selection.propertyId,
                  from: selection.from,
                  to: selection.to,
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
                disabled={!hasChange || !rateValid || !minStayValid || pending}
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
