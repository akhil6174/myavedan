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
  /** red: must check before approving; yellow: for information. */
  tier?: "red" | "yellow";
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
  /** For results, admit cards...: the recruitments it most likely belongs to, best first. */
  suggestions?: { id: string; slug: string; title: string; score: number; why: string }[];
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

export interface FoundLink {
  id: string;
  url: string;
  kind: "apply_link" | "corrigendum" | "admit_card" | "answer_key" | "result" | "cutoff";
  link_text: string;
  found_at: string;
  organization: string | null;
  suggestions: { id: string; slug: string; title: string; score: number; why: string }[];
}

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

export interface HealthReport {
  runs: { id: string; started_at: string; finished_at: string | null; host: string | null; counts: Record<string, number>; errors: string[] }[];
  sites: {
    id: string;
    url: string;
    organization: string;
    last_result: string | null;
    last_error: string | null;
    last_checked: string | null;
    last_ok: string | null;
    last_new: string | null;
    links: number | null;
  }[];
  open_unsure: number;
}

export interface UnsureLink {
  id: string;
  url: string;
  link_text: string;
  found_at: string;
  organization: string | null;
}

export const api = {
  health: () => call<HealthReport>("/health"),
  unsure: () => call<{ items: UnsureLink[] }>("/unsure"),
  unsureRead: (id: string, kind: string) => call<{ ok: true }>(`/unsure/${id}`, { method: "POST", body: { action: "read", kind } }),
  unsureDismiss: (id: string) => call<{ ok: true }>(`/unsure/${id}`, { method: "POST", body: { action: "dismiss" } }),
  me: () => call<{ email: string; role: Role }>("/me"),
  publishStatus: () =>
    call<{
      waiting: number;
      configured: boolean;
      batches: { id: string; requested_at: string; dispatched_at: string | null; deployed_at: string | null; urgent: number; versions: number }[];
    }>("/publish"),
  publishNow: () => call<{ dispatched: boolean; reason: string; versions?: number }>("/publish", { method: "POST" }),
  links: () => call<{ items: FoundLink[] }>("/links"),
  opportunities: () => call<{ items: { id: string; slug: string; title: string; advt_no: string | null; organization: string | null }[] }>("/opportunities"),
  attachLink: (id: string, body: { opportunity_id: string; title?: string; date?: string }) =>
    call<{ ok: true; opportunity: string }>(`/links/${id}`, { method: "POST", body: { action: "attach", ...body } }),
  dismissLink: (id: string) => call<{ ok: true }>(`/links/${id}`, { method: "POST", body: { action: "dismiss" } }),
  users: () => call<{ items: UserRow[] }>("/users"),
  setRole: (id: string, role: Role) => call<{ ok: true }>(`/users/${id}/role`, { method: "POST", body: { role } }),
  queue: () => call<{ items: QueueItem[]; open_corrections: number }>("/queue"),
  version: (id: string) => call<VersionDetail>(`/versions/${id}`),
  field: (id: string, body: { key: string; action: "approve" | "edit" | "reject"; value?: unknown; reason?: string }) =>
    call<{ ok: true }>(`/versions/${id}/fields`, { method: "POST", body }),
  bulk: (id: string, keys: string[]) => call<{ ok: true }>(`/versions/${id}/bulk`, { method: "POST", body: { keys } }),
  setKind: (id: string, kind: string) => call<{ ok: true; kind: string }>(`/versions/${id}/kind`, { method: "POST", body: { kind } }),
  decide: (id: string, body: { action: "approve" | "reject" | "reprocess" | "attach"; reason?: string; urgent?: boolean; change_note?: string; opportunity_id?: string; date?: string }) =>
    call<{ ok: true; state: string; opportunity?: { slug: string } }>(`/versions/${id}/decision`, { method: "POST", body }),
  corrections: (status = "open") => call<{ items: Correction[] }>(`/corrections?status=${status}`),
  resolve: (id: string, status: "confirmed" | "not_an_error" | "fixed") => call<{ ok: true }>(`/corrections/${id}`, { method: "POST", body: { status } }),
};
