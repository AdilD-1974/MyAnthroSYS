# === Création du dossier hooks si absent ===
New-Item -ItemType Directory -Force -Path src\hooks | Out-Null
New-Item -ItemType Directory -Force -Path src\components\affectation | Out-Null

# ==== 1/3 : src/hooks/useManagerHierarchie.ts ====
@'
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

'@ | Set-Content -Path src\hooks\useManagerHierarchie.ts -Encoding UTF8

# ==== 2/3 : src/components/affectation/WorkflowManagerForm.tsx ====
@'
/**
 * WorkflowManagerForm.tsx — Forçage workflow de validation
 * ────────────────────────────────────────────────────────────────────────────
 * REFONTE (17/05/2026) :
 *  ✓ Migration Supabase → API FastAPI (@/lib/api db.*)
 *  ✓ Quand forçage INACTIF : affiche les N+1/N+2 résolus dynamiquement
 *    via useManagerHierarchie (titulaire d'UO ou intérim, avec remontée
 *    automatique au parent si vacant). Selects désactivés avec valeur
 *    pré-sélectionnée + ligne contextuelle "via [UO] (source)".
 *  ✓ Quand forçage ACTIF : selects éditables, valeurs initialisées avec
 *    la résolution dynamique pour faciliter l'override.
 */
import React, { useEffect, useState } from "react";
import { db } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Save, Info, UserCog } from "lucide-react";
import { toast } from "sonner";
import { useManagerHierarchie, ResolvedManager } from "@/hooks/useManagerHierarchie";

interface Props {
  collaborateurId: string;
}

interface CollabOption {
  id: string;
  nom: string;
  prenom: string;
  matricule: string;
}

