/**
 * paieApi.ts — Accès typé aux endpoints du moteur de paie.
 * Auteur : Adil DAIA
 *
 * Endpoints backend (préfixe /api/v1) :
 *   POST   /paie/calcul/collaborateur
 *   GET    /paie/bulletins
 *   GET    /paie/bulletins/{id}
 *   DELETE /paie/bulletins/{id}
 */
import { api, qs } from "@/lib/api";

// ---- Types (miroir des schémas Pydantic) --------------------------------
export interface LigneBulletin {
  code_rubrique: string;
  libelle: string;
  code_type?: string | null;
  type_regle?: string | null;
  ordre_calcul?: number | null;
  ordre_affichage: number;
  base?: number | null;
  nombre?: number | null;
  taux?: number | null;
  montant: number;
  montant_patronal?: number | null;
  taux_patronal?: number | null;            // RG-PAIE-PATRONAL-01 (migration 076)
  montant_cumul?: number | null;
  montant_patronal_cumul?: number | null;   // RG-PAIE-PATRONAL-02
  nombre_cumul?: number | null;
  sens?: string | null;
  est_cotisation: boolean;
  type_periodicite?: string | null;
  frequence_raz?: string | null;
  date_valeur?: string | null;
  texte?: string | null;
  observation?: string | null;
}

export interface TotauxBulletin {
  total_brut: number;
  total_brut_imposable: number;
  total_gains: number;
  total_retenues: number;
  total_cot_salariale: number;
  total_cot_patronale: number;
  net_imposable: number;
  net_a_payer: number;
  cout_employeur: number;
}

export interface TraceEtape {
  rubrique: string;
  libelle?: string;
  type?: string | null;
  type_regle?: string | null;
  detail?: string[];
  avert?: string[];
  resultat?: { BASE: string; NB: string; TY: string; MT: string; MT_PAT?: string | null };
}

export interface CalculBulletinResult {
  bulletin_id?: string | null;
  lot_id?: string | null;
  statut?: string | null;
  /** Présent lors du rechargement d'un bulletin enregistré (pas après un calcul). */
  origine?: OrigineBulletin;
  collaborateur: { id: string; matricule?: string; nom?: string; prenom?: string };
  periode: { id: string; annee: number; mois: number; libelle: string; plan_paie_id?: string | null; code_plan?: string | null };
  totaux: TotauxBulletin;
  lignes: LigneBulletin[];
  trace: TraceEtape[];
  messages: string[];
  a_erreur: boolean;
}

// ---- Cycle de vie : contrôles, validation, clôture, historique ----------
export interface ControleResultat {
  code: string;
  libelle: string;
  categorie: string;
  niveau: string;            // BLOQUANT | ALERTE
  ok: boolean;
  message?: string | null;
}

export interface RapportControle {
  bulletin_id: string;
  statut: string;
  controles: ControleResultat[];
  bloquants_ko: number;
  alertes_ko: number;
  validable: boolean;
}

export interface ValidationResult {
  valide: boolean;
  confirmation_requise: boolean;
  statut: string;
  rapport: RapportControle;
}

export interface HistoriqueItem {
  id: string;
  periode_id: string;
  bulletin_id?: string | null;
  action: string;
  statut_avant?: string | null;
  statut_apres?: string | null;
  decision?: string | null;
  commentaire?: string | null;
  utilisateur_id?: string | null;
  created_at: string;
}

export function controlerBulletin(id: string): Promise<RapportControle> {
  return api.post<RapportControle>(`/paie/bulletins/${id}/controler`, {});
}
export function validerBulletin(id: string, forcer_alertes = false, commentaire?: string): Promise<ValidationResult> {
  return api.post<ValidationResult>(`/paie/bulletins/${id}/valider`, { forcer_alertes, commentaire });
}
export function devaliderBulletin(id: string, commentaire?: string): Promise<ValidationResult> {
  return api.post<ValidationResult>(`/paie/bulletins/${id}/devalider`, { commentaire });
}
export function historiqueBulletin(id: string): Promise<HistoriqueItem[]> {
  return api.get<HistoriqueItem[]>(`/paie/bulletins/${id}/historique`);
}
export function cloturerPeriode(periodeId: string, forcer_alertes = false, commentaire?: string): Promise<any> {
  return api.post<any>(`/paie/periodes/${periodeId}/cloturer`, { forcer_alertes, commentaire });
}
export function rouvrirPeriode(periodeId: string, commentaire?: string): Promise<any> {
  return api.post<any>(`/paie/periodes/${periodeId}/rouvrir`, { commentaire });
}

