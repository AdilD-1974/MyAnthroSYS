// pretsApi.ts — Client REST du module Gestion des Prêts
// src/lib/pretsApi.ts

import { api } from "@/lib/api";

// ──────────────────────────────────────────────────────────────
// TYPES
// ──────────────────────────────────────────────────────────────

export type PretStatut =
  | "brouillon" | "en_attente_validation" | "valide" | "debloque"
  | "en_cours" | "suspendu" | "solde" | "refuse" | "annule";

export type PretAlgo = "french_amortissement" | "lineaire" | "in_fine";
export type EcheanceStatut = "planifiee" | "prelevee" | "reportee" | "forcee" | "annulee";
export type MotifSuspension = "conge_sans_solde" | "conge_parental" | "maladie_longue_duree" | "disponibilite" | "autre";
export type ModeSuspension = "gel_echeance" | "hors_paie";

export interface Pret {
  id: string;
  matricule: string;
  collab_nom?: string;
  ref_pret: string;
  pret_interne: boolean;
  mt_pret: number;
  tx_interets: number;
  nb_echeance: number;
  mt_echeance?: number;
  mt_echeance_plus: number;
  algo_name: PretAlgo;
  inclure_interets: boolean;
  tx_endettement_i?: number;
  statut: PretStatut;
  imputable_paie: boolean;
  pret_debloque: boolean;
  pret_suspendu: boolean;
  manuel: boolean;
  forcage: boolean;
  dt_decision?: string;
  ref_decision?: string;
  motif_decision?: string;
  matric_decideur?: string;
  competenc_decideur?: string;
  dt_demande: string;
  dt_deblocage?: string;
  dt_debut_remb?: string;
  dt_proch_echeance?: string;
  fin_prevue?: string;
  mt_debloque?: number;
  mt_rembourse: number;
  capital_restant: number;
  echeance_restant?: number;
  no_cheque?: string;
  banque_emettrice?: string;
  organisme_credit?: string;
  etab_credit?: string;
  code_bqe?: string;
  no_compte?: string;
  clerib?: string;
  motif_suspension?: MotifSuspension;
  mode_suspension?: ModeSuspension;
  dt_debut_suspension?: string;
  dt_fin_suspension?: string;
  security_level: number;
  created_date: string;
  created_by: string;
  modified_date?: string;
  modified_by?: string;
}

export interface PretDetail extends Pret {
  echeancier: Echeance[];
  audit: AuditLog[];
  collab_nom: string;
  mat_collab: string;
  date_entree?: string;
}

export interface Echeance {
  id: string;
  pret_id: string;
  numero: number;
  date_echeance: string;
  capital_du: number;
  mt_capital: number;
  mt_interet: number;
  mt_total: number;
  capital_restant: number;
  statut: EcheanceStatut;
  date_prelevement?: string;
  mt_preleve?: number;
  reliquat: number;
  reference_paie?: string;
  note?: string;
}

export interface AuditLog {
  id: string;
  pret_id: string;
  action: string;
  champ?: string;
  ancienne_valeur?: string;
  nouvelle_valeur?: string;
  operateur: string;
  security_level_operateur?: number;
  horodatage: string;
  contexte?: Record<string, unknown>;
}

export interface Alerte {
  id: string;
  pret_id: string;
  ref_pret: string;
  matricule: string;
  type_alerte: string;
  message: string;
  lue: boolean;
  cree_le: string;
}

export interface SimulationResult {
  mensualite: number;
  total_rembourse: number;
  cout_credit: number;
  echeances: {
    numero: number;
    date_echeance: string;
    capital_du: number;
    mt_capital: number;
    mt_interet: number;
    capital_restant: number;
  }[];
}

export interface PretStats {
  en_attente: number;
  actifs: number;
  suspendus: number;
  soldes: number;
  refuses: number;
  encours_total: number;
  capital_restant: number;
  total_rembourse: number;
  enveloppe_interne_utilisee: number;
  plafond_interne_annuel: number;
  enveloppe_disponible: number;
}

export interface PretConfig {
  id: number;
  code: string;
  libelle: string;
  valeur: number;
  description?: string;
  modifie_par?: string;
  modifie_le: string;
}

// ──────────────────────────────────────────────────────────────
// CLIENT API
// ──────────────────────────────────────────────────────────────

