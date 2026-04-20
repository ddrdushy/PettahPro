import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc, sql, ilike } from "drizzle-orm";
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
  addressLine2: z.string().trim().max(255).optional().or(z.literal("")),
  city: z.string().trim().max(128).optional().or(z.literal("")),
  postalCode: z.string().trim().max(16).optional().or(z.literal("")),
  country: z.string().length(2).optional().default("LK"),
  tin: z.string().trim().max(32).optional().or(z.literal("")),
  vatNo: z.string().trim().max(32).optional().or(z.literal("")),
  brNo: z.string().trim().max(32).optional().or(z.literal("")),
  paymentTermsDays: z.number().int().min(0).max(365).optional().default(0),
  creditLimitCents: z.number().int().min(0).optional().default(0),
  currency: z.string().length(3).optional().default("LKR"),
  notes: z.string().optional().or(z.literal("")),
});

function emptyToNull<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = { ...input };
  for (const k of Object.keys(out)) {
    if (out[k] === "") out[k] = null;
  }
  return out as T;
}

export const customersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const q = typeof req.query === "object" && req.query
      ? (req.query as { q?: string }).q?.trim()
      : undefined;

    const rows = await withTenant(ctx.tenantId, async (tx) => {
      const whereClauses = [
        eq(schema.customers.tenantId, ctx.tenantId),
        isNull(schema.customers.deletedAt),
      ];
      if (q) whereClauses.push(ilike(schema.customers.name, `%${q}%`));

      return tx
        .select()
        .from(schema.customers)
        .where(and(...whereClauses))
        .orderBy(desc(schema.customers.createdAt))
        .limit(200);
    });

    return reply.send({ customers: rows });
  });

  fastify.post("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const data = emptyToNull(parsed.data);

    try {
      const customer = await withTenant(ctx.tenantId, async (tx) => {
        const [c] = await tx
          .insert(schema.customers)
          .values({
            tenantId: ctx.tenantId,
            name: data.name,
            legalName: data.legalName ?? null,
            code: data.code ?? null,
            email: data.email ?? null,
            phone: data.phone ?? null,
            whatsapp: data.whatsapp ?? null,
            addressLine1: data.addressLine1 ?? null,
            addressLine2: data.addressLine2 ?? null,
            city: data.city ?? null,
            postalCode: data.postalCode ?? null,
            country: data.country ?? "LK",
            tin: data.tin ?? null,
            vatNo: data.vatNo ?? null,
            brNo: data.brNo ?? null,
            paymentTermsDays: data.paymentTermsDays ?? 0,
            creditLimitCents: data.creditLimitCents ?? 0,
            currency: data.currency ?? "LKR",
            notes: data.notes ?? null,
          })
          .returning();
        return c;
      });
      return reply.status(201).send({ customer });
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (msg.includes("customers_tenant_code_unique")) {
        return reply.status(409).send({ error: { code: "DUPLICATE_CODE", message: "A customer with this code already exists." } });
      }
      throw err;
    }
  });
};
