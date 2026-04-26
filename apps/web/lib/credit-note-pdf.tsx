import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { PdfLogoBlock } from "@/lib/pdf-logo-block";
import type {
  CreditNoteDetail,
  CreditNoteLine,
  CreditNoteLinkedInvoice,
  CreditNoteReason,
  Customer,
  Tenant,
} from "@/lib/api";

// Brand tokens shared with invoice-pdf / bill-pdf / delivery-note-pdf.
const CHARCOAL = "#1A1A1A";
const MINT_DARK = "#3D6B52";
const MINT_SURFACE = "#E8EDE9";
const TEXT_SECONDARY = "#5F5E5A";
const TEXT_TERTIARY = "#888780";
const BORDER = "#E5E5E3";
const SURFACE_RECESSED = "#F1EFE8";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: CHARCOAL,
    paddingTop: 48,
    paddingBottom: 64,
    paddingHorizontal: 48,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 32,
  },
  tenantBlock: { maxWidth: 260 },
  tenantName: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  tenantMeta: { color: TEXT_SECONDARY, lineHeight: 1.5 },
  docHeader: { alignItems: "flex-end" },
  docLabel: {
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: TEXT_TERTIARY,
  },
  docNumber: { fontSize: 22, fontFamily: "Helvetica-Bold", marginTop: 4 },
  statusPill: {
    marginTop: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  statusDraft: { backgroundColor: SURFACE_RECESSED, color: TEXT_SECONDARY },
  statusPosted: { backgroundColor: MINT_SURFACE, color: MINT_DARK },
  statusVoid: { backgroundColor: "#F4DADA", color: "#8C2F2F" },

  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTop: `0.5pt solid ${BORDER}`,
    borderBottom: `0.5pt solid ${BORDER}`,
    paddingVertical: 14,
    marginBottom: 24,
  },
  metaCell: { flex: 1 },
  metaLabel: {
    fontSize: 8,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: TEXT_TERTIARY,
    marginBottom: 4,
  },
  metaValue: { fontSize: 10, color: CHARCOAL },

  billTo: { marginBottom: 20 },
  billToLabel: {
    fontSize: 8,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: TEXT_TERTIARY,
    marginBottom: 6,
  },
  billToName: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  billToLine: { color: TEXT_SECONDARY, marginTop: 2 },

  // Callout for linked invoice — "Credit against invoice INV-001".
  linkedInvoice: {
    marginBottom: 20,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: SURFACE_RECESSED,
    borderRadius: 4,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  linkedInvoiceLabel: { color: TEXT_SECONDARY, fontSize: 9 },
  linkedInvoiceValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: CHARCOAL,
  },

  table: {
    borderTop: `0.5pt solid ${BORDER}`,
    marginBottom: 24,
  },
  row: {
    flexDirection: "row",
    borderBottom: `0.5pt solid ${BORDER}`,
    paddingVertical: 8,
  },
  rowHeader: { backgroundColor: SURFACE_RECESSED },
  colNum: { width: 24, textAlign: "center" },
  colDesc: { flex: 1, paddingRight: 8 },
  colQty: { width: 55, textAlign: "right" },
  colUnit: { width: 72, textAlign: "right" },
  colTax: { width: 62, textAlign: "right" },
  colTotal: { width: 80, textAlign: "right" },
  th: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: TEXT_TERTIARY,
  },
  td: { fontSize: 10 },
  tdMuted: { fontSize: 8, color: TEXT_TERTIARY, marginTop: 2 },

  totalsBlock: {
    marginLeft: "auto",
    width: 240,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  totalLabel: { color: TEXT_SECONDARY },
  totalValue: { color: CHARCOAL },
  totalDivider: {
    borderTop: `0.5pt solid ${BORDER}`,
    marginVertical: 6,
  },
  grandTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    backgroundColor: MINT_SURFACE,
    paddingHorizontal: 10,
    marginTop: 4,
    marginBottom: 4,
  },
  grandLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    color: CHARCOAL,
  },
  grandValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 14,
    color: CHARCOAL,
  },

  notes: {
    marginTop: 32,
    paddingTop: 14,
    borderTop: `0.5pt solid ${BORDER}`,
  },
  notesLabel: {
    fontSize: 8,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: TEXT_TERTIARY,
    marginBottom: 6,
  },
  notesText: { color: TEXT_SECONDARY, lineHeight: 1.5 },

  // Watermark when the CN is still a draft. Drafts exist so AR reviewers
  // can preview the issue-to-customer document before posting.
  draftBanner: {
    marginBottom: 20,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: SURFACE_RECESSED,
    color: TEXT_SECONDARY,
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    textAlign: "center",
    borderRadius: 4,
  },

  footer: {
    position: "absolute",
    bottom: 24,
    left: 48,
    right: 48,
    fontSize: 8,
    color: TEXT_TERTIARY,
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

const reasonLabels: Record<CreditNoteReason, string> = {
  return: "Return",
  price_adjustment: "Price adjustment",
  discount: "Discount",
  goodwill: "Goodwill",
  write_off: "Write-off",
  other: "Other",
};

function formatLKR(cents: number): string {
  const abs = Math.abs(cents) / 100;
  const negative = cents < 0;
  const formatted = abs.toLocaleString("en-LK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${negative ? "-" : ""}LKR ${formatted}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function CreditNotePDF({
  tenant,
  creditNote,
  lines,
  customer,
  invoice,
  logoDataUrl,
}: {
  tenant: Pick<Tenant, "businessName">;
  creditNote: CreditNoteDetail;
  lines: CreditNoteLine[];
  customer: Customer | null;
  invoice: CreditNoteLinkedInvoice | null;
  logoDataUrl?: string | null;
}) {
  const statusStyle = {
    draft: styles.statusDraft,
    posted: styles.statusPosted,
    void: styles.statusVoid,
  }[creditNote.status];

  const docNumber = creditNote.creditNoteNumber ?? "Draft";
  const unapplied = creditNote.totalCents - creditNote.appliedCents;

  return (
    <Document
      title={docNumber}
      author={tenant.businessName}
      creator="PettahPro"
      producer="PettahPro"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          <View style={styles.tenantBlock}>
            <PdfLogoBlock logoDataUrl={logoDataUrl} />
            <Text style={styles.tenantName}>{tenant.businessName}</Text>
            <Text style={styles.tenantMeta}>Sri Lanka</Text>
          </View>
          <View style={styles.docHeader}>
            <Text style={styles.docLabel}>Credit Note</Text>
            <Text style={styles.docNumber}>{docNumber}</Text>
            <Text style={[styles.statusPill, statusStyle]}>
              {creditNote.status}
            </Text>
          </View>
        </View>

        {creditNote.status === "draft" && (
          <Text style={styles.draftBanner}>
            Draft — not posted to the ledger
          </Text>
        )}

        <View style={styles.metaRow}>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Issue date</Text>
            <Text style={styles.metaValue}>{formatDate(creditNote.issueDate)}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Reason</Text>
            <Text style={styles.metaValue}>{reasonLabels[creditNote.reason]}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Currency</Text>
            <Text style={styles.metaValue}>{creditNote.currency}</Text>
          </View>
          {creditNote.postedAt && (
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>Posted</Text>
              <Text style={styles.metaValue}>
                {formatDate(creditNote.postedAt.slice(0, 10))}
              </Text>
            </View>
          )}
        </View>

        {invoice && (
          <View style={styles.linkedInvoice}>
            <Text style={styles.linkedInvoiceLabel}>Credit against invoice</Text>
            <Text style={styles.linkedInvoiceValue}>
              {invoice.invoiceNumber ?? invoice.id.slice(0, 8)}
            </Text>
          </View>
        )}

        {customer && (
          <View style={styles.billTo}>
            <Text style={styles.billToLabel}>Issued to</Text>
            <Text style={styles.billToName}>{customer.name}</Text>
            {customer.legalName && customer.legalName !== customer.name && (
              <Text style={styles.billToLine}>{customer.legalName}</Text>
            )}
            {customer.addressLine1 && (
              <Text style={styles.billToLine}>{customer.addressLine1}</Text>
            )}
            {customer.addressLine2 && (
              <Text style={styles.billToLine}>{customer.addressLine2}</Text>
            )}
            {customer.city && <Text style={styles.billToLine}>{customer.city}</Text>}
            {customer.email && <Text style={styles.billToLine}>{customer.email}</Text>}
            {customer.phone && <Text style={styles.billToLine}>{customer.phone}</Text>}
            {customer.vatNo && (
              <Text style={[styles.billToLine, { marginTop: 4, fontSize: 8 }]}>
                VAT: {customer.vatNo}
              </Text>
            )}
          </View>
        )}

        <View style={styles.table}>
          <View style={[styles.row, styles.rowHeader]}>
            <Text style={[styles.colNum, styles.th]}>#</Text>
            <Text style={[styles.colDesc, styles.th]}>Description</Text>
            <Text style={[styles.colQty, styles.th]}>Qty</Text>
            <Text style={[styles.colUnit, styles.th]}>Unit</Text>
            <Text style={[styles.colTax, styles.th]}>Tax</Text>
            <Text style={[styles.colTotal, styles.th]}>Total</Text>
          </View>
          {lines.map((l) => (
            <View key={l.id} style={styles.row} wrap={false}>
              <Text style={[styles.colNum, styles.td]}>{l.lineNo}</Text>
              <View style={styles.colDesc}>
                <Text style={styles.td}>{l.description}</Text>
                {l.discountCents > 0 && (
                  <Text style={styles.tdMuted}>
                    Discount {(l.discountPctBps / 100).toFixed(2)}% ·{" "}
                    {formatLKR(l.discountCents)}
                  </Text>
                )}
              </View>
              <Text style={[styles.colQty, styles.td]}>
                {Number(l.quantity).toLocaleString("en-LK")}
              </Text>
              <Text style={[styles.colUnit, styles.td]}>
                {formatLKR(l.unitPriceCents)}
              </Text>
              <View style={styles.colTax}>
                <Text style={styles.td}>
                  {l.taxCents > 0 ? formatLKR(l.taxCents) : "—"}
                </Text>
                {l.taxCents > 0 && (
                  <Text style={styles.tdMuted}>
                    {(l.taxRateBps / 100).toFixed(2)}%
                  </Text>
                )}
              </View>
              <Text style={[styles.colTotal, styles.td]}>
                {formatLKR(l.lineTotalCents)}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.totalsBlock}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>{formatLKR(creditNote.subtotalCents)}</Text>
          </View>
          {creditNote.discountCents > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Discount</Text>
              <Text style={styles.totalValue}>-{formatLKR(creditNote.discountCents)}</Text>
            </View>
          )}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Tax</Text>
            <Text style={styles.totalValue}>{formatLKR(creditNote.taxCents)}</Text>
          </View>
          <View style={styles.totalDivider} />
          <View style={styles.grandTotal}>
            <Text style={styles.grandLabel}>Credit total</Text>
            <Text style={styles.grandValue}>{formatLKR(creditNote.totalCents)}</Text>
          </View>
          {creditNote.status === "posted" && creditNote.appliedCents > 0 && (
            <>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Applied to invoice</Text>
                <Text style={styles.totalValue}>
                  {formatLKR(creditNote.appliedCents)}
                </Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={[styles.totalLabel, { fontFamily: "Helvetica-Bold" }]}>
                  {unapplied > 0 ? "Standing credit" : "Fully applied"}
                </Text>
                <Text style={[styles.totalValue, { fontFamily: "Helvetica-Bold" }]}>
                  {formatLKR(unapplied)}
                </Text>
              </View>
            </>
          )}
        </View>

        {creditNote.notes && (
          <View style={styles.notes} wrap={false}>
            <Text style={styles.notesLabel}>Notes</Text>
            <Text style={styles.notesText}>{creditNote.notes}</Text>
          </View>
        )}

        <View style={styles.footer} fixed>
          <Text>Generated with PettahPro — pettahpro.lk</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}
