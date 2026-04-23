const API_BASE =
  typeof window === "undefined"
    ? process.env.INTERNAL_API_URL ?? "http://api:4000"
    : process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  code: string;
  status: number;
  issues?: unknown;

  constructor(status: number, code: string, message: string, issues?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, headers, ...rest } = init;
  // Only advertise application/json when we actually have a body — Fastify
  // rejects empty bodies with "Body cannot be empty when content-type is
  // set to 'application/json'", which broke action POSTs like
  // /invoices/:id/post that take no body.
  const hasBody = json !== undefined || rest.body != null;
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    credentials: "include",
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });

  const contentType = res.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await res.json() : null;

  if (!res.ok) {
    const err = payload?.error;
    throw new ApiError(
      res.status,
      err?.code ?? "UNKNOWN",
      err?.message ?? res.statusText,
      err?.issues,
    );
  }

  return payload as T;
}

export const api = {
  signup: (body: {
    businessName: string;
    ownerName: string;
    email: string;
    password: string;
  }) => request<{ user: User; tenant: Tenant }>("/auth/signup", { method: "POST", json: body }),

  login: (body: { email: string; password: string }) =>
    request<{ user: User }>("/auth/login", { method: "POST", json: body }),

  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),

  me: () =>
    request<{ user: User; tenant: Tenant; permissions: CallerPermissions }>("/auth/me", {
      method: "GET",
    }),

  listCustomers: (q?: string) =>
    request<{ customers: Customer[] }>(`/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  getCustomer: (id: string) => request<CustomerDetail>(`/customers/${id}`),
  getCustomerCredit: (id: string) => request<CustomerCredit>(`/customers/${id}/credit`),
  holdCustomer: (id: string, reason: string) =>
    request<{ ok: true }>(`/customers/${id}/hold`, { method: "POST", json: { reason } }),
  unholdCustomer: (id: string) =>
    request<{ ok: true }>(`/customers/${id}/unhold`, { method: "POST" }),

  customerStatement: (id: string, from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const q = params.toString();
    return request<CustomerStatement>(`/customers/${id}/statement${q ? `?${q}` : ""}`);
  },
  emailCustomerStatement: (
    id: string,
    body?: {
      from?: string;
      to?: string;
      toEmail?: string;
      ccEmails?: string[];
      subjectOverride?: string;
      messageNote?: string;
    },
  ) =>
    request<{ result: StatementEmailResult }>(
      `/customers/${id}/statement/email`,
      { method: "POST", json: body ?? {} },
    ),
  emailCustomerStatementsBatch: (body: {
    customerIds: string[];
    from?: string;
    to?: string;
    messageNote?: string;
  }) =>
    request<{
      results: StatementEmailResult[];
      summary: { sent: number; failed: number; skipped: number };
    }>("/customers/statements/email-batch", { method: "POST", json: body }),
  listCustomerStatementEmails: (id: string) =>
    request<{ history: StatementEmailHistoryEntry[] }>(
      `/customers/${id}/statement-emails`,
    ),
  updateCustomerStatementEmailSettings: (
    id: string,
    body: { autoStatementEmail?: boolean; statementEmailDay?: number | null },
  ) =>
    request<{
      customer: {
        id: string;
        autoStatementEmail: boolean;
        statementEmailDay: number | null;
      };
    }>(`/customers/${id}/statement-email-settings`, {
      method: "PATCH",
      json: body,
    }),
  createCustomer: (body: CreateCustomer) =>
    request<{ customer: Customer }>("/customers", { method: "POST", json: body }),

  listSuppliers: (q?: string) =>
    request<{ suppliers: Supplier[] }>(`/suppliers${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  getSupplier: (id: string) => request<SupplierDetail>(`/suppliers/${id}`),
  supplierStatement: (id: string, from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const q = params.toString();
    return request<SupplierStatement>(`/suppliers/${id}/statement${q ? `?${q}` : ""}`);
  },
  createSupplier: (body: CreateSupplier) =>
    request<{ supplier: Supplier }>("/suppliers", { method: "POST", json: body }),
  reconcileSupplier: (id: string, rows: SupplierReconcileRow[]) =>
    request<SupplierReconcileResult>(`/suppliers/${id}/reconcile`, {
      method: "POST",
      json: { rows },
    }),

  listItems: (q?: string) =>
    request<{ items: Item[] }>(`/items${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  createItem: (body: CreateItem) =>
    request<{ item: Item }>("/items", { method: "POST", json: body }),

  listCoa: () => request<{ accounts: Account[] }>("/coa"),
  listTaxCodes: () => request<{ taxCodes: TaxCode[] }>("/tax-codes"),

  listBranches: () => request<{ branches: Branch[] }>("/branches"),
  getBranch: (id: string) => request<{ branch: Branch }>(`/branches/${id}`),
  createBranch: (body: CreateBranch) =>
    request<{ branch: Branch }>("/branches", { method: "POST", json: body }),
  updateBranch: (id: string, body: UpdateBranch) =>
    request<{ branch: Branch }>(`/branches/${id}`, { method: "PATCH", json: body }),

  listJournalEntries: (limit?: number, offset?: number) => {
    const params = new URLSearchParams();
    if (limit !== undefined) params.set("limit", String(limit));
    if (offset !== undefined) params.set("offset", String(offset));
    const q = params.toString();
    return request<{ entries: JournalEntryListRow[] }>(`/journal-entries${q ? `?${q}` : ""}`);
  },
  getJournalEntry: (id: string) =>
    request<{ entry: JournalEntryHeader; lines: JournalEntryLine[] }>(`/journal-entries/${id}`),
  createJournalEntry: (body: CreateJournalEntry) =>
    request<CreateJournalEntryResponse>("/journal-entries", {
      method: "POST",
      json: body,
    }),

  listJournalDrafts: () =>
    request<{ drafts: JournalEntryDraft[] }>("/journal-entries/drafts"),
  approveJournalDraft: (id: string) =>
    request<{ ok: true; entryId: string; entryNumber: string }>(
      `/journal-entries/drafts/${id}/approve`,
      { method: "POST" },
    ),
  rejectJournalDraft: (id: string, reason: string) =>
    request<{ ok: true }>(`/journal-entries/drafts/${id}/reject`, {
      method: "POST",
      json: { reason },
    }),

  listFixedAssets: () =>
    request<{
      assets: FixedAssetRow[];
      totals: { costCents: number; accumulatedCents: number; netBookValueCents: number; count: number };
    }>("/fixed-assets"),
  getFixedAsset: (id: string) =>
    request<{ asset: FixedAssetRow; history: FixedAssetDepreciationEntry[] }>(`/fixed-assets/${id}`),
  createFixedAsset: (body: CreateFixedAsset) =>
    request<{ asset: FixedAssetRow }>("/fixed-assets", { method: "POST", json: body }),
  runDepreciation: (year: number, month: number) =>
    request<{
      ok: true;
      processed: number;
      skipped: Array<{ id: string; name: string; reason: string }>;
      totalDepreciationCents: number;
      entryNumber?: string;
      runDate?: string;
    }>("/fixed-assets/run-depreciation", { method: "POST", json: { year, month } }),

  listInvoices: () => request<{ invoices: InvoiceListRow[] }>("/invoices"),
  getInvoice: (id: string) =>
    request<{ invoice: InvoiceDetail; lines: InvoiceLine[]; customer: Customer | null }>(
      `/invoices/${id}`,
    ),
  createInvoice: (body: CreateInvoice) =>
    request<{ invoice: InvoiceDetail }>("/invoices", { method: "POST", json: body }),
  postInvoice: (id: string) =>
    request<{ ok: true; invoiceNumber: string; entryNumber: string }>(
      `/invoices/${id}/post`,
      { method: "POST" },
    ),
  voidInvoice: (id: string, reason?: string) =>
    request<{ ok: true; reversalEntryNumber: string }>(`/invoices/${id}/void`, {
      method: "POST",
      json: reason ? { reason } : {},
    }),
  duplicateInvoice: (id: string) =>
    request<{ invoice: InvoiceDetail }>(`/invoices/${id}/duplicate`, { method: "POST" }),
  batchInvoiceFromDeliveryNotes: (body: {
    deliveryNoteIds: string[];
    issueDate?: string;
    dueDate?: string;
    notes?: string;
  }) =>
    request<{ invoice: InvoiceDetail; dnCount: number }>(
      "/invoices/batch-from-delivery-notes",
      { method: "POST", json: body },
    ),
  writeOffInvoice: (id: string, body: { reason: string; claimVatRelief?: boolean }) =>
    request<{
      ok: true;
      entryId: string;
      entryNumber: string;
      principalCents: number;
      vatReliefCents: number;
    }>(`/invoices/${id}/write-off`, { method: "POST", json: body }),
  reverseWriteOff: (id: string, reason?: string) =>
    request<{ ok: true; entryId: string; entryNumber: string }>(
      `/invoices/${id}/reverse-write-off`,
      { method: "POST", json: reason ? { reason } : {} },
    ),

  badDebtsReport: () => request<BadDebtReport>("/reports/bad-debts"),

  listRecurringInvoices: () =>
    request<{ recurringInvoices: RecurringInvoiceListRow[] }>("/recurring-invoices"),
  getRecurringInvoice: (id: string) =>
    request<{
      recurringInvoice: RecurringInvoiceDetail;
      lines: RecurringInvoiceLine[];
      customer: Customer | null;
    }>(`/recurring-invoices/${id}`),
  createRecurringInvoice: (body: CreateRecurringInvoice) =>
    request<{ recurringInvoice: RecurringInvoiceDetail }>(`/recurring-invoices`, {
      method: "POST",
      json: body,
    }),
  pauseRecurringInvoice: (id: string) =>
    request<{ ok: true }>(`/recurring-invoices/${id}/pause`, { method: "POST" }),
  resumeRecurringInvoice: (id: string) =>
    request<{ ok: true }>(`/recurring-invoices/${id}/resume`, { method: "POST" }),
  generateRecurringInvoiceNow: (id: string) =>
    request<{ ok: true; invoiceId: string }>(
      `/recurring-invoices/${id}/generate-now`,
      { method: "POST" },
    ),
  deleteRecurringInvoice: (id: string) =>
    request<{ ok: true }>(`/recurring-invoices/${id}`, { method: "DELETE" }),

  listSalesOrders: () => request<{ salesOrders: SalesOrderListRow[] }>("/sales-orders"),
  getSalesOrder: (id: string) =>
    request<{ salesOrder: SalesOrderDetail; lines: SalesOrderLine[]; customer: Customer | null }>(
      `/sales-orders/${id}`,
    ),
  createSalesOrder: (body: CreateSalesOrder) =>
    request<{ salesOrder: SalesOrderDetail }>("/sales-orders", { method: "POST", json: body }),
  confirmSalesOrder: (id: string) =>
    request<{ ok: true; soNumber: string }>(`/sales-orders/${id}/confirm`, { method: "POST" }),
  cancelSalesOrder: (id: string, reason?: string) =>
    request<{ ok: true }>(`/sales-orders/${id}/cancel`, {
      method: "POST",
      json: reason ? { reason } : {},
    }),
  convertSalesOrder: (id: string) =>
    request<{ ok: true; invoiceId: string }>(`/sales-orders/${id}/convert`, { method: "POST" }),

  listDeliveryNotes: () => request<{ deliveryNotes: DeliveryNoteListRow[] }>("/delivery-notes"),
  getDeliveryNote: (id: string) =>
    request<{ deliveryNote: DeliveryNoteDetail; lines: DeliveryNoteLine[]; customer: Customer | null }>(
      `/delivery-notes/${id}`,
    ),
  createDeliveryNote: (body: CreateDeliveryNote) =>
    request<{ deliveryNote: DeliveryNoteDetail }>("/delivery-notes", { method: "POST", json: body }),
  deliverDeliveryNote: (id: string, receivedByName?: string) =>
    request<{ ok: true; dnNumber: string }>(`/delivery-notes/${id}/deliver`, {
      method: "POST",
      json: receivedByName ? { receivedByName } : {},
    }),
  cancelDeliveryNote: (id: string, reason?: string) =>
    request<{ ok: true }>(`/delivery-notes/${id}/cancel`, {
      method: "POST",
      json: reason ? { reason } : {},
    }),

  listGrns: () => request<{ grns: GrnListRow[] }>("/grns"),
  getGrn: (id: string) =>
    request<{ grn: GrnDetail; lines: GrnLine[]; supplier: Supplier | null }>(`/grns/${id}`),
  createGrn: (body: CreateGrn) =>
    request<{ grn: GrnDetail }>("/grns", { method: "POST", json: body }),
  receiveGrn: (id: string) =>
    request<{ ok: true; grnNumber: string }>(`/grns/${id}/receive`, { method: "POST" }),
  cancelGrn: (id: string, reason?: string) =>
    request<{ ok: true }>(`/grns/${id}/cancel`, {
      method: "POST",
      json: reason ? { reason } : {},
    }),

  listQuotations: () => request<{ quotations: QuotationListRow[] }>("/quotations"),
  getQuotation: (id: string) =>
    request<{ quotation: QuotationDetail; lines: QuotationLine[]; customer: Customer | null }>(
      `/quotations/${id}`,
    ),
  createQuotation: (body: CreateQuotation) =>
    request<{ quotation: QuotationDetail }>("/quotations", { method: "POST", json: body }),
  sendQuotation: (id: string) =>
    request<{ ok: true; quotationNumber: string }>(`/quotations/${id}/send`, { method: "POST" }),
  acceptQuotation: (id: string) =>
    request<{ ok: true }>(`/quotations/${id}/accept`, { method: "POST" }),
  rejectQuotation: (id: string, reason?: string) =>
    request<{ ok: true }>(`/quotations/${id}/reject`, {
      method: "POST",
      json: reason ? { reason } : {},
    }),
  convertQuotation: (id: string) =>
    request<{ ok: true; invoiceId: string }>(`/quotations/${id}/convert`, { method: "POST" }),

  listProformaInvoices: () =>
    request<{ proformaInvoices: ProformaInvoiceListRow[] }>("/proforma-invoices"),
  getProformaInvoice: (id: string) =>
    request<{
      proformaInvoice: ProformaInvoiceDetail;
      lines: ProformaInvoiceLine[];
      customer: Customer | null;
    }>(`/proforma-invoices/${id}`),
  createProformaInvoice: (body: CreateProformaInvoice) =>
    request<{ proformaInvoice: ProformaInvoiceDetail }>("/proforma-invoices", {
      method: "POST",
      json: body,
    }),
  sendProformaInvoice: (id: string) =>
    request<{ ok: true; proformaNumber: string }>(`/proforma-invoices/${id}/send`, {
      method: "POST",
    }),
  cancelProformaInvoice: (id: string, reason?: string) =>
    request<{ ok: true }>(`/proforma-invoices/${id}/cancel`, {
      method: "POST",
      json: reason ? { reason } : {},
    }),
  convertProformaInvoice: (id: string) =>
    request<{ ok: true; invoiceId: string }>(`/proforma-invoices/${id}/convert`, {
      method: "POST",
    }),
  deleteProformaInvoice: (id: string) =>
    request<{ ok: true }>(`/proforma-invoices/${id}`, { method: "DELETE" }),

  listCreditNotes: () => request<{ creditNotes: CreditNoteListRow[] }>("/credit-notes"),
  getCreditNote: (id: string) =>
    request<{
      creditNote: CreditNoteDetail;
      lines: CreditNoteLine[];
      customer: Customer | null;
      invoice: CreditNoteLinkedInvoice | null;
    }>(`/credit-notes/${id}`),
  createCreditNote: (body: CreateCreditNote) =>
    request<{ creditNote: CreditNoteDetail }>("/credit-notes", { method: "POST", json: body }),
  postCreditNote: (id: string) =>
    request<{ ok: true; creditNoteNumber: string; entryNumber: string; appliedCents: number }>(
      `/credit-notes/${id}/post`,
      { method: "POST" },
    ),

  listBills: () => request<{ bills: BillListRow[] }>("/bills"),
  getBill: (id: string) =>
    request<{ bill: BillDetail; lines: BillLine[]; charges: BillCharge[]; supplier: Supplier | null }>(`/bills/${id}`),
  createBill: (body: CreateBill) =>
    request<{ bill: BillDetail }>("/bills", { method: "POST", json: body }),
  postBill: (id: string) =>
    request<{ ok: true; internalReference: string; entryNumber: string }>(
      `/bills/${id}/post`,
      { method: "POST" },
    ),
  voidBill: (id: string, reason?: string) =>
    request<{ ok: true; reversalEntryNumber: string }>(`/bills/${id}/void`, {
      method: "POST",
      json: reason ? { reason } : {},
    }),

  listRecurringBills: () =>
    request<{ recurringBills: RecurringBillListRow[] }>("/recurring-bills"),
  getRecurringBill: (id: string) =>
    request<{
      recurringBill: RecurringBillDetail;
      lines: RecurringBillLine[];
      supplier: Supplier | null;
    }>(`/recurring-bills/${id}`),
  createRecurringBill: (body: CreateRecurringBill) =>
    request<{ recurringBill: RecurringBillDetail }>(`/recurring-bills`, {
      method: "POST",
      json: body,
    }),
  pauseRecurringBill: (id: string) =>
    request<{ ok: true }>(`/recurring-bills/${id}/pause`, { method: "POST" }),
  resumeRecurringBill: (id: string) =>
    request<{ ok: true }>(`/recurring-bills/${id}/resume`, { method: "POST" }),
  generateRecurringBillNow: (id: string) =>
    request<{ ok: true; billId: string }>(
      `/recurring-bills/${id}/generate-now`,
      { method: "POST" },
    ),
  deleteRecurringBill: (id: string) =>
    request<{ ok: true }>(`/recurring-bills/${id}`, { method: "DELETE" }),

  listRecurringJournals: () =>
    request<{ recurringJournals: RecurringJournalListRow[] }>("/recurring-journals"),
  getRecurringJournal: (id: string) =>
    request<{
      recurringJournal: RecurringJournalDetail;
      lines: RecurringJournalLine[];
    }>(`/recurring-journals/${id}`),
  createRecurringJournal: (body: CreateRecurringJournal) =>
    request<{ recurringJournal: RecurringJournalDetail }>(`/recurring-journals`, {
      method: "POST",
      json: body,
    }),
  updateRecurringJournal: (id: string, body: Partial<CreateRecurringJournal> & { isActive?: boolean }) =>
    request<{ ok: true }>(`/recurring-journals/${id}`, { method: "PATCH", json: body }),
  pauseRecurringJournal: (id: string) =>
    request<{ ok: true }>(`/recurring-journals/${id}/pause`, { method: "POST" }),
  resumeRecurringJournal: (id: string) =>
    request<{ ok: true }>(`/recurring-journals/${id}/resume`, { method: "POST" }),
  generateRecurringJournalNow: (id: string) =>
    request<{
      ok: true;
      entryId?: string;
      entryNumber?: string;
      draftId?: string;
    }>(`/recurring-journals/${id}/generate-now`, { method: "POST" }),
  deleteRecurringJournal: (id: string) =>
    request<{ ok: true }>(`/recurring-journals/${id}`, { method: "DELETE" }),

  listPurchaseOrders: () => request<{ purchaseOrders: PurchaseOrderListRow[] }>("/purchase-orders"),
  getPurchaseOrder: (id: string) =>
    request<{ purchaseOrder: PurchaseOrderDetail; lines: PurchaseOrderLine[]; supplier: Supplier | null }>(
      `/purchase-orders/${id}`,
    ),
  createPurchaseOrder: (body: CreatePurchaseOrder) =>
    request<{ purchaseOrder: PurchaseOrderDetail }>("/purchase-orders", { method: "POST", json: body }),
  sendPurchaseOrder: (id: string) =>
    request<{ ok: true; poNumber: string }>(`/purchase-orders/${id}/send`, { method: "POST" }),
  acknowledgePurchaseOrder: (id: string, supplierReference?: string) =>
    request<{ ok: true }>(`/purchase-orders/${id}/acknowledge`, {
      method: "POST",
      json: supplierReference ? { supplierReference } : {},
    }),
  cancelPurchaseOrder: (id: string, reason?: string) =>
    request<{ ok: true }>(`/purchase-orders/${id}/cancel`, {
      method: "POST",
      json: reason ? { reason } : {},
    }),
  convertPurchaseOrder: (id: string) =>
    request<{ ok: true; billId: string }>(`/purchase-orders/${id}/convert`, { method: "POST" }),

  listDebitNotes: () => request<{ debitNotes: DebitNoteListRow[] }>("/debit-notes"),
  getDebitNote: (id: string) =>
    request<{
      debitNote: DebitNoteDetail;
      lines: DebitNoteLine[];
      supplier: Supplier | null;
      bill: DebitNoteLinkedBill | null;
    }>(`/debit-notes/${id}`),
  createDebitNote: (body: CreateDebitNote) =>
    request<{ debitNote: DebitNoteDetail }>("/debit-notes", { method: "POST", json: body }),
  postDebitNote: (id: string) =>
    request<{ ok: true; internalReference: string; entryNumber: string; appliedCents: number }>(
      `/debit-notes/${id}/post`,
      { method: "POST" },
    ),

  dashboard: () => request<Dashboard>("/dashboard"),

  trialBalance: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const q = params.toString();
    return request<TrialBalance>(`/reports/trial-balance${q ? `?${q}` : ""}`);
  },

  profitLoss: (from?: string, to?: string, compare?: string) => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (compare) params.set("compare", compare);
    const q = params.toString();
    return request<ProfitLoss>(`/reports/profit-loss${q ? `?${q}` : ""}`);
  },

  balanceSheet: (asOf?: string) => {
    const qs = asOf ? `?asOf=${asOf}` : "";
    return request<BalanceSheet>(`/reports/balance-sheet${qs}`);
  },

  generalLedger: (accountId: string, from?: string, to?: string) => {
    const params = new URLSearchParams({ accountId });
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return request<GeneralLedger>(`/reports/general-ledger?${params.toString()}`);
  },

  vatReturn: (from: string, to: string) => {
    const params = new URLSearchParams({ from, to });
    return request<VatReturn>(`/reports/vat-return?${params.toString()}`);
  },

  cashFlow: (from: string, to: string) => {
    const params = new URLSearchParams({ from, to });
    return request<CashFlow>(`/reports/cash-flow?${params.toString()}`);
  },

  arAging: () => request<AgingDetailReport>("/reports/ar-aging"),
  apAging: () => request<AgingDetailReport>("/reports/ap-aging"),

  threeWayMatch: (filter?: { status?: ThreeWayMatchFilter; from?: string; to?: string }) => {
    const params = new URLSearchParams();
    if (filter?.status) params.set("status", filter.status);
    if (filter?.from) params.set("from", filter.from);
    if (filter?.to) params.set("to", filter.to);
    const q = params.toString();
    return request<ThreeWayMatchReport>(`/reports/three-way-match${q ? `?${q}` : ""}`);
  },

  listBankImports: () => request<{ imports: BankImportRow[] }>("/bank-reconciliation/imports"),
  getBankImport: (id: string) =>
    request<{
      import: BankImportDetail;
      bank: Account | null;
      lines: BankStatementLineRow[];
    }>(`/bank-reconciliation/imports/${id}`),
  createBankImport: (body: CreateBankImport) =>
    request<{ import: BankImportDetail; issues: string[] }>(
      "/bank-reconciliation/imports",
      { method: "POST", json: body },
    ),
  autoMatchBankImport: (id: string) =>
    request<{
      ok: true;
      autoMatched: number;
      multipleCandidates: number;
      totalLines: number;
      matchedLines: number;
    }>(`/bank-reconciliation/imports/${id}/auto-match`, { method: "POST" }),
  unmatchBankLine: (id: string) =>
    request<{ ok: true }>(`/bank-reconciliation/lines/${id}/unmatch`, { method: "POST" }),
  reconcileBankImport: (id: string) =>
    request<{ ok: true }>(`/bank-reconciliation/imports/${id}/reconcile`, { method: "POST" }),

  getOpeningBalance: () => request<OpeningBalanceState>("/opening-balance"),
  postOpeningBalance: (body: {
    asOfDate: string;
    lines: Array<{
      accountCode: string;
      drCents?: number;
      crCents?: number;
      description?: string;
    }>;
  }) =>
    request<{ ok: true; entryId: string; entryNumber: string }>("/opening-balance", {
      method: "POST",
      json: body,
    }),

  whtSummary: () => request<WhtSummary>("/wht"),
  remitWht: (body: {
    bankAccountId: string;
    amountCents: number;
    paymentDate?: string;
    reference?: string;
    memo?: string;
  }) =>
    request<{ ok: true; entryId: string; entryNumber: string }>("/wht/remit", {
      method: "POST",
      json: body,
    }),

  listPeriods: () => request<{ periods: FiscalPeriod[] }>("/periods"),
  softClosePeriod: (id: string, reason: string) =>
    request<{ ok: true }>(`/periods/${id}/soft-close`, { method: "POST", json: { reason } }),
  reopenPeriod: (id: string, reason: string) =>
    request<{ ok: true }>(`/periods/${id}/reopen`, { method: "POST", json: { reason } }),
  closeFiscalYear: (body: { fiscalYear: number; reason: string; retainedEarningsAccountId: string }) =>
    request<{
      ok: true;
      closingEntryId: string | null;
      closingEntryNumber: string | null;
      incomeClosedCents: number;
      expenseClosedCents: number;
      netProfitCents: number;
    }>(`/periods/close-year`, { method: "POST", json: body }),

  getSettings: () => request<TenantSettingsResponse>("/settings"),
  updateSettings: (body: Partial<TenantSettings>) =>
    request<TenantSettingsResponse>("/settings", { method: "PATCH", json: body }),

  listFxRates: (filter?: { from?: string; to?: string }) => {
    const qs = new URLSearchParams();
    if (filter?.from) qs.set("from", filter.from);
    if (filter?.to) qs.set("to", filter.to);
    const s = qs.toString();
    return request<{ rates: FxRate[] }>(`/fx-rates${s ? `?${s}` : ""}`);
  },
  createFxRate: (body: CreateFxRate) =>
    request<{ rate: FxRate }>("/fx-rates", { method: "POST", json: body }),
  deleteFxRate: (id: string) =>
    request<void>(`/fx-rates/${id}`, { method: "DELETE" }),

  listFxRevaluations: () =>
    request<{ revaluations: FxRevaluation[] }>("/fx-revaluations"),
  getFxRevaluation: (id: string) =>
    request<{ revaluation: FxRevaluation; lines: FxRevaluationLine[] }>(
      `/fx-revaluations/${id}`,
    ),
  createFxRevaluation: (body: { asOfDate: string; notes?: string }) =>
    request<{ revaluation: FxRevaluation; lineCount: number }>("/fx-revaluations", {
      method: "POST",
      json: body,
    }),
  postFxRevaluation: (id: string) =>
    request<{ journalEntryId: string; entryNumber: string }>(
      `/fx-revaluations/${id}/post`,
      { method: "POST" },
    ),
  voidFxRevaluation: (id: string, body?: { reason?: string; reversalDate?: string }) =>
    request<{ voidJournalEntryId: string; entryNumber: string }>(
      `/fx-revaluations/${id}/void`,
      { method: "POST", json: body ?? {} },
    ),
  deleteFxRevaluation: (id: string) =>
    request<void>(`/fx-revaluations/${id}`, { method: "DELETE" }),

  listNumberSeries: () => request<{ series: NumberSeries[] }>("/number-series"),
  getNumberSeries: (name: string) =>
    request<{ series: NumberSeries }>(`/number-series/${name}`),
  updateNumberSeries: (name: string, body: UpdateNumberSeries) =>
    request<{ ok: true }>(`/number-series/${name}`, { method: "PATCH", json: body }),
  previewNumberSeries: (body: PreviewNumberSeries) =>
    request<{ preview: string }>("/number-series/preview", { method: "POST", json: body }),

  listNotifications: (limit?: number) => {
    const qs = limit ? `?limit=${limit}` : "";
    return request<{ notifications: AppNotification[] }>(`/notifications${qs}`);
  },
  notificationUnreadCount: () =>
    request<{ count: number }>("/notifications/unread-count"),
  readNotification: (id: string) =>
    request<{ ok: true }>(`/notifications/${id}/read`, { method: "POST" }),
  readAllNotifications: () =>
    request<{ ok: true; markedRead: number }>("/notifications/read-all", { method: "POST" }),
  listNotificationPreferences: () =>
    request<{ preferences: NotificationPreference[] }>("/notifications/preferences"),
  updateNotificationPreference: (kind: string, enabled: boolean) =>
    request<{ ok: true; kind: string; enabled: boolean }>(
      `/notifications/preferences/${encodeURIComponent(kind)}`,
      { method: "PATCH", json: { enabled } },
    ),

  // Approval policies (roadmap #26)
  listApprovalPolicies: () =>
    request<{ policies: ApprovalPolicy[] }>("/approval-policies"),
  createApprovalPolicy: (body: CreateApprovalPolicy) =>
    request<{ policy: ApprovalPolicy }>("/approval-policies", { method: "POST", json: body }),
  updateApprovalPolicy: (id: string, body: Partial<CreateApprovalPolicy>) =>
    request<{ policy: ApprovalPolicy }>(`/approval-policies/${id}`, { method: "PATCH", json: body }),
  deleteApprovalPolicy: (id: string) =>
    request<{ ok: true }>(`/approval-policies/${id}`, { method: "DELETE" }),

  // Roles + user-role assignment (roadmap #27)
  listRoles: () => request<{ roles: AppRole[] }>("/roles"),
  createRole: (body: CreateAppRole) =>
    request<{ role: AppRole }>("/roles", { method: "POST", json: body }),
  updateRole: (id: string, body: Partial<CreateAppRole>) =>
    request<{ role: AppRole }>(`/roles/${id}`, { method: "PATCH", json: body }),
  deleteRole: (id: string) => request<{ ok: true }>(`/roles/${id}`, { method: "DELETE" }),
  listUsersWithRoles: () => request<{ users: UserWithRoles[] }>("/roles/users"),
  assignRole: (userId: string, roleId: string) =>
    request<{ ok: true }>(`/roles/users/${userId}/roles`, {
      method: "POST",
      json: { roleId },
    }),
  unassignRole: (userId: string, roleId: string) =>
    request<{ ok: true }>(`/roles/users/${userId}/roles/${roleId}`, { method: "DELETE" }),

  // Audit log viewer (read-only).
  listAuditEvents: (filters: AuditLogFilters = {}) => {
    const qs = new URLSearchParams();
    if (filters.from) qs.set("from", filters.from);
    if (filters.to) qs.set("to", filters.to);
    if (filters.kind) qs.set("kind", filters.kind);
    if (filters.actorUserId) qs.set("actorUserId", filters.actorUserId);
    if (filters.refType) qs.set("refType", filters.refType);
    if (filters.refId) qs.set("refId", filters.refId);
    if (filters.limit !== undefined) qs.set("limit", String(filters.limit));
    if (filters.offset !== undefined) qs.set("offset", String(filters.offset));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<AuditLogListResponse>(`/audit-log${suffix}`);
  },
  listAuditKinds: () =>
    request<{ kinds: AuditKindBucket[] }>("/audit-log/kinds"),
  getAuditEvent: (id: string) =>
    request<{ event: AuditEvent }>(`/audit-log/${id}`),

  listStock: () =>
    request<{ balances: StockBalanceRow[]; totalValueCents: number }>("/stock"),
  stockLedger: (itemId: string) =>
    request<{ movements: StockLedgerMovement[] }>(`/stock/ledger?itemId=${itemId}`),
  lowStock: () =>
    request<{ items: LowStockItem[]; count: number }>("/stock/low-stock"),
  listWarehouses: () =>
    request<{ warehouses: WarehouseRow[] }>("/stock/warehouses"),

  listStockTransfers: () =>
    request<{ transfers: StockTransferListRow[] }>("/stock-transfers"),
  getStockTransfer: (id: string) =>
    request<{
      transfer: StockTransferDetail;
      lines: StockTransferLineRow[];
      source: StockTransferWarehouse | null;
      destination: StockTransferWarehouse | null;
    }>(`/stock-transfers/${id}`),
  createStockTransfer: (body: CreateStockTransfer) =>
    request<{ transfer: StockTransferDetail }>("/stock-transfers", {
      method: "POST",
      json: body,
    }),
  dispatchStockTransfer: (id: string) =>
    request<{ ok: true; transferNumber: string }>(
      `/stock-transfers/${id}/dispatch`,
      { method: "POST" },
    ),
  receiveStockTransfer: (
    id: string,
    body: { lines: Array<{ lineId: string; quantityReceived: number }>; notes?: string },
  ) =>
    request<{ ok: true; hasDiscrepancy: boolean }>(
      `/stock-transfers/${id}/receive`,
      { method: "POST", json: body },
    ),
  cancelStockTransfer: (id: string, reason?: string) =>
    request<{ ok: true }>(`/stock-transfers/${id}/cancel`, {
      method: "POST",
      json: reason ? { reason } : {},
    }),

  listStockCounts: () =>
    request<{ counts: StockCountListRow[] }>("/stock-counts"),
  getStockCount: (id: string) =>
    request<{ count: StockCountDetail }>(`/stock-counts/${id}`),
  createStockCount: (body: CreateStockCount) =>
    request<{ id: string }>("/stock-counts", { method: "POST", json: body }),
  updateStockCountLines: (
    id: string,
    body: { lines: Array<{ lineId: string; countedQty: number }> },
  ) =>
    request<{ ok: true }>(`/stock-counts/${id}/lines`, {
      method: "PATCH",
      json: body,
    }),
  reviewStockCount: (
    id: string,
    body: {
      reasons?: Array<{
        lineId: string;
        reasonCode: StockCountReasonCode;
        notes?: string;
      }>;
    },
  ) =>
    request<{
      status: StockCountStatus;
      maxVarianceBps: number | null;
      totalVarianceValueCents: number | null;
      requiresApproval: boolean;
    }>(`/stock-counts/${id}/review`, { method: "POST", json: body }),
  approveStockCount: (id: string) =>
    request<{ ok: true }>(`/stock-counts/${id}/approve`, { method: "POST" }),
  postStockCount: (id: string) =>
    request<{ ok: true; countNumber: string | null; journalEntryId: string | null }>(
      `/stock-counts/${id}/post`,
      { method: "POST" },
    ),
  cancelStockCount: (id: string, reason?: string) =>
    request<{ ok: true }>(`/stock-counts/${id}/cancel`, {
      method: "POST",
      json: reason ? { reason } : {},
    }),

  listEmployees: (q?: string) =>
    request<{ employees: EmployeeListRow[] }>(
      `/employees${q ? `?q=${encodeURIComponent(q)}` : ""}`,
    ),
  getEmployee: (id: string) => request<{ employee: Employee }>(`/employees/${id}`),
  createEmployee: (body: CreateEmployee) =>
    request<{ employee: Employee }>("/employees", { method: "POST", json: body }),
  exitEmployee: (
    id: string,
    body: {
      exitDate: string;
      lastWorkingDay?: string;
      noticePeriodDays?: number;
      statusAfter?: "resigned" | "terminated" | "retired" | "deceased";
      reason?: string;
    },
  ) =>
    request<{ employee: Employee }>(`/employees/${id}/exit`, {
      method: "POST",
      json: body,
    }),
  confirmProbation: (
    id: string,
    body: { confirmationDate: string; notes?: string },
  ) =>
    request<{ employee: Employee }>(`/employees/${id}/confirm-probation`, {
      method: "POST",
      json: body,
    }),
  getSalaryStructure: (employeeId: string) =>
    request<{ employee: Employee; structure: EmployeeStructureRow[] }>(
      `/employees/${employeeId}/salary-structure`,
    ),
  putSalaryStructure: (
    employeeId: string,
    body: {
      effectiveFrom: string;
      items: Array<{ componentId: string; amountCents: number; percentBps?: number; notes?: string }>;
    },
  ) =>
    request<{ ok: true; count: number }>(`/employees/${employeeId}/salary-structure`, {
      method: "PUT",
      json: body,
    }),

  listSalaryRevisions: (employeeId: string) =>
    request<{ revisions: SalaryRevision[] }>(
      `/employees/${employeeId}/salary-revisions`,
    ),
  createSalaryRevision: (
    employeeId: string,
    body: {
      effectiveDate: string;
      newBasicSalaryCents: number;
      reason?: string;
      notes?: string;
    },
  ) =>
    request<{ revision: SalaryRevision }>(
      `/employees/${employeeId}/salary-revisions`,
      { method: "POST", json: body },
    ),

  listLoanTypes: () => request<{ loanTypes: LoanType[] }>("/loan-types"),
  createLoanType: (body: CreateLoanType) =>
    request<{ loanType: LoanType }>("/loan-types", { method: "POST", json: body }),
  updateLoanType: (id: string, body: Partial<CreateLoanType> & { isActive?: boolean }) =>
    request<{ loanType: LoanType }>(`/loan-types/${id}`, { method: "PATCH", json: body }),

  listEmployeeLoans: () =>
    request<{ loans: EmployeeLoanRow[] }>("/employee-loans"),
  getEmployeeLoan: (id: string) =>
    request<{ loan: EmployeeLoanRow; schedule: LoanScheduleRow[] }>(`/employee-loans/${id}`),
  listEmployeeLoansForEmployee: (employeeId: string) =>
    request<{ loans: EmployeeLoan[] }>(`/employee-loans/by-employee/${employeeId}`),
  applyEmployeeLoan: (body: {
    employeeId: string;
    loanTypeId?: string | null;
    principalCents: number;
    interestRateBps: number;
    tenureMonths: number;
    firstInstallmentDate?: string;
    applicationReason?: string;
    notes?: string;
  }) => request<{ loan: EmployeeLoan }>("/employee-loans/apply", { method: "POST", json: body }),
  approveEmployeeLoan: (id: string, body?: { approvalNotes?: string }) =>
    request<{ loan: EmployeeLoan }>(`/employee-loans/${id}/approve`, {
      method: "POST",
      json: body ?? {},
    }),
  disburseEmployeeLoan: (
    id: string,
    body: {
      disbursementDate: string;
      disbursementAccountId: string;
      firstInstallmentDate?: string;
    },
  ) =>
    request<{ loan: EmployeeLoan; loanNumber: string }>(
      `/employee-loans/${id}/disburse`,
      { method: "POST", json: body },
    ),
  cancelEmployeeLoan: (id: string, body?: { reason?: string }) =>
    request<{ loan: EmployeeLoan }>(`/employee-loans/${id}/cancel`, {
      method: "POST",
      json: body ?? {},
    }),
  writeOffEmployeeLoan: (id: string, body: { reason: string }) =>
    request<{ loan: EmployeeLoan }>(`/employee-loans/${id}/write-off`, {
      method: "POST",
      json: body,
    }),

  // Bonus schemes
  listBonusSchemes: () => request<{ schemes: BonusScheme[] }>("/bonus-schemes"),
  createBonusScheme: (body: CreateBonusScheme) =>
    request<{ scheme: BonusScheme }>("/bonus-schemes", { method: "POST", json: body }),
  updateBonusScheme: (id: string, body: Partial<CreateBonusScheme>) =>
    request<{ scheme: BonusScheme }>(`/bonus-schemes/${id}`, {
      method: "PATCH",
      json: body,
    }),

  // Bonus runs
  listBonusRuns: () => request<{ runs: BonusRunRow[] }>("/bonus-runs"),
  getBonusRun: (id: string) =>
    request<{ run: BonusRunRow; lines: BonusRunLine[] }>(`/bonus-runs/${id}`),
  createBonusRun: (body: CreateBonusRun) =>
    request<{ runId: string }>("/bonus-runs", { method: "POST", json: body }),
  adjustBonusRunLine: (
    runId: string,
    lineId: string,
    body: { bonusGrossCents: number; notes?: string },
  ) =>
    request<{ ok: true }>(`/bonus-runs/${runId}/lines/${lineId}`, {
      method: "PATCH",
      json: body,
    }),
  postBonusRun: (id: string) =>
    request<{ runId: string; journalEntryId: string }>(`/bonus-runs/${id}/post`, {
      method: "POST",
    }),
  voidBonusRun: (id: string, body: { reason: string }) =>
    request<{ runId: string }>(`/bonus-runs/${id}/void`, { method: "POST", json: body }),
  deleteBonusRun: (id: string) =>
    request<{ ok: true }>(`/bonus-runs/${id}`, { method: "DELETE" }),

  // Expense categories
  listExpenseCategories: () =>
    request<{ categories: ExpenseCategory[] }>("/expense-categories"),
  createExpenseCategory: (body: CreateExpenseCategory) =>
    request<{ category: ExpenseCategory }>("/expense-categories", {
      method: "POST",
      json: body,
    }),
  updateExpenseCategory: (
    id: string,
    body: Partial<CreateExpenseCategory> & { isActive?: boolean },
  ) =>
    request<{ category: ExpenseCategory }>(`/expense-categories/${id}`, {
      method: "PATCH",
      json: body,
    }),
  deleteExpenseCategory: (id: string) =>
    request<{ ok: true }>(`/expense-categories/${id}`, { method: "DELETE" }),

  // Expense claims
  listExpenseClaims: () => request<{ claims: ExpenseClaimRow[] }>("/expense-claims"),
  getExpenseClaim: (id: string) =>
    request<{ claim: ExpenseClaimRow }>(`/expense-claims/${id}`),
  createExpenseClaim: (body: CreateExpenseClaim) =>
    request<{ claim: ExpenseClaim }>("/expense-claims", {
      method: "POST",
      json: body,
    }),
  updateExpenseClaim: (id: string, body: UpdateExpenseClaim) =>
    request<{ claim: ExpenseClaim }>(`/expense-claims/${id}`, {
      method: "PATCH",
      json: body,
    }),
  submitExpenseClaim: (id: string) =>
    request<{ claim: ExpenseClaim }>(`/expense-claims/${id}/submit`, {
      method: "POST",
    }),
  approveExpenseClaim: (id: string) =>
    request<{ claim: ExpenseClaim }>(`/expense-claims/${id}/approve`, {
      method: "POST",
      json: {},
    }),
  approveAndPayExpenseClaim: (id: string, body: ApproveAndPayExpenseClaim) =>
    request<{ claim: ExpenseClaim }>(`/expense-claims/${id}/approve-and-pay`, {
      method: "POST",
      json: body,
    }),
  rejectExpenseClaim: (id: string, body: { reason: string }) =>
    request<{ claim: ExpenseClaim }>(`/expense-claims/${id}/reject`, {
      method: "POST",
      json: body,
    }),
  voidExpenseClaim: (id: string, body?: { reason?: string }) =>
    request<{ claim: ExpenseClaim }>(`/expense-claims/${id}/void`, {
      method: "POST",
      json: body ?? {},
    }),
  listExpenseClaimsByEmployee: (employeeId: string) =>
    request<{ claims: ExpenseClaim[]; ytdCents: number; year: number }>(
      `/expense-claims/by-employee/${employeeId}`,
    ),

  listLeaveTypes: () => request<{ leaveTypes: LeaveType[] }>("/leave-types"),
  createLeaveType: (body: CreateLeaveType) =>
    request<{ leaveType: LeaveType }>("/leave-types", { method: "POST", json: body }),
  updateLeaveType: (id: string, body: Partial<CreateLeaveType> & { isActive?: boolean }) =>
    request<{ leaveType: LeaveType }>(`/leave-types/${id}`, { method: "PATCH", json: body }),

  getEmployeeLeaveBalance: (employeeId: string, year?: number) => {
    const qs = year ? `?year=${year}` : "";
    return request<{ year: number; balances: EmployeeLeaveBalance[] }>(
      `/employees/${employeeId}/leave-balance${qs}`,
    );
  },
  upsertLeaveAllocation: (
    employeeId: string,
    body: { leaveTypeId: string; periodYear: number; allocatedDays: number; carriedForwardDays?: number },
  ) =>
    request<{ ok: true }>(`/employees/${employeeId}/leave-allocations`, {
      method: "POST",
      json: body,
    }),

  listLeaveRequests: (filter?: { status?: string; employeeId?: string }) => {
    const params = new URLSearchParams();
    if (filter?.status) params.set("status", filter.status);
    if (filter?.employeeId) params.set("employeeId", filter.employeeId);
    const qs = params.toString();
    return request<{ leaveRequests: LeaveRequestListRow[] }>(`/leave-requests${qs ? `?${qs}` : ""}`);
  },
  getLeaveRequest: (id: string) =>
    request<{
      leaveRequest: LeaveRequestDetail;
      employee: Employee | null;
      leaveType: LeaveType | null;
    }>(`/leave-requests/${id}`),
  createLeaveRequest: (body: CreateLeaveRequest) =>
    request<{ leaveRequest: LeaveRequestDetail }>("/leave-requests", { method: "POST", json: body }),
  submitLeaveRequest: (id: string) =>
    request<{ ok: true }>(`/leave-requests/${id}/submit`, { method: "POST" }),
  approveLeaveRequest: (id: string) =>
    request<{ ok: true }>(`/leave-requests/${id}/approve`, { method: "POST" }),
  rejectLeaveRequest: (id: string, reason?: string) =>
    request<{ ok: true }>(`/leave-requests/${id}/reject`, {
      method: "POST",
      json: reason ? { reason } : {},
    }),
  cancelLeaveRequest: (id: string) =>
    request<{ ok: true }>(`/leave-requests/${id}/cancel`, { method: "POST" }),

  listSalaryComponents: () =>
    request<{ components: SalaryComponent[] }>("/salary-components"),
  createSalaryComponent: (body: CreateSalaryComponent) =>
    request<{ component: SalaryComponent }>("/salary-components", {
      method: "POST",
      json: body,
    }),
  updateSalaryComponent: (id: string, body: Partial<CreateSalaryComponent> & { isActive?: boolean }) =>
    request<{ ok: true; component: SalaryComponent }>(`/salary-components/${id}`, {
      method: "PATCH",
      json: body,
    }),
  deleteSalaryComponent: (id: string) =>
    request<{ ok: true }>(`/salary-components/${id}`, { method: "DELETE" }),

  listPayrollRuns: () => request<{ runs: PayrollRun[] }>("/payroll-runs"),
  getPayrollRun: (id: string) =>
    request<{ run: PayrollRun; lines: PayrollRunLine[] }>(`/payroll-runs/${id}`),
  createPayrollRun: (body: {
    periodYear: number;
    periodMonth: number;
    payDate?: string;
    notes?: string;
  }) =>
    request<{ ok: true; runId: string }>("/payroll-runs", { method: "POST", json: body }),
  postPayrollRun: (id: string) =>
    request<{ ok: true; runNumber: string; entryNumber: string }>(
      `/payroll-runs/${id}/post`,
      { method: "POST" },
    ),
  payPayrollRun: (
    id: string,
    body: {
      bankAccountId: string;
      paymentDate?: string;
      method?: "bank_transfer" | "slips" | "cash" | "cheque" | "other";
      reference?: string;
      memo?: string;
    },
  ) =>
    request<{ ok: true; entryNumber: string }>(`/payroll-runs/${id}/pay`, {
      method: "POST",
      json: body,
    }),

  statutorySummary: () =>
    request<{ statutory: StatutoryBalance[] }>("/payroll/statutory-summary"),
  remitStatutory: (body: {
    which: "epf" | "etf" | "paye";
    bankAccountId: string;
    amountCents: number;
    paymentDate?: string;
    reference?: string;
    memo?: string;
  }) =>
    request<{ ok: true; entryId: string; entryNumber: string }>("/payroll/remit", {
      method: "POST",
      json: body,
    }),

  listPayments: () => request<{ payments: PaymentListRow[] }>("/payments"),
  createPayment: (body: CreatePayment) =>
    request<{
      ok: true;
      payment: Payment;
      paymentNumber: string;
      entryNumber: string;
    }>("/payments", { method: "POST", json: body }),

  listSupplierPayments: () =>
    request<{ payments: SupplierPaymentListRow[] }>("/supplier-payments"),
  createSupplierPayment: (body: CreateSupplierPayment) =>
    request<{
      ok: true;
      payment: SupplierPayment;
      paymentNumber: string;
      entryNumber: string;
    }>("/supplier-payments", { method: "POST", json: body }),

  listCheques: () => request<{ cheques: ChequeListRow[] }>("/cheques"),
  getCheque: (id: string) =>
    request<{
      cheque: Cheque;
      events: ChequeBounceEvent[];
      party: { id: string; name: string } | null;
      bankAccount: { code: string; name: string } | null;
    }>(`/cheques/${id}`),
  clearCheque: (id: string, clearedOn?: string) =>
    request<{ ok: true; entryNumber: string }>(`/cheques/${id}/clear`, {
      method: "POST",
      json: clearedOn ? { clearedOn } : {},
    }),
  bounceCheque: (
    id: string,
    body: {
      reasonCode: string;
      reasonDetails?: string;
      bankChargesCents?: number;
      bouncedOn?: string;
    },
  ) =>
    request<{ ok: true; entryNumber: string; bounceNumber: number }>(
      `/cheques/${id}/bounce`,
      { method: "POST", json: body },
    ),
  reissueCheque: (
    id: string,
    body: { newChequeNumber: string; newChequeDate: string; memo?: string },
  ) =>
    request<{ ok: true; newChequeId: string }>(`/cheques/${id}/reissue`, {
      method: "POST",
      json: body,
    }),
  flagStaleCheques: () =>
    request<{
      flagged: number;
      cheques: Array<{
        id: string;
        chequeNumber: string;
        direction: "received" | "issued";
        amountCents: number;
        staleAt: string;
      }>;
    }>(`/cheques/flag-stale`, { method: "POST" }),

  // Final settlement (payroll-module-spec §9) ------------------------------
  computeFinalSettlement: (
    employeeId: string,
    body: { overrides?: FinalSettlementOverrides; notes?: string } = {},
  ) =>
    request<{ compute: FinalSettlementComputeResult }>(
      `/employees/${employeeId}/final-settlement/compute`,
      { method: "POST", json: body },
    ),
  createFinalSettlement: (
    employeeId: string,
    body: { overrides?: FinalSettlementOverrides; notes?: string } = {},
  ) =>
    request<{ settlement: FinalSettlementRow }>(
      `/employees/${employeeId}/final-settlement`,
      { method: "POST", json: body },
    ),
  listFinalSettlementsForEmployee: (employeeId: string) =>
    request<{ settlements: FinalSettlementRow[] }>(
      `/employees/${employeeId}/final-settlements`,
    ),
  listFinalSettlements: () =>
    request<{ settlements: FinalSettlementRow[] }>(`/final-settlements`),
  getFinalSettlement: (id: string) =>
    request<{ settlement: FinalSettlementRow }>(`/final-settlements/${id}`),
  patchFinalSettlement: (id: string, body: FinalSettlementPatch) =>
    request<{ ok: true; settlement: FinalSettlementRow }>(
      `/final-settlements/${id}`,
      { method: "PATCH", json: body },
    ),
  approveFinalSettlement: (id: string) =>
    request<{ ok: true; settlement: FinalSettlementRow }>(
      `/final-settlements/${id}/approve`,
      { method: "POST" },
    ),
  postFinalSettlement: (id: string) =>
    request<{
      ok: true;
      settlement: FinalSettlementRow;
      journalEntryNumber: string;
    }>(`/final-settlements/${id}/post`, { method: "POST" }),
  cancelFinalSettlement: (id: string, body: { reason?: string } = {}) =>
    request<{ ok: true; settlement: FinalSettlementRow }>(
      `/final-settlements/${id}/cancel`,
      { method: "POST", json: body },
    ),

  // ─── POS ───────────────────────────────────────────────────────────────
  getCurrentPosShift: () =>
    request<{ shift: PosShift | null }>("/pos/shifts/current"),
  listPosShifts: () => request<{ shifts: PosShift[] }>("/pos/shifts"),
  openPosShift: (body: OpenPosShift) =>
    request<{ shift: PosShift }>("/pos/shifts", { method: "POST", json: body }),
  closePosShift: (id: string, body: ClosePosShift) =>
    request<{
      ok: true;
      shift: PosShift;
      expectedCashCents: number;
      varianceCents: number;
    }>(`/pos/shifts/${id}/close`, { method: "POST", json: body }),
  getPosZReport: (id: string) =>
    request<PosZReport>(`/pos/shifts/${id}/z-report`),
  createPosSale: (body: CreatePosSale) =>
    request<{
      ok: true;
      invoiceId: string;
      invoiceNumber: string;
      totalCents: number;
      tenderedCents: number;
      changeCents: number;
      paymentIds: string[];
    }>("/pos/sales", { method: "POST", json: body }),

  // ─── Commissions ───────────────────────────────────────────────────────
  listCommissionRules: () =>
    request<{ rules: CommissionRule[] }>("/commissions/rules"),
  createCommissionRule: (body: CreateCommissionRule) =>
    request<{ rule: CommissionRule }>("/commissions/rules", {
      method: "POST",
      json: body,
    }),
  updateCommissionRule: (id: string, body: Partial<CreateCommissionRule>) =>
    request<{ rule: CommissionRule }>(`/commissions/rules/${id}`, {
      method: "PATCH",
      json: body,
    }),
  deleteCommissionRule: (id: string) =>
    request<{ ok: true }>(`/commissions/rules/${id}`, { method: "DELETE" }),
  listCommissionSalespeople: () =>
    request<{ salespeople: CommissionSalesperson[] }>(
      "/commissions/salespeople",
    ),
  upsertCommissionSalesperson: (body: UpsertCommissionSalesperson) =>
    request<{ salesperson: CommissionSalesperson }>(
      "/commissions/salespeople",
      { method: "PUT", json: body },
    ),
  deleteCommissionSalesperson: (userId: string) =>
    request<{ ok: true }>(`/commissions/salespeople/${userId}`, {
      method: "DELETE",
    }),
  listCommissionEarnings: (
    params: {
      salespersonUserId?: string;
      status?: CommissionEarningStatus;
      from?: string;
      to?: string;
    } = {},
  ) => {
    const qs = new URLSearchParams();
    if (params.salespersonUserId)
      qs.set("salespersonUserId", params.salespersonUserId);
    if (params.status) qs.set("status", params.status);
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    const query = qs.toString();
    return request<{ earnings: CommissionEarning[] }>(
      `/commissions/earnings${query ? `?${query}` : ""}`,
    );
  },
  getCommissionLedger: () =>
    request<{ ledger: CommissionLedgerRow[] }>("/commissions/ledger"),
};

export interface User {
  id: string;
  email: string;
  fullName: string;
  isOwner: boolean;
}

export interface Tenant {
  id: string;
  slug: string;
  businessName: string;
}

// Shape of the caller's permission envelope returned from /auth/me.
// `enforcementActive=false` means the tenant hasn't configured any
// role assignments yet — the UI should treat every permission as
// granted (matches the server's dormant-mode bypass).
export interface CallerPermissions {
  isOwner: boolean;
  enforcementActive: boolean;
  granted: Record<string, boolean>;
}

// Client-side mirror of the server's requirePermission() decision.
// Use wherever a UI element (Post button, Void button, settings tile)
// should conditionally render based on a specific permission key
// ("invoices.post", "bills.void", "accounting.manage", ...).
export function hasPermission(
  perms: CallerPermissions | null | undefined,
  key: string,
): boolean {
  if (!perms) return false;
  if (perms.isOwner) return true;
  if (!perms.enforcementActive) return true;
  return perms.granted[key] === true;
}

export interface Customer {
  id: string;
  code: string | null;
  name: string;
  legalName: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  country: string;
  tin: string | null;
  vatNo: string | null;
  paymentTermsDays: number;
  creditLimitCents: number;
  creditHold: boolean;
  creditHoldReason: string | null;
  creditHoldAt: string | null;
  currency: string;
  autoStatementEmail?: boolean;
  statementEmailDay?: number | null;
  isActive: boolean;
  createdAt: string;
}

export interface StatementEmailResult {
  customerId: string;
  customerName: string;
  status: "sent" | "failed" | "skipped";
  toEmail: string | null;
  error?: string;
  emailLogId?: string;
}

export interface StatementEmailHistoryEntry {
  id: string;
  to_email: string;
  cc_emails: string[];
  subject: string;
  statement_from: string | null;
  statement_to: string;
  opening_balance_cents: number;
  closing_balance_cents: number;
  transaction_count: number;
  status: "sent" | "failed" | "skipped";
  error_message: string | null;
  message_id: string | null;
  transport: "smtp" | "console";
  trigger_kind: "manual" | "scheduled";
  sent_at: string;
  triggered_by_email: string | null;
}

export interface CustomerCredit {
  creditLimitCents: number;
  openArCents: number;
  availableCents: number | null;
  utilizationPct: number | null;
  creditHold: boolean;
  creditHoldReason: string | null;
  creditHoldAt: string | null;
  bounceCount: number;
}

export interface PartyKpis {
  totalBilledCents: number;
  totalPaidCents: number;
  balanceDueCents: number;
  openCount: number;
  overdueCount: number;
  overdueCents: number;
}

export interface PartyAgingBucket {
  label: "current" | "0-30" | "30-60" | "60-90" | "90+";
  balanceCents: number;
  invoiceCount: number;
}

export interface CustomerDetail {
  customer: Customer;
  kpis: PartyKpis;
  aging: PartyAgingBucket[];
  invoices: Array<{
    id: string;
    invoiceNumber: string | null;
    status: InvoiceStatus;
    issueDate: string;
    dueDate: string;
    totalCents: number;
    balanceDueCents: number;
  }>;
  payments: Array<{
    id: string;
    paymentNumber: string | null;
    paymentDate: string;
    method: PaymentMethod;
    amountCents: number;
    reference: string | null;
    status: string;
  }>;
}

export interface CustomerStatementTransaction {
  kind: "invoice" | "payment";
  id: string;
  number: string | null;
  date: string;
  dueDate: string | null;
  description: string;
  debitCents: number;
  creditCents: number;
  runningBalanceCents: number;
}

export interface CustomerStatement {
  customer: Customer;
  asOfFrom: string;
  asOfTo: string;
  openingBalanceCents: number;
  closingBalanceCents: number;
  totalBilledCents: number;
  totalReceivedCents: number;
  transactions: CustomerStatementTransaction[];
  aging: PartyAgingBucket[];
}

export interface SupplierStatementTransaction {
  kind: "bill" | "payment";
  id: string;
  number: string | null;
  date: string;
  dueDate: string | null;
  description: string;
  debitCents: number;
  creditCents: number;
  runningBalanceCents: number;
}

export interface SupplierStatement {
  supplier: Supplier;
  asOfFrom: string;
  asOfTo: string;
  openingBalanceCents: number;
  closingBalanceCents: number;
  totalBilledCents: number;
  totalPaidCents: number;
  transactions: SupplierStatementTransaction[];
  aging: PartyAgingBucket[];
}

export interface SupplierReconcileRow {
  reference: string;
  amount: number;
  date?: string;
}

export type SupplierReconcileStatus =
  | "matched"
  | "amount_mismatch"
  | "only_in_ours"
  | "only_in_theirs";

export interface SupplierReconcileMatch {
  status: SupplierReconcileStatus;
  reference: string;
  theirAmountCents: number | null;
  theirDate: string | null;
  ourBillId: string | null;
  ourBillNumber: string | null;
  ourInternalReference: string | null;
  ourBalanceCents: number | null;
  diffCents: number | null;
}

export interface SupplierReconcileResult {
  supplier: { id: string; name: string };
  summary: {
    theirTotalCents: number;
    ourTotalCents: number;
    diffCents: number;
    matched: number;
    amountMismatch: number;
    onlyInOurs: number;
    onlyInTheirs: number;
  };
  results: SupplierReconcileMatch[];
}

export interface SupplierDetail {
  supplier: Supplier;
  kpis: PartyKpis;
  aging: PartyAgingBucket[];
  bills: Array<{
    id: string;
    internalReference: string | null;
    supplierBillNumber: string | null;
    status: BillStatus;
    billDate: string;
    dueDate: string;
    totalCents: number;
    balanceDueCents: number;
  }>;
  payments: Array<{
    id: string;
    paymentNumber: string | null;
    paymentDate: string;
    method: SupplierPaymentMethod;
    amountCents: number;
    reference: string | null;
    chequeNumber: string | null;
    status: string;
  }>;
}

export interface CreateCustomer {
  name: string;
  legalName?: string;
  code?: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  city?: string;
  postalCode?: string;
  tin?: string;
  vatNo?: string;
  brNo?: string;
  paymentTermsDays?: number;
  creditLimitCents?: number;
  currency?: string;
  notes?: string;
}

export interface Supplier {
  id: string;
  code: string | null;
  name: string;
  legalName: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  country: string;
  tin: string | null;
  vatNo: string | null;
  brNo: string | null;
  paymentTermsDays: number;
  currency: string;
  defaultWhtTaxCodeId: string | null;
  bankName: string | null;
  bankAccountNo: string | null;
  bankBranch: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface CreateSupplier {
  name: string;
  legalName?: string;
  code?: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  addressLine1?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  tin?: string;
  vatNo?: string;
  brNo?: string;
  paymentTermsDays?: number;
  currency?: string;
  defaultWhtTaxCodeId?: string;
  bankName?: string;
  bankAccountNo?: string;
  bankBranch?: string;
  notes?: string;
}

export interface Item {
  id: string;
  sku: string | null;
  name: string;
  description: string | null;
  itemType: "product" | "service" | "bundle";
  unit: string;
  sellPriceCents: number;
  buyPriceCents: number;
  currency: string;
  trackInventory: boolean;
  valuationMethod: "fifo" | "weighted_avg" | "standard";
  reorderPoint: number | null;
  isActive: boolean;
  createdAt: string;
}

export interface CreateItem {
  sku?: string;
  barcode?: string;
  name: string;
  description?: string;
  itemType?: "product" | "service" | "bundle";
  unit?: string;
  sellPriceCents?: number;
  buyPriceCents?: number;
  currency?: string;
  trackInventory?: boolean;
  valuationMethod?: "fifo" | "weighted_avg" | "standard";
  reorderPoint?: number;
  taxCodeId?: string;
}

export interface Account {
  id: string;
  code: string;
  name: string;
  accountType: "asset" | "liability" | "equity" | "income" | "expense";
  accountSubtype: string | null;
  normalSide: "dr" | "cr";
  isSystem: boolean;
  isActive: boolean;
  // Currency of the account. Non-LKR only meaningful for bank/cash
  // accounts in v1 — every other account type posts in LKR.
  currency: string;
}

export interface Branch {
  id: string;
  code: string;
  name: string;
  isHeadOffice: boolean;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  postalCode: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBranch {
  code: string;
  name: string;
  isHeadOffice?: boolean;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  postalCode?: string;
  phone?: string;
}

export interface UpdateBranch extends Partial<CreateBranch> {
  isActive?: boolean;
}

export interface JournalEntryListRow {
  id: string;
  entryNumber: string;
  entryDate: string;
  memo: string | null;
  sourceType: string | null;
  sourceId: string | null;
  isReversed: boolean;
  postedAt: string;
  totalCents: number;
  lineCount: number;
}

export interface JournalEntryHeader {
  id: string;
  entryNumber: string;
  entryDate: string;
  memo: string | null;
  sourceType: string | null;
  sourceId: string | null;
  isReversed: boolean;
  postedAt: string;
}

export interface JournalEntryLine {
  id: string;
  lineNo: number;
  accountId: string;
  accountCode: string;
  accountName: string;
  drCents: number;
  crCents: number;
  description: string | null;
  customerId: string | null;
  customerName: string | null;
  supplierId: string | null;
  supplierName: string | null;
}

export interface CreateJournalEntryLine {
  accountId: string;
  drCents?: number;
  crCents?: number;
  description?: string;
  customerId?: string;
  supplierId?: string;
}

export interface CreateJournalEntry {
  entryDate: string;
  memo?: string;
  lines: CreateJournalEntryLine[];
}

export type CreateJournalEntryResponse =
  | { ok: true; status: "posted"; entryId: string; entryNumber: string }
  | {
      ok: true;
      status: "pending_approval";
      draftId: string;
      thresholdCents: number;
      totalCents: number;
    };

export type JournalDraftStatus = "pending_approval" | "approved" | "rejected";

export interface JournalDraftLinePayload {
  accountId: string;
  drCents: number;
  crCents: number;
  description?: string | null;
  customerId?: string | null;
  supplierId?: string | null;
}

export interface JournalEntryDraft {
  id: string;
  entryDate: string;
  memo: string | null;
  totalCents: number;
  payload: { lines: JournalDraftLinePayload[] };
  status: JournalDraftStatus;
  createdByUserId: string | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  rejectedByUserId: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  postedJournalEntryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type FixedAssetCategory =
  | "vehicle"
  | "equipment"
  | "furniture"
  | "building"
  | "it_hardware"
  | "software"
  | "land"
  | "other";

export type FixedAssetStatus = "active" | "disposed" | "written_off";

export interface FixedAssetRow {
  id: string;
  code: string | null;
  name: string;
  category: FixedAssetCategory;
  assetAccountId: string | null;
  accumulatedDepreciationAccountId: string | null;
  depreciationExpenseAccountId: string | null;
  acquisitionDate: string;
  depreciationStartDate: string;
  costCents: number;
  salvageCents: number;
  usefulLifeMonths: number;
  depreciationMethod: "straight_line";
  accumulatedDepreciationCents: number;
  netBookValueCents: number;
  lastDepreciationRunDate: string | null;
  status: FixedAssetStatus;
  supplierId: string | null;
  billId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FixedAssetDepreciationEntry {
  id: string;
  fixedAssetId: string;
  runDate: string;
  periodYear: number;
  periodMonth: number;
  depreciationCents: number;
  accumulatedAfterCents: number;
  journalEntryId: string | null;
  createdAt: string;
}

export interface CreateFixedAsset {
  code?: string;
  name: string;
  category?: FixedAssetCategory;
  acquisitionDate: string;
  depreciationStartDate?: string;
  costCents: number;
  salvageCents?: number;
  usefulLifeMonths: number;
  assetAccountId?: string;
  accumulatedDepreciationAccountId?: string;
  depreciationExpenseAccountId?: string;
  supplierId?: string;
  billId?: string;
  notes?: string;
}

export type InvoiceStatus = "draft" | "posted" | "partially_paid" | "paid" | "void" | "written_off";
export type BillStatus = InvoiceStatus;

export interface BillListRow {
  id: string;
  internalReference: string | null;
  supplierBillNumber: string | null;
  status: BillStatus;
  billDate: string;
  dueDate: string;
  supplierId: string;
  supplierName: string;
  currency: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  balanceDueCents: number;
  createdAt: string;
}

export interface BillDetail {
  id: string;
  internalReference: string | null;
  supplierBillNumber: string | null;
  supplierId: string;
  branchId: string | null;
  status: BillStatus;
  billDate: string;
  dueDate: string;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  chargesTotalCents: number;
  chargeAllocationMethod: BillChargeAllocationMethod;
  totalCents: number;
  amountPaidCents: number;
  balanceDueCents: number;
  notes: string | null;
  journalEntryId: string | null;
  postedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type BillChargeKind =
  | "freight"
  | "insurance"
  | "customs"
  | "clearing"
  | "loading"
  | "other";

export type BillChargeAllocationMethod = "value" | "quantity";

export interface BillCharge {
  id: string;
  lineNo: number;
  kind: BillChargeKind;
  description: string | null;
  amountCents: number;
}

export interface CreateBillCharge {
  kind: BillChargeKind;
  description?: string;
  amountCents: number;
}

export interface BillLine {
  id: string;
  lineNo: number;
  itemId: string | null;
  description: string;
  quantity: string;
  unitPriceCents: number;
  lineSubtotalCents: number;
  discountPctBps: number;
  discountCents: number;
  taxCodeId: string | null;
  taxRateBps: number;
  taxCents: number;
  lineTotalCents: number;
  expenseAccountId: string | null;
}

export interface CreateBillLine {
  itemId?: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountPctBps?: number;
  taxCodeId?: string;
  expenseAccountId?: string;
}

export interface CreateBill {
  supplierId: string;
  supplierBillNumber?: string;
  billDate?: string;
  dueDate?: string;
  currency?: string;
  fxRate?: number;
  notes?: string;
  lines: CreateBillLine[];
  charges?: CreateBillCharge[];
  chargeAllocationMethod?: BillChargeAllocationMethod;
}

export type PurchaseOrderStatus =
  | "draft"
  | "sent"
  | "acknowledged"
  | "cancelled"
  | "converted";

export interface PurchaseOrderListRow {
  id: string;
  poNumber: string | null;
  status: PurchaseOrderStatus;
  orderDate: string;
  expectedDeliveryDate: string | null;
  supplierId: string;
  supplierName: string;
  currency: string;
  totalCents: number;
  convertedBillId: string | null;
  createdAt: string;
}

export interface PurchaseOrderDetail {
  id: string;
  poNumber: string | null;
  supplierId: string;
  branchId: string | null;
  status: PurchaseOrderStatus;
  orderDate: string;
  expectedDeliveryDate: string | null;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  reference: string | null;
  supplierReference: string | null;
  notes: string | null;
  terms: string | null;
  sentAt: string | null;
  acknowledgedAt: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  convertedBillId: string | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrderLine {
  id: string;
  lineNo: number;
  itemId: string | null;
  description: string;
  quantity: string;
  unitPriceCents: number;
  lineSubtotalCents: number;
  discountPctBps: number;
  discountCents: number;
  taxCodeId: string | null;
  taxRateBps: number;
  taxCents: number;
  lineTotalCents: number;
  expenseAccountId: string | null;
}

export interface CreatePurchaseOrderLine {
  itemId?: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountPctBps?: number;
  taxCodeId?: string;
  expenseAccountId?: string;
}

export interface CreatePurchaseOrder {
  supplierId: string;
  orderDate?: string;
  expectedDeliveryDate?: string;
  reference?: string;
  notes?: string;
  terms?: string;
  lines: CreatePurchaseOrderLine[];
}

export interface InvoiceListRow {
  id: string;
  invoiceNumber: string | null;
  status: InvoiceStatus;
  issueDate: string;
  dueDate: string;
  customerId: string;
  customerName: string;
  currency: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  balanceDueCents: number;
  createdAt: string;
}

export interface InvoiceDetail {
  id: string;
  invoiceNumber: string | null;
  customerId: string;
  branchId: string | null;
  status: InvoiceStatus;
  issueDate: string;
  dueDate: string;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  amountPaidCents: number;
  balanceDueCents: number;
  reference: string | null;
  poNumber: string | null;
  notes: string | null;
  terms: string | null;
  journalEntryId: string | null;
  postedAt: string | null;
  writtenOffAt: string | null;
  writeoffReason: string | null;
  writeoffJournalEntryId: string | null;
  writeoffVatReliefCents: number;
  writeoffPrincipalCents: number;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceLine {
  id: string;
  lineNo: number;
  itemId: string | null;
  description: string;
  quantity: string;
  unitPriceCents: number;
  lineSubtotalCents: number;
  discountPctBps: number;
  discountCents: number;
  taxCodeId: string | null;
  taxRateBps: number;
  taxCents: number;
  lineTotalCents: number;
}

export interface CreateInvoiceLine {
  itemId?: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountPctBps?: number;
  taxCodeId?: string;
}

export interface CreateInvoice {
  customerId: string;
  salespersonUserId?: string;
  issueDate?: string;
  dueDate?: string;
  currency?: string;
  fxRate?: number;
  reference?: string;
  poNumber?: string;
  notes?: string;
  terms?: string;
  lines: CreateInvoiceLine[];
}

export type SalesOrderStatus = "draft" | "confirmed" | "cancelled" | "converted";

export interface SalesOrderListRow {
  id: string;
  soNumber: string | null;
  status: SalesOrderStatus;
  orderDate: string;
  expectedShipDate: string | null;
  customerId: string;
  customerName: string;
  currency: string;
  totalCents: number;
  convertedInvoiceId: string | null;
  createdAt: string;
}

export interface SalesOrderDetail {
  id: string;
  soNumber: string | null;
  customerId: string;
  branchId: string | null;
  status: SalesOrderStatus;
  orderDate: string;
  expectedShipDate: string | null;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  reference: string | null;
  customerPoNumber: string | null;
  notes: string | null;
  terms: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  convertedInvoiceId: string | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SalesOrderLine {
  id: string;
  lineNo: number;
  itemId: string | null;
  description: string;
  quantity: string;
  unitPriceCents: number;
  lineSubtotalCents: number;
  discountPctBps: number;
  discountCents: number;
  taxCodeId: string | null;
  taxRateBps: number;
  taxCents: number;
  lineTotalCents: number;
  incomeAccountId: string | null;
}

export interface CreateSalesOrderLine {
  itemId?: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountPctBps?: number;
  taxCodeId?: string;
}

export interface CreateSalesOrder {
  customerId: string;
  orderDate?: string;
  expectedShipDate?: string;
  reference?: string;
  customerPoNumber?: string;
  notes?: string;
  terms?: string;
  lines: CreateSalesOrderLine[];
}

export type DeliveryNoteStatus = "draft" | "delivered" | "cancelled";

export interface DeliveryNoteListRow {
  id: string;
  dnNumber: string | null;
  status: DeliveryNoteStatus;
  deliveryDate: string;
  customerId: string;
  customerName: string;
  salesOrderId: string | null;
  invoiceId: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  createdAt: string;
}

export interface DeliveryNoteDetail {
  id: string;
  dnNumber: string | null;
  customerId: string;
  branchId: string | null;
  salesOrderId: string | null;
  invoiceId: string | null;
  status: DeliveryNoteStatus;
  deliveryDate: string;
  shippingAddressLine1: string | null;
  shippingAddressLine2: string | null;
  shippingCity: string | null;
  shippingPostalCode: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  receivedByName: string | null;
  notes: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryNoteLine {
  id: string;
  lineNo: number;
  itemId: string | null;
  description: string;
  quantity: string;
}

export interface CreateDeliveryNoteLine {
  itemId?: string;
  description: string;
  quantity: number;
}

export interface CreateDeliveryNote {
  customerId: string;
  salesOrderId?: string;
  invoiceId?: string;
  deliveryDate?: string;
  shippingAddressLine1?: string;
  shippingAddressLine2?: string;
  shippingCity?: string;
  shippingPostalCode?: string;
  carrier?: string;
  trackingNumber?: string;
  notes?: string;
  lines: CreateDeliveryNoteLine[];
}

export type GrnStatus = "draft" | "received" | "cancelled";

export interface GrnListRow {
  id: string;
  grnNumber: string | null;
  status: GrnStatus;
  receiptDate: string;
  supplierId: string;
  supplierName: string;
  purchaseOrderId: string | null;
  billId: string | null;
  supplierDeliveryNote: string | null;
  createdAt: string;
}

export interface GrnDetail {
  id: string;
  grnNumber: string | null;
  supplierId: string;
  branchId: string | null;
  purchaseOrderId: string | null;
  billId: string | null;
  status: GrnStatus;
  receiptDate: string;
  supplierDeliveryNote: string | null;
  conditionNotes: string | null;
  notes: string | null;
  receivedAt: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GrnLine {
  id: string;
  lineNo: number;
  itemId: string | null;
  description: string;
  quantityOrdered: string | null;
  quantityReceived: string;
  lineNotes: string | null;
}

export interface CreateGrnLine {
  itemId?: string;
  description: string;
  quantityOrdered?: number;
  quantityReceived: number;
  lineNotes?: string;
}

export interface CreateGrn {
  supplierId: string;
  purchaseOrderId?: string;
  billId?: string;
  receiptDate?: string;
  supplierDeliveryNote?: string;
  conditionNotes?: string;
  notes?: string;
  lines: CreateGrnLine[];
}

export type QuotationStatus =
  | "draft"
  | "sent"
  | "accepted"
  | "rejected"
  | "expired"
  | "converted";

export interface QuotationListRow {
  id: string;
  quotationNumber: string | null;
  status: QuotationStatus;
  issueDate: string;
  validUntil: string;
  customerId: string;
  customerName: string;
  currency: string;
  totalCents: number;
  convertedInvoiceId: string | null;
  createdAt: string;
}

export interface QuotationDetail {
  id: string;
  quotationNumber: string | null;
  customerId: string;
  branchId: string | null;
  status: QuotationStatus;
  issueDate: string;
  validUntil: string;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  reference: string | null;
  notes: string | null;
  terms: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  rejectedReason: string | null;
  convertedInvoiceId: string | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuotationLine {
  id: string;
  lineNo: number;
  itemId: string | null;
  description: string;
  quantity: string;
  unitPriceCents: number;
  lineSubtotalCents: number;
  discountPctBps: number;
  discountCents: number;
  taxCodeId: string | null;
  taxRateBps: number;
  taxCents: number;
  lineTotalCents: number;
  incomeAccountId: string | null;
}

export interface CreateQuotationLine {
  itemId?: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountPctBps?: number;
  taxCodeId?: string;
}

export interface CreateQuotation {
  customerId: string;
  issueDate?: string;
  validUntil?: string;
  reference?: string;
  notes?: string;
  terms?: string;
  lines: CreateQuotationLine[];
}

export type ProformaInvoiceStatus = "draft" | "sent" | "converted" | "cancelled";

export interface ProformaInvoiceListRow {
  id: string;
  proformaNumber: string | null;
  status: ProformaInvoiceStatus;
  issueDate: string;
  validUntil: string;
  customerId: string;
  customerName: string;
  currency: string;
  totalCents: number;
  convertedInvoiceId: string | null;
  createdAt: string;
}

export interface ProformaInvoiceDetail {
  id: string;
  proformaNumber: string | null;
  customerId: string;
  branchId: string | null;
  status: ProformaInvoiceStatus;
  issueDate: string;
  validUntil: string;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  reference: string | null;
  notes: string | null;
  terms: string | null;
  sentAt: string | null;
  convertedInvoiceId: string | null;
  convertedAt: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProformaInvoiceLine {
  id: string;
  lineNo: number;
  itemId: string | null;
  description: string;
  quantity: string;
  unitPriceCents: number;
  lineSubtotalCents: number;
  discountPctBps: number;
  discountCents: number;
  taxCodeId: string | null;
  taxRateBps: number;
  taxCents: number;
  lineTotalCents: number;
  incomeAccountId: string | null;
}

export interface CreateProformaInvoiceLine {
  itemId?: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountPctBps?: number;
  taxCodeId?: string;
}

export interface CreateProformaInvoice {
  customerId: string;
  issueDate?: string;
  validUntil?: string;
  reference?: string;
  notes?: string;
  terms?: string;
  lines: CreateProformaInvoiceLine[];
}

export type CreditNoteStatus = "draft" | "posted" | "void";

export type CreditNoteReason =
  | "return"
  | "price_adjustment"
  | "discount"
  | "goodwill"
  | "write_off"
  | "other";

export interface CreditNoteListRow {
  id: string;
  creditNoteNumber: string | null;
  status: CreditNoteStatus;
  issueDate: string;
  customerId: string;
  customerName: string;
  invoiceId: string | null;
  currency: string;
  totalCents: number;
  appliedCents: number;
  reason: CreditNoteReason;
  createdAt: string;
}

export interface CreditNoteDetail {
  id: string;
  creditNoteNumber: string | null;
  customerId: string;
  branchId: string | null;
  invoiceId: string | null;
  status: CreditNoteStatus;
  issueDate: string;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  appliedCents: number;
  reason: CreditNoteReason;
  notes: string | null;
  journalEntryId: string | null;
  postedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreditNoteLine {
  id: string;
  lineNo: number;
  itemId: string | null;
  description: string;
  quantity: string;
  unitPriceCents: number;
  lineSubtotalCents: number;
  discountPctBps: number;
  discountCents: number;
  taxCodeId: string | null;
  taxRateBps: number;
  taxCents: number;
  lineTotalCents: number;
  incomeAccountId: string | null;
}

export interface CreditNoteLinkedInvoice {
  id: string;
  invoiceNumber: string | null;
  totalCents: number;
  balanceDueCents: number;
}

export interface CreateCreditNoteLine {
  itemId?: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountPctBps?: number;
  taxCodeId?: string;
}

export interface CreateCreditNote {
  customerId: string;
  invoiceId?: string;
  issueDate?: string;
  reason?: CreditNoteReason;
  notes?: string;
  lines: CreateCreditNoteLine[];
}

export type DebitNoteStatus = "draft" | "posted" | "void";

export type DebitNoteReason =
  | "return"
  | "price_adjustment"
  | "discount"
  | "goodwill"
  | "shortage"
  | "other";

export interface DebitNoteListRow {
  id: string;
  internalReference: string | null;
  supplierDebitNumber: string | null;
  status: DebitNoteStatus;
  issueDate: string;
  supplierId: string;
  supplierName: string;
  billId: string | null;
  currency: string;
  totalCents: number;
  appliedCents: number;
  reason: DebitNoteReason;
  createdAt: string;
}

export interface DebitNoteDetail {
  id: string;
  internalReference: string | null;
  supplierDebitNumber: string | null;
  supplierId: string;
  branchId: string | null;
  billId: string | null;
  status: DebitNoteStatus;
  issueDate: string;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  appliedCents: number;
  reason: DebitNoteReason;
  notes: string | null;
  journalEntryId: string | null;
  postedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DebitNoteLine {
  id: string;
  lineNo: number;
  itemId: string | null;
  description: string;
  quantity: string;
  unitPriceCents: number;
  lineSubtotalCents: number;
  discountPctBps: number;
  discountCents: number;
  taxCodeId: string | null;
  taxRateBps: number;
  taxCents: number;
  lineTotalCents: number;
  expenseAccountId: string | null;
}

export interface DebitNoteLinkedBill {
  id: string;
  internalReference: string | null;
  supplierBillNumber: string | null;
  totalCents: number;
  balanceDueCents: number;
}

export interface CreateDebitNoteLine {
  itemId?: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountPctBps?: number;
  taxCodeId?: string;
  expenseAccountId?: string;
}

export interface CreateDebitNote {
  supplierId: string;
  billId?: string;
  supplierDebitNumber?: string;
  issueDate?: string;
  reason?: DebitNoteReason;
  notes?: string;
  lines: CreateDebitNoteLine[];
}

export type ChequeStatus =
  | "drafted"
  | "issued"
  | "presented"
  | "cleared"
  | "bounced"
  | "cancelled"
  | "stale"
  | "reissued"
  | "replaced"
  | "received"
  | "deposited"
  | "in_clearing"
  | "returned_to_customer";

export interface Cheque {
  id: string;
  direction: "received" | "issued";
  status: ChequeStatus;
  chequeNumber: string;
  chequeDate: string;
  amountCents: number;
  currency: string;
  customerId: string | null;
  supplierId: string | null;
  otherPartyName: string | null;
  payeeName: string | null;
  bankAccountId: string | null;
  draweeBankName: string | null;
  draweeBranchName: string | null;
  draweeAccountNumber: string | null;
  sourcePaymentId: string | null;
  sourceReceiptId: string | null;
  issuedAt: string | null;
  handedOverAt: string | null;
  depositedAt: string | null;
  presentedAt: string | null;
  clearedAt: string | null;
  bouncedAt: string | null;
  cancelledAt: string | null;
  staleAt: string | null;
  bounceCount: number;
  lastBounceReason: string | null;
  legalActionInitiated: boolean;
  legalActionInitiatedAt: string | null;
  legalCaseReference: string | null;
  replacedByChequeId: string | null;
  createdAt: string;
  updatedAt: string;
  memo: string | null;
}

export type ChequeListRow = Cheque & { partyName: string };

export interface ChequeBounceEvent {
  id: string;
  chequeId: string;
  bounceNumber: number;
  bouncedAt: string;
  reasonCode: string;
  reasonDetails: string | null;
  bankChargesCents: number;
  bankChargesAccountId: string | null;
  customerNotifiedAt: string | null;
  notificationChannel: string | null;
  rePresented: boolean;
  rePresentedAt: string | null;
  reversalJournalEntryId: string | null;
  createdAt: string;
}

export interface StatutoryBalance {
  accountId: string;
  accountCode: string;
  accountName: string;
  kind: "epf" | "etf" | "paye";
  balanceCents: number;
}

export type PayrollRunStatus = "draft" | "posted" | "paid" | "void";

export interface PayrollRun {
  id: string;
  runNumber: string | null;
  periodYear: number;
  periodMonth: number;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  status: PayrollRunStatus;
  employeeCount: number;
  grossCents: number;
  epfEmployeeCents: number;
  epfEmployerCents: number;
  etfEmployerCents: number;
  payeCents: number;
  netPayCents: number;
  journalEntryId: string | null;
  postedAt: string | null;
  notes: string | null;
  createdAt: string;
}

// Final settlement (payroll-module-spec §9) ----------------------------------
export type FinalSettlementStatus =
  | "draft"
  | "approved"
  | "posted"
  | "paid"
  | "cancelled";

export interface FinalSettlementOverrides {
  leaveEncashmentDays?: number;
  gratuityCents?: number;
  noticePayInLieuCents?: number;
  noticeShortfallCents?: number;
  otherEarningsCents?: number;
  otherDeductionsCents?: number;
}

export interface FinalSettlementLine {
  code: string;
  name: string;
  kind: "earning" | "deduction" | "statutory";
  amountCents: number;
  meta?: Record<string, unknown>;
}

export interface FinalSettlementComputeResult {
  employeeId: string;
  employeeFullName: string;
  employeeCode: string | null;
  designation: string | null;
  department: string | null;
  hireDate: string;
  exitDate: string;
  lastWorkingDay: string;
  statusAfter: string;
  basicSalaryCents: number;
  currency: string;

  yearsOfService: number;
  gratuityYearsCompleted: number;

  proRataSalaryCents: number;
  proRataDaysWorked: number;
  proRataDaysInPeriod: number;

  leaveEncashmentDays: number;
  leaveEncashmentCents: number;
  gratuityCents: number;
  noticePayInLieuCents: number;
  noticeShortfallCents: number;
  loanPrincipalRecoveryCents: number;
  loanInterestRecoveryCents: number;
  otherEarningsCents: number;
  otherDeductionsCents: number;

  epfEmployeeCents: number;
  epfEmployerCents: number;
  etfEmployerCents: number;
  payeCents: number;

  grossCents: number;
  totalDeductionsCents: number;
  netPayableCents: number;

  lines: FinalSettlementLine[];
}

export interface FinalSettlementRow {
  id: string;
  tenantId: string;
  settlementNumber: string | null;
  employeeId: string;
  employeeCode: string | null;
  employeeFullName: string;
  designation: string | null;
  department: string | null;
  hireDate: string;
  exitDate: string;
  lastWorkingDay: string;
  statusAfter: string;
  basicSalaryCents: number;
  currency: string;

  yearsOfService: string;
  gratuityYearsCompleted: number;

  proRataSalaryCents: number;
  leaveEncashmentDays: string;
  leaveEncashmentCents: number;
  gratuityCents: number;
  noticePayInLieuCents: number;
  noticeShortfallCents: number;
  loanPrincipalRecoveryCents: number;
  loanInterestRecoveryCents: number;
  otherEarningsCents: number;
  otherDeductionsCents: number;

  epfEmployeeCents: number;
  epfEmployerCents: number;
  etfEmployerCents: number;
  payeCents: number;

  grossCents: number;
  totalDeductionsCents: number;
  netPayableCents: number;

  linesSnapshot: FinalSettlementLine[];
  status: FinalSettlementStatus;
  notes: string | null;

  approvedAt: string | null;
  approvedByUserId: string | null;
  postedAt: string | null;
  postedByUserId: string | null;
  journalEntryId: string | null;
  paidAt: string | null;
  paidByUserId: string | null;
  paymentJournalId: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;

  createdAt: string;
  updatedAt: string;
  createdByUserId: string | null;
}

export interface FinalSettlementPatch {
  leaveEncashmentDays?: number;
  leaveEncashmentCents?: number;
  gratuityCents?: number;
  noticePayInLieuCents?: number;
  noticeShortfallCents?: number;
  otherEarningsCents?: number;
  otherDeductionsCents?: number;
  notes?: string;
}

export type LeaveRequestStatus = "draft" | "pending" | "approved" | "rejected" | "cancelled";

export interface LeaveType {
  id: string;
  code: string;
  name: string;
  defaultDaysPerYear: string;
  isPaid: boolean;
  carryForwardAllowed: boolean;
  maxCarryForwardDays: string;
  isSystem: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLeaveType {
  code: string;
  name: string;
  defaultDaysPerYear?: number;
  isPaid?: boolean;
  carryForwardAllowed?: boolean;
  maxCarryForwardDays?: number;
}

export interface EmployeeLeaveBalance {
  leaveTypeId: string;
  code: string;
  name: string;
  isPaid: boolean;
  defaultDaysPerYear: number;
  allocatedDays: number;
  carriedForwardDays: number;
  usedDays: number;
  availableDays: number;
}

export interface LeaveRequestListRow {
  id: string;
  requestNumber: string | null;
  status: LeaveRequestStatus;
  fromDate: string;
  toDate: string;
  daysCount: string;
  reason: string | null;
  employeeId: string;
  employeeName: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  submittedAt: string | null;
  createdAt: string;
}

export interface LeaveRequestDetail {
  id: string;
  requestNumber: string | null;
  employeeId: string;
  leaveTypeId: string;
  fromDate: string;
  toDate: string;
  daysCount: string;
  reason: string | null;
  status: LeaveRequestStatus;
  submittedAt: string | null;
  approvedAt: string | null;
  approvedByUserId: string | null;
  rejectedAt: string | null;
  rejectedReason: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLeaveRequest {
  employeeId: string;
  leaveTypeId: string;
  fromDate: string;
  toDate: string;
  daysCount: number;
  reason?: string;
}

export type SalaryComponentKind = "earning" | "deduction";
export type SalaryCalculationBasis = "fixed" | "percent_of_basic" | "from_employee_basic";

export interface SalaryComponent {
  id: string;
  code: string;
  name: string;
  kind: SalaryComponentKind;
  calculationBasis: SalaryCalculationBasis;
  defaultAmountCents: number;
  defaultPercentBps: number;
  countsForEpf: boolean;
  countsForEtf: boolean;
  countsForPaye: boolean;
  isSystem: boolean;
  isActive: boolean;
  sortOrder: number;
  notes: string | null;
}

export interface CreateSalaryComponent {
  code: string;
  name: string;
  kind: SalaryComponentKind;
  calculationBasis?: SalaryCalculationBasis;
  defaultAmountCents?: number;
  defaultPercentBps?: number;
  countsForEpf?: boolean;
  countsForEtf?: boolean;
  countsForPaye?: boolean;
  sortOrder?: number;
  notes?: string;
}

export interface SalaryRevision {
  id: string;
  tenantId: string;
  employeeId: string;
  effectiveDate: string;
  previousBasicSalaryCents: number;
  newBasicSalaryCents: number;
  reason: string | null;
  notes: string | null;
  appliedInRunId: string | null;
  appliedAt: string | null;
  arrearsCentsApplied: number | null;
  createdAt: string;
  createdByUserId: string | null;
}

export interface EmployeeStructureRow {
  id: string;
  componentId: string;
  amountCents: number;
  percentBps: number;
  effectiveFrom: string;
  notes: string | null;
  code: string;
  name: string;
  kind: SalaryComponentKind;
  calculationBasis: SalaryCalculationBasis;
  countsForEpf: boolean;
  countsForEtf: boolean;
  countsForPaye: boolean;
  sortOrder: number;
}

export interface PayrollRunLineComponent {
  id: string;
  lineId: string;
  componentId: string | null;
  code: string;
  name: string;
  kind: SalaryComponentKind;
  amountCents: number;
  countsForEpf: boolean;
  countsForEtf: boolean;
  countsForPaye: boolean;
  sortOrder: number;
}

export interface PayrollRunLine {
  id: string;
  runId: string;
  employeeId: string;
  employeeFullName: string;
  employeeCode: string | null;
  nic: string | null;
  epfNumber: string | null;
  etfNumber: string | null;
  designation: string | null;
  department: string | null;
  basicSalaryCents: number;
  grossCents: number;
  earningsCents: number;
  nonStatutoryDeductionsCents: number;
  epfEmployeeCents: number;
  payeCents: number;
  otherDeductionsCents: number;
  totalDeductionsCents: number;
  epfEmployerCents: number;
  etfEmployerCents: number;
  netPayCents: number;
  wasEpfEligible: boolean;
  wasEtfEligible: boolean;
  wasPayeApplicable: boolean;
  paidLeaveDays: string;
  unpaidLeaveDays: string;
  prorataDaysWorked: number | null;
  prorataDaysInPeriod: number | null;
  bankName: string | null;
  bankAccountNo: string | null;
  bankBranch: string | null;
  components?: PayrollRunLineComponent[];
}

export type EmploymentType =
  | "permanent"
  | "contract"
  | "casual"
  | "probation"
  | "intern"
  | "consultant";

export type EmployeeStatus =
  | "active"
  | "on_probation"
  | "confirmed"
  | "suspended"
  | "resigned"
  | "terminated"
  | "retired"
  | "deceased";

export interface EmployeeListRow {
  id: string;
  employeeCode: string | null;
  firstName: string;
  lastName: string;
  fullName: string;
  designation: string | null;
  department: string | null;
  hireDate: string;
  employmentType: EmploymentType;
  status: EmployeeStatus;
  nic: string | null;
  personalEmail: string | null;
  mobilePhone: string | null;
  basicSalaryCents: number;
  currency: string;
  epfEligible: boolean;
  etfEligible: boolean;
  payeApplicable: boolean;
}

export interface Employee extends EmployeeListRow {
  dateOfBirth: string | null;
  gender: string | null;
  whatsapp: string | null;
  addressLine1: string | null;
  city: string | null;
  postalCode: string | null;
  epfNumber: string | null;
  etfNumber: string | null;
  tin: string | null;
  branchId: string | null;
  wageType: string;
  bankName: string | null;
  bankAccountNo: string | null;
  bankBranch: string | null;
  statusChangedAt: string;
  statusChangeReason: string | null;
  exitDate: string | null;
  confirmationDate: string | null;
  noticePeriodDays: number;
  lastWorkingDay: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEmployee {
  firstName: string;
  lastName: string;
  employeeCode?: string;
  dateOfBirth?: string;
  gender?: string;
  personalEmail?: string;
  mobilePhone?: string;
  whatsapp?: string;
  addressLine1?: string;
  city?: string;
  postalCode?: string;
  nic?: string;
  epfNumber?: string;
  etfNumber?: string;
  tin?: string;
  hireDate: string;
  employmentType?: EmploymentType;
  designation?: string;
  department?: string;
  branchId?: string;
  wageType?: string;
  basicSalaryCents?: number;
  epfEligible?: boolean;
  etfEligible?: boolean;
  payeApplicable?: boolean;
  bankName?: string;
  bankAccountNo?: string;
  bankBranch?: string;
  status?: EmployeeStatus;
  notes?: string;
}

export interface StockBalanceRow {
  itemId: string;
  itemName: string;
  sku: string | null;
  unit: string;
  trackInventory: boolean;
  reorderPoint: number | null;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  quantityOnHand: string;
  averageCostCents: number;
  totalValueCents: number;
  lastMovementAt: string | null;
  /** Stock dispatched to this warehouse from another warehouse but not yet received. */
  inTransitInboundQty: number;
}

export interface StockLedgerMovement {
  id: string;
  movementType: string;
  quantity: string;
  unitCostCents: number;
  totalCostCents: number;
  runningQuantity: string;
  runningValueCents: number;
  runningAvgCostCents: number;
  sourceDocumentType: string | null;
  sourceDocumentId: string | null;
  occurredAt: string;
  warehouseCode: string;
  warehouseName: string;
}

export interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
}

export type StockTransferStatus = "draft" | "dispatched" | "received" | "cancelled";

export interface StockTransferListRow {
  id: string;
  transferNumber: string | null;
  status: StockTransferStatus;
  requestedDate: string;
  dispatchedAt: string | null;
  receivedAt: string | null;
  hasDiscrepancy: boolean;
  createdAt: string;
  sourceCode: string;
  sourceName: string;
  destCode: string;
  destName: string;
  lineCount: number;
}

export interface StockTransferDetail {
  id: string;
  transferNumber: string | null;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  status: StockTransferStatus;
  requestedDate: string;
  dispatchedAt: string | null;
  receivedAt: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  hasDiscrepancy: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StockTransferWarehouse {
  id: string;
  code: string;
  name: string;
}

export interface StockTransferLineRow {
  id: string;
  line_no: number;
  item_id: string;
  item_name: string;
  sku: string | null;
  unit: string;
  quantity_requested: string;
  quantity_dispatched: string | null;
  quantity_received: string | null;
  unit_cost_cents_at_dispatch: number | string | null;
  notes: string | null;
}

export interface CreateStockTransfer {
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  requestedDate?: string;
  notes?: string;
  lines: Array<{ itemId: string; quantityRequested: number; notes?: string }>;
}

export type StockCountStatus =
  | "draft"
  | "review"
  | "pending_approval"
  | "posted"
  | "cancelled";

export type StockCountReasonCode =
  | "damage"
  | "theft"
  | "expiry"
  | "shrinkage"
  | "miscount"
  | "sample"
  | "system_error"
  | "other";

export interface StockCountListRow {
  id: string;
  countNumber: string | null;
  status: StockCountStatus;
  countDate: string;
  scopeType: "warehouse" | "items";
  requiresApproval: boolean;
  maxVarianceBps: number | null;
  totalVarianceValueCents: number | null;
  postedAt: string | null;
  createdAt: string;
  warehouseCode: string;
  warehouseName: string;
  lineCount: number;
  countedCount: number;
}

export interface StockCountLineRow {
  id: string;
  lineNo: number;
  itemId: string;
  itemSku: string;
  itemName: string;
  itemUom: string | null;
  systemQty: number;
  systemAvgCostCents: number;
  countedQty: number | null;
  varianceQty: number | null;
  varianceValueCents: number | null;
  reasonCode: StockCountReasonCode | null;
  notes: string | null;
}

export interface StockCountDetail {
  id: string;
  tenantId: string;
  countNumber: string | null;
  warehouseId: string;
  scopeType: "warehouse" | "items";
  countDate: string;
  status: StockCountStatus;
  blindCount: boolean;
  varianceThresholdBps: number;
  maxVarianceBps: number | null;
  totalVarianceValueCents: number | null;
  requiresApproval: boolean;
  countedAt: string | null;
  reviewedAt: string | null;
  postedAt: string | null;
  postedByUserId: string | null;
  approvedAt: string | null;
  approvedByUserId: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  journalEntryId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string | null;
  warehouse: { id: string; code: string; name: string } | null;
  lines: StockCountLineRow[];
  reasonCodes: readonly StockCountReasonCode[];
}

export interface CreateStockCount {
  warehouseId: string;
  countDate?: string;
  scopeType: "warehouse" | "items";
  lines?: Array<{ itemId: string }>;
  notes?: string;
  varianceThresholdBps?: number;
}

export interface LowStockItem {
  itemId: string;
  sku: string | null;
  name: string;
  unit: string;
  reorderPoint: number;
  onHand: number;
  shortBy: number;
  lastMovementAt: string | null;
}

export interface BalanceSheetLine {
  accountId: string;
  code: string;
  name: string;
  subtype: string | null;
  balanceCents: number;
}

export interface BalanceSheetSection {
  label: string;
  accounts: BalanceSheetLine[];
  totalCents: number;
}

export interface BalanceSheet {
  asOf: string;
  sections: BalanceSheetSection[];
  totalAssetsCents: number;
  totalLiabilitiesCents: number;
  totalEquityCents: number;
  liabilitiesAndEquityCents: number;
  currentEarningsCents: number;
  balanced: boolean;
}

export interface ProfitLossLine {
  accountId: string;
  code: string;
  name: string;
  amountCents: number;
  comparisonCents?: number;
}

export interface ProfitLossSection {
  label: string;
  accounts: ProfitLossLine[];
  totalCents: number;
  comparisonTotalCents?: number;
}

export interface ProfitLoss {
  asOfFrom: string;
  asOfTo: string;
  compare: "none" | "prior_month" | "prior_year";
  comparisonFrom: string | null;
  comparisonTo: string | null;
  sections: ProfitLossSection[];
  grossProfitCents: number;
  netProfitCents: number;
  totalIncomeCents: number;
  totalCogsCents: number;
  totalOpexCents: number;
  comparison: {
    grossProfitCents: number;
    netProfitCents: number;
    totalIncomeCents: number;
    totalCogsCents: number;
    totalOpexCents: number;
  } | null;
}

export interface TrialBalanceAccount {
  accountId: string;
  code: string;
  name: string;
  accountType: "asset" | "liability" | "equity" | "income" | "expense";
  accountSubtype: string | null;
  normalSide: "dr" | "cr";
  debitCents: number;
  creditCents: number;
  balanceCents: number;
}

export interface TrialBalance {
  accounts: TrialBalanceAccount[];
  totalDebits: number;
  totalCredits: number;
  balanced: boolean;
  asOfFrom: string | null;
  asOfTo: string | null;
}

export interface GeneralLedgerLine {
  journalEntryId: string;
  entryNumber: string;
  entryDate: string;
  memo: string | null;
  sourceType: string | null;
  sourceId: string | null;
  lineNo: number;
  description: string | null;
  drCents: number;
  crCents: number;
  runningBalanceCents: number;
}

export interface GeneralLedger {
  account: {
    id: string;
    code: string;
    name: string;
    accountType: "asset" | "liability" | "equity" | "income" | "expense";
    accountSubtype: string | null;
    normalSide: "dr" | "cr";
  };
  asOfFrom: string | null;
  asOfTo: string | null;
  openingBalanceCents: number;
  closingBalanceCents: number;
  totalDebitsCents: number;
  totalCreditsCents: number;
  lines: GeneralLedgerLine[];
  truncated: boolean;
}

export interface VatOutputRow {
  invoiceId: string;
  invoiceNumber: string | null;
  issueDate: string;
  customerId: string;
  customerName: string;
  customerVatNo: string | null;
  taxableCents: number;
  vatCents: number;
  totalCents: number;
}

export interface VatInputRow {
  billId: string;
  internalReference: string | null;
  supplierBillNumber: string | null;
  billDate: string;
  supplierId: string;
  supplierName: string;
  supplierVatNo: string | null;
  taxableCents: number;
  vatCents: number;
  totalCents: number;
}

export interface VatReturn {
  asOfFrom: string;
  asOfTo: string;
  outputSummary: {
    standardRatedTaxableCents: number;
    standardRatedVatCents: number;
    zeroRatedTaxableCents: number;
    exemptTaxableCents: number;
    totalTaxableCents: number;
    totalVatCents: number;
    totalInvoices: number;
  };
  inputSummary: {
    standardRatedTaxableCents: number;
    standardRatedVatCents: number;
    totalBills: number;
  };
  netVatPayableCents: number;
  outputRegister: VatOutputRow[];
  inputRegister: VatInputRow[];
}

export interface CashFlowRow {
  accountId: string;
  code: string;
  name: string;
  accountSubtype: string | null;
  flowCents: number;
}

export interface CashFlowSection {
  label: string;
  kind: "operating" | "investing" | "financing";
  accounts: CashFlowRow[];
  totalCents: number;
}

export interface BadDebtWriteOff {
  invoiceId: string;
  invoiceNumber: string | null;
  issueDate: string;
  writtenOffAt: string;
  customerId: string;
  customerName: string;
  writeoffReason: string | null;
  principalCents: number;
  vatReliefCents: number;
  totalCents: number;
  writeoffJournalEntryId: string | null;
}

export interface BadDebtReport {
  writeOffs: BadDebtWriteOff[];
  totals: {
    principalCents: number;
    vatReliefCents: number;
    totalCents: number;
    count: number;
  };
}

export type AgingBucketLabel = "current" | "0-30" | "30-60" | "60-90" | "90+";

export interface AgingDetailRow {
  id: string;
  docNumber: string | null;
  partyId: string;
  partyName: string;
  issueDate: string;
  dueDate: string;
  daysOverdue: number;
  bucket: AgingBucketLabel;
  totalCents: number;
  amountPaidCents: number;
  balanceDueCents: number;
  reference: string | null;
}

export interface AgingDetailGroup {
  partyId: string;
  partyName: string;
  totalBalanceCents: number;
  rows: AgingDetailRow[];
  bucketTotals: Record<AgingBucketLabel, number>;
}

export interface AgingDetailReport {
  groups: AgingDetailGroup[];
  grandTotalCents: number;
  bucketTotals: Record<AgingBucketLabel, number>;
  asOf: string;
}

export type ThreeWayMatchStatus =
  | "ok"
  | "awaiting_grn"
  | "awaiting_bill"
  | "under_received"
  | "over_received"
  | "bill_mismatch";
export type ThreeWayMatchFilter = ThreeWayMatchStatus | "variance";

export interface ThreeWayMatchLine {
  lineId: string;
  lineNo: number;
  itemId: string | null;
  description: string;
  orderedQty: number;
  receivedQty: number;
  billedQty: number;
  status: ThreeWayMatchStatus;
}

export interface ThreeWayMatchPo {
  poId: string;
  poNumber: string | null;
  supplierId: string;
  supplierName: string;
  orderDate: string;
  poStatus: string;
  totalCents: number;
  convertedBillId: string | null;
  lines: ThreeWayMatchLine[];
  status: ThreeWayMatchStatus;
  lineCount: number;
  varianceCount: number;
}

export interface ThreeWayMatchReport {
  purchaseOrders: ThreeWayMatchPo[];
  summary: {
    total: number;
    ok: number;
    awaitingGrn: number;
    awaitingBill: number;
    underReceived: number;
    overReceived: number;
    billMismatch: number;
  };
}

export interface CashFlow {
  asOfFrom: string;
  asOfTo: string;
  openingCashCents: number;
  closingCashCents: number;
  netChangeCents: number;
  sections: CashFlowSection[];
}

export interface RecurringInvoiceListRow {
  id: string;
  scheduleName: string;
  customerId: string;
  customerName: string;
  frequency: string;
  dayOfMonth: number;
  startDate: string;
  endDate: string | null;
  nextRunDate: string;
  lastRunDate: string | null;
  isActive: boolean;
  pausedAt: string | null;
  generatedCount: number;
  lastGeneratedInvoiceId: string | null;
  currency: string;
  createdAt: string;
}

export interface RecurringInvoiceDetail extends RecurringInvoiceListRow {
  branchId: string | null;
  dueDays: number;
  reference: string | null;
  notes: string | null;
  terms: string | null;
  deletedAt: string | null;
  updatedAt: string;
  createdByUserId: string | null;
}

export interface RecurringInvoiceLine {
  id: string;
  recurringInvoiceId: string;
  lineNo: number;
  itemId: string | null;
  description: string;
  quantity: string;
  unitPriceCents: number;
  discountPctBps: number;
  taxCodeId: string | null;
  incomeAccountId: string | null;
  createdAt: string;
}

export interface CreateRecurringInvoice {
  customerId: string;
  scheduleName: string;
  frequency?: "monthly";
  dayOfMonth?: number;
  startDate: string;
  endDate?: string;
  dueDays?: number;
  currency?: string;
  reference?: string;
  notes?: string;
  terms?: string;
  lines: Array<{
    itemId?: string;
    description: string;
    quantity: number;
    unitPriceCents: number;
    discountPctBps?: number;
    taxCodeId?: string;
  }>;
}

export interface RecurringBillListRow {
  id: string;
  scheduleName: string;
  supplierId: string;
  supplierName: string;
  frequency: string;
  dayOfMonth: number;
  startDate: string;
  endDate: string | null;
  nextRunDate: string;
  lastRunDate: string | null;
  isActive: boolean;
  pausedAt: string | null;
  generatedCount: number;
  lastGeneratedBillId: string | null;
  currency: string;
  createdAt: string;
}

export interface RecurringBillDetail extends RecurringBillListRow {
  branchId: string | null;
  dueDays: number;
  supplierBillNumberTemplate: string | null;
  notes: string | null;
  deletedAt: string | null;
  updatedAt: string;
  createdByUserId: string | null;
}

export interface RecurringBillLine {
  id: string;
  recurringBillId: string;
  lineNo: number;
  itemId: string | null;
  description: string;
  quantity: string;
  unitPriceCents: number;
  discountPctBps: number;
  taxCodeId: string | null;
  expenseAccountId: string | null;
  createdAt: string;
}

export interface CreateRecurringBill {
  supplierId: string;
  scheduleName: string;
  frequency?: "monthly";
  dayOfMonth?: number;
  startDate: string;
  endDate?: string;
  dueDays?: number;
  currency?: string;
  supplierBillNumberTemplate?: string;
  notes?: string;
  lines: Array<{
    itemId?: string;
    description: string;
    quantity: number;
    unitPriceCents: number;
    discountPctBps?: number;
    taxCodeId?: string;
    expenseAccountId?: string;
  }>;
}

export interface RecurringJournalListRow {
  id: string;
  scheduleName: string;
  frequency: string;
  dayOfMonth: number;
  startDate: string;
  endDate: string | null;
  nextRunDate: string;
  lastRunDate: string | null;
  autoPost: boolean;
  memoTemplate: string | null;
  isActive: boolean;
  pausedAt: string | null;
  generatedCount: number;
  lastGeneratedEntryId: string | null;
  lastGeneratedDraftId: string | null;
  totalCents: number;
  createdAt: string;
}

export interface RecurringJournalDetail {
  id: string;
  scheduleName: string;
  frequency: string;
  dayOfMonth: number;
  startDate: string;
  endDate: string | null;
  nextRunDate: string;
  lastRunDate: string | null;
  autoPost: boolean;
  memoTemplate: string | null;
  notes: string | null;
  isActive: boolean;
  pausedAt: string | null;
  generatedCount: number;
  lastGeneratedEntryId: string | null;
  lastGeneratedDraftId: string | null;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string | null;
  deletedAt: string | null;
}

export interface RecurringJournalLine {
  id: string;
  recurringJournalId: string;
  lineNo: number;
  accountId: string;
  drCents: number;
  crCents: number;
  description: string | null;
  customerId: string | null;
  supplierId: string | null;
  createdAt: string;
}

export interface CreateRecurringJournalLine {
  accountId: string;
  drCents: number;
  crCents: number;
  description?: string;
  customerId?: string;
  supplierId?: string;
}

export interface CreateRecurringJournal {
  scheduleName: string;
  frequency?: "monthly";
  dayOfMonth?: number;
  startDate: string;
  endDate?: string;
  autoPost?: boolean;
  memoTemplate?: string;
  notes?: string;
  lines: CreateRecurringJournalLine[];
}

export type StockRelieveOn = "invoice" | "delivery_note";

export interface TenantSettings {
  salaryDaysPerMonth: number;
  stockRelieveOn: StockRelieveOn;
  journalApprovalThresholdCents: number;
}

export interface OpeningBalanceState {
  posted: boolean;
  entry: {
    id: string;
    entryNumber: string | null;
    entryDate: string;
    lineCount: number;
    totalDrCents: number;
    totalCrCents: number;
  } | null;
}

export interface WhtPerMonth {
  year: number;
  month: number;
  withheldCents: number;
  remittedCents: number;
  netBalanceCents: number;
}

export interface WhtBySupplier {
  supplierId: string;
  supplierName: string;
  withheldCents: number;
  paymentCount: number;
}

export interface WhtRemittance {
  id: string;
  entryNumber: string | null;
  entryDate: string;
  amountCents: number;
  reference: string | null;
  memo: string | null;
}

export interface WhtSummary {
  balanceCents: number;
  perMonth: WhtPerMonth[];
  suppliers: WhtBySupplier[];
  remittances: WhtRemittance[];
}

export type PeriodStatus = "open" | "soft_closed" | "closed";

export interface FiscalPeriod {
  id: string;
  fiscalYear: number;
  periodNo: number;
  startsOn: string;
  endsOn: string;
  status: PeriodStatus;
  closedAt: string | null;
  closedByUserId: string | null;
  lastReason: string | null;
  reopenedCount: number;
  closingJournalEntryId: string | null;
  entryCount: number;
}

export interface TenantSettingsResponse {
  settings: TenantSettings;
  defaults: TenantSettings;
}

export interface FxRate {
  id: string;
  fromCurrency: string;
  toCurrency: string;
  rateDate: string;
  rate: string;
  source: string;
  note: string | null;
  createdAt: string;
  createdByUserId: string | null;
}

export interface CreateFxRate {
  fromCurrency: string;
  toCurrency: string;
  rateDate: string;
  rate: number;
  source?: string;
  note?: string;
}

export interface FxRevaluation {
  id: string;
  asOfDate: string;
  status: "draft" | "posted" | "voided";
  arGainCents: number;
  arLossCents: number;
  apGainCents: number;
  apLossCents: number;
  currencySummary: Record<
    string,
    { openForeign: number; openLkr: number; asOfRate: number; deltaLkr: number }
  >;
  journalEntryId: string | null;
  voidJournalEntryId: string | null;
  notes: string | null;
  createdAt: string;
  postedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

export interface FxRevaluationLine {
  id: string;
  revaluationId: string;
  sourceType: "invoice" | "bill";
  sourceId: string;
  docNumber?: string | null;
  currency: string;
  issueFxRate: string;
  foreignOutstandingCents: number;
  lkrOnLedgerCents: number;
  asOfRate: string;
  lkrAtAsOfCents: number;
  cumulativeDeltaCents: number;
  previousCumulativeDeltaCents: number;
  incrementalDeltaCents: number;
  direction: "ar" | "ap";
}

export type NumberSeriesScope = "year" | "month" | "global";

export interface NumberSeries {
  sequenceName: string;
  displayName: string | null;
  prefix: string;
  template: string;
  scope: NumberSeriesScope;
  padWidth: number;
  counter: number;
  currentYear: number | null;
  currentMonth: number | null;
  nextPreview: string;
  updatedAt: string;
}

export interface UpdateNumberSeries {
  prefix?: string;
  template?: string;
  scope?: NumberSeriesScope;
  padWidth?: number;
  // Forward-only — server refuses a decrease.
  counter?: number;
}

export interface PreviewNumberSeries {
  prefix: string;
  template: string;
  padWidth: number;
  nextCounter: number;
}

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  refType: string | null;
  refId: string | null;
  readAt: string | null;
  createdAt: string;
  isBroadcast: boolean;
}

// Notification prefs (roadmap #25)
export interface NotificationPreference {
  kind: string;
  label: string;
  description: string;
  enabled: boolean;
  known: boolean;
}

// Approval policies (roadmap #26)
export type ApprovalDocumentType =
  | "journal_entry"
  | "expense_claim"
  | "leave_request"
  | "bill"
  | "purchase_order"
  | "invoice";

export interface ApprovalStepApprover {
  kind: "role" | "user";
  id: string;
  label?: string;
}

export interface ApprovalStep {
  approvers: ApprovalStepApprover[];
  anyOf: boolean;
}

export interface ApprovalTriggerRule {
  minAmountCents?: number;
  submitters?: string[];
}

export interface ApprovalPolicy {
  id: string;
  name: string;
  description: string | null;
  documentType: ApprovalDocumentType;
  triggerRule: ApprovalTriggerRule;
  steps: ApprovalStep[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateApprovalPolicy {
  name: string;
  description?: string;
  documentType: ApprovalDocumentType;
  triggerRule?: ApprovalTriggerRule;
  steps: ApprovalStep[];
  isActive?: boolean;
}

// Custom roles (roadmap #27)
export interface AppRole {
  id: string;
  name: string;
  description: string | null;
  permissions: Record<string, boolean>;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAppRole {
  name: string;
  description?: string;
  permissions: Record<string, boolean>;
}

export interface UserWithRoles {
  id: string;
  email: string;
  fullName: string | null;
  isOwner: boolean;
  isActive: boolean;
  roles: Array<{ id: string; name: string }>;
}

export type BankImportStatus = "pending" | "reconciled";
export type BankLineMatchStatus = "unmatched" | "matched" | "ignored" | "multiple_candidates";

export interface BankImportRow {
  id: string;
  bankAccountId: string;
  bankAccountCode: string;
  bankAccountName: string;
  statementFromDate: string;
  statementToDate: string;
  openingBalanceCents: number | null;
  closingBalanceCents: number | null;
  totalLines: number;
  matchedLines: number;
  status: BankImportStatus;
  reconciledAt: string | null;
  createdAt: string;
}

export interface BankImportDetail {
  id: string;
  bankAccountId: string;
  statementFromDate: string;
  statementToDate: string;
  openingBalanceCents: number | null;
  closingBalanceCents: number | null;
  totalLines: number;
  matchedLines: number;
  status: BankImportStatus;
  notes: string | null;
  reconciledAt: string | null;
  reconciledByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BankStatementLineRow {
  id: string;
  importId: string;
  lineNo: number;
  transactionDate: string;
  description: string;
  amountCents: number;
  reference: string | null;
  matchStatus: BankLineMatchStatus;
  matchedRefType: string | null;
  matchedRefId: string | null;
  matchNotes: string | null;
  matchedAt: string | null;
  createdAt: string;
}

export interface CreateBankImport {
  bankAccountId: string;
  statementFromDate: string;
  statementToDate: string;
  openingBalanceCents?: number;
  closingBalanceCents?: number;
  notes?: string;
  csv: string;
}

export interface AgingBucket {
  label: "current" | "0-30" | "30-60" | "60-90" | "90+";
  lowerDays: number;
  upperDays: number | null;
  balanceCents: number;
  invoiceCount: number;
}

export interface Dashboard {
  cashPositionCents: number;
  cashByAccount: Array<{ code: string; name: string; balanceCents: number }>;
  arTotalCents: number;
  openInvoiceCount: number;
  overdueCents: number;
  overdueCount: number;
  apTotalCents: number;
  openBillCount: number;
  overdueBillsCents: number;
  overdueBillsCount: number;
  revenueThisMonthCents: number;
  revenueLastMonthCents: number;
  invoicesThisMonth: number;
  paymentsThisMonthCents: number;
  aging: AgingBucket[];
  apAging: AgingBucket[];
  recentInvoices: Array<{
    id: string;
    invoiceNumber: string | null;
    customerName: string;
    totalCents: number;
    balanceDueCents: number;
    status: InvoiceStatus;
    issueDate: string;
    dueDate: string;
  }>;
  recentPayments: Array<{
    id: string;
    paymentNumber: string | null;
    customerName: string;
    amountCents: number;
    method: string;
    paymentDate: string;
  }>;
  revenueSeries: Array<{ day: string; revenueCents: number }>;
}

export type PaymentMethod =
  | "cash"
  | "bank_transfer"
  | "cheque"
  | "card"
  | "lankaqr"
  | "payhere"
  | "frimi"
  | "genie"
  | "ipay"
  | "other";

export interface PaymentListRow {
  id: string;
  paymentNumber: string | null;
  paymentDate: string;
  method: PaymentMethod;
  amountCents: number;
  currency: string;
  reference: string | null;
  status: string;
  customerId: string;
  customerName: string;
  bankAccountCode: string;
  bankAccountName: string;
  createdAt: string;
}

export interface Payment {
  id: string;
  paymentNumber: string | null;
  customerId: string;
  paymentDate: string;
  method: PaymentMethod;
  amountCents: number;
  currency: string;
  bankAccountId: string;
  reference: string | null;
  chequeDate: string | null;
  memo: string | null;
  status: "draft" | "posted" | "reversed";
  postedAt: string | null;
  journalEntryId: string | null;
}

export type SupplierPaymentMethod =
  | "cash"
  | "bank_transfer"
  | "cheque"
  | "slips"
  | "other";

export interface SupplierPaymentListRow {
  id: string;
  paymentNumber: string | null;
  paymentDate: string;
  method: SupplierPaymentMethod;
  amountCents: number;
  currency: string;
  reference: string | null;
  chequeNumber: string | null;
  status: string;
  supplierId: string;
  supplierName: string;
  bankAccountCode: string;
  bankAccountName: string;
  createdAt: string;
}

export interface SupplierPayment {
  id: string;
  paymentNumber: string | null;
  supplierId: string;
  paymentDate: string;
  method: SupplierPaymentMethod;
  amountCents: number;
  currency: string;
  bankAccountId: string;
  reference: string | null;
  chequeNumber: string | null;
  chequeDate: string | null;
  memo: string | null;
  status: "draft" | "posted" | "reversed";
  postedAt: string | null;
  journalEntryId: string | null;
}

export interface CreateSupplierPayment {
  supplierId: string;
  paymentDate?: string;
  method: SupplierPaymentMethod;
  bankAccountId: string;
  amountCents: number;
  reference?: string;
  chequeNumber?: string;
  chequeDate?: string;
  memo?: string;
  allocations: { billId: string; allocatedCents: number }[];
  whtCents?: number;
  whtTaxCodeId?: string;
}

export interface CreatePayment {
  customerId: string;
  paymentDate?: string;
  method: PaymentMethod;
  bankAccountId: string;
  amountCents: number;
  reference?: string;
  chequeDate?: string;
  memo?: string;
  allocations: { invoiceId: string; allocatedCents: number }[];
}

export interface TaxCode {
  id: string;
  code: string;
  name: string;
  taxKind: "vat" | "wht" | "sscl" | "stamp" | "exempt" | "zero";
  rateBps: number;
  appliesTo: "sale" | "purchase" | "both";
  isActive: boolean;
}

export type LoanStatus =
  | "draft"
  | "approved"
  | "disbursed"
  | "closed"
  | "written_off"
  | "cancelled";

export interface LoanType {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  maxAmountCents: number | null;
  defaultInterestRateBps: number;
  defaultTenureMonths: number;
  maxTenureMonths: number;
  isInterestBearing: boolean;
  isActive: boolean;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLoanType {
  code: string;
  name: string;
  description?: string;
  maxAmountCents?: number | null;
  defaultInterestRateBps?: number;
  defaultTenureMonths?: number;
  maxTenureMonths?: number;
  isInterestBearing?: boolean;
  isActive?: boolean;
}

export interface EmployeeLoan {
  id: string;
  tenantId: string;
  loanNumber: string | null;
  employeeId: string;
  loanTypeId: string | null;
  loanTypeName: string | null;
  principalCents: number;
  interestRateBps: number;
  tenureMonths: number;
  totalInterestCents: number;
  emiCents: number;
  firstInstallmentDate: string | null;
  status: LoanStatus;
  appliedAt: string;
  approvedAt: string | null;
  approvedByUserId: string | null;
  disbursedAt: string | null;
  disbursedByUserId: string | null;
  disbursementDate: string | null;
  disbursementAccountId: string | null;
  disbursementJournalId: string | null;
  closedAt: string | null;
  closedReason: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  principalOutstandingCents: number;
  interestOutstandingCents: number;
  principalRepaidCents: number;
  interestRepaidCents: number;
  writtenOffCents: number;
  applicationReason: string | null;
  approvalNotes: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string | null;
}

export interface EmployeeLoanRow extends EmployeeLoan {
  employeeName: string;
  employeeCode: string | null;
}

export interface LoanScheduleRow {
  id: string;
  loanId: string;
  installmentNo: number;
  dueDate: string;
  principalCents: number;
  interestCents: number;
  totalCents: number;
  openingBalanceCents: number;
  closingBalanceCents: number;
  status: "pending" | "paid" | "waived";
  appliedInRunId: string | null;
  appliedRunLineId: string | null;
  appliedAt: string | null;
  waivedReason: string | null;
  createdAt: string;
}

// ─── Bonus schemes / runs ──────────────────────────────────────────────

export type BonusFormulaType =
  | "flat_amount"
  | "percent_of_basic"
  | "days_of_basic"
  | "manual";

export type BonusRunStatus = "draft" | "posted" | "void";

export interface BonusScheme {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  formulaType: BonusFormulaType;
  formulaValue: number | null;
  eligibilityMinTenureDays: number;
  eligibilityEmploymentTypes: string[];
  eligibilityStatuses: string[];
  countsForEpf: boolean;
  countsForEtf: boolean;
  countsForPaye: boolean;
  expenseAccountId: string | null;
  isActive: boolean;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBonusScheme {
  code: string;
  name: string;
  description?: string;
  formulaType: BonusFormulaType;
  formulaValue?: number | null;
  eligibilityMinTenureDays?: number;
  eligibilityEmploymentTypes?: string[];
  eligibilityStatuses?: string[];
  countsForEpf?: boolean;
  countsForEtf?: boolean;
  countsForPaye?: boolean;
  expenseAccountId?: string | null;
  isActive?: boolean;
}

export interface BonusRun {
  id: string;
  tenantId: string;
  schemeId: string;
  runNumber: string | null;
  label: string;
  payDate: string;
  status: BonusRunStatus;
  employeeCount: number;
  grossCents: number;
  epfEmployeeCents: number;
  epfEmployerCents: number;
  etfEmployerCents: number;
  payeCents: number;
  netPayCents: number;
  journalEntryId: string | null;
  postedAt: string | null;
  postedByUserId: string | null;
  voidReason: string | null;
  voidAt: string | null;
  voidByUserId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BonusRunRow extends BonusRun {
  schemeName: string | null;
  schemeCode: string | null;
}

export interface BonusRunLine {
  id: string;
  tenantId: string;
  runId: string;
  employeeId: string;
  employeeFullName: string;
  employeeCode: string | null;
  nic: string | null;
  epfNumber: string | null;
  etfNumber: string | null;
  designation: string | null;
  department: string | null;
  basicAtRunCents: number;
  bonusGrossCents: number;
  epfEmployeeCents: number;
  epfEmployerCents: number;
  etfEmployerCents: number;
  payeCents: number;
  netPayCents: number;
  wasManuallyAdjusted: boolean;
  wasEpfApplied: boolean;
  wasEtfApplied: boolean;
  wasPayeApplied: boolean;
  bankName: string | null;
  bankAccountNo: string | null;
  bankBranch: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBonusRun {
  schemeId: string;
  label: string;
  payDate: string;
  notes?: string;
}

// ─── Expense claims ────────────────────────────────────────────────────

export type ExpenseClaimStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "paid"
  | "void";

export type ExpenseDisbursementMethod = "direct" | "payroll";

export interface ExpenseCategory {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  expenseAccountId: string | null;
  isTaxable: boolean;
  isActive: boolean;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateExpenseCategory {
  code: string;
  name: string;
  description?: string;
  expenseAccountId?: string | null;
  isTaxable?: boolean;
  isActive?: boolean;
}

export interface ExpenseClaim {
  id: string;
  tenantId: string;
  claimNumber: string | null;
  employeeId: string;
  categoryId: string | null;
  categoryName: string | null;
  expenseAccountId: string | null;
  claimDate: string;
  amountCents: number;
  description: string | null;
  receiptRef: string | null;
  disbursementMethod: ExpenseDisbursementMethod;
  isTaxable: boolean;
  status: ExpenseClaimStatus;
  submittedAt: string | null;
  submittedByUserId: string | null;
  approvedAt: string | null;
  approvedByUserId: string | null;
  rejectedAt: string | null;
  rejectedByUserId: string | null;
  rejectionReason: string | null;
  paidAt: string | null;
  paidByUserId: string | null;
  paymentAccountId: string | null;
  paymentJournalId: string | null;
  paymentDate: string | null;
  paymentReference: string | null;
  appliedInRunId: string | null;
  appliedInRunLineId: string | null;
  appliedAt: string | null;
  voidAt: string | null;
  voidReason: string | null;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string | null;
}

export interface ExpenseClaimRow extends ExpenseClaim {
  employeeName: string;
  employeeCode: string | null;
}

export interface CreateExpenseClaim {
  employeeId: string;
  categoryId: string;
  claimDate: string;
  amountCents: number;
  description?: string;
  receiptRef?: string;
  disbursementMethod?: ExpenseDisbursementMethod;
}

export type UpdateExpenseClaim = Partial<CreateExpenseClaim>;

export interface ApproveAndPayExpenseClaim {
  paymentAccountId: string;
  paymentDate: string;
  paymentReference?: string;
}

export type AuditEventKind =
  | "user.login"
  | "user.logout"
  | "journal.post"
  | "journal.void"
  | "journal.approve"
  | "journal.reject"
  | "period.close"
  | "period.reopen"
  | "period.close_year"
  | "invoice.void"
  | "bill.void"
  | "payment.void"
  | "supplier_payment.void"
  | "bad_debt.writeoff"
  | "bad_debt.reverse"
  | "customer.credit_hold"
  | "customer.credit_release"
  | "employee.exit"
  | "employee.confirm_probation"
  | "salary_revision.create"
  | "payroll.post"
  | "payroll.void"
  | "settings.update"
  | "number_series.update";

export interface AuditEvent {
  id: string;
  kind: AuditEventKind | string;
  refType: string | null;
  refId: string | null;
  summary: string;
  diff: Record<string, unknown> | null;
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AuditLogFilters {
  from?: string;
  to?: string;
  kind?: string;
  actorUserId?: string;
  refType?: string;
  refId?: string;
  limit?: number;
  offset?: number;
}

export interface AuditLogListResponse {
  events: AuditEvent[];
  filters: {
    from: string;
    to: string;
    kind: string | null;
    actorUserId: string | null;
    refType: string | null;
    refId: string | null;
  };
  paging: {
    limit: number;
    offset: number;
  };
}

export interface AuditKindBucket {
  kind: string;
  count: number;
}

// ─── POS ─────────────────────────────────────────────────────────────────

export type PosShiftStatus = "open" | "closed";

export type PosVarianceReasonCode =
  | "change_error"
  | "miscount"
  | "theft_suspicion"
  | "other";

export interface PosShift {
  id: string;
  tenantId: string;
  branchId: string | null;
  cashierUserId: string;
  status: PosShiftStatus;
  openedAt: string;
  openingFloatCents: number;
  openingNotes: string | null;
  cashAccountId: string | null;
  closedAt: string | null;
  closedByUserId: string | null;
  closingDenominations: Record<string, number> | null;
  closingCashCents: number | null;
  expectedCashCents: number | null;
  varianceCents: number | null;
  varianceReasonCode: PosVarianceReasonCode | null;
  varianceReasonNotes: string | null;
  varianceJournalEntryId: string | null;
  supervisorSignature: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OpenPosShift {
  branchId?: string;
  openingFloatCents?: number;
  openingNotes?: string;
  cashAccountId?: string;
}

export interface ClosePosShift {
  closingCashCents: number;
  closingDenominations?: Record<string, number>;
  varianceReasonCode?: PosVarianceReasonCode;
  varianceReasonNotes?: string;
  supervisorSignature?: string;
}

export type PosTenderMethod =
  | "cash"
  | "card"
  | "lankaqr"
  | "payhere"
  | "frimi"
  | "genie"
  | "ipay"
  | "bank_transfer"
  | "other";

export interface PosSaleLine {
  itemId?: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountPctBps?: number;
  taxCodeId?: string;
}

export interface PosSaleTender {
  method: PosTenderMethod;
  amountCents: number;
  bankAccountId?: string;
  reference?: string;
}

export interface CreatePosSale {
  shiftId: string;
  customerId?: string;
  branchId?: string;
  issueDate?: string;
  lines: PosSaleLine[];
  tenders: PosSaleTender[];
}

export interface PosZReport {
  shift: PosShift;
  cashier: { id: string; full_name: string; email: string } | null;
  tender: Array<{ method: PosTenderMethod; count: number; totalCents: number }>;
  invoices: {
    count: number;
    subtotalCents: number;
    discountCents: number;
    taxCents: number;
    totalCents: number;
  };
}

// ─── Commissions ─────────────────────────────────────────────────────────

export type CommissionTriggerEvent = "invoice_posted" | "payment_received";
export type CommissionFormula = "flat_pct" | "tiered_volume";
export type CommissionRuleStatus = "active" | "inactive";
export type CommissionEarningStatus =
  | "accrued"
  | "paid"
  | "clawed_back"
  | "voided";
export type CommissionSourceType =
  | "invoice"
  | "payment"
  | "credit_note"
  | "adjustment";

export interface CommissionFlatPctConfig {
  bps: number;
}

export interface CommissionTier {
  upToCents?: number | null;
  bps: number;
}

export interface CommissionTieredVolumeConfig {
  tiers: CommissionTier[];
}

export type CommissionRuleConfig =
  | CommissionFlatPctConfig
  | CommissionTieredVolumeConfig
  | Record<string, unknown>;

export interface CommissionRule {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: CommissionRuleStatus;
  triggerEvent: CommissionTriggerEvent;
  formula: CommissionFormula;
  config: CommissionRuleConfig;
  salespersonUserIds: string[] | null;
  itemIds: string[] | null;
  customerIds: string[] | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  priority: number;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateCommissionRule {
  name: string;
  description?: string;
  status?: CommissionRuleStatus;
  triggerEvent: CommissionTriggerEvent;
  formula: CommissionFormula;
  config: CommissionRuleConfig;
  salespersonUserIds?: string[] | null;
  itemIds?: string[] | null;
  customerIds?: string[] | null;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  priority?: number;
}

export interface CommissionSalesperson {
  id: string;
  userId: string;
  employeeId: string | null;
  isActive: boolean;
  defaultRateBps: number | null;
  notes: string | null;
  createdAt: string;
  userFullName: string;
  userEmail: string;
  employeeFullName: string | null;
  employeeCode: string | null;
}

export interface UpsertCommissionSalesperson {
  userId: string;
  employeeId?: string | null;
  isActive?: boolean;
  defaultRateBps?: number | null;
  notes?: string;
}

export interface CommissionEarning {
  id: string;
  ruleId: string;
  ruleName: string | null;
  salespersonUserId: string;
  sourceType: CommissionSourceType;
  sourceId: string;
  sourceNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  baseCents: number;
  rateBps: number | null;
  amountCents: number;
  status: CommissionEarningStatus;
  earnedAt: string;
  paidInRunId: string | null;
  memo: string | null;
}

export interface CommissionLedgerRow {
  salespersonUserId: string;
  fullName: string;
  email: string;
  accruedCents: number;
  paidCents: number;
  clawedBackCents: number;
  totalCents: number;
  rowCount: number;
}
