/**
 * types.ts — Structure d'une édition côté écran.
 * Auteur : Adil DAIA — lot 2 (16/10/2026)
 *
 * Miroir exact de personahub-api/app/editions/definition.py (Pydantic, extra
 * interdit) : ne JAMAIS ajouter ici de propriété que le backend ne connaît pas,
 * l'enregistrement serait refusé. Toutes les dimensions sont en millimètres.
 */

export type Expr = string;
export type Verrou = "AUCUN" | "FORME" | "TOTAL";

export type TypeParametre =
  | "PERIODE" | "COLLABORATEUR" | "ORGANISATION" | "PLAN_PAIE" | "DATE" | "ANNEE"
  | "TEXTE" | "NOMBRE" | "BOOLEEN" | "LISTE";

export interface Parametre {
  code: string;
  libelle: string;
  type: TypeParametre;
  obligatoire?: boolean;
  multiple?: boolean;
  defaut?: Expr | null;
  valeurs?: string[] | null;
}

export interface Calcul { code: string; expression: Expr }
export interface Tri { champ: string; sens?: "ASC" | "DESC" }

export interface Jeu {
  code: string;
  source: string;
  role: "PRINCIPAL" | "SECONDAIRE";
  parent?: string | null;
  relation?: string | null;
  champs?: string[];
  filtres?: Expr[];
  calculs?: Calcul[];
  tri?: Tri[];
  groupes?: string[];
  a_date?: Expr | null;
}

export interface Style {
  police?: string | null;
  taille?: number | null;
  gras?: boolean | null;
  italique?: boolean | null;
  souligne?: boolean | null;
  couleur?: string | null;
  fond?: string | null;
  alignement?: "GAUCHE" | "CENTRE" | "DROITE" | "JUSTIFIE" | null;
  alignement_vertical?: "HAUT" | "MILIEU" | "BAS" | null;
  bordures?: string | null;
  epaisseur_bordure?: number | null;
  rotation?: 0 | 90 | 180 | 270;
  langue?: "FR" | "AR" | "AUTO";
}

export interface Condition { expression: Expr; sinon?: "VIDE" | "MASQUER" }

export interface Affichage {
  masque?: string | null;
  texte_avant?: string | null;
  texte_apres?: string | null;
  valeur_si_vide?: string | null;
}

interface ElementBase {
  id: string;
  x: number;
  y: number;
  l: number;
  h: number;
  style?: Style;
  condition?: Condition | null;
  verrou?: Verrou;
  extensible?: boolean;
  calque?: number;
}

export interface ElTexte extends ElementBase { type: "TEXTE"; valeur: Expr; affichage?: Affichage }
export interface ElChamp extends ElementBase { type: "CHAMP"; valeur: Expr; affichage?: Affichage }
export interface ElTexteRiche extends ElementBase { type: "TEXTE_RICHE"; contenu: string }
export interface ElImage extends ElementBase { type: "IMAGE"; valeur: Expr; ajustement?: "CONTENIR" | "REMPLIR" | "ETIRER" }
export interface ElLigne extends ElementBase { type: "LIGNE" }
export interface ElCadre extends ElementBase { type: "CADRE"; arrondi?: number }
export interface ElCodeBarre extends ElementBase { type: "CODE_BARRE"; valeur: Expr; symbologie?: "QR" | "CODE128" }

export interface Colonne {
  id: string;
  titre: string;
  largeur: number;
  valeur: Expr;
  affichage?: Affichage;
  total?: "AUCUN" | "SOMME" | "NB" | "MOYENNE";
  style?: Style;
  masquee?: boolean;
}

/** Une rubrique du plan des lignes (RG-EDT-LIGNES-01). */
export interface LigneRubrique {
  code: string;
  libelle?: string | null;          // libellé imprimé ; défaut : libellé d'édition de la rubrique
  style?: Style;
  valeurs?: Record<string, Expr>;   // id de colonne → formule qui remplace celle de la colonne
  toujours?: boolean;               // imprimée même absente ou à zéro
}

