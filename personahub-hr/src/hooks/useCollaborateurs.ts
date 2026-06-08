/**
 * useCollaborateurs.ts — Hooks React Query pour le module collaborateurs.
 *
 * Remplace les appels directs à supabase.from("collaborateurs")...
 * À placer dans : src/hooks/useCollaborateurs.ts
 *
 * Avant (Supabase) :
 *   const data = []; const error = null; // Supabase desactive
import { api, type CollaborateurRead, type CollaborateurList } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface CollaborateursParams {
  page?: number;
  page_size?: number;
  search?: string;
  statut?: string;
}

// ── Queries ───────────────────────────────────────────────────────────────────

export function useCollaborateurs(params: CollaborateursParams = {}) {
  const { page = 1, page_size = 20, search = "", statut = "" } = params;

  const qs = new URLSearchParams({
    page: String(page),
    page_size: String(page_size),
    ...(search ? { search } : {}),
    ...(statut ? { statut } : {}),
  }).toString();

  return useQuery<CollaborateurList>({
    queryKey: ["collaborateurs", page, page_size, search, statut],
    queryFn: () => api.get<CollaborateurList>(`/collaborateurs?${qs}`),
    staleTime: 1000 * 60 * 2, // 2 minutes
  });
}

export function useCollaborateur(id: string | undefined) {
  return useQuery<CollaborateurRead>({
    queryKey: ["collaborateurs", id],
    queryFn: () => api.get<CollaborateurRead>(`/collaborateurs/${id}`),
    enabled: !!id,
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useCreateCollaborateur() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<CollaborateurRead>) =>
      api.post<CollaborateurRead>("/collaborateurs", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collaborateurs"] });
      toast.success("Collaborateur créé avec succès");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}

export function useUpdateCollaborateur(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<CollaborateurRead>) =>
      api.patch<CollaborateurRead>(`/collaborateurs/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collaborateurs", id] });
      qc.invalidateQueries({ queryKey: ["collaborateurs"] });
      toast.success("Collaborateur mis à jour");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}

export function useArchiveCollaborateur() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/collaborateurs/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collaborateurs"] });
      toast.success("Collaborateur archivé");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}
