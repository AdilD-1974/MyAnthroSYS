import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Pencil, Trash2, Heart, Save } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import RefSelect from "@/components/RefSelect";
import { Button } from "@/components/ui/button";

/* ── helpers ── */
const fmt = (d?: string | null) => d ? new Date(d).toLocaleDateString("fr-FR") : "—";

interface Conjoint {
  id: string;
  nom: string;
  prenom: string;
  code_genre: string;
  code_nationalite?: string | null;
  code_statut: string;
  cin?: string | null;
  cin_date_debut?: string | null;
  cin_date_fin?: string | null;
  passeport?: string | null;
  passeport_date_debut?: string | null;
  passeport_date_fin?: string | null;
  date_naissance?: string | null;
  lieu_naissance?: string | null;
  date_mariage?: string | null;
  lieu_mariage?: string | null;
  est_salarie: boolean;
  matricule_conjoint?: string | null;
  date_fin_relation?: string | null;
  date_deces?: string | null;
  reference_decision?: string | null;
  observations?: string | null;
}

const EMPTY: Omit<Conjoint, "id"> = {
  nom: "", prenom: "", code_genre: "F", code_nationalite: "", code_statut: "MARIE",
  cin: "", cin_date_debut: "", cin_date_fin: "",
  passeport: "", passeport_date_debut: "", passeport_date_fin: "",
  date_naissance: "", lieu_naissance: "", date_mariage: "", lieu_mariage: "",
  est_salarie: false, matricule_conjoint: "",
  date_fin_relation: "", date_deces: "", reference_decision: "", observations: "",
};

const STATUT_CONJOINT = [
  { value: "MARIE", label: "Marié(e)" },
  { value: "DIVORCE", label: "Divorcé(e)" },
  { value: "VEUF", label: "Veuf/Veuve" },
  { value: "SEPARE", label: "Séparé(e)" },
];

/* ── Input helpers ── */
const FI: React.FC<{ label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean; className?: string }> =
  ({ label, value, onChange, type = "text", required, className }) => (
    <div className={className}>
      <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
        {label}{required && <span style={{ color: "hsl(0 84% 55%)" }}> *</span>}
      </label>
      <input type={type} value={value || ""} onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
        style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))", height: 38 }} />
    </div>
  );

const FB: React.FC<{ label: string; value: boolean; onChange: (v: boolean) => void }> = ({ label, value, onChange }) => (
  <div className="flex items-center gap-3">
    <button type="button" onClick={() => onChange(!value)}
      className="w-10 h-5 rounded-full transition-colors relative flex-shrink-0"
      style={{ background: value ? "hsl(var(--accent))" : "hsl(var(--border))" }}>
      <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all shadow-sm"
        style={{ left: value ? "calc(100% - 18px)" : "2px" }} />
    </button>
    <span className="text-sm" style={{ color: "hsl(var(--foreground))" }}>{label}</span>
  </div>
);

const FieldView: React.FC<{ label: string; value?: string | null }> = ({ label, value }) => (
  <div>
    <p className="text-xs font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</p>
    <p className="text-sm" style={{ color: value ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground) / 0.4)" }}>{value || "—"}</p>
  </div>
);

interface CollaborateurOption { value: string; label: string }

interface Props { collaborateurId: string }

