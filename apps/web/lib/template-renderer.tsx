import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import type {
  BillCharge,
  BillDetail,
  BillLine,
  CreditNoteDetail,
  CreditNoteLine,
  CreditNoteLinkedInvoice,
  CreditNoteReason,
  Customer,
  DebitNoteDetail,
  DebitNoteLine,
  DebitNoteLinkedBill,
  DebitNoteReason,
  DeliveryNoteDetail,
  DeliveryNoteLine,
  FinalSettlementRow,
  InvoiceDetail,
  InvoiceLine,
  PayrollRun,
  PayrollRunLine,
  PayrollRunLineComponent,
  ProformaInvoiceDetail,
  ProformaInvoiceLine,
  PurchaseOrderDetail,
  PurchaseOrderLine,
  QuotationDetail,
  QuotationLine,
  StockTransferDetail,
  StockTransferLineRow,
  StockTransferWarehouse,
  Supplier,
  Tenant,
} from "@/lib/api";
import { PdfLogoBlock } from "@/lib/pdf-logo-block";

// Template renderer (roadmap #33) — walks a `layout_json` blob (as
// stored in document_templates.layout_json) and emits react-pdf
// primitives. The API is intentionally opaque: callers pass the
// layout object and a document context, the renderer returns a
// react-pdf Document.
//
// v1 supports invoices only — the section types map 1:1 to blocks
// we already draw in apps/web/lib/invoice-pdf.tsx (header, meta row,
// bill-to, line items, totals, notes, footer). Extending to other
// doc types means adding a context shape (buildContext below) and
// growing the section dispatcher. Schema lives in JSON so the SQL
// side doesn't move when the renderer grows new blocks.
//
// Layout JSON shape (parsed defensively — missing fields fall back
// to sensible defaults so a malformed template doesn't 500 the
// render route):
//   {
//     pageSize: 'a4' | 'a5' | 'thermal_80' | 'thermal_58',
//     theme: {
//       accentColor, mutedColor, textPrimary, textSecondary,
//       textTertiary, borderColor, surfaceRecessed, fontFamily,
//       fontSize
//     },
//     sections: Array<
//       | { type: 'header', showLogo?, showStatusPill? }
//       | { type: 'metaRow', fields?: string[] }
//       | { type: 'billTo' }
//       | { type: 'lineItemsTable' }
//       | { type: 'totals', showTaxBreakdown? }
//       | { type: 'notes' }
//       | { type: 'footer', text? }
//       | { type: 'spacer', height?: number }
//       | { type: 'text', text: string, emphasis?: 'default' | 'muted' | 'label' }
//     >
//   }

type PageSize = "a4" | "a5" | "thermal_80" | "thermal_58";

type Theme = {
  accentColor: string;
  mutedColor: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  borderColor: string;
  surfaceRecessed: string;
  fontFamily: string;
  fontSize: number;
};

type Section =
  | { type: "header"; showLogo?: boolean; showStatusPill?: boolean }
  | { type: "metaRow"; fields?: string[] }
  | { type: "billTo" }
  // billFrom mirrors billTo but for the supplier party — used by
  // bill / debit-note / PO templates where the document is *received
  // from* a vendor.
  | { type: "billFrom" }
  | { type: "lineItemsTable" }
  // Bills can carry landed-cost / freight / clearing charges as a
  // second table. chargesTable renders when the doc context has them
  // and silently skips otherwise (so an invoice template with this
  // section accidentally reused does nothing instead of crashing).
  | { type: "chargesTable" }
  // Soft "Draft — not posted to the ledger" banner. Visible only when
  // the doc's status is draft; the template can still include the
  // section unconditionally.
  | { type: "draftBanner"; text?: string }
  // Validity callout for quotations / proformas — shows the
  // valid-until date and an expired warning when the date is past.
  | { type: "validity" }
  // Linked-document badge — shown by credit notes (against an
  // invoice) and debit notes (against a bill) so the recipient can
  // see what the credit/debit applies to.
  | { type: "linkedDocument" }
  | { type: "totals"; showTaxBreakdown?: boolean }
  | { type: "notes" }
  | { type: "footer"; text?: string }
  | { type: "spacer"; height?: number }
  | {
      type: "text";
      text: string;
      emphasis?: "default" | "muted" | "label";
    }
  // Two-column "Deliver to" / shipping-address row used by the delivery
  // note. Renders nothing when neither column has data.
  | { type: "partiesRow" }
  // Source-→-destination warehouse row used by stock transfers.
  | { type: "warehouseRow" }
  // "Delivered/dispatched by" + "Received by" sign-off block — used by
  // delivery notes and stock transfers.
  | { type: "signBlock" }
  // Buyer-side instructions callout on a purchase order ("quote PO #
  // on your invoice", partial-shipment policy etc.).
  | { type: "instructions" }
  // Italic "this is not a tax invoice" paragraph rendered at the
  // bottom of a proforma invoice.
  | { type: "disclaimer" }
  // Payslip sections — every block is its own section so payroll
  // admins can rearrange or drop optional pieces.
  | { type: "employeeBlock" }
  | { type: "payslipColumns" }
  | { type: "netPayBand" }
  | { type: "leaveSummary" }
  | { type: "employerContributions" }
  | { type: "bankDisbursement" }
  // Settlement-letter sections — the doc has two single-column
  // earnings/deductions cards plus a declaration paragraph and
  // signature block, none of which fit the generic shapes above.
  | { type: "settlementEmployee" }
  | { type: "settlementEarnings" }
  | { type: "settlementDeductions" }
  | { type: "settlementNetPay" }
  | { type: "settlementDeclaration" }
  | { type: "settlementSignatures" };

type Layout = {
  pageSize: PageSize;
  theme: Theme;
  sections: Section[];
};

// Default theme — falls back to brand-kit §5 tokens when a layout
// omits a field. Keeps the output sane even if the builder UI
// shipped a partial JSON blob.
const DEFAULT_THEME: Theme = {
  accentColor: "#3D6B52",
  mutedColor: "#E8EDE9",
  textPrimary: "#1A1A1A",
  textSecondary: "#5F5E5A",
  textTertiary: "#888780",
  borderColor: "#E5E5E3",
  surfaceRecessed: "#F1EFE8",
  fontFamily: "Helvetica",
  fontSize: 10,
};

function parseLayout(raw: unknown): Layout {
  const r = (raw ?? {}) as Partial<Layout>;
  return {
    pageSize: (r.pageSize as PageSize) ?? "a4",
    theme: { ...DEFAULT_THEME, ...(r.theme ?? {}) },
    sections: Array.isArray(r.sections) ? (r.sections as Section[]) : [],
  };
}

// react-pdf's Page `size` prop accepts a string name or a tuple of
// points ([width, height]). 80mm = 226.77pt, 58mm = 164.41pt (at
// 72dpi). Receipt heights are unbounded — we pass a very tall value
// and let react-pdf auto-paginate if content overflows.
function pageSizeProp(size: PageSize): "A4" | "A5" | [number, number] {
  if (size === "a4") return "A4";
  if (size === "a5") return "A5";
  if (size === "thermal_80") return [226.77, 1200];
  return [164.41, 1200]; // thermal_58
}

function formatLKR(cents: number, currency = "LKR"): string {
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

// -----------------------------------------------------------------
// Invoice context + renderer
// -----------------------------------------------------------------
export type InvoiceContext = {
  docType: "invoice";
  tenant: Pick<Tenant, "businessName">;
  invoice: InvoiceDetail;
  lines: InvoiceLine[];
  customer: Customer | null;
  // Tenant logo as a data URL (gaps M9 follow-up). When the layout's
  // header section sets showLogo (default true), the renderer drops
  // an <Image> above the business name. Null = text-only header.
  logoDataUrl?: string | null;
};

export function buildInvoiceContext(args: {
  tenant: Pick<Tenant, "businessName">;
  invoice: InvoiceDetail;
  lines: InvoiceLine[];
  customer: Customer | null;
  logoDataUrl?: string | null;
}): InvoiceContext {
  return { docType: "invoice", ...args };
}

function buildInvoiceStyles(theme: Theme) {
  return StyleSheet.create({
    page: {
      fontFamily: theme.fontFamily,
      fontSize: theme.fontSize,
      color: theme.textPrimary,
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
    tenantName: {
      fontSize: 18,
      fontFamily: `${theme.fontFamily}-Bold`,
      marginBottom: 4,
    },
    tenantMeta: { color: theme.textSecondary, lineHeight: 1.5 },
    invoiceHeader: { alignItems: "flex-end" },
    invoiceLabel: {
      fontSize: 9,
      textTransform: "uppercase",
      letterSpacing: 1,
      color: theme.textTertiary,
    },
    invoiceNumber: {
      fontSize: 22,
      fontFamily: `${theme.fontFamily}-Bold`,
      marginTop: 4,
    },
    statusPill: {
      marginTop: 10,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      fontSize: 8,
      fontFamily: `${theme.fontFamily}-Bold`,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      backgroundColor: theme.mutedColor,
      color: theme.accentColor,
    },

    metaRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      borderTop: `0.5pt solid ${theme.borderColor}`,
      borderBottom: `0.5pt solid ${theme.borderColor}`,
      paddingVertical: 14,
      marginBottom: 24,
    },
    metaCell: { flex: 1 },
    metaLabel: {
      fontSize: 8,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      color: theme.textTertiary,
      marginBottom: 4,
    },
    metaValue: { fontSize: 10, color: theme.textPrimary },

    billTo: { marginBottom: 20 },
    billToLabel: {
      fontSize: 8,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      color: theme.textTertiary,
      marginBottom: 6,
    },
    billToName: { fontSize: 12, fontFamily: `${theme.fontFamily}-Bold` },
    billToLine: { color: theme.textSecondary, marginTop: 2 },

    table: {
      borderTop: `0.5pt solid ${theme.borderColor}`,
      marginBottom: 24,
    },
    row: {
      flexDirection: "row",
      borderBottom: `0.5pt solid ${theme.borderColor}`,
      paddingVertical: 8,
    },
    rowHeader: { backgroundColor: theme.surfaceRecessed },
    colNum: { width: 24, textAlign: "center" },
    colDesc: { flex: 1, paddingRight: 8 },
    colQty: { width: 55, textAlign: "right" },
    colUnit: { width: 72, textAlign: "right" },
    colTax: { width: 62, textAlign: "right" },
    colTotal: { width: 80, textAlign: "right" },
    th: {
      fontSize: 8,
      fontFamily: `${theme.fontFamily}-Bold`,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      color: theme.textTertiary,
    },
    td: { fontSize: 10 },
    tdMuted: { fontSize: 8, color: theme.textTertiary, marginTop: 2 },

    totalsBlock: { marginLeft: "auto", width: 240 },
    totalRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 4,
    },
    totalLabel: { color: theme.textSecondary },
    totalValue: { color: theme.textPrimary },
    totalDivider: {
      borderTop: `0.5pt solid ${theme.borderColor}`,
      marginVertical: 6,
    },
    grandTotal: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 8,
      backgroundColor: theme.mutedColor,
      paddingHorizontal: 10,
      marginTop: 4,
      marginBottom: 4,
    },
    grandLabel: {
      fontFamily: `${theme.fontFamily}-Bold`,
      fontSize: 11,
      color: theme.textPrimary,
    },
    grandValue: {
      fontFamily: `${theme.fontFamily}-Bold`,
      fontSize: 14,
      color: theme.textPrimary,
    },

    notes: {
      marginTop: 32,
      paddingTop: 14,
      borderTop: `0.5pt solid ${theme.borderColor}`,
    },
    notesLabel: {
      fontSize: 8,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      color: theme.textTertiary,
      marginBottom: 6,
    },
    notesText: { color: theme.textSecondary, lineHeight: 1.5 },

    footer: {
      position: "absolute",
      bottom: 24,
      left: 48,
      right: 48,
      fontSize: 8,
      color: theme.textTertiary,
      flexDirection: "row",
      justifyContent: "space-between",
    },

    spacerBase: {},
    text: { color: theme.textPrimary },
    textMuted: { color: theme.textSecondary },
    textLabel: {
      fontSize: 8,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      color: theme.textTertiary,
    },
  });
}

