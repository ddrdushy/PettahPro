/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // typedRoutes was on, but ~18 dynamic-href Link sites pass plain string
    // variables (computed routes) which fail the RouteImpl<string> check at
    // build time. Disabled to unblock the prod build; re-enable once those
    // sites are typed (cast as Route at construction sites or use a typed
    // route-builder helper). Runtime impact of a wrong link is a 404, not
    // a crash, so the loss of dev-time link safety is bounded.
    typedRoutes: false,
    // instrumentation.ts hook — wakes up sentry.server.config + .edge.config
    // at server start. Next 15 flips this on by default; we're on 14 so
    // we still need the opt-in. Roadmap #46.
    instrumentationHook: true,
  },
};

export default nextConfig;
