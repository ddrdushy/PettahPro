"use client";

// #59 — Saved views for /platform/tenants + /platform/audit.
//
// Renders as a row of pill chips above the filter form. Each chip
// links to the saved querystring. A separate "Save current view"
// button prompts for a name and POSTs the current querystring back.
// Views are personal (per platform user) so we don't bother with
// share URLs — the filter string is already a share URL.
//
// Fetches on mount to keep the server page a pure read. Errors
// swallow silently to a muted line — saved views are a nicety, not
// the product.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PlatformApiError,
  platformApi,
  type PlatformSavedView,
  type PlatformSavedViewScope,
} from "@/lib/platform-api";

export function SavedViewsBar({
  scope,
  pageBasePath,
  currentQueryString,
}: {
  scope: PlatformSavedViewScope;
  pageBasePath: string;
  currentQueryString: string;
}) {
  const router = useRouter();
  const [views, setViews] = useState<PlatformSavedView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const { views: rows } = await platformApi.listSavedViews(scope);
      setViews(rows);
    } catch {
      setViews([]);
    }
  }

  useEffect(() => {
    void load();
    // scope is stable per page — tenants page never switches to audit
    // without a full reload. No need to re-fetch on route change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  async function doSave() {
    const name = window.prompt(
      "Name for this view (visible only to you):",
      "",
    );
    if (!name || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await platformApi.createSavedView({
        scope,
        name: name.trim(),
        queryString: currentQueryString,
      });
      await load();
    } catch (e) {
      if (e instanceof PlatformApiError && e.code === "NAME_TAKEN") {
        setError("You already have a view with that name.");
      } else if (e instanceof PlatformApiError) {
        setError(e.message || "Could not save view.");
      } else {
        setError("Could not save view.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function doDelete(id: string, name: string) {
    if (!window.confirm(`Delete saved view "${name}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      await platformApi.deleteSavedView(id);
      await load();
    } catch {
      setError("Could not delete view.");
    } finally {
      setBusy(false);
    }
  }

  function applyView(qs: string) {
    // Empty qs → bare page (no filters). Use replace() so the chip
    // doesn't pile up in history on repeated clicks.
    const href = qs ? `${pageBasePath}?${qs}` : pageBasePath;
    router.push(href);
  }

  const hasCurrentFilter = currentQueryString.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-caption uppercase tracking-wide text-white/40">
        Saved views
      </span>
      {views === null ? (
        <span className="text-caption text-white/30">Loading…</span>
      ) : views.length === 0 ? (
        <span className="text-caption text-white/30">None yet</span>
      ) : (
        views.map((v) => (
          <span
            key={v.id}
            className="group inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-caption text-white/80 hover:border-mint/40 hover:bg-mint/10 hover:text-white"
          >
            <button
              type="button"
              onClick={() => applyView(v.queryString)}
              className="outline-none"
              title={v.queryString ? `?${v.queryString}` : "No filters"}
            >
              {v.name}
            </button>
            <button
              type="button"
              onClick={() => doDelete(v.id, v.name)}
              disabled={busy}
              title="Delete this view"
              className="rounded-full px-1 text-white/30 opacity-0 transition group-hover:opacity-100 hover:text-red-300"
            >
              ×
            </button>
          </span>
        ))
      )}
      <button
        type="button"
        onClick={doSave}
        disabled={busy || !hasCurrentFilter}
        title={
          hasCurrentFilter
            ? "Save the current filters as a view"
            : "Apply a filter first"
        }
        className="ml-auto inline-flex items-center gap-1 rounded-full border border-mint/30 bg-mint/10 px-3 py-1 text-caption text-mint hover:bg-mint/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-white/40"
      >
        + Save current view
      </button>
      {error && (
        <span className="basis-full text-caption text-red-300">{error}</span>
      )}
    </div>
  );
}
