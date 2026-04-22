import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft } from "lucide-react";
import type { AppRole, UserWithRoles } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";
import { RolesClient } from "./roles-client";

export const metadata: Metadata = { title: "Roles & permissions" };

async function fetchAll(): Promise<{ roles: AppRole[]; users: UserWithRoles[] }> {
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const cookie = cookies().toString();
  const [rRes, uRes] = await Promise.all([
    fetch(`${base}/roles`, { headers: { cookie }, cache: "no-store" }),
    fetch(`${base}/roles/users`, { headers: { cookie }, cache: "no-store" }),
  ]);
  const roles = rRes.ok ? ((await rRes.json()) as { roles: AppRole[] }).roles : [];
  const users = uRes.ok ? ((await uRes.json()) as { users: UserWithRoles[] }).users : [];
  return { roles, users };
}

export default async function RolesPage() {
  const { roles, users } = await fetchAll();

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
        title="Roles & permissions"
        description="Roles bundle permission keys; assign one or more to each team member. Owner is the super-admin bypass — assigning a role to an owner has no restrictive effect."
      />
      <RolesClient initialRoles={roles} initialUsers={users} />
    </main>
  );
}