export interface Section {
  id: string;
  titre?: string | null;
  filtre?: Expr | null;             // ignoré si `rubriques` est rempli
  rubriques?: LigneRubrique[];
  sous_total?: boolean;
}

export interface ElTableau extends ElementBase {
  type: "TABLEAU";
  jeu: string;                      // jeu SECONDAIRE (mode expert)…
  corps?: string | null;            // …ou corps de données « lignes »
  corps_suivants?: string[];        // autres corps « lignes » imprimés à la suite
  entete?: boolean;                 // ligne des titres de colonnes (défaut : oui)
  grouper?: boolean;
  colonnes: Colonne[];
  sections?: Section[];
  repeter_entete?: boolean;
  zebre?: boolean;
  hauteur_ligne?: number;
  section_autres?: string | null;   // titre des lignes hors sections (absent : masquées)
  quadrillage?: "AUCUN" | "COLONNES" | "COMPLET";
  lignes_min?: number;
  ligne_total?: boolean;            // ligne des totaux (défaut : oui)
}

export interface ColonneGrille { id: string; titre?: string; largeur: number; affichage?: Affichage; style?: Style }
export interface LigneGrille { id: string; titre?: string; valeurs?: Record<string, Expr>; style?: Style }

/** Zone libre lignes × colonnes, chaque case une formule (cumuls, congés…). RG-EDT-GRILLE-01 */
export interface ElGrille extends ElementBase {
  type: "GRILLE";
  colonnes: ColonneGrille[];
  lignes: LigneGrille[];
  largeur_titres?: number;
  entete?: boolean;
  hauteur_ligne?: number;
  quadrillage?: "AUCUN" | "COLONNES" | "COMPLET";
}

export type Element = ElTexte | ElChamp | ElTexteRiche | ElImage | ElLigne | ElCadre | ElCodeBarre | ElTableau | ElGrille;
export type TypeElement = Element["type"];

export type TypeBande =
  | "EN_TETE_ETAT" | "EN_TETE_PAGE" | "EN_TETE_GROUPE" | "CORPS"
  | "PIED_GROUPE" | "PIED_PAGE" | "PIED_ETAT" | "FOND";

export interface Bande {
  id: string;
  type: TypeBande;
  niveau_groupe?: number | null;
  hauteur: number;
  extensible?: boolean;
  insecable?: boolean;
  saut_avant?: boolean;
  saut_apres?: boolean;
  condition?: Expr | null;
  elements: Element[];
}

export interface Page {
  format?: "A4" | "A3" | "A5" | "LETTRE";
  orientation?: "PORTRAIT" | "PAYSAGE";
  marges?: [number, number, number, number]; // haut, droite, bas, gauche
  charte?: string;
  filigrane?: Expr | null;
}

export interface Sortie {
  formats?: ("PDF" | "XLSX" | "DOCX" | "CSV" | "HTML")[];
  nom_fichier?: Expr;
  eclatement?: string | null;
  qr_verification?: boolean;
}

