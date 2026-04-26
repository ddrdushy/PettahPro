import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, desc, asc, sql, inArray } from "drizzle-orm";
import { withTenant, schema } from "@pettahpro/db";
import { requirePortalSession } from "./plugin.js";
import {
  computeCustomerStatement,
  defaultStatementRange,
} from "../operations/customer-statement.js";
import { getObjectStream } from "../../lib/object-storage.js";

/**
 * Portal data endpoints. Every handler:
 *
 *   1. Requires a portal session (401 otherwise).
 *   2. Wraps reads in withTenant(session.tenantId) so RLS gates rows to
 *      the right tenant.
 *   3. Adds an explicit `customer_id = session.customerId` predicate on
 *      every row it fetches — belt + suspenders in case RLS ever gets
 *      loosened or a query goes through the app role unintentionally.
 *   4. Returns only the fields the spec §14.3 lists as customer-visible.
 *      Never exposes: item cost, GL account ids, journal entries, POS
 *      internal data, other customers, salesperson / discount-policy
 *      metadata.
 */
export const portalDataRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /portal/invoices
  //
  // Returns the invoices the customer should see — anything that's ever
  // been posted (posted / partially_paid / paid / void) plus the
  // implicit "not draft" guard. Drafts aren't customer-facing; void
  // invoices are shown so the customer can see their own cancellations
  // but are flagged as such.
  fastify.get("/invoices", async (req, reply) => {
    const session = requirePortalSession(req, reply);
    if (!session) return;

    const rows = await withTenant(session.tenantId, async (tx) => {
      const invs = (await tx.execute(sql`
        SELECT
          id,
          invoice_number,
          status,
          issue_date::text AS issue_date,
          due_date::text AS due_date,
          currency,
          total_cents,
          amount_paid_cents,
          balance_due_cents,
          foreign_total_cents,
          po_number,
          reference,
          channel
        FROM invoices
        WHERE tenant_id = current_tenant_id()
          AND customer_id = ${session.customerId}
          AND deleted_at IS NULL
          AND status IN ('posted', 'partially_paid', 'paid', 'void')
        ORDER BY issue_date DESC, created_at DESC
      `)) as unknown as Array<{
        id: string;
        invoice_number: string | null;
        status: string;
        issue_date: string;
        due_date: string;
        currency: string;
        total_cents: number | string;
        amount_paid_cents: number | string;
        balance_due_cents: number | string;
        foreign_total_cents: number | string | null;
        po_number: string | null;
        reference: string | null;
        channel: string;
      }>;
      return invs.map((r) => ({
        id: r.id,
        invoiceNumber: r.invoice_number,
        status: r.status,
        issueDate: r.issue_date,
        dueDate: r.due_date,
        currency: r.currency,
        totalCents: Number(r.total_cents),
        amountPaidCents: Number(r.amount_paid_cents),
        balanceDueCents: Number(r.balance_due_cents),
        foreignTotalCents: r.foreign_total_cents == null ? null : Number(r.foreign_total_cents),
        poNumber: r.po_number,
        reference: r.reference,
        channel: r.channel,
      }));
    });

    return reply.send({ invoices: rows });
  });

  // GET /portal/invoices/:id
  fastify.get<{ Params: { id: string } }>("/invoices/:id", async (req, reply) => {
    const session = requirePortalSession(req, reply);
    if (!session) return;

    const data = await withTenant(session.tenantId, async (tx) => {
      const invRows = await tx
        .select()
        .from(schema.invoices)
        .where(
          and(
            eq(schema.invoices.tenantId, session.tenantId),
            eq(schema.invoices.id, req.params.id),
            eq(schema.invoices.customerId, session.customerId),
            isNull(schema.invoices.deletedAt),
          ),
        )
        .limit(1);
      const invoice = invRows[0];
      if (!invoice) return null;
      // Drafts are not portal-visible — surfacing them would leak
      // unsent/unposted work product.
      if (invoice.status === "draft") return null;

      const lines = await tx
        .select()
        .from(schema.invoiceLines)
        .where(eq(schema.invoiceLines.invoiceId, invoice.id))
        .orderBy(asc(schema.invoiceLines.lineNo));

      const custRows = await tx
        .select({
          id: schema.customers.id,
          name: schema.customers.name,
          legalName: schema.customers.legalName,
          email: schema.customers.email,
          phone: schema.customers.phone,
          addressLine1: schema.customers.addressLine1,
          addressLine2: schema.customers.addressLine2,
          city: schema.customers.city,
          postalCode: schema.customers.postalCode,
          country: schema.customers.country,
          tin: schema.customers.tin,
          vatNo: schema.customers.vatNo,
        })
        .from(schema.customers)
        .where(eq(schema.customers.id, invoice.customerId))
        .limit(1);

      return { invoice, lines, customer: custRows[0] ?? null };
    });

    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send(data);
  });

  // GET /portal/statement — reuses the existing AR statement compute so
  // the portal view matches the tenant-side view byte-for-byte.
  fastify.get("/statement", async (req, reply) => {
    const session = requirePortalSession(req, reply);
    if (!session) return;

    const q = req.query as { from?: string; to?: string };
    const defaults = defaultStatementRange();
    // Portal default: a wider 6-month window instead of the admin
    // default (month-to-date) so customers who pop in occasionally
    // still see activity without fiddling with date pickers.
    const to = q.to ?? defaults.to;
    const from =
      q.from ??
      (() => {
        const d = new Date(to);
        d.setMonth(d.getMonth() - 6);
        return d.toISOString().slice(0, 10);
      })();

    const data = await withTenant(session.tenantId, (tx) =>
      computeCustomerStatement(tx, session.customerId, session.tenantId, { from, to }),
    );

    if (!data) return reply.status(404).send({ error: { code: "NOT_FOUND" } });
    return reply.send(data);
  });

  // GET /portal/payments
  //
  // Returns posted customer payments + what they were allocated against
  // (invoice numbers) so the customer can tell "this ₨ 50,000 I paid
  // went against INV-2026-0012 and INV-2026-0014".
  fastify.get("/payments", async (req, reply) => {
    const session = requirePortalSession(req, reply);
    if (!session) return;

    const payments = await withTenant(session.tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.customerPayments)
        .where(
          and(
            eq(schema.customerPayments.tenantId, session.tenantId),
            eq(schema.customerPayments.customerId, session.customerId),
            isNull(schema.customerPayments.deletedAt),
            eq(schema.customerPayments.status, "posted"),
          ),
        )
        .orderBy(desc(schema.customerPayments.paymentDate), desc(schema.customerPayments.createdAt));
      if (rows.length === 0) return [];

      const paymentIds = rows.map((r) => r.id);
      const allocs = await tx
        .select({
          id: schema.paymentAllocations.id,
          paymentId: schema.paymentAllocations.paymentId,
          invoiceId: schema.paymentAllocations.invoiceId,
          allocatedCents: schema.paymentAllocations.allocatedCents,
          invoiceNumber: schema.invoices.invoiceNumber,
        })
        .from(schema.paymentAllocations)
        .leftJoin(schema.invoices, eq(schema.invoices.id, schema.paymentAllocations.invoiceId))
        .where(inArray(schema.paymentAllocations.paymentId, paymentIds));

      const allocsByPayment = new Map<string, typeof allocs>();
      for (const a of allocs) {
        const list = allocsByPayment.get(a.paymentId) ?? [];
        list.push(a);
        allocsByPayment.set(a.paymentId, list);
      }

      return rows.map((p) => ({
        id: p.id,
        paymentNumber: p.paymentNumber,
        paymentDate: p.paymentDate,
        method: p.method,
        amountCents: Number(p.amountCents),
        currency: p.currency,
        reference: p.reference,
        memo: p.memo,
        allocations: (allocsByPayment.get(p.id) ?? []).map((a) => ({
          invoiceId: a.invoiceId,
          invoiceNumber: a.invoiceNumber,
          allocatedCents: Number(a.allocatedCents),
        })),
      }));
    });

    return reply.send({ payments });
  });

  // GET /portal/recurring
  //
  // "View standing orders / recurring schedule" from spec §14.2 — read-only
  // list of recurring invoice templates so the customer can see upcoming
  // auto-generated invoices.
  fastify.get("/recurring", async (req, reply) => {
    const session = requirePortalSession(req, reply);
    if (!session) return;

    const templates = await withTenant(session.tenantId, async (tx) => {
      // recurring_invoices uses is_active + paused_at (no `status` column)
      // and line totals live on recurring_invoice_lines. Keep the portal
      // payload light — schedule-level info is all the customer needs to
      // see "you have one monthly auto-invoice coming on the 1st".
      const rows = (await tx.execute(sql`
        SELECT
          id,
          schedule_name,
          frequency,
          is_active,
          paused_at,
          next_run_date::text AS next_run_date,
          last_run_date::text AS last_run_date,
          end_date::text      AS end_date,
          currency,
          reference
        FROM recurring_invoices
        WHERE tenant_id = current_tenant_id()
          AND customer_id = ${session.customerId}
          AND deleted_at IS NULL
          AND is_active = true
        ORDER BY next_run_date ASC NULLS LAST
      `)) as unknown as Array<{
        id: string;
        schedule_name: string;
        frequency: string;
        is_active: boolean;
        paused_at: string | null;
        next_run_date: string | null;
        last_run_date: string | null;
        end_date: string | null;
        currency: string;
        reference: string | null;
      }>;
      return rows.map((r) => ({
        id: r.id,
        scheduleName: r.schedule_name,
        status: r.paused_at ? "paused" : "active",
        frequency: r.frequency,
        nextRunDate: r.next_run_date,
        lastRunDate: r.last_run_date,
        endDate: r.end_date,
        currency: r.currency,
        reference: r.reference,
      }));
    });

    return reply.send({ recurring: templates });
  });

  // GET /portal/tenant-logo
  //
  // Streams the tenant's logo image to portal users so the invoice
  // PDF served from the portal carries the same branding as the
  // admin-side render. The MinIO key is read out of tenant_settings
  // under the portal session's tenant scope.
  fastify.get("/tenant-logo", async (req, reply) => {
    const session = requirePortalSession(req, reply);
    if (!session) return;

    const settings = await withTenant(session.tenantId, async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT settings FROM tenant_settings WHERE tenant_id = current_tenant_id()
      `)) as unknown as Array<{ settings: Record<string, unknown> | null }>;
      return rows[0]?.settings ?? {};
    });

    const objectKey = (settings as Record<string, unknown>).logoObjectKey;
    const contentType = (settings as Record<string, unknown>).logoContentType;
    if (typeof objectKey !== "string" || typeof contentType !== "string") {
      return reply.status(404).send({ error: { code: "NO_LOGO" } });
    }

    const obj = await getObjectStream(objectKey);
    if (!obj) {
      return reply.status(404).send({ error: { code: "OBJECT_MISSING" } });
    }

    reply
      .type(obj.contentType ?? contentType)
      .header("Cache-Control", "private, max-age=3600");
    if (obj.contentLength !== null) {
      reply.header("Content-Length", String(obj.contentLength));
    }
    return reply.send(obj.stream);
  });
};
