/**
 * comptaPaieApi – Accès API pour le sous-module Comptabilisation de la paie.
 *
 * Convention reprise du reste du module Paie (voir RubriqueForm.tsx / MODULE_PAIE.md §4) :
 *  - Les tables (CRUD simple) passent par le proxy générique `/db/...` (PostgREST-like).
 *  - Les ACTIONS (génération, contrôle, export) passent par le routeur dédié
 *    `app/routers/compta_paie.py`, préfixe `/paie/compta` (voir MODULE_COMPTA_PAIE.md §6).
 *
 * ⚠️ Ce fichier a été écrit à partir de la SPEC (MODULE_COMPTA_PAIE.md), pas du code
 * backend réel (les squelettes `app/routers/compta_paie.py`, `app/services/
 * comptabilisation_engine.py` sont mentionnés mais pas fournis). Les noms de colonnes
 * marqués ⚠️ sont des hypothèses raisonnables par analogie avec le reste du schéma
 * (ex. `rubrique_paie_code` en FK texte plutôt que `rubrique_paie_id`) — à vérifier
 * contre le DDL réel `sql/23_comptabilite_paie.sql` avant intégration.
 */
import { api } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModeGeneration = "GLOBALE" | "NOMINATIF";
export type StatutLot = "BROUILLON" | "GENERE" | "EXPORTE" | "COMPTABILISE";

export interface Plan {
  code: string;
  libelle: string;
}

// ⚠️ Colonnes de calendrier_paie supposées par analogie avec MODULE_PAIE.md
// (sql/10_calendrier_ouverture.sql, sql/11_calendrier_intitule.sql) : `date_ouverture`
// et `intitule` y sont ajoutées, ce qui confirme au moins ces deux colonnes.
export interface Periode {
  id: string;
  plan_paie_code: string;
  annee: number;
  periode: number;
  intitule: string;
  statut: "OUVERTE" | "CLOTUREE";
  date_ouverture: string | null;
}

export interface EcartCollaborateur {
  collaborateur_id: string;
  matricule: string;
  nom: string;
  prenom: string;
  motif: string; // ex. "Aucun bulletin" / "Bulletin encore à CALCULE"
}

export interface ControleEffectif {
  effectif_attendu: number;
  effectif_valide: number;
  controle_ok: boolean;
  ecarts: EcartCollaborateur[];
}

export interface Lot {
  id: string;
  plan_paie_code: string;
  annee: number;
  periode: number;
  mode: ModeGeneration;
  statut: StatutLot;
  effectif_attendu: number | null;
  effectif_valide: number | null;
  controle_ok: boolean | null;
  force_par: string | null;
  motif_forcage: string | null;
  created_at: string;
  created_par: string | null;
}

export interface Anomalie {
  bulletin_id: string;
  matricule: string;
  nom: string;
  prenom: string;
  rubrique_code: string;
  rubrique_libelle: string;
  motif: string; // ex. "Aucune imputation active pour cette rubrique/part à la date de la période"
}

export interface ResultatGeneration {
  lot: Lot;
  nb_lignes_generees: number;
  total_debit: number;
  total_credit: number;
  equilibre: boolean;
  nb_anomalies: number;
}

export interface RubriqueSansImputation {
  code: string;
  libelle: string;
  code_type: string;
}

export interface FormatExport {
  code: string; // SAGE_CSV | FEC | GENERIQUE_CSV | GENERIQUE_XLSX
  description: string;
  notes: string | null;
}

// ---------------------------------------------------------------------------
// Référentiels / lecture (proxy générique /db)
// ---------------------------------------------------------------------------

export async function listPlans(): Promise<Plan[]> {
  // ⚠️ Table/colonnes `plan_paie(code, libelle)` supposées — à vérifier.
  const data = await api.get("/db/plan_paie?select=code,libelle&order=code");
  return (data || []) as Plan[];
}

export async function listPeriodes(planCode: string): Promise<Periode[]> {
  const data = await api.get(
    `/db/calendrier_paie?plan_paie_code=eq.${planCode}&select=id,plan_paie_code,annee,periode,intitule,statut,date_ouverture&order=annee,periode`
  );
  return (data || []) as Periode[];
}

