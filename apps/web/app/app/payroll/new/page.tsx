import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { NewPayrollRunClient } from "./new-run-client";

export const metadata: Metadata = { title: "New payroll run" };

export default function NewPayrollRunPage() {
  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/payroll" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to payroll
        </Link>
      </div>

      <PageHeader
        eyebrow="HR"
        title="New payroll run"
        description="Creates a draft run for the chosen period, snapshotting every active employee's basic salary and computing statutory deductions. Review before posting."
      />

      <div className="mt-8 max-w-xl">
        <NewPayrollRunClient />
      </div>
    </main>
  );
}
