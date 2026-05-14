import { createTRPCReact, httpBatchLink, type CreateTRPCReact } from '@trpc/react-query';
import superjson from 'superjson';
import type { AppRouter } from '@cm/api';
import { supabase } from './supabase';

// Explicit annotation avoids a TS2742 "inferred type cannot be named" error
// caused by pnpm's symlink-based node_modules layout.
export const trpc: CreateTRPCReact<AppRouter, unknown> = createTRPCReact<AppRouter>();

const apiUrl = import.meta.env.VITE_API_URL ?? '/trpc';

export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: apiUrl,
      transformer: superjson,
      async headers() {
        const { data } = await supabase.auth.getSession();
        if (data.session?.access_token) {
          return { Authorization: `Bearer ${data.session.access_token}` };
        }
        return {};
      },
    }),
  ],
});
