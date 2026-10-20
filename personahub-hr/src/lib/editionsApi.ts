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

/** RG-EDT-RUBRIQUES-01 : rubrique de paie, avec de quoi la filtrer dans le designer. */
export interface RubriqueInfo {
  code: string;
  libelle: string;
  famille?: string | null; famille_libelle?: string | null;
  type?: string | null; type_libelle?: string | null;          // nature
  flux?: string | null; flux_libelle?: string | null;
  frequence?: string | null; frequence_libelle?: string | null;
  ordre_calcul?: number | null;
  assiettes?: string[];                                          // assiettes qu'elle alimente
}

export interface AccesEtat {
  code: string;
  existe: boolean;                 // l'élément a son propre écran de navigation
  actif: boolean | null;
  roles: string[];                 // rôles propres, ou hérités (herite_de)
  herite_de: "dossier" | null;
  roles_disponibles: { code: string; libelle: string }[];
  peut_regler: boolean;
}

export interface SourceCatalogue {
  code: string;
  libelle: string;
  nature: string;
  contexte_requis: string[];
  champs: ChampCatalogue[];
  relations: { code: string; cible: string; cardinalite: "UN" | "PLUSIEURS" }[];
}

// ── Dictionnaire des données (RG-EDT-DICO-01..08) ─────────────────────────────
export type ModeChamp = "COLONNE" | "RECHERCHE";
export type Agregat = "PREMIER" | "DERNIER" | "NB" | "SOMME" | "LISTE";
export interface ConditionDico { colonne: string; operateur: string; valeur?: string | null }
export interface DefinitionChamp {
  mode: ModeChamp;
  colonne?: string | null;
  cle_ligne?: string | null;
  table_cible?: string | null;
  colonne_cle?: string | null;
  colonne_valeur?: string | null;
  colonne_date_debut?: string | null;
  colonne_date_fin?: string | null;
  date_reference?: "PERIODE" | "AUJOURDHUI";
  agregat?: Agregat;
  colonne_ordre?: string | null;
  conditions?: ConditionDico[];
}
export interface ChampDico extends ChampCatalogue {
  visible: boolean;
  perso: boolean;
  libelle_modifie: boolean;
  groupe_modifie: boolean;
  description: string | null;
  definition: (DefinitionChamp & { code: string; source_code: string }) | null;
}
export interface DefinitionSource {
  code?: string;
  libelle?: string;
  description?: string | null;
  table_principale: string;
  colonne_cle?: string | null;
  colonne_societe?: string | null;
  colonne_collaborateur?: string | null;
  conditions?: ConditionDico[];
  colonnes?: string[];
}
export interface RelationDico { code: string; cible: string; cardinalite: "UN" | "PLUSIEURS"; cle_source: string; cle_cible: string; perso: boolean; libelle: string | null }
export interface SourceDico {
  code: string;
  libelle: string;
  nature: string;
  perso: boolean;
  contexte_requis: string[];
  definition: DefinitionSource | null;
  champs: ChampDico[];
  relations: RelationDico[];
}
export interface TableDico {
  nom: string;
  colonnes: { nom: string; type: string; type_donnee: ChampCatalogue["type_donnee"] }[];
  a_societe: boolean;
  a_collaborateur: boolean;
  referentiel: boolean;
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

export interface CollaborateurPaye { id: string; matricule: string | null; nom: string | null; prenom: string | null; nb_bulletins: number }

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

// ── Filtres de population (RG-EDT-FILTRE-01..03) ───────────────────────────
export interface UoFiltre { id: string; parent_id: string | null; code: string | null; libelle: string; niveau: number | null }
export interface FiltresValeurs {
  uos: UoFiltre[];
  criteres: { code: string; libelle: string; options: { code: string; libelle: string }[] }[];
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
  /** Mois (1-12) : avec l'année, donne le paramètre MOIS (ex. mois de sortie d'un départ). */
  mois?: number | null;
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
  // dictionnaire des données (RG-EDT-DICO) : consultation (concevoir), configuration (administrer)
  dictionnaire: () => appel<{ sources: SourceDico[]; peut_administrer: boolean }>("GET", "/dictionnaire"),
  dicoTables: () => appel<TableDico[]>("GET", "/dictionnaire/tables"),
  dicoApercuTable: (table: string, colonnes: string[] = []) =>
    appel<{ colonnes: string[]; lignes: Record<string, unknown>[] }>("GET", `/dictionnaire/tables/${encodeURIComponent(table)}/apercu?colonnes=${encodeURIComponent(colonnes.join(","))}`),
  dicoCreerSource: (s: DefinitionSource) => appel<{ code: string }>("POST", "/dictionnaire/sources", s),
  dicoModifierSource: (code: string, s: DefinitionSource) => appel<{ code: string }>("PUT", `/dictionnaire/sources/${code}`, s),
  dicoSupprimerSource: (code: string) => appel<{ ok: boolean }>("DELETE", `/dictionnaire/sources/${code}`),
  dicoApercuSource: (code: string) => appel<{ total: number; lignes: Record<string, unknown>[] }>("GET", `/dictionnaire/sources/${code}/apercu`),
  dicoCreerChamp: (source: string, c: DefinitionChamp & { code: string; libelle: string; groupe?: string; type_donnee?: string; masque_defaut?: string | null; sensible?: boolean; description?: string | null }) =>
    appel<{ code: string; type_donnee: string }>("POST", `/dictionnaire/sources/${source}/champs`, c),
  dicoModifierChamp: (source: string, code: string, c: Partial<Pick<ChampDico, "libelle" | "groupe" | "masque_defaut" | "sensible" | "visible" | "description" | "type_donnee">> & { reinitialiser?: boolean; definition?: DefinitionChamp }) =>
    appel<{ ok: boolean }>("PUT", `/dictionnaire/sources/${source}/champs/${encodeURIComponent(code)}`, c),
  dicoSupprimerChamp: (source: string, code: string) => appel<{ ok: boolean }>("DELETE", `/dictionnaire/sources/${source}/champs/${encodeURIComponent(code)}`),
  dicoTesterChamp: (source: string, definition: DefinitionChamp, cles: string[] = []) =>
    appel<{ resultats: { cle: string; valeur: unknown; nb_lignes: number }[] }>("POST", `/dictionnaire/sources/${source}/tester`, { definition, cles }),
  dicoCreerRelation: (r: { source: string; cible: string; code?: string; libelle?: string; cle_source: string; cle_cible: string; cardinalite: "UN" | "PLUSIEURS" }) =>
    appel<{ code: string }>("POST", "/dictionnaire/relations", r),
  dicoSupprimerRelation: (source: string, code: string) => appel<{ ok: boolean }>("DELETE", `/dictionnaire/relations/${source}/${code}`),
  fonctions: () => appel<Fonction[]>("GET", "/fonctions"),
  masques: () => appel<Masque[]>("GET", "/masques"),
  rubriques: () => appel<RubriqueInfo[]>("GET", "/rubriques"),
  analyser: (expression: string, source?: string, parametres: string[] = []) =>
    appel<Analyse>("POST", "/expressions/analyser", { expression, source, parametres }),
  periodes: () => appel<Periode[]>("GET", "/parametres/periodes"),
  plansPaie: (annee?: number) => appel<{ id: string; code: string; libelle: string }[]>("GET", `/parametres/plans-paie${annee ? `?annee=${annee}` : ""}`),
  /** RG-EDT-LANCEMENT-01 : salariés payés dans l'année / le mois / les périodes choisis (sortis compris). */
  collaborateursPayes: (f: { annee?: number; mois?: number; periodes?: string[] }) => {
    const q = new URLSearchParams();
    if (f.annee) q.set("annee", String(f.annee));
    if (f.mois) q.set("mois", String(f.mois));
    if (f.periodes?.length) q.set("periodes", f.periodes.join(","));
    return appel<CollaborateurPaye[]>("GET", `/parametres/collaborateurs${q.toString() ? `?${q}` : ""}`);
  },

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
  // RG-EDT-NAV-02 : un état ou un dossier devient un écran de la navigation
  ecranNavigation: (type: "MODELE" | "DOSSIER", id: string) =>
    appel<{ disponible: boolean; existe: boolean; peut_generer: boolean; chemin?: string; libelle?: string }>("GET", `/navigation?type=${type}&id=${encodeURIComponent(id)}`),
  genererEcran: (type: "MODELE" | "DOSSIER", id: string, libelle?: string) =>
    appel<{ code: string; chemin: string; libelle: string; cree: boolean }>("POST", "/navigation", { type, id, libelle }),
  retirerEcran: (type: "MODELE" | "DOSSIER", id: string) => appel<{ ok: boolean }>("DELETE", `/navigation?type=${type}&id=${encodeURIComponent(id)}`),
  // RG-EDT-ACCES-01..03 : rôles qui voient un état ou un dossier (rôles de son écran de navigation)
  acces: (type: "MODELE" | "DOSSIER", id: string) => appel<AccesEtat>("GET", `/acces?type=${type}&id=${encodeURIComponent(id)}`),
  reglerAcces: (type: "MODELE" | "DOSSIER", id: string, roles: string[]) => appel<AccesEtat>("PUT", "/acces", { type, id, roles }),
  publierNavigation: (module: string, avec_etats: boolean) =>
    appel<{ crees: number; mis_a_jour: number; retires: number }>("POST", "/navigation/publier", { module, avec_etats }),
  menuModule: (module: string, tout = false) => appel<ArbreMenu>("GET", `/menus/${module}${tout ? "?tout=true" : ""}`),
  lancerMenu: (module: string, corps: { modele_id: string; parametres?: Record<string, unknown>; forme?: string }) =>
    appel<{ demande_id: string; statut: string; documents: DocumentProduit[]; modele: { id: string; code: string; libelle: string } }>(
      "POST", `/menus/${module}/demandes`, corps),

  filtresPopulation: () => appel<FiltresValeurs>("GET", "/filtres"),
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
