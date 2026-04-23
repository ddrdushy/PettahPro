import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import * as Sentry from "@sentry/node";

/**
 * Error tracking plugin (roadmap #46).
 *
 * Initialises the Sentry SDK at boot when `SENTRY_DSN` is set and attaches
 * a request hook that tags every event with the authenticated tenant + user
 * ids. When the DSN is empty (dev boxes, ephemeral environments, anyone who
 * hasn't wired up GlitchTip / Sentry yet) everything is a no-op — the SDK
 * is safe to call whether or not it's been initialised.
 *
 * The SDK speaks the Sentry protocol; it works against either the hosted
 * product at sentry.io or a self-hosted GlitchTip instance (the compose
 * file at docker-compose.observability.yml bootstraps one). Swap backends
 * by changing `SENTRY_DSN` — no code changes.
 */

let initialised = false;

function ensureInitialised(): boolean {
  if (initialised) return true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;

  Sentry.init({
    dsn,
    release: process.env.SENTRY_RELEASE ?? "pettahpro-api@dev",
    environment: process.env.NODE_ENV ?? "development",
    // Low sample rate by default — errors are always captured, traces
    // are for debugging specific latency issues. Raise in env if needed.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
    // Don't spam Sentry with 4xx validation errors. 401/403/404/409/422
    // are application flow, not bugs — the team's audit log catches those.
    beforeSend(event) {
      const status = event.contexts?.response?.status_code;
      if (typeof status === "number" && status >= 400 && status < 500) {
        return null;
      }
      return event;
    },
  });
  initialised = true;
  return true;
}

export const errorTrackingPlugin: FastifyPluginAsync = fp(
  async (fastify) => {
    const on = ensureInitialised();
    if (!on) {
      fastify.log.info(
        "SENTRY_DSN not set; error tracking plugin is a no-op.",
      );
      return;
    }
    fastify.log.info("Error tracking plugin active.");

    // Tag every in-flight request with tenant + user so the dashboard can
    // filter by "show me all 500s for tenant X." The tenant-context plugin
    // runs before this one (registered earlier in server.ts) so the fields
    // are already attached.
    fastify.addHook("onRequest", async (req) => {
      Sentry.getCurrentScope().setTag(
        "tenant_id",
        req.tenantId ?? "anonymous",
      );
      Sentry.getCurrentScope().setTag("user_id", req.userId ?? "anonymous");
      Sentry.getCurrentScope().setTransactionName(
        `${req.method} ${req.routeOptions?.url ?? req.url}`,
      );
    });

    // Capture unhandled errors from route handlers. Fastify's errorHandler
    // still renders a JSON error back to the client — we just pipe a copy
    // into Sentry on the way out.
    fastify.addHook("onError", async (req, reply, err) => {
      Sentry.captureException(err, {
        contexts: {
          response: { status_code: reply.statusCode },
        },
        tags: {
          method: req.method,
          route: req.routeOptions?.url ?? "unmatched",
        },
      });
    });
  },
  { name: "error-tracking" },
);

/** Worker processes use this directly since they don't go through the
 *  fastify lifecycle. Safe to call repeatedly. */
export function initErrorTrackingForWorker(): void {
  ensureInitialised();
}

/** Exposed for manual capture from non-HTTP code paths (cron jobs,
 *  queue workers). No-op when DSN isn't set. */
export function captureException(
  err: unknown,
  context?: Record<string, unknown>,
): void {
  if (!ensureInitialised()) return;
  Sentry.captureException(err, {
    extra: context,
  });
}
