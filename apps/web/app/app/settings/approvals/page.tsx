import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft } from "lucide-react";
import type { ApprovalPolicy, AppRole, UserWithRoles } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { ApprovalsClient } from "./approvals-client";

export const metadata: Metadata = { title: "Approval workflows" };

async function fetchAll(): Promise<{
  policies: ApprovalPolicy[];
  roles: AppRole[];
  users: UserWithRoles[];
}> {
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const cookie = cookies().toString();
  const [pRes, rRes, uRes] = await Promise.all([
    fetch(`${base}/approval-policies`, { headers: { cookie }, cache: "no-store" }),
    fetch(`${base}/roles`, { headers: { cookie }, cache: "no-store" }),
    fetch(`${base}/roles/users`, { headers: { cookie }, cache: "no-store" }),
  ]);
  const policies = pRes.ok ? ((await pRes.json()) as { policies: ApprovalPolicy[] }).policies : [];
  const roles = rRes.ok ? ((await rRes.json()) as { roles: AppRole[] }).roles : [];
  const users = uRes.ok ? ((await uRes.json()) as { users: UserWithRoles[] }).users : [];
  return { policies, roles, users };
}

export default async function ApprovalsPage() {
  const { policies, roles, users } = await fetchAll();

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/settings" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to settings
        </Link>
      </div>
      <PageHeader
        eyebrow="Admin"
        title="Approval workflows"
        description="Design linear approval chains per document type. Trigger by minimum amount or submitter; route each step to one or more roles or named users. Policies are stored here today — wiring them into posting flows ships in a follow-up."
      />
      <ApprovalsClient initialPolicies={policies} roles={roles} users={users} />
    </main>
  );
}
