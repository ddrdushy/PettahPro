import type { FastifyReply } from "fastify";

export const SESSION_COOKIE = "pp_session";

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
