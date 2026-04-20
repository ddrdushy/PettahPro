import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import cookie from "@fastify/cookie";
import { authRoutes } from "./routes.js";
import { SESSION_COOKIE } from "./cookies.js";
import { readSession } from "./sessions.js";

/**
 * Wires @fastify/cookie, the /auth/* routes, and a session-resolving
 * onRequest hook that populates req.tenantId / req.userId from the
 * signed session cookie (replacing the placeholder x-tenant-id header).
 */
export const identityPlugin: FastifyPluginAsync = fp(
  async (fastify) => {
    await fastify.register(cookie, {
      secret: process.env.SESSION_SECRET ?? "dev-session-secret-change-me",
      parseOptions: {},
    });

    fastify.addHook("onRequest", async (req) => {
      const raw = req.cookies[SESSION_COOKIE];
      if (!raw) return;
      const unsigned = req.unsignCookie(raw);
      if (!unsigned.valid || !unsigned.value) return;
      const session = await readSession(unsigned.value);
      if (!session) return;
      req.tenantId = session.tenantId;
      req.userId = session.userId;
    });

    await fastify.register(authRoutes, { prefix: "/auth" });
  },
  { name: "identity" },
);
