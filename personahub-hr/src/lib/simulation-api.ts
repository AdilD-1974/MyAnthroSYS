/**
 * src/lib/simulation-api.ts — Client API du module Simulation.
 *
 * Aligné sur la vraie signature de src/lib/api.ts (vérifiée, plus une
 * hypothèse) :
 *   - api.get<T>(path)              — PAS de second argument "params" :
 *     toute query string doit être construite dans `path` lui-même, via
 *     le helper `qs()` déjà exporté par api.ts.
 *   - api.post/patch/put<T>(path, body) — `body` est OBLIGATOIRE (pas
 *     optionnel) même quand la requête n'a rien à envoyer : passer `{}`.
 *   - Toutes les méthodes renvoient directement T (jamais `{ data: T }`) —
 *     `response.json()` est retourné tel quel par `request()`.
 */
import { api, qs, postForBlob, API_BASE, tokenStore } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types (reflet fidèle des schémas Pydantic app/schemas/paie_simulation.py)
// ---------------------------------------------------------------------------
export type ModeSimulation = "BULLETIN" | "IMPACT" | "EMBAUCHE";
export type AttributSurcharge = "BASE" | "NOMBRE" | "TAUX" | "MONTANT";
export type ModeSurcharge = "AJOUT" | "FORCAGE";
export type ModeSurchargeRegime = "AJOUT" | "FORCAGE" | "POURCENTAGE";

export interface SurchargeRubrique {
  code_rubrique: string;
  attribut: AttributSurcharge;
  valeur: string; // Decimal → string côté JSON, converti à l'affichage
  mode: ModeSurcharge;
}

export interface SurchargeTable {
  table: string;
  colonne: string;
  valeur: string | number | boolean | null;
}

/**
 * RG-SIM-COTISATION-01 — surcharge de taux de cotisation et/ou affiliation
 * simulée à un régime. `code_regle` = code de la RÈGLE de cotisation (voir
 * RegimeSimulable.code), pas le code régime.
 */
export interface SurchargeRegime {
  code_regle: string;
  mode: ModeSurchargeRegime;
  taux_salarial: string | null;
  taux_patronal: string | null;
  forcer_affectation: boolean;
  valeur_bareme_taux_simulee: string | null;
}

export interface RegimeSimulable {
  code: string;
  libelle: string;
  code_regime: string | null;
}

export interface LigneBulletin {
  code_rubrique: string;
  libelle: string;
  code_type: string;
  base: string | null;
  nombre: string | null;
  taux: string | null;
  montant: string;
  montant_patronal: string | null;
  montant_cumul: string | null;
  nombre_cumul: string | null;
  sens: "GAIN" | "RETENUE" | "NEUTRE";
  est_cotisation: boolean;
  type_periodicite: string | null;
  date_valeur: string | null;
  texte: string | null;
  observation: string | null;
  [cle: string]: unknown; // le moteur peut renvoyer d'autres clés (ordre_calcul, frequence_raz, etc.)
}

export interface TotauxBulletin {
  total_brut: string;
  total_brut_imposable: string;
  total_gains: string;
  total_retenues: string;
  total_cot_salariale: string;
  total_cot_patronale: string;
  net_imposable: string;
  net_a_payer: string;
  cout_employeur: string;
}

export interface ResultatBulletin {
  bulletin_id: string | null;
  lot_id: string | null;
  collaborateur: { id: string | null; matricule: string; nom: string; prenom: string };
  periode: { id: string; annee: number; mois: number; libelle: string; code_plan: string | null };
  totaux: TotauxBulletin;
  lignes: LigneBulletin[];
  trace: Array<Record<string, unknown>>;
  messages: string[];
  a_erreur: boolean;
}

export interface LigneEcart {
  code_rubrique: string;
  libelle: string;
  avant: string;
  apres: string;
  delta: string;
  delta_pct: string | null;
  avant_patronal: string;
  apres_patronal: string;
  delta_patronal: string;
  delta_pct_patronal: string | null;
}

export interface ResultatImpact {
  avant: ResultatBulletin;
  apres: ResultatBulletin;
  ecarts: {
    lignes: LigneEcart[];
    totaux: Record<string, { avant: string; apres: string; delta: string }>;
  };
}

