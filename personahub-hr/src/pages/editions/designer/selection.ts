/**
 * selection.ts — Opérations sur plusieurs objets : alignement, répartition, même taille,
 * alignement sur la page, déplacement, duplication, copier-coller.
 * Auteur : Adil DAIA — lot 2 bis (18/10/2026)
 *
 * RG-EDT-FORME-05 (Adil DAIA) : les coordonnées d'un objet sont relatives à SA bande.
 * L'alignement horizontal (gauche, centre, droite) et la répartition horizontale valent pour
 * des objets de bandes différentes ; l'alignement vertical et la répartition verticale
 * demandent des objets d'une même bande (sinon « haut » n'aurait pas de sens commun).
 */
import { copie, type Bande, type Definition, type Element } from "@/pages/editions/types";
import { renommerSousParties } from "./Inspecteur";
import type { Selection } from "./useEditeur";

export type Alignement = "GAUCHE" | "CENTRE_H" | "DROITE" | "HAUT" | "MILIEU_V" | "BAS";
export type Repartition = "H" | "V";
export type Taille = "LARGEUR" | "HAUTEUR" | "LES_DEUX";
export type AlignementPage = "GAUCHE" | "CENTRE" | "DROITE";

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Les objets sélectionnés : la sélection multiple, sinon l'objet seul. */
export function idsSelection(s: Selection): string[] {
  if (s.multi && s.multi.length) return s.multi;
  return s.element ? [s.element] : [];
}

export function trouver(d: Definition, ids: string[]): { el: Element; bande: Bande }[] {
  const res: { el: Element; bande: Bande }[] = [];
  for (const b of d.bandes) for (const el of b.elements) if (ids.includes(el.id)) res.push({ el, bande: b });
  return res;
}

export const memeBande = (d: Definition, ids: string[]) => new Set(trouver(d, ids).map((x) => x.bande.id)).size <= 1;

const ajusterBande = (b: Bande, el: Element) => { b.hauteur = Math.max(b.hauteur, el.y + el.h); };

/** Aligne sur l'objet de référence (le premier sélectionné), comme les outils de bureautique. */
export function aligner(d: Definition, ids: string[], mode: Alignement, reference?: string) {
  const objets = trouver(d, ids);
  if (objets.length < 2) return;
  const ref = objets.find((o) => o.el.id === reference)?.el ?? objets[0].el;
  for (const { el, bande } of objets) {
    if (el.id === ref.id) continue;
    switch (mode) {
      case "GAUCHE": el.x = ref.x; break;
      case "CENTRE_H": el.x = r1(ref.x + ref.l / 2 - el.l / 2); break;
      case "DROITE": el.x = r1(ref.x + ref.l - el.l); break;
      case "HAUT": el.y = ref.y; break;
      case "MILIEU_V": el.y = r1(ref.y + ref.h / 2 - el.h / 2); break;
      case "BAS": el.y = r1(ref.y + ref.h - el.h); break;
    }
    el.x = Math.max(0, el.x); el.y = Math.max(0, el.y);
    ajusterBande(bande, el);
  }
}

/** Répartit régulièrement l'espace entre les objets (3 au moins), extrêmes immobiles. */
export function repartir(d: Definition, ids: string[], sens: Repartition) {
  const objets = trouver(d, ids).map((o) => o.el);
  if (objets.length < 3) return;
  const pos = sens === "H" ? (e: Element) => e.x : (e: Element) => e.y;
  const dim = sens === "H" ? (e: Element) => e.l : (e: Element) => e.h;
  objets.sort((a, b) => pos(a) - pos(b));
  const debut = pos(objets[0]);
  const fin = Math.max(...objets.map((e) => pos(e) + dim(e)));
  const espace = (fin - debut - objets.reduce((s, e) => s + dim(e), 0)) / (objets.length - 1);
  let c = debut;
  for (const e of objets) {
    if (sens === "H") e.x = r1(c); else e.y = r1(c);
    c += dim(e) + espace;
  }
}

export function memeTaille(d: Definition, ids: string[], quoi: Taille, reference?: string) {
  const objets = trouver(d, ids);
  const ref = objets.find((o) => o.el.id === reference)?.el ?? objets[0]?.el;
  if (!ref) return;
  for (const { el, bande } of objets) {
    if (quoi !== "HAUTEUR") el.l = ref.l;
    if (quoi !== "LARGEUR") el.h = ref.h;
    ajusterBande(bande, el);
  }
}

