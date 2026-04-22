import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type {
  StockTransferDetail,
  StockTransferLineRow,
  StockTransferWarehouse,
  Tenant,
} from "@/lib/api";

// Brand tokens (shared with invoice-pdf / delivery-note-pdf / quotation-pdf).
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
  statusDispatched: { backgroundColor: "#FEF3C7", color: "#92400E" },
  statusReceived: { backgroundColor: MINT_SURFACE, color: MINT_DARK },
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
  arrow: {
    alignSelf: "center",
    color: TEXT_TERTIARY,
    fontSize: 16,
    paddingTop: 18,
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
  colQty: { width: 90, textAlign: "right" },
  th: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: TEXT_TERTIARY,
  },
  td: { fontSize: 10 },
  tdMuted: { fontSize: 10, color: TEXT_TERTIARY },
  tdShort: { fontSize: 10, color: "#92400E" },

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

function formatQty(n: string | number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("en-LK", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

export function StockTransferPDF({
  tenant,
  transfer,
  lines,
  source,
  destination,
}: {
  tenant: Pick<Tenant, "businessName">;
  transfer: StockTransferDetail;
  lines: StockTransferLineRow[];
  source: StockTransferWarehouse | null;
  destination: StockTransferWarehouse | null;
}) {
  const statusStyle = {
    draft: styles.statusDraft,
    dispatched: styles.statusDispatched,
    received: styles.statusReceived,
    cancelled: styles.statusCancelled,
  }[transfer.status];

  const isDispatchedOrLater =
    transfer.status === "dispatched" || transfer.status === "received";

  return (
    <Document
      title={transfer.transferNumber ?? "Stock transfer"}
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
            <Text style={styles.docLabel}>Stock transfer</Text>
            <Text style={styles.docNumber}>{transfer.transferNumber ?? "Draft"}</Text>
            <Text style={[styles.statusPill, statusStyle]}>{transfer.status}</Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Requested</Text>
            <Text style={styles.metaValue}>{formatDate(transfer.requestedDate)}</Text>
          </View>
          {transfer.dispatchedAt && (
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>Dispatched</Text>
              <Text style={styles.metaValue}>
                {formatDate(transfer.dispatchedAt.slice(0, 10))}
              </Text>
            </View>
          )}
          {transfer.receivedAt && (
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>Received</Text>
              <Text style={styles.metaValue}>
                {formatDate(transfer.receivedAt.slice(0, 10))}
              </Text>
            </View>
          )}
          {transfer.hasDiscrepancy && (
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>Discrepancy</Text>
              <Text style={styles.metaValue}>Flagged</Text>
            </View>
          )}
        </View>

        <View style={styles.partiesRow}>
          <View style={styles.partyCol}>
            <Text style={styles.partyLabel}>From (source)</Text>
            {source ? (
              <>
                <Text style={styles.partyName}>{source.name}</Text>
                <Text style={styles.partyLine}>Code: {source.code}</Text>
              </>
            ) : (
              <Text style={styles.partyLine}>—</Text>
            )}
          </View>
          <Text style={styles.arrow}>→</Text>
          <View style={styles.partyCol}>
            <Text style={styles.partyLabel}>To (destination)</Text>
            {destination ? (
              <>
                <Text style={styles.partyName}>{destination.name}</Text>
                <Text style={styles.partyLine}>Code: {destination.code}</Text>
              </>
            ) : (
              <Text style={styles.partyLine}>—</Text>
            )}
          </View>
        </View>

        <View style={styles.table}>
          <View style={[styles.row, styles.rowHeader]}>
            <Text style={[styles.colNum, styles.th]}>#</Text>
            <Text style={[styles.colDesc, styles.th]}>Item</Text>
            <Text style={[styles.colQty, styles.th]}>Requested</Text>
            <Text style={[styles.colQty, styles.th]}>Dispatched</Text>
            <Text style={[styles.colQty, styles.th]}>Received</Text>
          </View>
          {lines.map((l) => {
            const dispatched = Number(l.quantity_dispatched ?? 0);
            const received =
              l.quantity_received != null ? Number(l.quantity_received) : null;
            const isShort =
              isDispatchedOrLater &&
              received !== null &&
              received < dispatched;
            return (
              <View key={l.id} style={styles.row} wrap={false}>
                <Text style={[styles.colNum, styles.td]}>{l.line_no}</Text>
                <View style={styles.colDesc}>
                  <Text style={styles.td}>{l.item_name}</Text>
                  {l.sku && <Text style={styles.tdMuted}>{l.sku}</Text>}
                  {l.notes && <Text style={styles.tdMuted}>{l.notes}</Text>}
                </View>
                <Text style={[styles.colQty, styles.td]}>
                  {formatQty(l.quantity_requested)} {l.unit}
                </Text>
                <Text style={[styles.colQty, styles.td]}>
                  {l.quantity_dispatched != null
                    ? `${formatQty(l.quantity_dispatched)} ${l.unit}`
                    : "—"}
                </Text>
                <Text
                  style={[styles.colQty, isShort ? styles.tdShort : styles.td]}
                >
                  {l.quantity_received != null
                    ? `${formatQty(l.quantity_received)} ${l.unit}`
                    : "—"}
                </Text>
              </View>
            );
          })}
        </View>

        {transfer.notes && (
          <View style={styles.notes} wrap={false}>
            <Text style={styles.notesLabel}>Notes</Text>
            <Text style={styles.notesText}>{transfer.notes}</Text>
          </View>
        )}

        {transfer.cancelledReason && (
          <View style={styles.notes} wrap={false}>
            <Text style={styles.notesLabel}>Cancelled reason</Text>
            <Text style={styles.notesText}>{transfer.cancelledReason}</Text>
          </View>
        )}

        <View style={styles.signBlock} wrap={false}>
          <View style={styles.signCol}>
            <View style={styles.signLine}>
              <Text style={styles.signLabel}>Dispatched by (name &amp; signature)</Text>
            </View>
          </View>
          <View style={styles.signCol}>
            <View style={styles.signLine}>
              <Text style={styles.signLabel}>Received by (name &amp; signature)</Text>
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
