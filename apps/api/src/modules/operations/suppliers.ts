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

  // GET /suppliers/:id — supplier + KPIs + recent bills + recent payments + aging
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx) => {
      const supRows = await tx
        .select()
        .from(schema.suppliers)
        .where(
          and(
            eq(schema.suppliers.tenantId, ctx.tenantId),
            eq(schema.suppliers.id, req.params.id),
            isNull(schema.suppliers.deletedAt),
          ),
        )
        .limit(1);
      const supplier = supRows[0];
      if (!supplier) return null;

      const [kpis] = (await tx.execute(sql`
        SELECT
          COALESCE(SUM(total_cents) FILTER (WHERE status <> 'draft' AND status <> 'void'), 0)::bigint AS total_billed,
          COALESCE(SUM(amount_paid_cents) FILTER (WHERE status <> 'void'), 0)::bigint AS total_paid,
          COALESCE(SUM(balance_due_cents) FILTER (WHERE status IN ('posted','partially_paid')), 0)::bigint AS balance_due,
          COUNT(*) FILTER (WHERE status IN ('posted','partially_paid'))::int AS open_count,
          COUNT(*) FILTER (WHERE status IN ('posted','partially_paid') AND due_date < current_date)::int AS overdue_count,
          COALESCE(SUM(balance_due_cents) FILTER (WHERE status IN ('posted','partially_paid') AND due_date < current_date), 0)::bigint AS overdue_cents
        FROM bills
        WHERE tenant_id = current_tenant_id()
          AND supplier_id = ${supplier.id}
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
        FROM bills
        WHERE tenant_id = current_tenant_id()
          AND supplier_id = ${supplier.id}
          AND deleted_at IS NULL
          AND status IN ('posted','partially_paid')
        GROUP BY bucket
      `)) as unknown as Array<{
        bucket: "current" | "0-30" | "30-60" | "60-90" | "90+";
        balance_cents: number | string;
        inv_count: number;
      }>;

      const bills = await tx
        .select({
          id: schema.bills.id,
          internalReference: schema.bills.internalReference,
          supplierBillNumber: schema.bills.supplierBillNumber,
          status: schema.bills.status,
          billDate: schema.bills.billDate,
          dueDate: schema.bills.dueDate,
          totalCents: schema.bills.totalCents,
          balanceDueCents: schema.bills.balanceDueCents,
        })
        .from(schema.bills)
        .where(
          and(
            eq(schema.bills.tenantId, ctx.tenantId),
            eq(schema.bills.supplierId, supplier.id),
            isNull(schema.bills.deletedAt),
          ),
        )
        .orderBy(desc(schema.bills.createdAt))
        .limit(50);

      const payments = await tx
        .select({
          id: schema.supplierPayments.id,
          paymentNumber: schema.supplierPayments.paymentNumber,
          paymentDate: schema.supplierPayments.paymentDate,
          method: schema.supplierPayments.method,
          amountCents: schema.supplierPayments.amountCents,
          reference: schema.supplierPayments.reference,
          chequeNumber: schema.supplierPayments.chequeNumber,
          status: schema.supplierPayments.status,
        })
        .from(schema.supplierPayments)
        .where(
          and(
            eq(schema.supplierPayments.tenantId, ctx.tenantId),
            eq(schema.supplierPayments.supplierId, supplier.id),
            isNull(schema.supplierPayments.deletedAt),
          ),
        )
        .orderBy(desc(schema.supplierPayments.createdAt))
        .limit(50);

      const agingMap = new Map(aging.map((r) => [r.bucket, r]));
      const buckets = (["current", "0-30", "30-60", "60-90", "90+"] as const).map((b) => ({
        label: b,
        balanceCents: Number(agingMap.get(b)?.balance_cents ?? 0),
        invoiceCount: agingMap.get(b)?.inv_count ?? 0,
      }));

      return {
        supplier,
        kpis: {
          totalBilledCents: Number(kpis?.total_billed ?? 0),
          totalPaidCents: Number(kpis?.total_paid ?? 0),
          balanceDueCents: Number(kpis?.balance_due ?? 0),
          openCount: Number(kpis?.open_count ?? 0),
          overdueCount: Number(kpis?.overdue_count ?? 0),
          overdueCents: Number(kpis?.overdue_cents ?? 0),
        },
        aging: buckets,
        bills,
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
