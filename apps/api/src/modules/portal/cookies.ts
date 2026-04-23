import type { FastifyReply } from "fastify";

// Distinct from admin `pp_session` so admin auth and portal auth can
// coexist on the same browser without collision.
export const PORTAL_SESSION_COOKIE = "pp_portal_session";

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