// ── Données de l'état, définies AVANT la forme (lot 2 bis, Report Manager) ──
export type TypeColonneCorps = "MONTANT" | "NOMBRE" | "TAUX" | "TEXTE" | "DATE";
export interface ColonneCorps { code: string; libelle: string; sigle?: string | null; type?: TypeColonneCorps; masque?: string | null; total?: boolean }
export interface LigneCorps { code: string; libelle: string }
export type AttributAffecte = "NB" | "MT" | "TX" | "BASE" | "PAT" | "VAL";
export interface Affectation {
  rubrique?: string | null;
  formule?: Expr | null;
  periode?: "MOIS" | "CUMUL";
  cibles: Partial<Record<AttributAffecte, string>>;   // colonne (LIGNES) ou « ligne.colonne » (CASES)
  groupe?: string | null;
  libelle?: string | null;
  negatif?: boolean;                // « en – » : soustraite (seule ou dans une ligne fusionnée)
  nulle?: boolean;                  // imprimée même à zéro (jamais sans aucune valeur)
  fusion?: boolean;                 // s'ajoute à la ligne de l'affectation précédente
  gras?: boolean | null;            // défaut : gras pour une formule
}
export interface Corps {
  code: string;
  libelle: string;
  nature: "LIGNES" | "CASES";
  colonnes: ColonneCorps[];
  lignes?: LigneCorps[];
  affectations?: Affectation[];
  tri?: "AFFECTATION" | "PAIE" | "CODE";
  afficher_titre?: boolean;         // titre du corps imprimé (défaut : oui)
  emplacement?: "DETAIL" | "BAS_DE_PAGE" | "MASQUE" | null;   // défaut : DETAIL (lignes), BAS_DE_PAGE (cases)
}
export interface Variable { code: string; libelle: string; type?: "TEXTE" | "NOMBRE" | "MONTANT" | "DATE" | "BOOLEEN"; valeur: Expr }
export interface Usages {
  confidentialite?: number;
  formes_au_choix?: boolean;
  forme_par_defaut?: string | null;
  nb_exemplaires?: number;
  duplicata?: boolean;
  interdire_copies?: boolean;
  export_texte?: boolean;
  nom_export?: Expr | null;
  frequence?: string | null;
}
export interface FormeAlternative { code: string; libelle: string; page?: Page; bandes: Bande[]; sortie?: Sortie }

export interface Definition {
  schema_version: 1;
  // données (le « quoi »)
  parametres: Parametre[];
  jeux: Jeu[];
  corps?: Corps[];
  variables?: Variable[];
  usages?: Usages;
  // mise en forme placée dans l'éditeur (le « comment ») + les autres
  forme_code?: string;
  forme_libelle?: string;
  page?: Page;
  bandes: Bande[];
  sortie?: Sortie;
  formes?: FormeAlternative[];
}

export const ATTRIBUTS_AFFECTABLES: { code: Exclude<AttributAffecte, "VAL">; libelle: string; cumul: boolean }[] = [
  { code: "NB", libelle: "Nb", cumul: true }, { code: "MT", libelle: "Mt", cumul: true }, { code: "TX", libelle: "Tx", cumul: false },
  { code: "BASE", libelle: "Base", cumul: true }, { code: "PAT", libelle: "Patronal", cumul: false },
];

/** Masque par défaut d'une colonne de corps placée dans un tableau. */
export function masqueColonne(c: ColonneCorps): string | null {
  if (c.masque) return c.masque;
  return c.type === "MONTANT" ? "MONTANT_SANS_ZERO" : (c.type === "NOMBRE" || c.type === "TAUX") ? "QUANTITE" : c.type === "DATE" ? "DATE_FR" : null;
}

/** Tableau lié à un corps « lignes » : une colonne libellé puis une par colonne du corps. */
export function tableauDepuisCorps(d: Definition, corpsOuListe: Corps | Corps[], x = 0, y = 0, largeur?: number, id?: string): ElTableau {
  const liste = Array.isArray(corpsOuListe) ? corpsOuListe : [corpsOuListe];
  // colonnes : celles du premier corps, puis celles des suivants qui manquent
  const colonnesCorps: ColonneCorps[] = [];
  liste.forEach((c) => c.colonnes.forEach((col) => { if (!colonnesCorps.some((x) => x.code === col.code)) colonnesCorps.push(col); }));
  const corps: Corps = { ...liste[0], colonnes: colonnesCorps };
  const gen = generateurIds(d);
  const l = largeur ?? largeurUtile(d.page);
  const nb = corps.colonnes.length;
  const lib = Math.max(40, Math.round(l * 0.32));
  const reste = Math.round(((l - lib) / Math.max(nb, 1)) * 10) / 10;
  return {
    id: id ?? gen(`tableau_${corps.code}`), type: "TABLEAU", x, y, l, h: 20, jeu: "", corps: corps.code,
    ...(liste.length > 1 ? { corps_suivants: liste.slice(1).map((c) => c.code) } : {}),
    colonnes: [
      { id: gen("col_libelle"), titre: "Désignation", largeur: Math.round((l - reste * nb) * 10) / 10, valeur: "libelle" },
      ...corps.colonnes.map((c) => ({
        id: gen(`col_${c.code}`), titre: c.libelle, largeur: reste, valeur: c.code,
        ...(masqueColonne(c) ? { affichage: { masque: masqueColonne(c)! } } : {}),
        ...(c.total ? { total: "SOMME" as const } : {}),
      })),
    ],
  };
}

