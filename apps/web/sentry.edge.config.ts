// Sentry edge-runtime init (roadmap #46) — runs inside middleware and any
// edge-runtime route handlers. No-op when SENTRY_DSN is empty.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    release: process.env.SENTRY_RELEASE ?? "pettahpro-web@dev",
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
  });
}
