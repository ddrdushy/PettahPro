// Next.js instrumentation hook (roadmap #46). Runs once at server start,
// before any request is served. This is the documented entry point for
// Sentry's server-side SDK — separate file for the Node.js runtime vs the
// Edge runtime because they can't share a single import graph.
//
// Both imports are no-ops when SENTRY_DSN isn't set, so this is safe to
// ship unconfigured.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}
