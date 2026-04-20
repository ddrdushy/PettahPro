"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { api, ApiError } from "@/lib/api";

export function PostBillButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handle() {
    if (!confirm("Post this bill to the ledger? The entry will be immutable.")) return;
    setBusy(true);
    try {
      await api.postBill(id);
      router.refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Couldn't post the bill.");
    } finally {
      setBusy(false);
    }
  }

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
