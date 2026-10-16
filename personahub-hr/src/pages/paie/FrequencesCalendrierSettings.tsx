/**
 * FrequencesCalendrierSettings – Référentiel des fréquences de calcul et RAZ
 * avec association aux périodes du calendrier de paie.
 * RG-FREQ-CAL-01 : L'association périodique se gère au niveau du référentiel – Auteur : Adil DAIA
 * RG-FREQ-CAL-02 : Affichage groupé par plan de paie avec détail des périodes – Auteur : Adil DAIA
 * RG-FREQ-CAL-03 : Les fréquences sont gérées en CRUD depuis ref_frequence_rubrique_paie – Auteur : Adil DAIA
 */
import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Save, Calendar, ChevronDown, ChevronRight, Plus, Pencil, Trash2, X, Check } from "lucide-react";

interface CalendrierPeriode {
  id: string; annee: number; mois: number; numero_periode: number; type_periode: string;
  date_debut: string; date_fin: string; statut: string; plan_paie_id: string;
}

interface PlanPaie {
  id: string; code: string; libelle: string; frequence: string;
}

interface Frequence {
  code: string; libelle: string; description: string | null; actif: boolean;
}

const formatDate = (d: string) => {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${day}-${m}-${y}`;
};

const MOIS_LABELS = [
  "", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"
];

const TYPE_PERIODE_LABELS: Record<string, string> = {
  NORMALE: "Normale",
  RAPPEL: "Rappel",
  REGUL: "Régularisation",
  COMPLEMENTAIRE: "Complémentaire",
  EXCEPTIONNELLE: "Exceptionnelle",
  PRIME: "Prime",
};

const FrequencesCalendrierSettings: React.FC = () => {
  const [periodes, setPeriodes] = useState<CalendrierPeriode[]>([]);
  const [plans, setPlans] = useState<PlanPaie[]>([]);
  const [frequences, setFrequences] = useState<Frequence[]>([]);
  const [associations, setAssociations] = useState<{ code_frequence: string; calendrier_paie_id: string; type_frequence: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedFreq, setSelectedFreq] = useState("");
  const [selectedType, setSelectedType] = useState<"CALCUL" | "RAZ">("CALCUL");
  const [openPlans, setOpenPlans] = useState<Set<string>>(new Set());

  // Gestion CRUD fréquences
  const [showFreqManager, setShowFreqManager] = useState(false);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [freqForm, setFreqForm] = useState<Frequence>({ code: "", libelle: "", description: "", actif: true });
  const [freqSaving, setFreqSaving] = useState(false);

  const togglePlan = (planId: string) => {
    setOpenPlans(prev => {
      const next = new Set(prev);
      if (next.has(planId)) next.delete(planId);
      else next.add(planId);
      return next;
    });
  };

  const expandAll = () => setOpenPlans(new Set(plans.map(p => p.id)));
  const collapseAll = () => setOpenPlans(new Set());

  // RG-FREQ-BUG-01 (correctif, Adil DAIA) : cette fonction interrogeait
  // "collaborateur_divers" avec une variable `collaborateurId` inexistante
  // dans ce composant (ni prop, ni state) — plantait (ReferenceError) à
  // chaque création/modification/suppression de fréquence, puisqu'appelée
  // juste après (saveFreq/deleteFreq). Corrigé pour interroger la vraie
  // table du référentiel des fréquences, comme au chargement initial (fRes).
  const loadFrequences = async () => {
    const { data } = await supabase
      .from("ref_frequence_rubrique_paie" as never)
      .select("code,libelle,description,actif" as never)
      .order("libelle" as never, { ascending: true });
    if (data) {
      setFrequences(data as unknown as Frequence[]);
      const liste = data as unknown as Frequence[];
      if (liste.length > 0 && !selectedFreq) {
        const periodique = liste.find((f) => f.code === "PERIODIQUE");
        setSelectedFreq(periodique?.code || liste[0].code);
      }
    }
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [pRes, plRes, aRes, fRes] = await Promise.all([
        supabase.from("calendrier_paie" as never)
          .select("id,annee,mois,numero_periode,type_periode,date_debut,date_fin,statut,plan_paie_id")
          .order("annee" as never, { ascending: true })
          .order("numero_periode" as never, { ascending: true }),
        supabase.from("plan_paie" as never)
          .select("id,code,libelle,frequence")
          .eq("actif" as never, true as never)
          .order("libelle" as never, { ascending: true }),
        supabase.from("ref_frequence_paie_calendrier" as never).select("code_frequence,calendrier_paie_id,type_frequence"),
        supabase.from("ref_frequence_rubrique_paie" as never)
          .select("code,libelle,description,actif")
          .order("libelle" as never, { ascending: true }),
      ]) as any[];
      if (pRes.data) setPeriodes(pRes.data);
      if (plRes.data) {
        setPlans(plRes.data);
        if (plRes.data.length > 0) setOpenPlans(new Set([plRes.data[0].id]));
      }
      if (aRes.data) setAssociations(aRes.data);
      if (fRes.data) {
        setFrequences(fRes.data);
        if (fRes.data.length > 0) {
          const periodique = fRes.data.find((f: Frequence) => f.code === "PERIODIQUE");
          setSelectedFreq(periodique?.code || fRes.data[0].code);
        }
      }
      setLoading(false);
    };
    load();
  }, []);

  const isChecked = (periodeId: string) =>
    associations.some(a => a.code_frequence === selectedFreq && a.calendrier_paie_id === periodeId && a.type_frequence === selectedType);

  const toggle = (periodeId: string) => {
    if (isChecked(periodeId)) {
      setAssociations(prev => prev.filter(a => !(a.code_frequence === selectedFreq && a.calendrier_paie_id === periodeId && a.type_frequence === selectedType)));
    } else {
      setAssociations(prev => [...prev, { code_frequence: selectedFreq, calendrier_paie_id: periodeId, type_frequence: selectedType }]);
    }
  };

  const selectAll = () => {
    const filtered = periodes.filter(p => !isChecked(p.id));
    if (filtered.length > 0) {
      setAssociations(prev => [...prev, ...filtered.map(p => ({ code_frequence: selectedFreq, calendrier_paie_id: p.id, type_frequence: selectedType }))]);
    }
  };

  const selectAllForPlan = (planId: string) => {
    const planPeriodes = periodes.filter(p => p.plan_paie_id === planId && !isChecked(p.id));
    if (planPeriodes.length > 0) {
      setAssociations(prev => [...prev, ...planPeriodes.map(p => ({ code_frequence: selectedFreq, calendrier_paie_id: p.id, type_frequence: selectedType }))]);
    }
  };

  const deselectAllForPlan = (planId: string) => {
    const planPeriodeIds = new Set(periodes.filter(p => p.plan_paie_id === planId).map(p => p.id));
    setAssociations(prev => prev.filter(a => !(a.code_frequence === selectedFreq && a.type_frequence === selectedType && planPeriodeIds.has(a.calendrier_paie_id))));
  };

  const deselectAll = () => {
    setAssociations(prev => prev.filter(a => !(a.code_frequence === selectedFreq && a.type_frequence === selectedType)));
  };

  const handleSave = async () => {
    if (!selectedFreq) return;
    setSaving(true);
    await supabase.from("ref_frequence_paie_calendrier" as never)
      .delete()
      .eq("code_frequence" as never, selectedFreq as never)
      .eq("type_frequence" as never, selectedType as never);
    const rows = associations
      .filter(a => a.code_frequence === selectedFreq && a.type_frequence === selectedType)
      .map(a => ({ code_frequence: a.code_frequence, calendrier_paie_id: a.calendrier_paie_id, type_frequence: a.type_frequence }));
    if (rows.length > 0) {
      await supabase.from("ref_frequence_paie_calendrier" as never).insert(rows as never);
    }
    setSaving(false);
  };

  // CRUD Fréquences
  const startCreate = () => {
    setEditingCode(null);
    setFreqForm({ code: "", libelle: "", description: "", actif: true });
    setShowFreqManager(true);
  };

  const startEdit = (f: Frequence) => {
    setEditingCode(f.code);
    setFreqForm({ ...f });
    setShowFreqManager(true);
  };

  const cancelFreqEdit = () => {
    setShowFreqManager(false);
    setEditingCode(null);
  };

  const saveFreq = async () => {
    if (!freqForm.code.trim() || !freqForm.libelle.trim()) return;
    setFreqSaving(true);
    if (editingCode) {
      await supabase.from("ref_frequence_rubrique_paie" as never)
        .update({ libelle: freqForm.libelle, description: freqForm.description, actif: freqForm.actif } as never)
        .eq("code" as never, editingCode as never);
    } else {
      await supabase.from("ref_frequence_rubrique_paie" as never).insert({
        code: freqForm.code.toUpperCase().trim(),
        libelle: freqForm.libelle.trim(),
        description: freqForm.description?.trim() || null,
        actif: freqForm.actif,
      } as never);
    }
    await loadFrequences();
    setFreqSaving(false);
    setShowFreqManager(false);
    setEditingCode(null);
  };

  const deleteFreq = async (code: string) => {
    if (!confirm(`Supprimer la fréquence "${code}" ?\nLes associations liées seront également supprimées.`)) return;
    await supabase.from("ref_frequence_paie_calendrier" as never).delete().eq("code_frequence" as never, code as never);
    await supabase.from("ref_frequence_rubrique_paie" as never).delete().eq("code" as never, code as never);
    setAssociations(prev => prev.filter(a => a.code_frequence !== code));
    await loadFrequences();
    if (selectedFreq === code) {
      const remaining = frequences.filter(f => f.code !== code);
      setSelectedFreq(remaining[0]?.code || "");
    }
  };

  const currentCount = associations.filter(a => a.code_frequence === selectedFreq && a.type_frequence === selectedType).length;
  const plansAvecPeriodes = plans.filter(pl => periodes.some(p => p.plan_paie_id === pl.id));
  const frequencesActives = frequences.filter(f => f.actif);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-accent" size={24} />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-xl bg-accent/10">
          <Calendar size={20} className="text-accent" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-foreground">Fréquences & Calendrier</h2>
          <p className="text-xs text-muted-foreground">Créez vos fréquences et associez-les aux périodes du calendrier de paie</p>
        </div>
      </div>

      {/* Gestion des fréquences */}
      <div className="mb-6 rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 bg-accent/5 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-foreground">Référentiel des fréquences</h3>
            <p className="text-xs text-muted-foreground">{frequences.length} fréquence(s) · {frequencesActives.length} active(s)</p>
          </div>
          <button onClick={startCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
            style={{ background: "hsl(var(--accent))", color: "hsl(var(--accent-foreground))" }}>
            <Plus size={14} /> Nouvelle fréquence
          </button>
        </div>

        {showFreqManager && (
          <div className="px-4 py-3 bg-muted/30 border-b border-border">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[120px]">
                <label className="block text-xs font-medium mb-1 text-muted-foreground">Code *</label>
                <input value={freqForm.code} onChange={e => setFreqForm({ ...freqForm, code: e.target.value })}
                  disabled={!!editingCode} placeholder="MENSUELLE"
                  className="w-full px-3 py-2 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all disabled:opacity-60 disabled:cursor-not-allowed font-mono uppercase" />
              </div>
              <div className="flex-1 min-w-[160px]">
                <label className="block text-xs font-medium mb-1 text-muted-foreground">Libellé *</label>
                <input value={freqForm.libelle} onChange={e => setFreqForm({ ...freqForm, libelle: e.target.value })}
                  placeholder="Mensuelle"
                  className="w-full px-3 py-2 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all" />
              </div>
              <div className="flex-[2] min-w-[200px]">
                <label className="block text-xs font-medium mb-1 text-muted-foreground">Description</label>
                <input value={freqForm.description || ""} onChange={e => setFreqForm({ ...freqForm, description: e.target.value })}
                  placeholder="Optionnel"
                  className="w-full px-3 py-2 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all" />
              </div>
              <label className="flex items-center gap-2 px-3 py-2 cursor-pointer">
                <input type="checkbox" checked={freqForm.actif} onChange={e => setFreqForm({ ...freqForm, actif: e.target.checked })}
                  className="rounded border-border text-accent focus:ring-accent/30" />
                <span className="text-xs font-medium text-foreground">Actif</span>
              </label>
              <button onClick={saveFreq} disabled={freqSaving || !freqForm.code.trim() || !freqForm.libelle.trim()}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                style={{ background: "hsl(var(--accent))", color: "hsl(var(--accent-foreground))" }}>
                {freqSaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                {editingCode ? "Modifier" : "Créer"}
              </button>
              <button onClick={cancelFreqEdit}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-border bg-background text-foreground hover:bg-muted transition-colors">
                <X size={12} /> Annuler
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Code</th>
                <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Libellé</th>
                <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Description</th>
                <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wide font-semibold text-muted-foreground w-20">Statut</th>
                <th className="px-4 py-2 text-right text-[10px] uppercase tracking-wide font-semibold text-muted-foreground w-32">Actions</th>
              </tr>
            </thead>
            <tbody>
              {frequences.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Aucune fréquence définie</td></tr>
              ) : frequences.map(f => (
                <tr key={f.code} className="border-b border-border last:border-b-0 hover:bg-muted/30">
                  <td className="px-4 py-2 font-mono font-semibold text-accent">{f.code}</td>
                  <td className="px-4 py-2 text-foreground">{f.libelle}</td>
                  <td className="px-4 py-2 text-muted-foreground">{f.description || "—"}</td>
                  <td className="px-4 py-2">
                    {f.actif
                      ? <span className="px-2 py-0.5 rounded-md text-xs font-medium" style={{ background: "hsl(var(--success) / 0.12)", color: "hsl(var(--success))" }}>Actif</span>
                      : <span className="px-2 py-0.5 rounded-md bg-muted text-muted-foreground text-xs font-medium">Inactif</span>}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => startEdit(f)} title="Modifier"
                        className="p-1.5 rounded-md hover:bg-accent/10 text-accent transition-colors">
                        <Pencil size={12} />
                      </button>
                      <button onClick={() => deleteFreq(f.code)} title="Supprimer"
                        className="p-1.5 rounded-md hover:bg-destructive/10 text-destructive transition-colors">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sélection fréquence + type */}
      <div className="flex flex-wrap items-end gap-4 mb-6">
        <div>
          <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Fréquence</label>
          <select value={selectedFreq} onChange={e => setSelectedFreq(e.target.value)}
            disabled={frequencesActives.length === 0}
            className="px-3 py-2.5 rounded-lg border text-sm outline-none bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all min-w-[180px] disabled:opacity-50">
            {frequencesActives.length === 0
              ? <option value="">Aucune fréquence active</option>
              : frequencesActives.map(f => <option key={f.code} value={f.code}>{f.libelle}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Type de fréquence</label>
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button onClick={() => setSelectedType("CALCUL")}
              className="px-4 py-2.5 text-sm font-medium transition-colors"
              style={selectedType === "CALCUL" ? { background: "hsl(var(--accent))", color: "hsl(var(--accent-foreground))" } : { background: "hsl(var(--background))", color: "hsl(var(--muted-foreground))" }}>
              Calcul
            </button>
            <button onClick={() => setSelectedType("RAZ")}
              className="px-4 py-2.5 text-sm font-medium transition-colors border-l border-border"
              style={selectedType === "RAZ" ? { background: "hsl(var(--warning))", color: "#fff" } : { background: "hsl(var(--background))", color: "hsl(var(--muted-foreground))" }}>
              RAZ Cumuls
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={selectAll} disabled={!selectedFreq}
            className="px-3 py-2.5 rounded-lg text-xs font-medium border border-border bg-background text-foreground hover:bg-muted transition-colors disabled:opacity-50">
            Tout cocher
          </button>
          <button onClick={deselectAll} disabled={!selectedFreq}
            className="px-3 py-2.5 rounded-lg text-xs font-medium border border-border bg-background text-foreground hover:bg-muted transition-colors disabled:opacity-50">
            Tout décocher
          </button>
        </div>
        <button onClick={handleSave} disabled={saving || !selectedFreq}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
          style={{ background: "hsl(var(--accent))", color: "hsl(var(--accent-foreground))" }}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Enregistrer
        </button>
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={expandAll}
            className="px-3 py-2.5 rounded-lg text-xs font-medium border border-border bg-background text-foreground hover:bg-muted transition-colors flex items-center gap-1.5">
            <ChevronDown size={12} /> Tout déplier
          </button>
          <button onClick={collapseAll}
            className="px-3 py-2.5 rounded-lg text-xs font-medium border border-border bg-background text-foreground hover:bg-muted transition-colors flex items-center gap-1.5">
            <ChevronRight size={12} /> Tout replier
          </button>
        </div>
        <span className="text-xs text-muted-foreground self-center">{currentCount} période(s) sélectionnée(s)</span>
      </div>

      {plansAvecPeriodes.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground border border-border rounded-xl">
          Aucune période de calendrier n'est définie. Créez d'abord un plan de paie et ses périodes dans l'onglet Calendrier.
        </div>
      ) : (
        <div className="space-y-3">
          {plansAvecPeriodes.map(plan => {
            const planPeriodes = periodes.filter(p => p.plan_paie_id === plan.id);
            const annees = [...new Set(planPeriodes.map(p => p.annee))].sort();
            const checkedCount = planPeriodes.filter(p => isChecked(p.id)).length;
            const isOpen = openPlans.has(plan.id);
            return (
              <div key={plan.id} className="rounded-xl border border-border bg-card overflow-hidden">
                <button
                  type="button"
                  onClick={() => togglePlan(plan.id)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-accent/5 hover:bg-accent/10 border-b border-border transition-colors text-left">
                  <div className="flex items-center gap-3">
                    <div className="p-1 rounded-md text-accent">
                      {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </div>
                    <div className="p-1.5 rounded-lg bg-accent/10">
                      <Calendar size={14} className="text-accent" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-foreground">{plan.libelle}</span>
                        <span className="text-xs px-2 py-0.5 rounded-md bg-muted text-muted-foreground font-mono">{plan.code}</span>
                        <span className="text-xs px-2 py-0.5 rounded-md bg-accent/10 text-accent font-medium">{plan.frequence}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {planPeriodes.length} période(s) · {checkedCount} sélectionnée(s) pour {selectedFreq} / {selectedType}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    <button onClick={() => selectAllForPlan(plan.id)} disabled={!selectedFreq}
                      className="px-2.5 py-1.5 rounded-md text-xs font-medium border border-border bg-background text-foreground hover:bg-muted transition-colors disabled:opacity-50">
                      Tout cocher
                    </button>
                    <button onClick={() => deselectAllForPlan(plan.id)} disabled={!selectedFreq}
                      className="px-2.5 py-1.5 rounded-md text-xs font-medium border border-border bg-background text-foreground hover:bg-muted transition-colors disabled:opacity-50">
                      Tout décocher
                    </button>
                  </div>
                </button>

                {isOpen && (<>
                {annees.map(annee => {
                  const anneePeriodes = planPeriodes.filter(p => p.annee === annee);
                  const anneeChecked = anneePeriodes.filter(p => isChecked(p.id)).length;
                  return (
                    <div key={annee} className="border-b border-border last:border-b-0">
                      <div className="px-4 py-2 bg-muted/30 border-b border-border flex items-center gap-2">
                        <span className="text-xs font-semibold text-foreground">Année {annee}</span>
                        <span className="text-xs text-muted-foreground">({anneeChecked}/{anneePeriodes.length})</span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-border bg-muted/20">
                              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide font-semibold text-muted-foreground w-12">
                                <input type="checkbox"
                                  checked={anneePeriodes.every(p => isChecked(p.id)) && anneePeriodes.length > 0}
                                  disabled={!selectedFreq}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      const toAdd = anneePeriodes.filter(p => !isChecked(p.id));
                                      setAssociations(prev => [...prev, ...toAdd.map(p => ({ code_frequence: selectedFreq, calendrier_paie_id: p.id, type_frequence: selectedType }))]);
                                    } else {
                                      const ids = new Set(anneePeriodes.map(p => p.id));
                                      setAssociations(prev => prev.filter(a => !(a.code_frequence === selectedFreq && a.type_frequence === selectedType && ids.has(a.calendrier_paie_id))));
                                    }
                                  }}
                                  className="rounded border-border text-accent focus:ring-accent/30" />
                              </th>
                              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Période</th>
                              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Mois</th>
                              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Date début</th>
                              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Date fin</th>
                              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Type</th>
                              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Statut</th>
                            </tr>
                          </thead>
                          <tbody>
                            {anneePeriodes.map(p => {
                              const checked = isChecked(p.id);
                              return (
                                <tr key={p.id}
                                  onClick={() => selectedFreq && toggle(p.id)}
                                  className="border-b border-border last:border-b-0 cursor-pointer transition-colors hover:bg-muted/40"
                                  style={checked
                                    ? { background: selectedType === "CALCUL" ? "hsl(var(--accent) / 0.08)" : "hsl(var(--warning) / 0.08)" }
                                    : undefined}>
                                  <td className="px-3 py-2">
                                    <input type="checkbox" checked={checked} onChange={() => toggle(p.id)}
                                      disabled={!selectedFreq}
                                      onClick={e => e.stopPropagation()}
                                      className="rounded border-border text-accent focus:ring-accent/30" />
                                  </td>
                                  <td className="px-3 py-2 font-semibold text-foreground whitespace-nowrap">
                                    <span className="text-accent">P{p.numero_periode}</span>
                                    <span className="ml-1.5 text-muted-foreground font-normal">— Période {p.numero_periode} de {p.annee}</span>
                                  </td>
                                  <td className="px-3 py-2 text-foreground whitespace-nowrap">
                                    <span className="font-mono text-muted-foreground">M{String(p.mois).padStart(2, "0")}</span>
                                    <span className="ml-1.5">{MOIS_LABELS[p.mois]}</span>
                                  </td>
                                  <td className="px-3 py-2 text-foreground font-mono">{formatDate(p.date_debut)}</td>
                                  <td className="px-3 py-2 text-foreground font-mono">{formatDate(p.date_fin)}</td>
                                  <td className="px-3 py-2">
                                    <span className="px-2 py-0.5 rounded-md bg-muted text-muted-foreground text-xs">{TYPE_PERIODE_LABELS[p.type_periode] || p.type_periode}</span>
                                  </td>
                                  <td className="px-3 py-2">
                                    <span className="px-2 py-0.5 rounded-md text-xs font-medium" style={
                                      p.statut === "CLOTUREE" ? { background: "hsl(var(--success) / 0.12)", color: "hsl(var(--success))" } :
                                      p.statut === "EN_COURS" ? { background: "hsl(var(--info) / 0.12)", color: "hsl(var(--info))" } :
                                      { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }
                                    }>{p.statut}</span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
                </>)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default FrequencesCalendrierSettings;
