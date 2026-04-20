import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { PayrollRun, PayrollRunLine, Tenant } from "@/lib/api";

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
  payslipHeader: { alignItems: "flex-end" },
  payslipLabel: {
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: TEXT_TERTIARY,
  },
  runNumber: { fontSize: 20, fontFamily: "Helvetica-Bold", marginTop: 4 },
  periodPill: {
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

  twoCol: {
    flexDirection: "row",
    gap: 18,
    marginBottom: 20,
  },
  colCard: {
    flex: 1,
    borderRadius: 4,
    border: `0.5pt solid ${BORDER}`,
    padding: 14,
  },
  colHeader: {
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: TEXT_TERTIARY,
    marginBottom: 10,
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

  employerNote: {
    backgroundColor: SURFACE_RECESSED,
    padding: 12,
    borderRadius: 4,
    marginBottom: 20,
  },
  employerTitle: {
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: TEXT_TERTIARY,
    marginBottom: 8,
  },
  employerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
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

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function PayslipPDF({
  tenant,
  run,
  line,
}: {
  tenant: Pick<Tenant, "businessName">;
  run: PayrollRun;
  line: PayrollRunLine;
}) {
  const periodLabel = `${MONTHS[run.periodMonth - 1]} ${run.periodYear}`;

  const comps = (line.components ?? [])
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const earningRows = comps.filter((c) => c.kind === "earning");
  // Pre-tax deduction = reduces EPF or PAYE basis (no-pay leave etc.)
  const preTaxDeductionRows = comps.filter(
    (c) => c.kind === "deduction" && (c.countsForEpf || c.countsForEtf || c.countsForPaye),
  );
  // Post-tax = pure take-home recovery (salary advance, etc.)
  const postTaxDeductionRows = comps.filter(
    (c) => c.kind === "deduction" && !c.countsForEpf && !c.countsForEtf && !c.countsForPaye,
  );

  return (
    <Document
      title={`Payslip ${line.employeeFullName} ${periodLabel}`}
      author={tenant.businessName}
      creator="PettahPro"
      producer="PettahPro"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          <View style={styles.tenantBlock}>
            <Text style={styles.tenantName}>{tenant.businessName}</Text>
            <Text style={styles.tenantMeta}>Payslip · confidential</Text>
          </View>
          <View style={styles.payslipHeader}>
            <Text style={styles.payslipLabel}>Payslip</Text>
            <Text style={styles.runNumber}>
              {run.runNumber ? run.runNumber : "Draft"}
            </Text>
            <Text style={styles.periodPill}>{periodLabel}</Text>
          </View>
        </View>

        <View style={styles.employeeBlock}>
          <View style={styles.employeeCol}>
            <Text style={styles.employeeName}>{line.employeeFullName}</Text>
            {line.designation && (
              <Text style={styles.employeeMeta}>{line.designation}</Text>
            )}
            {line.department && (
              <Text style={styles.employeeMeta}>{line.department}</Text>
            )}
            {line.employeeCode && (
              <Text style={styles.employeeMeta}>Employee code: {line.employeeCode}</Text>
            )}
          </View>
          <View>
            {line.nic && (
              <>
                <Text style={styles.metaLabel}>NIC</Text>
                <Text style={styles.metaValue}>{line.nic}</Text>
              </>
            )}
            {line.epfNumber && (
              <>
                <Text style={styles.metaLabel}>EPF number</Text>
                <Text style={styles.metaValue}>{line.epfNumber}</Text>
              </>
            )}
            <Text style={styles.metaLabel}>Pay date</Text>
            <Text style={styles.metaValue}>{formatDate(run.payDate)}</Text>
          </View>
        </View>

        <View style={styles.twoCol}>
          <View style={styles.colCard}>
            <Text style={styles.colHeader}>Earnings</Text>
            {earningRows.length === 0 ? (
              <View style={styles.lineRow}>
                <Text style={styles.lineLabel}>Basic salary</Text>
                <Text style={styles.lineValue}>{formatLKR(line.basicSalaryCents)}</Text>
              </View>
            ) : (
              earningRows.map((c) => (
                <View key={c.id} style={styles.lineRow}>
                  <Text style={styles.lineLabel}>{c.name}</Text>
                  <Text style={styles.lineValue}>{formatLKR(c.amountCents)}</Text>
                </View>
              ))
            )}
            <View style={styles.cardDivider} />
            <View style={styles.subtotal}>
              <Text style={styles.subtotalLabel}>Gross earnings</Text>
              <Text style={styles.subtotalValue}>
                {formatLKR(line.earningsCents || line.grossCents)}
              </Text>
            </View>
          </View>

          <View style={styles.colCard}>
            <Text style={styles.colHeader}>Deductions</Text>
            {preTaxDeductionRows.map((c) => (
              <View key={c.id} style={styles.lineRow}>
                <Text style={styles.lineLabel}>{c.name}</Text>
                <Text style={styles.lineValue}>-{formatLKR(c.amountCents)}</Text>
              </View>
            ))}
            {line.epfEmployeeCents > 0 && (
              <View style={styles.lineRow}>
                <Text style={styles.lineLabel}>EPF (employee, 8%)</Text>
                <Text style={styles.lineValue}>-{formatLKR(line.epfEmployeeCents)}</Text>
              </View>
            )}
            {line.payeCents > 0 && (
              <View style={styles.lineRow}>
                <Text style={styles.lineLabel}>PAYE</Text>
                <Text style={styles.lineValue}>-{formatLKR(line.payeCents)}</Text>
              </View>
            )}
            {postTaxDeductionRows.map((c) => (
              <View key={c.id} style={styles.lineRow}>
                <Text style={styles.lineLabel}>{c.name}</Text>
                <Text style={styles.lineValue}>-{formatLKR(c.amountCents)}</Text>
              </View>
            ))}
            {line.totalDeductionsCents === 0 &&
              preTaxDeductionRows.length === 0 &&
              postTaxDeductionRows.length === 0 && (
                <Text style={styles.lineLabel}>No deductions</Text>
              )}
            <View style={styles.cardDivider} />
            <View style={styles.subtotal}>
              <Text style={styles.subtotalLabel}>Total deductions</Text>
              <Text style={styles.subtotalValue}>
                -{formatLKR(Math.max(0, (line.earningsCents || line.grossCents) - line.netPayCents))}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.netBand}>
          <Text style={styles.netLabel}>Net take-home pay</Text>
          <Text style={styles.netValue}>{formatLKR(line.netPayCents)}</Text>
        </View>

        {(line.epfEmployerCents > 0 || line.etfEmployerCents > 0) && (
          <View style={styles.employerNote}>
            <Text style={styles.employerTitle}>Employer contributions (for your records)</Text>
            {line.epfEmployerCents > 0 && (
              <View style={styles.employerRow}>
                <Text style={styles.lineLabel}>EPF (employer, 12%)</Text>
                <Text style={styles.lineValue}>{formatLKR(line.epfEmployerCents)}</Text>
              </View>
            )}
            {line.etfEmployerCents > 0 && (
              <View style={styles.employerRow}>
                <Text style={styles.lineLabel}>ETF (employer, 3%)</Text>
                <Text style={styles.lineValue}>{formatLKR(line.etfEmployerCents)}</Text>
              </View>
            )}
          </View>
        )}

        {line.bankName && line.bankAccountNo && (
          <View style={styles.employerNote}>
            <Text style={styles.employerTitle}>Disbursed to</Text>
            <Text style={styles.metaValue}>
              {line.bankName} · {line.bankAccountNo}
              {line.bankBranch ? ` · ${line.bankBranch}` : ""}
            </Text>
          </View>
        )}

        <View style={styles.footer} fixed>
          <Text>Generated with PettahPro — pettahpro.lk</Text>
          <Text>
            Payslip for {line.employeeFullName} · {periodLabel}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
