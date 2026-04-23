import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc, ilike } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { requirePermission } from "../../lib/permissions.js";

const CreateSchema = z.object({
  sku: z.string().trim().max(64).optional().or(z.literal("")),
  barcode: z.string().trim().max(64).optional().or(z.literal("")),
  name: z.string().trim().min(1).max(255),
  description: z.string().optional().or(z.literal("")),
  itemType: z.enum(["product", "service", "bundle"]).default("product"),
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

  fastify.post("/", async (req, reply) => {
    const ctx = await requirePermission(req, reply, "inventory.manage");
    if (!ctx) return;

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const data = parsed.data;

    // Services don't track inventory
    const trackInventory = data.itemType === "service" ? false : data.trackInventory;

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
};
