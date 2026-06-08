import { useState, useEffect } from "react";
import { db } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

// =====================================================
// Hook : useManagerPopulation — SOURCE UNIQUE du périmètre manager
// RG-MGR-POP-01 (Adil DAIA) :
//   La population gérée par un manager comprend les collaborateurs rattachés,
//   selon DEUX axes cumulatifs :
//   A. FORÇAGE  : collaborateur dont manager_n1_id OU manager_n2_id = le manager
//   B. DYNAMIQUE : collaborateurs des UO dont le manager est responsable
//      (responsable_id OU poste_responsable_code) + TOUTES les sous-UO
//      (hiérarchie descendante récursive, jusqu'au niveau le plus fin).
//   Cette logique doit être utilisée partout (Mon équipe, Gestion des demandes,
//   Congés, Planning, Taux d'absence…) — ne jamais la dupliquer ailleurs.
// Sans Supabase — utilise api/db uniquement.
// =====================================================

interface UseManagerPopulationResult {
  managerCollaborateurId: string | null;
  collaborateurIds: string[];
  uoIds: string[];
  uoByCollaborateur: Record<string, string>;
  uoLabels: Record<string, string>;
  uoParent: Record<string, string>;
  uoCode: Record<string, string>;
  loading: boolean;
}

const isAffActive = (a: any, today: string) => !a?.date_fin_uo || a.date_fin_uo >= today;

