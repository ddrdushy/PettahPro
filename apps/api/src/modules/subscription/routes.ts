import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../../lib/with-tenant.js";
import { getTenantSubscription } from "../../lib/plan-gate.js";

/**
 * Tenant-side subscription endpoint (#62). Any signed-in user on the
 * tenant can read their current plan — used by the "Your plan" card on
 * /app/settings and by the upgrade-CTA dialog rendered in the web app
 * when an API call returns PLAN_REQUIRED.
 *
 * Deliberately unpermissioned beyond requireAuth: every user who sees
 * a gated feature deserves to know which plan they're on. Mutating the
 * plan (change-plan / cancel / etc.) happens via the platform-admin
 * endpoints today — self-serve upgrade flow ships in #64.
 */
export const subscriptionRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const subscription = await getTenantSubscription(ctx.tenantId);
    if (!subscription) {
      // No subscription row — this is the same failure mode described
      // in plan-gate.ts (pre-backfill tenant, or a race on a freshly
      // created tenant before the backfill job runs). 404 is correct:
      // there's no subscription to return. The UI shows a "contact
      // support" fallback.
      return reply.status(404).send({
        error: {
          code: "NO_SUBSCRIPTION",
          message: "No subscription is associated with this tenant.",
        },
      });
    }

    return reply.send({ subscription });
  });
};
