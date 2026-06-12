import { useState, useEffect, type ReactNode } from 'react';
import { toast } from 'sonner';
import { FileText, Download } from 'lucide-react';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { formatMoney } from '../../lib/format-money';
import { invoicePdfUrl } from '../../lib/invoice-url';
import { trpc } from '../../lib/trpc';

const centsToEuro = (c: number) =>
  (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const euroToCents = (s: string) => {
  const t = s.trim();
  const norm = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  return Math.max(0, Math.round((parseFloat(norm) || 0) * 100));
};

/**
 * Booking-detail invoice block: shows the issued invoice (with PDF download) or,
 * for an invoiceable booking on an enabled tenant, lets the operator generate
 * one after entering the recipient. Suppressed for blocks + unresolvable amounts.
 */
export function InvoiceSection({
  bookingId,
  guestName,
}: {
  bookingId: string;
  guestName: string | null;
}) {
  const utils = trpc.useUtils();
  const q = trpc.invoices.forBooking.useQuery({ bookingId });
  const [showForm, setShowForm] = useState(false);
  const [r, setR] = useState({
    company: '',
    name: guestName ?? '',
    street: '',
    zip: '',
    city: '',
    country: 'Deutschland',
    vatId: '',
  });

  const issue = trpc.invoices.issue.useMutation({
    onSuccess: () => {
      toast.success('Rechnung erstellt');
      setShowForm(false);
      void utils.invoices.forBooking.invalidate({ bookingId });
    },
    onError: (e) => toast.error(e.message),
  });

  const meQ = trpc.me.current.useQuery();
  const role = meQ.data?.memberships?.[0]?.role;
  const isAdmin = role === 'owner' || role === 'admin';
  const voidM = trpc.invoices.voidInvoice.useMutation({
    onSuccess: () => {
      toast.success('Rechnung storniert');
      void utils.invoices.forBooking.invalidate({ bookingId });
    },
    onError: (e) => toast.error(e.message),
  });

  // Editable invoice amounts (paid gross + cleaning), seeded from the server.
  const [grossEuro, setGrossEuro] = useState('');
  const [cleaningEuro, setCleaningEuro] = useState('');
  const srvGross = q.data?.grossCents ?? null;
  const srvCleaning = q.data?.cleaningCents ?? null;
  useEffect(() => {
    if (srvGross != null) setGrossEuro(centsToEuro(srvGross));
    if (srvCleaning != null) setCleaningEuro(centsToEuro(srvCleaning));
  }, [srvGross, srvCleaning]);
  const ov = trpc.invoices.setOverrides.useMutation({
    onSuccess: () => {
      toast.success('Beträge gespeichert');
      void utils.invoices.forBooking.invalidate({ bookingId });
    },
    onError: (e) => toast.error(e.message),
  });

  if (!q.data || q.data.reason === 'block') return null;
  const d = q.data;

  const wrap = (children: ReactNode) => (
    <div className="pt-1">
      <div className="text-[11px] uppercase tracking-widest text-whisper mb-2 flex items-center gap-1.5">
        <FileText className="h-3 w-3" /> Rechnung
      </div>
      {children}
    </div>
  );

  if (d.existing) {
    const inv = d.existing;
    return wrap(
      <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-canvas/60 px-3 py-2.5">
        <div className="min-w-0">
          <div className="num text-[13px] text-ink">{inv.number}</div>
          {inv.status === 'void' && <div className="text-[11px] text-negative">storniert</div>}
        </div>
        {inv.status !== 'void' && (
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button
                type="button"
                className="text-[12px] text-muted hover:text-negative transition-colors disabled:opacity-50"
                disabled={voidM.isPending}
                onClick={() => {
                  if (confirm(`Rechnung ${inv.number} stornieren?`)) {
                    voidM.mutate({ invoiceId: inv.id });
                  }
                }}
              >
                Stornieren
              </button>
            )}
            <a href={invoicePdfUrl(inv.token)} target="_blank" rel="noopener noreferrer">
              <Button variant="secondary" size="sm" iconLeft={<Download className="h-4 w-4" />}>
                PDF
              </Button>
            </a>
          </div>
        )}
      </div>,
    );
  }

  if (!d.enabled) {
    return wrap(
      <p className="text-[12px] text-whisper">
        Rechnungs-Portal unter „Rechnungen" aktivieren, dann lässt sich hier eine Rechnung
        erstellen.
      </p>,
    );
  }

  if (!d.confident || !d.breakdown) {
    return wrap(
      <p className="text-[12px] text-whisper">
        Betrag nicht sicher ermittelbar (z. B. Airbnb übermittelt nur die Auszahlung) — keine
        automatische Rechnung.
      </p>,
    );
  }

  if (!showForm) {
    const b = d.breakdown;
    const dirty =
      (d.grossCents != null && euroToCents(grossEuro) !== d.grossCents) ||
      (d.cleaningCents != null && euroToCents(cleaningEuro) !== d.cleaningCents);
    const vatPct = (b.vatRateBp / 100).toString().replace('.', ',');
    return wrap(
      <div className="space-y-3 rounded-md border border-line bg-canvas/60 px-3 py-3">
        <p className="text-[11.5px] text-muted">
          Gezahlter Betrag prüfen — daraus werden Übernachtung, City-Tax und USt berechnet.
        </p>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="text-[11px] text-whisper block mb-1">Gezahlt (Brutto) €</label>
            <Input value={grossEuro} onChange={(e) => setGrossEuro(e.target.value)} />
          </div>
          <div className="flex-1">
            <label className="text-[11px] text-whisper block mb-1">davon Reinigung €</label>
            <Input value={cleaningEuro} onChange={(e) => setCleaningEuro(e.target.value)} />
          </div>
        </div>
        {dirty && (
          <div className="flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              loading={ov.isPending}
              onClick={() =>
                ov.mutate({
                  bookingId,
                  grossCents: euroToCents(grossEuro),
                  cleaningCents: euroToCents(cleaningEuro),
                })
              }
            >
              Beträge speichern
            </Button>
          </div>
        )}
        <div className="text-[11.5px] text-muted leading-relaxed border-t border-line pt-2">
          Übernachtung {formatMoney(b.lodgingGrossCents, d.currency)} · Übernachtungssteuer{' '}
          {formatMoney(b.cityTaxCents, d.currency)} · USt {vatPct}%{' '}
          {formatMoney(b.totalVatCents, d.currency)}
          <span className="block text-ink font-medium mt-0.5">
            Brutto {formatMoney(b.totalGrossCents, d.currency)}
          </span>
        </div>
        <Button
          variant="brand"
          size="sm"
          iconLeft={<FileText className="h-4 w-4" />}
          disabled={dirty}
          onClick={() => setShowForm(true)}
        >
          Rechnung erstellen
        </Button>
        {dirty && (
          <p className="text-[11px] text-whisper">
            Erst „Beträge speichern", dann die Rechnung erstellen.
          </p>
        )}
      </div>,
    );
  }

  const valid = !!(r.name.trim() && r.street.trim() && r.zip.trim() && r.city.trim());
  return wrap(
    <div className="space-y-2.5 rounded-md border border-line bg-canvas/60 px-3 py-3">
      <p className="text-[11.5px] text-muted">Rechnungsempfänger</p>
      <Input placeholder="Firma (optional)" value={r.company} onChange={(e) => setR({ ...r, company: e.target.value })} />
      <Input placeholder="Name" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} />
      <Input placeholder="Straße + Nr." value={r.street} onChange={(e) => setR({ ...r, street: e.target.value })} />
      <div className="flex gap-2">
        <Input placeholder="PLZ" value={r.zip} onChange={(e) => setR({ ...r, zip: e.target.value })} className="w-28" />
        <Input placeholder="Ort" value={r.city} onChange={(e) => setR({ ...r, city: e.target.value })} />
      </div>
      <Input placeholder="Land" value={r.country} onChange={(e) => setR({ ...r, country: e.target.value })} />
      <Input placeholder="USt-IdNr. (optional)" value={r.vatId} onChange={(e) => setR({ ...r, vatId: e.target.value })} />
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>
          Abbrechen
        </Button>
        <Button
          variant="brand"
          size="sm"
          loading={issue.isPending}
          disabled={!valid}
          onClick={() =>
            issue.mutate({
              bookingId,
              recipient: {
                company: r.company.trim() || undefined,
                name: r.name.trim(),
                street: r.street.trim(),
                zip: r.zip.trim(),
                city: r.city.trim(),
                country: r.country.trim() || undefined,
                vatId: r.vatId.trim() || undefined,
              },
            })
          }
        >
          Erstellen
        </Button>
      </div>
    </div>,
  );
}
