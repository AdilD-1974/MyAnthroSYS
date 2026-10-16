/**
 * virementsApi.ts
 * Client API du module Virements des salaires & Retenues à la source.
 * Emplacement confirmé : src/lib/virementsApi.ts (à côté de api.ts, paieApi.ts).
 *
 * Aligné sur le vrai client `api` de src/lib/api.ts (fetch natif, pas axios) :
 * pas de wrapper {data}, les fonctions retournent directement le type attendu.
 * Le téléchargement du fichier SIMT n'utilise PAS `api.get` (qui fait
 * toujours .json()) mais un fetch dédié en blob, sur le même principe que
 * uploadFile() dans api.ts.
 */

import { api, qs, API_BASE, tokenStore } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RefBanque {
  code: string;
  libelle: string;
  code_pays: string;
  code_simt: string | null;
  actif: boolean;
}

export interface CompteBancaireEmetteur {
  id: string;
  societe_id: string;
  code_banque: string;
  agence: string | null;
  numero_compte: string;
  code_simt_effectif: string | null;
  rib: string | null;
  raison_sociale_emetteur: string | null;
  actif: boolean;
}

export interface AssociationCompteTypeVirement {
  compte_bancaire_id: string;
  type_virement: TypeOrdreVirement;
}

export interface TypeTiersPayeur {
  code: string;
  libelle: string;
  actif: boolean;
}

export interface TiersPayeur {
  id: string;
  type_tiers_payeur_code: string;
  type_tiers_payeur_libelle?: string;
  nom: string;
  rib: string | null;
  reference_externe: string | null;
  actif: boolean;
}

export type StatutRetenueTiers = "ACTIF" | "SUSPENDU" | "SOLDE";

export interface TypeRetenueSource {
  code: string;
  libelle: string;
  rubrique_paie_code: string;
  rubrique_paie_libelle?: string;
  priorite_defaut: number;
  actif: boolean;
}

export interface RetenueTiers {
  id: string;
  collaborateur_id: string;
  collaborateur_nom?: string;
  collaborateur_matricule?: string;
  tiers_payeur_id: string;
  tiers_payeur_nom?: string;
  type_retenue_source_code: string;
  type_retenue_source_libelle?: string;
  rubrique_paie_code?: string;
  rubrique_paie_libelle?: string;
  priorite: number;
  reference_dossier: string | null;
  date_debut: string;
  date_fin: string | null;
  statut: StatutRetenueTiers;
}

export type TypeOrdreVirement = "SALAIRE" | "RETENUE_TIERS" | "PRET_EXTERNE" | "AD_HOC";
export type StatutOrdreVirement =
  | "BROUILLON" | "ENREGISTRE" | "EN_CONTROLE" | "VALIDE" | "GENERE"
  | "TRANSMIS" | "EXECUTE" | "PARTIEL" | "REJETE";
export type ModeGeneration = "MANUEL" | "VENTILE";

export interface ControleOrdre {
  type_controle: "MONTANT_TOTAL" | "RIB_VALIDE" | "DOUBLONS" | "ECART_PERIODE_PRECEDENTE" | "NB_LIGNES_ATTENDU" | "COMPTE_EMETTEUR_ACTIF";
  resultat: "OK" | "ALERTE" | "ERREUR";
  message: string;
  controle_par?: string;
  controle_le?: string;
}

export interface OrdreVirement {
  id: string;
  type: TypeOrdreVirement;
  nature_operation: "34" | "32" | "35";
  periode_id?: string | null;
  periode_libelle?: string;
  banque_emettrice_id: string;
  banque_emettrice_libelle?: string;
  date_valeur: string;
  reference_lot: string;
  statut: StatutOrdreVirement;
  nb_lignes: number;
  montant_total: number;
  created_at: string;
}

export interface LigneVirement {
  id: string;
  ordre_virement_id: string;
  beneficiaire_type: "COLLABORATEUR_PRINCIPAL" | "TIERS_RETENUE" | "ORGANISME_CREDIT_PRET";
  collaborateur_nom?: string;
  nom_beneficiaire_snapshot: string;
  rib_beneficiaire_snapshot: string;
  montant: number;
  libelle_motif: string;
  statut_ligne: "GENEREE" | "EXECUTEE" | "REJETEE";
  motif_rejet: string | null;
  controlee: boolean;
}

export interface VirementSyntheseKpi {
  net_a_payer: { montant: number; nb_collaborateurs: number };
  retenues_tiers: { montant: number; nb_dossiers: number };
  prets_externes: { montant: number; nb_echeances: number };
  rejets_a_traiter: number;
}

// ---------------------------------------------------------------------------
// Téléchargement du fichier SIMT — hors du pattern api.get (blob, pas JSON)
// ---------------------------------------------------------------------------

