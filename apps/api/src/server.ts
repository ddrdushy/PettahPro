import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { tenantContextPlugin } from "./plugins/tenant-context.js";
import { telemetryPlugin } from "./plugins/telemetry.js";
import { errorTrackingPlugin } from "./plugins/error-tracking.js";
import { rateLimitPlugin } from "./plugins/rate-limit.js";
import { ensureBucket } from "./lib/object-storage.js";
import { attachmentsRoutes } from "./modules/platform/attachments.js";
import { identityPlugin } from "./modules/identity/plugin.js";
import { healthRoutes } from "./routes/health.js";
import { customersRoutes } from "./modules/operations/customers.js";
import { branchesRoutes } from "./modules/operations/branches.js";
import { customerStatementRoutes } from "./modules/operations/customer-statement.js";
import { customerStatementEmailRoutes } from "./modules/operations/customer-statement-email.js";
import { suppliersRoutes } from "./modules/operations/suppliers.js";
import { supplierStatementRoutes } from "./modules/operations/supplier-statement.js";
import { supplierReconcileRoutes } from "./modules/buy/supplier-reconcile.js";
import { itemsRoutes } from "./modules/operations/items.js";
import { coaRoutes, taxCodesRoutes } from "./modules/accounting/coa.js";
import { fxRatesRoutes } from "./modules/accounting/fx-rates.js";
import { fxRevaluationRoutes } from "./modules/accounting/fx-revaluation.js";
import { pettyCashRoutes } from "./modules/accounting/petty-cash.js";
import { journalEntriesRoutes } from "./modules/accounting/journal-entries.js";
import { recurringJournalsRoutes } from "./modules/accounting/recurring-journals.js";
import { fixedAssetsRoutes } from "./modules/accounting/fixed-assets.js";
import { periodsRoutes } from "./modules/accounting/periods.js";
import { whtRoutes } from "./modules/accounting/wht.js";
import { openingBalanceRoutes } from "./modules/accounting/opening-balance.js";
import { bankReconciliationRoutes } from "./modules/accounting/bank-reconciliation.js";
import { invoicesRoutes } from "./modules/sell/invoices.js";
import { recurringInvoicesRoutes } from "./modules/sell/recurring-invoices.js";
import { creditNotesRoutes } from "./modules/sell/credit-notes.js";
import { quotationsRoutes } from "./modules/sell/quotations.js";
import { proformaInvoicesRoutes } from "./modules/sell/proforma-invoices.js";
import { salesOrdersRoutes } from "./modules/sell/sales-orders.js";
import { deliveryNotesRoutes } from "./modules/sell/delivery-notes.js";
import { purchaseOrdersRoutes } from "./modules/buy/purchase-orders.js";
import { purchaseRequisitionsRoutes } from "./modules/buy/purchase-requisitions.js";
import { grnsRoutes } from "./modules/buy/grns.js";
import { paymentsRoutes } from "./modules/sell/payments.js";
import { billsRoutes } from "./modules/buy/bills.js";
import { recurringBillsRoutes } from "./modules/buy/recurring-bills.js";
import { debitNotesRoutes } from "./modules/buy/debit-notes.js";
import { supplierPaymentsRoutes } from "./modules/buy/supplier-payments.js";
import { stockRoutes } from "./modules/inventory/stock.js";
import { stockTransfersRoutes } from "./modules/inventory/stock-transfers.js";
import { itemCategoriesRoutes } from "./modules/inventory/item-categories.js";
import { stockCountsRoutes } from "./modules/inventory/stock-counts.js";
import { itemTrackingRoutes } from "./modules/inventory/item-tracking.js";
import { documentTemplatesRoutes } from "./modules/operations/document-templates.js";
import { chequesRoutes } from "./modules/cheques/routes.js";
import { employeesRoutes } from "./modules/hr/employees.js";
import { salaryRevisionsRoutes } from "./modules/hr/salary-revisions.js";
import {
  loanTypesRoutes,
  employeeLoansRoutes,
} from "./modules/hr/staff-loans.js";
import {
  bonusSchemesRoutes,
  bonusRunsRoutes,
} from "./modules/hr/bonuses.js";
import {
  expenseCategoriesRoutes,
  expenseClaimsRoutes,
} from "./modules/hr/expense-claims.js";
import { payrollRunsRoutes } from "./modules/hr/payroll-runs.js";
import { attendanceRoutes } from "./modules/hr/attendance.js";
import {
  finalSettlementRoutes,
  finalSettlementByIdRoutes,
} from "./modules/hr/final-settlement.js";
import { statutoryRoutes } from "./modules/hr/statutory.js";
import {
  salaryComponentsRoutes,
  employeeSalaryStructureRoutes,
} from "./modules/hr/salary-components.js";
import {
  leaveTypesRoutes,
  employeeLeaveRoutes,
  leaveRequestsRoutes,
} from "./modules/hr/leave.js";
import { dashboardRoutes } from "./modules/reports/dashboard.js";
import { trialBalanceRoutes } from "./modules/reports/trial-balance.js";
import { profitLossRoutes } from "./modules/reports/profit-loss.js";
import { balanceSheetRoutes } from "./modules/reports/balance-sheet.js";
import { generalLedgerRoutes } from "./modules/reports/general-ledger.js";
import { vatReturnRoutes } from "./modules/reports/vat-return.js";
import { cashFlowRoutes } from "./modules/reports/cash-flow.js";
import { threeWayMatchRoutes } from "./modules/reports/three-way-match.js";
import { arAgingRoutes, apAgingRoutes } from "./modules/reports/aging.js";
import { badDebtsRoutes } from "./modules/reports/bad-debts.js";
import { notificationsRoutes } from "./modules/notifications/routes.js";
import { settingsRoutes } from "./modules/settings/routes.js";
import { numberSeriesRoutes } from "./modules/settings/number-series.js";
import { auditLogRoutes } from "./modules/audit/routes.js";
import { approvalPoliciesRoutes } from "./modules/admin/approval-policies.js";
import { approvalsRoutes } from "./modules/admin/approvals.js";
import { rolesRoutes } from "./modules/admin/roles.js";
import { posShiftsRoutes } from "./modules/pos/shifts.js";
import { posSalesRoutes } from "./modules/pos/sales.js";
import { commissionsRoutes } from "./modules/commissions/routes.js";
import { portalPlugin } from "./modules/portal/plugin.js";