// ---- Clôture annuelle ----------------------------------------------------
export interface AnneePaie {
  id: string;
  plan_paie_id: string;
  annee: number;
  statut: string;            // OUVERTE | CLOTUREE
  cloture_le?: string | null;
  cloture_par?: string | null;
  commentaire?: string | null;
}
export function listerAnnees(planPaieId: string): Promise<AnneePaie[]> {
  return api.get<AnneePaie[]>("/paie/annees" + qs({ plan_paie_id: planPaieId }));
}
export function cloturerAnnee(plan_paie_id: string, annee: number, forcer_alertes = false, commentaire?: string): Promise<any> {
  return api.post<any>("/paie/annees/cloturer", { plan_paie_id, annee, forcer_alertes, commentaire });
}
export function rouvrirAnnee(plan_paie_id: string, annee: number, commentaire?: string): Promise<any> {
  return api.post<any>("/paie/annees/rouvrir", { plan_paie_id, annee, commentaire });
}

// ---- Lancement en masse (population + lot) --------------------------------
export interface PopulationFiltres {
  /** Unités organisationnelles (UUID). Cocher une UO inclut ses sous-unités. */
  unite_ids?: string[];
  /** Codes du référentiel ref_poste (et non des identifiants d'instance). */
  codes_poste?: string[];
  types_contrat?: string[];
  statuts_contrat?: string[];
  temps?: string[];
  statuts_collaborateur?: string[];
  regimes?: string[];
  nationalites?: string[];
  matricule?: string | null;
  collaborateur_ids?: string[];
}
export interface CollaborateurCible { id: string; matricule?: string; nom?: string; prenom?: string; }
export interface LigneLotResultat {
  collaborateur_id: string; matricule?: string | null; nom?: string | null;
  net_a_payer?: number | null; a_erreur: boolean; message?: string | null;
}
export interface LotCalculResult {
  nb_total: number; nb_ok: number; nb_erreur: number;
  /** Bulletins déjà validés : laissés intacts (ni recalculés, ni en erreur). */
  nb_ignores?: number;
  total_net: number; total_cout: number; resultats: LigneLotResultat[];
}
export function apercuPopulation(plan_paie_id: string, periode_id: string, filtres: PopulationFiltres): Promise<CollaborateurCible[]> {
  return api.post<CollaborateurCible[]>("/paie/population", { plan_paie_id, periode_id, filtres });
}
export function calculerLot(plan_paie_id: string, periode_id: string, filtres: PopulationFiltres, persister = true): Promise<LotCalculResult> {
  return api.post<LotCalculResult>("/paie/calcul/lot", { plan_paie_id, periode_id, filtres, persister });
}

export interface LigneLotValidation {
  collaborateur_id: string; matricule?: string | null; nom?: string | null;
  statut: string; bloquants: number; alertes: number; message?: string | null;
}
export interface LotValidationResult {
  nb_total: number; nb_valides: number;
  /** Déjà VALIDE avant cet appel (ex. validé lors d'une action précédente) —
   * n'était jusqu'ici comptabilisé nulle part dans les totaux, ce qui rendait
   * le message "N validé(s)" trompeur après une validation en plusieurs
   * temps (RG-LOT-DEJA-VALIDE-01). */
  nb_deja_valide: number;
  nb_bloques: number; nb_alertes: number;
  nb_sans_bulletin: number; resultats: LigneLotValidation[];
}
export function validerLot(plan_paie_id: string, periode_id: string, filtres: PopulationFiltres, forcer_alertes = false): Promise<LotValidationResult> {
  return api.post<LotValidationResult>("/paie/lot/valider", { plan_paie_id, periode_id, filtres, forcer_alertes });
}

