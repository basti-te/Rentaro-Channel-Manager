import { useEffect, useMemo, useState } from 'react';
import { Plug } from 'lucide-react';

import { PageHeader } from './_dashboard';
import { Card } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { ChannelMappingFrame } from '../components/ChannelMappingFrame';
import { trpc } from '../lib/trpc';

/**
 * Self-service channel mapping. Each tenant connects their own real
 * Airbnb / Booking.com / Vrbo / … listings to a connected apartment via the
 * embedded Channex /channels screen — no per-tenant operator work.
 *
 * Lives in the Apartments area (linked from the Apartments page). Designed to
 * grow: future channel-level info/functions will hang off this page.
 */
export function ChannelsPage() {
  const propsQ = trpc.properties.list.useQuery();
  const connected = useMemo(
    () => (propsQ.data ?? []).filter((p) => !!p.channexPropertyRef),
    [propsQ.data],
  );
  const [propertyId, setPropertyId] = useState<string | null>(null);

  useEffect(() => {
    if (!propertyId && connected.length > 0) setPropertyId(connected[0]!.id);
  }, [connected, propertyId]);

  const selectedName = connected.find((p) => p.id === propertyId)?.name ?? null;

  return (
    <>
      <PageHeader
        title="Kanäle"
        subtitle="Verbinde deine echten Airbnb-, Booking.com- und Vrbo-Listings mit deinen Apartments — direkt hier, ohne Umweg."
      />

      <div className="px-4 sm:px-6 md:px-8 py-6">
        {propsQ.isLoading ? (
          <Skeleton className="h-[70vh] w-full rounded-xl" />
        ) : connected.length === 0 ? (
          <Card className="p-10 text-center max-w-[52ch] mx-auto">
            <div className="mx-auto h-12 w-12 rounded-md flex items-center justify-center mb-4 bg-brand-soft text-brand">
              <Plug className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <h3 className="display text-[20px] font-medium text-ink">
              Kein verbundenes Apartment
            </h3>
            <p className="mt-2 text-[13px] text-muted leading-relaxed">
              Verbinde zuerst ein Apartment mit Channex (Seite „Apartments“ →
              „Verbinden“). Danach kannst du hier die OTA-Kanäle zuordnen.
            </p>
          </Card>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-3 flex-wrap">
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
              <p className="text-[12px] text-muted">
                Airbnb &amp; Booking.com sind oben angepinnt; alle weiteren OTAs
                findest du in der Channex-Liste darunter.
              </p>
            </div>

            {propertyId && (
              <ChannelMappingFrame
                propertyId={propertyId}
                propertyName={selectedName}
              />
            )}
          </>
        )}
      </div>
    </>
  );
}