const WorkflowManagerForm: React.FC<Props> = ({ collaborateurId }) => {
  const [managerN1, setManagerN1] = useState<string | null>(null);
  const [managerN2, setManagerN2] = useState<string | null>(null);
  const [actif, setActif] = useState(false);
  const [commentaire, setCommentaire] = useState("");
  const [existingId, setExistingId] = useState<string | null>(null);
  const [collabs, setCollabs] = useState<CollabOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Résolution dynamique N+1/N+2
  const { n1: resolvedN1, n2: resolvedN2, loading: loadingHierarchie } =
    useManagerHierarchie(collaborateurId);

  // ── Chargement initial ─────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const loadAll = async () => {
      setLoading(true);
      try {
        const [wfList, collabList] = await Promise.all([
          db.list<any>("collaborateur_workflow_managers", {
            collaborateur_id: collaborateurId,
            limit: 1,
          }),
          db.list<CollabOption>("collaborateurs", {
            archive: false,
            order: "nom",
          }),
        ]);
        if (cancelled) return;

        const wf = wfList[0];
        if (wf) {
          setExistingId(wf.id);
          setManagerN1(wf.manager_n1_id);
          setManagerN2(wf.manager_n2_id);
          setActif(!!wf.actif);
          setCommentaire(wf.commentaire || "");
        }
        setCollabs(collabList.filter((c) => c.id !== collaborateurId));
      } catch (e: any) {
        console.error(e);
        toast.error(e?.message ?? "Erreur de chargement");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadAll();
    return () => {
      cancelled = true;
    };
  }, [collaborateurId]);

  // ── Pré-remplissage à l'activation du forçage ──────────────────────────
  // Si l'utilisateur active le forçage et que les selects sont vides, on
  // initialise avec la résolution dynamique pour qu'il parte d'une base
  // sensée et puisse juste ajuster.
  const handleToggle = () => {
    const newActif = !actif;
    if (newActif) {
      if (!managerN1 && resolvedN1) setManagerN1(resolvedN1.collab.id);
      if (!managerN2 && resolvedN2) setManagerN2(resolvedN2.collab.id);
    }
    setActif(newActif);
  };

  // ── Sauvegarde ─────────────────────────────────────────────────────────
  const save = async () => {
    setSaving(true);
    try {
      const payload: any = {
        collaborateur_id: collaborateurId,
        manager_n1_id: managerN1 || null,
        manager_n2_id: managerN2 || null,
        actif,
        commentaire: commentaire || null,
        updated_at: new Date().toISOString(),
      };

      if (existingId) {
        await db.update("collaborateur_workflow_managers", { id: existingId }, payload);
      } else {
        const inserted: any = await db.create("collaborateur_workflow_managers", payload);
        const newId =
          (Array.isArray(inserted) ? inserted[0]?.id : inserted?.id) ?? null;
        setExistingId(newId);
      }
      toast.success("Forçage workflow enregistré");
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "Erreur d'enregistrement");
    } finally {
      setSaving(false);
    }
  };

  // ── Styles ─────────────────────────────────────────────────────────────
  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: "hsl(var(--muted-foreground))",
    marginBottom: 2,
  };
  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "6px 10px",
    borderRadius: 8,
    fontSize: 13,
    border: "1px solid hsl(var(--border))",
    background: "hsl(var(--background))",
    color: "hsl(var(--foreground))",
  };

  // ── Sous-composants ────────────────────────────────────────────────────
  /** Affiche le résultat de la résolution dynamique (mode lecture seule). */
  const ResolvedDisplay: React.FC<{
    label: string;
    resolved: ResolvedManager | null;
  }> = ({ label, resolved }) => {
    if (!resolved) {
      return (
        <div>
          <p style={labelStyle}>{label} (résolu automatiquement)</p>
          <div
            style={{
              ...inputStyle,
              padding: "8px 10px",
              color: "hsl(var(--muted-foreground))",
              fontStyle: "italic",
            }}
          >
            — Aucun manager trouvé en remontant la hiérarchie —
          </div>
        </div>
      );
    }
    const { collab, uo, source, interim_date_fin, niveaux_remontes } = resolved;
    return (
      <div>
        <p style={labelStyle}>{label} (résolu automatiquement)</p>
        <div
          style={{
            ...inputStyle,
            padding: "8px 10px",
            background: "hsl(var(--accent) / 0.05)",
            borderColor: "hsl(var(--accent) / 0.2)",
          }}
        >
          <span style={{ fontWeight: 600 }}>
            {collab.prenom} {collab.nom}
          </span>
          <span
            style={{
              marginLeft: 6,
              fontSize: 11,
              color: "hsl(var(--muted-foreground))",
            }}
          >
            {collab.matricule}
          </span>
        </div>
        <p
          className="text-[10px] mt-1 flex items-center gap-1 flex-wrap"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          <Info size={10} />
          via <strong style={{ color: "hsl(var(--foreground))" }}>{uo.libelle}</strong>
          {niveaux_remontes > 0 && (
            <span>
              (remontée de {niveaux_remontes} niveau{niveaux_remontes > 1 ? "x" : ""})
            </span>
          )}
          {source === "interim" ? (
            <span
              className="px-1.5 py-0.5 rounded text-[9px] font-semibold ml-1"
              style={{
                background: "hsl(45 100% 50% / 0.15)",
                color: "hsl(45 100% 30%)",
              }}
            >
              INTÉRIM
              {interim_date_fin
                ? ` (jusqu'au ${new Date(interim_date_fin).toLocaleDateString("fr-FR")})`
                : ""}
            </span>
          ) : (
            <span
              className="px-1.5 py-0.5 rounded text-[9px] font-semibold ml-1"
              style={{
                background: "hsl(var(--accent) / 0.12)",
                color: "hsl(var(--accent))",
              }}
            >
              TITULAIRE
            </span>
          )}
        </p>
      </div>
    );
  };

  if (loading) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">Chargement…</p>
    );
  }

  return (
    <div>
      {/* Toggle */}
      <div className="flex items-center gap-3 mb-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <div
            className="relative w-9 h-5 rounded-full transition-colors"
            style={{
              background: actif ? "hsl(var(--accent))" : "hsl(var(--muted))",
            }}
            onClick={handleToggle}
          >
            <div
              className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
              style={{ left: actif ? 18 : 2 }}
            />
          </div>
          <span
            className="text-xs font-semibold"
            style={{ color: "hsl(var(--foreground))" }}
          >
            {actif ? "Forçage actif" : "Forçage inactif"}
          </span>
        </label>
        <p
          className="text-[10px]"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {actif
            ? "Les managers ci-dessous remplacent la hiérarchie UO pour le workflow."
            : "Les managers sont résolus automatiquement via les affectations et la hiérarchie UO."}
        </p>
      </div>

      {/* Mode INACTIF → affichage lecture seule de la résolution dynamique */}
      {!actif && (
        <>
          {loadingHierarchie ? (
            <p className="text-xs text-muted-foreground py-2">
              Résolution de la hiérarchie…
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ResolvedDisplay label="Manager N+1" resolved={resolvedN1} />
              <ResolvedDisplay label="Manager N+2" resolved={resolvedN2} />
            </div>
          )}
        </>
      )}

      {/* Mode ACTIF → selects éditables (override manuel) */}
      {actif && (
        <>
          <div
            className="flex items-start gap-2 px-3 py-2 rounded-lg mb-3 text-[11px]"
            style={{
              background: "hsl(45 100% 50% / 0.08)",
              border: "1px solid hsl(45 100% 50% / 0.2)",
              color: "hsl(45 100% 25%)",
            }}
          >
            <UserCog size={13} style={{ marginTop: 1, flexShrink: 0 }} />
            <span>
              Le forçage manuel remplace la résolution dynamique. Pense à le
              désactiver si la situation revient à la normale.
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p style={labelStyle}>Manager N+1</p>
              <select
                style={inputStyle}
                value={managerN1 || ""}
                onChange={(e) => setManagerN1(e.target.value || null)}
              >
                <option value="">— Aucun —</option>
                {collabs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.prenom} {c.nom} ({c.matricule})
                  </option>
                ))}
              </select>
              {resolvedN1 && managerN1 !== resolvedN1.collab.id && (
                <p
                  className="text-[10px] mt-1"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  Résolution auto aurait été : {resolvedN1.collab.prenom}{" "}
                  {resolvedN1.collab.nom}
                </p>
              )}
            </div>
            <div>
              <p style={labelStyle}>Manager N+2</p>
              <select
                style={inputStyle}
                value={managerN2 || ""}
                onChange={(e) => setManagerN2(e.target.value || null)}
              >
                <option value="">— Aucun —</option>
                {collabs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.prenom} {c.nom} ({c.matricule})
                  </option>
                ))}
              </select>
              {resolvedN2 && managerN2 !== resolvedN2.collab.id && (
                <p
                  className="text-[10px] mt-1"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  Résolution auto aurait été : {resolvedN2.collab.prenom}{" "}
                  {resolvedN2.collab.nom}
                </p>
              )}
            </div>
          </div>

          <div className="mt-3">
            <p style={labelStyle}>Commentaire</p>
            <textarea
              style={{ ...inputStyle, minHeight: 50 }}
              value={commentaire}
              onChange={(e) => setCommentaire(e.target.value)}
              placeholder="Raison du forçage…"
            />
          </div>
        </>
      )}

      <div className="flex justify-end mt-4">
        <Button size="sm" onClick={save} disabled={saving}>
          <Save size={13} className="mr-1" />
          {saving ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </div>
    </div>
  );
};

