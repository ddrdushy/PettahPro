import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { Customer, DeliveryNoteDetail, DeliveryNoteLine, Tenant } from "@/lib/api";

// Brand tokens from brand-kit.md §5 (shared with invoice-pdf / quotation-pdf).
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
  statusDelivered: { backgroundColor: MINT_SURFACE, color: MINT_DARK },
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

  partiesRow: {
    flexDirection: "row",
    gap: 24,
    marginBottom: 20,
  },
  partyCol: { flex: 1 },
  partyLabel: {
    fontSize: 8,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: TEXT_TERTIARY,
    marginBottom: 6,
  },
  partyName: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  partyLine: { color: TEXT_SECONDARY, marginTop: 2 },

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
  colQty: { width: 100, textAlign: "right" },
  th: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: TEXT_TERTIARY,
  },
  td: { fontSize: 10 },

  signBlock: {
    marginTop: 40,
    flexDirection: "row",
    gap: 40,
  },
  signCol: { flex: 1 },
  signLine: {
    borderTop: `0.5pt solid ${CHARCOAL}`,
    marginTop: 48,
    paddingTop: 6,
  },
  signLabel: {
    fontSize: 9,
    color: TEXT_TERTIARY,
  },
  signName: { fontSize: 10, color: CHARCOAL, marginTop: 2 },

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

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatQty(n: string | number): string {
  return Number(n).toLocaleString("en-LK", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

export function DeliveryNotePDF({
  tenant,
  deliveryNote,
  lines,
  customer,
}: {
  tenant: Pick<Tenant, "businessName">;
  deliveryNote: DeliveryNoteDetail;
  lines: DeliveryNoteLine[];
  customer: Customer | null;
}) {
  const statusStyle = {
    draft: styles.statusDraft,
    delivered: styles.statusDelivered,
    cancelled: styles.statusCancelled,
  }[deliveryNote.status];

  const shipAddress = [
    deliveryNote.shippingAddressLine1,
    deliveryNote.shippingAddressLine2,
    deliveryNote.shippingCity,
    deliveryNote.shippingPostalCode,
  ].filter(Boolean);

  return (
    <Document
      title={deliveryNote.dnNumber ?? "Delivery note"}
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
          <View style={styles.docHeader}>
            <Text style={styles.docLabel}>Delivery note</Text>
            <Text style={styles.docNumber}>{deliveryNote.dnNumber ?? "Draft"}</Text>
            <Text style={[styles.statusPill, statusStyle]}>{deliveryNote.status}</Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Delivery date</Text>
            <Text style={styles.metaValue}>{formatDate(deliveryNote.deliveryDate)}</Text>
          </View>
          {deliveryNote.carrier && (
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>Carrier</Text>
              <Text style={styles.metaValue}>{deliveryNote.carrier}</Text>
            </View>
          )}
          {deliveryNote.trackingNumber && (
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>Tracking #</Text>
              <Text style={styles.metaValue}>{deliveryNote.trackingNumber}</Text>
            </View>
          )}
          {deliveryNote.deliveredAt && (
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>Delivered</Text>
              <Text style={styles.metaValue}>{formatDate(deliveryNote.deliveredAt.slice(0, 10))}</Text>
            </View>
          )}
        </View>

        <View style={styles.partiesRow}>
          {customer && (
            <View style={styles.partyCol}>
              <Text style={styles.partyLabel}>Deliver to</Text>
              <Text style={styles.partyName}>{customer.name}</Text>
              {customer.addressLine1 && <Text style={styles.partyLine}>{customer.addressLine1}</Text>}
              {customer.addressLine2 && <Text style={styles.partyLine}>{customer.addressLine2}</Text>}
              {customer.city && <Text style={styles.partyLine}>{customer.city}</Text>}
              {customer.phone && <Text style={styles.partyLine}>{customer.phone}</Text>}
            </View>
          )}
          {shipAddress.length > 0 && (
            <View style={styles.partyCol}>
              <Text style={styles.partyLabel}>Shipping address</Text>
              {shipAddress.map((line, i) => (
                <Text key={i} style={styles.partyLine}>{line}</Text>
              ))}
            </View>
          )}
        </View>

        <View style={styles.table}>
          <View style={[styles.row, styles.rowHeader]}>
            <Text style={[styles.colNum, styles.th]}>#</Text>
            <Text style={[styles.colDesc, styles.th]}>Description</Text>
            <Text style={[styles.colQty, styles.th]}>Qty delivered</Text>
          </View>
          {lines.map((l) => (
            <View key={l.id} style={styles.row} wrap={false}>
              <Text style={[styles.colNum, styles.td]}>{l.lineNo}</Text>
              <Text style={[styles.colDesc, styles.td]}>{l.description}</Text>
              <Text style={[styles.colQty, styles.td]}>{formatQty(l.quantity)}</Text>
            </View>
          ))}
        </View>

        {deliveryNote.notes && (
          <View style={styles.notes} wrap={false}>
            <Text style={styles.notesLabel}>Notes</Text>
            <Text style={styles.notesText}>{deliveryNote.notes}</Text>
          </View>
        )}

        <View style={styles.signBlock} wrap={false}>
          <View style={styles.signCol}>
            <View style={styles.signLine}>
              <Text style={styles.signLabel}>Delivered by (name &amp; signature)</Text>
            </View>
          </View>
          <View style={styles.signCol}>
            <View style={styles.signLine}>
              <Text style={styles.signLabel}>Received by (name &amp; signature)</Text>
              {deliveryNote.receivedByName && (
                <Text style={styles.signName}>{deliveryNote.receivedByName}</Text>
              )}
            </View>
          </View>
        </View>

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
