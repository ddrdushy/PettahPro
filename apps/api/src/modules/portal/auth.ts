import { createHash, randomInt } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db, withTenant } from "@pettahpro/db";
import { sendEmail } from "../../lib/email.js";
import { recordAuditEvent } from "../../lib/audit.js";
import {
  createPortalSession,
  destroyPortalSession,
  readPortalSession,
  tryConsumeOtpRateBudget,
  tryConsumeVerifyRateBudget,
} from "./sessions.js";
import {
  PORTAL_SESSION_COOKIE,
  clearPortalCsrfCookie,
  clearPortalSessionCookie,
  setPortalCsrfCookie,
  setPortalSessionCookie,
} from "./cookies.js";

type PortalCustomerRow = {
  tenant_id: string;
  customer_id: string;
  customer_name: string;
  customer_email: string;
  business_name: string;
  tenant_slug: string;
};

type PortalOtpRow = {
  id: string;
  tenant_id: string;
  customer_id: string;
  email: string;
  expires_at: string;
  consumed_at: string | null;
};

type PortalSessionResolveRow = {
  tenant_id: string;
  tenant_slug: string;
  business_name: string;
  tenant_timezone: string;
  customer_id: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  customer_active: boolean;
};

const SESSION_TTL = 60 * 60 * 24 * 14;
const OTP_EXPIRY_MS = 10 * 60 * 1000;

const RequestOtpSchema = z.object({
  email: z.string().email().max(255).toLowerCase(),
});

const VerifySchema = z.object({
  email: z.string().email().max(255).toLowerCase(),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
  // If the email matches customer rows across multiple tenants the
  // caller disambiguates by passing the tenant slug they want to land
  // in. Optional — we default to the single match when it's unique.
  tenantSlug: z.string().min(1).max(63).optional(),
});

