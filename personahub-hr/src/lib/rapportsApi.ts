/**
 * rapportsApi.ts — Accès typé aux endpoints du module Rapports de paie.
 *
 * Endpoints backend (préfixe /api/v1/paie/rapports) :
 *   GET  /templates
 *   GET  /champs-disponibles
 *   POST /journal/apercu
 *   POST /journal/generer   (réponse binaire PDF/Excel)
 *
 * Utilise le même client que paieApi.ts (`api` de @/lib/api), qui gère
 * déjà le token d'authentification, l'URL de base et la déconnexion
 * automatique sur 401 — pas de fetch() indépendant.
 */
import { api, API_BASE, tokenStore, qs } from "@/lib/api";

export type TypeRapport = "BULLETIN" | "JOURNAL";

export interface RapportTemplate {
  id: string;
  code: string;
  libelle: string;
  libelle_court?: string;
  type_rapport: TypeRapport;
  description?: string;
  actif: boolean;
  par_defaut: boolean;
}

export interface JournalColonne {
  type: "champ" | "rubrique" | "total";
  cle?: string;
  code?: string;
  attribut?: "MT" | "NB" | "TX" | "BASE";
  libelle: string;
}

export type PerimetreJournal =
  | { mode: "periode_plan"; plan_paie_id: string; periode_id: string; organisation_ids?: string[] }
  | { mode: "collaborateur"; collaborateur_id: string; periode_id_debut: string; periode_id_fin: string }
  | { mode: "annee"; annee: number; plan_paie_id?: string; organisation_ids?: string[] };

export interface JournalLigne {
  valeurs: Record<string, unknown>;
  groupe?: Record<string, string>;
}

export interface JournalApercuResponse {
  colonnes: JournalColonne[];
  lignes: JournalLigne[];
  sous_totaux_par_groupe: Record<string, Record<string, number>>;
  total_general: Record<string, number>;
  nb_bulletins: number;
}

export interface ChampsDisponibles {
  champs_snapshot: { cle: string; libelle: string }[];
  rubriques: { code: string; libelle: string }[];
  totaux: { cle: string; libelle: string }[];
}

// ---- Journal grille (format réglementaire, cases configurables) ---------

export type TypeSourceCase = "IDENTITE" | "RUBRIQUE" | "CONSTANTE";

export type OperateurCondition =
  | "RENSEIGNEE" | "NON_ZERO" | "EGAL" | "DIFFERENT" | "SUPERIEUR" | "INFERIEUR" | "CONTIENT";

/** Condition d'affichage d'une case, évaluée bulletin par bulletin côté serveur. */
export interface GrilleCondition {
  /** "SELF" (la case elle-même) ou la clé "ligne_colonne" d'une autre case, ex. "2_3". */
  cible: string;
  operateur: OperateurCondition;
  valeur?: string | null;
  /** VIDE : la case reste en place, valeur vide. MASQUER : toute la case est effacée. */
  sinon: "VIDE" | "MASQUER";
}

export interface GrilleMasque {
  code: string;
  libelle: string;
  exemple: string;
}

export interface GrilleCase {
  id?: string;
  ligne: number;
  colonne: number;
  rowspan: number;
  colspan: number;
  libelle: string;
  type_source: TypeSourceCase;
  cle_identite?: string | null;
  code_rubrique?: string | null;
  attribut?: "MT" | "NB" | "TX" | "BASE" | null;
  valeur_constante?: string | null;
  ordre_affichage: number;
  // Habillage du modèle de sortie — tous optionnels (absents = rendu historique)
  masque?: string | null;
  texte_avant?: string | null;
  texte_apres?: string | null;
  /** null/absent = tiret "-" ; "" = laisser vide ; autre = ce texte. */
  valeur_si_vide?: string | null;
  condition_affichage?: GrilleCondition | null;
}

export interface GrilleBlocCollaborateur {
  bulletin_id: string;
  /** Valeurs déjà formatées par le serveur (masque, texte, condition) — identiques au PDF. */
  valeurs: Record<string, unknown>;
  /** Clés "ligne_colonne" des cases effacées par une condition « masquer ». */
  masquees?: string[];
}

export interface GrilleApercuResponse {
  entete: { adresse?: string; identifiant_fiscal?: string; affiliation_cnss?: string; logo_path?: string };
  cases: GrilleCase[];
  blocs: GrilleBlocCollaborateur[];
  nb_collaborateurs: number;
}

// ---- Bulletin de paie (5 modèles, en-tête/corps/pied configurables) -----

export interface EnteteChamp {
  libelle: string;
  cle_identite: string;
}

export interface CorpsColonne {
  cle: string;
  libelle: string;
}

export interface CorpsConfig {
  colonnes: CorpsColonne[];
  afficher_section_gains: boolean;
  afficher_section_retenues: boolean;
  afficher_cotisations_patronales: boolean;
  libelle_section_gains: string;
  libelle_section_retenues: string;
}

export interface PiedCumul {
  code_rubrique: string;
  libelle: string;
}

export interface PiedConfig {
  cumuls: PiedCumul[];
  mentions_legales: string;
  afficher_signature: boolean;
  texte_signature: string;
  afficher_date_paiement: boolean;
}

export interface BulletinConfig {
  template_id: string;
  style: string;
  entete_config: EnteteChamp[];
  corps_config: CorpsConfig;
  pied_config: PiedConfig;
}

