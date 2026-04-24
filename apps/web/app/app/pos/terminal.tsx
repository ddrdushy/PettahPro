"use client";

// POS terminal — one-screen retail UI.
//
// Layout: left pane = item search + cart; right pane = totals + tender tiles.
// A shift-gate overlays if the cashier has no open shift. Every action is
// keyboard-first: type to search, Enter to add, F1–F4 switches tender, Enter
// on the tender panel finalises the sale.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Banknote,
  CreditCard,
  Loader2,
  Plus,
  QrCode,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { api, type Account, type Item, type PosShift, type PosTenderMethod } from "@/lib/api";
import { formatLKR } from "@/lib/format";
import { PlanErrorBanner } from "@/components/app/plan-error-banner";

type CartLine = {
  // Stable key for React list rendering — items can repeat, so the id alone
  // isn't enough.
  key: string;
  itemId?: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountPctBps: number;
  taxCodeId?: string;
};

type Tender = {
  method: PosTenderMethod;
  amountCents: number;
  bankAccountId?: string;
  reference?: string;
};

const TENDER_TILES: Array<{ method: PosTenderMethod; label: string; icon: typeof Banknote }> = [
  { method: "cash", label: "Cash", icon: Banknote },
  { method: "card", label: "Card", icon: CreditCard },
  { method: "lankaqr", label: "LankaQR", icon: QrCode },
  { method: "bank_transfer", label: "Bank", icon: Banknote },
];

function lineTotalCents(line: CartLine) {
  const gross = line.quantity * line.unitPriceCents;
  const discount = Math.round((gross * line.discountPctBps) / 10000);
  return gross - discount;
}

