// Template library (roadmap #33) — hard-coded starter templates the
// tenant admin UI lists under "Browse library". Cloning one copies
// the layout JSON into a tenant-owned `document_templates` row with
// `library_key` preserved so the UI can label the origin and a
// future sync flow can detect library revisions.
//
// v1 ships one invoice template ("Classic"). Extending the library
// means adding more entries here — no DB changes required. Future
// PRs per doc type will bulk-add PO, GRN, quotation, etc.
//
// The JSON shape is the renderer's contract; see
// apps/web/lib/template-renderer.tsx for the authoritative type
// definition. Keep the shape in sync when extending.

export type LibraryTemplate = {
  libraryKey: string;
  docType: string;
  name: string;
  description: string;
  // Languages this library entry is available in. The UI shows one
  // card per key and lets the user pick a language at clone time.
  languages: readonly string[];
  // Layout JSON — opaque to the API, parsed by the web renderer.
  layout: Record<string, unknown>;
};

// The invoice layout mirrors the hard-coded `InvoicePDF` React
// component so cloning "Classic" gives the same output the tenant
// already had before switching to template-driven rendering. The
// renderer falls back to the hard-coded component when no template
// is configured, so this is also our "what does the fallback look
// like" source of truth.
const CLASSIC_THEME: Record<string, unknown> = {
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

const CLASSIC_INVOICE_LAYOUT: Record<string, unknown> = {
  pageSize: "a4",
  theme: CLASSIC_THEME,
  sections: [
    { type: "header", showLogo: true, showStatusPill: true },
    {
      type: "metaRow",
      fields: ["invoiceDate", "dueDate", "currency", "invoiceNumber"],
    },
    { type: "billTo" },
    { type: "lineItemsTable" },
    { type: "totals", showTaxBreakdown: true },
    { type: "notes" },
    { type: "footer", text: "Thank you for your business." },
  ],
};

// Classic bill — mirrors the hard-coded BillPDF component output so
// cloning this and rendering it gives the exact same PDF a tenant
// who never touches the builder gets. Sections in render order:
// header (with logo) → draft banner (only when status='draft') →
// meta row (bill date, due date, supplier ref, posted) → billed-from
// supplier → line items → optional landed-cost charges → totals →
// notes → footer.
const CLASSIC_BILL_LAYOUT: Record<string, unknown> = {
  pageSize: "a4",
  theme: CLASSIC_THEME,
  sections: [
    { type: "header", showLogo: true, showStatusPill: true },
    { type: "draftBanner" },
    {
      type: "metaRow",
      fields: ["billDate", "dueDate", "supplierBillNumber", "postedAt"],
    },
    { type: "billFrom" },
    { type: "lineItemsTable" },
    { type: "chargesTable" },
    { type: "totals" },
    { type: "notes" },
    { type: "footer", text: "Generated with PettahPro — pettahpro.lk" },
  ],
};

// Classic debit note — AP-side counterpart to credit_note_classic.
// Mirrors the hard-coded DebitNotePDF output: header, draft banner,
// meta row (with reason + supplier ref), optional "Debit against
// bill" badge, "Issued to" supplier, line items, totals with
// "Applied to bill" / "Standing debit" once posted, notes, footer.
const CLASSIC_DEBIT_NOTE_LAYOUT: Record<string, unknown> = {
  pageSize: "a4",
  theme: CLASSIC_THEME,
  sections: [
    { type: "header", showLogo: true, showStatusPill: true },
    { type: "draftBanner" },
    {
      type: "metaRow",
      fields: [
        "issueDate",
        "reason",
        "currency",
        "supplierDebitNumber",
        "postedAt",
      ],
    },
    { type: "linkedDocument" },
    { type: "billFrom" },
    { type: "lineItemsTable" },
    { type: "totals" },
    { type: "notes" },
    { type: "footer", text: "Generated with PettahPro — pettahpro.lk" },
  ],
};

// Classic credit note — mirrors the hard-coded CreditNotePDF output.
// Specifics: status set (draft/posted/void), reason in the meta row,
// optional "Credit against invoice" badge below meta when linked,
// "Issued to" customer label, and totals that show "Applied to
// invoice" / "Standing credit" / "Fully applied" once posted.
const CLASSIC_CREDIT_NOTE_LAYOUT: Record<string, unknown> = {
  pageSize: "a4",
  theme: CLASSIC_THEME,
  sections: [
    { type: "header", showLogo: true, showStatusPill: true },
    { type: "draftBanner" },
    {
      type: "metaRow",
      fields: ["issueDate", "reason", "currency", "postedAt"],
    },
    { type: "linkedDocument" },
    { type: "billTo" },
    { type: "lineItemsTable" },
    { type: "totals" },
    { type: "notes" },
    { type: "footer", text: "Generated with PettahPro — pettahpro.lk" },
  ],
};

// Classic quotation — mirrors the hard-coded QuotationPDF output.
// Different from invoice in three places: status set, "Prepared
// for" label on the customer block (handled inside the renderer's
// billTo case for quotation context), and a validity callout block
// that switches to a "this quotation expired" message when the
// valid_until date is in the past.
const CLASSIC_QUOTATION_LAYOUT: Record<string, unknown> = {
  pageSize: "a4",
  theme: CLASSIC_THEME,
  sections: [
    { type: "header", showLogo: true, showStatusPill: true },
    {
      type: "metaRow",
      fields: ["issueDate", "validUntil", "reference", "currency"],
    },
    { type: "billTo" },
    { type: "lineItemsTable" },
    { type: "totals" },
    { type: "validity" },
    { type: "notes" },
    { type: "footer", text: "Generated with PettahPro — pettahpro.lk" },
  ],
};

const LIBRARY: readonly LibraryTemplate[] = [
  {
    libraryKey: "invoice_classic",
    docType: "invoice",
    name: "Classic invoice",
    description:
      "Clean, professional A4 layout with header, meta row, bill-to block, line items table, and totals with tax breakdown.",
    languages: ["en"],
    layout: CLASSIC_INVOICE_LAYOUT,
  },
  {
    libraryKey: "bill_classic",
    docType: "bill",
    name: "Classic bill",
    description:
      "AP-side companion to the Classic invoice. Same tone, but supplier details ('Billed from'), Input tax, and an optional landed-cost charges table.",
    languages: ["en"],
    layout: CLASSIC_BILL_LAYOUT,
  },
  {
    libraryKey: "quotation_classic",
    docType: "quotation",
    name: "Classic quotation",
    description:
      "Pre-sale quote with 'Prepared for' customer block, a validity callout, and notes + terms. Switches to an expired-warning style when the valid-until date is in the past.",
    languages: ["en"],
    layout: CLASSIC_QUOTATION_LAYOUT,
  },
  {
    libraryKey: "credit_note_classic",
    docType: "credit_note",
    name: "Classic credit note",
    description:
      "Sales-side refund / adjustment doc. Shows the reason, an optional 'Credit against invoice' badge when linked, an 'Issued to' customer block, and applied / standing credit lines once posted.",
    languages: ["en"],
    layout: CLASSIC_CREDIT_NOTE_LAYOUT,
  },
  {
    libraryKey: "delivery_note_classic",
    docType: "delivery_note",
    name: "Classic delivery note",
    description:
      "Logistics doc — no money. Two-column 'Deliver to' + shipping address, qty-only line table, signature block at the bottom for delivered-by / received-by sign-off.",
    languages: ["en"],
    layout: {
      pageSize: "a4",
      theme: CLASSIC_THEME,
      sections: [
        { type: "header", showLogo: true, showStatusPill: true },
        {
          type: "metaRow",
          fields: [
            "deliveryDate",
            "carrier",
            "trackingNumber",
            "deliveredAt",
          ],
        },
        { type: "partiesRow" },
        { type: "lineItemsTable" },
        { type: "notes" },
        { type: "signBlock" },
        { type: "footer", text: "Generated with PettahPro — pettahpro.lk" },
      ],
    },
    libraryKey: "debit_note_classic",
    docType: "debit_note",
    name: "Classic debit note",
    description:
      "AP-side counterpart to the credit note. Shows the reason, an optional 'Debit against bill' badge when linked, an 'Issued to' supplier block, and applied / standing debit lines once posted.",
    languages: ["en"],
    layout: CLASSIC_DEBIT_NOTE_LAYOUT,
  },
  {
    libraryKey: "stock_transfer_classic",
    docType: "stock_transfer",
    name: "Classic stock transfer",
    description:
      "Internal logistics doc. Source-→-destination warehouse pair, three-quantity table (Requested / Dispatched / Received) with discrepancy highlighting, signature block for dispatched-by / received-by sign-off.",
    libraryKey: "purchase_order_classic",
    docType: "purchase_order",
    name: "Classic purchase order",
    description:
      "Buyer-issued order with supplier block, line items priced for acknowledgement, totals, and a 'Supplier instructions' callout (PO number quoting + partial-shipment policy).",
    libraryKey: "proforma_invoice_classic",
    docType: "proforma_invoice",
    name: "Classic proforma invoice",
    description:
      "Pre-sale doc for advance payment / customs / LC purposes. Same shape as a quotation (validity callout, 'Prepared for') with an italic disclaimer at the bottom — 'this is not a tax invoice'.",
    languages: ["en"],
    layout: {
      pageSize: "a4",
      theme: CLASSIC_THEME,
      sections: [
        { type: "header", showLogo: true, showStatusPill: true },
        {
          type: "metaRow",
          fields: [
            "requestedDate",
            "dispatchedAt",
            "receivedAt",
            "discrepancy",
          ],
        },
        { type: "warehouseRow" },
        { type: "lineItemsTable" },
        { type: "notes" },
        { type: "signBlock" },
          fields: ["orderDate", "expectedDeliveryDate", "reference", "currency"],
        },
        { type: "billFrom" },
        { type: "lineItemsTable" },
        { type: "totals" },
        { type: "instructions" },
          fields: ["issueDate", "validUntil", "reference", "currency"],
        },
        { type: "billTo" },
        { type: "lineItemsTable" },
        { type: "totals" },
        { type: "validity" },
        { type: "disclaimer" },
        { type: "notes" },
        { type: "footer", text: "Generated with PettahPro — pettahpro.lk" },
      ],
    },
  },
] as const;

export function listLibraryTemplates(filters: {
  docType?: string;
} = {}): LibraryTemplate[] {
  return LIBRARY.filter(
    (t) => !filters.docType || t.docType === filters.docType,
  ).map((t) => ({ ...t }));
}

export function findLibraryTemplate(libraryKey: string): LibraryTemplate | null {
  return LIBRARY.find((t) => t.libraryKey === libraryKey) ?? null;
}
