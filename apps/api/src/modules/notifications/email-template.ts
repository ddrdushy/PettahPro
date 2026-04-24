// Shared notification-email rendering (roadmap #45 + #53).
//
// The digest cron was the first to need an HTML email for notifications,
// and it baked both KIND_LABELS and a render helper inline. Roadmap #53
// adds immediate-email delivery, which needs the same KIND_LABELS
// dictionary and a similar-but-smaller template. Extracting to a shared
// module avoids a drift trap where a new kind gets a label in one place
// and not the other.
//
// Two renderers:
//   • renderDigestEmail   — multi-event rollup (daily / weekly cadence)
//   • renderImmediateEmail — single-event notification (immediate cadence
//     with email_enabled=true)
//
// Both use the same plaintext/HTML skeleton so brand + typography stay
// consistent across the two email types.

export type DigestRow = {
  kind: string;
  title: string;
  body: string | null;
};

/**
 * Keep aligned with NOTIFICATION_KIND_CATALOG in routes.ts. Untracked
 * kinds fall through to the raw kind string — degrades gracefully so a
 * new emit site that hasn't had a label added yet still ships a readable
 * email.
 */
export const KIND_LABELS: Record<string, string> = {
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

export function renderDigestEmail(input: {
  cadence: "daily" | "weekly";
  businessName: string;
  recipientName: string;
  rows: DigestRow[];
}): { subject: string; html: string; text: string } {
  const cadenceLabel = input.cadence === "daily" ? "Daily" : "Weekly";
  const subject = `${cadenceLabel} digest · ${input.businessName} · ${input.rows.length} update${input.rows.length === 1 ? "" : "s"}`;

  const groups = new Map<string, DigestRow[]>();
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

/**
 * Single-event email sent when a user has cadence='immediate' and
 * email_enabled=true. Intentionally small — one event, one section. The
 * subject puts the event kind up front so inbox scanning is quick
 * ("[PettahPro] Invoice posted — INV-00042"), followed by the business
 * name so users who belong to multiple tenants can tell the emails
 * apart at a glance.
 */
export function renderImmediateEmail(input: {
  kind: string;
  title: string;
  body: string | null;
  businessName: string;
  recipientName: string;
}): { subject: string; html: string; text: string } {
  const label = KIND_LABELS[input.kind] ?? input.kind;
  const subject = `[${input.businessName}] ${label} — ${input.title}`;

  const html = `
<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9fafb;margin:0;padding:24px;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:28px;">
      <p style="margin:0 0 4px 0;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(label)}</p>
      <h1 style="margin:0 0 16px 0;font-size:20px;color:#111827;">${escapeHtml(input.businessName)}</h1>
      <p style="margin:0 0 8px 0;color:#111827;font-size:15px;font-weight:500;">
        ${escapeHtml(input.title)}
      </p>
      ${
        input.body
          ? `<p style="margin:0 0 20px 0;color:#374151;font-size:14px;line-height:1.5;">${escapeHtml(input.body)}</p>`
          : ""
      }
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 16px 0;" />
      <p style="margin:0;color:#9ca3af;font-size:12px;">
        Hi ${escapeHtml(input.recipientName || "there")} — you're receiving this because you turned on email alerts for <strong>${escapeHtml(label)}</strong>.
        Adjust under Settings → Notifications in PettahPro.
      </p>
    </div>
  </body>
</html>`.trim();

  const text = [
    `${label} — ${input.businessName}`,
    "",
    input.title,
    ...(input.body ? ["", input.body] : []),
    "",
    `Hi ${input.recipientName || "there"} — you're receiving this because you turned on email alerts for ${label}. Adjust under Settings → Notifications in PettahPro.`,
  ].join("\n");

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