export function PosTerminal() {
  const router = useRouter();
  const [shift, setShift] = useState<PosShift | null>(null);
  const [shiftLoading, setShiftLoading] = useState(true);
  const [openingFloat, setOpeningFloat] = useState("0");
  const [openingBusy, setOpeningBusy] = useState(false);

  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);

  const [tenders, setTenders] = useState<Tender[]>([]);
  const [activeTender, setActiveTender] = useState<PosTenderMethod>("cash");
  const [bankAccounts, setBankAccounts] = useState<Account[]>([]);
  const [selectedBankAccount, setSelectedBankAccount] = useState<string>("");
  const [tenderReference, setTenderReference] = useState("");
  const [tenderAmount, setTenderAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Error state preserves the raw ApiError so PlanErrorBanner can read
  // the structured plan-gate detail (#69). Shift-open and sale-finalise
  // share a single `error` because the UI is mutually exclusive — you
  // only see the shift-open form when no shift is open, and only the
  // tender panel afterwards — so there's no risk of one flow's error
  // leaking into the other. Shift opens aren't plan-gated, so banners
  // there will always hit the fallback text; sale finalises are gated
  // on `invoices_monthly` and will render the upgrade CTA properly.
  const [error, setError] = useState<unknown>(null);
  const [lastReceipt, setLastReceipt] = useState<{
    invoiceNumber: string;
    changeCents: number;
  } | null>(null);

  // ── Initial load ─────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const { shift } = await api.getCurrentPosShift();
        setShift(shift);
      } finally {
        setShiftLoading(false);
      }
      const { accounts } = await api.listCoa();
      setBankAccounts(
        accounts.filter(
          (a) =>
            a.accountType === "asset" &&
            (a.accountSubtype === "bank" || a.accountSubtype === "cash") &&
            a.isActive,
        ),
      );
    })().catch(() => setShiftLoading(false));
  }, []);

  // ── Item search (debounced) ─────────────────────────────────────────────
  useEffect(() => {
    if (!shift) return;
    const t = setTimeout(async () => {
      setSearchBusy(true);
      try {
        const { items } = await api.listItems(query || undefined);
        setItems(items.slice(0, 20));
      } finally {
        setSearchBusy(false);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [query, shift]);

  // ── Cart math ───────────────────────────────────────────────────────────
  const subtotalCents = useMemo(
    () => cart.reduce((s, l) => s + lineTotalCents(l), 0),
    [cart],
  );
  // v1: taxes are computed at post time on the server (from taxCodeId on each
  // line). The header preview just shows the taxable subtotal — cashier gets
  // the final total back on the receipt.
  const tenderedCents = useMemo(
    () => tenders.reduce((s, t) => s + t.amountCents, 0),
    [tenders],
  );
  const balanceCents = Math.max(0, subtotalCents - tenderedCents);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const openShift = async () => {
    setOpeningBusy(true);
    try {
      const cents = Math.max(0, Math.round(Number(openingFloat || 0) * 100));
      const { shift } = await api.openPosShift({ openingFloatCents: cents });
      setShift(shift);
    } catch (e) {
      setError(e);
    } finally {
      setOpeningBusy(false);
    }
  };

  const addItem = useCallback((item: Item) => {
    setCart((prev) => [
      ...prev,
      {
        key: `${item.id}-${Date.now()}`,
        itemId: item.id,
        description: item.name,
        quantity: 1,
        unitPriceCents: item.sellPriceCents,
        discountPctBps: 0,
      },
    ]);
    setQuery("");
  }, []);

  const addFreeLine = useCallback(() => {
    setCart((prev) => [
      ...prev,
      {
        key: `free-${Date.now()}`,
        description: "Custom line",
        quantity: 1,
        unitPriceCents: 0,
        discountPctBps: 0,
      },
    ]);
  }, []);

  const updateLine = (key: string, patch: Partial<CartLine>) => {
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };
  const removeLine = (key: string) => {
    setCart((prev) => prev.filter((l) => l.key !== key));
  };

  const addTender = () => {
    const amount = Math.round(Number(tenderAmount || 0) * 100);
    if (amount <= 0) return;
    const tender: Tender = {
      method: activeTender,
      amountCents: amount,
      bankAccountId:
        activeTender === "cash" ? undefined : selectedBankAccount || undefined,
      reference: tenderReference || undefined,
    };
    setTenders((prev) => [...prev, tender]);
    setTenderAmount("");
    setTenderReference("");
  };

  const quickTenderExact = () => {
    const remaining = Math.max(0, subtotalCents - tenderedCents);
    if (remaining <= 0) return;
    setTenders((prev) => [
      ...prev,
      {
        method: activeTender,
        amountCents: remaining,
        bankAccountId:
          activeTender === "cash" ? undefined : selectedBankAccount || undefined,
      },
    ]);
  };

  const removeTender = (idx: number) => {
    setTenders((prev) => prev.filter((_, i) => i !== idx));
  };

  const finalise = async () => {
    if (!shift) return;
    if (cart.length === 0) {
      setError(new Error("Cart is empty."));
      return;
    }
    if (tenderedCents < subtotalCents) {
      setError(new Error("Tendered amount is less than the total."));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.createPosSale({
        shiftId: shift.id,
        lines: cart.map((l) => ({
          itemId: l.itemId,
          description: l.description,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          discountPctBps: l.discountPctBps,
          taxCodeId: l.taxCodeId,
        })),
        tenders: tenders.map((t) => ({
          method: t.method,
          amountCents: t.amountCents,
          bankAccountId: t.bankAccountId,
          reference: t.reference,
        })),
      });
      setLastReceipt({
        invoiceNumber: result.invoiceNumber,
        changeCents: result.changeCents,
      });
      setCart([]);
      setTenders([]);
    } catch (e) {
      setError(e);
    } finally {
      setSubmitting(false);
    }
  };

  const closeShift = () => {
    if (!shift) return;
    router.push(`/app/pos/shifts/${shift.id}?close=1`);
  };

  // ── Renderers ────────────────────────────────────────────────────────────
  if (shiftLoading) {
    return (
      <div className="flex h-[calc(100vh-theme(spacing.14))] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-text-tertiary" />
      </div>
    );
  }

  if (!shift) {
    return (
      <div className="flex h-[calc(100vh-theme(spacing.14))] items-center justify-center bg-cream">
        <div className="w-full max-w-md rounded-lg border border-line bg-white p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-charcoal">Open a POS shift</h1>
          <p className="mt-2 text-small text-text-secondary">
            Enter the cash you're starting the day with. This is the float in the
            till before any sales — it'll be used to calculate expected cash at
            close.
          </p>
          <label className="mt-6 block text-small font-medium text-charcoal">
            Opening float (LKR)
          </label>
          <input
            type="number"
            min="0"
            step="100"
            value={openingFloat}
            onChange={(e) => setOpeningFloat(e.target.value)}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 text-base focus:border-primary focus:outline-none"
            placeholder="0.00"
          />
          {error ? (
            <div className="mt-3">
              <PlanErrorBanner error={error} fallbackMessage="Could not open shift." />
            </div>
          ) : null}
          <button
            type="button"
            onClick={openShift}
            disabled={openingBusy}
            className="btn-primary mt-6 w-full"
          >
            {openingBusy ? "Opening…" : "Open shift and start selling"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-theme(spacing.14))] flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-line bg-white px-4 py-2">
        <div>
          <p className="text-caption uppercase tracking-wide text-text-tertiary">
            Shift open since
          </p>
          <p className="text-small font-medium text-charcoal">
            {new Date(shift.openedAt).toLocaleTimeString("en-LK", {
              hour: "2-digit",
              minute: "2-digit",
            })}
            {" · "}float {formatLKR(shift.openingFloatCents)}
          </p>
        </div>
        <button type="button" onClick={closeShift} className="btn-secondary">
          Close shift
        </button>
      </div>

      {lastReceipt && (
        <div className="flex items-center justify-between border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-small">
          <span className="text-emerald-900">
            Sale <span className="font-semibold">{lastReceipt.invoiceNumber}</span>{" "}
            posted.
            {lastReceipt.changeCents > 0 && (
              <>
                {" "}
                Change due:{" "}
                <span className="font-semibold">
                  {formatLKR(lastReceipt.changeCents)}
                </span>
              </>
            )}
          </span>
          <button
            onClick={() => setLastReceipt(null)}
            className="text-emerald-700 hover:text-emerald-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Main two-pane layout */}
      <div className="grid flex-1 grid-cols-[1fr_380px] overflow-hidden">
        {/* LEFT: search + cart */}
        <div className="flex flex-col border-r border-line bg-cream">
          <div className="border-b border-line bg-white p-3">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-tertiary" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search item by name or SKU · Enter to add first result"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && items[0]) {
                    addItem(items[0]);
                  }
                }}
                className="w-full rounded-md border border-line bg-white py-2 pl-9 pr-3 text-base focus:border-primary focus:outline-none"
              />
            </div>
            {query && items.length > 0 && (
              <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-line bg-white">
                {items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => addItem(item)}
                    className="flex w-full items-center justify-between border-b border-line px-3 py-2 text-left hover:bg-cream"
                  >
                    <div>
                      <p className="text-small font-medium text-charcoal">
                        {item.name}
                      </p>
                      <p className="text-caption text-text-tertiary">
                        {item.sku ?? "no SKU"} · {item.unit}
                      </p>
                    </div>
                    <span className="text-small font-medium text-charcoal">
                      {formatLKR(item.sellPriceCents)}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {query && !searchBusy && items.length === 0 && (
              <p className="mt-2 text-small text-text-tertiary">No items match.</p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {cart.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-text-tertiary">
                <p className="text-small">Cart is empty.</p>
                <button
                  onClick={addFreeLine}
                  className="mt-2 flex items-center gap-1 text-caption text-primary hover:underline"
                >
                  <Plus className="h-3 w-3" /> Add a custom line
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {cart.map((line) => (
                  <div
                    key={line.key}
                    className="rounded-md border border-line bg-white p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <input
                        value={line.description}
                        onChange={(e) =>
                          updateLine(line.key, { description: e.target.value })
                        }
                        className="flex-1 text-small font-medium text-charcoal focus:outline-none"
                      />
                      <button
                        onClick={() => removeLine(line.key)}
                        className="text-text-tertiary hover:text-destructive-foreground"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-[80px_110px_80px_1fr] items-center gap-2 text-small">
                      <div>
                        <label className="text-caption text-text-tertiary">Qty</label>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={line.quantity}
                          onChange={(e) =>
                            updateLine(line.key, {
                              quantity: Math.max(0, Number(e.target.value)),
                            })
                          }
                          className="w-full rounded border border-line px-2 py-1 focus:border-primary focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-caption text-text-tertiary">
                          Unit price
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={(line.unitPriceCents / 100).toString()}
                          onChange={(e) =>
                            updateLine(line.key, {
                              unitPriceCents: Math.round(
                                Number(e.target.value) * 100,
                              ),
                            })
                          }
                          className="w-full rounded border border-line px-2 py-1 focus:border-primary focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-caption text-text-tertiary">
                          Disc %
                        </label>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={(line.discountPctBps / 100).toString()}
                          onChange={(e) =>
                            updateLine(line.key, {
                              discountPctBps: Math.round(
                                Number(e.target.value) * 100,
                              ),
                            })
                          }
                          className="w-full rounded border border-line px-2 py-1 focus:border-primary focus:outline-none"
                        />
                      </div>
                      <div className="text-right">
                        <p className="text-caption text-text-tertiary">Line</p>
                        <p className="font-semibold text-charcoal">
                          {formatLKR(lineTotalCents(line))}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
                <button
                  onClick={addFreeLine}
                  className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-line py-2 text-small text-text-secondary hover:border-primary hover:text-primary"
                >
                  <Plus className="h-3 w-3" /> Add custom line
                </button>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: totals + tenders */}
        <div className="flex flex-col bg-white">
          <div className="border-b border-line p-4">
            <div className="flex items-baseline justify-between">
              <p className="text-small text-text-secondary">Subtotal</p>
              <p className="text-base font-medium text-charcoal">
                {formatLKR(subtotalCents)}
              </p>
            </div>
            <div className="mt-1 flex items-baseline justify-between">
              <p className="text-small text-text-secondary">Tendered</p>
              <p className="text-base text-charcoal">{formatLKR(tenderedCents)}</p>
            </div>
            <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2">
              <p className="text-small font-medium text-charcoal">Due</p>
              <p className="text-2xl font-bold text-charcoal">
                {formatLKR(balanceCents)}
              </p>
            </div>
            <p className="mt-2 text-caption text-text-tertiary">
              Tax is computed at post time from each line's tax code. This preview
              is net of discounts, before tax.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="grid grid-cols-4 gap-2">
              {TENDER_TILES.map((tile) => {
                const Icon = tile.icon;
                const active = activeTender === tile.method;
                return (
                  <button
                    key={tile.method}
                    onClick={() => setActiveTender(tile.method)}
                    className={`flex flex-col items-center gap-1 rounded-md border px-2 py-3 text-caption ${
                      active
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-line text-text-secondary hover:border-primary"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    {tile.label}
                  </button>
                );
              })}
            </div>

            {activeTender !== "cash" && (
              <div className="mt-4">
                <label className="text-caption text-text-tertiary">
                  Deposit account
                </label>
                <select
                  value={selectedBankAccount}
                  onChange={(e) => setSelectedBankAccount(e.target.value)}
                  className="mt-1 w-full rounded border border-line px-2 py-2 text-small focus:border-primary focus:outline-none"
                >
                  <option value="">— pick account —</option>
                  {bankAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} · {a.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <div className="flex-1">
                <label className="text-caption text-text-tertiary">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={tenderAmount}
                  onChange={(e) => setTenderAmount(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addTender()}
                  className="mt-1 w-full rounded border border-line px-2 py-2 text-small focus:border-primary focus:outline-none"
                  placeholder="0.00"
                />
              </div>
              <div className="flex-1">
                <label className="text-caption text-text-tertiary">
                  Reference (optional)
                </label>
                <input
                  value={tenderReference}
                  onChange={(e) => setTenderReference(e.target.value)}
                  className="mt-1 w-full rounded border border-line px-2 py-2 text-small focus:border-primary focus:outline-none"
                  placeholder={
                    activeTender === "card" ? "Last 4 / auth code" : "Txn ref"
                  }
                />
              </div>
            </div>

            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={quickTenderExact}
                className="btn-secondary flex-1"
              >
                Exact {formatLKR(balanceCents)}
              </button>
              <button
                type="button"
                onClick={addTender}
                className="btn-secondary flex-1"
              >
                Add tender
              </button>
            </div>

            {tenders.length > 0 && (
              <div className="mt-4 space-y-1">
                {tenders.map((t, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded border border-line bg-cream px-3 py-2 text-small"
                  >
                    <span className="capitalize text-charcoal">
                      {t.method.replace("_", " ")}
                      {t.reference ? ` · ${t.reference}` : ""}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-charcoal">
                        {formatLKR(t.amountCents)}
                      </span>
                      <button
                        onClick={() => removeTender(i)}
                        className="text-text-tertiary hover:text-destructive-foreground"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {error ? (
              <div className="mt-3">
                <PlanErrorBanner
                  error={error}
                  fallbackMessage="Could not post sale."
                />
              </div>
            ) : null}
          </div>

          <div className="border-t border-line p-4">
            <button
              type="button"
              onClick={finalise}
              disabled={submitting || cart.length === 0}
              className="btn-primary w-full py-3 text-base"
            >
              {submitting ? "Posting…" : `Finalise sale · ${formatLKR(subtotalCents)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
