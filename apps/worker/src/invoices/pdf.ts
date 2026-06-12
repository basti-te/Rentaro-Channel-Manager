/**
 * Render a guest invoice to a PDF buffer with pdfkit, mirroring the operator's
 * existing CITY APARTMENTS ESSEN layout: top-right wordmark, sender line +
 * recipient block, meta block, a 3-line item table (Übernachtung /
 * Übernachtungssteuer / Endreinigung), net / VAT 7% / VAT 0% / gross totals,
 * and the legal footer. All amounts come frozen from the guest_invoices row.
 */
import PDFDocument from 'pdfkit';
import { formatInvoiceMoney, formatInvoiceDate } from '@cm/api';
import { guestInvoices } from '@cm/db';
import type { IssuerSnapshot } from '@cm/api';

type InvoiceRow = typeof guestInvoices.$inferSelect;

const PAGE_W = 595.28;
const M = 50; // margin
const RIGHT = PAGE_W - M; // 545.28

const INK = '#1a1a1a';
const MUTED = '#6b6b6b';
const LINE = '#d9d9d9';
const ZEBRA = '#f4f3f1';

export function renderInvoicePdf(
  inv: InvoiceRow,
  logoImageData?: string | null,
): Promise<Buffer> {
  const iss = (inv.issuerSnapshot ?? {}) as IssuerSnapshot;
  const cur = inv.currency;
  const money = (c: bigint | number) => formatInvoiceMoney(Number(c), cur);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: M });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Logo image (top-right) with wordmark fallback ──────────────────────
    let drewLogo = false;
    if (logoImageData) {
      try {
        const base64 = logoImageData.includes(',')
          ? logoImageData.slice(logoImageData.indexOf(',') + 1)
          : logoImageData;
        doc.image(Buffer.from(base64, 'base64'), RIGHT - 180, 40, { fit: [180, 64] });
        drewLogo = true;
      } catch {
        drewLogo = false;
      }
    }
    if (!drewLogo) {
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(20);
      doc.text((iss.logoText ?? iss.issuerName ?? '').toUpperCase(), M, 55, {
        width: RIGHT - M,
        align: 'right',
      });
    }

    // ── Sender line + recipient ────────────────────────────────────────────
    let y = 175;
    if (iss.senderLine) {
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED);
      doc.text(iss.senderLine, M, y, { width: 300 });
    }
    y = 205;
    doc.font('Helvetica').fontSize(10.5).fillColor(INK);
    const recipientLines = [
      inv.recipientCompany,
      inv.recipientName,
      inv.recipientStreet,
      `${inv.recipientZip} ${inv.recipientCity}`,
      inv.recipientCountry,
    ].filter((l): l is string => !!l && l.trim().length > 0);
    doc.text(recipientLines.join('\n'), M, y, { width: 280, lineGap: 1.5 });

    // ── Meta block (right) ─────────────────────────────────────────────────
    const metaX = 330;
    const metaW = RIGHT - metaX;
    let my = 200;
    doc.font('Helvetica-Bold').fontSize(13).fillColor(INK);
    doc.text('Rechnungs-Nr.', metaX, my, { width: metaW * 0.55, continued: false });
    doc.text(inv.number, metaX + metaW * 0.45, my, { width: metaW * 0.55, align: 'right' });
    my += 26;
    const metaRow = (label: string, value: string) => {
      doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
      doc.text(label, metaX, my, { width: metaW * 0.5 });
      doc.fillColor(INK);
      doc.text(value, metaX + metaW * 0.4, my, { width: metaW * 0.6, align: 'right' });
      my += 14;
    };
    metaRow('Rechnungsdatum', formatInvoiceDate(inv.issueDate));
    metaRow('Lieferdatum', formatInvoiceDate(inv.serviceDate));
    if (iss.contactPerson) {
      my += 6;
      metaRow('Ihr Ansprechpartner', iss.contactPerson);
    }

    // ── Title ──────────────────────────────────────────────────────────────
    y = 330;
    doc.font('Helvetica-Bold').fontSize(15).fillColor(INK);
    doc.text(`Rechnung Nr. ${inv.number}`, M, y);

    // ── Intro ──────────────────────────────────────────────────────────────
    y = 375;
    doc.font('Helvetica').fontSize(10).fillColor(INK);
    doc.text('Sehr geehrte Damen und Herren,', M, y);
    y += 22;
    doc.text('vielen Dank für Ihren Aufenthalt.', M, y);
    y += 15;
    doc.text('Hiermit erhalten Sie die Rechnung, zu Ihren bereits bezahlten Leistungen:', M, y);
    y += 32;

    // ── Items table ────────────────────────────────────────────────────────
    const col = {
      pos: M,
      desc: 82,
      menge: 300,
      einzel: 380,
      gesamt: 465,
      mengeW: 70,
      einzelW: 75,
      gesamtW: RIGHT - 465,
    };
    // Header
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK);
    doc.text('Pos.', col.pos, y);
    doc.text('Beschreibung', col.desc, y);
    doc.text('Menge', col.menge, y, { width: col.mengeW, align: 'right' });
    doc.text('Einzelpreis', col.einzel, y, { width: col.einzelW, align: 'right' });
    doc.text('Gesamtpreis', col.gesamt, y, { width: col.gesamtW, align: 'right' });
    y += 16;
    doc.moveTo(M, y).lineTo(RIGHT, y).strokeColor(LINE).lineWidth(0.7).stroke();
    y += 10;

    const vatPct = (inv.vatRateBp / 100).toString().replace('.', ',');
    const cityPct = (inv.cityTaxRateBp / 100).toString().replace('.', ',');
    const nights = inv.nights;
    const perNight = Math.round(Number(inv.lodgingGrossCents) / Math.max(1, nights));

    type Item = { pos: string; title: string; sub?: string; menge: string; einzel: string; gesamt: string };
    const items: Item[] = [
      {
        pos: '1.',
        title: `${iss.lodgingLabel ?? 'Übernachtung'} ${inv.apartmentName}`.trim(),
        sub: `${formatInvoiceDate(inv.stayFrom)} - ${formatInvoiceDate(inv.stayTo)}`,
        menge: `${nights.toLocaleString('de-DE', { minimumFractionDigits: 2 })} Tag(e)`,
        einzel: money(perNight),
        gesamt: money(inv.lodgingGrossCents),
      },
      {
        pos: '2.',
        title: `${iss.cityTaxLabel ?? 'Übernachtungssteuer'} (${cityPct}%)`,
        menge: 'pauschal',
        einzel: money(inv.cityTaxCents),
        gesamt: money(inv.cityTaxCents),
      },
    ];
    if (Number(inv.cleaningGrossCents) > 0) {
      items.push({
        pos: '3.',
        title: iss.cleaningLabel ?? 'Endreinigung',
        menge: 'pauschal',
        einzel: money(inv.cleaningGrossCents),
        gesamt: money(inv.cleaningGrossCents),
      });
    }

    for (const it of items) {
      const rowH = it.sub ? 30 : 20;
      doc.font('Helvetica-Bold').fontSize(10).fillColor(INK);
      doc.text(it.pos, col.pos, y);
      doc.text(it.title, col.desc, y, { width: col.menge - col.desc - 8 });
      doc.font('Helvetica').fontSize(10).fillColor(INK);
      doc.text(it.menge, col.menge, y, { width: col.mengeW, align: 'right' });
      doc.text(it.einzel, col.einzel, y, { width: col.einzelW, align: 'right' });
      doc.text(it.gesamt, col.gesamt, y, { width: col.gesamtW, align: 'right' });
      if (it.sub) {
        doc.font('Helvetica').fontSize(9).fillColor(MUTED);
        doc.text(it.sub, col.desc, y + 14, { width: col.menge - col.desc - 8 });
      }
      y += rowH;
    }

    // ── Totals ─────────────────────────────────────────────────────────────
    y += 6;
    const totalLabelX = 300;
    const totalValX = col.gesamt;
    const totalValW = col.gesamtW;
    const totalRow = (label: string, value: string, bold = false, shade = false) => {
      if (shade) {
        doc.rect(totalLabelX - 6, y - 4, RIGHT - totalLabelX + 6, 19).fill(ZEBRA);
      }
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 10).fillColor(INK);
      doc.text(label, totalLabelX, y, { width: 150 });
      doc.text(value, totalValX - 60, y, { width: totalValW + 60, align: 'right' });
      y += 19;
    };
    totalRow('Gesamtbetrag netto', money(inv.totalNetCents), false, true);
    totalRow(`Umsatzsteuer ${vatPct}%`, money(inv.totalVatCents));
    totalRow('Umsatzsteuer 0%', money(0));
    totalRow('Gesamtbetrag brutto', money(inv.totalGrossCents), true, true);

    // Kleinunternehmer note
    if (iss.vatMode === 'kleinunternehmer') {
      y += 12;
      doc.font('Helvetica').fontSize(9).fillColor(MUTED);
      doc.text('Gemäß §19 UStG wird keine Umsatzsteuer berechnet.', M, y, { width: RIGHT - M });
    }

    // ── Closing ────────────────────────────────────────────────────────────
    y += 30;
    doc.font('Helvetica').fontSize(10).fillColor(INK);
    if (iss.closingNote) {
      doc.text(iss.closingNote, M, y, { width: RIGHT - M, lineGap: 1.5 });
      y += iss.closingNote.split('\n').length * 14;
    }
    y += 16;
    doc.text('Mit freundlichen Grüßen', M, y);
    if (iss.contactPerson) {
      y += 14;
      doc.text(iss.contactPerson, M, y);
    }

    // ── Footer (4 columns) — fixed near the bottom, kept above the page
    // margin so pdfkit never auto-paginates a column onto a 2nd page.
    const footY = 730;
    doc.moveTo(M, footY - 12).lineTo(RIGHT, footY - 12).strokeColor(LINE).lineWidth(0.5).stroke();
    // Page number
    doc.font('Helvetica').fontSize(8).fillColor(MUTED);
    doc.text('1/1', RIGHT - 40, footY - 28, { width: 40, align: 'right' });
    doc.font('Helvetica').fontSize(7).fillColor(MUTED);
    const colW = (RIGHT - M) / 4;
    const footCols = [
      [iss.issuerName, iss.issuerAddress].filter(Boolean).join('\n'),
      iss.footerContact ?? '',
      iss.footerRegistry ?? '',
      iss.footerBank ?? '',
    ];
    footCols.forEach((text, i) => {
      doc.text(text, M + i * colW, footY, { width: colW - 6, lineGap: 0.5, lineBreak: true });
    });

    doc.end();
  });
}
