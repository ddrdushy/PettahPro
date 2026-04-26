"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import React, { useMemo, useState } from "react";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import {
  api,
  ApiError,
  type Account,
  type BillChargeAllocationMethod,
  type BillChargeKind,
  type CostCenter,
  type Item,
  type Supplier,
  type TaxCode,
} from "@/lib/api";
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
  expenseAccountId: string;
  // Tracking (roadmap #34). Populated only when the picked item has
  // `trackBatches`/`trackExpiry` (batch block) or `trackSerials`
  // (serials block) on. Server enforces required-ness at post; UI
  // only guides.
  batchNumber: string;
  mfgDate: string;
  expiryDate: string;
  batchNotes: string;
  serialNumbersText: string;
}

interface ChargeDraft {
  id: string;
  kind: BillChargeKind;
  description: string;
  amount: string;
}

const CHARGE_KIND_LABELS: Record<BillChargeKind, string> = {
  freight: "Freight",
  insurance: "Insurance",
  customs: "Customs duty",
  clearing: "Clearing / forwarding",
  loading: "Loading / unloading",
  other: "Other",
};

function emptyLine(): LineDraft {
  return {
    id: crypto.randomUUID(),
    itemId: "",
    description: "",
    quantity: "1",
    unitPrice: "0",
    discountPct: "0",
    taxCodeId: "",
    expenseAccountId: "",
    batchNumber: "",
    mfgDate: "",
    expiryDate: "",
    batchNotes: "",
    serialNumbersText: "",
  };
}

