"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { api, ApiError, type DeliveryNoteListRow } from "@/lib/api";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Group DNs by customer so the user only sees their own-customer options
// at a time — mixing customers into one invoice is an API-side error and
// would confuse the user.
function groupByCustomer(
  dns: DeliveryNoteListRow[],
): Array<{ customerId: string; customerName: string; dns: DeliveryNoteListRow[] }> {
  const map = new Map<string, { customerId: string; customerName: string; dns: DeliveryNoteListRow[] }>();
  for (const d of dns) {
    const entry = map.get(d.customerId);
    if (entry) entry.dns.push(d);
    else
      map.set(d.customerId, {
        customerId: d.customerId,
        customerName: d.customerName,
        dns: [d],
      });
  }
  return Array.from(map.values()).sort((a, b) => a.customerName.localeCompare(b.customerName));
}

export function BatchInvoiceClient({
  deliveryNotes,
}: {
  deliveryNotes: DeliveryNoteListRow[];
}) {
  const router = useRouter();
  const grouped = useMemo(() => groupByCustomer(deliveryNotes), [deliveryNotes]);
  const [customerId, setCustomerId] = useState<string>(grouped[0]?.customerId ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [issueDate, setIssueDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available = grouped.find((g) => g.customerId === customerId)?.dns ?? [];

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(available.map((d) => d.id)));
  }

  function clearAll() {
    setSelected(new Set());
  }

  async function submit() {
    setError(null);
    const ids = Array.from(selected);
    if (ids.length === 0) {
      setError("Pick at least one delivery note.");
      return;
    }
    setBusy(true);
    try {
      const { invoice } = await api.batchInvoiceFromDeliveryNotes({
        deliveryNoteIds: ids,
        issueDate,
        notes: notes.trim() || undefined,
      });
      router.push(`/app/invoices/${invoice.id}`);
      router.refresh();
    } catch (err) {
      const msg = err instanceof ApiError ? friendlyError(err) : "Couldn't create invoice.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  if (grouped.length === 0) {
    return (
      <section className="mt-8 rounded-card border-hairline border-border bg-surface-elevated p-6 text-body text-text-secondary">
        No delivered, un-invoiced delivery notes right now. Deliver a DN first, then come back here to roll it up.
      </section>
    );
  }

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[2fr_1fr]">
      <section className="rounded-card border-hairline border-border bg-surface-elevated">
        <div className="flex items-center justify-between border-b-hairline border-border px-6 py-4">
          <div>
            <label className="block text-small font-medium text-charcoal">Customer</label>
            <select
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                setSelected(new Set());
              }}
              className="mt-1.5 w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-body text-charcoal"
            >
              {grouped.map((g) => (
                <option key={g.customerId} value={g.customerId}>
                  {g.customerName} ({g.dns.length} DN{g.dns.length === 1 ? "" : "s"})
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={selectAll} className="btn-secondary text-small">
              Select all
            </button>
            <button type="button" onClick={clearAll} className="btn-secondary text-small">
              Clear
            </button>
          </div>
        </div>

        <table className="w-full text-small">
          <thead className="bg-surface-recessed">
            <tr className="text-caption uppercase tracking-wide text-text-tertiary">
              <th className="w-10 px-3 py-3" />
              <th className="px-3 py-3 text-left">DN #</th>
              <th className="px-3 py-3 text-left">Delivered</th>
              <th className="px-3 py-3 text-left">Carrier</th>
              <th className="px-3 py-3 text-left">Tracking</th>
            </tr>
          </thead>
          <tbody className="divide-y-hairline divide-border">
            {available.map((d) => {
              const checked = selected.has(d.id);
              return (
                <tr
                  key={d.id}
                  className={`cursor-pointer ${checked ? "bg-mint-surface/30" : ""}`}
                  onClick={() => toggle(d.id)}
                >
                  <td className="px-3 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(d.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4"
                    />
                  </td>
                  <td className="px-3 py-3 text-charcoal tabular-nums">{d.dnNumber ?? "—"}</td>
                  <td className="px-3 py-3 text-text-secondary">{d.deliveryDate}</td>
                  <td className="px-3 py-3 text-text-secondary">{d.carrier ?? ""}</td>
                  <td className="px-3 py-3 text-text-secondary">{d.trackingNumber ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <aside className="rounded-card border-hairline border-border bg-surface-elevated p-6">
        <h2 className="text-body font-medium text-charcoal">Invoice header</h2>
        <div className="mt-4 space-y-4">
          <label className="block text-small">
            <span className="mb-1 block text-caption text-text-secondary">Issue date</span>
            <input
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              className="w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-body text-charcoal"
            />
          </label>
          <label className="block text-small">
            <span className="mb-1 block text-caption text-text-secondary">Notes (optional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Defaults to a list of the rolled-up DN numbers."
              className="w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2 text-body text-charcoal"
            />
          </label>
          <div className="rounded-md bg-surface-recessed p-3 text-caption text-text-secondary">
            <p>
              Each DN line becomes one invoice line (prefixed with the DN number). Unit prices
              come from the item's current sell price — review and tweak the draft before
              posting.
            </p>
          </div>
          {error ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-caption text-red-700">{error}</p>
          ) : null}
          <button
            type="button"
            onClick={submit}
            disabled={busy || selected.size === 0}
            className="btn-primary w-full disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Create invoice from {selected.size} DN{selected.size === 1 ? "" : "s"}
          </button>
        </div>
      </aside>
    </div>
  );
}

function friendlyError(err: ApiError): string {
  switch (err.code) {
    case "DN_MIXED_CUSTOMERS":
      return "All selected DNs must be for the same customer.";
    case "DN_ALREADY_INVOICED":
      return "One of the selected DNs is already on an invoice. Refresh the list.";
    case "DN_NOT_DELIVERED":
      return "Only delivered DNs can be invoiced.";
    case "DN_NO_LINES":
      return "The selected DNs have no lines.";
    case "DN_NOT_FOUND":
      return "A selected DN couldn't be found. Refresh the list.";
    case "CUSTOMER_NOT_FOUND":
      return "That customer no longer exists.";
    default:
      return err.message;
  }
}
