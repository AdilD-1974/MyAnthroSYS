/**
 * useMonEquipe — Résout l'équipe d'un manager (collaborateurs dont il est
 * le responsable direct N+1, optionnellement N+2).
 *
 * Source : collaborateur_affectations.manager_n1_id (et manager_n2_id).
 * On part du collaborateurId du manager connecté.
 *
 * Retourne la liste des membres d'équipe enrichis (collaborateur + affectation).
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export interface MembreEquipe {
  id: string;             // collaborateur_id
  matricule: string;
  nom: string;
  prenom: string;
  photo_path?: string;
  statut_collaborateur?: string;
  email_professionnel?: string;
  niveau: "N1" | "N2";    // rattachement direct ou indirect
  affectation?: any;      // ligne d'affectation correspondante
}

export interface UseMonEquipeResult {
  equipe: MembreEquipe[];
  loading: boolean;
  error: string | null;
  count: number;
}

export function useMonEquipe(
  managerCollaborateurId: string | null | undefined,
  includeN2 = false,
): UseMonEquipeResult {
  const [state, setState] = useState<UseMonEquipeResult>({
    equipe: [],
    loading: !!managerCollaborateurId,
    error: null,
    count: 0,
  });

  useEffect(() => {
    if (!managerCollaborateurId) {
      setState({ equipe: [], loading: false, error: null, count: 0 });
      return;
    }
    let cancelled = false;

    (async () => {
      setState(s => ({ ...s, loading: true }));
      try {
        // 1) Affectations où je suis manager N1 (et N2 si demandé)
        //    Le proxy generic ne gère pas or=(...) → on fait 1 ou 2 fetches.
        const fetchByManager = async (col: "manager_n1_id" | "manager_n2_id") => {
          try {
            const rows: any[] = await api.get(
              `/db/collaborateur_affectations?${col}=eq.${managerCollaborateurId}` +
              `&archive=eq.false&select=collaborateur_id,unite_id,code_poste,date_debut_uo,date_fin_uo`
            );
            return rows || [];
          } catch { return []; }
        };

        const today = new Date().toISOString().split("T")[0];
        const affN1 = await fetchByManager("manager_n1_id");
        const affN2 = includeN2 ? await fetchByManager("manager_n2_id") : [];

        // Garder les affectations en cours (pas de date_fin_uo ou >= today)
        const activeOnly = (rows: any[]) =>
          rows.filter(a => !a.date_fin_uo || a.date_fin_uo >= today);

        // Map collaborateur_id → niveau + affectation
        const memberMap = new Map<string, { niveau: "N1" | "N2"; aff: any }>();
        activeOnly(affN1).forEach(a => {
          if (a.collaborateur_id && a.collaborateur_id !== managerCollaborateurId) {
            memberMap.set(a.collaborateur_id, { niveau: "N1", aff: a });
          }
        });
        activeOnly(affN2).forEach(a => {
          if (a.collaborateur_id && a.collaborateur_id !== managerCollaborateurId
              && !memberMap.has(a.collaborateur_id)) {
            memberMap.set(a.collaborateur_id, { niveau: "N2", aff: a });
          }
        });

        const ids = Array.from(memberMap.keys());
        if (ids.length === 0) {
          if (!cancelled) setState({ equipe: [], loading: false, error: null, count: 0 });
          return;
        }

        // 2) Charger les collaborateurs de l'équipe en une requête IN
        const collabs: any[] = await api.get(
          `/db/collaborateurs?id=in.(${ids.join(",")})` +
          `&select=id,matricule,nom,prenom,photo_path,statut_collaborateur,email_professionnel`
        );

        const equipe: MembreEquipe[] = (collabs || []).map(c => {
          const m = memberMap.get(c.id);
          return {
            id: c.id,
            matricule: c.matricule,
            nom: c.nom,
            prenom: c.prenom,
            photo_path: c.photo_path,
            statut_collaborateur: c.statut_collaborateur,
            email_professionnel: c.email_professionnel,
            niveau: m?.niveau || "N1",
            affectation: m?.aff,
          };
        });

        // Tri : N1 d'abord, puis alphabétique par nom
        equipe.sort((a, b) =>
          a.niveau !== b.niveau
            ? (a.niveau === "N1" ? -1 : 1)
            : (a.nom || "").localeCompare(b.nom || "")
        );

        if (!cancelled) {
          setState({ equipe, loading: false, error: null, count: equipe.length });
        }
      } catch (e: any) {
        if (!cancelled) {
          setState({ equipe: [], loading: false, error: e?.message || "Erreur", count: 0 });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [managerCollaborateurId, includeN2]);

  return state;
}

export default useMonEquipe;
