"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarDays, Loader2, Plus } from "lucide-react";
import { api, ApiError, type LeaveType } from "@/lib/api";
import { PageHeader } from "@/components/app/page-header";

export function LeaveTypesClient({ initial }: { initial: LeaveType[] }) {
  const router = useRouter();
  const [types, setTypes] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    code: "",
    name: "",
    defaultDaysPerYear: "0",
    isPaid: true,
    carryForwardAllowed: false,
    maxCarryForwardDays: "0",
  });

  async function toggleActive(lt: LeaveType) {
    setError(null);
    try {
      const res = await api.updateLeaveType(lt.id, { isActive: !lt.isActive });
      setTypes((prev) => prev.map((t) => (t.id === lt.id ? res.leaveType : t)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update.");
    }
  }

  async function save() {
    setError(null);
    if (!form.code.trim() || !form.name.trim()) {
      setError("Code and name are required.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.createLeaveType({
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        defaultDaysPerYear: Number(form.defaultDaysPerYear) || 0,
        isPaid: form.isPaid,
        carryForwardAllowed: form.carryForwardAllowed,
        maxCarryForwardDays: Number(form.maxCarryForwardDays) || 0,
      });
      setTypes((prev) => [...prev, res.leaveType].sort((a, b) => a.code.localeCompare(b.code)));
      setShowForm(false);
      setForm({
        code: "",
        name: "",
        defaultDaysPerYear: "0",
        isPaid: true,
        carryForwardAllowed: false,
        maxCarryForwardDays: "0",
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container-p py-10">
      <PageHeader
        eyebrow="HR"
        title="Leave types"
        description="Taxonomy of leave your business offers. SL defaults seeded at tenant creation — add custom types as needed."
        action={
          <button type="button" onClick={() => setShowForm((s) => !s)} className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden />
            {showForm ? "Close" : "New leave type"}
          </button>
        }
      />

      {showForm && (
        <section className="mt-6 rounded-card border-hairline border-border bg-surface-elevated p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">Code</label>
              <input type="text" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="BEREAV, COMP" maxLength={16} className="input mt-1.5 tabular-nums" />
            </div>
            <div>
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">Name</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Bereavement leave" className="input mt-1.5" />
            </div>
            <div>
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">Default days per year</label>
              <input type="number" step="0.5" min="0" value={form.defaultDaysPerYear} onChange={(e) => setForm({ ...form, defaultDaysPerYear: e.target.value })} className="input mt-1.5 text-right tabular-nums" />
            </div>
            <div>
              <label className="block text-caption uppercase tracking-wide text-text-tertiary">Max carry-forward days</label>
              <input type="number" step="0.5" min="0" value={form.maxCarryForwardDays} onChange={(e) => setForm({ ...form, maxCarryForwardDays: e.target.value })} disabled={!form.carryForwardAllowed} className="input mt-1.5 text-right tabular-nums disabled:opacity-50" />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-small text-charcoal">
              <input type="checkbox" checked={form.isPaid} onChange={(e) => setForm({ ...form, isPaid: e.target.checked })} className="h-4 w-4 rounded border-border-emphasis" />
              Paid leave <span className="text-caption text-text-tertiary">(salary not reduced)</span>
            </label>
            <label className="flex items-center gap-2 text-small text-charcoal">
              <input type="checkbox" checked={form.carryForwardAllowed} onChange={(e) => setForm({ ...form, carryForwardAllowed: e.target.checked })} className="h-4 w-4 rounded border-border-emphasis" />
              Allow carry-forward to next year
            </label>
          </div>
          <div className="mt-4 flex items-center justify-end gap-3">
            {error && <span className="text-small text-danger">{error}</span>}
            <button type="button" onClick={save} disabled={busy} className="btn-primary disabled:opacity-50">
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Create
            </button>
          </div>
        </section>
      )}

      {types.length === 0 ? (
        <div className="mt-8 rounded-card border-hairline border-border bg-surface-elevated p-10 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-mint-surface text-mint-dark">
            <CalendarDays className="h-5 w-5" />
          </div>
          <p className="text-body text-charcoal">No leave types yet.</p>
        </div>
      ) : (
        <section className="mt-8 overflow-hidden rounded-card border-hairline border-border bg-surface-elevated">
          <table className="w-full text-small">
            <thead className="bg-surface-recessed text-caption uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="w-20 px-4 py-3 text-left">Code</th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="w-28 px-4 py-3 text-right">Days / year</th>
                <th className="w-20 px-4 py-3 text-center">Paid</th>
                <th className="w-36 px-4 py-3 text-center">Carry-forward</th>
                <th className="w-24 px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y-hairline divide-border">
              {types.map((lt) => (
                <tr key={lt.id}>
                  <td className="px-4 py-3 tabular-nums font-medium text-charcoal">{lt.code}</td>
                  <td className="px-4 py-3 text-text-primary">
                    {lt.name}
                    {lt.isSystem && <span className="ml-2 text-caption text-text-tertiary">System</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">{Number(lt.defaultDaysPerYear)}</td>
                  <td className="px-4 py-3 text-center text-text-secondary">{lt.isPaid ? "Yes" : "No"}</td>
                  <td className="px-4 py-3 text-center text-text-secondary">
                    {lt.carryForwardAllowed ? `Up to ${Number(lt.maxCarryForwardDays)}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      type="button"
                      onClick={() => toggleActive(lt)}
                      className={`rounded-full px-2.5 py-0.5 text-caption font-medium transition ${
                        lt.isActive ? "bg-mint-surface text-mint-dark hover:bg-mint" : "bg-surface-recessed text-text-secondary hover:bg-warning-bg"
                      }`}
                    >
                      {lt.isActive ? "Active" : "Inactive"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
