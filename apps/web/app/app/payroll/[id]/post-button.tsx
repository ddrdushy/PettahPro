"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useCan } from "@/components/auth/permissions-provider";

export function PostPayrollButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const canManage = useCan("payroll.manage");

  async function handle() {
    if (!confirm("Post this payroll run to the ledger? The journal will be immutable.")) return;
    setBusy(true);
    try {
      await api.postPayrollRun(id);
      router.refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Couldn't post the run.");
    } finally {
      setBusy(false);
    }
  }

  if (!canManage) return null;

  return (
    <button type="button" onClick={handle} disabled={busy} className="btn-primary">
      {busy ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Posting…
        </>
      ) : (
        <>
          <Send className="h-4 w-4" aria-hidden /> Post to ledger
        </>
      )}
    </button>
  );
}
