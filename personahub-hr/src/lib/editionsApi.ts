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
import type { Definition, Parametre } from "@/pages/editions/types";

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
export interface PoliceEdition { nom: string; origine: "PDF" | "TrueType"; gras: boolean; italique: boolean }
export interface ImageEdition { code: string; format: string; taille: number; modifie_le: string; formule: string }
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
  /** RG-EDT-ACTIF-01 : actif pour la société active (inactif : ni proposé ni lançable). */
  actif?: boolean;
  /** RG-EDT-THEME-01/02 : thème choisi (null : celui de la catégorie). */
  theme_id?: string | null;
  theme_effectif_id?: string | null;
  theme_libelle?: string | null;
  theme_module?: string | null;
  theme_implicite?: boolean;
}

export interface Theme {
  id: string;
  code: string;
  libelle: string;
  module: string;
  parent_id: string | null;
  societe_id: string | null;
  categorie_defaut: Categorie | null;
  ordre: number;
  actif: boolean;
  est_systeme: boolean;
}
export interface ThemeMenu extends Theme { modeles: ModeleEcran[] }
export interface ArbreMenu { module: string; libelle: string; themes: ThemeMenu[] }

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
    rubriques?: ({ code: string; libelle: string; absente: boolean } & Record<"NB" | "BASE" | "TX" | "MT" | "PAT" | "TXP" | "CNB" | "CBASE" | "CMT" | "CPAT", string | null>)[];
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

// ── Menus métier (RG-EDT-ECRAN-01..06) ─────────────────────────────────────
export interface Ecran {
  code_ecran: string;
  libelle: string;
  module_libelle: string | null;
  chemin_route: string | null;
  categorie_edition: Categorie | null;
  contexte_disponible: string[];
}
export interface RattachementEcran {
  code_ecran: string;
  par_defaut: boolean;
  libelle?: string;
  module_libelle?: string | null;
  chemin_route?: string | null;
  /** Proposé d'office (aucun rattachement dans la société pour cet écran). */
  implicite?: boolean;
}
export interface ModeleEcran {
  id: string;
  code: string;
  libelle: string;
  description?: string | null;
  categorie: Categorie;
  est_systeme: boolean;
  numero_publie: number;
  par_defaut: boolean;
  parametres: Parametre[];
  formes: { code: string; libelle: string }[];
  forme_par_defaut: string | null;
}
/** Contexte transmis par l'écran : il remplit les paramètres du modèle selon leur type. */
export interface ContexteEcran {
  periode_id?: string | null;
  plan_paie_id?: string | null;
  collaborateur_id?: string | null;
  collaborateur_ids?: string[];
  bulletin_id?: string | null;
  annee?: number | null;
}

