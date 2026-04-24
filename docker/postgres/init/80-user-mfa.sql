-- Roadmap #51 / gap A1 — Multi-factor authentication (TOTP).
--
-- One row per (tenant_id, user_id) that's enrolled in TOTP. `enabled` is
-- the source of truth: a row with enabled=false means "enrolment started
-- but never confirmed" — cleaned up when the user either verifies (flips
-- to true) or restarts enrolment (upsert replaces the secret). No row at
-- all = MFA is off for this user.
--
-- Why this shape
-- --------------
-- - `totp_secret_encrypted` is aes-256-gcm ciphertext; the app tier owns
--   the key (env MFA_ENCRYPTION_KEY). Never stored as plaintext at rest.
--   The ciphertext + iv + authTag are concatenated into a single base64
--   blob by the app so the DB layer doesn't need separate columns.
-- - `backup_codes_hash text[]` — bcrypt/argon2 hashes of 10 single-use
--   codes generated at enrolment time. We *remove* the hash from the
--   array when a code is consumed, rather than maintaining a parallel
--   "used_at" list. Simple, auditable, makes "how many codes are left?"
--   a trivial cardinality query.
-- - RLS on tenant_id (standard). Cross-tenant reads (e.g. login step 2
--   before we've established session / tenant context) go through the
--   SECURITY DEFINER helpers below, same pattern as 44-auth-helpers.sql.
-- - No separate "method" column like the data-model spec's
--   user_mfa_config — we're shipping TOTP only for this PR. When SMS /
--   email OTP / WhatsApp land, the obvious extension is an ENUM-typed
--   `method` column with TOTP being the backfilled default. That's a
--   later migration, not this one.
--
-- Disable policy
-- --------------
-- Disable (DELETE) requires a valid TOTP code at the API layer, not
-- just a session. This is deliberate: a session cookie alone should
-- never be enough to silently remove the second factor — that would
-- hand an attacker who steals a laptop a trivial "disarm MFA then
-- change password" pivot. The constraint lives in the handler, not the
-- schema.

CREATE TABLE IF NOT EXISTS user_mfa (
    user_id                    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    tenant_id                  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    -- aes-256-gcm ciphertext of the base32 TOTP secret. Base64-encoded
    -- by the app; nullable only for defensive schema shape but in
    -- practice never NULL (enrolment always writes a secret).
    totp_secret_encrypted      text NOT NULL,
    -- argon2 hashes of single-use backup codes. Consumption removes the
    -- hash from the array; array_length() tells us how many remain.
    backup_codes_hash          text[] NOT NULL DEFAULT ARRAY[]::text[],
    enabled                    boolean NOT NULL DEFAULT false,
    enrolled_at                timestamptz,
    last_used_at               timestamptz,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_mfa_tenant
    ON user_mfa (tenant_id)
    WHERE enabled = true;

ALTER TABLE user_mfa ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_mfa FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON user_mfa;
CREATE POLICY tenant_isolation ON user_mfa
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ------------------------------------------------------------------------------
-- auth_get_mfa_for_user(user_id) — pre-session lookup used during
-- login step 2. At this point we have the user_id from the challenge
-- record in Redis but no tenant context on the PG connection, so we
-- can't go through RLS. SECURITY DEFINER bypasses RLS as the table
-- owner; the return shape is only what the login-step-2 handler
-- needs (encrypted secret + hashes + enabled flag).
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_get_mfa_for_user(p_user_id uuid)
RETURNS TABLE (
    user_id                 uuid,
    tenant_id               uuid,
    totp_secret_encrypted   text,
    backup_codes_hash       text[],
    enabled                 boolean
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT m.user_id, m.tenant_id, m.totp_secret_encrypted, m.backup_codes_hash, m.enabled
      FROM user_mfa m
     WHERE m.user_id = p_user_id
       AND m.enabled = true
     LIMIT 1;
$$;

-- ------------------------------------------------------------------------------
-- auth_record_mfa_success(user_id, new_backup_codes) — stamp
-- last_used_at and (optionally) replace the backup-codes array after a
-- successful verification. Called from login-step-2 and from code
-- consumption paths. Split from the RLS-scoped UPDATE because this
-- runs pre-session (no app.tenant_id set yet).
--
-- If p_new_backup_codes IS NULL the array is left alone (TOTP success);
-- pass the shortened array when a backup code was consumed.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_record_mfa_success(
    p_user_id uuid,
    p_new_backup_codes text[]
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
    UPDATE user_mfa
       SET last_used_at = now(),
           backup_codes_hash = COALESCE(p_new_backup_codes, backup_codes_hash),
           updated_at = now()
     WHERE user_id = p_user_id;
$$;

-- ------------------------------------------------------------------------------
-- auth_user_has_mfa(user_id) — cheap existence check used during
-- login step 1 to decide whether to branch into the challenge flow or
-- mint a session directly. Same pre-session + cross-tenant situation.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_user_has_mfa(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM user_mfa WHERE user_id = p_user_id AND enabled = true
    );
$$;

-- Narrow grants. PUBLIC can't see anything; only the app role executes.
REVOKE ALL ON FUNCTION auth_get_mfa_for_user(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_record_mfa_success(uuid, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_user_has_mfa(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_get_mfa_for_user(uuid) TO pettahpro_app;
GRANT EXECUTE ON FUNCTION auth_record_mfa_success(uuid, text[]) TO pettahpro_app;
GRANT EXECUTE ON FUNCTION auth_user_has_mfa(uuid) TO pettahpro_app;

-- Table grants — standard CRUD for the app role. The SECURITY DEFINER
-- helpers above are what get used for the pre-session paths; the
-- in-session paths (enrolment, disable, status) use these grants with
-- app.tenant_id set so RLS does its job.
GRANT SELECT, INSERT, UPDATE, DELETE ON user_mfa TO pettahpro_app;
