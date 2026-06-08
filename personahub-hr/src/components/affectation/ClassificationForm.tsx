import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useChainCollaborateurIds } from "@/hooks/useChainCollaborateurIds";
import { Layers, Plus, Pencil, Trash2, Save, X, Check, ChevronDown } from "lucide-react";
import RefSelect from "@/components/RefSelect";
import { toast } from "sonner";

interface Qualification {
  id: string;
  collaborateur_id: string;
  code_motif: string;
  date_evolution: string;
  code_emploi: string;
  code_fonction: string | null;
  code_categorie_professionnelle: string | null;
  code_college: string | null;
  code_responsabilite: string | null;
  code_niveau: string | null;
  code_grade: string | null;
  code_echelle: string | null;
  code_classe: string | null;
  echelon_actuel: string | null;
  code_filiere: string | null;
  code_activite: string | null;
  code_classification: string | null;
  code_decision: string | null;
  decision_reference: string | null;
  decision_date: string | null;
  indice_reference: string | null;
  indice_saisi: string | null;
  points_attribues: number | null;
  commentaires: string | null;
  archive: boolean;
}

const EMPTY = {
  code_motif: "",
  date_evolution: "",
  code_emploi: "",
  code_fonction: "",
  code_categorie_professionnelle: "",
  code_college: "",
  code_responsabilite: "",
  code_niveau: "",
  code_grade: "",
  code_echelle: "",
  code_classe: "",
  echelon_actuel: "",
  code_filiere: "",
  code_activite: "",
  code_classification: "",
  code_decision: "",
  decision_reference: "",
  decision_date: "",
  indice_reference: "",
  indice_saisi: "",
  points_attribues: null as number | null,
  commentaires: "",
};

interface Props { collaborateurId: string; ancienMatricule?: string }

