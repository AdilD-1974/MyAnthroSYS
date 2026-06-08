/**
 * MouvementsPage.tsx — Mouvements internes
 *
 * Filtres enrichis :
 * RG-MVT-FILTRE-01 : Filtre statut multi-choix
 * RG-MVT-FILTRE-02 : Filtre type multi-choix
 * RG-MVT-FILTRE-03 : Filtre période avec modes :
 *   - Plage libre (date début → date fin)
 *   - Mois (sélecteur mois/année)
 *   - Trimestre (T1/T2/T3/T4 + année)
 *   - Semestre (S1/S2 + année)
 *   - Année complète
 * RG-MVT-FILTRE-04 : Filtre nature (Temporaire / Définitif)
 * RG-MVT-FILTRE-05 : Filtre organisation (unité organisationnelle)
 */
import React, { useEffect, useState, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import {
  ArrowRightLeft, Search, AlertCircle, ExternalLink, Plus, X,
  ChevronDown, Check, Calendar, Filter, RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import MouvementForm from "@/components/mouvement/MouvementForm";

interface MouvementRow {
  id: string;
  collaborateur_id: string;
  code_type_mouvement: string;
  date_effet: string;
  date_fin_prevue: string | null;
  date_fin_effective: string | null;
  ancien_poste: string | null;
  nouveau_poste: string | null;
  ancienne_unite_id: string | null;
  nouvelle_unite_id: string | null;
  reference_decision: string | null;
  statut: string;
  commentaire: string | null;
}

// ── Types de période ──────────────────────────────────────────────────────────
type ModePeriode = "TOUS" | "PLAGE" | "MOIS" | "TRIMESTRE" | "SEMESTRE" | "ANNEE";

const MOIS_LABELS = ["Janv.","Févr.","Mars","Avr.","Mai","Juin","Juil.","Août","Sept.","Oct.","Nov.","Déc."];
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 8 }, (_, i) => CURRENT_YEAR - 3 + i);

