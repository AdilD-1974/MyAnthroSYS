// ============================================================
// navApi.ts — src/lib/navApi.ts
// ------------------------------------------------------------
// CORRECTION DE FOND : api.get/post/... renvoie DÉJÀ le JSON
// (voir lib/api.ts). On ne déstructure donc plus `{ data }`
// (réflexe axios) — sinon tout revenait `undefined`.
//   Avant : const { data } = await api.get(...); return data;  // ❌ undefined
//   Après : return api.get<...>(...);                          // ✅ le JSON
// ============================================================
import { api } from "@/lib/api";

export interface NavSection {
  id: string;
  code: string;
  label: string;
  ordre: number;
  actif: boolean;
  items: NavItem[];
}

export interface NavItem {
  id: string;
  code: string;
  label: string;
  icone?: string;
  chemin?: string;
  section_id?: string;
  section_label?: string;
  section_code?: string;
  module_code?: string;
  parent_id?: string;
  ordre: number;
  actif: boolean;
  roles: string[];
  enfants?: NavItem[];
}

export interface NavItemCreate {
  code: string;
  label: string;
  icone?: string;
  chemin?: string;
  section_id?: string;
  module_code?: string;
  parent_id?: string;
  ordre?: number;
  roles?: string[];
}

export interface NavItemUpdate {
  label?: string;
  icone?: string;
  chemin?: string;
  section_id?: string;
  module_code?: string;
  parent_id?: string;
  ordre?: number;
  actif?: boolean;
  roles?: string[];
}

// ──────────────────────────────────────────────────────────────
// MODULES — source unique des libellés + couleurs (doit rester
// alignée avec la table nav_module / le seed). Sert au licensing
// (découpage par module) et à la coloration des icônes.
// ──────────────────────────────────────────────────────────────
export interface ModuleMeta { code: string; label: string; couleur: string; }

export const MODULES: Record<string, ModuleMeta> = {
  core:           { code: "core",           label: "Socle",                couleur: "#38BDF8" },
  personnel:      { code: "personnel",      label: "Dossier du personnel", couleur: "#60A5FA" },
  absences:       { code: "absences",       label: "Absences & Congés",    couleur: "#22D3EE" },
  manager:        { code: "manager",        label: "Management",           couleur: "#FBBF24" },
  prets:          { code: "prets",          label: "Prêts & Avances",      couleur: "#2DD4BF" },
  paie:           { code: "paie",           label: "Paie",                 couleur: "#34D399" },
  gpec:           { code: "gpec",           label: "GPEC & Emplois",       couleur: "#A78BFA" },
  recrutement:    { code: "recrutement",    label: "Recrutement",          couleur: "#F472B6" },
  formation:      { code: "formation",      label: "Formation",            couleur: "#FB923C" },
  performance:    { code: "performance",    label: "Performance",          couleur: "#C084FC" },
  relations:      { code: "relations",      label: "Relations sociales",   couleur: "#818CF8" },
  sante:          { code: "sante",          label: "Santé & Sécurité",     couleur: "#FB7185" },
  referentiels:   { code: "referentiels",   label: "Référentiels",         couleur: "#94A3B8" },
  configuration:  { code: "configuration",  label: "Configuration",        couleur: "#A1A1AA" },
  administration: { code: "administration", label: "Administration",       couleur: "#F87171" },
  pilotage:       { code: "pilotage",       label: "Pilotage & Audit",     couleur: "#FCD34D" },
  requeteur:      { code: "requeteur",      label: "Requêteur",            couleur: "#5EEAD4" },
  editions:       { code: "editions",       label: "Éditions",             couleur: "#60A5FA" },  // RG-EDT-NAV-02 (migration 079)
};

export const couleurModule = (code?: string): string =>
  (code && MODULES[code]?.couleur) || "#94A3B8";

export const labelModule = (code?: string): string =>
  (code && MODULES[code]?.label) || "—";

const BASE = "/navigation";

export const navApi = {
  // ── Lecture ──────────────────────────────────────────────
  menu: (role?: string): Promise<NavSection[]> =>
    api.get<NavSection[]>(`${BASE}/menu${role ? `?role=${encodeURIComponent(role)}` : ""}`),
  items: (): Promise<NavItem[]> => api.get<NavItem[]>(`${BASE}/items`),
  sections: (): Promise<NavSection[]> => api.get<NavSection[]>(`${BASE}/sections`),

  // ── Items ────────────────────────────────────────────────
  creerItem: (payload: NavItemCreate): Promise<NavItem> =>
    api.post<NavItem>(`${BASE}/items`, payload),
  modifierItem: (id: string, payload: NavItemUpdate): Promise<NavItem> =>
    api.patch<NavItem>(`${BASE}/items/${id}`, payload),
  supprimerItem: (id: string): Promise<void> =>
    api.delete<void>(`${BASE}/items/${id}`),
  reordonnerItems: (ordres: { id: string; ordre: number }[]): Promise<void> =>
    api.put<void>(`${BASE}/items/ordre`, ordres),
  setRoles: (id: string, roles: string[]): Promise<void> =>
    api.put<void>(`${BASE}/items/${id}/roles`, roles),

  // ── Sections ─────────────────────────────────────────────
  creerSection: (payload: { code: string; label: string; ordre?: number }): Promise<NavSection> =>
    api.post<NavSection>(`${BASE}/sections`, payload),
  modifierSection: (id: string, payload: { label?: string; ordre?: number; actif?: boolean }): Promise<NavSection> =>
    api.patch<NavSection>(`${BASE}/sections/${id}`, payload),
  reordonnerSections: (ordres: { id: string; ordre: number }[]): Promise<void> =>
    api.put<void>(`${BASE}/sections/ordre`, ordres),
};
