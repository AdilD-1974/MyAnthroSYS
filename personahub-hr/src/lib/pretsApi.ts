// src/lib/pretsApi.ts
//
// Client API du module Prêts & Avances — écrit pour correspondre EXACTEMENT
// à l'usage réel dans MesPretsPage.tsx et GestionPretsPage.tsx (déjà en
// place). Toute évolution de signature doit rester compatible avec ces deux
// fichiers, sauf changement concerté des deux côtés.
//
// Utilise le vrai client HTTP du projet (src/lib/api.ts : api.get/post/patch/
// put/delete + qs). API_BASE y inclut déjà "/api/v1" — les chemins ci-dessous
// commencent donc par "/prets/...", jamais par "/api/v1/prets/...".
// Les erreurs levées par ce client sont des `Error` JS standard (message
// dans `e.message`), PAS des objets `{ detail }` — à respecter dans tous les
// composants qui consomment ce client.
import { api, qs, uploadFile, tokenStore, API_BASE } from "./api";

// ─────────────────────────────────────────────────────────────
// Types (miroir des enums PostgreSQL réels)
// ─────────────────────────────────────────────────────────────

export type PretStatut =
  | "brouillon" | "en_attente_validation" | "valide" | "debloque" | "en_cours"
  | "suspendu" | "solde" | "refuse" | "annule"
  | "cloture_stc_solde" | "cloture_stc_reste_du";

export type AlgoAmortissement = "lineaire" | "french_amortissement" | "in_fine";
export type EcheanceStatut = "planifiee" | "prelevee" | "reportee" | "forcee" | "annulee";
export type MotifSuspension = "conge_sans_solde" | "conge_parental" | "maladie_longue_duree" | "disponibilite" | "autre";
export type ModeSuspension = "gel_echeance" | "hors_paie";

export interface Echeance {
  numero: number;
  date_echeance: string;
  capital_du: number;
  mt_capital: number;
  mt_interet: number;
  mt_total: number;
  capital_restant: number;
  statut: EcheanceStatut;
  reliquat: number;
  reference_paie?: string | null;
  mt_tva_interet: number;
  // Traitement réel par la paie — null tant que la clôture de paie n'a pas
  // traité cette échéance.
  dt_reelle_remboursement?: string | null;
  periode_paie_code?: string | null;
  mois_paie?: number | null;
  annee_paie?: number | null;
}

export interface DocumentPret {
  id: string;
  pret_id: string;
  libelle: string;
  type_mime?: string | null;
  taille_ko?: number | null;
  uploade_par: string;
  uploade_le: string;
}

export interface SuspensionHistorique {
  id: string;
  motif_suspension?: MotifSuspension | null;
  mode_suspension?: ModeSuspension | null;
  dt_debut_suspension: string;
  dt_fin_suspension?: string | null;
  nb_mois_decale: number;
  fin_prevue_avant?: string | null;
  fin_prevue_apres?: string | null;
  demandeur_ref?: string | null;
  gestionnaire_paie_ref?: string | null;
  created_at: string;
}

export interface RemboursementAnticipe {
  id: string;
  date_remboursement: string;
  type_remboursement: "PARTIEL" | "TOTAL";
  montant: number;
  mode_paiement: "CHEQUE" | "VIREMENT" | "ESPECES";
  reference_paiement?: string | null;
  capital_restant_avant: number;
  capital_restant_apres: number;
  impact_amortissement: "REDUCTION_MENSUALITE" | "REDUCTION_DUREE";
  recalcul_effectue: boolean;
  created_by?: string | null;
  created_at: string;
}

