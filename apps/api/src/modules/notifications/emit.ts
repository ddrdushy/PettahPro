import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { and, eq, sql } from "drizzle-orm";
import { schema } from "@pettahpro/db";
import { sendEmail } from "../../lib/email.js";
import { renderImmediateEmail } from "./email-template.js";

export interface EmitNotificationInput {
  tenantId: string;
  // null user_id = broadcast to every user in the tenant (fan-out at read time).
  userId?: string | null;
  kind: string;
  title: string;
  body?: string | null;
  refType?: string | null;
  refId?: string | null;
}

/**
 * Single entry point for creating in-app notifications. Kept separate from
 * the core posting primitives so an emit failure never rolls back a journal
 * entry — we log + swallow. Callers pass their own tx so the notification
 * lands in the same commit as the triggering event when that's desirable.
 *
 * Per-user opt-out (roadmap #25): before inserting a directed notification
 * (userId set) we check notification_preferences for the caller's cadence.
 * Semantics:
 *   • No row OR cadence='immediate'  → in-app bell (current behaviour)
 *   • enabled=false OR cadence='off' → silently drop
 *   • cadence='daily' or 'weekly'    → insert into notification_digest_queue
 *     so the digest cron can coalesce into one email (roadmap #45)
 *
 * Immediate email delivery (roadmap #53 / gap D1): when cadence='immediate'
 * and email_enabled=true, we also fire a single-event email. The bell row
 * is still written — emailing doesn't replace the in-app notification,
 * just augments it. The email fire is after the bell insert + inside the
 * same try/catch so a misconfigured SMTP host can't block the bell or the
 * triggering business op. We log to notification_digest_emails with
 * cadence='immediate', event_count=1 so there's a single grep target for
 * "did this email actually go out?" regardless of cadence.
 *
 * Broadcasts (userId null) bypass the check — tenant-wide announcements
 * aren't user-level opt-out material and shouldn't be deferred into a
 * digest either (by the time the email lands, "period closed" has lost
 * urgency).
 */
export async function emitNotification(
  tx: PostgresJsDatabase<typeof schema>,
  input: EmitNotificationInput,
): Promise<void> {
  try {
    let emailEnabled = false;
    if (input.userId) {
      const [pref] = await tx
        .select({
          enabled: schema.notificationPreferences.enabled,
          cadence: schema.notificationPreferences.cadence,
          emailEnabled: schema.notificationPreferences.emailEnabled,
        })
        .from(schema.notificationPreferences)
        .where(
          and(
            eq(schema.notificationPreferences.tenantId, input.tenantId),
            eq(schema.notificationPreferences.userId, input.userId),
            eq(schema.notificationPreferences.kind, input.kind),
          ),
        )
        .limit(1);

      if (pref && (!pref.enabled || pref.cadence === "off")) {
        // Hard opt-out — drop silently.
        return;
      }

      const cadence = pref?.cadence ?? "immediate";
      if (cadence === "daily" || cadence === "weekly") {
        // Divert to the digest queue. The digest cron coalesces these
        // into one rollup email per user per window, so no in-app bell
        // row is written. Users who want both bell + digest can keep
        // cadence='immediate' and add an inbox filter on their side —
        // digest mode is explicitly "instead of" not "in addition to"
        // to keep the mental model simple.
        await tx.insert(schema.notificationDigestQueue).values({
          tenantId: input.tenantId,
          userId: input.userId,
          kind: input.kind,
          cadence,
          title: input.title,
          body: input.body ?? null,
          refType: input.refType ?? null,
          refId: input.refId ?? null,
        });
        return;
      }
      // cadence === 'immediate' from here on.
      emailEnabled = pref?.emailEnabled ?? false;
    }
    await tx.insert(schema.notifications).values({
      tenantId: input.tenantId,
      userId: input.userId ?? null,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
    });

    if (input.userId && emailEnabled) {
      // Fire-and-log an immediate email. Isolated in its own try so a
      // transport hiccup can't skip the bell insert that just ran.
      await deliverImmediateEmail(tx, {
        tenantId: input.tenantId,
        userId: input.userId,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
      });
    }
  } catch (err) {
    // Don't fail the business operation over a notification write. Log for
    // visibility; we can reconcile via polling or audit log if it matters.
    console.warn("[notifications] emit failed:", (err as Error).message, input);
  }
}

async function deliverImmediateEmail(
  tx: PostgresJsDatabase<typeof schema>,
  input: {
    tenantId: string;
    userId: string;
    kind: string;
    title: string;
    body: string | null;
  },
): Promise<void> {
  try {
    // Fetch recipient + tenant brand in one round-trip. Uses raw SQL
    // rather than drizzle's relations builder so we don't have to wire
    // a relation definition for a single call site.
    const rows = (await tx.execute(sql`
      SELECT u.email, u.full_name, t.business_name
      FROM users u
      JOIN tenants t ON t.id = u.tenant_id
      WHERE u.id = ${input.userId}::uuid
        AND u.tenant_id = ${input.tenantId}::uuid
        AND u.is_active = true
        AND u.deleted_at IS NULL
      LIMIT 1
    `)) as unknown as Array<{
      email: string;
      full_name: string;
      business_name: string;
    }>;
    const recipient = rows[0];
    if (!recipient) return;

    const now = new Date().toISOString();
    const { subject, html, text } = renderImmediateEmail({
      kind: input.kind,
      title: input.title,
      body: input.body,
      businessName: recipient.business_name,
      recipientName: recipient.full_name,
    });

    try {
      const result = await sendEmail({ to: recipient.email, subject, html, text });
      // Log to the same table as digests — one place to grep for send
      // outcomes. window_start == window_end == now for immediate sends.
      await tx.execute(sql`
        INSERT INTO notification_digest_emails
          (tenant_id, user_id, to_email, cadence, window_start, window_end,
           event_count, kind_breakdown, status, message_id, transport)
        VALUES
          (${input.tenantId}::uuid, ${input.userId}::uuid, ${recipient.email},
           'immediate', ${now}::timestamptz, ${now}::timestamptz,
           1, ${JSON.stringify({ [input.kind]: 1 })}::jsonb, 'sent',
           ${result.messageId}, ${result.transport})
      `);
    } catch (err) {
      const message = (err as Error).message;
      await tx.execute(sql`
        INSERT INTO notification_digest_emails
          (tenant_id, user_id, to_email, cadence, window_start, window_end,
           event_count, kind_breakdown, status, error_message, transport)
        VALUES
          (${input.tenantId}::uuid, ${input.userId}::uuid, ${recipient.email},
           'immediate', ${now}::timestamptz, ${now}::timestamptz,
           1, ${JSON.stringify({ [input.kind]: 1 })}::jsonb, 'failed',
           ${message}, 'smtp')
      `);
      console.warn("[notifications] immediate email failed:", message, {
        userId: input.userId,
        kind: input.kind,
      });
    }
  } catch (err) {
    // Recipient lookup itself failed. Already inside the outer emit
    // try/catch so this just makes the log more specific.
    console.warn(
      "[notifications] immediate email lookup failed:",
      (err as Error).message,
      { userId: input.userId, kind: input.kind },
    );
  }
}