const ConjointForm: React.FC<Props> = ({ collaborateurId }) => {
  const [conjoints, setConjoints] = useState<Conjoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Conjoint | null>(null);
  const [form, setForm] = useState<Omit<Conjoint, "id">>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [collaborateurOptions, setCollaborateurOptions] = useState<CollaborateurOption[]>([]);
  // Maps de résolution des libellés depuis les référentiels
  const [natMap, setNatMap] = useState<Record<string, string>>({});
  const [genreMap, setGenreMap] = useState<Record<string, string>>({});

  useEffect(() => {
    // Charger les référentiels nationalité et genre pour l'affichage en lecture
    Promise.all([
      supabase.from("ref_nationalite" as never).select("code, libelle").eq("actif" as never, true as never),
      supabase.from("ref_genre" as never).select("code, libelle").eq("actif" as never, true as never),
    ]).then(([nat, genre]) => {
      const nm: Record<string, string> = {};
      ((nat.data as any[]) || []).forEach((r: any) => { nm[r.code] = r.libelle; });
      setNatMap(nm);
      const gm: Record<string, string> = {};
      ((genre.data as any[]) || []).forEach((r: any) => { gm[r.code] = r.libelle; });
      setGenreMap(gm);
    });
  }, []);

  useEffect(() => { load(); }, [collaborateurId]);

  // Charger la liste des collaborateurs pour le matricule
  useEffect(() => {
    const fetchCollaborateurs = async () => {
      const { data } = await supabase
        .from("collaborateurs")
        .select("matricule, nom, prenom")
        .eq("archive", false)
        .order("nom");
      if (data) {
        setCollaborateurOptions(data.map(c => ({
          value: c.matricule,
          label: `${c.matricule} — ${c.nom} ${c.prenom}`,
        })));
      }
    };
    fetchCollaborateurs();
  }, []);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("collaborateur_conjoints")
      .select("*")
      .eq("collaborateur_id", collaborateurId)
      .eq("archive", false)
      .order("date_mariage", { ascending: false });
    if (data) setConjoints(data as Conjoint[]);
    setLoading(false);
  };

  const openNew = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (c: Conjoint) => { setEditing(c); setForm({ ...c }); setOpen(true); };

  const set = (k: keyof typeof EMPTY, v: any) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.nom.trim() || !form.prenom.trim()) return;
    setSaving(true);
    const payload = {
      collaborateur_id: collaborateurId,
      nom: form.nom.trim(), prenom: form.prenom.trim(),
      code_genre: form.code_genre || "F",
      code_nationalite: form.code_nationalite || null,
      code_statut: form.code_statut || "MARIE",
      cin: form.cin || null, cin_date_debut: form.cin_date_debut || null, cin_date_fin: form.cin_date_fin || null,
      passeport: form.passeport || null, passeport_date_debut: form.passeport_date_debut || null, passeport_date_fin: form.passeport_date_fin || null,
      date_naissance: form.date_naissance || null, lieu_naissance: form.lieu_naissance || null,
      date_mariage: form.date_mariage || null, lieu_mariage: form.lieu_mariage || null,
      est_salarie: form.est_salarie,
      matricule_conjoint: form.est_salarie ? (form.matricule_conjoint || null) : null,
      date_fin_relation: form.date_fin_relation || null,
      date_deces: form.date_deces || null,
      reference_decision: form.reference_decision || null,
      observations: form.observations || null,
    };
    if (editing) {
      await supabase.from("collaborateur_conjoints").update(payload).eq("id", editing.id);
    } else {
      await supabase.from("collaborateur_conjoints").insert(payload);
    }
    setSaving(false);
    setOpen(false);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Archiver ce conjoint ?")) return;
    await supabase.from("collaborateur_conjoints").update({ archive: true }).eq("id", id);
    load();
  };

  return (
    <>
      {/* Liste */}
      <div>
        <div className="flex items-center justify-end mb-3">
          <button onClick={openNew}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: "hsl(var(--accent))", color: "white" }}>
            <Plus size={12} />Ajouter
          </button>
        </div>

        {loading
          ? <div className="h-12 flex items-center justify-center"><div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "hsl(var(--accent))", borderTopColor: "transparent" }} /></div>
          : conjoints.length === 0
            ? <p className="text-sm text-center py-6" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun conjoint enregistré</p>
            : <div className="space-y-3">
                {conjoints.map(c => (
                  <div key={c.id} className="rounded-xl border p-4" style={{ background: "hsl(var(--muted) / 0.3)", borderColor: "hsl(var(--border))" }}>
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
                          style={{ background: "hsl(var(--accent) / 0.15)", color: "hsl(var(--accent))" }}>
                          {c.prenom?.[0]?.toUpperCase()}{c.nom?.[0]?.toUpperCase()}
                        </div>
                        <div>
                          <p className="font-semibold text-sm" style={{ color: "hsl(var(--foreground))" }}>{c.prenom} {c.nom}</p>
                          <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{c.code_statut} {c.date_mariage ? `— Marié(e) le ${fmt(c.date_mariage)}` : ""}</p>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(c)} className="p-1.5 rounded hover:bg-accent/10 transition-colors" style={{ color: "hsl(var(--accent))" }}><Pencil size={13} /></button>
                        <button onClick={() => handleDelete(c.id)} className="p-1.5 rounded hover:bg-red-50 transition-colors" style={{ color: "hsl(0 84% 55%)" }}><Trash2 size={13} /></button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <FieldView label="Date naissance" value={fmt(c.date_naissance)} />
                      <FieldView label="Lieu naissance" value={c.lieu_naissance} />
                      <FieldView label="Nationalité" value={natMap[c.code_nationalite || ""] || c.code_nationalite} />
                      <FieldView label="Genre" value={genreMap[c.code_genre] || c.code_genre} />
                      <FieldView label="CIN" value={c.cin} />
                      <FieldView label="Passeport" value={c.passeport} />
                      <FieldView label="Lieu mariage" value={c.lieu_mariage} />
                      <FieldView label="Est salarié" value={c.est_salarie ? "Oui" : "Non"} />
                      {c.est_salarie && <FieldView label="Matricule" value={c.matricule_conjoint} />}
                      {c.date_deces && <FieldView label="Date décès" value={fmt(c.date_deces)} />}
                      {c.date_fin_relation && <FieldView label="Fin relation" value={fmt(c.date_fin_relation)} />}
                      {c.observations && <div className="col-span-full"><FieldView label="Observations" value={c.observations} /></div>}
                    </div>
                  </div>
                ))}
              </div>
        }
      </div>

      {/* Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Modifier le conjoint" : "Ajouter un conjoint"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Est salarié — EN PREMIER avant tout */}
            <div className="rounded-lg p-3 border" style={{ background: "hsl(var(--accent) / 0.05)", borderColor: "hsl(var(--accent) / 0.3)" }}>
              <div className="mb-3">
                <FB label="Est salarié(e)" value={form.est_salarie} onChange={v => set("est_salarie", v)} />
              </div>
              {form.est_salarie && (
                <RefSelect
                  table=""
                  staticOptions={collaborateurOptions}
                  value={form.matricule_conjoint || ""}
                  onChange={v => set("matricule_conjoint", v)}
                  label="Matricule du conjoint (collaborateur)"
                />
              )}
            </div>

            {/* Identité */}
            <div className="rounded-lg p-3 border" style={{ background: "hsl(var(--muted) / 0.3)", borderColor: "hsl(var(--border))" }}>
              <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: "hsl(var(--accent))" }}>Identité</p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <FI label="Nom" value={form.nom} onChange={v => set("nom", v)} required />
                <FI label="Prénom" value={form.prenom} onChange={v => set("prenom", v)} required />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <RefSelect table="ref_genre"
                  value={form.code_genre} onChange={v => set("code_genre", v)} label="Genre" />
                <RefSelect table="ref_nationalite" value={form.code_nationalite || ""} onChange={v => set("code_nationalite", v)} label="Nationalité" />
                <RefSelect table="" staticOptions={STATUT_CONJOINT} value={form.code_statut} onChange={v => set("code_statut", v)} label="Statut marital" />
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <FI label="Date de naissance" value={form.date_naissance || ""} onChange={v => set("date_naissance", v)} type="date" />
                <FI label="Lieu de naissance" value={form.lieu_naissance || ""} onChange={v => set("lieu_naissance", v)} />
              </div>
            </div>

            {/* Mariage */}
            <div className="rounded-lg p-3 border" style={{ background: "hsl(var(--muted) / 0.3)", borderColor: "hsl(var(--border))" }}>
              <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: "hsl(var(--accent))" }}>Mariage</p>
              <div className="grid grid-cols-2 gap-3">
                <FI label="Date de mariage" value={form.date_mariage || ""} onChange={v => set("date_mariage", v)} type="date" />
                <FI label="Lieu de mariage" value={form.lieu_mariage || ""} onChange={v => set("lieu_mariage", v)} />
                <FI label="Date fin relation" value={form.date_fin_relation || ""} onChange={v => set("date_fin_relation", v)} type="date" />
                <FI label="Date décès" value={form.date_deces || ""} onChange={v => set("date_deces", v)} type="date" />
              </div>
            </div>

            {/* Documents */}
            <div className="rounded-lg p-3 border" style={{ background: "hsl(var(--muted) / 0.3)", borderColor: "hsl(var(--border))" }}>
              <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: "hsl(var(--accent))" }}>Documents</p>
              <div className="grid grid-cols-3 gap-3 mb-2">
                <FI label="CIN" value={form.cin || ""} onChange={v => set("cin", v)} />
                <FI label="CIN — Début validité" value={form.cin_date_debut || ""} onChange={v => set("cin_date_debut", v)} type="date" />
                <FI label="CIN — Fin validité" value={form.cin_date_fin || ""} onChange={v => set("cin_date_fin", v)} type="date" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <FI label="Passeport" value={form.passeport || ""} onChange={v => set("passeport", v)} />
                <FI label="Passeport — Début" value={form.passeport_date_debut || ""} onChange={v => set("passeport_date_debut", v)} type="date" />
                <FI label="Passeport — Fin" value={form.passeport_date_fin || ""} onChange={v => set("passeport_date_fin", v)} type="date" />
              </div>
            </div>

            {/* Divers */}
            <div className="grid grid-cols-2 gap-3">
              <FI label="Référence décision" value={form.reference_decision || ""} onChange={v => set("reference_decision", v)} />
              <div className="col-span-2">
                <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Observations</label>
                <textarea value={form.observations || ""} onChange={e => set("observations", e.target.value)} rows={2}
                  className="w-full px-3 py-2 rounded-lg border text-sm outline-none resize-none"
                  style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }} />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            <Button onClick={handleSave} disabled={saving || !form.nom.trim() || !form.prenom.trim()}
              style={{ background: "hsl(var(--accent))", color: "white" }}>
              {saving ? "Enregistrement..." : <><Save size={13} className="mr-1" />Enregistrer</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ConjointForm;
