import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { FinalSettlementRow, Tenant } from "@/lib/api";

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
    marginBottom: 28,
  },
  tenantBlock: { maxWidth: 280 },
  tenantName: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  tenantMeta: { color: TEXT_SECONDARY, lineHeight: 1.5 },
  letterHeader: { alignItems: "flex-end" },
  letterLabel: {
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: TEXT_TERTIARY,
  },
  settlementNumber: { fontSize: 20, fontFamily: "Helvetica-Bold", marginTop: 4 },
  statusPill: {
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: MINT_SURFACE,
    color: MINT_DARK,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
  },

  employeeBlock: {
    borderTop: `0.5pt solid ${BORDER}`,
    borderBottom: `0.5pt solid ${BORDER}`,
    paddingVertical: 14,
    marginBottom: 20,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  employeeCol: { maxWidth: 260 },
  employeeName: { fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  employeeMeta: { color: TEXT_SECONDARY, lineHeight: 1.6 },
  metaLabel: {
    fontSize: 8,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: TEXT_TERTIARY,
    marginBottom: 3,
  },
  metaValue: { fontSize: 10, color: CHARCOAL, marginBottom: 8 },

  sectionTitle: {
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: TEXT_TERTIARY,
    marginBottom: 8,
  },
  card: {
    borderRadius: 4,
    border: `0.5pt solid ${BORDER}`,
    padding: 14,
    marginBottom: 14,
  },
  lineRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  lineLabel: { color: TEXT_SECONDARY },
  lineValue: { color: CHARCOAL },
  cardDivider: {
    borderTop: `0.5pt solid ${BORDER}`,
    marginVertical: 8,
  },
  subtotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  subtotalLabel: { fontFamily: "Helvetica-Bold", color: CHARCOAL },
  subtotalValue: { fontFamily: "Helvetica-Bold", color: CHARCOAL },

  netBand: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: MINT_SURFACE,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 4,
    marginBottom: 20,
  },
  netLabel: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: MINT_DARK,
    fontFamily: "Helvetica-Bold",
  },
  netValue: { fontSize: 20, fontFamily: "Helvetica-Bold", color: CHARCOAL },

  note: {
    backgroundColor: SURFACE_RECESSED,
    padding: 12,
    borderRadius: 4,
    marginBottom: 20,
  },
  noteBody: { color: TEXT_SECONDARY, lineHeight: 1.5 },

  signatureBlock: {
    marginTop: 32,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  signatureCol: { flex: 1, marginRight: 16 },
  signatureLine: {
    borderTop: `0.5pt solid ${CHARCOAL}`,
    marginTop: 40,
    paddingTop: 6,
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

/**
 * Employer-issued settlement letter. Includes gross-to-net breakdown
 * (mirroring the worksheet), a short legal-ish statement about the
 * final and binding nature of the payment, and signature blocks.
 */
export function SettlementLetterPDF({
  tenant,
  settlement,
}: {
  tenant: Pick<Tenant, "businessName">;
  settlement: FinalSettlementRow;
}) {
  const lines = settlement.linesSnapshot ?? [];
  const earningRows = lines.filter((l) => l.kind === "earning");
  const deductionRows = lines.filter((l) => l.kind === "deduction");
  const statutoryRows = lines.filter((l) => l.kind === "statutory");

  const earningsTotal = earningRows.reduce(
    (sum, r) => sum + r.amountCents,
    0,
  );
  const deductionsTotal =
    deductionRows.reduce((sum, r) => sum + r.amountCents, 0) +
    statutoryRows.reduce((sum, r) => sum + r.amountCents, 0);

  const number = settlement.settlementNumber ?? "Draft";
  const statusLabel =
    settlement.status === "posted"
      ? "Posted"
      : settlement.status === "paid"
        ? "Paid"
        : settlement.status === "approved"
          ? "Approved"
          : settlement.status === "cancelled"
            ? "Cancelled"
            : "Draft";

  return (
    <Document
      title={`Settlement letter ${settlement.employeeFullName}`}
      author={tenant.businessName}
      creator="PettahPro"
      producer="PettahPro"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          <View style={styles.tenantBlock}>
            <Text style={styles.tenantName}>{tenant.businessName}</Text>
            <Text style={styles.tenantMeta}>
              Final settlement · confidential
            </Text>
          </View>
          <View style={styles.letterHeader}>
            <Text style={styles.letterLabel}>Settlement</Text>
            <Text style={styles.settlementNumber}>{number}</Text>
            <Text style={styles.statusPill}>{statusLabel}</Text>
          </View>
        </View>

        <View style={styles.employeeBlock}>
          <View style={styles.employeeCol}>
            <Text style={styles.employeeName}>{settlement.employeeFullName}</Text>
            {settlement.designation && (
              <Text style={styles.employeeMeta}>{settlement.designation}</Text>
            )}
            {settlement.department && (
              <Text style={styles.employeeMeta}>{settlement.department}</Text>
            )}
            {settlement.employeeCode && (
              <Text style={styles.employeeMeta}>
                Employee code: {settlement.employeeCode}
              </Text>
            )}
          </View>
          <View>
            <Text style={styles.metaLabel}>Hire date</Text>
            <Text style={styles.metaValue}>{formatDate(settlement.hireDate)}</Text>
            <Text style={styles.metaLabel}>Exit date</Text>
            <Text style={styles.metaValue}>{formatDate(settlement.exitDate)}</Text>
            <Text style={styles.metaLabel}>Last working day</Text>
            <Text style={styles.metaValue}>
              {formatDate(settlement.lastWorkingDay)}
            </Text>
            <Text style={styles.metaLabel}>Years of service</Text>
            <Text style={styles.metaValue}>
              {Number(settlement.yearsOfService).toFixed(2)} (
              {settlement.gratuityYearsCompleted} completed)
            </Text>
          </View>
        </View>

        {earningRows.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Earnings</Text>
            {earningRows.map((line) => (
              <View key={line.code} style={styles.lineRow}>
                <Text style={styles.lineLabel}>{line.name}</Text>
                <Text style={styles.lineValue}>
                  {formatLKR(line.amountCents)}
                </Text>
              </View>
            ))}
            <View style={styles.cardDivider} />
            <View style={styles.subtotal}>
              <Text style={styles.subtotalLabel}>Gross earnings</Text>
              <Text style={styles.subtotalValue}>{formatLKR(earningsTotal)}</Text>
            </View>
          </View>
        )}

        {(deductionRows.length > 0 || statutoryRows.length > 0) && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Deductions</Text>
            {statutoryRows.map((line) => (
              <View key={line.code} style={styles.lineRow}>
                <Text style={styles.lineLabel}>{line.name}</Text>
                <Text style={styles.lineValue}>
                  -{formatLKR(line.amountCents)}
                </Text>
              </View>
            ))}
            {deductionRows.map((line) => (
              <View key={line.code} style={styles.lineRow}>
                <Text style={styles.lineLabel}>{line.name}</Text>
                <Text style={styles.lineValue}>
                  -{formatLKR(line.amountCents)}
                </Text>
              </View>
            ))}
            <View style={styles.cardDivider} />
            <View style={styles.subtotal}>
              <Text style={styles.subtotalLabel}>Total deductions</Text>
              <Text style={styles.subtotalValue}>
                -{formatLKR(deductionsTotal)}
              </Text>
            </View>
          </View>
        )}

        <View style={styles.netBand}>
          <Text style={styles.netLabel}>Net payable</Text>
          <Text style={styles.netValue}>
            {formatLKR(settlement.netPayableCents)}
          </Text>
        </View>

        <View style={styles.note}>
          <Text style={styles.sectionTitle}>Declaration</Text>
          <Text style={styles.noteBody}>
            This letter sets out the final settlement payable to{" "}
            {settlement.employeeFullName} on the cessation of employment with{" "}
            {tenant.businessName} effective {formatDate(settlement.exitDate)}.
            The amount shown is inclusive of all statutory entitlements including
            gratuity (where applicable), EPF/ETF, and is in full and final
            settlement of all dues between employer and employee. On receipt of
            this payment the employee has no further monetary claims against the
            employer arising out of the employment.
          </Text>
        </View>

        {settlement.notes && (
          <View style={styles.note}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text style={styles.noteBody}>{settlement.notes}</Text>
          </View>
        )}

        <View style={styles.signatureBlock}>
          <View style={styles.signatureCol}>
            <View style={styles.signatureLine}>
              <Text style={styles.lineLabel}>Employee signature</Text>
              <Text style={styles.lineLabel}>{settlement.employeeFullName}</Text>
            </View>
          </View>
          <View style={styles.signatureCol}>
            <View style={styles.signatureLine}>
              <Text style={styles.lineLabel}>Authorised signatory</Text>
              <Text style={styles.lineLabel}>{tenant.businessName}</Text>
            </View>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text>Generated with PettahPro — pettahpro.lk</Text>
          <Text>
            Settlement {number} · {settlement.employeeFullName}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
