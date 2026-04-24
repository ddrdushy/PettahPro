import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import cookie from "@fastify/cookie";
import { authRoutes } from "./routes.js";
import { SESSION_COOKIE } from "./cookies.js";
import { readSession, type Session } from "./sessions.js";
import { enterImpersonation } from "../../lib/impersonation-context.js";

declare module "fastify" {
  interface FastifyRequest {
    // #57 / gap L1 v1 — the resolved tenant session blob. Decorated
    // here so downstream handlers (approval routes, impersonation
    // routes) can read the impersonation stamps without a second
    // Redis read.
    session: Session | null;
  }
}

/**
 * Wires @fastify/cookie, the /auth/* routes, and a session-resolving
 * onRequest hook that populates req.tenantId / req.userId from the
 * signed session cookie (replacing the placeholder x-tenant-id header).
 *
 * Also enters an AsyncLocalStorage scope carrying the impersonation
 * context (if any) so recordAuditEvent can stamp dual-actor
 * attribution without every audit write site needing to know.
 */
export const identityPlugin: FastifyPluginAsync = fp(
  async (fastify) => {
    await fastify.register(cookie, {
      secret: process.env.SESSION_SECRET ?? "dev-session-secret-change-me",
      parseOptions: {},
    });

    fastify.decorateRequest("session", null);

    fastify.addHook("onRequest", async (req) => {
      const raw = req.cookies[SESSION_COOKIE];
      if (!raw) return;
      const unsigned = req.unsignCookie(raw);
      if (!unsigned.valid || !unsigned.value) return;
      const session = await readSession(unsigned.value);
      if (!session) return;
      req.tenantId = session.tenantId;
      req.userId = session.userId;
      req.session = session;
    });

    // Second hook: attach the impersonation context to the request's
    // async chain so recordAuditEvent can stamp dual-actor
    // attribution. Uses AsyncLocalStorage.enterWith, which installs
    // the store for the CURRENT async resource (this request) and
    // all its descendants. Fastify's per-request async chain means
    // one request's context cannot bleed into another's — each is
    // rooted at its own connection-read event.
    fastify.addHook("onRequest", async (req) => {
      const s = req.session;
      if (s?.impersonatedByPlatformUserId && s.impersonatedByPlatformUserEmail) {
        enterImpersonation({
          platformUserId: s.impersonatedByPlatformUserId,
          platformUserEmail: s.impersonatedByPlatformUserEmail,
        });
      }
    });

    await fastify.register(authRoutes, { prefix: "/auth" });
  },
  { name: "identity" },
);
