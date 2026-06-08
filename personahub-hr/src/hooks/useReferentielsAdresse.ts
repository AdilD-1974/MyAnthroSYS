/**
 * Hooks React Query — Référentiels d'adresse (lecture seule).
 *
 * Cache long (30 min) car ces données changent très rarement.
 * On les charge à la demande pour économiser le réseau.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface RefPays {
  code: string;
  libelle: string;
  actif: boolean | null;
  code_pays_alpha2: string | null;
  continent: string | null;
  devise: string | null;
}

export interface RefRegion {
  code: string;
  libelle: string;
  code_pays: string | null;
  actif: boolean | null;
}

export interface RefVille {
  code: string;
  libelle: string;
  code_region: string;
  code_postal: string | null;
  actif: boolean | null;
  // Champs déduits côté backend pour le cascading
  code_pays: string | null;
  libelle_region: string | null;
  libelle_pays: string | null;
}

const STALE_TIME = 30 * 60 * 1000; // 30 minutes

// ---------------------------------------------------------------------------
// Pays
// ---------------------------------------------------------------------------
export function usePays() {
  return useQuery({
    queryKey: ["ref", "pays"],
    queryFn: async (): Promise<RefPays[]> => api.get("/referentiels/pays?actif=true"),
    staleTime: STALE_TIME,
  });
}

// ---------------------------------------------------------------------------
// Régions (filtrables par pays)
// ---------------------------------------------------------------------------
export function useRegions(codePays?: string | null) {
  return useQuery({
    queryKey: ["ref", "regions", codePays ?? "all"],
    queryFn: async (): Promise<RefRegion[]> => {
      const params = new URLSearchParams({ actif: "true" });
      if (codePays) params.set("code_pays", codePays);
      return api.get(`/referentiels/regions?${params.toString()}`);
    },
    staleTime: STALE_TIME,
    enabled: codePays !== null, // si on passe explicitement null, on ne charge pas
  });
}

// ---------------------------------------------------------------------------
// Villes (filtrables par région ou pays, avec recherche)
// ---------------------------------------------------------------------------
export interface VilleFilters {
  codeRegion?: string | null;
  codePays?: string | null;
  search?: string;
  limit?: number;
  enabled?: boolean;
}

export function useVilles(filters: VilleFilters = {}) {
  const { codeRegion, codePays, search, limit = 50, enabled = true } = filters;

  return useQuery({
    queryKey: ["ref", "villes", codeRegion ?? "all", codePays ?? "all", search ?? "", limit],
    queryFn: async (): Promise<RefVille[]> => {
      const params = new URLSearchParams({ actif: "true", limit: String(limit) });
      if (codeRegion) params.set("code_region", codeRegion);
      if (codePays) params.set("code_pays", codePays);
      if (search) params.set("search", search);
      return api.get(`/referentiels/villes?${params.toString()}`);
    },
    staleTime: STALE_TIME,
    enabled,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Charge UNE ville par son code (pour résoudre des données existantes).
 * Utilise le filtre search comme fallback si l'endpoint /villes/{code} n'existe pas.
 */
export function useVilleByCode(code?: string | null) {
  return useQuery({
    queryKey: ["ref", "ville", code],
    queryFn: async (): Promise<RefVille | null> => {
      if (!code) return null;
      const villes: RefVille[] = await api.get(`/referentiels/villes?search=${encodeURIComponent(code)}&limit=1`);
      return villes.find((v) => v.code === code) ?? null;
    },
    staleTime: STALE_TIME,
    enabled: !!code,
  });
}
