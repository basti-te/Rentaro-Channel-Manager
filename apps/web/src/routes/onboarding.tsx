/**
 * First-time onboarding wizard. Shown to every tenant whose
 * `onboardedAt` is NULL — i.e. every fresh sign-up. Four steps:
 *
 *   1. Workspace       — name, currency, timezone (required)
 *   2. First Apartment — name + defaults (required)
 *   3. Channex Connect — one-click onboard for the first apartment (skip ok)
 *   4. Plan & Billing  — start trial or subscribe (skip ok)
 *
 * On completion (or "skip remaining") settings.completeOnboarding fires
 * and the user lands on /calendar. The DashboardLayout's redirect guard
 * picks up the new state and never sends the user back here.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { ArrowRight, Check, Loader2, SkipForward } from 'lucide-react';
import { cn } from '@cm/ui';

import { Brand } from '../components/Brand';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Label } from '../components/ui/Label';
import { CURRENCY_FALLBACK, TIMEZONE_FALLBACK, intlSupported, withPreferred } from '../lib/locale-options';
import { useAuth } from '../lib/auth';
import { trpc } from '../lib/trpc';

type Step = 1 | 2 | 3 | 4;

const STEP_LABELS: Record<Step, string> = {
  1: 'Workspace',
  2: 'Erstes Apartment',
  3: 'Schnittstelle',
  4: 'Tarif',
};

export function OnboardingPage() {
  const auth = useAuth();
  const nav = useNavigate();
  const utils = trpc.useUtils();

  // Auth guard — kick to login if logged out
  useEffect(() => {
    if (!auth.loading && !auth.user) {
      void nav({ to: '/login' });
    }
  }, [auth.loading, auth.user, nav]);

  const meQ = trpc.me.current.useQuery(undefined, {
    enabled: !!auth.user,
    retry: false,
  });
  const tenant = meQ.data?.memberships[0];

  // If onboarding already done, leave immediately
  useEffect(() => {
    if (tenant?.onboardedAt) {
      void nav({ to: '/calendar' });
    }
  }, [tenant?.onboardedAt, nav]);

  const [step, setStep] = useState<Step>(1);
  const [createdApartmentId, setCreatedApartmentId] = useState<string | null>(null);

  // Final wizard close — mark onboarded, jump to calendar.
  // We await the invalidate so the DashboardLayout sees the fresh
  // `onboardedAt` before its redirect-guard runs, avoiding a flicker
  // calendar → /onboarding → calendar.
  const complete = trpc.settings.completeOnboarding.useMutation({
    onSuccess: async () => {
      toast.success('Setup abgeschlossen — willkommen bei Rentaro!');
      await utils.me.current.invalidate();
      void nav({ to: '/calendar' });
    },
    onError: (e) => toast.error(e.message),
  });

  if (auth.loading || !auth.user || meQ.isLoading || !tenant) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-canvas">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-canvas flex flex-col grain">
      {/* Top bar — brand on the left, sign-out top right */}
      <header className="border-b border-line bg-surface/80 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Brand />
          <button
            type="button"
            onClick={() => auth.signOut().then(() => nav({ to: '/login' }))}
            className="text-[12.5px] text-muted hover:text-ink"
          >
            Abmelden
          </button>
        </div>
      </header>

      {/* Step indicator */}
      <StepIndicator current={step} />

      {/* Card area */}
      <main className="flex-1 flex items-start justify-center px-4 sm:px-6 pt-8 pb-16">
        <div className="w-full max-w-2xl">
          {step === 1 && (
            <WorkspaceStep
              tenant={tenant}
              onDone={() => setStep(2)}
            />
          )}
          {step === 2 && (
            <ApartmentStep
              defaultCurrency={tenant.defaultCurrency ?? 'EUR'}
              onDone={(id) => {
                setCreatedApartmentId(id);
                setStep(3);
              }}
            />
          )}
          {step === 3 && (
            <ChannexStep
              apartmentId={createdApartmentId}
              onDone={() => setStep(4)}
              onSkip={() => setStep(4)}
            />
          )}
          {step === 4 && (
            <BillingStep
              onDone={() => complete.mutate()}
              onSkip={() => complete.mutate()}
              completing={complete.isPending}
            />
          )}
        </div>
      </main>
    </div>
  );
}

