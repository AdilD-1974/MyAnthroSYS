// src/hooks/useChainCollaborateurIds.ts
//
// Résout la chaîne complète des collaborateurs historiques d'un collab
// via le champ `ancien_matricule`.
//
// Exemple : collab MAT9 a ancien_matricule = "MAT7", MAT7 a ancien = "MAT4", ...
// Le hook retourne :
//   - chainIds : [uuid_de_MAT9, uuid_de_MAT7, uuid_de_MAT4, ...]
//   - chainCollabs : [{id, matricule, nom, prenom}, ...] dans le même ordre
//   - loading : true tant qu'on remonte
//
// Protections :
//   - Anti-cycle via Set de matricules déjà visités
//   - Profondeur max 20 (au cas où)
//   - Tolérant : si un ancêtre n'existe pas en base, on s'arrête là

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export interface ChainCollab {
  id: string;
  matricule: string;
  nom?: string;
  prenom?: string;
}

export interface UseChainResult {
  /** Liste des UUIDs : [courant, ancêtre1, ancêtre2, ...] */
  chainIds: string[];
  /** Détails des collabs dans le même ordre */
  chainCollabs: ChainCollab[];
  loading: boolean;
}

export function useChainCollaborateurIds(
  startCollabId: string | null | undefined,
  startAncienMatricule?: string | null,
): UseChainResult {
  const [state, setState] = useState<UseChainResult>({
    chainIds: [],
    chainCollabs: [],
    loading: false,
  });

  useEffect(() => {
    if (!startCollabId) {
      setState({ chainIds: [], chainCollabs: [], loading: false });
      return;
    }

    let cancelled = false;
    (async () => {
      setState(s => ({ ...s, loading: true }));

      const chainIds: string[] = [startCollabId];
      const chainCollabs: ChainCollab[] = [];
      const visited = new Set<string>(); // matricules déjà rencontrés (anti-cycle)

      try {
        // 1) Charger le collab courant (pour avoir son matricule + nom)
        const [current]: any[] = await api.get(
          `/db/collaborateurs?id=eq.${startCollabId}&select=id,matricule,nom,prenom,ancien_matricule&limit=1`
        );
        if (!current) {
          if (!cancelled) setState({ chainIds, chainCollabs, loading: false });
          return;
        }

        chainCollabs.push({
          id: current.id,
          matricule: current.matricule,
          nom: current.nom,
          prenom: current.prenom,
        });
        if (current.matricule) visited.add(current.matricule);

        // 2) Remonter la chaîne via ancien_matricule
        let nextAncien: string | null =
          startAncienMatricule || current.ancien_matricule || null;
        let depth = 0;
        const MAX_DEPTH = 20;

        while (nextAncien && depth < MAX_DEPTH) {
          if (visited.has(nextAncien)) {
            // Cycle détecté
            console.warn("[useChainCollaborateurIds] cycle détecté à matricule =", nextAncien);
            break;
          }
          visited.add(nextAncien);
          depth++;

          // Fetch le collab ancêtre par son matricule
          let ancestor: any = null;
          try {
            const rows: any[] = await api.get(
              `/db/collaborateurs?matricule=eq.${encodeURIComponent(nextAncien)}` +
              `&select=id,matricule,nom,prenom,ancien_matricule&limit=1`
            );
            ancestor = rows?.[0] || null;
          } catch (e) {
            console.warn("[useChainCollaborateurIds] erreur fetch ancêtre", nextAncien, e);
            break;
          }

          if (!ancestor) {
            // Matricule référencé mais collab inexistant en base
            break;
          }

          chainIds.push(ancestor.id);
          chainCollabs.push({
            id: ancestor.id,
            matricule: ancestor.matricule,
            nom: ancestor.nom,
            prenom: ancestor.prenom,
          });

          nextAncien = ancestor.ancien_matricule || null;
        }

        if (!cancelled) {
          setState({ chainIds, chainCollabs, loading: false });
        }
      } catch (e) {
        console.error("[useChainCollaborateurIds] erreur résolution chaîne :", e);
        if (!cancelled) {
          setState({ chainIds: [startCollabId], chainCollabs: [], loading: false });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [startCollabId, startAncienMatricule]);

  return state;
}

export default useChainCollaborateurIds;
