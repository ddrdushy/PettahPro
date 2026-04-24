"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  PlatformApiError,
  PLATFORM_ROLES,
  PLATFORM_ROLE_LABELS,
  type PlatformRole,
  type PlatformStaffMember,
  platformApi,
} from "@/lib/platform-api";

// #56 — staff management UI. Deliberately simple: list + inline edit
// role + add + deactivate/reactivate + delete. No invite-by-email flow
// yet (password is set by the super-admin who creates the user; they
// share it out-of-band and the new hire rotates it on first login via
// /platform/account). An invite-email flow is a follow-up if it's
// painful enough to warrant building.

function formatDateTime(s: string | null): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return s;
  }
}

const ROLE_PILL: Record<PlatformRole, string> = {
  super_admin: "bg-mint/20 text-mint",
  support: "bg-sky-500/20 text-sky-200",
  billing: "bg-amber-400/20 text-amber-200",
};

export function StaffClient({
  initialStaff,
  currentUserId,
}: {
  initialStaff: PlatformStaffMember[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [staff, setStaff] = useState<PlatformStaffMember[]>(initialStaff);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  function refresh() {
    router.refresh();
    // Also refetch into local state so the list updates before the
    // server-side navigation settles.
    platformApi
      .listPlatformUsers()
      .then((r) => setStaff(r.users))
      .catch(() => {
        /* swallow — the page will refresh from router.refresh() */
      });
  }

  async function onPatch(
    id: string,
    patch: { role?: PlatformRole; isActive?: boolean },
  ) {
    setError(null);
    try {
      await platformApi.patchPlatformUser(id, patch);
      refresh();
    } catch (err) {
      setError(
        err instanceof PlatformApiError
          ? err.message || "Update failed."
          : "Could not reach the API.",
      );
    }
  }

  async function onDelete(id: string, email: string) {
    if (
      !confirm(
        `Delete platform user ${email}? Their active sessions will be terminated. This can't be undone.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      await platformApi.deletePlatformUser(id);
      refresh();
    } catch (err) {
      setError(
        err instanceof PlatformApiError
          ? err.message || "Delete failed."
          : "Could not reach the API.",
      );
    }
  }

  return (
    <div className="mt-8">
      {error && (
        <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-small text-red-200">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="rounded-md border border-mint/40 bg-mint/10 px-4 py-2 text-small text-mint hover:bg-mint/20"
        >
          Add staff member
        </button>
      </div>

      <div className="mt-4 overflow-hidden rounded-card border border-white/10">
        <table className="w-full text-small">
          <thead className="bg-black/40 text-caption uppercase tracking-wide text-white/60">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Email</th>
              <th className="px-4 py-3 text-left">Role</th>
              <th className="px-4 py-3 text-left">Last login</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {staff.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-white/50">
                  No staff yet.
                </td>
              </tr>
            )}
            {staff.map((u) => {
              const isSelf = u.id === currentUserId;
              return (
                <tr key={u.id} className="hover:bg-white/5">
                  <td className="px-4 py-3 text-white/90">
                    {u.fullName}
                    {isSelf && (
                      <span className="ml-2 text-caption text-white/40">(you)</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-white/70">{u.email}</td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role}
                      disabled={isSelf}
                      onChange={(e) =>
                        onPatch(u.id, { role: e.target.value as PlatformRole })
                      }
                      className={`rounded-full border border-white/10 bg-black/40 px-2 py-0.5 text-caption ${
                        ROLE_PILL[u.role] ?? "text-white/70"
                      } ${isSelf ? "opacity-60" : ""}`}
                      title={
                        isSelf
                          ? "Ask another super-admin to change your role."
                          : undefined
                      }
                    >
                      {PLATFORM_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {PLATFORM_ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-white/70">
                    {formatDateTime(u.lastLoginAt)}
                  </td>
                  <td className="px-4 py-3 text-white/70">
                    {u.isActive ? (
                      <span className="inline-flex rounded-full bg-mint/20 px-2 py-0.5 text-caption text-mint">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-white/10 px-2 py-0.5 text-caption text-white/60">
                        Deactivated
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {u.isActive ? (
                        <button
                          type="button"
                          disabled={isSelf}
                          onClick={() => onPatch(u.id, { isActive: false })}
                          className="rounded-md border border-white/10 bg-white/5 px-3 py-1 text-caption text-white/80 hover:bg-white/10 disabled:opacity-40"
                          title={
                            isSelf
                              ? "You can't deactivate your own account."
                              : undefined
                          }
                        >
                          Deactivate
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onPatch(u.id, { isActive: true })}
                          className="rounded-md border border-mint/40 bg-mint/10 px-3 py-1 text-caption text-mint hover:bg-mint/20"
                        >
                          Reactivate
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={isSelf}
                        onClick={() => onDelete(u.id, u.email)}
                        className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1 text-caption text-red-200 hover:bg-red-500/20 disabled:opacity-40"
                        title={
                          isSelf ? "You can't delete your own account." : undefined
                        }
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <AddStaffDialog
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function AddStaffDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<PlatformRole>("support");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!email.includes("@")) {
      setError("Valid email required.");
      return;
    }
    if (fullName.trim().length < 2) {
      setError("Full name required.");
      return;
    }
    if (password.length < 12) {
      setError("Password must be at least 12 characters.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await platformApi.createPlatformUser({
        email: email.trim().toLowerCase(),
        fullName: fullName.trim(),
        password,
        role,
      });
      onCreated();
    } catch (err) {
      setError(
        err instanceof PlatformApiError
          ? err.message || "Create failed."
          : "Could not reach the API.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-labelledby="add-staff-heading"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-md rounded-card border border-white/10 bg-charcoal p-6 text-white">
        <h3 id="add-staff-heading" className="text-h3">
          Add staff member
        </h3>
        <p className="mt-1 text-caption text-white/60">
          Share the password out-of-band. They can rotate it on first login
          from /platform/account.
        </p>

        <div className="mt-6 space-y-4">
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-body text-white focus:border-mint focus:outline-none"
              placeholder="name@pettahpro.lk"
            />
          </Field>
          <Field label="Full name">
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1 block w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-body text-white focus:border-mint focus:outline-none"
            />
          </Field>
          <Field label="Password (min 12 chars)">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className="mt-1 block w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-body text-white focus:border-mint focus:outline-none"
            />
          </Field>
          <Field label="Role">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as PlatformRole)}
              className="mt-1 block w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-body text-white focus:border-mint focus:outline-none"
            >
              {PLATFORM_ROLES.map((r) => (
                <option key={r} value={r}>
                  {PLATFORM_ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 p-2 text-small text-red-200">
            {error}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-small text-white hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="rounded-md bg-mint px-4 py-2 text-small text-charcoal hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-caption uppercase tracking-wide text-white/60">
        {label}
      </label>
      {children}
    </div>
  );
}
