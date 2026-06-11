import { useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown } from 'lucide-react';
import { cn } from '@cm/ui';

import { PageHeader } from './_dashboard';
import { Button } from '../components/ui/Button';
import { Switch } from '../components/ui/Switch';
import { Card } from '../components/ui/Card';
import { SectionCard } from '../components/ui/SectionCard';
import { Skeleton } from '../components/ui/Skeleton';
import { trpc } from '../lib/trpc';

/**
 * KI-Gastnachrichten — the home for everything about the AI guest-reply
 * assistant: the per-tenant on/auto-send switches AND the per-apartment
 * knowledge the model answers from. Both used to live elsewhere (Settings /
 * Apartments); consolidated here so the AI story is in one place.
 */
export function KiGuestMessagesPage() {
  const meQ = trpc.me.current.useQuery();
  const role = meQ.data?.memberships?.[0]?.role;
  const isAdmin = role === 'owner' || role === 'admin';
  const utils = trpc.useUtils();
  const tenantQ = trpc.settings.tenant.useQuery();

  return (
    <>
      <PageHeader
        title="KI-Gastnachrichten"
        subtitle="Die KI entwirft Antworten auf Gast-Nachrichten (Airbnb / Booking) — und das Wissen, aus dem sie schöpft."
      />
      <div className="px-4 sm:px-6 md:px-8 py-6 max-w-3xl space-y-5">
        {!isAdmin && meQ.data && (
          <Card className="px-4 py-3 bg-warning-soft/40 border-warning/30">
            <p className="text-[12.5px] text-ink-soft">
              Nur Owner/Admin können diese Einstellungen ändern — du kannst sie
              ansehen.
            </p>
          </Card>
        )}

        {tenantQ.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : tenantQ.data ? (
          <AiRepliesSection
            repliesEnabled={tenantQ.data.aiRepliesEnabled}
            autoSend={tenantQ.data.aiAutoSend}
            disabled={!isAdmin}
            onSaved={() => utils.settings.tenant.invalidate()}
          />
        ) : null}

        <ApartmentKnowledgeSection disabled={!isAdmin} />
      </div>
    </>
  );
}

function AiRepliesSection({
  repliesEnabled,
  autoSend,
  disabled,
  onSaved,
}: {
  repliesEnabled: boolean;
  autoSend: boolean;
  disabled: boolean;
  onSaved: () => void;
}) {
  const save = trpc.settings.setAiReplies.useMutation({
    onSuccess: () => {
      onSaved();
      toast.success('Gespeichert');
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <SectionCard
      title="KI-Gastantworten"
      desc="Kostenpflichtiges Add-on — die KI entwirft Antworten auf Gast-Nachrichten (Airbnb/Booking) aus dem hinterlegten Apartment-Wissen. Standard: du gibst jede Antwort frei."
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[14px] text-ink">
          {repliesEnabled ? 'KI-Antworten aktiviert' : 'KI-Antworten deaktiviert'}
        </span>
        <Switch
          checked={repliesEnabled}
          disabled={disabled || save.isPending}
          onChange={(next) =>
            save.mutate({ aiRepliesEnabled: next, aiAutoSend: next ? autoSend : false })
          }
          aria-label="KI-Gastantworten aktivieren"
        />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
        <span className={cn('text-[14px]', repliesEnabled ? 'text-ink' : 'text-whisper')}>
          Auto-Send
          <span className="block text-[11.5px] text-whisper">
            Antworten ohne Freigabe direkt senden.
          </span>
        </span>
        <Switch
          checked={autoSend}
          disabled={disabled || !repliesEnabled || save.isPending}
          onChange={(next) => save.mutate({ aiRepliesEnabled: repliesEnabled, aiAutoSend: next })}
          aria-label="Auto-Send aktivieren"
        />
      </div>
      <p className="mt-3 text-[11px] text-whisper">
        Das Wissen pro Apartment pflegst du unten. Entwürfe erscheinen auf der
        Buchungs-Detailseite.
      </p>
    </SectionCard>
  );
}

interface ApartmentRow {
  id: string;
  name: string;
  aiKnowledge: string | null;
}

function ApartmentKnowledgeSection({ disabled }: { disabled: boolean }) {
  const listQ = trpc.properties.list.useQuery();
  return (
    <SectionCard
      title="Apartment-Info"
      desc="Pro Apartment hinterlegtes Wissen — WLAN, Türcode, Anfahrt, Hausregeln, Tipps. Die KI beantwortet Gastfragen ausschließlich anhand dieser Infos."
    >
      {listQ.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (listQ.data?.length ?? 0) === 0 ? (
        <p className="text-[12.5px] text-muted">Noch keine Apartments angelegt.</p>
      ) : (
        <ul className="rounded-md border border-line divide-y divide-line">
          {listQ.data!.map((p) => (
            <ApartmentKnowledgeRow key={p.id} property={p} disabled={disabled} />
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function ApartmentKnowledgeRow({
  property,
  disabled,
}: {
  property: ApartmentRow;
  disabled: boolean;
}) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(property.aiKnowledge ?? '');
  const save = trpc.properties.setAiKnowledge.useMutation({
    onSuccess: () => {
      toast.success('KI-Wissen gespeichert');
      void utils.properties.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const saved = property.aiKnowledge ?? '';
  const dirty = value !== saved;
  const hasKnowledge = saved.trim().length > 0;

  return (
    <li className="px-3 py-2.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 text-left"
        aria-expanded={open}
      >
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] text-ink truncate">{property.name}</div>
          <div className={cn('text-[12px]', hasKnowledge ? 'text-muted' : 'text-whisper')}>
            {hasKnowledge ? `${saved.length} Zeichen hinterlegt` : 'Noch kein Wissen'}
          </div>
        </div>
        <span
          className={cn(
            'text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 border',
            hasKnowledge
              ? 'text-brand border-brand/30 bg-brand-soft/30'
              : 'text-whisper border-line',
          )}
        >
          {hasKnowledge ? 'hinterlegt' : 'leer'}
        </span>
        <ChevronDown
          className={cn('h-4 w-4 text-whisper transition-transform', open && 'rotate-180')}
          strokeWidth={1.75}
        />
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={6}
            maxLength={8000}
            disabled={disabled}
            placeholder="WLAN, Türcode, Anfahrt, Hausregeln, Tipps … — die KI beantwortet Gastfragen ausschließlich anhand dieser Infos."
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-[13px] leading-relaxed text-ink focus:border-ink focus:outline-none transition-colors resize-y disabled:opacity-60"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-whisper num">{value.length}/8000</span>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              loading={save.isPending}
              disabled={disabled || !dirty || save.isPending}
              onClick={() => save.mutate({ id: property.id, aiKnowledge: value })}
            >
              Speichern
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