export interface BulletinApercuResponse {
  entete_societe: Record<string, string | null>;
  entete_collaborateur: { libelle: string; valeur: unknown }[];
  lignes: { libelle: string; sens: string; valeurs: Record<string, unknown> }[];
  totaux: Record<string, number>;
  cumuls: { libelle: string; valeur: number }[];
  mentions_legales: string;
  afficher_signature: boolean;
  texte_signature: string;
  periode_libelle: string;
}

export const rapportsApi = {
  listerTemplates: (typeRapport?: TypeRapport) =>
    api.get<RapportTemplate[]>("/paie/rapports/templates" + qs({ type_rapport: typeRapport })),

  creerTemplate: (payload: Omit<RapportTemplate, "id">) =>
    api.post<RapportTemplate>("/paie/rapports/templates", payload),

  modifierTemplate: (id: string, payload: Omit<RapportTemplate, "id">) =>
    api.patch<RapportTemplate>(`/paie/rapports/templates/${id}`, payload),

  champsDisponibles: () => api.get<ChampsDisponibles>("/paie/rapports/champs-disponibles"),

  apercuJournal: (templateId: string, perimetre: PerimetreJournal) =>
    api.post<JournalApercuResponse>("/paie/rapports/journal/apercu", {
      template_id: templateId,
      perimetre,
    }),

  /**
   * Réponse binaire (PDF/Excel) : chemin séparé de `api.post`, qui attend
   * du JSON. Même mécanisme d'authentification que `uploadFile()` dans
   * @/lib/api (token manuel, pas de parsing JSON de la réponse).
   */
  genererJournal: async (
    templateId: string,
    perimetre: PerimetreJournal,
    formatExport: "PDF" | "EXCEL"
  ): Promise<Blob> => {
    const token = tokenStore.get();
    const response = await fetch(`${API_BASE}/paie/rapports/journal/generer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ template_id: templateId, perimetre, format_export: formatExport }),
    });
    if (response.status === 401) {
      tokenStore.clear();
      window.location.href = "/login";
      throw new Error("Session expirée");
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Erreur inconnue" }));
      throw new Error(error.detail ?? `Erreur ${response.status}`);
    }
    return response.blob();
  },

  // ---- Journal grille (format réglementaire) -----------------------------

  lireConfigGrille: (templateId: string) =>
    api.get<GrilleCase[]>(`/paie/rapports/journal-grille/config/${templateId}`),

  sauvegarderConfigGrille: (templateId: string, cases: GrilleCase[]) =>
    api.put<GrilleCase[]>(`/paie/rapports/journal-grille/config/${templateId}`, cases),

  masquesGrille: () => api.get<GrilleMasque[]>("/paie/rapports/journal-grille/masques"),

  apercuGrille: (templateId: string, perimetre: PerimetreJournal) =>
    api.post<GrilleApercuResponse>("/paie/rapports/journal-grille/apercu", {
      template_id: templateId,
      perimetre,
    }),

  genererGrillePdf: async (templateId: string, perimetre: PerimetreJournal): Promise<Blob> => {
    const token = tokenStore.get();
    const response = await fetch(`${API_BASE}/paie/rapports/journal-grille/generer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ template_id: templateId, perimetre, format_export: "PDF" }),
    });
    if (response.status === 401) {
      tokenStore.clear();
      window.location.href = "/login";
      throw new Error("Session expirée");
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Erreur inconnue" }));
      throw new Error(error.detail ?? `Erreur ${response.status}`);
    }
    return response.blob();
  },

  // ---- Bulletin de paie ---------------------------------------------------

  lireConfigBulletin: (templateId: string) =>
    api.get<BulletinConfig>(`/paie/rapports/bulletin/config/${templateId}`),

  dernierBulletin: (collaborateurId: string) =>
    api.get<{ bulletin_id: string; origine: string; periode_libelle: string }>(
      "/paie/rapports/bulletin/dernier" + qs({ collaborateur_id: collaborateurId })
    ),

  sauvegarderConfigBulletin: (templateId: string, config: Omit<BulletinConfig, "template_id">) =>
    api.put<BulletinConfig>(`/paie/rapports/bulletin/config/${templateId}`, config),

  apercuBulletin: (templateId: string, bulletinId: string) =>
    api.post<BulletinApercuResponse>("/paie/rapports/bulletin/apercu", {
      template_id: templateId,
      bulletin_id: bulletinId,
    }),

  genererBulletinPdf: async (templateId: string, bulletinId: string): Promise<Blob> => {
    const token = tokenStore.get();
    const response = await fetch(`${API_BASE}/paie/rapports/bulletin/generer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ template_id: templateId, bulletin_id: bulletinId, format_export: "PDF" }),
    });
    if (response.status === 401) {
      tokenStore.clear();
      window.location.href = "/login";
      throw new Error("Session expirée");
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Erreur inconnue" }));
      throw new Error(error.detail ?? `Erreur ${response.status}`);
    }
    return response.blob();
  },
};

// Coercition défensive des valeurs numériques d'une ligne de journal
// (même précaution que TraitementPaiePage.tsx : addition/tri fiables
// même si l'API sort les nombres en chaîne).
export function valeurNumerique(v: unknown): number {
  return Number(v) || 0;
}
