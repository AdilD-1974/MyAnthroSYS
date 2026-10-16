// ============================================================
// navTree.ts — src/lib/navTree.ts
// Reconstruit l'arbre de navigation (N niveaux) à partir de la
// liste APLATIE renvoyée par NavContext (items dédupliqués, avec
// enfants retirés). On se base sur `parent_id` pour retrouver la
// hiérarchie, quel que soit le nombre de niveaux.
// ============================================================

import type { NavItem } from "@/lib/navApi";

export interface NavItemArbre extends NavItem {
  enfants: NavItemArbre[];
}

/**
 * Reconstruit une arborescence à N niveaux à partir d'une liste plate.
 * Un item sans parent_id (ou dont le parent n'existe pas dans la liste,
 * ex. droit non hérité par le rôle courant) devient une racine.
 *
 * @param inclureInactifs  si false (défaut), les items avec actif === false
 *                         sont exclus de l'arbre (mais pas leurs enfants
 *                         actifs, qui remontent au niveau du parent existant).
 */
export function construireArbre(items: NavItem[], inclureInactifs = false): NavItemArbre[] {
  const source = inclureInactifs ? items : items.filter((it) => it.actif);
  const map = new Map<string, NavItemArbre>();
  source.forEach((it) => map.set(it.id, { ...it, enfants: [] }));

  const racines: NavItemArbre[] = [];

  map.forEach((item) => {
    const parent = item.parent_id ? map.get(item.parent_id) : undefined;
    if (parent) {
      parent.enfants.push(item);
    } else {
      racines.push(item);
    }
  });

  const trier = (arr: NavItemArbre[]) => {
    arr.sort((a, b) => a.ordre - b.ordre);
    arr.forEach((a) => trier(a.enfants));
  };
  trier(racines);

  return racines;
}
