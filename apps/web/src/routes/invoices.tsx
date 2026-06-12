import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Check, Sparkles } from 'lucide-react';

import { PageHeader } from './_dashboard';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Label } from '../components/ui/Label';
import { Switch } from '../components/ui/Switch';
import { Card } from '../components/ui/Card';
import { SectionCard } from '../components/ui/SectionCard';
import { Skeleton } from '../components/ui/Skeleton';
import { trpc } from '../lib/trpc';

interface FormState {
  enabled: boolean;
  issuerName: string;
  issuerAddress: string;
  senderLine: string;
  logoText: string;
  contactPerson: string;
  taxId: string;
  taxNumber: string;
  vatMode: 'regular' | 'kleinunternehmer';
  vatRatePct: string;
  cityTaxRatePct: string;
  lodgingLabel: string;
  cityTaxLabel: string;
  cleaningLabel: string;
  numberPrefix: string;
  nextSeq: string;
  footerContact: string;
  footerRegistry: string;
  footerBank: string;
  closingNote: string;
  lookupRequireCode: boolean;
  airbnbAmountIsGross: boolean;
}

const EMPTY: FormState = {
  enabled: false,
  issuerName: '',
  issuerAddress: '',
  senderLine: '',
  logoText: '',
  contactPerson: '',
  taxId: '',
  taxNumber: '',
  vatMode: 'regular',
  vatRatePct: '7',
  cityTaxRatePct: '5',
  lodgingLabel: 'Übernachtung',
  cityTaxLabel: 'Übernachtungssteuer',
  cleaningLabel: 'Endreinigung',
  numberPrefix: 'RE-',
  nextSeq: '1',
  footerContact: '',
  footerRegistry: '',
  footerBank: '',
  closingNote: 'Der Rechnungsbetrag wurde bereits bezahlt.\nVielen Dank.',
  lookupRequireCode: false,
  airbnbAmountIsGross: false,
};

/** One-click template for the primary operator (CITY APARTMENTS ESSEN). */
const TEMPLATE: Partial<FormState> = {
  issuerName: 'Leopards GmbH',
  issuerAddress: 'Am Schlangenberg 3\n45136 Essen\nDeutschland',
  senderLine: 'Leopards · Am Schlangenberg 3 · 45136 Essen',
  logoText: 'CITY APARTMENTS ESSEN',
  contactPerson: 'Sebastian Teufel',
  taxId: 'DE343901469',
  taxNumber: '112/5733/1478',
  cityTaxLabel: 'Übernachtungssteuer Stadt Essen',
  footerContact: 'Tel. 017641880498\nE-Mail\nsebastian.teufel.st@googlemail.com',
  footerRegistry:
    'Amtsgericht Essen\nHR-Nr. HRB 32276\nUSt.-ID DE343901469\nSteuer-Nr. 112/5733/1478\nGeschäftsführung Sebastian Teufel',
  footerBank:
    'Bank Commerzbank Essen\nKonto 0370279200\nBLZ 36040039\nIBAN DE94360400390370279200\nBIC COBADEFFXXX',
};

const AREA_CLS =
  'w-full rounded-md border border-line bg-surface px-3 py-2 text-[13px] leading-relaxed text-ink focus:border-ink focus:outline-none transition-colors resize-y disabled:opacity-60';

