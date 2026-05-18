import { useEffect, useMemo, useState } from 'react';
import { MessageSquare, AlertTriangle } from 'lucide-react';
import { cn } from '@cm/ui';

import { PageHeader } from './_dashboard';
import { Card } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { trpc } from '../lib/trpc';

export function MessagesPage() {
  const propsQ = trpc.properties.list.useQuery();

  // Only Channex-connected apartments can have a guest inbox.
  const connected = useMemo(
    () => (propsQ.data ?? []).filter((p) => !!p.channexPropertyRef),
    [propsQ.data],
  );

  const [propertyId, setPropertyId] = useState<string | null>(null);

  // Default to the first connected property once loaded.
  useEffect(() => {
    if (!propertyId && connected.length > 0) setPropertyId(connected[0]!.id);
  }, [connected, propertyId]);

  const sessionQ = trpc.messages.iframeSession.useQuery(
    { propertyId: propertyId! },
    {
      enabled: !!propertyId,
      // The OTT is single-use and consumed when the iframe loads — don't
      // let React Query silently refetch (and burn tokens) on focus.
      refetchOnWindowFocus: false,
      staleTime: 10 * 60_000,
      retry: false,
    },
  );

  const selectedName = connected.find((p) => p.id === propertyId)?.name ?? null;

  return (
    <>
      <PageHeader
        title="Nachrichten"
        subtitle="Gast-Inbox (Airbnb, Booking.com, Expedia) — bereitgestellt über Channex."
        action={
          connected.length > 0 ? (
            <select
              value={propertyId ?? ''}
              onChange={(e) => setPropertyId(e.target.value)}
              className="h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink focus:border-ink focus:outline-none transition-colors"
              aria-label="Apartment auswählen"
            >
              {connected.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : null
        }
      />

      <div className="px-4 sm:px-6 md:px-8 py-6">
        {propsQ.isLoading ? (
          <Skeleton className="h-[70vh] w-full rounded-xl" />
        ) : connected.length === 0 ? (
          <EmptyState
            title="Kein verbundenes Apartment"
            body="Verbinde zuerst ein Apartment mit Channex (Seite „Apartments“), dann erscheint hier die Gast-Inbox."
          />
        ) : sessionQ.isLoading ? (
          <Skeleton className="h-[70vh] w-full rounded-xl" />
        ) : sessionQ.isError ? (
          <EmptyState
            variant="error"
            title="Inbox nicht verfügbar"
            body={
              sessionQ.error.message ||
              'Die Channex-Messaging-Session konnte nicht erstellt werden.'
            }
          />
        ) : sessionQ.data ? (
          <div className="rounded-xl border border-line overflow-hidden bg-surface shadow-sm">
            <iframe
              key={sessionQ.data.url}
              src={sessionQ.data.url}
              title={`Gast-Inbox ${selectedName ?? ''}`}
              className="w-full h-[calc(100dvh-220px)] min-h-[480px] block"
              // Channex chat needs scripts + its own same-origin session.
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              referrerPolicy="no-referrer"
            />
          </div>
        ) : null}
      </div>
    </>
  );
}

function EmptyState({
  title,
  body,
  variant = 'default',
}: {
  title: string;
  body: string;
  variant?: 'default' | 'error';
}) {
  const isError = variant === 'error';
  return (
    <Card className="p-10 text-center max-w-[52ch] mx-auto">
      <div
        className={cn(
          'mx-auto h-12 w-12 rounded-md flex items-center justify-center mb-4',
          isError ? 'bg-negative-soft text-negative' : 'bg-brand-soft text-brand',
        )}
      >
        {isError ? (
          <AlertTriangle className="h-5 w-5" strokeWidth={1.75} />
        ) : (
          <MessageSquare className="h-5 w-5" strokeWidth={1.75} />
        )}
      </div>
      <h3 className="display text-[20px] font-medium text-ink">{title}</h3>
      <p className="mt-2 text-[13px] text-muted leading-relaxed">{body}</p>
    </Card>
  );
}
