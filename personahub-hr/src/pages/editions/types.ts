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
  jeu: string;
  colonnes: Colonne[];
  sections?: Section[];
  repeter_entete?: boolean;
  zebre?: boolean;
  hauteur_ligne?: number;
  section_autres?: string | null;   // titre des lignes hors sections (absent : masquées)
  quadrillage?: "AUCUN" | "COLONNES" | "COMPLET";
  lignes_min?: number;
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

export interface Definition {
  schema_version: 1;
  parametres: Parametre[];
  jeux: Jeu[];
  page?: Page;
  bandes: Bande[];
  sortie?: Sortie;
}

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
