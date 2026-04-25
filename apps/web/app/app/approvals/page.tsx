import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ClipboardCheck } from "lucide-react";
import type { ApprovalRequest } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { PlanFeatureGate } from "@/components/app/plan-feature-gate";
import { ApprovalsQueueClient } from "./queue-client";

export const metadata: Metadata = { title: "Approvals" };

// Cross-document approvals queue — roadmap #43.
//
// Pulls the three scopes in one render so the client can tab between them
// without a round-trip. Each list is capped at 200 server-side (the API);
// tenants with bigger queues will grow an explicit filter UI later.
async function fetchScope(
  scope: "mine" | "submitted_by_me" | "all",
  cookie: string,
): Promise<ApprovalRequest[]> {
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const res = await fetch(`${base}/approvals?scope=${scope}`, {
    headers: { cookie },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { requests: ApprovalRequest[] };
  return data.requests;
}

export default async function ApprovalsPage() {
  // Plan gate short-circuits the three scope fetches on tenants without
  // approval_workflows — no wasted round trips, upgrade card instead.
  return (
    <PlanFeatureGate feature="approval_workflows">
      <ApprovalsPageContent />
    </PlanFeatureGate>
  );
}

async function ApprovalsPageContent() {
  const cookie = cookies().toString();
  const [mine, submitted, all] = await Promise.all([
    fetchScope("mine", cookie),
    fetchScope("submitted_by_me", cookie),
    fetchScope("all", cookie),
  ]);

  const hasAny = mine.length + submitted.length + all.length > 0;

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="Workflow"
        title="Approvals"
        description="Documents routed through your tenant's approval policies land here. Decide on items awaiting you, or track requests you submitted."
      />

      {!hasAny ? (
        <div className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <ClipboardCheck className="mx-auto h-6 w-6 text-text-tertiary" aria-hidden />
          <p className="mt-3 text-body text-text-secondary">No approvals yet.</p>
          <p className="mt-1 text-caption text-text-tertiary">
            Design a policy under Settings → Approval workflows, then submit a
            matching document to start driving the queue.
          </p>
        </div>
      ) : (
        <ApprovalsQueueClient mine={mine} submitted={submitted} all={all} />
      )}
    </main>
  );
}
