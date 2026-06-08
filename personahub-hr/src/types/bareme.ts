/**
 * Types TypeScript — Barèmes (alignés sur les schémas Pydantic du backend).
 */

export type TypeCle = "NUMERIQUE" | "TEXTE" | "DATE" | "BOOLEEN";
export type ModeCle = "EXACT" | "PLAGE";
export type TypeSortie = "TAUX" | "MONTANT" | "NUMERIQUE" | "TEXTE" | "BOOLEEN";

export interface BaremeCle {
  id?: string;
  nom_technique: string;
  libelle: string;
  type: TypeCle;
  mode: ModeCle;
  ordre: number;
}

export interface BaremeSortie {
  id?: string;
  nom_technique: string;
  libelle: string;
  type: TypeSortie;
  par_defaut: boolean;
  ordre: number;
}

/** Une valeur de clé peut être : un scalaire (mode EXACT) ou un {min, max} (mode PLAGE). */
export type ValeurCle = string | number | boolean | { min: number | string; max: number | string };

export interface BaremeLigne {
  id?: string;
  ordre: number;
  valeurs_cles: Record<string, ValeurCle>;
  valeurs_sorties: Record<string, string | number | boolean | null>;
  commentaire: string | null;
}

export interface BaremeBase {
  code: string;
  libelle: string;
  description: string | null;
  date_debut_validite: string; // ISO date (YYYY-MM-DD)
  date_fin_validite: string | null;
  reference_decision: string | null;
  actif: boolean;
}

export interface Bareme extends BaremeBase {
  id: string;
  archive: boolean;
  created_at: string;
  updated_at: string;
  cles: Required<BaremeCle>[];
  sorties: Required<BaremeSortie>[];
  lignes: Required<BaremeLigne>[];
}

export interface BaremeListItem extends BaremeBase {
  id: string;
  archive: boolean;
  nb_cles: number;
  nb_sorties: number;
  nb_lignes: number;
  updated_at: string;
}

/** Payload pour POST / PUT : tout le barème en un seul objet. */
export interface BaremePayload extends BaremeBase {
  cles: BaremeCle[];
  sorties: BaremeSortie[];
  lignes: BaremeLigne[];
}

// ---------------------------------------------------------------------------
// Helpers / défauts
// ---------------------------------------------------------------------------
export const TYPE_CLE_OPTIONS: { value: TypeCle; label: string }[] = [
  { value: "NUMERIQUE", label: "Numérique" },
  { value: "TEXTE",     label: "Texte" },
  { value: "DATE",      label: "Date" },
  { value: "BOOLEEN",   label: "Booléen" },
];

export const MODE_CLE_OPTIONS: { value: ModeCle; label: string }[] = [
  { value: "EXACT", label: "Exact" },
  { value: "PLAGE", label: "Plage (min ≤ x ≤ max)" },
];

export const TYPE_SORTIE_OPTIONS: { value: TypeSortie; label: string }[] = [
  { value: "TAUX",      label: "Taux (%)" },
  { value: "MONTANT",   label: "Montant" },
  { value: "NUMERIQUE", label: "Numérique" },
  { value: "TEXTE",     label: "Texte" },
  { value: "BOOLEEN",   label: "Booléen" },
];

export function emptyBareme(): BaremePayload {
  const today = new Date().toISOString().slice(0, 10);
  return {
    code: "",
    libelle: "",
    description: null,
    date_debut_validite: today,
    date_fin_validite: null,
    reference_decision: null,
    actif: true,
    cles: [
      { nom_technique: "cle1", libelle: "Clé 1", type: "NUMERIQUE", mode: "EXACT", ordre: 0 },
    ],
    sorties: [
      { nom_technique: "valeur", libelle: "Valeur", type: "TAUX", par_defaut: true, ordre: 0 },
    ],
    lignes: [],
  };
}
