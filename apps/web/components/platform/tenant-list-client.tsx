"use client";

// #59 — Client table for /platform/tenants. Wraps the server-sorted
// tenant list with:
//
//   * row checkboxes + "select all on page"
//   * a sticky bulk-action bar that appears when anything is selected
//   * search-hit highlighting (wraps the matched substring with <mark>)
//   * keyboard shortcuts (/, j/k, x, Enter, Esc) matching common
//     ops-console bindings (Linear, Plaid, Superhuman, Vercel, etc.)
//   * a CSV export button driven by the rows currently on-screen
//
// The server page still owns fetching + sorting + filtering. This
// component is a display + interaction layer only. The sort header
// links are rendered by the server so right-click → open in new tab
// keeps working.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  PlatformApiError,
  platformApi,
  type TenantSummary,
} from "@/lib/platform-api";

// Duplicated from the server page on purpose — they're independent
// implementations that happen to render the same strings.
function statusPill(status: string): { label: string; cls: string } {
  switch (status) {
    case "active":
      return {
        label: "Active",
        cls: "bg-mint/20 text-mint ring-1 ring-inset ring-mint/30",
      };
    case "suspended":
      return {
        label: "Suspended",
        cls: "bg-red-500/20 text-red-300 ring-1 ring-inset ring-red-500/30",
      };
    case "trial":
      return {
        label: "Trial",
        cls: "bg-amber-400/20 text-amber-200 ring-1 ring-inset ring-amber-400/30",
      };
    case "past-due":
      return {
        label: "Past due",
        cls: "bg-orange-500/20 text-orange-200 ring-1 ring-inset ring-orange-500/30",
      };
    case "churned":
      return {
        label: "Churned",
        cls: "bg-white/10 text-white/60 ring-1 ring-inset ring-white/20",
      };
    default:
      return { label: status, cls: "bg-white/10 text-white/70" };
  }
}

function formatDate(s: string | null): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return s;
  }
}

function relativeTime(s: string | null): string {
  if (!s) return "Never";
  const diffMs = Date.now() - new Date(s).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

// Basic highlighter: splits the string by case-insensitive occurrences
// of `needle` and wraps each match in <mark>. Skips if needle is empty
// or too long (prevents quadratic blow-up on adversarial input).
function highlight(haystack: string, needle: string): React.ReactNode {
  const trimmed = needle.trim();
  if (!trimmed || trimmed.length > 80) return haystack;
  const lower = haystack.toLowerCase();
  const needleLower = trimmed.toLowerCase();
  const pieces: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < haystack.length) {
    const hit = lower.indexOf(needleLower, i);
    if (hit === -1) {
      pieces.push(haystack.slice(i));
      break;
    }
    if (hit > i) pieces.push(haystack.slice(i, hit));
    pieces.push(
      <mark
        key={key++}
        className="rounded-sm bg-mint/30 px-0.5 text-white"
      >
        {haystack.slice(hit, hit + trimmed.length)}
      </mark>,
    );
    i = hit + trimmed.length;
  }
  return <>{pieces}</>;
}

