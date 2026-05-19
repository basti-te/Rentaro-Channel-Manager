/**
 * Full-bleed "subscription required" view shown by the dashboard layout
 * when billing.currentPlan reports !ok (and the tenant isn't exempt).
 *
 * The sidebar stays visible so the user keeps their bearings, but the
 * main area is taken over entirely — no calendar, no settings sections
 * other than billing. Wraps <BillingCard context="lockout"> for the
 * actionable bits.
 */
import { ShieldAlert } from 'lucide-react';
import { BillingCard } from './BillingCard';

export function LockoutScreen() {
  return (
    <div className="px-4 sm:px-6 md:px-10 py-8 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="h-10 w-10 rounded-md bg-negative-soft text-negative flex items-center justify-center">
          <ShieldAlert className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div>
          <h1 className="display text-[22px] font-medium text-ink">
            Workspace gesperrt
          </h1>
          <p className="text-[13px] text-muted mt-0.5">
            Wähle ein Abo, um diesen Workspace wieder freizuschalten. Bestehende
            Daten bleiben erhalten.
          </p>
        </div>
      </div>
      <BillingCard context="lockout" />
    </div>
  );
}
