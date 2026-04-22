import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ClipboardCheck } from "lucide-react";
import type { JournalEntryDraft } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { ApprovalsClient } from "./approvals-client";

export const metadata: Metadata = { title: "Journal approvals" };

async function fetchDrafts(): Promise<JournalEntryDraft[]> {
  const res = await fetch(
    `${process.env.INTERNAL_API_URL ?? "http://api:4000"}/journal-entries/drafts`,
    { headers: { cookie: cookies().toString() }, cache: "no-store" },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { drafts: JournalEntryDraft[] };
  return data.drafts;
}

export default async function JournalApprovalsPage() {
  const drafts = await fetchDrafts();

  const pending = drafts.filter((d) => d.status === "pending_approval");
  const recent = drafts.filter((d) => d.status !== "pending_approval").slice(0, 25);

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Accounting"
        title="Journal approvals"
        description="Manual journal entries above the tenant threshold land here for a second pair of eyes. Approving posts them to the GL; rejecting shelves them with a reason. You can't approve drafts you created yourself."
      />

      {pending.length === 0 && recent.length === 0 ? (
        <div className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <ClipboardCheck className="mx-auto h-6 w-6 text-text-tertiary" aria-hidden />
          <p className="mt-3 text-body text-text-secondary">Nothing waiting on approval.</p>
          <p className="mt-1 text-caption text-text-tertiary">
            Set the threshold under Settings → Journal approvals to route high-value manual entries here.
          </p>
        </div>
      ) : (
        <ApprovalsClient pending={pending} recent={recent} />
      )}
    </main>
  );
}
