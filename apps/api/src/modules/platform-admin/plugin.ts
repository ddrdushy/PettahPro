import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { platformAdminRoutes } from "./routes.js";
import { platformImpersonationRoutes } from "./impersonation-routes.js";

/**
 * Registers all platform-admin routes under `/platform`. Depends on the
 * `identity` plugin for @fastify/cookie — platform cookies are signed
 * with the same SESSION_SECRET, which is intentional: one secret to
 * rotate, and the cookie *names* are distinct enough that no cross-talk
 * is possible (a signed pp_platform_session doesn't verify against
 * code that reads pp_session because the cookie name isn't part of
 * the signed payload but the lookup is by name).
 *
 * The CSRF double-submit plugin handles /platform URLs with its own
 * cookie pair — see apps/api/src/plugins/csrf.ts.
 */
export const platformAdminPlugin: FastifyPluginAsync = fp(
  async (fastify) => {
    await fastify.register(platformAdminRoutes, { prefix: "/platform" });
    await fastify.register(platformImpersonationRoutes, { prefix: "/platform" });
  },
  { name: "platform-admin", dependencies: ["identity"] },
);
