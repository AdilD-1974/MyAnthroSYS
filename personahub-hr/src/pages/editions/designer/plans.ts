/**
 * plans.ts — Superposition des objets d'une bande (premier plan, avancer, reculer, arrière-plan).
 * Auteur : Adil DAIA — lot 2 bis (17/10/2026)
 * RG-EDT-FORME-04 (Adil DAIA) : l'ordre d'impression d'une bande est celui des calques
 * (puis de l'ordre de création). Changer de plan renumérote les calques 0..n-1 de la bande.
 */
import type { Definition } from "@/pages/editions/types";

export type Plan = "PREMIER" | "AVANCER" | "RECULER" | "ARRIERE";

export const PLANS: { v: Plan; l: string; raccourci: string }[] = [
  { v: "PREMIER", l: "Mettre au premier plan", raccourci: "Ctrl+Maj+↑" },
  { v: "AVANCER", l: "Avancer d'un plan", raccourci: "Ctrl+↑" },
  { v: "RECULER", l: "Reculer d'un plan", raccourci: "Ctrl+↓" },
  { v: "ARRIERE", l: "Mettre à l'arrière-plan", raccourci: "Ctrl+Maj+↓" },
];

/** Rang de l'objet dans sa bande (1 = tout derrière) et nombre d'objets. */
export function rangPlan(d: Definition, bandeId: string, elId: string): [number, number] {
  const b = d.bandes.find((x) => x.id === bandeId);
  if (!b) return [0, 0];
  const ordre = b.elements.map((e, i) => ({ e, i })).sort((a, c) => (a.e.calque ?? 0) - (c.e.calque ?? 0) || a.i - c.i);
  return [ordre.findIndex((x) => x.e.id === elId) + 1, ordre.length];
}

export function changerPlan(d: Definition, bandeId: string, elId: string, plan: Plan) {
  const b = d.bandes.find((x) => x.id === bandeId);
  if (!b) return;
  const ordre = b.elements.map((e, i) => ({ e, i })).sort((a, c) => (a.e.calque ?? 0) - (c.e.calque ?? 0) || a.i - c.i).map((x) => x.e);
  const i = ordre.findIndex((x) => x.id === elId);
  if (i < 0) return;
  const [el] = ordre.splice(i, 1);
  const j = plan === "PREMIER" ? ordre.length : plan === "ARRIERE" ? 0 : plan === "AVANCER" ? Math.min(i + 1, ordre.length) : Math.max(i - 1, 0);
  ordre.splice(j, 0, el);
  ordre.forEach((x, k) => { if (k) x.calque = k; else delete x.calque; });
}
