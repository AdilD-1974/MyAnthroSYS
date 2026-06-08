/**
 * useManagerHierarchie.ts
 * ────────────────────────────────────────────────────────────────────────────
 * Résout dynamiquement les managers N+1 et N+2 d'un collaborateur en remontant
 * la hiérarchie des UO via `parent_id`.
 *
 * Algorithme pour une UO donnée (résolution du "responsable effectif") :
 *   1. Si `responsable_id` (titulaire) IS NOT NULL → c'est lui
 *   2. Sinon, si un intérim actif (date_debut ≤ today ≤ date_fin) existe → c'est lui
 *   3. Sinon → null (on remonte au parent_id)
 *
 * N+1 = premier responsable trouvé en remontant à partir de l'UO du collab,
 *       en excluant le collab lui-même (s'il est responsable de son UO, on
 *       monte d'un cran).
 * N+2 = premier responsable trouvé en remontant à partir du parent de l'UO
 *       du N+1, en excluant le collab et le N+1.
 *
 * Retourne aussi la source (titulaire / intérim), l'UO de résolution et le
 * nombre de niveaux remontés — utile pour l'UI ("via DGL, intérim jusqu'au …").
 */
import { useEffect, useState, useCallback } from "react";
import { db } from "@/lib/api";

export interface ResolvedManager {
  collab: { id: string; nom: string; prenom: string; matricule: string };
  uo: { id: string; libelle: string };
  source: "titulaire" | "interim";
  interim_date_fin: string | null;
  niveaux_remontes: number; // 0 = UO directe, 1 = parent, 2 = grand-parent…
}

export interface ManagerHierarchie {
  n1: ResolvedManager | null;
  n2: ResolvedManager | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

interface UO {
  id: string;
  libelle: string;
  parent_id: string | null;
  responsable_id: string | null;
}

interface Collab {
  id: string;
  nom: string;
  prenom: string;
  matricule: string;
}

interface Interim {
  id: string;
  unite_id: string;
  collaborateur_id: string;
  date_debut: string;
  date_fin: string | null;
  archive: boolean;
}

const MAX_LEVELS = 15;

export function useManagerHierarchie(collaborateurId: string | null): ManagerHierarchie {
  const [state, setState] = useState<{ n1: ResolvedManager | null; n2: ResolvedManager | null }>({
    n1: null,
    n2: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!collaborateurId) {
      setState({ n1: null, n2: null });
      return;
    }

    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const today = new Date().toISOString().slice(0, 10);

        const [uos, collabs, interims, aff] = await Promise.all([
          db.list<UO>("unites_organisationnelles"),
          db.list<Collab>("collaborateurs", { archive: false }),
          // Tolérant : si la table unite_interim n'existe pas encore, on continue
          db.list<Interim>("unite_interim", { archive: false }).catch(() => [] as Interim[]),
          db.findOne<{ unite_id: string | null }>("collaborateur_affectations", {
            collaborateur_id: collaborateurId,
            archive: false,
            date_fin_uo__isnull: true,
            order: "-date_debut_uo",
          }),
        ]);

        if (cancelled) return;

        const uoMap = new Map<string, UO>(uos.map((u) => [u.id, u]));
        const collabMap = new Map<string, Collab>(collabs.map((c) => [c.id, c]));

        const activeInterims = interims.filter(
          (i) => i.date_debut <= today && (!i.date_fin || i.date_fin >= today)
        );
        const interimByUo = new Map<string, Interim>(
          activeInterims.map((i) => [i.unite_id, i])
        );

        const getResp = (uoId: string): ResolvedManager | null => {
          const uo = uoMap.get(uoId);
          if (!uo) return null;

          // 1. Titulaire
          if (uo.responsable_id) {
            const c = collabMap.get(uo.responsable_id);
            if (c) {
              return {
                collab: { id: c.id, nom: c.nom, prenom: c.prenom, matricule: c.matricule },
                uo: { id: uo.id, libelle: uo.libelle },
                source: "titulaire",
                interim_date_fin: null,
                niveaux_remontes: 0,
              };
            }
          }

          // 2. Intérim actif (seulement si pas de titulaire)
          const interim = interimByUo.get(uoId);
          if (interim) {
            const c = collabMap.get(interim.collaborateur_id);
            if (c) {
              return {
                collab: { id: c.id, nom: c.nom, prenom: c.prenom, matricule: c.matricule },
                uo: { id: uo.id, libelle: uo.libelle },
                source: "interim",
                interim_date_fin: interim.date_fin,
                niveaux_remontes: 0,
              };
            }
          }

          return null;
        };

        const findManager = (
          excludeIds: Set<string>,
          startUoId: string | null
        ): ResolvedManager | null => {
          let uoId: string | null = startUoId;
          let level = 0;
          const visited = new Set<string>();
          while (uoId && !visited.has(uoId) && level < MAX_LEVELS) {
            visited.add(uoId);
            const resp = getResp(uoId);
            if (resp && !excludeIds.has(resp.collab.id)) {
              return { ...resp, niveaux_remontes: level };
            }
            uoId = uoMap.get(uoId)?.parent_id || null;
            level++;
          }
          return null;
        };

        const startUoId = aff?.unite_id || null;
        if (!startUoId) {
          setState({ n1: null, n2: null });
          return;
        }

        const n1 = findManager(new Set([collaborateurId]), startUoId);
        let n2: ResolvedManager | null = null;
        if (n1) {
          const n1ParentId = uoMap.get(n1.uo.id)?.parent_id || null;
          if (n1ParentId) {
            n2 = findManager(new Set([collaborateurId, n1.collab.id]), n1ParentId);
          }
        }

        setState({ n1, n2 });
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Erreur de résolution hiérarchique");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [collaborateurId, reloadKey]);

  return { ...state, loading, error, refresh };
}
