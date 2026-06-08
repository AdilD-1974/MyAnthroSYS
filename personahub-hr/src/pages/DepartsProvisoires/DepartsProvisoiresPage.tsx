import React, { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus, Search, Clock, CheckCircle2, X, Eye, RefreshCw,
  PauseCircle, PlayCircle, RotateCcw, UserCheck, Calendar,
  ChevronDown, Check, Filter, Briefcase, Building2, UserCircle2,
  AlertTriangle, Bell, TrendingUp, Ban, MessageSquare,
  CheckCircle, XCircle} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { differenceInDays, format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";

// =====================================================
// RG-DEP-PROV-02 (Adil DAIA) :
//   Gestion des départs provisoires
// =====================================================

interface DepartProv {
  id: string;
  collaborateur_id: string;
  code_motif: string;
  date_debut: string;
  date_fin_prevue: string;
  date_fin_effective: string | null;
  reference_decision: string | null;
  date_decision: string | null;
  commentaire: string | null;
  numero_reconduction: number;
  depart_original_id: string | null;
  statut: string;
  created_at: string;
  collaborateur?: { nom: string; prenom: string; matricule: string; statut_collaborateur: string };
  motif?: { libelle: string; reconductible: boolean; nombre_reconductions_max: number | null; duree_max_periode_jours: number | null; duree_globale_max_jours: number | null; reste_dans_effectif: boolean };
}

interface Motif {
  code: string;
  libelle: string;
  reconductible: boolean;
  nombre_reconductions_max: number | null;
  duree_max_periode_jours: number | null;
  duree_globale_max_jours: number | null;
  reste_dans_effectif: boolean;
}

// ── Types de période ──────────────────────────────────────────────────────────
type ModePeriode = "TOUS" | "PLAGE" | "MOIS" | "TRIMESTRE" | "SEMESTRE" | "ANNEE";
const MOIS_LABELS = ["Janv.","Févr.","Mars","Avr.","Mai","Juin","Juil.","Août","Sept.","Oct.","Nov.","Déc."];
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 8 }, (_, i) => CURRENT_YEAR - 3 + i);

// ── MultiSelect ───────────────────────────────────────────────────────────────
interface MultiSelectProps {
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
  allLabel?: string;
}
const MultiSelect: React.FC<MultiSelectProps> = ({ options, selected, onChange, allLabel = "Tous" }) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);
  const toggle = (v: string) => {
    if (v === "ALL") { onChange([]); return; }
    onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
  };
  const label = selected.length === 0 ? allLabel : selected.length === 1 ? options.find(o => o.value === selected[0])?.label || selected[0] : `${selected.length} sélectionnés`;
  return (
    <div ref={ref} className="relative" style={{ minWidth: 150 }}>
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium"
        style={{ border: "1px solid hsl(var(--border))", background: selected.length > 0 ? "hsl(var(--primary)/0.06)" : "hsl(var(--background))", color: selected.length > 0 ? "hsl(var(--primary))" : "hsl(var(--foreground))", borderColor: selected.length > 0 ? "hsl(var(--primary)/0.3)" : "hsl(var(--border))" }}>
        {label}<ChevronDown size={11} style={{ opacity: 0.6, marginLeft: "auto" }} />
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 rounded-xl border shadow-xl overflow-hidden"
          style={{ background: "hsl(var(--popover))", borderColor: "hsl(var(--border))", minWidth: 200, maxHeight: 260, overflowY: "auto" }}>
          <button onClick={() => toggle("ALL")} className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent/10 border-b" style={{ borderColor: "hsl(var(--border))", color: selected.length === 0 ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }}>
            <div className="w-4 h-4 rounded border flex items-center justify-center flex-shrink-0" style={{ background: selected.length === 0 ? "hsl(var(--primary))" : "transparent", borderColor: selected.length === 0 ? "hsl(var(--primary))" : "hsl(var(--border))" }}>{selected.length === 0 && <Check size={10} color="white" />}</div>
            {allLabel}
          </button>
          {options.map(o => (
            <button key={o.value} onClick={() => toggle(o.value)} className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent/10" style={{ color: "hsl(var(--foreground))" }}>
              <div className="w-4 h-4 rounded border flex items-center justify-center flex-shrink-0" style={{ background: selected.includes(o.value) ? "hsl(var(--primary))" : "transparent", borderColor: selected.includes(o.value) ? "hsl(var(--primary))" : "hsl(var(--border))" }}>{selected.includes(o.value) && <Check size={10} color="white" />}</div>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── FiltrePériode ─────────────────────────────────────────────────────────────
interface FiltrePeriodeProps {
  mode: ModePeriode; onModeChange: (m: ModePeriode) => void;
  plageDebut: string; onPlageDebutChange: (v: string) => void;
  plageFin: string; onPlageFinChange: (v: string) => void;
  mois: number; onMoisChange: (v: number) => void;
  trimestre: number; onTrimestreChange: (v: number) => void;
  semestre: number; onSemestreChange: (v: number) => void;
  annee: number; onAnneeChange: (v: number) => void;
}
const FiltrePeriode: React.FC<FiltrePeriodeProps> = (p) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);
  const modeLabel: Record<ModePeriode, string> = { TOUS: "Toutes périodes", PLAGE: "Plage", MOIS: `${MOIS_LABELS[p.mois]} ${p.annee}`, TRIMESTRE: `T${p.trimestre} ${p.annee}`, SEMESTRE: `S${p.semestre} ${p.annee}`, ANNEE: `${p.annee}` };
  const isActive = p.mode !== "TOUS";
  const iSty: React.CSSProperties = { border: "1px solid hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" };
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium"
        style={{ border: "1px solid hsl(var(--border))", background: isActive ? "hsl(var(--primary)/0.06)" : "hsl(var(--background))", color: isActive ? "hsl(var(--primary))" : "hsl(var(--foreground))", borderColor: isActive ? "hsl(var(--primary)/0.3)" : "hsl(var(--border))" }}>
        <Calendar size={11} />{modeLabel[p.mode]}<ChevronDown size={11} style={{ opacity: 0.6 }} />
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 rounded-xl border shadow-xl p-4" style={{ background: "hsl(var(--popover))", borderColor: "hsl(var(--border))", minWidth: 300 }}>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {(["TOUS","PLAGE","MOIS","TRIMESTRE","SEMESTRE","ANNEE"] as ModePeriode[]).map(m => (
              <button key={m} onClick={() => p.onModeChange(m)} className="px-2.5 py-1 rounded-full text-[11px] font-medium"
                style={{ background: p.mode === m ? "hsl(var(--primary))" : "hsl(var(--muted)/0.5)", color: p.mode === m ? "white" : "hsl(var(--foreground))" }}>
                {m === "TOUS" ? "Toutes" : m === "PLAGE" ? "Plage" : m === "MOIS" ? "Mois" : m === "TRIMESTRE" ? "Trimestre" : m === "SEMESTRE" ? "Semestre" : "Année"}
              </button>
            ))}
          </div>
          {p.mode !== "TOUS" && p.mode !== "PLAGE" && (
            <div className="mb-3">
              <label className="text-[10px] font-semibold uppercase tracking-wide mb-1 block" style={{ color: "hsl(var(--muted-foreground))" }}>Année</label>
              <div className="flex flex-wrap gap-1">{YEARS.map(y => (<button key={y} onClick={() => p.onAnneeChange(y)} className="px-2.5 py-1 rounded-lg text-xs font-medium" style={{ background: p.annee === y ? "hsl(var(--primary))" : "hsl(var(--muted)/0.4)", color: p.annee === y ? "white" : "hsl(var(--foreground))" }}>{y}</button>))}</div>
            </div>
          )}
          {p.mode === "MOIS" && (<div><label className="text-[10px] font-semibold uppercase tracking-wide mb-1 block" style={{ color: "hsl(var(--muted-foreground))" }}>Mois</label><div className="grid grid-cols-4 gap-1">{MOIS_LABELS.map((m, i) => (<button key={i} onClick={() => p.onMoisChange(i)} className="px-2 py-1 rounded-lg text-[11px] font-medium" style={{ background: p.mois === i ? "hsl(var(--primary))" : "hsl(var(--muted)/0.4)", color: p.mois === i ? "white" : "hsl(var(--foreground))" }}>{m}</button>))}</div></div>)}
          {p.mode === "TRIMESTRE" && (<div><label className="text-[10px] font-semibold uppercase tracking-wide mb-1 block" style={{ color: "hsl(var(--muted-foreground))" }}>Trimestre</label><div className="flex gap-2">{[1,2,3,4].map(t => (<button key={t} onClick={() => p.onTrimestreChange(t)} className="flex-1 py-2 rounded-lg text-xs font-bold" style={{ background: p.trimestre === t ? "hsl(var(--primary))" : "hsl(var(--muted)/0.4)", color: p.trimestre === t ? "white" : "hsl(var(--foreground))" }}>T{t}</button>))}</div><p className="text-[10px] mt-1.5" style={{ color: "hsl(var(--muted-foreground))" }}>{p.trimestre===1?"Jan–Mar":p.trimestre===2?"Avr–Juin":p.trimestre===3?"Juil–Sept":"Oct–Déc"} {p.annee}</p></div>)}
          {p.mode === "SEMESTRE" && (<div><label className="text-[10px] font-semibold uppercase tracking-wide mb-1 block" style={{ color: "hsl(var(--muted-foreground))" }}>Semestre</label><div className="flex gap-2">{[1,2].map(s => (<button key={s} onClick={() => p.onSemestreChange(s)} className="flex-1 py-2 rounded-lg text-sm font-bold" style={{ background: p.semestre === s ? "hsl(var(--primary))" : "hsl(var(--muted)/0.4)", color: p.semestre === s ? "white" : "hsl(var(--foreground))" }}>S{s}</button>))}</div><p className="text-[10px] mt-1.5" style={{ color: "hsl(var(--muted-foreground))" }}>{p.semestre===1?"Janv–Juin":"Juil–Déc"} {p.annee}</p></div>)}
          {p.mode === "PLAGE" && (<div className="grid grid-cols-2 gap-3"><div><label className="text-[10px] font-semibold uppercase tracking-wide mb-1 block" style={{ color: "hsl(var(--muted-foreground))" }}>Du</label><input type="date" className="px-2 py-1 rounded-lg border text-xs w-full" style={iSty} value={p.plageDebut} onChange={e => p.onPlageDebutChange(e.target.value)} /></div><div><label className="text-[10px] font-semibold uppercase tracking-wide mb-1 block" style={{ color: "hsl(var(--muted-foreground))" }}>Au</label><input type="date" className="px-2 py-1 rounded-lg border text-xs w-full" style={iSty} value={p.plageFin} onChange={e => p.onPlageFinChange(e.target.value)} /></div></div>)}
        </div>
      )}
    </div>
  );
};

const STATUT_CFG: Record<string, { label: string; bg: string; color: string; icon: React.ReactNode }> = {
  ACTIF: { label: "En cours", bg: "hsl(45 100% 50% / 0.12)", color: "hsl(45 100% 30%)", icon: <PauseCircle size={12} /> },
  TERMINE: { label: "Terminé", bg: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", icon: <Clock size={12} /> },
  RECONDUIT: { label: "Reconduit", bg: "hsl(200 70% 50% / 0.12)", color: "hsl(200 70% 30%)", icon: <RefreshCw size={12} /> },
  REINTEGRE: { label: "Réintégré", bg: "hsl(142 55% 45% / 0.12)", color: "hsl(142 55% 30%)", icon: <UserCheck size={12} /> },
  ANNULE: { label: "Annulé", bg: "hsl(0 70% 50% / 0.10)", color: "hsl(0 70% 40%)", icon: <X size={12} /> },
};

const Badge: React.FC<{ statut: string }> = ({ statut }) => {
  const c = STATUT_CFG[statut] ?? { label: statut, bg: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", icon: null };
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: c.bg, color: c.color }}>
      {c.icon}{c.label}
    </span>
  );
};

