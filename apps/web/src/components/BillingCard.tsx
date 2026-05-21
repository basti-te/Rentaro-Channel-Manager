/**
 * Billing UI panel. Two contexts:
 *   - "settings": embedded as a section on /settings (normal management).
 *   - "lockout":  rendered full-bleed by LockoutScreen when the back-end
 *                 plan-gate has blocked the tenant.
 *
 * Both share the same actions (plan picker → Stripe Checkout, Customer
 * Portal). The lockout context renders a more prominent header + status.
 */
import { CheckCircle2, AlertCircle, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@cm/ui';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Skeleton } from './ui/Skeleton';
import { trpc } from '../lib/trpc';

const REASON_LABEL: Record<string, { de: string; tone: 'ok' | 'warn' | 'block' }> = {
  exempt: { de: 'Workspace abrechnungsfrei (Owner-Konto)', tone: 'ok' },
  active: { de: 'Abonnement aktiv', tone: 'ok' },
  trialing: { de: 'Probezeit läuft', tone: 'ok' },
  trial_expired: { de: 'Probezeit abgelaufen — Abo wählen, um weiterzumachen', tone: 'block' },
  past_due: { de: 'Zahlung fehlgeschlagen — Karte aktualisieren', tone: 'block' },
  canceled: { de: 'Abonnement gekündigt — neu starten, um weiterzumachen', tone: 'block' },
  incomplete: { de: 'Bezahlung unvollständig — bitte abschließen', tone: 'block' },
  unpaid: { de: 'Offene Rechnung — bitte über das Kundenportal begleichen', tone: 'block' },
  no_subscription: { de: 'Kein aktives Abonnement', tone: 'block' },
};

function daysFromNow(d: Date | string | null | undefined): number {
  if (!d) return 0;
  const ms = new Date(d).getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.max(1, Math.ceil(ms / 86_400_000));
}

export function BillingCard({ context }: { context: 'settings' | 'lockout' }) {
  const planQ = trpc.billing.currentPlan.useQuery();
  const plansQ = trpc.billing.plans.useQuery();

  const startCheckout = trpc.billing.startCheckout.useMutation({
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (e) => toast.error(e.message),
  });
  const openPortal = trpc.billing.openPortal.useMutation({
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (e) => toast.error(e.message),
  });

  if (planQ.isLoading) return <Skeleton className="h-44 w-full rounded-xl" />;
  if (!planQ.data) return null;
  const p = planQ.data;
  const meta = REASON_LABEL[p.reason] ?? REASON_LABEL.no_subscription!;

  if (p.billingExempt) {
    return (
      <Card className="px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-md bg-brand-soft text-brand flex items-center justify-center">
            <Sparkles className="h-4.5 w-4.5" strokeWidth={1.75} />
          </div>
          <div>
            <h2 className="display text-[16px] font-medium text-ink">Abrechnung</h2>
            <p className="text-[12.5px] text-muted mt-0.5">
              Dieser Workspace ist von der SaaS-Abrechnung ausgenommen (Owner-Konto).
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const subscribed = p.subscribed;
  const isLocked = !p.ok;
  const trialDays = p.reason === 'trialing' ? daysFromNow(p.trialEndsAt) : 0;
  const stripeReady = (plansQ.data?.length ?? 0) > 0;

  // Plan picker: only while the tenant still needs to (re)subscribe.
  // Once subscribed (trial or active) plan changes go through the Portal.
  const showPlanPicker = stripeReady && (!subscribed || isLocked);
  // Customer Portal: once there is a real subscription to manage.
  const showPortal = subscribed;

  // "trialing" splits in two — not-yet-subscribed vs subscribed-in-trial.
  const headline =
    p.reason === 'trialing' && subscribed
      ? 'Abonnement abgeschlossen — Probezeit läuft'
      : meta.de;
  const tone: 'ok' | 'warn' | 'block' =
    p.reason === 'trialing' && subscribed ? 'ok' : meta.tone;

  return (
    <Card className={cn('px-5 py-4', context === 'lockout' && 'border-negative/40')}>
      <div className="flex items-start gap-3 mb-4">
        <div
          className={cn(
            'h-9 w-9 rounded-md flex items-center justify-center flex-shrink-0',
            tone === 'ok'
              ? 'bg-brand-soft text-brand'
              : tone === 'warn'
                ? 'bg-warning-soft text-warning'
                : 'bg-negative-soft text-negative',
          )}
        >
          {tone === 'ok' ? (
            <CheckCircle2 className="h-4.5 w-4.5" strokeWidth={1.75} />
          ) : (
            <AlertCircle className="h-4.5 w-4.5" strokeWidth={1.75} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="display text-[16px] font-medium text-ink">
            {context === 'lockout' ? 'Abonnement erforderlich' : 'Abrechnung'}
          </h2>
          <p className="text-[12.5px] text-muted mt-0.5">{headline}</p>
          {p.reason === 'trialing' && trialDays > 0 && (
            <p className="text-[12.5px] text-ink-soft mt-1">
              Noch <span className="num font-medium">{trialDays}</span>{' '}
              {trialDays === 1 ? 'Tag' : 'Tage'} Probezeit
              {subscribed
                ? ' — danach wird dein Abo automatisch abgerechnet.'
                : ` von ${p.trialDaysTotal} — wähle ein Abo, um Rentaro nahtlos weiterzunutzen.`}
            </p>
          )}
        </div>
      </div>

      {showPlanPicker && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
          {plansQ.data!.map((opt) => (
            <button
              key={opt.interval}
              type="button"
              disabled={startCheckout.isPending}
              onClick={() => startCheckout.mutate({ interval: opt.interval })}
              className={cn(
                'rounded-lg border border-line px-4 py-3 text-left transition-colors',
                'hover:border-ink hover:bg-sunken/40',
                'focus:outline-none focus-visible:border-ink focus-visible:bg-sunken/40',
                'disabled:opacity-60 disabled:cursor-not-allowed',
                opt.interval === 'annual' && 'border-brand/30 bg-brand-soft/30',
              )}
            >
              <div className="text-[13.5px] font-medium text-ink">
                {opt.label}
              </div>
              <div className="text-[11.5px] text-muted mt-0.5">
                {opt.interval === 'monthly'
                  ? 'Flexibel — monatliche Abrechnung'
                  : 'Spare 10 % gegenüber monatlich'}
              </div>
            </button>
          ))}
        </div>
      )}

      {!stripeReady && !subscribed && (
        <div className="rounded-md border border-line px-3 py-2 text-[12px] text-muted mb-3">
          Stripe ist noch nicht eingerichtet (Preis-IDs fehlen).
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap pt-1 border-t border-line/60 mt-1">
        <div className="text-[11.5px] text-whisper">
          {showPortal
            ? 'Rechnungen, Karte und Plan-Wechsel über das Kundenportal.'
            : 'Nach dem Abschluss erscheint hier das Kundenportal.'}
        </div>
        {showPortal && (
          <Button
            size="sm"
            variant="secondary"
            loading={openPortal.isPending}
            onClick={() => openPortal.mutate()}
          >
            Kundenportal öffnen
          </Button>
        )}
      </div>

      {isLocked && context === 'settings' && (
        <p className="text-[11.5px] text-negative mt-3">
          Solange das Abo nicht aktiv ist, sind Änderungen (neue Buchungen,
          Sync, Nachrichten) gesperrt.
        </p>
      )}
    </Card>
  );
}
