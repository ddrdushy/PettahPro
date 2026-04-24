// Platform-admin (#54 / gap L1) client-side API helpers.
//
// Distinct from lib/api.ts because:
//   - Different cookie namespace (pp_platform_csrf, path-scoped to /platform)
//   - Different base URL concerns are irrelevant, but keeping this file
//     separate makes it obvious that platform and tenant calls never share
//     credentials or typing.
//
// Mirrors the shape of lib/api.ts's request() function but reads the
// platform CSRF cookie. The fetch credentials still go cross-cookie —
// the browser includes any cookie whose path/domain matches, which is
// correct: we want pp_platform_session on /platform/* and neither on
// the tenant endpoints. Cookie path-scoping in cookies.ts enforces it.

const API_BASE =
  typeof window === "undefined"
    ? process.env.INTERNAL_API_URL ?? "http://api:4000"
    : process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class PlatformApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const prefix = `${name}=`;
  for (const raw of document.cookie.split(";")) {
    const part = raw.trim();
    if (part.startsWith(prefix)) {
      return decodeURIComponent(part.slice(prefix.length));
    }
  }
  return undefined;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

async function request<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, headers, ...rest } = init;
  const hasBody = json !== undefined || rest.body != null;
  const method = (rest.method ?? "GET").toUpperCase();
  const csrfToken = SAFE_METHODS.has(method) ? undefined : readCookie("pp_platform_csrf");
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    credentials: "include",
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      ...(headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const contentType = res.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await res.json() : null;
  if (!res.ok) {
    const err = payload?.error;
    throw new PlatformApiError(res.status, err?.code ?? "UNKNOWN", err?.message ?? res.statusText);
  }
  return payload as T;
}

export interface PlatformUser {
  id: string;
  email: string;
  fullName: string;
}

export interface TenantSummary {
  id: string;
  slug: string;
  businessName: string;
  country: string;
  timezone: string;
  status: string;
  createdAt: string;
  notes: string | null;
  userCount: number;
  lastLoginAt: string | null;
}

export interface TenantDetail extends TenantSummary {
  updatedAt: string;
}

export interface TenantUser {
  id: string;
  anonymousLabel: string;
  email: string | null;
  fullName: string | null;
  isOwner: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
}

export interface PlatformAuditEntry {
  id: string;
  platformUserEmail: string;
  kind: string;
  summary: string;
  reason: string | null;
  createdAt: string;
}

export const platformApi = {
  login: (body: { email: string; password: string }) =>
    request<{ user: PlatformUser }>("/platform/auth/login", {
      method: "POST",
      json: body,
    }),
  logout: () =>
    request<{ ok: true }>("/platform/auth/logout", { method: "POST" }),
  me: () => request<{ user: PlatformUser }>("/platform/auth/me"),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    request<{ ok: true }>("/platform/auth/change-password", {
      method: "POST",
      json: body,
    }),
  listTenants: (params: {
    status?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.search) qs.set("search", params.search);
    if (params.limit != null) qs.set("limit", String(params.limit));
    if (params.offset != null) qs.set("offset", String(params.offset));
    const q = qs.toString();
    return request<{
      total: number;
      limit: number;
      offset: number;
      tenants: TenantSummary[];
    }>(`/platform/tenants${q ? `?${q}` : ""}`);
  },
  getTenant: (id: string) =>
    request<{ tenant: TenantDetail }>(`/platform/tenants/${id}`),
  listTenantUsers: (id: string, opts: { reveal?: boolean; reason?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.reveal) qs.set("reveal", "1");
    if (opts.reason) qs.set("reason", opts.reason);
    const q = qs.toString();
    return request<{ users: TenantUser[] }>(
      `/platform/tenants/${id}/users${q ? `?${q}` : ""}`,
    );
  },
  listTenantPlatformAudit: (id: string) =>
    request<{ entries: PlatformAuditEntry[] }>(
      `/platform/tenants/${id}/platform-audit`,
    ),
  suspendTenant: (id: string, body: { reason: string }) =>
    request<{ ok: true; status: string }>(`/platform/tenants/${id}/suspend`, {
      method: "POST",
      json: body,
    }),
  reactivateTenant: (id: string, body: { reason: string }) =>
    request<{ ok: true; status: string }>(`/platform/tenants/${id}/reactivate`, {
      method: "POST",
      json: body,
    }),
};
