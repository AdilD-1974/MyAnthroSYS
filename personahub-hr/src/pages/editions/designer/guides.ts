/**
 * guides.ts — Repères magnétiques pendant un déplacement (alignement sur les autres objets).
 * Auteur : Adil DAIA — lot 2 bis (18/10/2026)
 * Verticaux (x) : bords et centres de TOUS les objets de la page, bords et centre de la page.
 * Horizontaux (y) : bords et centres des objets de la même bande. Alt : pas d'aimantation.
 */
import { useSyncExternalStore } from "react";
import type { Definition } from "@/pages/editions/types";

export interface Guides { x: number[]; y: { bande: string; v: number }[] }
let courant: Guides = { x: [], y: [] };
const abonnes = new Set<() => void>();
export function poserGuides(g: Guides) { courant = g; abonnes.forEach((f) => f()); }
export function useGuides(): Guides {
  return useSyncExternalStore((f) => { abonnes.add(f); return () => abonnes.delete(f); }, () => courant);
}

/** Cherche, pour la boîte déplacée, l'aimantation la plus proche (seuil en mm). */
export function aimanter(d: Definition, bandeId: string, exclus: string[], box: { x: number; y: number; l: number; h: number },
  largeur: number, seuil: number): { dx: number; dy: number; guides: Guides } {
  const cx: number[] = [0, largeur / 2, largeur];
  const cy: number[] = [];
  for (const b of d.bandes) for (const e of b.elements) {
    if (exclus.includes(e.id)) continue;
    cx.push(e.x, e.x + e.l / 2, e.x + e.l);
    if (b.id === bandeId) cy.push(e.y, e.y + e.h / 2, e.y + e.h);
  }
  const meilleur = (bords: number[], cibles: number[]) => {
    let best: { delta: number; v: number } | null = null;
    for (const b of bords) for (const c of cibles) {
      const delta = c - b;
      if (Math.abs(delta) <= seuil && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, v: c };
    }
    return best;
  };
  const mx = meilleur([box.x, box.x + box.l / 2, box.x + box.l], cx);
  const my = meilleur([box.y, box.y + box.h / 2, box.y + box.h], cy);
  const dx = mx?.delta ?? 0, dy = my?.delta ?? 0;
  // tous les repères atteints après aimantation (plusieurs bords peuvent coïncider)
  const proche = (a: number, b: number) => Math.abs(a - b) < 0.05;
  const gx = [box.x + dx, box.x + dx + box.l / 2, box.x + dx + box.l].filter((v) => mx && cx.some((c) => proche(c, v)));
  const gy = [box.y + dy, box.y + dy + box.h / 2, box.y + dy + box.h].filter((v) => my && cy.some((c) => proche(c, v)));
  return { dx, dy, guides: { x: [...new Set(gx)], y: [...new Set(gy)].map((v) => ({ bande: bandeId, v })) } };
}
