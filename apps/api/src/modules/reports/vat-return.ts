import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";

const QuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

interface OutputRow {
  invoiceId: string;
  invoiceNumber: string | null;
  issueDate: string;
  customerId: string;
  customerName: string;
  customerVatNo: string | null;
  taxableCents: number;
  vatCents: number;
  totalCents: number;
}

interface InputRow {
  billId: string;
  internalReference: string | null;
  supplierBillNumber: string | null;
  billDate: string;
  supplierId: string;
  supplierName: string;
  supplierVatNo: string | null;
  taxableCents: number;
  vatCents: number;
  totalCents: number;
}

interface VatReturnPayload {
  asOfFrom: string;
  asOfTo: string;

  // --- Sales side (output) ---
  outputSummary: {
    standardRatedTaxableCents: number;   // 18% base
    standardRatedVatCents: number;       // 18% tax
    zeroRatedTaxableCents: number;       // exports, etc.
    exemptTaxableCents: number;          // exempt supplies (no VAT claimable)
    totalTaxableCents: number;
    totalVatCents: number;
    totalInvoices: number;
  };

  // --- Purchase side (input) ---
  inputSummary: {
    standardRatedTaxableCents: number;
    standardRatedVatCents: number;
    totalBills: number;
  };

  // --- Net payable to IRD ---
  netVatPayableCents: number;             // output - input (positive = we owe IRD)

  outputRegister: OutputRow[];
  inputRegister: InputRow[];
}