function generateNumericCode(): string {
  // crypto.randomInt upper-exclusive — `1_000_000` gives us 0..999_999.
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function renderOtpEmail(args: {
  businessName: string;
  customerName: string;
  code: string;
  expiryMinutes: number;
}): { subject: string; html: string; text: string } {
  const subject = `${args.businessName} — your portal sign-in code`;
  const preheader = `Your sign-in code is ${args.code}. It expires in ${args.expiryMinutes} minutes.`;
  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f6f7f4;font-family:-apple-system,Segoe UI,Inter,sans-serif;color:#0e1111">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}</div>
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
    <tr><td align="center" style="padding:32px 16px">
      <table width="100%" style="max-width:520px" cellpadding="0" cellspacing="0" role="presentation">
        <tr><td style="background:#ffffff;border:1px solid #e6e6df;border-radius:12px;padding:32px">
          <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b6b63">${escapeHtml(args.businessName)}</p>
          <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0e1111">Your customer portal sign-in code</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#3a3a35">Hi ${escapeHtml(args.customerName)}, enter this code on the sign-in page to view your invoices and statement.</p>
          <div style="margin:24px 0;text-align:center">
            <div style="display:inline-block;padding:16px 24px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:28px;letter-spacing:.35em;background:#eef5ef;color:#123d2a;border-radius:10px">${args.code}</div>
          </div>
          <p style="margin:0 0 8px;font-size:14px;color:#6b6b63">Expires in ${args.expiryMinutes} minutes.</p>
          <p style="margin:0;font-size:13px;color:#8a8a80">If you didn't request this, ignore the email — your account stays safe.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  const text = `${args.businessName} — customer portal sign-in code

Hi ${args.customerName},

Your sign-in code is: ${args.code}
(Expires in ${args.expiryMinutes} minutes.)

Enter it on the sign-in page to view your invoices and statement.

If you didn't request this, ignore the email.`;
  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Per-IP rate-limit budgets for the portal auth endpoints (#47).
// The existing per-email budget (see tryConsumeOtpRateBudget below)
// protects a single customer from OTP spam; this one protects the
// PLATFORM from mass-enumeration by a single attacker IP cycling
// through different emails. Both layers run together.
//   /request-otp — 5 per 10 minutes per IP
//   /verify      — 10 per minute per IP (allows fat-fingered codes
//                  without locking out a legitimate customer)
// See apps/api/src/plugins/rate-limit.ts for the global fallback.
const PORTAL_REQUEST_OTP_RATE_LIMIT = { max: 5, timeWindow: "10 minutes" };
const PORTAL_VERIFY_RATE_LIMIT = { max: 10, timeWindow: "1 minute" };

export const portalAuthRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /portal/auth/request-otp
  //
  // Always returns 200 (plus a soft "sent" flag) regardless of whether
  // the email matched any customer. Returning 404 here would let an
  // attacker enumerate which emails are customers on the platform.
  fastify.post(
    "/request-otp",
    { config: { rateLimit: PORTAL_REQUEST_OTP_RATE_LIMIT } },
    async (req, reply) => {
    const parsed = RequestOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const { email } = parsed.data;

    // Rate-limit before any lookup so attackers can't batch-probe.
    const budget = await tryConsumeOtpRateBudget(email);
    if (!budget.ok) {
      return reply.status(429).send({
        error: {
          code: "RATE_LIMITED",
          message: "Too many sign-in code requests. Please wait and try again.",
        },
        retryAfterSeconds: budget.retryAfterSeconds,
      });
    }

    const rows = (await db.execute(
      sql`SELECT * FROM portal_find_customers_by_email(${email})`,
    )) as unknown as PortalCustomerRow[];

    if (rows.length === 0) {
      // Silent "sent" to prevent enumeration.
      return reply.send({ ok: true, sent: true, tenants: [] });
    }

    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

    // Mint one code per matching (tenant, customer). Same plaintext code
    // for each so the customer only has one code to remember — but
    // scoped per customer so consumption is per-relationship and the
    // verify handler can pick the right tenant.
    const code = generateNumericCode();
    const codeHash = hashCode(code);

    const mintedForTenants: { slug: string; businessName: string }[] = [];

    for (const row of rows) {
      await db.execute(
        sql`SELECT portal_mint_otp(
          ${row.tenant_id}::uuid,
          ${row.customer_id}::uuid,
          ${email},
          ${codeHash},
          ${expiresAt.toISOString()}::timestamptz,
          ${req.ip ?? null},
          ${req.headers["user-agent"] ?? null}
        )`,
      );
      mintedForTenants.push({ slug: row.tenant_slug, businessName: row.business_name });
    }

    // Send one email per matching relationship so the customer sees
    // which business is asking. Simpler than trying to list all
    // tenants in one email and still lets OTP pickup just work in the
    // single-tenant case.
    await Promise.all(
      rows.map(async (row) => {
        const { subject, html, text } = renderOtpEmail({
          businessName: row.business_name,
          customerName: row.customer_name,
          code,
          expiryMinutes: Math.round(OTP_EXPIRY_MS / 60_000),
        });
        try {
          await sendEmail({
            to: row.customer_email,
            subject,
            html,
            text,
          });
        } catch (err) {
          // Swallow per-send failures — we already minted the OTP, the
          // customer can ask for another code. Log so ops can tell.
          fastify.log.error(
            { err, email: row.customer_email, tenantId: row.tenant_id },
            "portal otp email send failed",
          );
        }
      }),
    );

    // Return minimal metadata the web layer can use — which businesses
    // the code is valid for so the verify page can disambiguate if
    // there's more than one match.
    return reply.send({
      ok: true,
      sent: true,
      tenants: mintedForTenants,
    });
  });

  // POST /portal/auth/verify
  fastify.post(
    "/verify",
    { config: { rateLimit: PORTAL_VERIFY_RATE_LIMIT } },
    async (req, reply) => {
    const parsed = VerifySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const { email, code, tenantSlug } = parsed.data;

    // Rate-limit brute-force attempts. Counted per email regardless of
    // success, so a legitimate user's typos eat into the same budget —
    // 10/hour is plenty of headroom while making 1M-combo brute force
    // infeasible inside the 10-minute OTP expiry.
    const budget = await tryConsumeVerifyRateBudget(email);
    if (!budget.ok) {
      return reply.status(429).send({
        error: {
          code: "RATE_LIMITED",
          message:
            "Too many sign-in attempts. Please wait and request a fresh code.",
        },
        retryAfterSeconds: budget.retryAfterSeconds,
      });
    }

    const codeHash = hashCode(code);

    const otps = (await db.execute(
      sql`SELECT * FROM portal_find_otp(${email}, ${codeHash})`,
    )) as unknown as PortalOtpRow[];

    if (otps.length === 0) {
      // We don't know the tenant on a bad-code verify (no OTP matched),
      // so we can't audit-scope this to a specific tenant. That's fine
      // — suspicious attempts show up in fastify logs + Redis rate-limit
      // TTL, and the successful-login audit event downstream is what
      // tenants actually want ("who logged in as which customer and when").
      fastify.log.warn(
        { email, ip: req.ip, userAgent: req.headers["user-agent"] },
        "portal verify failed: no matching otp",
      );
      return reply.status(401).send({
        error: {
          code: "INVALID_CODE",
          message: "That code is wrong or has expired. Request a fresh one.",
        },
      });
    }

    // If multiple customer relationships share the email+code, the
    // caller can disambiguate by tenant slug; otherwise we require
    // exactly one match and refuse ambiguity.
    let chosenOtp: PortalOtpRow | undefined;
    if (otps.length === 1) {
      chosenOtp = otps[0];
    } else if (tenantSlug) {
      // Resolve each candidate's tenant slug to pick the right OTP.
      const withSlug = await Promise.all(
        otps.map(async (otp) => {
          const res = (await db.execute(
            sql`SELECT * FROM portal_resolve_session(${otp.tenant_id}::uuid, ${otp.customer_id}::uuid)`,
          )) as unknown as PortalSessionResolveRow[];
          return { otp, slug: res[0]?.tenant_slug ?? null };
        }),
      );
      chosenOtp = withSlug.find((w) => w.slug === tenantSlug)?.otp;
    }

    if (!chosenOtp) {
      const candidates = (
        await Promise.all(
          otps.map(async (otp) => {
            const res = (await db.execute(
              sql`SELECT * FROM portal_resolve_session(${otp.tenant_id}::uuid, ${otp.customer_id}::uuid)`,
            )) as unknown as PortalSessionResolveRow[];
            const r = res[0];
            return r
              ? { tenantSlug: r.tenant_slug, businessName: r.business_name }
              : null;
          }),
        )
      ).filter((c): c is { tenantSlug: string; businessName: string } => c !== null);

      return reply.status(409).send({
        error: {
          code: "AMBIGUOUS_TENANT",
          message:
            "This email is linked to more than one business. Choose the one you want to sign in to.",
          // Nested under `issues` so the generic ApiError in apps/web
          // picks it up via err.issues — the request helper only
          // forwards `error.issues`, not arbitrary top-level fields.
          issues: { candidates },
        },
      });
    }

    await db.execute(sql`SELECT portal_consume_otp(${chosenOtp.id}::uuid)`);

    const session = await createPortalSession({
      tenantId: chosenOtp.tenant_id,
      customerId: chosenOtp.customer_id,
      email: chosenOtp.email,
      ttlSeconds: SESSION_TTL,
    });
    setPortalSessionCookie(reply, session.id, SESSION_TTL);
    setPortalCsrfCookie(reply, session.csrfToken, SESSION_TTL);

    // Audit the successful login. Tenant-scoped because we now know which
    // (tenant, customer) the session resolves to. actor_user_id stays null
    // because the actor is a portal customer, not a platform user —
    // customerId goes into refId / diff instead.
    await withTenant(chosenOtp.tenant_id, async (tx) => {
      await recordAuditEvent(tx, {
        kind: "portal.login",
        summary: `Customer portal login (${chosenOtp.email})`,
        refType: "customer",
        refId: chosenOtp.customer_id,
        diff: { email: chosenOtp.email, sessionId: session.id },
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });
    });

    const resolved = (await db.execute(
      sql`SELECT * FROM portal_resolve_session(${chosenOtp.tenant_id}::uuid, ${chosenOtp.customer_id}::uuid)`,
    )) as unknown as PortalSessionResolveRow[];
    const r = resolved[0];

    return reply.send({
      ok: true,
      tenant: r
        ? { id: r.tenant_id, slug: r.tenant_slug, businessName: r.business_name }
        : null,
      customer: r
        ? {
            id: r.customer_id,
            name: r.customer_name,
            email: r.customer_email,
            phone: r.customer_phone,
          }
        : null,
    });
  });

  // POST /portal/auth/logout
  fastify.post("/logout", async (req, reply) => {
    const unsigned = req.unsignCookie(req.cookies[PORTAL_SESSION_COOKIE] ?? "");
    if (unsigned.valid && unsigned.value) {
      const existing = await readPortalSession(unsigned.value);
      if (existing) {
        await destroyPortalSession(unsigned.value);
        // Tenant-scoped audit. Logout is low-risk but rounds out the
        // login/logout pair so admins can see the full session window
        // in the audit-log viewer.
        await withTenant(existing.tenantId, async (tx) => {
          await recordAuditEvent(tx, {
            kind: "portal.logout",
            summary: `Customer portal logout (${existing.email})`,
            refType: "customer",
            refId: existing.customerId,
            diff: { email: existing.email, sessionId: existing.id },
            ipAddress: req.ip ?? null,
            userAgent: req.headers["user-agent"] ?? null,
          });
        });
      }
    }
    clearPortalSessionCookie(reply);
    clearPortalCsrfCookie(reply);
    return reply.send({ ok: true });
  });

  // GET /portal/auth/me
  fastify.get("/me", async (req, reply) => {
    const session = req.portalSession;
    if (!session) {
      return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });
    }
    const rows = (await db.execute(
      sql`SELECT * FROM portal_resolve_session(${session.tenantId}::uuid, ${session.customerId}::uuid)`,
    )) as unknown as PortalSessionResolveRow[];
    const r = rows[0];
    if (!r || !r.customer_active) {
      // Underlying customer was archived / tenant suspended — blow the session away.
      await destroyPortalSession(session.id);
      clearPortalSessionCookie(reply);
      clearPortalCsrfCookie(reply);
      return reply.status(401).send({ error: { code: "UNAUTHENTICATED" } });
    }
    return reply.send({
      tenant: {
        id: r.tenant_id,
        slug: r.tenant_slug,
        businessName: r.business_name,
        timezone: r.tenant_timezone,
      },
      customer: {
        id: r.customer_id,
        name: r.customer_name,
        email: r.customer_email,
        phone: r.customer_phone,
      },
    });
  });
};
