import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { withTenant } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";

// GET /reports/bad-debts — invoices written off with principal/VAT relief
// and running totals. Only shows status='written_off' — reversed write-offs
// automatically fall off because the status flips back to posted/partially_paid.

interface BadDebtRow {
  invoiceId: string;
  invoiceNumber: string | null;
  issueDate: string;
  writtenOffAt: string;
  customerId: string;
  customerName: string;
  writeoffReason: string | null;
  principalCents: number;
  vatReliefCents: number;
  totalCents: number;
  writeoffJournalEntryId: string | null;
}

interface BadDebtReport {
  writeOffs: BadDebtRow[];
  totals: {
    principalCents: number;
    vatReliefCents: number;
    totalCents: number;
    count: number;
  };
}

export const badDebtsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx): Promise<BadDebtReport> => {
      const rows = (await tx.execute(sql`
        SELECT i.id                             AS invoice_id,
               i.invoice_number,
               i.issue_date::text               AS issue_date,
               i.written_off_at,
               i.customer_id,
               c.name                           AS customer_name,
               i.writeoff_reason,
               i.writeoff_principal_cents       AS principal_cents,
               i.writeoff_vat_relief_cents      AS vat_relief_cents,
               i.total_cents,
               i.writeoff_journal_entry_id
          FROM invoices i
          INNER JOIN customers c ON c.id = i.customer_id
         WHERE i.tenant_id = current_tenant_id()
           AND i.status = 'written_off'
           AND i.deleted_at IS NULL
         ORDER BY i.written_off_at DESC
         LIMIT 500
      `)) as unknown as Array<{
        invoice_id: string;
        invoice_number: string | null;
        issue_date: string;
        written_off_at: string | null;
        customer_id: string;
        customer_name: string;
        writeoff_reason: string | null;
        principal_cents: number | string;
        vat_relief_cents: number | string;
        total_cents: number | string;
        writeoff_journal_entry_id: string | null;
      }>;

      const writeOffs: BadDebtRow[] = rows.map((r) => ({
        invoiceId: r.invoice_id,
        invoiceNumber: r.invoice_number,
        issueDate: r.issue_date,
        writtenOffAt: r.written_off_at ?? "",
        customerId: r.customer_id,
        customerName: r.customer_name,
        writeoffReason: r.writeoff_reason,
        principalCents: Number(r.principal_cents),
        vatReliefCents: Number(r.vat_relief_cents),
        totalCents: Number(r.total_cents),
        writeoffJournalEntryId: r.writeoff_journal_entry_id,
      }));

      return {
        writeOffs,
        totals: {
          principalCents: writeOffs.reduce((s, w) => s + w.principalCents, 0),
          vatReliefCents: writeOffs.reduce((s, w) => s + w.vatReliefCents, 0),
          totalCents: writeOffs.reduce((s, w) => s + w.principalCents + w.vatReliefCents, 0),
          count: writeOffs.length,
        },
      };
    });

    return reply.send(data);
  });
};
