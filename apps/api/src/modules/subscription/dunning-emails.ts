import { sql } from "drizzle-orm";
import type { Database } from "@pettahpro/db";
import { sendEmail, type SendEmailResult } from "../../lib/email.js";

/**
 * Dunning email cadence (pricing-spec §10). Four templates fired by the
 * dunning cron at the right state-machine transition:
 *
 *   1. charge_failed   — after each retry failure where the policy's
 *                        email_after_attempts list includes the current
 *                        attempt_number (default [1, 3, 5]).
 *   2. final_warning   — when the next retry would be the last per the
 *                        policy. "If this fails, your service stops."
 *   3. suspended       — when the subscription transitions to cancelled
 *                        because all retries were exhausted.
 *   4. recovered       — when a charge succeeds while the subscription
 *                        is in past_due. "We got it, you're back."
 *
 * Recipients are owner + admin users of the tenant (users.is_owner OR
 * users.role = 'admin'). Multiple recipients are bcc'd on the same
 * email so they all see the message — no per-recipient delivery loop.
 *
 * Each send writes a platform_audit_log entry capturing the email kind,
 * recipient list, and the messageId returned from sendEmail. That gives
 * us the equivalent of an outbound-email log for dunning without
 * creating a new tracking table — the audit log is already the
 * canonical "what happened, when, who" record.
 *
 * SMTP_HOST not configured? sendEmail's console transport logs the
 * message to stdout. The dunning cron still records it in the audit
 * log, just with a console-prefixed messageId. Fine for dev.
 */

interface Log {
  info: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
}

export type DunningEmailKind =
  | "charge_failed"
  | "final_warning"
  | "suspended"
  | "recovered";

export interface DunningEmailContext {
  tenantId: string;
  tenantName: string;
  planName: string;
  amountCents: number;
  currency: string;
  attemptNumber: number;
  suspendAfterAttempts: number;
  // For charge_failed / final_warning: when the next retry will run.
  // null for suspended / recovered.
  nextRetryAt: Date | null;
  // For suspended: when the suspension took effect.
  suspendedAt?: Date;
  // For charge_failed: the failure reason from the gateway, surfaced
  // to the recipient ("card declined", "insufficient funds").
  failureReason?: string;
  // The /app/settings/plan URL the email points the user back to. Set
  // by the caller from the configured base URL — null falls back to a
  // generic instruction.
  updatePaymentUrl?: string;
}

interface RecipientRow {
  user_id: string;
  email: string;
  full_name: string | null;
}

/**
 * Look up owner + admin recipients for a tenant. Falls back to "any
 * active user" if no owner/admin is on file (rare but happens for
 * single-user tenants where the owner role wasn't set during signup).
 *
 * Bypasses RLS — the dunning cron is a system process and the users
 * table here is read with an explicit tenant_id filter.
 */
async function findRecipients(
  db: Database,
  tenantId: string,
): Promise<RecipientRow[]> {
  const ownerRows = (await db.execute(sql`
    SELECT id AS user_id, email, full_name
      FROM users
     WHERE tenant_id = ${tenantId}
       AND is_active = true
       AND deleted_at IS NULL
       AND (is_owner = true OR role = 'admin')
     ORDER BY is_owner DESC, created_at ASC
  `)) as unknown as RecipientRow[];

  if (ownerRows.length > 0) return ownerRows;

  // Fallback: any active user. We'd rather email the wrong person than
  // silently swallow a payment-failure notice.
  const anyActive = (await db.execute(sql`
    SELECT id AS user_id, email, full_name
      FROM users
     WHERE tenant_id = ${tenantId}
       AND is_active = true
       AND deleted_at IS NULL
     ORDER BY created_at ASC
     LIMIT 3
  `)) as unknown as RecipientRow[];

  return anyActive;
}

/**
 * Send a dunning email of the given kind. Resolves recipients,
 * renders the template, calls sendEmail, returns the result. Caller
 * is responsible for writing the audit log entry — keeps this file
 * focused on rendering + delivery, with the cron wiring the logging
 * alongside its other state-transition audit writes.
 */