export interface ScenarioSimulation {
  id: string;
  type_simulation: ModeSimulation;
  nom: string;
  created_by: string;
  collaborateur_id: string | null;
  population_id: string | null;
  periode_id: string | null;
  periode_reference: Record<string, unknown>;
  hypotheses: Record<string, unknown>;
  resultat_calcule: Record<string, unknown> | null;
  partage: boolean;
  archive: boolean;
  date_application: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Lancement en masse par population (RG-SIM-POPULATION-01) — écran séparé
// SimulationPopulationPage.tsx. Lancement ASYNCHRONE (produit destiné à des
// clients pouvant dépasser 300 collaborateurs) : POST .../lancer renvoie un
// job_id immédiatement, l'écran interroge GET .../jobs/{id} en polling.
// Double vue TOUJOURS calculée ensemble : fusion (tous les scénarios
// combinés) + par_scenario (chaque scénario isolé, pour comparaison).
// ---------------------------------------------------------------------------
export interface PopulationSimulable {
  id: string;
  libelle: string;
  mode: string;
}

export interface ResultatScenarioIndividuel {
  scenario_id: string;
  scenario_nom: string;
  net_apres: string | null;
  ecart_net: string | null;
  cout_employeur_apres: string | null;
  ecart_cout_employeur: string | null;
}

export interface LigneResultatPopulation {
  collaborateur_id: string;
  matricule: string;
  nom: string;
  prenom: string;
  a_erreur: boolean;
  message_erreur: string | null;
  net_avant: string | null;
  cout_employeur_avant: string | null;
  net_apres_fusion: string | null;
  ecart_net_fusion: string | null;
  cout_employeur_apres_fusion: string | null;
  ecart_cout_employeur_fusion: string | null;
  par_scenario: ResultatScenarioIndividuel[];
  nb_periodes_calculees: number;
  note_projection: string | null;
}

export interface ResumeScenarioIndividuel {
  scenario_id: string;
  scenario_nom: string;
  net_apres: string;
  ecart_net: string | null;
  cout_employeur_apres: string;
  ecart_cout_employeur: string | null;
}

export interface SimulationPopulationResult {
  population_id: string | null;
  population_nom: string;
  periode_debut_id: string;
  periode_fin_id: string;
  periode_debut_libelle: string;
  periode_fin_libelle: string;
  nb_periodes: number;
  scenarios: { id: string; nom: string }[];
  nb_collaborateurs: number;
  nb_erreurs: number;
  // RG-SIM-POPULATION-10 : avec_ecarts contrôle UNIQUEMENT l'affichage des
  // écarts ci-dessous — toujours masqués (null) si false, sans exception.
  avec_ecarts: boolean;
  resume_fusion: {
    net_avant: string | null; net_apres: string; ecart_net: string | null;
    cout_employeur_avant: string | null; cout_employeur_apres: string; ecart_cout_employeur: string | null;
  };
  resume_par_scenario: ResumeScenarioIndividuel[];
  lignes: LigneResultatPopulation[];
}

export interface SimulationPopulationJobCree {
  job_id: string;
  nb_total: number;
}

export interface SimulationPopulationJobStatut {
  id: string;
  statut: "EN_ATTENTE" | "EN_COURS" | "TERMINE" | "ERREUR";
  population_nom: string;
  nb_total: number;
  nb_traites: number;
  erreur: string | null;
  resultat: SimulationPopulationResult | null;
  created_at: string;
  termine_at: string | null;
}

// ---------------------------------------------------------------------------
// Liste des bulletins simulés (RG-SIM-POPULATION-03) — un bulletin par
// (collaborateur, période), regroupable par UO/période/collaborateur, avec
// détail des rubriques au clic.
// ---------------------------------------------------------------------------
export type ModeRegroupementBulletins = "aucun" | "uo" | "periode" | "annee" | "mois" | "collaborateur";

export interface BulletinSimulePopulation {
  id: string;
  collaborateur_id: string;
  matricule: string;
  nom: string;
  prenom: string;
  unite_libelle: string | null;
  periode_id: string;
  periode_annee: number;
  periode_mois: number;
  a_erreur: boolean;
  message_erreur: string | null;
  exclu_projection: boolean;
  motif_exclusion: string | null;
  net_avant: string | null;
  net_apres_fusion: string | null;
  ecart_net_fusion: string | null;
  cout_employeur_avant: string | null;
  cout_employeur_apres_fusion: string | null;
  ecart_cout_employeur_fusion: string | null;
  // Situation du collaborateur — "avant" = état actuel réel, "après" = la
  // même valeur sauf si un scénario du job la surcharge (voir backend).
  type_contrat_avant?: string | null;
  type_contrat_apres?: string | null;
  college_avant?: string | null;
  college_apres?: string | null;
  categorie_professionnelle_avant?: string | null;
  categorie_professionnelle_apres?: string | null;
  code_emploi_avant?: string | null;
  libelle_emploi_avant?: string | null;
  code_emploi_apres?: string | null;
  libelle_emploi_apres?: string | null;
}

export interface BulletinSimuleDetail extends BulletinSimulePopulation {
  lignes_avant: LigneBulletin[] | null;
  lignes_apres_fusion: LigneBulletin[] | null;
  par_scenario: ResultatScenarioIndividuel[] | null;
  totaux_avant: TotauxBulletin | null;
  totaux_apres_fusion: TotauxBulletin | null;
}

export interface GroupeBulletinsPopulation {
  cle: string;
  cle_filtre: string;
  nb_bulletins: number;
  nb_erreurs: number;
  nb_exclus_projection: number;
  net_avant: string | null;
  net_apres_fusion: string;
  ecart_net_fusion: string | null;
  cout_employeur_avant: string | null;
  cout_employeur_apres_fusion: string;
  ecart_cout_employeur_fusion: string | null;
  // Situation du collaborateur — uniquement renseignée en mode
  // groupby="collaborateur" (une ligne = une personne) ; absente sinon.
  type_contrat_avant?: string | null;
  type_contrat_apres?: string | null;
  college_avant?: string | null;
  college_apres?: string | null;
  categorie_professionnelle_avant?: string | null;
  categorie_professionnelle_apres?: string | null;
  code_emploi_avant?: string | null;
  libelle_emploi_avant?: string | null;
  code_emploi_apres?: string | null;
  libelle_emploi_apres?: string | null;
}


export interface ListeBulletinsPopulationResult {
  mode_regroupement: ModeRegroupementBulletins;
  groupes: GroupeBulletinsPopulation[] | null;
  bulletins: BulletinSimulePopulation[] | null;
}

export interface GabaritEmbauche {
  id: string;
  nom: string;
  collaborateur_reference_id: string;
  code_poste: string | null;
  plan_paie_id: string | null;
  type_contrat: string | null;
  salaire_indicatif_min: string | null;
  salaire_indicatif_max: string | null;
  actif: boolean;
  archive: boolean;
  created_at: string;
  updated_at: string;
}

export interface RubriqueSimulable {
  code: string;
  libelle: string;
  code_type: string;
  code_famille: string | null;
}

export interface ValeurReferentielle {
  code: string;
  libelle: string;
  parent_id: string | null;
}

export interface ReferentielChampResult {
  a_un_referentiel: boolean;
  table: string | null;
  valeurs: ValeurReferentielle[];
}

// ---------------------------------------------------------------------------
// UC1 — Bulletin
// ---------------------------------------------------------------------------
export function simulerBulletin(payload: {
  collaborateur_id: string;
  periode_id: string;
  surcharges_rubrique?: SurchargeRubrique[];
  surcharges_table?: SurchargeTable[];
  surcharges_regime?: SurchargeRegime[];
}): Promise<ResultatBulletin> {
  return api.post<ResultatBulletin>("/paie/simulation/bulletin", payload);
}

// ---------------------------------------------------------------------------
// UC2 — Impact
// ---------------------------------------------------------------------------
export function simulerImpact(payload: {
  collaborateur_id: string;
  periode_id: string;
  surcharges_rubrique?: SurchargeRubrique[];
  surcharges_table?: SurchargeTable[];
  surcharges_regime?: SurchargeRegime[];
}): Promise<ResultatImpact> {
  return api.post<ResultatImpact>("/paie/simulation/impact", payload);
}

// ---------------------------------------------------------------------------
// UC3 — Embauche
// ---------------------------------------------------------------------------
export function simulerEmbauche(payload: {
  collaborateur_reference_id: string;
  periode_id: string;
  surcharges_rubrique?: SurchargeRubrique[];
  surcharges_table?: SurchargeTable[];
  surcharges_regime?: SurchargeRegime[];
}): Promise<ResultatBulletin> {
  return api.post<ResultatBulletin>("/paie/simulation/embauche", payload);
}

// ---------------------------------------------------------------------------
// Scénarios sauvegardés
// ---------------------------------------------------------------------------
export function listerScenarios(params?: {
  type_simulation?: ModeSimulation;
  inclure_partages?: boolean;
}): Promise<ScenarioSimulation[]> {
  return api.get<ScenarioSimulation[]>("/paie/simulation/scenarios" + qs(params ?? {}));
}

export function creerScenario(payload: {
  type_simulation: ModeSimulation;
  nom: string;
  collaborateur_id?: string | null;
  population_id?: string | null;
  periode_id?: string | null;
  periode_reference?: Record<string, unknown>;
  hypotheses: Record<string, unknown>;
  resultat_calcule?: Record<string, unknown> | null;
  partage?: boolean;
  date_application?: string | null;
}): Promise<ScenarioSimulation> {
  return api.post<ScenarioSimulation>("/paie/simulation/scenarios", payload);
}

export function lireScenario(id: string): Promise<ScenarioSimulation> {
  return api.get<ScenarioSimulation>(`/paie/simulation/scenarios/${id}`);
}

export function modifierScenario(
  id: string,
  patch: Partial<Pick<ScenarioSimulation, "nom" | "partage" | "archive" | "hypotheses" | "population_id" | "date_application">>
): Promise<ScenarioSimulation> {
  return api.patch<ScenarioSimulation>(`/paie/simulation/scenarios/${id}`, patch);
}

export async function archiverScenario(id: string): Promise<void> {
  await api.delete<void>(`/paie/simulation/scenarios/${id}`);
}

export function dupliquerScenario(id: string): Promise<ScenarioSimulation> {
  // POST sans corps utile côté backend — `{}` requis car `body` n'est pas
  // optionnel dans la signature réelle de api.post().
  return api.post<ScenarioSimulation>(`/paie/simulation/scenarios/${id}/dupliquer`, {});
}

// ---------------------------------------------------------------------------
// Référentiel Gabarits d'embauche
// ---------------------------------------------------------------------------
export function listerGabarits(inclureInactifs = false): Promise<GabaritEmbauche[]> {
  return api.get<GabaritEmbauche[]>("/paie/simulation/gabarits" + qs({ inclure_inactifs: inclureInactifs }));
}

// ---------------------------------------------------------------------------
// Ergonomie de sélection — rubriques et référentiels de champs de contrat
// (la recherche collaborateur et la cascade plan/année/période passent
// maintenant par le CRUD générique db.list(), voir CollaborateurCombobox.tsx
// et useCascadePlanPeriode.ts, mirroir de TraitementPaiePage.tsx — ces deux
// endpoints backend dédiés existent toujours mais ne sont plus appelés par
// le frontend depuis ce changement)
// ---------------------------------------------------------------------------
export function listerRubriquesSimulables(): Promise<RubriqueSimulable[]> {
  return api.get<RubriqueSimulable[]>("/paie/simulation/rubriques");
}

export function listerRegimesSimulables(): Promise<RegimeSimulable[]> {
  return api.get<RegimeSimulable[]>("/paie/simulation/regimes");
}

export function valeursReferentielChamp(table: string, colonne: string): Promise<ReferentielChampResult> {
  return api.get<ReferentielChampResult>("/paie/simulation/referentiel-valeurs" + qs({ table, colonne }));
}

// ---------------------------------------------------------------------------
// Export Excel (KPI + détail)
// ---------------------------------------------------------------------------
/**
 * Déclenche le téléchargement d'un .xlsx généré côté serveur (KPI + détail
 * des lignes, ou 3 feuilles Avant/Après/Écarts pour un IMPACT). `resultat`
 * est repris tel quel de la réponse d'un calcul déjà effectué, ou de
 * ScenarioSimulation.resultat_calcule — jamais recalculé côté serveur.
 */
export async function exporterExcelSimulation(payload: {
  titre: string;
  type_simulation: ModeSimulation;
  resultat: Record<string, unknown>;
}): Promise<void> {
  const blob = await postForBlob("/paie/simulation/export-excel", payload);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${payload.titre.replace(/\s+/g, "_")}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Lancement en masse par population
// ---------------------------------------------------------------------------
export function listerPopulationsSimulables(): Promise<PopulationSimulable[]> {
  return api.get<PopulationSimulable[]>("/paie/simulation/populations");
}

/**
 * `population_id: null` = toutes les populations actives (union). Réponse
 * IMMÉDIATE (job_id) — le calcul tourne en tâche de fond côté serveur
 * (produit destiné à des clients pouvant dépasser 300 collaborateurs, donc
 * jamais synchrone). Poller lireJobPopulation(job_id) jusqu'à statut
 * "TERMINE" ou "ERREUR".
 */
export function lancerSimulationPopulation(payload: {
  population_id: string | null;
  periode_debut_id: string;
  periode_fin_id: string;
  scenario_ids: string[];
  avec_ecarts?: boolean;
}): Promise<SimulationPopulationJobCree> {
  return api.post<SimulationPopulationJobCree>("/paie/simulation/population/lancer", payload);
}

export function lireJobPopulation(jobId: string): Promise<SimulationPopulationJobStatut> {
  return api.get<SimulationPopulationJobStatut>(`/paie/simulation/population/jobs/${jobId}`);
}

// ---------------------------------------------------------------------------
// Génération des périodes d'un nouvel exercice (RG-CALENDRIER-GENERATION-01)
// — aucun mécanisme équivalent n'existait avant cette livraison.
// ---------------------------------------------------------------------------
export interface PeriodeGeneree {
  id: string;
  annee: number;
  mois: number;
  date_debut: string;
  date_fin: string;
}

export interface GenererAnneeResult {
  annee: number;
  annee_source: number | null;
  nb_periodes_creees: number;
  periodes: PeriodeGeneree[];
}

export function genererAnneeCalendrier(planPaieId: string, annee: number, anneeSource?: number): Promise<GenererAnneeResult> {
  return api.post<GenererAnneeResult>("/paie/calendrier/generer-annee", {
    plan_paie_id: planPaieId, annee, annee_source: anneeSource ?? null,
  });
}

// ---------------------------------------------------------------------------
// Liste des bulletins simulés d'un job (RG-SIM-POPULATION-03)
// ---------------------------------------------------------------------------
export function listerBulletinsPopulation(
  jobId: string,
  groupby: ModeRegroupementBulletins,
  filtres?: { unite_libelle?: string; periode_id?: string; annee?: number; mois?: number; collaborateur_id?: string }
): Promise<ListeBulletinsPopulationResult> {
  return api.get<ListeBulletinsPopulationResult>(
    `/paie/simulation/population/jobs/${jobId}/bulletins` + qs({ groupby, ...filtres })
  );
}

export function lireBulletinPopulation(bulletinId: string): Promise<BulletinSimuleDetail> {
  return api.get<BulletinSimuleDetail>(`/paie/simulation/population/bulletins/${bulletinId}`);
}

// ---------------------------------------------------------------------------
// Historique des lancements (RG-SIM-POPULATION-06) — liste/purge/export complet
// ---------------------------------------------------------------------------
export interface SimulationPopulationJobResume {
  id: string;
  statut: "EN_ATTENTE" | "EN_COURS" | "TERMINE" | "ERREUR";
  population_nom: string;
  periode_debut_libelle: string | null;
  periode_fin_libelle: string | null;
  nb_total: number;
  nb_traites: number;
  created_by: string;
  created_by_nom: string;
  scenario_noms: string[];
  created_at: string;
  termine_at: string | null;
}

export function listerJobsPopulation(statut?: string, limite = 50): Promise<SimulationPopulationJobResume[]> {
  return api.get<SimulationPopulationJobResume[]>(`/paie/simulation/population/jobs` + qs({ statut, limite }));
}

export async function purgerJobPopulation(jobId: string): Promise<void> {
  await api.delete<void>(`/paie/simulation/population/jobs/${jobId}`);
}

/**
 * Export Excel COMPLET (7 onglets) — endpoint GET dédié (pas de corps de
 * requête à envoyer, contrairement à exporterExcelSimulation/POST) : fetch
 * manuel avec le jeton d'authentification, comme le reste de l'app
 * (sessionStorage — voir tokenStore), plutôt qu'un lien direct qui
 * échouerait sans en-tête Authorization.
 */
export async function telechargerExportPopulationComplet(jobId: string, populationNom: string): Promise<void> {
  const token = tokenStore.get();
  const response = await fetch(`${API_BASE}/paie/simulation/population/jobs/${jobId}/export-excel`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (response.status === 401) {
    tokenStore.clear();
    window.location.href = "/login";
    throw new Error("Session expirée");
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => ({ detail: "Erreur inconnue" }));
    throw new Error(typeof detail?.detail === "string" ? detail.detail : `Erreur d'export (${response.status})`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Simulation_Population_${populationNom.replace(/\s+/g, "_")}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