// ---- Vue d'ensemble (tableau de bord) ------------------------------------
export interface SynthesePeriode {
  mois: number; periode_id: string; numero_periode: number;
  statut_periode: string; intitule: string | null; nb: number; effectif: number;
  calcules: number; valides: number; clotures: number; net: number; cout: number;
}
export interface SyntheseAnnee {
  annee: number; nb: number; valides: number; clotures: number; net: number; cout: number;
}
export interface RepartitionLigne { libelle: string; net: number; cout: number; nb: number; }
export interface TopRubrique { libelle: string; code: string; total: number; }
export interface SyntheseTotaux {
  nb: number; effectif: number; brut: number; net: number; cout: number; cotisations: number;
  cot_salariale: number; cot_patronale: number; retenues: number;
  brut_imposable: number; net_imposable: number;
  net_moyen: number; cout_moyen: number; brut_moyen: number;
  taux_charges: number; ratio_net_brut: number;
  valides: number; clotures: number; a_valider: number; en_erreur: number; avec_avertissement: number;
}
export interface SyntheseResult {
  annee: number;
  periodes: SynthesePeriode[];
  totaux: SyntheseTotaux;
  precedentes: SyntheseAnnee[];
  repartition_organisation: RepartitionLigne[];
  repartition_contrat: RepartitionLigne[];
  top_rubriques: TopRubrique[];
}

/**
 * Filtres optionnels pour /paie/synthese.
 * Mêmes clés que PopulationFiltres (cohérence avec le reste de l'app) :
 * organisation = vraie table référencée par ID, type de contrat = code libre.
 *
 * ⚠️ Le endpoint backend GET /paie/synthese doit être adapté pour lire et
 * appliquer ces query params (organisation_id, type_contrat) — ce fichier
 * ne fait que les transmettre, le filtrage réel se fait côté serveur.
 */
export interface SyntheseFiltres {
  organisation_ids?: string[];       // UO (unité organisationnelle)
  types_contrat?: string[];
  categorie_professionnelle_ids?: string[];
}

export function synthesePaie(planIds: string[], annee?: number, filtres?: SyntheseFiltres, officiel?: boolean, detailPeriodes?: boolean): Promise<SyntheseResult> {
  const p = new URLSearchParams();
  planIds.forEach((id) => p.append("plan_paie_id", id));
  if (annee) p.append("annee", String(annee));
  if (officiel) p.append("officiel", "true");
  if (detailPeriodes) p.append("detail_periodes", "true");
  // "organisation" ici = unité organisationnelle (UO) : la table `organisations`
  // n'est plus alimentée, `unites_organisationnelles` est la source à jour.
  filtres?.organisation_ids?.forEach((id) => p.append("unite_id", id));
  filtres?.types_contrat?.forEach((code) => p.append("type_contrat", code));
  filtres?.categorie_professionnelle_ids?.forEach((id) => p.append("categorie_professionnelle_id", id));
  return api.get<SyntheseResult>("/paie/synthese?" + p.toString());
}

/**
 * Table d'où provient le bulletin (cycle de vie physique) :
 *   TEMP       → bulletin_temp        : précalcul, recalculable, non échangé
 *   VALIDE     → bulletin             : base des déclarations et interfaces
 *   HISTORIQUE → bulletin_historique  : archive immuable (période clôturée)
 */
export type OrigineBulletin = "TEMP" | "VALIDE" | "HISTORIQUE";

export interface BulletinRead {
  id: string;
  origine: OrigineBulletin;
  lot_id: string;
  periode_id: string;
  plan_paie_id?: string | null;
  code_plan?: string | null;
  collaborateur_id: string;
  matricule?: string | null;
  total_brut: number;
  total_gains: number;
  total_retenues: number;
  total_cot_salariale: number;
  total_cot_patronale: number;
  net_imposable: number;
  net_a_payer: number;
  cout_employeur: number;
  statut: string;
  a_erreur: boolean;
  messages: string[];
  calcule_le: string;
  lignes: (LigneBulletin & { id: string })[];
}

// ---- Appels -------------------------------------------------------------
export async function calculerBulletin(input: {
  collaborateur_id: string;
  periode_id: string;
  persister?: boolean;
  type_lot?: "UNITAIRE" | "SIMULATION";
}): Promise<CalculBulletinResult> {
  try {
    return await api.post<CalculBulletinResult>("/paie/calcul/collaborateur", {
      collaborateur_id: input.collaborateur_id,
      periode_id: input.periode_id,
      persister: input.persister ?? false,
      type_lot: input.type_lot ?? "UNITAIRE",
    });
  } catch (e: any) {
    // 409 : le bulletin est déjà validé — le recalcul écraserait la base des échanges.
    if (/déjà validé/i.test(e?.message ?? "")) {
      throw new Error(
        "Ce bulletin est déjà validé. Dévalidez-le avant de le recalculer.",
      );
    }
    throw e;
  }
}

