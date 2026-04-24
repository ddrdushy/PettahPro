-- Roadmap #55 / gap L1 v1 — MFA for platform users.
--
-- Mirrors 80-user-mfa.sql (#51) but scoped to platform_users, which
-- live OUTSIDE RLS. That makes this table simpler: no tenant_id, no
-- RLS policy — the access gate is the /platform/* route guard that
-- authenticates via pp_platform_session, full stop.
--
-- Why a dedicated table (not reuse user_mfa)
-- ------------------------------------------
-- user_mfa FKs to users(id) + is tenant-scoped + under RLS. platform
-- users are a different principal type with a distinct FK target and
-- no tenant. Squashing them into the same table would either:
--   (a) require nullable tenant_id + nullable FK + a weakened RLS
--       policy (dangerous — the whole point of RLS on user_mfa is
--       that it's cross-tenant-unsafe to query without tenant
--       context), or
--   (b) add a `principal_type` enum column + nullable dual FKs that
--       are mutually exclusive — ugly constraint soup.
-- Both options hand complexity back in return for one fewer table.
-- Keeping them separate is the cleaner realm-split (same logic as
-- splitting platform_users from users in the first place).
--
-- Encryption / backup-code shape
-- ------------------------------
-- Same as user_mfa:
--   - totp_secret_encrypted: aes-256-gcm blob, app-layer key
--   - backup_codes_hash: text[] of argon2 hashes, consumption removes
-- The app-tier mfa.ts helpers are principal-agnostic — they encrypt,
-- decrypt, verify TOTP, and hash/consume backup codes without caring
-- which table the bytes come from. Platform MFA reuses them verbatim.
--
-- Disable policy
-- --------------
-- Disable requires a valid TOTP (or backup) code — same invariant as
-- user_mfa. A stolen platform session cookie must not be enough to
-- silently disarm the second factor.

CREATE TABLE IF NOT EXISTS platform_user_mfa (
    platform_user_id           uuid PRIMARY KEY REFERENCES platform_users(id) ON DELETE CASCADE,
    totp_secret_encrypted      text NOT NULL,
    backup_codes_hash          text[] NOT NULL DEFAULT ARRAY[]::text[],
    enabled                    boolean NOT NULL DEFAULT false,
    enrolled_at                timestamptz,
    last_used_at               timestamptz,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now()
);

-- Partial index on enabled=true so the "how many platform users have
-- MFA on?" query is cheap. Also useful for a future "require MFA" gate.
CREATE INDEX IF NOT EXISTS idx_platform_user_mfa_enabled
    ON platform_user_mfa (platform_user_id)
    WHERE enabled = true;

-- No RLS: platform_users has no tenant_id, and the route guard on
-- /platform/auth/mfa/* already scopes access to the authenticated
-- platform session. Grants mirror platform_users.
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_user_mfa TO pettahpro_app;

-- ---------------------------------------------------------------------
-- Pre-session helpers.
--
-- Step-2 of login (/platform/auth/login/mfa) runs BEFORE the platform
-- session cookie is minted — the client only has a challengeId from
-- step-1. The route needs to read the encrypted secret + backup hashes
-- for the user_id stashed in the challenge record. It doesn't need
-- RLS (platform_user_mfa has none), but it DOES need to not leak via
-- BYPASSRLS — keeping everything behind narrow SECURITY DEFINER
-- helpers keeps the app role's surface area small and consistent with
-- the tenant-side pattern (44-auth-helpers.sql, 80-user-mfa.sql).
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION platform_get_mfa_for_user(p_platform_user_id uuid)
RETURNS TABLE (
    platform_user_id        uuid,
    totp_secret_encrypted   text,
    backup_codes_hash       text[],
    enabled                 boolean
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT m.platform_user_id, m.totp_secret_encrypted, m.backup_codes_hash, m.enabled
      FROM platform_user_mfa m
     WHERE m.platform_user_id = p_platform_user_id
       AND m.enabled = true
     LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION platform_user_has_mfa(p_platform_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM platform_user_mfa
         WHERE platform_user_id = p_platform_user_id
           AND enabled = true
    );
$$;

-- Stamp last_used_at and optionally replace the backup-codes array
-- after a successful verify. Pass NULL for p_new_backup_codes to
-- leave the array alone (TOTP success); pass the shortened array
-- when a backup code was consumed.
CREATE OR REPLACE FUNCTION platform_record_mfa_success(
    p_platform_user_id uuid,
    p_new_backup_codes text[]
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
    UPDATE platform_user_mfa
       SET last_used_at = now(),
           backup_codes_hash = COALESCE(p_new_backup_codes, backup_codes_hash),
           updated_at = now()
     WHERE platform_user_id = p_platform_user_id;
$$;

REVOKE ALL ON FUNCTION platform_get_mfa_for_user(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_user_has_mfa(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_record_mfa_success(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_get_mfa_for_user(uuid) TO pettahpro_app;
GRANT EXECUTE ON FUNCTION platform_user_has_mfa(uuid) TO pettahpro_app;
GRANT EXECUTE ON FUNCTION platform_record_mfa_success(uuid, text[]) TO pettahpro_app;
