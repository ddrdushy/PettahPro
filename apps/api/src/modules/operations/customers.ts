import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc, ilike, sql } from "drizzle-orm";
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

  // GET /customers/:id — single customer + summary + recent docs
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const custRows = await tx
        .select()
        .from(schema.customers)
        .where(
          and(
            eq(schema.customers.tenantId, ctx.tenantId),
            eq(schema.customers.id, req.params.id),
            isNull(schema.customers.deletedAt),
          ),
        )
        .limit(1);
      const customer = custRows[0];
      if (!customer) return null;

      // KPI aggregates
      const [kpis] = (await tx.execute(sql`
        SELECT
          COALESCE(SUM(total_cents) FILTER (WHERE status <> 'draft' AND status <> 'void'), 0)::bigint AS total_billed,
          COALESCE(SUM(amount_paid_cents) FILTER (WHERE status <> 'void'), 0)::bigint AS total_paid,
          COALESCE(SUM(balance_due_cents) FILTER (WHERE status IN ('posted','partially_paid')), 0)::bigint AS balance_due,
          COUNT(*) FILTER (WHERE status IN ('posted','partially_paid'))::int AS open_count,
          COUNT(*) FILTER (WHERE status IN ('posted','partially_paid') AND due_date < current_date)::int AS overdue_count,
          COALESCE(SUM(balance_due_cents) FILTER (WHERE status IN ('posted','partially_paid') AND due_date < current_date), 0)::bigint AS overdue_cents
        FROM invoices
        WHERE tenant_id = current_tenant_id()
          AND customer_id = ${customer.id}
          AND deleted_at IS NULL
      `)) as unknown as Array<{
        total_billed: number | string;
        total_paid: number | string;
        balance_due: number | string;
        open_count: number;
        overdue_count: number;
        overdue_cents: number | string;
      }>;

      const aging = (await tx.execute(sql`
        SELECT
          CASE
            WHEN due_date >= current_date            THEN 'current'
            WHEN current_date - due_date BETWEEN 1 AND 30   THEN '0-30'
            WHEN current_date - due_date BETWEEN 31 AND 60  THEN '30-60'
            WHEN current_date - due_date BETWEEN 61 AND 90  THEN '60-90'
            ELSE '90+'
          END AS bucket,
          COALESCE(SUM(balance_due_cents), 0)::bigint AS balance_cents,
          COUNT(*)::int AS inv_count
        FROM invoices
        WHERE tenant_id = current_tenant_id()
          AND customer_id = ${customer.id}
          AND deleted_at IS NULL
          AND status IN ('posted','partially_paid')
        GROUP BY bucket
      `)) as unknown as Array<{
        bucket: "current" | "0-30" | "30-60" | "60-90" | "90+";
        balance_cents: number | string;
        inv_count: number;
      }>;

      const invoices = await tx
        .select({
          id: schema.invoices.id,
          invoiceNumber: schema.invoices.invoiceNumber,
          status: schema.invoices.status,
          issueDate: schema.invoices.issueDate,
          dueDate: schema.invoices.dueDate,
          totalCents: schema.invoices.totalCents,
          balanceDueCents: schema.invoices.balanceDueCents,
        })
        .from(schema.invoices)
        .where(
          and(
            eq(schema.invoices.tenantId, ctx.tenantId),
            eq(schema.invoices.customerId, customer.id),
            isNull(schema.invoices.deletedAt),
          ),
        )
        .orderBy(desc(schema.invoices.createdAt))
        .limit(50);

      const payments = await tx
        .select({
          id: schema.customerPayments.id,
          paymentNumber: schema.customerPayments.paymentNumber,
          paymentDate: schema.customerPayments.paymentDate,
          method: schema.customerPayments.method,
          amountCents: schema.customerPayments.amountCents,
          reference: schema.customerPayments.reference,
          status: schema.customerPayments.status,
        })
        .from(schema.customerPayments)
        .where(
          and(
            eq(schema.customerPayments.tenantId, ctx.tenantId),
            eq(schema.customerPayments.customerId, customer.id),
            isNull(schema.customerPayments.deletedAt),
          ),
        )
        .orderBy(desc(schema.customerPayments.createdAt))
        .limit(50);

      const agingMap = new Map(aging.map((r) => [r.bucket, r]));
      const buckets = (["current", "0-30", "30-60", "60-90", "90+"] as const).map((b) => ({
        label: b,
        balanceCents: Number(agingMap.get(b)?.balance_cents ?? 0),
        invoiceCount: agingMap.get(b)?.inv_count ?? 0,
      }));

      return {
        customer,
        kpis: {
          totalBilledCents: Number(kpis?.total_billed ?? 0),
          totalPaidCents: Number(kpis?.total_paid ?? 0),
          balanceDueCents: Number(kpis?.balance_due ?? 0),
          openCount: Number(kpis?.open_count ?? 0),
          overdueCount: Number(kpis?.overdue_count ?? 0),
          overdueCents: Number(kpis?.overdue_cents ?? 0),
        },
        aging: buckets,
        invoices,
        payments,
      };
    });

    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send(data);
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
