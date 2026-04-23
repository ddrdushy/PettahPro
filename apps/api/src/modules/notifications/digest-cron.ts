import { sql } from "drizzle-orm";
import type { Database } from "@pettahpro/db";
import { withTenant } from "@pettahpro/db";
import { sendEmail } from "../../lib/email.js";

/**
 * Notification digest cron (roadmap #45).
 *
 * Runs hourly. For each tenant, computes the current tenant-local hour
 * (honouring tenants.timezone, default Asia/Colombo) and fires the daily
 * digest when the local hour matches DIGEST_SEND_HOUR (default 8).
 * Weekly digests fire on Monday at the same hour.
 *
 * Dedupe is a lookback over notification_digest_emails — if the user
 * already received a status='sent' digest of this cadence inside the
 * min-gap window (20h daily, 6d weekly) we skip. Two cron ticks inside
 * the same tenant-local hour therefore won't double-send.
 *
 * All per-tenant reads go through withTenant() because
 * notification_digest_{queue,emails} have RLS — the app connects as
 * pettahpro_app (NOBYPASSRLS) so a missing tenant context returns zero
 * rows, not a leak. The tenant sweep itself hits `tenants` which has
 * no RLS.
 *
 * Per-user timezone is deliberately out of scope for v1 — every user in
 * a tenant shares the tenant's timezone for digest cutoffs. Adding a
 * users.timezone column is a trivial follow-up if tenants start asking.
 */

const DEFAULT_SEND_HOUR = 8;
const DAILY_MIN_GAP_HOURS = 20;
const WEEKLY_MIN_GAP_DAYS = 6;

type Log = {
  info: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
  warn?: (obj: object, msg?: string) => void;
};

type TenantRow = {
  id: string;
  timezone: string;
  business_name: string;
};

type PendingUserRow = {
  user_id: string;
  email: string;
  full_name: string;
  pending_count: number;
};

type QueueRow = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  ref_type: string | null;
  ref_id: string | null;
  created_at: string;
};

export async function runNotificationDigests(
  dbClient: Database,
  log: Log,
  now: Date = new Date(),
): Promise<{ sent: number; failed: number; skipped: number; tenantsScanned: number }> {
  const sendHour = Number(process.env.DIGEST_SEND_HOUR ?? DEFAULT_SEND_HOUR);

  // Tenants table has no RLS so the enumerate is fine at top level.
  const tenants = (await dbClient.execute(sql`
    SELECT id, COALESCE(timezone, 'Asia/Colombo') AS timezone, business_name
    FROM tenants
    WHERE deleted_at IS NULL
  `)) as unknown as TenantRow[];

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let tenantsScanned = 0;

  for (const tenant of tenants) {
    const local = tenantLocalNow(now, tenant.timezone);
    const fireDaily = local.hour === sendHour;
    // Monday = 1 under the weekday map derived below.
    const fireWeekly = fireDaily && local.weekday === 1;
    if (!fireDaily && !fireWeekly) continue;

    tenantsScanned++;
    try {
      const result = await dispatchForTenant(tenant, {
        fireDaily,
        fireWeekly,
        now,
        log,
      });
      sent += result.sent;
      failed += result.failed;
      skipped += result.skipped;
    } catch (err) {
      failed++;
      log.error(
        { tenantId: tenant.id, err: (err as Error).message },
        "digest dispatch crashed for tenant",
      );
    }
  }

  return { sent, failed, skipped, tenantsScanned };
}

