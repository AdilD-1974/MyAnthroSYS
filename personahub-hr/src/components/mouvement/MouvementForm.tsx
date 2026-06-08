/**
 * MouvementForm.tsx — Saisie / édition des mouvements internes
 * ─────────────────────────────────────────────────────────────────────────────
 * REFONTE (12/05/2026) :
 *  ✓ Migration complète Supabase → API FastAPI (@/lib/api)
 *  ✓ Prop `dateDebutContrat` : validation date_effet ≥ date début contrat
 *  ✓ Situation initiale (UO + poste actuel) en badges à couleur dynamique
 *    (couleur dérivée d'un hash du libellé, stable par libellé)
 *  ✓ Détection de conflit : si la date d'effet d'un nouveau mouvement = celle
 *    d'un mouvement ACTIF existant → alerte « Continuer / Annuler »
 *    Si « Continuer » : l'ancien mouvement passe à statut=ANNULE puis on crée
 *    le nouveau (remplacement complet).
 */
import React, { useEffect, useState } from "react";
import { db } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus, Pencil, Trash2, Save, X, Copy, ArrowRightLeft, AlertCircle, AlertTriangle,
} from "lucide-react";
import RefSelect from "@/components/RefSelect";
import { toast } from "sonner";

// ── Couleur dynamique stable par libellé (hash → HSL) ───────────────────────
const colorFromString = (s: string): { bg: string; text: string; border: string } => {
  if (!s) {
    return {
      bg: "hsl(0 0% 50% / 0.10)",
      text: "hsl(0 0% 30%)",
      border: "hsl(0 0% 50% / 0.25)",
    };
  }
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return {
    bg: `hsl(${hue} 70% 50% / 0.14)`,
    text: `hsl(${hue} 70% 32%)`,
    border: `hsl(${hue} 60% 50% / 0.30)`,
  };
};

// ── Types ────────────────────────────────────────────────────────────────────
interface Mouvement {
  id: string;
  collaborateur_id: string;
  code_type_mouvement: string;
  date_effet: string;
  date_fin_prevue: string | null;
  date_fin_effective: string | null;
  ancien_poste: string | null;
  ancienne_unite_id: string | null;
  nouveau_poste: string | null;
  nouvelle_unite_id: string | null;
  reference_decision: string | null;
  date_decision: string | null;
  commentaire: string | null;
  statut: string;
  archive: boolean;
}

interface Props {
  collaborateurId: string;
  /** Date de début du contrat en cours — utilisée pour la validation de date_effet */
  dateDebutContrat?: string | null;
}

const EMPTY: Partial<Mouvement> = {
  code_type_mouvement: "",
  date_effet: "",
  date_fin_prevue: null,
  date_fin_effective: null,
  ancien_poste: null,
  ancienne_unite_id: null,
  nouveau_poste: null,
  nouvelle_unite_id: null,
  reference_decision: null,
  date_decision: null,
  commentaire: null,
  statut: "ACTIF",
};