const DepartsProvisoiresPage: React.FC = () => {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterStatuts, setFilterStatuts] = useState<string[]>([]);
  const [filterMotifs, setFilterMotifs] = useState<string[]>([]);
  const [filterReconductible, setFilterReconductible] = useState<string[]>([]);
  const [modePeriode, setModePeriode] = useState<ModePeriode>("TOUS");
  const [plageDebut, setPlageDebut] = useState("");
  const [plageFin, setPlageFin] = useState("");
  const [moisFiltre, setMoisFiltre] = useState(new Date().getMonth());
  const [trimestreFiltre, setTrimestreFiltre] = useState(Math.ceil((new Date().getMonth() + 1) / 3));
  const [semestreFiltre, setSemestreFiltre] = useState(new Date().getMonth() < 6 ? 1 : 2);
  const [anneeFiltre, setAnneeFiltre] = useState(CURRENT_YEAR);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [formCollabSearch, setFormCollabSearch] = useState("");
  const [formCollabId, setFormCollabId] = useState("");
  const [formMotif, setFormMotif] = useState("");
  const [formDateDebut, setFormDateDebut] = useState("");
  const [formDateFinPrevue, setFormDateFinPrevue] = useState("");
  const [formRefDecision, setFormRefDecision] = useState("");
  const [formDateDecision, setFormDateDecision] = useState("");
  const [formCommentaire, setFormCommentaire] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // ── Référentiels couleurs (même pattern que DepartForm) ──────────────────────
  const { data: typesContrats = [] } = useQuery<any[]>({
    queryKey: ["ref_type_contrat-depart-prov"],
    queryFn: async () => { try { return await api.get("/db/ref_type_contrat"); } catch { return []; } },
    staleTime: 5 * 60 * 1000,
  });
  const { data: statutsContrat = [] } = useQuery<any[]>({
    queryKey: ["ref_statut_contrat-depart-prov"],
    queryFn: async () => { try { return await api.get("/db/ref_statut_contrat"); } catch { return []; } },
    staleTime: 5 * 60 * 1000,
  });

  const getTypeContratInfo = (code: string | null | undefined) => {
    if (!code) return { libelle: "", couleur: "hsl(210 80% 50%)" };
    const t = typesContrats.find((x: any) => x.code === code);
    return { libelle: t?.libelle || code, couleur: t?.couleur || "hsl(210 80% 50%)" };
  };
  const getStatutInfo = (code: string | null | undefined) => {
    if (!code) return { libelle: "", couleur: "hsl(0 0% 50%)" };
    const s = statutsContrat.find((x: any) => x.code === code);
    const fallback = (code === "ACTIF" || code === "EN_COURS") ? "hsl(140 60% 40%)" : "hsl(0 0% 50%)";
    return { libelle: s?.libelle || code, couleur: s?.couleur || fallback };
  };

  // ── Contexte collaborateur : contrat + affectation (même logique que DepartForm) ──
  const { data: collabContext, isLoading: loadingInfo, error: contextError } = useQuery({
    queryKey: ["collab-context-depart-prov", formCollabId],
    enabled: !!formCollabId,
    queryFn: async () => {
      if (!formCollabId) return null;
      const today = new Date().toISOString().split("T")[0];

      // 0. Infos collab
      let collabInfos: any = null;
      try {
        const c: any[] = await api.get(`/db/collaborateurs?id=eq.${formCollabId}&limit=1`);
        collabInfos = c?.[0] || null;
      } catch (e) { console.warn("[DepartsProv] collab:", e); }

      // 1. Contrat actif
      let contrat: any = null;
      try {
        const contrats: any[] = await api.get(
          `/db/collaborateur_contrats?collaborateur_id=eq.${formCollabId}&archive=eq.false&date_sortie=is.null&order=date_debut.desc&limit=1`
        );
        contrat = contrats?.[0] || null;
      } catch (e) { console.error("[DepartsProv] contrat:", e); }

      // 2. Affectation la plus récente non archivée
      let aRaw: any = null;
      try {
        const affs: any[] = await api.get(
          `/db/collaborateur_affectations?collaborateur_id=eq.${formCollabId}&archive=eq.false&order=date_debut_uo.desc&limit=1`
        );
        aRaw = affs?.[0] || null;
        if (aRaw?.date_fin_uo && aRaw.date_fin_uo < today) aRaw = null;
      } catch (e) { console.error("[DepartsProv] affectation:", e); }

      // 3. UO + Poste (libellé parent)
      let uo: any = null;
      if (aRaw?.unite_id) {
        try {
          const uoData: any[] = await api.get(`/db/unites_organisationnelles?id=eq.${aRaw.unite_id}&limit=1`);
          uo = uoData?.[0] || null;
        } catch (e) { console.warn("[DepartsProv] UO:", e); }
      }

      let poste: any = null;
      if (aRaw?.code_poste) {
        const codePosteInst = String(aRaw.code_poste);
        const codePosteParent = codePosteInst.split("-")[0];
        try {
          const vData: any[] = await api.get(`/db/v_postes_avec_instances?code_instance=eq.${encodeURIComponent(codePosteInst)}&limit=1`);
          if (vData?.[0]) poste = vData[0];
        } catch { /* continue */ }
        if (!poste?.libelle_poste && !poste?.libelle) {
          try {
            const rpData: any[] = await api.get(`/db/ref_poste?code=eq.${encodeURIComponent(codePosteParent)}&limit=1`);
            if (rpData?.[0]) poste = { ...(poste || {}), code_poste_parent: codePosteParent, ...rpData[0] };
          } catch (e) { console.warn("[DepartsProv] ref_poste:", e); }
        }
      }

      const affectation = aRaw ? {
        code_uo: uo?.code || null,
        libelle_uo: uo?.libelle || uo?.intitule || uo?.nom || null,
        couleur_uo: uo?.couleur || uo?.color || null,
        code_instance_poste: aRaw.code_poste || null,
        code_poste_parent: poste?.code_poste_parent || poste?.code_poste || null,
        libelle_poste: poste?.libelle_poste || poste?.libelle || poste?.intitule || poste?.nom || null,
        date_debut_uo: aRaw.date_debut_uo || null,
        date_debut_poste: aRaw.date_debut_poste || null,
        raw: aRaw,
      } : null;

      return { contrat, affectation, collabInfos };
    },
  });

  // Reconduction dialog
  const [reconductionTarget, setReconductionTarget] = useState<DepartProv | null>(null);
  const [reconDateFin, setReconDateFin] = useState("");
  const [reconRef, setReconRef] = useState("");

  const [detailTarget, setDetailTarget] = useState<DepartProv | null>(null);

  // Réintégration dialog (enrichi)
  const [reintegrationTarget, setReintegrationTarget] = useState<DepartProv | null>(null);
  const [reintDateEffective, setReintDateEffective] = useState("");
  const [reintMotif, setReintMotif] = useState("RETOUR_NORMAL");
  const [reintCommentaire, setReintCommentaire] = useState("");
  const [reintRef, setReintRef] = useState("");

  // Annulation avec motif
  const [annulationTarget, setAnnulationTarget] = useState<DepartProv | null>(null);
  const [annulMotif, setAnnulMotif] = useState("");
  const [annulCommentaire, setAnnulCommentaire] = useState("");

  const { data: motifs = [] } = useQuery<Motif[]>({
    queryKey: ["ref_motif_depart_provisoire_actifs"],
    queryFn: async () => {
      const data = await api.get("/db/ref_motif_depart_provisoire?actif=eq.true&order=libelle");
      return (data as any[]) || [];
    },
  });

  const { data: departs = [], isLoading } = useQuery<DepartProv[]>({
    queryKey: ["departs_provisoires"],
    queryFn: async () => {
      const deps: any[] = await api.get("/db/collaborateur_departs_provisoires?archive=eq.false&order=date_debut.desc") || [];
      if (deps.length === 0) return [];

      const collabIds = [...new Set(deps.map((d: any) => d.collaborateur_id))];
      const motifCodes = [...new Set(deps.map((d: any) => d.code_motif))];

      const [collabsData, motifsData] = await Promise.all([
        api.get(`/db/collaborateurs?id=in.(${collabIds.join(",")})&select=id,nom,prenom,matricule,statut_collaborateur`),
        api.get(`/db/ref_motif_depart_provisoire?code=in.(${motifCodes.join(",")})&select=code,libelle,reconductible,nombre_reconductions_max,duree_max_periode_jours,duree_globale_max_jours,reste_dans_effectif`),
      ]);

      const collabMap: Record<string, any> = {};
      ((collabsData as any[]) || []).forEach((c: any) => { collabMap[c.id] = c; });
      const motifMap: Record<string, any> = {};
      ((motifsData as any[]) || []).forEach((m: any) => { motifMap[m.code] = m; });

      return deps.map((d: any) => ({
        ...d,
        collaborateur: collabMap[d.collaborateur_id] || null,
        motif: motifMap[d.code_motif] || null,
      }));
    },
  });

  // Liste complète des collabs actifs — fetché une fois, filtré côté JS
  const { data: tousCollabsForm = [] } = useQuery<any[]>({
    queryKey: ["collabs-depart-prov-all"],
    enabled: showForm || !!new URLSearchParams(window.location.search).get("collaborateur"),
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const params = new URLSearchParams({
        select: "id,nom,prenom,matricule,statut_collaborateur,photo_path",
        statut_collaborateur: "in.(ACTIF)",
        archive: "eq.false",
        order: "nom",
        limit: "500",
      });
      const data: any[] = await api.get(`/db/collaborateurs?${params.toString()}`);
      return data || [];
    },
  });

  // Filtre client sur matricule / nom / prénom (insensible casse + accents, multi-tokens)
  const normTxt = (s: string) =>
    (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const collabList = React.useMemo(() => {
    const q = normTxt(formCollabSearch.trim());
    if (!q) return tousCollabsForm.slice(0, 50);
    const tokens = q.split(/\s+/).filter(Boolean);
    return tousCollabsForm.filter((c: any) => {
      const haystack = normTxt(`${c.matricule || ""} ${c.nom || ""} ${c.prenom || ""}`);
      return tokens.every(t => haystack.includes(t));
    }).slice(0, 50);
  }, [tousCollabsForm, formCollabSearch]);

  const selectedCollab = collabList.find((c: any) => c.id === formCollabId);

  // ── Query détail popup (contrat + affectation + reconductions pour detailTarget) ──
  const { data: detailContext, isLoading: detailLoading } = useQuery({
    queryKey: ["depart-prov-detail", detailTarget?.id],
    enabled: !!detailTarget,
    queryFn: async () => {
      if (!detailTarget) return null;
      const collabId = detailTarget.collaborateur_id;
      const today = new Date().toISOString().split("T")[0];

      // Collab + contrat + affectation en parallèle
      const [collabArr, contratsArr, affArr, reconArr] = await Promise.all([
        api.get(`/db/collaborateurs?id=eq.${collabId}&limit=1`).catch(() => []),
        api.get(`/db/collaborateur_contrats?collaborateur_id=eq.${collabId}&archive=eq.false&date_sortie=is.null&order=date_debut.desc&limit=1`).catch(() => []),
        api.get(`/db/collaborateur_affectations?collaborateur_id=eq.${collabId}&archive=eq.false&order=date_debut_uo.desc&limit=1`).catch(() => []),
        // Toutes les reconductions liées à ce départ original — filtrées sur le même collaborateur
        api.get(`/db/collaborateur_departs_provisoires?collaborateur_id=eq.${collabId}&or=(id.eq.${detailTarget.depart_original_id || detailTarget.id},depart_original_id.eq.${detailTarget.depart_original_id || detailTarget.id})&order=date_debut.asc`).catch(() => []),
      ]);

      const ci = (collabArr as any[])[0] || null;
      const contrat = (contratsArr as any[])[0] || null;
      let affRaw = (affArr as any[])[0] || null;
      if (affRaw?.date_fin_uo && affRaw.date_fin_uo < today) affRaw = null;

      // Résoudre libellé type contrat
      if (contrat?.code_type_contrat) {
        try {
          const types: any[] = await api.get(`/db/ref_type_contrat?code=eq.${contrat.code_type_contrat}&select=code,libelle,couleur&limit=1`);
          if (types?.[0]) { contrat.libelle_type_contrat = types[0].libelle; contrat.couleur_type = types[0].couleur; }
        } catch { /* ignore */ }
      }

      // Résoudre UO
      let uo: any = null;
      if (affRaw?.unite_id) {
        try { const r: any[] = await api.get(`/db/unites_organisationnelles?id=eq.${affRaw.unite_id}&limit=1`); uo = r?.[0] || null; } catch { /* ignore */ }
      }
      // Résoudre poste
      let poste: any = null;
      if (affRaw?.code_poste) {
        try { const r: any[] = await api.get(`/db/v_postes_avec_instances?code_instance=eq.${encodeURIComponent(affRaw.code_poste)}&limit=1`); poste = r?.[0] || null; } catch { /* ignore */ }
        if (!poste) {
          try { const r: any[] = await api.get(`/db/ref_poste?code=eq.${encodeURIComponent(String(affRaw.code_poste).split("-")[0])}&limit=1`); poste = r?.[0] || null; } catch { /* ignore */ }
        }
      }

      return {
        ci,
        contrat,
        affectation: affRaw ? {
          libelle_uo: uo?.libelle || uo?.intitule || uo?.nom || null,
          couleur_uo: uo?.couleur || null,
          libelle_poste: poste?.libelle_poste || poste?.libelle || poste?.intitule || null,
          date_debut_uo: affRaw.date_debut_uo || null,
          date_debut_poste: affRaw.date_debut_poste || null,
        } : null,
        reconductions: (reconArr as any[]) || [],
      };
    },
  });
  const [urlParamHandled, setUrlParamHandled] = useState(false);
  useEffect(() => {
    if (urlParamHandled) return;
    const params = new URLSearchParams(window.location.search);
    const collabParam = params.get("collaborateur");
    if (collabParam && collabList.length > 0) {
      const found = collabList.find((c: any) => c.id === collabParam);
      if (found) {
        setFormCollabId(collabParam);
        setShowForm(true);
        setUrlParamHandled(true);
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
  }, [collabList, urlParamHandled]);

  const resetForm = () => {
    setFormCollabSearch(""); setFormCollabId(""); setFormMotif("");
    setFormDateDebut(""); setFormDateFinPrevue(""); setFormRefDecision("");
    setFormDateDecision(""); setFormCommentaire("");
  };

  // Validation des contraintes de durée
  const validateDuration = (motifCode: string, collabId: string, dateDebut: string, dateFinPrevue: string): string | null => {
    const motif = motifs.find(m => m.code === motifCode);
    if (!motif) return null;
    const jours = differenceInDays(parseISO(dateFinPrevue), parseISO(dateDebut));
    if (motif.duree_max_periode_jours && jours > motif.duree_max_periode_jours) {
      return `La durée (${jours}j) dépasse la durée max par période (${motif.duree_max_periode_jours}j)`;
    }
    return null;
  };

  const handleSubmit = async () => {
    if (!formCollabId || !formMotif || !formDateDebut || !formDateFinPrevue) {
      toast({ title: "Veuillez remplir tous les champs obligatoires", variant: "destructive" });
      return;
    }
    const durationErr = validateDuration(formMotif, formCollabId, formDateDebut, formDateFinPrevue);
    if (durationErr) {
      toast({ title: "Contrainte de durée", description: durationErr, variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      // RG-DEP-PROV-DATE-01 : La date de début du départ doit être >= date_debut du contrat en cours
      if (collabContext?.contrat?.date_debut && formDateDebut) {
        const dateContrat = new Date(collabContext.contrat.date_debut);
        const dateDebut = new Date(formDateDebut);
        if (dateDebut < dateContrat) {
          toast({
            title: "Date invalide",
            description: `La date de début (${format(parseISO(formDateDebut), "dd/MM/yyyy", { locale: fr })}) doit être postérieure à la date de début du contrat en cours (${format(parseISO(collabContext.contrat.date_debut), "dd/MM/yyyy", { locale: fr })}).`,
            variant: "destructive",
          });
          setSubmitting(false);
          return;
        }
      }

      await api.post("/db/collaborateur_departs_provisoires", {
        collaborateur_id: formCollabId,
        code_motif: formMotif,
        date_debut: formDateDebut,
        date_fin_prevue: formDateFinPrevue,
        reference_decision: formRefDecision || null,
        date_decision: formDateDecision || null,
        commentaire: formCommentaire || null,
        created_by: user?.id,
        updated_by: user?.id,
      });

      await api.patch(`/db/collaborateurs?id=eq.${formCollabId}`, { statut_collaborateur: "SUSPENDU" });

      toast({ title: "Départ provisoire enregistré" });
      qc.invalidateQueries({ queryKey: ["departs_provisoires"] });
      setShowForm(false);
      resetForm();
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  // Reconduction
  const handleReconduction = async () => {
    if (!reconductionTarget || !reconDateFin) return;
    // RG-DEP-PROV-RECON-DATE-01 : la nouvelle date de fin doit être > date de début de la reconduction
    if (reconDateFin <= reconductionTarget.date_fin_prevue) {
      toast({
        title: "Date invalide",
        description: `La nouvelle date de fin (${format(parseISO(reconDateFin), "dd/MM/yyyy", { locale: fr })}) doit être strictement postérieure à la date de début de la reconduction (${format(parseISO(reconductionTarget.date_fin_prevue), "dd/MM/yyyy", { locale: fr })}).`,
        variant: "destructive",
      });
      return;
    }
    const dep = reconductionTarget;
    const motif = dep.motif as any;

    // Vérifier nombre max de reconductions
    if (motif?.nombre_reconductions_max && dep.numero_reconduction >= motif.nombre_reconductions_max) {
      toast({ title: "Limite atteinte", description: `Nombre maximum de reconductions (${motif.nombre_reconductions_max}) atteint`, variant: "destructive" });
      return;
    }

    // Vérifier durée globale
    if (motif?.duree_globale_max_jours) {
      const allDeps: any[] = await api.get(
        `/db/collaborateur_departs_provisoires?collaborateur_id=eq.${dep.collaborateur_id}&code_motif=eq.${dep.code_motif}&archive=eq.false&select=date_debut,date_fin_prevue,date_fin_effective`
      ) || [];
      const totalJours = allDeps.reduce((acc: number, d: any) => {
        const fin = d.date_fin_effective || d.date_fin_prevue;
        return acc + differenceInDays(parseISO(fin), parseISO(d.date_debut));
      }, 0);
      const newJours = differenceInDays(parseISO(reconDateFin), parseISO(dep.date_fin_prevue));
      if (totalJours + newJours > motif.duree_globale_max_jours) {
        toast({ title: "Durée globale dépassée", description: `Total (${totalJours + newJours}j) dépasse la limite globale (${motif.duree_globale_max_jours}j)`, variant: "destructive" });
        return;
      }
    }

    setSubmitting(true);
    try {
      await api.patch(`/db/collaborateur_departs_provisoires?id=eq.${dep.id}`, {
        statut: "RECONDUIT", date_fin_effective: dep.date_fin_prevue, updated_by: user?.id,
      });

      await api.post("/db/collaborateur_departs_provisoires", {
        collaborateur_id: dep.collaborateur_id,
        code_motif: dep.code_motif,
        date_debut: dep.date_fin_prevue,
        date_fin_prevue: reconDateFin,
        reference_decision: reconRef || null,
        numero_reconduction: dep.numero_reconduction + 1,
        depart_original_id: dep.depart_original_id || dep.id,
        created_by: user?.id,
        updated_by: user?.id,
      });

      toast({ title: "Reconduction enregistrée", description: `Reconduction n°${dep.numero_reconduction + 1}` });
      qc.invalidateQueries({ queryKey: ["departs_provisoires"] });
      setReconductionTarget(null);
      setReconDateFin(""); setReconRef("");
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  // Réintégration enrichie
  const handleReintegration = async () => {
    if (!reintegrationTarget || !reintDateEffective) return;
    // RG-DEP-PROV-REINT-01 : date effective doit être >= date_debut du départ
    if (reintDateEffective < reintegrationTarget.date_debut) {
      toast({ title: "Date invalide", description: "La date de réintégration doit être >= à la date de début du départ", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await api.patch(`/db/collaborateur_departs_provisoires?id=eq.${reintegrationTarget.id}`, {
        statut: "REINTEGRE",
        date_fin_effective: reintDateEffective,
        commentaire: reintCommentaire || reintegrationTarget.commentaire || null,
        reference_decision: reintRef || reintegrationTarget.reference_decision || null,
        updated_by: user?.id,
      });
      // Remettre le collaborateur ACTIF
      await api.patch(`/db/collaborateurs?id=eq.${reintegrationTarget.collaborateur_id}`, {
        statut_collaborateur: "ACTIF",
      });
      toast({ title: "Réintégration effectuée", description: `${reintegrationTarget.collaborateur?.prenom ?? ""} ${reintegrationTarget.collaborateur?.nom ?? ""} est de nouveau actif(ve)` });
      qc.invalidateQueries({ queryKey: ["departs_provisoires"] });
      setReintegrationTarget(null);
      setReintDateEffective("");
      setReintMotif("RETOUR_NORMAL");
      setReintCommentaire("");
      setReintRef("");
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  // Annulation avec motif
  const handleAnnulation = async () => {
    if (!annulationTarget || !annulMotif) return;
    setSubmitting(true);
    try {
      await api.patch(`/db/collaborateur_departs_provisoires?id=eq.${annulationTarget.id}`, {
        statut: "ANNULE",
        commentaire: annulCommentaire || null,
        updated_by: user?.id,
      });
      // Remettre le collaborateur ACTIF si le départ était en cours
      if (annulationTarget.statut === "ACTIF") {
        await api.patch(`/db/collaborateurs?id=eq.${annulationTarget.collaborateur_id}`, {
          statut_collaborateur: "ACTIF",
        });
      }
      toast({ title: "Départ annulé", description: annulCommentaire ? `Motif : ${annulCommentaire}` : undefined });
      qc.invalidateQueries({ queryKey: ["departs_provisoires"] });
      setAnnulationTarget(null);
      setAnnulMotif("");
      setAnnulCommentaire("");
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  // Calcul plage période
  const periodRange = React.useMemo((): { debut: Date | null; fin: Date | null } => {
    if (modePeriode === "TOUS") return { debut: null, fin: null };
    if (modePeriode === "PLAGE") return { debut: plageDebut ? new Date(plageDebut) : null, fin: plageFin ? new Date(plageFin) : null };
    if (modePeriode === "MOIS") return { debut: new Date(anneeFiltre, moisFiltre, 1), fin: new Date(anneeFiltre, moisFiltre + 1, 0) };
    if (modePeriode === "TRIMESTRE") { const sm = (trimestreFiltre-1)*3; return { debut: new Date(anneeFiltre, sm, 1), fin: new Date(anneeFiltre, sm+3, 0) }; }
    if (modePeriode === "SEMESTRE") { const sm = (semestreFiltre-1)*6; return { debut: new Date(anneeFiltre, sm, 1), fin: new Date(anneeFiltre, sm+6, 0) }; }
    return { debut: new Date(anneeFiltre, 0, 1), fin: new Date(anneeFiltre, 11, 31) };
  }, [modePeriode, plageDebut, plageFin, moisFiltre, trimestreFiltre, semestreFiltre, anneeFiltre]);

  // Grouper les reconductions : 1 ligne par chaîne (depart_original_id ou id)
  // On garde uniquement la période la plus récente (date_debut max) comme représentant
  const grouped = React.useMemo(() => {
    // Construire les groupes : clé = id racine (depart_original_id ?? id)
    const groupMap = new Map<string, DepartProv[]>();
    for (const d of departs) {
      const key = (d as any).depart_original_id || d.id;
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(d);
    }
    // Pour chaque groupe, prendre le représentant = ligne avec date_debut la plus récente
    const representatives = Array.from(groupMap.values()).map(groupe => {
      const sorted = [...groupe].sort((a, b) => b.date_debut.localeCompare(a.date_debut));
      const rep = sorted[0] as any;
      rep._totalPeriodes = groupe.length;
      rep._dateDebutOriginal = groupe.reduce((min, d) => d.date_debut < min ? d.date_debut : min, groupe[0].date_debut);
      return rep as DepartProv;
    });
    // Trier les groupes par date de début original desc
    return representatives.sort((a, b) => ((b as any)._dateDebutOriginal || b.date_debut).localeCompare((a as any)._dateDebutOriginal || a.date_debut));
  }, [departs]);

  const filtered = React.useMemo(() => grouped.filter(d => {
    if (filterStatuts.length > 0 && !filterStatuts.includes(d.statut)) return false;
    if (filterMotifs.length > 0 && !filterMotifs.includes(d.code_motif)) return false;
    if (filterReconductible.length > 0) {
      const isRec = !!(d as any).motif?.reconductible;
      if (!filterReconductible.some(r => (r === "OUI" && isRec) || (r === "NON" && !isRec))) return false;
    }
    if (periodRange.debut || periodRange.fin) {
      // Filtrer sur la date de début de la période originale
      const dt = (d as any)._dateDebutOriginal ? new Date((d as any)._dateDebutOriginal) : (d.date_debut ? new Date(d.date_debut) : null);
      if (!dt) return false;
      if (periodRange.debut && dt < periodRange.debut) return false;
      if (periodRange.fin && dt > periodRange.fin) return false;
    }
    if (search) {
      const col = (d as any).collaborateur;
      const t = search.toLowerCase();
      if (!col?.nom?.toLowerCase().includes(t) && !col?.prenom?.toLowerCase().includes(t) && !col?.matricule?.toLowerCase().includes(t)) return false;
    }
    return true;
  }), [grouped, filterStatuts, filterMotifs, filterReconductible, periodRange, search]);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <PauseCircle size={20} style={{ color: "hsl(var(--accent))" }} />
            <h1 className="text-xl font-bold" style={{ color: "hsl(var(--foreground))" }}>
              Départs provisoires
            </h1>
          </div>
          <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
            Détachements, mises en disponibilité, congés spécifiques
          </p>
        </div>
        <Button size="sm" onClick={() => { setShowForm(true); resetForm(); }}>
          <Plus size={15} className="mr-1" /> Nouveau départ provisoire
        </Button>
      </div>

      {/* KPIs */}
      {(() => {
        // KPIs sur grouped (une ligne par chaîne de reconductions)
        const enCours = grouped.filter(d => d.statut === "ACTIF").length;
        const reintegres = grouped.filter(d => d.statut === "REINTEGRE").length;
        const reconduits = grouped.filter(d => d.statut === "RECONDUIT").length;
        const depasses = grouped.filter(d => d.statut === "ACTIF" && new Date() > parseISO(d.date_fin_prevue)).length;
        const expirent7j = grouped.filter(d => {
          if (d.statut !== "ACTIF") return false;
          const j = differenceInDays(parseISO(d.date_fin_prevue), new Date());
          return j >= 0 && j <= 7;
        }).length;
        const totalJours = grouped.filter(d => d.statut === "ACTIF").reduce((acc, d) => {
          return acc + differenceInDays(parseISO(d.date_fin_prevue), parseISO(d.date_debut));
        }, 0);
        return (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: "En cours", value: enCours, icon: <PauseCircle size={17} />, bg: "hsl(45 100% 50% / 0.12)", color: "hsl(45 100% 28%)", border: "hsl(45 100% 50% / 0.25)" },
              { label: "Réintégrés", value: reintegres, icon: <UserCheck size={17} />, bg: "hsl(142 55% 45% / 0.12)", color: "hsl(142 55% 28%)", border: "hsl(142 55% 45% / 0.25)" },
              { label: "Reconduits", value: reconduits, icon: <RefreshCw size={17} />, bg: "hsl(210 70% 50% / 0.12)", color: "hsl(210 70% 35%)", border: "hsl(210 70% 50% / 0.25)" },
              { label: "Jours en cours", value: totalJours, icon: <Calendar size={17} />, bg: "hsl(var(--accent) / 0.10)", color: "hsl(var(--accent))", border: "hsl(var(--accent) / 0.2)" },
              { label: "Dépassés", value: depasses, icon: <AlertTriangle size={17} />, bg: "hsl(0 70% 50% / 0.10)", color: "hsl(0 70% 40%)", border: "hsl(0 70% 50% / 0.2)" },
              { label: "Expirent ≤ 7j", value: expirent7j, icon: <Bell size={17} />, bg: "hsl(38 92% 50% / 0.12)", color: "hsl(38 92% 35%)", border: "hsl(38 92% 50% / 0.25)" },
            ].map(k => (
              <div key={k.label} className="rounded-xl p-3.5 flex items-center gap-3"
                style={{ background: "hsl(var(--card))", border: `1px solid ${k.border}` }}>
                <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: k.bg, color: k.color }}>{k.icon}</div>
                <div>
                  <p className="text-xl font-bold leading-none" style={{ color: "hsl(var(--foreground))" }}>{k.value}</p>
                  <p className="text-[11px] mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{k.label}</p>
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* ── Alertes proactives : départs expirant bientôt ou dépassés ───────── */}
      {(() => {
        const today = new Date();
        const alertes = departs.filter(d => {
          if (d.statut !== "ACTIF") return false;
          const fin = parseISO(d.date_fin_prevue);
          const joursRestants = differenceInDays(fin, today);
          return joursRestants <= 7; // Expire dans 7j ou déjà dépassé
        }).sort((a, b) => differenceInDays(parseISO(a.date_fin_prevue), parseISO(b.date_fin_prevue)));
        if (alertes.length === 0) return null;
        return (
          <div className="rounded-xl border overflow-hidden"
            style={{ borderColor: "hsl(0 70% 50% / 0.25)", background: "hsl(0 70% 50% / 0.04)" }}>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b"
              style={{ borderColor: "hsl(0 70% 50% / 0.2)", background: "hsl(0 70% 50% / 0.08)" }}>
              <Bell size={13} style={{ color: "hsl(0 70% 45%)" }} />
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "hsl(0 70% 40%)" }}>
                {alertes.length} départ{alertes.length > 1 ? "s" : ""} à traiter
              </span>
            </div>
            <div className="divide-y" style={{ borderColor: "hsl(0 70% 50% / 0.1)" }}>
              {alertes.map(dep => {
                const joursRestants = differenceInDays(parseISO(dep.date_fin_prevue), today);
                const isDepasse = joursRestants < 0;
                const c = dep.collaborateur;
                const m = dep.motif;
                return (
                  <div key={dep.id} className="flex items-center gap-3 px-4 py-2.5">
                    <AlertTriangle size={14} style={{ color: isDepasse ? "hsl(0 70% 45%)" : "hsl(38 92% 50%)", flexShrink: 0 }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                        {c?.prenom} {c?.nom}
                        <span className="font-normal ml-1.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                          — {m?.libelle || dep.code_motif}
                        </span>
                      </p>
                      <p className="text-[11px] mt-0.5" style={{ color: isDepasse ? "hsl(0 70% 45%)" : "hsl(38 92% 40%)" }}>
                        {isDepasse
                          ? `Dépassé de ${Math.abs(joursRestants)} jour${Math.abs(joursRestants) > 1 ? "s" : ""} (fin prévue le ${format(parseISO(dep.date_fin_prevue), "dd/MM/yyyy")})`
                          : joursRestants === 0 ? "Expire aujourd'hui"
                          : `Expire dans ${joursRestants} jour${joursRestants > 1 ? "s" : ""} (${format(parseISO(dep.date_fin_prevue), "dd/MM/yyyy")})`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {m?.reconductible && (
                        <button onClick={() => { setReconductionTarget(dep); setReconDateFin(""); setReconRef(""); }}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-opacity hover:opacity-80"
                          style={{ background: "hsl(210 70% 50% / 0.12)", color: "hsl(210 70% 35%)", border: "1px solid hsl(210 70% 50% / 0.2)" }}>
                          <RefreshCw size={11} /> Reconduire
                        </button>
                      )}
                      <button onClick={() => { setReintegrationTarget(dep); setReintDateEffective(new Date().toISOString().split("T")[0]); }}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-opacity hover:opacity-80"
                        style={{ background: "hsl(142 55% 45% / 0.12)", color: "hsl(142 55% 30%)", border: "1px solid hsl(142 55% 45% / 0.2)" }}>
                        <UserCheck size={11} /> Réintégrer
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Filtres enrichis ─────────────────────────────────────────────────── */}
      {(() => {
        const hasActive = filterStatuts.length > 0 || filterMotifs.length > 0 || filterReconductible.length > 0 || modePeriode !== "TOUS" || !!search;
        const resetAll = () => { setFilterStatuts([]); setFilterMotifs([]); setFilterReconductible([]); setModePeriode("TOUS"); setSearch(""); setPlageDebut(""); setPlageFin(""); };
        const motifOptions = motifs.map(m => ({ value: m.code, label: m.libelle }));
        return (
          <div className="rounded-xl border p-3 space-y-3" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted)/0.15)" }}>
            {/* Ligne 1 : recherche */}
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
                <Input placeholder="Rechercher collaborateur, matricule…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 text-xs" />
              </div>
              {hasActive && (
                <button onClick={resetAll} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
                  style={{ background: "hsl(0 70% 50% / 0.08)", color: "hsl(0 70% 40%)", border: "1px solid hsl(0 70% 50% / 0.2)" }}>
                  <RotateCcw size={11} /> Réinitialiser
                </button>
              )}
              <div className="flex items-center gap-1 ml-auto">
                <Filter size={11} style={{ color: "hsl(var(--muted-foreground))" }} />
                <span className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>{filtered.length} résultat{filtered.length > 1 ? "s" : ""}</span>
              </div>
            </div>
            {/* Ligne 2 : filtres */}
            <div className="flex flex-wrap gap-2 items-center">
              <MultiSelect
                options={[{value:"ACTIF",label:"En cours"},{value:"REINTEGRE",label:"Réintégré"},{value:"RECONDUIT",label:"Reconduit"},{value:"TERMINE",label:"Terminé"},{value:"ANNULE",label:"Annulé"}]}
                selected={filterStatuts} onChange={setFilterStatuts} allLabel="Tous les statuts" />
              <MultiSelect options={motifOptions} selected={filterMotifs} onChange={setFilterMotifs} allLabel="Tous les motifs" />
              <MultiSelect options={[{value:"OUI",label:"Reconductible"},{value:"NON",label:"Non reconductible"}]}
                selected={filterReconductible} onChange={setFilterReconductible} allLabel="Reconduction : toutes" />
              <FiltrePeriode
                mode={modePeriode} onModeChange={setModePeriode}
                plageDebut={plageDebut} onPlageDebutChange={setPlageDebut}
                plageFin={plageFin} onPlageFinChange={setPlageFin}
                mois={moisFiltre} onMoisChange={setMoisFiltre}
                trimestre={trimestreFiltre} onTrimestreChange={setTrimestreFiltre}
                semestre={semestreFiltre} onSemestreChange={setSemestreFiltre}
                annee={anneeFiltre} onAnneeChange={setAnneeFiltre} />
            </div>
            {/* Tags actifs */}
            {hasActive && (
              <div className="flex flex-wrap gap-1.5 pt-1 border-t" style={{ borderColor: "hsl(var(--border))" }}>
                {filterStatuts.map(s => (<span key={s} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ background: "hsl(var(--primary)/0.1)", color: "hsl(var(--primary))", border: "1px solid hsl(var(--primary)/0.2)" }}>{STATUT_CFG[s]?.label ?? s}<button onClick={() => setFilterStatuts(f => f.filter(x => x !== s))}><X size={9} /></button></span>))}
                {filterMotifs.map(m => (<span key={m} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ background: "hsl(var(--primary)/0.1)", color: "hsl(var(--primary))", border: "1px solid hsl(var(--primary)/0.2)" }}>{motifs.find(mo => mo.code === m)?.libelle ?? m}<button onClick={() => setFilterMotifs(f => f.filter(x => x !== m))}><X size={9} /></button></span>))}
                {filterReconductible.map(r => (<span key={r} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ background: "hsl(var(--primary)/0.1)", color: "hsl(var(--primary))", border: "1px solid hsl(var(--primary)/0.2)" }}>{r === "OUI" ? "Reconductible" : "Non reconductible"}<button onClick={() => setFilterReconductible(f => f.filter(x => x !== r))}><X size={9} /></button></span>))}
                {modePeriode !== "TOUS" && (<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ background: "hsl(210 70% 50% / 0.1)", color: "hsl(210 70% 40%)", border: "1px solid hsl(210 70% 50% / 0.2)" }}><Calendar size={9} />{modePeriode==="MOIS"?`${MOIS_LABELS[moisFiltre]} ${anneeFiltre}`:modePeriode==="TRIMESTRE"?`T${trimestreFiltre} ${anneeFiltre}`:modePeriode==="SEMESTRE"?`S${semestreFiltre} ${anneeFiltre}`:modePeriode==="ANNEE"?`${anneeFiltre}`:`${plageDebut} → ${plageFin}`}<button onClick={() => setModePeriode("TOUS")}><X size={9} /></button></span>)}
              </div>
            )}
          </div>
        );
      })()}

      {/* Tableau */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "hsl(var(--muted) / 0.5)", borderBottom: "1px solid hsl(var(--border))" }}>
              {[
                { label: "Collaborateur", w: "w-52" },
                { label: "Motif", w: "w-40" },
                { label: "Période & Durée", w: "" },
                { label: "Progression", w: "w-32" },
                { label: "Fin effective", w: "w-28" },
                { label: "Recon.", w: "w-16 text-center" },
                { label: "Statut", w: "w-28" },
                { label: "", w: "w-24" },
              ].map(h => (
                <th key={h.label} className={`text-left px-4 py-2.5 text-xs font-semibold ${h.w}`}
                  style={{ color: "hsl(var(--muted-foreground))" }}>{h.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={8} className="py-12 text-center text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Chargement…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="py-12 text-center">
                <PauseCircle size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun départ provisoire</p>
              </td></tr>
            ) : filtered.map((dep, i) => {
              const c = (dep as any).collaborateur;
              const m = (dep as any).motif;
              const isActive = dep.statut === "ACTIF";

              // Photo
              const photoRaw = c?.photo_path || c?.photo_url || null;
              const photoUrl = photoRaw ? (photoRaw.startsWith("http") || photoRaw.startsWith("/") ? photoRaw : `/api/v1/storage/${photoRaw}`) : null;

              // Durée et progression
              const totalJours = differenceInDays(parseISO(dep.date_fin_prevue), parseISO(dep.date_debut));
              const joursEcoules = isActive ? Math.min(differenceInDays(new Date(), parseISO(dep.date_debut)), totalJours) : totalJours;
              const pct = totalJours > 0 ? Math.round((joursEcoules / totalJours) * 100) : 0;
              const isOverdue = isActive && new Date() > parseISO(dep.date_fin_prevue);
              const progressColor = isOverdue ? "hsl(0 70% 50%)" : pct > 75 ? "hsl(45 100% 45%)" : "hsl(var(--accent))";

              return (
                <tr key={dep.id}
                  onClick={() => setDetailTarget(dep)}
                  className="cursor-pointer transition-colors"
                  style={{
                    background: i % 2 === 0 ? "hsl(var(--card))" : "hsl(var(--muted) / 0.15)",
                    borderBottom: "1px solid hsl(var(--border) / 0.5)",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = "hsl(var(--accent) / 0.04)")}
                  onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? "hsl(var(--card))" : "hsl(var(--muted) / 0.15)")}
                >
                  {/* Collaborateur */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      {photoUrl ? (
                        <img src={photoUrl} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                          style={{ border: "1.5px solid hsl(var(--border))" }}
                          onError={e => {
                            const el = e.target as HTMLImageElement;
                            el.style.display = "none";
                            const fb = el.nextElementSibling as HTMLElement;
                            if (fb) fb.style.display = "flex";
                          }} />
                      ) : null}
                      <div className={`w-8 h-8 rounded-full items-center justify-center text-[11px] font-bold flex-shrink-0 ${photoUrl ? "hidden" : "flex"}`}
                        style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}>
                        {c?.prenom?.[0]}{c?.nom?.[0]}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-xs truncate" style={{ color: "hsl(var(--foreground))" }}>{c?.prenom} {c?.nom}</p>
                        <p className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>#{c?.matricule}</p>
                      </div>
                    </div>
                  </td>

                  {/* Motif */}
                  <td className="px-4 py-3">
                    <p className="text-xs font-medium" style={{ color: "hsl(var(--foreground))" }}>{m?.libelle || dep.code_motif}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {m?.reconductible && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                          style={{ background: "hsl(210 70% 50% / 0.1)", color: "hsl(210 70% 35%)" }}>
                          Rec.
                        </span>
                      )}
                      {m?.reste_dans_effectif && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                          style={{ background: "hsl(142 55% 45% / 0.1)", color: "hsl(142 55% 30%)" }}>
                          Effectif
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Période & durée */}
                  <td className="px-4 py-3">
                    {/* Période originale → période courante */}
                    {(dep as any)._dateDebutOriginal && (dep as any)._dateDebutOriginal !== dep.date_debut ? (
                      <>
                        <p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                          Depuis le <span style={{ fontWeight: 600, color: "hsl(var(--foreground))" }}>{format(parseISO((dep as any)._dateDebutOriginal), "dd/MM/yyyy")}</span>
                        </p>
                        <p className="text-xs font-medium mt-0.5" style={{ color: "hsl(var(--foreground))" }}>
                          Période en cours : {format(parseISO(dep.date_debut), "dd/MM/yyyy")} → {format(parseISO(dep.date_fin_prevue), "dd/MM/yyyy")}
                        </p>
                      </>
                    ) : (
                      <p className="text-xs font-medium" style={{ color: "hsl(var(--foreground))" }}>
                        {format(parseISO(dep.date_debut), "dd/MM/yyyy")} → {format(parseISO(dep.date_fin_prevue), "dd/MM/yyyy")}
                      </p>
                    )}
                    <p className="text-[11px] mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {totalJours} jour{totalJours > 1 ? "s" : ""}
                      {m?.duree_max_periode_jours && (
                        <span style={{ color: totalJours > m.duree_max_periode_jours ? "hsl(0 70% 45%)" : "hsl(var(--muted-foreground))" }}>
                          {" "}/ {m.duree_max_periode_jours}j max
                        </span>
                      )}
                    </p>
                  </td>

                  {/* Barre de progression */}
                  <td className="px-4 py-3">
                    {isActive ? (
                      <div>
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "hsl(var(--muted))" }}>
                          <div className="h-full rounded-full transition-all"
                            style={{ width: `${Math.min(pct, 100)}%`, background: progressColor }} />
                        </div>
                        <p className="text-[10px] mt-1" style={{ color: isOverdue ? "hsl(0 70% 45%)" : "hsl(var(--muted-foreground))" }}>
                          {isOverdue ? "⚠ Dépassé" : `${pct}% · ${joursEcoules}j écoulés`}
                        </p>
                      </div>
                    ) : (
                      <span className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>—</span>
                    )}
                  </td>

                  {/* Fin effective */}
                  <td className="px-4 py-3 text-xs" style={{ color: dep.date_fin_effective ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))" }}>
                    {dep.date_fin_effective ? format(parseISO(dep.date_fin_effective), "dd/MM/yyyy") : "—"}
                  </td>

                  {/* N° reconduction — affiche période courante / total */}
                  <td className="px-4 py-3 text-center">
                    {(dep as any)._totalPeriodes > 1 ? (
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                        title={`Reconduction n°${dep.numero_reconduction} — ${(dep as any)._totalPeriodes} période(s) au total`}
                        style={{ background: "hsl(210 70% 50% / 0.1)", color: "hsl(210 70% 35%)" }}>
                        {dep.numero_reconduction}/{(dep as any)._totalPeriodes - 1}
                      </span>
                    ) : <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>—</span>}
                  </td>

                  {/* Statut */}
                  <td className="px-4 py-3"><Badge statut={dep.statut} /></td>

                  {/* Actions */}
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setDetailTarget(dep)}
                        className="p-1.5 rounded-lg hover:opacity-70 transition-opacity"
                        style={{ background: "hsl(var(--accent) / 0.1)", color: "hsl(var(--accent))" }}
                        title="Consulter le détail">
                        <Eye size={13} />
                      </button>
                      {isActive && m?.reconductible && (
                        <button onClick={() => { setReconductionTarget(dep); setReconDateFin(""); setReconRef(""); }}
                          className="p-1.5 rounded-lg hover:opacity-70 transition-opacity"
                          style={{ background: "hsl(210 70% 50% / 0.10)", color: "hsl(210 70% 35%)" }}
                          title="Reconduire">
                          <RefreshCw size={13} />
                        </button>
                      )}
                      {isActive && (
                        <button onClick={() => { setReintegrationTarget(dep); setReintDateEffective(new Date().toISOString().split("T")[0]); setReintMotif("RETOUR_NORMAL"); setReintCommentaire(""); setReintRef(""); }}
                          className="p-1.5 rounded-lg hover:opacity-70 transition-opacity"
                          style={{ background: "hsl(142 55% 45% / 0.10)", color: "hsl(142 55% 30%)" }}
                          title="Réintégrer">
                          <UserCheck size={13} />
                        </button>
                      )}
                      {(isActive || dep.statut === "RECONDUIT") && (
                        <button onClick={(e) => { e.stopPropagation(); setAnnulationTarget(dep); setAnnulMotif(""); setAnnulCommentaire(""); }}
                          className="p-1.5 rounded-lg hover:opacity-70 transition-opacity"
                          style={{ background: "hsl(0 70% 50% / 0.08)", color: "hsl(0 70% 40%)" }}
                          title="Annuler ce départ">
                          <Ban size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Formulaire de création */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "hsl(var(--background) / 0.85)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden"
            style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
            <div className="flex items-center justify-between px-6 py-4 border-b"
              style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
              <h2 className="text-base font-bold" style={{ color: "hsl(var(--foreground))" }}>Nouveau départ provisoire</h2>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:opacity-70"
                style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}><X size={16} /></button>
            </div>
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Collab search — même pattern que DepartForm */}
              <div>
                <Label className="text-xs font-semibold mb-1.5 block">Collaborateur *</Label>
                <Input
                  placeholder="Rechercher par nom, prénom ou matricule…"
                  value={formCollabSearch}
                  onChange={e => {
                    setFormCollabSearch(e.target.value);
                    if (formCollabId) setFormCollabId("");
                  }}
                  className="mb-2 h-9 text-sm"
                  autoComplete="off"
                />
                {/* Liste dropdown — apparaît dès 2 caractères ET pas encore sélectionné */}
                {formCollabSearch.trim().length >= 2 && !formCollabId && (
                  <div className="max-h-48 overflow-y-auto rounded-lg border" style={{ borderColor: "hsl(var(--border))" }}>
                    {(collabList as any[]).length === 0 ? (
                      <p className="text-xs text-center py-4" style={{ color: "hsl(var(--muted-foreground))" }}>
                        Aucun collaborateur trouvé
                      </p>
                    ) : (collabList as any[]).map((c: any) => (
                      <button key={c.id} type="button"
                        onClick={() => { setFormCollabId(c.id); setFormCollabSearch(`${c.prenom} ${c.nom}`); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:opacity-80 transition-opacity border-b last:border-0"
                        style={{ borderColor: "hsl(var(--border) / 0.4)", background: "hsl(var(--card))", color: "hsl(var(--foreground))" }}>
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                          style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}>
                          {c.prenom?.[0]}{c.nom?.[0]}
                        </div>
                        <span>{c.prenom} {c.nom}</span>
                        <span className="ml-auto text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>#{c.matricule}</span>
                      </button>
                    ))}
                  </div>
                )}
                {/* Aperçu collab sélectionné */}
                {formCollabId && selectedCollab && (
                  <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg mt-1"
                    style={{ background: "hsl(var(--muted))", border: "1px solid hsl(var(--border))" }}>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}>
                      {(selectedCollab as any).prenom?.[0]}{(selectedCollab as any).nom?.[0]}
                    </div>
                    <span className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>
                      {(selectedCollab as any).prenom} {(selectedCollab as any).nom}
                    </span>
                    <span className="text-xs ml-auto" style={{ color: "hsl(var(--muted-foreground))" }}>
                      #{(selectedCollab as any).matricule}
                    </span>
                    <button onClick={() => { setFormCollabId(""); setFormCollabSearch(""); }} className="ml-1">
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>

              {/* Pavé situation actuelle — même structure que DepartForm */}
              {formCollabId && (() => {
                const c = collabContext?.contrat;
                const a = collabContext?.affectation;
                const ci = collabContext?.collabInfos;
                const ti = getTypeContratInfo(c?.code_type_contrat);
                const si = getStatutInfo(c?.code_statut_contrat);

                // Photo du collaborateur
                const getPhotoUrl = (info: any): string | null => {
                  if (!info) return null;
                  const raw = info.photo_path || info.photo_url || info.avatar_url || info.photo || info.image_url || null;
                  if (!raw) return null;
                  if (raw.startsWith("http") || raw.startsWith("/")) return raw;
                  return `/api/v1/storage/${raw}`;
                };
                const photoUrl = getPhotoUrl(ci);
                const initiales = `${ci?.prenom?.[0] || ""}${ci?.nom?.[0] || ""}`;
                const AvatarEl = ({ size = 32 }: { size?: number }) => photoUrl ? (
                  <img src={photoUrl} alt=""
                    className="rounded-full object-cover flex-shrink-0"
                    style={{ width: size, height: size, border: "1px solid hsl(var(--border))" }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                ) : (
                  <div className="rounded-full flex items-center justify-center font-bold flex-shrink-0"
                    style={{ width: size, height: size, fontSize: size <= 24 ? 10 : 12, background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}>
                    {initiales}
                  </div>
                );

                return (
                  <div className="rounded-xl border overflow-hidden shadow-sm"
                    style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.25)" }}>
                    {/* En-tête */}
                    <div className="px-4 py-2.5 border-b flex items-center justify-between"
                      style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.5)" }}>
                      <div className="flex items-center gap-1.5">
                        <Briefcase size={13} style={{ color: "hsl(var(--accent))" }} />
                        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "hsl(var(--foreground))" }}>
                          Situation actuelle
                        </span>
                      </div>
                      {loadingInfo && <span className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>Chargement…</span>}
                      {contextError && <span className="text-[10px]" style={{ color: "hsl(0 70% 45%)" }}>Erreur de chargement</span>}
                    </div>

                    {/* Identité collaborateur */}
                    {ci && (
                      <div className="flex items-center gap-3 px-4 py-2.5 border-b"
                        style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
                        <AvatarEl size={36} />
                        <div>
                          <p className="text-sm font-semibold leading-tight" style={{ color: "hsl(var(--foreground))" }}>
                            {ci.civilite ? `${ci.civilite} ` : ""}{ci.nom} {ci.prenom}
                          </p>
                          <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>#{ci.matricule}</p>
                        </div>
                      </div>
                    )}

                    {!loadingInfo && (
                      <div className="grid grid-cols-2 divide-x" style={{ borderColor: "hsl(var(--border))" }}>
                        {/* ─ Contrat ─ */}
                        <div className="p-4 space-y-2">
                          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>Contrat</p>
                          {c ? (
                            <>
                              <div className="space-y-1">
                                <p className="text-sm font-bold leading-tight" style={{ color: ti.couleur }} title={c.code_type_contrat}>
                                  {ti.libelle}
                                </p>
                                {c.code_statut_contrat && (
                                  <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider animate-pulse"
                                    style={{ color: si.couleur }}>
                                    <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: si.couleur }} />
                                    {si.libelle}
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] space-y-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                                <p>
                                  Du{" "}<span style={{ color: "hsl(var(--foreground))", fontWeight: 600 }}>
                                    {c.date_debut ? format(parseISO(c.date_debut), "dd/MM/yyyy", { locale: fr }) : "—"}
                                  </span>
                                  {c.date_fin ? <> au <span style={{ color: "hsl(var(--foreground))", fontWeight: 600 }}>{format(parseISO(c.date_fin), "dd/MM/yyyy", { locale: fr })}</span></> : <span className="ml-1 italic">(sans date de fin)</span>}
                                </p>
                                {c.reference_contrat && (
                                  <p className="text-[10px] font-mono pt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{c.reference_contrat}</p>
                                )}
                              </div>
                            </>
                          ) : (
                            <p className="text-xs italic" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun contrat actif</p>
                          )}
                        </div>
                        {/* ─ Affectation ─ */}
                        <div className="p-4 space-y-2">
                          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>Affectation</p>
                          {a ? (
                            <div className="space-y-2">
                              {(a.libelle_uo || a.raw?.unite_id) && (
                                <div>
                                  <div className="flex items-start gap-1.5">
                                    <Building2 size={13} style={{ color: a.couleur_uo || "hsl(var(--accent))", marginTop: 1, flexShrink: 0 }} />
                                    <p className="text-sm font-semibold leading-tight" style={{ color: a.couleur_uo || "hsl(var(--foreground))" }}>
                                      {a.libelle_uo || "Unité organisationnelle"}
                                    </p>
                                  </div>
                                  {a.date_debut_uo && (
                                    <p className="text-[11px] pl-[18px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                                      Affecté(e) le{" "}
                                      <span style={{ color: "hsl(var(--foreground))", fontWeight: 600 }}>
                                        {format(parseISO(a.date_debut_uo), "dd/MM/yyyy", { locale: fr })}
                                      </span>
                                    </p>
                                  )}
                                </div>
                              )}
                              {(a.libelle_poste || a.code_instance_poste) && (
                                <div className="pt-1 border-t" style={{ borderColor: "hsl(var(--border) / 0.5)" }}>
                                  <div className="flex items-start gap-1.5 pt-1">
                                    <UserCircle2 size={13} style={{ color: "hsl(var(--foreground))", marginTop: 1, flexShrink: 0 }} />
                                    <p className="text-xs font-medium leading-tight" style={{ color: "hsl(var(--foreground))" }}>
                                      {a.libelle_poste || a.code_poste_parent || a.code_instance_poste}
                                    </p>
                                  </div>
                                  {a.date_debut_poste && (
                                    <p className="text-[11px] pl-[18px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                                      Attribué(e) le{" "}
                                      <span style={{ color: "hsl(var(--foreground))", fontWeight: 600 }}>
                                        {format(parseISO(a.date_debut_poste), "dd/MM/yyyy", { locale: fr })}
                                      </span>
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            <p className="text-xs italic" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune affectation active</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Motif */}
              <div>
                <Label className="text-xs font-semibold mb-1.5 block">Motif *</Label>
                <select value={formMotif} onChange={e => setFormMotif(e.target.value)}
                  className="w-full h-9 text-sm rounded-lg border px-3"
                  style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
                  <option value="">— Sélectionner —</option>
                  {motifs.map(m => <option key={m.code} value={m.code}>{m.libelle}</option>)}
                </select>
              </div>
              {/* Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs font-semibold mb-1.5 block">Date début *</Label>
                  <Input
                    type="date"
                    value={formDateDebut}
                    onChange={e => setFormDateDebut(e.target.value)}
                    min={collabContext?.contrat?.date_debut || undefined}
                    className="h-9 text-sm" />
                  {/* Avertissement live si date < début contrat en vigueur */}
                  {formDateDebut && collabContext?.contrat?.date_debut && formDateDebut < collabContext.contrat.date_debut && (
                    <p className="text-[11px] mt-1 flex items-center gap-1" style={{ color: "hsl(0 70% 45%)" }}>
                      <AlertTriangle size={11} />
                      Doit être ≥ {format(parseISO(collabContext.contrat.date_debut), "dd/MM/yyyy", { locale: fr })} (début du contrat en vigueur)
                    </p>
                  )}
                </div>
                <div>
                  <Label className="text-xs font-semibold mb-1.5 block">Date fin prévue *</Label>
                  <Input type="date" value={formDateFinPrevue} onChange={e => setFormDateFinPrevue(e.target.value)} className="h-9 text-sm" />
                </div>
              </div>
              {/* Durée info */}
              {formDateDebut && formDateFinPrevue && formMotif && (() => {
                const motif = motifs.find(m => m.code === formMotif);
                const jours = differenceInDays(parseISO(formDateFinPrevue), parseISO(formDateDebut));
                return (
                  <div className="text-xs px-3 py-2 rounded-lg" style={{ background: "hsl(var(--muted) / 0.5)", color: "hsl(var(--muted-foreground))" }}>
                    Durée : <strong>{jours} jours</strong>
                    {motif?.duree_max_periode_jours && <> (max par période : {motif.duree_max_periode_jours}j)</>}
                    {motif?.reconductible && <> · Reconductible{motif.nombre_reconductions_max ? ` (${motif.nombre_reconductions_max} fois max)` : ""}</>}
                    {motif?.reste_dans_effectif ? " · Reste dans l'effectif" : " · Hors effectif"}
                  </div>
                );
              })()}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs font-semibold mb-1.5 block">Référence décision</Label>
                  <Input value={formRefDecision} onChange={e => setFormRefDecision(e.target.value)} className="h-9 text-sm" placeholder="DRH/2026/…" />
                </div>
                <div>
                  <Label className="text-xs font-semibold mb-1.5 block">Date décision</Label>
                  <Input type="date" value={formDateDecision} onChange={e => setFormDateDecision(e.target.value)} className="h-9 text-sm" />
                </div>
              </div>
              <div>
                <Label className="text-xs font-semibold mb-1.5 block">Commentaire</Label>
                <Textarea value={formCommentaire} onChange={e => setFormCommentaire(e.target.value)} rows={2} className="text-sm resize-none" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t" style={{ borderColor: "hsl(var(--border))" }}>
              <Button variant="outline" onClick={() => setShowForm(false)} disabled={submitting}>Annuler</Button>
              <Button
                onClick={handleSubmit}
                disabled={submitting || (!!formDateDebut && !!collabContext?.contrat?.date_debut && formDateDebut < collabContext.contrat.date_debut)}>
                {submitting ? "Enregistrement…" : "Enregistrer"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal reconduction */}
      {reconductionTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "hsl(var(--background) / 0.85)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden"
            style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
            <div className="flex items-center justify-between px-6 py-4 border-b"
              style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
              <h2 className="text-base font-bold" style={{ color: "hsl(var(--foreground))" }}>Reconduction</h2>
              <button onClick={() => setReconductionTarget(null)} className="p-1.5 rounded-lg hover:opacity-70"
                style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}><X size={16} /></button>
            </div>
            <div className="p-6 space-y-4">
              {/* Récap départ */}
              <div className="p-3 rounded-xl space-y-1.5"
                style={{ background: "hsl(210 70% 50% / 0.07)", border: "1px solid hsl(210 70% 50% / 0.2)" }}>
                <p className="text-xs font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                  {reconductionTarget.collaborateur?.prenom} {reconductionTarget.collaborateur?.nom}
                </p>
                <p className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                  {reconductionTarget.motif?.libelle || reconductionTarget.code_motif}
                  {" · "}Reconduction n°<strong>{reconductionTarget.numero_reconduction + 1}</strong>
                  {reconductionTarget.motif?.nombre_reconductions_max && (
                    <span style={{ color: reconductionTarget.numero_reconduction + 1 >= (reconductionTarget.motif?.nombre_reconductions_max ?? Infinity) ? "hsl(0 70% 45%)" : "inherit" }}>
                      {" "}/ {reconductionTarget.motif.nombre_reconductions_max} max
                    </span>
                  )}
                </p>
                <p className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Nouvelle période à partir du <strong>{format(parseISO(reconductionTarget.date_fin_prevue), "dd/MM/yyyy", { locale: fr })}</strong>
                </p>
                {reconductionTarget.motif?.duree_globale_max_jours && (
                  <p className="text-[11px]" style={{ color: "hsl(38 92% 40%)" }}>
                    ⚠ Durée globale max : {reconductionTarget.motif.duree_globale_max_jours} jours tous cycles confondus
                  </p>
                )}
              </div>
              <div>
                <Label className="text-xs font-semibold mb-1.5 block">Nouvelle date de fin *</Label>
                <Input type="date" value={reconDateFin} onChange={e => setReconDateFin(e.target.value)} className="h-9 text-sm"
                  min={reconductionTarget.date_fin_prevue ? (() => {
                    const d = new Date(reconductionTarget.date_fin_prevue);
                    d.setDate(d.getDate() + 1);
                    return d.toISOString().split("T")[0];
                  })() : undefined} />
                {reconDateFin && reconDateFin <= reconductionTarget.date_fin_prevue && (
                  <p className="text-[11px] mt-1 flex items-center gap-1" style={{ color: "hsl(0 70% 45%)" }}>
                    <AlertTriangle size={11} />
                    Doit être postérieure au {format(parseISO(reconductionTarget.date_fin_prevue), "dd/MM/yyyy", { locale: fr })}
                  </p>
                )}
              </div>
              <div>
                <Label className="text-xs font-semibold mb-1.5 block">Référence décision</Label>
                <Input value={reconRef} onChange={e => setReconRef(e.target.value)} className="h-9 text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t" style={{ borderColor: "hsl(var(--border))" }}>
              <Button variant="outline" onClick={() => setReconductionTarget(null)} disabled={submitting}>Annuler</Button>
              <Button onClick={handleReconduction} disabled={submitting || !reconDateFin || (!!reconDateFin && !!reconductionTarget && reconDateFin <= reconductionTarget.date_fin_prevue)}>
                {submitting ? "…" : "Reconduire"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal réintégration enrichi */}
      {reintegrationTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "hsl(var(--background) / 0.85)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"
            style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
            <div className="flex items-center justify-between px-6 py-4 border-b"
              style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
              <div className="flex items-center gap-2">
                <UserCheck size={16} style={{ color: "hsl(142 55% 40%)" }} />
                <h2 className="text-base font-bold" style={{ color: "hsl(var(--foreground))" }}>Réintégration</h2>
              </div>
              <button onClick={() => setReintegrationTarget(null)} className="p-1.5 rounded-lg hover:opacity-70"
                style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}><X size={16} /></button>
            </div>
            <div className="p-6 space-y-4">
              {/* Récap collaborateur */}
              <div className="flex items-center gap-3 p-3 rounded-xl"
                style={{ background: "hsl(142 55% 45% / 0.08)", border: "1px solid hsl(142 55% 45% / 0.2)" }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ background: "hsl(142 55% 45% / 0.15)", color: "hsl(142 55% 30%)" }}>
                  {reintegrationTarget.collaborateur?.prenom?.[0]}{reintegrationTarget.collaborateur?.nom?.[0]}
                </div>
                <div>
                  <p className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                    {reintegrationTarget.collaborateur?.prenom} {reintegrationTarget.collaborateur?.nom}
                  </p>
                  <p className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Départ : {format(parseISO(reintegrationTarget.date_debut), "dd/MM/yyyy", { locale: fr })} → {format(parseISO(reintegrationTarget.date_fin_prevue), "dd/MM/yyyy", { locale: fr })}
                    {" · "}{reintegrationTarget.motif?.libelle || reintegrationTarget.code_motif}
                  </p>
                </div>
              </div>
              <div>
                <Label className="text-xs font-semibold mb-1.5 block">Date effective de réintégration *</Label>
                <Input type="date" value={reintDateEffective} onChange={e => setReintDateEffective(e.target.value)} className="h-9 text-sm"
                  min={reintegrationTarget.date_debut} />
                {reintDateEffective && reintDateEffective < reintegrationTarget.date_debut && (
                  <p className="text-[11px] mt-1 flex items-center gap-1" style={{ color: "hsl(0 70% 45%)" }}>
                    <AlertTriangle size={11} /> Doit être ≥ {format(parseISO(reintegrationTarget.date_debut), "dd/MM/yyyy", { locale: fr })}
                  </p>
                )}
              </div>
              <div>
                <Label className="text-xs font-semibold mb-1.5 block">Motif de réintégration</Label>
                <select value={reintMotif} onChange={e => setReintMotif(e.target.value)}
                  className="w-full h-9 text-sm rounded-lg border px-3"
                  style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
                  <option value="RETOUR_NORMAL">Retour normal (fin de période)</option>
                  <option value="RETOUR_ANTICIPE">Retour anticipé</option>
                  <option value="RETOUR_MEDICAL">Retour suite avis médical</option>
                  <option value="RETOUR_DISCIPLINAIRE">Retour suite décision disciplinaire</option>
                  <option value="AUTRE">Autre</option>
                </select>
              </div>
              <div>
                <Label className="text-xs font-semibold mb-1.5 block">Référence décision</Label>
                <Input value={reintRef} onChange={e => setReintRef(e.target.value)} className="h-9 text-sm" placeholder="DRH/2026/…" />
              </div>
              <div>
                <Label className="text-xs font-semibold mb-1.5 block">Commentaire</Label>
                <textarea value={reintCommentaire} onChange={e => setReintCommentaire(e.target.value)} rows={2}
                  className="w-full rounded-lg border px-3 py-2 text-sm resize-none"
                  style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}
                  placeholder="Observations sur la réintégration…" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t" style={{ borderColor: "hsl(var(--border))" }}>
              <Button variant="outline" onClick={() => setReintegrationTarget(null)} disabled={submitting}>Annuler</Button>
              <Button onClick={handleReintegration}
                disabled={submitting || !reintDateEffective || (!!reintDateEffective && reintDateEffective < reintegrationTarget.date_debut)}
                style={{ background: "hsl(142 55% 40%)", color: "white" }}>
                {submitting ? "Traitement…" : "Confirmer la réintégration"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal annulation avec motif */}
      {annulationTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "hsl(var(--background) / 0.85)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden"
            style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
            <div className="flex items-center justify-between px-6 py-4 border-b"
              style={{ borderColor: "hsl(var(--border))", background: "hsl(0 70% 50% / 0.06)" }}>
              <div className="flex items-center gap-2">
                <Ban size={15} style={{ color: "hsl(0 70% 45%)" }} />
                <h2 className="text-base font-bold" style={{ color: "hsl(var(--foreground))" }}>Annuler le départ</h2>
              </div>
              <button onClick={() => setAnnulationTarget(null)} className="p-1.5 rounded-lg hover:opacity-70"
                style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}><X size={16} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-start gap-2 p-3 rounded-xl"
                style={{ background: "hsl(0 70% 50% / 0.06)", border: "1px solid hsl(0 70% 50% / 0.15)" }}>
                <AlertTriangle size={14} style={{ color: "hsl(0 70% 45%)", marginTop: 1, flexShrink: 0 }} />
                <p className="text-xs leading-relaxed" style={{ color: "hsl(0 70% 40%)" }}>
                  Cette action est irréversible. {annulationTarget.statut === "ACTIF" ? "Le collaborateur sera remis en statut ACTIF." : ""}
                </p>
              </div>
              <div>
                <Label className="text-xs font-semibold mb-1.5 block">Motif d'annulation *</Label>
                <select value={annulMotif} onChange={e => setAnnulMotif(e.target.value)}
                  className="w-full h-9 text-sm rounded-lg border px-3"
                  style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
                  <option value="">— Sélectionner —</option>
                  <option value="ERREUR_SAISIE">Erreur de saisie</option>
                  <option value="ACCORD_PARTIES">Accord des parties</option>
                  <option value="DECISION_DIRECTION">Décision de la direction</option>
                  <option value="MOTIF_CADUC">Motif devenu caduc</option>
                  <option value="AUTRE">Autre</option>
                </select>
              </div>
              <div>
                <Label className="text-xs font-semibold mb-1.5 block">Commentaire</Label>
                <textarea value={annulCommentaire} onChange={e => setAnnulCommentaire(e.target.value)} rows={2}
                  className="w-full rounded-lg border px-3 py-2 text-sm resize-none"
                  style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}
                  placeholder="Précisez la raison de l'annulation…" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t" style={{ borderColor: "hsl(var(--border))" }}>
              <Button variant="outline" onClick={() => setAnnulationTarget(null)} disabled={submitting}>Retour</Button>
              <Button onClick={handleAnnulation} disabled={submitting || !annulMotif}
                style={{ background: "hsl(0 70% 45%)", color: "white" }}>
                {submitting ? "…" : "Confirmer l'annulation"}
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* ─── Popup détail départ provisoire ─────────────────────────── */}
      {detailTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "hsl(var(--background) / 0.82)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden"
            style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b"
              style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.35)" }}>
              <div className="flex items-center gap-2">
                <PauseCircle size={17} style={{ color: "hsl(var(--accent))" }} />
                <h2 className="text-base font-bold" style={{ color: "hsl(var(--foreground))" }}>
                  Détail du départ provisoire
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => { navigate(`/collaborateurs/${detailTarget.collaborateur_id}`); setDetailTarget(null); }}
                  className="text-xs px-3 py-1.5 rounded-lg border font-medium hover:opacity-80 transition-opacity"
                  style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--accent))" }}>
                  Voir la fiche
                </button>
                <button onClick={() => setDetailTarget(null)}
                  className="p-1.5 rounded-lg hover:opacity-70 transition-opacity"
                  style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                  <X size={15} />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto" style={{ maxHeight: "75vh" }}>
              {detailLoading ? (
                <div className="flex items-center justify-center py-16">
                  <span className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Chargement…</span>
                </div>
              ) : (() => {
                const ci = detailContext?.ci;
                const c = detailContext?.contrat;
                const a = detailContext?.affectation;
                const reconductions = detailContext?.reconductions || [];
                const ti = getTypeContratInfo(c?.code_type_contrat);
                const si = getStatutInfo(c?.code_statut_contrat);
                const motifInfo = motifs.find(m => m.code === detailTarget.code_motif);

                // Photo
                const photoRaw = ci?.photo_path || ci?.photo_url || ci?.avatar_url || null;
                const photoUrl = photoRaw ? (photoRaw.startsWith("http") || photoRaw.startsWith("/") ? photoRaw : `/api/v1/storage/${photoRaw}`) : null;
                const initiales = `${ci?.prenom?.[0] || ""}${ci?.nom?.[0] || ""}`;

                return (
                  <div className="p-6 space-y-5">

                    {/* ── Bloc collaborateur ── */}
                    <div className="flex items-center gap-4 p-4 rounded-xl border"
                      style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.25)" }}>
                      {photoUrl ? (
                        <img src={photoUrl} alt="" className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                          style={{ border: "2px solid hsl(var(--border))" }}
                          onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      ) : (
                        <div className="w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                          style={{ background: "hsl(var(--primary) / 0.12)", color: "hsl(var(--primary))" }}>
                          {initiales}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-base font-bold leading-tight" style={{ color: "hsl(var(--foreground))" }}>
                          {ci?.civilite ? `${ci.civilite} ` : ""}{ci?.nom} {ci?.prenom}
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>#{ci?.matricule}</p>
                      </div>
                      <Badge statut={detailTarget.statut} />
                    </div>

                    {/* ── Infos départ ── */}
                    <div className="rounded-xl border overflow-hidden"
                      style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.15)" }}>
                      <div className="px-4 py-2.5 border-b"
                        style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.4)" }}>
                        <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "hsl(var(--foreground))" }}>Départ provisoire</p>
                      </div>
                      <div className="grid grid-cols-2 gap-4 p-4">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Motif</p>
                          <p className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>{motifInfo?.libelle || detailTarget.code_motif}</p>
                          <div className="flex flex-wrap gap-2 mt-1.5">
                            {motifInfo?.reconductible && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                                style={{ background: "hsl(200 70% 50% / 0.12)", color: "hsl(200 70% 35%)" }}>
                                Reconductible ({motifInfo.nombre_reconductions_max ?? "∞"} max)
                              </span>
                            )}
                            {motifInfo?.reste_dans_effectif && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                                style={{ background: "hsl(142 55% 45% / 0.12)", color: "hsl(142 55% 30%)" }}>
                                Dans l'effectif
                              </span>
                            )}
                            {motifInfo?.duree_max_periode_jours && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                                style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                                Max {motifInfo.duree_max_periode_jours}j / période
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Période</p>
                            <p className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>
                              {format(parseISO(detailTarget.date_debut), "dd/MM/yyyy", { locale: fr })}
                              {" → "}
                              {format(parseISO(detailTarget.date_fin_prevue), "dd/MM/yyyy", { locale: fr })}
                            </p>
                            <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                              {differenceInDays(parseISO(detailTarget.date_fin_prevue), parseISO(detailTarget.date_debut))} jours
                              {detailTarget.date_fin_effective && (
                                <> · Fin effective : <span style={{ color: "hsl(var(--foreground))" }}>{format(parseISO(detailTarget.date_fin_effective), "dd/MM/yyyy", { locale: fr })}</span></>
                              )}
                            </p>
                          </div>
                          {detailTarget.reference_decision && (
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Réf. décision</p>
                              <p className="text-xs font-mono" style={{ color: "hsl(var(--foreground))" }}>{detailTarget.reference_decision}</p>
                            </div>
                          )}
                          {detailTarget.date_decision && (
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Date décision</p>
                              <p className="text-xs" style={{ color: "hsl(var(--foreground))" }}>{format(parseISO(detailTarget.date_decision), "dd/MM/yyyy", { locale: fr })}</p>
                            </div>
                          )}
                        </div>
                        {detailTarget.commentaire && (
                          <div className="col-span-2 pt-2 border-t" style={{ borderColor: "hsl(var(--border))" }}>
                            <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Commentaire</p>
                            <p className="text-xs leading-relaxed" style={{ color: "hsl(var(--foreground))" }}>{detailTarget.commentaire}</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* ── Situation actuelle (contrat + affectation) ── */}
                    <div className="rounded-xl border overflow-hidden"
                      style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.15)" }}>
                      <div className="px-4 py-2.5 border-b"
                        style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.4)" }}>
                        <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "hsl(var(--foreground))" }}>Situation au moment du départ</p>
                      </div>
                      <div className="grid grid-cols-2 divide-x" style={{ borderColor: "hsl(var(--border))" }}>
                        {/* Contrat */}
                        <div className="p-4 space-y-2">
                          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>Contrat</p>
                          {c ? (
                            <>
                              <p className="text-sm font-bold" style={{ color: ti.couleur }}>{ti.libelle}</p>
                              {c.code_statut_contrat && (
                                <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider"
                                  style={{ color: si.couleur }}>
                                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: si.couleur }} />
                                  {si.libelle}
                                </span>
                              )}
                              <p className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                                Du <span style={{ color: "hsl(var(--foreground))", fontWeight: 600 }}>
                                  {c.date_debut ? format(parseISO(c.date_debut), "dd/MM/yyyy", { locale: fr }) : "—"}
                                </span>
                                {c.date_fin && <> au <span style={{ color: "hsl(var(--foreground))", fontWeight: 600 }}>{format(parseISO(c.date_fin), "dd/MM/yyyy", { locale: fr })}</span></>}
                              </p>
                            </>
                          ) : <p className="text-xs italic" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun contrat actif</p>}
                        </div>
                        {/* Affectation */}
                        <div className="p-4 space-y-2">
                          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>Affectation</p>
                          {a ? (
                            <>
                              <div className="flex items-start gap-1.5">
                                <Building2 size={13} style={{ color: a.couleur_uo || "hsl(var(--accent))", marginTop: 1, flexShrink: 0 }} />
                                <p className="text-sm font-semibold" style={{ color: a.couleur_uo || "hsl(var(--foreground))" }}>{a.libelle_uo || "—"}</p>
                              </div>
                              {a.date_debut_uo && (
                                <p className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                                  Depuis le <span style={{ color: "hsl(var(--foreground))", fontWeight: 600 }}>{format(parseISO(a.date_debut_uo), "dd/MM/yyyy", { locale: fr })}</span>
                                </p>
                              )}
                              {a.libelle_poste && (
                                <div className="pt-1 border-t" style={{ borderColor: "hsl(var(--border) / 0.5)" }}>
                                  <div className="flex items-center gap-1.5 pt-1">
                                    <UserCircle2 size={13} style={{ color: "hsl(var(--muted-foreground))", flexShrink: 0 }} />
                                    <p className="text-xs font-medium" style={{ color: "hsl(var(--foreground))" }}>{a.libelle_poste}</p>
                                  </div>
                                </div>
                              )}
                            </>
                          ) : <p className="text-xs italic" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune affectation active</p>}
                        </div>
                      </div>
                    </div>

                    {/* ── Historique des reconductions enrichi + durée globale ── */}
                    {reconductions.length >= 1 && (
                      <div className="rounded-xl border overflow-hidden"
                        style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.15)" }}>
                        <div className="px-4 py-2.5 border-b flex items-center justify-between"
                          style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.4)" }}>
                          <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "hsl(var(--foreground))" }}>
                            {reconductions.length > 1 ? `Historique des périodes (${reconductions.length})` : "Période"}
                          </p>
                          {(() => {
                            const dureesBrutes = reconductions.map((r: any) => differenceInDays(parseISO(r.date_fin_prevue), parseISO(r.date_debut)));
                            const hasIncoherence = dureesBrutes.some((d: number) => d < 0);
                            const totalCumul = dureesBrutes.filter((d: number) => d >= 0).reduce((acc: number, d: number) => acc + d, 0);
                            return (
                              <span className="text-[11px] font-semibold flex items-center gap-1.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                                {hasIncoherence && (
                                  <span title="Certaines périodes ont des dates incohérentes en base et sont exclues du calcul">
                                    <AlertTriangle size={11} style={{ color: "hsl(38 92% 45%)" }} />
                                  </span>
                                )}
                                Cumul : <strong style={{ color: "hsl(var(--foreground))" }}>{totalCumul}j</strong>
                                {motifInfo?.duree_globale_max_jours && (
                                  <span style={{ color: totalCumul > motifInfo.duree_globale_max_jours ? "hsl(0 70% 45%)" : "hsl(var(--muted-foreground))" }}>
                                    {" "}/ {motifInfo.duree_globale_max_jours}j max
                                  </span>
                                )}
                              </span>
                            );
                          })()}
                        </div>
                        {/* Barre de durée globale */}
                        {motifInfo?.duree_globale_max_jours && (() => {
                          const totalCumul = reconductions
                            .map((r: any) => differenceInDays(parseISO(r.date_fin_prevue), parseISO(r.date_debut)))
                            .filter((d: number) => d >= 0)
                            .reduce((acc: number, d: number) => acc + d, 0);
                          const pctGlobal = Math.max(0, Math.min(Math.round((totalCumul / motifInfo.duree_globale_max_jours) * 100), 100));
                          const colorGlobal = pctGlobal >= 100 ? "hsl(0 70% 50%)" : pctGlobal >= 80 ? "hsl(38 92% 45%)" : "hsl(142 55% 45%)";
                          return (
                            <div className="px-4 py-2 border-b" style={{ borderColor: "hsl(var(--border))" }}>
                              <div className="h-2 rounded-full overflow-hidden" style={{ background: "hsl(var(--muted))" }}>
                                <div className="h-full rounded-full transition-all" style={{ width: `${pctGlobal}%`, background: colorGlobal }} />
                              </div>
                              <p className="text-[10px] mt-1" style={{ color: colorGlobal }}>
                                {pctGlobal}% de la durée globale autorisée utilisée
                              </p>
                            </div>
                          );
                        })()}
                        {/* Timeline verticale */}
                        <div className="p-4 space-y-0">
                          {reconductions.map((r: any, idx: number) => {
                            const duree = differenceInDays(parseISO(r.date_fin_prevue), parseISO(r.date_debut));
                            const isDateIncoherente = duree < 0;
                            const isLast = idx === reconductions.length - 1;
                            return (
                              <div key={r.id} className="relative flex gap-3">
                                {/* Ligne verticale */}
                                {!isLast && (
                                  <div className="absolute left-[11px] top-6 bottom-0 w-0.5" style={{ background: "hsl(var(--border))" }} />
                                )}
                                {/* Dot */}
                                <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 z-10 text-[9px] font-bold"
                                  style={{ background: idx === 0 ? "hsl(var(--primary) / 0.15)" : "hsl(210 70% 50% / 0.15)", color: idx === 0 ? "hsl(var(--primary))" : "hsl(210 70% 35%)", border: `1.5px solid ${idx === 0 ? "hsl(var(--primary) / 0.4)" : "hsl(210 70% 50% / 0.3)"}` }}>
                                  {idx === 0 ? "•" : idx}
                                </div>
                                <div className="flex-1 pb-4">
                                  <div className="flex items-baseline gap-2 flex-wrap">
                                    <span className="text-xs font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                                      {idx === 0 ? "Départ initial" : `Reconduction ${idx}`}
                                    </span>
                                    <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                                      {format(parseISO(r.date_debut), "dd/MM/yyyy", { locale: fr })} → {format(parseISO(r.date_fin_prevue), "dd/MM/yyyy", { locale: fr })}
                                    </span>
                                    {isDateIncoherente ? (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-1"
                                        title="Date de fin antérieure à la date de début — données incohérentes en base, exclues du cumul"
                                        style={{ background: "hsl(38 92% 50% / 0.12)", color: "hsl(38 92% 35%)" }}>
                                        <AlertTriangle size={9} />⚠ Dates incohérentes
                                      </span>
                                    ) : (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                                        style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                                        {duree}j
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 mt-1">
                                    <Badge statut={r.statut} />
                                    {r.reference_decision && (
                                      <span className="text-[10px] font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>
                                        {r.reference_decision}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                  </div>
                );
              })()}
            </div>

            {/* Footer */}
            <div className="flex justify-end px-6 py-4 border-t" style={{ borderColor: "hsl(var(--border))" }}>
              <Button variant="outline" onClick={() => setDetailTarget(null)}>Fermer</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DepartsProvisoiresPage;
