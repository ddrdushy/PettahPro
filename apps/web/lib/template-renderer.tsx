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
  InvoiceDetail,
  InvoiceLine,
  QuotationDetail,
  QuotationLine,
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
    };

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
