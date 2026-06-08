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
