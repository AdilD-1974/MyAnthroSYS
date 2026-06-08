/**
 * Hooks React Query — Barèmes.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

// ⚠️ Adapter à ton client API (le même que pour les autres modules paie).
import { api } from "@/lib/api";

import type { Bareme, BaremeListItem, BaremePayload } from "@/types/bareme";

const BASE = "/paie/baremes";

// ---------------------------------------------------------------------------
// LIST
// ---------------------------------------------------------------------------
export interface BaremeFilters {
  actif?: boolean;
  archive?: boolean;
  search?: string;
}

export function useBaremes(filters: BaremeFilters = {}) {
  return useQuery({
    queryKey: ["baremes", filters],
    queryFn: async (): Promise<BaremeListItem[]> => {
      const params = new URLSearchParams();
      if (filters.actif !== undefined)   params.set("actif", String(filters.actif));
      if (filters.archive !== undefined) params.set("archive", String(filters.archive));
      if (filters.search)                params.set("search", filters.search);
      const qs = params.toString();
      return api.get(`${BASE}${qs ? `?${qs}` : ""}`);
    },
  });
}

// ---------------------------------------------------------------------------
// DETAIL
// ---------------------------------------------------------------------------
export function useBareme(id: string | undefined) {
  return useQuery({
    queryKey: ["bareme", id],
    queryFn: async (): Promise<Bareme> => api.get(`${BASE}/${id}`),
    enabled: !!id,
  });
}

// ---------------------------------------------------------------------------
// MUTATIONS
// ---------------------------------------------------------------------------
export function useBaremeMutations() {
  const qc = useQueryClient();

  const invalidate = (id?: string) => {
    qc.invalidateQueries({ queryKey: ["baremes"] });
    if (id) qc.invalidateQueries({ queryKey: ["bareme", id] });
  };

  const create = useMutation({
    mutationFn: (payload: BaremePayload): Promise<Bareme> =>
      api.post(BASE, payload),
    onSuccess: (data) => {
      toast.success(`Barème "${data.code}" créé`);
      invalidate(data.id);
    },
    onError: (e: any) => {
      toast.error(e?.message ?? "Erreur lors de la création");
    },
  });

  const replace = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: BaremePayload }): Promise<Bareme> =>
      api.put(`${BASE}/${id}`, payload),
    onSuccess: (data) => {
      toast.success(`Barème "${data.code}" enregistré`);
      invalidate(data.id);
    },
    onError: (e: any) => {
      toast.error(e?.message ?? "Erreur lors de l'enregistrement");
    },
  });

  const archive = useMutation({
    mutationFn: ({ id, hard = false }: { id: string; hard?: boolean }) =>
      api.delete(`${BASE}/${id}${hard ? "?hard=true" : ""}`),
    onSuccess: (_, vars) => {
      toast.success(vars.hard ? "Barème supprimé" : "Barème archivé");
      invalidate(vars.id);
    },
    onError: (e: any) => {
      toast.error(e?.message ?? "Erreur lors de la suppression");
    },
  });

  return { create, replace, archive };
}
