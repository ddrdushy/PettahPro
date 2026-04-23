// Roadmap #47 — per-IP rate limiting.
//
// Design notes:
//
//  * Backed by the same redis instance the app already runs (sessions,
//    bullmq, portal OTPs). Keeps the ops surface to exactly one more
//    plugin, zero new infra.
//
//  * Global default is generous on purpose — we want it to be invisible
//    to a legitimate tenant clicking around the UI. The load-bearing
//    limits are the per-route overrides on /auth/login, /auth/signup,
//    /portal/auth/request-otp and /portal/auth/verify (see routes.ts
//    and auth.ts in the respective modules) — those are where a
//    compromised attacker actually gets value from hammering.
//
//  * `skipOnError: true` fails OPEN if redis is unreachable. In an
//    outage we'd rather serve the app than blanket 503 the tenants;
//    the brute-force risk window is still bounded by how long redis
//    is down, which we'd notice from the observability stack anyway.
//
//  * /health and /metrics are allow-listed so the Prometheus scraper
//    and any upstream load-balancer checks can never get rate-limited.
//
//  * Response shape `{ error: { code: "RATE_LIMITED", ... } }` matches
//    the app's error envelope (see server.ts setErrorHandler). Web
//    error surfaces render the `message` directly.
//
//  * Flip RATE_LIMIT_DISABLED=true to turn the whole thing off for a
//    debugging session — useful when reproducing an issue locally and
//    the limit keeps clipping your cycle.
import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import rateLimit from "@fastify/rate-limit";
import IORedis from "ioredis";

let redisClient: IORedis | null = null;

function getRedis(): IORedis {
  if (!redisClient) {
    redisClient = new IORedis(
      process.env.REDIS_URL ?? "redis://localhost:6379",
      {
        // The rate-limit plugin is chatty — one GET+INCR per request.
        // We explicitly do NOT want to queue commands while redis is
        // down; better to fail fast + fall through to `skipOnError`.
        enableOfflineQueue: false,
        connectTimeout: 500,
        maxRetriesPerRequest: 1,
        // Prefix keeps rate-limit keys out of the way of session /
        // OTP / bullmq keys that live on the same redis instance.
        keyPrefix: "pp-ratelimit:",
      },
    );
    // Don't crash the process on transient redis noise — the plugin's
    // skipOnError branch is the real safety net.
    redisClient.on("error", () => {
      /* intentionally silent — logged via plugin's skipOnError path */
    });
  }
  return redisClient;
}

export const rateLimitPlugin: FastifyPluginAsync = fp(
  async (fastify) => {
    if (process.env.RATE_LIMIT_DISABLED === "true") {
      fastify.log.info(
        "rate limiting disabled via RATE_LIMIT_DISABLED=true",
      );
      return;
    }

    const globalMax = Number(process.env.RATE_LIMIT_GLOBAL_MAX ?? 600);
    const globalWindow =
      process.env.RATE_LIMIT_GLOBAL_WINDOW ?? "1 minute";

    await fastify.register(rateLimit, {
      global: true,
      max: globalMax,
      timeWindow: globalWindow,
      redis: getRedis(),
      // If we're already over budget, keep counting (so repeated
      // requests extend the cooldown) rather than letting the counter
      // reset at window boundaries.
      continueExceeding: true,
      // Fail open on redis outage (see note above).
      skipOnError: true,
      // req.ip honours trustProxy: true in server.ts — correct client
      // IP when behind a reverse proxy.
      keyGenerator: (req) => req.ip,
      allowList: (req) => {
        // Liveness / readiness / Prometheus scrape must never be
        // gated — these are polled every few seconds by infra.
        return (
          req.url === "/health" ||
          req.url === "/health/" ||
          req.url === "/metrics"
        );
      },
      errorResponseBuilder: (_req, context) => ({
        error: {
          code: "RATE_LIMITED",
          message: `Too many requests. Please retry in ${context.after}.`,
          retryAfterSeconds: Math.ceil(context.ttl / 1000),
        },
      }),
    });

    fastify.log.info(
      { globalMax, globalWindow },
      "rate limiter armed",
    );
  },
  { name: "rate-limit" },
);
