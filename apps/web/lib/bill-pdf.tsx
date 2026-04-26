import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { BillCharge, BillDetail, BillLine, Supplier, Tenant } from "@/lib/api";
import { PdfLogoBlock } from "@/lib/pdf-logo-block";

// Brand tokens (shared with invoice-pdf / delivery-note-pdf / etc).
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
  statusPending: { backgroundColor: "#FAF0D9", color: "#B47A15" },
  statusPosted: { backgroundColor: MINT_SURFACE, color: MINT_DARK },
  statusPaid: { backgroundColor: "#7FB89A", color: MINT_DARK },
  statusPartial: { backgroundColor: "#FAF0D9", color: "#B47A15" },
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

  billFrom: { marginBottom: 20 },
  billFromLabel: {
    fontSize: 8,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: TEXT_TERTIARY,
    marginBottom: 6,
  },
  billFromName: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  billFromLine: { color: TEXT_SECONDARY, marginTop: 2 },

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

  // Watermark banner shown when the bill isn't yet posted. Internal-use PDFs
  // for drafts are useful (share with AP approver before posting), but we
  // want it obvious this isn't the posted record.
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

export function BillPDF({
  tenant,
  bill,
  lines,
  charges,
  supplier,
  logoDataUrl,
}: {
  tenant: Pick<Tenant, "businessName">;
  bill: BillDetail;
  lines: BillLine[];
  charges: BillCharge[];
  supplier: Supplier | null;
  logoDataUrl?: string | null;
}) {
  const statusStyle = {
    draft: styles.statusDraft,
    pending_approval: styles.statusPending,
    posted: styles.statusPosted,
    partially_paid: styles.statusPartial,
    paid: styles.statusPaid,
    void: styles.statusVoid,
    written_off: styles.statusVoid,
  }[bill.status];

  const docNumber = bill.internalReference ?? "Draft";

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
            <Text style={styles.docLabel}>Bill</Text>
            <Text style={styles.docNumber}>{docNumber}</Text>
            <Text style={[styles.statusPill, statusStyle]}>
              {bill.status.replace("_", " ")}
            </Text>
          </View>
        </View>

        {bill.status === "draft" && (
          <Text style={styles.draftBanner}>
            Draft — not posted to the ledger
          </Text>
        )}

        <View style={styles.metaRow}>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Bill date</Text>
            <Text style={styles.metaValue}>{formatDate(bill.billDate)}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Due date</Text>
            <Text style={styles.metaValue}>{formatDate(bill.dueDate)}</Text>
          </View>
          {bill.supplierBillNumber && (
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>Supplier ref</Text>
              <Text style={styles.metaValue}>{bill.supplierBillNumber}</Text>
            </View>
          )}
          {bill.postedAt && (
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>Posted</Text>
              <Text style={styles.metaValue}>
                {formatDate(bill.postedAt.slice(0, 10))}
              </Text>
            </View>
          )}
        </View>

        {supplier && (
          <View style={styles.billFrom}>
            <Text style={styles.billFromLabel}>Billed from</Text>
            <Text style={styles.billFromName}>{supplier.name}</Text>
            {supplier.legalName && supplier.legalName !== supplier.name && (
              <Text style={styles.billFromLine}>{supplier.legalName}</Text>
            )}
            {supplier.addressLine1 && (
              <Text style={styles.billFromLine}>{supplier.addressLine1}</Text>
            )}
            {supplier.addressLine2 && (
              <Text style={styles.billFromLine}>{supplier.addressLine2}</Text>
            )}
            {supplier.city && <Text style={styles.billFromLine}>{supplier.city}</Text>}
            {supplier.email && <Text style={styles.billFromLine}>{supplier.email}</Text>}
            {supplier.phone && <Text style={styles.billFromLine}>{supplier.phone}</Text>}
            {supplier.vatNo && (
              <Text style={[styles.billFromLine, { marginTop: 4, fontSize: 8 }]}>
                VAT: {supplier.vatNo}
              </Text>
            )}
            {supplier.brNo && (
              <Text style={[styles.billFromLine, { fontSize: 8 }]}>
                BR: {supplier.brNo}
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

        {charges.length > 0 && (
          <View style={styles.table} wrap={false}>
            <View style={[styles.row, styles.rowHeader]}>
              <Text style={[styles.colNum, styles.th]}>#</Text>
              <Text style={[styles.colDesc, styles.th]}>
                Additional charges — allocated by{" "}
                {bill.chargeAllocationMethod === "quantity" ? "quantity" : "value"}
              </Text>
              <Text style={[styles.colTotal, styles.th]}>Amount</Text>
            </View>
            {charges.map((c) => (
              <View key={c.id} style={styles.row} wrap={false}>
                <Text style={[styles.colNum, styles.td]}>{c.lineNo}</Text>
                <View style={styles.colDesc}>
                  <Text style={[styles.td, { textTransform: "capitalize" }]}>{c.kind}</Text>
                  {c.description && (
                    <Text style={styles.tdMuted}>{c.description}</Text>
                  )}
                </View>
                <Text style={[styles.colTotal, styles.td]}>{formatLKR(c.amountCents)}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.totalsBlock}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>{formatLKR(bill.subtotalCents)}</Text>
          </View>
          {bill.discountCents > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Discount</Text>
              <Text style={styles.totalValue}>-{formatLKR(bill.discountCents)}</Text>
            </View>
          )}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Input tax</Text>
            <Text style={styles.totalValue}>{formatLKR(bill.taxCents)}</Text>
          </View>
          {bill.chargesTotalCents > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Charges (landed cost)</Text>
              <Text style={styles.totalValue}>{formatLKR(bill.chargesTotalCents)}</Text>
            </View>
          )}
          <View style={styles.totalDivider} />
          <View style={styles.grandTotal}>
            <Text style={styles.grandLabel}>Bill total</Text>
            <Text style={styles.grandValue}>{formatLKR(bill.totalCents)}</Text>
          </View>
          {bill.amountPaidCents > 0 && (
            <>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Paid to date</Text>
                <Text style={styles.totalValue}>{formatLKR(bill.amountPaidCents)}</Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={[styles.totalLabel, { fontFamily: "Helvetica-Bold" }]}>
                  Balance due
                </Text>
                <Text style={[styles.totalValue, { fontFamily: "Helvetica-Bold" }]}>
                  {formatLKR(bill.balanceDueCents)}
                </Text>
              </View>
            </>
          )}
        </View>

        {bill.notes && (
          <View style={styles.notes} wrap={false}>
            <Text style={styles.notesLabel}>Notes</Text>
            <Text style={styles.notesText}>{bill.notes}</Text>
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
