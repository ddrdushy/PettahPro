import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { portalAuthRoutes } from "./auth.js";
import { portalDataRoutes } from "./data.js";
import { PORTAL_SESSION_COOKIE } from "./cookies.js";
import { readPortalSession, type PortalSession } from "./sessions.js";

declare module "fastify" {
  interface FastifyRequest {
    portalSession: PortalSession | null;
  }
}

/**
 * Mounts everything under /portal. Two public routes (request-otp +
 * verify) and everything else behind a portal-session onRequest hook.
 *
 * Deliberately separate from the admin identity plugin — the cookie is
 * different, the cookie path is scoped to /portal, and a customer who
 * happens to share an email with an admin user on the same tenant must
 * not get admin context.
 */
export const portalPlugin: FastifyPluginAsync = fp(
  async (fastify) => {
    fastify.decorateRequest("portalSession", null);

    // Resolve the portal session cookie before every /portal request so
    // handlers can gate on requirePortalSession().
    fastify.addHook("onRequest", async (req: FastifyRequest) => {
      if (!req.url.startsWith("/portal")) return;
      const raw = req.cookies[PORTAL_SESSION_COOKIE];
      if (!raw) return;
      const unsigned = req.unsignCookie(raw);
      if (!unsigned.valid || !unsigned.value) return;
      const session = await readPortalSession(unsigned.value);
      if (!session) return;
      req.portalSession = session;
    });

    await fastify.register(portalAuthRoutes, { prefix: "/portal/auth" });
    await fastify.register(portalDataRoutes, { prefix: "/portal" });
  },
  { name: "portal" },
);

/**
 * Guards a portal data route — 401 if no portal session on the request.
 */
export function requirePortalSession(
  req: FastifyRequest,
  reply: FastifyReply,
): PortalSession | null {
  if (!req.portalSession) {
    reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });
    return null;
  }
  return req.portalSession;
}