function renderInvoiceSection(
  section: Section,
  ctx: InvoiceContext,
  styles: ReturnType<typeof buildInvoiceStyles>,
  key: number,
) {
  const { invoice, lines, customer, tenant } = ctx;

  switch (section.type) {
    case "header":
      return (
        <View key={key} style={styles.header} fixed>
          <View style={styles.tenantBlock}>
            {section.showLogo !== false && (
              <PdfLogoBlock logoDataUrl={ctx.logoDataUrl} />
            )}
            <Text style={styles.tenantName}>{tenant.businessName}</Text>
            <Text style={styles.tenantMeta}>Sri Lanka</Text>
          </View>
          <View style={styles.invoiceHeader}>
            <Text style={styles.invoiceLabel}>Tax Invoice</Text>
            <Text style={styles.invoiceNumber}>
              {invoice.invoiceNumber ?? "Draft"}
            </Text>
            {section.showStatusPill !== false && (
              <Text style={styles.statusPill}>
                {invoice.status.replace("_", " ")}
              </Text>
            )}
          </View>
        </View>
      );

    case "metaRow": {
      const fields = section.fields ?? [
        "invoiceDate",
        "dueDate",
        "reference",
        "poNumber",
      ];
      const cells: Array<{ label: string; value: string | null }> = fields.map(
        (f) => {
          if (f === "invoiceDate")
            return { label: "Issue date", value: formatDate(invoice.issueDate) };
          if (f === "dueDate")
            return { label: "Due date", value: formatDate(invoice.dueDate) };
          if (f === "reference")
            return { label: "Reference", value: invoice.reference ?? null };
          if (f === "poNumber")
            return { label: "Customer PO", value: invoice.poNumber ?? null };
          if (f === "currency")
            return { label: "Currency", value: invoice.currency };
          if (f === "invoiceNumber")
            return { label: "Invoice #", value: invoice.invoiceNumber ?? null };
          return { label: f, value: null };
        },
      );
      return (
        <View key={key} style={styles.metaRow}>
          {cells
            .filter((c) => c.value !== null)
            .map((c, i) => (
              <View key={i} style={styles.metaCell}>
                <Text style={styles.metaLabel}>{c.label}</Text>
                <Text style={styles.metaValue}>{c.value}</Text>
              </View>
            ))}
        </View>
      );
    }

    case "billTo":
      if (!customer) return null;
      return (
        <View key={key} style={styles.billTo}>
          <Text style={styles.billToLabel}>Bill to</Text>
          <Text style={styles.billToName}>{customer.name}</Text>
          {customer.addressLine1 && (
            <Text style={styles.billToLine}>{customer.addressLine1}</Text>
          )}
          {customer.city && (
            <Text style={styles.billToLine}>{customer.city}</Text>
          )}
          {customer.email && (
            <Text style={styles.billToLine}>{customer.email}</Text>
          )}
          {customer.vatNo && (
            <Text style={[styles.billToLine, { marginTop: 4, fontSize: 8 }]}>
              VAT: {customer.vatNo}
            </Text>
          )}
        </View>
      );

    case "lineItemsTable":
      return (
        <View key={key} style={styles.table}>
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
      );

    case "totals":
      return (
        <View key={key} style={styles.totalsBlock}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>
              {formatLKR(invoice.subtotalCents)}
            </Text>
          </View>
          {invoice.discountCents > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Discount</Text>
              <Text style={styles.totalValue}>
                -{formatLKR(invoice.discountCents)}
              </Text>
            </View>
          )}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Tax</Text>
            <Text style={styles.totalValue}>
              {formatLKR(invoice.taxCents)}
            </Text>
          </View>
          <View style={styles.totalDivider} />
          <View style={styles.grandTotal}>
            <Text style={styles.grandLabel}>Total due</Text>
            <Text style={styles.grandValue}>
              {formatLKR(invoice.totalCents)}
            </Text>
          </View>
          {invoice.amountPaidCents > 0 && (
            <>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Paid to date</Text>
                <Text style={styles.totalValue}>
                  {formatLKR(invoice.amountPaidCents)}
                </Text>
              </View>
              <View style={styles.totalRow}>
                <Text
                  style={[
                    styles.totalLabel,
                    { fontFamily: `${styles.grandLabel.fontFamily}` },
                  ]}
                >
                  Balance
                </Text>
                <Text
                  style={[
                    styles.totalValue,
                    { fontFamily: `${styles.grandLabel.fontFamily}` },
                  ]}
                >
                  {formatLKR(invoice.balanceDueCents)}
                </Text>
              </View>
            </>
          )}
        </View>
      );

    case "notes":
      if (!invoice.notes && !invoice.terms) return null;
      return (
        <View key={key} style={styles.notes} wrap={false}>
          {invoice.notes && (
            <>
              <Text style={styles.notesLabel}>Notes</Text>
              <Text style={styles.notesText}>{invoice.notes}</Text>
            </>
          )}
          {invoice.terms && (
            <View style={{ marginTop: invoice.notes ? 14 : 0 }}>
              <Text style={styles.notesLabel}>Terms</Text>
              <Text style={styles.notesText}>{invoice.terms}</Text>
            </View>
          )}
        </View>
      );

    case "footer":
      return (
        <View key={key} style={styles.footer} fixed>
          <Text>{section.text ?? "Thank you for your business."}</Text>
          <Text>{tenant.businessName}</Text>
        </View>
      );

    case "spacer":
      return (
        <View key={key} style={{ height: section.height ?? 12 }} />
      );

    case "text": {
      const s =
        section.emphasis === "muted"
          ? styles.textMuted
          : section.emphasis === "label"
            ? styles.textLabel
            : styles.text;
      return (
        <Text key={key} style={s}>
          {section.text}
        </Text>
      );
    }

    default:
      return null;
  }
}

export function renderInvoiceTemplate(
  layoutRaw: unknown,
  ctx: InvoiceContext,
) {
  const layout = parseLayout(layoutRaw);
  const styles = buildInvoiceStyles(layout.theme);

  return (
    <Document
      title={ctx.invoice.invoiceNumber ?? "Invoice"}
      author={ctx.tenant.businessName}
      creator="PettahPro"
      producer="PettahPro"
    >
      <Page size={pageSizeProp(layout.pageSize)} style={styles.page}>
        {layout.sections.map((section, i) =>
          renderInvoiceSection(section, ctx, styles, i),
        )}
      </Page>
    </Document>
  );
}

// -----------------------------------------------------------------
// Bill context + renderer (M2 — first migrated doc type after invoice)
//
// The bill PDF reuses the same brand tokens as invoice + the same
// section vocabulary. Supplier-side data (`billFrom`, "Input tax"
// instead of "Tax", "Bill total" instead of "Total due") is what
// makes the bill renderer separate. The styles function is shared
// because every line, totals row, and theme token is identical.
// -----------------------------------------------------------------
export type BillContext = {
  docType: "bill";
  tenant: Pick<Tenant, "businessName">;
  bill: BillDetail;
  lines: BillLine[];
  charges: BillCharge[];
  supplier: Supplier | null;
  logoDataUrl?: string | null;
};

export function buildBillContext(args: {
  tenant: Pick<Tenant, "businessName">;
  bill: BillDetail;
  lines: BillLine[];
  charges: BillCharge[];
  supplier: Supplier | null;
  logoDataUrl?: string | null;
}): BillContext {
  return { docType: "bill", ...args };
}

// Bill-specific styles — extends invoice styles with the bits the
// bill renderer needs that the invoice doesn't (draftBanner,
// billFrom labels). Sharing buildInvoiceStyles avoids drift on the
// brand tokens; this function returns a superset.
function buildBillStyles(theme: Theme) {
  const base = buildInvoiceStyles(theme);
  return StyleSheet.create({
    ...base,
    billFrom: { marginBottom: 20 },
    billFromLabel: {
      fontSize: 8,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      color: theme.textTertiary,
      marginBottom: 6,
    },
    billFromName: { fontSize: 12, fontFamily: `${theme.fontFamily}-Bold` },
    billFromLine: { color: theme.textSecondary, marginTop: 2 },
    draftBanner: {
      backgroundColor: "#FAF0D9",
      color: "#B47A15",
      padding: 8,
      marginBottom: 16,
      fontSize: 9,
      fontFamily: `${theme.fontFamily}-Bold`,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      textAlign: "center",
    },
  });
}

function renderBillSection(
  section: Section,
  ctx: BillContext,
  styles: ReturnType<typeof buildBillStyles>,
  key: number,
) {
  const { bill, lines, charges, supplier, tenant } = ctx;

  switch (section.type) {
    case "header":
      return (
        <View key={key} style={styles.header} fixed>
          <View style={styles.tenantBlock}>
            {section.showLogo !== false && (
              <PdfLogoBlock logoDataUrl={ctx.logoDataUrl} />
            )}
            <Text style={styles.tenantName}>{tenant.businessName}</Text>
            <Text style={styles.tenantMeta}>Sri Lanka</Text>
          </View>
          <View style={styles.invoiceHeader}>
            <Text style={styles.invoiceLabel}>Bill</Text>
            <Text style={styles.invoiceNumber}>
              {bill.internalReference ?? "Draft"}
            </Text>
            {section.showStatusPill !== false && (
              <Text style={styles.statusPill}>
                {bill.status.replace("_", " ")}
              </Text>
            )}
          </View>
        </View>
      );

    case "draftBanner":
      if (bill.status !== "draft") return null;
      return (
        <Text key={key} style={styles.draftBanner}>
          {section.text ?? "Draft — not posted to the ledger"}
        </Text>
      );

    case "metaRow": {
      const fields = section.fields ?? [
        "billDate",
        "dueDate",
        "supplierBillNumber",
        "postedAt",
      ];
      const cells: Array<{ label: string; value: string | null }> = fields.map(
        (f) => {
          if (f === "billDate")
            return { label: "Bill date", value: formatDate(bill.billDate) };
          if (f === "dueDate")
            return { label: "Due date", value: formatDate(bill.dueDate) };
          if (f === "supplierBillNumber")
            return {
              label: "Supplier ref",
              value: bill.supplierBillNumber ?? null,
            };
          if (f === "postedAt")
            return {
              label: "Posted",
              value: bill.postedAt
                ? formatDate(bill.postedAt.slice(0, 10))
                : null,
            };
          if (f === "currency")
            return { label: "Currency", value: bill.currency };
          if (f === "internalReference")
            return {
              label: "Bill #",
              value: bill.internalReference ?? null,
            };
          return { label: f, value: null };
        },
      );
      return (
        <View key={key} style={styles.metaRow}>
          {cells
            .filter((c) => c.value !== null)
            .map((c, i) => (
              <View key={i} style={styles.metaCell}>
                <Text style={styles.metaLabel}>{c.label}</Text>
                <Text style={styles.metaValue}>{c.value}</Text>
              </View>
            ))}
        </View>
      );
    }

    case "billFrom":
      if (!supplier) return null;
      return (
        <View key={key} style={styles.billFrom}>
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
          {supplier.city && (
            <Text style={styles.billFromLine}>{supplier.city}</Text>
          )}
          {supplier.email && (
            <Text style={styles.billFromLine}>{supplier.email}</Text>
          )}
          {supplier.vatNo && (
            <Text style={[styles.billFromLine, { marginTop: 4, fontSize: 8 }]}>
              VAT: {supplier.vatNo}
            </Text>
          )}
        </View>
      );

    // billTo on a bill is interchangeable with billFrom — invoice
    // templates accidentally reused on a bill should still render
    // the supplier rather than crash.
    case "billTo":
      return renderBillSection({ type: "billFrom" }, ctx, styles, key);

    case "lineItemsTable":
      return (
        <View key={key} style={styles.table}>
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
      );

    case "chargesTable":
      if (charges.length === 0) return null;
      return (
        <View key={key} style={styles.table} wrap={false}>
          <View style={[styles.row, styles.rowHeader]}>
            <Text style={[styles.colNum, styles.th]}>#</Text>
            <Text style={[styles.colDesc, styles.th]}>
              Additional charges — allocated by{" "}
              {bill.chargeAllocationMethod === "quantity"
                ? "quantity"
                : "value"}
            </Text>
            <Text style={[styles.colTotal, styles.th]}>Amount</Text>
          </View>
          {charges.map((c) => (
            <View key={c.id} style={styles.row} wrap={false}>
              <Text style={[styles.colNum, styles.td]}>{c.lineNo}</Text>
              <View style={styles.colDesc}>
                <Text style={[styles.td, { textTransform: "capitalize" }]}>
                  {c.kind}
                </Text>
                {c.description && (
                  <Text style={styles.tdMuted}>{c.description}</Text>
                )}
              </View>
              <Text style={[styles.colTotal, styles.td]}>
                {formatLKR(c.amountCents)}
              </Text>
            </View>
          ))}
        </View>
      );

    case "totals":
      return (
        <View key={key} style={styles.totalsBlock}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>
              {formatLKR(bill.subtotalCents)}
            </Text>
          </View>
          {bill.discountCents > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Discount</Text>
              <Text style={styles.totalValue}>
                -{formatLKR(bill.discountCents)}
              </Text>
            </View>
          )}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Input tax</Text>
            <Text style={styles.totalValue}>{formatLKR(bill.taxCents)}</Text>
          </View>
          {bill.chargesTotalCents > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Charges (landed cost)</Text>
              <Text style={styles.totalValue}>
                {formatLKR(bill.chargesTotalCents)}
              </Text>
            </View>
          )}
          <View style={styles.totalDivider} />
          <View style={styles.grandTotal}>
            <Text style={styles.grandLabel}>Bill total</Text>
            <Text style={styles.grandValue}>
              {formatLKR(bill.totalCents)}
            </Text>
          </View>
          {bill.amountPaidCents > 0 && (
            <>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Paid to date</Text>
                <Text style={styles.totalValue}>
                  {formatLKR(bill.amountPaidCents)}
                </Text>
              </View>
              <View style={styles.totalRow}>
                <Text
                  style={[
                    styles.totalLabel,
                    { fontFamily: `${styles.grandLabel.fontFamily}` },
                  ]}
                >
                  Balance due
                </Text>
                <Text
                  style={[
                    styles.totalValue,
                    { fontFamily: `${styles.grandLabel.fontFamily}` },
                  ]}
                >
                  {formatLKR(bill.balanceDueCents)}
                </Text>
              </View>
            </>
          )}
        </View>
      );

    case "notes":
      if (!bill.notes) return null;
      return (
        <View key={key} style={styles.notes} wrap={false}>
          <Text style={styles.notesLabel}>Notes</Text>
          <Text style={styles.notesText}>{bill.notes}</Text>
        </View>
      );

    case "footer":
      return (
        <View key={key} style={styles.footer} fixed>
          <Text>{section.text ?? "Generated with PettahPro — pettahpro.lk"}</Text>
          <Text>{tenant.businessName}</Text>
        </View>
      );

    case "spacer":
      return <View key={key} style={{ height: section.height ?? 12 }} />;

    case "text": {
      const s =
        section.emphasis === "muted"
          ? styles.textMuted
          : section.emphasis === "label"
            ? styles.textLabel
            : styles.text;
      return (
        <Text key={key} style={s}>
          {section.text}
        </Text>
      );
    }

    default:
      return null;
  }
}

export function renderBillTemplate(layoutRaw: unknown, ctx: BillContext) {
  const layout = parseLayout(layoutRaw);
  const styles = buildBillStyles(layout.theme);

  return (
    <Document
      title={ctx.bill.internalReference ?? "Bill"}
      author={ctx.tenant.businessName}
      creator="PettahPro"
      producer="PettahPro"
    >
      <Page size={pageSizeProp(layout.pageSize)} style={styles.page}>
        {layout.sections.map((section, i) =>
          renderBillSection(section, ctx, styles, i),
        )}
      </Page>
    </Document>
  );
}

// -----------------------------------------------------------------
// Quotation context + renderer (M2 #2/10)
//
// Quotations differ from invoices in three things that matter for
// rendering: status set (draft/sent/accepted/rejected/expired/converted),
// "Prepared for" instead of "Bill to" (label, same data), and a
// validity callout block at the bottom that flips its message when
// the valid_until date is in the past. They also carry their own
// currency so per-line money formatting must thread it through.
// -----------------------------------------------------------------
export type QuotationContext = {
  docType: "quotation";
  tenant: Pick<Tenant, "businessName">;
  quotation: QuotationDetail;
  lines: QuotationLine[];
  customer: Customer | null;
  logoDataUrl?: string | null;
};

export function buildQuotationContext(args: {
  tenant: Pick<Tenant, "businessName">;
  quotation: QuotationDetail;
  lines: QuotationLine[];
  customer: Customer | null;
  logoDataUrl?: string | null;
}): QuotationContext {
  return { docType: "quotation", ...args };
}

function buildQuotationStyles(theme: Theme) {
  const base = buildInvoiceStyles(theme);
  return StyleSheet.create({
    ...base,
    validity: {
      marginTop: 18,
      padding: 12,
      backgroundColor: theme.surfaceRecessed,
      borderRadius: 4,
    },
    validityLabel: {
      fontSize: 8,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      color: theme.textTertiary,
      marginBottom: 4,
    },
    validityText: { color: theme.textSecondary, lineHeight: 1.5 },
    validityExpired: { color: "#B47A15" },
  });
}

