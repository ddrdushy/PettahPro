// Sentry client-side init (roadmap #46).
//
// Runs in the browser. No-op when NEXT_PUBLIC_SENTRY_DSN is empty — this is
// the safe default for dev / preview environments.
//
// Upstream: https://docs.sentry.io/platforms/javascript/guides/nextjs/
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? "pettahpro-web@dev",
    environment: process.env.NEXT_PUBLIC_SENTRY_ENV ?? "development",
    // Client-side traces are expensive (network payload + CPU). Default off;
    // opt in via env when debugging a specific slow page.
    tracesSampleRate: Number(
      process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0,
    ),
    // Don't report 4xx JSON responses from the API — they're validation / 403
    // flow, not client bugs.
    beforeSend(event) {
      const status = event.contexts?.response?.status_code;
      if (typeof status === "number" && status >= 400 && status < 500) {
        return null;
      }
      return event;
    },
  });
}
