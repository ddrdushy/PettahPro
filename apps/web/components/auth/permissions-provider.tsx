"use client";

import { createContext, useContext, type ReactNode } from "react";
import { hasPermission, type CallerPermissions } from "@/lib/api";

// Dormant-safe default: treats every permission as granted so that
// when the provider is missing (e.g. rendered outside /app) UI does
// not collapse. The real envelope is seeded from /auth/me in the
// app layout.
const DEFAULT_PERMS: CallerPermissions = {
  isOwner: false,
  enforcementActive: false,
  granted: {},
};

const PermissionsContext = createContext<CallerPermissions>(DEFAULT_PERMS);

export function PermissionsProvider({
  value,
  children,
}: {
  value: CallerPermissions;
  children: ReactNode;
}) {
  return (
    <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>
  );
}

// Consume the caller permission envelope seeded by the app layout.
export function usePermissions(): CallerPermissions {
  return useContext(PermissionsContext);
}

// Convenience hook mirroring the server's requirePermission() decision.
// Use for gating action buttons: `if (!useCan("invoices.post")) return null;`
export function useCan(key: string): boolean {
  return hasPermission(useContext(PermissionsContext), key);
}