async function dispatchForTenant(
  tenant: TenantRow,
  opts: { fireDaily: boolean; fireWeekly: boolean; now: Date; log: Log },
): Promise<{ sent: number; failed: number; skipped: number }> {
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  const cadences: Array<"daily" | "weekly"> = [];
  if (opts.fireDaily) cadences.push("daily");
  if (opts.fireWeekly) cadences.push("weekly");

  for (const cadence of cadences) {
    // Find users with pending rows for this cadence. The users table
    // is not RLS-gated but we still wrap in withTenant because we join
    // to notification_digest_queue which is.
    const users = await withTenant(tenant.id, async (tx) => {
      return (await tx.execute(sql`
        SELECT u.id AS user_id, u.email, u.full_name,
               (SELECT COUNT(*)::int FROM notification_digest_queue q2
                  WHERE q2.tenant_id = current_tenant_id()
                    AND q2.user_id = u.id
                    AND q2.cadence = ${cadence}
                    AND q2.delivered_at IS NULL) AS pending_count
        FROM users u
        WHERE u.tenant_id = ${tenant.id}::uuid
          AND u.is_active = true
          AND u.deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM notification_digest_queue q
            WHERE q.tenant_id = current_tenant_id()
              AND q.user_id = u.id
              AND q.cadence = ${cadence}
              AND q.delivered_at IS NULL
          )
      `)) as unknown as PendingUserRow[];
    });

    if (users.length === 0) continue;

    const minGapMs =
      cadence === "daily"
        ? DAILY_MIN_GAP_HOURS * 60 * 60 * 1000
        : WEEKLY_MIN_GAP_DAYS * 24 * 60 * 60 * 1000;

    for (const user of users) {
      const result = await withTenant(tenant.id, async (tx) => {
        // Dedupe: has this user received a sent digest of this cadence
        // inside the min-gap window? If so, skip.
        const recent = (await tx.execute(sql`
          SELECT sent_at FROM notification_digest_emails
          WHERE tenant_id = current_tenant_id()
            AND user_id = ${user.user_id}::uuid
            AND cadence = ${cadence}
            AND status = 'sent'
            AND sent_at > now() - ((${minGapMs}::bigint)::text || ' milliseconds')::interval
          ORDER BY sent_at DESC
          LIMIT 1
        `)) as unknown as Array<{ sent_at: string }>;
        if (recent.length > 0) {
          return { status: "deduped" as const, lastSent: recent[0]?.sent_at };
        }

        const rows = (await tx.execute(sql`
          SELECT id, kind, title, body, ref_type, ref_id, created_at
          FROM notification_digest_queue
          WHERE tenant_id = current_tenant_id()
            AND user_id = ${user.user_id}::uuid
            AND cadence = ${cadence}
            AND delivered_at IS NULL
          ORDER BY created_at ASC
        `)) as unknown as QueueRow[];
        if (rows.length === 0) return { status: "empty" as const };

        const windowStart = rows[0]?.created_at ?? opts.now.toISOString();
        const windowEnd = opts.now.toISOString();
        const breakdown = aggregateKinds(rows);
        const { subject, html, text } = renderDigestEmail({
          cadence,
          businessName: tenant.business_name,
          recipientName: user.full_name,
          rows,
          breakdown,
        });

        try {
          const emailResult = await sendEmail({
            to: user.email,
            subject,
            html,
            text,
          });

          const [logRow] = (await tx.execute(sql`
            INSERT INTO notification_digest_emails
              (tenant_id, user_id, to_email, cadence, window_start, window_end,
               event_count, kind_breakdown, status, message_id, transport)
            VALUES
              (${tenant.id}::uuid, ${user.user_id}::uuid, ${user.email},
               ${cadence}, ${windowStart}::timestamptz, ${windowEnd}::timestamptz,
               ${rows.length}, ${JSON.stringify(breakdown)}::jsonb, 'sent',
               ${emailResult.messageId}, ${emailResult.transport})
            RETURNING id
          `)) as unknown as Array<{ id: string }>;
          const digestEmailId = logRow?.id ?? null;

          await tx.execute(sql`
            UPDATE notification_digest_queue
            SET delivered_at = now(), digest_email_id = ${digestEmailId}::uuid
            WHERE tenant_id = current_tenant_id()
              AND user_id = ${user.user_id}::uuid
              AND cadence = ${cadence}
              AND delivered_at IS NULL
          `);

          return { status: "sent" as const, count: rows.length };
        } catch (err) {
          // Log the failed attempt but leave queue rows pending so the next
          // cron tick retries. We don't want one misconfigured SMTP host
          // to drop events on the floor.
          const message = (err as Error).message;
          await tx.execute(sql`
            INSERT INTO notification_digest_emails
              (tenant_id, user_id, to_email, cadence, window_start, window_end,
               event_count, kind_breakdown, status, error_message, transport)
            VALUES
              (${tenant.id}::uuid, ${user.user_id}::uuid, ${user.email},
               ${cadence}, ${windowStart}::timestamptz, ${windowEnd}::timestamptz,
               ${rows.length}, ${JSON.stringify(breakdown)}::jsonb, 'failed',
               ${message}, 'smtp')
          `);
          return { status: "failed" as const, error: message };
        }
      });

      if (result.status === "sent") {
        sent++;
        opts.log.info(
          { tenantId: tenant.id, userId: user.user_id, cadence, count: result.count },
          "digest sent",
        );
      } else if (result.status === "failed") {
        failed++;
        opts.log.error(
          { tenantId: tenant.id, userId: user.user_id, cadence, err: result.error },
          "digest send failed",
        );
      } else {
        skipped++;
        if (result.status === "deduped") {
          opts.log.info(
            { tenantId: tenant.id, userId: user.user_id, cadence, lastSent: result.lastSent },
            "digest skipped (dedupe window)",
          );
        }
      }
    }
  }

  return { sent, failed, skipped };
}

