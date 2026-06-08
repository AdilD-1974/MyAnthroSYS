import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { renderIcon } from "./menuIcons";

// Menus des espaces personnels/manager : jamais affichés à l'administrateur.
export const ADMIN_MENUS_CACHES = ["mon_espace", "mon_equipe", "espace_manager"];

// Format de nœud identique à l'ancien tableau MENU codé en dur :
// le Sidebar peut donc l'utiliser sans changer son rendu ni son filtrage.
export interface MenuNode {
  code: string;
  label: string;
  to?: string;
  color?: string;
  roles?: string[];          // undefined => visible par tous (sauf logique admin du Sidebar)
  icon?: React.ReactNode;
  moduleCode?: string;
  children?: MenuNode[];
}

interface InternalNode extends MenuNode {
  _id: string;
  _parent: string | null;
  _ordre: number;
}

/**
 * Charge l'arbre de navigation depuis menu_items + menu_role.
 * Retourne la liste racine au format MENU. Le filtrage par rôle reste
 * assuré par le Sidebar (role === 'administrateur' || !roles || roles.includes(role)).
 *
 * Filtrage LICENCE : un module dont licence_module.actif = false masque tous
 * ses menus (et leurs sous-menus). L'absence de ligne licence_module = module
 * actif (on ne masque jamais par défaut).
 */
export function useMenuTree(): { menu: MenuNode[]; loading: boolean } {
  const { role } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["menu-tree"],
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<MenuNode[]> => {
      const [items, roles, lic] = await Promise.all([
        api.get(
          "/db/menu_items?actif=eq.true&order=ordre&select=id,parent_id,code,libelle,icone,route,couleur,ordre,module_code"
        ) as Promise<any[]>,
        api.get("/db/menu_role?select=menu_id,role") as Promise<any[]>,
        api.get("/db/licence_module?select=module_code,actif").catch(() => []) as Promise<any[]>,
      ]);

      // Modules explicitement désactivés par la licence
      const modulesInactifs = new Set<string>(
        (lic || []).filter((m: any) => m.actif === false).map((m: any) => m.module_code)
      );

      const roleMap: Record<string, string[]> = {};
      (roles || []).forEach((r: any) => {
        (roleMap[r.menu_id] = roleMap[r.menu_id] || []).push(r.role);
      });

      const byId: Record<string, InternalNode> = {};
      (items || []).forEach((it: any) => {
        // Masquer les menus d'un module désactivé
        if (it.module_code && modulesInactifs.has(it.module_code)) return;
        byId[it.id] = {
          _id: it.id,
          _parent: it.parent_id || null,
          _ordre: it.ordre ?? 0,
          code: it.code,
          label: it.libelle,
          to: it.route || undefined,
          color: it.couleur || undefined,
          roles: roleMap[it.id],            // undefined si aucune restriction
          moduleCode: it.module_code || undefined,
          icon: renderIcon(it.icone),
          children: [],
        };
      });

      const roots: InternalNode[] = [];
      Object.values(byId).forEach((n) => {
        if (n._parent && byId[n._parent]) byId[n._parent].children!.push(n);
        else if (!n._parent) roots.push(n);
        // si le parent a été retiré (module inactif), l'enfant est ignoré
      });

      const sortRec = (arr: InternalNode[]) => {
        arr.sort((a, b) => a._ordre - b._ordre);
        arr.forEach((n) => {
          if (n.children && n.children.length) sortRec(n.children as InternalNode[]);
          else delete n.children;
        });
      };
      sortRec(roots);

      return roots;
    },
  });

  // L'administrateur voit tout (court-circuit du Sidebar) SAUF les espaces
  // personnels/manager, retirés ici de façon récursive.
  const menu = useMemo(() => {
    const tree = data || [];
    if (role !== "administrateur") return tree;
    const prune = (nodes: MenuNode[]): MenuNode[] =>
      nodes
        .filter((n) => !ADMIN_MENUS_CACHES.includes(n.code))
        .map((n) => (n.children ? { ...n, children: prune(n.children) } : n));
    return prune(tree);
  }, [data, role]);

  return { menu, loading: isLoading };
}