export function InvoicesPage() {
  const meQ = trpc.me.current.useQuery();
  const role = meQ.data?.memberships?.[0]?.role;
  const isAdmin = role === 'owner' || role === 'admin';

  const utils = trpc.useUtils();
  const settingsQ = trpc.invoices.settings.useQuery();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [slug, setSlug] = useState<string | null>(null);

  useEffect(() => {
    if (settingsQ.data === undefined) return;
    const r = settingsQ.data;
    setSlug(r?.publicSlug ?? null);
    if (!r) {
      setForm(EMPTY);
      return;
    }
    setForm({
      enabled: r.enabled,
      issuerName: r.issuerName ?? '',
      issuerAddress: r.issuerAddress ?? '',
      senderLine: r.senderLine ?? '',
      logoText: r.logoText ?? '',
      contactPerson: r.contactPerson ?? '',
      taxId: r.taxId ?? '',
      taxNumber: r.taxNumber ?? '',
      vatMode: (r.vatMode as 'regular' | 'kleinunternehmer') ?? 'regular',
      vatRatePct: String(r.vatRateBp / 100),
      cityTaxRatePct: String(r.cityTaxRateBp / 100),
      lodgingLabel: r.lodgingLabel,
      cityTaxLabel: r.cityTaxLabel,
      cleaningLabel: r.cleaningLabel,
      numberPrefix: r.numberPrefix,
      nextSeq: String(r.nextSeq),
      footerContact: r.footerContact ?? '',
      footerRegistry: r.footerRegistry ?? '',
      footerBank: r.footerBank ?? '',
      closingNote: r.closingNote,
      lookupRequireCode: r.lookupRequireCode,
      airbnbAmountIsGross: r.airbnbAmountIsGross,
    });
  }, [settingsQ.data]);

  const save = trpc.invoices.setSettings.useMutation({
    onSuccess: (row) => {
      toast.success('Gespeichert');
      setSlug(row.publicSlug ?? null);
      void utils.invoices.settings.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const fileRef = useRef<HTMLInputElement>(null);
  const setLogo = trpc.invoices.setLogo.useMutation({
    onSuccess: () => {
      toast.success('Logo gespeichert');
      void utils.invoices.settings.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const onLogoFile = (file: File) => {
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      toast.error('Bitte PNG oder JPEG');
      return;
    }
    if (file.size > 800_000) {
      toast.error('Logo zu groß (max ~800 KB)');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogo.mutate({ logoImageData: String(reader.result) });
    reader.readAsDataURL(file);
  };

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const onSave = () => {
    const vatBp = Math.round(parseFloat(form.vatRatePct.replace(',', '.') || '0') * 100);
    const cityBp = Math.round(parseFloat(form.cityTaxRatePct.replace(',', '.') || '0') * 100);
    const seq = Math.max(1, parseInt(form.nextSeq, 10) || 1);
    save.mutate({
      enabled: form.enabled,
      issuerName: form.issuerName.trim(),
      issuerAddress: form.issuerAddress,
      senderLine: form.senderLine.trim(),
      logoText: form.logoText.trim(),
      contactPerson: form.contactPerson.trim(),
      taxId: form.taxId.trim(),
      taxNumber: form.taxNumber.trim(),
      vatMode: form.vatMode,
      vatRateBp: vatBp,
      cityTaxRateBp: cityBp,
      lodgingLabel: form.lodgingLabel.trim() || 'Übernachtung',
      cityTaxLabel: form.cityTaxLabel.trim() || 'Übernachtungssteuer',
      cleaningLabel: form.cleaningLabel.trim() || 'Endreinigung',
      numberPrefix: form.numberPrefix,
      nextSeq: seq,
      footerContact: form.footerContact,
      footerRegistry: form.footerRegistry,
      footerBank: form.footerBank,
      closingNote: form.closingNote,
      lookupRequireCode: form.lookupRequireCode,
      airbnbAmountIsGross: form.airbnbAmountIsGross,
    });
  };

  const portalUrl = slug ? `${window.location.origin}/rechnung/${slug}` : null;

  return (
    <>
      <PageHeader
        title="Rechnungen"
        subtitle="Gäste-Rechnungen mit dem wirklich gezahlten Preis — Aussteller, Steuer und das Self-Service-Portal."
      />
      <div className="px-4 sm:px-6 md:px-8 py-6 max-w-3xl space-y-5">
        {!isAdmin && meQ.data && (
          <Card className="px-4 py-3 bg-warning-soft/40 border-warning/30">
            <p className="text-[12.5px] text-ink-soft">
              Nur Owner/Admin können die Rechnungs-Einstellungen ändern.
            </p>
          </Card>
        )}

        {settingsQ.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            {/* Portal */}
            <SectionCard
              title="Self-Service-Portal"
              desc="Gäste rufen ihre Rechnung selbst ab (Identifikation per Name + Reisedaten). Ohne Aktivierung ist das Portal nicht erreichbar."
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-[14px] text-ink">
                  {form.enabled ? 'Portal aktiv' : 'Portal deaktiviert'}
                </span>
                <Switch
                  checked={form.enabled}
                  disabled={!isAdmin}
                  onChange={(v) => set('enabled', v)}
                  aria-label="Portal aktivieren"
                />
              </div>
              {portalUrl && (
                <div className="mt-3 border-t border-line pt-3">
                  <Label>Portal-Link (zum Teilen)</Label>
                  <PortalLink url={portalUrl} />
                </div>
              )}
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
                <span className="text-[13px] text-ink-soft">
                  Zusätzlich OTA-Buchungscode verlangen
                  <span className="block text-[11.5px] text-whisper">
                    Sicherer, aber der Gast muss seinen Airbnb-/Booking-Code kennen.
                  </span>
                </span>
                <Switch
                  checked={form.lookupRequireCode}
                  disabled={!isAdmin}
                  onChange={(v) => set('lookupRequireCode', v)}
                  aria-label="Code verlangen"
                />
              </div>
            </SectionCard>

            {/* Issuer */}
            <SectionCard
              title="Aussteller"
              desc="Erscheint im Kopf + der Fußzeile der Rechnung (§14 UStG)."
            >
              {isAdmin && (
                <div className="flex justify-end mb-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    iconLeft={<Sparkles className="h-4 w-4" />}
                    onClick={() => setForm((f) => ({ ...f, ...TEMPLATE }))}
                  >
                    CITY APARTMENTS ESSEN-Vorlage
                  </Button>
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Firma / Aussteller" value={form.issuerName} onChange={(v) => set('issuerName', v)} disabled={!isAdmin} placeholder="Leopards GmbH" />
                <Field label="Wortmarke (Kopf)" value={form.logoText} onChange={(v) => set('logoText', v)} disabled={!isAdmin} placeholder="CITY APARTMENTS ESSEN" />
                <Field label="Ansprechpartner" value={form.contactPerson} onChange={(v) => set('contactPerson', v)} disabled={!isAdmin} placeholder="Sebastian Teufel" />
                <Field label="Absenderzeile" value={form.senderLine} onChange={(v) => set('senderLine', v)} disabled={!isAdmin} placeholder="Leopards · Am Schlangenberg 3 · 45136 Essen" />
                <Field label="USt-IdNr." value={form.taxId} onChange={(v) => set('taxId', v)} disabled={!isAdmin} placeholder="DE343901469" />
                <Field label="Steuer-Nr." value={form.taxNumber} onChange={(v) => set('taxNumber', v)} disabled={!isAdmin} placeholder="112/5733/1478" />
              </div>
              <div className="mt-3 space-y-1.5">
                <Label>Anschrift (mehrzeilig)</Label>
                <textarea className={AREA_CLS} rows={3} disabled={!isAdmin} value={form.issuerAddress} onChange={(e) => set('issuerAddress', e.target.value)} placeholder={'Am Schlangenberg 3\n45136 Essen\nDeutschland'} />
              </div>
              <div className="mt-3 space-y-1.5">
                <Label>Logo (PNG/JPEG, optional)</Label>
                <div className="flex items-center gap-3 flex-wrap">
                  {settingsQ.data?.logoImageData ? (
                    <img
                      src={settingsQ.data.logoImageData}
                      alt="Logo"
                      className="h-12 max-w-[180px] object-contain rounded border border-line bg-white p-1"
                    />
                  ) : (
                    <span className="text-[12px] text-whisper">
                      Kein Logo — es wird die Wortmarke verwendet.
                    </span>
                  )}
                  {isAdmin && (
                    <>
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/png,image/jpeg"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) onLogoFile(f);
                          e.target.value = '';
                        }}
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={setLogo.isPending}
                        onClick={() => fileRef.current?.click()}
                      >
                        Logo hochladen
                      </Button>
                      {settingsQ.data?.logoImageData && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setLogo.mutate({ logoImageData: null })}
                        >
                          Entfernen
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </SectionCard>

            {/* Tax */}
            <SectionCard title="Steuer" desc="Pro Tenant. City-Tax = Prozentsatz auf den Brutto-Übernachtungspreis (nicht auf die Reinigung).">
              <div className="grid sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="vatmode">USt-Modus</Label>
                  <select
                    id="vatmode"
                    value={form.vatMode}
                    disabled={!isAdmin}
                    onChange={(e) => set('vatMode', e.target.value as 'regular' | 'kleinunternehmer')}
                    className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink focus:border-ink focus:outline-none transition-colors disabled:opacity-60"
                  >
                    <option value="regular">Regelbesteuert</option>
                    <option value="kleinunternehmer">Kleinunternehmer §19</option>
                  </select>
                </div>
                <Field label="USt-Satz (%)" value={form.vatRatePct} onChange={(v) => set('vatRatePct', v)} disabled={!isAdmin || form.vatMode === 'kleinunternehmer'} />
                <Field label="City-Tax (%)" value={form.cityTaxRatePct} onChange={(v) => set('cityTaxRatePct', v)} disabled={!isAdmin} />
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
                <span className="text-[13px] text-ink-soft">
                  Airbnb: Channex liefert den Gesamtbetrag
                  <span className="block text-[11.5px] text-whisper">
                    An = „Booking Total Type: Total Amount" (amount = Brutto). Aus = „Payout
                    Amount" (Brutto = Auszahlung + Provision). Muss zum Channex-Kanal passen.
                  </span>
                </span>
                <Switch
                  checked={form.airbnbAmountIsGross}
                  disabled={!isAdmin}
                  onChange={(v) => set('airbnbAmountIsGross', v)}
                  aria-label="Airbnb Gesamtbetrag"
                />
              </div>
            </SectionCard>

            {/* Labels + numbering */}
            <SectionCard title="Positionen & Nummerierung">
              <div className="grid sm:grid-cols-3 gap-3">
                <Field label="Label Übernachtung" value={form.lodgingLabel} onChange={(v) => set('lodgingLabel', v)} disabled={!isAdmin} />
                <Field label="Label City-Tax" value={form.cityTaxLabel} onChange={(v) => set('cityTaxLabel', v)} disabled={!isAdmin} />
                <Field label="Label Reinigung" value={form.cleaningLabel} onChange={(v) => set('cleaningLabel', v)} disabled={!isAdmin} />
                <Field label="Nummern-Präfix" value={form.numberPrefix} onChange={(v) => set('numberPrefix', v)} disabled={!isAdmin} placeholder="RE-" />
                <Field label="Nächste Nummer" value={form.nextSeq} onChange={(v) => set('nextSeq', v)} disabled={!isAdmin} />
              </div>
              <p className="mt-2 text-[11px] text-whisper">
                Setze die Startnummer so, dass sie nicht mit deinen bisherigen Rechnungen kollidiert.
              </p>
            </SectionCard>

            {/* Footer */}
            <SectionCard title="Fußzeile" desc="Drei Spalten neben der Anschrift (Kontakt · Register/Steuer · Bank).">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Kontakt</Label>
                  <textarea className={AREA_CLS} rows={3} disabled={!isAdmin} value={form.footerContact} onChange={(e) => set('footerContact', e.target.value)} placeholder={'Tel. …\nE-Mail\n…@…'} />
                </div>
                <div className="space-y-1.5">
                  <Label>Register / Steuer / Geschäftsführung</Label>
                  <textarea className={AREA_CLS} rows={5} disabled={!isAdmin} value={form.footerRegistry} onChange={(e) => set('footerRegistry', e.target.value)} placeholder={'Amtsgericht …\nHR-Nr. …\nUSt.-ID …\nSteuer-Nr. …\nGeschäftsführung …'} />
                </div>
                <div className="space-y-1.5">
                  <Label>Bank</Label>
                  <textarea className={AREA_CLS} rows={5} disabled={!isAdmin} value={form.footerBank} onChange={(e) => set('footerBank', e.target.value)} placeholder={'Bank …\nIBAN …\nBIC …'} />
                </div>
                <div className="space-y-1.5">
                  <Label>Schlusssatz</Label>
                  <textarea className={AREA_CLS} rows={2} disabled={!isAdmin} value={form.closingNote} onChange={(e) => set('closingNote', e.target.value)} />
                </div>
              </div>
            </SectionCard>

            {isAdmin && (
              <div className="flex justify-end">
                <Button variant="brand" loading={save.isPending} onClick={onSave}>
                  Speichern
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input value={value} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function PortalLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 min-w-0 truncate text-[12px] text-ink bg-sunken/60 border border-line rounded-md px-2.5 py-2">
        {url}
      </code>
      <Button
        variant="secondary"
        size="sm"
        iconLeft={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        onClick={() => {
          void navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? 'Kopiert' : 'Kopieren'}
      </Button>
    </div>
  );
}
