import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { tenantContextPlugin } from "./plugins/tenant-context.js";
import { identityPlugin } from "./modules/identity/plugin.js";
import { healthRoutes } from "./routes/health.js";
import { customersRoutes } from "./modules/operations/customers.js";
import { branchesRoutes } from "./modules/operations/branches.js";
import { customerStatementRoutes } from "./modules/operations/customer-statement.js";
import { suppliersRoutes } from "./modules/operations/suppliers.js";
import { supplierStatementRoutes } from "./modules/operations/supplier-statement.js";
import { itemsRoutes } from "./modules/operations/items.js";
import { coaRoutes, taxCodesRoutes } from "./modules/accounting/coa.js";
import { journalEntriesRoutes } from "./modules/accounting/journal-entries.js";
import { fixedAssetsRoutes } from "./modules/accounting/fixed-assets.js";
import { bankReconciliationRoutes } from "./modules/accounting/bank-reconciliation.js";
import { invoicesRoutes } from "./modules/sell/invoices.js";
import { recurringInvoicesRoutes } from "./modules/sell/recurring-invoices.js";
import { creditNotesRoutes } from "./modules/sell/credit-notes.js";
import { quotationsRoutes } from "./modules/sell/quotations.js";
import { salesOrdersRoutes } from "./modules/sell/sales-orders.js";
import { deliveryNotesRoutes } from "./modules/sell/delivery-notes.js";
import { purchaseOrdersRoutes } from "./modules/buy/purchase-orders.js";
import { grnsRoutes } from "./modules/buy/grns.js";
import { paymentsRoutes } from "./modules/sell/payments.js";
import { billsRoutes } from "./modules/buy/bills.js";
import { debitNotesRoutes } from "./modules/buy/debit-notes.js";
import { supplierPaymentsRoutes } from "./modules/buy/supplier-payments.js";
import { stockRoutes } from "./modules/inventory/stock.js";
import { chequesRoutes } from "./modules/cheques/routes.js";
import { employeesRoutes } from "./modules/hr/employees.js";
import { payrollRunsRoutes } from "./modules/hr/payroll-runs.js";
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
import { notificationsRoutes } from "./modules/notifications/routes.js";
import { settingsRoutes } from "./modules/settings/routes.js";

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
  await server.register(identityPlugin);
  await server.register(healthRoutes, { prefix: "/health" });
  await server.register(customersRoutes, { prefix: "/customers" });
  await server.register(branchesRoutes, { prefix: "/branches" });
  await server.register(customerStatementRoutes, { prefix: "/customers" });
  await server.register(suppliersRoutes, { prefix: "/suppliers" });
  await server.register(supplierStatementRoutes, { prefix: "/suppliers" });
  await server.register(itemsRoutes, { prefix: "/items" });
  await server.register(coaRoutes, { prefix: "/coa" });
  await server.register(taxCodesRoutes, { prefix: "/tax-codes" });
  await server.register(journalEntriesRoutes, { prefix: "/journal-entries" });
  await server.register(fixedAssetsRoutes, { prefix: "/fixed-assets" });
  await server.register(bankReconciliationRoutes, { prefix: "/bank-reconciliation" });
  await server.register(invoicesRoutes, { prefix: "/invoices" });
  await server.register(recurringInvoicesRoutes, { prefix: "/recurring-invoices" });
  await server.register(creditNotesRoutes, { prefix: "/credit-notes" });
  await server.register(quotationsRoutes, { prefix: "/quotations" });
  await server.register(salesOrdersRoutes, { prefix: "/sales-orders" });
  await server.register(deliveryNotesRoutes, { prefix: "/delivery-notes" });
  await server.register(purchaseOrdersRoutes, { prefix: "/purchase-orders" });
  await server.register(grnsRoutes, { prefix: "/grns" });
  await server.register(paymentsRoutes, { prefix: "/payments" });
  await server.register(billsRoutes, { prefix: "/bills" });
  await server.register(debitNotesRoutes, { prefix: "/debit-notes" });
  await server.register(supplierPaymentsRoutes, { prefix: "/supplier-payments" });
  await server.register(stockRoutes, { prefix: "/stock" });
  await server.register(chequesRoutes, { prefix: "/cheques" });
  await server.register(employeesRoutes, { prefix: "/employees" });
  await server.register(employeeSalaryStructureRoutes, { prefix: "/employees" });
  await server.register(salaryComponentsRoutes, { prefix: "/salary-components" });
  await server.register(leaveTypesRoutes, { prefix: "/leave-types" });
  await server.register(employeeLeaveRoutes, { prefix: "/employees" });
  await server.register(leaveRequestsRoutes, { prefix: "/leave-requests" });
  await server.register(payrollRunsRoutes, { prefix: "/payroll-runs" });
  await server.register(statutoryRoutes, { prefix: "/payroll" });
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
  await server.register(notificationsRoutes, { prefix: "/notifications" });
  await server.register(settingsRoutes, { prefix: "/settings" });

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
