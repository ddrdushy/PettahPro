/**
 * Reset a platform user's password from the CLI. Companion to
 * create-platform-admin: that script bootstraps the FIRST admin and
 * refuses to re-run on an existing email; this script handles the
 * "I forgot my password" / "ops needs to rotate" flow.
 *
 * Usage (inside the api container or with DATABASE_URL set):
 *   pnpm --filter @pettahpro/api reset-platform-password \
 *       --email you@pettahpro.lk
 *
 * Prompts for the new password on stdin. Refuses if the user is
 * deleted or inactive — re-activate via /platform/staff first or
 * the CLI exits cleanly with a hint.
 *
 * Side effect: also clears MFA enrolment if present (a forgotten
 * password is also typically a forgotten authenticator app, and
 * leaving stale TOTP would lock the user out at login step 2).
 * Pass --keep-mfa to skip the MFA wipe.
 *
 * Intentionally NOT exposed as an HTTP route — same rationale as
 * the bootstrap script: ops actions that touch credentials live
 * outside the web app.
 */

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { db, schema } from "@pettahpro/db";
import { and, eq, isNull } from "drizzle-orm";
import { hashPassword } from "../modules/identity/password.js";

function parseArgs(argv: string[]): {
  email?: string;
  keepMfa?: boolean;
} {
  const out: { email?: string; keepMfa?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--email") out.email = argv[++i];
    else if (a === "--keep-mfa") out.keepMfa = true;
  }
  return out;
}

async function promptPassword(
  rl: Awaited<ReturnType<typeof createInterface>>,
): Promise<string> {
  const raw = await rl.question("New password (min 12 chars): ");
  return raw.trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rl = createInterface({ input, output });

  const email = (args.email ?? (await rl.question("Email: ")))
    .trim()
    .toLowerCase();
  if (!email.includes("@")) {
    console.error("error: email looks invalid");
    process.exit(2);
  }

  const existing = await db
    .select({
      id: schema.platformUsers.id,
      isActive: schema.platformUsers.isActive,
    })
    .from(schema.platformUsers)
    .where(
      and(
        eq(schema.platformUsers.email, email),
        isNull(schema.platformUsers.deletedAt),
      ),
    )
    .limit(1);
  const user = existing[0];
  if (!user) {
    console.error(`error: no live platform user found for ${email}`);
    console.error(
      "hint: run create-platform-admin to bootstrap the first user, or check /platform/staff for a typo",
    );
    process.exit(1);
  }
  if (!user.isActive) {
    console.error(
      `error: user ${email} is deactivated; reactivate them in /platform/staff first`,
    );
    process.exit(1);
  }

  const password = await promptPassword(rl);
  if (password.length < 12) {
    console.error("error: password must be at least 12 characters");
    process.exit(2);
  }
  rl.close();

  const passwordHash = await hashPassword(password);
  await db
    .update(schema.platformUsers)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(schema.platformUsers.id, user.id));

  if (!args.keepMfa) {
    // Wipe MFA so the user isn't locked out at the second factor with
    // a stale authenticator they no longer have. They re-enrol from
    // /platform/account after signing in.
    await db
      .delete(schema.platformUserMfa)
      .where(eq(schema.platformUserMfa.platformUserId, user.id));
  }

  console.log(`reset password for ${email}`);
  console.log(args.keepMfa ? "MFA preserved" : "MFA cleared (re-enrol after login)");
  console.log("sign in at /platform/login");
  process.exit(0);
}

main().catch((err) => {
  console.error("failed:", err);
  process.exit(1);
});
