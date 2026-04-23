/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    typedRoutes: true,
    // instrumentation.ts hook — wakes up sentry.server.config + .edge.config
    // at server start. Next 15 flips this on by default; we're on 14 so
    // we still need the opt-in. Roadmap #46.
    instrumentationHook: true,
  },
};

export default nextConfig;