export interface Pret {
  id: string;
  matricule: string;
  collab_nom?: string;
  ref_pret?: string | null;
  type_code?: string | null;
  type_libelle?: string | null;
  type_icone?: string | null;
  type_couleur?: string | null;
  pret_interne: boolean;
  objet?: string | null;
  mt_pret: number;
  tx_interets: number;
  taux_tva: number;
  nb_echeance: number;
  mt_echeance?: number | null;
  mt_echeance_plus: number;
  algo_name: AlgoAmortissement;
  statut: PretStatut;
  capital_restant: number;
  echeance_restant?: number | null;
  mt_rembourse: number;
  mt_debloque?: number | null;
  dt_demande: string;
  dt_deblocage?: string | null;
  dt_premiere_retenue?: string | null;
  dt_proch_echeance?: string | null;
  fin_prevue?: string | null;
  tx_endettement_avant?: number | null;
  tx_endettement_apres?: number | null;
  tx_endettement_i?: number | null;
  avantage_nature_mensuel: number;
  rubrique_lib?: string | null;
  rubrique_paie_code?: string | null;
  pret_suspendu: boolean;
  motif_suspension?: MotifSuspension | null;
  mode_suspension?: ModeSuspension | null;
  dt_debut_suspension?: string | null;
  dt_fin_suspension?: string | null;
  organisme_credit?: string | null;
  etab_credit?: string | null;
  no_compte?: string | null;
  code_bqe?: string | null;
  clerib?: string | null;
  dt_decision?: string | null;
  ref_decision?: string | null;
  matric_decideur?: string | null;
  competenc_decideur?: string | null;
  motif_decision?: string | null;
  pret_debloque: boolean;

  // Champs complémentaires (dossier fonctionnel — écrans Descriptif/Banque)
  motif?: string | null;
  dt_debut_pret?: string | null;
  dt_debut_remb?: string | null;
  justificatif_fourni: boolean;
  justificatif_date?: string | null;
  observations_rh?: string | null;
  no_cheque?: string | null;
  banque_emettrice?: string | null;
  code_guichet?: string | null;
  intitule_compte?: string | null;
  hypotheque: boolean;
  reconnaissance_dette: boolean;
  priorite_prelevement?: number | null;
  manuel: boolean;
  forcage: boolean;
  security_level?: number | null;
  created_date?: string | null;
  modified_date?: string | null;
  created_by?: string | null;
  modified_by?: string | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  champ?: string | null;
  ancienne_valeur?: string | null;
  nouvelle_valeur?: string | null;
  operateur: string;
  security_level_operateur?: number | null;
  horodatage: string;
}

export interface PretDetail extends Pret {
  echeancier: Echeance[];
  audit: AuditEntry[];
}

export interface PretStats {
  en_attente: number;
  actifs: number;
  suspendus: number;
  encours_total: number;
  capital_restant: number;
  enveloppe_disponible: number;
  plafond_interne_annuel: number;
  enveloppe_interne_utilisee: number;
}

export interface Alerte {
  id: string;
  type_alerte: string;
  ref_pret?: string | null;
  matricule?: string | null;
  message: string;
  cree_le: string;
  lue: boolean;
}

export interface PretConfig {
  code: string;
  libelle: string;
  valeur: number;
  description?: string | null;
  modifie_par?: string | null;
}

export interface TypePret {
  code: string;
  libelle: string;
  description?: string | null;
  categorie_code: string;
  origine_code: string;
  taux_annuel_defaut: number;
  duree_max_mois: number;
  montant_max?: number | null;
  algo_defaut: AlgoAmortissement;
  avance_sur_salaire: boolean;
  justificatif_requis: boolean;
  icone: string;
  couleur: string;
}

// ─────────────────────────────────────────────────────────────
// Paramétrage (admin) — catégories, types de prêt, règles
// ─────────────────────────────────────────────────────────────

export interface CategoriePret {
  code: string;
  libelle: string;
  description?: string | null;
  icone: string;
  couleur: string;
  ordre: number;
  actif: boolean;
}

export interface TypePretAdmin {
  code: string;
  libelle: string;
  description?: string | null;
  categorie_code: string;
  origine_code: string;
  taux_annuel_defaut: number;
  duree_max_mois: number;
  montant_max?: number | null;
  anciennete_min_mois: number;
  algo_defaut: AlgoAmortissement;
  rubrique_paie_code?: string | null;
  rubrique_paie_lib?: string | null;
  rubrique_paie_code_interet?: string | null;
  rubrique_paie_lib_interet?: string | null;
  rubrique_paie_code_tva?: string | null;
  rubrique_paie_lib_tva?: string | null;
  imputable_paie: boolean;
  nb_max_simultanes: number;
  renouvelable: boolean;
  justificatif_requis: boolean;
  double_validation: boolean;
  avance_sur_salaire: boolean;
  workflow_actif: boolean;
  code_workflow?: string | null;
  autorise_remboursement_anticipe: boolean;
  autorise_suspension: boolean;
  report_max_consecutif: number;
  mode_amortissement_defaut: "AUTO" | "MANUEL" | "IMPORT";
  priorite_retenue: number;
  quotite_max_pourcent_override?: number | null;
  types_contrat_autorises?: string[] | null;
  icone: string;
  couleur: string;
  ordre: number;
  actif: boolean;
}

