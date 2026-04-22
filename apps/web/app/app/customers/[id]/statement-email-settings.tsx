"use client";

import { useState } from "react";
import { Loader2, Save, AlertCircle } from "lucide-react";
import { api, ApiError } from "@/lib/api";

export function StatementEmailSettings({
  customerId,
  customerEmail,
  initialAuto,
  initialDay,
}: {
  customerId: string;
  customerEmail: string | null;
  initialAuto: boolean;
  initialDay: number | null;
}) {
  const [auto, setAuto] = useState(initialAuto);
  const [day, setDay] = useState<number>(initialDay ?? 1);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  const hasEmail = !!customerEmail?.trim();
  const dirty = auto !== initialAuto || (auto && day !== (initialDay ?? 1));

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      await api.updateCustomerStatementEmailSettings(customerId, {
        autoStatementEmail: auto,
        statementEmailDay: auto ? day : null,
      });
      setMsg({ kind: "ok", text: auto ? "Auto-send enabled" : "Auto-send disabled" });
      // Optimistic — we don't re-fetch, the values we just saved are authoritative
    } catch (err) {
      const text = err instanceof ApiError ? err.message : "Save failed";
      setMsg({ kind: "err", text });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-card border-hairline border-border bg-surface-elevated p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-body font-medium text-charcoal">Auto-send statements</h2>
        <span className="text-caption text-text-tertiary">Monthly</span>
      </div>
      <p className="mt-1 text-caption text-text-secondary">
        Email the statement of account to this customer every month on a fixed day.
      </p>

      {!hasEmail && (
        <div className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 p-3 text-caption text-amber-800">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden />
          <span>
            No email address on this customer. Add one above before enabling auto-send.
          </span>
        </div>
      )}

      <label className="mt-4 flex items-center gap-2 text-small text-charcoal">
        <input
          type="checkbox"
          checked={auto}
          onChange={(e) => setAuto(e.target.checked)}
          disabled={!hasEmail}
          className="h-4 w-4 rounded border-border-emphasis text-charcoal focus:ring-charcoal"
        />
        <span>Automatically email statement</span>
      </label>

      {auto && (
        <div className="mt-3 flex items-end gap-3">
          <div>
            <label htmlFor="day" className="block text-caption uppercase tracking-wide text-text-tertiary">
              Day of month
            </label>
            <select
              id="day"
              value={day}
              onChange={(e) => setDay(Number(e.target.value))}
              className="mt-1.5 rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-small text-charcoal focus:border-charcoal focus:outline-none"
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <p className="flex-1 text-caption text-text-tertiary">
            Statement covers the prior calendar month on day 1, otherwise the
            trailing 30 days. Limited to days 1–28 to cover every month.
          </p>
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="btn-primary text-small inline-flex items-center gap-2 disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Save className="h-3.5 w-3.5" aria-hidden />
          )}
          Save
        </button>
        {msg && (
          <span
            className={`text-caption ${msg.kind === "ok" ? "text-emerald-700" : "text-red-700"}`}
          >
            {msg.text}
          </span>
        )}
      </div>
    </section>
  );
}
