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
  createCustomer: (body: CreateCustomer) =>
    request<{ customer: Customer }>("/customers", { method: "POST", json: body }),

  listSuppliers: (q?: string) =>
    request<{ suppliers: Supplier[] }>(`/suppliers${q ? `?q=${encodeURIComponent(q)}` : ""}`),
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

  dashboard: () => request<Dashboard>("/dashboard"),

  listPayments: () => request<{ payments: PaymentListRow[] }>("/payments"),
  createPayment: (body: CreatePayment) =>
    request<{
      ok: true;
      payment: Payment;
      paymentNumber: string;
      entryNumber: string;
    }>("/payments", { method: "POST", json: body }),
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
  revenueThisMonthCents: number;
  revenueLastMonthCents: number;
  invoicesThisMonth: number;
  paymentsThisMonthCents: number;
  aging: AgingBucket[];
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