async function pdfAvecJeton(chemin: string): Promise<Blob> {
  const token = tokenStore.get();
  const r = await fetch(`${API_BASE}/editions${chemin}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new ErreurEdition(r.status, e?.detail?.message ?? `Erreur ${r.status}`);
  }
  return r.blob();
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

  modeles: (categorie?: string, archives = false) => {
    const q = new URLSearchParams();
    if (categorie) q.set("categorie", categorie);
    if (archives) q.set("archives", "true");
    return appel<Modele[]>("GET", `/modeles${q.toString() ? `?${q}` : ""}`);
  },
  /** RG-EDT-MODELE-04 : archiver (réversible) — RG-EDT-MODELE-05 : supprimer (jamais publié). */
  archiver: (id: string, archive = true) => appel<Modele>("POST", `/modeles/${id}/archivage`, { archive }),
  supprimerModele: (id: string) => appel<void>("DELETE", `/modeles/${id}`),
  modele: (id: string) => appel<Modele>("GET", `/modeles/${id}`),
  /** Libellé, description, catégorie (type), visibilité — sans nouvelle version (RG-EDT-MODELE-03). */
  modifierModele: (id: string, corps: { libelle?: string; description?: string; categorie?: Categorie; visibilite?: Visibilite }) =>
    appel<Modele>("PATCH", `/modeles/${id}`, corps),
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
  polices: () => appel<PoliceEdition[]>("GET", "/polices"),
  // ── bibliothèque d'images (RG-EDT-IMAGE-01..03) ──
  images: () => appel<ImageEdition[]>("GET", "/images"),
  supprimerImage: (code: string) => appel<void>("DELETE", `/images/${encodeURIComponent(code)}`),
  async deposerImage(fichier: File, code: string, remplacer = false): Promise<ImageEdition> {
    const token = tokenStore.get();
    const f = new FormData();
    f.append("fichier", fichier);
    f.append("code", code);
    f.append("remplacer", remplacer ? "true" : "false");
    const r = await fetch(`${API_BASE}/editions/images`, { method: "POST", body: f, headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      const d = e?.detail;
      throw new ErreurEdition(r.status, (d && typeof d === "object" && !Array.isArray(d) ? d.message : null) ?? `Erreur ${r.status}`);
    }
    return r.json();
  },
  /** Logo de la société active en URL locale (canevas). */
  async urlLogo(): Promise<string | null> {
    const token = tokenStore.get();
    const r = await fetch(`${API_BASE}/editions/logo`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return r.ok ? URL.createObjectURL(await r.blob()) : null;
  },
  /** Image de la bibliothèque en URL locale (blob) : le fichier exige le jeton. */
  async urlImage(code: string): Promise<string | null> {
    const token = tokenStore.get();
    const r = await fetch(`${API_BASE}/editions/images/${encodeURIComponent(code)}/fichier`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return r.ok ? URL.createObjectURL(await r.blob()) : null;
  },

  // ── thèmes, actif, menu en arborescence (RG-EDT-THEME/ACTIF/MENU) ──
  themes: (module?: string) => appel<Theme[]>("GET", `/themes${module ? `?module=${module}` : ""}`),
  creerTheme: (corps: { libelle: string; module?: string; parent_id?: string | null }) => appel<Theme>("POST", "/themes", corps),
  modifierTheme: (id: string, corps: { libelle?: string; parent_id?: string | null; ordre?: number; actif?: boolean }) =>
    appel<Theme>("PATCH", `/themes/${id}`, corps),
  supprimerTheme: (id: string) => appel<void>("DELETE", `/themes/${id}`),
  /** theme_id : undefined = inchangé, null = thème de la catégorie. */
  reglerModele: (modeleId: string, corps: { actif?: boolean; theme_id?: string | null; ordre?: number }) =>
    appel<Modele>("PUT", `/modeles/${modeleId}/reglage`, { ...corps, theme_id: corps.theme_id === undefined ? "" : corps.theme_id }),
  menuModule: (module: string, tout = false) => appel<ArbreMenu>("GET", `/menus/${module}${tout ? "?tout=true" : ""}`),
  lancerMenu: (module: string, corps: { modele_id: string; parametres?: Record<string, unknown>; forme?: string }) =>
    appel<{ demande_id: string; statut: string; documents: DocumentProduit[]; modele: { id: string; code: string; libelle: string } }>(
      "POST", `/menus/${module}/demandes`, corps),

  // ── menus métier ──
  ecrans: () => appel<Ecran[]>("GET", "/ecrans"),
  ecransDuModele: (modeleId: string) => appel<RattachementEcran[]>("GET", `/modeles/${modeleId}/ecrans`),
  rattacher: (modeleId: string, ecrans: { code_ecran: string; par_defaut: boolean }[]) =>
    appel<RattachementEcran[]>("PUT", `/modeles/${modeleId}/ecrans`, { ecrans }),
  modelesEcran: (codeEcran: string) =>
    appel<{ ecran: Ecran; modeles: ModeleEcran[]; defaut: string | null }>("GET", `/ecrans/${codeEcran}/modeles`),
  lancerEcran: (codeEcran: string, corps: { modele_id?: string; contexte?: ContexteEcran; parametres?: Record<string, unknown>; forme?: string }) =>
    appel<{ demande_id: string; statut: string; documents: DocumentProduit[]; modele: { id: string; code: string; libelle: string } }>(
      "POST", `/ecrans/${codeEcran}/demandes`, corps),
  /** Tous les documents d'une demande en un seul PDF (impression en série). */
  pdfDemande: (demandeId: string) => pdfAvecJeton(`/ecrans/demandes/${demandeId}/pdf`),
  pdfDocumentEcran: (documentId: string) => pdfAvecJeton(`/ecrans/documents/${documentId}/fichier`),

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
