import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, asc, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { requirePermission } from "../../lib/permissions.js";
import { recordAuditEvent } from "../../lib/audit.js";

/**
 * Chart of accounts (#I3 / gaps I3).
 *
 * Read is open to any authenticated tenant member. Write requires
 * `settings.manage` because customising the CoA is an admin-tier
 * action — it touches the structure every transaction posts against.
 *
 * Two safety rails on system accounts (the seeded SL-typical ones from
 * `seed_tenant_defaults`):
 *   1. `code` and `account_type` are immutable. The seed function and
 *      every module that resolves an account by code (1010 bank, 1100
 *      AR, 4000 sales, etc.) needs the codes to stay put.
 *   2. Soft-delete is refused. We only let the user *deactivate* a
 *      system account. Custom (user-added) accounts can be hard-soft-
 *      deleted iff no journal_lines reference them.
 *
 * The "wizard" is just the same CRUD surfaced as a section-grouped UI
 * — there's no separate workflow state to model. Customising is the
 * normal lifecycle of the table.
 */

const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
const NORMAL_SIDES = ["dr", "cr"] as const;

const CreateSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(16)
    .regex(/^[A-Za-z0-9._-]+$/, "Code must use letters, digits, dot, dash, or underscore."),
  name: z.string().trim().min(1).max(255),
  accountType: z.enum(ACCOUNT_TYPES),
  accountSubtype: z.string().trim().min(1).max(32).nullable().optional(),
  normalSide: z.enum(NORMAL_SIDES),
  description: z.string().trim().max(2000).nullable().optional(),
  currency: z.string().trim().length(3).optional(),
});

const UpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    accountSubtype: z.string().trim().min(1).max(32).nullable().optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    isActive: z.boolean().optional(),
    // Custom accounts can rename their code; system accounts can't.
    code: z
      .string()
      .trim()
      .min(2)
      .max(16)
      .regex(/^[A-Za-z0-9._-]+$/)
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field is required.",
  });

