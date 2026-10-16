/**
 * JoursFeriesPage – Paramétrage des Jours Fériés
 * Configuration > Gestion des Temps > Jours Fériés
 *
 * Auteur : Adil DAIA
 *
 * RG-FERIE-STRUCT-01   : Chaque jour férié appartient à une famille (Nationales, Religieuses, etc.)
 *                        et est rattaché à un événement gabarit (ref_evenement_ferie).
 * RG-FERIE-MULTI-JOURS-01 : Un événement peut couvrir plusieurs jours consécutifs.
 *                            date_fin = date_debut + nombre_jours - 1.
 * RG-FERIE-EXERCICE-01 : Un exercice = une année civile.
 *                        La génération d'un nouvel exercice clone les événements actifs
 *                        de l'année précédente (dates à ajuster manuellement pour les
 *                        fêtes religieuses mobiles).
 * RG-FERIE-UNICITE-01  : Un même événement ne peut être déclaré qu'une seule fois par exercice.
 */

import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  CalendarDays, Plus, Pencil, Trash2, Loader2, ChevronDown, ChevronRight,
  Copy, AlertTriangle, Check, X, Search, ToggleLeft, ToggleRight,
  Sparkles, Calendar, FolderOpen, Palette, Info, ChevronLeft,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FamilleFerie {
  code: string;
  libelle: string;
  description: string | null;
  couleur: string;
  actif: boolean;
  ordre: number | null;
}

interface EvenementFerie {
  code: string;
  libelle: string;
  description: string | null;
  code_famille: string | null;
  nb_jours_defaut: number;
  actif: boolean;
  ordre: number | null;
}

interface JourFerie {
  id: string;
  annee: number;
  code_evenement: string;
  code_famille: string | null;
  libelle_specifique: string | null;
  date_debut: string;
  nombre_jours: number;
  observations: string | null;
  actif: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** RG-FERIE-COULEUR (Adil DAIA): hex → rgba avec opacité */
const hexToRgba = (hex: string, alpha: number): string => {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!r) return `rgba(99,102,241,${alpha})`;
  return `rgba(${parseInt(r[1], 16)},${parseInt(r[2], 16)},${parseInt(r[3], 16)},${alpha})`;
};

const addDays = (dateStr: string, days: number): string => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
};

const formatDateFR = (dateStr: string): string => {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("fr-MA", { day: "2-digit", month: "long", year: "numeric" });
};

const PALETTE = [
  "#EF4444","#F97316","#EAB308","#22C55E","#14B8A6","#06B6D4",
  "#3B82F6","#8B5CF6","#EC4899","#6366F1","#64748B","#78716C",
];

// ─── Sous-composants ──────────────────────────────────────────────────────────

const Toggle: React.FC<{ value: boolean; onChange: (v: boolean) => void; label: string }> = ({ value, onChange, label }) => (
  <button type="button" onClick={() => onChange(!value)} className="flex items-center gap-1.5 text-xs select-none">
    {value
      ? <ToggleRight size={18} style={{ color: "hsl(var(--accent))" }} />
      : <ToggleLeft size={18} style={{ color: "hsl(var(--muted-foreground))" }} />}
    <span style={{ color: value ? "hsl(var(--accent))" : "hsl(var(--muted-foreground))" }}>{label}</span>
  </button>
);

const Field: React.FC<{ label: string; required?: boolean; children: React.ReactNode; className?: string }> = ({ label, required, children, className }) => (
  <div className={className}>
    <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
      {label}{required && <span style={{ color: "hsl(0 84% 55%)" }}> *</span>}
    </label>
    {children}
  </div>
);

