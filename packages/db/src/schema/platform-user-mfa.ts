import { sql } from "drizzle-orm";
import { pgTable, uuid, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { platformUsers } from "./platform-users.js";

/**
 * TOTP-based MFA enrolment for platform admins (#55 / gap L1 v1).
 *
 * Mirrors `user_mfa` but scoped to `platform_users`, which live outside
 * RLS. No `tenant_id`, no RLS policy — the access gate is the
 * /platform/* route guard on `pp_platform_session`.
 *
 * Same shape rules as the tenant-side user_mfa: aes-256-gcm ciphertext
 * for the TOTP secret (app-tier encrypts before write), argon2 hashes
 * for the backup codes (consumption removes the matched hash from the
 * array), enabled flag as source of truth, disable = DELETE the row.
 */
export const platformUserMfa = pgTable(
  "platform_user_mfa",
  {
    platformUserId: uuid("platform_user_id")
      .primaryKey()
      .references(() => platformUsers.id, { onDelete: "cascade" }),
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
    enabledIdx: index("idx_platform_user_mfa_enabled").on(t.platformUserId),
  }),
);

export type PlatformUserMfa = typeof platformUserMfa.$inferSelect;
export type NewPlatformUserMfa = typeof platformUserMfa.$inferInsert;
