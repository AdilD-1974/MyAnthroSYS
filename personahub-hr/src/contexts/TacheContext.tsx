// ============================================================
// TacheContext.tsx — src/contexts/TacheContext.tsx
// Adapté à tachesApi.ts existant du projet
// ============================================================

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { tachesApi, TacheCompteurs } from "@/lib/tachesApi";
import { useAuth } from "@/contexts/AuthContext";

// ──────────────────────────────────────────────────────────────
// TYPES
// ──────────────────────────────────────────────────────────────

interface TacheContextValue {
  badge: TacheCompteurs;
  rafraichirBadge: () => Promise<void>;
}

const BADGE_DEFAUT: TacheCompteurs = {
  total_actives: 0,
  en_retard: 0,
  dues_aujourd_hui: 0,
  haute_priorite: 0,
};

const TacheContext = createContext<TacheContextValue>({
  badge: BADGE_DEFAUT,
  rafraichirBadge: async () => {},
});

// ──────────────────────────────────────────────────────────────
// PROVIDER
// ──────────────────────────────────────────────────────────────

export function TacheProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [badge, setBadge] = useState<TacheCompteurs>(BADGE_DEFAUT);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const rafraichirBadge = useCallback(async () => {
    if (!user) return;
    try {
      const compteurs = await tachesApi.compteurs();
      setBadge(compteurs);
    } catch {
      // silencieux
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;

    rafraichirBadge();

    // Rafraîchissement toutes les 2 minutes
    intervalRef.current = setInterval(rafraichirBadge, 2 * 60 * 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [user, rafraichirBadge]);

  return (
    <TacheContext.Provider value={{ badge, rafraichirBadge }}>
      {children}
    </TacheContext.Provider>
  );
}

// ──────────────────────────────────────────────────────────────
// HOOK
// ──────────────────────────────────────────────────────────────

export function useTaches(): TacheContextValue {
  return useContext(TacheContext);
}