const inp = "w-full px-3 py-1.5 rounded-lg border text-sm outline-none transition-colors";
const inpS = { borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" };

// ─── Component principal ───────────────────────────────────────────────────────

const JoursFeriesPage: React.FC = () => {
  const currentYear = new Date().getFullYear();

  // ── State ──
  const [familles, setFamilles]     = useState<FamilleFerie[]>([]);
  const [evenements, setEvenements] = useState<EvenementFerie[]>([]);
  const [jours, setJours]           = useState<JourFerie[]>([]);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const [selectedAnnee, setSelectedAnnee]     = useState<number>(currentYear);
  const [filterFamille, setFilterFamille]     = useState<string>("all");
  const [search, setSearch]                   = useState("");
  const [expandedFamilles, setExpandedFamilles] = useState<Set<string>>(new Set(["NAT","REL","INT","DIV"]));

  // Onglets : "calendrier" | "evenements" | "familles"
  const [activeTab, setActiveTab] = useState<"calendrier" | "evenements" | "familles">("calendrier");

  // Panels
  const [panel, setPanel] = useState<string | null>(null);

  // Formulaire Famille
  const [familleForm, setFamilleForm] = useState<FamilleFerie>({ code:"", libelle:"", description:null, couleur:"#6366F1", actif:true, ordre:0 });

  // Formulaire Événement
  const [evtForm, setEvtForm] = useState<EvenementFerie>({ code:"", libelle:"", description:null, code_famille:null, nb_jours_defaut:1, actif:true, ordre:0 });

  // Formulaire Jour Férié
  const [jourForm, setJourForm] = useState<Partial<JourFerie>>({ annee: currentYear, nombre_jours:1, actif:true });

  // Génération exercice
  const [showGenModal, setShowGenModal]     = useState(false);
  const [genFromAnnee, setGenFromAnnee]     = useState<number>(currentYear - 1);
  const [genToAnnee, setGenToAnnee]         = useState<number>(currentYear);
  const [genPreview, setGenPreview]         = useState<EvenementFerie[]>([]);
  const [genGenerating, setGenGenerating]   = useState(false);

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: fam }, { data: evt }, { data: jf }] = await Promise.all([
      supabase.from("ref_famille_ferie" as never).select("*").order("ordre").order("libelle"),
      supabase.from("ref_evenement_ferie" as never).select("*").order("ordre").order("libelle"),
      supabase.from("ref_jours_feries" as never).select("*").order("date_debut"),
    ]);
    if (fam) setFamilles(fam as FamilleFerie[]);
    if (evt) setEvenements(evt as EvenementFerie[]);
    if (jf)  setJours(jf as JourFerie[]);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // RG-FERIE-RECALCUL-01 (Adil DAIA) : Recalcul des soldes congés après modification du calendrier fériés
  const recalculerSoldesApresModifFeries = async (annee: number) => {
    try {
      // Récupérer tous les collaborateurs actifs ayant un solde pour cet exercice
      const { data: soldes } = await (supabase
        .from("cong_solde" as never)
        .select("collaborateur_id, code_type_conge")
        .eq("exercice", annee)
        .eq("archive", false) as any);
      if (!soldes || soldes.length === 0) return;
      // Recalculer chaque combinaison collaborateur/type via la fonction DB
      const uniquePairs = new Map<string, { cid: string; tc: string }>();
      for (const s of soldes as any[]) {
        const key = `${s.collaborateur_id}|${s.code_type_conge}`;
        if (!uniquePairs.has(key)) uniquePairs.set(key, { cid: s.collaborateur_id, tc: s.code_type_conge });
      }
      let count = 0;
      for (const { cid, tc } of uniquePairs.values()) {
        await supabase.rpc("recalculate_cong_solde", {
          p_collaborateur_id: cid,
          p_code_type_conge: tc,
          p_exercice: annee,
        });
        count++;
      }
      if (count > 0) {
        alert(`${count} solde(s) de congés recalculé(s) pour l'exercice ${annee} suite à la modification des jours fériés.`);
      }
    } catch (e: any) {
      console.error("Erreur recalcul soldes fériés:", e);
    }
  };

  // ── Données filtrées ──────────────────────────────────────────────────────
  const joursAnnee = jours.filter(j => j.annee === selectedAnnee);
  const joursFiltered = joursAnnee.filter(j => {
    if (filterFamille !== "all" && j.code_famille !== filterFamille) return false;
    if (search) {
      const evt = evenements.find(e => e.code === j.code_evenement);
      const s = search.toLowerCase();
      if (!evt?.libelle.toLowerCase().includes(s) && !(j.libelle_specifique?.toLowerCase().includes(s))) return false;
    }
    return true;
  });

  // Grouper par famille
  const joursByFamille: Record<string, JourFerie[]> = {};
  joursFiltered.forEach(j => {
    const k = j.code_famille || "DIV";
    if (!joursByFamille[k]) joursByFamille[k] = [];
    joursByFamille[k].push(j);
  });

  // Années disponibles dans les données
  const anneesDisponibles = [...new Set(jours.map(j => j.annee))].sort((a,b) => b-a);

  // Total jours de l'exercice
  const totalJours = joursAnnee.reduce((s, j) => s + j.nombre_jours, 0);

  // ── CRUD Famille ──────────────────────────────────────────────────────────
  const saveFamille = async () => {
    if (!familleForm.code || !familleForm.libelle) { setError("Code et libellé requis."); return; }
    setSaving(true); setError(null);
    const isEdit = panel?.startsWith("edit_famille:");
    const payload = { ...familleForm, code: familleForm.code.toUpperCase() };
    const { error: err } = isEdit
      ? await (supabase.from("ref_famille_ferie" as never) as any).update(payload).eq("code", payload.code)
      : await (supabase.from("ref_famille_ferie" as never) as any).insert(payload);
    setSaving(false);
    if (err) { setError(err.message.includes("duplicate") ? "Ce code existe déjà." : err.message); return; }
    setPanel(null); loadData();
  };

  const deleteFamille = async (code: string) => {
    if (!confirm(`Supprimer la famille "${code}" ?`)) return;
    await (supabase.from("ref_famille_ferie" as never) as any).delete().eq("code", code);
    loadData();
  };

  // ── CRUD Événement ────────────────────────────────────────────────────────
  const saveEvenement = async () => {
    if (!evtForm.code || !evtForm.libelle) { setError("Code et libellé requis."); return; }
    if (evtForm.nb_jours_defaut < 1) { setError("Le nombre de jours doit être ≥ 1."); return; }
    setSaving(true); setError(null);
    const isEdit = panel?.startsWith("edit_evt:");
    const payload = { ...evtForm, code: evtForm.code.toUpperCase() };
    const { error: err } = isEdit
      ? await (supabase.from("ref_evenement_ferie" as never) as any).update(payload).eq("code", payload.code)
      : await (supabase.from("ref_evenement_ferie" as never) as any).insert(payload);
    setSaving(false);
    if (err) { setError(err.message.includes("duplicate") ? "Ce code existe déjà." : err.message); return; }
    setPanel(null); loadData();
  };

  const deleteEvenement = async (code: string) => {
    if (!confirm(`Supprimer l'événement "${code}" ?`)) return;
    await (supabase.from("ref_evenement_ferie" as never) as any).delete().eq("code", code);
    loadData();
  };

  // ── CRUD Jour Férié ────────────────────────────────────────────────────────
  const saveJour = async () => {
    if (!jourForm.code_evenement || !jourForm.date_debut) { setError("Événement et date de début requis."); return; }
    setSaving(true); setError(null);
    // RG-FERIE-EXERCICE-01 (Adil DAIA): copier la famille depuis l'événement si non renseignée
    const evt = evenements.find(e => e.code === jourForm.code_evenement);
    const payload = {
      annee: jourForm.annee || selectedAnnee,
      code_evenement: jourForm.code_evenement,
      code_famille: jourForm.code_famille || evt?.code_famille || null,
      libelle_specifique: jourForm.libelle_specifique || null,
      date_debut: jourForm.date_debut,
      nombre_jours: jourForm.nombre_jours || 1,
      observations: jourForm.observations || null,
      actif: jourForm.actif !== false,
    };
    const isEdit = panel?.startsWith("edit_jour:");
    const { error: err } = isEdit && jourForm.id
      ? await (supabase.from("ref_jours_feries" as never) as any).update(payload).eq("id", jourForm.id)
      : await (supabase.from("ref_jours_feries" as never) as any).insert(payload);
    setSaving(false);
    if (err) { setError(err.message.includes("uq_ferie_annee_evt") ? "Cet événement est déjà déclaré pour cet exercice." : err.message); return; }
    setPanel(null); loadData();
    // RG-FERIE-RECALCUL-01 (Adil DAIA) : Recalculer les soldes congés après modification du calendrier
    recalculerSoldesApresModifFeries(payload.annee);
  };

  const deleteJour = async (id: string) => {
    if (!confirm("Supprimer cette occurrence ?")) return;
    const jourToDelete = jours.find(j => j.id === id);
    await (supabase.from("ref_jours_feries" as never) as any).delete().eq("id", id);
    loadData();
    if (jourToDelete) recalculerSoldesApresModifFeries(jourToDelete.annee);
  };

  // ── Génération d'exercice ─────────────────────────────────────────────────
  /**
   * RG-FERIE-EXERCICE-01 (Adil DAIA): Génération d'un nouvel exercice.
   * Clone les événements actifs de l'exercice source dans le nouvel exercice.
   * Les fêtes religieuses mobiles nécessitent un ajustement manuel des dates.
   */
  const handleGenerate = async () => {
    // Vérification : l'exercice cible ne doit pas déjà exister
    const existants = jours.filter(j => j.annee === genToAnnee);
    if (existants.length > 0) {
      if (!confirm(`L'exercice ${genToAnnee} contient déjà ${existants.length} jours fériés. Continuer quand même (les doublons seront ignorés) ?`)) return;
    }

    setGenGenerating(true); setError(null);
    const source = jours.filter(j => j.annee === genFromAnnee && j.actif);
    const yearDiff = genToAnnee - genFromAnnee;
    let inserted = 0;
    let skipped  = 0;

    for (const j of source) {
      // Décaler la date d'une année (approximatif pour les fêtes fixes)
      const newDate = new Date(j.date_debut);
      newDate.setFullYear(newDate.getFullYear() + yearDiff);
      const payload = {
        annee: genToAnnee,
        code_evenement: j.code_evenement,
        code_famille: j.code_famille,
        libelle_specifique: j.libelle_specifique,
        date_debut: newDate.toISOString().split("T")[0],
        nombre_jours: j.nombre_jours,
        observations: "⚠️ Généré automatiquement – vérifier la date (fêtes mobiles)",
        actif: true,
      };
      const { error: e } = await (supabase.from("ref_jours_feries" as never) as any).insert(payload);
      if (e && e.message?.includes("uq_ferie_annee_evt")) skipped++;
      else inserted++;
    }

    setGenGenerating(false);
    setShowGenModal(false);
    setSelectedAnnee(genToAnnee);
    alert(`Exercice ${genToAnnee} généré : ${inserted} événements créés, ${skipped} ignorés (doublons).`);
    loadData();
    if (inserted > 0) recalculerSoldesApresModifFeries(genToAnnee);
  };

  // ── Ouvrir les panels ──────────────────────────────────────────────────────
  const openNewFamille = () => {
    setFamilleForm({ code:"", libelle:"", description:null, couleur:"#6366F1", actif:true, ordre:0 });
    setError(null); setPanel("new_famille");
  };
  const openEditFamille = (f: FamilleFerie) => {
    setFamilleForm({ ...f }); setError(null); setPanel(`edit_famille:${f.code}`);
  };
  const openNewEvt = () => {
    setEvtForm({ code:"", libelle:"", description:null, code_famille:null, nb_jours_defaut:1, actif:true, ordre:0 });
    setError(null); setPanel("new_evt");
  };
  const openEditEvt = (e: EvenementFerie) => {
    setEvtForm({ ...e }); setError(null); setPanel(`edit_evt:${e.code}`);
  };
  const openNewJour = () => {
    setJourForm({ annee: selectedAnnee, nombre_jours:1, actif:true });
    setError(null); setPanel("new_jour");
  };
  const openEditJour = (j: JourFerie) => {
    setJourForm({ ...j }); setError(null); setPanel(`edit_jour:${j.id}`);
  };

  // ── Sélection événement → auto-remplir famille et nb_jours ───────────────
  const handleEvtChange = (code: string) => {
    const evt = evenements.find(e => e.code === code);
    setJourForm(prev => ({
      ...prev,
      code_evenement: code,
      code_famille: evt?.code_famille || prev.code_famille || null,
      nombre_jours: evt?.nb_jours_defaut || prev.nombre_jours || 1,
    }));
  };

  // RG-FERIE-FILTRE-01 (Adil DAIA) : Sélection famille → filtre les événements disponibles
  const handleFamilleJourChange = (codeFamille: string) => {
    setJourForm(prev => ({
      ...prev,
      code_famille: codeFamille || null,
      // Réinitialiser l'événement si la famille change et que l'événement actuel n'appartient pas à la nouvelle famille
      code_evenement: (() => {
        const currentEvt = evenements.find(e => e.code === prev.code_evenement);
        if (!codeFamille) return prev.code_evenement; // pas de famille = pas de filtre
        if (currentEvt && currentEvt.code_famille === codeFamille) return prev.code_evenement;
        return undefined; // réinitialiser
      })(),
    }));
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const isPanel = panel !== null;

  // ── Render Panel Famille ────────────────────────────────────────────────────
  const renderPanelFamille = () => (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-5">
        <button onClick={() => setPanel(null)} className="p-1.5 rounded-lg hover:bg-muted transition-colors"><ChevronLeft size={16} /></button>
        <h3 className="font-semibold text-sm" style={{ color: "hsl(var(--foreground))" }}>
          {panel === "new_famille" ? "Nouvelle famille" : "Modifier famille"}
        </h3>
      </div>
      <div className="space-y-3 flex-1">
        <Field label="Code" required>
          <input className={inp} style={inpS} value={familleForm.code} disabled={panel?.startsWith("edit_")}
            onChange={e => setFamilleForm(p => ({ ...p, code: e.target.value.toUpperCase() }))} placeholder="NAT" maxLength={10} />
        </Field>
        <Field label="Libellé" required>
          <input className={inp} style={inpS} value={familleForm.libelle}
            onChange={e => setFamilleForm(p => ({ ...p, libelle: e.target.value }))} placeholder="Fêtes Nationales" />
        </Field>
        <Field label="Description">
          <textarea className={inp} style={inpS} rows={2} value={familleForm.description || ""}
            onChange={e => setFamilleForm(p => ({ ...p, description: e.target.value || null }))} />
        </Field>
        <Field label="Couleur">
          <div className="flex flex-wrap gap-1.5 mb-2">
            {PALETTE.map(c => (
              <button key={c} type="button" onClick={() => setFamilleForm(p => ({ ...p, couleur: c }))}
                className="w-6 h-6 rounded-full border-2 transition-all"
                style={{ background: c, borderColor: familleForm.couleur === c ? "hsl(var(--foreground))" : "transparent" }} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input type="color" value={familleForm.couleur}
              onChange={e => setFamilleForm(p => ({ ...p, couleur: e.target.value }))}
              className="w-8 h-8 rounded cursor-pointer border" style={{ borderColor: "hsl(var(--border))" }} />
            <input className={inp} style={inpS} value={familleForm.couleur}
              onChange={e => setFamilleForm(p => ({ ...p, couleur: e.target.value }))} placeholder="#6366F1" maxLength={7} />
          </div>
        </Field>
        <div className="flex gap-4">
          <Field label="Ordre" className="flex-1">
            <input type="number" className={inp} style={inpS} value={familleForm.ordre ?? 0}
              onChange={e => setFamilleForm(p => ({ ...p, ordre: parseInt(e.target.value) || 0 }))} />
          </Field>
          <Field label="Statut" className="flex-1 flex items-end pb-1">
            <Toggle value={familleForm.actif} onChange={v => setFamilleForm(p => ({ ...p, actif: v }))} label={familleForm.actif ? "Active" : "Inactive"} />
          </Field>
        </div>
      </div>
      {error && <p className="text-xs mt-2 p-2 rounded-lg bg-destructive/10 text-destructive">{error}</p>}
      <div className="flex gap-2 mt-4 pt-4 border-t" style={{ borderColor: "hsl(var(--border))" }}>
        <button onClick={() => setPanel(null)} className="flex-1 px-3 py-1.5 rounded-lg border text-sm" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>Annuler</button>
        <button onClick={saveFamille} disabled={saving} className="flex-1 px-3 py-1.5 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5"
          style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Enregistrer
        </button>
      </div>
    </div>
  );

  // ── Render Panel Événement ─────────────────────────────────────────────────
  const renderPanelEvt = () => (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-5">
        <button onClick={() => setPanel(null)} className="p-1.5 rounded-lg hover:bg-muted transition-colors"><ChevronLeft size={16} /></button>
        <h3 className="font-semibold text-sm" style={{ color: "hsl(var(--foreground))" }}>
          {panel === "new_evt" ? "Nouvel événement" : "Modifier événement"}
        </h3>
      </div>
      <div className="space-y-3 flex-1">
        <Field label="Code" required>
          <input className={inp} style={inpS} value={evtForm.code} disabled={panel?.startsWith("edit_")}
            onChange={e => setEvtForm(p => ({ ...p, code: e.target.value.toUpperCase() }))} placeholder="AID_FITR" maxLength={20} />
        </Field>
        <Field label="Libellé" required>
          <input className={inp} style={inpS} value={evtForm.libelle}
            onChange={e => setEvtForm(p => ({ ...p, libelle: e.target.value }))} placeholder="Aïd Al-Fitr" />
        </Field>
        <Field label="Famille">
          <select className={inp} style={inpS} value={evtForm.code_famille || ""}
            onChange={e => setEvtForm(p => ({ ...p, code_famille: e.target.value || null }))}>
            <option value="">-- Aucune --</option>
            {familles.filter(f => f.actif).map(f => (
              <option key={f.code} value={f.code}>{f.libelle}</option>
            ))}
          </select>
        </Field>
        <Field label="Nombre de jours par défaut" required>
          <div className="flex items-center gap-2">
            <input type="number" min={1} max={30} className={inp} style={inpS} value={evtForm.nb_jours_defaut}
              onChange={e => setEvtForm(p => ({ ...p, nb_jours_defaut: Math.max(1, parseInt(e.target.value) || 1) }))} />
            <span className="text-xs whitespace-nowrap" style={{ color: "hsl(var(--muted-foreground))" }}>jour(s)</span>
          </div>
          <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
            Valeur utilisée lors de la génération d'exercice (modifiable manuellement par la suite).
          </p>
        </Field>
        <Field label="Description">
          <textarea className={inp} style={inpS} rows={2} value={evtForm.description || ""}
            onChange={e => setEvtForm(p => ({ ...p, description: e.target.value || null }))} />
        </Field>
        <div className="flex gap-4">
          <Field label="Ordre" className="flex-1">
            <input type="number" className={inp} style={inpS} value={evtForm.ordre ?? 0}
              onChange={e => setEvtForm(p => ({ ...p, ordre: parseInt(e.target.value) || 0 }))} />
          </Field>
          <Field label="Statut" className="flex-1 flex items-end pb-1">
            <Toggle value={evtForm.actif} onChange={v => setEvtForm(p => ({ ...p, actif: v }))} label={evtForm.actif ? "Actif" : "Inactif"} />
          </Field>
        </div>
      </div>
      {error && <p className="text-xs mt-2 p-2 rounded-lg bg-destructive/10 text-destructive">{error}</p>}
      <div className="flex gap-2 mt-4 pt-4 border-t" style={{ borderColor: "hsl(var(--border))" }}>
        <button onClick={() => setPanel(null)} className="flex-1 px-3 py-1.5 rounded-lg border text-sm" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>Annuler</button>
        <button onClick={saveEvenement} disabled={saving} className="flex-1 px-3 py-1.5 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5"
          style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Enregistrer
        </button>
      </div>
    </div>
  );

  // ── Render Panel Jour Férié ────────────────────────────────────────────────
  const renderPanelJour = () => {
    const dateFin = jourForm.date_debut && jourForm.nombre_jours && jourForm.nombre_jours > 1
      ? addDays(jourForm.date_debut, jourForm.nombre_jours - 1)
      : null;

    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 mb-5">
          <button onClick={() => setPanel(null)} className="p-1.5 rounded-lg hover:bg-muted transition-colors"><ChevronLeft size={16} /></button>
          <h3 className="font-semibold text-sm" style={{ color: "hsl(var(--foreground))" }}>
            {panel === "new_jour" ? "Nouveau jour férié" : "Modifier jour férié"}
          </h3>
        </div>
        <div className="space-y-3 flex-1 overflow-y-auto">
          <Field label="Exercice (Année)" required>
            <input type="number" min={2000} max={2100} className={inp} style={inpS}
              value={jourForm.annee || selectedAnnee}
              onChange={e => setJourForm(p => ({ ...p, annee: parseInt(e.target.value) || currentYear }))} />
          </Field>
          {/* RG-FERIE-FILTRE-01 (Adil DAIA) : La famille est saisie en premier pour filtrer les événements */}
          <Field label="Famille" required>
            <select className={inp} style={inpS} value={jourForm.code_famille || ""}
              onChange={e => handleFamilleJourChange(e.target.value)}>
              <option value="">-- Toutes les familles --</option>
              {familles.filter(f => f.actif).map(f => (
                <option key={f.code} value={f.code}>{f.libelle}</option>
              ))}
            </select>
          </Field>
          {/* Aperçu couleur famille */}
          {(() => {
            const familleFerie = familles.find(f => f.code === jourForm.code_famille);
            return familleFerie ? (
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs"
                style={{ background: hexToRgba(familleFerie.couleur, 0.1), color: familleFerie.couleur }}>
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: familleFerie.couleur }} />
                {familleFerie.libelle}
              </div>
            ) : null;
          })()}
          <Field label="Événement" required>
            <select className={inp} style={inpS} value={jourForm.code_evenement || ""}
              onChange={e => handleEvtChange(e.target.value)}>
              <option value="">-- Choisir un événement --</option>
              {evenements
                .filter(e => e.actif && (!jourForm.code_famille || e.code_famille === jourForm.code_famille))
                .map(e => (
                  <option key={e.code} value={e.code}>{e.libelle}</option>
                ))}
            </select>
            {jourForm.code_famille && evenements.filter(e => e.actif && e.code_famille === jourForm.code_famille).length === 0 && (
              <p className="text-xs mt-1" style={{ color: "hsl(var(--destructive))" }}>
                Aucun événement pour cette famille.
              </p>
            )}
          </Field>
          <Field label="Libellé spécifique (optionnel)">
            <input className={inp} style={inpS} value={jourForm.libelle_specifique || ""}
              onChange={e => setJourForm(p => ({ ...p, libelle_specifique: e.target.value || null }))}
              placeholder="ex: Aïd Al-Fitr 1447H" />
          </Field>
          <Field label="Date de début" required>
            <input type="date" className={inp} style={inpS} value={jourForm.date_debut || ""}
              onChange={e => setJourForm(p => ({ ...p, date_debut: e.target.value }))} />
          </Field>
          {/* RG-FERIE-MULTI-JOURS-01 (Adil DAIA): saisie du nombre de jours */}
          <Field label="Nombre de jours" required>
            <input type="number" min={1} max={30} className={inp} style={inpS}
              value={jourForm.nombre_jours || 1}
              onChange={e => setJourForm(p => ({ ...p, nombre_jours: Math.max(1, parseInt(e.target.value) || 1) }))} />
          </Field>
          {dateFin && (
            <div className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg"
              style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
              <Info size={12} />
              Date de fin : <span className="font-medium" style={{ color: "hsl(var(--foreground))" }}>{formatDateFR(dateFin)}</span>
            </div>
          )}
          <Field label="Observations">
            <textarea className={inp} style={inpS} rows={2} value={jourForm.observations || ""}
              onChange={e => setJourForm(p => ({ ...p, observations: e.target.value || null }))} />
          </Field>
          <Toggle value={jourForm.actif !== false} onChange={v => setJourForm(p => ({ ...p, actif: v }))} label={jourForm.actif !== false ? "Actif" : "Inactif"} />
        </div>
        {error && <p className="text-xs mt-2 p-2 rounded-lg bg-destructive/10 text-destructive">{error}</p>}
        <div className="flex gap-2 mt-4 pt-4 border-t" style={{ borderColor: "hsl(var(--border))" }}>
          <button onClick={() => setPanel(null)} className="flex-1 px-3 py-1.5 rounded-lg border text-sm" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>Annuler</button>
          <button onClick={saveJour} disabled={saving} className="flex-1 px-3 py-1.5 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5"
            style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Enregistrer
          </button>
        </div>
      </div>
    );
  };

  // ── Render ligne jour férié ─────────────────────────────────────────────────
  const renderJourRow = (j: JourFerie) => {
    const evt  = evenements.find(e => e.code === j.code_evenement);
    const fam  = familles.find(f => f.code === j.code_famille);
    const couleur = fam?.couleur || "#64748B";
    const dateFin = j.nombre_jours > 1 ? addDays(j.date_debut, j.nombre_jours - 1) : null;
    const hasWarning = j.observations?.includes("⚠️");

    return (
      <tr key={j.id} className="border-b transition-colors hover:bg-muted/30"
        style={{ borderColor: "hsl(var(--border))", opacity: j.actif ? 1 : 0.5 }}>
        {/* Trait couleur famille */}
        <td className="w-1 p-0">
          <div className="w-1 h-full min-h-[40px]" style={{ background: couleur }} />
        </td>
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            {hasWarning && <AlertTriangle size={12} className="text-amber-500 flex-shrink-0" />}
            <span className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>
              {j.libelle_specifique || evt?.libelle || j.code_evenement}
            </span>
          </div>
          {j.libelle_specifique && evt && (
            <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{evt.libelle}</p>
          )}
        </td>
        <td className="px-4 py-2.5">
          <span className="text-sm" style={{ color: "hsl(var(--foreground))" }}>{formatDateFR(j.date_debut)}</span>
        </td>
        <td className="px-4 py-2.5">
          {dateFin
            ? <span className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>{formatDateFR(dateFin)}</span>
            : <span className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>—</span>}
        </td>
        <td className="px-4 py-2.5 text-center">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold"
            style={{ background: hexToRgba(couleur, 0.15), color: couleur }}>
            {j.nombre_jours}
          </span>
        </td>
        <td className="px-4 py-2.5 text-right">
          <div className="flex items-center justify-end gap-1">
            <button onClick={() => openEditJour(j)} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
              <Pencil size={13} style={{ color: "hsl(var(--muted-foreground))" }} />
            </button>
            <button onClick={() => deleteJour(j.id)} className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors">
              <Trash2 size={13} style={{ color: "hsl(var(--destructive))" }} />
            </button>
          </div>
        </td>
      </tr>
    );
  };

  // ── Modale génération exercice ─────────────────────────────────────────────
  const renderGenModal = () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="rounded-xl shadow-xl p-6 w-full max-w-md" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
        <div className="flex items-center gap-2 mb-4">
          <Sparkles size={18} style={{ color: "hsl(var(--accent))" }} />
          <h3 className="font-semibold text-sm" style={{ color: "hsl(var(--foreground))" }}>Générer un nouvel exercice</h3>
        </div>

        {/* RG-FERIE-EXERCICE-01 (Adil DAIA): info génération */}
        <div className="text-xs p-3 rounded-lg mb-4 flex gap-2"
          style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
          <Info size={12} className="flex-shrink-0 mt-0.5" />
          <span>
            Les dates des fêtes fixes (Nouvel An, Fête du Trône, etc.) seront décalées d'une année.
            <br /><strong>Les fêtes religieuses mobiles (Aïd, Mawlid, etc.) devront être ajustées manuellement.</strong>
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <Field label="Copier depuis l'exercice">
            <select className={inp} style={inpS} value={genFromAnnee}
              onChange={e => setGenFromAnnee(parseInt(e.target.value))}>
              {[...Array(10)].map((_, i) => {
                const y = currentYear - i;
                const count = jours.filter(j => j.annee === y).length;
                return <option key={y} value={y}>{y}{count > 0 ? ` (${count} j)` : ""}</option>;
              })}
            </select>
          </Field>
          <Field label="Vers l'exercice">
            <select className={inp} style={inpS} value={genToAnnee}
              onChange={e => setGenToAnnee(parseInt(e.target.value))}>
              {[...Array(5)].map((_, i) => {
                const y = currentYear + i;
                const count = jours.filter(j => j.annee === y).length;
                return <option key={y} value={y}>{y}{count > 0 ? ` (${count} existants)` : " (vide)"}</option>;
              })}
            </select>
          </Field>
        </div>

        <div className="text-xs px-3 py-2 rounded-lg mb-4" style={{ background: "hsl(var(--muted))" }}>
          {jours.filter(j => j.annee === genFromAnnee && j.actif).length} événements actifs seront copiés depuis {genFromAnnee} → {genToAnnee}
        </div>

        <div className="flex gap-2">
          <button onClick={() => setShowGenModal(false)} className="flex-1 px-3 py-2 rounded-lg border text-sm"
            style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>Annuler</button>
          <button onClick={handleGenerate} disabled={genGenerating || genFromAnnee === genToAnnee}
            className="flex-1 px-3 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5"
            style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))", opacity: genFromAnnee === genToAnnee ? 0.5 : 1 }}>
            {genGenerating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            Générer
          </button>
        </div>
      </div>
    </div>
  );

  // ── Onglet Familles ────────────────────────────────────────────────────────
  const renderTabFamilles = () => (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>
          {familles.length} famille(s) de jours fériés
        </h3>
        <button onClick={openNewFamille} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
          style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
          <Plus size={13} /> Nouvelle famille
        </button>
      </div>
      <div className="rounded-xl overflow-hidden border" style={{ borderColor: "hsl(var(--border))" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "hsl(var(--muted))", borderBottom: "1px solid hsl(var(--border))" }}>
              <th className="px-4 py-2.5 text-left text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Famille</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Couleur</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Événements</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Statut</th>
              <th className="px-4 py-2.5 w-20" />
            </tr>
          </thead>
          <tbody>
            {familles.map(f => {
              const evtCount = evenements.filter(e => e.code_famille === f.code).length;
              return (
                <tr key={f.code} className="border-b transition-colors hover:bg-muted/30"
                  style={{ borderColor: "hsl(var(--border))" }}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: f.couleur }} />
                      <div>
                        <p className="font-medium text-sm" style={{ color: "hsl(var(--foreground))" }}>{f.libelle}</p>
                        <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{f.code}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded border" style={{ background: f.couleur, borderColor: "hsl(var(--border))" }} />
                      <span className="text-xs font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>{f.couleur}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-sm" style={{ color: "hsl(var(--foreground))" }}>{evtCount}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${f.actif ? "text-green-700 bg-green-100" : "text-gray-500 bg-gray-100"}`}>
                      {f.actif ? "Actif" : "Inactif"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEditFamille(f)} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                        <Pencil size={13} style={{ color: "hsl(var(--muted-foreground))" }} />
                      </button>
                      <button onClick={() => deleteFamille(f.code)} className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors">
                        <Trash2 size={13} style={{ color: "hsl(var(--destructive))" }} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  // ── Onglet Événements ──────────────────────────────────────────────────────
  const renderTabEvenements = () => (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>
          {evenements.length} événement(s) défini(s)
        </h3>
        <button onClick={openNewEvt} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
          style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
          <Plus size={13} /> Nouvel événement
        </button>
      </div>
      <div className="rounded-xl overflow-hidden border" style={{ borderColor: "hsl(var(--border))" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "hsl(var(--muted))", borderBottom: "1px solid hsl(var(--border))" }}>
              <th className="px-4 py-2.5 text-left text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Événement</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Famille</th>
              <th className="px-4 py-2.5 text-center text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Jours déf.</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Statut</th>
              <th className="px-4 py-2.5 w-20" />
            </tr>
          </thead>
          <tbody>
            {evenements.map(e => {
              const fam = familles.find(f => f.code === e.code_famille);
              return (
                <tr key={e.code} className="border-b transition-colors hover:bg-muted/30"
                  style={{ borderColor: "hsl(var(--border))", opacity: e.actif ? 1 : 0.5 }}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      {fam && <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: fam.couleur }} />}
                      <div>
                        <p className="font-medium text-sm" style={{ color: "hsl(var(--foreground))" }}>{e.libelle}</p>
                        <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{e.code}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    {fam
                      ? <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ background: hexToRgba(fam.couleur, 0.12), color: fam.couleur }}>
                          {fam.libelle}
                        </span>
                      : <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>{e.nb_jours_defaut}j</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${e.actif ? "text-green-700 bg-green-100" : "text-gray-500 bg-gray-100"}`}>
                      {e.actif ? "Actif" : "Inactif"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEditEvt(e)} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                        <Pencil size={13} style={{ color: "hsl(var(--muted-foreground))" }} />
                      </button>
                      <button onClick={() => deleteEvenement(e.code)} className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors">
                        <Trash2 size={13} style={{ color: "hsl(var(--destructive))" }} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  // ── Onglet Calendrier (exercice) ───────────────────────────────────────────
  const renderTabCalendrier = () => (
    <div>
      {/* Barre exercice */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Sélecteur d'année */}
        <div className="flex items-center gap-1.5">
          <button onClick={() => setSelectedAnnee(a => a - 1)}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"><ChevronLeft size={14} /></button>
          <select className="px-2 py-1 rounded-lg border text-sm font-semibold"
            style={inpS} value={selectedAnnee} onChange={e => setSelectedAnnee(parseInt(e.target.value))}>
            {[...new Set([...anneesDisponibles, currentYear, currentYear+1])].sort((a,b)=>b-a).map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button onClick={() => setSelectedAnnee(a => a + 1)}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"><ChevronRight size={14} /></button>
        </div>

        {/* Stats exercice */}
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium"
          style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
          <CalendarDays size={12} />
          {joursAnnee.length} événements · {totalJours} jour(s)
        </div>

        {/* Filtres famille */}
        <div className="flex gap-1 flex-wrap">
          <button onClick={() => setFilterFamille("all")}
            className="px-2.5 py-1 rounded-full text-xs font-medium transition-colors"
            style={{
              background: filterFamille === "all" ? "hsl(var(--primary))" : "hsl(var(--muted))",
              color: filterFamille === "all" ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))",
            }}>Tous</button>
          {familles.filter(f => f.actif).map(f => (
            <button key={f.code} onClick={() => setFilterFamille(f.code)}
              className="px-2.5 py-1 rounded-full text-xs font-medium transition-colors"
              style={{
                background: filterFamille === f.code ? hexToRgba(f.couleur, 0.9) : hexToRgba(f.couleur, 0.1),
                color: filterFamille === f.code ? "#fff" : f.couleur,
              }}>{f.libelle}</button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Recherche */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
            <input className="pl-8 pr-3 py-1.5 rounded-lg border text-xs w-40" style={inpS}
              placeholder="Rechercher…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {/* Générer exercice */}
          <button onClick={() => { setGenFromAnnee(selectedAnnee - 1); setGenToAnnee(selectedAnnee + 1); setShowGenModal(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: "hsl(var(--accent))", color: "hsl(var(--accent-foreground))" }}>
            <Sparkles size={13} /> Générer exercice
          </button>
          {/* Ajouter */}
          <button onClick={openNewJour} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
            <Plus size={13} /> Ajouter
          </button>
        </div>
      </div>

      {/* Tableau groupé par famille */}
      {joursFiltered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center rounded-xl border"
          style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
          <CalendarDays size={36} className="mb-3 opacity-30" />
          <p className="text-sm font-medium">Aucun jour férié pour l'exercice {selectedAnnee}</p>
          <p className="text-xs mt-1">Ajoutez des jours fériés ou générez l'exercice depuis une année existante.</p>
          <button onClick={() => { setGenFromAnnee(selectedAnnee - 1); setGenToAnnee(selectedAnnee); setShowGenModal(true); }}
            className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium"
            style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
            <Sparkles size={13} /> Générer depuis {selectedAnnee - 1}
          </button>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden border" style={{ borderColor: "hsl(var(--border))" }}>
          {familles.filter(f => joursByFamille[f.code]?.length > 0).map(fam => {
            const isExpanded = expandedFamilles.has(fam.code);
            const items = joursByFamille[fam.code] || [];
            const totalF = items.reduce((s, j) => s + j.nombre_jours, 0);

            return (
              <div key={fam.code}>
                {/* En-tête famille */}
                <button
                  onClick={() => setExpandedFamilles(prev => {
                    const next = new Set(prev);
                    isExpanded ? next.delete(fam.code) : next.add(fam.code);
                    return next;
                  })}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:opacity-90"
                  style={{ background: hexToRgba(fam.couleur, 0.12), borderBottom: "1px solid hsl(var(--border))" }}>
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: fam.couleur }} />
                  <span className="text-sm font-semibold flex-1" style={{ color: fam.couleur }}>{fam.libelle}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ background: hexToRgba(fam.couleur, 0.2), color: fam.couleur }}>
                    {items.length} événement{items.length > 1 ? "s" : ""} · {totalF} jour{totalF > 1 ? "s" : ""}
                  </span>
                  {isExpanded ? <ChevronDown size={14} style={{ color: fam.couleur }} /> : <ChevronRight size={14} style={{ color: fam.couleur }} />}
                </button>

                {isExpanded && (
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: "hsl(var(--muted))", borderBottom: "1px solid hsl(var(--border))" }}>
                        <th className="w-1 p-0" />
                        <th className="px-4 py-2 text-left text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Événement</th>
                        <th className="px-4 py-2 text-left text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Date début</th>
                        <th className="px-4 py-2 text-left text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Date fin</th>
                        <th className="px-4 py-2 text-center text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Nbre jours</th>
                        <th className="px-4 py-2 w-20" />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(j => renderJourRow(j))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // ── Render principal ───────────────────────────────────────────────────────
  return (
    <div className="flex gap-0 h-full min-h-0 overflow-hidden" style={{ background: "hsl(var(--background))" }}>
      {/* Zone principale */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Fil d'Ariane */}
        <div className="flex items-center gap-1.5 px-6 pt-4 pb-0 text-[13px] flex-shrink-0" style={{ color: "hsl(var(--muted-foreground))" }}>
          <span>Référentiels</span>
          <span style={{ opacity: 0.5 }}>/</span>
          <span className="font-semibold" style={{ color: "hsl(var(--foreground))" }}>Jours Fériés</span>
        </div>

        {/* En-tête */}
        <div className="px-6 pt-3 pb-4 flex-shrink-0">
          <div className="flex items-center gap-3 mb-1">
            <CalendarDays size={20} style={{ color: "hsl(var(--primary))" }} />
            <h1 className="text-lg font-bold" style={{ color: "hsl(var(--foreground))" }}>Jours Fériés</h1>
          </div>
          <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
            Paramétrage des jours fériés par exercice — RG-FERIE-STRUCT-01 (Adil DAIA)
          </p>

          {/* Onglets */}
          <div className="flex gap-1 mt-4 border-b" style={{ borderColor: "hsl(var(--border))" }}>
            {([
              { key: "calendrier", label: "Calendrier", icon: Calendar },
              { key: "evenements", label: "Événements", icon: FolderOpen },
              { key: "familles",   label: "Familles",   icon: Palette },
            ] as const).map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 transition-colors -mb-px"
                style={{
                  borderBottomColor: activeTab === tab.key ? "hsl(var(--primary))" : "transparent",
                  color: activeTab === tab.key ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                }}>
                <tab.icon size={13} /> {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Contenu */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={24} className="animate-spin" style={{ color: "hsl(var(--accent))" }} />
            </div>
          ) : (
            <>
              {activeTab === "calendrier"  && renderTabCalendrier()}
              {activeTab === "evenements"  && renderTabEvenements()}
              {activeTab === "familles"    && renderTabFamilles()}
            </>
          )}
        </div>
      </div>

      {/* Panel latéral */}
      {isPanel && (
        <div className="w-72 flex-shrink-0 border-l overflow-y-auto p-4"
          style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
          {(panel === "new_famille" || panel?.startsWith("edit_famille:")) && renderPanelFamille()}
          {(panel === "new_evt"     || panel?.startsWith("edit_evt:"))     && renderPanelEvt()}
          {(panel === "new_jour"    || panel?.startsWith("edit_jour:"))    && renderPanelJour()}
        </div>
      )}

      {/* Modale génération */}
      {showGenModal && renderGenModal()}
    </div>
  );
};

export default JoursFeriesPage;
