/**
 * api.ts — Client HTTP centralisé pour l'API FastAPI.
 *
 * Remplace entièrement @supabase/supabase-js.
 * À placer dans : src/lib/api.ts
 *
 * Usage dans un composant React :
 *   import { api } from '@/lib/api'
 *   const collabs = await api.get('/collaborateurs?page=1&page_size=20')
 */

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000/api/v1";

// ── Gestion du token JWT en sessionStorage ────────────────────────────────────

export const tokenStore = {
  get: () => sessionStorage.getItem("access_token"),
  set: (token: string) => sessionStorage.setItem("access_token", token),
  clear: () => sessionStorage.removeItem("access_token"),
};

// ── Client HTTP de base ───────────────────────────────────────────────────────

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: RequestInit = {}
): Promise<T> {
  const token = tokenStore.get();

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...options,
  });

  // Token expiré → déconnexion automatique
  if (response.status === 401) {
    tokenStore.clear();
    window.location.href = "/login";
    throw new Error("Session expirée");
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Erreur inconnue" }));
    throw new Error(error.detail ?? `Erreur ${response.status}`);
  }

  // 204 No Content → pas de corps
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

// ── Types (alignés avec les schémas Pydantic FastAPI) ────────────────────────

export interface TokenResponse {
  access_token: string;
  token_type: string;
  role: AppRole;
  all_roles: AppRole[];
  user_id: string;
  nom?: string;
  prenom?: string;
}

export type AppRole =
  | "administrateur"
  | "gestionnaire_rh"
  | "gestionnaire_paie"
  | "manager"
  | "collaborateur";

export interface CollaborateurRead {
  id: string;
  matricule: string;
  nom: string;
  prenom: string;
  date_naissance: string;
  code_genre: string;
  statut_collaborateur: string;
  email_professionnel?: string;
  telephone?: string;
  gsm?: string;
  archive: boolean;
  created_at: string;
  updated_at: string;
}

export interface CollaborateurList {
  total: number;
  page: number;
  page_size: number;
  items: CollaborateurRead[];
}

export interface DemandeCongeRead {
  id: string;
  collaborateur_id: string;
  type_conge_id: string;
  date_debut: string;
  date_fin: string;
  nombre_jours: number;
  statut: "en_attente" | "approuvee" | "refusee" | "annulee";
  motif?: string;
  created_at: string;
}
