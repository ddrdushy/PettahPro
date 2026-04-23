import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { requirePermission } from "../../lib/permissions.js";

/**
 * Item category hierarchy routes (roadmap #36, inventory-module-spec §2.4).
 *
 * The tree lives in `item_categories` (self-referential parent_id) with
 * DB triggers enforcing cycle prevention + same-tenant parents. Defaults
 * (valuation method, tax code, accounts, SKU prefix, reorder point) are
 * nullable — a null means "inherit from ancestor" and the
 * `item_category_effective_defaults(uuid)` SQL helper walks the chain.
 *
 * Delete semantics:
 *   - Soft-delete only (sets deleted_at).
 *   - Blocks if the category has active children: "move or delete children first."
 *   - Blocks if any items reference the category: the FK is ON DELETE SET NULL
 *     on the hard-delete path, but at the API layer we require the tenant to
 *     reassign first to avoid surprise orphaning.
 *
 * Move semantics:
 *   - PATCH body may include parent_id. The cycle trigger covers the safety
 *     case (trying to move a node under its own descendant); we translate
 *     the DB error into a 400 CYCLE here.
 */

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(128),
  parentId: z.string().uuid().nullable().optional(),
  codePrefix: z.string().trim().max(16).nullable().optional(),
  defaultValuationMethod: z
    .enum(["fifo", "weighted_avg", "standard", "specific"])
    .nullable()
    .optional(),
  defaultTaxCodeId: z.string().uuid().nullable().optional(),
  defaultIncomeAccountId: z.string().uuid().nullable().optional(),
  defaultExpenseAccountId: z.string().uuid().nullable().optional(),
  defaultAssetAccountId: z.string().uuid().nullable().optional(),
  defaultReorderPoint: z.number().int().min(0).nullable().optional(),
  sortOrder: z.number().int().optional(),
});

const UpdateSchema = CreateSchema.partial();

type CategoryTreeRow = {
  id: string;
  tenant_id: string;
  parent_id: string | null;
  name: string;
  code_prefix: string | null;
  default_valuation_method: string | null;
  default_tax_code_id: string | null;
  default_income_account_id: string | null;
  default_expense_account_id: string | null;
  default_asset_account_id: string | null;
  default_reorder_point: number | null;
  sort_order: number;
  is_active: boolean;
  depth: number;
  path: string;
  item_count: number;
};

