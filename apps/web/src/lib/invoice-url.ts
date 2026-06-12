/**
 * Build the public PDF download URL for an invoice token. VITE_API_URL points at
 * the tRPC endpoint (".../trpc"); the PDF route lives at the API origin under
 * /api/invoices, so we strip a trailing /trpc.
 */
export function invoicePdfUrl(token: string): string {
  const base = (import.meta.env.VITE_API_URL ?? '').replace(/\/trpc\/?$/, '');
  return `${base}/api/invoices/${token}.pdf`;
}
