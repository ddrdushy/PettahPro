import type { FastifyPluginAsync } from "fastify";
import { and, asc, desc, eq, ilike, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { requirePermission } from "../../lib/permissions.js";
import { recordAuditEvent } from "../../lib/audit.js";

const ItemTypeSchema = z.enum(["product", "service", "bundle"]);

const CreateSchema = z.object({
  sku: z.string().trim().max(64).optional().or(z.literal("")),
  barcode: z.string().trim().max(64).optional().or(z.literal("")),
  name: z.string().trim().min(1).max(255),
  description: z.string().optional().or(z.literal("")),
  itemType: ItemTypeSchema.default("product"),
  unit: z.string().trim().max(16).default("unit"),
  sellPriceCents: z.number().int().min(0).default(0),
  buyPriceCents: z.number().int().min(0).default(0),
  currency: z.string().length(3).default("LKR"),
  trackInventory: z.boolean().default(true),
  valuationMethod: z.enum(["fifo", "weighted_avg", "standard"]).default("weighted_avg"),
  reorderPoint: z.number().int().min(0).optional(),
  taxCodeId: z.string().uuid().optional(),
  categoryId: z.string().uuid().nullable().optional(),
});

// PATCH — every field optional, same validators as Create. `itemType`
// can change but flipping between bundle / non-bundle has extra rules
// enforced in the handler (see below) rather than at the schema layer
// so the error messages stay specific.
const UpdateSchema = z.object({
  sku: z.string().trim().max(64).nullable().optional(),
  barcode: z.string().trim().max(64).nullable().optional(),
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  itemType: ItemTypeSchema.optional(),
  unit: z.string().trim().max(16).optional(),
  sellPriceCents: z.number().int().min(0).optional(),
  buyPriceCents: z.number().int().min(0).optional(),
  currency: z.string().length(3).optional(),
  trackInventory: z.boolean().optional(),
  valuationMethod: z.enum(["fifo", "weighted_avg", "standard"]).optional(),
  reorderPoint: z.number().int().min(0).nullable().optional(),
  taxCodeId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

// PUT /items/:id/components — replace-all. Client collapses duplicate
// componentItemIds client-side (the UI consolidates when the user adds
// the same component twice), but we validate again here — the wire
// contract is "unique rows, positive quantities".
const ComponentsSchema = z.object({
  components: z
    .array(
      z.object({
        componentItemId: z.string().uuid(),
        quantity: z.number().positive().max(1_000_000),
      }),
    )
    .max(500),
});

export const itemsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const q = typeof req.query === "object" && req.query
      ? (req.query as { q?: string }).q?.trim()
      : undefined;

    const rows = await withTenant(ctx.tenantId, async (tx) => {
      const whereClauses = [
        eq(schema.items.tenantId, ctx.tenantId),
        isNull(schema.items.deletedAt),
      ];
      if (q) whereClauses.push(ilike(schema.items.name, `%${q}%`));

      return tx
        .select()
        .from(schema.items)
        .where(and(...whereClauses))
        .orderBy(desc(schema.items.createdAt))
        .limit(200);
    });

    return reply.send({ items: rows });
  });

  // GET /items/:id — single item with its components inlined when
  // it's a bundle. Non-bundles get `components: []` for a stable
  // client shape so the detail page doesn't need to branch on
  // presence vs null.
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const [item] = await tx
        .select()
        .from(schema.items)
        .where(
          and(
            eq(schema.items.tenantId, ctx.tenantId),
            eq(schema.items.id, req.params.id),
            isNull(schema.items.deletedAt),
          ),
        )
        .limit(1);
      if (!item) return null;

      const components =
        item.itemType === "bundle"
          ? await loadBundleComponents(tx, ctx.tenantId, item.id)
          : [];
      return { item, components };
    });

    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send(data);
  });

  fastify.post("/", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "inventory.manage");
    if (!ctx) return;

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const data = parsed.data;

    // Services never track stock; bundles never track stock (they're
    // virtual — see migration 74). Keep the one-line guard here rather
    // than scattering the rule across a type check.
    const trackInventory =
      data.itemType === "service" || data.itemType === "bundle"
        ? false
        : data.trackInventory;

    try {
      const item = await withTenant(ctx.tenantId, async (tx) => {
        const [i] = await tx
          .insert(schema.items)
          .values({
            tenantId: ctx.tenantId,
            sku: data.sku || null,
            barcode: data.barcode || null,
            name: data.name,
            description: data.description || null,
            itemType: data.itemType,
            unit: data.unit,
            sellPriceCents: data.sellPriceCents,
            buyPriceCents: data.buyPriceCents,
            currency: data.currency,
            trackInventory,
            valuationMethod: data.valuationMethod,
            reorderPoint: data.reorderPoint ?? null,
            taxCodeId: data.taxCodeId ?? null,
            categoryId: data.categoryId ?? null,
          })
          .returning();
        return i;
      });
      return reply.status(201).send({ item });
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (msg.includes("items_tenant_sku_unique")) {
        return reply.status(409).send({ error: { code: "DUPLICATE_SKU", message: "An item with this SKU already exists." } });
      }
      throw err;
    }
  });

  // PATCH /items/:id — partial update. Bundle-type transitions have
  // extra guards: you can't flip a bundle → non-bundle while it still
  // has components (the caller must clear components first, so the
  // intent is explicit), and any non-bundle → bundle flip forces
  // `trackInventory=false` since bundles are virtual.
  fastify.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "inventory.manage");
    if (!ctx) return;

    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const body = parsed.data;

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.items)
        .where(
          and(
            eq(schema.items.tenantId, ctx.tenantId),
            eq(schema.items.id, req.params.id),
            isNull(schema.items.deletedAt),
          ),
        )
        .limit(1);
      if (!existing) return { error: "NOT_FOUND" as const };

      const nextItemType = body.itemType ?? existing.itemType;
      const typeChanged = body.itemType && body.itemType !== existing.itemType;

      // bundle → non-bundle: block if components exist. Forces the
      // caller to clear the component list via `PUT .../components`
      // with an empty array first, so the transition is never a
      // silent data loss.
      if (typeChanged && existing.itemType === "bundle") {
        const rows = await tx
          .select({ id: schema.itemBundleComponents.id })
          .from(schema.itemBundleComponents)
          .where(eq(schema.itemBundleComponents.bundleItemId, existing.id))
          .limit(1);
        if (rows.length > 0) {
          return { error: "BUNDLE_HAS_COMPONENTS" as const };
        }
      }

      // Any move to bundle forces trackInventory=false. A bundle's
      // stock lives on its components, not on itself.
      const trackInventory =
        nextItemType === "bundle" || nextItemType === "service"
          ? false
          : body.trackInventory ?? existing.trackInventory;

      const [updated] = await tx
        .update(schema.items)
        .set({
          ...(body.sku !== undefined ? { sku: body.sku || null } : {}),
          ...(body.barcode !== undefined ? { barcode: body.barcode || null } : {}),
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined
            ? { description: body.description || null }
            : {}),
          itemType: nextItemType,
          ...(body.unit !== undefined ? { unit: body.unit } : {}),
          ...(body.sellPriceCents !== undefined
            ? { sellPriceCents: body.sellPriceCents }
            : {}),
          ...(body.buyPriceCents !== undefined
            ? { buyPriceCents: body.buyPriceCents }
            : {}),
          ...(body.currency !== undefined ? { currency: body.currency } : {}),
          trackInventory,
          ...(body.valuationMethod !== undefined
            ? { valuationMethod: body.valuationMethod }
            : {}),
          ...(body.reorderPoint !== undefined
            ? { reorderPoint: body.reorderPoint }
            : {}),
          ...(body.taxCodeId !== undefined ? { taxCodeId: body.taxCodeId } : {}),
          ...(body.categoryId !== undefined
            ? { categoryId: body.categoryId }
            : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.items.id, existing.id))
        .returning();

      return { item: updated };
    });

    if ("error" in result) {
      const msgs: Record<string, string> = {
        NOT_FOUND: "Item not found.",
        BUNDLE_HAS_COMPONENTS:
          "This bundle still has components. Clear the component list before changing its type.",
      };
      const code = result.error as string;
      const status = code === "NOT_FOUND" ? 404 : 409;
      return reply
        .status(status)
        .send({ error: { code, message: msgs[code] ?? code } });
    }
    return reply.send(result);
  });

  // GET /items/:id/components — flat list of the bundle's components
  // with the component's name + SKU joined in for UI rendering. Returns
  // 404 for a non-bundle so clients don't render an empty "components"
  // table when they shouldn't be asking.
  fastify.get<{ Params: { id: string } }>(
    "/:id/components",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;

      const data = await withTenant(ctx.tenantId, async (tx) => {
        const [item] = await tx
          .select()
          .from(schema.items)
          .where(
            and(
              eq(schema.items.tenantId, ctx.tenantId),
              eq(schema.items.id, req.params.id),
              isNull(schema.items.deletedAt),
            ),
          )
          .limit(1);
        if (!item) return { error: "NOT_FOUND" as const };
        if (item.itemType !== "bundle") {
          return { error: "NOT_A_BUNDLE" as const };
        }
        const components = await loadBundleComponents(tx, ctx.tenantId, item.id);
        return { components };
      });

      if ("error" in data) {
        const code = data.error;
        return reply
          .status(code === "NOT_FOUND" ? 404 : 400)
          .send({ error: { code } });
      }
      return reply.send(data);
    },
  );

  // PUT /items/:id/components — replace-all. Validations:
  //   1. Bundle exists, tenant-scoped, item_type='bundle'.
  //   2. No duplicates in the payload.
  //   3. No self-reference.
  //   4. Every referenced component exists, is tenant-scoped, not
  //      soft-deleted, and is not itself a bundle (no nested bundles).
  // One transaction: delete-all-then-insert-all. Simpler than diffing
  // for a table this small and avoids stale rows if the frontend
  // reorders or drops a component.
  fastify.put<{ Params: { id: string } }>(
    "/:id/components",
    async (req, reply) => {
      const ctx = await requirePermission(req, reply, "inventory.manage");
      if (!ctx) return;

      const parsed = ComponentsSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
      }
      const { components: payload } = parsed.data;

      // Duplicate detection — consolidating is the UI's job, but we
      // refuse ambiguous input at the wire rather than silently
      // coalescing.
      const ids = payload.map((c) => c.componentItemId);
      if (new Set(ids).size !== ids.length) {
        return reply
          .status(400)
          .send({
            error: {
              code: "DUPLICATE_COMPONENT",
              message:
                "A component appears more than once. Combine duplicate rows and try again.",
            },
          });
      }

      const result = await withTenant(ctx.tenantId, async (tx) => {
        const [bundle] = await tx
          .select()
          .from(schema.items)
          .where(
            and(
              eq(schema.items.tenantId, ctx.tenantId),
              eq(schema.items.id, req.params.id),
              isNull(schema.items.deletedAt),
            ),
          )
          .limit(1);
        if (!bundle) return { error: "NOT_FOUND" as const };
        if (bundle.itemType !== "bundle") {
          return { error: "NOT_A_BUNDLE" as const };
        }

        if (ids.includes(bundle.id)) {
          return { error: "SELF_REFERENCE" as const };
        }

        if (payload.length > 0) {
          // Look up every component in one query. Filter out
          // soft-deleted rows and bundles.
          const componentRows = await tx
            .select({
              id: schema.items.id,
              itemType: schema.items.itemType,
            })
            .from(schema.items)
            .where(
              and(
                eq(schema.items.tenantId, ctx.tenantId),
                inArray(schema.items.id, ids),
                isNull(schema.items.deletedAt),
              ),
            );
          const byId = new Map(componentRows.map((r) => [r.id, r]));

          const missing = ids.filter((id) => !byId.has(id));
          if (missing.length > 0) {
            return { error: "COMPONENT_NOT_FOUND" as const, missing };
          }

          const nested = Array.from(byId.values()).filter(
            (r) => r.itemType === "bundle",
          );
          if (nested.length > 0) {
            return {
              error: "NESTED_BUNDLE" as const,
              nestedIds: nested.map((r) => r.id),
            };
          }
        }

        // Replace-all. Diffing would mean more code for the same
        // outcome on a table of at most a few hundred rows per
        // bundle.
        await tx
          .delete(schema.itemBundleComponents)
          .where(
            eq(schema.itemBundleComponents.bundleItemId, bundle.id),
          );

        if (payload.length > 0) {
          await tx.insert(schema.itemBundleComponents).values(
            payload.map((c, idx) => ({
              tenantId: ctx.tenantId,
              bundleItemId: bundle.id,
              componentItemId: c.componentItemId,
              quantity: c.quantity.toString(),
              sortOrder: idx,
            })),
          );
        }

        await recordAuditEvent(tx, {
          kind: "item_bundle.updated",
          summary: `Updated bundle components for ${bundle.name}`,
          refType: "item",
          refId: bundle.id,
          actorUserId: ctx.userId,
          diff: { componentCount: payload.length, components: payload },
        });

        const components = await loadBundleComponents(tx, ctx.tenantId, bundle.id);
        return { components };
      });

      if ("error" in result) {
        const code = result.error as string;
        const msgs: Record<string, string> = {
          NOT_FOUND: "Item not found.",
          NOT_A_BUNDLE: "Only bundle items can have components.",
          SELF_REFERENCE: "A bundle can't list itself as a component.",
          COMPONENT_NOT_FOUND: "One or more components weren't found.",
          NESTED_BUNDLE:
            "A bundle can't contain another bundle. Flatten the nested bundle into individual items.",
        };
        const status = code === "NOT_FOUND" ? 404 : 400;
        return reply
          .status(status)
          .send({ error: { code, message: msgs[code] ?? code, ...result } });
      }
      return reply.send(result);
    },
  );
};