function renderQuotationSection(
  section: Section,
  ctx: QuotationContext,
  styles: ReturnType<typeof buildQuotationStyles>,
  key: number,
) {
  const { quotation, lines, customer, tenant } = ctx;
  const today = new Date().toISOString().slice(0, 10);
  const isExpired =
    quotation.status !== "accepted" &&
    quotation.status !== "converted" &&
    quotation.validUntil < today;

  switch (section.type) {
    case "header":
      return (
        <View key={key} style={styles.header} fixed>
          <View style={styles.tenantBlock}>
            {section.showLogo !== false && (
              <PdfLogoBlock logoDataUrl={ctx.logoDataUrl} />
            )}
            <Text style={styles.tenantName}>{tenant.businessName}</Text>
            <Text style={styles.tenantMeta}>Sri Lanka</Text>
          </View>
          <View style={styles.invoiceHeader}>
            <Text style={styles.invoiceLabel}>Quotation</Text>
            <Text style={styles.invoiceNumber}>
              {quotation.quotationNumber ?? "Draft"}
            </Text>
            {section.showStatusPill !== false && (
              <Text style={styles.statusPill}>{quotation.status}</Text>
            )}
          </View>
        </View>
      );

    case "metaRow": {
      const fields = section.fields ?? [
        "issueDate",
        "validUntil",
        "reference",
        "currency",
      ];
      const cells: Array<{ label: string; value: string | null }> = fields.map(
        (f) => {
          if (f === "issueDate")
            return { label: "Issue date", value: formatDate(quotation.issueDate) };
          if (f === "validUntil")
            return {
              label: "Valid until",
              value: formatDate(quotation.validUntil),
            };
          if (f === "reference")
            return { label: "Reference", value: quotation.reference ?? null };
          if (f === "currency")
            return { label: "Currency", value: quotation.currency };
          if (f === "quotationNumber")
            return {
              label: "Quotation #",
              value: quotation.quotationNumber ?? null,
            };
          return { label: f, value: null };
        },
      );
      return (
        <View key={key} style={styles.metaRow}>
          {cells
            .filter((c) => c.value !== null)
            .map((c, i) => (
              <View key={i} style={styles.metaCell}>
                <Text style={styles.metaLabel}>{c.label}</Text>
                <Text style={styles.metaValue}>{c.value}</Text>
              </View>
            ))}
        </View>
      );
    }

    case "billTo":
      // Quotations use "Prepared for" rather than "Bill to" — same
      // customer block, different label. Templates cloned from a
      // generic library entry shouldn't have to know the difference.
      if (!customer) return null;
      return (
        <View key={key} style={styles.billTo}>
          <Text style={styles.billToLabel}>Prepared for</Text>
          <Text style={styles.billToName}>{customer.name}</Text>
          {customer.addressLine1 && (
            <Text style={styles.billToLine}>{customer.addressLine1}</Text>
          )}
          {customer.city && (
            <Text style={styles.billToLine}>{customer.city}</Text>
          )}
          {customer.email && (
            <Text style={styles.billToLine}>{customer.email}</Text>
          )}
          {customer.vatNo && (
            <Text style={[styles.billToLine, { marginTop: 4, fontSize: 8 }]}>
              VAT: {customer.vatNo}
            </Text>
          )}
        </View>
      );

    case "lineItemsTable":
      return (
        <View key={key} style={styles.table}>
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
                    {formatLKR(l.discountCents, quotation.currency)}
                  </Text>
                )}
              </View>
              <Text style={[styles.colQty, styles.td]}>
                {Number(l.quantity).toLocaleString("en-LK")}
              </Text>
              <Text style={[styles.colUnit, styles.td]}>
                {formatLKR(l.unitPriceCents, quotation.currency)}
              </Text>
              <View style={styles.colTax}>
                <Text style={styles.td}>
                  {l.taxCents > 0
                    ? formatLKR(l.taxCents, quotation.currency)
                    : "—"}
                </Text>
                {l.taxCents > 0 && (
                  <Text style={styles.tdMuted}>
                    {(l.taxRateBps / 100).toFixed(2)}%
                  </Text>
                )}
              </View>
              <Text style={[styles.colTotal, styles.td]}>
                {formatLKR(l.lineTotalCents, quotation.currency)}
              </Text>
            </View>
          ))}
        </View>
      );

    case "totals":
      return (
        <View key={key} style={styles.totalsBlock}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>
              {formatLKR(quotation.subtotalCents, quotation.currency)}
            </Text>
          </View>
          {quotation.discountCents > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Discount</Text>
              <Text style={styles.totalValue}>
                -{formatLKR(quotation.discountCents, quotation.currency)}
              </Text>
            </View>
          )}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Tax</Text>
            <Text style={styles.totalValue}>
              {formatLKR(quotation.taxCents, quotation.currency)}
            </Text>
          </View>
          <View style={styles.totalDivider} />
          <View style={styles.grandTotal}>
            <Text style={styles.grandLabel}>Total</Text>
            <Text style={styles.grandValue}>
              {formatLKR(quotation.totalCents, quotation.currency)}
            </Text>
          </View>
        </View>
      );

    case "validity":
      return (
        <View key={key} style={styles.validity} wrap={false}>
          <Text style={styles.validityLabel}>Validity</Text>
          <Text
            style={
              isExpired
                ? [styles.validityText, styles.validityExpired]
                : styles.validityText
            }
          >
            {isExpired
              ? `This quotation expired on ${formatDate(quotation.validUntil)}. Please request a fresh quote.`
              : `This quotation is valid until ${formatDate(quotation.validUntil)}. Prices and availability may change after that date.`}
          </Text>
        </View>
      );

    case "notes":
      if (!quotation.notes && !quotation.terms) return null;
      return (
        <View key={key} style={styles.notes} wrap={false}>
          {quotation.notes && (
            <>
              <Text style={styles.notesLabel}>Notes</Text>
              <Text style={styles.notesText}>{quotation.notes}</Text>
            </>
          )}
          {quotation.terms && (
            <View style={{ marginTop: quotation.notes ? 14 : 0 }}>
              <Text style={styles.notesLabel}>Terms</Text>
              <Text style={styles.notesText}>{quotation.terms}</Text>
            </View>
          )}
        </View>
      );

    case "footer":
      return (
        <View key={key} style={styles.footer} fixed>
          <Text>
            {section.text ?? "Generated with PettahPro — pettahpro.lk"}
          </Text>
          <Text>{tenant.businessName}</Text>
        </View>
      );

    case "spacer":
      return <View key={key} style={{ height: section.height ?? 12 }} />;

    case "text": {
      const s =
        section.emphasis === "muted"
          ? styles.textMuted
          : section.emphasis === "label"
            ? styles.textLabel
            : styles.text;
      return (
        <Text key={key} style={s}>
          {section.text}
        </Text>
      );
    }

    default:
      return null;
  }
}

export function renderQuotationTemplate(
  layoutRaw: unknown,
  ctx: QuotationContext,
) {
  const layout = parseLayout(layoutRaw);
  const styles = buildQuotationStyles(layout.theme);

  return (
    <Document
      title={ctx.quotation.quotationNumber ?? "Quotation"}
      author={ctx.tenant.businessName}
      creator="PettahPro"
      producer="PettahPro"
    >
      <Page size={pageSizeProp(layout.pageSize)} style={styles.page}>
        {layout.sections.map((section, i) =>
          renderQuotationSection(section, ctx, styles, i),
        )}
      </Page>
    </Document>
  );
}

// -----------------------------------------------------------------
// Credit note context + renderer (M2 #3/10)
//
// CN-specific behaviour: status set (draft/posted/void), reason
// dropdown (return / price_adjustment / discount / goodwill /
// write_off / other) shown in the meta row, "Issued to" label on
// the customer block, an optional linked-invoice badge below the
// meta row, and totals that show "Applied to invoice" / "Standing
// credit" lines once the CN has been applied.
// -----------------------------------------------------------------
const CREDIT_NOTE_REASON_LABELS: Record<CreditNoteReason, string> = {
  return: "Return",
  price_adjustment: "Price adjustment",
  discount: "Discount",
  goodwill: "Goodwill",
  write_off: "Write-off",
  other: "Other",
};

export type CreditNoteContext = {
  docType: "credit_note";
  tenant: Pick<Tenant, "businessName">;
  creditNote: CreditNoteDetail;
  lines: CreditNoteLine[];
  customer: Customer | null;
  invoice: CreditNoteLinkedInvoice | null;
  logoDataUrl?: string | null;
};

export function buildCreditNoteContext(args: {
  tenant: Pick<Tenant, "businessName">;
  creditNote: CreditNoteDetail;
  lines: CreditNoteLine[];
  customer: Customer | null;
  invoice: CreditNoteLinkedInvoice | null;
  logoDataUrl?: string | null;
}): CreditNoteContext {
  return { docType: "credit_note", ...args };
}

function buildCreditNoteStyles(theme: Theme) {
  const base = buildBillStyles(theme); // includes draftBanner
  return StyleSheet.create({
    ...base,
    linkedDocument: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: 6,
      marginBottom: 16,
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: theme.surfaceRecessed,
      borderRadius: 4,
    },
    linkedDocumentLabel: {
      fontSize: 8,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      color: theme.textTertiary,
    },
    linkedDocumentValue: {
      fontSize: 10,
      fontFamily: `${theme.fontFamily}-Bold`,
      color: theme.textPrimary,
    },
  });
}

function renderCreditNoteSection(
  section: Section,
  ctx: CreditNoteContext,
  styles: ReturnType<typeof buildCreditNoteStyles>,
  key: number,
) {
  const { creditNote, lines, customer, invoice, tenant } = ctx;
  const docNumber = creditNote.creditNoteNumber ?? "Draft";
  const unapplied = creditNote.totalCents - creditNote.appliedCents;

  switch (section.type) {
    case "header":
      return (
        <View key={key} style={styles.header} fixed>
          <View style={styles.tenantBlock}>
            {section.showLogo !== false && (
              <PdfLogoBlock logoDataUrl={ctx.logoDataUrl} />
            )}
            <Text style={styles.tenantName}>{tenant.businessName}</Text>
            <Text style={styles.tenantMeta}>Sri Lanka</Text>
          </View>
          <View style={styles.invoiceHeader}>
            <Text style={styles.invoiceLabel}>Credit Note</Text>
            <Text style={styles.invoiceNumber}>{docNumber}</Text>
            {section.showStatusPill !== false && (
              <Text style={styles.statusPill}>{creditNote.status}</Text>
            )}
          </View>
        </View>
      );

    case "draftBanner":
      if (creditNote.status !== "draft") return null;
      return (
        <Text key={key} style={styles.draftBanner}>
          {section.text ?? "Draft — not posted to the ledger"}
        </Text>
      );

    case "metaRow": {
      const fields = section.fields ?? [
        "issueDate",
        "reason",
        "currency",
        "postedAt",
      ];
      const cells: Array<{ label: string; value: string | null }> = fields.map(
        (f) => {
          if (f === "issueDate")
            return {
              label: "Issue date",
              value: formatDate(creditNote.issueDate),
            };
          if (f === "reason")
            return {
              label: "Reason",
              value: CREDIT_NOTE_REASON_LABELS[creditNote.reason] ?? creditNote.reason,
            };
          if (f === "currency")
            return { label: "Currency", value: creditNote.currency };
          if (f === "postedAt")
            return {
              label: "Posted",
              value: creditNote.postedAt
                ? formatDate(creditNote.postedAt.slice(0, 10))
                : null,
            };
          if (f === "creditNoteNumber")
            return {
              label: "Credit note #",
              value: creditNote.creditNoteNumber ?? null,
            };
          return { label: f, value: null };
        },
      );
      return (
        <View key={key} style={styles.metaRow}>
          {cells
            .filter((c) => c.value !== null)
            .map((c, i) => (
              <View key={i} style={styles.metaCell}>
                <Text style={styles.metaLabel}>{c.label}</Text>
                <Text style={styles.metaValue}>{c.value}</Text>
              </View>
            ))}
        </View>
      );
    }

    case "linkedDocument":
      if (!invoice) return null;
      return (
        <View key={key} style={styles.linkedDocument} wrap={false}>
          <Text style={styles.linkedDocumentLabel}>Credit against invoice</Text>
          <Text style={styles.linkedDocumentValue}>
            {invoice.invoiceNumber ?? invoice.id.slice(0, 8)}
          </Text>
        </View>
      );

    case "billTo":
      // Credit notes use "Issued to" rather than "Bill to". Same data.
      if (!customer) return null;
      return (
        <View key={key} style={styles.billTo}>
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
          {customer.city && (
            <Text style={styles.billToLine}>{customer.city}</Text>
          )}
          {customer.email && (
            <Text style={styles.billToLine}>{customer.email}</Text>
          )}
          {customer.phone && (
            <Text style={styles.billToLine}>{customer.phone}</Text>
          )}
          {customer.vatNo && (
            <Text style={[styles.billToLine, { marginTop: 4, fontSize: 8 }]}>
              VAT: {customer.vatNo}
            </Text>
          )}
        </View>
      );

    case "lineItemsTable":
      return (
        <View key={key} style={styles.table}>
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
      );

    case "totals":
      return (
        <View key={key} style={styles.totalsBlock}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>
              {formatLKR(creditNote.subtotalCents)}
            </Text>
          </View>
          {creditNote.discountCents > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Discount</Text>
              <Text style={styles.totalValue}>
                -{formatLKR(creditNote.discountCents)}
              </Text>
            </View>
          )}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Tax</Text>
            <Text style={styles.totalValue}>
              {formatLKR(creditNote.taxCents)}
            </Text>
          </View>
          <View style={styles.totalDivider} />
          <View style={styles.grandTotal}>
            <Text style={styles.grandLabel}>Credit total</Text>
            <Text style={styles.grandValue}>
              {formatLKR(creditNote.totalCents)}
            </Text>
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
                <Text
                  style={[
                    styles.totalLabel,
                    { fontFamily: `${styles.grandLabel.fontFamily}` },
                  ]}
                >
                  {unapplied > 0 ? "Standing credit" : "Fully applied"}
                </Text>
                <Text
                  style={[
                    styles.totalValue,
                    { fontFamily: `${styles.grandLabel.fontFamily}` },
                  ]}
                >
                  {formatLKR(unapplied)}
                </Text>
              </View>
            </>
          )}
        </View>
      );

    case "notes":
      if (!creditNote.notes) return null;
      return (
        <View key={key} style={styles.notes} wrap={false}>
          <Text style={styles.notesLabel}>Notes</Text>
          <Text style={styles.notesText}>{creditNote.notes}</Text>
        </View>
      );

    case "footer":
      return (
        <View key={key} style={styles.footer} fixed>
          <Text>{section.text ?? "Generated with PettahPro — pettahpro.lk"}</Text>
          <Text>{tenant.businessName}</Text>
        </View>
      );

    case "spacer":
      return <View key={key} style={{ height: section.height ?? 12 }} />;

    case "text": {
      const s =
        section.emphasis === "muted"
          ? styles.textMuted
          : section.emphasis === "label"
            ? styles.textLabel
            : styles.text;
      return (
        <Text key={key} style={s}>
          {section.text}
        </Text>
      );
    }

    default:
      return null;
  }
}