export interface RegleCatalogue {
  code: string;
  libelle: string;
  description?: string | null;
  parametres_attendus?: string | null;
  actif: boolean;
}

export interface TypeRegle {
  id: string;
  code_regle: string;
  parametres: Record<string, unknown>;
  niveau: "BLOQUANT" | "ALERTE";
  derogation_rh_autorisee: boolean;
  ordre: number;
  actif: boolean;
}

// ─────────────────────────────────────────────────────────────
// Simulation / éligibilité / demande (self-service)
// ─────────────────────────────────────────────────────────────

export interface TrancheMensualiteIn {
  ordre: number;
  montant_mensualite: number;
  date_debut: string;
  date_fin?: string | null;
}

export interface SimulationPretRequest {
  type_code: string;
  montant: number;
  nb_echeance: number;
  date_premiere_echeance: string;
  taux_annuel?: number;
  taux_tva?: number;
  algo_name?: AlgoAmortissement;
  tranches?: TrancheMensualiteIn[];
}

export interface EcheanceSimulee {
  numero: number;
  date_echeance: string;
  capital_du: number;
  mt_capital: number;
  mt_interet: number;
  mt_total: number;
  capital_restant: number;
  capital_rembourse_cumule: number;
  mt_tva_interet: number;
}

export interface SimulationPretResponse {
  type_code: string;
  algo_name: AlgoAmortissement;
  montant: number;
  taux_annuel: number;
  nb_echeance_demande: number;
  nb_echeance_retenu: number;
  mensualite_theorique: number;
  cout_total_interets: number;
  borne_fin_annee_civile_appliquee: boolean;
  echeancier: EcheanceSimulee[];
  avertissements: string[];
}

export interface ResultatRegleEligibilite {
  code_regle: string;
  libelle: string;
  niveau: "BLOQUANT" | "ALERTE";
  respectee: boolean;
  message: string;
  derogation_rh_autorisee: boolean;
}

export interface VerificationEligibiliteResponse {
  eligible: boolean;
  resultats: ResultatRegleEligibilite[];
}

export interface DemandePretCreate {
  type_code: string;
  montant: number;
  nb_echeance: number;
  date_premiere_echeance: string;
  objet?: string;
  motif?: string;
  derogations_regles?: string[];
}

// ─────────────────────────────────────────────────────────────
// Constantes d'affichage
// ─────────────────────────────────────────────────────────────

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
  cloture_stc_solde: "Clôturé (STC)",
  cloture_stc_reste_du: "Clôturé (reste dû)",
};

// Couleurs dérivées des variables de thème (AppearancePage) plutôt que
// d'une palette Tailwind figée — respecte les préférences de couleurs de
// statut choisies par l'utilisateur (--success/--warning/--destructive/--info).
export const PRET_STATUT_COLORS: Record<PretStatut, { bg: string; text: string }> = {
  brouillon: { bg: "bg-muted", text: "text-muted-foreground" },
  en_attente_validation: { bg: "bg-[hsl(var(--info)/0.12)]", text: "text-[hsl(var(--info))]" },
  valide: { bg: "bg-[hsl(var(--info)/0.12)]", text: "text-[hsl(var(--info))]" },
  debloque: { bg: "bg-[hsl(var(--success)/0.12)]", text: "text-[hsl(var(--success))]" },
  en_cours: { bg: "bg-[hsl(var(--success)/0.12)]", text: "text-[hsl(var(--success))]" },
  suspendu: { bg: "bg-[hsl(var(--warning)/0.12)]", text: "text-[hsl(var(--warning))]" },
  solde: { bg: "bg-[hsl(var(--success)/0.12)]", text: "text-[hsl(var(--success))]" },
  refuse: { bg: "bg-[hsl(var(--destructive)/0.12)]", text: "text-[hsl(var(--destructive))]" },
  annule: { bg: "bg-muted", text: "text-muted-foreground" },
  cloture_stc_solde: { bg: "bg-[hsl(var(--success)/0.12)]", text: "text-[hsl(var(--success))]" },
  cloture_stc_reste_du: { bg: "bg-[hsl(var(--destructive)/0.12)]", text: "text-[hsl(var(--destructive))]" },
};