export async function listFormats(): Promise<FormatExport[]> {
  // Référentiel administrable ref_format_export_compta (§4.2) — même logique que
  // les autres référentiels chargés via /db dans RubriqueForm.tsx.
  const data = await api.get(
    "/db/ref_format_export_compta?actif=eq.true&select=code,description,notes&order=code"
  );
  return (data || []) as FormatExport[];
}

export async function listLots(planCode?: string): Promise<Lot[]> {
  const filtre = planCode ? `plan_paie_code=eq.${planCode}&` : "";
  const data = await api.get(
    `/db/lot_ecriture_paie?${filtre}select=*&order=created_at.desc&limit=100`
  );
  return (data || []) as Lot[];
}

export async function listHistoriqueExports(lotId: string) {
  // ⚠️ Réutilisation de paie_historique avec le nouvel événement EXPORT_ECRITURE
  // (§3.3) — colonne `lot_id` supposée pour rattacher l'historique au lot.
  const data = await api.get(
    `/db/paie_historique?lot_id=eq.${lotId}&type_evenement=eq.EXPORT_ECRITURE&select=*&order=created_at.desc`
  );
  return (data || []) as any[];
}

// ---------------------------------------------------------------------------
// Rappel imputations manquantes (§2.5 : « utilisable ... sur l'écran de
// génération pour un rappel avant lancement »)
// ---------------------------------------------------------------------------

export async function getRubriquesSansImputation(): Promise<RubriqueSansImputation[]> {
  const data = await api.get("/paie/compta/imputations/manquantes");
  return (data || []) as RubriqueSansImputation[];
}

// ---------------------------------------------------------------------------
// Actions (routeur compta_paie.py)
// ---------------------------------------------------------------------------

export async function creerLot(params: {
  plan_paie_code: string;
  annee: number;
  periode: number;
  mode: ModeGeneration;
}): Promise<Lot> {
  const data = await api.post("/paie/compta/lots", params);
  return data as Lot;
}

export async function controlerLot(lotId: string): Promise<ControleEffectif> {
  const data = await api.post(`/paie/compta/lots/${lotId}/controler`, {});
  return data as ControleEffectif;
}

export async function genererLot(
  lotId: string,
  options?: { forcer?: boolean; motif?: string }
): Promise<ResultatGeneration> {
  const data = await api.post(`/paie/compta/lots/${lotId}/generer`, {
    forcer: !!options?.forcer,
    motif: options?.motif || null,
  });
  return data as ResultatGeneration;
}

export async function getAnomalies(lotId: string): Promise<Anomalie[]> {
  const data = await api.get(`/paie/compta/lots/${lotId}/anomalies`);
  return (data || []) as Anomalie[];
}

// ---------------------------------------------------------------------------
// Export fichier — cas particulier : la réponse est un fichier binaire, pas du
// JSON. ⚠️ Le module `api` centralisé (vu dans RubriqueForm.tsx) n'expose que des
// méthodes qui semblent parser la réponse en JSON (`api.get/post/patch/delete`).
// On passe donc ici par un fetch bas niveau. À ADAPTER selon l'implémentation
// réelle de `src/lib/api.ts` (URL de base, gestion du token/cookie de session) :
// remplacer `resolveBaseUrl()` / les headers ci-dessous par l'équivalent exact
// utilisé par `api.get` (ex. `api.baseURL`, intercepteur d'auth, etc.).
// ---------------------------------------------------------------------------

function resolveBaseUrl(): string {
  // ⚠️ Hypothèse : même base que les autres appels /db et /paie (ex. "/api/v1").
  return (api as any).baseURL || "/api/v1";
}

export async function exporterLot(
  lotId: string,
  formatCode: string
): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(
    `${resolveBaseUrl()}/paie/compta/lots/${lotId}/exporter?format=${encodeURIComponent(formatCode)}`,
    {
      method: "POST",
      credentials: "include",
      // ⚠️ Ajouter ici les headers d'auth réels du projet si `api` n'utilise pas
      // de cookie de session (ex. Authorization: Bearer ...).
    }
  );
  if (!res.ok) {
    let message = `Échec de l'export (HTTP ${res.status})`;
    try {
      const body = await res.json();
      if (body?.detail) message = body.detail;
    } catch {
      /* réponse non-JSON, on garde le message par défaut */
    }
    throw new Error(message);
  }
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const filename = match?.[1] ? decodeURIComponent(match[1]) : `export_${formatCode}_${lotId}`;
  const blob = await res.blob();
  return { blob, filename };
}

export function declencherTelechargement(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