export function renderCreditNoteTemplate(
  layoutRaw: unknown,
  ctx: CreditNoteContext,
) {
  const layout = parseLayout(layoutRaw);
  const styles = buildCreditNoteStyles(layout.theme);

  return (
    <Document
      title={ctx.creditNote.creditNoteNumber ?? "Credit note"}
      author={ctx.tenant.businessName}
      creator="PettahPro"
      producer="PettahPro"
    >
      <Page size={pageSizeProp(layout.pageSize)} style={styles.page}>
        {layout.sections.map((section, i) =>
          renderCreditNoteSection(section, ctx, styles, i),
        )}
      </Page>
    </Document>
  );
}

// -----------------------------------------------------------------
// Debit note context + renderer (M2 #4/10)
//
// AP-side counterpart to credit notes. Differs in three places:
// supplier (not customer), bill (not invoice) for the linkedDocument
// badge, and a different reason set ("shortage" instead of
// "write_off"). billFrom shows "Issued to" — the doc is *issued by*
// the tenant *to* the supplier as a debit.
// -----------------------------------------------------------------
const DEBIT_NOTE_REASON_LABELS: Record<DebitNoteReason, string> = {
  return: "Return",
  price_adjustment: "Price adjustment",
  discount: "Discount",
  goodwill: "Goodwill",
  shortage: "Shortage",
  other: "Other",
};

export type DebitNoteContext = {
  docType: "debit_note";
  tenant: Pick<Tenant, "businessName">;
  debitNote: DebitNoteDetail;
  lines: DebitNoteLine[];
  supplier: Supplier | null;
  bill: DebitNoteLinkedBill | null;
  logoDataUrl?: string | null;
};

export function buildDebitNoteContext(args: {
  tenant: Pick<Tenant, "businessName">;
  debitNote: DebitNoteDetail;
  lines: DebitNoteLine[];
  supplier: Supplier | null;
  bill: DebitNoteLinkedBill | null;
  logoDataUrl?: string | null;
}): DebitNoteContext {
  return { docType: "debit_note", ...args };
}

function buildDebitNoteStyles(theme: Theme) {
  // Reuse credit-note styles — same draftBanner, linkedDocument shape.
  return buildCreditNoteStyles(theme);
}

function renderDebitNoteSection(
  section: Section,
  ctx: DebitNoteContext,
  styles: ReturnType<typeof buildDebitNoteStyles>,
  key: number,
) {
  const { debitNote, lines, supplier, bill, tenant } = ctx;
  const docNumber = debitNote.internalReference ?? "Draft";
  const unapplied = debitNote.totalCents - debitNote.appliedCents;

  switch (section.type) {
    case "header":
      return (
        <View key={key} style={styles.header} fixed>
          <View style={styles.tenantBlock}>
            {section.showLogo !== false && (
              <PdfLogoBlock logoDataUrl={ctx.logoDataUrl} />
            )}
            <Text style={styles.tenantName}>{tenant.businessName}</Text>
            <Text style={styles.tenantMeta}>Sri Lanka</Text>
          </View>
          <View style={styles.invoiceHeader}>
            <Text style={styles.invoiceLabel}>Debit Note</Text>
            <Text style={styles.invoiceNumber}>{docNumber}</Text>
            {section.showStatusPill !== false && (
              <Text style={styles.statusPill}>{debitNote.status}</Text>
            )}
          </View>
        </View>
      );

    case "draftBanner":
      if (debitNote.status !== "draft") return null;
      return (
        <Text key={key} style={styles.draftBanner}>
          {section.text ?? "Draft — not posted to the ledger"}
        </Text>
      );

    case "metaRow": {
      const fields = section.fields ?? [
        "issueDate",
        "reason",
        "currency",
        "supplierDebitNumber",
        "postedAt",
      ];
      const cells: Array<{ label: string; value: string | null }> = fields.map(
        (f) => {
          if (f === "issueDate")
            return {
              label: "Issue date",
              value: formatDate(debitNote.issueDate),
            };
          if (f === "reason")
            return {
              label: "Reason",
              value:
                DEBIT_NOTE_REASON_LABELS[debitNote.reason] ?? debitNote.reason,
            };
          if (f === "currency")
            return { label: "Currency", value: debitNote.currency };
          if (f === "supplierDebitNumber")
            return {
              label: "Supplier ref",
              value: debitNote.supplierDebitNumber ?? null,
            };
          if (f === "postedAt")
            return {
              label: "Posted",
              value: debitNote.postedAt
                ? formatDate(debitNote.postedAt.slice(0, 10))
                : null,
            };
          if (f === "internalReference")
            return {
              label: "Debit note #",
              value: debitNote.internalReference ?? null,
            };
          return { label: f, value: null };
        },
      );
      return (
        <View key={key} style={styles.metaRow}>
          {cells
            .filter((c) => c.value !== null)
            .map((c, i) => (
              <View key={i} style={styles.metaCell}>
                <Text style={styles.metaLabel}>{c.label}</Text>
                <Text style={styles.metaValue}>{c.value}</Text>
              </View>
            ))}
        </View>
      );
    }

    case "linkedDocument":
      if (!bill) return null;
      return (
        <View key={key} style={styles.linkedDocument} wrap={false}>
          <Text style={styles.linkedDocumentLabel}>Debit against bill</Text>
          <Text style={styles.linkedDocumentValue}>
            {bill.internalReference ??
              bill.supplierBillNumber ??
              bill.id.slice(0, 8)}
          </Text>
        </View>
      );

    case "billFrom":
      // Debit notes are issued *to* the supplier, so the supplier
      // block reads "Issued to" rather than "Billed from".
      if (!supplier) return null;
      return (
        <View key={key} style={styles.billFrom}>
          <Text style={styles.billFromLabel}>Issued to</Text>
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
          {supplier.city && (
            <Text style={styles.billFromLine}>{supplier.city}</Text>
          )}
          {supplier.email && (
            <Text style={styles.billFromLine}>{supplier.email}</Text>
          )}
          {supplier.phone && (
            <Text style={styles.billFromLine}>{supplier.phone}</Text>
          )}
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
      );

    case "billTo":
      return renderDebitNoteSection({ type: "billFrom" }, ctx, styles, key);

    case "lineItemsTable":
      return (
        <View key={key} style={styles.table}>
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
      );

    case "totals":
      return (
        <View key={key} style={styles.totalsBlock}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>
              {formatLKR(debitNote.subtotalCents)}
            </Text>
          </View>
          {debitNote.discountCents > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Discount</Text>
              <Text style={styles.totalValue}>
                -{formatLKR(debitNote.discountCents)}
              </Text>
            </View>
          )}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Tax</Text>
            <Text style={styles.totalValue}>
              {formatLKR(debitNote.taxCents)}
            </Text>
          </View>
          <View style={styles.totalDivider} />
          <View style={styles.grandTotal}>
            <Text style={styles.grandLabel}>Debit total</Text>
            <Text style={styles.grandValue}>
              {formatLKR(debitNote.totalCents)}
            </Text>
          </View>
          {debitNote.status === "posted" && debitNote.appliedCents > 0 && (
            <>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Applied to bill</Text>
                <Text style={styles.totalValue}>
                  {formatLKR(debitNote.appliedCents)}
                </Text>
              </View>
              <View style={styles.totalRow}>
                <Text
                  style={[
                    styles.totalLabel,
                    { fontFamily: `${styles.grandLabel.fontFamily}` },
                  ]}
                >
                  {unapplied > 0 ? "Standing debit" : "Fully applied"}
                </Text>
                <Text
                  style={[
                    styles.totalValue,
                    { fontFamily: `${styles.grandLabel.fontFamily}` },
                  ]}
                >
                  {formatLKR(unapplied)}
                </Text>
              </View>
            </>
          )}
        </View>
      );

    case "notes":
      if (!debitNote.notes) return null;
      return (
        <View key={key} style={styles.notes} wrap={false}>
          <Text style={styles.notesLabel}>Notes</Text>
          <Text style={styles.notesText}>{debitNote.notes}</Text>
        </View>
      );

    case "footer":
      return (
        <View key={key} style={styles.footer} fixed>
          <Text>{section.text ?? "Generated with PettahPro — pettahpro.lk"}</Text>
          <Text>{tenant.businessName}</Text>
        </View>
      );

    case "spacer":
      return <View key={key} style={{ height: section.height ?? 12 }} />;

    case "text": {
      const s =
        section.emphasis === "muted"
          ? styles.textMuted
          : section.emphasis === "label"
            ? styles.textLabel
            : styles.text;
      return (
        <Text key={key} style={s}>
          {section.text}
        </Text>
      );
    }

    default:
      return null;
  }
}

export function renderDebitNoteTemplate(
  layoutRaw: unknown,
  ctx: DebitNoteContext,
) {
  const layout = parseLayout(layoutRaw);
  const styles = buildDebitNoteStyles(layout.theme);

  return (
    <Document
      title={ctx.debitNote.internalReference ?? "Debit note"}
      author={ctx.tenant.businessName}
      creator="PettahPro"
      producer="PettahPro"
    >
      <Page size={pageSizeProp(layout.pageSize)} style={styles.page}>
        {layout.sections.map((section, i) =>
          renderDebitNoteSection(section, ctx, styles, i),
        )}
      </Page>
    </Document>
  );
}

// -----------------------------------------------------------------
// Delivery note context + renderer (M2 #5/10)
//
// DN-specific behaviour: logistics doc — no money. Sections are
// header / metaRow / partiesRow (deliver-to + shipping address) /
// lineItemsTable (qty-only, no prices) / notes / signBlock /
// footer. Mirrors apps/web/lib/delivery-note-pdf.tsx.
// -----------------------------------------------------------------
export type DeliveryNoteContext = {
  docType: "delivery_note";
  tenant: Pick<Tenant, "businessName">;
  deliveryNote: DeliveryNoteDetail;
  lines: DeliveryNoteLine[];
  customer: Customer | null;
  logoDataUrl?: string | null;
};

export function buildDeliveryNoteContext(args: {
  tenant: Pick<Tenant, "businessName">;
  deliveryNote: DeliveryNoteDetail;
  lines: DeliveryNoteLine[];
  customer: Customer | null;
  logoDataUrl?: string | null;
}): DeliveryNoteContext {
  return { docType: "delivery_note", ...args };
}

function buildDeliveryNoteStyles(theme: Theme) {
  const base = buildInvoiceStyles(theme);
  return StyleSheet.create({
    ...base,
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
      color: theme.textTertiary,
      marginBottom: 6,
    },
    partyName: { fontSize: 12, fontFamily: `${theme.fontFamily}-Bold` },
    partyLine: { color: theme.textSecondary, marginTop: 2 },

    dnTable: {
      borderTop: `0.5pt solid ${theme.borderColor}`,
      marginBottom: 24,
    },
    dnColQty: { width: 100, textAlign: "right" },

    signBlock: {
      marginTop: 40,
      flexDirection: "row",
      gap: 40,
    },
    signCol: { flex: 1 },
    signLine: {
      borderTop: `0.5pt solid ${theme.textPrimary}`,
      marginTop: 48,
      paddingTop: 6,
    },
    signLabel: {
      fontSize: 9,
      color: theme.textTertiary,
    },
    signName: { fontSize: 10, color: theme.textPrimary, marginTop: 2 },
  });
}

