import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { tenantContextPlugin } from "./plugins/tenant-context.js";
import { identityPlugin } from "./modules/identity/plugin.js";
import { healthRoutes } from "./routes/health.js";
import { customersRoutes } from "./modules/operations/customers.js";
import { suppliersRoutes } from "./modules/operations/suppliers.js";
import { itemsRoutes } from "./modules/operations/items.js";
import { coaRoutes, taxCodesRoutes } from "./modules/accounting/coa.js";
import { invoicesRoutes } from "./modules/sell/invoices.js";
import { paymentsRoutes } from "./modules/sell/payments.js";
import { billsRoutes } from "./modules/buy/bills.js";
import { dashboardRoutes } from "./modules/reports/dashboard.js";

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
  await server.register(suppliersRoutes, { prefix: "/suppliers" });
  await server.register(itemsRoutes, { prefix: "/items" });
  await server.register(coaRoutes, { prefix: "/coa" });
  await server.register(taxCodesRoutes, { prefix: "/tax-codes" });
  await server.register(invoicesRoutes, { prefix: "/invoices" });
  await server.register(paymentsRoutes, { prefix: "/payments" });
  await server.register(billsRoutes, { prefix: "/bills" });
  await server.register(dashboardRoutes, { prefix: "/dashboard" });

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
