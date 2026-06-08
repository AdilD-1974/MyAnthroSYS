const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000/api/v1";

export const tokenStore = {
  get: () => sessionStorage.getItem("access_token"),
  set: (token: string) => sessionStorage.setItem("access_token", token),
  clear: () => sessionStorage.removeItem("access_token"),
};

async function request<T>(method: string, path: string, body?: unknown, options: RequestInit = {}): Promise<T> {
  const token = tokenStore.get();
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...options,
  });
  if (response.status === 401) { tokenStore.clear(); window.location.href = "/login"; throw new Error("Session expirée"); }
  if (!response.ok) { const error = await response.json().catch(() => ({ detail: "Erreur inconnue" })); throw new Error(error.detail ?? `Erreur ${response.status}`); }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export const api = {
  get:    <T>(path: string) => request<T>("GET", path),
  post:   <T>(path: string, body: unknown) => request<T>("POST", path, body),
  patch:  <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  put:    <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};

export const qs = (params: Record<string, unknown>): string => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return entries.length ? "?" + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&") : "";
};

export async function listAll<T = unknown>(path: string, query: Record<string, unknown> = {}): Promise<T[]> {
  const data = await api.get<T[] | { items: T[] }>(path + qs(query));
  return Array.isArray(data) ? data : (data?.items ?? []);
}

export async function findOne<T = unknown>(path: string, query: Record<string, unknown> = {}): Promise<T | null> {
  const items = await listAll<T>(path, query);
  return items[0] ?? null;
}

function pgFilters(opts: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts)) {
    if (v === undefined) continue;
    if (k === "select" || k === "offset") { out[k] = String(v); continue; }
    if (k === "limit" || k === "page_size") { out.limit = String(v); continue; }
    if (k === "order") {
      if (typeof v === "string" && v.length > 0) out.order = v.startsWith("-") ? `${v.slice(1)}.desc` : `${v}.asc`;
      continue;
    }
    if (k.endsWith("__isnull")) {
      const col = k.slice(0, -"__isnull".length);
      out[col] = v === true || v === "true" ? "is.null" : "not.is.null";
      continue;
    }
    if (v === null) { out[k] = "is.null"; continue; }
    const sv = String(v);
    if (/^(eq|neq|gt|gte|lt|lte|like|ilike|in|is|not|fts|cs|cd|sl|sr|nxr|nxl|adj|ov)\./i.test(sv)) { out[k] = sv; continue; }
    out[k] = `eq.${sv}`;
  }
  return out;
}

function dbPath(table: string): string { return `/db/${encodeURIComponent(table)}`; }

export const db = {
  async list<T = unknown>(table: string, opts: Record<string, unknown> = {}): Promise<T[]> {
    const data = await api.get<T[] | { items: T[] }>(dbPath(table) + qs(pgFilters(opts)));
    return Array.isArray(data) ? data : (data?.items ?? []);
  },
  async findOne<T = unknown>(table: string, opts: Record<string, unknown> = {}): Promise<T | null> {
    const items = await db.list<T>(table, { ...opts, limit: 1 });
    return items[0] ?? null;
  },
  create<T = unknown>(table: string, payload: unknown): Promise<T> { return api.post<T>(dbPath(table), payload); },
  update<T = unknown>(table: string, filters: Record<string, unknown>, patch: unknown): Promise<T> {
    return api.patch<T>(dbPath(table) + qs(pgFilters(filters)), patch);
  },
  remove(table: string, filters: Record<string, unknown>): Promise<void> {
    return api.delete<void>(dbPath(table) + qs(pgFilters(filters)));
  },
};

export interface TokenResponse { access_token: string; token_type: string; role: AppRole; all_roles: AppRole[]; user_id: string; nom?: string; prenom?: string; }
export type AppRole = "administrateur" | "gestionnaire_rh" | "gestionnaire_paie" | "manager" | "collaborateur";
export interface CollaborateurRead { id: string; matricule: string; nom: string; prenom: string; date_naissance: string; code_genre: string; statut_collaborateur: string; email_professionnel?: string; telephone?: string; gsm?: string; archive: boolean; created_at: string; updated_at: string; }
export interface CollaborateurList { total: number; page: number; page_size: number; items: CollaborateurRead[]; }
export interface DemandeCongeRead { id: string; collaborateur_id: string; type_conge_id: string; date_debut: string; date_fin: string; nombre_jours: number; statut: "en_attente" | "approuvee" | "refusee" | "annulee"; motif?: string; created_at: string; }