function formatQty(n: string | number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("en-LK", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

function renderDeliveryNoteSection(
  section: Section,
  ctx: DeliveryNoteContext,
  styles: ReturnType<typeof buildDeliveryNoteStyles>,
  key: number,
) {
  const { deliveryNote, lines, customer, tenant } = ctx;
  const docNumber = deliveryNote.dnNumber ?? "Draft";

  switch (section.type) {
    case "header":
      return (
        <View key={key} style={styles.header} fixed>
          <View style={styles.tenantBlock}>
            {section.showLogo !== false && (
              <PdfLogoBlock logoDataUrl={ctx.logoDataUrl} />
            )}
            <Text style={styles.tenantName}>{tenant.businessName}</Text>
            <Text style={styles.tenantMeta}>Sri Lanka</Text>
          </View>
          <View style={styles.invoiceHeader}>
            <Text style={styles.invoiceLabel}>Delivery note</Text>
            <Text style={styles.invoiceNumber}>{docNumber}</Text>
            {section.showStatusPill !== false && (
              <Text style={styles.statusPill}>{deliveryNote.status}</Text>
            )}
          </View>
        </View>
      );

    case "metaRow": {
      const fields = section.fields ?? [
        "deliveryDate",
        "carrier",
        "trackingNumber",
        "deliveredAt",
      ];
      const cells: Array<{ label: string; value: string | null }> = fields.map(
        (f) => {
          if (f === "deliveryDate")
            return {
              label: "Delivery date",
              value: formatDate(deliveryNote.deliveryDate),
            };
          if (f === "carrier")
            return { label: "Carrier", value: deliveryNote.carrier ?? null };
          if (f === "trackingNumber")
            return {
              label: "Tracking #",
              value: deliveryNote.trackingNumber ?? null,
            };
          if (f === "deliveredAt")
            return {
              label: "Delivered",
              value: deliveryNote.deliveredAt
                ? formatDate(deliveryNote.deliveredAt.slice(0, 10))
                : null,
            };
          if (f === "dnNumber")
            return {
              label: "Delivery note #",
              value: deliveryNote.dnNumber ?? null,
            };
          return { label: f, value: null };
        },
      );
      return (
        <View key={key} style={styles.metaRow}>
          {cells
            .filter((c) => c.value !== null)
            .map((c, i) => (
              <View key={i} style={styles.metaCell}>
                <Text style={styles.metaLabel}>{c.label}</Text>
                <Text style={styles.metaValue}>{c.value}</Text>
              </View>
            ))}
        </View>
      );
    }

    case "partiesRow": {
      const shipAddress = [
        deliveryNote.shippingAddressLine1,
        deliveryNote.shippingAddressLine2,
        deliveryNote.shippingCity,
        deliveryNote.shippingPostalCode,
      ].filter((l): l is string => Boolean(l));
      if (!customer && shipAddress.length === 0) return null;
      return (
        <View key={key} style={styles.partiesRow}>
          {customer && (
            <View style={styles.partyCol}>
              <Text style={styles.partyLabel}>Deliver to</Text>
              <Text style={styles.partyName}>{customer.name}</Text>
              {customer.addressLine1 && (
                <Text style={styles.partyLine}>{customer.addressLine1}</Text>
              )}
              {customer.addressLine2 && (
                <Text style={styles.partyLine}>{customer.addressLine2}</Text>
              )}
              {customer.city && (
                <Text style={styles.partyLine}>{customer.city}</Text>
              )}
              {customer.phone && (
                <Text style={styles.partyLine}>{customer.phone}</Text>
              )}
            </View>
          )}
          {shipAddress.length > 0 && (
            <View style={styles.partyCol}>
              <Text style={styles.partyLabel}>Shipping address</Text>
              {shipAddress.map((line, i) => (
                <Text key={i} style={styles.partyLine}>
                  {line}
                </Text>
              ))}
            </View>
          )}
        </View>
      );
    }

    // billTo on a delivery note falls through to the partiesRow so a
    // template cloned from a generic library entry doesn't render an
    // empty block.
    case "billTo":
      return renderDeliveryNoteSection(
        { type: "partiesRow" },
        ctx,
        styles,
        key,
      );

    case "lineItemsTable":
      return (
        <View key={key} style={styles.dnTable}>
          <View style={[styles.row, styles.rowHeader]}>
            <Text style={[styles.colNum, styles.th]}>#</Text>
            <Text style={[styles.colDesc, styles.th]}>Description</Text>
            <Text style={[styles.dnColQty, styles.th]}>Qty delivered</Text>
          </View>
          {lines.map((l) => (
            <View key={l.id} style={styles.row} wrap={false}>
              <Text style={[styles.colNum, styles.td]}>{l.lineNo}</Text>
              <Text style={[styles.colDesc, styles.td]}>{l.description}</Text>
              <Text style={[styles.dnColQty, styles.td]}>
                {formatQty(l.quantity)}
              </Text>
            </View>
          ))}
        </View>
      );

    case "notes":
      if (!deliveryNote.notes) return null;
      return (
        <View key={key} style={styles.notes} wrap={false}>
          <Text style={styles.notesLabel}>Notes</Text>
          <Text style={styles.notesText}>{deliveryNote.notes}</Text>
        </View>
      );

    case "signBlock":
      return (
        <View key={key} style={styles.signBlock} wrap={false}>
          <View style={styles.signCol}>
            <View style={styles.signLine}>
              <Text style={styles.signLabel}>
                Delivered by (name &amp; signature)
              </Text>
            </View>
          </View>
          <View style={styles.signCol}>
            <View style={styles.signLine}>
              <Text style={styles.signLabel}>
                Received by (name &amp; signature)
              </Text>
              {deliveryNote.receivedByName && (
                <Text style={styles.signName}>
                  {deliveryNote.receivedByName}
                </Text>
              )}
            </View>
          </View>
        </View>
      );

    case "footer":
      return (
        <View key={key} style={styles.footer} fixed>
          <Text>{section.text ?? "Generated with PettahPro — pettahpro.lk"}</Text>
          <Text>{tenant.businessName}</Text>
        </View>
      );

    case "spacer":
      return <View key={key} style={{ height: section.height ?? 12 }} />;

    case "text": {
      const s =
        section.emphasis === "muted"
          ? styles.textMuted
          : section.emphasis === "label"
            ? styles.textLabel
            : styles.text;
      return (
        <Text key={key} style={s}>
          {section.text}
        </Text>
      );
    }

    default:
      return null;
  }
}

export function renderDeliveryNoteTemplate(
  layoutRaw: unknown,
  ctx: DeliveryNoteContext,
) {
  const layout = parseLayout(layoutRaw);
  const styles = buildDeliveryNoteStyles(layout.theme);

  return (
    <Document
      title={ctx.deliveryNote.dnNumber ?? "Delivery note"}
      author={ctx.tenant.businessName}
      creator="PettahPro"
      producer="PettahPro"
    >
      <Page size={pageSizeProp(layout.pageSize)} style={styles.page}>
        {layout.sections.map((section, i) =>
          renderDeliveryNoteSection(section, ctx, styles, i),
        )}
      </Page>
    </Document>
  );
}

// -----------------------------------------------------------------
// Proforma invoice context + renderer (M2 #6/10)
//
// Pre-sale doc — same shape as a quotation (validity callout,
// "Prepared for") with an italic "this is not a tax invoice"
// disclaimer at the bottom. Status set: draft / sent / converted /
// cancelled. Mirrors apps/web/lib/proforma-pdf.tsx.
// -----------------------------------------------------------------
export type ProformaInvoiceContext = {
  docType: "proforma_invoice";
  tenant: Pick<Tenant, "businessName">;
  proformaInvoice: ProformaInvoiceDetail;
  lines: ProformaInvoiceLine[];
  customer: Customer | null;
  logoDataUrl?: string | null;
};

export function buildProformaInvoiceContext(args: {
  tenant: Pick<Tenant, "businessName">;
  proformaInvoice: ProformaInvoiceDetail;
  lines: ProformaInvoiceLine[];
  customer: Customer | null;
  logoDataUrl?: string | null;
}): ProformaInvoiceContext {
  return { docType: "proforma_invoice", ...args };
}

function buildProformaInvoiceStyles(theme: Theme) {
  const base = buildInvoiceStyles(theme);
  return StyleSheet.create({
    ...base,
    validity: {
      marginTop: 12,
      padding: 10,
      backgroundColor: theme.surfaceRecessed,
      borderRadius: 4,
    },
    validityLabel: {
      fontSize: 8,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      color: theme.textTertiary,
      marginBottom: 4,
    },
    validityText: { color: theme.textPrimary, fontSize: 10 },
    validityExpired: { color: "#B47A15" },
    disclaimer: {
      marginTop: 10,
      padding: 10,
      borderLeft: `2pt solid ${theme.accentColor}`,
      backgroundColor: "#FAF7EF",
    },
    disclaimerText: {
      fontSize: 9,
      color: theme.textSecondary,
      lineHeight: 1.5,
    },
  });
}

function renderProformaInvoiceSection(
  section: Section,
  ctx: ProformaInvoiceContext,
  styles: ReturnType<typeof buildProformaInvoiceStyles>,
  key: number,
) {
  const { proformaInvoice, lines, customer, tenant } = ctx;
  const today = new Date().toISOString().slice(0, 10);
  const isExpired =
    proformaInvoice.status !== "converted" &&
    proformaInvoice.status !== "cancelled" &&
    proformaInvoice.validUntil < today;

  switch (section.type) {
    case "header":
      return (
        <View key={key} style={styles.header} fixed>
          <View style={styles.tenantBlock}>
            {section.showLogo !== false && (
              <PdfLogoBlock logoDataUrl={ctx.logoDataUrl} />
            )}
            <Text style={styles.tenantName}>{tenant.businessName}</Text>
            <Text style={styles.tenantMeta}>Sri Lanka</Text>
          </View>
          <View style={styles.invoiceHeader}>
            <Text style={styles.invoiceLabel}>Proforma invoice</Text>
            <Text style={styles.invoiceNumber}>
              {proformaInvoice.proformaNumber ?? "Draft"}
            </Text>
            {section.showStatusPill !== false && (
              <Text style={styles.statusPill}>{proformaInvoice.status}</Text>
            )}
          </View>
        </View>
      );

    case "metaRow": {
      const fields = section.fields ?? [
        "issueDate",
        "validUntil",
        "reference",
        "currency",
      ];
      const cells: Array<{ label: string; value: string | null }> = fields.map(
        (f) => {
          if (f === "issueDate")
            return {
              label: "Issue date",
              value: formatDate(proformaInvoice.issueDate),
            };
          if (f === "validUntil")
            return {
              label: "Valid until",
              value: formatDate(proformaInvoice.validUntil),
            };
          if (f === "reference")
            return {
              label: "Reference",
              value: proformaInvoice.reference ?? null,
            };
          if (f === "currency")
            return { label: "Currency", value: proformaInvoice.currency };
          if (f === "proformaNumber")
            return {
              label: "Proforma #",
              value: proformaInvoice.proformaNumber ?? null,
            };
          return { label: f, value: null };
        },
      );
      return (
        <View key={key} style={styles.metaRow}>
          {cells
            .filter((c) => c.value !== null)
            .map((c, i) => (
              <View key={i} style={styles.metaCell}>
                <Text style={styles.metaLabel}>{c.label}</Text>
                <Text style={styles.metaValue}>{c.value}</Text>
              </View>
            ))}
        </View>
      );
    }

    case "billTo":
      // "Prepared for" framing — same customer block as quotation.
      if (!customer) return null;
      return (
        <View key={key} style={styles.billTo}>
          <Text style={styles.billToLabel}>Prepared for</Text>
          <Text style={styles.billToName}>{customer.name}</Text>
          {customer.addressLine1 && (
            <Text style={styles.billToLine}>{customer.addressLine1}</Text>
          )}
          {customer.city && (
            <Text style={styles.billToLine}>{customer.city}</Text>
          )}
          {customer.email && (
            <Text style={styles.billToLine}>{customer.email}</Text>
          )}
          {customer.vatNo && (
            <Text style={[styles.billToLine, { marginTop: 4, fontSize: 8 }]}>
              VAT: {customer.vatNo}
            </Text>
          )}
        </View>
      );

    case "lineItemsTable":
      return (
        <View key={key} style={styles.table}>
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
                    {formatLKR(l.discountCents, proformaInvoice.currency)}
                  </Text>
                )}
              </View>
              <Text style={[styles.colQty, styles.td]}>
                {Number(l.quantity).toLocaleString("en-LK")}
              </Text>
              <Text style={[styles.colUnit, styles.td]}>
                {formatLKR(l.unitPriceCents, proformaInvoice.currency)}
              </Text>
              <View style={styles.colTax}>
                <Text style={styles.td}>
                  {l.taxCents > 0
                    ? formatLKR(l.taxCents, proformaInvoice.currency)
                    : "—"}
                </Text>
                {l.taxCents > 0 && (
                  <Text style={styles.tdMuted}>
                    {(l.taxRateBps / 100).toFixed(2)}%
                  </Text>
                )}
              </View>
              <Text style={[styles.colTotal, styles.td]}>
                {formatLKR(l.lineTotalCents, proformaInvoice.currency)}
              </Text>
            </View>
          ))}
        </View>
      );

    case "totals":
      return (
        <View key={key} style={styles.totalsBlock}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>
              {formatLKR(
                proformaInvoice.subtotalCents,
                proformaInvoice.currency,
              )}
            </Text>
          </View>
          {proformaInvoice.discountCents > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Discount</Text>
              <Text style={styles.totalValue}>
                -
                {formatLKR(
                  proformaInvoice.discountCents,
                  proformaInvoice.currency,
                )}
              </Text>
            </View>
          )}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Tax</Text>
            <Text style={styles.totalValue}>
              {formatLKR(proformaInvoice.taxCents, proformaInvoice.currency)}
            </Text>
          </View>
          <View style={styles.totalDivider} />
          <View style={styles.grandTotal}>
            <Text style={styles.grandLabel}>Total</Text>
            <Text style={styles.grandValue}>
              {formatLKR(proformaInvoice.totalCents, proformaInvoice.currency)}
            </Text>
          </View>
        </View>
      );

    case "validity":
      return (
        <View key={key} style={styles.validity} wrap={false}>
          <Text style={styles.validityLabel}>Validity</Text>
          <Text
            style={
              isExpired
                ? [styles.validityText, styles.validityExpired]
                : styles.validityText
            }
          >
            {isExpired
              ? `This proforma expired on ${formatDate(proformaInvoice.validUntil)}. Please request a fresh proforma.`
              : `This proforma is valid until ${formatDate(proformaInvoice.validUntil)}. Prices and availability may change after that date.`}
          </Text>
        </View>
      );

    case "disclaimer":
      return (
        <View key={key} style={styles.disclaimer} wrap={false}>
          <Text style={styles.disclaimerText}>
            This is a proforma invoice issued for advance payment, customs, or
            letter-of-credit purposes. It is not a tax invoice. A final VAT
            invoice will be issued on supply.
          </Text>
        </View>
      );

    case "notes":
      if (!proformaInvoice.notes && !proformaInvoice.terms) return null;
      return (
        <View key={key} style={styles.notes} wrap={false}>
          {proformaInvoice.notes && (
            <>
              <Text style={styles.notesLabel}>Notes</Text>
              <Text style={styles.notesText}>{proformaInvoice.notes}</Text>
            </>
          )}
          {proformaInvoice.terms && (
            <View style={{ marginTop: proformaInvoice.notes ? 14 : 0 }}>
              <Text style={styles.notesLabel}>Terms</Text>
              <Text style={styles.notesText}>{proformaInvoice.terms}</Text>
            </View>
          )}
        </View>
      );

    case "footer":
      return (
        <View key={key} style={styles.footer} fixed>
          <Text>{section.text ?? "Generated with PettahPro — pettahpro.lk"}</Text>
          <Text>{tenant.businessName}</Text>
        </View>
      );

    case "spacer":
      return <View key={key} style={{ height: section.height ?? 12 }} />;

    case "text": {
      const s =
        section.emphasis === "muted"
          ? styles.textMuted
          : section.emphasis === "label"
            ? styles.textLabel
            : styles.text;
      return (
        <Text key={key} style={s}>
          {section.text}
        </Text>
      );
    }

    default:
      return null;
  }
}

export function renderProformaInvoiceTemplate(
  layoutRaw: unknown,
  ctx: ProformaInvoiceContext,
) {
  const layout = parseLayout(layoutRaw);
  const styles = buildProformaInvoiceStyles(layout.theme);

  return (
    <Document
      title={ctx.proformaInvoice.proformaNumber ?? "Proforma invoice"}
      author={ctx.tenant.businessName}
      creator="PettahPro"
      producer="PettahPro"
    >
      <Page size={pageSizeProp(layout.pageSize)} style={styles.page}>
        {layout.sections.map((section, i) =>
          renderProformaInvoiceSection(section, ctx, styles, i),
        )}
      </Page>
    </Document>
  );
}

// -----------------------------------------------------------------
// Purchase order context + renderer (M2 #7/10)
//
// Buyer-issued order with supplier block ("billFrom"), priced line
// items, totals, and a "Supplier instructions" callout. Status set
// covers the full PO lifecycle (draft / pending_approval / sent /
// acknowledged / converted / cancelled). Mirrors
// apps/web/lib/purchase-order-pdf.tsx.
// -----------------------------------------------------------------
export type PurchaseOrderContext = {
  docType: "purchase_order";
  tenant: Pick<Tenant, "businessName">;
  purchaseOrder: PurchaseOrderDetail;
  lines: PurchaseOrderLine[];
  supplier: Supplier | null;
  logoDataUrl?: string | null;
};

export function buildPurchaseOrderContext(args: {
  tenant: Pick<Tenant, "businessName">;
  purchaseOrder: PurchaseOrderDetail;
  lines: PurchaseOrderLine[];
  supplier: Supplier | null;
  logoDataUrl?: string | null;
}): PurchaseOrderContext {
  return { docType: "purchase_order", ...args };
}