function parseSerials(raw: string): string[] {
  return raw
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function emptyCharge(): ChargeDraft {
  return {
    id: crypto.randomUUID(),
    kind: "freight",
    description: "",
    amount: "0",
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

export function NewBillClient({
  suppliers,
  items,
  taxCodes,
  expenseAccounts,
  costCenters,
}: {
  suppliers: Supplier[];
  items: Item[];
  taxCodes: TaxCode[];
  expenseAccounts: Account[];
  costCenters: CostCenter[];
}) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState("");
  const [supplierBillNumber, setSupplierBillNumber] = useState("");
  const [billDate, setBillDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [currency, setCurrency] = useState("LKR");
  const [fxRate, setFxRate] = useState("1");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [charges, setCharges] = useState<ChargeDraft[]>([]);
  const [allocationMethod, setAllocationMethod] =
    useState<BillChargeAllocationMethod>("value");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedSupplier = useMemo(
    () => suppliers.find((s) => s.id === supplierId) ?? null,
    [suppliers, supplierId],
  );
  const effectiveDueDate = useMemo(() => {
    if (dueDate) return dueDate;
    if (!selectedSupplier) return "";
    const base = new Date(billDate);
    base.setDate(base.getDate() + (selectedSupplier.paymentTermsDays ?? 0));
    return base.toISOString().slice(0, 10);
  }, [dueDate, billDate, selectedSupplier]);

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
      const item = items.find((i) => i.id === l.itemId);
      const isStocked = item?.trackInventory === true;
      subtotal += subLine;
      discount += discLine;
      tax += taxLine;
      return { subLine, discLine, taxLine, total, net: taxable, qty, isStocked };
    });

    // Mirrors allocateCharges() on the server: pro-rata across stocked
    // lines by value or quantity, largest-remainder distribution so the
    // sum always matches chargesTotal exactly.
    const chargesTotal = charges.reduce((s, c) => s + toInt(c.amount), 0);
    const stockedIdx = perLine
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.isStocked);
    const allocatedPerLine = perLine.map(() => 0);
    let unallocated = 0;
    if (chargesTotal > 0) {
      if (stockedIdx.length === 0) {
        unallocated = chargesTotal;
      } else {
        const weights = stockedIdx.map(({ l }) =>
          allocationMethod === "quantity" ? Math.max(l.qty, 0) : Math.max(l.net, 0),
        );
        const totalW = weights.reduce((s, w) => s + w, 0);
        if (totalW <= 0) {
          const even = Math.floor(chargesTotal / stockedIdx.length);
          let rem = chargesTotal - even * stockedIdx.length;
          for (const { i } of stockedIdx) {
            allocatedPerLine[i] = even + (rem > 0 ? 1 : 0);
            if (rem > 0) rem -= 1;
          }
        } else {
          const raw = weights.map((w) => (chargesTotal * w) / totalW);
          const floors = raw.map((r) => Math.floor(r));
          const remainders = raw.map((r, idx) => r - floors[idx]!);
          const distributed = floors.reduce((s, v) => s + v, 0);
          let leftover = chargesTotal - distributed;
          const ordered = remainders
            .map((r, idx) => ({ idx, r }))
            .sort((a, b) => b.r - a.r);
          const extra = new Array(weights.length).fill(0);
          for (const { idx } of ordered) {
            if (leftover <= 0) break;
            extra[idx] = 1;
            leftover -= 1;
          }
          for (let k = 0; k < stockedIdx.length; k++) {
            const { i } = stockedIdx[k]!;
            allocatedPerLine[i] = (floors[k] ?? 0) + (extra[k] ?? 0);
          }
        }
      }
    }

    return {
      perLine,
      allocatedPerLine,
      chargesTotal,
      unallocated,
      subtotal,
      discount,
      tax,
      total: subtotal - discount + tax + chargesTotal,
    };
  }, [lines, taxCodes, items, charges, allocationMethod]);

  function addLine() {
    setLines((r) => [...r, emptyLine()]);
  }
  function removeLine(id: string) {
    setLines((r) => (r.length <= 1 ? r : r.filter((l) => l.id !== id)));
  }
  function patchLine(id: string, patch: Partial<LineDraft>) {
    setLines((r) => r.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  function addCharge() {
    setCharges((r) => [...r, emptyCharge()]);
  }
  function removeCharge(id: string) {
    setCharges((r) => r.filter((c) => c.id !== id));
  }
  function patchCharge(id: string, patch: Partial<ChargeDraft>) {
    setCharges((r) => r.map((c) => (c.id === id ? { ...c, ...patch } : c)));
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
      unitPrice: (item.buyPriceCents / 100).toFixed(2),
    });
  }

  async function onSave(alsoPost: boolean) {
    setError(null);
    if (!supplierId) {
      setError("Pick a supplier first.");
      return;
    }
    const validLines = lines.filter((l) => l.description.trim() && toNum(l.quantity) > 0);
    if (validLines.length === 0) {
      setError("Add at least one line with a description and quantity.");
      return;
    }
    setBusy(true);
    try {
      const validCharges = charges.filter((c) => toInt(c.amount) > 0);
      const { bill } = await api.createBill({
        supplierId,
        supplierBillNumber: supplierBillNumber.trim() || undefined,
        billDate,
        dueDate: effectiveDueDate || undefined,
        currency: currency.toUpperCase(),
        fxRate: Number(fxRate) || 1,
        notes: notes.trim() || undefined,
        costCenterId: costCenterId || undefined,
        lines: validLines.map((l) => {
          const item = items.find((i) => i.id === l.itemId);
          const wantsBatch = !!item && (item.trackBatches || item.trackExpiry);
          const wantsSerials = !!item && item.trackSerials;
          const tracking: {
            batchNumber?: string;
            mfgDate?: string;
            expiryDate?: string;
            batchNotes?: string;
            serialNumbers?: string[];
          } = {};
          if (wantsBatch) {
            if (l.batchNumber.trim()) tracking.batchNumber = l.batchNumber.trim();
            if (l.mfgDate) tracking.mfgDate = l.mfgDate;
            if (l.expiryDate) tracking.expiryDate = l.expiryDate;
            if (l.batchNotes.trim()) tracking.batchNotes = l.batchNotes.trim();
          }
          if (wantsSerials) {
            const serials = parseSerials(l.serialNumbersText);
            if (serials.length > 0) tracking.serialNumbers = serials;
          }
          const hasTracking = Object.keys(tracking).length > 0;
          return {
            itemId: l.itemId || undefined,
            description: l.description.trim(),
            quantity: toNum(l.quantity),
            unitPriceCents: toInt(l.unitPrice),
            discountPctBps: Math.round(toNum(l.discountPct) * 100),
            taxCodeId: l.taxCodeId || undefined,
            expenseAccountId: l.expenseAccountId || undefined,
            tracking: hasTracking ? tracking : undefined,
          };
        }),
        charges: validCharges.map((c) => ({
          kind: c.kind,
          description: c.description.trim() || undefined,
          amountCents: toInt(c.amount),
        })),
        chargeAllocationMethod: allocationMethod,
      });
      if (alsoPost) await api.postBill(bill.id);
      router.push(`/app/bills/${bill.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save the bill.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container-p py-10">
      <div className="mb-4">
        <Link href="/app/bills" className="btn-link text-small">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to bills
        </Link>
      </div>

      <PageHeader
        eyebrow="Buy"
        title="New bill"
        description="Capture a supplier bill. Posting creates the AP liability and records VAT input."
      />

      <div className="mt-8 grid gap-8 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-8">
          <section className="rounded-card border-hairline border-border bg-surface-elevated p-6">
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className="block text-small font-medium text-charcoal">Supplier</label>
                <select
                  value={supplierId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setSupplierId(id);
                    const picked = suppliers.find((s) => s.id === id);
                    if (picked?.currency) setCurrency(picked.currency);
                  }}
                  className="mt-1.5 w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body text-charcoal focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
                >
                  <option value="">Select a supplier…</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {suppliers.length === 0 && (
                  <p className="mt-1.5 text-caption text-text-tertiary">
                    No suppliers yet.{" "}
                    <Link href="/app/suppliers" className="underline">
                      Add one
                    </Link>
                    .
                  </p>
                )}
              </div>
              <div>
                <label className="block text-small font-medium text-charcoal">Supplier's bill number</label>
                <input
                  value={supplierBillNumber}
                  onChange={(e) => setSupplierBillNumber(e.target.value)}
                  placeholder="e.g. INV-4872 from the supplier"
                  className="mt-1.5 w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body text-charcoal placeholder:text-text-tertiary focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-small font-medium text-charcoal">Bill date</label>
                  <input
                    type="date"
                    value={billDate}
                    onChange={(e) => setBillDate(e.target.value)}
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
              {costCenters.length > 0 && (
                <div>
                  <label className="block text-small font-medium text-charcoal">
                    Cost center{" "}
                    <span className="text-caption text-text-tertiary">
                      (P&amp;L roll-up dimension)
                    </span>
                  </label>
                  <select
                    value={costCenterId}
                    onChange={(e) => setCostCenterId(e.target.value)}
                    className="mt-1.5 w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body text-charcoal focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
                  >
                    <option value="">— Unassigned —</option>
                    {costCenters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-small font-medium text-charcoal">Currency</label>
                  <input
                    list="bill-currencies"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
                    maxLength={3}
                    className="mt-1.5 w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body uppercase text-charcoal focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
                  />
                  <datalist id="bill-currencies">
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
                      1 {currency.toUpperCase()} = {fxRate || "?"} LKR. <Link href="/app/settings/fx-rates" className="underline">Manage rates</Link>
                    </p>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-card border-hairline border-border bg-surface-elevated">
            <div className="flex items-center justify-between border-b-hairline border-border px-6 py-4">
              <div>
                <h2 className="text-h3 text-charcoal">Lines</h2>
                <p className="text-caption text-text-tertiary">Pick an expense account per line — it drives which account the cost hits.</p>
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
                    <th className="px-3 py-3 text-left">Expense account</th>
                    <th className="w-20 px-3 py-3 text-right">Qty</th>
                    <th className="w-28 px-3 py-3 text-right">Unit</th>
                    <th className="w-24 px-3 py-3 text-left">Tax</th>
                    <th className="w-28 px-3 py-3 text-right">Total</th>
                    <th className="w-10 px-3 py-3" aria-hidden />
                  </tr>
                </thead>
                <tbody className="divide-y-hairline divide-border">
                  {lines.map((l, idx) => {
                    const c = computed.perLine[idx];
                    const item = items.find((i) => i.id === l.itemId);
                    const needsBatch = !!item && (item.trackBatches || item.trackExpiry);
                    const needsSerials = !!item && item.trackSerials;
                    const needsTracking = needsBatch || needsSerials;
                    const serialCount = parseSerials(l.serialNumbersText).length;
                    const expectedQty = toNum(l.quantity);
                    return (
                      <React.Fragment key={l.id}>
                      <tr className="align-top">
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
                                {it.sku ? `${it.sku} · ` : ""}{it.name}
                              </option>
                            ))}
                          </select>
                          <input
                            value={l.description}
                            onChange={(e) => patchLine(l.id, { description: e.target.value })}
                            placeholder="What's this charge for?"
                            className="w-full rounded-md border-hairline border-border bg-surface-elevated px-2 py-1.5 text-small text-charcoal placeholder:text-text-tertiary focus:border-charcoal focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-3">
                          <select
                            value={l.expenseAccountId}
                            onChange={(e) => patchLine(l.id, { expenseAccountId: e.target.value })}
                            className="w-full rounded-md border-hairline border-border bg-surface-elevated px-2 py-1.5 text-small text-charcoal focus:border-charcoal focus:outline-none"
                          >
                            <option value="">(Default)</option>
                            {expenseAccounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.code} — {a.name}
                              </option>
                            ))}
                          </select>
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
                      {needsTracking && (
                        <tr className="bg-surface-recessed/40">
                          <td />
                          <td colSpan={7} className="px-3 pb-4">
                            <div className="rounded-md border-hairline border-border bg-surface-elevated p-3">
                              <p className="text-caption uppercase tracking-wide text-text-tertiary">
                                Tracking
                                {item?.trackBatches ? " · Batch" : ""}
                                {item?.trackExpiry ? " · Expiry" : ""}
                                {item?.trackSerials ? " · Serials" : ""}
                              </p>
                              {needsBatch && (
                                <div className="mt-2 grid gap-3 sm:grid-cols-4">
                                  <div>
                                    <label className="block text-caption text-text-tertiary">Batch number</label>
                                    <input
                                      value={l.batchNumber}
                                      onChange={(e) => patchLine(l.id, { batchNumber: e.target.value })}
                                      placeholder="e.g. LOT-24A"
                                      className="mt-1 w-full rounded-md border-hairline border-border bg-surface-elevated px-2 py-1.5 text-small text-charcoal focus:border-charcoal focus:outline-none"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-caption text-text-tertiary">Mfg date</label>
                                    <input
                                      type="date"
                                      value={l.mfgDate}
                                      onChange={(e) => patchLine(l.id, { mfgDate: e.target.value })}
                                      className="mt-1 w-full rounded-md border-hairline border-border bg-surface-elevated px-2 py-1.5 text-small text-charcoal focus:border-charcoal focus:outline-none"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-caption text-text-tertiary">
                                      Expiry date{item?.trackExpiry ? " *" : ""}
                                    </label>
                                    <input
                                      type="date"
                                      value={l.expiryDate}
                                      onChange={(e) => patchLine(l.id, { expiryDate: e.target.value })}
                                      className="mt-1 w-full rounded-md border-hairline border-border bg-surface-elevated px-2 py-1.5 text-small text-charcoal focus:border-charcoal focus:outline-none"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-caption text-text-tertiary">Notes</label>
                                    <input
                                      value={l.batchNotes}
                                      onChange={(e) => patchLine(l.id, { batchNotes: e.target.value })}
                                      placeholder="Optional"
                                      className="mt-1 w-full rounded-md border-hairline border-border bg-surface-elevated px-2 py-1.5 text-small text-charcoal focus:border-charcoal focus:outline-none"
                                    />
                                  </div>
                                </div>
                              )}
                              {needsSerials && (
                                <div className="mt-3">
                                  <label className="block text-caption text-text-tertiary">
                                    Serial numbers (one per line) — {serialCount} / {expectedQty || 0}
                                  </label>
                                  <textarea
                                    rows={Math.min(6, Math.max(3, expectedQty || 3))}
                                    value={l.serialNumbersText}
                                    onChange={(e) => patchLine(l.id, { serialNumbersText: e.target.value })}
                                    placeholder={"SN-0001\nSN-0002"}
                                    className="mt-1 w-full rounded-md border-hairline border-border bg-surface-elevated px-2 py-1.5 font-mono text-small text-charcoal focus:border-charcoal focus:outline-none"
                                  />
                                  {expectedQty > 0 && serialCount !== expectedQty && (
                                    <p className="mt-1 text-caption text-amber-700">
                                      Posting needs exactly {expectedQty} serial{expectedQty === 1 ? "" : "s"}.
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-card border-hairline border-border bg-surface-elevated">
            <div className="flex items-start justify-between gap-4 border-b-hairline border-border px-6 py-4">
              <div>
                <h2 className="text-h3 text-charcoal">Additional charges</h2>
                <p className="text-caption text-text-tertiary">
                  Freight, customs, clearing — capitalized into item cost (WAVG) pro-rata across stocked lines.
                </p>
              </div>
              <button type="button" onClick={addCharge} className="btn-secondary text-small">
                <Plus className="h-3.5 w-3.5" aria-hidden /> Add charge
              </button>
            </div>

            {charges.length > 0 && (
              <>
                <div className="flex items-center gap-3 border-b-hairline border-border bg-surface-recessed px-6 py-3">
                  <span className="text-caption uppercase tracking-wide text-text-tertiary">
                    Allocate by
                  </span>
                  <select
                    value={allocationMethod}
                    onChange={(e) =>
                      setAllocationMethod(e.target.value as BillChargeAllocationMethod)
                    }
                    className="rounded-md border-hairline border-border bg-surface-elevated px-2 py-1 text-small text-charcoal focus:border-charcoal focus:outline-none"
                  >
                    <option value="value">Line value (cost-weighted)</option>
                    <option value="quantity">Quantity (unit-weighted)</option>
                  </select>
                  {computed.unallocated > 0 && (
                    <span className="ml-auto text-caption text-text-tertiary">
                      No stocked lines — charges expense to <span className="font-mono">5130 Freight &amp; handling</span>.
                    </span>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-small">
                    <thead className="bg-surface-recessed">
                      <tr className="text-caption uppercase tracking-wide text-text-tertiary">
                        <th className="w-40 px-3 py-3 text-left">Kind</th>
                        <th className="px-3 py-3 text-left">Description</th>
                        <th className="w-32 px-3 py-3 text-right">Amount</th>
                        <th className="w-10 px-3 py-3" aria-hidden />
                      </tr>
                    </thead>
                    <tbody className="divide-y-hairline divide-border">
                      {charges.map((c) => (
                        <tr key={c.id} className="align-top">
                          <td className="px-3 py-3">
                            <select
                              value={c.kind}
                              onChange={(e) =>
                                patchCharge(c.id, { kind: e.target.value as BillChargeKind })
                              }
                              className="w-full rounded-md border-hairline border-border bg-surface-elevated px-2 py-1.5 text-small text-charcoal focus:border-charcoal focus:outline-none"
                            >
                              {(Object.keys(CHARGE_KIND_LABELS) as BillChargeKind[]).map((k) => (
                                <option key={k} value={k}>
                                  {CHARGE_KIND_LABELS[k]}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-3">
                            <input
                              value={c.description}
                              onChange={(e) => patchCharge(c.id, { description: e.target.value })}
                              placeholder="Optional · e.g. BOE-4812 customs duty"
                              className="w-full rounded-md border-hairline border-border bg-surface-elevated px-2 py-1.5 text-small text-charcoal placeholder:text-text-tertiary focus:border-charcoal focus:outline-none"
                            />
                          </td>
                          <td className="px-3 py-3">
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={c.amount}
                              onChange={(e) => patchCharge(c.id, { amount: e.target.value })}
                              className="w-full rounded-md border-hairline border-border bg-surface-elevated px-2 py-1.5 text-right text-small tabular-nums text-charcoal focus:border-charcoal focus:outline-none"
                            />
                          </td>
                          <td className="px-3 py-3 text-center">
                            <button
                              type="button"
                              onClick={() => removeCharge(c.id)}
                              aria-label="Remove charge"
                              className="text-text-tertiary transition-colors hover:text-danger"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {computed.chargesTotal > 0 && computed.unallocated === 0 && (
                  <div className="border-t-hairline border-border px-6 py-3 text-caption text-text-tertiary">
                    Allocation preview:{" "}
                    {computed.allocatedPerLine
                      .map((cents, i) =>
                        cents > 0 ? `Line ${i + 1}: +${formatLKR(cents)}` : null,
                      )
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                )}
              </>
            )}
          </section>

          <section className="rounded-card border-hairline border-border bg-surface-elevated p-6">
            <label className="block text-small font-medium text-charcoal">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Context for later — PO link, approval, project."
              className="mt-1.5 w-full rounded-md border-hairline border-border-emphasis bg-surface-elevated px-3 py-2.5 text-body text-charcoal placeholder:text-text-tertiary focus:border-charcoal focus:outline-none focus:ring-1 focus:ring-charcoal"
            />
          </section>
        </div>

        <aside className="space-y-6">
          <div className="sticky top-24 rounded-card border-hairline border-border bg-surface-elevated p-6">
            <p className="text-caption uppercase tracking-wide text-text-tertiary">Totals</p>
            <dl className="mt-4 space-y-2 text-small">
              <Row label="Subtotal" value={computed.subtotal} />
              {computed.discount > 0 && <Row label="Discount" value={-computed.discount} />}
              <Row label="Input tax" value={computed.tax} />
              {computed.chargesTotal > 0 && (
                <Row label="Charges (landed cost)" value={computed.chargesTotal} />
              )}
              <div className="border-t-hairline border-border pt-2">
                <Row label="Bill total" value={computed.total} emphasize />
              </div>
            </dl>

            {error && (
              <div className="mt-5 rounded-md border-hairline border-danger/40 bg-danger-bg/50 p-3 text-small text-danger">
                {error}
              </div>
            )}

            <div className="mt-6 flex flex-col gap-2">
              <button type="button" disabled={busy} onClick={() => onSave(true)} className="btn-primary w-full">
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Saving…
                  </>
                ) : (
                  "Save and post"
                )}
              </button>
              <button type="button" disabled={busy} onClick={() => onSave(false)} className="btn-secondary w-full">
                Save as draft
              </button>
            </div>

            <p className="mt-4 text-caption text-text-tertiary">
              Posting creates: <br />
              <span className="tabular-nums">
                DR Expense · DR VAT recoverable · CR Accounts payable
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
