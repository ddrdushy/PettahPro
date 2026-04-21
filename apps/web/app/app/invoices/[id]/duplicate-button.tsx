"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Copy, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";

export function DuplicateInvoiceButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handle() {
    setBusy(true);
    try {
      const res = await api.duplicateInvoice(id);
      router.push(`/app/invoices/${res.invoice.id}`);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Couldn't duplicate the invoice.");
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={handle} disabled={busy} className="btn-secondary">
      {busy ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Duplicating…
        </>
      ) : (
        <>
          <Copy className="h-4 w-4" aria-hidden /> Duplicate
        </>
      )}
    </button>
  );
}