function aggregateKinds(rows: QueueRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    out[r.kind] = (out[r.kind] ?? 0) + 1;
  }
  return out;
}

// Exposed for testing. Intl.DateTimeFormat with timezone is the cheapest
// way to derive tenant-local wall clock without pulling in date-fns-tz.
export function tenantLocalNow(
  now: Date,
  timezone: string,
): { hour: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const hourPart = parts.find((p) => p.type === "hour")?.value ?? "0";
  const weekdayPart = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const weekdayMap: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0,
  };
  return {
    hour: Number(hourPart) % 24,
    weekday: weekdayMap[weekdayPart] ?? 0,
  };
}

function renderDigestEmail(input: {
  cadence: "daily" | "weekly";
  businessName: string;
  recipientName: string;
  rows: QueueRow[];
  breakdown: Record<string, number>;
}): { subject: string; html: string; text: string } {
  const cadenceLabel = input.cadence === "daily" ? "Daily" : "Weekly";
  const subject = `${cadenceLabel} digest · ${input.businessName} · ${input.rows.length} update${input.rows.length === 1 ? "" : "s"}`;

  // Group by kind for the HTML summary — cleaner than a flat chronological
  // list when the digest spans multiple event types.
  const groups = new Map<string, QueueRow[]>();
  for (const r of input.rows) {
    const bucket = groups.get(r.kind) ?? [];
    bucket.push(r);
    groups.set(r.kind, bucket);
  }

  const sections: string[] = [];
  const textSections: string[] = [];
  for (const [kind, rows] of groups.entries()) {
    const label = KIND_LABELS[kind] ?? kind;
    sections.push(`
      <h3 style="font-size:14px;margin:20px 0 6px 0;color:#1f2937;">${escapeHtml(label)} <span style="color:#9ca3af;font-weight:400;">(${rows.length})</span></h3>
      <ul style="margin:0 0 0 0;padding:0 0 0 18px;color:#374151;font-size:13px;line-height:1.6;">
        ${rows
          .map(
            (r) => `<li>
              <strong>${escapeHtml(r.title)}</strong>${r.body ? `<br/><span style="color:#6b7280;">${escapeHtml(r.body)}</span>` : ""}
            </li>`,
          )
          .join("")}
      </ul>
    `);
    textSections.push(`${label} (${rows.length}):`);
    for (const r of rows) {
      textSections.push(`  · ${r.title}${r.body ? ` — ${r.body}` : ""}`);
    }
    textSections.push("");
  }

  const html = `
<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9fafb;margin:0;padding:24px;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:28px;">
      <p style="margin:0 0 4px 0;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">${cadenceLabel} digest</p>
      <h1 style="margin:0 0 16px 0;font-size:20px;color:#111827;">${escapeHtml(input.businessName)}</h1>
      <p style="margin:0 0 20px 0;color:#374151;font-size:14px;">
        Hi ${escapeHtml(input.recipientName || "there")}, here's what happened in the last ${input.cadence === "daily" ? "day" : "week"}.
      </p>
      ${sections.join("")}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 16px 0;" />
      <p style="margin:0;color:#9ca3af;font-size:12px;">
        You're receiving this because you set ${input.cadence} digest for one or more events.
        Adjust under Settings → Notifications in PettahPro.
      </p>
    </div>
  </body>
</html>`.trim();

  const text = [
    `${cadenceLabel} digest — ${input.businessName}`,
    "",
    `Hi ${input.recipientName || "there"}, here's what happened in the last ${input.cadence === "daily" ? "day" : "week"}.`,
    "",
    ...textSections,
    "Adjust your digest settings under Settings → Notifications in PettahPro.",
  ].join("\n");

  return { subject, html, text };
}

// Keep aligned with NOTIFICATION_KIND_CATALOG in routes.ts. Untracked
// kinds fall through to the raw kind string — degrades gracefully.
const KIND_LABELS: Record<string, string> = {
  invoice_posted: "Invoice posted",
  payment_received: "Payment received",
  pos_sale_posted: "POS sale posted",
  pos_shift_variance: "POS shift variance",
  bill_posted: "Bill posted",
  je_approval_pending: "Journal pending review",
  je_approved: "Journal approved",
  je_rejected: "Journal rejected",
  period_closed: "Period closed",
  period_reopened: "Period reopened",
  year_closed: "Year closed",
  low_stock: "Low stock",
  cheque_stale: "Stale cheque",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
