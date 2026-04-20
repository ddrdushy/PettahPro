const API_BASE =
  typeof window === "undefined"
    ? process.env.INTERNAL_API_URL ?? "http://api:4000"
    : process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  code: string;
  status: number;
  issues?: unknown;

  constructor(status: number, code: string, message: string, issues?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });

  const contentType = res.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await res.json() : null;

  if (!res.ok) {
    const err = payload?.error;
    throw new ApiError(
      res.status,
      err?.code ?? "UNKNOWN",
      err?.message ?? res.statusText,
      err?.issues,
    );
  }

  return payload as T;
}

export const api = {
  signup: (body: {
    businessName: string;
    ownerName: string;
    email: string;
    password: string;
  }) => request<{ user: User; tenant: Tenant }>("/auth/signup", { method: "POST", json: body }),

  login: (body: { email: string; password: string }) =>
    request<{ user: User }>("/auth/login", { method: "POST", json: body }),

  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),

  me: () => request<{ user: User; tenant: Tenant }>("/auth/me", { method: "GET" }),
};

export interface User {
  id: string;
  email: string;
  fullName: string;
  isOwner: boolean;
}

export interface Tenant {
  id: string;
  slug: string;
  businessName: string;
}
