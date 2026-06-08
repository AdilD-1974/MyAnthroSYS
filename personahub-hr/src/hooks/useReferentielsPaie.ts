/**
 * Hook générique pour CRUD des référentiels paie.
 *
 * Usage:
 *   const { items, isLoading, create, update, remove } = useReferentielsPaie('familles');
 *
 * Référentiels disponibles :
 *   familles | types | flux | frequences | zones-fixes
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

// ⚠️ Adapter l'import au client API existant du projet (ex: `@/lib/api`).
//    Ce fichier expose un `api.get/post/patch/delete` retournant directement
//    le JSON parsé. Si tu utilises supabase-js, remplace les appels par les
//    requêtes Supabase équivalentes.
import { api } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type ReferentielSlug =
  | "familles"
  | "types"
  | "flux"
  | "frequences"
  | "zones-fixes";

export interface ReferentielItem {
  id: string;
  code: string;
  libelle: string;
  description: string | null;
  ordre: number;
  actif: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReferentielPayload {
  code: string;
  libelle: string;
  description?: string | null;
  ordre?: number;
  actif?: boolean;
}

export interface ReferentielFilters {
  actif?: boolean;
  search?: string;
}

// ---------------------------------------------------------------------------
// Métadonnées d'affichage
// ---------------------------------------------------------------------------
export const REFERENTIELS_META: Record<
  ReferentielSlug,
  { label: string; singular: string }
> = {
  familles:      { label: "Familles de rubrique",  singular: "Famille"  },
  types:         { label: "Types de rubrique",     singular: "Type"     },
  flux:          { label: "Flux",                  singular: "Flux"     },
  frequences:    { label: "Fréquences",            singular: "Fréquence"},
  "zones-fixes": { label: "Zones fixes",           singular: "Zone fixe"},
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
const BASE = "/paie/referentiels";

export function useReferentielsPaie(
  slug: ReferentielSlug,
  filters: ReferentielFilters = {},
) {
  const qc = useQueryClient();
  const queryKey = ["referentiels-paie", slug, filters] as const;

  const list = useQuery({
    queryKey,
    queryFn: async (): Promise<ReferentielItem[]> => {
      const params = new URLSearchParams();
      if (filters.actif !== undefined) params.set("actif", String(filters.actif));
      if (filters.search) params.set("search", filters.search);
      const qs = params.toString();
      return api.get(`${BASE}/${slug}${qs ? `?${qs}` : ""}`);
    },
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["referentiels-paie", slug] });

  const create = useMutation({
    mutationFn: (payload: ReferentielPayload): Promise<ReferentielItem> =>
      api.post(`${BASE}/${slug}`, payload),
    onSuccess: () => {
      toast.success("Élément créé");
      invalidate();
    },
    onError: (e: any) => {
      toast.error(e?.message ?? "Erreur lors de la création");
    },
  });

  const update = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: Partial<ReferentielPayload>;
    }): Promise<ReferentielItem> => api.patch(`${BASE}/${slug}/${id}`, payload),
    onSuccess: () => {
      toast.success("Élément mis à jour");
      invalidate();
    },
    onError: (e: any) => {
      toast.error(e?.message ?? "Erreur lors de la mise à jour");
    },
  });

  const remove = useMutation({
    mutationFn: ({ id, hard = false }: { id: string; hard?: boolean }) =>
      api.delete(`${BASE}/${slug}/${id}${hard ? "?hard=true" : ""}`),
    onSuccess: (_, vars) => {
      toast.success(vars.hard ? "Élément supprimé" : "Élément désactivé");
      invalidate();
    },
    onError: (e: any) => {
      toast.error(e?.message ?? "Erreur lors de la suppression");
    },
  });

  return {
    items: list.data ?? [],
    isLoading: list.isLoading,
    isError: list.isError,
    error: list.error,
    refetch: list.refetch,
    create,
    update,
    remove,
  };
}
