import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Award, Plus, Pencil, Trash2, Save, X, Check } from "lucide-react";
import RefSelect from "@/components/RefSelect";
import { toast } from "sonner";

interface Competence {
  id: string;
  collaborateur_id: string;
  code_competence: string;
  code_niveau: string;
  date_evaluation: string | null;
  source_evaluation: string | null;
  archive: boolean;
}

const EMPTY: Omit<Competence, "id" | "collaborateur_id" | "archive"> = {
  code_competence: "",
  code_niveau: "",
  date_evaluation: "",
  source_evaluation: "",
};

const SOURCES = ["Manager", "Auto-évaluation", "Projet", "Formation", "Certification"];

interface Props { collaborateurId: string }

const CompetenceForm: React.FC<Props> = ({ collaborateurId }) => {
  const [rows, setRows] = useState<Competence[]>([]);
  const [draft, setDraft] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /* labels cache */
  const [compLabels, setCompLabels] = useState<Record<string, string>>({});
  const [nivLabels, setNivLabels] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("collaborateur_competences")
      .select("*")
      .eq("collaborateur_id", collaborateurId)
      .eq("archive", false)
      .order("date_evaluation", { ascending: false });
    setRows((data as Competence[] | null) ?? []);
    setLoading(false);
  }, [collaborateurId]);

  const loadLabels = useCallback(async () => {
    const [c, n] = await Promise.all([
      supabase.from("ref_competence").select("code,libelle").eq("actif", true),
      supabase.from("ref_niveau_competence").select("code,libelle").eq("actif", true),
    ]);
    const cm: Record<string, string> = {};
    (c.data ?? []).forEach((r: any) => { cm[r.code] = r.libelle; });
    setCompLabels(cm);
    const nm: Record<string, string> = {};
    (n.data ?? []).forEach((r: any) => { nm[r.code] = r.libelle; });
    setNivLabels(nm);
  }, []);

  useEffect(() => { load(); loadLabels(); }, [load, loadLabels]);

  const save = async () => {
    if (!draft.code_competence || !draft.code_niveau) {
      toast.error("Compétence et niveau requis");
      return;
    }
    const payload: any = {
      collaborateur_id: collaborateurId,
      code_competence: draft.code_competence,
      code_niveau: draft.code_niveau,
      date_evaluation: draft.date_evaluation || null,
      source_evaluation: draft.source_evaluation || null,
    };
    if (editId) {
      payload.updated_at = new Date().toISOString();
      const { error } = await supabase.from("collaborateur_competences").update(payload).eq("id", editId);
      if (error) { toast.error(error.message); return; }
      toast.success("Compétence modifiée");
    } else {
      const { error } = await supabase.from("collaborateur_competences").insert(payload);
      if (error) { toast.error(error.message); return; }
      toast.success("Compétence ajoutée");
    }
    setDraft(EMPTY); setAdding(false); setEditId(null); load();
  };

  const remove = async (id: string) => {
    await supabase.from("collaborateur_competences").update({ archive: true, updated_at: new Date().toISOString() }).eq("id", id);
    toast.success("Compétence archivée"); load();
  };

  const startEdit = (r: Competence) => {
    setEditId(r.id);
    setDraft({
      code_competence: r.code_competence,
      code_niveau: r.code_niveau,
      date_evaluation: r.date_evaluation ?? "",
      source_evaluation: r.source_evaluation ?? "",
    });
    setAdding(true);
  };

  const cancel = () => { setDraft(EMPTY); setAdding(false); setEditId(null); };

  /* Couleur badge niveau */
  const niveauColor = (code: string) => {
    switch (code) {
      case "N1": return "hsl(var(--muted))";
      case "N2": return "hsl(210 80% 55%)";
      case "N3": return "hsl(145 60% 42%)";
      case "N4": return "hsl(35 95% 55%)";
      default: return "hsl(var(--muted))";
    }
  };

  return (
    <div className="rounded-xl border p-5 mb-4" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Award size={16} style={{ color: "hsl(var(--accent))" }} />
          <h3 className="font-semibold text-sm" style={{ color: "hsl(var(--foreground))" }}>Compétences</h3>
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)} className="flex items-center gap-1 text-xs px-2 py-1 rounded" style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
            <Plus size={13} /> Ajouter
          </button>
        )}
      </div>

      {adding && (
        <div className="rounded-lg border p-4 mb-4 space-y-3" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <RefSelect label="Compétence *" table="ref_competence" value={draft.code_competence} onChange={v => setDraft(d => ({ ...d, code_competence: v }))} />
            <RefSelect label="Niveau *" table="ref_niveau_competence" value={draft.code_niveau} onChange={v => setDraft(d => ({ ...d, code_niveau: v }))} />
            <div>
              <label className="text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Date évaluation</label>
              <input type="date" value={draft.date_evaluation ?? ""} onChange={e => setDraft(d => ({ ...d, date_evaluation: e.target.value }))} className="w-full mt-1 rounded border px-2 py-1.5 text-sm" style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }} />
            </div>
            <div>
              <label className="text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Source évaluation</label>
              <select value={draft.source_evaluation ?? ""} onChange={e => setDraft(d => ({ ...d, source_evaluation: e.target.value }))} className="w-full mt-1 rounded border px-2 py-1.5 text-sm" style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
                <option value="">— Sélectionner —</option>
                {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={cancel} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded border" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}><X size={13} /> Annuler</button>
            <button onClick={save} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded" style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}><Check size={13} /> {editId ? "Modifier" : "Enregistrer"}</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-center py-6" style={{ color: "hsl(var(--muted-foreground))" }}>Chargement…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-center py-6" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune compétence enregistrée</p>
      ) : (
        <div className="space-y-2">
          {rows.map(r => (
            <div key={r.id} className="flex items-center justify-between rounded-lg border px-4 py-3" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))" }}>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>{compLabels[r.code_competence] || r.code_competence}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold text-white" style={{ background: niveauColor(r.code_niveau) }}>
                    {nivLabels[r.code_niveau] || r.code_niveau}
                  </span>
                </div>
                <div className="flex gap-4 mt-1 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                  {r.date_evaluation && <span>Évalué le {r.date_evaluation}</span>}
                  {r.source_evaluation && <span>Source : {r.source_evaluation}</span>}
                </div>
              </div>
              <div className="flex gap-1">
                <button onClick={() => startEdit(r)} className="p-1 rounded hover:bg-accent/20"><Pencil size={13} style={{ color: "hsl(var(--muted-foreground))" }} /></button>
                <button onClick={() => remove(r.id)} className="p-1 rounded hover:bg-destructive/20"><Trash2 size={13} style={{ color: "hsl(var(--destructive))" }} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CompetenceForm;