/** Grille liée à un corps « cases » : ses lignes et colonnes, chaque case lisant corps.<corps>.<ligne>.<colonne>. */
export function grilleDepuisCorps(d: Definition, corps: Corps, x = 0, y = 0, largeur?: number, id?: string): ElGrille {
  const gen = generateurIds(d);
  const gid = id ?? gen(`grille_${corps.code}`);
  const l = largeur ?? Math.min(largeurUtile(d.page), 20 + 25 * corps.colonnes.length);
  const titres = 20;
  const lc = Math.round(((l - titres) / Math.max(corps.colonnes.length, 1)) * 10) / 10;
  const colonnes = corps.colonnes.map((c) => ({
    id: gen(`${gid}_${c.code}`), titre: c.libelle, largeur: lc,
    ...(masqueColonne(c) ? { affichage: { masque: c.masque ?? (c.type === "MONTANT" ? "MONTANT" : masqueColonne(c)!) } } : {}),
  }));
  const lignes = (corps.lignes ?? []).map((lg) => ({
    id: gen(`${gid}_${lg.code}`), titre: lg.libelle,
    valeurs: Object.fromEntries(corps.colonnes.map((c, i) => [colonnes[i].id, `corps.${corps.code}.${lg.code}.${c.code}`])),
  }));
  return { id: gid, type: "GRILLE", x, y, l, h: 5 * (lignes.length + 1), largeur_titres: titres, colonnes,
    lignes: lignes.length ? lignes : [{ id: gen(`${gid}_l`), titre: "" }] };
}

/** Place la mise en forme `code` dans l'éditeur (la courante rejoint les autres). La forme
 *  imprimée par défaut ne change pas : elle est désignée par usages.forme_par_defaut. */
export function activerForme(d: Definition, code: string) {
  const i = (d.formes ?? []).findIndex((f) => f.code === code);
  if (i < 0) return;
  const f = d.formes![i];
  const courante: FormeAlternative = { code: d.forme_code ?? "standard", libelle: d.forme_libelle ?? "Mise en forme standard",
    page: d.page, bandes: d.bandes, sortie: d.sortie };
  if (!d.usages?.forme_par_defaut) d.usages = { ...(d.usages ?? {}), forme_par_defaut: courante.code };
  d.formes![i] = courante;
  d.forme_code = f.code; d.forme_libelle = f.libelle; d.page = f.page; d.bandes = f.bandes; d.sortie = f.sortie;
}

