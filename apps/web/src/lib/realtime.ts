import { useEffect } from 'react';
import { supabase } from './supabase';
import { trpc } from './trpc';

/**
 * Subscribes to live changes on `public.sync_jobs` for the user's tenant and
 * invalidates the trpc `sync.statusByProperty` query whenever a row changes.
 *
 * Supabase Realtime delivers each row through the user's RLS, so the worker
 * (running with service role) inserting a row will fan out to the active
 * tenant's session only.
 *
 * Returns nothing — call it once at a stable place (e.g. CalendarPage).
 */
export function useSyncJobsRealtime(tenantId: string | null | undefined) {
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!tenantId) return;
    const channel = supabase
      .channel(`sync-jobs:${tenantId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sync_jobs',
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => {
          void utils.sync.statusByProperty.invalidate();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tenantId, utils]);
}

/**
 * Subscribes to live changes on `public.bookings` for the user's tenant and
 * invalidates the calendar's booking query whenever a row changes. This is how
 * an inbound OTA booking (Channex webhook → ingest-bookings → DB upsert) shows
 * up in the calendar automatically, without a manual reload.
 *
 * `bookings` is in the Supabase Realtime publication (post-migrate 02_realtime).
 * RLS still applies per row, so only the owning tenant's session is notified.
 * We invalidate (rather than patch the cache) so the refetch re-applies the
 * exact server-side range/status filtering.
 */
export function useBookingsRealtime(tenantId: string | null | undefined) {
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!tenantId) return;
    const channel = supabase
      .channel(`bookings:${tenantId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bookings',
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => {
          void utils.bookings.listByRange.invalidate();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tenantId, utils]);
}
