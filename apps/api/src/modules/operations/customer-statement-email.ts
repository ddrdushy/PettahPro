import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema, type Database } from "@pettahpro/db";
import { requireAuth } from "../../lib/with-tenant.js";
import { sendEmail } from "../../lib/email.js";
import {
  computeCustomerStatement,
  defaultStatementRange,
  type StatementData,
} from "./customer-statement.js";

const SendBodySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toEmail: z.string().email().optional(), // override customer default
  ccEmails: z.array(z.string().email()).optional(),
  subjectOverride: z.string().min(1).max(500).optional(),
  messageNote: z.string().max(2000).optional(),
});

const BatchBodySchema = z.object({
  customerIds: z.array(z.string().uuid()).min(1).max(200),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  messageNote: z.string().max(2000).optional(),
});

export type StatementEmailResult = {
  customerId: string;
  customerName: string;
  status: "sent" | "failed" | "skipped";
  toEmail: string | null;
  error?: string;
  emailLogId?: string;
};

const LKR_FMT = new Intl.NumberFormat("en-LK", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
function fmtMoney(cents: number): string {
  return LKR_FMT.format(cents / 100);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function agingLabel(bucket: string): string {
  switch (bucket) {
    case "current":
      return "Not yet due";
    case "0-30":
      return "1-30 days";
    case "30-60":
      return "31-60 days";
    case "60-90":
      return "61-90 days";
    case "90+":
      return "Over 90 days";
    default:
      return bucket;
  }
}

function renderStatementHtml(opts: {
  data: StatementData;
  tenantName: string;
  messageNote?: string | null;
}): { subject: string; html: string; text: string } {
  const { data, tenantName, messageNote } = opts;
  const { customer, asOfFrom, asOfTo, closingBalanceCents } = data;
  const subject = `Statement of account — ${asOfTo} — ${tenantName}`;

  const agingRows = data.aging
    .filter((b) => b.balanceCents !== 0 || b.invoiceCount > 0)
    .map(
      (b) =>
        `<tr>
           <td style="padding:6px 12px;border-bottom:1px solid #eee">${escapeHtml(agingLabel(b.label))}</td>
           <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right">${escapeHtml(fmtMoney(b.balanceCents))}</td>
         </tr>`,
    )
    .join("");

  const txRows = data.transactions
    .map(
      (t) => `
        <tr>
          <td style="padding:6px 12px;border-bottom:1px solid #f2f2f2;white-space:nowrap">${escapeHtml(t.date)}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #f2f2f2">${escapeHtml(t.kind === "invoice" ? "Invoice" : "Payment")} ${escapeHtml(t.number ?? "")}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #f2f2f2">${escapeHtml(t.description ?? "")}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #f2f2f2;text-align:right">${t.debitCents ? escapeHtml(fmtMoney(t.debitCents)) : ""}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #f2f2f2;text-align:right">${t.creditCents ? escapeHtml(fmtMoney(t.creditCents)) : ""}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #f2f2f2;text-align:right">${escapeHtml(fmtMoney(t.runningBalanceCents))}</td>
        </tr>`,
    )
    .join("");

  const notePara = messageNote
    ? `<p style="margin:16px 0;color:#333;white-space:pre-wrap">${escapeHtml(messageNote)}</p>`
    : "";

  const openingRow =
    data.openingBalanceCents !== 0
      ? `<tr>
           <td style="padding:6px 12px;border-bottom:1px solid #f2f2f2" colspan="5"><em>Opening balance</em></td>
           <td style="padding:6px 12px;border-bottom:1px solid #f2f2f2;text-align:right"><em>${escapeHtml(fmtMoney(data.openingBalanceCents))}</em></td>
         </tr>`
      : "";

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:0;padding:24px;background:#fafafa">
  <div style="max-width:720px;margin:0 auto;background:#fff;border:1px solid #eee;border-radius:8px;padding:24px">
    <h1 style="font-size:20px;margin:0 0 4px 0">Statement of account</h1>
    <div style="color:#666;font-size:13px">${escapeHtml(tenantName)}</div>
    <div style="color:#666;font-size:13px">Period ${escapeHtml(asOfFrom)} → ${escapeHtml(asOfTo)}</div>
    <hr style="border:none;border-top:1px solid #eee;margin:16px 0" />

    <div style="margin-bottom:16px">
      <div style="font-weight:600">${escapeHtml(customer.name)}</div>
      ${customer.email ? `<div style="color:#555;font-size:13px">${escapeHtml(customer.email)}</div>` : ""}
      ${customer.addressLine1 ? `<div style="color:#555;font-size:13px">${escapeHtml(customer.addressLine1)}</div>` : ""}
      ${customer.addressLine2 ? `<div style="color:#555;font-size:13px">${escapeHtml(customer.addressLine2)}</div>` : ""}
      ${customer.city ? `<div style="color:#555;font-size:13px">${escapeHtml(customer.city)}</div>` : ""}
    </div>

    ${notePara}

    <div style="margin:16px 0;padding:12px 16px;background:#f6f9fb;border-radius:6px;display:flex;justify-content:space-between">
      <div style="font-weight:600">Balance due as of ${escapeHtml(asOfTo)}</div>
      <div style="font-weight:700;font-size:18px">LKR ${escapeHtml(fmtMoney(closingBalanceCents))}</div>
    </div>

    <h2 style="font-size:14px;margin:24px 0 8px">Transactions</h2>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#f6f6f6">
          <th style="padding:6px 12px;text-align:left">Date</th>
          <th style="padding:6px 12px;text-align:left">Document</th>
          <th style="padding:6px 12px;text-align:left">Description</th>
          <th style="padding:6px 12px;text-align:right">Charges</th>
          <th style="padding:6px 12px;text-align:right">Payments</th>
          <th style="padding:6px 12px;text-align:right">Balance</th>
        </tr>
      </thead>
      <tbody>
        ${openingRow}
        ${txRows || `<tr><td colspan="6" style="padding:12px;text-align:center;color:#888">No activity in this period</td></tr>`}
      </tbody>
    </table>

    ${
      agingRows
        ? `
      <h2 style="font-size:14px;margin:24px 0 8px">Aging summary</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#f6f6f6">
            <th style="padding:6px 12px;text-align:left">Age</th>
            <th style="padding:6px 12px;text-align:right">Balance</th>
          </tr>
        </thead>
        <tbody>${agingRows}</tbody>
      </table>
    `
        : ""
    }

    <p style="color:#888;font-size:12px;margin-top:24px">
      If you have any questions about this statement, please reply to this email.
    </p>
  </div>
</body>
</html>`;

  const textLines = [
    `Statement of account — ${tenantName}`,
    `Period ${asOfFrom} → ${asOfTo}`,
    `Customer: ${customer.name}`,
    "",
    messageNote ? `${messageNote}\n` : "",
    `Balance due as of ${asOfTo}: LKR ${fmtMoney(closingBalanceCents)}`,
    "",
    "Transactions:",
    ...data.transactions.map(
      (t) =>
        `  ${t.date}  ${t.kind === "invoice" ? "Inv" : "Pmt"} ${t.number ?? ""}  ` +
        `Dr ${fmtMoney(t.debitCents)}  Cr ${fmtMoney(t.creditCents)}  Bal ${fmtMoney(t.runningBalanceCents)}`,
    ),
  ];

  return { subject, html, text: textLines.join("\n") };
}

async function loadTenantName(tx: Database, tenantId: string): Promise<string> {
  const rows = (await tx.execute(sql`
    SELECT business_name FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1
  `)) as unknown as Array<{ business_name: string }>;
  return rows[0]?.business_name ?? "PettahPro";
}

type SendOpts = {
  tenantId: string;
  userId: string | null;
  customerId: string;
  from?: string;
  to?: string;
  toEmailOverride?: string;
  ccEmails?: string[];
  subjectOverride?: string;
  messageNote?: string;
  triggerKind: "manual" | "scheduled";
};

/**
 * Core send routine — computes the statement, renders the email, sends via
 * nodemailer, and logs the attempt (whether it succeeded or not).
 *
 * Failures do NOT throw: every call path (manual button, batch, monthly cron)
 * wants to see the failure logged with a user-visible reason rather than have
 * the whole request 500. The returned `status` tells the caller what happened.
 */
export async function sendCustomerStatementEmail(
  opts: SendOpts,
): Promise<StatementEmailResult> {
  const range =
    opts.from && opts.to
      ? { from: opts.from, to: opts.to }
      : defaultStatementRange();

  return withTenant(opts.tenantId, async (tx) => {
    const data = await computeCustomerStatement(
      tx,
      opts.customerId,
      opts.tenantId,
      range,
    );
    if (!data) {
      return {
        customerId: opts.customerId,
        customerName: "(unknown)",
        status: "failed",
        toEmail: null,
        error: "Customer not found",
      };
    }

    const toEmail = (opts.toEmailOverride ?? data.customer.email ?? "").trim();
    if (!toEmail) {
      // Log the skip so the UI can show "tried but no email on file".
      const [logged] = (await tx.execute(sql`
        INSERT INTO customer_statement_emails (
          tenant_id, customer_id, to_email, cc_emails, subject,
          statement_from, statement_to,
          opening_balance_cents, closing_balance_cents, transaction_count,
          status, error_message, transport, trigger_kind, triggered_by_user_id
        ) VALUES (
          current_tenant_id(), ${data.customer.id}::uuid, '',
          ${JSON.stringify(opts.ccEmails ?? [])}::jsonb,
          ${"(no recipient)"},
          ${range.from}::date, ${range.to}::date,
          ${data.openingBalanceCents}, ${data.closingBalanceCents}, ${data.transactions.length},
          'skipped', ${"Customer has no email on file"},
          'smtp', ${opts.triggerKind},
          ${opts.userId}
        )
        RETURNING id
      `)) as unknown as Array<{ id: string }>;

      return {
        customerId: data.customer.id,
        customerName: data.customer.name,
        status: "skipped",
        toEmail: null,
        error: "Customer has no email on file",
        emailLogId: logged?.id,
      };
    }

    const tenantName = await loadTenantName(tx, opts.tenantId);
    const rendered = renderStatementHtml({
      data,
      tenantName,
      messageNote: opts.messageNote,
    });
    const subject = opts.subjectOverride ?? rendered.subject;

    try {
      const result = await sendEmail({
        to: toEmail,
        cc: opts.ccEmails,
        subject,
        html: rendered.html,
        text: rendered.text,
      });

      const [logged] = (await tx.execute(sql`
        INSERT INTO customer_statement_emails (
          tenant_id, customer_id, to_email, cc_emails, subject,
          statement_from, statement_to,
          opening_balance_cents, closing_balance_cents, transaction_count,
          status, message_id, transport, trigger_kind, triggered_by_user_id
        ) VALUES (
          current_tenant_id(), ${data.customer.id}::uuid, ${toEmail},
          ${JSON.stringify(opts.ccEmails ?? [])}::jsonb,
          ${subject},
          ${range.from}::date, ${range.to}::date,
          ${data.openingBalanceCents}, ${data.closingBalanceCents}, ${data.transactions.length},
          'sent', ${result.messageId}, ${result.transport},
          ${opts.triggerKind}, ${opts.userId}
        )
        RETURNING id
      `)) as unknown as Array<{ id: string }>;

      return {
        customerId: data.customer.id,
        customerName: data.customer.name,
        status: "sent",
        toEmail,
        emailLogId: logged?.id,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const [logged] = (await tx.execute(sql`
        INSERT INTO customer_statement_emails (
          tenant_id, customer_id, to_email, cc_emails, subject,
          statement_from, statement_to,
          opening_balance_cents, closing_balance_cents, transaction_count,
          status, error_message, transport, trigger_kind, triggered_by_user_id
        ) VALUES (
          current_tenant_id(), ${data.customer.id}::uuid, ${toEmail},
          ${JSON.stringify(opts.ccEmails ?? [])}::jsonb,
          ${subject},
          ${range.from}::date, ${range.to}::date,
          ${data.openingBalanceCents}, ${data.closingBalanceCents}, ${data.transactions.length},
          'failed', ${msg.slice(0, 2000)},
          'smtp', ${opts.triggerKind}, ${opts.userId}
        )
        RETURNING id
      `)) as unknown as Array<{ id: string }>;

      return {
        customerId: data.customer.id,
        customerName: data.customer.name,
        status: "failed",
        toEmail,
        error: msg,
        emailLogId: logged?.id,
      };
    }
  });
}

export const customerStatementEmailRoutes: FastifyPluginAsync = async (
  fastify,
) => {
  // POST /customers/:id/statement/email — one-shot send
  fastify.post<{ Params: { id: string } }>(
    "/:id/statement/email",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;

      const parsed = SendBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
      }

      const result = await sendCustomerStatementEmail({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        customerId: req.params.id,
        from: parsed.data.from,
        to: parsed.data.to,
        toEmailOverride: parsed.data.toEmail,
        ccEmails: parsed.data.ccEmails,
        subjectOverride: parsed.data.subjectOverride,
        messageNote: parsed.data.messageNote,
        triggerKind: "manual",
      });

      if (result.status === "failed") {
        return reply.status(502).send({
          error: {
            code: "EMAIL_FAILED",
            message: result.error ?? "Email send failed",
          },
          result,
        });
      }
      if (result.status === "skipped") {
        return reply.status(400).send({
          error: {
            code: "NO_RECIPIENT",
            message: result.error ?? "Customer has no email on file",
          },
          result,
        });
      }
      return reply.send({ result });
    },
  );

  // POST /customers/statements/email-batch
  fastify.post("/statements/email-batch", async (req, reply) => {
    const ctx = requireAuth(req, reply);
    if (!ctx) return;

    const parsed = BatchBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "INVALID_INPUT", issues: parsed.error.issues } });
    }

    const results: StatementEmailResult[] = [];
    for (const customerId of parsed.data.customerIds) {
      // Serial — keeps the SMTP server from throttling, and lets us surface
      // a partial-success response if the transport is flaky.
      const r = await sendCustomerStatementEmail({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        customerId,
        from: parsed.data.from,
        to: parsed.data.to,
        messageNote: parsed.data.messageNote,
        triggerKind: "manual",
      });
      results.push(r);
    }

    return reply.send({
      results,
      summary: {
        sent: results.filter((r) => r.status === "sent").length,
        failed: results.filter((r) => r.status === "failed").length,
        skipped: results.filter((r) => r.status === "skipped").length,
      },
    });
  });

  // GET /customers/:id/statement-emails — send history for this customer
  fastify.get<{ Params: { id: string } }>(
    "/:id/statement-emails",
    async (req, reply) => {
      const ctx = requireAuth(req, reply);
      if (!ctx) return;

      const rows = await withTenant(ctx.tenantId, async (tx) => {
        // Verify customer exists and belongs to tenant — otherwise an empty
        // history would look the same as "customer not found".
        const cust = await tx
          .select({ id: schema.customers.id })
          .from(schema.customers)
          .where(
            and(
              eq(schema.customers.tenantId, ctx.tenantId),
              eq(schema.customers.id, req.params.id),
              isNull(schema.customers.deletedAt),
            ),
          )
          .limit(1);
        if (cust.length === 0) return null;

        return (await tx.execute(sql`
          SELECT
            e.id, e.to_email, e.cc_emails, e.subject,
            e.statement_from::text AS statement_from,
            e.statement_to::text   AS statement_to,
            e.opening_balance_cents, e.closing_balance_cents, e.transaction_count,
            e.status, e.error_message, e.message_id, e.transport,
            e.trigger_kind, e.sent_at,
            u.email AS triggered_by_email
          FROM customer_statement_emails e
          LEFT JOIN users u ON u.id = e.triggered_by_user_id
          WHERE e.tenant_id = current_tenant_id()
            AND e.customer_id = ${req.params.id}::uuid
          ORDER BY e.sent_at DESC
          LIMIT 200
        `)) as unknown as Array<Record<string, unknown>>;
      });

      if (rows === null) {
        return reply.status(404).send({ error: { code: "NOT_FOUND" } });
      }
      return reply.send({ history: rows });
    },
  );
};
