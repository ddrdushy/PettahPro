import type { Metadata } from "next";
import { BranchFormClient } from "../branch-form-client";

export const metadata: Metadata = { title: "New branch" };

export default function NewBranchPage() {
  return <BranchFormClient mode="create" />;
}