const ClassificationForm: React.FC<Props> = ({ collaborateurId, ancienMatricule }) => {
  const [rows, setRows] = useState<Qualification[]>([]);
  // RG-CLASS-ACCORDION-01 (Adil DAIA — 07/05/2026) : accordéon des cartes
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setExpandedIds(prev => prev.size === rows.length ? new Set() : new Set(rows.map(r => r.id)));
  };
  const [form, setForm] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Labels cache
  const [labels, setLabels] = useState<Record<string, Record<string, string>>>({});

  const REF_TABLES = [
    "ref_motif_classification", "ref_fonction", "ref_categorie_professionnelle",
    "ref_college", "ref_responsabilite", "ref_niveau_qualification", "ref_grade",
    "ref_echelle", "ref_classe", "ref_echelon", "ref_filiere", "ref_activite",
  ];

  // Chaîne d'anciens matricules (N niveaux)
  const { chainIds, chainCollabs } = useChainCollaborateurIds(collaborateurId, ancienMatricule);

  const load = useCallback(async () => {
    if (chainIds.length === 0) return;
    setLoading(true);
    // Le proxy generic ne supporte pas .or(...) PostgREST.
    // On fetch séparément chaque collab de la chaîne et on agrège côté JS.
    const currentId = chainIds[0];
    const ancestorIds = chainIds.filter(id => id !== currentId);

    const [curRes, ...ancestorRes] = await Promise.all([
      supabase.from("collaborateur_qualifications").select("*")
        .eq("collaborateur_id", currentId).eq("archive", false)
        .order("date_evolution", { ascending: false }).order("created_at" as any, { ascending: false }),
      ...ancestorIds.map(id =>
        supabase.from("collaborateur_qualifications").select("*")
          .eq("collaborateur_id", id).eq("archive", false)
      ),
    ]);

    const matriculeById = new Map(chainCollabs.map(c => [c.id, c.matricule]));
    const list: Qualification[] = [];
    ((curRes.data as any[]) ?? []).forEach(q => list.push({ ...q, _from_ancien: undefined } as Qualification));
    ancestorRes.forEach(r => {
      ((r.data as any[]) ?? []).forEach(q => {
        list.push({ ...q, _from_ancien: matriculeById.get(q.collaborateur_id) } as Qualification);
      });
    });

    // Tri global (les plus récents en haut)
    list.sort((a: any, b: any) =>
      (b.date_evolution || "").localeCompare(a.date_evolution || "")
      || (b.created_at || "").localeCompare(a.created_at || "")
    );

    setRows(list);
    if (list.length > 0) setExpandedIds(new Set([list[0].id]));
    setLoading(false);
  }, [chainIds.join(",")]);

  const loadLabels = useCallback(async () => {
    const results = await Promise.all(
      REF_TABLES.map(t => supabase.from(t as any).select("code, libelle").eq("actif", true))
    );
    const map: Record<string, Record<string, string>> = {};
    REF_TABLES.forEach((t, i) => {
      const m: Record<string, string> = {};
      ((results[i].data as any[]) ?? []).forEach((r: any) => { m[r.code] = r.libelle; });
      map[t] = m;
    });
    setLabels(map);
  }, []);

  useEffect(() => { load(); loadLabels(); }, [load, loadLabels]);

  const getLabel = (table: string, code: string | null) =>
    code ? (labels[table]?.[code] || code) : "—";

  const set = (key: string, val: any) => setForm(f => ({ ...f, [key]: val }));

  const save = async () => {
    if (!form.code_motif || !form.date_evolution) {
      toast.error("Motif et date de classification sont obligatoires");
      return;
    }
    const payload: any = {
      collaborateur_id: collaborateurId,
      code_motif: form.code_motif,
      date_evolution: form.date_evolution,
      code_emploi: form.code_emploi,
      code_fonction: form.code_fonction || null,
      code_categorie_professionnelle: form.code_categorie_professionnelle || null,
      code_college: form.code_college || null,
      code_responsabilite: form.code_responsabilite || null,
      code_niveau: form.code_niveau || null,
      code_grade: form.code_grade || null,
      code_echelle: form.code_echelle || null,
      code_classe: form.code_classe || null,
      echelon_actuel: form.echelon_actuel || null,
      code_filiere: form.code_filiere || null,
      code_activite: form.code_activite || null,
      code_classification: form.code_classification || null,
      code_decision: form.code_decision || null,
      decision_reference: form.decision_reference || null,
      decision_date: form.decision_date || null,
      indice_reference: form.indice_reference || null,
      indice_saisi: form.indice_saisi || null,
      points_attribues: form.points_attribues,
      commentaires: form.commentaires || null,
    };

    if (editId) {
      const { error } = await supabase.from("collaborateur_qualifications").update(payload as any).eq("id", editId);
      if (error) { toast.error(error.message); return; }
      toast.success("Classification mise à jour");
    } else {
      // Clôturer l'occurrence précédente (date_fin = date_classification - 1 jour)
      if (rows.length > 0) {
        const lastRow = rows[0]; // rows triées par date desc
        const newDate = new Date(form.date_evolution);
        newDate.setDate(newDate.getDate() - 1);
        const dateFin = newDate.toISOString().split("T")[0];
        await supabase.from("collaborateur_qualifications")
          .update({ decision_date: dateFin } as any)
          .eq("id", lastRow.id);
      }
      const { error } = await supabase.from("collaborateur_qualifications").insert(payload as any);
      if (error) { toast.error(error.message); return; }
      toast.success("Classification ajoutée");
    }
    setForm(EMPTY); setAdding(false); setEditId(null); load();
  };

  const remove = async (id: string) => {
    if (!confirm("Archiver cette classification ?")) return;
    // Archiver l'occurrence
    await supabase.from("collaborateur_qualifications").update({ archive: true } as any).eq("id", id);
    // Réactiver la dernière occurrence non archivée (enlever sa date de fin)
    const { data: remaining } = await supabase
      .from("collaborateur_qualifications")
      .select("id")
      .eq("collaborateur_id", collaborateurId)
      .eq("archive", false)
      .order("date_evolution", { ascending: false })
      .limit(1);
    if (remaining && remaining.length > 0) {
      await supabase.from("collaborateur_qualifications")
        .update({ decision_date: null } as any)
        .eq("id", remaining[0].id);
    }
    toast.success("Classification archivée"); load();
  };

  const startEdit = (r: Qualification) => {
    setEditId(r.id);
    setAdding(true);
    setForm({
      code_motif: r.code_motif,
      date_evolution: r.date_evolution,
      code_emploi: r.code_emploi,
      code_fonction: r.code_fonction || "",
      code_categorie_professionnelle: r.code_categorie_professionnelle || "",
      code_college: r.code_college || "",
      code_responsabilite: r.code_responsabilite || "",
      code_niveau: r.code_niveau || "",
      code_grade: r.code_grade || "",
      code_echelle: r.code_echelle || "",
      code_classe: r.code_classe || "",
      echelon_actuel: r.echelon_actuel || "",
      code_filiere: r.code_filiere || "",
      code_activite: r.code_activite || "",
      code_classification: r.code_classification || "",
      code_decision: r.code_decision || "",
      decision_reference: r.decision_reference || "",
      decision_date: r.decision_date || "",
      indice_reference: r.indice_reference || "",
      indice_saisi: r.indice_saisi || "",
      points_attribues: r.points_attribues,
      commentaires: r.commentaires || "",
    });
  };

  const cancel = () => { setForm(EMPTY); setAdding(false); setEditId(null); };

  const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString("fr-FR") : "—";

  const inputStyle = { borderColor: "hsl(var(--border))", background: "hsl(var(--background))", height: 38 };

  return (
    <div className="rounded-xl border p-5 mb-4" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Layers size={15} style={{ color: "hsl(var(--accent))" }} />
          <h3 className="font-semibold text-sm" style={{ color: "hsl(var(--foreground))" }}>Classification</h3>
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-semibold"
            style={{ background: "hsl(var(--accent))", color: "white" }}>
            <Plus size={12} /> Ajouter
          </button>
        )}
      </div>

      {adding && (
        <div className="rounded-lg border p-4 mb-4 space-y-4" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.2)" }}>
          {/* Ligne 1 : Motif + Date + Emploi */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <RefSelect label="Motif de classification *" table="ref_motif_classification" value={form.code_motif} onChange={v => set("code_motif", v)} required />
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Date de classification *</label>
              <input type="date" value={form.date_evolution} onChange={e => set("date_evolution", e.target.value)}
                className="w-full px-3 py-2 rounded-lg border text-sm" style={inputStyle} />
            </div>
          </div>

          {/* Bloc Classification */}
          <div className="rounded-lg p-3 border" style={{ background: "hsl(var(--muted) / 0.3)", borderColor: "hsl(var(--border))" }}>
            <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: "hsl(var(--accent))" }}>Classification</p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              <RefSelect label="Fonction" table="ref_fonction" value={form.code_fonction} onChange={v => set("code_fonction", v)} />
              <RefSelect label="Catégorie Professionnelle" table="ref_categorie_professionnelle" value={form.code_categorie_professionnelle} onChange={v => set("code_categorie_professionnelle", v)} />
              <RefSelect label="Collège" table="ref_college" value={form.code_college} onChange={v => set("code_college", v)} />
              <RefSelect label="Responsabilité" table="ref_responsabilite" value={form.code_responsabilite} onChange={v => set("code_responsabilite", v)} />
              <RefSelect label="Niveau" table="ref_niveau_qualification" value={form.code_niveau} onChange={v => set("code_niveau", v)} />
              <RefSelect label="Grade" table="ref_grade" value={form.code_grade} onChange={v => set("code_grade", v)} />
              <RefSelect label="Échelle" table="ref_echelle" value={form.code_echelle} onChange={v => set("code_echelle", v)} />
              <RefSelect label="Classe" table="ref_classe" value={form.code_classe} onChange={v => set("code_classe", v)} />
              <RefSelect label="Échelon" table="ref_echelon" value={form.echelon_actuel} onChange={v => set("echelon_actuel", v)} />
              <RefSelect label="Filière" table="ref_filiere" value={form.code_filiere} onChange={v => set("code_filiere", v)} />
              <RefSelect label="Activité" table="ref_activite" value={form.code_activite} onChange={v => set("code_activite", v)} />
            </div>
          </div>


          {/* Commentaires */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Commentaires</label>
            <textarea value={form.commentaires} onChange={e => set("commentaires", e.target.value)}
              rows={2} className="w-full px-3 py-2 rounded-lg border text-sm resize-none"
              style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))" }} />
          </div>

          <div className="flex gap-2 justify-end">
            <button onClick={cancel} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border font-semibold"
              style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
              <X size={13} /> Annuler
            </button>
            <button onClick={save} className="flex items-center gap-1 text-xs px-4 py-1.5 rounded-lg font-semibold"
              style={{ background: "hsl(var(--accent))", color: "white" }}>
              <Save size={13} /> {editId ? "Mettre à jour" : "Enregistrer"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-center py-6" style={{ color: "hsl(var(--muted-foreground))" }}>Chargement…</p>
      ) : rows.length === 0 && !adding ? (
        <p className="text-xs text-center py-6" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune classification enregistrée</p>
      ) : (
        <div className="mt-3">
          {/* Barre d'actions globales */}
          {rows.length > 1 && (
            <div className="flex items-center justify-between mb-2 text-xs"
              style={{ color: "hsl(var(--muted-foreground))" }}>
              <span>{rows.length} évolution{rows.length > 1 ? "s" : ""} — du plus récent au plus ancien</span>
              <button onClick={toggleAll} className="hover:underline font-medium" style={{ color: "hsl(var(--accent))" }}>
                {expandedIds.size === rows.length ? "Tout replier" : "Tout déplier"}
              </button>
            </div>
          )}

          <div className="space-y-2">
            {rows.map((r, idx) => {
              const isOpen = expandedIds.has(r.id);
              const estCourante = idx === 0; // 1ère = la plus récente
              const borderColor = estCourante ? "hsl(var(--accent) / 0.4)" : "hsl(var(--border))";
              const bgColor     = estCourante ? "hsl(var(--accent) / 0.04)" : "transparent";
              return (
                <div key={r.id} className="rounded-lg border overflow-hidden transition-all"
                  style={{ borderColor, background: bgColor }}>
                  {/* HEADER (toujours visible) */}
                  <div onClick={() => toggleExpanded(r.id)}
                    className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/30 transition-colors">
                    <div className="flex-shrink-0 transition-transform" style={{
                      transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)",
                      color: "hsl(var(--muted-foreground))",
                    }}>
                      <ChevronDown size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm truncate" style={{ color: "hsl(var(--foreground))" }}>
                          {getLabel("ref_motif_classification", r.code_motif)}
                        </p>
                        {/* Aperçu compact des principaux champs */}
                        {r.code_grade && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded" style={{
                            background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))",
                          }}>
                            Grade : {getLabel("ref_grade", r.code_grade)}
                          </span>
                        )}
                        {r.echelon_actuel && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded" style={{
                            background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))",
                          }}>
                            Éch. {r.echelon_actuel}
                          </span>
                        )}
                      </div>
                      <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                        {fmtDate(r.date_evolution)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                      {estCourante && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide"
                          style={{ background: "hsl(var(--accent) / 0.15)", color: "hsl(var(--accent))" }}>
                          Actuelle
                        </span>
                      )}
                      <button onClick={() => startEdit(r)} className="p-1 rounded hover:bg-muted">
                        <Pencil size={12} style={{ color: "hsl(var(--accent))" }} />
                      </button>
                      <button onClick={() => remove(r.id)} className="p-1 rounded hover:bg-muted">
                        <Trash2 size={12} style={{ color: "hsl(0 84% 55%)" }} />
                      </button>
                    </div>
                  </div>

                  {/* CONTENU DÉPLIABLE */}
                  {isOpen && (
                    <div className="px-3 pb-3 pt-2 border-t" style={{ borderColor: "hsl(var(--border))" }}>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                        {r.code_fonction && (
                          <div>
                            <p className="font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Fonction</p>
                            <p style={{ color: "hsl(var(--foreground))" }}>{getLabel("ref_fonction", r.code_fonction)}</p>
                          </div>
                        )}
                        {r.code_categorie_professionnelle && (
                          <div>
                            <p className="font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Catégorie Pro.</p>
                            <p style={{ color: "hsl(var(--foreground))" }}>{getLabel("ref_categorie_professionnelle", r.code_categorie_professionnelle)}</p>
                          </div>
                        )}
                        {r.code_college && (
                          <div>
                            <p className="font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Collège</p>
                            <p style={{ color: "hsl(var(--foreground))" }}>{getLabel("ref_college", r.code_college)}</p>
                          </div>
                        )}
                        {r.code_grade && (
                          <div>
                            <p className="font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Grade</p>
                            <p style={{ color: "hsl(var(--foreground))" }}>{getLabel("ref_grade", r.code_grade)}</p>
                          </div>
                        )}
                        {r.code_echelle && (
                          <div>
                            <p className="font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Échelle</p>
                            <p style={{ color: "hsl(var(--foreground))" }}>{getLabel("ref_echelle", r.code_echelle)}</p>
                          </div>
                        )}
                        {r.code_classe && (
                          <div>
                            <p className="font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Classe</p>
                            <p style={{ color: "hsl(var(--foreground))" }}>{getLabel("ref_classe", r.code_classe)}</p>
                          </div>
                        )}
                        {r.echelon_actuel && (
                          <div>
                            <p className="font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Échelon</p>
                            <p style={{ color: "hsl(var(--foreground))" }}>{r.echelon_actuel}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default ClassificationForm;