// CSV value escape — wrap in double quotes if the value contains
// comma/quote/newline; escape existing quotes by doubling.
function csvField(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(filename: string, rows: string[][]) {
  const body = rows.map((r) => r.map(csvField).join(",")).join("\n");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

type SortKey =
  | "name"
  | "status"
  | "country"
  | "users"
  | "lastActive"
  | "created";
type SortDir = "asc" | "desc";

// A mini SortHeader that renders inside the client table. Same shape
// as the server-side one so URLs keep working — sort state lives in
// the URL, always.
function SortHeader({
  label,
  sortKey,
  currentKey,
  currentDir,
  baseParams,
  align,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  currentDir: SortDir;
  baseParams: { status?: string; search?: string };
  align?: "left" | "right";
}) {
  const active = currentKey === sortKey;
  const nextDir: SortDir = active && currentDir === "asc" ? "desc" : "asc";
  const qs = new URLSearchParams();
  if (baseParams.status) qs.set("status", baseParams.status);
  if (baseParams.search) qs.set("search", baseParams.search);
  qs.set("sort", sortKey);
  qs.set("dir", nextDir);
  const arrow = active ? (currentDir === "asc" ? "↑" : "↓") : "";
  return (
    <th className={`px-4 py-3 ${align === "right" ? "text-right" : "text-left"}`}>
      <Link
        href={`/platform/tenants?${qs.toString()}`}
        className={`group inline-flex items-center gap-1 hover:text-white ${
          active ? "text-white" : ""
        }`}
      >
        {label}
        <span className="text-[0.6rem] opacity-60 group-hover:opacity-100">
          {arrow || "↕"}
        </span>
      </Link>
    </th>
  );
}

export function TenantListClient({
  tenants,
  searchTerm,
  canBulkAct,
  currentSort,
  currentDir,
  baseParams,
}: {
  tenants: TenantSummary[];
  searchTerm: string;
  canBulkAct: boolean;
  currentSort: SortKey;
  currentDir: SortDir;
  baseParams: { status?: string; search?: string };
}) {
  const router = useRouter();
  // Map id → selected. Using a Map keeps Set-like semantics but gives
  // React a stable dependency when the size changes.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Focused row for keyboard nav. -1 means no row focused yet.
  const [focusIdx, setFocusIdx] = useState<number>(-1);
  const [showBulkPrompt, setShowBulkPrompt] = useState<
    null | "suspend" | "reactivate"
  >(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([]);

  // If the underlying sorted list shrinks below our focus cursor, pull
  // the cursor back in range. Same story for selection — prune ids
  // that no longer exist in the page (a page-change would reset this
  // via a full navigation, but filter changes don't).
  useEffect(() => {
    if (focusIdx >= tenants.length) setFocusIdx(tenants.length - 1);
    setSelected((prev) => {
      const allIds = new Set(tenants.map((t) => t.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (allIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [tenants, focusIdx]);

  // One-stop keyboard handler. Skips if the user is typing in an
  // input/textarea/select (so `/` doesn't hijack the filter box once
  // it's focused; Esc is the way out from there).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inEditable =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      // "/" focuses search even if we're not in an editable — the most
      // useful shortcut on the page.
      if (e.key === "/" && !inEditable) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (inEditable) return; // everything below is row-nav

      if (e.key === "Escape") {
        setFocusIdx(-1);
        setSelected(new Set());
        setShowBulkPrompt(null);
        return;
      }

      if (tenants.length === 0) return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIdx((i) => Math.min(tenants.length - 1, Math.max(0, i + 1)));
        return;
      }
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIdx((i) => Math.max(0, i === -1 ? 0 : i - 1));
        return;
      }
      if (e.key === "x" || e.key === " ") {
        if (!canBulkAct || focusIdx < 0) return;
        e.preventDefault();
        const id = tenants[focusIdx]?.id;
        if (!id) return;
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        return;
      }
      if (e.key === "Enter") {
        if (focusIdx < 0) return;
        const id = tenants[focusIdx]?.id;
        if (!id) return;
        e.preventDefault();
        router.push(`/platform/tenants/${id}`);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tenants, focusIdx, canBulkAct, router]);

  // Scroll the focused row into view when it changes (only if the row
  // is outside the viewport — avoids jitter on every j/k tap).
  useEffect(() => {
    if (focusIdx < 0) return;
    const row = rowRefs.current[focusIdx];
    if (!row) return;
    const rect = row.getBoundingClientRect();
    const above = rect.top < 80;
    const below = rect.bottom > window.innerHeight - 40;
    if (above || below) {
      row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [focusIdx]);

  // Register the global search input reference via a ref callback so
  // the `/` shortcut can grab it. We do this once on mount by looking
  // up the input in the parent form (it lives in the server component).
  useEffect(() => {
    const input = document.getElementById("search") as HTMLInputElement | null;
    searchInputRef.current = input;
  }, []);

  const allOnPageSelected = useMemo(() => {
    if (tenants.length === 0) return false;
    return tenants.every((t) => selected.has(t.id));
  }, [tenants, selected]);

  function toggleAll() {
    setSelected((prev) => {
      if (tenants.every((t) => prev.has(t.id))) {
        // clear only the ones on this page — preserve any selection
        // from a previous filter state, if that ever matters. We're
        // in client state so there isn't a "previous filter" — this
        // reduces to a plain clear, which is what users expect.
        return new Set();
      }
      const next = new Set(prev);
      for (const t of tenants) next.add(t.id);
      return next;
    });
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function doBulk() {
    if (!showBulkPrompt) return;
    if (reason.trim().length < 3) {
      setError("Reason must be at least 3 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await platformApi.bulkTenantAction({
        action: showBulkPrompt,
        tenantIds: Array.from(selected),
        reason: reason.trim(),
      });
      setShowBulkPrompt(null);
      setReason("");
      setSelected(new Set());
      setFeedback(
        `Applied: ${res.counts.ok} updated, ${res.counts.noop} already in state, ${res.counts.notFound} missing.`,
      );
      router.refresh();
      setTimeout(() => setFeedback(null), 4000);
    } catch (e) {
      if (e instanceof PlatformApiError) {
        setError(e.message || "Bulk action failed.");
      } else {
        setError("Bulk action failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  function doExportCsv() {
    const header = [
      "id",
      "slug",
      "business_name",
      "status",
      "country",
      "timezone",
      "user_count",
      "last_login_at",
      "created_at",
    ];
    const rows = tenants.map((t) => [
      t.id,
      t.slug,
      t.businessName,
      t.status,
      t.country,
      t.timezone,
      String(t.userCount),
      t.lastLoginAt ?? "",
      t.createdAt,
    ]);
    const now = new Date().toISOString().slice(0, 10);
    downloadCsv(`pettahpro-tenants-${now}.csv`, [header, ...rows]);
  }

  const selectedCount = selected.size;

  return (
    <>
      {/* Utility bar: export on the right, keyboard-shortcut legend
          on the left. Sits just above the table. */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-caption text-white/40">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            <kbd className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 font-mono text-[0.65rem] text-white/80">
              /
            </kbd>{" "}
            search
          </span>
          <span>
            <kbd className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 font-mono text-[0.65rem] text-white/80">
              j
            </kbd>
            /
            <kbd className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 font-mono text-[0.65rem] text-white/80">
              k
            </kbd>{" "}
            move
          </span>
          {canBulkAct && (
            <span>
              <kbd className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 font-mono text-[0.65rem] text-white/80">
                x
              </kbd>{" "}
              select
            </span>
          )}
          <span>
            <kbd className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 font-mono text-[0.65rem] text-white/80">
              ↵
            </kbd>{" "}
            open
          </span>
          <span>
            <kbd className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 font-mono text-[0.65rem] text-white/80">
              esc
            </kbd>{" "}
            clear
          </span>
        </div>
        <button
          type="button"
          onClick={doExportCsv}
          className="rounded-md border border-white/10 bg-white/5 px-3 py-1 text-caption text-white/80 hover:bg-white/10"
          title="Export the currently filtered + sorted rows as CSV"
        >
          ⬇ Export CSV
        </button>
      </div>

      {feedback && (
        <p className="mt-3 rounded-md border border-mint/40 bg-mint/10 p-3 text-small text-mint">
          {feedback}
        </p>
      )}

      {canBulkAct && selectedCount > 0 && (
        <div className="sticky top-0 z-10 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-card border border-mint/40 bg-black/80 p-3 backdrop-blur">
          <p className="text-small text-white">
            {selectedCount} tenant{selectedCount === 1 ? "" : "s"} selected
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setShowBulkPrompt("suspend");
                setReason("");
                setError(null);
              }}
              disabled={busy}
              className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-small text-red-200 hover:bg-red-500/20"
            >
              Suspend selected
            </button>
            <button
              type="button"
              onClick={() => {
                setShowBulkPrompt("reactivate");
                setReason("");
                setError(null);
              }}
              disabled={busy}
              className="rounded-md border border-mint/40 bg-mint/10 px-3 py-1.5 text-small text-mint hover:bg-mint/20"
            >
              Reactivate selected
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              disabled={busy}
              className="rounded-md px-3 py-1.5 text-small text-white/60 hover:text-white"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {showBulkPrompt && (
        <div className="mt-3 rounded-card border border-white/10 bg-black/40 p-4">
          <p className="text-small text-white">
            {showBulkPrompt === "suspend" ? "Suspend" : "Reactivate"}{" "}
            {selectedCount} tenant{selectedCount === 1 ? "" : "s"}. A reason is
            required and will be audited against every tenant.
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="e.g. Payment failure — escalation 2026-04-24"
            className="mt-3 block w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-small text-white placeholder:text-white/30 focus:border-mint focus:outline-none"
          />
          {error && (
            <p className="mt-2 text-caption text-red-300">{error}</p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={doBulk}
              disabled={busy || reason.trim().length < 3}
              className={`rounded-md border px-4 py-1.5 text-small ${
                showBulkPrompt === "suspend"
                  ? "border-red-500/40 bg-red-500/20 text-red-100 hover:bg-red-500/30"
                  : "border-mint/40 bg-mint/20 text-white hover:bg-mint/30"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {busy
                ? "Applying…"
                : showBulkPrompt === "suspend"
                  ? `Confirm suspend (${selectedCount})`
                  : `Confirm reactivate (${selectedCount})`}
            </button>
            <button
              type="button"
              onClick={() => setShowBulkPrompt(null)}
              disabled={busy}
              className="rounded-md px-3 py-1.5 text-caption text-white/60 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 overflow-hidden rounded-card border border-white/10">
        <table className="w-full text-small">
          <thead className="bg-black/40 text-caption uppercase tracking-wide text-white/60">
            <tr>
              {canBulkAct && (
                <th className="w-10 px-3 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={toggleAll}
                    aria-label="Select all on page"
                    className="h-4 w-4 cursor-pointer rounded border-white/20 bg-black/40 text-mint focus:ring-mint"
                  />
                </th>
              )}
              <SortHeader
                label="Business"
                sortKey="name"
                currentKey={currentSort}
                currentDir={currentDir}
                baseParams={baseParams}
              />
              <SortHeader
                label="Status"
                sortKey="status"
                currentKey={currentSort}
                currentDir={currentDir}
                baseParams={baseParams}
              />
              <SortHeader
                label="Country"
                sortKey="country"
                currentKey={currentSort}
                currentDir={currentDir}
                baseParams={baseParams}
              />
              <SortHeader
                label="Users"
                sortKey="users"
                currentKey={currentSort}
                currentDir={currentDir}
                baseParams={baseParams}
                align="right"
              />
              <SortHeader
                label="Last active"
                sortKey="lastActive"
                currentKey={currentSort}
                currentDir={currentDir}
                baseParams={baseParams}
              />
              <SortHeader
                label="Created"
                sortKey="created"
                currentKey={currentSort}
                currentDir={currentDir}
                baseParams={baseParams}
              />
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {tenants.length === 0 && (
              <tr>
                <td
                  colSpan={canBulkAct ? 7 : 6}
                  className="px-4 py-16 text-center text-white/50"
                >
                  No tenants match those filters.
                </td>
              </tr>
            )}
            {tenants.map((t, idx) => {
              const pill = statusPill(t.status);
              const isSelected = selected.has(t.id);
              const isFocused = idx === focusIdx;
              return (
                <tr
                  key={t.id}
                  ref={(el) => {
                    rowRefs.current[idx] = el;
                  }}
                  onClick={(e) => {
                    // Clicking the checkbox cell shouldn't open the
                    // tenant — checkbox is its own control.
                    const target = e.target as HTMLElement;
                    if (target.closest('input[type="checkbox"]')) return;
                    if (target.closest("a")) return;
                    setFocusIdx(idx);
                  }}
                  className={`transition ${
                    isFocused
                      ? "bg-white/10 ring-1 ring-inset ring-mint/40"
                      : isSelected
                        ? "bg-mint/5"
                        : "hover:bg-white/5"
                  }`}
                >
                  {canBulkAct && (
                    <td className="w-10 px-3 py-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOne(t.id)}
                        aria-label={`Select ${t.businessName}`}
                        className="h-4 w-4 cursor-pointer rounded border-white/20 bg-black/40 text-mint focus:ring-mint"
                      />
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <Link
                      href={`/platform/tenants/${t.id}`}
                      className="block text-white hover:text-mint"
                    >
                      {highlight(t.businessName, searchTerm)}
                    </Link>
                    <span className="text-caption text-white/40">
                      /{highlight(t.slug, searchTerm)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-caption ${pill.cls}`}
                    >
                      {pill.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-white/70">{t.country}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-white/80">
                    {t.userCount}
                  </td>
                  <td className="px-4 py-3 text-white/70">
                    {relativeTime(t.lastLoginAt)}
                  </td>
                  <td className="px-4 py-3 text-white/70">
                    {formatDate(t.createdAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
