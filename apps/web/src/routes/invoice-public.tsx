/**
 * Public guest invoice portal — `/rechnung/:slug`, no auth.
 *
 * The guest identifies their stay by last name + both dates (and the OTA code
 * if the operator requires it), fills in their billing details, and downloads
 * the finished PDF. Errors are generic (no enumeration). The slug → tenant; an
 * unknown/disabled slug just yields "not found" on lookup.
 */
import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Loader2, Download, FileText, ArrowLeft, Search } from 'lucide-react';

import { Brand } from '../components/Brand';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Label } from '../components/ui/Label';
import { formatMoney } from '../lib/format-money';
import { invoicePdfUrl } from '../lib/invoice-url';
import { trpc } from '../lib/trpc';

interface LookupData {
  found: boolean;
  guestName?: string | null;
  apartmentName?: string;
  nights?: number;
  currency?: string;
  confident?: boolean;
  grossCents?: number | null;
  existing?: { number: string; token: string; status: string } | null;
}

export function PublicInvoicePage() {
  const { slug } = useParams({ strict: false }) as { slug: string };

  const [form, setForm] = useState({ lastName: '', checkin: '', checkout: '', code: '' });
  const [result, setResult] = useState<LookupData | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [r, setR] = useState({
    company: '',
    name: '',
    street: '',
    zip: '',
    city: '',
    country: 'Deutschland',
    vatId: '',
  });

  const lookupM = trpc.invoices.publicLookup.useMutation({
    onSuccess: (res) => {
      setResult(res);
      if (res.found) {
        setR((x) => ({ ...x, name: res.guestName ?? '' }));
        if (res.existing) setToken(res.existing.token);
      }
    },
    onError: (e) => toast.error(e.message),
  });
  const issueM = trpc.invoices.publicIssue.useMutation({
    onSuccess: (res) => setToken(res.token),
    onError: (e) => toast.error(e.message),
  });

  const reset = () => {
    setResult(null);
    setToken(null);
  };

  const submitLookup = () => {
    lookupM.mutate({
      slug,
      lastName: form.lastName.trim(),
      checkin: form.checkin,
      checkout: form.checkout,
      code: form.code.trim() || undefined,
    });
  };

  const recipientValid = !!(r.name.trim() && r.street.trim() && r.zip.trim() && r.city.trim());

  return (
    <div className="grain min-h-dvh bg-canvas flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Brand size="md" />
        </div>

        <div className="bg-surface border border-line rounded-xl shadow-sm p-6 animate-fade-up">
          {/* ── Download screen ── */}
          {token ? (
            <div className="text-center space-y-4">
              <div className="h-12 w-12 rounded-full bg-positive-soft/60 flex items-center justify-center mx-auto">
                <FileText className="h-6 w-6 text-positive" strokeWidth={1.75} />
              </div>
              <div>
                <h1 className="display text-[22px] text-ink">Rechnung bereit</h1>
                <p className="mt-1 text-[13px] text-muted">
                  Ihre Rechnung wurde erstellt. Sie können sie jetzt herunterladen.
                </p>
              </div>
              <a href={invoicePdfUrl(token)} target="_blank" rel="noopener noreferrer" className="block">
                <Button variant="brand" className="w-full" iconLeft={<Download className="h-4 w-4" />}>
                  Rechnung herunterladen (PDF)
                </Button>
              </a>
            </div>
          ) : result?.found && result.existing ? null : result?.found && result.confident ? (
            /* ── Recipient form ── */
            <div className="space-y-3">
              <button
                type="button"
                onClick={reset}
                className="flex items-center gap-1.5 text-[12px] text-muted hover:text-ink transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> zurück
              </button>
              <div>
                <h1 className="display text-[22px] text-ink">Rechnungsdetails</h1>
                <p className="mt-1 text-[13px] text-muted">
                  {result.apartmentName} · {result.nights} Nächte ·{' '}
                  <span className="text-ink font-medium">
                    {formatMoney(result.grossCents ?? 0, result.currency ?? 'EUR')}
                  </span>
                </p>
              </div>
              <Input placeholder="Firma (optional)" value={r.company} onChange={(e) => setR({ ...r, company: e.target.value })} />
              <Input placeholder="Name" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} />
              <Input placeholder="Straße + Nr." value={r.street} onChange={(e) => setR({ ...r, street: e.target.value })} />
              <div className="flex gap-2">
                <Input placeholder="PLZ" value={r.zip} onChange={(e) => setR({ ...r, zip: e.target.value })} className="w-28" />
                <Input placeholder="Ort" value={r.city} onChange={(e) => setR({ ...r, city: e.target.value })} />
              </div>
              <Input placeholder="Land" value={r.country} onChange={(e) => setR({ ...r, country: e.target.value })} />
              <Input placeholder="USt-IdNr. (optional)" value={r.vatId} onChange={(e) => setR({ ...r, vatId: e.target.value })} />
              <Button
                variant="brand"
                className="w-full"
                loading={issueM.isPending}
                disabled={!recipientValid}
                onClick={() =>
                  issueM.mutate({
                    slug,
                    lastName: form.lastName.trim(),
                    checkin: form.checkin,
                    checkout: form.checkout,
                    code: form.code.trim() || undefined,
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
                Rechnung erstellen
              </Button>
              <p className="text-[11px] text-whisper text-center">
                Die Rechnung wird einmalig mit diesen Angaben erstellt.
              </p>
            </div>
          ) : result?.found && !result.confident ? (
            /* ── Found but not invoiceable ── */
            <div className="text-center space-y-3">
              <h1 className="display text-[22px] text-ink">Online nicht verfügbar</h1>
              <p className="text-[13px] text-muted leading-relaxed">
                Für diese Buchung kann online leider keine Rechnung erstellt werden. Bitte wenden
                Sie sich direkt an Ihren Gastgeber.
              </p>
              <Button variant="ghost" onClick={reset} iconLeft={<ArrowLeft className="h-4 w-4" />}>
                zurück
              </Button>
            </div>
          ) : result && !result.found ? (
            /* ── Not found ── */
            <div className="text-center space-y-3">
              <h1 className="display text-[22px] text-ink">Keine Buchung gefunden</h1>
              <p className="text-[13px] text-muted leading-relaxed">
                Wir konnten keine passende Buchung finden. Bitte prüfen Sie Nachname und Reisedaten
                und versuchen Sie es erneut.
              </p>
              <Button variant="ghost" onClick={reset} iconLeft={<ArrowLeft className="h-4 w-4" />}>
                erneut versuchen
              </Button>
            </div>
          ) : (
            /* ── Lookup form ── */
            <div className="space-y-3">
              <div>
                <h1 className="display text-[22px] text-ink">Ihre Rechnung</h1>
                <p className="mt-1 text-[13px] text-muted">
                  Geben Sie Ihren Nachnamen und Ihre Reisedaten ein, um Ihre Rechnung abzurufen.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ln">Nachname</Label>
                <Input id="ln" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} placeholder="wie in der Buchung" />
              </div>
              <div className="flex gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="ci">Anreise</Label>
                  <Input id="ci" type="date" value={form.checkin} onChange={(e) => setForm({ ...form, checkin: e.target.value })} />
                </div>
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="co">Abreise</Label>
                  <Input id="co" type="date" value={form.checkout} onChange={(e) => setForm({ ...form, checkout: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cd">Buchungscode (optional)</Label>
                <Input id="cd" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="z. B. Airbnb-/Booking-Code" />
              </div>
              <Button
                variant="brand"
                className="w-full"
                loading={lookupM.isPending}
                disabled={!form.lastName.trim() || !form.checkin || !form.checkout}
                iconLeft={<Search className="h-4 w-4" />}
                onClick={submitLookup}
              >
                Rechnung abrufen
              </Button>
            </div>
          )}
        </div>

        <p className="text-center text-[11px] text-whisper mt-6">
          {lookupM.isPending && <Loader2 className="inline h-3 w-3 animate-spin mr-1" />}
          Sichere Rechnungsabfrage
        </p>
      </div>
    </div>
  );
}
