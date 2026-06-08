import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface WfOption { id: string; code: string; libelle: string; statut: string; couleur: string | null; }

// Workflows actifs applicables aux demandes de congé
export function useCongeWorkflowOptions() {
  const { data, isLoading } = useQuery({
    queryKey: ["conge-wf-options"],
    staleTime: 2 * 60 * 1000,
    queryFn: async () => (await api.get("/db/ref_workflow?type_objet=eq.cong_demande&actif=eq.true&order=libelle&select=id,code,libelle,statut,couleur")) as WfOption[],
  });
  return { options: data || [], loading: isLoading };
}

export async function loadTypeWorkflow(codeType: string) {
  const rows = (await api.get(`/db/ref_type_conge?code=eq.${encodeURIComponent(codeType)}&select=code,libelle,workflow_obligatoire,code_workflow,code_famille`)) as any[];
  return rows[0] || null;
}
export async function loadFamilleWorkflow(codeFamille: string) {
  if (!codeFamille) return null;
  const rows = (await api.get(`/db/ref_famille_conge?code=eq.${encodeURIComponent(codeFamille)}&select=code,libelle,code_workflow`)) as any[];
  return rows[0] || null;
}

export async function saveTypeWorkflow(codeType: string, payload: { workflow_obligatoire: boolean; code_workflow: string | null }) {
  await api.patch(`/db/ref_type_conge?code=eq.${encodeURIComponent(codeType)}`, {
    workflow_obligatoire: payload.workflow_obligatoire,
    code_workflow: payload.code_workflow || null,
    updated_at: new Date().toISOString(),
  });
}
export async function saveFamilleWorkflow(codeFamille: string, code_workflow: string | null) {
  await api.patch(`/db/ref_famille_conge?code=eq.${encodeURIComponent(codeFamille)}`, {
    code_workflow: code_workflow || null,
    updated_at: new Date().toISOString(),
  });
}
