// Roadmap #50 / gap A5 — CSRF double-submit belt-and-braces.
//
// First layer of defence is already SameSite=Lax on pp_session /
// pp_portal_session plus the app's same-origin CORS policy (see server.ts
// — only same-origin or *.pettahpro.lk origins are credentialled). That
// alone stops the classic cross-site form-post attack from an attacker
// page on evil.example.
//
// This plugin adds a second, independent layer: a double-submit token
// that lives on both the session record (read from Redis inside
// readSession / readPortalSession) and a non-HttpOnly companion cookie
// (pp_csrf / pp_portal_csrf). On every mutating request the client
// echoes the cookie value back via the X-CSRF-Token header; we
// constant-time compare it against the session's csrfToken. An attacker
// on another origin can't read the cookie (same-origin policy on
// document.cookie + the CORS block on fetch responses), so can't
// construct the header, so can't get past this check even if SameSite
// ever regresses or the browser ships a buggy cookie default.
//
// Why double-submit instead of rotating-per-request tokens? The threat
// we're defending against is "attacker POSTs on behalf of a logged-in
// user from another origin," not "attacker predicts the next token" —
// a 256-bit session-lifetime static token is plenty, and a per-request
// token would break parallel tab usage + all the action POSTs the web
// app makes without coordinated refresh.
//
// Exemptions:
//   - GET / HEAD / OPTIONS never mutate, never checked.
//   - Pre-session endpoints (login, signup, portal OTP) have no session
//     yet, so there's no double-submit value to compare. They're
//     protected instead by SameSite + rate-limit (#47 / #89) + the
//     fact that login CSRF is a dead-end (attacker signs the victim
//     into the attacker's account, which is exactly backwards).
//   - If a request has no session cookie at all, we skip — the handler
//     will 401 on its own and there's nothing for CSRF to protect.
//
// Rollout:
//   readSession / readPortalSession back-fill csrfToken for blobs
//   minted before this plugin shipped (see identity/sessions.ts and
//   portal/sessions.ts), so existing logged-in users don't get booted
//   on deploy — their first mutating request mints the token on the
//   server side, and the cookie is set by the next session touch. In
//   practice, because the cookie is only set on signup/login/verify/
//   change-password, pre-existing sessions will need to log in again to
//   get the cookie — but that's a one-off on deploy day, not an ongoing
//   friction.
import { timingSafeEqual } from "node:crypto";
import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { CSRF_COOKIE, SESSION_COOKIE } from "../modules/identity/cookies.js";
import { PORTAL_CSRF_COOKIE, PORTAL_SESSION_COOKIE } from "../modules/portal/cookies.js";
import { readSession } from "../modules/identity/sessions.js";
import { readPortalSession } from "../modules/portal/sessions.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Paths that never have a session cookie at the point they run. Keeping
// this tight — everything else goes through the double-submit check.
// Prefix match (startsWith) because /portal/auth/verify + variants with
// a trailing slash or query string both need to land.
const EXEMPT_PREFIXES = [
  // `/auth/login` covers both step 1 (`/auth/login`) and step 2
  // (`/auth/login/mfa`, #51) — both are pre-session and there's no
  // double-submit token to check yet.
  "/auth/login",
  "/auth/signup",
  "/portal/auth/request-otp",
  "/portal/auth/verify",
];

// Liveness / readiness / scrape endpoints — never CSRF-checked. The
// rate-limit plugin's allowList already ignores these; we mirror the
// shape so a synthetic POST to /health can't be wedged by a missing
// header in a test.
const HEALTH_PREFIXES = ["/health", "/metrics"];

function isExempt(url: string): boolean {
  // Strip query string for the startsWith check so /auth/login?next=... hits.
  const path = url.split("?", 1)[0] ?? url;
  if (HEALTH_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return true;
  }
  return EXEMPT_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

function safeEqual(a: string, b: string): boolean {
  // timingSafeEqual throws if lengths differ — guard first so a
  // length-based side channel can't leak through the thrown exception's
  // propagation time. Both tokens are base64url of a fixed-size buffer
  // so a mismatch here means "tampered" and we can bail.
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function reject(req: FastifyRequest, reply: FastifyReply, reason: string) {
  req.log.warn({ url: req.url, method: req.method, reason }, "csrf reject");
  return reply.status(403).send({
    error: { code: "CSRF_INVALID", message: "CSRF token missing or invalid." },
  });
}

export const csrfPlugin: FastifyPluginAsync = fp(
  async (fastify) => {
    if (process.env.CSRF_DISABLED === "true") {
      fastify.log.warn(
        "CSRF double-submit disabled via CSRF_DISABLED=true — dev-only, never set in prod",
      );
      return;
    }

    fastify.addHook("onRequest", async (req, reply) => {
      // Safe methods never carry mutations — skip entirely.
      if (SAFE_METHODS.has(req.method)) return;
      if (isExempt(req.url)) return;

      const isPortal = req.url.startsWith("/portal");

      // Portal vs admin uses different cookies — pick the pair that
      // matches the URL scope. A portal request with only an admin
      // session cookie (or vice versa) falls through to "no session"
      // below and the downstream handler will 401, which is fine.
      const sessionCookieName = isPortal ? PORTAL_SESSION_COOKIE : SESSION_COOKIE;
      const csrfCookieName = isPortal ? PORTAL_CSRF_COOKIE : CSRF_COOKIE;

      const rawSession = req.cookies[sessionCookieName];
      if (!rawSession) {
        // No session means the handler will 401 — nothing for CSRF to
        // guard. Letting it through keeps error shape consistent
        // (UNAUTHENTICATED not CSRF_INVALID).
        return;
      }
      const unsigned = req.unsignCookie(rawSession);
      if (!unsigned.valid || !unsigned.value) {
        // Tampered session cookie — same deal, downstream 401s.
        return;
      }
      const session = isPortal
        ? await readPortalSession(unsigned.value)
        : await readSession(unsigned.value);
      if (!session) {
        // Session expired / revoked — downstream 401.
        return;
      }

      const cookieToken = req.cookies[csrfCookieName];
      const headerToken = req.headers["x-csrf-token"];
      const headerValue = Array.isArray(headerToken) ? headerToken[0] : headerToken;

      if (!cookieToken || !headerValue) {
        return reject(req, reply, "missing cookie or header");
      }
      // Double-submit: both must match AND both must match the
      // server-side token on the session. The server-side compare is
      // what actually stops forgery — the cookie<->header check is a
      // low-cost sanity gate that catches bugs where the client forgot
      // to mirror the cookie.
      if (!safeEqual(cookieToken, headerValue)) {
        return reject(req, reply, "cookie/header mismatch");
      }
      if (!safeEqual(cookieToken, session.csrfToken)) {
        return reject(req, reply, "token does not match session");
      }
    });

    fastify.log.info("csrf double-submit armed");
  },
  { name: "csrf", dependencies: ["identity"] },
);