export default WorkflowManagerForm;

'@ | Set-Content -Path src\components\affectation\WorkflowManagerForm.tsx -Encoding UTF8

# ==== 3/3 : src/components/affectation/InterimSelector.tsx ====
@'
/**
 * InterimSelector.tsx — Gestion des intérims d'une UO
 * ────────────────────────────────────────────────────────────────────────────
 * À embarquer dans la fiche UO (page Organisations).
 *
 *   <InterimSelector uoId={uo.id} uoLibelle={uo.libelle} hasTitulaire={!!uo.responsable_id} />
 *
 * Permet de :
 *   - Lister les intérims (actif, futurs, passés) avec badges de statut
 *   - Désigner un nouvel intérim (collaborateur + période + motif)
 *   - Modifier ou archiver un intérim existant
 *
 * Rappel de la règle : l'intérim n'est consulté par la résolution du workflow
 * QUE si l'UO n'a pas de responsable titulaire (responsable_id IS NULL).
 * Si un titulaire existe, un bandeau avertit que l'intérim est dormant.
 */
import React, { useEffect, useState } from "react";
import { db } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus, Pencil, Trash2, Save, X, Search, UserCheck, AlertCircle, Clock,
} from "lucide-react";
import { toast } from "sonner";

interface Props {
  uoId: string;
  uoLibelle?: string;
  /** Si true, affiche un avertissement : titulaire présent → intérim dormant */
  hasTitulaire?: boolean;
}