function buildPurchaseOrderStyles(theme: Theme) {
  // Reuse bill styles for billFrom + draftBanner shapes; layer the
  // PO-only "Supplier instructions" callout on top.
  const base = buildBillStyles(theme);
  return StyleSheet.create({
    ...base,
    instructions: {
      marginTop: 12,
      padding: 10,
      backgroundColor: theme.surfaceRecessed,
      borderRadius: 4,
    },
    instructionsLabel: {
      fontSize: 8,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      color: theme.textTertiary,
      marginBottom: 4,
    },
    instructionsText: { color: theme.textPrimary, fontSize: 10 },
    instructionsBold: {
      fontFamily: `${theme.fontFamily}-Bold`,
    },
  });
}

function renderPurchaseOrderSection(
  section: Section,
  ctx: PurchaseOrderContext,
  styles: ReturnType<typeof buildPurchaseOrderStyles>,
  key: number,
) {
  const { purchaseOrder, lines, supplier, tenant } = ctx;

  switch (section.type) {
    case "header":
      return (
        <View key={key} style={styles.header} fixed>
          <View style={styles.tenantBlock}>
            {section.showLogo !== false && (
              <PdfLogoBlock logoDataUrl={ctx.logoDataUrl} />
            )}
            <Text style={styles.tenantName}>{tenant.businessName}</Text>
            <Text style={styles.tenantMeta}>Sri Lanka</Text>
          </View>
          <View style={styles.invoiceHeader}>
            <Text style={styles.invoiceLabel}>Purchase order</Text>
            <Text style={styles.invoiceNumber}>
              {purchaseOrder.poNumber ?? "Draft"}
            </Text>
            {section.showStatusPill !== false && (
              <Text style={styles.statusPill}>{purchaseOrder.status}</Text>
            )}
          </View>
        </View>
      );

    case "metaRow": {
      const fields = section.fields ?? [
        "orderDate",
        "expectedDeliveryDate",
        "reference",
        "currency",
      ];
      const cells: Array<{ label: string; value: string | null }> = fields.map(
        (f) => {
          if (f === "orderDate")
            return {
              label: "Order date",
              value: formatDate(purchaseOrder.orderDate),
            };
          if (f === "expectedDeliveryDate")
            return {
              label: "Expected delivery",
              value: purchaseOrder.expectedDeliveryDate
                ? formatDate(purchaseOrder.expectedDeliveryDate)
                : null,
            };
          if (f === "reference")
            return {
              label: "Reference",
              value: purchaseOrder.reference ?? null,
            };
          if (f === "currency")
            return { label: "Currency", value: purchaseOrder.currency };
          if (f === "supplierReference")
            return {
              label: "Supplier ref",
              value: purchaseOrder.supplierReference ?? null,
            };
          if (f === "poNumber")
            return {
              label: "PO #",
              value: purchaseOrder.poNumber ?? null,
            };
          return { label: f, value: null };
        },
      );
      return (
        <View key={key} style={styles.metaRow}>
          {cells
            .filter((c) => c.value !== null)
            .map((c, i) => (
              <View key={i} style={styles.metaCell}>
                <Text style={styles.metaLabel}>{c.label}</Text>
                <Text style={styles.metaValue}>{c.value}</Text>
              </View>
            ))}
        </View>
      );
    }

    case "billFrom":
      // POs ship *to* the supplier, so the supplier block reads
      // "Supplier" rather than "Billed from".
      if (!supplier) return null;
      return (
        <View key={key} style={styles.billFrom}>
          <Text style={styles.billFromLabel}>Supplier</Text>
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
          {supplier.city && (
            <Text style={styles.billFromLine}>{supplier.city}</Text>
          )}
          {supplier.email && (
            <Text style={styles.billFromLine}>{supplier.email}</Text>
          )}
          {supplier.phone && (
            <Text style={styles.billFromLine}>{supplier.phone}</Text>
          )}
          {supplier.vatNo && (
            <Text style={[styles.billFromLine, { marginTop: 4, fontSize: 8 }]}>
              VAT: {supplier.vatNo}
            </Text>
          )}
        </View>
      );

    case "billTo":
      return renderPurchaseOrderSection(
        { type: "billFrom" },
        ctx,
        styles,
        key,
      );

    case "lineItemsTable":
      return (
        <View key={key} style={styles.table}>
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
                    {formatLKR(l.discountCents, purchaseOrder.currency)}
                  </Text>
                )}
              </View>
              <Text style={[styles.colQty, styles.td]}>
                {Number(l.quantity).toLocaleString("en-LK")}
              </Text>
              <Text style={[styles.colUnit, styles.td]}>
                {formatLKR(l.unitPriceCents, purchaseOrder.currency)}
              </Text>
              <View style={styles.colTax}>
                <Text style={styles.td}>
                  {l.taxCents > 0
                    ? formatLKR(l.taxCents, purchaseOrder.currency)
                    : "—"}
                </Text>
                {l.taxCents > 0 && (
                  <Text style={styles.tdMuted}>
                    {(l.taxRateBps / 100).toFixed(2)}%
                  </Text>
                )}
              </View>
              <Text style={[styles.colTotal, styles.td]}>
                {formatLKR(l.lineTotalCents, purchaseOrder.currency)}
              </Text>
            </View>
          ))}
        </View>
      );

    case "totals":
      return (
        <View key={key} style={styles.totalsBlock}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>
              {formatLKR(
                purchaseOrder.subtotalCents,
                purchaseOrder.currency,
              )}
            </Text>
          </View>
          {purchaseOrder.discountCents > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Discount</Text>
              <Text style={styles.totalValue}>
                -
                {formatLKR(
                  purchaseOrder.discountCents,
                  purchaseOrder.currency,
                )}
              </Text>
            </View>
          )}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Tax</Text>
            <Text style={styles.totalValue}>
              {formatLKR(purchaseOrder.taxCents, purchaseOrder.currency)}
            </Text>
          </View>
          <View style={styles.totalDivider} />
          <View style={styles.grandTotal}>
            <Text style={styles.grandLabel}>Order total</Text>
            <Text style={styles.grandValue}>
              {formatLKR(purchaseOrder.totalCents, purchaseOrder.currency)}
            </Text>
          </View>
        </View>
      );

    case "instructions":
      return (
        <View key={key} style={styles.instructions} wrap={false}>
          <Text style={styles.instructionsLabel}>Supplier instructions</Text>
          <Text style={styles.instructionsText}>
            Please quote PO number{" "}
            <Text style={styles.instructionsBold}>
              {purchaseOrder.poNumber ?? "—"}
            </Text>{" "}
            on your invoice and delivery note. Partial shipments must be agreed
            with the buyer in advance.
          </Text>
        </View>
      );

    case "notes":
      if (!purchaseOrder.notes && !purchaseOrder.terms) return null;
      return (
        <View key={key} style={styles.notes} wrap={false}>
          {purchaseOrder.notes && (
            <>
              <Text style={styles.notesLabel}>Notes</Text>
              <Text style={styles.notesText}>{purchaseOrder.notes}</Text>
            </>
          )}
          {purchaseOrder.terms && (
            <View style={{ marginTop: purchaseOrder.notes ? 14 : 0 }}>
              <Text style={styles.notesLabel}>Terms</Text>
              <Text style={styles.notesText}>{purchaseOrder.terms}</Text>
            </View>
          )}
        </View>
      );

    case "footer":
      return (
        <View key={key} style={styles.footer} fixed>
          <Text>{section.text ?? "Generated with PettahPro — pettahpro.lk"}</Text>
          <Text>{tenant.businessName}</Text>
        </View>
      );

    case "spacer":
      return <View key={key} style={{ height: section.height ?? 12 }} />;

    case "text": {
      const s =
        section.emphasis === "muted"
          ? styles.textMuted
          : section.emphasis === "label"
            ? styles.textLabel
            : styles.text;
      return (
        <Text key={key} style={s}>
          {section.text}
        </Text>
      );
    }

    default:
      return null;
  }
}

export function renderPurchaseOrderTemplate(
  layoutRaw: unknown,
  ctx: PurchaseOrderContext,
) {
  const layout = parseLayout(layoutRaw);
  const styles = buildPurchaseOrderStyles(layout.theme);

  return (
    <Document
      title={ctx.purchaseOrder.poNumber ?? "Purchase order"}
      author={ctx.tenant.businessName}
      creator="PettahPro"
      producer="PettahPro"
    >
      <Page size={pageSizeProp(layout.pageSize)} style={styles.page}>
        {layout.sections.map((section, i) =>
          renderPurchaseOrderSection(section, ctx, styles, i),
        )}
      </Page>
    </Document>
  );
}

// -----------------------------------------------------------------
// Stock transfer context + renderer (M2 #8/10)
//
// Internal logistics doc — no money, no parties (warehouses
// instead). Three-quantity table (Requested / Dispatched /
// Received) with discrepancy highlighting, signature block for
// dispatched-by / received-by sign-off. Mirrors
// apps/web/lib/stock-transfer-pdf.tsx.
// -----------------------------------------------------------------
export type StockTransferContext = {
  docType: "stock_transfer";
  tenant: Pick<Tenant, "businessName">;
  transfer: StockTransferDetail;
  lines: StockTransferLineRow[];
  source: StockTransferWarehouse | null;
  destination: StockTransferWarehouse | null;
  logoDataUrl?: string | null;
};

export function buildStockTransferContext(args: {
  tenant: Pick<Tenant, "businessName">;
  transfer: StockTransferDetail;
  lines: StockTransferLineRow[];
  source: StockTransferWarehouse | null;
  destination: StockTransferWarehouse | null;
  logoDataUrl?: string | null;
}): StockTransferContext {
  return { docType: "stock_transfer", ...args };
}

function buildStockTransferStyles(theme: Theme) {
  const base = buildInvoiceStyles(theme);
  return StyleSheet.create({
    ...base,
    warehouseRow: {
      flexDirection: "row",
      gap: 24,
      marginBottom: 20,
    },
    warehouseCol: { flex: 1 },
    warehouseLabel: {
      fontSize: 8,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      color: theme.textTertiary,
      marginBottom: 6,
    },
    warehouseName: { fontSize: 12, fontFamily: `${theme.fontFamily}-Bold` },
    warehouseLine: { color: theme.textSecondary, marginTop: 2 },
    warehouseArrow: {
      alignSelf: "center",
      color: theme.textTertiary,
      fontSize: 16,
      paddingTop: 18,
    },

    stTable: {
      borderTop: `0.5pt solid ${theme.borderColor}`,
      marginBottom: 24,
    },
    stColQty: { width: 90, textAlign: "right" },
    tdShort: { fontSize: 10, color: "#92400E" },

    signBlock: {
      marginTop: 40,
      flexDirection: "row",
      gap: 40,
    },
    signCol: { flex: 1 },
    signLine: {
      borderTop: `0.5pt solid ${theme.textPrimary}`,
      marginTop: 48,
      paddingTop: 6,
    },
    signLabel: {
      fontSize: 9,
      color: theme.textTertiary,
    },
  });
}

function renderStockTransferSection(
  section: Section,
  ctx: StockTransferContext,
  styles: ReturnType<typeof buildStockTransferStyles>,
  key: number,
) {
  const { transfer, lines, source, destination, tenant } = ctx;
  const isDispatchedOrLater =
    transfer.status === "dispatched" || transfer.status === "received";

  switch (section.type) {
    case "header":
      return (
        <View key={key} style={styles.header} fixed>
          <View style={styles.tenantBlock}>
            {section.showLogo !== false && (
              <PdfLogoBlock logoDataUrl={ctx.logoDataUrl} />
            )}
            <Text style={styles.tenantName}>{tenant.businessName}</Text>
            <Text style={styles.tenantMeta}>Sri Lanka</Text>
          </View>
          <View style={styles.invoiceHeader}>
            <Text style={styles.invoiceLabel}>Stock transfer</Text>
            <Text style={styles.invoiceNumber}>
              {transfer.transferNumber ?? "Draft"}
            </Text>
            {section.showStatusPill !== false && (
              <Text style={styles.statusPill}>{transfer.status}</Text>
            )}
          </View>
        </View>
      );

    case "metaRow": {
      const fields = section.fields ?? [
        "requestedDate",
        "dispatchedAt",
        "receivedAt",
        "discrepancy",
      ];
      const cells: Array<{ label: string; value: string | null }> = fields.map(
        (f) => {
          if (f === "requestedDate")
            return {
              label: "Requested",
              value: formatDate(transfer.requestedDate),
            };
          if (f === "dispatchedAt")
            return {
              label: "Dispatched",
              value: transfer.dispatchedAt
                ? formatDate(transfer.dispatchedAt.slice(0, 10))
                : null,
            };
          if (f === "receivedAt")
            return {
              label: "Received",
              value: transfer.receivedAt
                ? formatDate(transfer.receivedAt.slice(0, 10))
                : null,
            };
          if (f === "discrepancy")
            return {
              label: "Discrepancy",
              value: transfer.hasDiscrepancy ? "Flagged" : null,
            };
          if (f === "transferNumber")
            return {
              label: "Transfer #",
              value: transfer.transferNumber ?? null,
            };
          return { label: f, value: null };
        },
      );
      return (
        <View key={key} style={styles.metaRow}>
          {cells
            .filter((c) => c.value !== null)
            .map((c, i) => (
              <View key={i} style={styles.metaCell}>
                <Text style={styles.metaLabel}>{c.label}</Text>
                <Text style={styles.metaValue}>{c.value}</Text>
              </View>
            ))}
        </View>
      );
    }

    case "warehouseRow":
      return (
        <View key={key} style={styles.warehouseRow}>
          <View style={styles.warehouseCol}>
            <Text style={styles.warehouseLabel}>From (source)</Text>
            {source ? (
              <>
                <Text style={styles.warehouseName}>{source.name}</Text>
                <Text style={styles.warehouseLine}>Code: {source.code}</Text>
              </>
            ) : (
              <Text style={styles.warehouseLine}>—</Text>
            )}
          </View>
          <Text style={styles.warehouseArrow}>→</Text>
          <View style={styles.warehouseCol}>
            <Text style={styles.warehouseLabel}>To (destination)</Text>
            {destination ? (
              <>
                <Text style={styles.warehouseName}>{destination.name}</Text>
                <Text style={styles.warehouseLine}>
                  Code: {destination.code}
                </Text>
              </>
            ) : (
              <Text style={styles.warehouseLine}>—</Text>
            )}
          </View>
        </View>
      );

    // billTo/billFrom on a stock transfer falls through to warehouseRow
    // so a generic-template clone doesn't render an empty block.
    case "billTo":
    case "billFrom":
      return renderStockTransferSection(
        { type: "warehouseRow" },
        ctx,
        styles,
        key,
      );

    case "lineItemsTable":
      return (
        <View key={key} style={styles.stTable}>
          <View style={[styles.row, styles.rowHeader]}>
            <Text style={[styles.colNum, styles.th]}>#</Text>
            <Text style={[styles.colDesc, styles.th]}>Item</Text>
            <Text style={[styles.stColQty, styles.th]}>Requested</Text>
            <Text style={[styles.stColQty, styles.th]}>Dispatched</Text>
            <Text style={[styles.stColQty, styles.th]}>Received</Text>
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
                <Text style={[styles.stColQty, styles.td]}>
                  {formatQty(l.quantity_requested)} {l.unit}
                </Text>
                <Text style={[styles.stColQty, styles.td]}>
                  {l.quantity_dispatched != null
                    ? `${formatQty(l.quantity_dispatched)} ${l.unit}`
                    : "—"}
                </Text>
                <Text
                  style={[
                    styles.stColQty,
                    isShort ? styles.tdShort : styles.td,
                  ]}
                >
                  {l.quantity_received != null
                    ? `${formatQty(l.quantity_received)} ${l.unit}`
                    : "—"}
                </Text>
              </View>
            );
          })}
        </View>
      );

    case "notes": {
      const hasNotes = !!transfer.notes;
      const hasCancelReason = !!transfer.cancelledReason;
      if (!hasNotes && !hasCancelReason) return null;
      return (
        <View key={key}>
          {hasNotes && (
            <View style={styles.notes} wrap={false}>
              <Text style={styles.notesLabel}>Notes</Text>
              <Text style={styles.notesText}>{transfer.notes}</Text>
            </View>
          )}
          {hasCancelReason && (
            <View style={styles.notes} wrap={false}>
              <Text style={styles.notesLabel}>Cancelled reason</Text>
              <Text style={styles.notesText}>{transfer.cancelledReason}</Text>
            </View>
          )}
        </View>
      );
    }

    case "signBlock":
      return (
        <View key={key} style={styles.signBlock} wrap={false}>
          <View style={styles.signCol}>
            <View style={styles.signLine}>
              <Text style={styles.signLabel}>
                Dispatched by (name &amp; signature)
              </Text>
            </View>
          </View>
          <View style={styles.signCol}>
            <View style={styles.signLine}>
              <Text style={styles.signLabel}>
                Received by (name &amp; signature)
              </Text>
            </View>
          </View>
        </View>
      );

    case "footer":
      return (
        <View key={key} style={styles.footer} fixed>
          <Text>{section.text ?? "Generated with PettahPro — pettahpro.lk"}</Text>
          <Text>{tenant.businessName}</Text>
        </View>
      );

    case "spacer":
      return <View key={key} style={{ height: section.height ?? 12 }} />;

    case "text": {
      const s =
        section.emphasis === "muted"
          ? styles.textMuted
          : section.emphasis === "label"
            ? styles.textLabel
            : styles.text;
      return (
        <Text key={key} style={s}>
          {section.text}
        </Text>
      );
    }

    default:
      return null;
  }
}

