"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

export function PortalLogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handle() {
    setBusy(true);
    try {
      await api.portalLogout();
    } catch {
      /* best effort */
    }
    router.push("/portal/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handle}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-small text-text-secondary transition-colors hover:bg-mint-surface hover:text-charcoal"
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <LogOut className="h-4 w-4" aria-hidden />
      )}
      Sign out
    </button>
  );
}