const MouvementForm: React.FC<Props> = ({ collaborateurId, dateDebutContrat }) => {
  const [rows, setRows] = useState<Mouvement[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Mouvement>>({});
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uoMap, setUoMap] = useState<Record<string, string>>({});
  const [typeMap, setTypeMap] = useState<Record<string, { libelle: string; est_temporaire: boolean; est_definitif: boolean }>>({});
  const [currentAffectation, setCurrentAffectation] = useState<{
    code_poste: string | null;
    unite_id: string | null;
    poste_libelle: string;
    uo_libelle: string;
    emploi_libelle: string;
  }>({ code_poste: null, unite_id: null, poste_libelle: "", uo_libelle: "", emploi_libelle: "" });
  const [allPostes, setAllPostes] = useState<{ code: string; libelle: string; unite_id: string | null; code_emploi: string | null }[]>([]);
  const [filteredPostes, setFilteredPostes] = useState<{ code: string; libelle: string; code_emploi: string | null }[]>([]);
  const [emploiMap, setEmploiMap] = useState<Record<string, string>>({});
  const [posteLibelleMap, setPosteLibelleMap] = useState<Record<string, string>>({});

  // Conflit de date (alerte continuer/annuler)
  const [conflictMvt, setConflictMvt] = useState<Mouvement | null>(null);
  const [saving, setSaving] = useState(false);

  // ── Chargement ────────────────────────────────────────────────────────────
  const load = async () => {
    setLoading(true);
    try {
      const data = await db.list<Mouvement>("collaborateur_mouvements", {
        collaborateur_id: collaborateurId,
        archive: false,
        order: "-date_effet",
      });
      setRows(data);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "Erreur chargement mouvements");
    } finally {
      setLoading(false);
    }
  };

  // Affectation active courante (auto-fill ancien poste / UO)
  const loadCurrentAffectation = async () => {
    try {
      const aff = await db.findOne<any>("collaborateur_affectations", {
        collaborateur_id: collaborateurId,
        archive: false,
        date_fin_uo__isnull: true,
        order: "-date_debut_uo",
      });
      if (!aff) return;

      let posteLib = aff.code_poste || "";
      let uoLib = "";
      let emploiLib = "";

      if (aff.code_poste) {
        // code_poste = code instance (ex: RSADM-001) → résolution parent + emploi
        try {
          const inst = await db.findOne<any>("ref_poste_instances", {
            code_instance: aff.code_poste,
          });
          const parentCode = inst?.code_poste || aff.code_poste;
          const parent = await db.findOne<any>("ref_poste", { code: parentCode });
          if (parent) {
            posteLib = parent.libelle;
            if (parent.code_emploi) {
              const empl = await db.findOne<any>("ref_emploi", { code: parent.code_emploi });
              if (empl?.libelle) emploiLib = empl.libelle;
            }
          }
        } catch {
          /* tolérant */
        }
      }

      if (aff.unite_id) {
        try {
          const uo = await db.findOne<any>("unites_organisationnelles", { id: aff.unite_id });
          if (uo?.libelle) uoLib = uo.libelle;
        } catch {
          /* tolérant */
        }
      }

      setCurrentAffectation({
        code_poste: aff.code_poste,
        unite_id: aff.unite_id,
        poste_libelle: posteLib,
        uo_libelle: uoLib,
        emploi_libelle: emploiLib,
      });
    } catch (e) {
      console.error("Erreur chargement affectation :", e);
    }
  };

  useEffect(() => {
    load();
    loadCurrentAffectation();

    // UO map
    db.list<any>("unites_organisationnelles").then((data) => {
      const m: Record<string, string> = {};
      data.forEach((r) => { m[r.id] = r.libelle; });
      setUoMap(m);
    });

    // Type mouvement map (actifs uniquement)
    db.list<any>("ref_type_mouvement", { actif: true }).then((data) => {
      const m: Record<string, { libelle: string; est_temporaire: boolean; est_definitif: boolean }> = {};
      data.forEach((r) => {
        m[r.code] = {
          libelle: r.libelle,
          est_temporaire: !!r.est_temporaire,
          est_definitif: !!r.est_definitif,
        };
      });
      setTypeMap(m);
    });

    // Postes (actifs)
    db.list<any>("ref_poste", { actif: true }).then((data) => {
      setAllPostes(data);
      const pm: Record<string, string> = {};
      data.forEach((r) => { pm[r.code] = r.libelle; });
      setPosteLibelleMap(pm);
    });

    // Emplois (actifs)
    db.list<any>("ref_emploi", { actif: true }).then((data) => {
      const m: Record<string, string> = {};
      data.forEach((r) => { m[r.code] = r.libelle; });
      setEmploiMap(m);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collaborateurId]);

  // Filtre postes par UO sélectionnée
  useEffect(() => {
    if (form.nouvelle_unite_id) {
      setFilteredPostes(allPostes.filter((p) => p.unite_id === form.nouvelle_unite_id));
    } else {
      setFilteredPostes([]);
    }
  }, [form.nouvelle_unite_id, allPostes]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const startAdd = () => {
    setForm({
      ...EMPTY,
      ancien_poste: currentAffectation.code_poste,
      ancienne_unite_id: currentAffectation.unite_id,
    });
    setAdding(true);
    setEditing(null);
  };

  /**
   * Sauvegarde : effectue toutes les validations, détecte un conflit de date,
   * et délègue à doSave() si tout est OK.
   */
  const save = async () => {
    // 1) Champs obligatoires
    if (!form.code_type_mouvement || !form.date_effet) {
      toast.error("Type de mouvement et date d'effet sont obligatoires");
      return;
    }

    // 2) Validation date_effet ≥ date début contrat (spec)
    if (dateDebutContrat && form.date_effet < dateDebutContrat) {
      toast.error(
        `La date d'effet doit être ≥ date début contrat (${new Date(dateDebutContrat).toLocaleDateString("fr-FR")})`
      );
      return;
    }

    // 3) Définitif → nouvelle UO obligatoire
    const isDefinitif = typeMap[form.code_type_mouvement]?.est_definitif ?? false;
    if (isDefinitif && !form.nouvelle_unite_id) {
      toast.error("La nouvelle UO est obligatoire pour un mouvement définitif");
      return;
    }

    // 4) Détection conflit de date (uniquement pour les NOUVEAUX mouvements,
    //    on n'alerte pas lors d'une simple édition d'un mouvement existant)
    if (!editing) {
      const conflicting = rows.find(
        (r) => r.statut === "ACTIF" && !r.archive && r.date_effet === form.date_effet
      );
      if (conflicting) {
        setConflictMvt(conflicting);
        return; // l'utilisateur tranche dans le dialog
      }
    }

    await doSave();
  };

  /**
   * Sauvegarde effective (appelée après validations + résolution du conflit).
   */
  const doSave = async () => {
    setSaving(true);
    try {
      const isDefinitif = typeMap[form.code_type_mouvement!]?.est_definitif ?? false;

      if (editing) {
        await db.update("collaborateur_mouvements", { id: editing }, {
          ...form,
          updated_at: new Date().toISOString(),
        });
        toast.success("Mouvement mis à jour");
      } else {
        await db.create("collaborateur_mouvements", {
          ...form,
          collaborateur_id: collaborateurId,
        });

        // Si définitif → clôturer ancienne affectation & créer la nouvelle
        if (isDefinitif) {
          await handleDefinitifAffectation();
        }
        toast.success("Mouvement ajouté");
      }
      setEditing(null);
      setAdding(false);
      setForm({});
      await load();
      await loadCurrentAffectation();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "Erreur d'enregistrement");
    } finally {
      setSaving(false);
    }
  };

  /** Confirme le remplacement : annule l'ancien mouvement puis sauvegarde le nouveau */
  const handleConflictContinue = async () => {
    if (!conflictMvt) return;
    try {
      await db.update("collaborateur_mouvements", { id: conflictMvt.id }, {
        statut: "ANNULE",
        updated_at: new Date().toISOString(),
      });
      toast.info("Mouvement précédent annulé");
      setConflictMvt(null);
      await doSave();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "Erreur lors de l'annulation");
    }
  };

  const recalcParentPosteState = async (codeInstance: string) => {
    const codeParent = codeInstance.includes("-")
      ? codeInstance.split("-").slice(0, -1).join("-")
      : codeInstance;
    try {
      const instances = await db.list<any>("ref_poste_instances", {
        code_poste: codeParent,
      });
      const etats = instances.map((i: any) => i.code_etat);
      let newEtat = "VA";
      if (etats.some((e: string) => e === "AT")) newEtat = "AT";
      else if (etats.some((e: string) => e === "EC")) newEtat = "EC";

      // Update par code (clé naturelle de ref_poste)
      const parent = await db.findOne<any>("ref_poste", { code: codeParent });
      if (parent?.code) {
        await db.update("ref_poste", { code: parent.code }, {
          code_etat_poste: newEtat,
        });
      }
    } catch (e) {
      console.error("recalcParentPosteState :", e);
    }
  };

  const handleDefinitifAffectation = async () => {
    const dateEffet = form.date_effet!;
    const dEffet = new Date(dateEffet);
    const dCloture = new Date(dEffet.getFullYear(), dEffet.getMonth(), dEffet.getDate() - 1);
    const dateCloture = `${dCloture.getFullYear()}-${String(dCloture.getMonth() + 1).padStart(2, "0")}-${String(dCloture.getDate()).padStart(2, "0")}`;

    // 1) Clôturer l'(les) affectation(s) active(s)
    const activeAffs = await db.list<any>("collaborateur_affectations", {
      collaborateur_id: collaborateurId,
      archive: false,
      date_fin_uo__isnull: true,
    });
    for (const aff of activeAffs) {
      await db.update("collaborateur_affectations", { id: aff.id }, {
        date_fin_uo: dateCloture,
        date_fin_poste: dateCloture,
        updated_at: new Date().toISOString(),
      });
    }

    // 2) Libérer l'ancienne instance de poste → VA
    if (currentAffectation.code_poste) {
      const inst = await db.findOne<any>("ref_poste_instances", {
        code_instance: currentAffectation.code_poste,
      });
      if (inst?.id) {
        await db.update("ref_poste_instances", { id: inst.id }, {
          code_etat: "VA",
          collaborateur_id: null,
        });
      }
      await recalcParentPosteState(currentAffectation.code_poste);
    }

    // 3) Trouver une instance vacante du nouveau poste
    let instanceCode: string | null = null;
    if (form.nouveau_poste) {
      const vacant = await db.findOne<any>("ref_poste_instances", {
        code_poste: form.nouveau_poste,
        code_etat: "VA",
        archive: false,
      });
      if (!vacant) {
        toast.error("Aucune instance vacante pour le poste sélectionné");
        return;
      }
      instanceCode = vacant.code_instance;

      // Attribuer l'instance → AT
      await db.update("ref_poste_instances", { id: vacant.id }, {
        code_etat: "AT",
        collaborateur_id: collaborateurId,
      });
      await recalcParentPosteState(instanceCode!);
    }

    // 4) Mettre à jour le dernier mouvement créé avec le code instance réel
    if (instanceCode && form.nouveau_poste) {
      const lastMvt = await db.findOne<any>("collaborateur_mouvements", {
        collaborateur_id: collaborateurId,
        archive: false,
        order: "-created_at",
      });
      if (lastMvt?.id) {
        await db.update("collaborateur_mouvements", { id: lastMvt.id }, {
          nouveau_poste: instanceCode,
        });
      }
    }

    // 5) Créer la nouvelle affectation
    const codePosteFinal = instanceCode || currentAffectation.code_poste || null;
    const newAff: any = {
      collaborateur_id: collaborateurId,
      unite_id: form.nouvelle_unite_id,
      date_debut_uo: dateEffet,
      date_debut_poste: codePosteFinal ? dateEffet : null,
      code_poste: codePosteFinal,
      motif_affectation: form.code_type_mouvement,
      commentaire: `Mouvement définitif — ${typeMap[form.code_type_mouvement!]?.libelle || form.code_type_mouvement}`,
    };
    try {
      await db.create("collaborateur_affectations", newAff);
      toast.success("Nouvelle affectation créée automatiquement");
    } catch (e: any) {
      console.error("Erreur création affectation :", e, "Payload :", newAff);
      toast.error("Erreur création affectation : " + (e?.message ?? "inconnue"), { duration: 8000 });
    }

    // 6) RG-UO-RESP-DYNAMIC : mise à jour des responsables d'UO
    await updateUoResponsables(currentAffectation.unite_id, form.nouvelle_unite_id, instanceCode);
  };

  const updateUoResponsables = async (
    ancienneUoId: string | null,
    nouvelleUoId: string | null | undefined,
    nouveauPosteInstance: string | null
  ) => {
    // a) Si le collab quitte son ancienne UO et qu'il en était responsable → libérer
    if (ancienneUoId) {
      try {
        const ancienneUo = await db.findOne<any>("unites_organisationnelles", {
          id: ancienneUoId,
        });
        if (ancienneUo?.responsable_id === collaborateurId) {
          await db.update("unites_organisationnelles", { id: ancienneUoId }, {
            responsable_id: null,
            responsable_temporaire: null,
          });
          toast.info("Le responsable de l'ancienne UO a été libéré automatiquement");
        }
      } catch (e) {
        console.error("updateUoResponsables (ancienne) :", e);
      }
    }

    // b) Si le nouveau poste = poste_responsable_code de la nouvelle UO → devient responsable
    if (nouvelleUoId && nouveauPosteInstance) {
      try {
        const codePosteParent = nouveauPosteInstance.includes("-")
          ? nouveauPosteInstance.split("-").slice(0, -1).join("-")
          : nouveauPosteInstance;
        const nouvelleUo = await db.findOne<any>("unites_organisationnelles", {
          id: nouvelleUoId,
        });
        if (nouvelleUo?.poste_responsable_code === codePosteParent) {
          await db.update("unites_organisationnelles", { id: nouvelleUoId }, {
            responsable_id: collaborateurId,
            responsable_temporaire: false,
          });
          toast.info("Le collaborateur est devenu responsable de la nouvelle UO");
        }
      } catch (e) {
        console.error("updateUoResponsables (nouvelle) :", e);
      }
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Supprimer ce mouvement ?")) return;
    try {
      await db.update("collaborateur_mouvements", { id }, { archive: true });
      toast.success("Mouvement archivé");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur suppression");
    }
  };

  const duplicate = (row: Mouvement) => {
    setForm({
      ...EMPTY,
      code_type_mouvement: row.code_type_mouvement,
      ancien_poste: row.nouveau_poste,
      ancienne_unite_id: row.nouvelle_unite_id,
      date_effet: "",
    });
    setAdding(true);
    setEditing(null);
  };

  const cloturer = async (id: string) => {
    const today = new Date().toISOString().split("T")[0];
    try {
      await db.update("collaborateur_mouvements", { id }, {
        statut: "CLOTURE",
        date_fin_effective: today,
      });
      toast.success("Mouvement clôturé");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur clôture");
    }
  };

  const isTemporaire = (code: string) => typeMap[code]?.est_temporaire ?? false;

  // Alertes : mouvements temporaires sans fin prévue ou dans les 30j
  const alertes = rows.filter((r) => {
    if (r.statut !== "ACTIF" || !isTemporaire(r.code_type_mouvement)) return false;
    if (!r.date_fin_prevue) return true;
    const today = new Date();
    const fin = new Date(r.date_fin_prevue);
    const diff = (fin.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
    return diff <= 30;
  });

  // ── Styles communs ────────────────────────────────────────────────────────
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

  // ── Sous-rendu : badge couleur dynamique ─────────────────────────────────
  const DynamicBadge: React.FC<{ value: string }> = ({ value }) => {
    const c = colorFromString(value || "—");
    return (
      <span
        className="inline-block px-3 py-1.5 rounded-lg text-xs font-semibold"
        style={{
          background: c.bg,
          color: c.text,
          border: `1px solid ${c.border}`,
          maxWidth: "100%",
        }}
        title={value}
      >
        {value || "—"}
      </span>
    );
  };

  // ── Formulaire ────────────────────────────────────────────────────────────
  const renderForm = () => {
    const dateEffetMin = dateDebutContrat || undefined;
    const dateEffetInvalid =
      !!dateDebutContrat && !!form.date_effet && form.date_effet < dateDebutContrat;

    return (
      <div
        className="rounded-xl border p-4 mb-3"
        style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <p style={labelStyle}>Type de mouvement *</p>
            <RefSelect
              table="ref_type_mouvement"
              value={form.code_type_mouvement || ""}
              onChange={(v) => setForm((f) => ({ ...f, code_type_mouvement: v }))}
              label=""
            />
          </div>
          <div>
            <p style={labelStyle}>Date d'effet *</p>
            <input
              type="date"
              style={{
                ...inputStyle,
                borderColor: dateEffetInvalid ? "hsl(0 70% 50%)" : inputStyle.border as string,
              }}
              min={dateEffetMin}
              value={form.date_effet || ""}
              onChange={(e) => setForm((f) => ({ ...f, date_effet: e.target.value }))}
            />
            {dateEffetInvalid && (
              <p className="text-[10px] mt-1" style={{ color: "hsl(0 70% 40%)" }}>
                ≥ date début contrat ({new Date(dateDebutContrat!).toLocaleDateString("fr-FR")})
              </p>
            )}
          </div>
          <div>
            <p style={labelStyle}>Statut</p>
            <select
              style={inputStyle}
              value={form.statut || "ACTIF"}
              onChange={(e) => setForm((f) => ({ ...f, statut: e.target.value }))}
            >
              <option value="ACTIF">Actif</option>
              <option value="CLOTURE">Clôturé</option>
              <option value="ANNULE">Annulé</option>
            </select>
          </div>
        </div>

        {/* Dates fin si temporaire */}
        {isTemporaire(form.code_type_mouvement || "") && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <div>
              <p style={labelStyle}>Date fin prévue</p>
              <input
                type="date"
                style={inputStyle}
                value={form.date_fin_prevue || ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, date_fin_prevue: e.target.value || null }))
                }
              />
            </div>
            <div>
              <p style={labelStyle}>Date fin effective</p>
              <input
                type="date"
                style={inputStyle}
                value={form.date_fin_effective || ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, date_fin_effective: e.target.value || null }))
                }
              />
            </div>
          </div>
        )}

        {/* ── Situation initiale (BADGES COULEUR DYNAMIQUE) ─────────── */}
        <p
          className="text-[11px] font-semibold mt-4 mb-2"
          style={{ color: "hsl(var(--accent))" }}
        >
          Situation initiale
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <p style={labelStyle}>UO actuelle</p>
            <DynamicBadge
              value={
                currentAffectation.uo_libelle ||
                (form.ancienne_unite_id ? uoMap[form.ancienne_unite_id] || "" : "") ||
                "—"
              }
            />
          </div>
          <div>
            <p style={labelStyle}>Poste actuel</p>
            <DynamicBadge
              value={
                currentAffectation.emploi_libelle ||
                currentAffectation.poste_libelle ||
                form.ancien_poste ||
                "—"
              }
            />
          </div>
        </div>

        {/* Nouvelle situation */}
        <p
          className="text-[11px] font-semibold mt-4 mb-1"
          style={{ color: "hsl(var(--accent))" }}
        >
          Nouvelle situation
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <p style={labelStyle}>Nouvelle UO *</p>
            <select
              style={inputStyle}
              value={form.nouvelle_unite_id || ""}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  nouvelle_unite_id: e.target.value || null,
                  nouveau_poste: null,
                }))
              }
            >
              <option value="">— Sélectionner une UO —</option>
              {Object.entries(uoMap).map(([id, lib]) => (
                <option key={id} value={id}>{lib}</option>
              ))}
            </select>
          </div>
          <div>
            <p style={labelStyle}>Nouveau poste</p>
            <select
              style={inputStyle}
              value={form.nouveau_poste || ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, nouveau_poste: e.target.value || null }))
              }
              disabled={!form.nouvelle_unite_id}
            >
              <option value="">
                {form.nouvelle_unite_id ? "— Sélectionner un poste —" : "— Choisir d'abord une UO —"}
              </option>
              {filteredPostes.map((p) => (
                <option key={p.code} value={p.code}>{p.libelle}</option>
              ))}
            </select>
            {form.nouveau_poste && (() => {
              const poste = allPostes.find((p) => p.code === form.nouveau_poste);
              const emploiLib = poste?.code_emploi ? emploiMap[poste.code_emploi] : null;
              return emploiLib ? (
                <p
                  className="text-[10px] mt-1 italic"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  Emploi : <strong>{emploiLib}</strong>
                </p>
              ) : null;
            })()}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <div>
            <p style={labelStyle}>Réf. décision</p>
            <input
              style={inputStyle}
              value={form.reference_decision || ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, reference_decision: e.target.value }))
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

        <div className="mt-3">
          <p style={labelStyle}>Commentaire</p>
          <textarea
            style={{ ...inputStyle, minHeight: 60 }}
            value={form.commentaire || ""}
            onChange={(e) =>
              setForm((f) => ({ ...f, commentaire: e.target.value }))
            }
          />
        </div>

        <div className="flex gap-2 mt-3">
          <Button size="sm" onClick={save} disabled={saving}>
            <Save size={13} className="mr-1" />
            {editing ? "Mettre à jour" : "Enregistrer"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => { setEditing(null); setAdding(false); setForm({}); }}
            disabled={saving}
          >
            <X size={13} className="mr-1" />
            Annuler
          </Button>
        </div>
      </div>
    );
  };

  const statutBadge = (statut: string) => {
    const colors: Record<string, { bg: string; text: string }> = {
      ACTIF: { bg: "hsl(142 70% 45% / 0.12)", text: "hsl(142 70% 30%)" },
      CLOTURE: { bg: "hsl(220 15% 50% / 0.12)", text: "hsl(220 15% 40%)" },
      ANNULE: { bg: "hsl(0 70% 50% / 0.12)", text: "hsl(0 70% 35%)" },
    };
    const c = colors[statut] || colors.ACTIF;
    return (
      <span
        className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
        style={{ background: c.bg, color: c.text }}
      >
        {statut}
      </span>
    );
  };

  return (
    <div>
      {/* Alertes mouvements temporaires */}
      {alertes.length > 0 && (
        <div
          className="flex items-start gap-2 px-4 py-3 rounded-xl mb-4"
          style={{
            background: "hsl(45 100% 50% / 0.10)",
            border: "1px solid hsl(45 100% 50% / 0.25)",
          }}
        >
          <AlertCircle
            size={15}
            style={{ color: "hsl(45 100% 30%)", flexShrink: 0, marginTop: 2 }}
          />
          <div>
            <p className="text-xs font-semibold" style={{ color: "hsl(45 100% 30%)" }}>
              {alertes.length} mouvement(s) temporaire(s) à surveiller
            </p>
            {alertes.map((a) => (
              <p key={a.id} className="text-[11px] mt-1" style={{ color: "hsl(45 100% 25%)" }}>
                • {typeMap[a.code_type_mouvement]?.libelle || a.code_type_mouvement}
                {a.date_fin_prevue
                  ? ` — fin prévue le ${new Date(a.date_fin_prevue).toLocaleDateString("fr-FR")}`
                  : " — aucune date de fin prévue"}
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-2 h-5 text-[10px]"
                  onClick={() => cloturer(a.id)}
                >
                  Clôturer
                </Button>
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <h3
          className="font-semibold text-sm flex items-center gap-2"
          style={{ color: "hsl(var(--foreground))" }}
        >
          <ArrowRightLeft size={15} style={{ color: "hsl(var(--accent))" }} />
          Mouvements internes
        </h3>
        {!adding && !editing && (
          <Button size="sm" variant="outline" onClick={startAdd}>
            <Plus size={13} className="mr-1" />Ajouter
          </Button>
        )}
      </div>

      {(adding || editing) && renderForm()}

      {loading ? (
        <p className="text-xs text-muted-foreground py-4 text-center">Chargement…</p>
      ) : rows.length === 0 && !adding ? (
        <p className="text-xs text-muted-foreground py-8 text-center">
          Aucun mouvement enregistré
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div
              key={row.id}
              className="rounded-lg border p-3 flex items-start justify-between gap-3"
              style={{
                background: "hsl(var(--card))",
                borderColor: "hsl(var(--border))",
              }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="font-semibold text-xs"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {typeMap[row.code_type_mouvement]?.libelle || row.code_type_mouvement}
                  </span>
                  {statutBadge(row.statut)}
                  {isTemporaire(row.code_type_mouvement) && (
                    <span
                      className="px-1.5 py-0.5 rounded text-[9px] font-medium"
                      style={{
                        background: "hsl(280 65% 50% / 0.12)",
                        color: "hsl(280 65% 40%)",
                      }}
                    >
                      Temporaire
                    </span>
                  )}
                  {typeMap[row.code_type_mouvement]?.est_definitif && (
                    <span
                      className="px-1.5 py-0.5 rounded text-[9px] font-medium"
                      style={{
                        background: "hsl(210 70% 50% / 0.12)",
                        color: "hsl(210 70% 35%)",
                      }}
                    >
                      Définitif
                    </span>
                  )}
                </div>
                <div
                  className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-[11px]"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  <span>
                    Date d'effet :{" "}
                    <strong>
                      {row.date_effet ? new Date(row.date_effet).toLocaleDateString("fr-FR") : "—"}
                    </strong>
                  </span>
                  {row.date_fin_prevue && (
                    <span>
                      Fin prévue :{" "}
                      <strong>{new Date(row.date_fin_prevue).toLocaleDateString("fr-FR")}</strong>
                    </span>
                  )}
                  {row.date_fin_effective && (
                    <span>
                      Fin effective :{" "}
                      <strong>{new Date(row.date_fin_effective).toLocaleDateString("fr-FR")}</strong>
                    </span>
                  )}
                  {row.ancien_poste && (
                    <span>
                      De :{" "}
                      {(() => {
                        const parentCode = row.ancien_poste!.includes("-")
                          ? row.ancien_poste!.split("-").slice(0, -1).join("-")
                          : row.ancien_poste!;
                        return posteLibelleMap[parentCode] || row.ancien_poste;
                      })()}
                    </span>
                  )}
                  {row.nouveau_poste && (
                    <span>
                      Vers :{" "}
                      {(() => {
                        const parentCode = row.nouveau_poste!.includes("-")
                          ? row.nouveau_poste!.split("-").slice(0, -1).join("-")
                          : row.nouveau_poste!;
                        return posteLibelleMap[parentCode] || row.nouveau_poste;
                      })()}
                    </span>
                  )}
                  {row.ancienne_unite_id && (
                    <span>Anc. UO : {uoMap[row.ancienne_unite_id] || "—"}</span>
                  )}
                  {row.nouvelle_unite_id && (
                    <span>Nouv. UO : {uoMap[row.nouvelle_unite_id] || "—"}</span>
                  )}
                  {row.reference_decision && (
                    <span>Décision : {row.reference_decision}</span>
                  )}
                </div>
                {row.commentaire && (
                  <p
                    className="text-[11px] mt-1 italic"
                    style={{ color: "hsl(var(--muted-foreground) / 0.7)" }}
                  >
                    {row.commentaire}
                  </p>
                )}
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  title="Dupliquer"
                  onClick={() => duplicate(row)}
                >
                  <Copy size={13} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => { setEditing(row.id); setForm(row); setAdding(false); }}
                >
                  <Pencil size={13} />
                </Button>
                {row.statut === "ACTIF" && isTemporaire(row.code_type_mouvement) && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    title="Clôturer"
                    onClick={() => cloturer(row.id)}
                  >
                    <X size={13} />
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive"
                  onClick={() => remove(row.id)}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Dialog de conflit de date (continuer / annuler) ──────────────── */}
      <Dialog
        open={!!conflictMvt}
        onOpenChange={(open) => { if (!open) setConflictMvt(null); }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-amber-500" />
              Conflit de date d'effet
            </DialogTitle>
          </DialogHeader>
          {conflictMvt && (
            <div className="space-y-3 text-sm">
              <p>
                Un mouvement <strong>actif</strong> existe déjà à la date du{" "}
                <strong>{new Date(conflictMvt.date_effet).toLocaleDateString("fr-FR")}</strong> :
              </p>
              <div
                className="rounded-lg border p-3 bg-amber-50/50"
                style={{ borderColor: "hsl(45 80% 60%)" }}
              >
                <p className="text-xs font-semibold">
                  {typeMap[conflictMvt.code_type_mouvement]?.libelle ||
                    conflictMvt.code_type_mouvement}
                </p>
                {conflictMvt.reference_decision && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Réf. : {conflictMvt.reference_decision}
                  </p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Si vous continuez, ce mouvement sera marqué <strong>ANNULÉ</strong> et remplacé
                par le nouveau.
              </p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConflictMvt(null)}
              disabled={saving}
            >
              Annuler
            </Button>
            <Button
              size="sm"
              onClick={handleConflictContinue}
              disabled={saving}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              Continuer & remplacer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MouvementForm;
