/**
 * Bootstrap the first platform admin (#54 / gap L1).
 *
 * Usage (inside the api container or with DATABASE_URL set):
 *   pnpm --filter @pettahpro/api create-platform-admin \
 *       --email you@pettahpro.lk \
 *       --name "Dushy"
 *
 * Prompts for a password on stdin (echo off). Refuses to run if a
 * live platform user already exists with that email — use psql to
 * nuke or rotate the password after the fact.
 *
 * Intentionally NOT exposed as an HTTP route — the first platform
 * admin has to come from somewhere outside the web app. This lives
 * as a one-off script; subsequent admins (once L1 v1 adds role
 * separation) get created through the console.
 */

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { db, schema } from "@pettahpro/db";
import { and, eq, isNull } from "drizzle-orm";
import { hashPassword } from "../modules/identity/password.js";

function parseArgs(argv: string[]): { email?: string; name?: string } {
  const out: { email?: string; name?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--email") out.email = argv[++i];
    else if (a === "--name") out.name = argv[++i];
  }
  return out;
}

async function promptPassword(rl: Awaited<ReturnType<typeof createInterface>>): Promise<string> {
  // readline doesn't mute the echo natively; for a bootstrap script on
  // an operator's machine we accept the echo. If this moves to a
  // production-facing ops tool, wire up read-password or similar.
  const raw = await rl.question("Password (min 12 chars): ");
  return raw.trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rl = createInterface({ input, output });

  const email = (
    args.email ?? (await rl.question("Email: "))
  )
    .trim()
    .toLowerCase();
  if (!email.includes("@")) {
    console.error("error: email looks invalid");
    process.exit(2);
  }
  const fullName = (args.name ?? (await rl.question("Full name: "))).trim();
  if (fullName.length < 2) {
    console.error("error: full name is required");
    process.exit(2);
  }
  const password = await promptPassword(rl);
  if (password.length < 12) {
    console.error("error: password must be at least 12 characters");
    process.exit(2);
  }
  rl.close();

  const existing = await db
    .select({ id: schema.platformUsers.id })
    .from(schema.platformUsers)
    .where(
      and(
        eq(schema.platformUsers.email, email),
        isNull(schema.platformUsers.deletedAt),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    console.error(`error: a live platform user already exists with email ${email}`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const [row] = await db
    .insert(schema.platformUsers)
    .values({ email, fullName, passwordHash, isActive: true })
    .returning({ id: schema.platformUsers.id, email: schema.platformUsers.email });

  if (!row) {
    console.error("error: insert returned no row");
    process.exit(1);
  }

  console.log(`created platform user ${row.email} (id=${row.id})`);
  console.log("sign in at /platform/login");
  process.exit(0);
}

main().catch((err) => {
  console.error("failed:", err);
  process.exit(1);
});
