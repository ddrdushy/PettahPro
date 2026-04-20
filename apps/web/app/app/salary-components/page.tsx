import type { Metadata } from "next";
import { cookies } from "next/headers";
import { PageHeader } from "@/components/app/page-header";
import type { SalaryComponent } from "@/lib/api";
import { ComponentsClient } from "./components-client";

export const metadata: Metadata = { title: "Salary components" };

async function fetchComponents(): Promise<SalaryComponent[]> {
  const base = process.env.INTERNAL_API_URL ?? "http://api:4000";
  const cookieHeader = cookies().toString();
  const res = await fetch(`${base}/salary-components`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { components: SalaryComponent[] };
  return body.components;
}

export default async function SalaryComponentsPage() {
  const components = await fetchComponents();
  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="HR"
        title="Salary components"
        description="Building blocks for a payslip. Each component says how it's calculated and whether it counts for EPF, ETF, and PAYE. System components cover the SL defaults — add your own for one-off allowances or recoveries."
      />
      <div className="mt-6">
        <ComponentsClient initial={components} />
      </div>
    </main>
  );
}
