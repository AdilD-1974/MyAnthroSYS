// ============================================================
// NavContext.tsx — src/contexts/NavContext.tsx
// Utilise fetch natif avec le token lu au moment de l'appel
// pour contourner le blocage Edge sur sessionStorage.
//
// UNION DES PROFILS : le menu cumule les droits de TOUS les rôles
// du collaborateur. On interroge /navigation/menu?role=X pour chaque
// rôle puis on fusionne (dédoublonnage par id). Le menu ne dépend
// donc plus du rôle actif ; activeRole reste le contexte « j'agis
// en tant que… » pour les workflows et l'affichage.
// ============================================================

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { NavSection, type NavItem } from "@/lib/navApi";
import { useAuth } from "@/contexts/AuthContext";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000/api/v1";

interface NavContextValue {
  sections: NavSection[];
  loading: boolean;
  rafraichir: () => Promise<void>;
}

const NavContext = createContext<NavContextValue>({
  sections: [],
  loading: true,
  rafraichir: async () => {},
});

async function fetchMenu(role?: string | null): Promise<NavSection[]> {
  // Lire le token au moment précis de l'appel (pas au render)
  const token = sessionStorage.getItem("access_token");
  if (!token) return [];

  const qs = role ? `?role=${encodeURIComponent(role)}` : "";
  const res = await fetch(`${API_BASE}/navigation/menu${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// Aplatit les items d'une section (l'arbre peut être imbriqué via `enfants`)
function aplatir(items?: NavItem[]): NavItem[] {
  const out: NavItem[] = [];
  const walk = (arr?: NavItem[]) =>
    arr?.forEach(i => { out.push(i); if (i.enfants?.length) walk(i.enfants); });
  walk(items);
  return out;
}

// Fusionne les menus de plusieurs rôles : union des sections et des items,
// dédoublonnés par id. On renvoie des items APLATIS (enfants retirés) : les
// consommateurs (Sidebar / TopNav) reconstruisent l'arbre via parent_id.
function fusionner(reponses: NavSection[][]): NavSection[] {
  const sections = new Map<string, { meta: NavSection; items: Map<string, NavItem> }>();
  for (const rep of reponses) {
    for (const sec of rep ?? []) {
      let entry = sections.get(sec.id);
      if (!entry) { entry = { meta: sec, items: new Map() }; sections.set(sec.id, entry); }
      for (const it of aplatir(sec.items)) {
        if (!entry.items.has(it.id)) entry.items.set(it.id, { ...it, enfants: undefined });
      }
    }
  }
  return [...sections.values()].map(e => ({ ...e.meta, items: [...e.items.values()] }));
}

export function NavProvider({ children }: { children: React.ReactNode }) {
  const { allRoles } = useAuth();
  const rolesKey = (allRoles ?? []).join(",");   // clé stable pour le useCallback
  const [sections, setSections] = useState<NavSection[]>([]);
  const [loading, setLoading] = useState(true);

  const rafraichir = useCallback(async () => {
    try {
      const roles = allRoles ?? [];
      if (roles.length === 0) { setSections([]); return; }
      // Un appel par profil, en parallèle, puis fusion (union des droits)
      const reponses = await Promise.all(roles.map(r => fetchMenu(r)));
      setSections(fusionner(reponses));
    } catch {
      setSections([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolesKey]);

  useEffect(() => {
    // Attendre que le token soit écrit en sessionStorage après login
    const t = setTimeout(rafraichir, 500);
    return () => clearTimeout(t);
  }, [rafraichir]);

  // Rechargement automatique du menu sur événement externe
  // (ex. page d'administration de la navigation) :
  // window.dispatchEvent(new Event("nav:refresh"))
  useEffect(() => {
    const handler = () => { rafraichir(); };
    window.addEventListener("nav:refresh", handler);
    return () => window.removeEventListener("nav:refresh", handler);
  }, [rafraichir]);

  return (
    <NavContext.Provider value={{ sections, loading, rafraichir }}>
      {children}
    </NavContext.Provider>
  );
}

export function useNav(): NavContextValue {
  return useContext(NavContext);
}