// Shared loader — used by GET /:id (inlines) and GET /:id/components
// (standalone endpoint). Joins against items to return the friendly
// name + SKU so the UI doesn't need a second round-trip.
async function loadBundleComponents(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: string,
  bundleItemId: string,
): Promise<
  Array<{
    id: string;
    componentItemId: string;
    componentName: string;
    componentSku: string | null;
    quantity: number;
    sortOrder: number;
  }>
> {
  const rows = await tx
    .select({
      id: schema.itemBundleComponents.id,
      componentItemId: schema.itemBundleComponents.componentItemId,
      componentName: schema.items.name,
      componentSku: schema.items.sku,
      quantity: schema.itemBundleComponents.quantity,
      sortOrder: schema.itemBundleComponents.sortOrder,
      componentDeletedAt: schema.items.deletedAt,
    })
    .from(schema.itemBundleComponents)
    .innerJoin(
      schema.items,
      eq(schema.items.id, schema.itemBundleComponents.componentItemId),
    )
    .where(
      and(
        eq(schema.itemBundleComponents.tenantId, tenantId),
        eq(schema.itemBundleComponents.bundleItemId, bundleItemId),
        // Filter out components whose item has been soft-deleted —
        // they shouldn't appear in the bundle UI and they're excluded
        // from the sale-time explosion too.
        isNull(schema.items.deletedAt),
      ),
    )
    .orderBy(asc(schema.itemBundleComponents.sortOrder));

  return rows.map((r) => ({
    id: r.id,
    componentItemId: r.componentItemId,
    componentName: r.componentName,
    componentSku: r.componentSku,
    quantity: Number(r.quantity),
    sortOrder: r.sortOrder,
  }));
}
