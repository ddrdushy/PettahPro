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
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
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

  me: () => request<{ user: User; tenant: Tenant }>("/auth/me", { method: "GET" }),

  listCustomers: (q?: string) =>
    request<{ customers: Customer[] }>(`/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  getCustomer: (id: string) => request<CustomerDetail>(`/customers/${id}`),
  createCustomer: (body: CreateCustomer) =>
    request<{ customer: Customer }>("/customers", { method: "POST", json: body }),

  listSuppliers: (q?: string) =>
    request<{ suppliers: Supplier[] }>(`/suppliers${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  getSupplier: (id: string) => request<SupplierDetail>(`/suppliers/${id}`),
  createSupplier: (body: CreateSupplier) =>
    request<{ supplier: Supplier }>("/suppliers", { method: "POST", json: body }),

  listItems: (q?: string) =>
    request<{ items: Item[] }>(`/items${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  createItem: (body: CreateItem) =>
    request<{ item: Item }>("/items", { method: "POST", json: body }),

  listCoa: () => request<{ accounts: Account[] }>("/coa"),
  listTaxCodes: () => request<{ taxCodes: TaxCode[] }>("/tax-codes"),

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

  listBills: () => request<{ bills: BillListRow[] }>("/bills"),
  getBill: (id: string) =>
    request<{ bill: BillDetail; lines: BillLine[]; supplier: Supplier | null }>(`/bills/${id}`),
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

  listStock: () =>
    request<{ balances: StockBalanceRow[]; totalValueCents: number }>("/stock"),
  stockLedger: (itemId: string) =>
    request<{ movements: StockLedgerMovement[] }>(`/stock/ledger?itemId=${itemId}`),

  listEmployees: (q?: string) =>
    request<{ employees: EmployeeListRow[] }>(
      `/employees${q ? `?q=${encodeURIComponent(q)}` : ""}`,
    ),
  getEmployee: (id: string) => request<{ employee: Employee }>(`/employees/${id}`),
  createEmployee: (body: CreateEmployee) =>
    request<{ employee: Employee }>("/employees", { method: "POST", json: body }),
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

export interface Customer {
  id: string;
  code: string | null;
  name: string;
  legalName: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  city: string | null;
  country: string;
  tin: string | null;
  vatNo: string | null;
  paymentTermsDays: number;
  creditLimitCents: number;
  currency: string;
  isActive: boolean;
  createdAt: string;
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
}

export type InvoiceStatus = "draft" | "posted" | "partially_paid" | "paid" | "void";
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
  totalCents: number;
  amountPaidCents: number;
  balanceDueCents: number;
  notes: string | null;
  journalEntryId: string | null;
  postedAt: string | null;
  createdAt: string;
  updatedAt: string;
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
  notes?: string;
  lines: CreateBillLine[];
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
  issueDate?: string;
  dueDate?: string;
  reference?: string;
  poNumber?: string;
  notes?: string;
  terms?: string;
  lines: CreateInvoiceLine[];
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
