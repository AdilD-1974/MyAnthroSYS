/**
 * useTableSort.ts — Hook de tri de tableaux par colonne
 * Auteur : Adil DAIA
 *
 * Tri tri-état : asc → desc → none → asc → …
 * Gère automatiquement les valeurs null, les nombres, les booléens et les dates.
 *
 * Usage :
 *
 *   const { sortedData, sortKey, sortDir, toggleSort, SortIcon } =
 *     useTableSort(rubriques, "code");
 *
 *   <th onClick={() => toggleSort("libelle")} className="cursor-pointer">
 *     Libellé <SortIcon column="libelle" />
 *   </th>
 *
 *   {sortedData.map(...)}
 *
 * On peut aussi passer un getter custom pour un champ calculé :
 *   getValue: (row, key) => key === "famille_label" ? labelFamilles[row.code_famille] : row[key]
 */

import React, { useState, useMemo } from "react";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

type SortDir = "asc" | "desc" | null;

interface UseTableSortOptions<T> {
  /** Clé initiale de tri (optionnel) */
  initialKey?: keyof T | string;
  /** Direction initiale de tri (par défaut "asc") */
  initialDir?: "asc" | "desc";
  /** Getter custom pour les colonnes calculées */
  getValue?: (row: T, key: string) => any;
}

interface UseTableSortReturn<T> {
  sortedData: T[];
  sortKey: string | null;
  sortDir: SortDir;
  toggleSort: (key: string) => void;
  SortIcon: React.FC<{ column: string; size?: number }>;
}

/** Compare deux valeurs en gérant null, nombres, booléens, dates et strings */
const compareValues = (a: any, b: any): number => {
  // Null/undefined toujours en fin
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;

  // Booléens : true avant false
  if (typeof a === "boolean" && typeof b === "boolean") {
    return a === b ? 0 : a ? -1 : 1;
  }

  // Nombres
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }

  // Dates ISO
  const da = Date.parse(a as string);
  const db = Date.parse(b as string);
  if (!isNaN(da) && !isNaN(db) && typeof a === "string" && typeof b === "string"
      && /^\d{4}-\d{2}-\d{2}/.test(a) && /^\d{4}-\d{2}-\d{2}/.test(b)) {
    return da - db;
  }

  // Strings — comparaison locale insensible à la casse et aux accents
  return String(a).localeCompare(String(b), "fr", { sensitivity: "base", numeric: true });
};

export function useTableSort<T extends Record<string, any>>(
  data: T[],
  initialKeyOrOptions?: (keyof T | string) | UseTableSortOptions<T>,
  initialDir: "asc" | "desc" = "asc",
): UseTableSortReturn<T> {
  // Compatibilité signatures : useTableSort(data, "code") OU useTableSort(data, { initialKey, getValue })
  const opts: UseTableSortOptions<T> =
    typeof initialKeyOrOptions === "object" && initialKeyOrOptions !== null
      ? initialKeyOrOptions
      : { initialKey: initialKeyOrOptions as string | undefined, initialDir };

  const [sortKey, setSortKey] = useState<string | null>(
    (opts.initialKey as string) || null
  );
  const [sortDir, setSortDir] = useState<SortDir>(
    opts.initialKey ? (opts.initialDir || "asc") : null
  );

  const toggleSort = (key: string) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortKey(null);
      setSortDir(null);
    }
  };

  const sortedData = useMemo(() => {
    if (!sortKey || !sortDir) return data;
    const getValue = opts.getValue || ((row: T, key: string) => row[key]);
    const sorted = [...data].sort((a, b) => {
      const va = getValue(a, sortKey);
      const vb = getValue(b, sortKey);
      const cmp = compareValues(va, vb);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [data, sortKey, sortDir, opts.getValue]);

  const SortIcon: React.FC<{ column: string; size?: number }> = ({ column, size = 12 }) => {
    if (sortKey !== column) {
      return <ArrowUpDown size={size} className="inline-block ml-1 opacity-30" />;
    }
    return sortDir === "asc"
      ? <ArrowUp size={size} className="inline-block ml-1 text-accent" />
      : <ArrowDown size={size} className="inline-block ml-1 text-accent" />;
  };

  return { sortedData, sortKey, sortDir, toggleSort, SortIcon };
}
