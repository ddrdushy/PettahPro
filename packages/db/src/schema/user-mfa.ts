import { sql } from "drizzle-orm";
import { pgTable, uuid, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

/**
 * TOTP-based MFA enrolment (#51 / gap A1). One row per enrolled user.
 *
 * The TOTP secret is aes-256-gcm encrypted by the app tier before it
 * lands here — the DB only stores the base64-encoded ciphertext blob
 * (iv|authTag|ciphertext). Backup codes are argon2 hashes; consuming
 * a code removes its hash from the array (see
 * `auth_record_mfa_success` in docker/postgres/init/80-user-mfa.sql).
 *
 * `enabled` is the source of truth: a row with enabled=false is a
 * half-finished enrolment (secret written, verification not yet
 * confirmed). Restarting enrolment upserts a fresh secret over the
 * pending row; a confirmed verify flips the flag to true. Disabling
 * MFA deletes the row outright — no soft-delete, no audit trail here
 * beyond what the audit_events module already captures.
 */
export const userMfa = pgTable(
  "user_mfa",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    totpSecretEncrypted: text("totp_secret_encrypted").notNull(),
    backupCodesHash: text("backup_codes_hash")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    enabled: boolean("enabled").notNull().default(false),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("idx_user_mfa_tenant").on(t.tenantId),
  }),
);

export type UserMfa = typeof userMfa.$inferSelect;
export type NewUserMfa = typeof userMfa.$inferInsert;
