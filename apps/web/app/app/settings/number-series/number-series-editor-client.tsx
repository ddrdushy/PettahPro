"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { api, ApiError, type NumberSeries, type NumberSeriesScope } from "@/lib/api";

// Client-side renderer — mirrors the SQL helper exactly so users see the
// correct preview without waiting on a round-trip. Server is still the source
// of truth: on save, the server recomputes and persists.
function renderPreview(
  template: string,
  prefix: string,
  padWidth: number,
  nextCounter: number,
  today: Date,
): string {
  const yyyy = String(today.getFullYear());
  const yy = yyyy.slice(-2);
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const mmm = today.toLocaleString("en", { month: "short" });
  const month = today.toLocaleString("en", { month: "long" });
  const seq = String(nextCounter).padStart(Math.max(padWidth, 1), "0");
  return template
    .replaceAll("{PREFIX}", prefix)
    .replaceAll("{YYYY}", yyyy)
    .replaceAll("{YY}", yy)
    .replaceAll("{MM}", mm)
    .replaceAll("{MMM}", mmm)
    .replaceAll("{MONTH}", month)
    .replaceAll("{SEQ}", seq);
}

const PRESETS: Array<{ label: string; template: string }> = [
  { label: "PFX-2026-0042", template: "{PREFIX}-{YYYY}-{SEQ}" },
  { label: "PFX-202604-0042", template: "{PREFIX}-{YYYY}{MM}-{SEQ}" },
  { label: "PFX/26/0042", template: "{PREFIX}/{YY}/{SEQ}" },
  { label: "PFX26-0042", template: "{PREFIX}{YY}-{SEQ}" },
  { label: "PFX-0042", template: "{PREFIX}-{SEQ}" },
];

export function NumberSeriesEditor({ initial }: { initial: NumberSeries }) {
  const router = useRouter();
  const [prefix, setPrefix] = useState(initial.prefix);
  const [template, setTemplate] = useState(initial.template);
  const [scope, setScope] = useState<NumberSeriesScope>(initial.scope);
  const [padWidth, setPadWidth] = useState<number>(initial.padWidth);
  const [counter, setCounter] = useState<number>(initial.counter);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const dirty =
    prefix !== initial.prefix ||
    template !== initial.template ||
    scope !== initial.scope ||
    padWidth !== initial.padWidth ||
    counter !== initial.counter;

  const preview = useMemo(() => {
    try {
      return renderPreview(template, prefix, padWidth, counter + 1, new Date());
    } catch {
      return "—";
    }
  }, [template, prefix, padWidth, counter]);

  const templateOk = template.includes("{SEQ}");
  const counterOk = counter >= initial.counter;

  // If user picks a preset, fill the template.
  function applyPreset(t: string) {
    setTemplate(t);
  }

  // Ref keeps the in-flight request cancellable across fast typing (not
  // strictly needed — the preview is client-rendered — but left here in
  // case we swap back to the server preview for exotic locales).
  const latestPreviewReq = useRef(0);
  useEffect(() => {
    latestPreviewReq.current += 1;
  }, [template, prefix, padWidth, counter]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!templateOk) return setError("Template must contain {SEQ}.");
    if (!counterOk) return setError(`Counter can only move forward — current is ${initial.counter}.`);

    setBusy(true);
    try {
      await api.updateNumberSeries(initial.sequenceName, {
        prefix,
        template,
        scope,
        padWidth,
        counter,
      });
      setSavedAt(new Date());
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={save}
      className="rounded-card border-hairline border-border bg-surface-elevated p-5"
    >
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h3 className="text-body font-medium text-charcoal">
            {initial.displayName ?? initial.sequenceName}
          </h3>
          <p className="text-caption text-text-tertiary">
            <code>{initial.sequenceName}</code> · counter {initial.counter}
          </p>
        </div>
        <div className="text-right">
          <p className="text-caption uppercase tracking-wide text-text-tertiary">Next number</p>
          <p className="font-mono text-body text-charcoal tabular-nums">{preview}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-[120px_1fr_160px_100px_140px]">
        <div>
          <Label htmlFor={`${initial.sequenceName}-prefix`}>Prefix</Label>
          <input
            id={`${initial.sequenceName}-prefix`}
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            maxLength={32}
            className="input mt-1.5 w-full font-mono tabular-nums"
          />
        </div>
        <div>
          <Label htmlFor={`${initial.sequenceName}-template`}>Template</Label>
          <input
            id={`${initial.sequenceName}-template`}
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            maxLength={128}
            className={`input mt-1.5 w-full font-mono tabular-nums ${
              templateOk ? "" : "border-danger"
            }`}
          />
          <div className="mt-1.5 flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.template}
                type="button"
                onClick={() => applyPreset(p.template)}
                className="btn-ghost rounded-full px-2 py-0.5 text-caption text-text-tertiary hover:bg-surface-recessed"
                title={p.template}
              >
                {p.label}
              </button>
            ))}
          </div>
          {!templateOk && (
            <p className="mt-1 text-caption text-danger">Template must contain {"{SEQ}"}.</p>
          )}
        </div>
        <div>
          <Label htmlFor={`${initial.sequenceName}-scope`}>Reset period</Label>
          <select
            id={`${initial.sequenceName}-scope`}
            value={scope}
            onChange={(e) => setScope(e.target.value as NumberSeriesScope)}
            className="input mt-1.5 w-full"
          >
            <option value="year">Yearly (Jan 1)</option>
            <option value="month">Monthly</option>
            <option value="global">Never</option>
          </select>
        </div>
        <div>
          <Label htmlFor={`${initial.sequenceName}-pad`}>Pad width</Label>
          <input
            id={`${initial.sequenceName}-pad`}
            type="number"
            min={1}
            max={10}
            value={padWidth}
            onChange={(e) => setPadWidth(Number(e.target.value) || 1)}
            className="input mt-1.5 w-full tabular-nums"
          />
        </div>
        <div>
          <Label htmlFor={`${initial.sequenceName}-counter`}>Counter (from)</Label>
          <input
            id={`${initial.sequenceName}-counter`}
            type="number"
            min={initial.counter}
            value={counter}
            onChange={(e) => setCounter(Number(e.target.value) || 0)}
            className={`input mt-1.5 w-full tabular-nums ${counterOk ? "" : "border-danger"}`}
          />
          <p className="mt-1 text-caption text-text-tertiary">
            Forward-only. Next = this + 1.
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || !dirty || !templateOk || !counterOk}
          className="btn-primary inline-flex items-center gap-2 text-small disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          Save
        </button>
        {savedAt && !dirty && !busy && (
          <span className="inline-flex items-center gap-1.5 text-caption text-mint-dark">
            <Check className="h-3.5 w-3.5" aria-hidden />
            Saved
          </span>
        )}
        {error && <span className="text-caption text-danger">{error}</span>}
      </div>
    </form>
  );
}

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-caption uppercase tracking-wide text-text-tertiary">
      {children}
    </label>
  );
}