// Utilisé tel quel (comme une chaîne) dans GestionPretsPage.tsx.
export const ALGO_LABELS: Record<AlgoAmortissement, string> = {
  lineaire: "Linéaire (capital constant)",
  french_amortissement: "Française (mensualité constante)",
  in_fine: "In fine (intérêts seuls)",
};

// ⚠️ MesPretsPage.tsx utilise `ALGO_LABELS[pret.algo_name]` comme un OBJET
// ({.court, .description}) à deux endroits (const algoInfo = ...; puis
// algoInfo?.court et algoInfo.description). Comme ALGO_LABELS est une chaîne
// ci-dessus (utilisée comme telle dans GestionPretsPage.tsx), remplacez ces
// deux usages dans MesPretsPage.tsx par ALGO_INFO :
//   const algoInfo = ALGO_INFO[pret.algo_name];
export const ALGO_INFO: Record<AlgoAmortissement, { court: string; description: string }> = {
  lineaire: {
    court: "Linéaire",
    description: "Capital remboursé à parts égales chaque mois ; les intérêts diminuent avec le capital restant.",
  },
  french_amortissement: {
    court: "Française",
    description: "Mensualité totale constante ; la part d'intérêts diminue et la part de capital augmente avec le temps.",
  },
  in_fine: {
    court: "In fine",
    description: "Seuls les intérêts sont payés chaque mois ; le capital est remboursé intégralement à la dernière échéance.",
  },
};

export const MOTIF_SUSPENSION_LABELS: Record<string, string> = {
  conge_sans_solde: "Congé sans solde",
  conge_parental: "Congé parental",
  maladie_longue_duree: "Maladie longue durée",
  disponibilite: "Disponibilité",
  autre: "Autre motif",
};

