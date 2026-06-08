import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface WfRole {
  id: string; code: string; libelle: string; description: string | null;
  categorie: string; couleur: string | null; actif: boolean; ordre: number;
}
export interface WfRoleMembre {
  id?: string; collaborateur_id: string | null; poste_code: string | null; unite_id: string | null;
  date_debut: string | null; date_fin: string | null; actif: boolean;
}
export interface OptionLite { id: string; label: string; }
export interface UoNode { id: string; label: string; code?: string; depth: number; }

export const CATEGORIES_ROLE = ["DIRECTION", "RH", "MANAGEMENT", "FINANCE", "GENERAL"];

function buildUoHier(unites: any[]): UoNode[] {
  const actifs = (unites || []).filter((u) => u.actif !== false);
  const byParent: Record<string, any[]> = {};
  actifs.forEach((u) => { const k = u.parent_id || "root"; (byParent[k] = byParent[k] || []).push(u); });
  Object.values(byParent).forEach((arr) => arr.sort((a, b) => (a.libelle || "").localeCompare(b.libelle || "", "fr")));
  const out: UoNode[] = []; const seen = new Set<string>();
  const walk = (pid: string, depth: number) => {
    (byParent[pid] || []).forEach((u) => { out.push({ id: u.id, label: u.libelle, code: u.code, depth }); seen.add(u.id); walk(u.id, depth + 1); });
  };
  walk("root", 0);
  // Orphelins (parent absent) rattachés à la racine
  actifs.forEach((u) => { if (!seen.has(u.id)) out.push({ id: u.id, label: u.libelle, code: u.code, depth: 0 }); });
  return out;
}

export function useWorkflowRolesData() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["wf-roles-data"],
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const [roles, membres, collabs, unites, postes] = await Promise.all([
        api.get("/db/ref_workflow_role?order=ordre&select=id,code,libelle,description,categorie,couleur,actif,ordre") as Promise<any[]>,
        api.get("/db/ref_workflow_role_membre?select=id,id_role,collaborateur_id,poste_code,unite_id,date_debut,date_fin,actif").catch(() => []) as Promise<any[]>,
        api.get("/db/collaborateurs?select=id,matricule,nom,prenom,archive") as Promise<any[]>,
        api.get("/db/unites_organisationnelles?select=id,code,libelle,parent_id,actif").catch(() => []) as Promise<any[]>,
        api.get("/db/ref_poste?actif=eq.true&order=libelle&select=code,libelle").catch(() => []) as Promise<any[]>,
      ]);
      const membresByRole: Record<string, any[]> = {};
      (membres || []).forEach((m) => { (membresByRole[m.id_role] = membresByRole[m.id_role] || []).push(m); });

      const collaborateurs: OptionLite[] = (collabs || [])
        .filter((c) => !c.archive)
        .map((c) => ({ id: c.id, label: `${c.matricule ? c.matricule + " — " : ""}${c.nom || ""} ${c.prenom || ""}`.trim() }))
        .sort((a, b) => a.label.localeCompare(b.label, "fr"));
      const collabLabel: Record<string, string> = {};
      collaborateurs.forEach((c) => { collabLabel[c.id] = c.label; });

      const postesOpt: OptionLite[] = (postes || []).map((p) => ({ id: p.code, label: `${p.libelle}${p.code ? " (" + p.code + ")" : ""}` }));
      const posteLabel: Record<string, string> = {};
      postesOpt.forEach((p) => { posteLabel[p.id] = p.label; });

      const uoHier = buildUoHier(unites || []);
      const uoLabel: Record<string, string> = {};
      uoHier.forEach((u) => { uoLabel[u.id] = u.label; });

      return { roles: (roles || []) as WfRole[], membresByRole, collaborateurs, postes: postesOpt, uoHier, collabLabel, posteLabel, uoLabel };
    },
  });

  return {
    roles: data?.roles || [], membresByRole: data?.membresByRole || {},
    collaborateurs: data?.collaborateurs || [], postes: data?.postes || [], uoHier: data?.uoHier || [],
    collabLabel: data?.collabLabel || {}, posteLabel: data?.posteLabel || {}, uoLabel: data?.uoLabel || {},
    loading: isLoading, refetch,
  };
}

export async function saveRoleMembres(roleId: string, membres: WfRoleMembre[]) {
  await (api as any).delete(`/db/ref_workflow_role_membre?id_role=eq.${roleId}`);
  for (const m of membres) {
    if (!m.collaborateur_id && !m.poste_code) continue;  // au moins une cible
    await api.post("/db/ref_workflow_role_membre", {
      id_role: roleId,
      collaborateur_id: m.collaborateur_id || null,
      poste_code: m.poste_code || null,
      unite_id: m.unite_id || null,
      date_debut: m.date_debut || null, date_fin: m.date_fin || null, actif: m.actif,
    });
  }
}
