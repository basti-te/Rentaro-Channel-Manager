import React from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import './styles.css';
import { router } from './router';
import { AuthProvider } from './lib/auth';
import { trpc, trpcClient } from './lib/trpc';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false },
  },
});

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

createRoot(container).render(
  <React.StrictMode>
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </trpc.Provider>
  </React.StrictMode>,
);