interface Interim {
  id: string;
  unite_id: string;
  collaborateur_id: string;
  date_debut: string;
  date_fin: string | null;
  motif: string | null;
  reference_decision: string | null;
  date_decision: string | null;
  archive: boolean;
}

interface CollabOption {
  id: string;
  nom: string;
  prenom: string;
  matricule: string;
  statut_collaborateur?: string;
}

type StatutInterim = "EN_COURS" | "FUTUR" | "TERMINE";

const EMPTY: Partial<Interim> = {
  collaborateur_id: "",
  date_debut: "",
  date_fin: null,
  motif: null,
  reference_decision: null,
  date_decision: null,
};

function getStatut(i: Interim, today: string): StatutInterim {
  if (i.date_debut > today) return "FUTUR";
  if (!i.date_fin || i.date_fin >= today) return "EN_COURS";
  return "TERMINE";
}

const InterimSelector: React.FC<Props> = ({ uoId, uoLibelle, hasTitulaire }) => {
  const [interims, setInterims] = useState<Interim[]>([]);
  const [collabs, setCollabs] = useState<CollabOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Interim>>({});
  const [collabSearch, setCollabSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  // ── Chargement ────────────────────────────────────────────────────────
  const load = async () => {
    setLoading(true);
    try {
      const [ints, cols] = await Promise.all([
        db.list<Interim>("unite_interim", {
          unite_id: uoId,
          archive: false,
          order: "-date_debut",
        }),
        db.list<CollabOption>("collaborateurs", {
          archive: false,
          order: "nom",
        }),
      ]);
      setInterims(ints);
      setCollabs(cols.filter((c) => c.statut_collaborateur !== "SORTI"));
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "Erreur de chargement des intérims");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uoId]);

  // ── Actions ──────────────────────────────────────────────────────────
  const startAdd = () => {
    setForm({ ...EMPTY, unite_id: uoId });
    setAdding(true);
    setEditing(null);
    setCollabSearch("");
  };

  const startEdit = (row: Interim) => {
    setForm(row);
    setEditing(row.id);
    setAdding(false);
  };

  const cancel = () => {
    setForm({});
    setAdding(false);
    setEditing(null);
  };

  const save = async () => {
    // Validations
    if (!form.collaborateur_id) {
      toast.error("Sélectionne un collaborateur");
      return;
    }
    if (!form.date_debut) {
      toast.error("La date de début est obligatoire");
      return;
    }
    if (form.date_fin && form.date_fin < form.date_debut) {
      toast.error("La date de fin doit être ≥ date de début");
      return;
    }

    // Conflit : intérim qui chevauche pour la même UO ?
    const overlap = interims.find((i) => {
      if (editing && i.id === editing) return false;
      const aStart = form.date_debut!;
      const aEnd = form.date_fin || "9999-12-31";
      const bStart = i.date_debut;
      const bEnd = i.date_fin || "9999-12-31";
      return aStart <= bEnd && bStart <= aEnd;
    });
    if (overlap) {
      const collab = collabs.find((c) => c.id === overlap.collaborateur_id);
      if (
        !confirm(
          `Un intérim de ${collab ? `${collab.prenom} ${collab.nom}` : "?"} existe déjà sur une période qui chevauche (${overlap.date_debut} → ${overlap.date_fin || "ouvert"}). Continuer quand même ?`
        )
      ) {
        return;
      }
    }

    setSaving(true);
    try {
      const payload: any = {
        unite_id: uoId,
        collaborateur_id: form.collaborateur_id,
        date_debut: form.date_debut,
        date_fin: form.date_fin || null,
        motif: form.motif || null,
        reference_decision: form.reference_decision || null,
        date_decision: form.date_decision || null,
        updated_at: new Date().toISOString(),
      };

      if (editing) {
        await db.update("unite_interim", { id: editing }, payload);
        toast.success("Intérim mis à jour");
      } else {
        await db.create("unite_interim", payload);
        toast.success("Intérim désigné");
      }
      cancel();
      await load();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "Erreur d'enregistrement");
    } finally {
      setSaving(false);
    }
  };

  const archive = async (id: string) => {
    if (!confirm("Archiver cet intérim ? Il ne sera plus considéré par la résolution du workflow.")) return;
    try {
      await db.update("unite_interim", { id }, { archive: true });
      toast.success("Intérim archivé");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur d'archivage");
    }
  };

  // ── Helpers d'affichage ──────────────────────────────────────────────
  const collabLabel = (id: string) => {
    const c = collabs.find((c) => c.id === id);
    return c ? `${c.prenom} ${c.nom} (${c.matricule})` : id;
  };

  const fmtDate = (d: string | null | undefined) =>
    d ? new Date(d).toLocaleDateString("fr-FR") : "—";

  const statutBadge = (statut: StatutInterim) => {
    const map: Record<StatutInterim, { bg: string; text: string; label: string }> = {
      EN_COURS: {
        bg: "hsl(142 70% 45% / 0.15)",
        text: "hsl(142 70% 30%)",
        label: "EN COURS",
      },
      FUTUR: {
        bg: "hsl(210 70% 50% / 0.15)",
        text: "hsl(210 70% 35%)",
        label: "FUTUR",
      },
      TERMINE: {
        bg: "hsl(220 15% 50% / 0.15)",
        text: "hsl(220 15% 40%)",
        label: "TERMINÉ",
      },
    };
    const c = map[statut];
    return (
      <span
        className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
        style={{ background: c.bg, color: c.text }}
      >
        {c.label}
      </span>
    );
  };

  // Trier : EN_COURS d'abord, puis FUTUR, puis TERMINE
  const ordered = [...interims].sort((a, b) => {
    const sa = getStatut(a, today);
    const sb = getStatut(b, today);
    const w: Record<StatutInterim, number> = { EN_COURS: 0, FUTUR: 1, TERMINE: 2 };
    if (w[sa] !== w[sb]) return w[sa] - w[sb];
    return b.date_debut.localeCompare(a.date_debut);
  });

  // ── Styles ───────────────────────────────────────────────────────────
  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: "hsl(var(--muted-foreground))",
    marginBottom: 2,
  };
  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "6px 10px",
    borderRadius: 8,
    fontSize: 13,
    border: "1px solid hsl(var(--border))",
    background: "hsl(var(--background))",
    color: "hsl(var(--foreground))",
  };

  const filteredCollabs = collabSearch
    ? collabs.filter((c) =>
        `${c.nom} ${c.prenom} ${c.matricule}`
          .toLowerCase()
          .includes(collabSearch.toLowerCase())
      )
    : collabs;

  // ── Rendu du formulaire (dans un Dialog) ─────────────────────────────
  const renderFormDialog = () => (
    <Dialog
      open={adding || !!editing}
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
    >
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCheck size={16} />
            {editing ? "Modifier l'intérim" : "Désigner un intérim"}
            {uoLibelle && (
              <span className="text-xs text-muted-foreground font-normal ml-1">
                — {uoLibelle}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Collab picker */}
          <div>
            <p style={labelStyle}>Collaborateur *</p>
            {editing ? (
              <div style={{ ...inputStyle, padding: "8px 10px" }}>
                {collabLabel(form.collaborateur_id || "")}
              </div>
            ) : (
              <>
                <div className="relative mb-2">
                  <Search
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    style={{ ...inputStyle, paddingLeft: 32 }}
                    placeholder="Rechercher par nom, prénom, matricule…"
                    value={collabSearch}
                    onChange={(e) => setCollabSearch(e.target.value)}
                    autoFocus
                  />
                </div>
                {form.collaborateur_id ? (
                  <div
                    className="px-3 py-2 rounded-lg flex items-center justify-between"
                    style={{
                      background: "hsl(var(--accent) / 0.10)",
                      border: "1px solid hsl(var(--accent) / 0.25)",
                    }}
                  >
                    <span className="text-sm font-medium">
                      {collabLabel(form.collaborateur_id)}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-xs"
                      onClick={() => setForm((f) => ({ ...f, collaborateur_id: "" }))}
                    >
                      <X size={12} className="mr-1" /> Changer
                    </Button>
                  </div>
                ) : (
                  <div className="max-h-44 overflow-y-auto space-y-1 rounded-lg border p-1">
                    {filteredCollabs.slice(0, 30).map((c) => (
                      <button
                        key={c.id}
                        className="w-full text-left px-2 py-1.5 rounded hover:bg-accent/10 text-sm flex justify-between"
                        onClick={() =>
                          setForm((f) => ({ ...f, collaborateur_id: c.id }))
                        }
                      >
                        <span>
                          {c.prenom} {c.nom}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {c.matricule}
                        </span>
                      </button>
                    ))}
                    {filteredCollabs.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-2">
                        Aucun résultat
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p style={labelStyle}>Date début *</p>
              <input
                type="date"
                style={inputStyle}
                value={form.date_debut || ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, date_debut: e.target.value }))
                }
              />
            </div>
            <div>
              <p style={labelStyle}>Date fin (vide = ouvert)</p>
              <input
                type="date"
                style={inputStyle}
                value={form.date_fin || ""}
                min={form.date_debut || undefined}
                onChange={(e) =>
                  setForm((f) => ({ ...f, date_fin: e.target.value || null }))
                }
              />
            </div>
          </div>

          {/* Décision */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p style={labelStyle}>Réf. décision</p>
              <input
                style={inputStyle}
                value={form.reference_decision || ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, reference_decision: e.target.value || null }))
                }
              />
            </div>
            <div>
              <p style={labelStyle}>Date décision</p>
              <input
                type="date"
                style={inputStyle}
                value={form.date_decision || ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, date_decision: e.target.value || null }))
                }
              />
            </div>
          </div>

          {/* Motif */}
          <div>
            <p style={labelStyle}>Motif</p>
            <textarea
              style={{ ...inputStyle, minHeight: 60 }}
              value={form.motif || ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, motif: e.target.value || null }))
              }
              placeholder="Ex: Vacance de poste suite au départ de M. X, en attente du recrutement…"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={cancel} disabled={saving}>
            <X size={13} className="mr-1" /> Annuler
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            <Save size={13} className="mr-1" />
            {saving ? "Enregistrement…" : editing ? "Mettre à jour" : "Désigner"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // ── Rendu principal ──────────────────────────────────────────────────
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3
          className="font-semibold text-sm flex items-center gap-2"
          style={{ color: "hsl(var(--foreground))" }}
        >
          <UserCheck size={15} style={{ color: "hsl(var(--accent))" }} />
          Intérims
          {ordered.length > 0 && (
            <span
              className="px-1.5 py-0.5 rounded text-[10px] font-medium"
              style={{
                background: "hsl(var(--muted) / 0.4)",
                color: "hsl(var(--muted-foreground))",
              }}
            >
              {ordered.length}
            </span>
          )}
        </h3>
        <Button size="sm" variant="outline" onClick={startAdd}>
          <Plus size={13} className="mr-1" /> Désigner un intérim
        </Button>
      </div>

      {/* Avertissement si un titulaire existe déjà */}
      {hasTitulaire && (
        <div
          className="flex items-start gap-2 px-3 py-2 rounded-lg mb-3 text-[11px]"
          style={{
            background: "hsl(45 100% 50% / 0.08)",
            border: "1px solid hsl(45 100% 50% / 0.2)",
            color: "hsl(45 100% 25%)",
          }}
        >
          <AlertCircle size={13} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>
            Cette UO a un <strong>responsable titulaire</strong>. L'intérim ne
            sera pris en compte par la résolution du workflow que si le
            titulaire est retiré (responsable_id mis à null).
          </span>
        </div>
      )}

      {/* Liste */}
      {loading ? (
        <p className="text-xs text-muted-foreground py-6 text-center">Chargement…</p>
      ) : ordered.length === 0 ? (
        <p className="text-xs text-muted-foreground py-6 text-center italic">
          Aucun intérim désigné pour cette UO
        </p>
      ) : (
        <div className="space-y-2">
          {ordered.map((row) => {
            const statut = getStatut(row, today);
            return (
              <div
                key={row.id}
                className="rounded-lg border p-3 flex items-start justify-between gap-3"
                style={{
                  background: "hsl(var(--card))",
                  borderColor: "hsl(var(--border))",
                  opacity: statut === "TERMINE" ? 0.65 : 1,
                }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span
                      className="font-semibold text-sm"
                      style={{ color: "hsl(var(--foreground))" }}
                    >
                      {collabLabel(row.collaborateur_id)}
                    </span>
                    {statutBadge(statut)}
                  </div>
                  <div
                    className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-[11px]"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    <span className="flex items-center gap-1">
                      <Clock size={10} />
                      {fmtDate(row.date_debut)} →{" "}
                      {row.date_fin ? fmtDate(row.date_fin) : <em>ouvert</em>}
                    </span>
                    {row.reference_decision && (
                      <span>
                        Réf : <strong>{row.reference_decision}</strong>
                      </span>
                    )}
                    {row.date_decision && (
                      <span>Décision : {fmtDate(row.date_decision)}</span>
                    )}
                  </div>
                  {row.motif && (
                    <p
                      className="text-[11px] mt-1 italic"
                      style={{ color: "hsl(var(--muted-foreground) / 0.8)" }}
                    >
                      {row.motif}
                    </p>
                  )}
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => startEdit(row)}
                  >
                    <Pencil size={13} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive"
                    onClick={() => archive(row.id)}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {renderFormDialog()}
    </div>
  );
};

export default InterimSelector;

'@ | Set-Content -Path src\components\affectation\InterimSelector.tsx -Encoding UTF8

# === Vérifications ===
Write-Host ""
Write-Host "=== Vérifications ==="
$h = (Select-String -Path src\hooks\useManagerHierarchie.ts -Pattern "useManagerHierarchie","ResolvedManager" | Measure-Object).Count
$w = (Select-String -Path src\components\affectation\WorkflowManagerForm.tsx -Pattern "useManagerHierarchie","ResolvedDisplay","db.list" | Measure-Object).Count
$i = (Select-String -Path src\components\affectation\InterimSelector.tsx -Pattern "InterimSelector","db.list","db.create" | Measure-Object).Count
Write-Host "useManagerHierarchie.ts  : $h matches (attendu >= 3)"
Write-Host "WorkflowManagerForm.tsx  : $w matches (attendu >= 5)"
Write-Host "InterimSelector.tsx      : $i matches (attendu >= 4)"
