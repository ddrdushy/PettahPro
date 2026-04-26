import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { PdfLogoBlock } from "@/lib/pdf-logo-block";
import type {
  PurchaseOrderDetail,
  PurchaseOrderLine,
  Supplier,
  Tenant,
} from "@/lib/api";

// Brand tokens from brand-kit.md §5 (shared with invoice/quotation PDF).
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
  statusSent: { backgroundColor: MINT_SURFACE, color: MINT_DARK },
  statusAcknowledged: { backgroundColor: "#7FB89A", color: MINT_DARK },
  statusConverted: { backgroundColor: "#FAF0D9", color: "#B47A15" },
  statusCancelled: { backgroundColor: "#F4DADA", color: "#8C2F2F" },

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

  supplierBlock: { marginBottom: 20 },
  supplierLabel: {
    fontSize: 8,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: TEXT_TERTIARY,
    marginBottom: 6,
  },
  supplierName: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  supplierLine: { color: TEXT_SECONDARY, marginTop: 2 },

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

  totalsBlock: { marginLeft: "auto", width: 240 },
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
  grandLabel: { fontFamily: "Helvetica-Bold", fontSize: 11, color: CHARCOAL },
  grandValue: { fontFamily: "Helvetica-Bold", fontSize: 14, color: CHARCOAL },

  instructions: {
    marginTop: 12,
    padding: 10,
    backgroundColor: SURFACE_RECESSED,
    borderRadius: 4,
  },
  instructionsLabel: {
    fontSize: 8,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: TEXT_TERTIARY,
    marginBottom: 4,
  },
  instructionsText: { color: CHARCOAL, fontSize: 10 },

  notes: {
    marginTop: 24,
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

function formatMoney(cents: number, currency = "LKR"): string {
  const abs = Math.abs(cents) / 100;
  const negative = cents < 0;
  const formatted = abs.toLocaleString("en-LK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${negative ? "-" : ""}${currency} ${formatted}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function PurchaseOrderPDF({
  tenant,
  purchaseOrder,
  lines,
  supplier,
  logoDataUrl,
}: {
  tenant: Pick<Tenant, "businessName">;
  purchaseOrder: PurchaseOrderDetail;
  lines: PurchaseOrderLine[];
  supplier: Supplier | null;
  logoDataUrl?: string | null;
}) {
  const statusStyle = {
    draft: styles.statusDraft,
    pending_approval: styles.statusPending,
    sent: styles.statusSent,
    acknowledged: styles.statusAcknowledged,
    converted: styles.statusConverted,
    cancelled: styles.statusCancelled,
  }[purchaseOrder.status];

  return (
    <Document
      title={purchaseOrder.poNumber ?? "Purchase order"}
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
            <Text style={styles.docLabel}>Purchase order</Text>
            <Text style={styles.docNumber}>{purchaseOrder.poNumber ?? "Draft"}</Text>
            <Text style={[styles.statusPill, statusStyle]}>{purchaseOrder.status}</Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Order date</Text>
            <Text style={styles.metaValue}>{formatDate(purchaseOrder.orderDate)}</Text>
          </View>
          {purchaseOrder.expectedDeliveryDate && (
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>Expected delivery</Text>
              <Text style={styles.metaValue}>{formatDate(purchaseOrder.expectedDeliveryDate)}</Text>
            </View>
          )}
          {purchaseOrder.reference && (
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>Reference</Text>
              <Text style={styles.metaValue}>{purchaseOrder.reference}</Text>
            </View>
          )}
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Currency</Text>
            <Text style={styles.metaValue}>{purchaseOrder.currency}</Text>
          </View>
        </View>

        {supplier && (
          <View style={styles.supplierBlock}>
            <Text style={styles.supplierLabel}>Supplier</Text>
            <Text style={styles.supplierName}>{supplier.name}</Text>
            {supplier.addressLine1 && <Text style={styles.supplierLine}>{supplier.addressLine1}</Text>}
            {supplier.addressLine2 && <Text style={styles.supplierLine}>{supplier.addressLine2}</Text>}
            {supplier.city && <Text style={styles.supplierLine}>{supplier.city}</Text>}
            {supplier.email && <Text style={styles.supplierLine}>{supplier.email}</Text>}
            {supplier.vatNo && (
              <Text style={[styles.supplierLine, { marginTop: 4, fontSize: 8 }]}>
                VAT: {supplier.vatNo}
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
                    Discount {(l.discountPctBps / 100).toFixed(2)}% · {formatMoney(l.discountCents, purchaseOrder.currency)}
                  </Text>
                )}
              </View>
              <Text style={[styles.colQty, styles.td]}>
                {Number(l.quantity).toLocaleString("en-LK")}
              </Text>
              <Text style={[styles.colUnit, styles.td]}>
                {formatMoney(l.unitPriceCents, purchaseOrder.currency)}
              </Text>
              <View style={styles.colTax}>
                <Text style={styles.td}>
                  {l.taxCents > 0 ? formatMoney(l.taxCents, purchaseOrder.currency) : "—"}
                </Text>
                {l.taxCents > 0 && (
                  <Text style={styles.tdMuted}>{(l.taxRateBps / 100).toFixed(2)}%</Text>
                )}
              </View>
              <Text style={[styles.colTotal, styles.td]}>
                {formatMoney(l.lineTotalCents, purchaseOrder.currency)}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.totalsBlock}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>{formatMoney(purchaseOrder.subtotalCents, purchaseOrder.currency)}</Text>
          </View>
          {purchaseOrder.discountCents > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Discount</Text>
              <Text style={styles.totalValue}>-{formatMoney(purchaseOrder.discountCents, purchaseOrder.currency)}</Text>
            </View>
          )}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Tax</Text>
            <Text style={styles.totalValue}>{formatMoney(purchaseOrder.taxCents, purchaseOrder.currency)}</Text>
          </View>
          <View style={styles.totalDivider} />
          <View style={styles.grandTotal}>
            <Text style={styles.grandLabel}>Order total</Text>
            <Text style={styles.grandValue}>{formatMoney(purchaseOrder.totalCents, purchaseOrder.currency)}</Text>
          </View>
        </View>

        <View style={styles.instructions}>
          <Text style={styles.instructionsLabel}>Supplier instructions</Text>
          <Text style={styles.instructionsText}>
            Please quote PO number <Text style={{ fontFamily: "Helvetica-Bold" }}>
              {purchaseOrder.poNumber ?? "—"}
            </Text> on your invoice and delivery note. Partial shipments must be agreed with the buyer in advance.
          </Text>
        </View>

        {(purchaseOrder.notes || purchaseOrder.terms) && (
          <View style={styles.notes} wrap={false}>
            {purchaseOrder.notes && (
              <>
                <Text style={styles.notesLabel}>Notes</Text>
                <Text style={styles.notesText}>{purchaseOrder.notes}</Text>
              </>
            )}
            {purchaseOrder.terms && (
              <>
                <Text style={[styles.notesLabel, { marginTop: 14 }]}>Terms</Text>
                <Text style={styles.notesText}>{purchaseOrder.terms}</Text>
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
