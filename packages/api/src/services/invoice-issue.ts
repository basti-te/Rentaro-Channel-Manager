/**
 * Issue + preview guest invoices.
 *
 * Issuing is idempotent per booking (UNIQUE booking_id): the first call assigns
 * a sequential number (transactional counter on tenant_invoice_settings.nextSeq)
 * and freezes a full snapshot of amounts + issuer config; later calls return the
 * same row. The confidence gate (invoiceBasisForBooking) suppresses bookings
 * whose lodging price can't be reliably determined, so an auto-issued invoice is
 * never wrong.
 */
import { and, eq, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import {
  bookings,
  guestInvoices,
  properties,
  tenantInvoiceSettings,
  type Database,
} from '@cm/db';
import { computeInvoiceBreakdown, invoiceBasisForBooking } from './invoices';

export interface InvoiceRecipient {
  company?: string | null;
  name: string;
  street: string;
  zip: string;
  city: string;
  country?: string | null;
  vatId?: string | null;
  email?: string | null;
}

export type IssuerSnapshot = {
  issuerName: string | null;
  issuerAddress: string | null;
  senderLine: string | null;
  logoText: string | null;
  contactPerson: string | null;
  taxId: string | null;
  taxNumber: string | null;
  vatMode: string;
  lodgingLabel: string;
  cityTaxLabel: string;
  cleaningLabel: string;
  footerContact: string | null;
  footerRegistry: string | null;
  footerBank: string | null;
  closingNote: string;
};

function nightsBetween(checkin: string, checkout: string): number {
  const a = Date.UTC(+checkin.slice(0, 4), +checkin.slice(5, 7) - 1, +checkin.slice(8, 10));
  const b = Date.UTC(+checkout.slice(0, 4), +checkout.slice(5, 7) - 1, +checkout.slice(8, 10));
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

async function loadContext(db: Database, tenantId: string, bookingId: string) {
  const settings = (
    await db
      .select()
      .from(tenantInvoiceSettings)
      .where(eq(tenantInvoiceSettings.tenantId, tenantId))
      .limit(1)
  )[0];
  const bk = (
    await db
      .select({
        source: bookings.source,
        checkin: bookings.checkin,
        checkout: bookings.checkout,
        currency: bookings.currency,
        nightlyRateCents: bookings.nightlyRateCents,
        cleaningFeeCents: bookings.cleaningFeeCents,
        rawPayload: bookings.rawPayload,
        propertyName: properties.name,
      })
      .from(bookings)
      .innerJoin(properties, eq(properties.id, bookings.propertyId))
      .where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, tenantId)))
      .limit(1)
  )[0];
  return { settings, bk };
}

export interface InvoicePreview {
  confident: boolean;
  reason?: 'no_booking' | 'block' | 'no_amount' | 'disabled';
  nights: number;
  apartmentName: string;
  currency: string;
  breakdown: ReturnType<typeof computeInvoiceBreakdown> | null;
  existing: { id: string; number: string; token: string; status: string } | null;
  enabled: boolean;
}

/** Compute what the invoice WOULD be, without issuing. Drives the operator UI. */
export async function previewInvoice(
  db: Database,
  tenantId: string,
  bookingId: string,
): Promise<InvoicePreview> {
  const { settings, bk } = await loadContext(db, tenantId, bookingId);
  const existing =
    (
      await db
        .select({
          id: guestInvoices.id,
          number: guestInvoices.number,
          token: guestInvoices.token,
          status: guestInvoices.status,
        })
        .from(guestInvoices)
        .where(and(eq(guestInvoices.bookingId, bookingId), eq(guestInvoices.status, 'issued')))
        .limit(1)
    )[0] ?? null;

  const enabled = !!settings?.enabled;
  const base = {
    nights: 0,
    apartmentName: bk?.propertyName ?? '',
    currency: bk?.currency ?? 'EUR',
    breakdown: null,
    existing,
    enabled,
  };
  if (!bk) return { confident: false, reason: 'no_booking', ...base };
  if (bk.source === 'block') return { confident: false, reason: 'block', ...base };

  const nights = nightsBetween(bk.checkin, bk.checkout);
  const basis = invoiceBasisForBooking(bk, nights);
  if (!basis.confident) {
    return { confident: false, reason: 'no_amount', ...base, nights };
  }
  const cfg = {
    vatMode: (settings?.vatMode ?? 'regular') as 'regular' | 'kleinunternehmer',
    vatRateBp: settings?.vatRateBp ?? 700,
    cityTaxRateBp: settings?.cityTaxRateBp ?? 500,
  };
  const breakdown = computeInvoiceBreakdown(
    basis.lodgingGrossCents,
    basis.cleaningGrossCents,
    cfg,
  );
  return {
    confident: true,
    nights,
    apartmentName: bk.propertyName,
    currency: bk.currency,
    breakdown,
    existing,
    enabled,
  };
}

