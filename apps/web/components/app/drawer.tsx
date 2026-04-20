"use client";

import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
      <button
        type="button"
        aria-label="Close drawer"
        onClick={onClose}
        className="flex-1 bg-charcoal/30 animate-fade-in"
      />
      <div
        className="relative flex h-full w-full max-w-md flex-col overflow-hidden bg-offwhite shadow-xl animate-drawer-in"
        style={{ animation: "drawer-in 0.3s cubic-bezier(0.22, 1, 0.36, 1) both" }}
      >
        <header className="flex items-start justify-between gap-4 border-b-hairline border-border px-6 py-5">
          <div>
            <h2 id="drawer-title" className="text-h2 text-charcoal">{title}</h2>
            {description && <p className="mt-1 text-small text-text-secondary">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-md text-text-secondary transition-colors hover:bg-mint-surface hover:text-charcoal"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
      <style>{`
        @keyframes drawer-in {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
