import { useState } from 'react';
import { toast } from 'sonner';
import { Copy, Check, ExternalLink } from 'lucide-react';
import { cn } from '@cm/ui';

import { PageHeader } from './_dashboard';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { trpc } from '../lib/trpc';

type Channel = 'airbnb' | 'booking';

const CHANNEL_META: Record<
  Channel,
  { label: string; dot: string; placeholder: string }
> = {
  airbnb: {
    label: 'Airbnb',
    dot: 'bg-[#FF5A5F]',
    placeholder: 'https://www.airbnb.de/rooms/… — Link einfügen',
  },
  booking: {
    label: 'Booking.com',
    dot: 'bg-[#003580]',
    placeholder: 'https://www.booking.com/hotel/… — Link einfügen',
  },
};

export function ListingLinksPage() {
  const q = trpc.properties.list.useQuery();

  return (
    <>
      <PageHeader
        title="Listing-Links"
        subtitle="Airbnb- und Booking.com-Links je Apartment — mit einem Klick kopieren und z. B. per WhatsApp teilen."
      />
      <div className="px-4 sm:px-6 md:px-8 py-6 max-w-3xl space-y-4">
        {q.isLoading ? (
          <>
            <div className="h-28 w-full rounded-lg bg-sunken animate-pulse" />
            <div className="h-28 w-full rounded-lg bg-sunken animate-pulse" />
          </>
        ) : !q.data || q.data.length === 0 ? (
          <Card className="px-5 py-10 text-center">
            <p className="text-[13px] text-muted">
              Noch keine Apartments. Lege zuerst unter „Apartments" welche an.
            </p>
          </Card>
        ) : (
          q.data.map((p) => (
            <Card key={p.id} className="overflow-hidden">
              <div className="flex items-center gap-2 border-b border-line px-5 py-3">
                <h3 className="flex-1 truncate text-[14.5px] font-semibold text-ink">
                  {p.name}
                </h3>
                {p.group && (
                  <span className="flex-shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-whisper">
                    {p.group.name}
                  </span>
                )}
              </div>
              <div className="divide-y divide-line">
                <LinkRow propertyId={p.id} channel="airbnb" initialUrl={p.airbnbListingUrl} />
                <LinkRow propertyId={p.id} channel="booking" initialUrl={p.bookingListingUrl} />
              </div>
            </Card>
          ))
        )}
      </div>
    </>
  );
}

function LinkRow({
  propertyId,
  channel,
  initialUrl,
}: {
  propertyId: string;
  channel: Channel;
  initialUrl: string | null;
}) {
  const meta = CHANNEL_META[channel];
  const utils = trpc.useUtils();
  const [val, setVal] = useState(initialUrl ?? '');
  const [saved, setSaved] = useState(initialUrl ?? '');
  const [copied, setCopied] = useState(false);

  const save = trpc.properties.setListingLinks.useMutation({
    onSuccess: (row) => {
      const next = (channel === 'airbnb' ? row.airbnbListingUrl : row.bookingListingUrl) ?? '';
      setSaved(next);
      setVal(next);
      utils.properties.list.invalidate();
      toast.success(`${meta.label}-Link gespeichert`);
    },
    onError: (e) => {
      setVal(saved); // revert the field
      toast.error(e.message);
    },
  });

  const effective = val.trim() || saved;
  const hasUrl = effective.length > 0;
  const dirty = val.trim() !== saved;

  function commit() {
    const v = val.trim();
    if (v === saved) return;
    if (v !== '' && !/^https?:\/\//i.test(v)) {
      toast.error('Bitte eine vollständige URL eingeben (https://…).');
      return;
    }
    const url = v === '' ? null : v;
    save.mutate(
      channel === 'airbnb'
        ? { id: propertyId, airbnbListingUrl: url }
        : { id: propertyId, bookingListingUrl: url },
    );
  }

  async function copy() {
    if (!hasUrl) return;
    try {
      await navigator.clipboard.writeText(effective);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
      toast.success(`${meta.label}-Link kopiert`);
    } catch {
      toast.error('Kopieren fehlgeschlagen');
    }
  }

  return (
    <div className="px-5 py-3">
      <div className="flex items-center gap-2.5">
        <span className="flex w-[96px] flex-shrink-0 items-center gap-1.5">
          <span className={cn('h-2 w-2 rounded-full', meta.dot)} />
          <span className="text-[12.5px] font-medium text-ink-soft">{meta.label}</span>
        </span>
        <Input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          placeholder={meta.placeholder}
          className="h-9 min-w-0 flex-1 font-mono text-[12.5px]"
          inputMode="url"
          aria-label={`${meta.label}-Link`}
        />
        <button
          type="button"
          onClick={copy}
          disabled={!hasUrl}
          title="Link kopieren"
          aria-label={`${meta.label}-Link kopieren`}
          className={cn(
            'inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border transition-colors',
            'disabled:cursor-not-allowed disabled:opacity-40',
            copied
              ? 'border-positive/40 bg-positive-soft text-positive'
              : 'border-line bg-surface text-ink-soft hover:bg-sunken hover:text-ink',
          )}
        >
          {copied ? (
            <Check className="h-4 w-4" strokeWidth={2.5} />
          ) : (
            <Copy className="h-4 w-4" strokeWidth={1.75} />
          )}
        </button>
        <a
          href={hasUrl ? effective : undefined}
          target="_blank"
          rel="noopener noreferrer"
          title="In neuem Tab öffnen"
          aria-label={`${meta.label}-Link öffnen`}
          className={cn(
            'inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-line transition-colors',
            hasUrl
              ? 'bg-surface text-ink-soft hover:bg-sunken hover:text-ink'
              : 'pointer-events-none opacity-40',
          )}
        >
          <ExternalLink className="h-4 w-4" strokeWidth={1.75} />
        </a>
      </div>
      {dirty && (
        <div className="mt-1.5 text-[11px] text-whisper">
          {save.isPending ? 'Speichern…' : 'Zum Speichern Feld verlassen oder Enter drücken'}
        </div>
      )}
    </div>
  );
}
