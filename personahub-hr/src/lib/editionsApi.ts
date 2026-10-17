/**
 * editionsApi.ts — Client de l'API /editions (plateforme d'éditions unifiée).
 * Auteur : Adil DAIA — lot 2 (16/10/2026)
 *
 * Miroir de personahub-api/app/routers/editions.py. Les erreurs métier du
 * backend ont la forme { detail: { message, details? } } : ErreurEdition les
 * expose telles quelles (statut HTTP + détails), pour que le designer puisse
 * réagir au cas par cas (409 concurrence, 422 erreurs de validation…).
 *
 * Concurrence (RG-EDT-VERSION-03) : enregistrer() et publier() envoient
 * If-Match avec le jeton lu ; un 409 signifie « modifié ailleurs ».
 */
import { API_BASE, tokenStore } from "@/lib/api";
import type { Definition } from "@/pages/editions/types";

export class ErreurEdition extends Error {
  constructor(public statut: number, message: string, public details?: any) {
    super(message);
  }
}

async function appel<T>(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}): Promise<T> {
  const token = tokenStore.get();
  const r = await fetch(`${API_BASE}/editions${chemin}`, {
    method: methode,
    headers: {
      ...(corps !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...entetes,
    },
    body: corps !== undefined ? JSON.stringify(corps) : undefined,
  });
  if (r.status === 401) {
    tokenStore.clear();
    window.location.href = "/login";
    throw new ErreurEdition(401, "Session expirée");
  }
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    const d = e?.detail;
    if (d && typeof d === "object" && !Array.isArray(d)) throw new ErreurEdition(r.status, d.message ?? `Erreur ${r.status}`, d.details);
    if (Array.isArray(d)) throw new ErreurEdition(r.status, d.map((x: any) => x?.msg).join(" · "), d);
    throw new ErreurEdition(r.status, typeof d === "string" ? d : `Erreur ${r.status}`);
  }
  const type = r.headers.get("content-type") ?? "";
  if (type.includes("application/pdf")) return (await r.blob()) as unknown as T;
  if (r.status === 204) return undefined as T;
  return r.json();
}

// ── Types de réponse ────────────────────────────────────────────────────────
export type Categorie = "BULLETIN" | "JOURNAL" | "ATTESTATION" | "COURRIER" | "LISTE" | "DECLARATION" | "AUTRE";
export const CATEGORIES: { code: Categorie; libelle: string }[] = [
  { code: "BULLETIN", libelle: "Bulletins" },
  { code: "JOURNAL", libelle: "Journaux" },
  { code: "ATTESTATION", libelle: "Attestations" },
  { code: "COURRIER", libelle: "Courriers" },
  { code: "LISTE", libelle: "Listes" },
  { code: "DECLARATION", libelle: "Déclarations" },
  { code: "AUTRE", libelle: "Autres" },
];
export type Visibilite = "PRIVE" | "SOCIETE" | "GLOBAL";

export interface Modele {
  id: string;
  code: string;
  libelle: string;
  description: string | null;
  categorie: Categorie;
  moteur: "NATIF" | "CRYSTAL";
  societe_id: string | null;
  proprietaire_id: string | null;
  visibilite: Visibilite;
  est_systeme: boolean;
  modele_origine_id: string | null;
  version_publiee_id: string | null;
  archive: boolean;
  cree_le: string;
  modifie_le: string;
  numero_publie?: number | null;
  publie_le?: string | null;
  brouillon_id?: string | null;
}

export type StatutVersion = "BROUILLON" | "EN_REVUE" | "PUBLIEE" | "RETIREE";

export interface VersionResume {
  id: string;
  numero: number;
  statut: StatutVersion;
  empreinte: string | null;
  note: string | null;
  cree_le: string;
  modifie_le: string;
  publie_le: string | null;
}

export interface Version extends VersionResume {
  modele_id: string;
  definition: Definition;
  jeton_concurrence: string;
  modele: Modele;
}

export interface ErreurValidation {
  chemin: string;
  message: string;
  debut: number | null;
  fin: number | null;
}

export interface RapportValidation {
  valide: boolean;
  erreurs: ErreurValidation[];
  dependances: { type: string; code: string }[];
}

export interface ChampCatalogue {
  code: string;
  libelle: string;
  groupe: string | null;
  type_donnee: "TEXTE" | "NOMBRE" | "MONTANT" | "DATE" | "BOOLEEN" | "IMAGE";
  masque_defaut: string | null;
  sensible: boolean;
}

export interface SourceCatalogue {
  code: string;
  libelle: string;
  nature: string;
  contexte_requis: string[];
  champs: ChampCatalogue[];
  relations: { code: string; cible: string; cardinalite: "UN" | "PLUSIEURS" }[];
}

export interface Fonction {
  nom: string;
  categorie: string;
  signature: string;
  description?: string;
  exemple?: string;
  origine: "PAIE" | "EDITION";
}

export interface Masque {
  code: string;
  libelle: string;
  type: "NOMBRE" | "DATE" | "TEXTE";
  exemple: string;
}

