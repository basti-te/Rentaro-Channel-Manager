import type { ReactNode } from 'react';
import { Toaster } from 'sonner';

export function RootLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: 'rgb(var(--surface))',
            color: 'rgb(var(--ink))',
            border: '1px solid rgb(var(--line))',
            borderRadius: 'var(--r-md)',
            fontFamily: 'Manrope, system-ui, sans-serif',
            fontSize: '13px',
            boxShadow: 'var(--shadow-lg)',
          },
        }}
      />
    </>
  );
}