async function telechargerFichierSimt(ordreId: string): Promise<Blob> {
  const token = tokenStore.get();
  const response = await fetch(`${API_BASE}/virements/ordres/${ordreId}/fichier-simt`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
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
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export const virementsApi = {
  // Référentiel banques / comptes émetteurs : voir societe_comptes_bancaires
  // via l'endpoint générique db.list()/db.update() — plus de wrapper ici.

  // Tiers payeurs / dossiers de retenue
  // Tiers payeurs : voir /db/tiers_payeur générique (db.list/db.create) —
  // plus de route dédiée, comme pour les comptes émetteurs.

  getRetenuesTiers: (params?: { collaborateur_id?: string; statut?: StatutRetenueTiers }) =>
    api.get<RetenueTiers[]>(`/virements/retenues-tiers${qs(params ?? {})}`),

  createRetenueTiers: (payload: Omit<RetenueTiers, "id">) =>
    api.post<RetenueTiers>("/virements/retenues-tiers", payload),

  updateRetenueTiers: (id: string, payload: Partial<RetenueTiers>) =>
    api.patch<RetenueTiers>(`/virements/retenues-tiers/${id}`, payload),

  suspendreRetenueTiers: (id: string) =>
    api.patch<RetenueTiers>(`/virements/retenues-tiers/${id}`, { statut: "SUSPENDU" }),

  // KPI / ordres de virement
  getKpiPeriode: (periode_id: string) =>
    api.get<VirementSyntheseKpi>(`/virements/kpi${qs({ periode_id })}`),

  getOrdresVirement: (params?: { periode_id?: string; banque_emettrice_id?: string }) =>
    api.get<OrdreVirement[]>(`/virements/ordres${qs(params ?? {})}`),

  genererOrdreVirement: (payload: {
    type: "SALAIRE" | "RETENUE_TIERS" | "PRET_EXTERNE";
    periode_id: string;
    mode: ModeGeneration;
    banque_emettrice_id?: string;
    date_valeur: string;
  }) => api.post<{ id: string; reference_lot: string; nb_lignes: number; montant_total: number }[]>(
    "/virements/ordres/generer",
    payload
  ),

  genererOrdreAdHoc: (payload: {
    banque_emettrice_id: string;
    date_valeur: string;
    libelle_motif: string;
    plan_paie_id?: string;
    lignes: { collaborateur_id: string; montant: number }[];
  }) => api.post<{ id: string; reference_lot: string; nb_lignes: number; montant_total: number }>(
    "/virements/ordres/ad-hoc",
    payload
  ),

  getLignesOrdreVirement: (ordre_id: string) =>
    api.get<LigneVirement[]>(`/virements/ordres/${ordre_id}/lignes`),

  telechargerFichierSimt,

  regenererLignesBrouillon: (ordre_id: string) =>
    api.post<{ id: string; nb_lignes: number; montant_total: number }>(`/virements/ordres/${ordre_id}/regenerer-lignes`, {}),

  enregistrerOrdre: (ordre_id: string) =>
    api.patch<{ id: string; statut: string }>(`/virements/ordres/${ordre_id}/enregistrer`, {}),

  controlerOrdre: (ordre_id: string) =>
    api.post<ControleOrdre[]>(`/virements/ordres/${ordre_id}/controler`, {}),

  getControlesOrdre: (ordre_id: string) =>
    api.get<ControleOrdre[]>(`/virements/ordres/${ordre_id}/controles`),

  cocherLigne: (ligne_id: string, valeur: boolean) =>
    api.patch<{ id: string; controlee: boolean }>(`/virements/lignes/${ligne_id}/cocher${qs({ valeur })}`, {}),

  validerOrdre: (ordre_id: string, forcerAlertes = false) =>
    api.patch<{ id: string; statut: string }>(`/virements/ordres/${ordre_id}/valider${qs({ forcer_alertes: forcerAlertes })}`, {}),

  genererFichierOrdre: (ordre_id: string) =>
    api.post<{ id: string; fichier_genere_path: string }>(`/virements/ordres/${ordre_id}/generer-fichier`, {}),

  revenirEnArriere: (ordre_id: string) =>
    api.post<{ id: string }>(`/virements/ordres/${ordre_id}/revenir-arriere`, {}),

  marquerTransmis: (ordre_id: string) =>
    api.patch<{ id: string; statut: string }>(`/virements/ordres/${ordre_id}/transmis`, {}),

  marquerExecute: (ordre_id: string) =>
    api.patch<{ id: string; statut: string }>(`/virements/ordres/${ordre_id}/execute`, {}),

  signalerRejet: (ordre_id: string, payload: { lignes_rejetees: { ligne_id: string; motif: string }[] }) =>
    api.patch<{ id: string }>(`/virements/ordres/${ordre_id}/rejet`, payload),

  regenererOrdreVirement: (ordre_id: string) =>
    api.post<{ id: string }>(`/virements/ordres/${ordre_id}/regenerer`, {}),
};