// ── Composant MultiSelect ─────────────────────────────────────────────────────
interface MultiSelectProps {
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  allLabel?: string;
}
const MultiSelect: React.FC<MultiSelectProps> = ({ options, selected, onChange, placeholder, allLabel = "Tous" }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (v: string) => {
    if (v === "ALL") { onChange([]); return; }
    onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
  };

  const label = selected.length === 0
    ? allLabel
    : selected.length === 1
      ? options.find(o => o.value === selected[0])?.label || selected[0]
      : `${selected.length} sélectionnés`;

  return (
    <div ref={ref} className="relative" style={{ minWidth: 160 }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium"
        style={{
          border: "1px solid hsl(var(--border))",
          background: selected.length > 0 ? "hsl(var(--primary)/0.06)" : "hsl(var(--background))",
          color: selected.length > 0 ? "hsl(var(--primary))" : "hsl(var(--foreground))",
          borderColor: selected.length > 0 ? "hsl(var(--primary)/0.3)" : "hsl(var(--border))",
        }}>
        {label}
        <ChevronDown size={12} style={{ opacity: 0.6, marginLeft: "auto" }} />
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 rounded-xl border shadow-xl overflow-hidden"
          style={{ background: "hsl(var(--popover))", borderColor: "hsl(var(--border))", minWidth: 200, maxHeight: 280, overflowY: "auto" }}>
          {/* Tout sélectionner */}
          <button onClick={() => toggle("ALL")}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent/10 border-b"
            style={{ borderColor: "hsl(var(--border))", color: selected.length === 0 ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }}>
            <div className="w-4 h-4 rounded border flex items-center justify-center flex-shrink-0"
              style={{ background: selected.length === 0 ? "hsl(var(--primary))" : "transparent", borderColor: selected.length === 0 ? "hsl(var(--primary))" : "hsl(var(--border))" }}>
              {selected.length === 0 && <Check size={10} color="white" />}
            </div>
            {allLabel}
          </button>
          {options.map(o => (
            <button key={o.value} onClick={() => toggle(o.value)}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent/10"
              style={{ color: "hsl(var(--foreground))" }}>
              <div className="w-4 h-4 rounded border flex items-center justify-center flex-shrink-0"
                style={{ background: selected.includes(o.value) ? "hsl(var(--primary))" : "transparent", borderColor: selected.includes(o.value) ? "hsl(var(--primary))" : "hsl(var(--border))" }}>
                {selected.includes(o.value) && <Check size={10} color="white" />}
              </div>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Composant FiltrePériode ───────────────────────────────────────────────────
interface FiltrePeriodeProps {
  mode: ModePeriode;
  onModeChange: (m: ModePeriode) => void;
  plageDebut: string; onPlageDebutChange: (v: string) => void;
  plageFin: string; onPlageFinChange: (v: string) => void;
  mois: number; onMoisChange: (v: number) => void;
  trimestre: number; onTrimestreChange: (v: number) => void;
  semestre: number; onSemestreChange: (v: number) => void;
  annee: number; onAnneeChange: (v: number) => void;
}
const FiltrePeriode: React.FC<FiltrePeriodeProps> = (p) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const modeLabel: Record<ModePeriode, string> = {
    TOUS: "Toutes périodes", PLAGE: "Plage personnalisée",
    MOIS: `${MOIS_LABELS[p.mois]} ${p.annee}`,
    TRIMESTRE: `T${p.trimestre} ${p.annee}`,
    SEMESTRE: `S${p.semestre} ${p.annee}`,
    ANNEE: `Année ${p.annee}`,
  };

  const isActive = p.mode !== "TOUS";
  const inputCls = "px-2 py-1 rounded-lg border text-xs";
  const inputSty: React.CSSProperties = { border: "1px solid hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" };

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium"
        style={{
          border: "1px solid hsl(var(--border))",
          background: isActive ? "hsl(var(--primary)/0.06)" : "hsl(var(--background))",
          color: isActive ? "hsl(var(--primary))" : "hsl(var(--foreground))",
          borderColor: isActive ? "hsl(var(--primary)/0.3)" : "hsl(var(--border))",
        }}>
        <Calendar size={12} />
        {modeLabel[p.mode]}
        <ChevronDown size={12} style={{ opacity: 0.6 }} />
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 rounded-xl border shadow-xl p-4"
          style={{ background: "hsl(var(--popover))", borderColor: "hsl(var(--border))", minWidth: 320 }}>
          {/* Mode selector */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {(["TOUS","PLAGE","MOIS","TRIMESTRE","SEMESTRE","ANNEE"] as ModePeriode[]).map(m => (
              <button key={m} onClick={() => p.onModeChange(m)}
                className="px-2.5 py-1 rounded-full text-[11px] font-medium transition-all"
                style={{
                  background: p.mode === m ? "hsl(var(--primary))" : "hsl(var(--muted)/0.5)",
                  color: p.mode === m ? "white" : "hsl(var(--foreground))",
                }}>
                {m === "TOUS" ? "Toutes" : m === "PLAGE" ? "Plage" : m === "MOIS" ? "Mois" : m === "TRIMESTRE" ? "Trimestre" : m === "SEMESTRE" ? "Semestre" : "Année"}
              </button>
            ))}
          </div>

          {/* Année (commune à MOIS, TRIMESTRE, SEMESTRE, ANNEE) */}
          {p.mode !== "TOUS" && p.mode !== "PLAGE" && (
            <div className="mb-3">
              <label className="text-[10px] font-semibold uppercase tracking-wide mb-1 block" style={{ color: "hsl(var(--muted-foreground))" }}>Année</label>
              <div className="flex flex-wrap gap-1">
                {YEARS.map(y => (
                  <button key={y} onClick={() => p.onAnneeChange(y)}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium"
                    style={{ background: p.annee === y ? "hsl(var(--primary))" : "hsl(var(--muted)/0.4)", color: p.annee === y ? "white" : "hsl(var(--foreground))" }}>
                    {y}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Mois */}
          {p.mode === "MOIS" && (
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wide mb-1 block" style={{ color: "hsl(var(--muted-foreground))" }}>Mois</label>
              <div className="grid grid-cols-4 gap-1">
                {MOIS_LABELS.map((m, i) => (
                  <button key={i} onClick={() => p.onMoisChange(i)}
                    className="px-2 py-1 rounded-lg text-[11px] font-medium"
                    style={{ background: p.mois === i ? "hsl(var(--primary))" : "hsl(var(--muted)/0.4)", color: p.mois === i ? "white" : "hsl(var(--foreground))" }}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Trimestre */}
          {p.mode === "TRIMESTRE" && (
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wide mb-1 block" style={{ color: "hsl(var(--muted-foreground))" }}>Trimestre</label>
              <div className="flex gap-2">
                {[1,2,3,4].map(t => (
                  <button key={t} onClick={() => p.onTrimestreChange(t)}
                    className="flex-1 py-2 rounded-lg text-xs font-bold"
                    style={{ background: p.trimestre === t ? "hsl(var(--primary))" : "hsl(var(--muted)/0.4)", color: p.trimestre === t ? "white" : "hsl(var(--foreground))" }}>
                    T{t}
                  </button>
                ))}
              </div>
              <p className="text-[10px] mt-1.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                {p.trimestre === 1 ? "Jan–Mar" : p.trimestre === 2 ? "Avr–Juin" : p.trimestre === 3 ? "Juil–Sept" : "Oct–Déc"} {p.annee}
              </p>
            </div>
          )}

          {/* Semestre */}
          {p.mode === "SEMESTRE" && (
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wide mb-1 block" style={{ color: "hsl(var(--muted-foreground))" }}>Semestre</label>
              <div className="flex gap-2">
                {[1,2].map(s => (
                  <button key={s} onClick={() => p.onSemestreChange(s)}
                    className="flex-1 py-2 rounded-lg text-sm font-bold"
                    style={{ background: p.semestre === s ? "hsl(var(--primary))" : "hsl(var(--muted)/0.4)", color: p.semestre === s ? "white" : "hsl(var(--foreground))" }}>
                    S{s}
                  </button>
                ))}
              </div>
              <p className="text-[10px] mt-1.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                {p.semestre === 1 ? "Janv–Juin" : "Juil–Déc"} {p.annee}
              </p>
            </div>
          )}

          {/* Plage */}
          {p.mode === "PLAGE" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wide mb-1 block" style={{ color: "hsl(var(--muted-foreground))" }}>Du</label>
                <input type="date" className={inputCls} style={{ ...inputSty, width: "100%" }}
                  value={p.plageDebut} onChange={e => p.onPlageDebutChange(e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wide mb-1 block" style={{ color: "hsl(var(--muted-foreground))" }}>Au</label>
                <input type="date" className={inputCls} style={{ ...inputSty, width: "100%" }}
                  value={p.plageFin} onChange={e => p.onPlageFinChange(e.target.value)} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Page principale ───────────────────────────────────────────────────────────
const MouvementsPage: React.FC = () => {
  const [rows, setRows] = useState<MouvementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Filtres multi-choix
  const [filterStatuts, setFilterStatuts] = useState<string[]>([]);
  const [filterTypes, setFilterTypes] = useState<string[]>([]);
  const [filterNature, setFilterNature] = useState<string[]>([]);
  const [filterUOs, setFilterUOs] = useState<string[]>([]);

  // Filtre période
  const [modePeriode, setModePeriode] = useState<ModePeriode>("TOUS");
  const [plageDebut, setPlageDebut] = useState("");
  const [plageFin, setPlageFin] = useState("");
  const [moisFiltre, setMoisFiltre] = useState(new Date().getMonth());
  const [trimestreFiltre, setTrimestreFiltre] = useState(Math.ceil((new Date().getMonth() + 1) / 3));
  const [semestreFiltre, setSemestreFiltre] = useState(new Date().getMonth() < 6 ? 1 : 2);
  const [anneeFiltre, setAnneeFiltre] = useState(CURRENT_YEAR);

  const [collabMap, setCollabMap] = useState<Record<string, { nom: string; prenom: string; matricule: string }>>({});
  const [typeMap, setTypeMap] = useState<Record<string, { libelle: string; est_temporaire: boolean; est_definitif: boolean }>>({});
  const [uoMap, setUoMap] = useState<Record<string, string>>({});
  const [posteMap, setPosteMap] = useState<Record<string, string>>({});
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [selectedCollabId, setSelectedCollabId] = useState<string | null>(null);
  const [collabSearch, setCollabSearch] = useState("");
  const [collabList, setCollabList] = useState<{ id: string; nom: string; prenom: string; matricule: string }[]>([]);
  const navigate = useNavigate();

  const loadAll = async () => {
    setLoading(true);
    const [mvts, collabs, types, uos, postes] = await Promise.all([
      supabase.from("collaborateur_mouvements" as any).select("*").eq("archive", false).order("date_effet", { ascending: false }),
      supabase.from("collaborateurs").select("id, nom, prenom, matricule, statut_collaborateur").eq("archive", false),
      supabase.from("ref_type_mouvement" as any).select("code, libelle, est_temporaire, est_definitif"),
      supabase.from("unites_organisationnelles" as any).select("id, libelle"),
      supabase.from("ref_poste" as any).select("code, libelle"),
    ]);
    setRows((mvts.data as any[]) || []);
    const collabArr = ((collabs.data as any[]) || []).filter((c: any) => c.statut_collaborateur !== "SORTI");
    const cm: Record<string, { nom: string; prenom: string; matricule: string }> = {};
    collabArr.forEach((c: any) => { cm[c.id] = { nom: c.nom, prenom: c.prenom, matricule: c.matricule }; });
    setCollabMap(cm);
    setCollabList(collabArr.map((c: any) => ({ id: c.id, nom: c.nom, prenom: c.prenom, matricule: c.matricule })));
    const tm: Record<string, { libelle: string; est_temporaire: boolean; est_definitif: boolean }> = {};
    ((types.data as any[]) || []).forEach((t: any) => { tm[t.code] = { libelle: t.libelle, est_temporaire: t.est_temporaire, est_definitif: !!t.est_definitif }; });
    setTypeMap(tm);
    const um: Record<string, string> = {};
    ((uos.data as any[]) || []).forEach((u: any) => { um[u.id] = u.libelle; });
    setUoMap(um);
    const pm: Record<string, string> = {};
    ((postes.data as any[]) || []).forEach((p: any) => { pm[p.code] = p.libelle; });
    setPosteMap(pm);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  // ── Calcul plage de dates selon mode ────────────────────────────────────────
  const periodRange = useMemo((): { debut: Date | null; fin: Date | null } => {
    if (modePeriode === "TOUS") return { debut: null, fin: null };
    if (modePeriode === "PLAGE") return {
      debut: plageDebut ? new Date(plageDebut) : null,
      fin: plageFin ? new Date(plageFin) : null,
    };
    if (modePeriode === "MOIS") return {
      debut: new Date(anneeFiltre, moisFiltre, 1),
      fin: new Date(anneeFiltre, moisFiltre + 1, 0),
    };
    if (modePeriode === "TRIMESTRE") {
      const startM = (trimestreFiltre - 1) * 3;
      return { debut: new Date(anneeFiltre, startM, 1), fin: new Date(anneeFiltre, startM + 3, 0) };
    }
    if (modePeriode === "SEMESTRE") {
      const startM = (semestreFiltre - 1) * 6;
      return { debut: new Date(anneeFiltre, startM, 1), fin: new Date(anneeFiltre, startM + 6, 0) };
    }
    if (modePeriode === "ANNEE") return {
      debut: new Date(anneeFiltre, 0, 1),
      fin: new Date(anneeFiltre, 11, 31),
    };
    return { debut: null, fin: null };
  }, [modePeriode, plageDebut, plageFin, moisFiltre, trimestreFiltre, semestreFiltre, anneeFiltre]);

  // ── Filtrage ─────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => rows.filter(r => {
    // Statuts multi-choix
    if (filterStatuts.length > 0 && !filterStatuts.includes(r.statut)) return false;
    // Types multi-choix
    if (filterTypes.length > 0 && !filterTypes.includes(r.code_type_mouvement)) return false;
    // Nature (Temporaire/Définitif) multi-choix
    if (filterNature.length > 0) {
      const tm = typeMap[r.code_type_mouvement];
      const isTemp = tm?.est_temporaire;
      const isDef = tm?.est_definitif;
      const match = filterNature.some(n => (n === "TEMP" && isTemp) || (n === "DEF" && isDef));
      if (!match) return false;
    }
    // UOs multi-choix
    if (filterUOs.length > 0) {
      if (!filterUOs.includes(r.ancienne_unite_id || "") && !filterUOs.includes(r.nouvelle_unite_id || "")) return false;
    }
    // Période
    if (periodRange.debut || periodRange.fin) {
      const d = r.date_effet ? new Date(r.date_effet) : null;
      if (!d) return false;
      if (periodRange.debut && d < periodRange.debut) return false;
      if (periodRange.fin && d > periodRange.fin) return false;
    }
    // Recherche texte
    if (search) {
      const c = collabMap[r.collaborateur_id];
      const txt = `${c?.nom || ""} ${c?.prenom || ""} ${c?.matricule || ""} ${typeMap[r.code_type_mouvement]?.libelle || ""} ${r.nouveau_poste || ""} ${r.ancien_poste || ""}`.toLowerCase();
      if (!txt.includes(search.toLowerCase())) return false;
    }
    return true;
  }), [rows, filterStatuts, filterTypes, filterNature, filterUOs, periodRange, search, collabMap, typeMap]);

  const alertes = rows.filter(r => {
    if (r.statut !== "ACTIF" || !typeMap[r.code_type_mouvement]?.est_temporaire) return false;
    if (!r.date_fin_prevue) return true;
    const diff = (new Date(r.date_fin_prevue).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return diff <= 30;
  });

  const hasActiveFilters = filterStatuts.length > 0 || filterTypes.length > 0 || filterNature.length > 0 || filterUOs.length > 0 || modePeriode !== "TOUS" || search;

  const resetFilters = () => {
    setFilterStatuts([]); setFilterTypes([]); setFilterNature([]); setFilterUOs([]);
    setModePeriode("TOUS"); setSearch(""); setPlageDebut(""); setPlageFin("");
  };

  const statutBadge = (s: string) => {
    const colors: Record<string, { bg: string; text: string }> = {
      ACTIF: { bg: "hsl(142 70% 45% / 0.12)", text: "hsl(142 70% 30%)" },
      CLOTURE: { bg: "hsl(220 15% 50% / 0.12)", text: "hsl(220 15% 40%)" },
      ANNULE: { bg: "hsl(0 70% 50% / 0.12)", text: "hsl(0 70% 35%)" },
    };
    const c = colors[s] || colors.ACTIF;
    return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: c.bg, color: c.text }}>{s}</span>;
  };

  const uoOptions = useMemo(() =>
    Object.entries(uoMap).map(([id, libelle]) => ({ value: id, label: libelle }))
  , [uoMap]);

  const typeOptions = useMemo(() =>
    Object.entries(typeMap).map(([code, { libelle }]) => ({ value: code, label: libelle }))
  , [typeMap]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "hsl(var(--accent) / 0.12)" }}>
            <ArrowRightLeft size={20} style={{ color: "hsl(var(--accent))" }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: "hsl(var(--foreground))" }}>Mouvements internes</h1>
            <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
              {filtered.length} mouvement(s) — {alertes.length} alerte(s)
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => { setShowNewDialog(true); setSelectedCollabId(null); setCollabSearch(""); }}>
          <Plus size={15} className="mr-1" /> Nouveau mouvement
        </Button>
      </div>

      {/* Dialog nouveau mouvement */}
      <Dialog open={showNewDialog} onOpenChange={(open) => { if (!open) { setShowNewDialog(false); setSelectedCollabId(null); loadAll(); } }}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Nouveau mouvement interne</DialogTitle></DialogHeader>
          {!selectedCollabId ? (
            <div>
              <p className="text-sm text-muted-foreground mb-3">Sélectionnez un collaborateur :</p>
              <div className="relative mb-3">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input className="w-full pl-9 pr-3 py-2 rounded-lg border border-input bg-background text-sm"
                  placeholder="Rechercher par nom, prénom ou matricule…"
                  value={collabSearch} onChange={e => setCollabSearch(e.target.value)} autoFocus />
              </div>
              <div className="max-h-60 overflow-y-auto space-y-1">
                {collabList.filter(c => !collabSearch || `${c.nom} ${c.prenom} ${c.matricule}`.toLowerCase().includes(collabSearch.toLowerCase())).slice(0, 50).map(c => (
                  <button key={c.id} className="w-full text-left px-3 py-2 rounded-lg hover:bg-accent/10 text-sm flex justify-between items-center"
                    onClick={() => setSelectedCollabId(c.id)}>
                    <span className="font-medium">{c.prenom} {c.nom}</span>
                    <span className="text-xs text-muted-foreground">{c.matricule}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Button variant="ghost" size="sm" onClick={() => setSelectedCollabId(null)}>
                  <X size={14} className="mr-1" /> Changer de collaborateur
                </Button>
                <span className="text-sm font-medium">
                  {collabMap[selectedCollabId]?.prenom} {collabMap[selectedCollabId]?.nom} — {collabMap[selectedCollabId]?.matricule}
                </span>
              </div>
              <MouvementForm collaborateurId={selectedCollabId} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Alertes */}
      {alertes.length > 0 && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-xl mb-4" style={{ background: "hsl(45 100% 50% / 0.10)", border: "1px solid hsl(45 100% 50% / 0.25)" }}>
          <AlertCircle size={15} style={{ color: "hsl(45 100% 30%)", flexShrink: 0, marginTop: 2 }} />
          <div>
            <p className="text-xs font-semibold" style={{ color: "hsl(45 100% 30%)" }}>
              {alertes.length} mouvement(s) temporaire(s) nécessitant une action
            </p>
            {alertes.slice(0, 5).map(a => {
              const c = collabMap[a.collaborateur_id];
              return (
                <p key={a.id} className="text-[11px] mt-0.5" style={{ color: "hsl(45 100% 25%)" }}>
                  • {c ? `${c.prenom} ${c.nom}` : "—"} — {typeMap[a.code_type_mouvement]?.libelle}
                  {a.date_fin_prevue ? ` (fin prévue ${new Date(a.date_fin_prevue).toLocaleDateString("fr-FR")})` : " (pas de date de fin)"}
                </p>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Filtres enrichis ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border p-3 mb-4 space-y-3" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted)/0.15)" }}>
        {/* Ligne 1 : recherche + reset */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
            <input
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border text-xs"
              style={{ border: "1px solid hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
              placeholder="Rechercher collaborateur, type, poste…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {hasActiveFilters && (
            <button onClick={resetFilters}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{ background: "hsl(0 70% 50% / 0.08)", color: "hsl(0 70% 40%)", border: "1px solid hsl(0 70% 50% / 0.2)" }}>
              <RotateCcw size={11} /> Réinitialiser
            </button>
          )}
          <div className="flex items-center gap-1 ml-auto">
            <Filter size={12} style={{ color: "hsl(var(--muted-foreground))" }} />
            <span className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>
              {filtered.length} résultat{filtered.length > 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {/* Ligne 2 : filtres dropdown */}
        <div className="flex flex-wrap gap-2 items-center">
          {/* Statut multi-choix */}
          <MultiSelect
            options={[
              { value: "ACTIF", label: "Actif" },
              { value: "CLOTURE", label: "Clôturé" },
              { value: "ANNULE", label: "Annulé" },
            ]}
            selected={filterStatuts}
            onChange={setFilterStatuts}
            placeholder="Statut"
            allLabel="Tous les statuts"
          />

          {/* Type multi-choix */}
          <MultiSelect
            options={typeOptions}
            selected={filterTypes}
            onChange={setFilterTypes}
            placeholder="Type"
            allLabel="Tous les types"
          />

          {/* Nature multi-choix */}
          <MultiSelect
            options={[
              { value: "TEMP", label: "Temporaire" },
              { value: "DEF", label: "Définitif" },
            ]}
            selected={filterNature}
            onChange={setFilterNature}
            placeholder="Nature"
            allLabel="Toutes natures"
          />

          {/* UO multi-choix */}
          {uoOptions.length > 0 && (
            <MultiSelect
              options={uoOptions}
              selected={filterUOs}
              onChange={setFilterUOs}
              placeholder="Unité org."
              allLabel="Toutes les UO"
            />
          )}

          {/* Filtre période */}
          <FiltrePeriode
            mode={modePeriode} onModeChange={setModePeriode}
            plageDebut={plageDebut} onPlageDebutChange={setPlageDebut}
            plageFin={plageFin} onPlageFinChange={setPlageFin}
            mois={moisFiltre} onMoisChange={setMoisFiltre}
            trimestre={trimestreFiltre} onTrimestreChange={setTrimestreFiltre}
            semestre={semestreFiltre} onSemestreChange={setSemestreFiltre}
            annee={anneeFiltre} onAnneeChange={setAnneeFiltre}
          />
        </div>

        {/* Tags des filtres actifs */}
        {hasActiveFilters && (
          <div className="flex flex-wrap gap-1.5 pt-1 border-t" style={{ borderColor: "hsl(var(--border))" }}>
            {filterStatuts.map(s => (
              <span key={s} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                style={{ background: "hsl(var(--primary)/0.1)", color: "hsl(var(--primary))", border: "1px solid hsl(var(--primary)/0.2)" }}>
                {s} <button onClick={() => setFilterStatuts(f => f.filter(x => x !== s))}><X size={9} /></button>
              </span>
            ))}
            {filterTypes.map(t => (
              <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                style={{ background: "hsl(var(--primary)/0.1)", color: "hsl(var(--primary))", border: "1px solid hsl(var(--primary)/0.2)" }}>
                {typeMap[t]?.libelle || t} <button onClick={() => setFilterTypes(f => f.filter(x => x !== t))}><X size={9} /></button>
              </span>
            ))}
            {filterNature.map(n => (
              <span key={n} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                style={{ background: "hsl(var(--primary)/0.1)", color: "hsl(var(--primary))", border: "1px solid hsl(var(--primary)/0.2)" }}>
                {n === "TEMP" ? "Temporaire" : "Définitif"} <button onClick={() => setFilterNature(f => f.filter(x => x !== n))}><X size={9} /></button>
              </span>
            ))}
            {modePeriode !== "TOUS" && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                style={{ background: "hsl(210 70% 50% / 0.1)", color: "hsl(210 70% 40%)", border: "1px solid hsl(210 70% 50% / 0.2)" }}>
                <Calendar size={9} />
                {modePeriode === "MOIS" ? `${MOIS_LABELS[moisFiltre]} ${anneeFiltre}` :
                 modePeriode === "TRIMESTRE" ? `T${trimestreFiltre} ${anneeFiltre}` :
                 modePeriode === "SEMESTRE" ? `S${semestreFiltre} ${anneeFiltre}` :
                 modePeriode === "ANNEE" ? `${anneeFiltre}` :
                 `${plageDebut} → ${plageFin}`}
                <button onClick={() => setModePeriode("TOUS")}><X size={9} /></button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-center text-sm text-muted-foreground py-12">Chargement…</p>
      ) : filtered.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-12">Aucun mouvement trouvé</p>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: "hsl(var(--muted) / 0.3)" }}>
                  <th className="text-left px-3 py-2.5 font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>Collaborateur</th>
                  <th className="text-left px-3 py-2.5 font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>Type</th>
                  <th className="text-left px-3 py-2.5 font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>Date effet</th>
                  <th className="text-left px-3 py-2.5 font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>De → Vers</th>
                  <th className="text-left px-3 py-2.5 font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>Statut</th>
                  <th className="px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(row => {
                  const c = collabMap[row.collaborateur_id];
                  const resolvePoste = (code: string | null) => {
                    if (!code) return null;
                    const parentCode = code.includes("-") ? code.split("-").slice(0, -1).join("-") : code;
                    return posteMap[parentCode] || posteMap[code] || code;
                  };
                  const ancien = resolvePoste(row.ancien_poste) || (row.ancienne_unite_id ? uoMap[row.ancienne_unite_id] : "—");
                  const nouveau = resolvePoste(row.nouveau_poste) || (row.nouvelle_unite_id ? uoMap[row.nouvelle_unite_id] : "—");
                  return (
                    <tr key={row.id} className="border-t" style={{ borderColor: "hsl(var(--border))" }}>
                      <td className="px-3 py-2.5">
                        <p className="font-medium" style={{ color: "hsl(var(--foreground))" }}>{c ? `${c.prenom} ${c.nom}` : "—"}</p>
                        <p style={{ color: "hsl(var(--muted-foreground))", fontSize: 10 }}>{c?.matricule || ""}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        <span style={{ color: "hsl(var(--foreground))" }}>{typeMap[row.code_type_mouvement]?.libelle || row.code_type_mouvement}</span>
                        {typeMap[row.code_type_mouvement]?.est_temporaire && (
                          <span className="ml-1 px-1 py-0.5 rounded text-[9px]" style={{ background: "hsl(280 65% 50% / 0.12)", color: "hsl(280 65% 40%)" }}>Temp.</span>
                        )}
                        {typeMap[row.code_type_mouvement]?.est_definitif && (
                          <span className="ml-1 px-1 py-0.5 rounded text-[9px]" style={{ background: "hsl(210 70% 50% / 0.12)", color: "hsl(210 70% 35%)" }}>Déf.</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5" style={{ color: "hsl(var(--foreground))" }}>
                        {row.date_effet ? new Date(row.date_effet).toLocaleDateString("fr-FR") : "—"}
                      </td>
                      <td className="px-3 py-2.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                        {ancien} → {nouveau}
                      </td>
                      <td className="px-3 py-2.5">{statutBadge(row.statut)}</td>
                      <td className="px-3 py-2.5">
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="Voir la fiche"
                          onClick={() => navigate(`/collaborateurs/${row.collaborateur_id}`)}>
                          <ExternalLink size={13} />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default MouvementsPage;