export const itemCategoriesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /item-categories — flat list ordered depth-first for tree render.
  // Each row carries `depth` (0 = root) and `path` (a materialised ordered
  // breadcrumb of names, "Textile › Cotton › Shirting"). The web layer
  // uses depth for indentation and path for search.
  //
  // Also returns item_count per node so the UI can warn before delete.
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const rows = await withTenant(ctx.tenantId, async (tx) => {
      const res = await tx.execute(sql`
        WITH RECURSIVE tree AS (
          SELECT
            c.*,
            0 AS depth,
            c.name::text AS path,
            ARRAY[c.sort_order, 0]::int[] AS sort_key
          FROM item_categories c
          WHERE c.parent_id IS NULL
            AND c.deleted_at IS NULL
            AND c.tenant_id = current_tenant_id()

          UNION ALL

          SELECT
            c.*,
            tree.depth + 1,
            (tree.path || ' › ' || c.name)::text,
            tree.sort_key || c.sort_order
          FROM item_categories c
          INNER JOIN tree ON c.parent_id = tree.id
          WHERE c.deleted_at IS NULL
        ),
        counts AS (
          SELECT category_id, count(*)::int AS n
          FROM items
          WHERE deleted_at IS NULL
            AND tenant_id = current_tenant_id()
            AND category_id IS NOT NULL
          GROUP BY category_id
        )
        SELECT
          t.*,
          COALESCE(c.n, 0) AS item_count
        FROM tree t
        LEFT JOIN counts c ON c.category_id = t.id
        ORDER BY t.sort_key, lower(t.name)
      `);
      return res as unknown as CategoryTreeRow[];
    });

    return reply.send({
      categories: rows.map((r) => ({
        id: r.id,
        parentId: r.parent_id,
        name: r.name,
        codePrefix: r.code_prefix,
        defaultValuationMethod: r.default_valuation_method,
        defaultTaxCodeId: r.default_tax_code_id,
        defaultIncomeAccountId: r.default_income_account_id,
        defaultExpenseAccountId: r.default_expense_account_id,
        defaultAssetAccountId: r.default_asset_account_id,
        defaultReorderPoint: r.default_reorder_point,
        sortOrder: r.sort_order,
        isActive: r.is_active,
        depth: r.depth,
        path: r.path,
        itemCount: r.item_count,
      })),
    });
  });

  // GET /item-categories/:id/effective — resolved defaults with inheritance
  fastify.get<{ Params: { id: string } }>("/:id/effective", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const row = await withTenant(ctx.tenantId, async (tx) => {
      const res = await tx.execute(sql`
        SELECT * FROM item_category_effective_defaults(${req.params.id}::uuid)
      `);
      return (res as unknown as Array<{
        category_id: string;
        tenant_id: string | null;
        name: string | null;
        depth: number | null;
        code_prefix: string | null;
        default_valuation_method: string | null;
        default_tax_code_id: string | null;
        default_income_account_id: string | null;
        default_expense_account_id: string | null;
        default_asset_account_id: string | null;
        default_reorder_point: number | null;
      }>)[0];
    });

    if (!row || !row.tenant_id) {
      return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    }

    return reply.send({
      effective: {
        categoryId: row.category_id,
        name: row.name,
        depth: row.depth,
        codePrefix: row.code_prefix,
        defaultValuationMethod: row.default_valuation_method,
        defaultTaxCodeId: row.default_tax_code_id,
        defaultIncomeAccountId: row.default_income_account_id,
        defaultExpenseAccountId: row.default_expense_account_id,
        defaultAssetAccountId: row.default_asset_account_id,
        defaultReorderPoint: row.default_reorder_point,
      },
    });
  });

  // POST /item-categories — create
  fastify.post("/", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "inventory.manage");
    if (!ctx) return;

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const data = parsed.data;

    try {
      const category = await withTenant(ctx.tenantId, async (tx) => {
        const [c] = await tx
          .insert(schema.itemCategories)
          .values({
            tenantId: ctx.tenantId,
            parentId: data.parentId ?? null,
            name: data.name,
            codePrefix: data.codePrefix ?? null,
            defaultValuationMethod: data.defaultValuationMethod ?? null,
            defaultTaxCodeId: data.defaultTaxCodeId ?? null,
            defaultIncomeAccountId: data.defaultIncomeAccountId ?? null,
            defaultExpenseAccountId: data.defaultExpenseAccountId ?? null,
            defaultAssetAccountId: data.defaultAssetAccountId ?? null,
            defaultReorderPoint: data.defaultReorderPoint ?? null,
            sortOrder: data.sortOrder ?? 0,
          })
          .returning();
        return c;
      });
      return reply.status(201).send({ category });
    } catch (err) {
      return handleCategoryError(err, reply);
    }
  });

  // PATCH /item-categories/:id — update, including reparent
  fastify.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "inventory.manage");
    if (!ctx) return;

    const parsed = UpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const data = parsed.data;

    // Refuse no-op PATCH so the client gets a clear 400 instead of silent
    // success — matches the shape of other modules' optional-field PATCH
    // endpoints (e.g. /customers/:id/statement-email-settings).
    if (Object.keys(data).length === 0) {
      return reply.status(400).send({
        error: { code: "NO_FIELDS", message: "No fields to update." },
      });
    }

    try {
      const updated = await withTenant(ctx.tenantId, async (tx) => {
        const updates: Record<string, unknown> = {};
        if (data.name !== undefined) updates.name = data.name;
        if (data.parentId !== undefined) updates.parentId = data.parentId;
        if (data.codePrefix !== undefined) updates.codePrefix = data.codePrefix;
        if (data.defaultValuationMethod !== undefined)
          updates.defaultValuationMethod = data.defaultValuationMethod;
        if (data.defaultTaxCodeId !== undefined)
          updates.defaultTaxCodeId = data.defaultTaxCodeId;
        if (data.defaultIncomeAccountId !== undefined)
          updates.defaultIncomeAccountId = data.defaultIncomeAccountId;
        if (data.defaultExpenseAccountId !== undefined)
          updates.defaultExpenseAccountId = data.defaultExpenseAccountId;
        if (data.defaultAssetAccountId !== undefined)
          updates.defaultAssetAccountId = data.defaultAssetAccountId;
        if (data.defaultReorderPoint !== undefined)
          updates.defaultReorderPoint = data.defaultReorderPoint;
        if (data.sortOrder !== undefined) updates.sortOrder = data.sortOrder;

        const [row] = await tx
          .update(schema.itemCategories)
          .set(updates)
          .where(
            and(
              eq(schema.itemCategories.tenantId, ctx.tenantId),
              eq(schema.itemCategories.id, req.params.id),
              isNull(schema.itemCategories.deletedAt),
            ),
          )
          .returning();
        return row;
      });

      if (!updated) {
        return reply.status(404).send({ error: { code: "NOT_FOUND" } });
      }
      return reply.send({ category: updated });
    } catch (err) {
      return handleCategoryError(err, reply);
    }
  });

  // DELETE /item-categories/:id — soft delete.
  //
  // Guards:
  //   - Active children → 409 HAS_CHILDREN.
  //   - Referenced by items → 409 HAS_ITEMS (count surfaced so UI can say
  //     "reassign the 17 items first").
  fastify.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "inventory.manage");
    if (!ctx) return;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const childRes = await tx.execute(sql`
        SELECT count(*)::int AS n FROM item_categories
        WHERE parent_id = ${req.params.id}::uuid
          AND deleted_at IS NULL
          AND tenant_id = current_tenant_id()
      `);
      const childCount = ((childRes as unknown as Array<{ n: number }>)[0]?.n) ?? 0;
      if (childCount > 0) {
        return { ok: false as const, code: "HAS_CHILDREN", childCount };
      }

      const itemRes = await tx.execute(sql`
        SELECT count(*)::int AS n FROM items
        WHERE category_id = ${req.params.id}::uuid
          AND deleted_at IS NULL
          AND tenant_id = current_tenant_id()
      `);
      const itemCount = ((itemRes as unknown as Array<{ n: number }>)[0]?.n) ?? 0;
      if (itemCount > 0) {
        return { ok: false as const, code: "HAS_ITEMS", itemCount };
      }

      const [row] = await tx
        .update(schema.itemCategories)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(schema.itemCategories.tenantId, ctx.tenantId),
            eq(schema.itemCategories.id, req.params.id),
            isNull(schema.itemCategories.deletedAt),
          ),
        )
        .returning({ id: schema.itemCategories.id });
      return { ok: true as const, found: Boolean(row) };
    });

    if (!result.ok) {
      if (result.code === "HAS_CHILDREN") {
        return reply.status(409).send({
          error: {
            code: "HAS_CHILDREN",
            message: `Move or delete the ${result.childCount} child categor${result.childCount === 1 ? "y" : "ies"} first.`,
          },
        });
      }
      return reply.status(409).send({
        error: {
          code: "HAS_ITEMS",
          message: `Reassign the ${result.itemCount} item${result.itemCount === 1 ? "" : "s"} in this category first.`,
        },
      });
    }

    if (!result.found) {
      return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    }
    return reply.send({ ok: true });
  });
};

/**
 * Map DB-level constraint / trigger errors into the right HTTP shape.
 * The cycle trigger raises with ERRCODE=check_violation, the same-tenant
 * check uses the same code — distinguish via substring.
 */
function handleCategoryError(err: unknown, reply: import("fastify").FastifyReply) {
  const msg = (err as Error).message ?? "";
  if (msg.includes("cycle")) {
    return reply.status(400).send({
      error: {
        code: "CYCLE",
        message: "Can't move a category into its own descendant.",
      },
    });
  }
  if (msg.includes("different tenant")) {
    return reply.status(400).send({
      error: { code: "INVALID_PARENT", message: "Parent category not found." },
    });
  }
  if (msg.includes("max depth")) {
    return reply.status(400).send({
      error: { code: "MAX_DEPTH", message: "Category hierarchy too deep." },
    });
  }
  if (msg.includes("item_categories_sibling_name_uidx")) {
    return reply.status(409).send({
      error: {
        code: "DUPLICATE_NAME",
        message: "Another category at this level already uses that name.",
      },
    });
  }
  throw err;
}