export const coaRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const accounts = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.chartOfAccounts)
        .where(
          and(
            eq(schema.chartOfAccounts.tenantId, ctx.tenantId),
            isNull(schema.chartOfAccounts.deletedAt),
          ),
        )
        .orderBy(asc(schema.chartOfAccounts.code)),
    );
    return reply.send({ accounts });
  });

  fastify.post("/", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "INVALID_INPUT",
          message: parsed.error.issues[0]?.message ?? "Invalid payload.",
        },
      });
    }

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const dupRows = await tx
        .select({ id: schema.chartOfAccounts.id })
        .from(schema.chartOfAccounts)
        .where(
          and(
            eq(schema.chartOfAccounts.tenantId, ctx.tenantId),
            eq(schema.chartOfAccounts.code, parsed.data.code),
            isNull(schema.chartOfAccounts.deletedAt),
          ),
        )
        .limit(1);
      if (dupRows.length > 0) {
        return { error: "DUPLICATE_CODE" as const };
      }

      const [row] = await tx
        .insert(schema.chartOfAccounts)
        .values({
          tenantId: ctx.tenantId,
          code: parsed.data.code,
          name: parsed.data.name,
          accountType: parsed.data.accountType,
          accountSubtype: parsed.data.accountSubtype ?? null,
          normalSide: parsed.data.normalSide,
          description: parsed.data.description ?? null,
          currency: parsed.data.currency ?? "LKR",
          isSystem: false,
          isActive: true,
        })
        .returning();
      if (!row) return { error: "INSERT_FAILED" as const };

      await recordAuditEvent(tx, {
        kind: "coa.account_created",
        summary: `Added account ${row.code} — ${row.name}`,
        refType: "chart_of_account",
        refId: row.id,
        diff: {
          code: row.code,
          name: row.name,
          accountType: row.accountType,
          normalSide: row.normalSide,
        },
        actorUserId: ctx.userId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      return { account: row };
    });

    if ("error" in result) {
      if (result.error === "DUPLICATE_CODE") {
        return reply.status(409).send({
          error: {
            code: "DUPLICATE_CODE",
            message: "An account with that code already exists.",
          },
        });
      }
      return reply.status(500).send({ error: { code: result.error } });
    }
    return reply.status(201).send(result);
  });

  fastify.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;

    const idParsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!idParsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }
    const bodyParsed = UpdateSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      return reply.status(400).send({
        error: {
          code: "INVALID_INPUT",
          message: bodyParsed.error.issues[0]?.message ?? "Invalid payload.",
        },
      });
    }
    const updates = bodyParsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.chartOfAccounts)
        .where(
          and(
            eq(schema.chartOfAccounts.tenantId, ctx.tenantId),
            eq(schema.chartOfAccounts.id, idParsed.data.id),
            isNull(schema.chartOfAccounts.deletedAt),
          ),
        )
        .limit(1);
      if (!row) return { error: "NOT_FOUND" as const };

      // System-account safety: code stays put. Renaming is fine.
      if (row.isSystem && updates.code !== undefined && updates.code !== row.code) {
        return { error: "SYSTEM_CODE_IMMUTABLE" as const };
      }

      // Custom-code rename: check for collisions.
      if (updates.code !== undefined && updates.code !== row.code) {
        const dupRows = await tx
          .select({ id: schema.chartOfAccounts.id })
          .from(schema.chartOfAccounts)
          .where(
            and(
              eq(schema.chartOfAccounts.tenantId, ctx.tenantId),
              eq(schema.chartOfAccounts.code, updates.code),
              isNull(schema.chartOfAccounts.deletedAt),
            ),
          )
          .limit(1);
        if (dupRows.length > 0) return { error: "DUPLICATE_CODE" as const };
      }

      const before = {
        code: row.code,
        name: row.name,
        accountSubtype: row.accountSubtype,
        description: row.description,
        isActive: row.isActive,
      };

      const [updated] = await tx
        .update(schema.chartOfAccounts)
        .set({
          ...(updates.code !== undefined ? { code: updates.code } : {}),
          ...(updates.name !== undefined ? { name: updates.name } : {}),
          ...(updates.accountSubtype !== undefined
            ? { accountSubtype: updates.accountSubtype }
            : {}),
          ...(updates.description !== undefined
            ? { description: updates.description }
            : {}),
          ...(updates.isActive !== undefined ? { isActive: updates.isActive } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.chartOfAccounts.id, row.id))
        .returning();

      const after = {
        code: updated!.code,
        name: updated!.name,
        accountSubtype: updated!.accountSubtype,
        description: updated!.description,
        isActive: updated!.isActive,
      };

      await recordAuditEvent(tx, {
        kind: "coa.account_updated",
        summary: `Updated account ${updated!.code} — ${updated!.name}`,
        refType: "chart_of_account",
        refId: updated!.id,
        diff: { before, after },
        actorUserId: ctx.userId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      return { account: updated! };
    });

    if ("error" in result) {
      if (result.error === "NOT_FOUND") {
        return reply.status(404).send({ error: { code: "NOT_FOUND" } });
      }
      if (result.error === "SYSTEM_CODE_IMMUTABLE") {
        return reply.status(409).send({
          error: {
            code: "SYSTEM_CODE_IMMUTABLE",
            message:
              "System accounts have a fixed code — modules look them up by code. Rename freely.",
          },
        });
      }
      if (result.error === "DUPLICATE_CODE") {
        return reply.status(409).send({
          error: {
            code: "DUPLICATE_CODE",
            message: "Another account already uses that code.",
          },
        });
      }
      return reply.status(500).send({ error: { code: result.error } });
    }
    return reply.send(result);
  });

  fastify.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;

    const parsed = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT" } });
    }

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.chartOfAccounts)
        .where(
          and(
            eq(schema.chartOfAccounts.tenantId, ctx.tenantId),
            eq(schema.chartOfAccounts.id, parsed.data.id),
            isNull(schema.chartOfAccounts.deletedAt),
          ),
        )
        .limit(1);
      if (!row) return { error: "NOT_FOUND" as const };

      // System accounts can't be deleted — they're load-bearing for
      // the seeded modules. They can be deactivated via PATCH instead.
      if (row.isSystem) {
        return { error: "SYSTEM_ACCOUNT" as const };
      }

      // Block delete if the account has any GL movement; users can
      // deactivate to hide it from pickers without breaking history.
      const usageRows = (await tx.execute(sql`
        SELECT 1 AS used FROM journal_lines
         WHERE tenant_id = current_tenant_id() AND account_id = ${row.id}::uuid
         LIMIT 1
      `)) as unknown as Array<{ used: number }>;
      if (usageRows.length > 0) {
        return { error: "ACCOUNT_IN_USE" as const };
      }

      const [updated] = await tx
        .update(schema.chartOfAccounts)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.chartOfAccounts.id, row.id))
        .returning();

      await recordAuditEvent(tx, {
        kind: "coa.account_deleted",
        summary: `Deleted account ${row.code} — ${row.name}`,
        refType: "chart_of_account",
        refId: row.id,
        diff: { code: row.code, name: row.name },
        actorUserId: ctx.userId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      return { account: updated! };
    });

    if ("error" in result) {
      if (result.error === "NOT_FOUND") {
        return reply.status(404).send({ error: { code: "NOT_FOUND" } });
      }
      if (result.error === "SYSTEM_ACCOUNT") {
        return reply.status(409).send({
          error: {
            code: "SYSTEM_ACCOUNT",
            message: "System accounts can't be deleted — deactivate instead.",
          },
        });
      }
      if (result.error === "ACCOUNT_IN_USE") {
        return reply.status(409).send({
          error: {
            code: "ACCOUNT_IN_USE",
            message:
              "This account has posted journal entries. Deactivate it to hide from pickers without losing history.",
          },
        });
      }
      return reply.status(500).send({ error: { code: result.error } });
    }
    return reply.send({ ok: true, account: result.account });
  });
};

export const taxCodesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const taxCodes = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.taxCodes)
        .where(
          and(
            eq(schema.taxCodes.tenantId, ctx.tenantId),
            isNull(schema.taxCodes.deletedAt),
          ),
        )
        .orderBy(asc(schema.taxCodes.code)),
    );
    return reply.send({ taxCodes });
  });
};