export class InvoiceIssueError extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

/** Issue (or return the existing) invoice for a booking. */
export async function issueInvoiceForBooking(
  db: Database,
  tenantId: string,
  bookingId: string,
  recipient: InvoiceRecipient,
): Promise<typeof guestInvoices.$inferSelect> {
  const existing = (
    await db
      .select()
      .from(guestInvoices)
      .where(and(eq(guestInvoices.bookingId, bookingId), eq(guestInvoices.status, 'issued')))
      .limit(1)
  )[0];
  if (existing) return existing;

  const { settings, bk } = await loadContext(db, tenantId, bookingId);
  if (!settings || !settings.enabled) throw new InvoiceIssueError('disabled');
  if (!bk) throw new InvoiceIssueError('no_booking');
  if (bk.source === 'block') throw new InvoiceIssueError('block');

  const nights = nightsBetween(bk.checkin, bk.checkout);
  const basis = invoiceBasisForBooking(bk, nights);
  if (!basis.confident) throw new InvoiceIssueError('no_amount');

  const b = computeInvoiceBreakdown(basis.lodgingGrossCents, basis.cleaningGrossCents, {
    vatMode: settings.vatMode as 'regular' | 'kleinunternehmer',
    vatRateBp: settings.vatRateBp,
    cityTaxRateBp: settings.cityTaxRateBp,
  });

  const snapshot: IssuerSnapshot = {
    issuerName: settings.issuerName,
    issuerAddress: settings.issuerAddress,
    senderLine: settings.senderLine,
    logoText: settings.logoText,
    contactPerson: settings.contactPerson,
    taxId: settings.taxId,
    taxNumber: settings.taxNumber,
    vatMode: settings.vatMode,
    lodgingLabel: settings.lodgingLabel,
    cityTaxLabel: settings.cityTaxLabel,
    cleaningLabel: settings.cleaningLabel,
    footerContact: settings.footerContact,
    footerRegistry: settings.footerRegistry,
    footerBank: settings.footerBank,
    closingNote: settings.closingNote,
  };

  const token = randomBytes(24).toString('base64url');
  const today = new Date().toISOString().slice(0, 10);

  try {
    return await db.transaction(async (tx) => {
      const [upd] = await tx
        .update(tenantInvoiceSettings)
        .set({ nextSeq: sql`${tenantInvoiceSettings.nextSeq} + 1`, updatedAt: new Date() })
        .where(eq(tenantInvoiceSettings.tenantId, tenantId))
        .returning({ nextSeq: tenantInvoiceSettings.nextSeq });
      const assigned = Number(upd!.nextSeq) - 1;
      const number = `${settings.numberPrefix}${assigned}`;

      const [ins] = await tx
        .insert(guestInvoices)
        .values({
          tenantId,
          bookingId,
          number,
          token,
          status: 'issued',
          issueDate: today,
          serviceDate: bk.checkout,
          stayFrom: bk.checkin,
          stayTo: bk.checkout,
          nights,
          currency: bk.currency,
          apartmentName: bk.propertyName,
          lodgingGrossCents: BigInt(b.lodgingGrossCents),
          lodgingNetCents: BigInt(b.lodgingNetCents),
          lodgingVatCents: BigInt(b.lodgingVatCents),
          cleaningGrossCents: BigInt(b.cleaningGrossCents),
          cleaningNetCents: BigInt(b.cleaningNetCents),
          cleaningVatCents: BigInt(b.cleaningVatCents),
          cityTaxCents: BigInt(b.cityTaxCents),
          totalNetCents: BigInt(b.totalNetCents),
          totalVatCents: BigInt(b.totalVatCents),
          totalGrossCents: BigInt(b.totalGrossCents),
          vatRateBp: b.vatRateBp,
          cityTaxRateBp: b.cityTaxRateBp,
          recipientCompany: recipient.company ?? null,
          recipientName: recipient.name,
          recipientStreet: recipient.street,
          recipientZip: recipient.zip,
          recipientCity: recipient.city,
          recipientCountry: recipient.country ?? 'Deutschland',
          recipientVatId: recipient.vatId ?? null,
          recipientEmail: recipient.email ?? null,
          issuerSnapshot: snapshot,
        })
        .returning();
      return ins!;
    });
  } catch (err) {
    // Lost an insert race on the UNIQUE booking_id — return the winner.
    const raced = (
      await db
        .select()
        .from(guestInvoices)
        .where(and(eq(guestInvoices.bookingId, bookingId), eq(guestInvoices.status, 'issued')))
        .limit(1)
    )[0];
    if (raced) return raced;
    throw err;
  }
}
