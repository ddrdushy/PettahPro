"use client";

import { useState } from "react";
import { Mail, Loader2, Check, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";

export function EmailStatementButton({
  customerId,
  defaultEmail,
  from,
  to,
}: {
  customerId: string;
  defaultEmail: string | null;
  from: string;
  to: string;
}) {
  const [open, setOpen] = useState(false);
  const [toEmail, setToEmail] = useState(defaultEmail ?? "");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<
    | { kind: "ok"; message: string }
    | { kind: "err"; message: string }
    | null
  >(null);

  async function handleSend() {
    setLoading(true);
    setResult(null);
    try {
      const res = await api.emailCustomerStatement(customerId, {
        from,
        to,
        toEmail: toEmail.trim() || undefined,
        messageNote: note.trim() || undefined,
      });
      setResult({
        kind: "ok",
        message: `Statement sent to ${res.result.toEmail ?? toEmail}`,
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to send";
      setResult({ kind: "err", message: msg });
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-secondary text-small inline-flex items-center gap-2"
      >
        <Mail className="h-3.5 w-3.5" aria-hidden />
        Email statement
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-card border-hairline border-border bg-surface-elevated p-4">
      <div className="min-w-[240px]">
        <label htmlFor="email-to" className="block text-caption uppercase tracking-wide text-text-tertiary">
          To
        </label>
        <input
          id="email-to"
          type="email"
          value={toEmail}
          onChange={(e) => setToEmail(e.target.value)}
          placeholder="customer@example.com"
          className="mt-1.5 w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-small text-charcoal focus:border-charcoal focus:outline-none"
        />
      </div>
      <div className="min-w-[320px] flex-1">
        <label htmlFor="email-note" className="block text-caption uppercase tracking-wide text-text-tertiary">
          Optional note
        </label>
        <input
          id="email-note"
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Please settle by month-end"
          className="mt-1.5 w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-small text-charcoal focus:border-charcoal focus:outline-none"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSend}
          disabled={loading || !toEmail.trim()}
          className="btn-primary text-small inline-flex items-center gap-2 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Mail className="h-3.5 w-3.5" aria-hidden />
          )}
          Send now
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setResult(null);
          }}
          className="btn-secondary text-small"
        >
          Cancel
        </button>
      </div>
      {result && (
        <p
          className={`basis-full text-caption ${
            result.kind === "ok" ? "text-emerald-700" : "text-red-700"
          }`}
        >
          {result.kind === "ok" ? (
            <Check className="mr-1 inline h-3 w-3" aria-hidden />
          ) : (
            <X className="mr-1 inline h-3 w-3" aria-hidden />
          )}
          {result.message}
        </p>
      )}
    </div>
  );
}
