/**
 * placement.ts — Où chaque corps de données s'imprime dans la mise en forme courante.
 * Auteur : Adil DAIA — lot 2 bis (17/10/2026)
 *
 * RG-EDT-DONNEES-07 (Adil DAIA) : chaque corps déclare son emplacement à l'impression —
 *   DETAIL      : dans le tableau du détail du bulletin, à la suite des autres corps « détail » ;
 *   BAS_DE_PAGE : dans le pied (grille pour un corps « cases », tableau pour un corps « lignes ») ;
 *   MASQUE      : calculé (utilisable par les formules) mais non imprimé.
 * Défaut : DETAIL pour un corps « lignes », BAS_DE_PAGE pour un corps « cases ».
 * Le designer applique ce choix à la mise en forme courante, qui reste ensuite modifiable à la main.
 */
import {
  generateurIds, grilleDepuisCorps, largeurUtile, masqueColonne, tableauDepuisCorps,
  type Bande, type Corps, type Definition, type ElGrille, type ElTableau, type Element, type TypeBande,
} from "./types";

export type Emplacement = "DETAIL" | "BAS_DE_PAGE" | "MASQUE";

export const EMPLACEMENTS: { v: Emplacement; l: string; aide: string }[] = [
  { v: "DETAIL", l: "Détail du bulletin", aide: "Lignes ajoutées au tableau du détail, après les corps précédents" },
  { v: "BAS_DE_PAGE", l: "Bas de page", aide: "Zone placée dans le pied du document (cumuls, récapitulatifs…)" },
  { v: "MASQUE", l: "Non imprimé", aide: "Calculé et utilisable dans les formules, mais pas imprimé" },
];

export const emplacementDe = (c: Corps): Emplacement => c.emplacement ?? (c.nature === "CASES" ? "BAS_DE_PAGE" : "DETAIL");

const PIEDS: TypeBande[] = ["PIED_ETAT", "PIED_PAGE"];

export interface Usage { bande: Bande; element: ElTableau | ElGrille; role: "principal" | "suite" | "cases" }

/** Les éléments de la forme courante qui impriment ce corps. */
export function usagesDuCorps(d: Definition, code: string): Usage[] {
  const r: Usage[] = [];
  for (const b of d.bandes) for (const el of b.elements) {
    if (el.type === "TABLEAU") {
      if (el.corps === code) r.push({ bande: b, element: el, role: "principal" });
      else if ((el.corps_suivants ?? []).includes(code)) r.push({ bande: b, element: el, role: "suite" });
    } else if (el.type === "GRILLE") {
      const cite = el.lignes.some((l) => Object.values(l.valeurs ?? {}).some((f) => f?.includes(`corps.${code}.`)));
      if (cite) r.push({ bande: b, element: el, role: "cases" });
    }
  }
  return r;
}

export const libelleBande = (t: TypeBande) => ({
  EN_TETE_ETAT: "En-tête d'état", EN_TETE_PAGE: "En-tête de page", EN_TETE_GROUPE: "En-tête de groupe", CORPS: "Corps",
  PIED_GROUPE: "Pied de groupe", PIED_PAGE: "Pied de page", PIED_ETAT: "Pied d'état", FOND: "Fond",
} as Record<TypeBande, string>)[t];

/** L'emplacement réel dans la forme courante est-il celui demandé ? */
export function placementConforme(d: Definition, c: Corps): boolean {
  const u = usagesDuCorps(d, c.code);
  const e = emplacementDe(c);
  if (e === "MASQUE") return u.length === 0;
  if (!u.length) return false;
  return e === "BAS_DE_PAGE" ? u.every((x) => PIEDS.includes(x.bande.type)) : u.every((x) => !PIEDS.includes(x.bande.type));
}

const basDesElements = (b: Bande) => b.elements.reduce((m, el) => Math.max(m, el.y + el.h), 0);

/** Retire le corps de la forme courante (tableaux et grilles qui l'impriment). */
function retirer(d: Definition, code: string) {
  for (const b of d.bandes) {
    b.elements = b.elements.flatMap((el): Element[] => {
      if (el.type === "TABLEAU") {
        if (el.corps === code) {
          const [suivant, ...reste] = el.corps_suivants ?? [];
          if (!suivant) return [];                                   // tableau de ce seul corps : retiré
          el.corps = suivant;
          el.corps_suivants = reste;
          if (!reste.length) delete el.corps_suivants;
        } else if (el.corps_suivants?.includes(code)) {
          el.corps_suivants = el.corps_suivants.filter((x) => x !== code);
          if (!el.corps_suivants.length) delete el.corps_suivants;
        }
        return [el];
      }
      if (el.type === "GRILLE") {
        const formules = el.lignes.flatMap((l) => Object.values(l.valeurs ?? {}));
        if (formules.length && formules.every((f) => !f || f.includes(`corps.${code}.`))) return [];   // grille de ce seul corps
      }
      return [el];
    });
  }
}

