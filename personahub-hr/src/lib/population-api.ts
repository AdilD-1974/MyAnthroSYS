/**
 * src/lib/population-api.ts
 *
 * Gestion des populations de paie (population_paie) — CRUD complet.
 * Endpoints déjà existants côté backend (paie_calcul.py, confirmés en
 * relisant le code réel, pas devinés) : GET/POST/PATCH/DELETE /paie/populations,
 * POST /paie/populations/valider-sql, POST /paie/populations/apercu.
 */
import { api } from "@/lib/api";

export type ModePopulation = "CRITERES" | "SQL";

/**
 * Les 18 champs de critères (population_paie) — tous des listes de codes
 * (text[], sauf unite_ids qui est un uuid[] mais transite en string[] côté
 * JSON). Une liste vide = critère non appliqué (voir _criteres_params côté
 * backend : `criteres.xxx or None`).
 */
export interface PopulationCriteres {
  unite_ids: string[];
  codes_emploi: string[];
  types_contrat: string[];
  temps: string[];
  statuts_collaborateur: string[];
  regimes: string[];
  nationalites: string[];
  codes_fonction: string[];
  codes_categorie_professionnelle: string[];
  codes_college: string[];
  codes_responsabilite: string[];
  codes_niveau: string[];
  codes_grade: string[];
  codes_echelle: string[];
  codes_classe: string[];
  echelons: string[];
  codes_filiere: string[];
  codes_activite: string[];
}

export function criteresVides(): PopulationCriteres {
  return {
    unite_ids: [], codes_emploi: [], types_contrat: [], temps: [],
    statuts_collaborateur: [], regimes: [], nationalites: [],
    codes_fonction: [], codes_categorie_professionnelle: [], codes_college: [],
    codes_responsabilite: [], codes_niveau: [], codes_grade: [], codes_echelle: [],
    codes_classe: [], echelons: [], codes_filiere: [], codes_activite: [],
  };
}

export interface PopulationPaieRead {
  id: string;
  code: string;
  libelle: string;
  mode: ModePopulation;
  condition_sql: string | null;
  actif: boolean;
  archive: boolean;
  criteres: PopulationCriteres;
  nb_rubriques: number;
  nb_retirees: number;
  created_at?: string;
  updated_at?: string;
}

export interface PopulationPaieWrite {
  code: string; // ignoré par le backend en modification (immuable après création), requis par le type malgré tout
  libelle: string;
  mode: ModePopulation;
  condition_sql: string | null;
  actif: boolean;
  criteres: PopulationCriteres;
}

export function listerPopulationsCompletes(inclureArchivees = false): Promise<PopulationPaieRead[]> {
  return api.get<PopulationPaieRead[]>(`/paie/populations?inclure_archivees=${inclureArchivees}`);
}

export function creerPopulation(data: PopulationPaieWrite): Promise<PopulationPaieRead> {
  return api.post<PopulationPaieRead>("/paie/populations", data);
}

export function modifierPopulation(id: string, data: PopulationPaieWrite): Promise<PopulationPaieRead> {
  return api.patch<PopulationPaieRead>(`/paie/populations/${id}`, data);
}

export async function archiverPopulation(id: string): Promise<void> {
  await api.delete<void>(`/paie/populations/${id}`);
}

export interface ConditionSqlValidation {
  ok: boolean;
  erreur: string | null;
}

export function validerConditionSql(conditionSql: string): Promise<ConditionSqlValidation> {
  return api.post<ConditionSqlValidation>(`/paie/populations/valider-sql?condition_sql=${encodeURIComponent(conditionSql)}`, {});
}

export interface CollaborateurCible {
  id: string;
  matricule: string;
  nom: string;
  prenom: string;
  // Optionnels tant que app/schemas/paie_calcul.py (CollaborateurCible,
  // response_model backend) n'a pas été étendu en conséquence — présents
  // dès que ce sera fait, sans autre changement frontend nécessaire.
  unite_libelle?: string | null;
  type_contrat?: string | null;
  categorie_professionnelle?: string | null;
}

/**
 * Aperçu du nombre/liste de collaborateurs correspondants — AVANT même
 * d'enregistrer la population (mode + critères/condition_sql en ad hoc), ou
 * pour une population déjà enregistrée (population_id). Utile pour afficher
 * un compteur live pendant que l'utilisateur ajuste les critères.
 */
export function apercuPopulation(payload: {
  population_id?: string;
  mode?: ModePopulation;
  criteres?: PopulationCriteres;
  condition_sql?: string;
}): Promise<CollaborateurCible[]> {
  return api.post<CollaborateurCible[]>("/paie/populations/apercu", payload);
}