export function renderStockTransferTemplate(
  layoutRaw: unknown,
  ctx: StockTransferContext,
) {
  const layout = parseLayout(layoutRaw);
  const styles = buildStockTransferStyles(layout.theme);

  return (
    <Document
      title={ctx.transfer.transferNumber ?? "Stock transfer"}
      author={ctx.tenant.businessName}
      creator="PettahPro"
      producer="PettahPro"
    >
      <Page size={pageSizeProp(layout.pageSize)} style={styles.page}>
        {layout.sections.map((section, i) =>
          renderStockTransferSection(section, ctx, styles, i),
        )}
      </Page>
    </Document>
  );
}

// -----------------------------------------------------------------
// Payslip context + renderer (M2 #9/10)
//
// Two-column earnings/deductions cards, highlighted net-pay band,
// optional leave / employer-contribution / bank-disbursement
// blocks. Each block is its own section so payroll admins can
// rearrange or drop optional pieces. Mirrors
// apps/web/lib/payslip-pdf.tsx.
// -----------------------------------------------------------------
const PAYSLIP_MONTHS = [
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

function formatLKRSimple(cents: number): string {
  const abs = Math.abs(cents) / 100;
  const negative = cents < 0;
  const formatted = abs.toLocaleString("en-LK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${negative ? "-" : ""}LKR ${formatted}`;
}

function formatDays(days: string | number): string {
  const n = Number(days);
  if (!Number.isFinite(n)) return "0 days";
  const rounded = Number.isInteger(n) ? n.toString() : n.toFixed(2);
  return `${rounded} ${n === 1 ? "day" : "days"}`;
}

export type PayslipContext = {
  docType: "payslip";
  tenant: Pick<Tenant, "businessName">;
  run: PayrollRun;
  line: PayrollRunLine;
  logoDataUrl?: string | null;
};

export function buildPayslipContext(args: {
  tenant: Pick<Tenant, "businessName">;
  run: PayrollRun;
  line: PayrollRunLine;
  logoDataUrl?: string | null;
}): PayslipContext {
  return { docType: "payslip", ...args };
}

function buildPayslipStyles(theme: Theme) {
  const base = buildInvoiceStyles(theme);
  return StyleSheet.create({
    ...base,
    payslipTenantMeta: { color: theme.textSecondary, lineHeight: 1.5 },
    payslipNumber: {
      fontSize: 20,
      fontFamily: `${theme.fontFamily}-Bold`,
      marginTop: 4,
    },
    periodPill: {
      marginTop: 8,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: theme.mutedColor,
      color: theme.accentColor,
      fontSize: 9,
      fontFamily: `${theme.fontFamily}-Bold`,
    },

    employeeBlock: {
      borderTop: `0.5pt solid ${theme.borderColor}`,
      borderBottom: `0.5pt solid ${theme.borderColor}`,
      paddingVertical: 14,
      marginBottom: 20,
      flexDirection: "row",
      justifyContent: "space-between",
    },
    employeeCol: { maxWidth: 260 },
    employeeName: {
      fontSize: 14,
      fontFamily: `${theme.fontFamily}-Bold`,
      marginBottom: 4,
    },
    employeeMeta: { color: theme.textSecondary, lineHeight: 1.6 },
    employeeMetaLabel: {
      fontSize: 8,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      color: theme.textTertiary,
      marginBottom: 3,
    },
    employeeMetaValue: {
      fontSize: 10,
      color: theme.textPrimary,
      marginBottom: 8,
    },

    twoCol: {
      flexDirection: "row",
      gap: 18,
      marginBottom: 20,
    },
    colCard: {
      flex: 1,
      borderRadius: 4,
      border: `0.5pt solid ${theme.borderColor}`,
      padding: 14,
    },
    colHeader: {
      fontSize: 9,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      color: theme.textTertiary,
      marginBottom: 10,
    },
    lineRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 4,
    },
    lineLabel: { color: theme.textSecondary },
    lineValue: { color: theme.textPrimary },
    cardDivider: {
      borderTop: `0.5pt solid ${theme.borderColor}`,
      marginVertical: 8,
    },
    subtotal: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 4,
    },
    subtotalLabel: {
      fontFamily: `${theme.fontFamily}-Bold`,
      color: theme.textPrimary,
    },
    subtotalValue: {
      fontFamily: `${theme.fontFamily}-Bold`,
      color: theme.textPrimary,
    },

    netBand: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      backgroundColor: theme.mutedColor,
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: 4,
      marginBottom: 20,
    },
    netLabel: {
      fontSize: 10,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      color: theme.accentColor,
      fontFamily: `${theme.fontFamily}-Bold`,
    },
    netValue: {
      fontSize: 20,
      fontFamily: `${theme.fontFamily}-Bold`,
      color: theme.textPrimary,
    },

    employerNote: {
      backgroundColor: theme.surfaceRecessed,
      padding: 12,
      borderRadius: 4,
      marginBottom: 20,
    },
    employerTitle: {
      fontSize: 9,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      color: theme.textTertiary,
      marginBottom: 8,
    },
    employerRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 2,
    },
  });
}

function payslipDeductionTotal(line: PayrollRunLine): number {
  const gross = line.earningsCents || line.grossCents;
  return Math.max(0, gross - line.netPayCents);
}

function splitPayslipComponents(line: PayrollRunLine) {
  const comps = (line.components ?? [])
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const earnings: PayrollRunLineComponent[] = comps.filter(
    (c) => c.kind === "earning",
  );
  const preTax: PayrollRunLineComponent[] = comps.filter(
    (c) =>
      c.kind === "deduction" &&
      (c.countsForEpf || c.countsForEtf || c.countsForPaye),
  );
  const postTax: PayrollRunLineComponent[] = comps.filter(
    (c) =>
      c.kind === "deduction" &&
      !c.countsForEpf &&
      !c.countsForEtf &&
      !c.countsForPaye,
  );
  return { earnings, preTax, postTax };
}

function renderPayslipSection(
  section: Section,
  ctx: PayslipContext,
  styles: ReturnType<typeof buildPayslipStyles>,
  key: number,
) {
  const { run, line, tenant } = ctx;
  const periodLabel = `${PAYSLIP_MONTHS[run.periodMonth - 1]} ${run.periodYear}`;

  switch (section.type) {
    case "header":
      return (
        <View key={key} style={styles.header} fixed>
          <View style={styles.tenantBlock}>
            {section.showLogo !== false && (
              <PdfLogoBlock logoDataUrl={ctx.logoDataUrl} />
            )}
            <Text style={styles.tenantName}>{tenant.businessName}</Text>
            <Text style={styles.payslipTenantMeta}>Payslip · confidential</Text>
          </View>
          <View style={styles.invoiceHeader}>
            <Text style={styles.invoiceLabel}>Payslip</Text>
            <Text style={styles.payslipNumber}>
              {run.runNumber ? run.runNumber : "Draft"}
            </Text>
            {section.showStatusPill !== false && (
              <Text style={styles.periodPill}>{periodLabel}</Text>
            )}
          </View>
        </View>
      );

    case "employeeBlock":
      return (
        <View key={key} style={styles.employeeBlock}>
          <View style={styles.employeeCol}>
            <Text style={styles.employeeName}>{line.employeeFullName}</Text>
            {line.designation && (
              <Text style={styles.employeeMeta}>{line.designation}</Text>
            )}
            {line.department && (
              <Text style={styles.employeeMeta}>{line.department}</Text>
            )}
            {line.employeeCode && (
              <Text style={styles.employeeMeta}>
                Employee code: {line.employeeCode}
              </Text>
            )}
          </View>
          <View>
            {line.nic && (
              <>
                <Text style={styles.employeeMetaLabel}>NIC</Text>
                <Text style={styles.employeeMetaValue}>{line.nic}</Text>
              </>
            )}
            {line.epfNumber && (
              <>
                <Text style={styles.employeeMetaLabel}>EPF number</Text>
                <Text style={styles.employeeMetaValue}>{line.epfNumber}</Text>
              </>
            )}
            <Text style={styles.employeeMetaLabel}>Pay date</Text>
            <Text style={styles.employeeMetaValue}>
              {formatDate(run.payDate)}
            </Text>
          </View>
        </View>
      );

    case "payslipColumns": {
      const { earnings, preTax, postTax } = splitPayslipComponents(line);
      return (
        <View key={key} style={styles.twoCol}>
          <View style={styles.colCard}>
            <Text style={styles.colHeader}>Earnings</Text>
            {earnings.length === 0 ? (
              <View style={styles.lineRow}>
                <Text style={styles.lineLabel}>Basic salary</Text>
                <Text style={styles.lineValue}>
                  {formatLKRSimple(line.basicSalaryCents)}
                </Text>
              </View>
            ) : (
              earnings.map((c) => (
                <View key={c.id} style={styles.lineRow}>
                  <Text style={styles.lineLabel}>{c.name}</Text>
                  <Text style={styles.lineValue}>
                    {formatLKRSimple(c.amountCents)}
                  </Text>
                </View>
              ))
            )}
            <View style={styles.cardDivider} />
            <View style={styles.subtotal}>
              <Text style={styles.subtotalLabel}>Gross earnings</Text>
              <Text style={styles.subtotalValue}>
                {formatLKRSimple(line.earningsCents || line.grossCents)}
              </Text>
            </View>
          </View>

          <View style={styles.colCard}>
            <Text style={styles.colHeader}>Deductions</Text>
            {preTax.map((c) => (
              <View key={c.id} style={styles.lineRow}>
                <Text style={styles.lineLabel}>{c.name}</Text>
                <Text style={styles.lineValue}>
                  -{formatLKRSimple(c.amountCents)}
                </Text>
              </View>
            ))}
            {line.epfEmployeeCents > 0 && (
              <View style={styles.lineRow}>
                <Text style={styles.lineLabel}>EPF (employee, 8%)</Text>
                <Text style={styles.lineValue}>
                  -{formatLKRSimple(line.epfEmployeeCents)}
                </Text>
              </View>
            )}
            {line.payeCents > 0 && (
              <View style={styles.lineRow}>
                <Text style={styles.lineLabel}>PAYE</Text>
                <Text style={styles.lineValue}>
                  -{formatLKRSimple(line.payeCents)}
                </Text>
              </View>
            )}
            {postTax.map((c) => (
              <View key={c.id} style={styles.lineRow}>
                <Text style={styles.lineLabel}>{c.name}</Text>
                <Text style={styles.lineValue}>
                  -{formatLKRSimple(c.amountCents)}
                </Text>
              </View>
            ))}
            {line.totalDeductionsCents === 0 &&
              preTax.length === 0 &&
              postTax.length === 0 && (
                <Text style={styles.lineLabel}>No deductions</Text>
              )}
            <View style={styles.cardDivider} />
            <View style={styles.subtotal}>
              <Text style={styles.subtotalLabel}>Total deductions</Text>
              <Text style={styles.subtotalValue}>
                -{formatLKRSimple(payslipDeductionTotal(line))}
              </Text>
            </View>
          </View>
        </View>
      );
    }

    case "netPayBand":
      return (
        <View key={key} style={styles.netBand}>
          <Text style={styles.netLabel}>Net take-home pay</Text>
          <Text style={styles.netValue}>
            {formatLKRSimple(line.netPayCents)}
          </Text>
        </View>
      );

    case "leaveSummary": {
      const paid = Number(line.paidLeaveDays);
      const unpaid = Number(line.unpaidLeaveDays);
      if (!(paid > 0 || unpaid > 0)) return null;
      return (
        <View key={key} style={styles.employerNote}>
          <Text style={styles.employerTitle}>Leave taken this period</Text>
          {paid > 0 && (
            <View style={styles.employerRow}>
              <Text style={styles.lineLabel}>Paid leave</Text>
              <Text style={styles.lineValue}>
                {formatDays(line.paidLeaveDays)}
              </Text>
            </View>
          )}
          {unpaid > 0 && (
            <View style={styles.employerRow}>
              <Text style={styles.lineLabel}>No-pay leave</Text>
              <Text style={styles.lineValue}>
                {formatDays(line.unpaidLeaveDays)}
              </Text>
            </View>
          )}
        </View>
      );
    }

    case "employerContributions": {
      if (!(line.epfEmployerCents > 0 || line.etfEmployerCents > 0))
        return null;
      return (
        <View key={key} style={styles.employerNote}>
          <Text style={styles.employerTitle}>
            Employer contributions (for your records)
          </Text>
          {line.epfEmployerCents > 0 && (
            <View style={styles.employerRow}>
              <Text style={styles.lineLabel}>EPF (employer, 12%)</Text>
              <Text style={styles.lineValue}>
                {formatLKRSimple(line.epfEmployerCents)}
              </Text>
            </View>
          )}
          {line.etfEmployerCents > 0 && (
            <View style={styles.employerRow}>
              <Text style={styles.lineLabel}>ETF (employer, 3%)</Text>
              <Text style={styles.lineValue}>
                {formatLKRSimple(line.etfEmployerCents)}
              </Text>
            </View>
          )}
        </View>
      );
    }

    case "bankDisbursement":
      if (!line.bankName || !line.bankAccountNo) return null;
      return (
        <View key={key} style={styles.employerNote}>
          <Text style={styles.employerTitle}>Disbursed to</Text>
          <Text style={styles.employeeMetaValue}>
            {line.bankName} · {line.bankAccountNo}
            {line.bankBranch ? ` · ${line.bankBranch}` : ""}
          </Text>
        </View>
      );

    case "footer":
      return (
        <View key={key} style={styles.footer} fixed>
          <Text>{section.text ?? "Generated with PettahPro — pettahpro.lk"}</Text>
          <Text>
            Payslip for {line.employeeFullName} · {periodLabel}
          </Text>
        </View>
      );

    case "spacer":
      return <View key={key} style={{ height: section.height ?? 12 }} />;

    case "text": {
      const s =
        section.emphasis === "muted"
          ? styles.textMuted
          : section.emphasis === "label"
            ? styles.textLabel
            : styles.text;
      return (
        <Text key={key} style={s}>
          {section.text}
        </Text>
      );
    }

    default:
      return null;
  }
}

