import type { FastifyReply } from "fastify";

export const SESSION_COOKIE = "pp_session";
// CSRF double-submit companion to pp_session (#50 / gap A5). Deliberately
// NOT HttpOnly so the web client can read it in JS and mirror its value
// into the X-CSRF-Token header on mutating requests. NOT signed — the
// token itself is 256 bits of random, signing adds zero defence against
// CSRF (the attacker on a different origin can't read it regardless of
// signing because of SameSite=Lax + same-origin policy on document.cookie).
export const CSRF_COOKIE = "pp_csrf";

const isProd = process.env.NODE_ENV === "production";

export function setSessionCookie(reply: FastifyReply, sessionId: string, maxAgeSeconds: number) {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    path: "/",
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    maxAge: maxAgeSeconds,
    signed: true,
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, {
    path: "/",
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    signed: true,
  });
}

/**
 * Set the CSRF cookie alongside the session cookie. Call this from every
 * site that calls setSessionCookie — signup, login, change-password. The
 * token lives on session.csrfToken; this function just surfaces it to the
 * browser so the client can echo it back in the X-CSRF-Token header.
 */
export function setCsrfCookie(reply: FastifyReply, token: string, maxAgeSeconds: number) {
  reply.setCookie(CSRF_COOKIE, token, {
    path: "/",
    // Readable by client-side JS. If an attacker has XSS they've already
    // lost — the session cookie is the actual secret and HttpOnly protects
    // that. CSRF protection is a separate concern (cross-origin).
    httpOnly: false,
    secure: isProd,
    sameSite: "lax",
    maxAge: maxAgeSeconds,
    signed: false,
  });
}

export function clearCsrfCookie(reply: FastifyReply) {
  reply.clearCookie(CSRF_COOKIE, {
    path: "/",
    httpOnly: false,
    secure: isProd,
    sameSite: "lax",
    signed: false,
  });
}
