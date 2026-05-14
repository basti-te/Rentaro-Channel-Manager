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
