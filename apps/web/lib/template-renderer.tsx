import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import type {
  Customer,
  InvoiceDetail,
  InvoiceLine,
  Tenant,
} from "@/lib/api";

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
  | { type: "lineItemsTable" }
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
};

export function buildInvoiceContext(args: {
  tenant: Pick<Tenant, "businessName">;
  invoice: InvoiceDetail;
  lines: InvoiceLine[];
  customer: Customer | null;
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
