import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requirePermission } from "../../lib/permissions.js";
import {
  findLibraryTemplate,
  listLibraryTemplates,
} from "./template-library.js";

/**
 * Document templates (roadmap #33) — per-tenant layout records that
 * drive the PDF renderer. v1 scope:
 *
 *   GET    /document-templates                  — list / filter
 *   GET    /document-templates/library          — platform library
 *   GET    /document-templates/:id              — single
 *   POST   /document-templates                  — create blank
 *   POST   /document-templates/clone-library    — clone from library
 *   POST   /document-templates/:id/clone        — clone existing (bump version)
 *   POST   /document-templates/:id/set-default  — atomically swap default
 *   POST   /document-templates/:id/publish      — draft → published
 *   PATCH  /document-templates/:id              — edit name/desc/layout
 *   DELETE /document-templates/:id              — soft-delete
 *
 * All mutations require `settings.manage` since templates are admin
 * surface (tenant-admin-ux-spec §2.4 Documents group). Reads require
 * any authenticated tenant user — the render routes on the web side
 * need to pull the active template for non-admin users too.
 */

// Keep in lockstep with the SQL CHECK constraint and the drizzle
// DOCUMENT_TEMPLATE_DOC_TYPES constant.
const DocTypeSchema = z.enum([
  "invoice",
  "quotation",
  "credit_note",
  "debit_note",
  "delivery_note",
  "proforma_invoice",
  "bill",
  "purchase_order",
  "goods_received_note",
  "stock_transfer",
  "payslip",
  "settlement_letter",
]);

const StatusSchema = z.enum(["draft", "published", "archived"]);

// Layout is opaque to the API — the web renderer owns the schema.
// We accept any JSON object; validation happens at render time.
const LayoutSchema = z.record(z.any());

const CreateSchema = z.object({
  docType: DocTypeSchema,
  language: z.string().min(2).max(5).default("en"),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional().or(z.literal("")),
  layout: LayoutSchema.default({}),
  libraryKey: z.string().max(80).optional(),
});

const UpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  layout: LayoutSchema.optional(),
  status: StatusSchema.optional(),
});

const CloneLibrarySchema = z.object({
  libraryKey: z.string().min(1).max(80),
  language: z.string().min(2).max(5).default("en"),
  name: z.string().trim().min(1).max(200).optional(),
});