export const vatReturnRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }
    const { from, to } = parsed.data;

    const data = await withTenant(ctx.tenantId, async (tx): Promise<VatReturnPayload> => {
      // -- Output (sales) summary: bucket invoice_lines by tax_code.tax_kind
      //    Only posted / partially-paid / paid invoices count — draft and void don't.
      const [outSummary] = (await tx.execute(sql`
        WITH lines AS (
          SELECT il.line_subtotal_cents - il.discount_cents AS taxable_cents,
                 il.tax_cents,
                 COALESCE(tc.tax_kind, 'none') AS tax_kind
          FROM invoice_lines il
          JOIN invoices inv
            ON inv.id = il.invoice_id
           AND inv.tenant_id = il.tenant_id
          LEFT JOIN tax_codes tc
            ON tc.id = il.tax_code_id
           AND tc.tenant_id = il.tenant_id
          WHERE il.tenant_id = current_tenant_id()
            AND inv.deleted_at IS NULL
            AND inv.status IN ('posted','partially_paid','paid')
            AND inv.issue_date BETWEEN ${from}::date AND ${to}::date
        )
        SELECT
          COALESCE(SUM(taxable_cents) FILTER (WHERE tax_kind = 'vat'), 0)::bigint    AS std_taxable,
          COALESCE(SUM(tax_cents)     FILTER (WHERE tax_kind = 'vat'), 0)::bigint    AS std_vat,
          COALESCE(SUM(taxable_cents) FILTER (WHERE tax_kind = 'zero'), 0)::bigint   AS zero_taxable,
          COALESCE(SUM(taxable_cents) FILTER (WHERE tax_kind = 'exempt'), 0)::bigint AS exempt_taxable
      `)) as unknown as Array<{
        std_taxable: number | string;
        std_vat: number | string;
        zero_taxable: number | string;
        exempt_taxable: number | string;
      }>;

      // -- Output register: one row per invoice with VAT exposure
      const outputRegister = (await tx.execute(sql`
        SELECT inv.id, inv.invoice_number,
               inv.issue_date::text AS issue_date,
               inv.customer_id,
               c.name AS customer_name,
               c.vat_no AS customer_vat_no,
               COALESCE(SUM(il.line_subtotal_cents - il.discount_cents)
                        FILTER (WHERE tc.tax_kind = 'vat'), 0)::bigint AS taxable_cents,
               COALESCE(SUM(il.tax_cents)
                        FILTER (WHERE tc.tax_kind = 'vat'), 0)::bigint AS vat_cents,
               inv.total_cents
        FROM invoices inv
        JOIN customers c
          ON c.id = inv.customer_id
         AND c.tenant_id = inv.tenant_id
        JOIN invoice_lines il
          ON il.invoice_id = inv.id
         AND il.tenant_id = inv.tenant_id
        LEFT JOIN tax_codes tc
          ON tc.id = il.tax_code_id
         AND tc.tenant_id = il.tenant_id
        WHERE inv.tenant_id = current_tenant_id()
          AND inv.deleted_at IS NULL
          AND inv.status IN ('posted','partially_paid','paid')
          AND inv.issue_date BETWEEN ${from}::date AND ${to}::date
        GROUP BY inv.id, c.id
        HAVING COALESCE(SUM(il.tax_cents)
                        FILTER (WHERE tc.tax_kind = 'vat'), 0) > 0
        ORDER BY inv.issue_date ASC, inv.invoice_number ASC
      `)) as unknown as Array<{
        id: string;
        invoice_number: string | null;
        issue_date: string;
        customer_id: string;
        customer_name: string;
        customer_vat_no: string | null;
        taxable_cents: number | string;
        vat_cents: number | string;
        total_cents: number | string;
      }>;

      // -- Input summary
      const [inSummary] = (await tx.execute(sql`
        SELECT
          COALESCE(SUM(bl.line_subtotal_cents - bl.discount_cents)
                   FILTER (WHERE tc.tax_kind = 'vat'), 0)::bigint AS std_taxable,
          COALESCE(SUM(bl.tax_cents)
                   FILTER (WHERE tc.tax_kind = 'vat'), 0)::bigint AS std_vat
        FROM bill_lines bl
        JOIN bills b
          ON b.id = bl.bill_id
         AND b.tenant_id = bl.tenant_id
        LEFT JOIN tax_codes tc
          ON tc.id = bl.tax_code_id
         AND tc.tenant_id = bl.tenant_id
        WHERE bl.tenant_id = current_tenant_id()
          AND b.deleted_at IS NULL
          AND b.status IN ('posted','partially_paid','paid')
          AND b.bill_date BETWEEN ${from}::date AND ${to}::date
      `)) as unknown as Array<{
        std_taxable: number | string;
        std_vat: number | string;
      }>;

      // -- Input register
      const inputRegister = (await tx.execute(sql`
        SELECT b.id, b.internal_reference, b.supplier_bill_number,
               b.bill_date::text AS bill_date,
               b.supplier_id,
               s.name AS supplier_name,
               s.vat_no AS supplier_vat_no,
               COALESCE(SUM(bl.line_subtotal_cents - bl.discount_cents)
                        FILTER (WHERE tc.tax_kind = 'vat'), 0)::bigint AS taxable_cents,
               COALESCE(SUM(bl.tax_cents)
                        FILTER (WHERE tc.tax_kind = 'vat'), 0)::bigint AS vat_cents,
               b.total_cents
        FROM bills b
        JOIN suppliers s
          ON s.id = b.supplier_id
         AND s.tenant_id = b.tenant_id
        JOIN bill_lines bl
          ON bl.bill_id = b.id
         AND bl.tenant_id = b.tenant_id
        LEFT JOIN tax_codes tc
          ON tc.id = bl.tax_code_id
         AND tc.tenant_id = bl.tenant_id
        WHERE b.tenant_id = current_tenant_id()
          AND b.deleted_at IS NULL
          AND b.status IN ('posted','partially_paid','paid')
          AND b.bill_date BETWEEN ${from}::date AND ${to}::date
        GROUP BY b.id, s.id
        HAVING COALESCE(SUM(bl.tax_cents)
                        FILTER (WHERE tc.tax_kind = 'vat'), 0) > 0
        ORDER BY b.bill_date ASC, b.supplier_bill_number ASC NULLS LAST
      `)) as unknown as Array<{
        id: string;
        internal_reference: string | null;
        supplier_bill_number: string | null;
        bill_date: string;
        supplier_id: string;
        supplier_name: string;
        supplier_vat_no: string | null;
        taxable_cents: number | string;
        vat_cents: number | string;
        total_cents: number | string;
      }>;

      const stdOutTaxable = Number(outSummary?.std_taxable ?? 0);
      const stdOutVat = Number(outSummary?.std_vat ?? 0);
      const zeroTaxable = Number(outSummary?.zero_taxable ?? 0);
      const exemptTaxable = Number(outSummary?.exempt_taxable ?? 0);
      const stdInTaxable = Number(inSummary?.std_taxable ?? 0);
      const stdInVat = Number(inSummary?.std_vat ?? 0);

      return {
        asOfFrom: from,
        asOfTo: to,
        outputSummary: {
          standardRatedTaxableCents: stdOutTaxable,
          standardRatedVatCents: stdOutVat,
          zeroRatedTaxableCents: zeroTaxable,
          exemptTaxableCents: exemptTaxable,
          totalTaxableCents: stdOutTaxable + zeroTaxable + exemptTaxable,
          totalVatCents: stdOutVat,
          totalInvoices: outputRegister.length,
        },
        inputSummary: {
          standardRatedTaxableCents: stdInTaxable,
          standardRatedVatCents: stdInVat,
          totalBills: inputRegister.length,
        },
        netVatPayableCents: stdOutVat - stdInVat,
        outputRegister: outputRegister.map((r) => ({
          invoiceId: r.id,
          invoiceNumber: r.invoice_number,
          issueDate: r.issue_date,
          customerId: r.customer_id,
          customerName: r.customer_name,
          customerVatNo: r.customer_vat_no,
          taxableCents: Number(r.taxable_cents),
          vatCents: Number(r.vat_cents),
          totalCents: Number(r.total_cents),
        })),
        inputRegister: inputRegister.map((r) => ({
          billId: r.id,
          internalReference: r.internal_reference,
          supplierBillNumber: r.supplier_bill_number,
          billDate: r.bill_date,
          supplierId: r.supplier_id,
          supplierName: r.supplier_name,
          supplierVatNo: r.supplier_vat_no,
          taxableCents: Number(r.taxable_cents),
          vatCents: Number(r.vat_cents),
          totalCents: Number(r.total_cents),
        })),
      };
    });

    return reply.send(data);
  });
};
