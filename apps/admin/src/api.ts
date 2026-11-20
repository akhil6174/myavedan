/** Calls to /api/admin/*. Cloudflare Access adds the sign-in token; we only send JSON. */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : {},
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, String(data.error ?? `Request failed (${res.status})`), data);
  return data as T;
}

export type FieldState = "pending" | "approved" | "edited" | "rejected";

export interface Evidence {
  page: number;
  section?: string;
  snippet: string;
}

export interface Flag {
  field: string;
  code: string;
  severity: "error" | "warning";
  message: string;
}

export interface Field {
  key: string;
  group: "overview" | "dates" | "posts" | "eligibility" | "fees" | "links" | "process";
  label: string;
  critical: boolean;
  value: unknown;
  evidence: Evidence | null;
  grounded: boolean | null;
  flags: Flag[];
  state: FieldState;
  decision: { reviewer: string; at: string; reason?: string | null; value?: unknown } | null;
}

export interface Approval {
  ok: boolean;
  pending: string[];
  rejected: string[];
  errors: string[];
}

export interface VersionDetail {
  version: {
    id: string;
    state: string;
    version_no: number;
    sha256: string;
    retrieved_at: string;
    pages: number | null;
    document_url: string;
    document_kind: string;
    reviewable: boolean;
  };
  flags: Flag[];
  fields: Field[];
  approval: Approval;
  pages: Record<string, string>;
  previous: Record<string, unknown> | null;
  history: { action: string; field_key: string | null; reviewer: string; reason: string | null; created_at: string }[];
}

export interface QueueItem {
  id: string;
  state: string;
  title: string;
  organization: string | null;
  document_kind: string;
  document_url: string;
  update: boolean;
  apply_end: string | null;
  errors: number;
  warnings: number;
  received_at: string;
}

export interface Correction {
  id: string;
  opportunity_slug: string;
  field_key: string;
  message: string;
  status: string;
  created_at: string;
}

export type Role = "reader" | "reviewer" | "admin";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  created_at: number;
}

/** Better Auth endpoints (same origin). */
async function authCall<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/auth${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, String(data.message ?? data.error ?? `Sign-in failed (${res.status})`), data);
  return data as T;
}

export const signIn = {
  options: () => call<{ configured: boolean; google: boolean; dev: boolean }>("/sign-in-options"),
  google: async () => {
    const r = await authCall<{ url?: string }>("/sign-in/social", { provider: "google", callbackURL: "/" });
    if (r.url) location.href = r.url;
  },
  devSignIn: (email: string, password: string) => authCall("/sign-in/email", { email, password }),
  devSignUp: (email: string, password: string, name: string) => authCall("/sign-up/email", { email, password, name }),
  signOut: () => authCall("/sign-out", {}),
};

export const api = {
  me: () => call<{ email: string; role: Role }>("/me"),
  users: () => call<{ items: UserRow[] }>("/users"),
  setRole: (id: string, role: Role) => call<{ ok: true }>(`/users/${id}/role`, { method: "POST", body: { role } }),
  queue: () => call<{ items: QueueItem[]; open_corrections: number }>("/queue"),
  version: (id: string) => call<VersionDetail>(`/versions/${id}`),
  field: (id: string, body: { key: string; action: "approve" | "edit" | "reject"; value?: unknown; reason?: string }) =>
    call<{ ok: true }>(`/versions/${id}/fields`, { method: "POST", body }),
  bulk: (id: string, keys: string[]) => call<{ ok: true }>(`/versions/${id}/bulk`, { method: "POST", body: { keys } }),
  decide: (id: string, body: { action: "approve" | "reject" | "reprocess"; reason?: string; urgent?: boolean; change_note?: string }) =>
    call<{ ok: true; state: string; opportunity?: { slug: string } }>(`/versions/${id}/decision`, { method: "POST", body }),
  corrections: (status = "open") => call<{ items: Correction[] }>(`/corrections?status=${status}`),
  resolve: (id: string, status: "confirmed" | "not_an_error" | "fixed") => call<{ ok: true }>(`/corrections/${id}`, { method: "POST", body: { status } }),
};