function toRow(t: typeof schema.documentTemplates.$inferSelect) {
  return {
    id: t.id,
    docType: t.docType,
    language: t.language,
    name: t.name,
    description: t.description,
    layoutJson: t.layoutJson,
    version: t.version,
    status: t.status,
    isDefault: t.isDefault,
    libraryKey: t.libraryKey,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export const documentTemplatesRoutes: FastifyPluginAsync = async (fastify) => {
  // --- list + filters ----------------------------------------------------
  fastify.get<{
    Querystring: { docType?: string; language?: string; status?: string };
  }>("/", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) => {
      const whereClauses = [
        eq(schema.documentTemplates.tenantId, ctx.tenantId),
        isNull(schema.documentTemplates.deletedAt),
      ];
      if (req.query.docType) {
        whereClauses.push(eq(schema.documentTemplates.docType, req.query.docType));
      }
      if (req.query.language) {
        whereClauses.push(
          eq(schema.documentTemplates.language, req.query.language),
        );
      }
      if (req.query.status) {
        whereClauses.push(eq(schema.documentTemplates.status, req.query.status));
      }
      return tx
        .select()
        .from(schema.documentTemplates)
        .where(and(...whereClauses))
        .orderBy(desc(schema.documentTemplates.updatedAt))
        .limit(500);
    });

    return reply.send({ templates: rows.map(toRow) });
  });

  // --- library (hard-coded starter set) ---------------------------------
  fastify.get<{ Querystring: { docType?: string } }>(
    "/library",
    async (req, reply) => {
      const ctx = await requirePermission(req, reply, "settings.manage");
      if (!ctx) return;

      return reply.send({
        templates: listLibraryTemplates({ docType: req.query.docType }),
      });
    },
  );

  // --- single ------------------------------------------------------------
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;

    const [row] = await withTenant(ctx.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.documentTemplates)
        .where(
          and(
            eq(schema.documentTemplates.tenantId, ctx.tenantId),
            eq(schema.documentTemplates.id, req.params.id),
            isNull(schema.documentTemplates.deletedAt),
          ),
        )
        .limit(1),
    );
    if (!row) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send({ template: toRow(row) });
  });

  // --- create blank ------------------------------------------------------
  fastify.post("/", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const data = parsed.data;

    const row = await withTenant(ctx.tenantId, async (tx) => {
      const [inserted] = await tx
        .insert(schema.documentTemplates)
        .values({
          tenantId: ctx.tenantId,
          docType: data.docType,
          language: data.language,
          name: data.name,
          description: data.description || null,
          layoutJson: data.layout,
          libraryKey: data.libraryKey ?? null,
          createdByUserId: ctx.userId,
          status: "draft",
          version: 1,
          isDefault: false,
        })
        .returning();
      if (!inserted) throw new Error("document_templates insert returned empty");
      return inserted;
    });

    return reply.status(201).send({ template: toRow(row) });
  });

  // --- clone from library ------------------------------------------------
  fastify.post("/clone-library", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;

    const parsed = CloneLibrarySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const data = parsed.data;

    const source = findLibraryTemplate(data.libraryKey);
    if (!source) {
      return reply
        .status(404)
        .send({ error: { code: "LIBRARY_TEMPLATE_NOT_FOUND" } });
    }
    if (!source.languages.includes(data.language)) {
      return reply
        .status(400)
        .send({ error: { code: "LANGUAGE_NOT_IN_LIBRARY_ENTRY" } });
    }

    const row = await withTenant(ctx.tenantId, async (tx) => {
      const [inserted] = await tx
        .insert(schema.documentTemplates)
        .values({
          tenantId: ctx.tenantId,
          docType: source.docType,
          language: data.language,
          name: data.name ?? source.name,
          description: source.description,
          layoutJson: source.layout,
          libraryKey: source.libraryKey,
          createdByUserId: ctx.userId,
          status: "draft",
          version: 1,
          isDefault: false,
        })
        .returning();
      if (!inserted) throw new Error("document_templates insert returned empty");
      return inserted;
    });

    return reply.status(201).send({ template: toRow(row) });
  });

  // --- clone existing (bump version) ------------------------------------
  // Creates a new row with the same content but `version = existing+1`
  // and status 'draft'. The existing row stays untouched — archive it
  // via PATCH status=archived when the clone is ready. This keeps the
  // version-control flow explicit: nothing is implicitly overwritten.
  fastify.post<{ Params: { id: string } }>(
    "/:id/clone",
    async (req, reply) => {
      const ctx = await requirePermission(req, reply, "settings.manage");
      if (!ctx) return;

      const row = await withTenant(ctx.tenantId, async (tx) => {
        const [existing] = await tx
          .select()
          .from(schema.documentTemplates)
          .where(
            and(
              eq(schema.documentTemplates.tenantId, ctx.tenantId),
              eq(schema.documentTemplates.id, req.params.id),
              isNull(schema.documentTemplates.deletedAt),
            ),
          )
          .limit(1);
        if (!existing) return null;

        const [inserted] = await tx
          .insert(schema.documentTemplates)
          .values({
            tenantId: ctx.tenantId,
            docType: existing.docType,
            language: existing.language,
            name: `${existing.name} (v${existing.version + 1})`,
            description: existing.description,
            layoutJson: existing.layoutJson,
            libraryKey: existing.libraryKey,
            createdByUserId: ctx.userId,
            status: "draft",
            version: existing.version + 1,
            isDefault: false,
          })
          .returning();
        return inserted;
      });

      if (!row) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
      return reply.status(201).send({ template: toRow(row) });
    },
  );

  // --- set default (atomic swap) ----------------------------------------
  // Clears existing default for (doc_type, language), sets this one.
  // Uses a single UPDATE with a CASE so the partial unique index never
  // sees two defaults between statements.
  fastify.post<{ Params: { id: string } }>(
    "/:id/set-default",
    async (req, reply) => {
      const ctx = await requirePermission(req, reply, "settings.manage");
      if (!ctx) return;

      const row = await withTenant(ctx.tenantId, async (tx) => {
        const [target] = await tx
          .select()
          .from(schema.documentTemplates)
          .where(
            and(
              eq(schema.documentTemplates.tenantId, ctx.tenantId),
              eq(schema.documentTemplates.id, req.params.id),
              isNull(schema.documentTemplates.deletedAt),
            ),
          )
          .limit(1);
        if (!target) return null;
        if (target.status !== "published") {
          return { error: "NOT_PUBLISHED" as const };
        }

        await tx
          .update(schema.documentTemplates)
          .set({
            isDefault: sql`(${schema.documentTemplates.id} = ${target.id})`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.documentTemplates.tenantId, ctx.tenantId),
              eq(schema.documentTemplates.docType, target.docType),
              eq(schema.documentTemplates.language, target.language),
              isNull(schema.documentTemplates.deletedAt),
            ),
          );

        const [refreshed] = await tx
          .select()
          .from(schema.documentTemplates)
          .where(eq(schema.documentTemplates.id, target.id))
          .limit(1);
        return { template: refreshed };
      });

      if (!row) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
      if ("error" in row && row.error === "NOT_PUBLISHED") {
        return reply
          .status(409)
          .send({ error: { code: "TEMPLATE_NOT_PUBLISHED" } });
      }
      return reply.send({ template: toRow(row.template!) });
    },
  );

  // --- publish (draft → published) --------------------------------------
  fastify.post<{ Params: { id: string } }>(
    "/:id/publish",
    async (req, reply) => {
      const ctx = await requirePermission(req, reply, "settings.manage");
      if (!ctx) return;

      const row = await withTenant(ctx.tenantId, async (tx) => {
        const [existing] = await tx
          .select()
          .from(schema.documentTemplates)
          .where(
            and(
              eq(schema.documentTemplates.tenantId, ctx.tenantId),
              eq(schema.documentTemplates.id, req.params.id),
              isNull(schema.documentTemplates.deletedAt),
            ),
          )
          .limit(1);
        if (!existing) return null;

        const [updated] = await tx
          .update(schema.documentTemplates)
          .set({ status: "published", updatedAt: new Date() })
          .where(eq(schema.documentTemplates.id, existing.id))
          .returning();
        return updated;
      });

      if (!row) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
      return reply.send({ template: toRow(row) });
    },
  );

  // --- patch -------------------------------------------------------------
  fastify.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;

    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const body = parsed.data;

    const row = await withTenant(ctx.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.documentTemplates)
        .where(
          and(
            eq(schema.documentTemplates.tenantId, ctx.tenantId),
            eq(schema.documentTemplates.id, req.params.id),
            isNull(schema.documentTemplates.deletedAt),
          ),
        )
        .limit(1);
      if (!existing) return null;

      const patch: Partial<typeof schema.documentTemplates.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (body.name !== undefined) patch.name = body.name;
      if (body.description !== undefined) {
        patch.description = body.description ?? null;
      }
      if (body.layout !== undefined) patch.layoutJson = body.layout;
      if (body.status !== undefined) patch.status = body.status;

      const [updated] = await tx
        .update(schema.documentTemplates)
        .set(patch)
        .where(eq(schema.documentTemplates.id, existing.id))
        .returning();
      return updated;
    });

    if (!row) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send({ template: toRow(row) });
  });

  // --- soft-delete -------------------------------------------------------
  // Default templates can't be deleted — clear the default first.
  fastify.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.documentTemplates)
        .where(
          and(
            eq(schema.documentTemplates.tenantId, ctx.tenantId),
            eq(schema.documentTemplates.id, req.params.id),
            isNull(schema.documentTemplates.deletedAt),
          ),
        )
        .limit(1);
      if (!existing) return { error: "NOT_FOUND" as const };
      if (existing.isDefault) return { error: "CANNOT_DELETE_DEFAULT" as const };

      await tx
        .update(schema.documentTemplates)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.documentTemplates.id, existing.id));
      return { ok: true as const };
    });

    if ("error" in result) {
      if (result.error === "NOT_FOUND") {
        return reply.status(404).send({ error: { code: "NOT_FOUND" } });
      }
      return reply
        .status(409)
        .send({ error: { code: "CANNOT_DELETE_DEFAULT_TEMPLATE" } });
    }
    return reply.send({ ok: true });
  });

  // --- active template lookup (used by render routes) -------------------
  // Returns the published+default template for (docType, language).
  // Falls back to en if the requested language has no default, then
  // returns null so the render route can use the hard-coded component.
  fastify.get<{
    Querystring: { docType: string; language?: string };
  }>("/active", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "settings.manage");
    if (!ctx) return;

    if (!req.query.docType) {
      return reply.status(400).send({ error: { code: "MISSING_DOC_TYPE" } });
    }

    const language = req.query.language ?? "en";

    const row = await withTenant(ctx.tenantId, async (tx) => {
      const pick = async (lang: string) => {
        const [r] = await tx
          .select()
          .from(schema.documentTemplates)
          .where(
            and(
              eq(schema.documentTemplates.tenantId, ctx.tenantId),
              eq(schema.documentTemplates.docType, req.query.docType),
              eq(schema.documentTemplates.language, lang),
              eq(schema.documentTemplates.isDefault, true),
              eq(schema.documentTemplates.status, "published"),
              isNull(schema.documentTemplates.deletedAt),
            ),
          )
          .limit(1);
        return r ?? null;
      };
      const primary = await pick(language);
      if (primary) return primary;
      if (language !== "en") return pick("en");
      return null;
    });

    return reply.send({ template: row ? toRow(row) : null });
  });
};
