/**
 * TypeCongesPage – Paramétrage des Types de Congé
 * Configuration > Gestion des Temps > Types de Congé
 *
 * Auteur : Adil DAIA
 *
 * RG-CONGE-STRUCT-01  : Chaque type de congé appartient à une famille de congé.
 * RG-CONGE-STRUCT-02  : Un type de congé peut être hiérarchisé (parent/enfant).
 * RG-CONGE-STRUCT-03  : Le code_type_jour référence la table ref_type_jour (CAL/OUV/OUV2).
 *                       Peut être null pour les types en heures (unité H).
 * RG-CONGE-STRUCT-04  : Les droits (légaux, convention, particulier) doivent être >= 0.
 * RG-CONGE-STRUCT-05  : Un type de congé peut impacter la paie et/ou être indemnisable (CNSS, AMO, CIMR).
 * RG-CONGE-HISTO-01   : Toute modification est tracée en base via trigger PostgreSQL.
 * RG-CONGE-POP-01     : La population éligible peut être définie via critères structurés
 *                       (genre, catégorie pro, type contrat, ancienneté) OU via une condition
 *                       libre (expression métier textuelle). Les deux sont complémentaires.
 * RG-CONGE-HIER-01    : Les droits (légal, convention, particulier) d'un type enfant ne peuvent
 *                       pas être supérieurs aux droits du type parent correspondant.
 *                       Si le parent a un droit null, l'enfant est libre.
 * RG-CONGE-COULEUR-01 : Chaque famille de congé possède une couleur hexadécimale utilisée pour
 *                       l'affichage en trame colorée dans la liste des types de congé.
 * RG-CONGE-JOUR-01    : Les types de jours (Calendaires, Ouvrés, Ouvrables) sont paramétrables
 *                       via la table ref_type_jour. Chaque type définit les jours de semaine
 *                       pris en compte (JSONB) et si les jours fériés entrent dans le décompte.
 *                       Calendaires = 7j/sem (lun-dim + fériés)
 *                       Ouvrés      = 6j/sem (lun-sam, hors fériés)
 *                       Ouvrables   = 5j/sem (lun-ven, hors fériés)
 *
 * ── Nouvelles règles de gestion ──────────────────────────────────────────────
 *
 * RG-CONGE-AUTOABS-01 : Autorisation d'Absence (sans décompte solde)
 *                       Un type de congé peut être configuré comme "Autorisation d'Absence".
 *                       Dans ce cas :
 *                         - Aucun solde n'est requis pour valider la demande
 *                         - La demande n'est pas décomptée d'un compteur de jours
 *                         - Elle est accordée de plein droit selon les droits légaux/conventionnels
 *                         - Exemples : mariage, naissance, décès d'un proche, circoncision
 *                       Le droit légal (jours) reste renseigné à titre informatif et de contrôle
 *                       de la durée maximale autorisée par événement.
 *
 * RG-CONGE-PLAFONDEVENT-01 : Plafond par événement
 *                       Certaines autorisations d'absence sont limitées à un nombre d'occurrences
 *                       par an ou par durée de vie du contrat (ex: 1 mariage/vie, 3 naissances max).
 *                       Le champ nb_occurrences_max_an et nb_occurrences_max_contrat permettent
 *                       de paramétrer cette contrainte.
 *
 * RG-CONGE-FRACTIONNEMENT-01 : Fractionnement autorisé
 *                       Indique si le congé peut être pris en plusieurs fois (fractionné).
 *                       Si false, la totalité des jours doit être posée en une seule demande.
 *                       Applicable aussi bien aux congés avec solde qu'aux autorisations d'absence.
 *
 * RG-CONGE-CHEVAUCHEMENT-01 : Contrôle chevauchement
 *                       Si actif, le système vérifie qu'aucune autre absence ne chevauche
 *                       la période demandée pour le même collaborateur.
 *                       Mode STRICT : blocage total
 *                       Mode AVERTISSEMENT : alerte sans blocage
 *
 * RG-CONGE-DELAI-DEPOT-01 : Délai de dépôt minimum
 *                       Nombre de jours ouvrés minimum entre la date de dépôt de la demande
 *                       et la date de début du congé. 0 = pas de contrainte.
 *                       Paramétrable par type de congé.
 *
 * RG-CONGE-SEXE-EVENEMENT-01 : Restriction par événement genré
 *                       Certains congés sont réservés à un genre spécifique (maternité, paternité).
 *                       Géré via population_criteres.genres (existant).
 *                       Le flag is_conge_maternite / is_conge_paternite permet des traitements
 *                       spécifiques en paie et reporting.
 *
 * RG-CONGE-SOLDE-NEGATIF-01 : Autorisation solde négatif
 *                       Si actif, la demande est acceptée même si le solde est insuffisant.
 *                       Le solde devient négatif et doit être régularisé.
 *                       Incompatible avec interdit_reliquat = true.
 *
 * ── Axes Internationaux ───────────────────────────────────────────────────────
 *
 * RG-CONGE-WINDOW-01 (Adil DAIA) : Fenêtre temporelle de validité (Time Window)
 *   Un type de congé peut définir sa fenêtre de validité selon 4 modes :
 *   - ANNEE_CIVILE  : du 1er janvier au 31 décembre (défaut)
 *   - ANNEE_FISCALE : selon la date de début de l'exercice fiscal de la société
 *   - ANNIVERSAIRE  : fenêtre glissante de 12 mois à partir de la date d'embauche
 *   - GLISSANT      : fenêtre glissante en arrière de N mois (ex: FMLA US = 12 mois rolling)
 *   Applicable pour : congé maladie longue durée, FMLA USA, sabbatiques, pèlerinage...
 *
 * RG-CONGE-ROLLOVER-01 (Adil DAIA) : Politique de fin de période (Rollover / Buy-Back)
 *   Complète RG-CONGE-REPORT-01 avec :
 *   - PERTE              : jours non pris perdus (Use-it-or-lose-it anglo-saxon)
 *   - REPORT_LIMITE      : report avec plafond et date de péremption (France/Belgique)
 *   - TRANSFERT_CET      : transfert vers Compte Épargne Temps (France)
 *   - RACHAT_PAIE        : Buy-back = rachat en paie des jours non consommés (USA/Canada)
 *
 * RG-CONGE-LIMIT-01 (Adil DAIA) : Durée de vie / Limite carrière (Lifetime Limits)
 *   Permet de brider le nombre total de jours ou d'occurrences sur toute la carrière :
 *   - Congé Pèlerinage Maroc : 1 seule occurrence sur toute la carrière
 *   - Parental Leave USA : plafonné à X jours sur la carrière dans l'entreprise
 *   - Sabbatical Leave : 1 occurrence tous les N ans d'ancienneté révolus (carence)
 *   Champs : nb_jours_max_carriere, nb_occurrences_max_carriere, carence_mois_entre_prises
 *
 * RG-CONGE-PRORATA-01 (Adil DAIA) : Proratisation FTE (Temps partiel / Entrée-Sortie)
 *   L'acquisition se proratise automatiquement selon le taux d'activité (FTE) :
 *   - Un salarié à 50% FTE n'acquiert que 1,25 j/mois au lieu de 2,5
 *   - Configurable : prorata FTE activable/désactivable par type
 *   - Base de calcul : FTE issu du contrat actif du collaborateur
 */

import React, { useEffect, useState, useCallback } from "react";
import { db } from "@/lib/api";
import { useReferentiels } from "@/hooks/useReferentiels";
import CongeWorkflowPanel from "@/pages/configuration/temps/CongeWorkflowPanel";
import OperationsWorkflowPanel from "@/pages/absences/OperationsWorkflowPanel";   // ✅ Workflows des opérations (annulation / report / reprise)
import FamilleWorkflowSelect from "@/pages/configuration/temps/FamilleWorkflowSelect";
import {
  Clock, Plus, Pencil, Trash2, Check, X, Loader2,
  ChevronRight, ChevronDown, FolderOpen, FileText,
  AlertTriangle, Search, ToggleLeft, ToggleRight, Users, Code2, Palette,
  CalendarDays, Info, RotateCcw, Ban, CreditCard, Calendar, ArrowRightCircle,
  RefreshCw, Copy,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * RG-CONGE-JOUR-01 (Adil DAIA): Structure d'un type de jour de la table ref_type_jour.
 * Définit les règles de décompte des jours de congé.
 * - jours_semaine : numéros ISO des jours comptabilisés (1=Lundi … 7=Dimanche)
 * - compte_feries : si true, les jours fériés tombant sur un jour ouvrable comptent
 * - compte_samedi / compte_dimanche : indicateurs de prise en compte du week-end
 */
interface TypeJour {
  code: string;
  libelle: string;
  description: string | null;
  jours_semaine: number[];
  compte_feries: boolean;
  compte_samedi: boolean;
  compte_dimanche: boolean;
  actif: boolean;
  ordre: number | null;
}

interface FamilleConge {
  code: string;
  libelle: string;
  description: string | null;
  actif: boolean;
  ordre: number | null;
  /** RG-CONGE-COULEUR-01 (Adil DAIA): couleur hex de la famille */
  couleur: string | null;
}

/**
 * RG-CONGE-POP-01 (Adil DAIA): Structure des critères de population structurés.
 * Chaque tableau vide signifie "sans restriction" pour ce critère.
 */
interface PopulationCriteres {
  genres: string[];
  categories_pro: string[];
  types_contrat: string[];
  anciennete_min_mois: number | null;
  anciennete_max_mois: number | null;
}

const EMPTY_POPULATION_CRITERES: PopulationCriteres = {
  genres: [],
  categories_pro: [],
  types_contrat: [],
  anciennete_min_mois: null,
  anciennete_max_mois: null,
};

interface TypeConge {
  code: string;
  libelle: string;
  description: string | null;
  code_famille: string | null;
  code_type_conge_parent: string | null;
  /** RG-CONGE-JOUR-01 (Adil DAIA): Code de la table ref_type_jour (CAL/OUV/OUV2) ou null si unité=Heures */
  code_type_jour: string | null;
  unite: string | null;
  duree_max: number | null;
  anciennete_min_mois: number | null;
  preavis_jours: number | null;
  justificatif_obligatoire: boolean;
  droit_legal_jours: number | null;
  reference_legale: string | null;
  droit_convention_jours: number | null;
  reference_convention: string | null;
  droit_particulier_jours: number | null;
  condition_particuliere: string | null;
  impacte_paie: boolean;
  /** RG-CONGE-VARPAIE-01 (Adil DAIA) : rubrique de paie alimentée en NOMBRE
   * lors de la récupération des modules (jours de congé approuvés → élément
   * variable). Distinct de rollover_code_rubrique_paie (rachat de reliquat). */
  code_rubrique_paie: string | null;
  indemnisable_cnss: boolean;
  indemnisable_amo: boolean;
  indemnisable_cimr: boolean;
  workflow_obligatoire: boolean;
  decision_reference: string | null;
  actif: boolean;
  ordre: number | null;
  // RG-CONGE-POP-01 (Adil DAIA)
  population_criteres: PopulationCriteres | null;
  population_condition: string | null;
  // RG-CONGE-REPORT-01 (Adil DAIA): Gestion du report des reliquats
  report_autorise: boolean;
  report_plafond_jours: number | null;
  report_mode_plafond: "FIXE" | "POURCENTAGE" | null;
  report_plafond_pct: number | null;
  report_delai_consommation_mois: number | null;
  report_date_butoir: string | null;
  report_type_butoir: "DELAI" | "DATE_FIXE" | null;
  report_action_solde_restant: "PERTE" | "REPORT" | "PAIEMENT" | null;
  report_cumul_autorise: boolean;
  report_cumul_max_exercices: number | null;
  report_condition: string | null;
  // RG-CONGE-RECOND-01 (Adil DAIA): Reconduction du congé
  reconduction_autorisee: boolean;
  reconduction_max_nombre: number | null;
  reconduction_duree_jours: number | null;
  // RG-CONGE-REPRISE-01 (Adil DAIA): Reprise obligatoire
  reprise_obligatoire: boolean;
  // RG-CONGE-RELIQUAT-INTERDIT-01 (Adil DAIA): Interdit le dépassement du solde
  interdit_reliquat: boolean;
  // RG-CONGE-DROIT-MODE-01 (Adil DAIA): Mode de calcul par niveau de droit
  mode_calcul_droit_legal:       "FIXE" | "BAREME" | "PRORATA" | null;
  code_bareme_legal:             string | null;
  mode_calcul_droit_convention:  "FIXE" | "BAREME" | "PRORATA" | null;
  code_bareme_convention:        string | null;
  mode_calcul_droit_particulier: "FIXE" | "BAREME" | "PRORATA" | null;
  code_bareme_particulier:       string | null;
  // RG-CONGE-ACQ-01 (Adil DAIA): Règles d'acquisition
  periodicite_acquisition: "MENSUEL" | "TRIMESTRIEL" | "SEMESTRIEL" | "ANNUEL" | null;
  prorata_entree:          boolean;
  prorata_sortie:          boolean;
  prorata_temps_partiel:   boolean;
  arrondi_acquisition:     "SUPERIEUR" | "INFERIEUR" | "MATHEMATIQUE" | null;
  absence_deductible:      boolean;
  evenements_recalcul:     string[];
  // RG-CONGE-AUTOABS-01 (Adil DAIA): Autorisation d'absence sans décompte solde
  est_autorisation_absence: boolean;
  // RG-CONGE-PLAFONDEVENT-01 (Adil DAIA): Plafond d'occurrences
  nb_occurrences_max_an:       number | null;
  nb_occurrences_max_contrat:  number | null;
  // RG-CONGE-FRACTIONNEMENT-01 (Adil DAIA): Fractionnement
  fractionnement_autorise: boolean;
  fractionnement_min_jours: number | null;
  // RG-CONGE-CHEVAUCHEMENT-01 (Adil DAIA): Contrôle chevauchement
  controle_chevauchement: "AUCUN" | "AVERTISSEMENT" | "STRICT" | null;
  // RG-CONGE-DELAI-DEPOT-01 (Adil DAIA): Délai de dépôt minimum
  delai_depot_min_jours: number | null;
  // RG-CONGE-SOLDE-NEGATIF-01 (Adil DAIA): Solde négatif autorisé
  solde_negatif_autorise: boolean;
  // RG-CONGE-SEXE-EVENEMENT-01 (Adil DAIA)
  is_conge_maternite: boolean;
  is_conge_paternite: boolean;

  // ── RG-CONGE-WINDOW-01 (Adil DAIA) : Fenêtre temporelle ─────────────────
  /** Mode de la fenêtre de validité : ANNEE_CIVILE | ANNEE_FISCALE | ANNIVERSAIRE | GLISSANT */
  window_mode: "ANNEE_CIVILE" | "ANNEE_FISCALE" | "ANNIVERSAIRE" | "GLISSANT" | null;
  /** Durée de la fenêtre glissante en mois (si window_mode = GLISSANT) */
  window_duree_mois: number | null;
  /** Sens de la fenêtre glissante : BACKWARD (en arrière) | FORWARD (en avant) */
  window_sens: "BACKWARD" | "FORWARD" | null;

  // ── RG-CONGE-ROLLOVER-01 (Adil DAIA) : Politique de fin de période ───────
  /** Politique de fin de période : PERTE | REPORT_LIMITE | TRANSFERT_CET | RACHAT_PAIE */
  rollover_politique: "PERTE" | "REPORT_LIMITE" | "TRANSFERT_CET" | "RACHAT_PAIE" | null;
  /** Taux de rachat en % du salaire journalier (si rollover_politique = RACHAT_PAIE) */
  rollover_taux_rachat_pct: number | null;
  /** Plafond de jours rachetables par exercice */
  rollover_plafond_jours_rachat: number | null;
  /** Code de la rubrique de paie pour le rachat */
  rollover_code_rubrique_paie: string | null;

  // ── RG-CONGE-LIMIT-01 (Adil DAIA) : Limites carrière ─────────────────────
  /** Nombre maximum de jours sur toute la carrière (null = illimité) */
  nb_jours_max_carriere: number | null;
  /** Nombre maximum d'occurrences sur toute la carrière (null = illimité) */
  nb_occurrences_max_carriere: number | null;
  /** Carence en mois entre deux prises successives (ex: 60 mois pour pèlerinage) */
  carence_mois_entre_prises: number | null;
  /** Ancienneté minimale requise en années pour déclencher le droit (ex: sabbatique = 5 ans) */
  anciennete_min_ans_carriere: number | null;

  // ── RG-CONGE-PRORATA-01 (Adil DAIA) : Proratisation FTE ──────────────────
  /** Activer la proratisation automatique selon le FTE du collaborateur */
  prorata_fte_actif: boolean;
  /** Mode de calcul FTE : LINEAIRE | PALIER */
  prorata_fte_mode: "LINEAIRE" | "PALIER" | null;
  /** Seuil FTE minimum en dessous duquel aucun droit n'est accordé (ex: 0.2 = 20%) */
  prorata_fte_seuil_min: number | null;
}

/** RG-CONGE-JOUR-01 (Adil DAIA): unite de décompte (JOUR ou HEURE) */
type UniteConge = "JOUR" | "HEURE";

const EMPTY_TYPE: TypeConge = {
  code: "", libelle: "", description: null,
  code_famille: null, code_type_conge_parent: null,
  code_type_jour: "CAL", unite: "JOUR", duree_max: null,
  anciennete_min_mois: null, preavis_jours: null,
  justificatif_obligatoire: false,
  droit_legal_jours: null, reference_legale: null,
  droit_convention_jours: null, reference_convention: null,
  droit_particulier_jours: null, condition_particuliere: null,
  impacte_paie: false, code_rubrique_paie: null, indemnisable_cnss: false,
  indemnisable_amo: false, indemnisable_cimr: false,
  workflow_obligatoire: false, decision_reference: null,
  actif: true, ordre: 0,
  population_criteres: null, population_condition: null,
  // RG-CONGE-REPORT-01 (Adil DAIA)
  report_autorise: false,
  report_plafond_jours: null,
  report_mode_plafond: "FIXE",
  report_plafond_pct: null,
  report_delai_consommation_mois: null,
  report_date_butoir: null,
  report_type_butoir: "DELAI",
  report_action_solde_restant: "PERTE",
  report_cumul_autorise: false,
  report_cumul_max_exercices: null,
  report_condition: null,
  // RG-CONGE-RECOND-01 (Adil DAIA)
  reconduction_autorisee: false,
  reconduction_max_nombre: null,
  reconduction_duree_jours: null,
  // RG-CONGE-REPRISE-01 (Adil DAIA)
  reprise_obligatoire: false,
  // RG-CONGE-RELIQUAT-INTERDIT-01 (Adil DAIA)
  interdit_reliquat: false,
  // RG-CONGE-DROIT-MODE-01 (Adil DAIA)
  mode_calcul_droit_legal: "FIXE",
  code_bareme_legal: null,
  mode_calcul_droit_convention: "FIXE",
  code_bareme_convention: null,
  mode_calcul_droit_particulier: "FIXE",
  code_bareme_particulier: null,
  // RG-CONGE-ACQ-01 (Adil DAIA)
  periodicite_acquisition: "ANNUEL",
  prorata_entree: true,
  prorata_sortie: true,
  prorata_temps_partiel: true,
  arrondi_acquisition: "SUPERIEUR",
  absence_deductible: false,
  evenements_recalcul: [],
  // RG-CONGE-AUTOABS-01
  est_autorisation_absence: false,
  // RG-CONGE-PLAFONDEVENT-01
  nb_occurrences_max_an: null,
  nb_occurrences_max_contrat: null,
  // RG-CONGE-FRACTIONNEMENT-01
  fractionnement_autorise: true,
  fractionnement_min_jours: null,
  // RG-CONGE-CHEVAUCHEMENT-01
  controle_chevauchement: "STRICT",
  // RG-CONGE-DELAI-DEPOT-01
  delai_depot_min_jours: null,
  // RG-CONGE-SOLDE-NEGATIF-01
  solde_negatif_autorise: false,
  // RG-CONGE-SEXE-EVENEMENT-01
  is_conge_maternite: false,
  is_conge_paternite: false,
  // RG-CONGE-WINDOW-01 (Adil DAIA)
  window_mode: "ANNEE_CIVILE",
  window_duree_mois: null,
  window_sens: "BACKWARD",
  // RG-CONGE-ROLLOVER-01 (Adil DAIA)
  rollover_politique: "PERTE",
  rollover_taux_rachat_pct: null,
  rollover_plafond_jours_rachat: null,
  rollover_code_rubrique_paie: null,
  // RG-CONGE-LIMIT-01 (Adil DAIA)
  nb_jours_max_carriere: null,
  nb_occurrences_max_carriere: null,
  carence_mois_entre_prises: null,
  anciennete_min_ans_carriere: null,
  // RG-CONGE-PRORATA-01 (Adil DAIA)
  prorata_fte_actif: false,
  prorata_fte_mode: "LINEAIRE",
  prorata_fte_seuil_min: null,
};

const EMPTY_FAMILLE: FamilleConge = {
  code: "", libelle: "", description: null, actif: true, ordre: 0, couleur: "#6366F1",
};

// ─── Palette de couleurs suggérées pour les familles ─────────────────────────
// RG-CONGE-COULEUR-01 (Adil DAIA): Palette prédéfinie pour faciliter le choix
const PALETTE_COULEURS = [
  "#6366F1", // Indigo
  "#8B5CF6", // Violet
  "#EC4899", // Rose
  "#EF4444", // Rouge
  "#F97316", // Orange
  "#EAB308", // Jaune
  "#22C55E", // Vert
  "#14B8A6", // Teal
  "#06B6D4", // Cyan
  "#3B82F6", // Bleu
  "#64748B", // Slate
  "#78716C", // Stone
];

// ─── Référentiels en dur (issus de la base) ────────────────────────────────
// RG-CONGE-POP-01 (Adil DAIA): Listes de référence pour les critères population
const REF_GENRES: never[] = [];         // Chargé dynamiquement via useReferentiels
const REF_CATEGORIES_PRO: never[] = []; // Chargé dynamiquement via useReferentiels
const REF_TYPES_CONTRAT: never[] = [];  // Chargé dynamiquement via useReferentiels

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** RG-CONGE-COULEUR-01 (Adil DAIA): Convertit une couleur hex en rgba avec opacité */
const hexToRgba = (hex: string, alpha: number): string => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return `rgba(99,102,241,${alpha})`;
  return `rgba(${parseInt(result[1], 16)},${parseInt(result[2], 16)},${parseInt(result[3], 16)},${alpha})`;
};

