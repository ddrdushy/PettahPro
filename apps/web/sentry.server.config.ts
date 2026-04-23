// Sentry server-side init (roadmap #46) — runs inside the Node.js Next.js
// server process. No-op when SENTRY_DSN is empty.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    release: process.env.SENTRY_RELEASE ?? "pettahpro-web@dev",
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
    beforeSend(event) {
      const status = event.contexts?.response?.status_code;
      if (typeof status === "number" && status >= 400 && status < 500) {
        return null;
      }
      return event;
    },
  });
}
