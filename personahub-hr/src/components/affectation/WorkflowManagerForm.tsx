/**
 * WorkflowManagerForm.tsx — Forçage workflow de validation
 * ────────────────────────────────────────────────────────────────────────────
 * v2 (17/05/2026) :
 *  ✓ Typographie alignée sur le pavé "Affectations UO / Poste" :
 *    labels gris semibold, valeurs en texte plat (pas de cadre/bordure)
 *  ✓ Suppression du suffixe "(résolu automatiquement)" — l'info est déjà
 *    portée par la phrase d'introduction sous le toggle.
 *
 * v1 :
 *  - Migration Supabase → @/lib/api db.*
 *  - Résolution dynamique N+1/N+2 via useManagerHierarchie
 *  - Selects désactivés en mode "inactif", éditables en mode "actif"
 */
import React, { useEffect, useState } from "react";
import { db } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Save, UserCog } from "lucide-react";
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

  const { n1: resolvedN1, n2: resolvedN2, loading: loadingHierarchie } =
    useManagerHierarchie(collaborateurId);

  // ── Chargement initial ──────────────────────────────────────────────────
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

  // ── Toggle ─────────────────────────────────────────────────────────────
  // ACTIVATION   : on prefill les selects avec la résolution dynamique
  //                (l'utilisateur valide ensuite manuellement avec Enregistrer)
  // DÉSACTIVATION: persistance immédiate de actif=false — pas de bouton
  //                Enregistrer car en mode auto il n'y a rien à sauver.
  //                Les valeurs manager_n1_id / manager_n2_id sont préservées
  //                en base pour le cas où l'utilisateur réactive plus tard.
  const handleToggle = async () => {
    const newActif = !actif;

    if (newActif) {
      if (!managerN1 && resolvedN1) setManagerN1(resolvedN1.collab.id);
      if (!managerN2 && resolvedN2) setManagerN2(resolvedN2.collab.id);
      setActif(true);
      return;
    }

    // Désactivation
    setActif(false);
    if (!existingId) return; // rien à sauver, actif=false est l'état par défaut
    try {
      await db.update(
        "collaborateur_workflow_managers",
        { id: existingId },
        { actif: false, updated_at: new Date().toISOString() }
      );
      toast.success("Forçage désactivé");
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur de désactivation");
      setActif(true); // rollback
    }
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

  // ── Styles alignés sur le reste de la fiche ─────────────────────────────
  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: "hsl(var(--muted-foreground))",
    marginBottom: 4,
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

  // ── Affichage lecture seule du résultat dynamique ───────────────────────
  const ResolvedDisplay: React.FC<{
    label: string;
    resolved: ResolvedManager | null;
  }> = ({ label, resolved }) => (
    <div>
      <p style={labelStyle}>{label}</p>
      {resolved ? (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>
              {resolved.collab.prenom} {resolved.collab.nom}
            </span>
            <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
              {resolved.collab.matricule}
            </span>
          </div>
          <p
            className="text-[11px] mt-1 flex items-center gap-1.5 flex-wrap"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            <span>
              via{" "}
              <span style={{ color: "hsl(var(--foreground))", fontWeight: 500 }}>
                {resolved.uo.libelle}
              </span>
              {resolved.niveaux_remontes > 0 && (
                <span>
                  {" "}
                  (remontée de {resolved.niveaux_remontes} niveau
                  {resolved.niveaux_remontes > 1 ? "x" : ""})
                </span>
              )}
            </span>
            {resolved.source === "interim" ? (
              <span
                className="px-1.5 py-0.5 rounded text-[9px] font-semibold"
                style={{
                  background: "hsl(45 100% 50% / 0.15)",
                  color: "hsl(45 100% 30%)",
                }}
              >
                INTÉRIM
                {resolved.interim_date_fin
                  ? ` · fin ${new Date(resolved.interim_date_fin).toLocaleDateString("fr-FR")}`
                  : ""}
              </span>
            ) : (
              <span
                className="px-1.5 py-0.5 rounded text-[9px] font-semibold"
                style={{
                  background: "hsl(var(--accent) / 0.12)",
                  color: "hsl(var(--accent))",
                }}
              >
                TITULAIRE
              </span>
            )}
          </p>
        </>
      ) : (
        <p
          className="text-sm italic"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          — Aucun manager trouvé en remontant la hiérarchie —
        </p>
      )}
    </div>
  );

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
            style={{ background: actif ? "hsl(var(--accent))" : "hsl(var(--muted))" }}
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

      {/* Mode INACTIF → affichage lecture seule */}
      {!actif && (
        <>
          {loadingHierarchie ? (
            <p className="text-xs text-muted-foreground py-2">
              Résolution de la hiérarchie…
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <ResolvedDisplay label="Manager N+1" resolved={resolvedN1} />
              <ResolvedDisplay label="Manager N+2" resolved={resolvedN2} />
            </div>
          )}
        </>
      )}

      {/* Mode ACTIF → édition manuelle */}
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
                  Résolution auto : {resolvedN1.collab.prenom} {resolvedN1.collab.nom}
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
                  Résolution auto : {resolvedN2.collab.prenom} {resolvedN2.collab.nom}
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

      {actif && (
        <div className="flex justify-end mt-4">
          <Button size="sm" onClick={save} disabled={saving}>
            <Save size={13} className="mr-1" />
            {saving ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      )}
    </div>
  );
};

export default WorkflowManagerForm;