export async function buildServer(): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      transport:
        process.env.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    },
    disableRequestLogging: false,
    trustProxy: true,
  });

  // Multipart support for document attachment uploads (roadmap #32).
  // Cap at 10 MB per file — matches the DB CHECK constraint and the
  // belt-and-braces check in the attachments module.
  await server.register(multipart, {
    attachFieldsToBody: false,
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  await server.register(cors, {
    origin: (origin, cb) => {
      // Allow same-origin, localhost dev, or any *.pettahpro.lk in prod
      if (!origin) return cb(null, true);
      if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
      if (/^https:\/\/([a-z0-9-]+\.)?pettahpro\.lk$/.test(origin)) return cb(null, true);
      cb(null, false);
    },
    credentials: true,
  });

  await server.register(tenantContextPlugin);
  // Telemetry + error tracking (roadmap #46). Registered after
  // tenant-context so the Sentry scope can read req.tenantId / req.userId
  // on its onRequest hook, but before routes so they instrument everything.
  await server.register(telemetryPlugin);
  await server.register(errorTrackingPlugin);
  // Rate limiting (roadmap #47). Registered BEFORE identityPlugin so a
  // pre-auth flood (credential stuffing, signup spam, OTP enumeration)
  // is throttled without ever reaching the session cookie lookup.
  // Per-route overrides on /auth/login, /auth/signup, /portal/auth/*
  // are set via route config.
  await server.register(rateLimitPlugin);
  await server.register(identityPlugin);
  await server.register(healthRoutes, { prefix: "/health" });
  await server.register(customersRoutes, { prefix: "/customers" });
  await server.register(branchesRoutes, { prefix: "/branches" });
  await server.register(customerStatementRoutes, { prefix: "/customers" });
  await server.register(customerStatementEmailRoutes, { prefix: "/customers" });
  await server.register(suppliersRoutes, { prefix: "/suppliers" });
  await server.register(supplierStatementRoutes, { prefix: "/suppliers" });
  await server.register(supplierReconcileRoutes, { prefix: "/suppliers" });
  await server.register(itemsRoutes, { prefix: "/items" });
  // Mounted under /items so tracking URLs read as
  // /items/:id/batches, /items/batches/:id/recall, etc.
  await server.register(itemTrackingRoutes, { prefix: "/items" });
  await server.register(documentTemplatesRoutes, {
    prefix: "/document-templates",
  });
  await server.register(coaRoutes, { prefix: "/coa" });
  await server.register(taxCodesRoutes, { prefix: "/tax-codes" });
  await server.register(journalEntriesRoutes, { prefix: "/journal-entries" });
  await server.register(recurringJournalsRoutes, { prefix: "/recurring-journals" });
  await server.register(fixedAssetsRoutes, { prefix: "/fixed-assets" });
  await server.register(periodsRoutes, { prefix: "/periods" });
  await server.register(whtRoutes, { prefix: "/wht" });
  await server.register(openingBalanceRoutes, { prefix: "/opening-balance" });
  await server.register(bankReconciliationRoutes, { prefix: "/bank-reconciliation" });
  await server.register(fxRatesRoutes, { prefix: "/fx-rates" });
  await server.register(fxRevaluationRoutes, { prefix: "/fx-revaluations" });
  await server.register(pettyCashRoutes, { prefix: "/petty-cash" });
  await server.register(invoicesRoutes, { prefix: "/invoices" });
  await server.register(recurringInvoicesRoutes, { prefix: "/recurring-invoices" });
  await server.register(creditNotesRoutes, { prefix: "/credit-notes" });
  await server.register(quotationsRoutes, { prefix: "/quotations" });
  await server.register(proformaInvoicesRoutes, { prefix: "/proforma-invoices" });
  await server.register(salesOrdersRoutes, { prefix: "/sales-orders" });
  await server.register(deliveryNotesRoutes, { prefix: "/delivery-notes" });
  await server.register(purchaseOrdersRoutes, { prefix: "/purchase-orders" });
  await server.register(purchaseRequisitionsRoutes, { prefix: "/purchase-requisitions" });
  await server.register(grnsRoutes, { prefix: "/grns" });
  await server.register(paymentsRoutes, { prefix: "/payments" });
  await server.register(billsRoutes, { prefix: "/bills" });
  await server.register(recurringBillsRoutes, { prefix: "/recurring-bills" });
  await server.register(debitNotesRoutes, { prefix: "/debit-notes" });
  await server.register(supplierPaymentsRoutes, { prefix: "/supplier-payments" });
  await server.register(stockRoutes, { prefix: "/stock" });
  await server.register(stockTransfersRoutes, { prefix: "/stock-transfers" });
  await server.register(itemCategoriesRoutes, { prefix: "/item-categories" });
  await server.register(stockCountsRoutes, { prefix: "/stock-counts" });
  await server.register(chequesRoutes, { prefix: "/cheques" });
  await server.register(employeesRoutes, { prefix: "/employees" });
  await server.register(salaryRevisionsRoutes, { prefix: "/employees" });
  await server.register(employeeSalaryStructureRoutes, { prefix: "/employees" });
  await server.register(salaryComponentsRoutes, { prefix: "/salary-components" });
  await server.register(leaveTypesRoutes, { prefix: "/leave-types" });
  await server.register(employeeLeaveRoutes, { prefix: "/employees" });
  await server.register(leaveRequestsRoutes, { prefix: "/leave-requests" });
  await server.register(payrollRunsRoutes, { prefix: "/payroll-runs" });
  await server.register(finalSettlementRoutes, { prefix: "/employees" });
  await server.register(finalSettlementByIdRoutes, { prefix: "/final-settlements" });
  await server.register(statutoryRoutes, { prefix: "/payroll" });
  await server.register(loanTypesRoutes, { prefix: "/loan-types" });
  await server.register(employeeLoansRoutes, { prefix: "/employee-loans" });
  await server.register(bonusSchemesRoutes, { prefix: "/bonus-schemes" });
  await server.register(bonusRunsRoutes, { prefix: "/bonus-runs" });
  await server.register(expenseCategoriesRoutes, { prefix: "/expense-categories" });
  await server.register(expenseClaimsRoutes, { prefix: "/expense-claims" });
  await server.register(attendanceRoutes, { prefix: "/attendance" });
  await server.register(dashboardRoutes, { prefix: "/dashboard" });
  await server.register(trialBalanceRoutes, { prefix: "/reports/trial-balance" });
  await server.register(profitLossRoutes, { prefix: "/reports/profit-loss" });
  await server.register(balanceSheetRoutes, { prefix: "/reports/balance-sheet" });
  await server.register(generalLedgerRoutes, { prefix: "/reports/general-ledger" });
  await server.register(vatReturnRoutes, { prefix: "/reports/vat-return" });
  await server.register(cashFlowRoutes, { prefix: "/reports/cash-flow" });
  await server.register(threeWayMatchRoutes, { prefix: "/reports/three-way-match" });
  await server.register(arAgingRoutes, { prefix: "/reports/ar-aging" });
  await server.register(apAgingRoutes, { prefix: "/reports/ap-aging" });
  await server.register(badDebtsRoutes, { prefix: "/reports/bad-debts" });
  await server.register(notificationsRoutes, { prefix: "/notifications" });
  await server.register(settingsRoutes, { prefix: "/settings" });
  await server.register(numberSeriesRoutes, { prefix: "/number-series" });
  await server.register(auditLogRoutes, { prefix: "/audit-log" });
  await server.register(approvalPoliciesRoutes, { prefix: "/approval-policies" });
  await server.register(approvalsRoutes, { prefix: "/approvals" });
  await server.register(rolesRoutes, { prefix: "/roles" });
  await server.register(posShiftsRoutes, { prefix: "/pos/shifts" });
  await server.register(posSalesRoutes, { prefix: "/pos/sales" });
  await server.register(commissionsRoutes, { prefix: "/commissions" });
  await server.register(attachmentsRoutes, { prefix: "/attachments" });
  await server.register(portalPlugin);

  // Kick MinIO bucket creation off in the background — don't block
  // boot or crash the server if the object store is unreachable; the
  // attachment endpoints will 503 on use which is the right signal.
  ensureBucket().catch((err) => {
    server.log.warn(
      { err },
      "ensureBucket failed — attachments storage unavailable at boot",
    );
  });

  server.setErrorHandler((err, req, reply) => {
    req.log.error({ err }, "request failed");
    const status = err.statusCode ?? 500;
    reply.status(status).send({
      error: {
        code: err.code ?? "INTERNAL",
        message: status >= 500 ? "Internal server error" : err.message,
      },
    });
  });

  return server;
}
