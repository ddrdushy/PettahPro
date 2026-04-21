import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
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
 */
export async function emitNotification(
  tx: PostgresJsDatabase<typeof schema>,
  input: EmitNotificationInput,
): Promise<void> {
  try {
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
