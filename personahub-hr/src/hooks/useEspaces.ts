import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface Espace {
  id: string;
  code: string;
  libelle: string;
  icone: string | null;
  route_accueil: string | null;
  couleur: string | null;
  ordre: number;
  actif: boolean;
  roles: string[];
}

export function useEspaces() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["espaces"],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Espace[]> => {
      const [espaces, liens] = await Promise.all([
        api.get("/db/ref_espace?order=ordre&select=id,code,libelle,icone,route_accueil,couleur,ordre,actif") as Promise<any[]>,
        api.get("/db/espace_role?select=espace_id,role").catch(() => []) as Promise<any[]>,
      ]);
      const rolesByEspace: Record<string, string[]> = {};
      (liens || []).forEach((l: any) => {
        (rolesByEspace[l.espace_id] = rolesByEspace[l.espace_id] || []).push(l.role);
      });
      return (espaces || []).map((e: any) => ({ ...e, roles: rolesByEspace[e.id] || [] }));
    },
  });

  return { espaces: data || [], loading: isLoading, refetch };
}
