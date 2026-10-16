/**
 * src/hooks/useSortableTable.ts
 *
 * Hook générique de tri, réutilisable sur TOUT tableau du module Simulation
 * (surcharges, lignes de bulletin, écarts, scénarios) — un seul mécanisme de
 * tri partagé plutôt qu'une logique réécrite dans chaque tableau.
 *
 * Le tri gère nativement les valeurs numériques stockées en string
 * (Decimal → JSON string côté API, ex. "1250.00") : une colonne déclarée
 * `type: "numeric"` est comparée numériquement, pas lexicographiquement
 * (sinon "900" > "1000" au tri alphabétique — bug classique sur ce genre
 * de données).
 */
import { useMemo, useState } from "react";

export type SensTri = "asc" | "desc";

export interface ColonneTriable<T> {
  cle: keyof T | string;
  type?: "texte" | "numeric" | "date";
  accesseur?: (ligne: T) => unknown; // pour une valeur dérivée / imbriquée
}

function valeurTri<T>(ligne: T, colonne: ColonneTriable<T>): unknown {
  if (colonne.accesseur) return colonne.accesseur(ligne);
  return (ligne as Record<string, unknown>)[colonne.cle as string];
}

function comparer(a: unknown, b: unknown, type: ColonneTriable<unknown>["type"]): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;

  if (type === "numeric") {
    const na = typeof a === "number" ? a : parseFloat(String(a).replace(",", "."));
    const nb = typeof b === "number" ? b : parseFloat(String(b).replace(",", "."));
    if (Number.isNaN(na) && Number.isNaN(nb)) return 0;
    if (Number.isNaN(na)) return -1;
    if (Number.isNaN(nb)) return 1;
    return na - nb;
  }
  if (type === "date") {
    return new Date(String(a)).getTime() - new Date(String(b)).getTime();
  }
  return String(a).localeCompare(String(b), "fr");
}

export function useSortableTable<T>(
  donnees: T[],
  colonnes: Record<string, ColonneTriable<T>>,
  triInitial?: { cle: string; sens: SensTri }
) {
  const [tri, setTri] = useState<{ cle: string; sens: SensTri } | null>(triInitial ?? null);

  const donneesTriees = useMemo(() => {
    if (!tri) return donnees;
    const colonne = colonnes[tri.cle];
    if (!colonne) return donnees;
    const copie = [...donnees];
    copie.sort((a, b) => {
      const cmp = comparer(valeurTri(a, colonne), valeurTri(b, colonne), colonne.type);
      return tri.sens === "asc" ? cmp : -cmp;
    });
    return copie;
  }, [donnees, tri, colonnes]);

  function basculerTri(cle: string) {
    setTri((precedent) => {
      if (!precedent || precedent.cle !== cle) return { cle, sens: "asc" };
      if (precedent.sens === "asc") return { cle, sens: "desc" };
      return null; // 3e clic : retour à l'ordre naturel
    });
  }

  return { donneesTriees, tri, basculerTri };
}
