"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload, Trash2, ImageIcon } from "lucide-react";
import { api, ApiError, type TenantSettings } from "@/lib/api";

// #M9 / gaps M9 — tenant branding section. Keeps state local so the
// rest of the settings page (which is a server component) doesn't have
// to round-trip on every upload. Uses /settings/logo route family.

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 2 * 1024 * 1024;

export function BrandingFormClient({
  initial,
}: {
  initial: TenantSettings;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [logoUpdatedAt, setLogoUpdatedAt] = useState<string | null>(initial.logoUpdatedAt);
  const [busy, setBusy] = useState<"upload" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onPick(file: File) {
    setError(null);
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError("Logo must be a PNG, JPEG or WebP image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Logo must be 2 MB or smaller.");
      return;
    }
    setBusy("upload");
    try {
      const result = await api.uploadTenantLogo(file);
      setLogoUpdatedAt(result.logoUpdatedAt);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || "Couldn't upload logo.");
      } else {
        setError("Couldn't upload logo. Try again.");
      }
    } finally {
      setBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function onRemove() {
    if (!confirm("Remove the tenant logo?")) return;
    setBusy("delete");
    setError(null);
    try {
      await api.deleteTenantLogo();
      setLogoUpdatedAt(null);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError && err.message
          ? err.message
          : "Couldn't remove logo. Try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  const hasLogo = logoUpdatedAt !== null;

  return (
    <section className="rounded-card border-hairline border-border bg-surface-elevated p-6">
      <h2 className="text-body font-medium text-charcoal">Branding</h2>
      <p className="mt-1 text-caption text-text-secondary">
        Your logo appears on PDF invoices, quotations, and other documents you
        send to customers and suppliers. PNG, JPEG, or WebP, 2 MB max. Square
        or wide-rectangle works best.
      </p>

      <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md border-hairline border-border bg-surface-recessed/40">
          {hasLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={api.tenantLogoUrl(logoUpdatedAt)}
              alt="Tenant logo"
              className="h-full w-full object-contain"
            />
          ) : (
            <ImageIcon className="h-8 w-8 text-text-tertiary" aria-hidden />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={ALLOWED_TYPES.join(",")}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onPick(file);
            }}
          />
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-md border-hairline border-border-emphasis bg-charcoal px-3 py-1.5 text-small font-medium text-white hover:bg-charcoal/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "upload" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Upload className="h-3.5 w-3.5" aria-hidden />
            )}
            {hasLogo ? "Replace logo" : "Upload logo"}
          </button>
          {hasLogo && (
            <button
              type="button"
              onClick={onRemove}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-md border-hairline border-border bg-surface-elevated px-3 py-1.5 text-small text-charcoal hover:bg-surface-recessed/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "delete" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              )}
              Remove
            </button>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-caption text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