/** Ajoute au tableau les colonnes du corps qui lui manquent, en gardant la largeur totale. */
function completerColonnes(d: Definition, t: ElTableau, c: Corps) {
  const gen = generateurIds(d);
  const manquantes = c.colonnes.filter((col) => !t.colonnes.some((x) => x.valeur === col.code));
  if (!manquantes.length) return;
  const libelle = t.colonnes.find((x) => x.valeur === "libelle");
  const autres = t.colonnes.filter((x) => x !== libelle);
  const moyenne = autres.length ? autres.reduce((s, x) => s + x.largeur, 0) / autres.length : 20;
  t.colonnes.push(...manquantes.map((col) => ({
    id: gen(`col_${col.code}`), titre: col.libelle, largeur: moyenne, valeur: col.code,
    ...(masqueColonne(col) ? { affichage: { masque: masqueColonne(col)! } } : {}),
    ...(col.total ? { total: "SOMME" as const } : {}),
  })));
  const total = t.colonnes.reduce((s, x) => s + x.largeur, 0);
  const k = t.l / total;
  t.colonnes.forEach((x) => { x.largeur = Math.round(x.largeur * k * 10) / 10; });
}

function bandeDuPied(d: Definition): Bande {
  const b = d.bandes.find((x) => x.type === "PIED_ETAT") ?? d.bandes.find((x) => x.type === "PIED_PAGE");
  if (b) return b;
  const gen = generateurIds(d);
  const nouvelle: Bande = { id: gen("pied_etat"), type: "PIED_ETAT", hauteur: 10, elements: [] };
  d.bandes.push(nouvelle);
  return nouvelle;
}

/** Applique l'emplacement demandé à la forme courante. Rend un compte rendu lisible. */
export function placerCorps(d: Definition, code: string): string {
  const c = (d.corps ?? []).find((x) => x.code === code);
  if (!c) return "";
  const e = emplacementDe(c);
  retirer(d, code);
  if (e === "MASQUE") return `« ${c.libelle} » n'est plus imprimé.`;

  if (e === "DETAIL" && c.nature === "LIGNES") {
    // le tableau du détail : celui d'un autre corps « détail », dans une bande hors pied
    const detail = (d.corps ?? []).filter((x) => x.code !== code && x.nature === "LIGNES" && emplacementDe(x) === "DETAIL").map((x) => x.code);
    for (const b of d.bandes) {
      if (PIEDS.includes(b.type)) continue;
      const t = b.elements.find((el): el is ElTableau => el.type === "TABLEAU" && !!el.corps && detail.includes(el.corps));
      if (t) {
        // à sa place dans l'ordre des corps (onglet Définition)
        const ordre = (d.corps ?? []).map((x) => x.code);
        const liste = [t.corps!, ...(t.corps_suivants ?? []), code].sort((a, b2) => ordre.indexOf(a) - ordre.indexOf(b2));
        t.corps = liste[0];
        t.corps_suivants = liste.slice(1);
        completerColonnes(d, t, c);
        return `« ${c.libelle} » est imprimé dans le tableau du détail (${libelleBande(b.type)}).`;
      }
    }
    const b = d.bandes.find((x) => x.type === "CORPS") ?? d.bandes[0];
    const y = basDesElements(b) + (b.elements.length ? 2 : 0);
    b.elements.push(tableauDepuisCorps(d, c, 0, y));
    b.hauteur = Math.max(b.hauteur, y + 22);
    return `Un tableau « ${c.libelle} » a été ajouté dans la bande ${libelleBande(b.type)}.`;
  }

  // bas de page (ou corps « cases » demandé au détail : une grille dans la bande Corps)
  const b = e === "BAS_DE_PAGE" ? bandeDuPied(d) : (d.bandes.find((x) => x.type === "CORPS") ?? d.bandes[0]);
  const y = basDesElements(b) + (b.elements.length ? 2 : 0);
  const el: Element = c.nature === "CASES"
    ? grilleDepuisCorps(d, c, 0, y)
    : tableauDepuisCorps(d, c, 0, y, largeurUtile(d.page));
  b.elements.push(el);
  b.hauteur = Math.max(b.hauteur, y + el.h + 2);
  return `« ${c.libelle} » a été placé dans la bande ${libelleBande(b.type)} — ajustez sa position dans « 2. Mise en forme ».`;
}