/** Variables usuelles d'un bulletin (équivalent des variables sLib_Etb, dtFin… du Report Manager). */
export const VARIABLES_BULLETIN: Variable[] = [
  { code: "societe", libelle: "Raison sociale", valeur: "societe.raison_sociale" },
  { code: "periode_du", libelle: "Période du", type: "DATE", valeur: "periode.date_debut" },
  { code: "periode_au", libelle: "Période au", type: "DATE", valeur: "periode.date_fin" },
  { code: "matricule", libelle: "Matricule", valeur: "identite.matricule" },
  { code: "nom_complet", libelle: "Nom et prénom", valeur: 'identite.nom + " " + identite.prenom' },
  { code: "date_naissance", libelle: "Date de naissance", type: "DATE", valeur: "identite.date_naissance" },
  { code: "date_embauche", libelle: "Date d'embauche", type: "DATE", valeur: "contrat.date_embauche" },
  { code: "situation_familiale", libelle: "Situation familiale", valeur: "situation_familiale.libelle" },
  { code: "nb_deductions", libelle: "Nombre de déductions", type: "NOMBRE", valeur: "situation_familiale.nb_deductions_fiscales" },
  { code: "num_cnss", libelle: "N° CNSS", valeur: "identite.num_cnss" },
  { code: "fonction", libelle: "Fonction", valeur: "affectation.emploi_libelle" },
  { code: "mode_paiement", libelle: "Mode de paiement", valeur: "paiement.mode_libelle" },
  { code: "banque", libelle: "Banque", valeur: "paiement.banque_libelle" },
  { code: "compte", libelle: "N° de compte", valeur: "paiement.numero_compte" },
  { code: "net_a_payer", libelle: "Net à payer", type: "MONTANT", valeur: "net_a_payer" },
];

// ── Constantes d'affichage ──────────────────────────────────────────────────
export const FORMATS_PAGE_MM: Record<string, [number, number]> = {
  A4: [210, 297], A3: [297, 420], A5: [148, 210], LETTRE: [215.9, 279.4],
};
export const MARGES_DEFAUT: [number, number, number, number] = [15, 15, 15, 15];

export const LIBELLES_BANDE: Record<TypeBande, string> = {
  EN_TETE_ETAT: "En-tête d'état (1ʳᵉ page)",
  EN_TETE_PAGE: "En-tête de page",
  EN_TETE_GROUPE: "En-tête de groupe",
  CORPS: "Corps (une fois par ligne)",
  PIED_GROUPE: "Pied de groupe",
  PIED_PAGE: "Pied de page",
  PIED_ETAT: "Pied d'état (dernière page)",
  FOND: "Fond de page",
};

export const LIBELLES_ELEMENT: Record<TypeElement, string> = {
  TEXTE: "Texte", CHAMP: "Champ", TEXTE_RICHE: "Texte à variables", IMAGE: "Image",
  LIGNE: "Ligne", CADRE: "Cadre", CODE_BARRE: "QR / code-barres", TABLEAU: "Tableau", GRILLE: "Grille / cumuls",
};

/** Totaux du bulletin utilisables comme des rubriques ([NET_IMPOSABLE].MT, .CMT pour le cumul). */
export const RUBRIQUES_EN_TETE: { code: string; libelle: string }[] = [
  { code: "TOTAL_BRUT", libelle: "Salaire brut (total)" },
  { code: "BRUT_IMPOSABLE", libelle: "Brut imposable (total)" },
  { code: "TOTAL_GAINS", libelle: "Total des gains" },
  { code: "TOTAL_RETENUES", libelle: "Total des retenues" },
  { code: "COT_SALARIALES", libelle: "Cotisations salariales (total)" },
  { code: "COT_PATRONALES", libelle: "Cotisations patronales (total)" },
  { code: "NET_IMPOSABLE", libelle: "Net imposable (total)" },
  { code: "NET_A_PAYER", libelle: "Net à payer" },
  { code: "COUT_EMPLOYEUR", libelle: "Coût employeur" },
];

export const ATTRIBUTS_RUBRIQUE: { code: string; libelle: string }[] = [
  { code: "MT", libelle: "montant du mois" }, { code: "NB", libelle: "nombre du mois" },
  { code: "TX", libelle: "taux" }, { code: "BASE", libelle: "base du mois" },
  { code: "PAT", libelle: "part patronale du mois" }, { code: "CMT", libelle: "cumul annuel du montant" },
  { code: "CNB", libelle: "cumul annuel du nombre" }, { code: "CBASE", libelle: "cumul annuel de la base" },
];