export interface Analyse {
  valide: boolean;
  erreurs: { message: string; debut: number | null; fin: number | null }[];
  champs: string[];
  parametres: string[];
  rubriques: string[];
  constantes: string[];
  fonctions: string[];
}

export interface DocumentProduit {
  id: string;
  nom_fichier: string;
  nb_pages: number;
  anomalies: { element: string; message: string }[];
}

export interface ApercuDonnees {
  nb_lignes: number;
  lignes: {
    id: string;
    titre: string;
    corps: Record<string, Record<string, unknown>[] | Record<string, Record<string, unknown>>>;
    variables: Record<string, unknown>;
    anomalies: { element: string; message: string }[];
    /** Contrôle : valeurs brutes des rubriques citées par les corps (avant affectation). */
    rubriques?: ({ code: string; libelle: string; absente: boolean } & Record<"NB" | "BASE" | "TX" | "MT" | "PAT" | "CNB" | "CBASE" | "CMT", string | null>)[];
  }[];
}

export interface Periode {
  id: string;
  intitule: string | null;
  annee: number;
  mois: number;
  statut: string | null;
  plan_paie_id: string | null;
  plan_code: string | null;
  plan_libelle: string | null;
  nb_bulletins: number;
}

// ── Appels ──────────────────────────────────────────────────────────────────
export const editionsApi = {
  catalogue: () => appel<{ sources: SourceCatalogue[] }>("GET", "/catalogue").then((r) => r.sources),
  fonctions: () => appel<Fonction[]>("GET", "/fonctions"),
  masques: () => appel<Masque[]>("GET", "/masques"),
  rubriques: () => appel<{ code: string; libelle: string }[]>("GET", "/rubriques"),
  analyser: (expression: string, source?: string, parametres: string[] = []) =>
    appel<Analyse>("POST", "/expressions/analyser", { expression, source, parametres }),
  periodes: () => appel<Periode[]>("GET", "/parametres/periodes"),
  plansPaie: () => appel<{ id: string; code: string; libelle: string }[]>("GET", "/parametres/plans-paie"),

  modeles: (categorie?: string) => appel<Modele[]>("GET", `/modeles${categorie ? `?categorie=${categorie}` : ""}`),
  modele: (id: string) => appel<Modele>("GET", `/modeles/${id}`),
  creerModele: (corps: { code: string; libelle: string; categorie?: Categorie; description?: string; visibilite?: Visibilite; origine_id?: string; definition?: Definition }) =>
    appel<{ modele_id: string; version_id: string }>("POST", "/modeles", corps),
  versions: (modeleId: string) => appel<VersionResume[]>("GET", `/modeles/${modeleId}/versions`),
  ouvrirBrouillon: (modeleId: string) => appel<{ version_id: string; cree: boolean }>("POST", `/modeles/${modeleId}/brouillon`),
  lancer: (modeleId: string, parametres: Record<string, unknown>, forme?: string) =>
    appel<{ demande_id: string; statut: string; documents: DocumentProduit[] }>("POST", `/modeles/${modeleId}/demandes`, { parametres, forme }),

  version: (versionId: string) => appel<Version>("GET", `/versions/${versionId}`),
  enregistrer: (versionId: string, definition: Definition, jeton: string, note?: string) =>
    appel<RapportValidation & { jeton: string }>("PUT", `/versions/${versionId}`, { definition, note }, { "If-Match": `"${jeton}"` }),
  valider: (versionId: string) => appel<RapportValidation>("POST", `/versions/${versionId}/valider`),
  publier: (versionId: string, jeton: string) =>
    appel<{ version_id: string; numero: number; empreinte: string }>("POST", `/versions/${versionId}/publier`, undefined, { "If-Match": `"${jeton}"` }),
  apercu: (versionId: string, parametres: Record<string, unknown>, forme?: string) =>
    appel<Blob>("POST", `/versions/${versionId}/apercu`, { parametres, forme }),
  /** Assistant de formule : valeur sur les premiers documents (définition en cours, non enregistrée). */
  testerFormule: (definition: Definition, formule: string, parametres: Record<string, unknown>, contexte?: string) =>
    appel<{ nb_lignes: number; resultats: { titre: string; valeur: unknown; texte: string; type: string; manques: string[]; erreur: string | null }[] }>(
      "POST", "/formules/tester", { definition, formule, parametres, contexte }),
  /** Aperçu tabulaire des données (corps, variables), sans mise en page. */
  donnees: (versionId: string, parametres: Record<string, unknown>) =>
    appel<ApercuDonnees>("POST", `/versions/${versionId}/donnees`, { parametres }),

  /** Ouvre un document produit dans un nouvel onglet (le fichier exige le jeton : on passe par un blob). */
  async ouvrirDocument(documentId: string, telecharger = false, nom = "document.pdf") {
    const token = tokenStore.get();
    const r = await fetch(`${API_BASE}/editions/documents/${documentId}/fichier`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new ErreurEdition(r.status, e?.detail?.message ?? `Erreur ${r.status}`);
    }
    const url = URL.createObjectURL(await r.blob());
    if (telecharger) {
      const a = document.createElement("a");
      a.href = url;
      a.download = nom;
      a.click();
    } else {
      window.open(url, "_blank", "noopener");
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
};