export function renderPayslipTemplate(
  layoutRaw: unknown,
  ctx: PayslipContext,
) {
  const layout = parseLayout(layoutRaw);
  const styles = buildPayslipStyles(layout.theme);
  const periodLabel = `${PAYSLIP_MONTHS[ctx.run.periodMonth - 1]} ${ctx.run.periodYear}`;

  return (
    <Document
      title={`Payslip ${ctx.line.employeeFullName} ${periodLabel}`}
      author={ctx.tenant.businessName}
      creator="PettahPro"
      producer="PettahPro"
    >
      <Page size={pageSizeProp(layout.pageSize)} style={styles.page}>
        {layout.sections.map((section, i) =>
          renderPayslipSection(section, ctx, styles, i),
        )}
      </Page>
    </Document>
  );
}

// -----------------------------------------------------------------
// Settlement letter context + renderer (M2 #10/10)
//
// Final settlement letter for a departing employee. Carries hire
// and exit dates plus years of service, single-column earnings and
// deductions cards, a highlighted Net-payable band, and a
// Declaration paragraph asserting full-and-final settlement.
// Mirrors apps/web/lib/settlement-letter-pdf.tsx.
// -----------------------------------------------------------------
export type SettlementContext = {
  docType: "settlement_letter";
  tenant: Pick<Tenant, "businessName">;
  settlement: FinalSettlementRow;
  logoDataUrl?: string | null;
};

export function buildSettlementContext(args: {
  tenant: Pick<Tenant, "businessName">;
  settlement: FinalSettlementRow;
  logoDataUrl?: string | null;
}): SettlementContext {
  return { docType: "settlement_letter", ...args };
}

function buildSettlementStyles(theme: Theme) {
  const base = buildInvoiceStyles(theme);
  return StyleSheet.create({
    ...base,
    settlementTenantMeta: { color: theme.textSecondary, lineHeight: 1.5 },
    settlementNumber: {
      fontSize: 20,
      fontFamily: `${theme.fontFamily}-Bold`,
      marginTop: 4,
    },
    settlementStatusPill: {
      marginTop: 8,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: theme.mutedColor,
      color: theme.accentColor,
      fontSize: 9,
      fontFamily: `${theme.fontFamily}-Bold`,
    },

    employeeBlock: {
      borderTop: `0.5pt solid ${theme.borderColor}`,
      borderBottom: `0.5pt solid ${theme.borderColor}`,
      paddingVertical: 14,
      marginBottom: 20,
      flexDirection: "row",
      justifyContent: "space-between",
    },
    employeeCol: { maxWidth: 260 },
    employeeName: {
      fontSize: 14,
      fontFamily: `${theme.fontFamily}-Bold`,
      marginBottom: 4,
    },
    employeeMeta: { color: theme.textSecondary, lineHeight: 1.6 },
    employeeMetaLabel: {
      fontSize: 8,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      color: theme.textTertiary,
      marginBottom: 3,
    },
    employeeMetaValue: {
      fontSize: 10,
      color: theme.textPrimary,
      marginBottom: 8,
    },

    sectionTitle: {
      fontSize: 9,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      color: theme.textTertiary,
      marginBottom: 8,
    },
    card: {
      borderRadius: 4,
      border: `0.5pt solid ${theme.borderColor}`,
      padding: 14,
      marginBottom: 14,
    },
    lineRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 4,
    },
    lineLabel: { color: theme.textSecondary },
    lineValue: { color: theme.textPrimary },
    cardDivider: {
      borderTop: `0.5pt solid ${theme.borderColor}`,
      marginVertical: 8,
    },
    subtotal: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 4,
    },
    subtotalLabel: {
      fontFamily: `${theme.fontFamily}-Bold`,
      color: theme.textPrimary,
    },
    subtotalValue: {
      fontFamily: `${theme.fontFamily}-Bold`,
      color: theme.textPrimary,
    },

    netBand: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      backgroundColor: theme.mutedColor,
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: 4,
      marginBottom: 20,
    },
    netLabel: {
      fontSize: 10,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      color: theme.accentColor,
      fontFamily: `${theme.fontFamily}-Bold`,
    },
    netValue: {
      fontSize: 20,
      fontFamily: `${theme.fontFamily}-Bold`,
      color: theme.textPrimary,
    },

    note: {
      backgroundColor: theme.surfaceRecessed,
      padding: 12,
      borderRadius: 4,
      marginBottom: 20,
    },
    noteBody: { color: theme.textSecondary, lineHeight: 1.5 },

    signatureBlock: {
      marginTop: 32,
      flexDirection: "row",
      justifyContent: "space-between",
    },
    signatureCol: { flex: 1, marginRight: 16 },
    signatureLine: {
      borderTop: `0.5pt solid ${theme.textPrimary}`,
      marginTop: 40,
      paddingTop: 6,
    },
  });
}

function settlementStatusLabel(status: FinalSettlementRow["status"]): string {
  if (status === "posted") return "Posted";
  if (status === "paid") return "Paid";
  if (status === "approved") return "Approved";
  if (status === "cancelled") return "Cancelled";
  if (status === "pending_approval") return "Pending approval";
  return "Draft";
}

function renderSettlementSection(
  section: Section,
  ctx: SettlementContext,
  styles: ReturnType<typeof buildSettlementStyles>,
  key: number,
) {
  const { settlement, tenant } = ctx;
  const lines = settlement.linesSnapshot ?? [];
  const earningRows = lines.filter((l) => l.kind === "earning");
  const deductionRows = lines.filter((l) => l.kind === "deduction");
  const statutoryRows = lines.filter((l) => l.kind === "statutory");
  const earningsTotal = earningRows.reduce((s, r) => s + r.amountCents, 0);
  const deductionsTotal =
    deductionRows.reduce((s, r) => s + r.amountCents, 0) +
    statutoryRows.reduce((s, r) => s + r.amountCents, 0);
  const number = settlement.settlementNumber ?? "Draft";

  switch (section.type) {
    case "header":
      return (
        <View key={key} style={styles.header} fixed>
          <View style={styles.tenantBlock}>
            {section.showLogo !== false && (
              <PdfLogoBlock logoDataUrl={ctx.logoDataUrl} />
            )}
            <Text style={styles.tenantName}>{tenant.businessName}</Text>
            <Text style={styles.settlementTenantMeta}>
              Final settlement · confidential
            </Text>
          </View>
          <View style={styles.invoiceHeader}>
            <Text style={styles.invoiceLabel}>Settlement</Text>
            <Text style={styles.settlementNumber}>{number}</Text>
            {section.showStatusPill !== false && (
              <Text style={styles.settlementStatusPill}>
                {settlementStatusLabel(settlement.status)}
              </Text>
            )}
          </View>
        </View>
      );

    case "settlementEmployee":
      return (
        <View key={key} style={styles.employeeBlock}>
          <View style={styles.employeeCol}>
            <Text style={styles.employeeName}>
              {settlement.employeeFullName}
            </Text>
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
            <Text style={styles.employeeMetaLabel}>Hire date</Text>
            <Text style={styles.employeeMetaValue}>
              {formatDate(settlement.hireDate)}
            </Text>
            <Text style={styles.employeeMetaLabel}>Exit date</Text>
            <Text style={styles.employeeMetaValue}>
              {formatDate(settlement.exitDate)}
            </Text>
            <Text style={styles.employeeMetaLabel}>Last working day</Text>
            <Text style={styles.employeeMetaValue}>
              {formatDate(settlement.lastWorkingDay)}
            </Text>
            <Text style={styles.employeeMetaLabel}>Years of service</Text>
            <Text style={styles.employeeMetaValue}>
              {Number(settlement.yearsOfService).toFixed(2)} (
              {settlement.gratuityYearsCompleted} completed)
            </Text>
          </View>
        </View>
      );

    case "settlementEarnings":
      if (earningRows.length === 0) return null;
      return (
        <View key={key} style={styles.card}>
          <Text style={styles.sectionTitle}>Earnings</Text>
          {earningRows.map((l) => (
            <View key={l.code} style={styles.lineRow}>
              <Text style={styles.lineLabel}>{l.name}</Text>
              <Text style={styles.lineValue}>
                {formatLKRSimple(l.amountCents)}
              </Text>
            </View>
          ))}
          <View style={styles.cardDivider} />
          <View style={styles.subtotal}>
            <Text style={styles.subtotalLabel}>Gross earnings</Text>
            <Text style={styles.subtotalValue}>
              {formatLKRSimple(earningsTotal)}
            </Text>
          </View>
        </View>
      );

    case "settlementDeductions":
      if (deductionRows.length === 0 && statutoryRows.length === 0) return null;
      return (
        <View key={key} style={styles.card}>
          <Text style={styles.sectionTitle}>Deductions</Text>
          {statutoryRows.map((l) => (
            <View key={l.code} style={styles.lineRow}>
              <Text style={styles.lineLabel}>{l.name}</Text>
              <Text style={styles.lineValue}>
                -{formatLKRSimple(l.amountCents)}
              </Text>
            </View>
          ))}
          {deductionRows.map((l) => (
            <View key={l.code} style={styles.lineRow}>
              <Text style={styles.lineLabel}>{l.name}</Text>
              <Text style={styles.lineValue}>
                -{formatLKRSimple(l.amountCents)}
              </Text>
            </View>
          ))}
          <View style={styles.cardDivider} />
          <View style={styles.subtotal}>
            <Text style={styles.subtotalLabel}>Total deductions</Text>
            <Text style={styles.subtotalValue}>
              -{formatLKRSimple(deductionsTotal)}
            </Text>
          </View>
        </View>
      );

    case "settlementNetPay":
      return (
        <View key={key} style={styles.netBand}>
          <Text style={styles.netLabel}>Net payable</Text>
          <Text style={styles.netValue}>
            {formatLKRSimple(settlement.netPayableCents)}
          </Text>
        </View>
      );

    case "settlementDeclaration":
      return (
        <View key={key} style={styles.note}>
          <Text style={styles.sectionTitle}>Declaration</Text>
          <Text style={styles.noteBody}>
            This letter sets out the final settlement payable to{" "}
            {settlement.employeeFullName} on the cessation of employment with{" "}
            {tenant.businessName} effective {formatDate(settlement.exitDate)}.
            The amount shown is inclusive of all statutory entitlements
            including gratuity (where applicable), EPF/ETF, and is in full and
            final settlement of all dues between employer and employee. On
            receipt of this payment the employee has no further monetary claims
            against the employer arising out of the employment.
          </Text>
        </View>
      );

    case "notes":
      if (!settlement.notes) return null;
      return (
        <View key={key} style={styles.note}>
          <Text style={styles.sectionTitle}>Notes</Text>
          <Text style={styles.noteBody}>{settlement.notes}</Text>
        </View>
      );

    case "settlementSignatures":
      return (
        <View key={key} style={styles.signatureBlock}>
          <View style={styles.signatureCol}>
            <View style={styles.signatureLine}>
              <Text style={styles.lineLabel}>Employee signature</Text>
              <Text style={styles.lineLabel}>
                {settlement.employeeFullName}
              </Text>
            </View>
          </View>
          <View style={styles.signatureCol}>
            <View style={styles.signatureLine}>
              <Text style={styles.lineLabel}>Authorised signatory</Text>
              <Text style={styles.lineLabel}>{tenant.businessName}</Text>
            </View>
          </View>
        </View>
      );

    case "footer":
      return (
        <View key={key} style={styles.footer} fixed>
          <Text>{section.text ?? "Generated with PettahPro — pettahpro.lk"}</Text>
          <Text>
            Settlement {number} · {settlement.employeeFullName}
          </Text>
        </View>
      );

    case "spacer":
      return <View key={key} style={{ height: section.height ?? 12 }} />;

    case "text": {
      const s =
        section.emphasis === "muted"
          ? styles.textMuted
          : section.emphasis === "label"
            ? styles.textLabel
            : styles.text;
      return (
        <Text key={key} style={s}>
          {section.text}
        </Text>
      );
    }

    default:
      return null;
  }
}

export function renderSettlementLetterTemplate(
  layoutRaw: unknown,
  ctx: SettlementContext,
) {
  const layout = parseLayout(layoutRaw);
  const styles = buildSettlementStyles(layout.theme);

  return (
    <Document
      title={`Settlement letter ${ctx.settlement.employeeFullName}`}
      author={ctx.tenant.businessName}
      creator="PettahPro"
      producer="PettahPro"
    >
      <Page size={pageSizeProp(layout.pageSize)} style={styles.page}>
        {layout.sections.map((section, i) =>
          renderSettlementSection(section, ctx, styles, i),
        )}
      </Page>
    </Document>
  );
}