export const LIBELLES_PARAMETRE: Record<TypeParametre, string> = {
  PERIODE: "Période de paie", COLLABORATEUR: "Collaborateur(s)", ORGANISATION: "Organisation",
  PLAN_PAIE: "Plan de paie", DATE: "Date", ANNEE: "Année", TEXTE: "Texte", NOMBRE: "Nombre",
  BOOLEEN: "Oui / non", LISTE: "Liste de valeurs",
};

// ── Outils ──────────────────────────────────────────────────────────────────
export function dimensionsPage(p?: Page): { l: number; h: number } {
  const [l, h] = FORMATS_PAGE_MM[p?.format ?? "A4"];
  return p?.orientation === "PAYSAGE" ? { l: h, h: l } : { l, h };
}

export function marges(p?: Page): [number, number, number, number] {
  return (p?.marges ?? MARGES_DEFAUT) as [number, number, number, number];
}

export function largeurUtile(p?: Page): number {
  const m = marges(p);
  return dimensionsPage(p).l - m[1] - m[3];
}

/** Tous les identifiants (bandes, éléments, colonnes, sections) : RG-EDT-FORME-03 les veut uniques et stables. */
export function identifiants(d: Definition): Set<string> {
  const ids = new Set<string>();
  for (const b of d.bandes) {
    ids.add(b.id);
    for (const e of b.elements) {
      ids.add(e.id);
      if (e.type === "TABLEAU") {
        e.colonnes.forEach((c) => ids.add(c.id));
        (e.sections ?? []).forEach((s) => ids.add(s.id));
      }
      if (e.type === "GRILLE") {
        e.colonnes.forEach((c) => ids.add(c.id));
        e.lignes.forEach((l) => ids.add(l.id));
      }
    }
  }
  return ids;
}

/** Générateur d'identifiants libres qui se souvient de ceux qu'il a déjà donnés
 *  (indispensable pour un objet pas encore inséré dans la définition). */
export function generateurIds(d: Definition): (prefixe: string) => string {
  const ids = identifiants(d);
  return (prefixe: string) => {
    const base = prefixe.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "el";
    for (let i = 1; ; i++) {
      const id = `${base}_${i}`;
      if (!ids.has(id)) { ids.add(id); return id; }
    }
  };
}

/** Nouvel identifiant lisible et libre : « champ_3 ». Jamais réutilisé dans la définition. */
export function nouvelId(d: Definition, prefixe: string): string {
  const ids = identifiants(d);
  const base = prefixe.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "el";
  for (let i = 1; ; i++) {
    const id = `${base}_${i}`;
    if (!ids.has(id)) return id;
  }
}

export function copie<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

/** Une expression qui n'est qu'un texte entre guillemets : "Bulletin de paie" → Bulletin de paie. */
export function texteLitteral(expr: Expr): string | null {
  const m = /^\s*"((?:[^"]|"")*)"\s*$/.exec(expr ?? "");
  return m ? m[1].replace(/""/g, '"') : null;
}

export function enLitteral(texte: string): Expr {
  return `"${(texte ?? "").replace(/"/g, '""')}"`;
}

/** Chemin d'erreur du backend → position dans la définition. « bandes[1].elements[7].valeur » */
export function cibleErreur(chemin: string): { bande?: number; element?: number; colonne?: number; zone?: string } {
  const b = /bandes\[(\d+)\]/.exec(chemin);
  const e = /elements\[(\d+)\]/.exec(chemin);
  const c = /colonnes\[(\d+)\]/.exec(chemin);
  const zone = /^(jeux|parametres|sortie|page)/.exec(chemin)?.[1];
  return {
    bande: b ? Number(b[1]) : undefined,
    element: e ? Number(e[1]) : undefined,
    colonne: c ? Number(c[1]) : undefined,
    zone,
  };
}