export function useManagerPopulation(): UseManagerPopulationResult {
  const { user, role, profile } = useAuth();
  const [managerCollaborateurId, setManagerCollaborateurId] = useState<string | null>(null);
  const [collaborateurIds, setCollaborateurIds] = useState<string[]>([]);
  const [uoIds, setUoIds] = useState<string[]>([]);
  const [uoByCollaborateur, setUoByCollaborateur] = useState<Record<string, string>>({});
  const [uoLabels, setUoLabels] = useState<Record<string, string>>({});
  const [uoParent, setUoParent] = useState<Record<string, string>>({});
  const [uoCode, setUoCode] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || role !== "manager") {
      setLoading(false);
      return;
    }
    loadPopulation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, role]);

  const loadPopulation = async () => {
    if (!user) return;
    setLoading(true);

    try {
      // ── Étape 1 : Résoudre le collaborateur_id du manager ───────────────
      let collaborateurId: string | null = null;

      const profileRow = await db.findOne<{ collaborateur_id?: string }>(
        "profiles",
        { select: "collaborateur_id", user_id: user.id }
      );
      collaborateurId = profileRow?.collaborateur_id ?? null;

      if (!collaborateurId && (profile as any)?.collaborateur_id) {
        collaborateurId = (profile as any).collaborateur_id;
      }

      const email = (user as any)?.email || (profile as any)?.email || null;
      if (!collaborateurId && email) {
        const collabByEmail = await db.findOne<{ id: string }>(
          "collaborateurs",
          { select: "id", email_professionnel: email, archive: false }
        );
        collaborateurId = collabByEmail?.id ?? null;
        if (collaborateurId) {
          await db.update("profiles", { user_id: user.id }, { collaborateur_id: collaborateurId });
        }
      }

      setManagerCollaborateurId(collaborateurId);

      if (!collaborateurId) {
        console.warn("[useManagerPopulation] Aucun collaborateur lié — user.id:", user.id);
        setCollaborateurIds([]); setUoIds([]); setUoByCollaborateur({}); setUoLabels({}); setUoParent({}); setUoCode({});
        return;
      }

      const today = new Date().toISOString().slice(0, 10);

      // ── Étape 2 : UO racines dont le manager est responsable ────────────
      const uosDirectes = await db.list<{ id: string }>(
        "unites_organisationnelles",
        { select: "id", responsable_id: collaborateurId, actif: true }
      );

      // Postes ACTIFS du manager (filtrage côté JS — plus de "isnull")
      const affManager = await db.list<{ code_poste?: string; date_fin_uo?: string }>(
        "collaborateur_affectations",
        { select: "code_poste,date_fin_uo", collaborateur_id: collaborateurId, archive: false }
      );
      const postesManager = [...new Set(
        affManager.filter(a => isAffActive(a, today)).map(a => a.code_poste).filter(Boolean) as string[]
      )];

      let uosViaPoste: { id: string }[] = [];
      if (postesManager.length > 0) {
        uosViaPoste = await db.list<{ id: string }>(
          "unites_organisationnelles",
          { select: "id", poste_responsable_code: `in.(${postesManager.join(",")})`, actif: true }
        );
      }

      const directUoIds = [...new Set([
        ...uosDirectes.map(u => u.id),
        ...uosViaPoste.map(u => u.id),
      ])];

      // ── Étape 3 : Descendance récursive des UO ──────────────────────────
      const allUoIds = directUoIds.length ? await getUoSubtree(directUoIds) : [];

      // ── Étape 4 : Collaborateurs du périmètre ───────────────────────────
      const uoByCol: Record<string, string> = {};
      const seen = new Set<string>();

      const ingest = (rows: any[]) => {
        rows.filter(a => isAffActive(a, today)).forEach((a: any) => {
          const cid = a.collaborateur_id;
          if (!cid || cid === collaborateurId) return; // exclure le manager lui-même
          seen.add(cid);
          if (!uoByCol[cid] && a.unite_id) uoByCol[cid] = a.unite_id;
        });
      };

      // 4a. DYNAMIQUE : affectations dans les UO du périmètre
      if (allUoIds.length) {
        const affUO = await db.list<any>("collaborateur_affectations", {
          select: "collaborateur_id,unite_id,date_fin_uo",
          unite_id: `in.(${allUoIds.join(",")})`,
          archive: false,
        });
        ingest(affUO);
      }

      // 4b. FORÇAGE : manager_n1_id OU manager_n2_id = le manager
      const [affN1, affN2] = await Promise.all([
        db.list<any>("collaborateur_affectations", {
          select: "collaborateur_id,unite_id,date_fin_uo",
          manager_n1_id: collaborateurId, archive: false,
        }),
        db.list<any>("collaborateur_affectations", {
          select: "collaborateur_id,unite_id,date_fin_uo",
          manager_n2_id: collaborateurId, archive: false,
        }),
      ]);
      ingest(affN1);
      ingest(affN2);

      const collabIds = Array.from(seen);

      // ── Étape 5 : Libellés des UO ───────────────────────────────────────
      const allRelevantUo = [...new Set([...allUoIds, ...Object.values(uoByCol)])];
      const labels: Record<string, string> = {};
      const parents: Record<string, string> = {};
      const codes: Record<string, string> = {};
      if (allRelevantUo.length) {
        const uoRows = await db.list<{ id: string; libelle?: string; parent_id?: string | null; code?: string }>(
          "unites_organisationnelles",
          { select: "id,libelle,parent_id,code", id: `in.(${allRelevantUo.join(",")})` }
        );
        uoRows.forEach(u => { labels[u.id] = u.libelle || u.id; if (u.parent_id) parents[u.id] = u.parent_id; if (u.code) codes[u.id] = u.code; });
      }

      setUoIds(allUoIds);
      setUoByCollaborateur(uoByCol);
      setUoLabels(labels);
      setUoParent(parents);
      setUoCode(codes);
      setCollaborateurIds(collabIds);
    } catch (err) {
      console.error("[useManagerPopulation] Erreur:", err);
      setCollaborateurIds([]); setUoIds([]); setUoByCollaborateur({}); setUoLabels({}); setUoParent({}); setUoCode({});
    } finally {
      setLoading(false);
    }
  };

  return { managerCollaborateurId, collaborateurIds, uoIds, uoByCollaborateur, uoLabels, uoParent, uoCode, loading };
}

// ── Parcours récursif de l'arbre UO (descendance) ────────────────────────────
// RG-MGR-POP-03 (Adil DAIA) : tous les collaborateurs des UO enfants
// (récursivement) sont inclus dans le périmètre du manager.
async function getUoSubtree(rootIds: string[]): Promise<string[]> {
  const visited = new Set<string>(rootIds);
  let toProcess = [...rootIds];
  let guard = 0;

  while (toProcess.length > 0 && guard < 10000) {
    guard++;
    const current = toProcess;
    toProcess = [];
    const children = await db.list<{ id: string }>("unites_organisationnelles", {
      select: "id",
      parent_id: `in.(${current.join(",")})`,
      actif: true,
    });
    for (const child of children) {
      if (!visited.has(child.id)) {
        visited.add(child.id);
        toProcess.push(child.id);
      }
    }
  }

  return Array.from(visited);
}
