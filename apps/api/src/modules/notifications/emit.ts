import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import { schema } from "@pettahpro/db";

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
    if (input.userId) {
      const [pref] = await tx
        .select({
          enabled: schema.notificationPreferences.enabled,
          cadence: schema.notificationPreferences.cadence,
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
  } catch (err) {
    // Don't fail the business operation over a notification write. Log for
    // visibility; we can reconcile via polling or audit log if it matters.
    console.warn("[notifications] emit failed:", (err as Error).message, input);
  }
}