export function elementParDefaut(d: Definition, type: TypeElement, x = 0, y = 0, valeur?: string): Element {
  const id = nouvelId(d, type === "CHAMP" && valeur ? valeur.split(".").pop()! : type);
  switch (type) {
    case "TEXTE": return { id, type, x, y, l: 40, h: 6, valeur: valeur ?? enLitteral("Texte") };
    case "CHAMP": return { id, type, x, y, l: 40, h: 6, valeur: valeur ?? "" };
    case "TEXTE_RICHE": return { id, type, x, y, l: 120, h: 12, contenu: "Texte avec {identite.nom}", extensible: true };
    case "IMAGE": return { id, type, x, y, l: 30, h: 15, valeur: valeur ?? 'CHARTE("logo")' };
    case "LIGNE": return { id, type, x, y, l: 60, h: 0.3 };
    case "CADRE": return { id, type, x, y, l: 60, h: 20 };
    case "CODE_BARRE": return { id, type, x, y, l: 18, h: 18, valeur: valeur ?? enLitteral("PersonaHub") };
    case "GRILLE": {
      // préréglage « cumuls du bulletin » : Mois / Cumul, comme le bloc du bulletin AGIRH
      const cols: [string, string, string][] = [
        ["Salaire brut", "total_brut", "cumul.total_brut"],
        ["Brut imposable", "total_brut_imposable", "cumul.total_brut_imposable"],
        ["Cotis. sal.", "total_cot_salariale", "cumul.total_cot_salariale"],
        ["Cotis. patr.", "total_cot_patronale", "cumul.total_cot_patronale"],
        ["Net imposable", "net_imposable", "cumul.net_imposable"],
        ["Net à payer", "net_a_payer", "cumul.net_a_payer"],
      ];
      const ids = new Set(identifiants(d));
      const libre = (p: string) => { for (let i = 1; ; i++) { const k = `${id}_${p}${i}`; if (!ids.has(k)) { ids.add(k); return k; } } };
      const colonnes = cols.map(([titre]) => ({ id: libre("c"), titre, largeur: 26, affichage: { masque: "MONTANT" } }));
      return {
        id, type, x, y, l: 20 + 26 * cols.length, h: 15, largeur_titres: 20,
        colonnes,
        lignes: [
          { id: libre("l"), titre: "Mois", valeurs: Object.fromEntries(cols.map(([, m], i) => [colonnes[i].id, m])) },
          { id: libre("l"), titre: "Cumul", valeurs: Object.fromEntries(cols.map(([, , c], i) => [colonnes[i].id, c])) },
        ],
      };
    }
    case "TABLEAU": {
      const jeu = d.jeux.find((j) => j.role === "SECONDAIRE")?.code ?? d.jeux[0]?.code ?? "";
      return {
        id, type, x, y, l: 120, h: 20, jeu,
        colonnes: [{ id: nouvelId(d, "col"), titre: "Colonne", largeur: 120, valeur: "" }],
      };
    }
  }
}

export function bandeParDefaut(d: Definition, type: TypeBande): Bande {
  const hauteurs: Record<TypeBande, number> = {
    EN_TETE_ETAT: 20, EN_TETE_PAGE: 20, EN_TETE_GROUPE: 8, CORPS: 6,
    PIED_GROUPE: 8, PIED_PAGE: 10, PIED_ETAT: 15, FOND: 0,
  };
  return { id: nouvelId(d, type), type, hauteur: hauteurs[type], elements: [] };
}

/** Ordre d'affichage des bandes dans le designer (celui du rendu). */
export const ORDRE_BANDES: TypeBande[] = [
  "FOND", "EN_TETE_ETAT", "EN_TETE_PAGE", "EN_TETE_GROUPE", "CORPS", "PIED_GROUPE", "PIED_ETAT", "PIED_PAGE",
];
