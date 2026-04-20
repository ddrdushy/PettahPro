import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type {
  Customer,
  InvoiceDetail,
  InvoiceLine,
  Tenant,
} from "@/lib/api";

// Brand tokens from brand-kit.md §5
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
  invoiceHeader: { alignItems: "flex-end" },
  invoiceLabel: {
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: TEXT_TERTIARY,
  },
  invoiceNumber: { fontSize: 22, fontFamily: "Helvetica-Bold", marginTop: 4 },
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
  statusPaid: { backgroundColor: "#7FB89A", color: MINT_DARK },
  statusPartial: { backgroundColor: "#FAF0D9", color: "#B47A15" },

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

  table: {
    borderTop: `0.5pt solid ${BORDER}`,
    marginBottom: 24,
  },
  row: {
    flexDirection: "row",
    borderBottom: `0.5pt solid ${BORDER}`,
    paddingVertical: 8,
  },
  rowHeader: {
    backgroundColor: SURFACE_RECESSED,
  },
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

export function InvoicePDF({
  tenant,
  invoice,
  lines,
  customer,
}: {
  tenant: Pick<Tenant, "businessName">;
  invoice: InvoiceDetail;
  lines: InvoiceLine[];
  customer: Customer | null;
}) {
  const statusStyle = {
    draft: styles.statusDraft,
    posted: styles.statusPosted,
    partially_paid: styles.statusPartial,
    paid: styles.statusPaid,
    void: styles.statusDraft,
  }[invoice.status];

  return (
    <Document
      title={invoice.invoiceNumber ?? "Invoice"}
      author={tenant.businessName}
      creator="PettahPro"
      producer="PettahPro"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          <View style={styles.tenantBlock}>
            <Text style={styles.tenantName}>{tenant.businessName}</Text>
            <Text style={styles.tenantMeta}>Sri Lanka</Text>
          </View>
          <View style={styles.invoiceHeader}>
            <Text style={styles.invoiceLabel}>Tax Invoice</Text>
            <Text style={styles.invoiceNumber}>
              {invoice.invoiceNumber ?? "Draft"}
            </Text>
            <Text style={[styles.statusPill, statusStyle]}>
              {invoice.status.replace("_", " ")}
            </Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Issue date</Text>
            <Text style={styles.metaValue}>{formatDate(invoice.issueDate)}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Due date</Text>
            <Text style={styles.metaValue}>{formatDate(invoice.dueDate)}</Text>
          </View>
          {invoice.reference && (
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>Reference</Text>
              <Text style={styles.metaValue}>{invoice.reference}</Text>
            </View>
          )}
          {invoice.poNumber && (
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>Customer PO</Text>
              <Text style={styles.metaValue}>{invoice.poNumber}</Text>
            </View>
          )}
        </View>

        {customer && (
          <View style={styles.billTo}>
            <Text style={styles.billToLabel}>Bill to</Text>
            <Text style={styles.billToName}>{customer.name}</Text>
            {customer.addressLine1 && (
              <Text style={styles.billToLine}>{customer.addressLine1}</Text>
            )}
            {customer.city && <Text style={styles.billToLine}>{customer.city}</Text>}
            {customer.email && <Text style={styles.billToLine}>{customer.email}</Text>}
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
                    Discount {(l.discountPctBps / 100).toFixed(2)}% · {formatLKR(l.discountCents)}
                  </Text>
                )}
              </View>
              <Text style={[styles.colQty, styles.td]}>
                {Number(l.quantity).toLocaleString("en-LK")}
              </Text>
              <Text style={[styles.colUnit, styles.td]}>{formatLKR(l.unitPriceCents)}</Text>
              <View style={styles.colTax}>
                <Text style={styles.td}>
                  {l.taxCents > 0 ? formatLKR(l.taxCents) : "—"}
                </Text>
                {l.taxCents > 0 && (
                  <Text style={styles.tdMuted}>{(l.taxRateBps / 100).toFixed(2)}%</Text>
                )}
              </View>
              <Text style={[styles.colTotal, styles.td]}>{formatLKR(l.lineTotalCents)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalsBlock}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>{formatLKR(invoice.subtotalCents)}</Text>
          </View>
          {invoice.discountCents > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Discount</Text>
              <Text style={styles.totalValue}>-{formatLKR(invoice.discountCents)}</Text>
            </View>
          )}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Tax</Text>
            <Text style={styles.totalValue}>{formatLKR(invoice.taxCents)}</Text>
          </View>
          <View style={styles.totalDivider} />
          <View style={styles.grandTotal}>
            <Text style={styles.grandLabel}>Total due</Text>
            <Text style={styles.grandValue}>{formatLKR(invoice.totalCents)}</Text>
          </View>
          {invoice.amountPaidCents > 0 && (
            <>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Paid to date</Text>
                <Text style={styles.totalValue}>{formatLKR(invoice.amountPaidCents)}</Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={[styles.totalLabel, { fontFamily: "Helvetica-Bold" }]}>Balance</Text>
                <Text style={[styles.totalValue, { fontFamily: "Helvetica-Bold" }]}>
                  {formatLKR(invoice.balanceDueCents)}
                </Text>
              </View>
            </>
          )}
        </View>

        {(invoice.notes || invoice.terms) && (
          <View style={styles.notes} wrap={false}>
            {invoice.notes && (
              <>
                <Text style={styles.notesLabel}>Notes</Text>
                <Text style={styles.notesText}>{invoice.notes}</Text>
              </>
            )}
            {invoice.terms && (
              <>
                <Text style={[styles.notesLabel, { marginTop: 14 }]}>Terms</Text>
                <Text style={styles.notesText}>{invoice.terms}</Text>
              </>
            )}
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
