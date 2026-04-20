"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { api, ApiError } from "@/lib/api";

export function PostInvoiceButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handle() {
    if (!confirm("Post this invoice to the ledger? The entry will be immutable.")) return;
    setBusy(true);
    try {
      await api.postInvoice(id);
      router.refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Couldn't post the invoice.");
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