export function listerBulletins(params: { periode_id?: string; collaborateur_id?: string; collaborateur_ids?: string[] } = {}): Promise<BulletinRead[]> {
  // RG-BULLETINS-QS-ARRAY-01 (Adil DAIA) : qs() joint les tableaux par des
  // virgules dans un seul paramètre ("id1,id2,id3"), mais FastAPI
  // (collaborateur_ids: list[UUID] = Query(None)) attend la clé RÉPÉTÉE
  // ("collaborateur_ids=id1&collaborateur_ids=id2&..."). Une virgule unique
  // fait échouer le parsing UUID côté backend → 422, et listerBulletins()
  // ne renvoie jamais rien : c'est ce qui empêchait toute dévalidation en
  // masse de fonctionner (LancementPaiePage.tsx::devalider()). Construction
  // manuelle ici, même pattern déjà correct dans rechercherBulletins/
  // synthesePaie plus bas dans ce fichier.
  const p = new URLSearchParams();
  if (params.periode_id) p.append("periode_id", params.periode_id);
  if (params.collaborateur_id) p.append("collaborateur_id", params.collaborateur_id);
  params.collaborateur_ids?.forEach((id) => p.append("collaborateur_ids", id));
  const suffixe = p.toString();
  return api.get<BulletinRead[]>("/paie/bulletins" + (suffixe ? `?${suffixe}` : ""));
}

// ---- Recherche transverse de bulletins (tous collaborateurs) -----------
export interface BulletinRechercheLigne {
  id: string; origine: OrigineBulletin; statut: string; matricule: string;
  nom: string | null; prenom: string | null; plan_code: string;
  mois: number; periode_annee: number; intitule: string | null;
  net_a_payer: number; cout_employeur: number; a_erreur: boolean;
  nb_messages: number; messages: string[] | null;
}
export interface RechercheBulletinsResult { lignes: BulletinRechercheLigne[]; total: number; }
export interface RechercheBulletinsFiltres {
  q?: string; statut?: string[]; origine?: OrigineBulletin[];
  seulementAvecProbleme?: boolean; officiel?: boolean;
  organisationIds?: string[]; typesContrat?: string[];
  limit?: number; offset?: number;
}

export function rechercherBulletins(planIds: string[], annee: number, filtres: RechercheBulletinsFiltres = {}): Promise<RechercheBulletinsResult> {
  const p = new URLSearchParams();
  planIds.forEach((id) => p.append("plan_paie_id", id));
  p.append("annee", String(annee));
  if (filtres.q?.trim()) p.append("q", filtres.q.trim());
  filtres.statut?.forEach((s) => p.append("statut", s));
  filtres.origine?.forEach((o) => p.append("origine", o));
  if (filtres.seulementAvecProbleme) p.append("seulement_avec_probleme", "true");
  if (filtres.officiel) p.append("officiel", "true");
  // "organisation" ici = unité organisationnelle (UO), cf. synthesePaie.
  filtres.organisationIds?.forEach((id) => p.append("unite_id", id));
  filtres.typesContrat?.forEach((c) => p.append("type_contrat", c));
  if (filtres.limit) p.append("limit", String(filtres.limit));
  if (filtres.offset) p.append("offset", String(filtres.offset));
  return api.get<RechercheBulletinsResult>("/paie/bulletins/recherche?" + p.toString());
}

export function lireBulletin(id: string): Promise<BulletinRead> {
  return api.get<BulletinRead>(`/paie/bulletins/${id}`);
}

export function supprimerBulletin(id: string): Promise<void> {
  return api.delete<void>(`/paie/bulletins/${id}`);
}

/** Convertit un bulletin enregistré (GET) vers la forme d'affichage du calcul. */
export function bulletinToResult(b: BulletinRead): CalculBulletinResult {
  return {
    bulletin_id: b.id,
    lot_id: b.lot_id,
    statut: b.statut,
    origine: b.origine,
    collaborateur: { id: b.collaborateur_id, matricule: b.matricule ?? undefined },
    periode: { id: b.periode_id, annee: 0, mois: 0, libelle: "", code_plan: b.code_plan },
    totaux: {
      total_brut: b.total_brut,
      total_brut_imposable: b.total_brut,
      total_gains: b.total_gains,
      total_retenues: b.total_retenues,
      total_cot_salariale: b.total_cot_salariale,
      total_cot_patronale: b.total_cot_patronale,
      net_imposable: b.net_imposable,
      net_a_payer: b.net_a_payer,
      cout_employeur: b.cout_employeur,
    },
    lignes: b.lignes,
    trace: [],
    messages: b.messages ?? [],
    a_erreur: b.a_erreur,
  };
}