const Toggle: React.FC<{ value: boolean; onChange: (v: boolean) => void; label: string }> = ({ value, onChange, label }) => (
  <button
    type="button"
    onClick={() => onChange(!value)}
    className="flex items-center gap-1.5 text-xs select-none"
  >
    {value
      ? <ToggleRight size={18} style={{ color: "hsl(var(--accent))" }} />
      : <ToggleLeft size={18} style={{ color: "hsl(var(--muted-foreground))" }} />}
    <span style={{ color: value ? "hsl(var(--accent))" : "hsl(var(--muted-foreground))" }}>{label}</span>
  </button>
);

const Field: React.FC<{ label: string; required?: boolean; children: React.ReactNode; className?: string }> = ({ label, required, children, className }) => (
  <div className={className}>
    <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
      {label}{required && <span style={{ color: "hsl(0 84% 55%)" }}> *</span>}
    </label>
    {children}
  </div>
);

const inputCls = "w-full px-3 py-1.5 rounded-lg border text-sm outline-none transition-colors";
const inputStyle = { borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" };

// ─── Component ────────────────────────────────────────────────────────────────

const TypeCongesPage: React.FC = () => {
  const [familles, setFamilles] = useState<FamilleConge[]>([]);
  const [types, setTypes] = useState<TypeConge[]>([]);
  /** RG-CONGE-JOUR-01 (Adil DAIA): Types de jours chargés depuis ref_type_jour */
  const [typesJour, setTypesJour] = useState<TypeJour[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterFamille, setFilterFamille] = useState<string>("all");
  const [expandedFamilles, setExpandedFamilles] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Panel state : null = list, "new_famille", "new_type", "edit_famille:<code>", "edit_type:<code>"
  const [panel, setPanel] = useState<string | null>(null);
  const [familleForm, setFamilleForm] = useState<FamilleConge>(EMPTY_FAMILLE);
  const [typeForm, setTypeForm] = useState<TypeConge>(EMPTY_TYPE);
  // RG-REF-01 (Adil DAIA): Référentiels chargés dynamiquement depuis la base
  const { genres, typesContrat, categoriesPro } = useReferentiels();

  const [activeTab, setActiveTab] = useState<"general" | "droits" | "paie" | "workflow" | "report" | "reconduction" | "acquisition">("general");
  const [baremes, setBaremes] = useState<Array<{code: string; libelle: string; critere_principal: string}>>([]);
  // RG-CONGE-VARPAIE-01 (Adil DAIA) : rubriques disponibles pour l'association
  // congé → rubrique (alimentation de l'attribut Nombre à la récupération des modules)
  const [rubriquesPaie, setRubriquesPaie] = useState<Array<{code: string; libelle: string}>>([]);

  // ── Duplication ───────────────────────────────────────────────────────────
  const [duplicateSource, setDuplicateSource] = useState<TypeConge | null>(null);
  const [duplicateCode, setDuplicateCode] = useState("");
  const [duplicateLibelle, setDuplicateLibelle] = useState("");
  const [duplicating, setDuplicating] = useState(false);

  // Charger les barèmes disponibles
  useEffect(() => {
    db.list<any>("bareme_droit_conge", {
      select: "code,libelle,critere_principal",
      actif: true,
      order: "libelle",
    }).then(data => setBaremes(data));
  }, []);

  // Charger les rubriques de paie disponibles (association congé → rubrique)
  useEffect(() => {
    db.list<any>("rubrique_paie", {
      select: "code,libelle",
      archive: false,
      v_ajout: true, // RG-CONGE-VARPAIE-01 : seules les rubriques autorisées en saisie d'EV "Ajout"
      order: "code",
    }).then(data => setRubriquesPaie(data)).catch(() => setRubriquesPaie([]));
  }, []);

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    const [fam, typ, tj] = await Promise.all([
      db.list<FamilleConge>("ref_famille_conge", { order: "ordre" }),
      db.list<TypeConge>("ref_type_conge", { order: "ordre" }),
      // RG-CONGE-JOUR-01 (Adil DAIA): Chargement des types de jours
      db.list<TypeJour>("ref_type_jour", { actif: true, order: "ordre" }),
    ]);
    setFamilles(fam);
    setTypes(typ);
    setTypesJour(tj);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Famille CRUD ──────────────────────────────────────────────────────────
  const saveFamille = async () => {
    if (!familleForm.code || !familleForm.libelle) { setError("Code et libellé sont requis."); return; }
    setSaving(true); setError(null);
    const isEdit = panel?.startsWith("edit_famille:");
    const payload = {
      ...familleForm,
      code: familleForm.code.toUpperCase(),
      description: familleForm.description || null,
      couleur: familleForm.couleur || "#6366F1",
    };
    try {
      if (isEdit) await db.update("ref_famille_conge", { code: payload.code }, payload);
      else await db.create("ref_famille_conge", payload);
    } catch (err: any) {
      setSaving(false);
      setError(err.message?.includes("duplicate") ? "Ce code existe déjà." : err.message);
      return;
    }
    setSaving(false);
    setPanel(null);
    loadData();
  };

  const deleteFamille = async (code: string) => {
    const used = types.some(t => t.code_famille === code);
    if (used) { setError(`La famille "${code}" est utilisée par des types de congé.`); return; }
    if (!confirm("Supprimer cette famille ?")) return;
    await db.remove("ref_famille_conge", { code });
    loadData();
  };

  // ── Type CRUD ─────────────────────────────────────────────────────────────
  /**
   * RG-CONGE-HIER-01 (Adil DAIA): Vérifie que les droits de l'enfant sont ≤ ceux du parent.
   * Si le parent n'a pas de droit défini (null), pas de contrainte sur l'enfant.
   */
  const validateDroitsHierarchie = (form: TypeConge, allTypes: TypeConge[]): string | null => {
    if (!form.code_type_conge_parent) return null;
    const parent = allTypes.find(t => t.code === form.code_type_conge_parent);
    if (!parent) return null;

    if (parent.droit_legal_jours != null && form.droit_legal_jours != null) {
      if (form.droit_legal_jours > parent.droit_legal_jours) {
        return `RG-CONGE-HIER-01 : Le droit légal de l'enfant (${form.droit_legal_jours}j) ne peut pas dépasser celui du parent "${parent.libelle}" (${parent.droit_legal_jours}j).`;
      }
    }
    if (parent.droit_convention_jours != null && form.droit_convention_jours != null) {
      if (form.droit_convention_jours > parent.droit_convention_jours) {
        return `RG-CONGE-HIER-01 : Le droit convention de l'enfant (${form.droit_convention_jours}j) ne peut pas dépasser celui du parent "${parent.libelle}" (${parent.droit_convention_jours}j).`;
      }
    }
    if (parent.droit_particulier_jours != null && form.droit_particulier_jours != null) {
      if (form.droit_particulier_jours > parent.droit_particulier_jours) {
        return `RG-CONGE-HIER-01 : Le droit particulier de l'enfant (${form.droit_particulier_jours}j) ne peut pas dépasser celui du parent "${parent.libelle}" (${parent.droit_particulier_jours}j).`;
      }
    }
    return null;
  };

  const saveType = async () => {
    if (!typeForm.code || !typeForm.libelle) { setError("Code et libellé sont requis."); return; }
    if (!typeForm.code_famille) { setError("La famille de congé est obligatoire."); return; }

    // RG-CONGE-HIER-01 (Adil DAIA): Validation droits parent/enfant
    const hierError = validateDroitsHierarchie(typeForm, types);
    if (hierError) { setError(hierError); return; }

    setSaving(true); setError(null);
    const isEdit = panel?.startsWith("edit_type:");
    // RG-CONGE-POP-01 (Adil DAIA): Sérialisation des critères population en JSONB
    const hasActiveCriteres = typeForm.population_criteres && (
      typeForm.population_criteres.genres.length > 0 ||
      typeForm.population_criteres.categories_pro.length > 0 ||
      typeForm.population_criteres.types_contrat.length > 0 ||
      typeForm.population_criteres.anciennete_min_mois != null ||
      typeForm.population_criteres.anciennete_max_mois != null
    );
    const payload = {
      ...typeForm,
      code: typeForm.code.toUpperCase(),
      description: typeForm.description || null,
      reference_legale: typeForm.reference_legale || null,
      reference_convention: typeForm.reference_convention || null,
      condition_particuliere: typeForm.condition_particuliere || null,
      decision_reference: typeForm.decision_reference || null,
      code_type_conge_parent: typeForm.code_type_conge_parent || null,
      population_criteres: hasActiveCriteres ? typeForm.population_criteres : null,
      population_condition: typeForm.population_condition || null,
    };
    try {
      if (isEdit) await db.update("ref_type_conge", { code: payload.code }, payload);
      else await db.create("ref_type_conge", payload);
    } catch (err: any) {
      setSaving(false);
      setError(err.message?.includes("duplicate") ? "Ce code existe déjà." : err.message);
      return;
    }
    setSaving(false);
    setPanel(null);
    loadData();
  };

  const deleteType = async (code: string) => {
    const hasChildren = types.some(t => t.code_type_conge_parent === code);
    if (hasChildren) { setError(`Ce type a des sous-types, supprimez-les d'abord.`); return; }
    if (!confirm("Supprimer ce type de congé ?")) return;
    await db.remove("ref_type_conge", { code });
    loadData();
  };

  /**
   * Ouvre le dialog de duplication pré-rempli avec les valeurs du type source.
   * L'utilisateur choisit un nouveau code et libellé avant de confirmer.
   */
  const openDuplicateType = (t: TypeConge) => {
    setDuplicateSource(t);
    setDuplicateCode(`${t.code}_COPIE`);
    setDuplicateLibelle(`${t.libelle} (copie)`);
    setError(null);
  };

  const confirmDuplicateType = async () => {
    if (!duplicateSource) return;
    const newCode = duplicateCode.trim().toUpperCase();
    if (!newCode || !duplicateLibelle.trim()) {
      setError("Le code et le libellé sont obligatoires.");
      return;
    }
    if (types.some(t => t.code === newCode)) {
      setError(`Le code "${newCode}" existe déjà.`);
      return;
    }
    setDuplicating(true);
    setError(null);
    // Copie intégrale du type source, en remplaçant code et libellé
    const { code: _oldCode, libelle: _oldLibelle, ...rest } = duplicateSource;
    const payload = {
      ...rest,
      code: newCode,
      libelle: duplicateLibelle.trim(),
      // Le type dupliqué part en inactif pour éviter toute génération accidentelle
      actif: false,
    };
    try {
      await db.create("ref_type_conge", payload);
    } catch (err: any) {
      setDuplicating(false);
      setError(err.message?.includes("duplicate") ? "Ce code existe déjà." : err.message);
      return;
    }
    setDuplicating(false);
    setDuplicateSource(null);
    loadData();
  };

  // ── Filtered list ─────────────────────────────────────────────────────────
  const filteredTypes = types.filter(t => {
    const matchSearch = !search || t.libelle.toLowerCase().includes(search.toLowerCase()) || t.code.toLowerCase().includes(search.toLowerCase());
    const matchFamille = filterFamille === "all" || t.code_famille === filterFamille;
    return matchSearch && matchFamille;
  });

  // Group by famille
  const typesByFamille: Record<string, TypeConge[]> = {};
  filteredTypes.filter(t => !t.code_type_conge_parent).forEach(t => {
    const key = t.code_famille || "_sans_famille";
    if (!typesByFamille[key]) typesByFamille[key] = [];
    typesByFamille[key].push(t);
  });

  const getChildren = (parentCode: string) => types.filter(t => t.code_type_conge_parent === parentCode);
  const toggleFamille = (code: string) => {
    setExpandedFamilles(prev => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  };

  const openEditFamille = (f: FamilleConge) => {
    setFamilleForm({ ...f, couleur: f.couleur || "#6366F1" });
    setPanel(`edit_famille:${f.code}`);
    setError(null);
  };

  const openEditType = (t: TypeConge) => {
    // RG-CONGE-POP-01 (Adil DAIA): Cast du JSONB population_criteres depuis la base
    const raw = t as any;
    const criteres = raw.population_criteres as PopulationCriteres | null;
    setTypeForm({
      ...t,
      population_criteres: criteres ? {
        genres: criteres.genres || [],
        categories_pro: criteres.categories_pro || [],
        types_contrat: criteres.types_contrat || [],
        anciennete_min_mois: criteres.anciennete_min_mois ?? null,
        anciennete_max_mois: criteres.anciennete_max_mois ?? null,
      } : null,
      population_condition: raw.population_condition || null,
      // RG-CONGE-REPORT-01 (Adil DAIA)
      report_autorise: raw.report_autorise ?? false,
      report_plafond_jours: raw.report_plafond_jours ?? null,
      report_mode_plafond: raw.report_mode_plafond ?? "FIXE",
      report_plafond_pct: raw.report_plafond_pct ?? null,
      report_delai_consommation_mois: raw.report_delai_consommation_mois ?? null,
      report_date_butoir: raw.report_date_butoir ?? null,
      report_type_butoir: raw.report_type_butoir ?? "DELAI",
      report_action_solde_restant: raw.report_action_solde_restant ?? "PERTE",
      report_cumul_autorise: raw.report_cumul_autorise ?? false,
      report_cumul_max_exercices: raw.report_cumul_max_exercices ?? null,
      report_condition: raw.report_condition ?? null,
      // RG-CONGE-RECOND-01 (Adil DAIA)
      reconduction_autorisee: raw.reconduction_autorisee ?? false,
      reconduction_max_nombre: raw.reconduction_max_nombre ?? null,
      reconduction_duree_jours: raw.reconduction_duree_jours ?? null,
      // RG-CONGE-REPRISE-01 (Adil DAIA)
      reprise_obligatoire: raw.reprise_obligatoire ?? false,
      // RG-CONGE-RELIQUAT-INTERDIT-01 (Adil DAIA)
      interdit_reliquat: raw.interdit_reliquat ?? false,
      // RG-CONGE-DROIT-MODE-01 (Adil DAIA)
      mode_calcul_droit_legal: raw.mode_calcul_droit_legal ?? "FIXE",
      code_bareme_legal: raw.code_bareme_legal ?? null,
      mode_calcul_droit_convention: raw.mode_calcul_droit_convention ?? "FIXE",
      code_bareme_convention: raw.code_bareme_convention ?? null,
      mode_calcul_droit_particulier: raw.mode_calcul_droit_particulier ?? "FIXE",
      code_bareme_particulier: raw.code_bareme_particulier ?? null,
      // RG-CONGE-ACQ-01 (Adil DAIA)
      periodicite_acquisition: raw.periodicite_acquisition ?? "ANNUEL",
      prorata_entree: raw.prorata_entree ?? true,
      prorata_sortie: raw.prorata_sortie ?? true,
      prorata_temps_partiel: raw.prorata_temps_partiel ?? true,
      arrondi_acquisition: raw.arrondi_acquisition ?? "SUPERIEUR",
      absence_deductible: raw.absence_deductible ?? false,
      evenements_recalcul: raw.evenements_recalcul ?? [],
      // RG-CONGE-AUTOABS-01
      est_autorisation_absence: raw.est_autorisation_absence ?? false,
      // RG-CONGE-PLAFONDEVENT-01
      nb_occurrences_max_an: raw.nb_occurrences_max_an ?? null,
      nb_occurrences_max_contrat: raw.nb_occurrences_max_contrat ?? null,
      // RG-CONGE-FRACTIONNEMENT-01
      fractionnement_autorise: raw.fractionnement_autorise ?? true,
      fractionnement_min_jours: raw.fractionnement_min_jours ?? null,
      // RG-CONGE-CHEVAUCHEMENT-01
      controle_chevauchement: raw.controle_chevauchement ?? "STRICT",
      // RG-CONGE-DELAI-DEPOT-01
      delai_depot_min_jours: raw.delai_depot_min_jours ?? null,
      // RG-CONGE-SOLDE-NEGATIF-01
      solde_negatif_autorise: raw.solde_negatif_autorise ?? false,
      // RG-CONGE-SEXE-EVENEMENT-01
      is_conge_maternite: raw.is_conge_maternite ?? false,
      is_conge_paternite: raw.is_conge_paternite ?? false,
      // RG-CONGE-WINDOW-01 (Adil DAIA)
      window_mode: raw.window_mode ?? "ANNEE_CIVILE",
      window_duree_mois: raw.window_duree_mois ?? null,
      window_sens: raw.window_sens ?? "BACKWARD",
      // RG-CONGE-ROLLOVER-01 (Adil DAIA)
      rollover_politique: raw.rollover_politique ?? "PERTE",
      rollover_taux_rachat_pct: raw.rollover_taux_rachat_pct ?? null,
      rollover_plafond_jours_rachat: raw.rollover_plafond_jours_rachat ?? null,
      rollover_code_rubrique_paie: raw.rollover_code_rubrique_paie ?? null,
      // RG-CONGE-VARPAIE-01 (Adil DAIA)
      code_rubrique_paie: raw.code_rubrique_paie ?? null,
      // RG-CONGE-LIMIT-01 (Adil DAIA)
      nb_jours_max_carriere: raw.nb_jours_max_carriere ?? null,
      nb_occurrences_max_carriere: raw.nb_occurrences_max_carriere ?? null,
      carence_mois_entre_prises: raw.carence_mois_entre_prises ?? null,
      anciennete_min_ans_carriere: raw.anciennete_min_ans_carriere ?? null,
      // RG-CONGE-PRORATA-01 (Adil DAIA)
      prorata_fte_actif: raw.prorata_fte_actif ?? false,
      prorata_fte_mode: raw.prorata_fte_mode ?? "LINEAIRE",
      prorata_fte_seuil_min: raw.prorata_fte_seuil_min ?? null,
    });
    setPanel(`edit_type:${t.code}`);
    setActiveTab("general");
    setError(null);
  };

  const openNewFamille = () => {
    setFamilleForm({ ...EMPTY_FAMILLE });
    setPanel("new_famille");
    setError(null);
  };

  const openNewType = (code_famille?: string) => {
    setTypeForm({ ...EMPTY_TYPE, code_famille: code_famille || null });
    setPanel("new_type");
    setActiveTab("general");
    setError(null);
  };

  // ── Helpers couleur famille ────────────────────────────────────────────────
  /** RG-CONGE-COULEUR-01 (Adil DAIA): Récupère la couleur d'une famille */
  const getFamilleColor = (codeFamille: string | null): string => {
    if (!codeFamille) return "#64748B";
    const fam = familles.find(f => f.code === codeFamille);
    return fam?.couleur || "#6366F1";
  };

  // ── Render badge ──────────────────────────────────────────────────────────
  const BadgeTag: React.FC<{ on: boolean; label: string }> = ({ on, label }) =>
    on ? (
      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
        style={{ background: "hsl(var(--accent) / 0.12)", color: "hsl(var(--accent))" }}>{label}</span>
    ) : null;

  /**
   * RG-CONGE-COULEUR-01 (Adil DAIA): Rendu d'une ligne de type avec trame colorée.
   * La couleur de fond gauche est dérivée de la famille du type de congé.
   */
  const renderTypeRow = (t: TypeConge, depth = 0) => {
    const children = getChildren(t.code);
    const familleColor = getFamilleColor(t.code_famille);

    return (
      <React.Fragment key={t.code}>
        <tr style={{
          background: depth === 0 ? "hsl(var(--card))" : "hsl(var(--muted) / 0.2)",
          borderBottom: "1px solid hsl(var(--border))",
          position: "relative",
        }}>
          {/* Indicateur coloré de famille (barre gauche) */}
          <td className="px-4 py-2.5" style={{ paddingLeft: depth > 0 ? `${16 + depth * 20}px` : undefined }}>
            <div className="flex items-center gap-2">
              {/* RG-CONGE-COULEUR-01 (Adil DAIA): Pastille de couleur famille */}
              <div
                className="flex-shrink-0 rounded-full"
                style={{
                  width: 8,
                  height: 8,
                  background: familleColor,
                  boxShadow: `0 0 4px ${hexToRgba(familleColor, 0.5)}`,
                }}
                title={familles.find(f => f.code === t.code_famille)?.libelle}
              />
              {depth > 0 && <ChevronRight size={10} style={{ color: "hsl(var(--muted-foreground))" }} />}
              <span className="font-mono text-xs px-1.5 py-0.5 rounded"
                style={{ background: hexToRgba(familleColor, 0.12), color: familleColor }}>{t.code}</span>
            </div>
          </td>
          <td className="px-4 py-2.5">
            {/* RG-CONGE-COULEUR-01 (Adil DAIA): Trame colorée subtile sur le libellé */}
            <div
              className="flex items-center gap-2 flex-wrap rounded-md px-2 py-0.5 -mx-2"
              style={{ background: depth === 0 ? hexToRgba(familleColor, 0.04) : "transparent" }}
            >
              <span className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>{t.libelle}</span>
              <BadgeTag on={t.impacte_paie} label="Paie" />
              <BadgeTag on={t.workflow_obligatoire} label="Workflow" />
              <BadgeTag on={t.justificatif_obligatoire} label="Justif." />
              <BadgeTag on={(t as any).report_autorise === true} label="Report ↻" />
              <BadgeTag on={(t as any).reconduction_autorisee === true} label="Recond. ↺" />
              <BadgeTag on={(t as any).reprise_obligatoire === true} label="Reprise !" />
              <BadgeTag on={(t as any).interdit_reliquat === true} label="Solde requis" />
              {/* RG-CONGE-AUTOABS-01 (Adil DAIA) */}
              <BadgeTag on={(t as any).est_autorisation_absence === true} label="✓ Autor. Absence" />
              {/* RG-CONGE-SOLDE-NEGATIF-01 (Adil DAIA) */}
              <BadgeTag on={(t as any).solde_negatif_autorise === true} label="Solde négatif OK" />
              {/* RG-CONGE-FRACTIONNEMENT-01 (Adil DAIA) */}
              <BadgeTag on={(t as any).fractionnement_autorise === false} label="Non fractionnable" />
              {/* RG-CONGE-WINDOW-01 (Adil DAIA) */}
              <BadgeTag on={(t as any).window_mode === "GLISSANT"} label="🌐 Rolling" />
              <BadgeTag on={(t as any).window_mode === "ANNIVERSAIRE"} label="🗓 Anniversaire" />
              {/* RG-CONGE-ROLLOVER-01 (Adil DAIA) */}
              <BadgeTag on={(t as any).rollover_politique === "RACHAT_PAIE"} label="💰 Buy-Back" />
              <BadgeTag on={(t as any).rollover_politique === "TRANSFERT_CET"} label="🏦 CET" />
              {/* RG-CONGE-LIMIT-01 (Adil DAIA) */}
              <BadgeTag on={(t as any).nb_occurrences_max_carriere != null} label="🔒 Lifetime" />
              {/* RG-CONGE-PRORATA-01 (Adil DAIA) */}
              <BadgeTag on={(t as any).prorata_fte_actif === true} label="📊 FTE" />
            </div>
            {t.description && <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{t.description}</p>}
          </td>
          <td className="px-4 py-2.5 text-xs text-center" style={{ color: "hsl(var(--muted-foreground))" }}>
            {/* RG-CONGE-JOUR-01 (Adil DAIA): Affichage du type de jour avec badge */}
            {t.unite === "HEURE" ? (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                style={{ background: "hsl(var(--muted) / 0.5)", color: "hsl(var(--muted-foreground))" }}>
                Heures
              </span>
            ) : t.code_type_jour ? (
              (() => {
                const tj = typesJour.find(j => j.code === t.code_type_jour);
                const tjColors: Record<string, string> = { CAL: "#6366F1", OUV: "#059669", OUV2: "#D97706" };
                const c = tjColors[t.code_type_jour] || "#6366F1";
                return (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                    style={{ background: hexToRgba(c, 0.12), color: c }}
                    title={tj?.description || ""}>
                    {tj?.libelle || t.code_type_jour}
                  </span>
                );
              })()
            ) : "—"}
          </td>
          <td className="px-4 py-2.5 text-xs text-center" style={{ color: "hsl(var(--foreground))" }}>
            {t.mode_calcul_droit_legal === "BAREME" && t.code_bareme_legal
              ? <span className="text-xs px-1.5 py-0.5 rounded font-mono"
                  style={{ background: "hsl(var(--accent)/0.1)", color: "hsl(var(--accent))" }}>
                  {t.code_bareme_legal}
                </span>
              : t.droit_legal_jours != null
                ? `${t.droit_legal_jours}j`
                : "—"
            }
          </td>
          <td className="px-4 py-2.5 text-center">
            <span className={`text-xs px-2 py-0.5 rounded-full ${t.actif ? "text-emerald-700" : "text-gray-400"}`}
              style={{ background: t.actif ? "hsl(142 60% 50% / 0.12)" : "hsl(var(--muted) / 0.5)" }}>
              {t.actif ? "Actif" : "Inactif"}
            </span>
          </td>
          <td className="px-4 py-2.5">
            <div className="flex items-center justify-end gap-1">
              <button onClick={() => openNewType(t.code_famille || undefined)}
                className="p-1.5 rounded hover:bg-muted transition-colors" title="Ajouter sous-type">
                <Plus size={11} style={{ color: "hsl(var(--accent))" }} />
              </button>
              <button onClick={() => openDuplicateType(t)}
                className="p-1.5 rounded hover:bg-muted transition-colors" title="Dupliquer ce type">
                <Copy size={11} style={{ color: "hsl(var(--muted-foreground))" }} />
              </button>
              <button onClick={() => openEditType(t)} className="p-1.5 rounded hover:bg-muted transition-colors">
                <Pencil size={11} style={{ color: "hsl(var(--muted-foreground))" }} />
              </button>
              <button onClick={() => deleteType(t.code)} className="p-1.5 rounded hover:bg-muted transition-colors">
                <Trash2 size={11} style={{ color: "hsl(0 84% 55%)" }} />
              </button>
            </div>
          </td>
        </tr>
        {children.map(child => renderTypeRow(child, depth + 1))}
      </React.Fragment>
    );
  };

  // ─── Form panel Famille ────────────────────────────────────────────────────
  const renderFamilleForm = () => (
    <div className="rounded-xl border p-4 mb-4"
      style={{ background: "hsl(var(--accent) / 0.04)", borderColor: "hsl(var(--accent) / 0.3)" }}>
      <p className="text-sm font-semibold mb-3" style={{ color: "hsl(var(--accent))" }}>
        {panel === "new_famille" ? "Nouvelle famille de congé" : `Modifier famille : ${familleForm.code}`}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
        <Field label="Code" required>
          <input className={inputCls} style={inputStyle}
            value={familleForm.code}
            onChange={e => setFamilleForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
            disabled={panel?.startsWith("edit_famille:")}
            placeholder="CONGE_PAYE" />
        </Field>
        <Field label="Libellé" required className="col-span-2">
          <input className={inputCls} style={inputStyle}
            value={familleForm.libelle}
            onChange={e => setFamilleForm(f => ({ ...f, libelle: e.target.value }))}
            placeholder="Congés Payés" />
        </Field>
        <Field label="Description" className="col-span-full">
          <input className={inputCls} style={inputStyle}
            value={familleForm.description || ""}
            onChange={e => setFamilleForm(f => ({ ...f, description: e.target.value }))}
            placeholder="Description..." />
        </Field>
        <Field label="Ordre">
          <input className={inputCls} style={inputStyle} type="number"
            value={familleForm.ordre ?? 0}
            onChange={e => setFamilleForm(f => ({ ...f, ordre: parseInt(e.target.value) || 0 }))} />
        </Field>
        <Field label="Statut">
          <Toggle value={familleForm.actif} onChange={v => setFamilleForm(f => ({ ...f, actif: v }))} label={familleForm.actif ? "Active" : "Inactive"} />
        </Field>
      </div>

      {/* RG-CONGE-COULEUR-01 (Adil DAIA): Sélecteur de couleur de famille */}
      <div className="mb-3">
        <label className="flex items-center gap-1.5 text-xs font-medium mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>
          <Palette size={12} />
          Couleur de la famille
          <span className="text-[10px] px-1.5 py-0.5 rounded-full"
            style={{ background: "hsl(var(--accent) / 0.1)", color: "hsl(var(--accent))" }}>
            Utilisée pour colorer les types dans la liste
          </span>
        </label>
        <div className="flex items-center gap-3">
          {/* Palette prédéfinie */}
          <div className="flex flex-wrap gap-1.5">
            {PALETTE_COULEURS.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setFamilleForm(f => ({ ...f, couleur: c }))}
                className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                style={{
                  background: c,
                  borderColor: familleForm.couleur === c ? "hsl(var(--foreground))" : "transparent",
                  boxShadow: familleForm.couleur === c ? `0 0 0 2px hsl(var(--background)), 0 0 0 3px ${c}` : "none",
                }}
                title={c}
              />
            ))}
          </div>
          {/* Input couleur personnalisée */}
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={familleForm.couleur || "#6366F1"}
              onChange={e => setFamilleForm(f => ({ ...f, couleur: e.target.value }))}
              className="w-8 h-8 rounded cursor-pointer border"
              style={{ borderColor: "hsl(var(--border))", padding: "2px" }}
            />
            <input
              className={inputCls}
              style={{ ...inputStyle, width: "100px" }}
              value={familleForm.couleur || ""}
              onChange={e => setFamilleForm(f => ({ ...f, couleur: e.target.value }))}
              placeholder="#RRGGBB"
              maxLength={7}
            />
            {/* Aperçu */}
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium"
              style={{
                background: hexToRgba(familleForm.couleur || "#6366F1", 0.12),
                color: familleForm.couleur || "#6366F1",
                border: `1px solid ${hexToRgba(familleForm.couleur || "#6366F1", 0.3)}`,
              }}>
              <div className="w-2 h-2 rounded-full" style={{ background: familleForm.couleur || "#6366F1" }} />
              Aperçu
            </div>
          </div>
        </div>
      </div>

      {panel?.startsWith("edit_famille:") && (
        <div className="mt-4 mb-4 pt-4 border-t" style={{ borderColor: "hsl(var(--border))" }}>
          <FamilleWorkflowSelect codeFamille={familleForm.code} />
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={saveFamille} disabled={saving}
          className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold"
          style={{ background: "hsl(var(--accent))", color: "white" }}>
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button onClick={() => { setPanel(null); setError(null); }}
          className="px-4 py-1.5 rounded-lg text-sm border"
          style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
          Annuler
        </button>
      </div>
    </div>
  );

  const tabs = [
    { key: "general",      label: "Général",                icon: "⚙" },
    { key: "droits",       label: "Droits & Règles",        icon: "📋" },
    { key: "paie",         label: "Paie & Indem.",          icon: "💰" },
    { key: "workflow",     label: "Workflow",               icon: "🔄" },
    { key: "report",       label: "Report & Reliquats",     icon: "↻" },
    { key: "reconduction", label: "Reconduction & Reprise", icon: "↺" },
    { key: "acquisition",  label: "Acquisition",            icon: "📅" },
    { key: "international",label: "International 🌍",       icon: "🌍" },
  ] as const;

  // ─── Helpers pour l'alerte RG-CONGE-HIER-01 dans le formulaire ──────────────
  /**
   * RG-CONGE-HIER-01 (Adil DAIA): Calcule les limites de droits en fonction du parent
   * pour afficher des avertissements en temps réel dans le formulaire.
   */
  const getParentLimits = () => {
    if (!typeForm.code_type_conge_parent) return null;
    const parent = types.find(t => t.code === typeForm.code_type_conge_parent);
    if (!parent) return null;
    return {
      droit_legal_jours: parent.droit_legal_jours,
      droit_convention_jours: parent.droit_convention_jours,
      droit_particulier_jours: parent.droit_particulier_jours,
      libelle: parent.libelle,
    };
  };

  const renderTypeForm = () => {
    const parentLimits = getParentLimits();

    return (
      <div className="rounded-xl border p-4 mb-4"
        style={{ background: "hsl(var(--accent) / 0.04)", borderColor: "hsl(var(--accent) / 0.3)" }}>
        {panel === "new_type" ? (
          <p className="text-sm font-semibold mb-3" style={{ color: "hsl(var(--accent))" }}>
            Nouveau type de congé
          </p>
        ) : (
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <p className="text-sm font-semibold" style={{ color: "hsl(var(--accent))" }}>
              Modifier :
            </p>
            <span className="font-mono px-1.5 py-0.5 rounded text-xs font-semibold"
              style={{ background: "hsl(var(--accent) / 0.12)", color: "hsl(var(--accent))" }}>
              {typeForm.code}
            </span>
            <span className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>
              {typeForm.libelle}
            </span>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b" style={{ borderColor: "hsl(var(--border))" }}>
          {tabs.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className="px-3 py-1.5 text-xs font-medium rounded-t-lg transition-colors"
              style={{
                background: activeTab === tab.key ? "hsl(var(--accent))" : "transparent",
                color: activeTab === tab.key ? "white" : "hsl(var(--muted-foreground))",
                borderBottom: activeTab === tab.key ? "2px solid hsl(var(--accent))" : "2px solid transparent",
              }}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab: Général */}
        {activeTab === "general" && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label="Code" required>
              <input className={inputCls} style={inputStyle}
                value={typeForm.code}
                onChange={e => setTypeForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                disabled={panel?.startsWith("edit_type:")}
                placeholder="CP_ANNUEL" />
            </Field>
            <Field label="Libellé" required className="col-span-2">
              <input className={inputCls} style={inputStyle}
                value={typeForm.libelle}
                onChange={e => setTypeForm(f => ({ ...f, libelle: e.target.value }))}
                placeholder="Congé Payé Annuel" />
            </Field>
            <Field label="Ordre">
              <input className={inputCls} style={inputStyle} type="number"
                value={typeForm.ordre ?? 0}
                onChange={e => setTypeForm(f => ({ ...f, ordre: parseInt(e.target.value) || 0 }))} />
            </Field>
            <Field label="Famille" required className="col-span-2">
              <select className={inputCls} style={inputStyle}
                value={typeForm.code_famille || ""}
                onChange={e => setTypeForm(f => ({ ...f, code_famille: e.target.value || null }))}>
                <option value="">— Sélectionner —</option>
                {familles.map(f => (
                  <option key={f.code} value={f.code}>{f.libelle}</option>
                ))}
              </select>
            </Field>
            <Field label="Type parent (sous-type de)" className="col-span-2">
              <select className={inputCls} style={inputStyle}
                value={typeForm.code_type_conge_parent || ""}
                onChange={e => setTypeForm(f => ({ ...f, code_type_conge_parent: e.target.value || null }))}>
                <option value="">— Aucun (racine) —</option>
                {types.filter(t => t.code !== typeForm.code).map(t => (
                  <option key={t.code} value={t.code}>{t.libelle} ({t.code})</option>
                ))}
              </select>
            </Field>
            {/* RG-CONGE-HIER-01 (Adil DAIA): Info sur le parent sélectionné */}
            {parentLimits && (
              <div className="col-span-full px-3 py-2 rounded-lg text-xs"
                style={{ background: "hsl(var(--accent) / 0.06)", border: "1px solid hsl(var(--accent) / 0.2)", color: "hsl(var(--muted-foreground))" }}>
                <span className="font-semibold" style={{ color: "hsl(var(--accent))" }}>RG-CONGE-HIER-01 :</span>{" "}
                Sous-type de <strong>{parentLimits.libelle}</strong> —
                les droits ci-dessous ne peuvent pas dépasser ceux du parent :
                {parentLimits.droit_legal_jours != null && <span className="ml-2">Légal: <strong>{parentLimits.droit_legal_jours}j</strong></span>}
                {parentLimits.droit_convention_jours != null && <span className="ml-2">Convention: <strong>{parentLimits.droit_convention_jours}j</strong></span>}
                {parentLimits.droit_particulier_jours != null && <span className="ml-2">Particulier: <strong>{parentLimits.droit_particulier_jours}j</strong></span>}
              </div>
            )}
            {/* RG-CONGE-JOUR-01 (Adil DAIA): Sélecteur d'unité de décompte */}
            <Field label="Unité de décompte" required className="col-span-2">
              <div className="flex gap-2">
                {/* Choix Jours / Heures */}
                <div className="flex gap-1">
                  {(["JOUR", "HEURE"] as const).map(u => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setTypeForm(f => ({
                        ...f,
                        unite: u,
                        code_type_jour: u === "HEURE" ? null : (f.code_type_jour || "CAL"),
                      }))}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all"
                      style={{
                        background: typeForm.unite === u ? "hsl(var(--accent))" : "transparent",
                        color: typeForm.unite === u ? "white" : "hsl(var(--muted-foreground))",
                        borderColor: typeForm.unite === u ? "hsl(var(--accent))" : "hsl(var(--border))",
                      }}>
                      {u === "JOUR" ? "Jours" : "Heures"}
                    </button>
                  ))}
                </div>
                {/* Si Jours → sélecteur type de jour */}
                {typeForm.unite !== "HEURE" && (
                  <select className={inputCls} style={inputStyle}
                    value={typeForm.code_type_jour || ""}
                    onChange={e => setTypeForm(f => ({ ...f, code_type_jour: e.target.value || null }))}>
                    <option value="">— Type de jour —</option>
                    {typesJour.map(tj => (
                      <option key={tj.code} value={tj.code}>{tj.libelle}</option>
                    ))}
                  </select>
                )}
              </div>
            </Field>
            {/* RG-CONGE-JOUR-01 (Adil DAIA): Carte de définition du type de jour sélectionné */}
            {typeForm.unite !== "HEURE" && typeForm.code_type_jour && (() => {
              const tj = typesJour.find(j => j.code === typeForm.code_type_jour);
              if (!tj) return null;
              const tjColors: Record<string, string> = { CAL: "#6366F1", OUV: "#059669", OUV2: "#D97706" };
              const c = tjColors[tj.code] || "#6366F1";
              const JOURS_LABELS = ["", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
              return (
                <div className="col-span-full rounded-xl border overflow-hidden"
                  style={{ borderColor: hexToRgba(c, 0.3), background: hexToRgba(c, 0.04) }}>
                  <div className="flex items-center gap-2 px-3 py-2 border-b"
                    style={{ borderColor: hexToRgba(c, 0.2), background: hexToRgba(c, 0.08) }}>
                    <CalendarDays size={13} style={{ color: c }} />
                    <span className="text-xs font-semibold" style={{ color: c }}>
                      {tj.libelle}
                    </span>
                    <span className="text-xs ml-auto font-mono px-1.5 py-0.5 rounded"
                      style={{ background: hexToRgba(c, 0.15), color: c }}>
                      {tj.code}
                    </span>
                  </div>
                  <div className="px-3 py-2.5 space-y-2">
                    {tj.description && (
                      <p className="text-xs leading-relaxed" style={{ color: "hsl(var(--muted-foreground))" }}>
                        {tj.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3 flex-wrap mt-1">
                      {/* Jours de la semaine */}
                      <div className="flex items-center gap-1">
                        {[1, 2, 3, 4, 5, 6, 7].map(d => {
                          const active = Array.isArray(tj.jours_semaine) && tj.jours_semaine.includes(d);
                          return (
                            <span key={d} className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                              style={{
                                background: active ? hexToRgba(c, 0.2) : "hsl(var(--muted) / 0.4)",
                                color: active ? c : "hsl(var(--muted-foreground))",
                                fontWeight: active ? 700 : 400,
                              }}>
                              {JOURS_LABELS[d]}
                            </span>
                          );
                        })}
                      </div>
                      {/* Indicateur fériés */}
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1"
                        style={{
                          background: tj.compte_feries ? hexToRgba(c, 0.12) : "hsl(var(--muted) / 0.4)",
                          color: tj.compte_feries ? c : "hsl(var(--muted-foreground))",
                        }}>
                        <Info size={9} />
                        Fériés {tj.compte_feries ? "comptabilisés" : "exclus"}
                      </span>
                      {/* Base semaine */}
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                        style={{ background: hexToRgba(c, 0.12), color: c }}>
                        {Array.isArray(tj.jours_semaine) ? tj.jours_semaine.length : 0}j / semaine
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}

            <Field label="Description" className="col-span-full">
              <textarea className={inputCls + " resize-none"} style={{ ...inputStyle, minHeight: 60 }}
                value={typeForm.description || ""}
                onChange={e => setTypeForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Description..." rows={2} />
            </Field>
            <Field label="Référence décision">
              <input className={inputCls} style={inputStyle}
                value={typeForm.decision_reference || ""}
                onChange={e => setTypeForm(f => ({ ...f, decision_reference: e.target.value }))} />
            </Field>
            <Field label="Statut">
              <div className="flex items-center h-9">
                <Toggle value={typeForm.actif} onChange={v => setTypeForm(f => ({ ...f, actif: v }))}
                  label={typeForm.actif ? "Actif" : "Inactif"} />
              </div>
            </Field>
          </div>
        )}

        {/* Tab: Droits & Règles */}
        {activeTab === "droits" && (
          <div className="flex flex-col gap-4">

            {/* ── Droits ── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {/* Droit légal */}
              {/* Mode calcul droit légal */}
              <div className="col-span-full flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>Droit légal — mode :</span>
                {(["FIXE", "BAREME", "PRORATA"] as const).map(m => (
                  <button key={m} type="button"
                    onClick={() => setTypeForm(f => ({ ...f, mode_calcul_droit_legal: m }))}
                    className="px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all"
                    style={{
                      background: typeForm.mode_calcul_droit_legal === m ? "hsl(var(--accent))" : "transparent",
                      color: typeForm.mode_calcul_droit_legal === m ? "white" : "hsl(var(--muted-foreground))",
                      borderColor: typeForm.mode_calcul_droit_legal === m ? "hsl(var(--accent))" : "hsl(var(--border))",
                    }}>{m}</button>
                ))}
                {typeForm.mode_calcul_droit_legal === "BAREME" && (
                  <select className={inputCls} style={{ ...inputStyle, fontSize: "calc(12px * var(--font-scale))", padding: "2px 8px" }}
                    value={typeForm.code_bareme_legal || ""}
                    onChange={e => setTypeForm(f => ({ ...f, code_bareme_legal: e.target.value || null }))}>
                    <option value="">— Choisir un barème —</option>
                    {baremes.map(b => <option key={b.code} value={b.code}>{b.libelle}</option>)}
                  </select>
                )}
              </div>
              <Field label="Droit légal (jours)">
                <input className={inputCls} style={{
                  ...inputStyle,
                  borderColor: (parentLimits?.droit_legal_jours != null && typeForm.droit_legal_jours != null && typeForm.droit_legal_jours > parentLimits.droit_legal_jours)
                    ? "hsl(0 84% 55%)" : inputStyle.borderColor,
                  opacity: typeForm.mode_calcul_droit_legal !== "FIXE" ? 0.4 : 1,
                }}
                  type="number" min={0} disabled={typeForm.mode_calcul_droit_legal !== "FIXE"}
                  max={parentLimits?.droit_legal_jours ?? undefined}
                  value={typeForm.droit_legal_jours ?? ""}
                  onChange={e => setTypeForm(f => ({ ...f, droit_legal_jours: e.target.value ? parseInt(e.target.value) : null }))} />
                {/* RG-CONGE-HIER-01 (Adil DAIA): Avertissement en temps réel */}
                {parentLimits?.droit_legal_jours != null && (
                  <p className="text-[10px] mt-0.5" style={{
                    color: (typeForm.droit_legal_jours != null && typeForm.droit_legal_jours > parentLimits.droit_legal_jours)
                      ? "hsl(0 84% 55%)" : "hsl(var(--muted-foreground))",
                  }}>
                    Max autorisé : {parentLimits.droit_legal_jours}j (parent)
                  </p>
                )}
              </Field>
              <Field label="Référence légale" className="col-span-2">
                <input className={inputCls} style={inputStyle}
                  value={typeForm.reference_legale || ""}
                  onChange={e => setTypeForm(f => ({ ...f, reference_legale: e.target.value }))}
                  placeholder="Art. L.3141-1 ..." />
              </Field>

              {/* Droit convention */}
              <Field label="Droit convention (jours)">
                <input className={inputCls} style={{
                  ...inputStyle,
                  borderColor: (parentLimits?.droit_convention_jours != null && typeForm.droit_convention_jours != null && typeForm.droit_convention_jours > parentLimits.droit_convention_jours)
                    ? "hsl(0 84% 55%)" : inputStyle.borderColor,
                }}
                  type="number" min={0}
                  max={parentLimits?.droit_convention_jours ?? undefined}
                  value={typeForm.droit_convention_jours ?? ""}
                  onChange={e => setTypeForm(f => ({ ...f, droit_convention_jours: e.target.value ? parseInt(e.target.value) : null }))} />
                {parentLimits?.droit_convention_jours != null && (
                  <p className="text-[10px] mt-0.5" style={{
                    color: (typeForm.droit_convention_jours != null && typeForm.droit_convention_jours > parentLimits.droit_convention_jours)
                      ? "hsl(0 84% 55%)" : "hsl(var(--muted-foreground))",
                  }}>
                    Max autorisé : {parentLimits.droit_convention_jours}j (parent)
                  </p>
                )}
              </Field>
              <Field label="Référence convention" className="col-span-2">
                <input className={inputCls} style={inputStyle}
                  value={typeForm.reference_convention || ""}
                  onChange={e => setTypeForm(f => ({ ...f, reference_convention: e.target.value }))} />
              </Field>

              {/* Droit particulier */}
              <Field label="Droit particulier (jours)">
                <input className={inputCls} style={{
                  ...inputStyle,
                  borderColor: (parentLimits?.droit_particulier_jours != null && typeForm.droit_particulier_jours != null && typeForm.droit_particulier_jours > parentLimits.droit_particulier_jours)
                    ? "hsl(0 84% 55%)" : inputStyle.borderColor,
                }}
                  type="number" min={0}
                  max={parentLimits?.droit_particulier_jours ?? undefined}
                  value={typeForm.droit_particulier_jours ?? ""}
                  onChange={e => setTypeForm(f => ({ ...f, droit_particulier_jours: e.target.value ? parseInt(e.target.value) : null }))} />
                {parentLimits?.droit_particulier_jours != null && (
                  <p className="text-[10px] mt-0.5" style={{
                    color: (typeForm.droit_particulier_jours != null && typeForm.droit_particulier_jours > parentLimits.droit_particulier_jours)
                      ? "hsl(0 84% 55%)" : "hsl(var(--muted-foreground))",
                  }}>
                    Max autorisé : {parentLimits.droit_particulier_jours}j (parent)
                  </p>
                )}
              </Field>
              <Field label="Condition particulière" className="col-span-2">
                <input className={inputCls} style={inputStyle}
                  value={typeForm.condition_particuliere || ""}
                  onChange={e => setTypeForm(f => ({ ...f, condition_particuliere: e.target.value }))} />
              </Field>
              <Field label="Durée max (jours)">
                <input className={inputCls} style={inputStyle} type="number" min={0}
                  value={typeForm.duree_max ?? ""}
                  onChange={e => setTypeForm(f => ({ ...f, duree_max: e.target.value ? parseInt(e.target.value) : null }))} />
              </Field>
              <Field label="Ancienneté min (mois)">
                <input className={inputCls} style={inputStyle} type="number" min={0}
                  value={typeForm.anciennete_min_mois ?? ""}
                  onChange={e => setTypeForm(f => ({ ...f, anciennete_min_mois: e.target.value ? parseInt(e.target.value) : null }))} />
              </Field>
              <Field label="Préavis (jours)">
                <input className={inputCls} style={inputStyle} type="number" min={0}
                  value={typeForm.preavis_jours ?? ""}
                  onChange={e => setTypeForm(f => ({ ...f, preavis_jours: e.target.value ? parseInt(e.target.value) : null }))} />
              </Field>
              <div className="col-span-full flex gap-4 mt-1 flex-wrap">
                <Toggle value={typeForm.justificatif_obligatoire}
                  onChange={v => setTypeForm(f => ({ ...f, justificatif_obligatoire: v }))}
                  label="Justificatif obligatoire" />
              </div>
            </div>

            {/* ── RG-CONGE-AUTOABS-01 : Autorisation d'Absence ──────────────
                Un type marqué "Autorisation d'Absence" est accordé de plein droit
                sans décompte sur un solde. La durée est encadrée par le droit légal.
            ─────────────────────────────────────────────────────────────────── */}
            <div className="rounded-xl border overflow-hidden"
              style={{ borderColor: typeForm.est_autorisation_absence ? "hsl(142 60% 45% / 0.4)" : "hsl(var(--border))" }}>
              <div className="flex items-center gap-3 px-4 py-2.5"
                style={{ background: typeForm.est_autorisation_absence ? "hsl(142 60% 45% / 0.08)" : "hsl(var(--muted)/0.3)", borderBottom: "1px solid hsl(var(--border))" }}>
                <Ban size={14} style={{ color: typeForm.est_autorisation_absence ? "hsl(142 60% 40%)" : "hsl(var(--muted-foreground))" }} />
                <span className="text-xs font-semibold" style={{ color: typeForm.est_autorisation_absence ? "hsl(142 60% 35%)" : "hsl(var(--muted-foreground))" }}>
                  Autorisation d'Absence
                </span>
                <span className="text-xs ml-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                  — RG-CONGE-AUTOABS-01 : accordée de plein droit, sans décompte de solde
                </span>
                <div className="ml-auto">
                  <Toggle value={typeForm.est_autorisation_absence}
                    onChange={v => setTypeForm(f => ({ ...f, est_autorisation_absence: v }))}
                    label={typeForm.est_autorisation_absence ? "Activé" : "Désactivé"} />
                </div>
              </div>
              {typeForm.est_autorisation_absence && (
                <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Field label="Occurrences max / an">
                    <input className={inputCls} style={inputStyle} type="number" min={0}
                      placeholder="Illimité"
                      value={typeForm.nb_occurrences_max_an ?? ""}
                      onChange={e => setTypeForm(f => ({ ...f, nb_occurrences_max_an: e.target.value ? parseInt(e.target.value) : null }))} />
                    <p className="text-[10px] mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>RG-CONGE-PLAFONDEVENT-01</p>
                  </Field>
                  <Field label="Occurrences max / contrat">
                    <input className={inputCls} style={inputStyle} type="number" min={0}
                      placeholder="Illimité"
                      value={typeForm.nb_occurrences_max_contrat ?? ""}
                      onChange={e => setTypeForm(f => ({ ...f, nb_occurrences_max_contrat: e.target.value ? parseInt(e.target.value) : null }))} />
                  </Field>
                  <div className="col-span-full flex gap-4 flex-wrap">
                    <Toggle value={typeForm.is_conge_maternite}
                      onChange={v => setTypeForm(f => ({ ...f, is_conge_maternite: v, is_conge_paternite: v ? false : f.is_conge_paternite }))}
                      label="Congé maternité" />
                    <Toggle value={typeForm.is_conge_paternite}
                      onChange={v => setTypeForm(f => ({ ...f, is_conge_paternite: v, is_conge_maternite: v ? false : f.is_conge_maternite }))}
                      label="Congé paternité" />
                  </div>
                </div>
              )}
            </div>

            {/* ── RG-CONGE-SOLDE-NEGATIF-01 + Règles complémentaires ────────── */}
            <div className="rounded-xl border p-4 grid grid-cols-2 sm:grid-cols-4 gap-3" style={{ borderColor: "hsl(var(--border))" }}>
              <div className="col-span-full text-xs font-semibold mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                Règles complémentaires
              </div>
              {/* RG-CONGE-SOLDE-NEGATIF-01 */}
              <div className="col-span-2 flex items-center gap-3">
                <Toggle value={typeForm.solde_negatif_autorise}
                  onChange={v => setTypeForm(f => ({ ...f, solde_negatif_autorise: v, interdit_reliquat: v ? false : f.interdit_reliquat }))}
                  label="Solde négatif autorisé (RG-CONGE-SOLDE-NEGATIF-01)" />
              </div>
              {/* RG-CONGE-DELAI-DEPOT-01 */}
              <Field label="Délai dépôt min (jours ouvrés) — RG-CONGE-DELAI-DEPOT-01">
                <input className={inputCls} style={inputStyle} type="number" min={0} placeholder="0 = aucun"
                  value={typeForm.delai_depot_min_jours ?? ""}
                  onChange={e => setTypeForm(f => ({ ...f, delai_depot_min_jours: e.target.value ? parseInt(e.target.value) : null }))} />
              </Field>
              {/* RG-CONGE-CHEVAUCHEMENT-01 */}
              <Field label="Contrôle chevauchement — RG-CONGE-CHEVAUCHEMENT-01">
                <select className={inputCls} style={inputStyle}
                  value={typeForm.controle_chevauchement || "STRICT"}
                  onChange={e => setTypeForm(f => ({ ...f, controle_chevauchement: e.target.value as any }))}>
                  <option value="AUCUN">Aucun contrôle</option>
                  <option value="AVERTISSEMENT">Avertissement</option>
                  <option value="STRICT">Strict (blocage)</option>
                </select>
              </Field>
              {/* RG-CONGE-FRACTIONNEMENT-01 */}
              <div className="col-span-full flex items-center gap-6 flex-wrap">
                <Toggle value={typeForm.fractionnement_autorise}
                  onChange={v => setTypeForm(f => ({ ...f, fractionnement_autorise: v }))}
                  label="Fractionnement autorisé (RG-CONGE-FRACTIONNEMENT-01)" />
                {typeForm.fractionnement_autorise && (
                  <Field label="Durée min par fraction (jours)">
                    <input className={inputCls} style={{ ...inputStyle, width: 100 }} type="number" min={1}
                      value={typeForm.fractionnement_min_jours ?? ""}
                      onChange={e => setTypeForm(f => ({ ...f, fractionnement_min_jours: e.target.value ? parseInt(e.target.value) : null }))} />
                  </Field>
                )}
              </div>
            </div>

            {/* ── Population cible ─────────────────────────────────────────────
                RG-CONGE-POP-01 (Adil DAIA):
                Deux modes complémentaires :
                  1) Critères structurés : sélecteurs sur attributs collaborateur
                  2) Condition libre     : expression métier textuelle
            ─────────────────────────────────────────────────────────────────── */}
            <div className="rounded-xl border overflow-hidden"
              style={{ borderColor: "hsl(var(--accent) / 0.25)" }}>
              {/* En-tête section */}
              <div className="flex items-center gap-2 px-4 py-2.5"
                style={{ background: "hsl(var(--accent) / 0.08)", borderBottom: "1px solid hsl(var(--accent) / 0.2)" }}>
                <Users size={14} style={{ color: "hsl(var(--accent))" }} />
                <span className="text-xs font-semibold" style={{ color: "hsl(var(--accent))" }}>
                  Population cible
                </span>
                <span className="text-xs ml-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                  — Définir les collaborateurs éligibles à ce type de congé
                </span>
              </div>

              <div className="p-4 flex flex-col gap-4">

                {/* Mode 1 : Critères structurés */}
                <div>
                  <div className="flex items-center gap-1.5 mb-3">
                    <Users size={12} style={{ color: "hsl(var(--muted-foreground))" }} />
                    <span className="text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>
                      Critères structurés (attributs du collaborateur)
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full ml-1"
                      style={{ background: "hsl(var(--accent) / 0.1)", color: "hsl(var(--accent))" }}>
                      Vide = sans restriction
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

                    {/* Genre */}
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                        Genre(s) éligible(s)
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {genres.map(g => {
                          const criteres = typeForm.population_criteres || EMPTY_POPULATION_CRITERES;
                          const checked = criteres.genres.includes(g.code);
                          return (
                            <button key={g.code} type="button"
                              onClick={() => {
                                const current = criteres.genres;
                                const next = checked ? current.filter(c => c !== g.code) : [...current, g.code];
                                setTypeForm(f => ({
                                  ...f,
                                  population_criteres: { ...criteres, genres: next },
                                }));
                              }}
                              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border transition-colors"
                              style={{
                                background: checked ? "hsl(var(--accent) / 0.12)" : "hsl(var(--background))",
                                borderColor: checked ? "hsl(var(--accent))" : "hsl(var(--border))",
                                color: checked ? "hsl(var(--accent))" : "hsl(var(--foreground))",
                              }}>
                              {checked && <Check size={10} />}
                              {g.libelle}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Ancienneté */}
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                        Ancienneté (mois)
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          className={inputCls} style={{ ...inputStyle, width: "80px" }}
                          type="number" min={0} placeholder="Min"
                          value={typeForm.population_criteres?.anciennete_min_mois ?? ""}
                          onChange={e => {
                            const criteres = typeForm.population_criteres || EMPTY_POPULATION_CRITERES;
                            setTypeForm(f => ({
                              ...f,
                              population_criteres: {
                                ...criteres,
                                anciennete_min_mois: e.target.value ? parseInt(e.target.value) : null,
                              },
                            }));
                          }}
                        />
                        <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>à</span>
                        <input
                          className={inputCls} style={{ ...inputStyle, width: "80px" }}
                          type="number" min={0} placeholder="Max"
                          value={typeForm.population_criteres?.anciennete_max_mois ?? ""}
                          onChange={e => {
                            const criteres = typeForm.population_criteres || EMPTY_POPULATION_CRITERES;
                            setTypeForm(f => ({
                              ...f,
                              population_criteres: {
                                ...criteres,
                                anciennete_max_mois: e.target.value ? parseInt(e.target.value) : null,
                              },
                            }));
                          }}
                        />
                        <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>mois</span>
                      </div>
                    </div>

                    {/* Catégorie professionnelle */}
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                        Catégorie(s) professionnelle(s)
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {categoriesPro.map(cp => {
                          const criteres = typeForm.population_criteres || EMPTY_POPULATION_CRITERES;
                          const checked = criteres.categories_pro.includes(cp.code);
                          return (
                            <button key={cp.code} type="button"
                              onClick={() => {
                                const current = criteres.categories_pro;
                                const next = checked ? current.filter(c => c !== cp.code) : [...current, cp.code];
                                setTypeForm(f => ({
                                  ...f,
                                  population_criteres: { ...criteres, categories_pro: next },
                                }));
                              }}
                              className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-xs border transition-colors"
                              style={{
                                background: checked ? "hsl(var(--accent) / 0.12)" : "hsl(var(--background))",
                                borderColor: checked ? "hsl(var(--accent))" : "hsl(var(--border))",
                                color: checked ? "hsl(var(--accent))" : "hsl(var(--foreground))",
                              }}>
                              {checked && <Check size={10} />}
                              {cp.libelle}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Types de contrat */}
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                        Type(s) de contrat
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {typesContrat.map(tc => {
                          const criteres = typeForm.population_criteres || EMPTY_POPULATION_CRITERES;
                          const checked = criteres.types_contrat.includes(tc.code);
                          return (
                            <button key={tc.code} type="button"
                              onClick={() => {
                                const current = criteres.types_contrat;
                                const next = checked ? current.filter(c => c !== tc.code) : [...current, tc.code];
                                setTypeForm(f => ({
                                  ...f,
                                  population_criteres: { ...criteres, types_contrat: next },
                                }));
                              }}
                              className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-xs border transition-colors"
                              style={{
                                background: checked ? "hsl(var(--accent) / 0.12)" : "hsl(var(--background))",
                                borderColor: checked ? "hsl(var(--accent))" : "hsl(var(--border))",
                                color: checked ? "hsl(var(--accent))" : "hsl(var(--foreground))",
                              }}>
                              {checked && <Check size={10} />}
                              {tc.libelle}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                  </div>
                </div>

                {/* Résumé des critères actifs */}
                {typeForm.population_criteres && (
                  typeForm.population_criteres.genres.length > 0 ||
                  typeForm.population_criteres.categories_pro.length > 0 ||
                  typeForm.population_criteres.types_contrat.length > 0 ||
                  typeForm.population_criteres.anciennete_min_mois != null ||
                  typeForm.population_criteres.anciennete_max_mois != null
                ) && (
                  <div className="flex flex-wrap gap-1.5 items-center">
                    <span className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>Critères actifs :</span>
                    {typeForm.population_criteres!.genres.map(g => (
                      <span key={g} className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                        style={{ background: "hsl(var(--accent) / 0.12)", color: "hsl(var(--accent))" }}>
                        {REF_GENRES.find(x => x.code === g)?.libelle || g}
                        <X size={8} className="cursor-pointer" onClick={() => {
                          const criteres = typeForm.population_criteres!;
                          setTypeForm(f => ({ ...f, population_criteres: { ...criteres, genres: criteres.genres.filter(c => c !== g) } }));
                        }} />
                      </span>
                    ))}
                    {typeForm.population_criteres!.categories_pro.map(c => (
                      <span key={c} className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                        style={{ background: "hsl(var(--accent) / 0.12)", color: "hsl(var(--accent))" }}>
                        {REF_CATEGORIES_PRO.find(x => x.code === c)?.libelle || c}
                        <X size={8} className="cursor-pointer" onClick={() => {
                          const criteres = typeForm.population_criteres!;
                          setTypeForm(f => ({ ...f, population_criteres: { ...criteres, categories_pro: criteres.categories_pro.filter(x => x !== c) } }));
                        }} />
                      </span>
                    ))}
                    {typeForm.population_criteres!.types_contrat.map(c => (
                      <span key={c} className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                        style={{ background: "hsl(var(--accent) / 0.12)", color: "hsl(var(--accent))" }}>
                        {REF_TYPES_CONTRAT.find(x => x.code === c)?.libelle || c}
                        <X size={8} className="cursor-pointer" onClick={() => {
                          const criteres = typeForm.population_criteres!;
                          setTypeForm(f => ({ ...f, population_criteres: { ...criteres, types_contrat: criteres.types_contrat.filter(x => x !== c) } }));
                        }} />
                      </span>
                    ))}
                    {typeForm.population_criteres!.anciennete_min_mois != null && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                        style={{ background: "hsl(var(--accent) / 0.12)", color: "hsl(var(--accent))" }}>
                        Ancienneté ≥ {typeForm.population_criteres!.anciennete_min_mois} mois
                      </span>
                    )}
                    {typeForm.population_criteres!.anciennete_max_mois != null && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                        style={{ background: "hsl(var(--accent) / 0.12)", color: "hsl(var(--accent))" }}>
                        Ancienneté ≤ {typeForm.population_criteres!.anciennete_max_mois} mois
                      </span>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px" style={{ background: "hsl(var(--border))" }} />
                  <span className="text-[10px] font-medium px-2" style={{ color: "hsl(var(--muted-foreground))" }}>ET / OU</span>
                  <div className="flex-1 h-px" style={{ background: "hsl(var(--border))" }} />
                </div>

                {/* Mode 2 : Condition libre */}
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Code2 size={12} style={{ color: "hsl(var(--muted-foreground))" }} />
                    <span className="text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>
                      Condition libre (expression métier)
                    </span>
                  </div>
                  <textarea
                    className={inputCls + " resize-none font-mono text-xs"}
                    style={{ ...inputStyle, minHeight: 64 }}
                    rows={3}
                    placeholder={`Ex: collaborateur.categorie == 'CP02' ET collaborateur.anciennete_annees >= 2\nOu: contrat.type IN ('CDI_STD') ET collab.code_genre == 'F'\nOu toute description textuelle de la condition d'éligibilité...`}
                    value={typeForm.population_condition || ""}
                    onChange={e => setTypeForm(f => ({ ...f, population_condition: e.target.value || null }))}
                  />
                  <p className="text-[10px] mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Saisir une règle textuelle ou expression complémentaire aux critères structurés ci-dessus.
                    Documentée mais non évaluée automatiquement en phase actuelle.
                  </p>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* Tab: Paie & Indemnisations */}
        {activeTab === "paie" && (
          <div className="flex flex-col gap-4">
            <div className="p-3 rounded-lg" style={{ background: "hsl(var(--muted) / 0.3)" }}>
              <p className="text-xs font-semibold mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>Impact paie</p>
              <Toggle value={typeForm.impacte_paie}
                onChange={v => setTypeForm(f => ({ ...f, impacte_paie: v }))}
                label="Ce congé impacte la paie" />
              {typeForm.impacte_paie && (
                <div className="mt-3">
                  <Field label="Rubrique de paie associée (élément variable — Nombre)">
                    <select className={inputCls} style={inputStyle}
                      value={typeForm.code_rubrique_paie ?? ""}
                      onChange={e => setTypeForm(f => ({ ...f, code_rubrique_paie: e.target.value || null }))}>
                      <option value="">— Aucune association —</option>
                      {rubriquesPaie.map(r => (
                        <option key={r.code} value={r.code}>{r.code} · {r.libelle}</option>
                      ))}
                    </select>
                  </Field>
                  <p className="text-[10px] mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Utilisée par « Récupération des modules » : le nombre de jours de congé approuvés
                    et chevauchant la période est déposé dans l'attribut <strong>Nombre</strong> de cette
                    rubrique, sur un élément variable de type <strong>Ajout</strong>, source <strong>POINTAGE</strong>.
                    Sans association, ce type de congé est ignoré par la récupération automatique.
                  </p>
                </div>
              )}
            </div>
            <div className="p-3 rounded-lg" style={{ background: "hsl(var(--muted) / 0.3)" }}>
              <p className="text-xs font-semibold mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>Indemnisations</p>
              <div className="flex flex-col gap-2">
                <Toggle value={typeForm.indemnisable_cnss}
                  onChange={v => setTypeForm(f => ({ ...f, indemnisable_cnss: v }))}
                  label="Indemnisable CNSS" />
                <Toggle value={typeForm.indemnisable_amo}
                  onChange={v => setTypeForm(f => ({ ...f, indemnisable_amo: v }))}
                  label="Indemnisable AMO" />
                <Toggle value={typeForm.indemnisable_cimr}
                  onChange={v => setTypeForm(f => ({ ...f, indemnisable_cimr: v }))}
                  label="Indemnisable CIMR" />
              </div>
            </div>
          </div>
        )}

        {/* Tab: Workflow */}
        {activeTab === "workflow" && (
          <div className="p-3 rounded-lg" style={{ background: "hsl(var(--muted) / 0.3)" }}>
            {typeForm.code ? (
              <div className="space-y-5">
                <CongeWorkflowPanel codeType={typeForm.code} codeFamille={typeForm.code_famille} />
                <div className="pt-4 border-t" style={{ borderColor: "hsl(var(--border))" }}>
                  <OperationsWorkflowPanel codeType={typeForm.code} />
                </div>
              </div>
            ) : (
              <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                Enregistrez d'abord le type de congé pour configurer son circuit de validation.
              </p>
            )}
          </div>
        )}

        {/* ─── Tab: Report & Reliquats ────────────────────────────────────────────
            RG-CONGE-REPORT-01 (Adil DAIA):
            Paramétrage du report des reliquats non consommés à la clôture de l'exercice.
            - Autorisation du report (on/off)
            - Plafond : fixe (jours) ou pourcentage du droit annuel
            - Date butoir : délai en mois OU date JJ/MM fixe
            - Action sur le solde restant (perte / re-report / paiement)
            - Cumul multi-exercices
        ─────────────────────────────────────────────────────────────────────── */}
        {activeTab === "report" && (
          <div className="flex flex-col gap-4">

            {/* Toggle principal */}
            <div className="flex items-center gap-3 p-3 rounded-xl border"
              style={{
                background: typeForm.report_autorise ? "hsl(var(--accent) / 0.06)" : "hsl(var(--muted) / 0.3)",
                borderColor: typeForm.report_autorise ? "hsl(var(--accent) / 0.3)" : "hsl(var(--border))",
              }}>
              <RotateCcw size={16} style={{ color: typeForm.report_autorise ? "hsl(var(--accent))" : "hsl(var(--muted-foreground))" }} />
              <div className="flex-1">
                <p className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                  Autoriser le report des reliquats
                </p>
                <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Permet aux collaborateurs de reporter les jours non consommés sur l'exercice suivant.
                </p>
              </div>
              <Toggle
                value={typeForm.report_autorise}
                onChange={v => setTypeForm(f => ({ ...f, report_autorise: v }))}
                label={typeForm.report_autorise ? "Activé" : "Désactivé"}
              />
            </div>

            {typeForm.report_autorise && (
              <>
                {/* Plafond du report */}
                <div className="rounded-xl border overflow-hidden" style={{ borderColor: "hsl(var(--accent) / 0.2)" }}>
                  <div className="flex items-center gap-2 px-4 py-2.5"
                    style={{ background: "hsl(var(--accent) / 0.07)", borderBottom: "1px solid hsl(var(--accent) / 0.15)" }}>
                    <ArrowRightCircle size={13} style={{ color: "hsl(var(--accent))" }} />
                    <span className="text-xs font-semibold" style={{ color: "hsl(var(--accent))" }}>
                      Plafond du report
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full ml-1"
                      style={{ background: "hsl(var(--accent) / 0.12)", color: "hsl(var(--accent))" }}>
                      Vide = sans plafond
                    </span>
                  </div>
                  <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Field label="Mode de plafond" className="col-span-2">
                      <div className="flex gap-2">
                        {[
                          { val: "FIXE", label: "Jours fixes" },
                          { val: "POURCENTAGE", label: "% du droit annuel" },
                        ].map(opt => (
                          <button key={opt.val} type="button"
                            onClick={() => setTypeForm(f => ({ ...f, report_mode_plafond: opt.val as "FIXE" | "POURCENTAGE" }))}
                            className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
                            style={{
                              background: typeForm.report_mode_plafond === opt.val ? "hsl(var(--accent))" : "hsl(var(--background))",
                              color: typeForm.report_mode_plafond === opt.val ? "white" : "hsl(var(--foreground))",
                              borderColor: typeForm.report_mode_plafond === opt.val ? "hsl(var(--accent))" : "hsl(var(--border))",
                            }}>
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </Field>
                    {typeForm.report_mode_plafond === "FIXE" ? (
                      <Field label="Plafond (jours)" className="col-span-2">
                        <input className={inputCls} style={inputStyle} type="number" min={0}
                          placeholder="Ex: 10"
                          value={typeForm.report_plafond_jours ?? ""}
                          onChange={e => setTypeForm(f => ({ ...f, report_plafond_jours: e.target.value ? parseInt(e.target.value) : null }))} />
                      </Field>
                    ) : (
                      <Field label="Taux (%)" className="col-span-2">
                        <div className="flex items-center gap-2">
                          <input className={inputCls} style={{ ...inputStyle, width: "80px" }} type="number" min={0} max={100}
                            placeholder="Ex: 50"
                            value={typeForm.report_plafond_pct ?? ""}
                            onChange={e => setTypeForm(f => ({ ...f, report_plafond_pct: e.target.value ? parseInt(e.target.value) : null }))} />
                          <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>% du droit annuel</span>
                          {typeForm.report_plafond_pct != null && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                              style={{ background: "hsl(var(--accent) / 0.12)", color: "hsl(var(--accent))" }}>
                              Ex : {Math.round((typeForm.droit_legal_jours ?? 0) * typeForm.report_plafond_pct / 100)}j sur {typeForm.droit_legal_jours ?? 0}j légaux
                            </span>
                          )}
                        </div>
                      </Field>
                    )}
                  </div>
                </div>

                {/* Date butoir de consommation */}
                <div className="rounded-xl border overflow-hidden" style={{ borderColor: "hsl(var(--accent) / 0.2)" }}>
                  <div className="flex items-center gap-2 px-4 py-2.5"
                    style={{ background: "hsl(var(--accent) / 0.07)", borderBottom: "1px solid hsl(var(--accent) / 0.15)" }}>
                    <Calendar size={13} style={{ color: "hsl(var(--accent))" }} />
                    <span className="text-xs font-semibold" style={{ color: "hsl(var(--accent))" }}>
                      Date butoir de consommation du reliquat
                    </span>
                  </div>
                  <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Field label="Type de butoir" className="col-span-2">
                      <div className="flex gap-2">
                        {[
                          { val: "DELAI", label: "Délai (en mois)" },
                          { val: "DATE_FIXE", label: "Date fixe (JJ/MM)" },
                        ].map(opt => (
                          <button key={opt.val} type="button"
                            onClick={() => setTypeForm(f => ({ ...f, report_type_butoir: opt.val as "DELAI" | "DATE_FIXE" }))}
                            className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
                            style={{
                              background: typeForm.report_type_butoir === opt.val ? "hsl(var(--accent))" : "hsl(var(--background))",
                              color: typeForm.report_type_butoir === opt.val ? "white" : "hsl(var(--foreground))",
                              borderColor: typeForm.report_type_butoir === opt.val ? "hsl(var(--accent))" : "hsl(var(--border))",
                            }}>
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </Field>
                    {typeForm.report_type_butoir === "DELAI" ? (
                      <Field label="Délai après début exercice (mois)" className="col-span-2">
                        <div className="flex items-center gap-2">
                          <input className={inputCls} style={{ ...inputStyle, width: "80px" }} type="number" min={1} max={12}
                            placeholder="Ex: 3"
                            value={typeForm.report_delai_consommation_mois ?? ""}
                            onChange={e => setTypeForm(f => ({ ...f, report_delai_consommation_mois: e.target.value ? parseInt(e.target.value) : null }))} />
                          <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>mois</span>
                          {typeForm.report_delai_consommation_mois != null && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                              style={{ background: "hsl(var(--accent) / 0.12)", color: "hsl(var(--accent))" }}>
                              Jusqu'au mois {typeForm.report_delai_consommation_mois} du nouvel exercice
                            </span>
                          )}
                        </div>
                      </Field>
                    ) : (
                      <Field label="Date fixe (JJ/MM)" className="col-span-2">
                        <div className="flex items-center gap-2">
                          <input className={inputCls} style={{ ...inputStyle, width: "100px" }}
                            placeholder="31/03"
                            maxLength={5}
                            value={typeForm.report_date_butoir ?? ""}
                            onChange={e => {
                              let v = e.target.value.replace(/[^0-9/]/g, "");
                              if (v.length === 2 && !v.includes("/")) v = v + "/";
                              setTypeForm(f => ({ ...f, report_date_butoir: v || null }));
                            }} />
                          <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>de l'exercice suivant</span>
                        </div>
                        <p className="text-[10px] mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                          Ex: 31/03 = 31 mars de l'exercice suivant
                        </p>
                      </Field>
                    )}
                  </div>
                </div>

                {/* Action sur le solde restant */}
                <div className="rounded-xl border overflow-hidden" style={{ borderColor: "hsl(var(--accent) / 0.2)" }}>
                  <div className="flex items-center gap-2 px-4 py-2.5"
                    style={{ background: "hsl(var(--accent) / 0.07)", borderBottom: "1px solid hsl(var(--accent) / 0.15)" }}>
                    <Ban size={13} style={{ color: "hsl(var(--accent))" }} />
                    <span className="text-xs font-semibold" style={{ color: "hsl(var(--accent))" }}>
                      Action sur le solde restant à la date butoir
                    </span>
                  </div>
                  <div className="p-4">
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { val: "PERTE", label: "Perte définitive", icon: <Ban size={14} />, desc: "Les jours non consommés sont perdus définitivement.", color: "#EF4444" },
                        { val: "REPORT", label: "Re-report", icon: <RotateCcw size={14} />, desc: "Les jours restants sont à nouveau reportés sur le prochain exercice.", color: "#6366F1" },
                        { val: "PAIEMENT", label: "Paiement", icon: <CreditCard size={14} />, desc: "Les jours restants sont payés au collaborateur.", color: "#22C55E" },
                      ].map(opt => {
                        const isSelected = typeForm.report_action_solde_restant === opt.val;
                        return (
                          <button key={opt.val} type="button"
                            onClick={() => setTypeForm(f => ({ ...f, report_action_solde_restant: opt.val as "PERTE" | "REPORT" | "PAIEMENT" }))}
                            className="flex flex-col items-center gap-2 p-3 rounded-xl border transition-all"
                            style={{
                              background: isSelected ? `${opt.color}15` : "hsl(var(--background))",
                              borderColor: isSelected ? opt.color : "hsl(var(--border))",
                              boxShadow: isSelected ? `0 0 0 1px ${opt.color}40` : "none",
                            }}>
                            <div className="w-8 h-8 rounded-full flex items-center justify-center"
                              style={{ background: isSelected ? `${opt.color}20` : "hsl(var(--muted) / 0.4)", color: isSelected ? opt.color : "hsl(var(--muted-foreground))" }}>
                              {opt.icon}
                            </div>
                            <span className="text-xs font-semibold" style={{ color: isSelected ? opt.color : "hsl(var(--foreground))" }}>
                              {opt.label}
                            </span>
                            <p className="text-[10px] text-center leading-tight" style={{ color: "hsl(var(--muted-foreground))" }}>
                              {opt.desc}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Cumul multi-exercices */}
                <div className="rounded-xl border overflow-hidden" style={{ borderColor: "hsl(var(--accent) / 0.2)" }}>
                  <div className="flex items-center gap-2 px-4 py-2.5"
                    style={{ background: "hsl(var(--accent) / 0.07)", borderBottom: "1px solid hsl(var(--accent) / 0.15)" }}>
                    <RotateCcw size={13} style={{ color: "hsl(var(--accent))" }} />
                    <span className="text-xs font-semibold" style={{ color: "hsl(var(--accent))" }}>
                      Cumul sur plusieurs exercices
                    </span>
                  </div>
                  <div className="p-4 flex flex-col gap-3">
                    <Toggle
                      value={typeForm.report_cumul_autorise}
                      onChange={v => setTypeForm(f => ({ ...f, report_cumul_autorise: v }))}
                      label="Autoriser le cumul du reliquat sur plusieurs exercices consécutifs"
                    />
                    {typeForm.report_cumul_autorise && (
                      <Field label="Nombre maximum d'exercices de cumul">
                        <div className="flex items-center gap-2">
                          <input className={inputCls} style={{ ...inputStyle, width: "80px" }} type="number" min={1}
                            placeholder="∞"
                            value={typeForm.report_cumul_max_exercices ?? ""}
                            onChange={e => setTypeForm(f => ({ ...f, report_cumul_max_exercices: e.target.value ? parseInt(e.target.value) : null }))} />
                          <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                            {typeForm.report_cumul_max_exercices == null ? "(illimité si vide)" : "exercice(s)"}
                          </span>
                        </div>
                      </Field>
                    )}
                  </div>
                </div>

                {/* Condition / commentaire libre */}
                <Field label="Conditions particulières au report">
                  <textarea className={inputCls + " resize-none"} style={{ ...inputStyle, minHeight: 60 }} rows={2}
                    placeholder="Ex: Report autorisé uniquement pour les cadres, après validation RH, dans la limite du cumul légal..."
                    value={typeForm.report_condition ?? ""}
                    onChange={e => setTypeForm(f => ({ ...f, report_condition: e.target.value || null }))} />
                </Field>
              </>
            )}

            {!typeForm.report_autorise && (
              <div className="flex flex-col items-center justify-center py-10 gap-3"
                style={{ color: "hsl(var(--muted-foreground))" }}>
                <Ban size={36} strokeWidth={1} />
                <p className="text-sm font-medium">Report non autorisé</p>
                <p className="text-xs text-center max-w-xs">
                  Activez l'option ci-dessus pour paramétrer les règles de report des reliquats pour ce type de congé.
                </p>
              </div>
            )}

            {/* ── Séparateur ── */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px" style={{ background: "hsl(var(--border))" }} />
              <span className="text-[10px] font-medium px-2" style={{ color: "hsl(var(--muted-foreground))" }}>CONTRÔLE SOLDE</span>
              <div className="flex-1 h-px" style={{ background: "hsl(var(--border))" }} />
            </div>

            {/* RG-CONGE-RELIQUAT-INTERDIT-01 (Adil DAIA): Interdire le dépassement du solde */}
            <div className="flex items-center gap-3 p-3 rounded-xl border"
              style={{
                background: typeForm.interdit_reliquat ? "hsl(0 72% 51% / 0.06)" : "hsl(var(--muted) / 0.3)",
                borderColor: typeForm.interdit_reliquat ? "hsl(0 72% 51% / 0.3)" : "hsl(var(--border))",
              }}>
              <Ban size={16} style={{ color: typeForm.interdit_reliquat ? "hsl(0 72% 51%)" : "hsl(var(--muted-foreground))" }} />
              <div className="flex-1">
                <p className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                  Solde requis pour la demande
                </p>
                <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                  RG-CONGE-RELIQUAT-INTERDIT-01 : Le collaborateur doit avoir un solde ≥ à la durée demandée, sinon la demande est bloquée.
                </p>
              </div>
              <Toggle
                value={typeForm.interdit_reliquat}
                onChange={v => setTypeForm(f => ({ ...f, interdit_reliquat: v }))}
                label={typeForm.interdit_reliquat ? "Activé" : "Désactivé"}
              />
            </div>

            {typeForm.interdit_reliquat && (
              <div className="px-4 py-3 rounded-lg text-xs"
                style={{ background: "hsl(0 72% 51% / 0.08)", border: "1px solid hsl(0 72% 51% / 0.2)", color: "hsl(var(--muted-foreground))" }}>
                <strong>Règle active :</strong> Le système bloquera toute demande de congé si le collaborateur ne dispose pas d'un solde suffisant (solde restant ≥ jours demandés).
              </div>
            )}
          </div>
        )}

        {/* ─── Tab: Reconduction & Reprise ────────────────────────────────────────
            RG-CONGE-RECOND-01 (Adil DAIA):
            Paramétrage de la reconduction du congé :
            - Autorisation de reconduction (on/off)
            - Nombre maximum de reconductions autorisées
            - Durée en jours de chaque reconduction
            
            RG-CONGE-REPRISE-01 (Adil DAIA):
            Paramétrage de la reprise obligatoire :
            - Si activé, le système alerte lorsque des collaborateurs en congé
              arrivent à la date de fin sans qu'une reprise soit enregistrée.
        ─────────────────────────────────────────────────────────────────────── */}
        {activeTab === "reconduction" && (
          <div className="flex flex-col gap-4">

            {/* ── Section Reconduction ── */}
            <div className="flex items-center gap-3 p-3 rounded-xl border"
              style={{
                background: typeForm.reconduction_autorisee ? "hsl(var(--accent) / 0.06)" : "hsl(var(--muted) / 0.3)",
                borderColor: typeForm.reconduction_autorisee ? "hsl(var(--accent) / 0.3)" : "hsl(var(--border))",
              }}>
              <RefreshCw size={16} style={{ color: typeForm.reconduction_autorisee ? "hsl(var(--accent))" : "hsl(var(--muted-foreground))" }} />
              <div className="flex-1">
                <p className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                  Autoriser la reconduction
                </p>
                <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                  RG-CONGE-RECOND-01 : Permet de prolonger un congé approuvé par des périodes successives.
                </p>
              </div>
              <Toggle
                value={typeForm.reconduction_autorisee}
                onChange={v => setTypeForm(f => ({ ...f, reconduction_autorisee: v }))}
                label={typeForm.reconduction_autorisee ? "Activée" : "Désactivée"}
              />
            </div>

            {typeForm.reconduction_autorisee && (
              <div className="rounded-xl border overflow-hidden" style={{ borderColor: "hsl(var(--accent) / 0.2)" }}>
                <div className="flex items-center gap-2 px-4 py-2.5"
                  style={{ background: "hsl(var(--accent) / 0.07)", borderBottom: "1px solid hsl(var(--accent) / 0.15)" }}>
                  <RefreshCw size={13} style={{ color: "hsl(var(--accent))" }} />
                  <span className="text-xs font-semibold" style={{ color: "hsl(var(--accent))" }}>
                    Paramètres de reconduction
                  </span>
                </div>
                <div className="p-4 grid grid-cols-2 gap-4">
                  <Field label="Nombre maximum de reconductions">
                    <div className="flex items-center gap-2">
                      <input className={inputCls} style={{ ...inputStyle, width: "100px" }} type="number" min={1}
                        placeholder="∞"
                        value={typeForm.reconduction_max_nombre ?? ""}
                        onChange={e => setTypeForm(f => ({ ...f, reconduction_max_nombre: e.target.value ? parseInt(e.target.value) : null }))} />
                      <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                        {typeForm.reconduction_max_nombre == null ? "(illimité si vide)" : "reconduction(s)"}
                      </span>
                    </div>
                  </Field>
                  <Field label="Durée par reconduction (jours)">
                    <div className="flex items-center gap-2">
                      <input className={inputCls} style={{ ...inputStyle, width: "100px" }} type="number" min={1}
                        placeholder="Ex: 30"
                        value={typeForm.reconduction_duree_jours ?? ""}
                        onChange={e => setTypeForm(f => ({ ...f, reconduction_duree_jours: e.target.value ? parseInt(e.target.value) : null }))} />
                      <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>jours</span>
                    </div>
                  </Field>
                </div>
              </div>
            )}

            {!typeForm.reconduction_autorisee && (
              <div className="flex flex-col items-center justify-center py-6 gap-2"
                style={{ color: "hsl(var(--muted-foreground))" }}>
                <RefreshCw size={28} strokeWidth={1} />
                <p className="text-xs text-center max-w-xs">
                  Activez la reconduction pour définir les règles de prolongation du congé.
                </p>
              </div>
            )}

            {/* ── Séparateur ── */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px" style={{ background: "hsl(var(--border))" }} />
              <span className="text-[10px] font-medium px-2" style={{ color: "hsl(var(--muted-foreground))" }}>REPRISE</span>
              <div className="flex-1 h-px" style={{ background: "hsl(var(--border))" }} />
            </div>

            {/* ── Section Reprise obligatoire ── */}
            <div className="flex items-center gap-3 p-3 rounded-xl border"
              style={{
                background: typeForm.reprise_obligatoire ? "hsl(45 100% 50% / 0.06)" : "hsl(var(--muted) / 0.3)",
                borderColor: typeForm.reprise_obligatoire ? "hsl(45 100% 50% / 0.3)" : "hsl(var(--border))",
              }}>
              <AlertTriangle size={16} style={{ color: typeForm.reprise_obligatoire ? "hsl(45 100% 35%)" : "hsl(var(--muted-foreground))" }} />
              <div className="flex-1">
                <p className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                  Date de reprise obligatoire
                </p>
                <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                  RG-CONGE-REPRISE-01 : Si activé, le système génère une alerte pour les collaborateurs en congé
                  arrivant à la date de fin et n'ayant pas enregistré de date de reprise effective.
                </p>
              </div>
              <Toggle
                value={typeForm.reprise_obligatoire}
                onChange={v => setTypeForm(f => ({ ...f, reprise_obligatoire: v }))}
                label={typeForm.reprise_obligatoire ? "Obligatoire" : "Non requise"}
              />
            </div>

            {typeForm.reprise_obligatoire && (
              <div className="px-4 py-3 rounded-lg text-xs"
                style={{ background: "hsl(45 100% 50% / 0.08)", border: "1px solid hsl(45 100% 50% / 0.2)", color: "hsl(var(--muted-foreground))" }}>
                <strong style={{ color: "hsl(45 100% 35%)" }}>📋 Comportement :</strong>{" "}
                Lorsqu'un congé de ce type arrive à sa date de fin d'absence, le système vérifie si une
                <em> date de reprise effective</em> a été saisie sur la demande. Si non, une notification
                d'alerte est générée pour les gestionnaires RH et le manager concerné.
              </div>
            )}

          </div>
        )}

        {/* ─── Tab: Acquisition ──────────────────────────────────────────────── */}
        {activeTab === "acquisition" && (
          <div className="flex flex-col gap-4">

            {/* Périodicité */}
            <div className="rounded-xl border p-4" style={{ borderColor: "hsl(var(--border))" }}>
              <p className="text-xs font-semibold mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>
                PÉRIODICITÉ D'ACQUISITION
              </p>
              <div className="flex gap-2 flex-wrap">
                {(["MENSUEL", "TRIMESTRIEL", "SEMESTRIEL", "ANNUEL"] as const).map(p => (
                  <button key={p} type="button"
                    onClick={() => setTypeForm(f => ({ ...f, periodicite_acquisition: p }))}
                    className="px-3 py-1.5 rounded-full text-xs font-medium border transition-all"
                    style={{
                      background: typeForm.periodicite_acquisition === p ? "hsl(var(--accent))" : "transparent",
                      color: typeForm.periodicite_acquisition === p ? "white" : "hsl(var(--muted-foreground))",
                      borderColor: typeForm.periodicite_acquisition === p ? "hsl(var(--accent))" : "hsl(var(--border))",
                    }}>
                    {p === "MENSUEL" ? "Mensuelle (1/12 par mois)"
                      : p === "TRIMESTRIEL" ? "Trimestrielle"
                      : p === "SEMESTRIEL" ? "Semestrielle"
                      : "Annuelle (tout d'un coup)"}
                  </button>
                ))}
              </div>
            </div>

            {/* Règles prorata */}
            <div className="rounded-xl border p-4" style={{ borderColor: "hsl(var(--border))" }}>
              <p className="text-xs font-semibold mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>
                RÈGLES DE PRORATA
              </p>
              <div className="flex flex-col gap-3">
                {[
                  { field: "prorata_entree",        label: "Prorata à l'entrée",         desc: "Droits calculés depuis la date d'embauche en cours de période" },
                  { field: "prorata_sortie",         label: "Prorata à la sortie",         desc: "Droits acquis jusqu'à la date de départ" },
                  { field: "prorata_temps_partiel",  label: "Prorata temps partiel",       desc: "Droit × taux de temps de travail du collaborateur" },
                  { field: "absence_deductible",     label: "Absences déductibles",        desc: "Certaines absences réduisent les droits acquis" },
                ].map(row => (
                  <label key={row.field} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                    <input type="checkbox"
                      checked={!!(typeForm as any)[row.field]}
                      onChange={() => setTypeForm(f => ({ ...f, [row.field]: !(f as any)[row.field] }))} />
                    <span>
                      <span className="text-sm" style={{ color: "hsl(var(--foreground))" }}>{row.label}</span>
                      <span className="text-xs ml-2" style={{ color: "hsl(var(--muted-foreground))" }}>— {row.desc}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Arrondi */}
            <div className="rounded-xl border p-4" style={{ borderColor: "hsl(var(--border))" }}>
              <p className="text-xs font-semibold mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>
                RÈGLE D'ARRONDI
              </p>
              <div className="flex gap-2 flex-wrap">
                {([
                  { v: "SUPERIEUR",    l: "Supérieur",    d: "0.4j → 0.5j" },
                  { v: "MATHEMATIQUE", l: "Mathématique", d: "0.4j → 0j, 0.6j → 1j" },
                  { v: "INFERIEUR",    l: "Inférieur",    d: "0.9j → 0.5j" },
                ] as const).map(a => (
                  <button key={a.v} type="button"
                    onClick={() => setTypeForm(f => ({ ...f, arrondi_acquisition: a.v }))}
                    className="px-3 py-1.5 rounded-full text-xs font-medium border transition-all"
                    style={{
                      background: typeForm.arrondi_acquisition === a.v ? "hsl(var(--accent))" : "transparent",
                      color: typeForm.arrondi_acquisition === a.v ? "white" : "hsl(var(--muted-foreground))",
                      borderColor: typeForm.arrondi_acquisition === a.v ? "hsl(var(--accent))" : "hsl(var(--border))",
                    }}>
                    {a.l} <span style={{ opacity: .6 }}>({a.d})</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Déclencheurs de recalcul */}
            <div className="rounded-xl border p-4" style={{ borderColor: "hsl(var(--border))" }}>
              <p className="text-xs font-semibold mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>
                DÉCLENCHEURS DE RECALCUL AUTOMATIQUE
              </p>
              <div className="flex gap-2 flex-wrap">
                {[
                  { v: "ANNIVERSAIRE",             l: "Anniversaire d'entrée" },
                  { v: "CHANGEMENT_CATEGORIE",     l: "Changement de catégorie" },
                  { v: "CHANGEMENT_CONTRAT",       l: "Changement de contrat" },
                  { v: "CHANGEMENT_TEMPS_TRAVAIL", l: "Changement temps de travail" },
                ].map(evt => {
                  const evts: string[] = (typeForm as any).evenements_recalcul || [];
                  const active = evts.includes(evt.v);
                  return (
                    <button key={evt.v} type="button"
                      onClick={() => {
                        const current: string[] = (typeForm as any).evenements_recalcul || [];
                        const next = active ? current.filter((e: string) => e !== evt.v) : [...current, evt.v];
                        setTypeForm(f => ({ ...f, evenements_recalcul: next }));
                      }}
                      className="px-3 py-1.5 rounded-full text-xs font-medium border transition-all"
                      style={{
                        background: active ? "hsl(var(--accent))" : "transparent",
                        color: active ? "white" : "hsl(var(--muted-foreground))",
                        borderColor: active ? "hsl(var(--accent))" : "hsl(var(--border))",
                      }}>
                      {evt.l}
                    </button>
                  );
                })}
              </div>
              {((typeForm as any).evenements_recalcul || []).length === 0 && (
                <p className="text-xs mt-2" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Aucun recalcul automatique — les droits ne changent qu'à la mise à jour manuelle.
                </p>
              )}
            </div>

          </div>
        )}

        {/* ─── Tab: International 🌍 ───────────────────────────────────────── */}
        {activeTab === "international" && (
          <div className="flex flex-col gap-5">

            {/* Bandeau info */}
            <div className="flex items-start gap-3 rounded-xl p-4"
              style={{ background: "hsl(210 80% 97%)", border: "0.5px solid hsl(210 70% 80%)" }}>
              <span style={{ fontSize: "calc(20px * var(--font-scale))" }}>🌍</span>
              <div>
                <p className="text-sm font-semibold" style={{ color: "hsl(210 70% 30%)" }}>
                  Paramétrage International
                </p>
                <p className="text-xs mt-0.5" style={{ color: "hsl(210 60% 45%)" }}>
                  Ces paramètres permettent d'adapter ce type de congé aux législations étrangères
                  (FMLA USA, sabbatiques, Buy-Back, temps partiel FTE…).
                </p>
              </div>
            </div>

            {/* RG-CONGE-WINDOW-01 : Fenêtre temporelle */}
            <div className="rounded-xl border p-4" style={{ borderColor: "hsl(var(--border))" }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-bold px-2 py-0.5 rounded font-mono"
                  style={{ background: "hsl(var(--accent)/0.1)", color: "hsl(var(--accent))" }}>
                  RG-CONGE-WINDOW-01
                </span>
                <p className="text-xs font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                  Fenêtre de validité (Time Window)
                </p>
              </div>
              <p className="text-xs mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>
                Définit la période sur laquelle les droits sont calculés et comptabilisés.
                Ex : FMLA US = 12 mois glissants en arrière.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                {([
                  { v: "ANNEE_CIVILE",  l: "Année civile",     d: "1 jan → 31 déc" },
                  { v: "ANNEE_FISCALE", l: "Année fiscale",    d: "Selon exercice société" },
                  { v: "ANNIVERSAIRE",  l: "Anniversaire",     d: "Date embauche → +12 mois" },
                  { v: "GLISSANT",      l: "Fenêtre glissante",d: "N mois en arrière/avant" },
                ] as const).map(opt => (
                  <button key={opt.v} type="button"
                    onClick={() => setTypeForm(f => ({ ...f, window_mode: opt.v }))}
                    className="px-3 py-2 rounded-lg text-xs border transition-all text-left"
                    style={{
                      background: typeForm.window_mode === opt.v ? "hsl(var(--accent))" : "hsl(var(--muted)/0.3)",
                      color: typeForm.window_mode === opt.v ? "white" : "hsl(var(--foreground))",
                      borderColor: typeForm.window_mode === opt.v ? "hsl(var(--accent))" : "hsl(var(--border))",
                    }}>
                    <div className="font-semibold">{opt.l}</div>
                    <div className="text-[10px] mt-0.5 opacity-75">{opt.d}</div>
                  </button>
                ))}
              </div>
              {typeForm.window_mode === "GLISSANT" && (
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <Field label="Durée de la fenêtre (mois)">
                    <input className={inputCls} style={inputStyle} type="number" min={1} max={60}
                      value={typeForm.window_duree_mois ?? ""}
                      placeholder="12"
                      onChange={e => setTypeForm(f => ({ ...f, window_duree_mois: e.target.value ? parseInt(e.target.value) : null }))} />
                  </Field>
                  <Field label="Sens de la fenêtre">
                    <select className={inputCls} style={inputStyle}
                      value={typeForm.window_sens ?? "BACKWARD"}
                      onChange={e => setTypeForm(f => ({ ...f, window_sens: e.target.value as any }))}>
                      <option value="BACKWARD">⬅ En arrière (Rolling backward) — ex: FMLA</option>
                      <option value="FORWARD">➡ En avant (Rolling forward)</option>
                    </select>
                  </Field>
                </div>
              )}
            </div>

            {/* RG-CONGE-ROLLOVER-01 : Politique de fin de période */}
            <div className="rounded-xl border p-4" style={{ borderColor: "hsl(var(--border))" }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-bold px-2 py-0.5 rounded font-mono"
                  style={{ background: "hsl(var(--accent)/0.1)", color: "hsl(var(--accent))" }}>
                  RG-CONGE-ROLLOVER-01
                </span>
                <p className="text-xs font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                  Politique de fin de période (Rollover / Buy-Back)
                </p>
              </div>
              <p className="text-xs mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>
                Définit ce qui arrive aux jours non consommés en fin de période.
                Complète les règles de report configurées dans l'onglet "Report & Reliquats".
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                {([
                  { v: "PERTE",          l: "Perte",           d: "Use-it-or-lose-it (USA/UK)", icon: "🗑" },
                  { v: "REPORT_LIMITE",  l: "Report limité",   d: "Avec plafond + péremption",  icon: "↻" },
                  { v: "TRANSFERT_CET",  l: "Transfert CET",   d: "Compte Épargne Temps (FR)",  icon: "🏦" },
                  { v: "RACHAT_PAIE",    l: "Rachat en paie",  d: "Buy-back (USA/Canada)",       icon: "💰" },
                ] as const).map(opt => (
                  <button key={opt.v} type="button"
                    onClick={() => setTypeForm(f => ({ ...f, rollover_politique: opt.v }))}
                    className="px-3 py-2 rounded-lg text-xs border transition-all text-left"
                    style={{
                      background: typeForm.rollover_politique === opt.v ? "hsl(var(--accent))" : "hsl(var(--muted)/0.3)",
                      color: typeForm.rollover_politique === opt.v ? "white" : "hsl(var(--foreground))",
                      borderColor: typeForm.rollover_politique === opt.v ? "hsl(var(--accent))" : "hsl(var(--border))",
                    }}>
                    <div className="font-semibold">{opt.icon} {opt.l}</div>
                    <div className="text-[10px] mt-0.5 opacity-75">{opt.d}</div>
                  </button>
                ))}
              </div>
              {typeForm.rollover_politique === "RACHAT_PAIE" && (
                <div className="grid grid-cols-3 gap-3 mt-2 p-3 rounded-lg"
                  style={{ background: "hsl(var(--muted)/0.3)" }}>
                  <Field label="Taux de rachat (% salaire journalier)">
                    <input className={inputCls} style={inputStyle} type="number" min={0} max={200} step={0.01}
                      value={typeForm.rollover_taux_rachat_pct ?? ""}
                      placeholder="100"
                      onChange={e => setTypeForm(f => ({ ...f, rollover_taux_rachat_pct: e.target.value ? parseFloat(e.target.value) : null }))} />
                  </Field>
                  <Field label="Plafond jours rachetables / exercice">
                    <input className={inputCls} style={inputStyle} type="number" min={0}
                      value={typeForm.rollover_plafond_jours_rachat ?? ""}
                      placeholder="5"
                      onChange={e => setTypeForm(f => ({ ...f, rollover_plafond_jours_rachat: e.target.value ? parseInt(e.target.value) : null }))} />
                  </Field>
                  <Field label="Code rubrique de paie">
                    <input className={inputCls} style={inputStyle}
                      value={typeForm.rollover_code_rubrique_paie ?? ""}
                      placeholder="EX: RUB_RACHAT_CP"
                      onChange={e => setTypeForm(f => ({ ...f, rollover_code_rubrique_paie: e.target.value || null }))} />
                  </Field>
                </div>
              )}
            </div>

            {/* RG-CONGE-LIMIT-01 : Limites carrière */}
            <div className="rounded-xl border p-4" style={{ borderColor: "hsl(var(--border))" }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-bold px-2 py-0.5 rounded font-mono"
                  style={{ background: "hsl(var(--accent)/0.1)", color: "hsl(var(--accent))" }}>
                  RG-CONGE-LIMIT-01
                </span>
                <p className="text-xs font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                  Limites sur la carrière (Lifetime Limits)
                </p>
              </div>
              <p className="text-xs mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>
                Bride le droit sur toute la durée du contrat dans l'entreprise.
                Ex : Congé Pèlerinage (1 occurrence/carrière), Sabbatique (1 tous les 5 ans), Parental Leave USA.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Field label="Jours max sur carrière" className="">
                  <input className={inputCls} style={inputStyle} type="number" min={0}
                    value={typeForm.nb_jours_max_carriere ?? ""}
                    placeholder="Illimité"
                    onChange={e => setTypeForm(f => ({ ...f, nb_jours_max_carriere: e.target.value ? parseInt(e.target.value) : null }))} />
                </Field>
                <Field label="Occurrences max sur carrière">
                  <input className={inputCls} style={inputStyle} type="number" min={0}
                    value={typeForm.nb_occurrences_max_carriere ?? ""}
                    placeholder="Illimité"
                    onChange={e => setTypeForm(f => ({ ...f, nb_occurrences_max_carriere: e.target.value ? parseInt(e.target.value) : null }))} />
                </Field>
                <Field label="Carence entre 2 prises (mois)">
                  <input className={inputCls} style={inputStyle} type="number" min={0}
                    value={typeForm.carence_mois_entre_prises ?? ""}
                    placeholder="Ex: 60 (pèlerinage)"
                    onChange={e => setTypeForm(f => ({ ...f, carence_mois_entre_prises: e.target.value ? parseInt(e.target.value) : null }))} />
                </Field>
                <Field label="Ancienneté min requise (ans)">
                  <input className={inputCls} style={inputStyle} type="number" min={0}
                    value={typeForm.anciennete_min_ans_carriere ?? ""}
                    placeholder="Ex: 5 (sabbatique)"
                    onChange={e => setTypeForm(f => ({ ...f, anciennete_min_ans_carriere: e.target.value ? parseInt(e.target.value) : null }))} />
                </Field>
              </div>
              {(typeForm.nb_jours_max_carriere != null || typeForm.nb_occurrences_max_carriere != null || typeForm.carence_mois_entre_prises != null) && (
                <div className="mt-3 px-3 py-2 rounded-lg text-xs"
                  style={{ background: "hsl(45 100% 50% / 0.08)", border: "1px solid hsl(45 100% 50% / 0.2)", color: "hsl(45 100% 30%)" }}>
                  ⚠ Ces limites nécessitent que l'historique de carrière soit complet en base pour être vérifiées correctement.
                </div>
              )}
            </div>

            {/* RG-CONGE-PRORATA-01 : Proratisation FTE */}
            <div className="rounded-xl border p-4" style={{ borderColor: "hsl(var(--border))" }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-bold px-2 py-0.5 rounded font-mono"
                  style={{ background: "hsl(var(--accent)/0.1)", color: "hsl(var(--accent))" }}>
                  RG-CONGE-PRORATA-01
                </span>
                <p className="text-xs font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                  Proratisation FTE (Équivalent Temps Plein)
                </p>
              </div>
              <p className="text-xs mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>
                En Europe, les droits des salariés à temps partiel doivent être proratisés selon leur taux d'activité.
                Un salarié à 50% FTE n'acquiert que 1,25 j/mois au lieu de 2,5.
              </p>
              <div className="flex items-center justify-between mb-3">
                <Toggle
                  value={typeForm.prorata_fte_actif}
                  onChange={v => setTypeForm(f => ({ ...f, prorata_fte_actif: v }))}
                  label={typeForm.prorata_fte_actif ? "Proratisation FTE activée" : "Proratisation FTE désactivée"}
                />
              </div>
              {typeForm.prorata_fte_actif && (
                <div className="grid grid-cols-2 gap-3 p-3 rounded-lg"
                  style={{ background: "hsl(var(--muted)/0.3)" }}>
                  <Field label="Mode de calcul FTE">
                    <div className="flex gap-2">
                      {([
                        { v: "LINEAIRE", l: "Linéaire", d: "Droits × FTE" },
                        { v: "PALIER",   l: "Par palier",d: "Tranches prédéfinies" },
                      ] as const).map(opt => (
                        <button key={opt.v} type="button"
                          onClick={() => setTypeForm(f => ({ ...f, prorata_fte_mode: opt.v }))}
                          className="flex-1 px-3 py-2 rounded-lg text-xs border transition-all"
                          style={{
                            background: typeForm.prorata_fte_mode === opt.v ? "hsl(var(--accent))" : "transparent",
                            color: typeForm.prorata_fte_mode === opt.v ? "white" : "hsl(var(--muted-foreground))",
                            borderColor: typeForm.prorata_fte_mode === opt.v ? "hsl(var(--accent))" : "hsl(var(--border))",
                          }}>
                          <div className="font-semibold">{opt.l}</div>
                          <div className="text-[10px] opacity-75">{opt.d}</div>
                        </button>
                      ))}
                    </div>
                  </Field>
                  <Field label="Seuil FTE minimum (ex: 0.2 = 20%)">
                    <input className={inputCls} style={inputStyle} type="number" min={0} max={1} step={0.05}
                      value={typeForm.prorata_fte_seuil_min ?? ""}
                      placeholder="0.2"
                      onChange={e => setTypeForm(f => ({ ...f, prorata_fte_seuil_min: e.target.value ? parseFloat(e.target.value) : null }))} />
                  </Field>
                  {typeForm.prorata_fte_mode === "LINEAIRE" && (
                    <div className="col-span-2 text-xs p-3 rounded-lg"
                      style={{ background: "hsl(142 70% 45% / 0.08)", color: "hsl(142 70% 30%)" }}>
                      <strong>Exemple :</strong> Droit légal = 25 j/an. Salarié à 60% FTE →{" "}
                      <strong>{(25 * 0.6).toFixed(1)} j/an</strong>.
                      Salarié à 80% FTE → <strong>{(25 * 0.8).toFixed(1)} j/an</strong>.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Badge nouveaux axes dans la liste */}
            <div className="rounded-xl border p-4"
              style={{ background: "hsl(var(--muted)/0.2)", borderColor: "hsl(var(--border))" }}>
              <p className="text-xs font-semibold mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>
                STATUT DE CONFIGURATION INTERNATIONALE
              </p>
              <div className="flex flex-wrap gap-2">
                {typeForm.window_mode && typeForm.window_mode !== "ANNEE_CIVILE" && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ background: "hsl(210 70% 90%)", color: "hsl(210 70% 30%)" }}>
                    🌐 Time Window : {typeForm.window_mode}
                  </span>
                )}
                {typeForm.rollover_politique && typeForm.rollover_politique !== "PERTE" && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ background: "hsl(142 60% 90%)", color: "hsl(142 60% 25%)" }}>
                    💰 Rollover : {typeForm.rollover_politique}
                  </span>
                )}
                {(typeForm.nb_jours_max_carriere != null || typeForm.nb_occurrences_max_carriere != null) && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ background: "hsl(38 92% 90%)", color: "hsl(38 92% 30%)" }}>
                    🔒 Lifetime Limit activé
                  </span>
                )}
                {typeForm.prorata_fte_actif && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ background: "hsl(280 60% 90%)", color: "hsl(280 60% 30%)" }}>
                    📊 Prorata FTE : {typeForm.prorata_fte_mode}
                  </span>
                )}
                {!typeForm.prorata_fte_actif && typeForm.window_mode === "ANNEE_CIVILE" && typeForm.rollover_politique === "PERTE" && typeForm.nb_jours_max_carriere == null && (
                  <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Aucun paramètre international configuré (mode par défaut Maroc/France)
                  </span>
                )}
              </div>
            </div>

          </div>
        )}

        <div className="flex gap-2 mt-4">
          <button onClick={saveType} disabled={saving}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold"
            style={{ background: "hsl(var(--accent))", color: "white" }}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
          <button onClick={() => { setPanel(null); setError(null); }}
            className="px-4 py-1.5 rounded-lg text-sm border"
            style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
            Annuler
          </button>
        </div>
      </div>
    );
  };

  // ─── Main render ──────────────────────────────────────────────────────────
  return (
    <>
    <div className="p-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl" style={{ background: "hsl(var(--accent) / 0.1)" }}>
            <Clock size={20} style={{ color: "hsl(var(--accent))" }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: "hsl(var(--foreground))" }}>Types de Congé</h1>
            <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
              Paramétrage des familles et types de congé • {types.length} type(s) configuré(s)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={openNewFamille}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors"
            style={{ borderColor: "hsl(var(--accent))", color: "hsl(var(--accent))" }}>
            <FolderOpen size={13} /> Famille
          </button>
          <button onClick={() => openNewType()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
            style={{ background: "hsl(var(--accent))", color: "white" }}>
            <Plus size={13} /> Type de congé
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
          style={{ background: "hsl(0 84% 55% / 0.1)", color: "hsl(0 84% 45%)", border: "1px solid hsl(0 84% 55% / 0.3)" }}>
          <AlertTriangle size={14} /> {error}
          <button onClick={() => setError(null)} className="ml-auto"><X size={14} /></button>
        </div>
      )}

      {/* Form panel */}
      {panel === "new_famille" || panel?.startsWith("edit_famille:") ? renderFamilleForm() : null}
      {panel === "new_type" || panel?.startsWith("edit_type:") ? renderTypeForm() : null}

      {/* Filtres */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
          <input className="w-full pl-8 pr-3 py-1.5 rounded-lg border text-sm outline-none"
            style={inputStyle}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher un type..." />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={() => setFilterFamille("all")}
            className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
            style={{
              background: filterFamille === "all" ? "hsl(var(--accent))" : "hsl(var(--muted) / 0.5)",
              color: filterFamille === "all" ? "white" : "hsl(var(--muted-foreground))",
            }}>
            Toutes
          </button>
          {/* RG-CONGE-COULEUR-01 (Adil DAIA): Boutons filtre avec couleur de famille */}
          {familles.map(f => {
            const color = f.couleur || "#6366F1";
            const isActive = filterFamille === f.code;
            return (
              <button key={f.code} onClick={() => setFilterFamille(f.code)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
                style={{
                  background: isActive ? color : hexToRgba(color, 0.1),
                  color: isActive ? "white" : color,
                  border: `1px solid ${hexToRgba(color, 0.3)}`,
                }}>
                <div className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: isActive ? "white" : color }} />
                {f.libelle}
              </button>
            );
          })}
        </div>
      </div>

      {/* Familles list (collapsed accordion) */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="animate-spin" style={{ color: "hsl(var(--accent))" }} />
        </div>
      ) : (
        <div className="space-y-3">
          {/* Familles section */}
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
            {/* Familles header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b"
              style={{ background: "hsl(var(--muted) / 0.3)", borderColor: "hsl(var(--border))" }}>
              <div className="flex items-center gap-2">
                <FolderOpen size={14} style={{ color: "hsl(var(--accent))" }} />
                <span className="text-xs font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                  Familles de Congé ({familles.length})
                </span>
              </div>
            </div>
            <div className="divide-y" style={{ borderColor: "hsl(var(--border))" }}>
              {familles.length === 0 ? (
                <p className="px-4 py-4 text-sm text-center" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune famille configurée</p>
              ) : familles.map(f => {
                const count = types.filter(t => t.code_famille === f.code).length;
                const isExpanded = expandedFamilles.has(f.code);
                const color = f.couleur || "#6366F1";
                return (
                  <div key={f.code}>
                    {/* RG-CONGE-COULEUR-01 (Adil DAIA): Bande de couleur gauche de la famille */}
                    <div className="flex items-center gap-3 px-4 py-2.5"
                      style={{
                        background: "hsl(var(--card))",
                        borderLeft: `4px solid ${color}`,
                      }}>
                      <button onClick={() => toggleFamille(f.code)} className="flex items-center gap-2 flex-1 text-left">
                        {isExpanded
                          ? <ChevronDown size={14} style={{ color: "hsl(var(--muted-foreground))" }} />
                          : <ChevronRight size={14} style={{ color: "hsl(var(--muted-foreground))" }} />}
                        {/* Pastille couleur */}
                        <div className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ background: color, boxShadow: `0 0 6px ${hexToRgba(color, 0.5)}` }} />
                        <span className="font-mono text-xs px-1.5 py-0.5 rounded"
                          style={{ background: hexToRgba(color, 0.12), color }}>{f.code}</span>
                        <span className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>{f.libelle}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full ml-1"
                          style={{ background: hexToRgba(color, 0.1), color }}>
                          {count} type(s)
                        </span>
                      </button>
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEditFamille(f)} className="p-1.5 rounded hover:bg-muted">
                          <Pencil size={11} style={{ color: "hsl(var(--muted-foreground))" }} />
                        </button>
                        <button onClick={() => deleteFamille(f.code)} className="p-1.5 rounded hover:bg-muted">
                          <Trash2 size={11} style={{ color: "hsl(0 84% 55%)" }} />
                        </button>
                      </div>
                    </div>
                    {isExpanded && f.description && (
                      <p className="px-10 py-1 text-xs" style={{ color: "hsl(var(--muted-foreground))", background: hexToRgba(color, 0.04), borderLeft: `4px solid ${color}` }}>
                        {f.description}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Types table */}
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b"
              style={{ background: "hsl(var(--muted) / 0.3)", borderColor: "hsl(var(--border))" }}>
              <FileText size={14} style={{ color: "hsl(var(--accent))" }} />
              <span className="text-xs font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                Types de Congé ({filteredTypes.length})
              </span>
              {/* Légende couleurs */}
              <div className="ml-auto flex items-center gap-2">
                {familles.filter(f => filteredTypes.some(t => t.code_famille === f.code)).map(f => (
                  <div key={f.code} className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full" style={{ background: f.couleur || "#6366F1" }} />
                    <span className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>{f.libelle}</span>
                  </div>
                ))}
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "hsl(var(--muted) / 0.2)", borderBottom: "1px solid hsl(var(--border))" }}>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>Code</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>Libellé</th>
                  {/* RG-CONGE-JOUR-01 (Adil DAIA): Colonne Type de jours */}
                  <th className="px-4 py-2.5 text-center text-xs font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>
                    <span className="flex items-center justify-center gap-1">
                      <CalendarDays size={11} />
                      Type de jours
                    </span>
                  </th>
                  <th className="px-4 py-2.5 text-center text-xs font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>Droit légal</th>
                  <th className="px-4 py-2.5 text-center text-xs font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>Statut</th>
                  <th className="px-4 py-2.5 w-24" />
                </tr>
              </thead>
              <tbody>
                {filteredTypes.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Aucun type de congé trouvé
                  </td></tr>
                ) : (
                  filterFamille === "all"
                    ? familles.flatMap(f => (typesByFamille[f.code] || []).map(t => renderTypeRow(t)))
                    : filteredTypes.filter(t => !t.code_type_conge_parent).map(t => renderTypeRow(t))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>

    {/* ── Dialog Duplication ─────────────────────────────────────────────── */}
    {duplicateSource && (
      <div className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ background: "rgba(0,0,0,0.4)" }}
        onClick={e => { if (e.target === e.currentTarget) setDuplicateSource(null); }}>
        <div className="rounded-xl border shadow-xl w-full max-w-md p-6"
          style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>

          {/* En-tête */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg" style={{ background: "hsl(var(--accent)/0.12)" }}>
                <Copy size={15} style={{ color: "hsl(var(--accent))" }} />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                  Dupliquer un type de congé
                </p>
                <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Source :&nbsp;
                  <span className="font-mono px-1 py-0.5 rounded text-[11px]"
                    style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                    {duplicateSource.code}
                  </span>
                  &nbsp;{duplicateSource.libelle}
                </p>
              </div>
            </div>
            <button onClick={() => setDuplicateSource(null)}
              className="p-1.5 rounded hover:bg-muted transition-colors">
              <X size={15} style={{ color: "hsl(var(--muted-foreground))" }} />
            </button>
          </div>

          {/* Récapitulatif des paramètres copiés */}
          <div className="rounded-lg p-3 mb-4 text-xs space-y-1"
            style={{ background: "hsl(var(--muted)/0.4)", color: "hsl(var(--muted-foreground))" }}>
            <p className="font-medium mb-1" style={{ color: "hsl(var(--foreground))" }}>
              Paramètres copiés intégralement :
            </p>
            <p>• Droits (légal, convention, particulier) et mode de calcul</p>
            <p>• Population cible et critères d'éligibilité</p>
            <p>• Workflow, justificatif, fractionnement, chevauchement</p>
            <p>• Règles d'acquisition, report et reconduction</p>
            <p className="mt-1 font-medium" style={{ color: "hsl(38 92% 50%)" }}>
              ⚠ Le type dupliqué sera créé en statut <strong>Inactif</strong> — activez-le manuellement après vérification.
            </p>
          </div>

          {/* Formulaire */}
          <div className="space-y-3 mb-4">
            <div>
              <label className="block text-xs font-medium mb-1"
                style={{ color: "hsl(var(--muted-foreground))" }}>
                Nouveau code <span style={{ color: "hsl(0 84% 55%)" }}>*</span>
              </label>
              <input
                type="text"
                value={duplicateCode}
                onChange={e => setDuplicateCode(e.target.value.toUpperCase())}
                placeholder="Ex. CNGP_CDD"
                className={inputCls}
                style={{ ...inputStyle, fontFamily: "monospace" }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1"
                style={{ color: "hsl(var(--muted-foreground))" }}>
                Nouveau libellé <span style={{ color: "hsl(0 84% 55%)" }}>*</span>
              </label>
              <input
                type="text"
                value={duplicateLibelle}
                onChange={e => setDuplicateLibelle(e.target.value)}
                placeholder="Ex. Congé Payé Annuel CDD"
                className={inputCls}
                style={inputStyle}
              />
            </div>
          </div>

          {/* Erreur */}
          {error && (
            <div className="flex items-center gap-2 rounded-lg px-3 py-2 mb-3 text-xs"
              style={{ background: "hsl(0 84% 55% / 0.08)", color: "hsl(0 84% 55%)" }}>
              <AlertTriangle size={13} />
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <button onClick={() => setDuplicateSource(null)}
              className="px-4 py-1.5 rounded-lg text-sm border transition-colors hover:bg-muted"
              style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
              Annuler
            </button>
            <button
              onClick={confirmDuplicateType}
              disabled={duplicating || !duplicateCode.trim() || !duplicateLibelle.trim()}
              className="px-4 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors"
              style={{
                background: "hsl(var(--accent))",
                color: "white",
                opacity: duplicating || !duplicateCode.trim() || !duplicateLibelle.trim() ? 0.5 : 1,
                cursor: duplicating ? "wait" : "pointer",
              }}>
              {duplicating
                ? <><Loader2 size={13} className="animate-spin" /> Duplication…</>
                : <><Copy size={13} /> Dupliquer</>}
            </button>
          </div>

        </div>
      </div>
    )}
    </>
  );
};

export default TypeCongesPage;
