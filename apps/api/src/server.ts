import Fastify, { type FastifyInstance } from "fastify";
import { tenantContextPlugin } from "./plugins/tenant-context.js";
import { healthRoutes } from "./routes/health.js";

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

  await server.register(tenantContextPlugin);
  await server.register(healthRoutes, { prefix: "/health" });

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
