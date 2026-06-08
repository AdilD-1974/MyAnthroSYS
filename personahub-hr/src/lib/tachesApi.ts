// src/lib/tachesApi.ts
// ------------------------------------------------------------
// Client REST — Module tâches PersonaHub HR
// Adapté à api.ts existant : utilise { api, qs, AppRole }
// ------------------------------------------------------------
import { api, qs, AppRole } from "@/lib/api";

// ─── Types ───────────────────────────────────────────────────

export type TacheStatut     = "a_faire" | "en_cours" | "terminee" | "annulee";
export type TachePriorite   = "basse" | "normale" | "haute" | "urgente";
export type TacheType       = "personnelle" | "assignee" | "workflow" | "rh_metier";
export type RoleAssignation = "responsable" | "participant" | "observateur";

export interface Assignation {
  collaborateur_id: string;
  role_assignation: RoleAssignation;
  assigne_le?: string;
}

export interface Rappel {
  id: string;
  date_rappel: string;
  type_rappel: "inapp" | "email" | "les_deux";
  envoye: boolean;
}

export interface Tache {
  id: string;
  titre: string;
  description?: string;
  type_tache: TacheType;
  statut: TacheStatut;
  priorite: TachePriorite;
  date_echeance?: string;
  date_debut?: string;
  cree_le: string;
  modifie_le: string;
  termine_le?: string;
  createur_id: string;
  proprietaire_id: string;
  demande_id?: string;
  wf_instance_id?: string;
  etiquettes: string[];
  metadata: Record<string, unknown>;
  assignations: Assignation[];
  rappels?: Rappel[];
  en_retard: boolean;
}

export interface TacheCompteurs {
  total_actives: number;
  en_retard: number;
  dues_aujourd_hui: number;
  haute_priorite: number;
}

export interface TacheFilters {
  statut?: TacheStatut;
  priorite?: TachePriorite;
  type_tache?: TacheType;
  date_debut?: string;
  date_fin?: string;
  assignataire_id?: string;
  etiquette?: string;
  search?: string;
  include_terminees?: boolean;
}

export interface TacheCreateInput {
  titre: string;
  description?: string;
  type_tache?: TacheType;
  statut?: TacheStatut;
  priorite?: TachePriorite;
  date_echeance?: string;
  date_debut?: string;
  proprietaire_id?: string;
  demande_id?: string;
  wf_instance_id?: string;
  etiquettes?: string[];
  assignations?: { collaborateur_id: string; role?: RoleAssignation }[];
}

export type TachePatchInput = Partial<TacheCreateInput>;


// ─── API calls ───────────────────────────────────────────────
// Utilise api.get / api.post / api.patch / api.delete
// exactement comme dans votre api.ts existant

export const tachesApi = {

  list(filters: TacheFilters = {}): Promise<Tache[]> {
    // Utilise qs() de votre api.ts pour construire la query string
    return api.get<Tache[]>(`/taches${qs(filters as Record<string, unknown>)}`);
  },

  compteurs(): Promise<TacheCompteurs> {
    return api.get<TacheCompteurs>("/taches/compteurs");
  },

  get(id: string): Promise<Tache> {
    return api.get<Tache>(`/taches/${id}`);
  },

  create(data: TacheCreateInput): Promise<Tache> {
    return api.post<Tache>("/taches", data);
  },

  update(id: string, data: TachePatchInput): Promise<Tache> {
    return api.patch<Tache>(`/taches/${id}`, data);
  },

  changeStatut(id: string, statut: TacheStatut): Promise<Tache> {
    return api.patch<Tache>(`/taches/${id}`, { statut });
  },

  delete(id: string): Promise<void> {
    return api.delete<void>(`/taches/${id}`);
  },
};

export default tachesApi;
