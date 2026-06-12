/**
 * Public PDF download for guest invoices.
 *
 *   GET /api/invoices/<token>.pdf
 *
 * The opaque `token` (stored on the guest_invoices row) is the capability —
 * holding the link is enough to download. Voided invoices 404. Deterministic:
 * the same row always renders the same bytes.
 */
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb, guestInvoices, tenantInvoiceSettings } from '@cm/db';
import { env } from '../env';
import { renderInvoicePdf } from './pdf';

export const invoicesRoute = new Hono();

invoicesRoute.get('/:file', async (c) => {
  const file = c.req.param('file');
  const token = file.endsWith('.pdf') ? file.slice(0, -4) : file;
  if (!token || token.length < 16) {
    return c.json({ error: 'not_found' }, 404);
  }

  const db = createDb(env.DATABASE_URL);
  const inv = (
    await db.select().from(guestInvoices).where(eq(guestInvoices.token, token)).limit(1)
  )[0];
  if (!inv || inv.status === 'void') {
    return c.json({ error: 'not_found' }, 404);
  }

  const [settings] = await db
    .select({ logo: tenantInvoiceSettings.logoImageData })
    .from(tenantInvoiceSettings)
    .where(eq(tenantInvoiceSettings.tenantId, inv.tenantId))
    .limit(1);
  const pdf = await renderInvoicePdf(inv, settings?.logo ?? null);
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${inv.number}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
});
