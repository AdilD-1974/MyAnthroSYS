import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Pencil, Trash2, Save, Users, Award, X } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import RefSelect from "@/components/RefSelect";
import { toast } from "@/hooks/use-toast";

const fmt = (d?: string | null) => d ? new Date(d).toLocaleDateString("fr-FR") : "—";

/* ── Field Input ── */
const FI: React.FC<{
  label: string; value: string; onChange: (v: string) => void;
  type?: string; required?: boolean; className?: string;
}> = ({ label, value, onChange, type = "text", required, className }) => (
  <div className={className}>
    <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
      {label}{required && <span className="text-destructive ml-0.5">*</span>}
    </label>
    <input
      type={type} value={value ?? ""} onChange={e => onChange(e.target.value)} required={required}
      className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
      style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
    />
  </div>
);

const Field: React.FC<{ label: string; value?: string | null }> = ({ label, value }) => (
  <div>
    <p className="text-xs font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</p>
    <p className="text-sm font-medium" style={{ color: value ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground) / 0.5)" }}>
      {value || "—"}
    </p>
  </div>
);

/* ═══════════════════════════════════════
   SYNDIQUÉ
═══════════════════════════════════════ */
interface SyndiqueFormData {
  code_syndicat: string;
  code_college: string;
  numero_affiliation: string;
  debut_syndicat: string;
  fin_syndicat: string;
}

const EMPTY_SYNDIQUE: SyndiqueFormData = {
  code_syndicat: "", code_college: "", numero_affiliation: "",
  debut_syndicat: "", fin_syndicat: "",
};

/* ═══════════════════════════════════════
   MANDATAIRE
═══════════════════════════════════════ */
interface MandatFormData {
  code_mandat: string;
  code_grade: string;
  debut_mandat: string;
  fin_mandat: string;
}

const EMPTY_MANDAT: MandatFormData = {
  code_mandat: "", code_grade: "", debut_mandat: "", fin_mandat: "",
};

/* ═══════════════════════════════════════
   COMPOSANT PRINCIPAL
═══════════════════════════════════════ */
interface Props { collaborateurId: string; }

