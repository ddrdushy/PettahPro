import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NewSettlementClient } from "./new-client";

export const metadata: Metadata = { title: "New final settlement" };

export default function NewFinalSettlementPage({
  searchParams,
}: {
  searchParams: { employeeId?: string };
}) {
  const employeeId = searchParams.employeeId;
  if (!employeeId) {
    // Must enter from the employee lifecycle drawer — no standalone picker yet.
    redirect("/app/employees");
  }
  return <NewSettlementClient employeeId={employeeId} />;
}
