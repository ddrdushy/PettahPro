"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Check, Loader2 } from "lucide-react";
import { api, type AppNotification } from "@/lib/api";

const POLL_INTERVAL_MS = 30_000;

function refHref(n: AppNotification): string | null {
  if (!n.refType || !n.refId) return null;
  const map: Record<string, string> = {
    invoice: `/app/invoices/${n.refId}`,
    bill: `/app/bills/${n.refId}`,
    customer_payment: `/app/payments`,
    supplier_payment: `/app/supplier-payments`,
    cheque: `/app/cheques/${n.refId}`,
    leave_request: `/app/leave-requests/${n.refId}`,
    item: `/app/stock/low-stock`,
    fiscal_period: `/app/accounting/periods`,
    fiscal_year: `/app/accounting/periods`,
    journal_entry_draft: `/app/journals/approvals`,
    journal_entry: `/app/journals/${n.refId}`,
  };
  return map[n.refType] ?? null;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [busy, setBusy] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(async () => {
    try {
      const res = await api.notificationUnreadCount();
      setCount(res.count);
    } catch {
      // Tolerate — the bell is best-effort. User can still open the dropdown.
    }
  }, []);

  // Poll the unread count every 30s while the page is visible.
  useEffect(() => {
    refreshCount();
    const handle = setInterval(refreshCount, POLL_INTERVAL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") refreshCount();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(handle);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refreshCount]);

  // Load the list when the dropdown opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.listNotifications(20);
        if (!cancelled) setItems(res.notifications);
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!anchorRef.current) return;
      if (!anchorRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  async function markOne(n: AppNotification) {
    if (n.readAt || n.isBroadcast) return; // can't mark broadcasts per current API
    try {
      await api.readNotification(n.id);
      setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) ?? null);
      setCount((c) => Math.max(0, c - 1));
    } catch {
      // ignore — UI stays as-is
    }
  }

  async function markAll() {
    setBusy(true);
    try {
      await api.readAllNotifications();
      setItems((prev) => prev?.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })) ?? null);
      setCount(0);
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  }

  function handleClick(n: AppNotification) {
    markOne(n);
    const href = refHref(n);
    setOpen(false);
    if (href) router.push(href);
  }

  return (
    <div ref={anchorRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={count > 0 ? `Notifications (${count} unread)` : "Notifications"}
        className="relative grid h-9 w-9 place-items-center rounded-md text-text-secondary transition-colors hover:bg-surface-recessed hover:text-charcoal"
      >
        <Bell className="h-4 w-4" aria-hidden />
        {count > 0 && (
          <span
            aria-hidden
            className="absolute right-1 top-1 grid h-4 min-w-[1rem] place-items-center rounded-full bg-danger px-1 text-[10px] font-medium text-offwhite"
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-40 w-96 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated shadow-lg">
          <header className="flex items-center justify-between border-b-hairline border-border px-4 py-3">
            <p className="text-small font-medium text-charcoal">Notifications</p>
            {count > 0 && (
              <button
                type="button"
                onClick={markAll}
                disabled={busy}
                className="flex items-center gap-1 text-caption text-text-secondary transition hover:text-charcoal disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Check className="h-3 w-3" aria-hidden />}
                Mark all read
              </button>
            )}
          </header>
          <div className="max-h-96 overflow-y-auto">
            {items === null ? (
              <div className="py-10 text-center text-small text-text-tertiary">
                <Loader2 className="mx-auto h-4 w-4 animate-spin" aria-hidden />
              </div>
            ) : items.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-full bg-mint-surface text-mint-dark">
                  <Bell className="h-4 w-4" aria-hidden />
                </div>
                <p className="text-small text-text-secondary">You're all caught up.</p>
              </div>
            ) : (
              <ul className="divide-y-hairline divide-border">
                {items.map((n) => {
                  const unread = !n.readAt;
                  const href = refHref(n);
                  const Inner = (
                    <div className={`flex gap-3 px-4 py-3 transition-colors ${unread ? "bg-mint-surface/30" : ""} hover:bg-surface-recessed/40`}>
                      <span
                        aria-hidden
                        className={`mt-1.5 h-2 w-2 flex-none rounded-full ${unread ? "bg-mint-dark" : "bg-transparent"}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-small font-medium text-charcoal">{n.title}</p>
                        {n.body && <p className="mt-0.5 truncate text-caption text-text-secondary">{n.body}</p>}
                        <p className="mt-1 text-caption text-text-tertiary">{timeAgo(n.createdAt)}</p>
                      </div>
                    </div>
                  );
                  return (
                    <li key={n.id}>
                      {href ? (
                        <Link
                          href={href}
                          onClick={() => markOne(n)}
                          className="block"
                        >
                          {Inner}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleClick(n)}
                          className="block w-full text-left"
                        >
                          {Inner}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
