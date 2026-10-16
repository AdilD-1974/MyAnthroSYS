/**
 * contexte.ts — Référentiels du designer (catalogue, fonctions, rubriques, masques).
 * Auteur : Adil DAIA — lot 2 (16/10/2026)
 */
import { createContext, useContext } from "react";
import type { Fonction, Masque, SourceCatalogue } from "@/lib/editionsApi";
import type { Definition } from "@/pages/editions/types";

export interface Referentiels {
  sources: SourceCatalogue[];
  fonctions: Fonction[];
  rubriques: { code: string; libelle: string }[];
  masques: Masque[];
  definition: Definition | null;
  lectureSeule: boolean;
}

export const ContexteDesigner = createContext<Referentiels>({
  sources: [], fonctions: [], rubriques: [], masques: [], definition: null, lectureSeule: true,
});

export const useReferentiels = () => useContext(ContexteDesigner);

/** Source d'un jeu de la définition (« b » → BULLETIN). Par défaut : le jeu principal. */
export function sourceDuJeu(d: Definition | null, jeu?: string | null): string | undefined {
  if (!d) return undefined;
  const j = jeu ? d.jeux.find((x) => x.code === jeu) : d.jeux.find((x) => x.role === "PRINCIPAL");
  return j?.source;
}