// ─── Step indicator ─────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: Step }) {
  const steps: Step[] = [1, 2, 3, 4];
  return (
    <div className="border-b border-line bg-surface">
      <div className="max-w-3xl mx-auto px-6 py-5">
        <div className="flex items-center gap-2 sm:gap-3">
          {steps.map((s, i) => {
            const isPast = s < current;
            const isActive = s === current;
            return (
              <div key={s} className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                <div
                  className={cn(
                    'inline-flex items-center justify-center h-7 w-7 rounded-full',
                    'text-[12px] font-semibold flex-shrink-0 transition-colors',
                    isPast && 'bg-brand text-white',
                    isActive && 'bg-brand text-white shadow-sm',
                    !isPast && !isActive && 'bg-sunken text-muted border border-line',
                  )}
                >
                  {isPast ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : s}
                </div>
                <span
                  className={cn(
                    'text-[12.5px] truncate hidden sm:inline',
                    isActive ? 'text-ink font-medium' : 'text-muted',
                  )}
                >
                  {STEP_LABELS[s]}
                </span>
                {i < steps.length - 1 && (
                  <div className="flex-1 h-px bg-line hidden sm:block" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Card wrapper ───────────────────────────────────────────────────────────

function StepCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-surface border border-line rounded-xl shadow-sm overflow-hidden animate-fade-up">
      <div className="px-6 sm:px-8 pt-7 pb-5">
        <h1 className="display text-[26px] sm:text-[30px] font-medium text-ink leading-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-2 text-[14px] text-muted leading-relaxed max-w-prose">
            {subtitle}
          </p>
        )}
      </div>
      <div className="px-6 sm:px-8 pb-7">{children}</div>
    </div>
  );
}

// ─── Step 1: Workspace ──────────────────────────────────────────────────────

interface WorkspaceTenant {
  tenantName: string | null;
  defaultCurrency: string | null;
  defaultCityTaxRateBp: number | null;
  defaultCheckinTime: string | null;
  defaultCheckoutTime: string | null;
}

function WorkspaceStep({
  tenant,
  onDone,
}: {
  tenant: WorkspaceTenant;
  onDone: () => void;
}) {
  const [name, setName] = useState(tenant.tenantName ?? '');
  const [currency, setCurrency] = useState(tenant.defaultCurrency ?? 'EUR');
  const [timezone, setTimezone] = useState('Europe/Berlin');

  const update = trpc.settings.updateTenant.useMutation({
    onSuccess: () => onDone(),
    onError: (e) => toast.error(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    update.mutate({
      name: name.trim(),
      defaultCurrency: currency,
      defaultTimezone: timezone,
      defaultCityTaxRateBp: tenant.defaultCityTaxRateBp ?? 500,
      defaultCheckinTime: tenant.defaultCheckinTime ?? '15:00',
      defaultCheckoutTime: tenant.defaultCheckoutTime ?? '11:00',
    });
  }

  return (
    <StepCard
      title="Dein Workspace"
      subtitle="So nennst du dein Vermietungs-Business in Rentaro. Du kannst die Werte später jederzeit unter Einstellungen ändern."
    >
      <form onSubmit={submit} className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="onb-name">Workspace-Name</Label>
          <Input
            id="onb-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. CITY APARTMENTS ESSEN"
            maxLength={80}
            autoFocus
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="onb-currency">Standardwährung</Label>
            <select
              id="onb-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink focus:border-ink focus:outline-none"
            >
              {withPreferred(
                intlSupported('currency', CURRENCY_FALLBACK),
                'EUR',
                currency,
              ).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="onb-tz">Zeitzone</Label>
            <select
              id="onb-tz"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink focus:border-ink focus:outline-none"
            >
              {withPreferred(
                intlSupported('timeZone', TIMEZONE_FALLBACK),
                'Europe/Berlin',
                timezone,
              ).map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex justify-end pt-2">
          <Button
            type="submit"
            variant="brand"
            loading={update.isPending}
            disabled={!name.trim() || update.isPending}
            iconRight={<ArrowRight className="h-4 w-4" />}
          >
            Weiter
          </Button>
        </div>
      </form>
    </StepCard>
  );
}

// ─── Step 2: First Apartment ────────────────────────────────────────────────

function ApartmentStep({
  defaultCurrency,
  onDone,
}: {
  defaultCurrency: string;
  onDone: (apartmentId: string) => void;
}) {
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  const [minStay, setMinStay] = useState('1');
  const [currency, setCurrency] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const create = trpc.properties.create.useMutation();
  const update = trpc.properties.update.useMutation();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const rateNum = rate.trim() === '' ? null : Number(rate.replace(',', '.'));
    const minStayNum = parseInt(minStay, 10) || 1;
    setSubmitting(true);
    try {
      // Create the bare apartment first — that's the part the API exposes
      // out of the box. Then PATCH the per-night defaults in a second call.
      const row = await create.mutateAsync({
        name: name.trim(),
        groupId: null,
        currency: currency ?? undefined,
      });
      if (!row) throw new Error('Apartment-Erstellung schlug fehl');
      if (rateNum != null && Number.isFinite(rateNum) || minStayNum > 1) {
        await update.mutateAsync({
          id: row.id,
          defaultRateCents:
            rateNum != null && Number.isFinite(rateNum)
              ? Math.round(rateNum * 100)
              : undefined,
          defaultMinStay: minStayNum,
        });
      }
      toast.success(`${row.name} angelegt`);
      onDone(row.id);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <StepCard
      title="Dein erstes Apartment"
      subtitle="Leg eine erste Ferienwohnung an. Diese Wohnung kannst du gleich danach mit unserer Schnittstelle verbinden und an Booking.com/Airbnb anschließen. Weitere Apartments fügst du später aus der Apartments-Seite hinzu."
    >
      <form onSubmit={submit} className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="onb-apt-name">Name</Label>
          <Input
            id="onb-apt-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Apartment Vorrathstraße 1"
            maxLength={120}
            autoFocus
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-1 space-y-1.5">
            <Label htmlFor="onb-apt-rate">Standardpreis / Nacht</Label>
            <Input
              id="onb-apt-rate"
              inputMode="decimal"
              placeholder="z. B. 89"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </div>
          <div className="sm:col-span-1 space-y-1.5">
            <Label htmlFor="onb-apt-min">Min. Aufenthalt</Label>
            <Input
              id="onb-apt-min"
              type="number"
              min={1}
              value={minStay}
              onChange={(e) => setMinStay(e.target.value)}
            />
          </div>
          <div className="sm:col-span-1 space-y-1.5">
            <Label htmlFor="onb-apt-cur">Währung</Label>
            <select
              id="onb-apt-cur"
              value={currency ?? ''}
              onChange={(e) => setCurrency(e.target.value || null)}
              className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink focus:border-ink focus:outline-none"
            >
              <option value="">{defaultCurrency} (Standard)</option>
              {withPreferred(
                intlSupported('currency', CURRENCY_FALLBACK),
                defaultCurrency,
                currency ?? defaultCurrency,
              )
                .filter((c) => c !== defaultCurrency)
                .map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
            </select>
          </div>
        </div>
        <div className="flex justify-end pt-2">
          <Button
            type="submit"
            variant="brand"
            loading={submitting}
            disabled={!name.trim() || submitting}
            iconRight={<ArrowRight className="h-4 w-4" />}
          >
            Weiter
          </Button>
        </div>
      </form>
    </StepCard>
  );
}

// ─── Step 3: Channex (skippable) ────────────────────────────────────────────

function ChannexStep({
  apartmentId,
  onDone,
  onSkip,
}: {
  apartmentId: string | null;
  onDone: () => void;
  onSkip: () => void;
}) {
  const onboard = trpc.properties.onboardToChannex.useMutation({
    onSuccess: () => {
      toast.success('Schnittstelle verbunden — Channels sind synchronisiert');
      onDone();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <StepCard
      title="An die Buchungsplattformen anschließen"
      subtitle="Unsere Schnittstelle stellt die Verbindung zu Booking.com, Airbnb, Expedia & Co. her. Mit einem Klick legen wir die Anbindung im Hintergrund an — danach kannst du deine OTA-Kanäle einrichten und Verfügbarkeit, Preise und Buchungen fließen automatisch."
    >
      <div className="rounded-md border border-line bg-canvas/60 p-4 text-[13px] text-muted leading-relaxed space-y-2">
        <p>
          Wenn du auf <span className="font-medium text-ink">Verbinden</span> klickst, registrieren
          wir deine Unterkunft in der Schnittstelle — mit den Defaults, die du oben angegeben hast.
        </p>
        <p>
          Du kannst diesen Schritt auch <span className="font-medium text-ink">überspringen</span>{' '}
          und später aus der Apartments-Seite verbinden — z. B. wenn du erstmal lokal mit
          Direkt-Buchungen testen willst.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 mt-6">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onSkip}
          disabled={onboard.isPending}
          iconLeft={<SkipForward className="h-3.5 w-3.5" />}
        >
          Später einrichten
        </Button>
        <Button
          type="button"
          variant="brand"
          loading={onboard.isPending}
          disabled={!apartmentId || onboard.isPending}
          iconRight={<ArrowRight className="h-4 w-4" />}
          onClick={() => apartmentId && onboard.mutate({ propertyId: apartmentId })}
        >
          Jetzt verbinden
        </Button>
      </div>
    </StepCard>
  );
}

// ─── Step 4: Plan & Billing (skippable) ─────────────────────────────────────

function BillingStep({
  onDone,
  onSkip,
  completing,
}: {
  onDone: () => void;
  onSkip: () => void;
  completing: boolean;
}) {
  // For v1 we keep this purely informational — the trial row is already
  // created during bootstrap, so "Trial starten" just closes the wizard.
  // A real "Subscribe now" flow can come post-launch.
  return (
    <StepCard
      title="14 Tage kostenlos testen"
      subtitle="Rentaro startet mit einem 14-Tage-Trial — keine Kreditkarte nötig. Du kannst während des Trials alle Features ausprobieren. Danach wählst du einen Tarif (siehe Einstellungen → Abrechnung)."
    >
      <div className="rounded-lg border border-line p-5 space-y-3 bg-canvas/60">
        <div className="flex items-baseline justify-between">
          <span className="text-[15px] font-medium text-ink">Trial-Phase</span>
          <span className="num text-[22px] font-medium text-ink">14 Tage</span>
        </div>
        <ul className="text-[13px] text-muted space-y-1.5">
          <li className="flex items-start gap-2">
            <Check className="h-3.5 w-3.5 mt-0.5 text-positive flex-shrink-0" />
            Alle Features freigeschaltet
          </li>
          <li className="flex items-start gap-2">
            <Check className="h-3.5 w-3.5 mt-0.5 text-positive flex-shrink-0" />
            Keine Kreditkarte erforderlich
          </li>
          <li className="flex items-start gap-2">
            <Check className="h-3.5 w-3.5 mt-0.5 text-positive flex-shrink-0" />
            Tarif wählst du erst, wenn du sicher bist
          </li>
        </ul>
      </div>

      <div className="flex items-center justify-between gap-3 mt-6">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onSkip}
          disabled={completing}
          iconLeft={<SkipForward className="h-3.5 w-3.5" />}
        >
          Tarif später wählen
        </Button>
        <Button
          type="button"
          variant="brand"
          loading={completing}
          disabled={completing}
          iconRight={<ArrowRight className="h-4 w-4" />}
          onClick={onDone}
        >
          Setup abschließen
        </Button>
      </div>
    </StepCard>
  );
}
