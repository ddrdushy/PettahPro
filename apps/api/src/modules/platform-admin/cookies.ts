import type { FastifyReply } from "fastify";

// Distinct cookie namespace from tenant users (#54 / gap L1). A browser
// that has both tenant and platform cookies (e.g. a developer signed
// into both roles) won't cross-pollinate — the CSRF plugin picks the
// right pair per URL prefix, and the session-resolving hook in each
// plugin only reads its own cookie.
export const PLATFORM_SESSION_COOKIE = "pp_platform_session";
export const PLATFORM_CSRF_COOKIE = "pp_platform_csrf";

// Path-scoped to /platform so the cookie doesn't leak to tenant pages.
// This also keeps it invisible to fetch() from the tenant app, which is
// a small but real defence-in-depth against a compromised tenant-side
// script trying to sniff platform credentials.
const COOKIE_PATH = "/platform";

const isProd = process.env.NODE_ENV === "production";

export function setPlatformSessionCookie(
  reply: FastifyReply,
  sessionId: string,
  maxAgeSeconds: number,
) {
  reply.setCookie(PLATFORM_SESSION_COOKIE, sessionId, {
    path: COOKIE_PATH,
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    maxAge: maxAgeSeconds,
    signed: true,
  });
}

export function clearPlatformSessionCookie(reply: FastifyReply) {
  reply.clearCookie(PLATFORM_SESSION_COOKIE, {
    path: COOKIE_PATH,
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    signed: true,
  });
}

export function setPlatformCsrfCookie(
  reply: FastifyReply,
  token: string,
  maxAgeSeconds: number,
) {
  reply.setCookie(PLATFORM_CSRF_COOKIE, token, {
    path: COOKIE_PATH,
    httpOnly: false,
    secure: isProd,
    sameSite: "lax",
    maxAge: maxAgeSeconds,
    signed: false,
  });
}

export function clearPlatformCsrfCookie(reply: FastifyReply) {
  reply.clearCookie(PLATFORM_CSRF_COOKIE, {
    path: COOKIE_PATH,
    httpOnly: false,
    secure: isProd,
    sameSite: "lax",
    signed: false,
  });
}
