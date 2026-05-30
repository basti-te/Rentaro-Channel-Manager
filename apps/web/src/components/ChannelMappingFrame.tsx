import { AlertTriangle } from 'lucide-react';
import { cn } from '@cm/ui';

import { trpc } from '../lib/trpc';
import { Card } from './ui/Card';
import { Skeleton } from './ui/Skeleton';

/**
 * Embeds the Channex self-service channel-mapping screen for one property.
 *
 * The tenant connects + maps their own real Airbnb / Booking.com / … listings
 * here, with no operator involvement. The API key never reaches the browser —
 * `channels.iframeSession` mints a one-time token server-side and returns a
 * ready `/auth/exchange?...redirect_to=/channels` URL.
 *
 * Reused by the dedicated Kanäle page and the per-apartment dialog.
 */
export function ChannelMappingFrame({
  propertyId,
  propertyName,
  heightClass = 'h-[calc(100dvh-280px)] min-h-[460px]',
}: {
  propertyId: string;
  propertyName?: string | null;
  /** Tailwind height utility for the iframe (lets the modal use a shorter box). */
  heightClass?: string;
}) {
  const sessionQ = trpc.channels.iframeSession.useQuery(
    { propertyId },
    { refetchOnWindowFocus: false, staleTime: 10 * 60_000, retry: false },
  );

  if (sessionQ.isLoading) {
    return <Skeleton className={cn('w-full rounded-xl', heightClass)} />;
  }

  if (sessionQ.isError) {
    return (
      <Card className="p-10 text-center max-w-[52ch] mx-auto">
        <div className="mx-auto h-12 w-12 rounded-md flex items-center justify-center mb-4 bg-negative-soft text-negative">
          <AlertTriangle className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <h3 className="display text-[20px] font-medium text-ink">
          Kanäle nicht verfügbar
        </h3>
        <p className="mt-2 text-[13px] text-muted leading-relaxed">
          {sessionQ.error.message ||
            'Die Channex-Session konnte nicht erstellt werden.'}
        </p>
      </Card>
    );
  }

  if (!sessionQ.data) return null;

  return (
    <div className="rounded-xl border border-line overflow-hidden bg-surface shadow-sm">
      <iframe
        key={sessionQ.data.url}
        src={sessionQ.data.url}
        title={`Kanäle ${propertyName ?? ''}`}
        className={cn('w-full block', heightClass)}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
