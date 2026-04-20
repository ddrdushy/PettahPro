import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    tenantId: string | null;
    userId: string | null;
  }
}

/**
 * Extracts the tenant and user context from the request and attaches them
 * to the request object. All authenticated routes read these values.
 *
 * v1: reads from `x-tenant-id` and `x-user-id` headers (placeholder).
 * Phase 1: replace with JWT verification once auth is wired.
 */
export const tenantContextPlugin: FastifyPluginAsync = fp(
  async (fastify) => {
    fastify.decorateRequest("tenantId", null);
    fastify.decorateRequest("userId", null);

    fastify.addHook("onRequest", async (req) => {
      const tenantId = req.headers["x-tenant-id"];
      const userId = req.headers["x-user-id"];
      req.tenantId = typeof tenantId === "string" ? tenantId : null;
      req.userId = typeof userId === "string" ? userId : null;
    });
  },
  { name: "tenant-context" },
);
