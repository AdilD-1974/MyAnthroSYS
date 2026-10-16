/**
 * CalendrierPaiePage – Gestion des plans de paie et calendriers associés.
 */
import React, { useState, useEffect, useCallback } from "react";
import { db } from "@/lib/api";
import { useFormatMasks } from "@/hooks/useFormatMasks";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Calendar, Copy, ChevronDown, ChevronRight, X, Save, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

const FREQUENCES = [
  { code: "MENSUELLE", label: "Mensuelle" },
  { code: "BIMENSUELLE", label: "Bimensuelle" },
  { code: "QUINZAINE", label: "Quinzaine" },
  { code: "HEBDOMADAIRE", label: "Hebdomadaire" },
  { code: "UTILISATEUR", label: "Utilisateur (libre)" },
];

const FREQUENCES_CALCUL = [
  { code: "MENSUELLE", label: "Mensuelle" },
  { code: "BIMENSUELLE", label: "Bimensuelle" },
  { code: "QUINZAINE", label: "Quinzaine" },
  { code: "HEBDOMADAIRE", label: "Hebdomadaire" },
];

const FREQUENCES_RAZ = [
  { code: "MENSUELLE", label: "Mensuelle" },
  { code: "TRIMESTRIELLE", label: "Trimestrielle" },
  { code: "SEMESTRIELLE", label: "Semestrielle" },
  { code: "ANNUELLE", label: "Annuelle" },
];

const TYPES_PERIODE = [
  { code: "NORMALE", label: "Normale" },
  { code: "EXCEPTIONNELLE", label: "Exceptionnelle" },
];

const STATUTS_PERIODE = [
  { code: "OUVERTE", label: "Ouverte" },
  { code: "FERMEE", label: "Fermée" },
];

const MOIS_LABELS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

type Plan = {
  id: string;
  code: string;
  libelle: string;
  frequence: string;
  frequence_calcul: string;
  frequence_raz_cumuls: string;
  description: string | null;
  actif: boolean;
};

type Periode = {
  id?: string;
  plan_paie_id: string;
  annee: number;
  mois: number;
  numero_periode: number;
  intitule: string | null;
  date_debut: string;
  date_fin: string;
  date_reference: string;
  est_fin_mois: boolean;
  est_fin_trimestre: boolean;
  est_fin_semestre: boolean;
  est_fin_annee: boolean;
  type_periode: string;
  statut: string;
  date_limite_saisie: string | null;
  date_limite_validation: string | null;
  date_ouverture: string | null;
  observations: string | null;
};

