/**
 * Hooks React Query — Adresses des collaborateurs.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface CollaborateurAdresse {
  id: string;
  collaborateur_id: string;
  adresse: string;
  complement_adresse: string | null;
  code_postal: string | null;
  code_pays: string | null;
  code_region: string | null;
  code_ville: string | null;
  telephone: string | null;
  telephone_bis: string | null;
  email: string | null;
  is_adresse_principale: boolean;
  is_adresse_correspondance: boolean;
  is_adresse_residence: boolean;
  is_adresse_professionnelle: boolean;
  archive: boolean;
  created_at: string;
  updated_at: string;
  // Libellés enrichis renvoyés par l'API
  libelle_pays: string | null;
  libelle_region: string | null;
  libelle_ville: string | null;
}

export interface AdressePayload {
  adresse: string;
  complement_adresse?: string | null;
  code_postal?: string | null;
  code_pays?: string | null;
  code_region?: string | null;
  code_ville?: string | null;
  telephone?: string | null;
  telephone_bis?: string | null;
  email?: string | null;
  is_adresse_principale?: boolean;
  is_adresse_correspondance?: boolean;
  is_adresse_residence?: boolean;
  is_adresse_professionnelle?: boolean;
}

const baseUrl = (collabId: string) => `/collaborateurs/${collabId}/adresses`;

// ---------------------------------------------------------------------------
// Hook combiné — list + mutations
// ---------------------------------------------------------------------------
export function useCollaborateurAdresses(collaborateurId: string) {
  const qc = useQueryClient();
  const queryKey = ["collaborateur-adresses", collaborateurId] as const;

  const list = useQuery({
    queryKey,
    queryFn: async (): Promise<CollaborateurAdresse[]> => api.get(baseUrl(collaborateurId)),
    enabled: !!collaborateurId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey });

  const create = useMutation({
    mutationFn: (payload: AdressePayload): Promise<CollaborateurAdresse> =>
      api.post(baseUrl(collaborateurId), payload),
    onSuccess: () => {
      toast.success("Adresse ajoutée");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erreur lors de la création"),
  });

  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<AdressePayload> & { archive?: boolean } }):
      Promise<CollaborateurAdresse> =>
      api.patch(`${baseUrl(collaborateurId)}/${id}`, payload),
    onSuccess: () => {
      toast.success("Adresse mise à jour");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erreur lors de la mise à jour"),
  });

  const archive = useMutation({
    mutationFn: ({ id, hard = false }: { id: string; hard?: boolean }) =>
      api.delete(`${baseUrl(collaborateurId)}/${id}${hard ? "?hard=true" : ""}`),
    onSuccess: (_, vars) => {
      toast.success(vars.hard ? "Adresse supprimée" : "Adresse archivée");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erreur lors de la suppression"),
  });

  return {
    adresses: list.data ?? [],
    isLoading: list.isLoading,
    isError: list.isError,
    refetch: list.refetch,
    create,
    update,
    archive,
  };
}
