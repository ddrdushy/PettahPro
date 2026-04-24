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

// #56 — kept in lockstep with packages/db PLATFORM_ROLES. If you add a
// new role, update both ends + the migration's CHECK constraint + the
// create/patch Zod schemas in apps/api routes.
export const PLATFORM_ROLES = ["super_admin", "support", "billing"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  super_admin: "Super admin",
  support: "Support",
  billing: "Billing",
};

export interface PlatformUser {
  id: string;
  email: string;
  fullName: string;
  // #56 — optional in the type because the /auth/login/mfa response
  // returns a narrow user shape without a role (the real role lands on
  // /auth/me). Consumers should treat `role` as "definitely present on
  // /auth/me, maybe not elsewhere."
  role?: PlatformRole;
}

export interface PlatformStaffMember {
  id: string;
  email: string;
  fullName: string;
  role: PlatformRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
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

export interface PlatformMfaStatus {
  enabled: boolean;
  enrolledAt: string | null;
  lastUsedAt: string | null;
  backupCodesRemaining: number;
}

export interface PlatformMfaEnrollResponse {
  tempToken: string;
  otpauthUri: string;
  secret: string;
  qrCodeDataUrl: string | null;
}

// Login response is a union: either the session was minted immediately
// (no MFA) or we got a pre-session MFA challenge. The UI branches on
// mfaRequired — see components/platform/login-form.tsx.
export type PlatformLoginResponse =
  | { mfaRequired?: false; user: PlatformUser }
  | { mfaRequired: true; challengeId: string };

export const platformApi = {
  login: (body: { email: string; password: string }) =>
    request<PlatformLoginResponse>("/platform/auth/login", {
      method: "POST",
      json: body,
    }),
  loginMfa: (body: { challengeId: string; code: string }) =>
    request<{ user: PlatformUser; backupCodesRemaining: number }>(
      "/platform/auth/login/mfa",
      { method: "POST", json: body },
    ),
  logout: () =>
    request<{ ok: true }>("/platform/auth/logout", { method: "POST" }),
  me: () =>
    request<{
      user: PlatformUser & { role: PlatformRole };
      mfa: { enabled: boolean };
    }>("/platform/auth/me"),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    request<{ ok: true }>("/platform/auth/change-password", {
      method: "POST",
      json: body,
    }),
  mfaStatus: () => request<PlatformMfaStatus>("/platform/auth/mfa/status"),
  mfaEnroll: () =>
    request<PlatformMfaEnrollResponse>("/platform/auth/mfa/enroll", {
      method: "POST",
    }),
  mfaEnrollVerify: (body: { tempToken: string; code: string }) =>
    request<{ ok: true; backupCodes: string[] }>(
      "/platform/auth/mfa/enroll/verify",
      { method: "POST", json: body },
    ),
  mfaDisable: (body: { code: string }) =>
    request<{ ok: true }>("/platform/auth/mfa/disable", {
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
  // #56 — staff management. Super-admin-gated at the API layer; the web
  // also hides the /platform/staff entry for non-super_admin sessions,
  // so these methods only exist on super-admin surfaces.
  listPlatformUsers: () =>
    request<{ users: PlatformStaffMember[] }>("/platform/platform-users"),
  createPlatformUser: (body: {
    email: string;
    fullName: string;
    password: string;
    role: PlatformRole;
  }) =>
    request<{ user: PlatformStaffMember }>("/platform/platform-users", {
      method: "POST",
      json: body,
    }),
  patchPlatformUser: (
    id: string,
    body: { fullName?: string; role?: PlatformRole; isActive?: boolean },
  ) =>
    request<{ ok: true }>(`/platform/platform-users/${id}`, {
      method: "PATCH",
      json: body,
    }),
  deletePlatformUser: (id: string) =>
    request<{ ok: true }>(`/platform/platform-users/${id}`, {
      method: "DELETE",
    }),
  // #58 — platform overview + global audit + tenant notes PATCH.
  getOverview: () => request<PlatformOverview>("/platform/overview"),
  listPlatformAudit: (params: {
    kind?: string;
    actor?: string;
    limit?: number;
    offset?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    if (params.kind) qs.set("kind", params.kind);
    if (params.actor) qs.set("actor", params.actor);
    if (params.limit != null) qs.set("limit", String(params.limit));
    if (params.offset != null) qs.set("offset", String(params.offset));
    const q = qs.toString();
    return request<{
      total: number;
      limit: number;
      offset: number;
      entries: PlatformAuditEntryWithTenant[];
    }>(`/platform/audit${q ? `?${q}` : ""}`);
  },
  updateTenant: (id: string, body: { notes?: string | null }) =>
    request<{ ok: true }>(`/platform/tenants/${id}`, {
      method: "PATCH",
      json: body,
    }),
  // #57 / gap L1 v1 — operator impersonation. Platform-side. Tenant-side
  // sits in lib/api.ts (different cookie realm).
  createImpersonationRequest: (
    tenantId: string,
    body: { requestedMinutes: 15 | 30 | 60; reason: string },
  ) =>
    request<{ id: string }>(
      `/platform/tenants/${tenantId}/impersonation-requests`,
      { method: "POST", json: body },
    ),
  listImpersonationRequests: (params: {
    status?: string;
    limit?: number;
    offset?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.limit != null) qs.set("limit", String(params.limit));
    if (params.offset != null) qs.set("offset", String(params.offset));
    const q = qs.toString();
    return request<{ requests: PlatformImpersonationRequest[] }>(
      `/platform/impersonation-requests${q ? `?${q}` : ""}`,
    );
  },
  startImpersonation: (id: string) =>
    request<{ ok: true; sessionId: string; endsAt: string }>(
      `/platform/impersonation-requests/${id}/start`,
      { method: "POST" },
    ),
  listImpersonationSessions: () =>
    request<{ sessions: PlatformImpersonationSession[] }>(
      `/platform/impersonation-sessions`,
    ),
  endImpersonationSession: (id: string, body: { reason: string }) =>
    request<{ ok: true }>(`/platform/impersonation-sessions/${id}/end`, {
      method: "POST",
      json: body,
    }),
};

// #58 — the global audit feed includes tenantId so the UI can link
// each row to /platform/tenants/:id; per-tenant audit doesn't need it.
export interface PlatformAuditEntryWithTenant extends PlatformAuditEntry {
  tenantId: string | null;
}

// #58 — shape of the GET /platform/overview payload.  Deliberately
// flat by section so a renaming of a stat doesn't ripple through the
// whole client.  byStatus always carries every status key with 0 as
// the fallback, so consumers never need `?? 0`.
export interface PlatformOverview {
  tenants: {
    total: number;
    byStatus: Record<string, number>;
    signupsLast7Days: number;
    signupsLast30Days: number;
  };
  users: {
    total: number;
    activeLast7Days: number;
    activeLast30Days: number;
  };
  impersonation: {
    pendingRequests: number;
    approvedWaiting: number;
    activeSessions: number;
  };
  recentAudit: PlatformAuditEntryWithTenant[];
}

export interface PlatformImpersonationRequest {
  id: string;
  requestingPlatformUserEmail: string;
  targetTenantId: string;
  tenantBusinessName: string | null;
  tenantSlug: string | null;
  requestedMinutes: number;
  reason: string;
  status: "pending" | "approved" | "refused" | "expired" | "cancelled";
  approvedByUserEmail: string | null;
  approvedMinutes: number | null;
  approvedAt: string | null;
  refusedAt: string | null;
  refusedReason: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface PlatformImpersonationSession {
  id: string;
  requestId: string;
  platformUserEmail: string;
  targetTenantId: string;
  tenantBusinessName: string | null;
  tenantSlug: string | null;
  targetUserEmail: string;
  startedAt: string;
  endsAt: string;
  endedAt: string | null;
  endedBy: "platform" | "tenant" | "expired" | null;
}
