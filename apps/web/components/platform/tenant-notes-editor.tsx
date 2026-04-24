"use client";

// #58 — Tenant notes editor. Ops annotations that should outlive a
// Slack message or a sticky note on someone's monitor.  Writes go
// through PATCH /platform/tenants/:id which audits the change with a
// before/after snippet so we know who wrote what, even after the user
// edits it again.
//
// super_admin + support are both editable; billing is read-only and
// sees the same textarea disabled rather than a different component —
// keeps the "what lives here" signal consistent across roles.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PlatformApiError, platformApi } from "@/lib/platform-api";

const MAX_LENGTH = 4000;

export function TenantNotesEditor({
  tenantId,
  initialNotes,
  readOnly,
}: {
  tenantId: string;
  initialNotes: string | null;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState<string>(initialNotes ?? "");
  const [saved, setSaved] = useState<string>(initialNotes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = notes !== saved;
  const overLimit = notes.length > MAX_LENGTH;

  async function doSave() {
    if (!dirty || overLimit) return;
    setBusy(true);
    setError(null);
    setJustSaved(false);
    try {
      // Empty string → null, so the row shows "no notes" rather than
      // a 0-character note.  The API accepts both but null is cleaner.
      const payload = notes.trim().length === 0 ? null : notes;
      await platformApi.updateTenant(tenantId, { notes: payload });
      setSaved(notes);
      setJustSaved(true);
      // Re-fetch the server component so the updated value makes it
      // into any other sections rendering tenant fields.
      router.refresh();
      // Fade the "Saved" confirmation after a couple of seconds so it
      // doesn't linger visually.
      setTimeout(() => setJustSaved(false), 2500);
    } catch (e) {
      if (e instanceof PlatformApiError) {
        setError(e.message || "Save failed.");
      } else {
        setError("Save failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  function doRevert() {
    setNotes(saved);
    setError(null);
    setJustSaved(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="text-small font-medium text-white">Internal notes</h3>
        <span
          className={`text-caption tabular-nums ${
            overLimit ? "text-red-300" : "text-white/40"
          }`}
        >
          {notes.length.toLocaleString()} / {MAX_LENGTH.toLocaleString()}
        </span>
      </div>
      <p className="mt-1 text-caption text-white/50">
        Visible to platform staff only. Every save is audited.
      </p>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        disabled={readOnly || busy}
        rows={6}
        placeholder={
          readOnly
            ? "No notes. Your role can read but not edit."
            : "Flag anything ops should know: migration status, billing exception, escalation history…"
        }
        className={`mt-3 block w-full rounded-md border bg-black/30 px-3 py-2 text-small text-white placeholder:text-white/30 focus:border-mint focus:outline-none disabled:opacity-60 ${
          overLimit ? "border-red-500/60" : "border-white/10"
        }`}
      />
      {error && (
        <p className="mt-2 rounded-md border border-red-500/40 bg-red-500/10 p-2 text-caption text-red-200">
          {error}
        </p>
      )}
      {!readOnly && (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={doSave}
            disabled={!dirty || overLimit || busy}
            className="rounded-md border border-mint/40 bg-mint/20 px-4 py-1.5 text-small text-white hover:bg-mint/30 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-white/40"
          >
            {busy ? "Saving…" : "Save notes"}
          </button>
          {dirty && (
            <button
              type="button"
              onClick={doRevert}
              disabled={busy}
              className="rounded-md px-3 py-1.5 text-caption text-white/60 hover:text-white"
            >
              Revert
            </button>
          )}
          {justSaved && !dirty && (
            <span className="text-caption text-mint">Saved</span>
          )}
        </div>
      )}
    </div>
  );
}