/** Aligne sur la largeur utile de la page ; plusieurs objets se déplacent ensemble (leur bloc). */
export function alignerPage(d: Definition, ids: string[], mode: AlignementPage, largeur: number) {
  const objets = trouver(d, ids).map((o) => o.el);
  if (!objets.length) return;
  const g = Math.min(...objets.map((e) => e.x));
  const dr = Math.max(...objets.map((e) => e.x + e.l));
  const dx = mode === "GAUCHE" ? -g : mode === "DROITE" ? largeur - dr : (largeur - (dr - g)) / 2 - g;
  objets.forEach((e) => { e.x = Math.max(0, r1(e.x + dx)); });
}

/** Étend les objets à toute la largeur utile. */
export function pleineLargeur(d: Definition, ids: string[], largeur: number) {
  trouver(d, ids).forEach(({ el }) => { el.x = 0; el.l = largeur; });
}

export function deplacer(d: Definition, ids: string[], dx: number, dy: number, largeur: number) {
  for (const { el, bande } of trouver(d, ids)) {
    el.x = Math.min(Math.max(0, r1(el.x + dx)), Math.max(0, largeur - el.l));
    el.y = Math.max(0, r1(el.y + dy));
    ajusterBande(bande, el);
  }
}

export function supprimer(d: Definition, ids: string[]) {
  for (const b of d.bandes) b.elements = b.elements.filter((e) => !ids.includes(e.id));
}

/** Duplique les objets dans leur bande, décalés de 2 mm ; rend les nouveaux identifiants. */
export function dupliquer(d: Definition, ids: string[]): string[] {
  const nouveaux: string[] = [];
  for (const { el, bande } of trouver(d, ids)) {
    const n = copie(el) as Element;
    renommerSousParties(d, n);
    n.x += 2; n.y += 2;
    bande.elements.push(n);
    ajusterBande(bande, n);
    nouveaux.push(n.id);
  }
  return nouveaux;
}

// ── presse-papiers : gardé dans le navigateur, on peut coller dans un AUTRE modèle ──
const CLE_PP = "editions.presse-papiers";
interface PressePapiers { elements: Element[]; bandeType: string | null }
let memoire: PressePapiers | null = null;

export function copier(d: Definition, ids: string[]): number {
  const objets = trouver(d, ids);
  if (!objets.length) return 0;
  const types = new Set(objets.map((o) => o.bande.type));
  const pp: PressePapiers = { elements: objets.map((o) => copie(o.el) as Element), bandeType: types.size === 1 ? objets[0].bande.type : null };
  memoire = pp;
  try { localStorage.setItem(CLE_PP, JSON.stringify(pp)); } catch { /* reste en mémoire */ }
  return objets.length;
}
export function contenuPressePapiers(): PressePapiers | null {
  try {
    const t = localStorage.getItem(CLE_PP);
    if (t) return JSON.parse(t);
  } catch { /* stockage indisponible */ }
  return memoire;
}

/** Colle dans la bande choisie (sinon : une bande du même type que la copie, sinon la bande Corps). */
export function coller(d: Definition, bandeId: string | null): { bande: string; ids: string[] } | null {
  const pp = contenuPressePapiers();
  if (!pp || !pp.elements.length) return null;
  const b = d.bandes.find((x) => x.id === bandeId)
    ?? d.bandes.find((x) => x.type === pp.bandeType)
    ?? d.bandes.find((x) => x.type === "CORPS") ?? d.bandes[0];
  if (!b) return null;
  const ids: string[] = [];
  const memeEndroit = pp.elements.every((e) => !b.elements.some((x) => x.x === e.x && x.y === e.y));
  for (const src of pp.elements) {
    const n = copie(src) as Element;
    renommerSousParties(d, n);
    if (!memeEndroit) { n.x += 2; n.y += 2; }
    b.elements.push(n);
    ajusterBande(b, n);
    ids.push(n.id);
  }
  return { bande: b.id, ids };
}

/** Objets dont la boîte coupe un rectangle (coordonnées écran). */
export function dansLeLasso(racine: HTMLElement, r: { x1: number; y1: number; x2: number; y2: number }): string[] {
  const g = Math.min(r.x1, r.x2), dr = Math.max(r.x1, r.x2), h = Math.min(r.y1, r.y2), b = Math.max(r.y1, r.y2);
  return Array.from(racine.querySelectorAll<HTMLElement>("[data-element]"))
    .filter((n) => { const x = n.getBoundingClientRect(); return x.right >= g && x.left <= dr && x.bottom >= h && x.top <= b; })
    .map((n) => n.getAttribute("data-element")!);
}
