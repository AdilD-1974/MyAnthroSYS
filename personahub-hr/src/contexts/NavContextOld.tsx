// ============================================================
// NavContext.tsx — src/contexts/NavContext.tsx
// Utilise fetch natif avec le token lu au moment de l'appel
// pour contourner le blocage Edge sur sessionStorage
// ============================================================

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { NavSection } from "@/lib/navApi";

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

async function fetchMenu(): Promise<NavSection[]> {
  // Lire le token au moment précis de l'appel (pas au render)
  const token = sessionStorage.getItem("access_token");
  if (!token) return [];

  const res = await fetch(`${API_BASE}/navigation/menu`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export function NavProvider({ children }: { children: React.ReactNode }) {
  const [sections, setSections] = useState<NavSection[]>([]);
  const [loading, setLoading] = useState(true);

  const rafraichir = useCallback(async () => {
    try {
      const data = await fetchMenu();
      setSections(data);
    } catch {
      setSections([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Attendre 500ms que le token soit écrit en sessionStorage après login
    const t = setTimeout(rafraichir, 500);
    return () => clearTimeout(t);
  }, [rafraichir]);

  // Rechargement automatique du menu dès qu'une modification a lieu ailleurs
  // (ex. page d'administration de la navigation) : un simple
  // window.dispatchEvent(new Event("nav:refresh")) suffit à mettre à jour
  // la sidebar en temps réel, sans recharger la page.
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
