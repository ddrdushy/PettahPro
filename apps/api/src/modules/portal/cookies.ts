import type { FastifyReply } from "fastify";

// Distinct from admin `pp_session` so admin auth and portal auth can
// coexist on the same browser without collision.
export const PORTAL_SESSION_COOKIE = "pp_portal_session";
// CSRF double-submit companion to pp_portal_session (#50 / gap A5).
// Path-scoped to /portal just like the session cookie, so admin and
// portal tabs on the same browser don't cross-pollinate their tokens.
// See identity/cookies.ts for the non-HttpOnly / unsigned rationale.
export const PORTAL_CSRF_COOKIE = "pp_portal_csrf";

const isProd = process.env.NODE_ENV === "production";

export function setPortalSessionCookie(
  reply: FastifyReply,
  sessionId: string,
  maxAgeSeconds: number,
) {
  reply.setCookie(PORTAL_SESSION_COOKIE, sessionId, {
    // Portal lives under /portal on the web app — scope the cookie so it
    // doesn't get sent along with admin /app requests and vice versa.
    path: "/portal",
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    maxAge: maxAgeSeconds,
    signed: true,
  });
}

export function clearPortalSessionCookie(reply: FastifyReply) {
  reply.clearCookie(PORTAL_SESSION_COOKIE, {
    path: "/portal",
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    signed: true,
  });
}

/**
 * Set the portal CSRF cookie alongside the portal session cookie. Same
 * lifecycle as the portal session — mint on verify, clear on logout.
 */
export function setPortalCsrfCookie(reply: FastifyReply, token: string, maxAgeSeconds: number) {
  reply.setCookie(PORTAL_CSRF_COOKIE, token, {
    path: "/portal",
    httpOnly: false,
    secure: isProd,
    sameSite: "lax",
    maxAge: maxAgeSeconds,
    signed: false,
  });
}

export function clearPortalCsrfCookie(reply: FastifyReply) {
  reply.clearCookie(PORTAL_CSRF_COOKIE, {
    path: "/portal",
    httpOnly: false,
    secure: isProd,
    sameSite: "lax",
    signed: false,
  });
}
