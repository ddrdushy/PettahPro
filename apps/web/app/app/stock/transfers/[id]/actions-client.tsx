"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Check, Loader2, Send, X } from "lucide-react";
import {
  api,
  ApiError,
  type StockTransferDetail,
  type StockTransferLineRow,
  type StockTransferStatus,
} from "@/lib/api";
import { formatDate } from "@/lib/format";

const STATUS_LABEL: Record<StockTransferStatus, string> = {
  draft: "Draft",
  dispatched: "In transit",
  received: "Received",
  cancelled: "Cancelled",
};

const STATUS_CLASS: Record<StockTransferStatus, string> = {
  draft: "bg-surface-recessed text-text-secondary border-border",
  dispatched: "bg-amber-50 text-amber-800 border-amber-200",
  received: "bg-mint-surface/60 text-mint-dark border-mint/40",
  cancelled: "bg-danger-bg/60 text-danger border-danger/40",
};

export function TransferActionsClient({
  transfer,
  lines,
}: {
  transfer: StockTransferDetail;
  lines: StockTransferLineRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receivedInputs, setReceivedInputs] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        lines.map((l) => [l.id, l.quantity_dispatched ?? l.quantity_requested]),
      ),
  );

  async function dispatchIt() {
    setError(null);
    setBusy("dispatch");
    try {
      await api.dispatchStockTransfer(transfer.id);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Dispatch failed.");
    } finally {
      setBusy(null);
    }
  }

  async function cancelIt() {
    if (!confirm("Cancel this draft transfer?")) return;
    setError(null);
    setBusy("cancel");
    try {
      await api.cancelStockTransfer(transfer.id);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Cancel failed.");
    } finally {
      setBusy(null);
    }
  }

  async function confirmReceive() {
    setError(null);
    setBusy("receive");
    try {
      const payload = {
        lines: lines.map((l) => ({
          lineId: l.id,
          quantityReceived: Number(receivedInputs[l.id] ?? "0") || 0,
        })),
      };
      const res = await api.receiveStockTransfer(transfer.id, payload);
      if (res.hasDiscrepancy) {
        alert("Received — one or more lines had less than dispatched. Flagged with a discrepancy on the header.");
      }
      setReceiveOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Receive failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-6 space-y-5">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-card border-hairline border-border bg-surface-elevated p-5">
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-1 rounded-full border-hairline px-2 py-0.5 text-caption font-medium ${STATUS_CLASS[transfer.status]}`}>
            {STATUS_LABEL[transfer.status]}
            {transfer.hasDiscrepancy && <AlertTriangle className="h-3 w-3" aria-hidden />}
          </span>
          <div className="text-caption text-text-tertiary">
            Requested {formatDate(transfer.requestedDate)}
            {transfer.dispatchedAt && <> · dispatched {formatDate(transfer.dispatchedAt.slice(0, 10))}</>}
            {transfer.receivedAt && <> · received {formatDate(transfer.receivedAt.slice(0, 10))}</>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {transfer.status === "draft" && (
            <>
              <button type="button" onClick={cancelIt} disabled={busy !== null} className="btn-secondary inline-flex items-center gap-1 text-small disabled:opacity-50">
                {busy === "cancel" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                Cancel
              </button>
              <button type="button" onClick={dispatchIt} disabled={busy !== null} className="btn-primary inline-flex items-center gap-1 text-small disabled:opacity-50">
                {busy === "dispatch" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Dispatch
              </button>
            </>
          )}
          {transfer.status === "dispatched" && (
            <button type="button" onClick={() => setReceiveOpen(true)} className="btn-primary inline-flex items-center gap-1 text-small">
              <Check className="h-3.5 w-3.5" />
              Receive
            </button>
          )}
        </div>
      </section>

      {error && (
        <div className="rounded-card border-hairline border-danger/40 bg-danger-bg/60 px-4 py-3 text-small text-danger">
          {error}
        </div>
      )}

      {transfer.cancelledReason && (
        <p className="text-caption italic text-text-tertiary">Cancelled reason: {transfer.cancelledReason}</p>
      )}

      <section className="overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
        <table className="w-full text-small">
          <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
            <tr>
              <th className="px-4 py-3 text-left">Item</th>
              <th className="w-24 px-4 py-3 text-right">Requested</th>
              <th className="w-24 px-4 py-3 text-right">Dispatched</th>
              <th className="w-24 px-4 py-3 text-right">Received</th>
              <th className="px-4 py-3 text-left">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y-hairline divide-border">
            {lines.map((l) => {
              const dispatched = Number(l.quantity_dispatched ?? 0);
              const received = Number(l.quantity_received ?? 0);
              const discrepancy =
                l.quantity_received != null && Number(l.quantity_received) < dispatched;
              return (
                <tr key={l.id}>
                  <td className="px-4 py-3 text-charcoal">
                    {l.item_name}
                    {l.sku && <span className="ml-2 text-caption text-text-tertiary">{l.sku}</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                    {Number(l.quantity_requested).toLocaleString("en-LK")} {l.unit}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                    {l.quantity_dispatched != null ? `${dispatched.toLocaleString("en-LK")} ${l.unit}` : "—"}
                  </td>
                  <td className={`px-4 py-3 text-right tabular-nums ${discrepancy ? "font-medium text-amber-800" : "text-text-secondary"}`}>
                    {l.quantity_received != null ? `${received.toLocaleString("en-LK")} ${l.unit}` : "—"}
                    {discrepancy && (
                      <p className="mt-0.5 text-caption text-amber-700">Short {(dispatched - received).toLocaleString("en-LK")}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{l.notes ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {receiveOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/40 px-4">
          <div className="w-full max-w-2xl rounded-card border-hairline border-border bg-surface-elevated p-6 shadow-lg">
            <h3 className="text-body font-medium text-charcoal">Receive transfer</h3>
            <p className="mt-1 text-caption text-text-secondary">
              Confirm the quantity actually received for each line. Anything less than dispatched gets flagged as a discrepancy on the header.
            </p>
            <table className="mt-4 w-full text-small">
              <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
                <tr>
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="w-24 px-3 py-2 text-right">Dispatched</th>
                  <th className="w-32 px-3 py-2 text-right">Received</th>
                </tr>
              </thead>
              <tbody className="divide-y-hairline divide-border">
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-2 text-charcoal">{l.item_name}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                      {Number(l.quantity_dispatched ?? 0).toLocaleString("en-LK")} {l.unit}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        value={receivedInputs[l.id] ?? ""}
                        onChange={(e) => setReceivedInputs((prev) => ({ ...prev, [l.id]: e.target.value }))}
                        className="input w-full text-right"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setReceiveOpen(false)} disabled={busy !== null} className="btn-ghost text-small">Cancel</button>
              <button type="button" onClick={confirmReceive} disabled={busy !== null} className="btn-primary inline-flex items-center gap-2 text-small disabled:opacity-50">
                {busy === "receive" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Confirm receive
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