export const MODE_SUSPENSION_LABELS: Record<string, string> = {
  gel_echeance: "Gel de l'échéance (décalage automatique)",
  hors_paie: "Hors paie (remboursement manuel)",
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

export function formatMontant(v?: number | null): string {
  if (v == null) return "—";
  return `${new Intl.NumberFormat("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)} DH`;
}

export function formatDate(d?: string | null): string {
  if (!d) return "—";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("fr-FR");
}

export function avancementPct(p: Pret): number {
  if (!p.mt_pret) return 0;
  const rembourse = p.mt_rembourse ?? Math.max(0, p.mt_pret - (p.capital_restant ?? p.mt_pret));
  return Math.min(100, Math.round((rembourse / p.mt_pret) * 100));
}

/**
 * Détermine les actions disponibles pour un dossier selon son statut et le
 * niveau de sécurité (security_level) de l'opérateur. Purement côté client
 * — le backend revalide indépendamment (ne jamais faire confiance à l'UI
 * seule pour l'autorisation réelle).
 *
 * Hypothèses de seuils (à ajuster si vos conventions SL diffèrent) :
 * - 0-49  : lecture seule
 * - 50+   : approuver / refuser / débloquer / suspendre / reprendre / voir alertes
 * - 70+   : forcer une échéance, voir la piste d'audit
 * - 90+   : administrer la configuration
 */
export function actionsDisponibles(detail: PretDetail, sl: number): string[] {
  const actions: string[] = [];

  if (detail.statut === "en_attente_validation" && sl >= 50) {
    actions.push("approuver", "refuser");
  }
  if (detail.statut === "valide" && detail.echeancier.length === 0 && sl >= 50) {
    actions.push("generer_amortissement");
  }
  if (detail.statut === "valide" && detail.echeancier.length > 0 && !detail.pret_debloque && sl >= 50) {
    actions.push("debloquer");
  }
  if (["debloque", "en_cours"].includes(detail.statut) && !detail.pret_suspendu && sl >= 50) {
    actions.push("suspendre");
  }
  if (detail.pret_suspendu && sl >= 50) {
    actions.push("reprendre");
  }
  if (sl >= 70 && ["debloque", "en_cours", "suspendu"].includes(detail.statut)) {
    actions.push("forcer_echeance");
  }
  if (sl >= 50 && !detail.pret_debloque) {
    actions.push("supprimer");
  }
  return actions;
}

// ─────────────────────────────────────────────────────────────
// Client API
// ─────────────────────────────────────────────────────────────

export const pretsApi = {
  // Self-service
  mesPrets: () => api.get<Pret[]>("/prets/mes-prets"),
  mesEcheances: (pretId: string) => api.get<Echeance[]>(`/prets/${pretId}/echeancier`),

  // Simulation & demande
  listerTypes: (initiableCollaborateur = true) =>
    api.get<TypePret[]>(`/prets/types${qs({ initiable_collaborateur: initiableCollaborateur })}`),
  simuler: (payload: SimulationPretRequest) =>
    api.post<SimulationPretResponse>("/prets/simulation", payload),
  verifierEligibilite: (payload: DemandePretCreate) =>
    api.post<VerificationEligibiliteResponse>("/prets/eligibilite", payload),
  soumettreDemande: (payload: DemandePretCreate) =>
    api.post<Pret>("/prets/demandes", payload),
  creerDirect: (payload: {
    collaborateur_id: string; type_code: string; montant: number; nb_echeance: number;
    taux_annuel?: number; taux_tva?: number; date_premiere_echeance: string; objet?: string; motif?: string;
    ref_pret?: string; mt_echeance_plus?: number; dt_debut_pret?: string; dt_debut_remb?: string;
    justificatif_fourni?: boolean; justificatif_date?: string; observations_rh?: string;
    deja_debloque?: boolean; montant_debloque?: number; date_deblocage?: string;
    capital_restant_saisie?: number; organisme_credit?: string; etab_credit?: string;
    code_bqe?: string; code_guichet?: string; no_compte?: string; clerib?: string;
    intitule_compte?: string; hypotheque?: boolean; reconnaissance_dette?: boolean;
  }) => api.post<Pret>("/prets/creation-directe", payload),

  // Gestion RH / Paie
  listePrets: (filtres?: { statut?: string; pret_interne?: boolean }) =>
    api.get<Pret[]>(`/prets${qs(filtres ?? {})}`),
  stats: () => api.get<PretStats>("/prets/stats"),
  alertes: () => api.get<Alerte[]>("/prets/alertes"),
  marquerAlerteLue: (id: string) => api.patch<void>(`/prets/alertes/${id}/lue`, {}),
  getConfig: () => api.get<PretConfig[]>("/prets/config"),
  modifierConfig: (code: string, valeur: number) => api.put<PretConfig>(`/prets/config/${code}`, { valeur }),
  detailPret: (id: string) => api.get<PretDetail>(`/prets/${id}`),
  remboursementsAnticipes: (id: string) => api.get<RemboursementAnticipe[]>(`/prets/${id}/remboursements-anticipes`),
  historiqueSuspensions: (id: string) => api.get<SuspensionHistorique[]>(`/prets/${id}/suspensions`),
  importerEcheancier: (id: string, lignes: { numero?: number; date_echeance: string; mt_capital: number; mt_interet: number; mt_tva_interet?: number }[]) =>
    api.post<Echeance[]>(`/prets/${id}/echeancier/importer`, { lignes }),
  supprimerEcheances: (id: string, numeros: number[]) =>
    api.post<Pret>(`/prets/${id}/echeancier/supprimer`, { numeros }),
  listerDocuments: (pretId: string) => api.get<DocumentPret[]>(`/prets/${pretId}/documents`),
  supprimerDocument: (documentId: string) => api.delete<void>(`/prets/documents/${documentId}`),
  uploaderDocument: (pretId: string, fichier: File, libelle: string) => {
    const form = new FormData();
    form.append("file", fichier);
    form.append("libelle", libelle);
    return uploadFile<DocumentPret>(`/prets/${pretId}/documents`, form);
  },
  // Le fichier est protégé par rôle côté serveur (Bearer token requis) — un
  // simple <a href> ou <img src> ne l'authentifierait pas puisque le token
  // vit en sessionStorage, pas en cookie. On le récupère donc en blob via
  // fetch authentifié, puis on l'ouvre/télécharge depuis un blob URL local.
  ouvrirDocument: async (documentId: string, mode: "view" | "download" = "view", nomFichier?: string) => {
    const token = tokenStore.get();
    const res = await fetch(`${API_BASE}/prets/documents/${documentId}/fichier?mode=${mode}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error("Impossible de charger le document.");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    if (mode === "download") {
      const a = document.createElement("a");
      a.href = url;
      a.download = nomFichier ?? "document";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },

  valider: (id: string, payload: { decision: "approuve" | "refuse"; ref_decision?: string; motif_decision?: string; competenc_decideur?: string }) =>
    api.post<Pret>(`/prets/${id}/valider`, payload),
  genererAmortissement: (id: string, datePremiereEcheance: string) =>
    api.post<Echeance[]>(`/prets/${id}/generer-amortissement`, { date_premiere_echeance: datePremiereEcheance }),
  debloquer: (id: string, payload: { montant_debloque: number; date_deblocage: string; no_cheque?: string; banque_emettrice?: string }) =>
    api.post<Pret>(`/prets/${id}/debloquer`, payload),
  suspendre: (id: string, payload: { motif: string; mode: ModeSuspension; date_debut: string; date_fin?: string }) =>
    api.post<Pret>(`/prets/${id}/suspendre`, payload),
  reprendre: (id: string) => api.post<Pret>(`/prets/${id}/reprendre`, {}),
  forcerEcheance: (id: string, payload: { numero_echeance: number; nouveau_montant: number; note: string; mode_cascade: "reduire_mensualite" | "reduire_duree" }) =>
    api.post<Echeance>(`/prets/${id}/forcer-echeance`, payload),
  recalculerEcheancier: (id: string, payload: { nouveau_capital_restant: number; nouveau_nb_echeances: number; date_reprise: string; motif: string }) =>
    api.post<PretDetail>(`/prets/${id}/recalculer-echeancier`, payload),
  modifierBanque: (id: string, payload: Partial<{
    organisme_credit: string; etab_credit: string; code_bqe: string; code_guichet: string;
    no_compte: string; clerib: string; intitule_compte: string; hypotheque: boolean; reconnaissance_dette: boolean;
  }>) => api.patch<Pret>(`/prets/${id}/banque`, payload),
  modifierPretExterne: (id: string, payload: Partial<{
    mt_pret: number; nb_echeance: number; tx_interets: number; taux_tva: number;
    dt_debut_pret: string; dt_debut_remb: string; ref_pret: string; motif: string;
    deja_debloque: boolean; montant_debloque: number; date_deblocage: string; capital_restant_saisie: number;
  }>) => api.patch<Pret>(`/prets/${id}/externe`, payload),
  supprimer: (id: string) => api.delete<void>(`/prets/${id}`),

  // Paramétrage (admin)
  listerCategories: () => api.get<CategoriePret[]>("/prets/categories"),
  creerCategorie: (payload: CategoriePret) => api.post<CategoriePret>("/prets/categories", payload),
  modifierCategorie: (code: string, payload: CategoriePret) => api.put<CategoriePret>(`/prets/categories/${code}`, payload),

  listerTypesAdmin: () => api.get<TypePretAdmin[]>("/prets/types-admin"),
  creerType: (payload: TypePretAdmin) => api.post<TypePretAdmin>("/prets/types-admin", payload),
  modifierType: (code: string, payload: TypePretAdmin) => api.put<TypePretAdmin>(`/prets/types-admin/${code}`, payload),

  catalogueRegles: () => api.get<RegleCatalogue[]>("/prets/regles-eligibilite-catalogue"),
  listerReglesType: (typeCode: string) => api.get<TypeRegle[]>(`/prets/types-admin/${typeCode}/regles`),
  ajouterRegleType: (typeCode: string, payload: Omit<TypeRegle, "id">) =>
    api.post<TypeRegle>(`/prets/types-admin/${typeCode}/regles`, payload),
  modifierRegleType: (typeCode: string, regleId: string, payload: Omit<TypeRegle, "id">) =>
    api.put<TypeRegle>(`/prets/types-admin/${typeCode}/regles/${regleId}`, payload),
  retirerRegleType: (typeCode: string, regleId: string) =>
    api.delete<void>(`/prets/types-admin/${typeCode}/regles/${regleId}`),
};