const SyndicalMandatForm: React.FC<Props> = ({ collaborateurId }) => {
  /* ── state syndiqués ── */
  const [syndiques, setSyndiques] = useState<any[]>([]);
  const [synOpen, setSynOpen] = useState(false);
  const [synEdit, setSynEdit] = useState<string | null>(null);
  const [synForm, setSynForm] = useState<SyndiqueFormData>(EMPTY_SYNDIQUE);
  const [synSaving, setSynSaving] = useState(false);

  /* ── state mandataires ── */
  const [mandataires, setMandataires] = useState<any[]>([]);
  const [manOpen, setManOpen] = useState(false);
  const [manEdit, setManEdit] = useState<string | null>(null);
  const [manForm, setManForm] = useState<MandatFormData>(EMPTY_MANDAT);
  const [manSaving, setManSaving] = useState(false);

  /* ── labels ── */
  const [syndicatLabels, setSyndicatLabels] = useState<Record<string, string>>({});
  const [collegeLabels, setCollegeLabels] = useState<Record<string, string>>({});
  const [mandatLabels, setMandatLabels] = useState<Record<string, string>>({});
  const [gradeLabels, setGradeLabels] = useState<Record<string, string>>({});

  /* ── load data ── */
  const loadData = useCallback(async () => {
    const [s, m] = await Promise.all([
      supabase.from("collaborateur_syndiques").select("*").eq("collaborateur_id", collaborateurId).eq("archive", false).order("debut_syndicat", { ascending: false }),
      supabase.from("collaborateur_mandataires").select("*").eq("collaborateur_id", collaborateurId).eq("archive", false).order("debut_mandat", { ascending: false }),
    ]);
    if (s.data) setSyndiques(s.data);
    if (m.data) setMandataires(m.data);
  }, [collaborateurId]);

  /* ── load labels ── */
  useEffect(() => {
    loadData();
    // Load ref labels
    supabase.from("ref_syndicat").select("code,libelle").eq("actif", true).then(({ data }) => {
      if (data) setSyndicatLabels(Object.fromEntries(data.map(r => [r.code, r.libelle])));
    });
    supabase.from("ref_college").select("code,libelle").then(({ data }) => {
      if (data) setCollegeLabels(Object.fromEntries(data.map(r => [r.code, r.libelle])));
    });
    supabase.from("ref_mandat_type").select("code,libelle").eq("actif", true).then(({ data }) => {
      if (data) setMandatLabels(Object.fromEntries(data.map(r => [r.code, r.libelle])));
    });
    supabase.from("ref_grade_mandat").select("code,libelle").then(({ data }) => {
      if (data) setGradeLabels(Object.fromEntries(data.map(r => [r.code, r.libelle])));
    });
  }, [loadData]);

  /* ═══ SYNDIQUÉ CRUD ═══ */
  const openNewSyn = () => { setSynForm(EMPTY_SYNDIQUE); setSynEdit(null); setSynOpen(true); };
  const openEditSyn = (s: any) => {
    setSynForm({
      code_syndicat: s.code_syndicat || "",
      code_college: s.code_college || "",
      numero_affiliation: s.numero_affiliation || "",
      debut_syndicat: s.debut_syndicat || "",
      fin_syndicat: s.fin_syndicat || "",
    });
    setSynEdit(s.id);
    setSynOpen(true);
  };

  const saveSyn = async () => {
    if (!synForm.code_syndicat || !synForm.code_college) {
      toast({ title: "Champs requis", description: "Syndicat et Collège sont obligatoires.", variant: "destructive" });
      return;
    }
    setSynSaving(true);
    const payload = {
      collaborateur_id: collaborateurId,
      code_syndicat: synForm.code_syndicat,
      code_college: synForm.code_college,
      numero_affiliation: synForm.numero_affiliation || null,
      debut_syndicat: synForm.debut_syndicat || null,
      fin_syndicat: synForm.fin_syndicat || null,
    };
    let err;
    if (synEdit) {
      ({ error: err } = await supabase.from("collaborateur_syndiques").update(payload).eq("id", synEdit));
    } else {
      ({ error: err } = await supabase.from("collaborateur_syndiques").insert(payload));
    }
    setSynSaving(false);
    if (err) { toast({ title: "Erreur", description: err.message, variant: "destructive" }); return; }
    toast({ title: synEdit ? "Affiliation modifiée" : "Affiliation ajoutée" });
    setSynOpen(false);
    loadData();
  };

  const deleteSyn = async (id: string) => {
    if (!confirm("Archiver cette affiliation syndicale ?")) return;
    await supabase.from("collaborateur_syndiques").update({ archive: true }).eq("id", id);
    toast({ title: "Affiliation archivée" });
    loadData();
  };

  /* ═══ MANDATAIRE CRUD ═══ */
  const openNewMan = () => { setManForm(EMPTY_MANDAT); setManEdit(null); setManOpen(true); };
  const openEditMan = (m: any) => {
    setManForm({
      code_mandat: m.code_mandat || "",
      code_grade: m.code_grade || "",
      debut_mandat: m.debut_mandat || "",
      fin_mandat: m.fin_mandat || "",
    });
    setManEdit(m.id);
    setManOpen(true);
  };

  const saveMan = async () => {
    if (!manForm.code_mandat) {
      toast({ title: "Champ requis", description: "Le type de mandat est obligatoire.", variant: "destructive" });
      return;
    }
    setManSaving(true);
    const payload = {
      collaborateur_id: collaborateurId,
      code_mandat: manForm.code_mandat,
      code_grade: manForm.code_grade || null,
      debut_mandat: manForm.debut_mandat || null,
      fin_mandat: manForm.fin_mandat || null,
    };
    let err;
    if (manEdit) {
      ({ error: err } = await supabase.from("collaborateur_mandataires").update(payload).eq("id", manEdit));
    } else {
      ({ error: err } = await supabase.from("collaborateur_mandataires").insert(payload));
    }
    setManSaving(false);
    if (err) { toast({ title: "Erreur", description: err.message, variant: "destructive" }); return; }
    toast({ title: manEdit ? "Mandat modifié" : "Mandat ajouté" });
    setManOpen(false);
    loadData();
  };

  const deleteMan = async (id: string) => {
    if (!confirm("Archiver ce mandat ?")) return;
    await supabase.from("collaborateur_mandataires").update({ archive: true }).eq("id", id);
    toast({ title: "Mandat archivé" });
    loadData();
  };

  /* ═══ RENDER ═══ */
  const SectionCard: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode; onAdd: () => void }> = ({ title, icon, children, onAdd }) => (
    <div className="rounded-xl border p-5 mb-4" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span style={{ color: "hsl(var(--accent))" }}>{icon}</span>
          <h3 className="font-semibold text-sm" style={{ color: "hsl(var(--foreground))" }}>{title}</h3>
        </div>
        <button onClick={onAdd} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "hsl(var(--accent))", color: "white" }}>
          <Plus size={12} />Ajouter
        </button>
      </div>
      {children}
    </div>
  );

  return (
    <div>
      {/* ── Affiliations syndicales ── */}
      <SectionCard title="Affiliations syndicales" icon={<Users size={15} />} onAdd={openNewSyn}>
        {syndiques.length === 0
          ? <p className="text-sm text-center py-4" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune affiliation syndicale</p>
          : syndiques.map(s => (
            <div key={s.id} className="p-3 rounded-lg border mb-2 group" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
              <div className="flex items-start justify-between">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 flex-1">
                  <Field label="Syndicat" value={syndicatLabels[s.code_syndicat] || s.code_syndicat} />
                  <Field label="Collège" value={collegeLabels[s.code_college] || s.code_college} />
                  <Field label="N° affiliation" value={s.numero_affiliation} />
                  <Field label="Début" value={fmt(s.debut_syndicat)} />
                  <Field label="Fin" value={s.fin_syndicat ? fmt(s.fin_syndicat) : "En cours"} />
                </div>
                <div className="flex gap-1 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openEditSyn(s)} className="p-1.5 rounded-md hover:bg-accent/10"><Pencil size={13} /></button>
                  <button onClick={() => deleteSyn(s.id)} className="p-1.5 rounded-md hover:bg-destructive/10 text-destructive"><Trash2 size={13} /></button>
                </div>
              </div>
            </div>
          ))
        }
      </SectionCard>

      {/* ── Mandats ── */}
      <SectionCard title="Mandats" icon={<Award size={15} />} onAdd={openNewMan}>
        {mandataires.length === 0
          ? <p className="text-sm text-center py-4" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun mandat enregistré</p>
          : mandataires.map(m => (
            <div key={m.id} className="p-3 rounded-lg border mb-2 group" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
              <div className="flex items-start justify-between">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-1">
                  <Field label="Type de mandat" value={mandatLabels[m.code_mandat] || m.code_mandat} />
                  <Field label="Grade" value={gradeLabels[m.code_grade] || m.code_grade} />
                  <Field label="Début" value={fmt(m.debut_mandat)} />
                  <Field label="Fin" value={m.fin_mandat ? fmt(m.fin_mandat) : "En cours"} />
                </div>
                <div className="flex gap-1 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openEditMan(m)} className="p-1.5 rounded-md hover:bg-accent/10"><Pencil size={13} /></button>
                  <button onClick={() => deleteMan(m.id)} className="p-1.5 rounded-md hover:bg-destructive/10 text-destructive"><Trash2 size={13} /></button>
                </div>
              </div>
            </div>
          ))
        }
      </SectionCard>

      {/* ── Dialog Syndiqué ── */}
      <Dialog open={synOpen} onOpenChange={setSynOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{synEdit ? "Modifier l'affiliation" : "Nouvelle affiliation syndicale"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <RefSelect label="Syndicat" table="ref_syndicat" value={synForm.code_syndicat} onChange={v => setSynForm(p => ({ ...p, code_syndicat: v }))} required />
            <RefSelect label="Collège" table="ref_college" value={synForm.code_college} onChange={v => setSynForm(p => ({ ...p, code_college: v }))} required />
            <FI label="N° affiliation" value={synForm.numero_affiliation} onChange={v => setSynForm(p => ({ ...p, numero_affiliation: v }))} />
            <div className="grid grid-cols-2 gap-3">
              <FI label="Date début" type="date" value={synForm.debut_syndicat} onChange={v => setSynForm(p => ({ ...p, debut_syndicat: v }))} />
              <FI label="Date fin" type="date" value={synForm.fin_syndicat} onChange={v => setSynForm(p => ({ ...p, fin_syndicat: v }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSynOpen(false)}>Annuler</Button>
            <Button onClick={saveSyn} disabled={synSaving}>
              <Save size={14} className="mr-1" />{synSaving ? "..." : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog Mandataire ── */}
      <Dialog open={manOpen} onOpenChange={setManOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{manEdit ? "Modifier le mandat" : "Nouveau mandat"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <RefSelect label="Type de mandat" table="ref_mandat_type" value={manForm.code_mandat} onChange={v => setManForm(p => ({ ...p, code_mandat: v }))} required />
            <RefSelect label="Grade" table="ref_grade_mandat" value={manForm.code_grade} onChange={v => setManForm(p => ({ ...p, code_grade: v }))} />
            <div className="grid grid-cols-2 gap-3">
              <FI label="Date début" type="date" value={manForm.debut_mandat} onChange={v => setManForm(p => ({ ...p, debut_mandat: v }))} />
              <FI label="Date fin" type="date" value={manForm.fin_mandat} onChange={v => setManForm(p => ({ ...p, fin_mandat: v }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManOpen(false)}>Annuler</Button>
            <Button onClick={saveMan} disabled={manSaving}>
              <Save size={14} className="mr-1" />{manSaving ? "..." : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SyndicalMandatForm;
