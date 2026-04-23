"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useCan } from "@/components/auth/permissions-provider";

export function PostInvoiceButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const canPost = useCan("invoices.post");

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

  // Hide the action entirely for users without `invoices.post`. The
  // server still enforces the check; this is just UX — no confused
  // "forbidden" toast when the button shouldn't have existed.
  if (!canPost) return null;

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