export async function sendDunningEmail(
  db: Database,
  log: Log,
  kind: DunningEmailKind,
  ctx: DunningEmailContext,
): Promise<{
  sent: boolean;
  messageId: string | null;
  recipients: string[];
  reason?: string;
}> {
  const recipients = await findRecipients(db, ctx.tenantId);
  if (recipients.length === 0) {
    log.error(
      { tenantId: ctx.tenantId, kind },
      "dunning-email: no recipients found",
    );
    return { sent: false, messageId: null, recipients: [], reason: "no-recipients" };
  }

  const rendered = renderDunningEmail(kind, ctx, recipients[0]!.full_name);
  const toList = recipients.map((r) => r.email);

  try {
    const result: SendEmailResult = await sendEmail({
      to: toList,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    log.info(
      {
        kind,
        tenantId: ctx.tenantId,
        recipients: toList.length,
        transport: result.transport,
        messageId: result.messageId,
      },
      "dunning-email sent",
    );
    return {
      sent: true,
      messageId: result.messageId,
      recipients: toList,
    };
  } catch (err) {
    log.error(
      { err, kind, tenantId: ctx.tenantId },
      "dunning-email send failed",
    );
    return {
      sent: false,
      messageId: null,
      recipients: toList,
      reason: err instanceof Error ? err.message : "unknown",
    };
  }
}

/**
 * Render the email body for a given kind. Pure function — given the
 * same context, produces the same output. No side effects, no I/O.
 * Lets us unit-test the templates without standing up a transport.
 */
export function renderDunningEmail(
  kind: DunningEmailKind,
  ctx: DunningEmailContext,
  recipientName: string | null,
): { subject: string; html: string; text: string } {
  const greeting = recipientName ? `Hi ${escapeHtml(recipientName)},` : "Hi,";
  const amount = formatCurrency(ctx.amountCents, ctx.currency);
  const planLabel = escapeHtml(ctx.planName);
  const tenantLabel = escapeHtml(ctx.tenantName);

  const ctaButton = ctx.updatePaymentUrl
    ? `<a href="${escapeAttr(ctx.updatePaymentUrl)}" style="display:inline-block;background:#3D6B52;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">Update payment method</a>`
    : `<p style="color:#6b7280;font-size:13px;margin:8px 0;">Sign in to PettahPro to update your payment method.</p>`;

  switch (kind) {
    case "charge_failed": {
      const retryDateLabel = ctx.nextRetryAt
        ? formatDate(ctx.nextRetryAt)
        : "soon";
      const failureLine = ctx.failureReason
        ? `<p style="color:#374151;font-size:14px;line-height:1.6;">Reason from your bank: ${escapeHtml(ctx.failureReason)}</p>`
        : "";
      return {
        subject: `Payment failed for ${ctx.tenantName} — we'll retry on ${retryDateLabel}`,
        html: wrapEmailShell(
          "Payment failed",
          `
            <p>${greeting}</p>
            <p>We tried to charge ${amount} for your <strong>${planLabel}</strong> subscription on PettahPro and the payment didn't go through.</p>
            ${failureLine}
            <p>We'll automatically retry on <strong>${retryDateLabel}</strong>. To avoid disruption, please update your payment method before then.</p>
            <p style="margin:24px 0;">${ctaButton}</p>
            <p style="color:#6b7280;font-size:12px;">This is attempt ${ctx.attemptNumber} of ${ctx.suspendAfterAttempts}. After ${ctx.suspendAfterAttempts} failed attempts, we'll suspend service until payment is resolved.</p>
          `,
        ),
        text: [
          `${recipientName ?? ""}`,
          ``,
          `We tried to charge ${formatCurrencyText(ctx.amountCents, ctx.currency)} for your ${ctx.planName} subscription on PettahPro and the payment didn't go through.`,
          ctx.failureReason ? `Reason from your bank: ${ctx.failureReason}` : "",
          ``,
          `We'll automatically retry on ${retryDateLabel}.`,
          ctx.updatePaymentUrl
            ? `Update your payment method: ${ctx.updatePaymentUrl}`
            : `Sign in to PettahPro to update your payment method.`,
          ``,
          `Attempt ${ctx.attemptNumber} of ${ctx.suspendAfterAttempts}.`,
          ``,
          `— PettahPro`,
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }
    case "final_warning": {
      const retryDateLabel = ctx.nextRetryAt
        ? formatDate(ctx.nextRetryAt)
        : "soon";
      return {
        subject: `Last warning — your PettahPro service will be suspended after ${retryDateLabel}`,
        html: wrapEmailShell(
          "Last warning before suspension",
          `
            <p>${greeting}</p>
            <p>This is the final retry on your <strong>${planLabel}</strong> subscription for ${tenantLabel}. We've tried ${ctx.attemptNumber} times and each charge has failed.</p>
            <p>If the next attempt on <strong>${retryDateLabel}</strong> also fails, your service will be suspended automatically. You'll lose access to your books until payment is resolved.</p>
            <p>Please update your payment method right now to avoid disruption.</p>
            <p style="margin:24px 0;">${ctaButton}</p>
            <p style="color:#6b7280;font-size:12px;">If you've already paid out-of-band, contact support and we'll mark your subscription paid manually.</p>
          `,
        ),
        text: [
          `${recipientName ?? ""}`,
          ``,
          `LAST WARNING — Your PettahPro service for ${ctx.tenantName} will be suspended if the next retry on ${retryDateLabel} fails.`,
          ``,
          `We've tried ${ctx.attemptNumber} times and each charge for ${formatCurrencyText(ctx.amountCents, ctx.currency)} has failed.`,
          ``,
          ctx.updatePaymentUrl
            ? `Update your payment method: ${ctx.updatePaymentUrl}`
            : `Sign in to PettahPro to update your payment method.`,
          ``,
          `If you've already paid out-of-band, contact support.`,
          ``,
          `— PettahPro`,
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }
    case "suspended": {
      const suspendedAtLabel = ctx.suspendedAt
        ? formatDate(ctx.suspendedAt)
        : "today";
      return {
        subject: `Your PettahPro subscription for ${ctx.tenantName} has been suspended`,
        html: wrapEmailShell(
          "Subscription suspended",
          `
            <p>${greeting}</p>
            <p>Your <strong>${planLabel}</strong> subscription for ${tenantLabel} was suspended on <strong>${suspendedAtLabel}</strong> after ${ctx.attemptNumber} failed payment attempts.</p>
            <p>Your data is still safe and intact — nothing has been deleted. To restore access:</p>
            <ol style="color:#374151;font-size:14px;line-height:1.8;">
              <li>Update your payment method.</li>
              <li>Contact support to reactivate your subscription.</li>
            </ol>
            <p style="margin:24px 0;">${ctaButton}</p>
            <p style="color:#6b7280;font-size:12px;">If this is a mistake, or you've already paid, please reach out — we can resolve it quickly.</p>
          `,
        ),
        text: [
          `${recipientName ?? ""}`,
          ``,
          `Your ${ctx.planName} subscription for ${ctx.tenantName} was suspended on ${suspendedAtLabel} after ${ctx.attemptNumber} failed payment attempts.`,
          ``,
          `Your data is safe. To restore access:`,
          `  1. Update your payment method`,
          `  2. Contact support to reactivate`,
          ``,
          ctx.updatePaymentUrl
            ? `Update your payment method: ${ctx.updatePaymentUrl}`
            : `Sign in to PettahPro to update your payment method.`,
          ``,
          `— PettahPro`,
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }
    case "recovered": {
      return {
        subject: `Payment received — your PettahPro service is back to normal`,
        html: wrapEmailShell(
          "Payment received",
          `
            <p>${greeting}</p>
            <p>Good news — we successfully charged ${amount} for your <strong>${planLabel}</strong> subscription on PettahPro.</p>
            <p>Your service is back to normal. Thanks for resolving this!</p>
            <p style="color:#6b7280;font-size:12px;margin-top:24px;">If you have any questions about your billing, you can review the details on your settings page.</p>
          `,
        ),
        text: [
          `${recipientName ?? ""}`,
          ``,
          `We successfully charged ${formatCurrencyText(ctx.amountCents, ctx.currency)} for your ${ctx.planName} subscription on PettahPro.`,
          ``,
          `Your service is back to normal. Thanks for resolving this!`,
          ``,
          `— PettahPro`,
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }
  }
}

// ---------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------

function wrapEmailShell(headline: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9fafb;margin:0;padding:24px;color:#1f2937;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:28px;">
      <p style="margin:0 0 4px 0;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">PettahPro · Billing</p>
      <h2 style="margin:0 0 18px 0;font-size:18px;color:#1f2937;">${escapeHtml(headline)}</h2>
      <div style="font-size:14px;line-height:1.6;color:#374151;">${bodyHtml}</div>
      <hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0 12px 0;"/>
      <p style="color:#9ca3af;font-size:11px;line-height:1.5;margin:0;">PettahPro · Cloud accounting and business operations for Sri Lankan SMEs · pettahpro.lk</p>
    </div>
  </body>
</html>`;
}

function formatCurrency(cents: number, currency: string): string {
  const major = (cents / 100).toLocaleString("en-LK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `<strong>${currency} ${major}</strong>`;
}

function formatCurrencyText(cents: number, currency: string): string {
  const major = (cents / 100).toLocaleString("en-LK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${major}`;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-LK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
