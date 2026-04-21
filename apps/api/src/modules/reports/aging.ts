import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { withTenant } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";

// Aging buckets match the dashboard — same boundaries so counts reconcile.
export type AgingBucketLabel = "current" | "0-30" | "30-60" | "60-90" | "90+";

export interface AgingDetailRow {
  id: string;
  docNumber: string | null;
  partyId: string;
  partyName: string;
  issueDate: string;
  dueDate: string;
  daysOverdue: number;
  bucket: AgingBucketLabel;
  totalCents: number;
  amountPaidCents: number;
  balanceDueCents: number;
  reference: string | null;
}

export interface AgingDetailGroup {
  partyId: string;
  partyName: string;
  totalBalanceCents: number;
  rows: AgingDetailRow[];
  bucketTotals: Record<AgingBucketLabel, number>;
}

interface AgingDetailResponse {
  groups: AgingDetailGroup[];
  grandTotalCents: number;
  bucketTotals: Record<AgingBucketLabel, number>;
  asOf: string;
}

function emptyBuckets(): Record<AgingBucketLabel, number> {
  return { current: 0, "0-30": 0, "30-60": 0, "60-90": 0, "90+": 0 };
}

export const arAgingRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx): Promise<AgingDetailResponse> => {
      const rows = (await tx.execute(sql`
        SELECT i.id,
               i.invoice_number,
               i.customer_id AS party_id,
               c.name         AS party_name,
               i.issue_date::text AS issue_date,
               i.due_date::text   AS due_date,
               GREATEST(0, (CURRENT_DATE - i.due_date))::int AS days_overdue,
               i.total_cents,
               i.amount_paid_cents,
               i.balance_due_cents,
               i.reference,
               CASE
                 WHEN i.due_date >= CURRENT_DATE            THEN 'current'
                 WHEN CURRENT_DATE - i.due_date BETWEEN 1 AND 30  THEN '0-30'
                 WHEN CURRENT_DATE - i.due_date BETWEEN 31 AND 60 THEN '30-60'
                 WHEN CURRENT_DATE - i.due_date BETWEEN 61 AND 90 THEN '60-90'
                 ELSE '90+'
               END AS bucket
          FROM invoices i
          INNER JOIN customers c ON c.id = i.customer_id
         WHERE i.tenant_id = current_tenant_id()
           AND i.deleted_at IS NULL
           AND i.status IN ('posted', 'partially_paid')
           AND i.balance_due_cents > 0
         ORDER BY c.name ASC, i.due_date ASC
      `)) as unknown as Array<{
        id: string;
        invoice_number: string | null;
        party_id: string;
        party_name: string;
        issue_date: string;
        due_date: string;
        days_overdue: number;
        total_cents: number | string;
        amount_paid_cents: number | string;
        balance_due_cents: number | string;
        reference: string | null;
        bucket: AgingBucketLabel;
      }>;

      const groupMap = new Map<string, AgingDetailGroup>();
      const bucketTotals = emptyBuckets();
      let grandTotal = 0;

      for (const r of rows) {
        const balance = Number(r.balance_due_cents);
        grandTotal += balance;
        bucketTotals[r.bucket] += balance;

        let group = groupMap.get(r.party_id);
        if (!group) {
          group = {
            partyId: r.party_id,
            partyName: r.party_name,
            totalBalanceCents: 0,
            rows: [],
            bucketTotals: emptyBuckets(),
          };
          groupMap.set(r.party_id, group);
        }
        group.totalBalanceCents += balance;
        group.bucketTotals[r.bucket] += balance;
        group.rows.push({
          id: r.id,
          docNumber: r.invoice_number,
          partyId: r.party_id,
          partyName: r.party_name,
          issueDate: r.issue_date,
          dueDate: r.due_date,
          daysOverdue: r.days_overdue,
          bucket: r.bucket,
          totalCents: Number(r.total_cents),
          amountPaidCents: Number(r.amount_paid_cents),
          balanceDueCents: balance,
          reference: r.reference,
        });
      }

      const groups = Array.from(groupMap.values()).sort(
        (a, b) => b.totalBalanceCents - a.totalBalanceCents,
      );

      return {
        groups,
        grandTotalCents: grandTotal,
        bucketTotals,
        asOf: new Date().toISOString().slice(0, 10),
      };
    });

    return reply.send(data);
  });
};

export const apAgingRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const data = await withTenant(ctx.tenantId, async (tx): Promise<AgingDetailResponse> => {
      const rows = (await tx.execute(sql`
        SELECT b.id,
               COALESCE(b.supplier_bill_number, b.internal_reference) AS doc_number,
               b.supplier_id AS party_id,
               s.name         AS party_name,
               b.bill_date::text AS issue_date,
               b.due_date::text  AS due_date,
               GREATEST(0, (CURRENT_DATE - b.due_date))::int AS days_overdue,
               b.total_cents,
               b.amount_paid_cents,
               b.balance_due_cents,
               b.supplier_bill_number AS reference,
               CASE
                 WHEN b.due_date >= CURRENT_DATE            THEN 'current'
                 WHEN CURRENT_DATE - b.due_date BETWEEN 1 AND 30  THEN '0-30'
                 WHEN CURRENT_DATE - b.due_date BETWEEN 31 AND 60 THEN '30-60'
                 WHEN CURRENT_DATE - b.due_date BETWEEN 61 AND 90 THEN '60-90'
                 ELSE '90+'
               END AS bucket
          FROM bills b
          INNER JOIN suppliers s ON s.id = b.supplier_id
         WHERE b.tenant_id = current_tenant_id()
           AND b.deleted_at IS NULL
           AND b.status IN ('posted', 'partially_paid')
           AND b.balance_due_cents > 0
         ORDER BY s.name ASC, b.due_date ASC
      `)) as unknown as Array<{
        id: string;
        doc_number: string | null;
        party_id: string;
        party_name: string;
        issue_date: string;
        due_date: string;
        days_overdue: number;
        total_cents: number | string;
        amount_paid_cents: number | string;
        balance_due_cents: number | string;
        reference: string | null;
        bucket: AgingBucketLabel;
      }>;

      const groupMap = new Map<string, AgingDetailGroup>();
      const bucketTotals = emptyBuckets();
      let grandTotal = 0;

      for (const r of rows) {
        const balance = Number(r.balance_due_cents);
        grandTotal += balance;
        bucketTotals[r.bucket] += balance;

        let group = groupMap.get(r.party_id);
        if (!group) {
          group = {
            partyId: r.party_id,
            partyName: r.party_name,
            totalBalanceCents: 0,
            rows: [],
            bucketTotals: emptyBuckets(),
          };
          groupMap.set(r.party_id, group);
        }
        group.totalBalanceCents += balance;
        group.bucketTotals[r.bucket] += balance;
        group.rows.push({
          id: r.id,
          docNumber: r.doc_number,
          partyId: r.party_id,
          partyName: r.party_name,
          issueDate: r.issue_date,
          dueDate: r.due_date,
          daysOverdue: r.days_overdue,
          bucket: r.bucket,
          totalCents: Number(r.total_cents),
          amountPaidCents: Number(r.amount_paid_cents),
          balanceDueCents: balance,
          reference: r.reference,
        });
      }

      const groups = Array.from(groupMap.values()).sort(
        (a, b) => b.totalBalanceCents - a.totalBalanceCents,
      );

      return {
        groups,
        grandTotalCents: grandTotal,
        bucketTotals,
        asOf: new Date().toISOString().slice(0, 10),
      };
    });

    return reply.send(data);
  });
};