const CalendrierPaiePage: React.FC = () => {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [periodes, setPeriodes] = useState<Periode[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Dialog states
  const [planDialog, setPlanDialog] = useState(false);
  const [editPlan, setEditPlan] = useState<Plan | null>(null);
  const [planForm, setPlanForm] = useState({ code: "", libelle: "", frequence: "MENSUELLE", frequence_calcul: "MENSUELLE", frequence_raz_cumuls: "ANNUELLE", description: "", actif: true });

  const [periodeDialog, setPeriodeDialog] = useState(false);
  const [editPeriode, setEditPeriode] = useState<Periode | null>(null);
  const [periodeForm, setPeriodeForm] = useState<Partial<Periode>>({});

  const [generateDialog, setGenerateDialog] = useState(false);
  const [generateYear, setGenerateYear] = useState(new Date().getFullYear());

  const { formatDate } = useFormatMasks();

  // Load plans
  const loadPlans = useCallback(async () => {
    try {
      const data = await db.list<Plan>("plan_paie", { select: "*", order: "code" });
      setPlans(data);
    } catch (e: any) { toast.error(e.message); }
  }, []);

  // Load periodes for a plan + year
  const loadPeriodes = useCallback(async (planId: string, year: number) => {
    setLoading(true);
    let data: Periode[] = [];
    try { data = await db.list<Periode>("calendrier_paie", { plan_paie_id: planId, annee: year, select: "*", order: "numero_periode" }); }
    catch (e: any) { toast.error(e.message); }
    setPeriodes(data);
    setLoading(false);
  }, []);

  useEffect(() => { loadPlans(); }, [loadPlans]);

  useEffect(() => {
    if (selectedPlan) loadPeriodes(selectedPlan.id, selectedYear);
  }, [selectedPlan, selectedYear, loadPeriodes]);

  // Plan CRUD
  const openNewPlan = () => {
    setEditPlan(null);
    setPlanForm({ code: "", libelle: "", frequence: "MENSUELLE", frequence_calcul: "MENSUELLE", frequence_raz_cumuls: "ANNUELLE", description: "", actif: true });
    setPlanDialog(true);
  };

  const openEditPlan = (p: Plan) => {
    setEditPlan(p);
    setPlanForm({ code: p.code, libelle: p.libelle, frequence: p.frequence, frequence_calcul: p.frequence_calcul || "MENSUELLE", frequence_raz_cumuls: p.frequence_raz_cumuls || "ANNUELLE", description: p.description || "", actif: p.actif });
    setPlanDialog(true);
  };

  const savePlan = async () => {
    if (!planForm.code || !planForm.libelle) { toast.error("Code et libellé obligatoires"); return; }
    if (editPlan) {
      try { await db.update("plan_paie", { id: editPlan.id }, planForm); }
      catch (e: any) { toast.error(e.message); return; }
      toast.success("Plan modifié");
    } else {
      try { await db.create("plan_paie", planForm); }
      catch (e: any) { toast.error(e.message); return; }
      toast.success("Plan créé");
    }
    setPlanDialog(false);
    loadPlans();
  };

  const deletePlan = async (id: string) => {
    if (!confirm("Supprimer ce plan et toutes ses périodes ?")) return;
    try { await db.remove("plan_paie", { id }); }
    catch (e: any) { toast.error(e.message); return; }
    if (selectedPlan?.id === id) { setSelectedPlan(null); setPeriodes([]); }
    toast.success("Plan supprimé");
    loadPlans();
  };

  // Generate periodes based on frequency
  const generatePeriodes = async () => {
    if (!selectedPlan) return;
    const freq = selectedPlan.frequence;
    if (freq === "UTILISATEUR") { toast.error("Pour un plan libre, ajoutez les périodes manuellement."); return; }

    const newPeriodes: Omit<Periode, "id">[] = [];

    if (freq === "MENSUELLE" || freq === "BIMENSUELLE") {
      for (let m = 1; m <= 12; m++) {
        if (freq === "BIMENSUELLE") {
          // 1ère quinzaine
          const df1 = `${generateYear}-${String(m).padStart(2, "0")}-15`;
          newPeriodes.push({
            plan_paie_id: selectedPlan.id, annee: generateYear, mois: m, numero_periode: newPeriodes.length + 1,
            date_debut: `${generateYear}-${String(m).padStart(2, "0")}-01`,
            date_fin: df1,
            date_reference: df1,
            est_fin_mois: false, est_fin_trimestre: false, est_fin_semestre: false, est_fin_annee: false,
            type_periode: "NORMALE", statut: "OUVERTE", intitule: null, date_ouverture: null, date_limite_saisie: null, date_limite_validation: null, observations: null,
          });
          // 2ème quinzaine
          const lastDay = new Date(generateYear, m, 0).getDate();
          const df2 = `${generateYear}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
          newPeriodes.push({
            plan_paie_id: selectedPlan.id, annee: generateYear, mois: m, numero_periode: newPeriodes.length + 1,
            date_debut: `${generateYear}-${String(m).padStart(2, "0")}-16`,
            date_fin: df2,
            date_reference: df2,
            est_fin_mois: true, est_fin_trimestre: m % 3 === 0, est_fin_semestre: m % 6 === 0, est_fin_annee: m === 12,
            type_periode: "NORMALE", statut: "OUVERTE", intitule: null, date_ouverture: null, date_limite_saisie: null, date_limite_validation: null, observations: null,
          });
        } else {
          const lastDay = new Date(generateYear, m, 0).getDate();
          const df = `${generateYear}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
          newPeriodes.push({
            plan_paie_id: selectedPlan.id, annee: generateYear, mois: m, numero_periode: m,
            date_debut: `${generateYear}-${String(m).padStart(2, "0")}-01`,
            date_fin: df,
            date_reference: df,
            est_fin_mois: true, est_fin_trimestre: m % 3 === 0, est_fin_semestre: m % 6 === 0, est_fin_annee: m === 12,
            type_periode: "NORMALE", statut: "OUVERTE", intitule: null, date_ouverture: null, date_limite_saisie: null, date_limite_validation: null, observations: null,
          });
        }
      }
    } else if (freq === "QUINZAINE") {
      // 24 périodes de ~15 jours
      for (let m = 1; m <= 12; m++) {
        const lastDay = new Date(generateYear, m, 0).getDate();
        const df1 = `${generateYear}-${String(m).padStart(2, "0")}-15`;
        newPeriodes.push({
          plan_paie_id: selectedPlan.id, annee: generateYear, mois: m, numero_periode: newPeriodes.length + 1,
          date_debut: `${generateYear}-${String(m).padStart(2, "0")}-01`,
          date_fin: df1,
          date_reference: df1,
          est_fin_mois: false, est_fin_trimestre: false, est_fin_semestre: false, est_fin_annee: false,
          type_periode: "NORMALE", statut: "OUVERTE", intitule: null, date_ouverture: null, date_limite_saisie: null, date_limite_validation: null, observations: null,
        });
        const df2 = `${generateYear}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
        newPeriodes.push({
          plan_paie_id: selectedPlan.id, annee: generateYear, mois: m, numero_periode: newPeriodes.length + 1,
          date_debut: `${generateYear}-${String(m).padStart(2, "0")}-16`,
          date_fin: df2,
          date_reference: df2,
          est_fin_mois: true, est_fin_trimestre: m % 3 === 0, est_fin_semestre: m % 6 === 0, est_fin_annee: m === 12,
          type_periode: "NORMALE", statut: "OUVERTE", intitule: null, date_ouverture: null, date_limite_saisie: null, date_limite_validation: null, observations: null,
        });
      }
    } else if (freq === "HEBDOMADAIRE") {
      // ~52 semaines
      let d = new Date(generateYear, 0, 1);
      // Ajuster au lundi
      const dayOfWeek = d.getDay();
      if (dayOfWeek !== 1) d.setDate(d.getDate() + ((8 - dayOfWeek) % 7));
      let num = 1;
      while (d.getFullYear() <= generateYear) {
        const fin = new Date(d); fin.setDate(fin.getDate() + 6);
        if (fin.getFullYear() > generateYear) break;
        const mois = d.getMonth() + 1;
        const finMois = fin.getMonth() !== d.getMonth() || fin.getDate() === new Date(generateYear, fin.getMonth() + 1, 0).getDate();
        const dfStr = fin.toISOString().slice(0, 10);
        newPeriodes.push({
          plan_paie_id: selectedPlan.id, annee: generateYear, mois, numero_periode: num,
          date_debut: d.toISOString().slice(0, 10),
          date_fin: dfStr,
          date_reference: dfStr,
          est_fin_mois: finMois, est_fin_trimestre: finMois && mois % 3 === 0,
          est_fin_semestre: finMois && mois % 6 === 0, est_fin_annee: false,
          type_periode: "NORMALE", statut: "OUVERTE", intitule: null, date_ouverture: null, date_limite_saisie: null, date_limite_validation: null, observations: null,
        });
        d.setDate(d.getDate() + 7);
        num++;
      }
      if (newPeriodes.length > 0) newPeriodes[newPeriodes.length - 1].est_fin_annee = true;
    }

    try { await db.create("calendrier_paie", newPeriodes); }
    catch (e: any) { toast.error(e.message); return; }
    toast.success(`${newPeriodes.length} périodes générées pour ${generateYear}`);
    setGenerateDialog(false);
    setSelectedYear(generateYear);
    loadPeriodes(selectedPlan.id, generateYear);
  };

  // Ajouter une période manuelle (dialog de création, disponible pour tous les plans)
  const addManualPeriode = () => {
    if (!selectedPlan) return;
    // Calculer le prochain numéro disponible (max + 1)
    const maxNum = periodes.reduce((m, p) => Math.max(m, p.numero_periode || 0), 0);
    const now = new Date();
    const mois = now.getMonth() + 1;
    const lastDay = new Date(selectedYear, mois, 0).getDate();
    const dateDebut = `${selectedYear}-${String(mois).padStart(2, "0")}-01`;
    const dateFin = `${selectedYear}-${String(mois).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    setEditPeriode(null);
    setPeriodeForm({
      plan_paie_id: selectedPlan.id,
      annee: selectedYear,
      mois,
      numero_periode: maxNum + 1,
      date_debut: dateDebut,
      date_fin: dateFin,
      date_reference: dateFin,
      est_fin_mois: false, est_fin_trimestre: false, est_fin_semestre: false, est_fin_annee: false,
      type_periode: "NORMALE", statut: "OUVERTE",
      intitule: null, date_ouverture: null, date_limite_saisie: null, date_limite_validation: null, observations: null,
    });
    setPeriodeDialog(true);
  };

  // Periode CRUD
  const openEditPeriode = (p: Periode) => {
    setEditPeriode(p);
    setPeriodeForm({ ...p });
    setPeriodeDialog(true);
  };

  const savePeriode = async () => {
    const f = { ...periodeForm } as Periode;
    if (!f.plan_paie_id || !f.date_debut || !f.date_fin || !f.numero_periode) {
      toast.error("Numéro, dates de début/fin obligatoires"); return;
    }
    if (f.date_fin < f.date_debut) { toast.error("La date de fin doit être ≥ date de début"); return; }
    // Fallback : si date_reference oubliée → date_fin
    if (!f.date_reference) f.date_reference = f.date_fin;
    if (f.date_reference < f.date_debut || f.date_reference > f.date_fin) {
      toast.error("La date de référence doit être comprise entre la date de début et la date de fin"); return;
    }
    if (editPeriode?.id) {
      const { id, ...rest } = f as Periode & { id: string };
      try { await db.update("calendrier_paie", { id: editPeriode.id }, rest); }
      catch (e: any) { toast.error(e.message); return; }
      toast.success("Période modifiée");
    } else {
      try { await db.create("calendrier_paie", f); }
      catch (e: any) { toast.error(e.message); return; }
      toast.success("Période ajoutée");
    }
    setPeriodeDialog(false);
    if (selectedPlan) loadPeriodes(selectedPlan.id, selectedYear);
  };

  const deletePeriode = async (id: string) => {
    if (!confirm("Supprimer cette période ?")) return;
    try { await db.remove("calendrier_paie", { id }); }
    catch (e: any) { toast.error(e.message); return; }
    toast.success("Période supprimée");
    if (selectedPlan) loadPeriodes(selectedPlan.id, selectedYear);
  };

  const toggleStatutPeriode = async (p: Periode) => {
    const newStatut = p.statut === "OUVERTE" ? "FERMEE" : "OUVERTE";
    try { await db.update("calendrier_paie", { id: p.id! }, { statut: newStatut }); }
    catch (e: any) { toast.error(e.message); return; }
    toast.success(`Période ${newStatut === "FERMEE" ? "fermée" : "réouverte"}`);
    if (selectedPlan) loadPeriodes(selectedPlan.id, selectedYear);
  };

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  return (
    <div className="space-y-6">
      {/* Plans de paie */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Plans de paie</h2>
        <Button size="sm" onClick={openNewPlan} className="gap-2">
          <Plus size={14} /> Nouveau plan
        </Button>
      </div>

      <div className="space-y-2">
        {plans.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            Aucun plan de paie. Créez-en un pour commencer.
          </div>
        )}
        {plans.map((p) => (
          <div key={p.id} className="border border-border rounded-xl overflow-hidden">
            <div
              className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                selectedPlan?.id === p.id ? "bg-accent/10" : "hover:bg-muted/50"
              }`}
              onClick={() => {
                setSelectedPlan(p);
                setExpandedPlan(expandedPlan === p.id ? null : p.id);
              }}
            >
              {expandedPlan === p.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">{p.code}</span>
                  <span className="font-medium text-sm">{p.libelle}</span>
                  <Badge variant={p.actif ? "default" : "secondary"} className="text-[10px]">
                    {p.actif ? "Actif" : "Inactif"}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {FREQUENCES.find((f) => f.code === p.frequence)?.label || p.frequence}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-600">
                    Calcul : {FREQUENCES_CALCUL.find((f) => f.code === p.frequence_calcul)?.label || p.frequence_calcul || "—"}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-600">
                    RAZ : {FREQUENCES_RAZ.find((f) => f.code === p.frequence_raz_cumuls)?.label || p.frequence_raz_cumuls || "—"}
                  </Badge>
                </div>
                {p.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{p.description}</p>}
              </div>
              <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditPlan(p)}>
                  <Pencil size={13} style={{ color: "hsl(var(--accent))" }} />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deletePlan(p.id)}>
                  <Trash2 size={13} />
                </Button>
              </div>
            </div>

            {/* Calendrier expanded */}
            {expandedPlan === p.id && selectedPlan?.id === p.id && (
              <div className="border-t border-border bg-muted/20 p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Calendar size={16} className="text-accent" />
                    <span className="text-sm font-medium">Calendrier {selectedYear}</span>
                    <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
                      <SelectTrigger className="w-24 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {years.map((y) => (
                          <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex gap-2">
                    {selectedPlan?.frequence === "UTILISATEUR" ? (
                      <Button size="sm" variant="outline" className="gap-1 text-xs h-8" onClick={addManualPeriode}>
                        <Plus size={12} /> Ajouter une période
                      </Button>
                    ) : (
                      <>
                        <Button size="sm" variant="outline" className="gap-1 text-xs h-8" onClick={addManualPeriode}>
                          <Plus size={12} /> Ajouter une période
                        </Button>
                        <Button size="sm" variant="outline" className="gap-1 text-xs h-8" onClick={() => { setGenerateYear(selectedYear); setGenerateDialog(true); }}>
                          <RefreshCw size={12} /> Générer l'exercice
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {loading ? (
                  <div className="text-center py-6 text-muted-foreground text-sm">Chargement…</div>
                ) : periodes.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground text-sm">
                    Aucune période pour {selectedYear}. Utilisez "Générer l'exercice".
                  </div>
                ) : (
                  <div className="rounded-lg border border-border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="text-xs w-12">#</TableHead>
                          <TableHead className="text-xs">Mois</TableHead>
                          <TableHead className="text-xs">Intitulé</TableHead>
                          <TableHead className="text-xs">Trimestre</TableHead>
                          <TableHead className="text-xs">Semestre</TableHead>
                          <TableHead className="text-xs">Début</TableHead>
                          <TableHead className="text-xs">Fin</TableHead>
                          <TableHead className="text-xs">Date réf.</TableHead>
                          <TableHead className="text-xs text-center">Fin T</TableHead>
                          <TableHead className="text-xs text-center">Fin S</TableHead>
                          <TableHead className="text-xs text-center">Fin A</TableHead>
                          <TableHead className="text-xs">Type</TableHead>
                          <TableHead className="text-xs">Statut</TableHead>
                          <TableHead className="text-xs">Ouverture</TableHead>
                          <TableHead className="text-xs">Lim. saisie</TableHead>
                          <TableHead className="text-xs">Lim. valid.</TableHead>
                          <TableHead className="text-xs w-24 sticky right-0 bg-background z-10 text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {periodes.map((per) => (
                          <TableRow key={per.id} className="text-xs cursor-pointer" onDoubleClick={() => openEditPeriode(per)} title="Double-cliquez pour modifier la période">
                            <TableCell className="font-mono">{per.numero_periode}</TableCell>
                            <TableCell className="font-medium">{MOIS_LABELS[per.mois - 1]}</TableCell>
                            <TableCell className="text-muted-foreground">{per.intitule || "—"}</TableCell>
                            <TableCell className="text-muted-foreground">T{Math.ceil(per.mois / 3)}</TableCell>
                            <TableCell className="text-muted-foreground">S{per.mois <= 6 ? 1 : 2}</TableCell>
                            <TableCell>{formatDate(per.date_debut)}</TableCell>
                            <TableCell>{formatDate(per.date_fin)}</TableCell>
                            <TableCell className="font-medium text-accent">{formatDate(per.date_reference)}</TableCell>
                            <TableCell className="text-center">{per.est_fin_trimestre ? "✓" : ""}</TableCell>
                            <TableCell className="text-center">{per.est_fin_semestre ? "✓" : ""}</TableCell>
                            <TableCell className="text-center">{per.est_fin_annee ? "✓" : ""}</TableCell>
                            <TableCell>
                              <Badge variant={per.type_periode === "EXCEPTIONNELLE" ? "destructive" : "outline"} className="text-[10px]">
                                {per.type_periode}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {(() => {
                                const today = new Date().toISOString().slice(0, 10);
                                const estFermee = per.statut === "FERMEE" || per.statut === "CLOTUREE";
                                const nonOuverte = !estFermee && !!per.date_ouverture && per.date_ouverture > today;
                                if (nonOuverte) {
                                  return (
                                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700" title={`Ouverture le ${formatDate(per.date_ouverture)}`}>
                                      Non ouverte
                                    </span>
                                  );
                                }
                                return (
                                  <button
                                    onClick={() => toggleStatutPeriode(per)}
                                    className={`text-[10px] font-medium px-2 py-0.5 rounded-full cursor-pointer transition-colors ${
                                      per.statut === "OUVERTE"
                                        ? "bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25"
                                        : "bg-rose-500/15 text-rose-600 hover:bg-rose-500/25"
                                    }`}
                                  >
                                    {per.statut}
                                  </button>
                                );
                              })()}
                            </TableCell>
                            <TableCell className="text-muted-foreground">{per.date_ouverture ? formatDate(per.date_ouverture) : "—"}</TableCell>
                            <TableCell className="text-muted-foreground">{per.date_limite_saisie ? formatDate(per.date_limite_saisie) : "—"}</TableCell>
                            <TableCell className="text-muted-foreground">{per.date_limite_validation ? formatDate(per.date_limite_validation) : "—"}</TableCell>
                            <TableCell className="sticky right-0 bg-background z-10">
                              <div className="flex gap-1 justify-end">
                                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEditPeriode(per)}>
                                  <Pencil size={11} style={{ color: "hsl(var(--accent))" }} />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => deletePeriode(per.id!)}>
                                  <Trash2 size={11} />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Plan Dialog */}
      <Dialog open={planDialog} onOpenChange={setPlanDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editPlan ? "Modifier le plan" : "Nouveau plan de paie"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Code *</Label>
                <Input value={planForm.code} onChange={(e) => setPlanForm({ ...planForm, code: e.target.value.toUpperCase() })} className="h-9 text-sm" />
              </div>
              <div>
                <Label className="text-xs">Fréquence du plan</Label>
                <Select value={planForm.frequence} onValueChange={(v) => setPlanForm({ ...planForm, frequence: v })}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FREQUENCES.map((f) => <SelectItem key={f.code} value={f.code}>{f.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Libellé *</Label>
              <Input value={planForm.libelle} onChange={(e) => setPlanForm({ ...planForm, libelle: e.target.value })} className="h-9 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <Input value={planForm.description} onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })} className="h-9 text-sm" />
            </div>
            {/* Fréquences des rubriques */}
            <div className="border border-border rounded-lg p-3 space-y-3 bg-muted/30">
              <p className="text-xs font-semibold text-foreground">Fréquences des rubriques</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Fréquence de calcul</Label>
                  <Select value={planForm.frequence_calcul} onValueChange={(v) => setPlanForm({ ...planForm, frequence_calcul: v })}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FREQUENCES_CALCUL.map((f) => <SelectItem key={f.code} value={f.code}>{f.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground mt-1">À quelle fréquence les rubriques sont calculées</p>
                </div>
                <div>
                  <Label className="text-xs">RAZ des cumuls</Label>
                  <Select value={planForm.frequence_raz_cumuls} onValueChange={(v) => setPlanForm({ ...planForm, frequence_raz_cumuls: v })}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FREQUENCES_RAZ.map((f) => <SelectItem key={f.code} value={f.code}>{f.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground mt-1">Fréquence de remise à zéro des cumuls</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={planForm.actif} onCheckedChange={(v) => setPlanForm({ ...planForm, actif: v })} />
              <Label className="text-xs">Actif</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanDialog(false)}>Annuler</Button>
            <Button onClick={savePlan} className="gap-1"><Save size={14} /> Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Période Dialog */}
      <Dialog open={periodeDialog} onOpenChange={setPeriodeDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editPeriode?.id ? "Modifier la période" : "Ajouter une période"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Résumé en lecture seule */}
            <div className="grid grid-cols-4 gap-3 p-3 rounded-lg bg-muted/50 border border-border">
              <div>
                <Label className="text-[10px] text-muted-foreground uppercase">Année</Label>
                <p className="text-sm font-medium">{periodeForm.annee}</p>
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground uppercase">Mois</Label>
                <p className="text-sm font-medium">{MOIS_LABELS[(periodeForm.mois || 1) - 1]}</p>
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground uppercase">Trimestre</Label>
                <p className="text-sm font-medium">T{Math.ceil((periodeForm.mois || 1) / 3)}</p>
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground uppercase">Semestre</Label>
                <p className="text-sm font-medium">S{(periodeForm.mois || 1) <= 6 ? 1 : 2}</p>
              </div>
            </div>

            <div>
              <Label className="text-xs">Intitulé de la période <span className="font-normal text-muted-foreground">(optionnel — sinon « Mois Année »)</span></Label>
              <Input value={periodeForm.intitule || ""} onChange={(e) => setPeriodeForm({ ...periodeForm, intitule: e.target.value || null })} placeholder="ex. Paie de Janvier 2026" className="h-9 text-sm" />
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <Label className="text-xs">N° période</Label>
                <Input type="number" value={periodeForm.numero_periode || ""} onChange={(e) => setPeriodeForm({ ...periodeForm, numero_periode: Number(e.target.value) })} className="h-9 text-sm" />
              </div>
              <div>
                <Label className="text-xs">Mois</Label>
                <Select value={String(periodeForm.mois || 1)} onValueChange={(v) => setPeriodeForm({ ...periodeForm, mois: Number(v) })}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MOIS_LABELS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Date début</Label>
                <Input type="date" value={periodeForm.date_debut || ""} onChange={(e) => setPeriodeForm({ ...periodeForm, date_debut: e.target.value })} className="h-9 text-sm" />
              </div>
              <div>
                <Label className="text-xs">Date fin</Label>
                <Input type="date" value={periodeForm.date_fin || ""} onChange={(e) => setPeriodeForm({ ...periodeForm, date_fin: e.target.value })} className="h-9 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">
                  Date de référence
                  <span className="text-muted-foreground font-normal ml-1">(pivot pour le calcul de paie)</span>
                </Label>
                <Input
                  type="date"
                  value={periodeForm.date_reference || ""}
                  onChange={(e) => setPeriodeForm({ ...periodeForm, date_reference: e.target.value })}
                  className="h-9 text-sm"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Si non renseignée, la date de fin de période sera utilisée automatiquement.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Type de période</Label>
                <Select value={periodeForm.type_periode || "NORMALE"} onValueChange={(v) => setPeriodeForm({ ...periodeForm, type_periode: v })}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TYPES_PERIODE.map((t) => <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Statut</Label>
                <Select value={periodeForm.statut || "OUVERTE"} onValueChange={(v) => setPeriodeForm({ ...periodeForm, statut: v })}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUTS_PERIODE.map((s) => <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Observations</Label>
                <Input value={periodeForm.observations || ""} onChange={(e) => setPeriodeForm({ ...periodeForm, observations: e.target.value || null })} className="h-9 text-sm" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Date d'ouverture <span className="font-normal text-muted-foreground">— le traitement est bloque avant cette date (vide = ouverte)</span></Label>
              <Input type="date" value={periodeForm.date_ouverture || ""} onChange={(e) => setPeriodeForm({ ...periodeForm, date_ouverture: e.target.value || null })} className="h-9 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Date limite saisie</Label>
                <Input type="date" value={periodeForm.date_limite_saisie || ""} onChange={(e) => setPeriodeForm({ ...periodeForm, date_limite_saisie: e.target.value || null })} className="h-9 text-sm" />
              </div>
              <div>
                <Label className="text-xs">Date limite validation</Label>
                <Input type="date" value={periodeForm.date_limite_validation || ""} onChange={(e) => setPeriodeForm({ ...periodeForm, date_limite_validation: e.target.value || null })} className="h-9 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div className="flex items-center gap-2">
                <Switch checked={periodeForm.est_fin_mois || false} onCheckedChange={(v) => setPeriodeForm({ ...periodeForm, est_fin_mois: v })} />
                <Label className="text-xs">Fin mois</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={periodeForm.est_fin_trimestre || false} onCheckedChange={(v) => setPeriodeForm({ ...periodeForm, est_fin_trimestre: v })} />
                <Label className="text-xs">Fin trim.</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={periodeForm.est_fin_semestre || false} onCheckedChange={(v) => setPeriodeForm({ ...periodeForm, est_fin_semestre: v })} />
                <Label className="text-xs">Fin sem.</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={periodeForm.est_fin_annee || false} onCheckedChange={(v) => setPeriodeForm({ ...periodeForm, est_fin_annee: v })} />
                <Label className="text-xs">Fin année</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPeriodeDialog(false)}>Annuler</Button>
            <Button onClick={savePeriode} className="gap-1"><Save size={14} /> Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generate Dialog */}
      <Dialog open={generateDialog} onOpenChange={setGenerateDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Générer l'exercice</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              Générer automatiquement les périodes pour le plan <strong>{selectedPlan?.libelle}</strong>{" "}
              (fréquence : {FREQUENCES.find(f => f.code === selectedPlan?.frequence)?.label}).
            </p>
            <div>
              <Label className="text-xs">Année</Label>
              <Select value={String(generateYear)} onValueChange={(v) => setGenerateYear(Number(v))}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenerateDialog(false)}>Annuler</Button>
            <Button onClick={generatePeriodes} className="gap-1"><RefreshCw size={14} /> Générer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CalendrierPaiePage;
