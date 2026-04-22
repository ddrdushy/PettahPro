"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { api, ApiError, type Customer, type Item, type TaxCode } from "@/lib/api";
import { formatLKR } from "@/lib/format";
import { PageHeader } from "@/components/app/page-header";

interface LineDraft {
  id: string;
  itemId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPct: string;
  taxCodeId: string;
}

function emptyLine(): LineDraft {
  return {
    id: crypto.randomUUID(),
    itemId: "",
    description: "",
    quantity: "1",
    unitPrice: "0",
    discountPct: "0",
    taxCodeId: "",
  };
}

function toInt(cents: string): number {
  const v = Number(cents);
  return Number.isFinite(v) ? Math.max(0, Math.round(v * 100)) : 0;
}

function toNum(n: string): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

export function NewInvoiceClient({
  customers,
  items,
  taxCodes,
}: {
  customers: Customer[];
  items: Item[];
  taxCodes: TaxCode[];
}) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState("");
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [reference, setReference] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [notes, setNotes] = useState("");
  // Multi-currency (v1). Currency auto-follows the picked customer's
  // default. Fx rate is 1.0 for LKR and required when non-LKR — but we
  // don't hard-block empty because the form stays usable if the user
  // hasn't captured a rate yet; the back-end defaults to 1.0.
  const [currency, setCurrency] = useState("LKR");
  const [fxRate, setFxRate] = useState("1");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === customerId) ?? null,
    [customers, customerId],
  );
  // Snap currency to the customer's default whenever customer changes and
  // the user hasn't manually overridden. We detect "manually overridden"
  // as simply: whatever's typed in the input wins once it's set. Using a
  // state-setter effect would be wrong here — we just update synchronously
  // when customer changes via the select handler below.
  const effectiveDueDate = useMemo(() => {
    if (dueDate) return dueDate;
    if (!selectedCustomer) return "";
    const base = new Date(issueDate);
    base.setDate(base.getDate() + (selectedCustomer.paymentTermsDays ?? 0));
    return base.toISOString().slice(0, 10);
  }, [dueDate, issueDate, selectedCustomer]);

  const computed = useMemo(() => {
    let subtotal = 0;
    let discount = 0;
    let tax = 0;
    const perLine = lines.map((l) => {
      const qty = toNum(l.quantity);
      const unit = toInt(l.unitPrice);
      const subLine = Math.round(qty * unit);
      const discPct = Math.min(10_000, Math.max(0, Math.round(toNum(l.discountPct) * 100)));
      const discLine = Math.round((subLine * discPct) / 10_000);
      const taxable = subLine - discLine;
      const taxRate = taxCodes.find((t) => t.id === l.taxCodeId)?.rateBps ?? 0;
      const taxLine = Math.round((taxable * taxRate) / 10_000);
      const total = taxable + taxLine;
      subtotal += subLine;
      discount += discLine;
      tax += taxLine;
      return { subLine, discLine, taxLine, total };
    });
    return {
      perLine,
      subtotal,
      discount,
      tax,
      total: subtotal - discount + tax,
    };
  }, [lines, taxCodes]);

  function addLine() {
    setLines((r) => [...r, emptyLine()]);
  }

  function removeLine(id: string) {
    setLines((r) => (r.length <= 1 ? r : r.filter((l) => l.id !== id)));
  }

  function patchLine(id: string, patch: Partial<LineDraft>) {
    setLines((r) => r.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function onPickItem(lineId: string, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    if (!item) {
      patchLine(lineId, { itemId: "" });
      return;
    }
    patchLine(lineId, {
      itemId,
      description: item.name,
      unitPrice: (item.sellPriceCents / 100).toFixed(2),
    });
  }

  async function onSave(alsoPost: boolean) {
    setError(null);

    if (!customerId) {
      setError("Pick a customer first.");
      return;
    }
    const validLines = lines.filter(
      (l) => l.description.trim() && toNum(l.quantity) > 0,
    );
    if (validLines.length === 0) {
      setError("Add at least one line with a description and quantity.");
      return;
    }

    setBusy(true);
    try {
      const { invoice } = await api.createInvoice({
        customerId,
        issueDate,
        dueDate: effectiveDueDate || undefined,
        currency: currency.toUpperCase(),
        fxRate: Number(fxRate) || 1,
        reference: reference.trim() || undefined,
        poNumber: poNumber.trim() || undefined,
        notes: notes.trim() || undefined,
        lines: validLines.map((l) => ({
          itemId: l.itemId || undefined,
          description: l.description.trim(),
          quantity: toNum(l.quantity),
          unitPriceCents: toInt(l.unitPrice),
          discountPctBps: Math.round(toNum(l.discountPct) * 100),
          taxCodeId: l.taxCodeId || undefined,
        })),
      });

      if (alsoPost) {
        await api.postInvoice(invoice.id);
      }
      router.push(`/app/invoices/${invoice.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the invoice.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/invoices" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to invoices
        </Link>
      </div>

      <PageHeader eyebrow="Sell" title="New invoice" description="Build the lines, review totals, save as draft or post straight to the ledger." />

      <div className="mt-8 grid gap-8 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-8">
          {/* Header */}
          <section className="rounded-card border-hairline border-border bg-surface-elevated p-6">
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className="block text-small font-medium text-charcoal">Customer</label>
                <select
                  value={customerId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setCustomerId(id);
                    const picked = customers.find((c) => c.id === id);
                    if (picked?.currency) setCurrency(picked.currency);
                  }}
                  className="mt-1.5 w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body text-charcoal focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
                >
                  <option value="">Select a customer…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {customers.length === 0 && (
                  <p className="mt-1.5 text-caption text-text-tertiary">
                    No customers yet.{" "}
                    <Link href="/app/customers" className="underline">
                      Add one
                    </Link>
                    .
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-small font-medium text-charcoal">Issue date</label>
                  <input
                    type="date"
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                    className="mt-1.5 w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body text-charcoal focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
                  />
                </div>
                <div>
                  <label className="block text-small font-medium text-charcoal">Due date</label>
                  <input
                    type="date"
                    value={dueDate || effectiveDueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="mt-1.5 w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body text-charcoal focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
                  />
                </div>
              </div>
              <div>
                <label className="block text-small font-medium text-charcoal">Reference</label>
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Internal reference"
                  className="mt-1.5 w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body text-charcoal placeholder:text-text-tertiary focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
                />
              </div>
              <div>
                <label className="block text-small font-medium text-charcoal">Customer PO</label>
                <input
                  value={poNumber}
                  onChange={(e) => setPoNumber(e.target.value)}
                  placeholder="If provided"
                  className="mt-1.5 w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body text-charcoal placeholder:text-text-tertiary focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-small font-medium text-charcoal">Currency</label>
                  <input
                    list="invoice-currencies"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
                    maxLength={3}
                    className="mt-1.5 w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body uppercase text-charcoal focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
                  />
                  <datalist id="invoice-currencies">
                    <option value="LKR" />
                    <option value="USD" />
                    <option value="EUR" />
                    <option value="GBP" />
                    <option value="AUD" />
                    <option value="INR" />
                    <option value="SGD" />
                    <option value="AED" />
                  </datalist>
                </div>
                <div>
                  <label className="block text-small font-medium text-charcoal">
                    FX rate <span className="text-caption text-text-tertiary">(to LKR)</span>
                  </label>
                  <input
                    type="number"
                    step="0.000001"
                    value={fxRate}
                    onChange={(e) => setFxRate(e.target.value)}
                    disabled={currency.toUpperCase() === "LKR"}
                    className="mt-1.5 w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body text-charcoal focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal disabled:bg-surface-recessed"
                  />
                  {currency.toUpperCase() !== "LKR" && (
                    <p className="mt-1 text-caption text-text-tertiary">
                      1 {currency.toUpperCase()} = {fxRate || "?"} LKR. Totals still post in LKR. <Link href="/app/settings/fx-rates" className="underline">Manage rates</Link>
                    </p>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Lines */}
          <section className="rounded-card border-hairline border-border bg-surface-elevated">
            <div className="flex items-center justify-between border-b-hairline border-border px-6 py-4">
              <div>
                <h2 className="text-h3 text-charcoal">Lines</h2>
                <p className="text-caption text-text-tertiary">Quantity × unit price − discount + tax = line total</p>
              </div>
              <button type="button" onClick={addLine} className="btn-secondary text-small">
                <Plus className="h-3.5 w-3.5" aria-hidden /> Add line
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-small">
                <thead className="bg-surface-recessed">
                  <tr className="text-caption uppercase tracking-wide text-text-tertiary">
                    <th className="w-10 px-3 py-3 text-center">#</th>
                    <th className="px-3 py-3 text-left">Item / description</th>
                    <th className="w-24 px-3 py-3 text-right">Qty</th>
                    <th className="w-32 px-3 py-3 text-right">Unit price</th>
                    <th className="w-20 px-3 py-3 text-right">Disc %</th>
                    <th className="w-28 px-3 py-3 text-left">Tax</th>
                    <th className="w-32 px-3 py-3 text-right">Line total</th>
                    <th className="w-10 px-3 py-3" aria-hidden />
                  </tr>
                </thead>
                <tbody className="divide-y-hairline divide-border">
                  {lines.map((l, idx) => {
                    const c = computed.perLine[idx];
                    return (
                      <tr key={l.id} className="align-top">
                        <td className="px-3 py-3 text-center text-caption text-text-tertiary">{idx + 1}</td>
                        <td className="px-3 py-3">
                          <select
                            value={l.itemId}
                            onChange={(e) => onPickItem(l.id, e.target.value)}
                            className="mb-1.5 w-full rounded-md border-hairline border-border bg-surface-elevated px-2 py-1.5 text-small text-charcoal focus:border-charcoal focus:outline-none"
                          >
                            <option value="">(Custom description)</option>
                            {items.map((it) => (
                              <option key={it.id} value={it.id}>
                                {it.sku ? `${it.sku} · ` : ""}
                                {it.name}
                              </option>
                            ))}
                          </select>
                          <input
                            value={l.description}
                            onChange={(e) => patchLine(l.id, { description: e.target.value })}
                            placeholder="What are you charging for?"
                            className="w-full rounded-md border-hairline border-border bg-surface-elevated px-2 py-1.5 text-small text-charcoal placeholder:text-text-tertiary focus:border-charcoal focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-3">
                          <input
                            type="number"
                            min={0}
                            step="0.0001"
                            value={l.quantity}
                            onChange={(e) => patchLine(l.id, { quantity: e.target.value })}
                            className="w-full rounded-md border-hairline border-border bg-surface-elevated px-2 py-1.5 text-right text-small tabular-nums text-charcoal focus:border-charcoal focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-3">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={l.unitPrice}
                            onChange={(e) => patchLine(l.id, { unitPrice: e.target.value })}
                            className="w-full rounded-md border-hairline border-border bg-surface-elevated px-2 py-1.5 text-right text-small tabular-nums text-charcoal focus:border-charcoal focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-3">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step="0.01"
                            value={l.discountPct}
                            onChange={(e) => patchLine(l.id, { discountPct: e.target.value })}
                            className="w-full rounded-md border-hairline border-border bg-surface-elevated px-2 py-1.5 text-right text-small tabular-nums text-charcoal focus:border-charcoal focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-3">
                          <select
                            value={l.taxCodeId}
                            onChange={(e) => patchLine(l.id, { taxCodeId: e.target.value })}
                            className="w-full rounded-md border-hairline border-border bg-surface-elevated px-2 py-1.5 text-small text-charcoal focus:border-charcoal focus:outline-none"
                          >
                            <option value="">No tax</option>
                            {taxCodes.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.code}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-small text-charcoal">
                          {c ? formatLKR(c.total) : formatLKR(0)}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => removeLine(l.id)}
                            aria-label="Remove line"
                            disabled={lines.length <= 1}
                            className="text-text-tertiary transition-colors hover:text-danger disabled:opacity-30"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Notes */}
          <section className="rounded-card border-hairline border-border bg-surface-elevated p-6">
            <label className="block text-small font-medium text-charcoal">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Any context for the customer — delivery details, payment account, etc."
              className="mt-1.5 w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body text-charcoal placeholder:text-text-tertiary focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
            />
          </section>
        </div>

        {/* Totals sidebar */}
        <aside className="space-y-6">
          <div className="sticky top-24 rounded-card border-hairline border-border bg-surface-elevated p-6">
            <p className="text-caption uppercase tracking-wide text-text-tertiary">Totals</p>
            <dl className="mt-4 space-y-2 text-small">
              <Row label="Subtotal" value={computed.subtotal} />
              {computed.discount > 0 && <Row label="Discount" value={-computed.discount} />}
              <Row label="Tax" value={computed.tax} />
              <div className="border-t-hairline border-border pt-2">
                <Row label="Total" value={computed.total} emphasize />
              </div>
            </dl>

            {error && (
              <div className="mt-5 rounded-md border-hairline border-danger/40 bg-danger-bg/50 p-3 text-small text-danger">
                {error}
              </div>
            )}

            <div className="mt-6 flex flex-col gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => onSave(true)}
                className="btn-primary w-full"
              >
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Saving…
                  </>
                ) : (
                  "Save and post"
                )}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onSave(false)}
                className="btn-secondary w-full"
              >
                Save as draft
              </button>
            </div>

            <p className="mt-4 text-caption text-text-tertiary">
              Posting creates a balanced journal entry: <br />
              <span className="tabular-nums">
                DR Accounts receivable · CR Sales · CR VAT payable
              </span>
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}

function Row({ label, value, emphasize }: { label: string; value: number; emphasize?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className={emphasize ? "font-medium text-charcoal" : "text-text-secondary"}>{label}</dt>
      <dd className={`tabular-nums ${emphasize ? "text-h3 text-charcoal" : "text-charcoal"}`}>
        {formatLKR(value)}
      </dd>
    </div>
  );
}
