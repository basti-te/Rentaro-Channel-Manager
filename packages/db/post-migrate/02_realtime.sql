-- ============================================================================
-- Supabase Realtime publication
-- ============================================================================
-- Tables added here stream INSERT/UPDATE/DELETE events to subscribed clients
-- via Supabase's `postgres_changes` channel. RLS policies still apply to
-- each delivered row — only subscribers who can SELECT the row receive it.
--
-- Idempotent: if a table is already in the publication, the block is a no-op.
-- ============================================================================

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'sync_jobs',
    'bookings',  -- prep for future inbound webhook → calendar live-updates
    'cleaning_messages'  -- live cleaning-reminder status on the Reinigung page
  ])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      RAISE NOTICE '+ Added public.% to supabase_realtime', t;
    END IF;
  END LOOP;
END $$;