export const pretsApi = {
  // Simulation
  simuler: (p: {
    montant: number; nb_echeances: number; taux_annuel?: number;
    algo?: PretAlgo; date_premiere_echeance?: string;
  }): Promise<SimulationResult> => api.post("/prets/simuler", p),

  // Collaborateur
  mesPrets: (): Promise<Pret[]> => api.get("/prets/mes-prets"),
  mesEcheances: (pretId: string): Promise<Echeance[]> => api.get(`/prets/mes-prets/${pretId}/echeances`),
  soumettreDemande: (data: {
    pret_interne: boolean; montant: number; nb_echeances: number;
    taux?: number; algo?: PretAlgo; inclure_interets?: boolean;
    organisme_credit?: string; etab_credit?: string;
    code_bqe?: string; no_compte?: string; clerib?: string;
  }): Promise<Pret> => api.post("/prets/demandes", data),

  // Gestion (SL 20+)
  listePrets: (params?: { statut?: string; pret_interne?: boolean; matricule?: string }): Promise<Pret[]> => {
    const qs = params ? "?" + new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([,v]) => v !== undefined).map(([k,v]) => [k, String(v)]))
    ).toString() : "";
    return api.get(`/prets/gestion/prets${qs}`);
  },
  detailPret: (id: string): Promise<PretDetail> => api.get(`/prets/gestion/prets/${id}`),
  stats: (): Promise<PretStats> => api.get("/prets/gestion/stats"),
  alertes: (): Promise<Alerte[]> => api.get("/prets/gestion/alertes"),
  marquerAlerteLue: (alerteId: string) => api.post(`/prets/gestion/alertes/${alerteId}/lue`, {}),
  auditPret: (id: string): Promise<AuditLog[]> => api.get(`/prets/gestion/audit/${id}`),

  // Actions RH (SL 50+)
  genererAmortissement: (id: string, date_premiere_echeance: string) =>
    api.post(`/prets/gestion/prets/${id}/amortissement`, { date_premiere_echeance }),
  valider: (id: string, data: {
    decision: "approuve" | "refuse"; ref_decision?: string;
    motif_decision?: string; competenc_decideur?: string;
  }) => api.post(`/prets/gestion/prets/${id}/valider`, data),
  suspendre: (id: string, data: {
    motif: string; mode: ModeSuspension; date_debut: string; date_fin?: string;
  }) => api.post(`/prets/gestion/prets/${id}/suspendre`, data),
  reprendre: (id: string) => api.post(`/prets/gestion/prets/${id}/reprendre`, {}),
  supprimer: (id: string) => api.delete(`/prets/gestion/prets/${id}`),

  // Finance / Paie (SL 70+)
  debloquer: (id: string, data: {
    montant_debloque: number; date_deblocage: string;
    no_cheque?: string; banque_emettrice?: string;
  }) => api.post(`/prets/gestion/prets/${id}/debloquer`, data),
  prelever: (id: string, data: {
    salaire_net_disponible: number; reference_paie: string; matricule?: string;
  }) => api.post(`/prets/gestion/prets/${id}/prelever`, data),
  forcerEcheance: (id: string, data: {
    numero_echeance: number; nouveau_montant: number; note: string;
  }) => api.post(`/prets/gestion/prets/${id}/forcer-echeance`, data),

  // Config (SL 90+)
  getConfig: (): Promise<PretConfig[]> => api.get("/prets/config"),
  updateConfig: (code: string, valeur: number, description?: string) =>
    api.put(`/prets/config/${code}`, { valeur, description }),
};

// ──────────────────────────────────────────────────────────────
// UTILITAIRES
// ──────────────────────────────────────────────────────────────

export const PRET_STATUT_LABELS: Record<PretStatut, string> = {
  brouillon: "Brouillon",
  en_attente_validation: "En attente de validation",
  valide: "Validé",
  debloque: "Débloqué",
  en_cours: "En cours",
  suspendu: "Suspendu",
  solde: "Soldé",
  refuse: "Refusé",
  annule: "Annulé",
};

export const PRET_STATUT_COLORS: Record<PretStatut, { bg: string; text: string }> = {
  brouillon:            { bg: "bg-gray-100",   text: "text-gray-600"  },
  en_attente_validation:{ bg: "bg-blue-50",    text: "text-blue-700"  },
  valide:               { bg: "bg-indigo-50",  text: "text-indigo-700"},
  debloque:             { bg: "bg-amber-50",   text: "text-amber-700" },
  en_cours:             { bg: "bg-green-50",   text: "text-green-700" },
  suspendu:             { bg: "bg-orange-50",  text: "text-orange-700"},
  solde:                { bg: "bg-teal-50",    text: "text-teal-700"  },
  refuse:               { bg: "bg-red-50",     text: "text-red-700"   },
  annule:               { bg: "bg-gray-100",   text: "text-gray-500"  },
};

export const ALGO_LABELS: Record<PretAlgo, string> = {
  french_amortissement: "Amortissement à la française",
  lineaire: "Linéaire (sans intérêts)",
  in_fine: "In fine",
};

export const MOTIF_SUSPENSION_LABELS: Record<string, string> = {
  conge_sans_solde: "Congé sans solde",
  conge_parental: "Congé parental",
  maladie_longue_duree: "Maladie longue durée",
  disponibilite: "Disponibilité",
  autre: "Autre",
};

export const MODE_SUSPENSION_LABELS: Record<ModeSuspension, string> = {
  gel_echeance: "Gel des échéances (décalage du tableau)",
  hors_paie: "Maintien hors-paie (remboursement manuel)",
};

export function formatMontant(n?: number | null): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("fr-MA", { style: "currency", currency: "MAD", minimumFractionDigits: 2 }).format(n);
}

export function formatDate(s?: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("fr-FR");
}

export function avancementPct(pret: Pret): number {
  if (!pret.mt_debloque || pret.mt_debloque === 0) return 0;
  return Math.min(100, Math.round((pret.mt_rembourse / pret.mt_debloque) * 100));
}

/** Détermine les actions disponibles selon le statut et le security_level */
export function actionsDisponibles(pret: Pret, sl: number): string[] {
  const actions: string[] = [];
  if (sl >= 50 && pret.statut === "en_attente_validation") actions.push("valider", "refuser");
  if (sl >= 50 && pret.statut === "valide") actions.push("generer_amortissement");
  if (sl >= 70 && pret.statut === "valide") actions.push("debloquer");
  if (sl >= 50 && ["debloque","en_cours"].includes(pret.statut)) actions.push("suspendre");
  if (sl >= 50 && pret.statut === "suspendu") actions.push("reprendre");
  if (sl >= 70 && ["debloque","en_cours"].includes(pret.statut)) actions.push("forcer_echeance");
  if (sl >= 50 && !pret.pret_debloque) actions.push("supprimer");
  return actions;
}
