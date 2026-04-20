import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc, ilike } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(255),
  legalName: z.string().trim().max(255).optional().or(z.literal("")),
  code: z.string().trim().max(32).optional().or(z.literal("")),
  email: z.string().email().max(255).optional().or(z.literal("")),
  phone: z.string().trim().max(32).optional().or(z.literal("")),
  whatsapp: z.string().trim().max(32).optional().or(z.literal("")),
  addressLine1: z.string().trim().max(255).optional().or(z.literal("")),
  city: z.string().trim().max(128).optional().or(z.literal("")),
  postalCode: z.string().trim().max(16).optional().or(z.literal("")),
  country: z.string().length(2).optional().default("LK"),
  tin: z.string().trim().max(32).optional().or(z.literal("")),
  vatNo: z.string().trim().max(32).optional().or(z.literal("")),
  brNo: z.string().trim().max(32).optional().or(z.literal("")),
  paymentTermsDays: z.number().int().min(0).max(365).optional().default(0),
  currency: z.string().length(3).optional().default("LKR"),
  defaultWhtTaxCodeId: z.string().uuid().optional(),
  bankName: z.string().trim().max(128).optional().or(z.literal("")),
  bankAccountNo: z.string().trim().max(64).optional().or(z.literal("")),
  bankBranch: z.string().trim().max(128).optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
});

export const suppliersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const q = typeof req.query === "object" && req.query
      ? (req.query as { q?: string }).q?.trim()
      : undefined;

    const rows = await withTenant(ctx.tenantId, async (tx) => {
      const whereClauses = [
        eq(schema.suppliers.tenantId, ctx.tenantId),
        isNull(schema.suppliers.deletedAt),
      ];
      if (q) whereClauses.push(ilike(schema.suppliers.name, `%${q}%`));

      return tx
        .select()
        .from(schema.suppliers)
        .where(and(...whereClauses))
        .orderBy(desc(schema.suppliers.createdAt))
        .limit(200);
    });

    return reply.send({ suppliers: rows });
  });

  fastify.post("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const d = parsed.data;

    try {
      const supplier = await withTenant(ctx.tenantId, async (tx) => {
        const [s] = await tx
          .insert(schema.suppliers)
          .values({
            tenantId: ctx.tenantId,
            name: d.name,
            legalName: d.legalName || null,
            code: d.code || null,
            email: d.email || null,
            phone: d.phone || null,
            whatsapp: d.whatsapp || null,
            addressLine1: d.addressLine1 || null,
            city: d.city || null,
            postalCode: d.postalCode || null,
            country: d.country ?? "LK",
            tin: d.tin || null,
            vatNo: d.vatNo || null,
            brNo: d.brNo || null,
            paymentTermsDays: d.paymentTermsDays ?? 0,
            currency: d.currency ?? "LKR",
            defaultWhtTaxCodeId: d.defaultWhtTaxCodeId ?? null,
            bankName: d.bankName || null,
            bankAccountNo: d.bankAccountNo || null,
            bankBranch: d.bankBranch || null,
            notes: d.notes || null,
          })
          .returning();
        return s;
      });
      return reply.status(201).send({ supplier });
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (msg.includes("suppliers_tenant_code_unique")) {
        return reply.status(409).send({
          error: { code: "DUPLICATE_CODE", message: "A supplier with this code already exists." },
        });
      }
      throw err;
    }
  });
};
