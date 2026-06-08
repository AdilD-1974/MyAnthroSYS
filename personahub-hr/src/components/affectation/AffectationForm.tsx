import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useChainCollaborateurIds } from "@/hooks/useChainCollaborateurIds";
import { Plus, Pencil, Trash2, Save, Building2, Hash, Search, ChevronDown, UserCheck, X, ToggleRight, Users, RotateCcw, ChevronRight } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const fmt = (d?: string | null) => d ? new Date(d).toLocaleDateString("fr-FR") : "—";

interface Affectation {
  id: string;
  collaborateur_id: string;
  unite_id?: string | null;
  date_debut_uo: string;
  date_fin_uo?: string | null;
  code_poste?: string | null;
  date_debut_poste?: string | null;
  date_fin_poste?: string | null;
  motif_affectation?: string | null;
  commentaire?: string | null;
  responsable_id?: string | null;
  forcage_manager?: boolean;
  manager_n1_id?: string | null;
  manager_n2_id?: string | null;
  _from_ancien?: string;
}

type AffectationFormData = Omit<Affectation, "id" | "collaborateur_id" | "_from_ancien">;

const EMPTY: AffectationFormData = {
  unite_id: "",
  date_debut_uo: "",
  date_fin_uo: "",
  code_poste: "",
  date_debut_poste: "",
  date_fin_poste: "",
  motif_affectation: "",
  commentaire: "",
  responsable_id: "",
  forcage_manager: false,
  manager_n1_id: "",
  manager_n2_id: "",
};

/* ── FI : champ texte/date ── */
const FI: React.FC<{
  label: string; value: string; onChange: (v: string) => void;
  type?: string; required?: boolean; className?: string;
}> = ({ label, value, onChange, type = "text", required, className }) => (
  <div className={className}>
    <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
      {label}{required && <span style={{ color: "hsl(0 84% 55%)" }}> *</span>}
    </label>
    <input
      type={type} value={value || ""} onChange={e => onChange(e.target.value)}
      className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
      style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))", height: 38 }}
    />
  </div>
);

/* ── FieldView ── */
const FieldView: React.FC<{ label: string; value?: string | null; className?: string }> = ({ label, value, className }) => (
  <div className={className}>
    <p className="text-xs font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</p>
    <p className="text-sm" style={{ color: value ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground) / 0.4)" }}>
      {value || "—"}
    </p>
  </div>
);

/* ── DropSel : dropdown avec recherche ── */
const DropSel: React.FC<{
  value: string; onChange: (v: string) => void; label?: string; required?: boolean;
  options: { value: string; label: string; meta?: string }[];
  placeholder?: string; disabled?: boolean;
}> = ({ value, onChange, label, required, options, placeholder = "— Sélectionner —", disabled }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setSearch(""); }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = options.filter(o =>
    o.label.toLowerCase().includes(search.toLowerCase()) ||
    (o.meta || "").toLowerCase().includes(search.toLowerCase())
  );
  const selected = options.find(o => o.value === value);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {label && (
        <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
          {label}{required && <span style={{ color: "hsl(0 84% 55%)" }}> *</span>}
        </label>
      )}
      <button
        type="button" disabled={disabled}
        onClick={() => { if (!disabled) { setOpen(o => !o); setSearch(""); } }}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm outline-none text-left"
        style={{
          borderColor: open ? "hsl(var(--accent))" : "hsl(var(--border))",
          background: disabled ? "hsl(var(--muted)/0.3)" : "hsl(var(--background))",
          color: selected ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
          minHeight: 38, cursor: disabled ? "not-allowed" : "pointer",
          boxShadow: open ? "0 0 0 2px hsl(var(--accent) / 0.2)" : "none",
        }}
      >
        <span className="truncate">{selected?.label || placeholder}</span>
        <ChevronDown size={14} style={{ color: "hsl(var(--muted-foreground))", transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.15s", flexShrink: 0, marginLeft: 6 }} />
      </button>
      {open && (
        <div className="absolute z-50 w-full rounded-lg border shadow-lg mt-1"
          style={{ background: "hsl(var(--popover))", borderColor: "hsl(var(--border))", boxShadow: "0 8px 24px hsl(0 0% 0% / 0.12)", maxHeight: 280, display: "flex", flexDirection: "column" }}>
          <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: "hsl(var(--border))" }}>
            <Search size={13} style={{ color: "hsl(var(--muted-foreground))", flexShrink: 0 }} />
            <input autoFocus type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher..." className="flex-1 text-sm outline-none bg-transparent"
              style={{ color: "hsl(var(--foreground))" }} />
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
            <button type="button" onClick={() => { onChange(""); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
              — Sélectionner —
            </button>
            {filtered.map(opt => (
              <button key={opt.value} type="button"
                onClick={() => { onChange(opt.value); setOpen(false); setSearch(""); }}
                className="w-full text-left px-3 py-2 text-sm transition-colors"
                style={{
                  background: opt.value === value ? "hsl(var(--accent) / 0.12)" : "transparent",
                  color: opt.value === value ? "hsl(var(--accent))" : "hsl(var(--foreground))",
                  fontWeight: opt.value === value ? 600 : 400,
                }}>
                {opt.meta && <span className="text-xs mr-2" style={{ color: "hsl(var(--muted-foreground))" }}>{opt.meta}</span>}
                {opt.label}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="text-xs text-center py-4" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun résultat</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface Props { collaborateurId: string; ancienMatricule?: string }

const AffectationFormComponent: React.FC<Props> = ({ collaborateurId, ancienMatricule }) => {
  const [affectations, setAffectations] = useState<Affectation[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Affectation | null>(null);
  const [form, setForm] = useState<AffectationFormData>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [dateErreur, setDateErreur] = useState<string | null>(null);
  const [dateContratMin, setDateContratMin] = useState<string | null>(null);
  const [qualifWarning, setQualifWarning] = useState<string | null>(null);

  const [uoMap, setUoMap] = useState<Record<string, string>>({});
  const [uoOptions, setUoOptions] = useState<{ value: string; label: string; meta?: string }[]>([]);
  const [motifMap, setMotifMap] = useState<Record<string, string>>({});
  // RG-AFFECT-ACCORDION-01 (Adil DAIA — 07/05/2026) : accordéon des cartes
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAll = (allIds: string[]) => {
    setExpandedIds(prev => prev.size === allIds.length ? new Set() : new Set(allIds));
  };
  const [motifOptions, setMotifOptions] = useState<{ value: string; label: string }[]>([]);
  const [posteMap, setPosteMap] = useState<Record<string, string>>({});
  const [instanceOptionsForUO, setInstanceOptionsForUO] = useState<{ value: string; label: string; meta?: string }[]>([]);

  const [responsableInfo, setResponsableInfo] = useState<{ id: string; matricule: string; nom: string; prenom: string } | null>(null);
  const [responsableSearch, setResponsableSearch] = useState("");
  const [responsableSuggestions, setResponsableSuggestions] = useState<{ id: string; matricule: string; nom: string; prenom: string }[]>([]);
  const [responsableSearchOpen, setResponsableSearchOpen] = useState(false);
  const [collaborateurMap, setCollaborateurMap] = useState<Record<string, { matricule: string; nom: string; prenom: string }>>({});

  const [managerN1Info, setManagerN1Info] = useState<{ id: string; matricule: string; nom: string; prenom: string } | null>(null);
  const [managerN1Search, setManagerN1Search] = useState("");
  const [managerN1Suggestions, setManagerN1Suggestions] = useState<{ id: string; matricule: string; nom: string; prenom: string }[]>([]);
  const [managerN1SearchOpen, setManagerN1SearchOpen] = useState(false);

  const [managerN2Info, setManagerN2Info] = useState<{ id: string; matricule: string; nom: string; prenom: string } | null>(null);
  const [managerN2Search, setManagerN2Search] = useState("");
  const [managerN2Suggestions, setManagerN2Suggestions] = useState<{ id: string; matricule: string; nom: string; prenom: string }[]>([]);
  const [managerN2SearchOpen, setManagerN2SearchOpen] = useState(false);

  // Charger les instances vacantes par UO
  useEffect(() => {
    if (!form.unite_id) { setInstanceOptionsForUO([]); return; }
    supabase.from("ref_poste" as never)
      .select("code, libelle")
      .eq("unite_id" as never, form.unite_id as never)
      .eq("actif" as never, true as never)
      .then(async ({ data: postesData }) => {
        const postes = (postesData as any[]) || [];
        if (postes.length === 0) { setInstanceOptionsForUO([]); return; }
        const codes = postes.map((p: any) => p.code);
        const libelleMap: Record<string, string> = {};
        postes.forEach((p: any) => { libelleMap[p.code] = p.libelle; });

        const { data: instData } = await (supabase.from("ref_poste_instances" as never)
          .select("id, code_poste, code_instance, code_etat")
          .in("code_poste" as never, codes as never)
          .eq("code_etat" as never, "VA" as never) as any);

        const opts = ((instData as any[]) || []).map((inst: any) => ({
          value: inst.code_instance,
          label: `${libelleMap[inst.code_poste] || inst.code_poste}`,
          meta: inst.code_instance,
        }));
        setInstanceOptionsForUO(opts);
      });
  }, [form.unite_id]);

  // Auto-remplir le responsable quand un poste est sélectionné
  useEffect(() => {
    if (!form.code_poste) return;
    supabase.from("collaborateur_affectations")
      .select("collaborateur_id")
      .eq("code_poste", form.code_poste)
      .is("date_fin_poste", null)
      .eq("archive", false)
      .neq("collaborateur_id", collaborateurId)
      .maybeSingle()
      .then(async ({ data }) => {
        if ((data as any)?.collaborateur_id) {
          const { data: collab } = await supabase
            .from("collaborateurs")
            .select("id, matricule, nom, prenom")
            .eq("id", (data as any).collaborateur_id)
            .maybeSingle();
          if (collab) {
            const c = collab as any;
            setResponsableInfo({ id: c.id, matricule: c.matricule, nom: c.nom, prenom: c.prenom });
            setForm(f => ({ ...f, responsable_id: c.id }));
          }
        }
      });
  }, [form.code_poste]);

  // Vérifier les qualifications du collaborateur vs celles requises par le poste
  useEffect(() => {
    setQualifWarning(null);
    if (!form.code_poste) return;
    const codePosteParent = form.code_poste.includes("-")
      ? form.code_poste.split("-").slice(0, -1).join("-")
      : form.code_poste;

    (async () => {
      const { data: posteData } = await (supabase.from("ref_poste" as never)
        .select("qualifications_requises, code_emploi, code_classification" as never)
        .eq("code" as never, codePosteParent as never)
        .maybeSingle() as any);
      if (!posteData) return;
      const qualReq = (posteData as any).qualifications_requises;
      if (qualReq && qualReq.trim()) {
        const { data: collabQualifs } = await supabase
          .from("collaborateur_qualifications")
          .select("id")
          .eq("collaborateur_id", collaborateurId);
        if (!collabQualifs || collabQualifs.length === 0) {
          setQualifWarning(`Qualifications requises pour ce poste : ${qualReq}. Le collaborateur n'a aucune qualification enregistrée.`);
        }
      }
    })();
  }, [form.code_poste, collaborateurId]);

  // Recherche de responsable (debounce 300ms)
  useEffect(() => {
    if (responsableSearch.length < 2) { setResponsableSuggestions([]); return; }
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from("collaborateurs")
        .select("id, matricule, nom, prenom")
        .eq("archive", false)
        .or(`matricule.ilike.%${responsableSearch}%,nom.ilike.%${responsableSearch}%,prenom.ilike.%${responsableSearch}%`)
        .limit(10);
      setResponsableSuggestions(((data as any[]) || []).map((c: any) => ({ id: c.id, matricule: c.matricule, nom: c.nom, prenom: c.prenom })));
    }, 300);
    return () => clearTimeout(timer);
  }, [responsableSearch]);

  // Recherche N+1
  useEffect(() => {
    if (managerN1Search.length < 2) { setManagerN1Suggestions([]); return; }
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from("collaborateurs")
        .select("id, matricule, nom, prenom")
        .eq("archive", false)
        .or(`matricule.ilike.%${managerN1Search}%,nom.ilike.%${managerN1Search}%,prenom.ilike.%${managerN1Search}%`)
        .limit(10);
      setManagerN1Suggestions(((data as any[]) || []).map((c: any) => ({ id: c.id, matricule: c.matricule, nom: c.nom, prenom: c.prenom })));
    }, 300);
    return () => clearTimeout(timer);
  }, [managerN1Search]);

  // Recherche N+2
  useEffect(() => {
    if (managerN2Search.length < 2) { setManagerN2Suggestions([]); return; }
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from("collaborateurs")
        .select("id, matricule, nom, prenom")
        .eq("archive", false)
        .or(`matricule.ilike.%${managerN2Search}%,nom.ilike.%${managerN2Search}%,prenom.ilike.%${managerN2Search}%`)
        .limit(10);
      setManagerN2Suggestions(((data as any[]) || []).map((c: any) => ({ id: c.id, matricule: c.matricule, nom: c.nom, prenom: c.prenom })));
    }, 300);
    return () => clearTimeout(timer);
  }, [managerN2Search]);

  // Résolution récursive de la chaîne d'anciens matricules (N niveaux)
  const { chainIds, chainCollabs } = useChainCollaborateurIds(collaborateurId, ancienMatricule);

  React.useEffect(() => { loadAll(); }, [chainIds.join(",")]);

  const loadAll = async () => {
    if (chainIds.length === 0) return;
    setLoading(true);
    // Le proxy generic ne supporte pas la syntaxe PostgREST .or(...).
    // On fetch UNIQUEMENT les affectations du collab courant côté serveur,
    // puis on fetch séparément celles des ancêtres pour les joindre côté JS.
    const chainSet = new Set(chainIds);
    const [aff, uo, motifs, typeMouvements, postes, contrat, collabs] = await Promise.all([
      supabase.from("collaborateur_affectations").select("*")
        .eq("collaborateur_id", collaborateurId).eq("archive", false)
        .order("date_debut_uo", { ascending: false }),
      supabase.from("unites_organisationnelles" as never)
        .select("id, libelle, code, type_uo")
        .eq("actif" as never, true as never),
      supabase.from("ref_motif_affectation").select("code, libelle"),
      supabase.from("ref_type_mouvement").select("code, libelle"),
      supabase.from("ref_poste" as never).select("code, libelle, unite_id"),
      supabase.from("collaborateur_contrats").select("date_debut")
        .eq("collaborateur_id", collaborateurId).eq("archive", false)
        .eq("code_statut_contrat", "ACTIF")
        .order("date_debut", { ascending: true }).limit(1),
      supabase.from("collaborateurs").select("id, matricule, nom, prenom").eq("archive", false),
    ]);

    const contrats = (contrat.data as any[]) || [];
    if (contrats.length > 0) setDateContratMin(contrats[0].date_debut);
    else setDateContratMin(null);

    // Récupérer les affectations des ancêtres séparément (un fetch par collab ancêtre)
    const currentId = chainIds[0];
    const ancestorIds = chainIds.filter(id => id !== currentId);
    const ancestorResults = await Promise.all(
      ancestorIds.map(id =>
        supabase.from("collaborateur_affectations").select("*")
          .eq("collaborateur_id", id).eq("archive", false)
      )
    );

    const matriculeById = new Map(chainCollabs.map(c => [c.id, c.matricule]));
    let all: Affectation[] = ((aff.data as any[]) || []).map(a => ({
      ...a,
      _from_ancien: undefined,
    })) as Affectation[];
    ancestorResults.forEach(r => {
      const rows = (r.data as any[]) || [];
      rows.forEach(a => {
        // garde-fou : on ne garde QUE les lignes dont le collaborateur_id est dans notre chaîne
        if (chainSet.has(a.collaborateur_id)) {
          all.push({ ...a, _from_ancien: matriculeById.get(a.collaborateur_id) } as Affectation);
        }
      });
    });

    // RG-AFFECT-SORT-V2 (Adil DAIA — 07/05/2026) : Tri amélioré
    //   1. Affectations actives (date_fin_uo NULL ou future) en tête
    //   2. Puis par date_debut_uo décroissant
    //   3. Puis par date_fin_uo décroissant (les plus récentes d'abord)
    //   4. Puis par date_debut_poste décroissant pour les ex aequo
    const today = new Date().toISOString().slice(0, 10);
    const isActive = (a: any) => !a.date_fin_uo || a.date_fin_uo >= today;
    all.sort((a: any, b: any) => {
      // 1. Active vs terminée
      const aA = isActive(a), bA = isActive(b);
      if (aA !== bA) return aA ? -1 : 1;
      // 2. date_debut_uo desc
      const cmp1 = (b.date_debut_uo || "").localeCompare(a.date_debut_uo || "");
      if (cmp1 !== 0) return cmp1;
      // 3. date_fin_uo desc (NULL en haut = encore en cours)
      const aFin = a.date_fin_uo || "9999-12-31";
      const bFin = b.date_fin_uo || "9999-12-31";
      const cmp2 = bFin.localeCompare(aFin);
      if (cmp2 !== 0) return cmp2;
      // 4. date_debut_poste desc
      return (b.date_debut_poste || "").localeCompare(a.date_debut_poste || "");
    });
    setAffectations(all);
    // Déplier auto les affectations en cours
    const ouverts = new Set(all.filter(a => isEnCours(a)).map(a => a.id));
    setExpandedIds(ouverts);

    const collabMapBuilt: Record<string, { matricule: string; nom: string; prenom: string }> = {};
    ((collabs.data as any[]) || []).forEach((c: any) => {
      collabMapBuilt[c.id] = { matricule: c.matricule, nom: c.nom, prenom: c.prenom };
    });
    setCollaborateurMap(collabMapBuilt);

    const uoRaw = (uo.data as any[]) || [];
    const typeCodes = [...new Set(uoRaw.map((u: any) => u.type_uo).filter(Boolean))];
    let typeNiveauMap: Record<string, number> = {};
    if (typeCodes.length > 0) {
      const { data: types } = await supabase
        .from("ref_type_uo")
        .select("code, niveau")
        .in("code", typeCodes);
      ((types as any[]) || []).forEach((t: any) => { typeNiveauMap[t.code] = t.niveau; });
    }
    const uoSorted = [...uoRaw].sort((a: any, b: any) => {
      const na = typeNiveauMap[a.type_uo] ?? 99;
      const nb = typeNiveauMap[b.type_uo] ?? 99;
      if (na !== nb) return na - nb;
      return a.libelle.localeCompare(b.libelle);
    });

    const uoMapBuilt: Record<string, string> = {};
    const uoOptBuilt: { value: string; label: string; meta?: string }[] = [];
    uoSorted.forEach((r: any) => {
      uoMapBuilt[r.id] = r.libelle + (r.code ? ` (${r.code})` : "");
      uoOptBuilt.push({ value: r.id, label: r.libelle, meta: r.code || undefined });
    });
    setUoMap(uoMapBuilt);
    setUoOptions(uoOptBuilt);

    const motifMapBuilt: Record<string, string> = {};
    const motifOptBuilt: { value: string; label: string }[] = [];
    ((motifs.data as any[]) || []).forEach((r: any) => {
      motifMapBuilt[r.code] = r.libelle;
      motifOptBuilt.push({ value: r.code, label: r.libelle });
    });
    ((typeMouvements.data as any[]) || []).forEach((r: any) => {
      if (!motifMapBuilt[r.code]) {
        motifMapBuilt[r.code] = r.libelle;
        motifOptBuilt.push({ value: r.code, label: `${r.libelle} (mouvement)` });
      }
    });
    setMotifMap(motifMapBuilt);
    setMotifOptions(motifOptBuilt);

    const posteMapBuilt: Record<string, string> = {};
    ((postes.data as any[]) || []).forEach((r: any) => {
      posteMapBuilt[r.code] = r.libelle;
    });
    try {
      const { data: instances } = await (supabase.from("ref_poste_instances" as never)
        .select("code_instance, code_poste") as any);
      ((instances as any[]) || []).forEach((inst: any) => {
        if (!posteMapBuilt[inst.code_instance] && posteMapBuilt[inst.code_poste]) {
          posteMapBuilt[inst.code_instance] = posteMapBuilt[inst.code_poste];
        }
      });
    } catch {}
    setPosteMap(posteMapBuilt);

    setLoading(false);
  };

  const set = (k: keyof AffectationFormData, v: any) => setForm(f => {
    const updated = { ...f, [k]: v };
    if (k === "unite_id") {
      updated.code_poste = "";
      updated.responsable_id = "";
      setResponsableInfo(null);
      setResponsableSearch("");
    }
    if (k === "code_poste" && !v) {
      updated.responsable_id = "";
      setResponsableInfo(null);
    }
    return updated;
  });

  const resetManagerFields = () => {
    setManagerN1Info(null); setManagerN1Search(""); setManagerN1SearchOpen(false);
    setManagerN2Info(null); setManagerN2Search(""); setManagerN2SearchOpen(false);
  };

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY);
    setDateErreur(null);
    setResponsableInfo(null);
    setResponsableSearch("");
    resetManagerFields();
    setOpen(true);
  };
  const openEdit = (a: Affectation) => {
    setEditing(a);
    setDateErreur(null);
    setForm({
      unite_id: a.unite_id || "",
      date_debut_uo: a.date_debut_uo || "",
      date_fin_uo: a.date_fin_uo || "",
      code_poste: a.code_poste || "",
      date_debut_poste: a.date_debut_poste || "",
      date_fin_poste: a.date_fin_poste || "",
      motif_affectation: a.motif_affectation || "",
      commentaire: a.commentaire || "",
      responsable_id: a.responsable_id || "",
      forcage_manager: a.forcage_manager || false,
      manager_n1_id: a.manager_n1_id || "",
      manager_n2_id: a.manager_n2_id || "",
    });
    if (a.responsable_id && collaborateurMap[a.responsable_id]) {
      setResponsableInfo({ id: a.responsable_id, ...collaborateurMap[a.responsable_id] });
    } else {
      setResponsableInfo(null);
    }
    setResponsableSearch("");
    if (a.manager_n1_id && collaborateurMap[a.manager_n1_id]) {
      setManagerN1Info({ id: a.manager_n1_id, ...collaborateurMap[a.manager_n1_id] });
    } else { setManagerN1Info(null); }
    setManagerN1Search(""); setManagerN1SearchOpen(false);
    if (a.manager_n2_id && collaborateurMap[a.manager_n2_id]) {
      setManagerN2Info({ id: a.manager_n2_id, ...collaborateurMap[a.manager_n2_id] });
    } else { setManagerN2Info(null); }
    setManagerN2Search(""); setManagerN2SearchOpen(false);
    setOpen(true);
  };

  const validerDates = (dateDebut: string, dateDebutPoste: string): string | null => {
    if (!dateContratMin) return null;
    if (dateDebut && dateDebut < dateContratMin) {
      return `La date de début d'affectation ne peut pas être antérieure au début du contrat actif (${new Date(dateContratMin).toLocaleDateString("fr-FR")}).`;
    }
    if (dateDebutPoste && dateDebutPoste < dateContratMin) {
      return `La date de début de poste ne peut pas être antérieure au début du contrat actif (${new Date(dateContratMin).toLocaleDateString("fr-FR")}).`;
    }
    return null;
  };

  const dateMoinsUn = (dateIso: string): string => {
    const d = new Date(dateIso);
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  };

  const handleSave = async () => {
    if (!form.date_debut_uo) return;

    const erreur = validerDates(form.date_debut_uo, form.date_debut_poste || "");
    if (erreur) { setDateErreur(erreur); return; }
    setDateErreur(null);
    setSaving(true);

    try {
      if (!editing) {
        // RG-AFF-02 : Clôture automatique des anciennes affectations actives
        const { data: affActives, error: errFetch } = await supabase
          .from("collaborateur_affectations")
          .select("id, code_poste, date_fin_poste")
          .eq("collaborateur_id", collaborateurId)
          .eq("archive", false)
          .is("date_fin_uo", null);

        if (errFetch) {
          console.error("RG-AFF-02 : Erreur récupération affectations actives :", errFetch.message);
        }

        const listeAffActives = (affActives as any[]) || [];

        if (listeAffActives.length > 0) {
          const dateFinAncienneUO = dateMoinsUn(form.date_debut_uo);

          for (const affActive of listeAffActives) {
            const miseAJourAncienne: any = {
              date_fin_uo: dateFinAncienneUO,
            };

            if (affActive.code_poste && !affActive.date_fin_poste && form.code_poste) {
              const dateRefNouveauPoste = form.date_debut_poste || form.date_debut_uo;
              miseAJourAncienne.date_fin_poste = dateMoinsUn(dateRefNouveauPoste);

              await (supabase.from("ref_poste_instances" as never)
                .update({ code_etat: "VA" } as never)
                .eq("code_instance" as never, affActive.code_poste as never) as any);

              const codePosteParent = affActive.code_poste.includes("-")
                ? affActive.code_poste.split("-").slice(0, -1).join("-")
                : affActive.code_poste;
              const { data: instAncien } = await (supabase.from("ref_poste_instances" as never)
                .select("code_etat")
                .eq("code_poste" as never, codePosteParent as never) as any);
              const etatsAncien = ((instAncien as any[]) || []).map((i: any) => i.code_etat);
              const etatParentAncien = etatsAncien.every((e: string) => e === "VA") ? "VA"
                : etatsAncien.some((e: string) => e === "AT") ? "AT" : "EC";
              await (supabase.from("ref_poste" as never)
                .update({ code_etat_poste: etatParentAncien } as never)
                .eq("code" as never, codePosteParent as never) as any);
            }

            const { error: errCloture } = await supabase
              .from("collaborateur_affectations")
              .update(miseAJourAncienne)
              .eq("id", affActive.id);

            if (errCloture) {
              console.error(`RG-AFF-02/03 : Erreur clôture affectation ${affActive.id} :`, errCloture.message);
            }
          }
        }

        // RG-AFF-04-INST : Attribution de la nouvelle instance de poste
        if (form.code_poste) {
          await (supabase.from("ref_poste_instances" as never)
            .update({ code_etat: "AT" } as never)
            .eq("code_instance" as never, form.code_poste as never) as any);

          const codePosteParentNouveau = form.code_poste.includes("-")
            ? form.code_poste.split("-").slice(0, -1).join("-")
            : form.code_poste;
          const { data: instNouveau } = await (supabase.from("ref_poste_instances" as never)
            .select("code_etat")
            .eq("code_poste" as never, codePosteParentNouveau as never) as any);
          const etatsNouveau = ((instNouveau as any[]) || []).map((i: any) => i.code_etat);
          const etatParentNouveau = etatsNouveau.every((e: string) => e === "VA") ? "VA"
            : etatsNouveau.some((e: string) => e === "AT") ? "AT" : "EC";
          await (supabase.from("ref_poste" as never)
            .update({ code_etat_poste: etatParentNouveau } as never)
            .eq("code" as never, codePosteParentNouveau as never) as any);
        }

      } else {
        // Mode édition : gérer le changement d'instance de poste
        const ancienPoste = editing.code_poste;
        const nouveauPoste = form.code_poste || null;

        if (ancienPoste !== nouveauPoste) {
          if (ancienPoste) {
            await (supabase.from("ref_poste_instances" as never)
              .update({ code_etat: "VA" } as never)
              .eq("code_instance" as never, ancienPoste as never) as any);
            const codeParentAncien = ancienPoste.includes("-") ? ancienPoste.split("-").slice(0, -1).join("-") : ancienPoste;
            const { data: iA } = await (supabase.from("ref_poste_instances" as never).select("code_etat").eq("code_poste" as never, codeParentAncien as never) as any);
            const etatsA = ((iA as any[]) || []).map((i: any) => i.code_etat);
            const etatA = etatsA.every((e: string) => e === "VA") ? "VA" : etatsA.some((e: string) => e === "AT") ? "AT" : "EC";
            await (supabase.from("ref_poste" as never).update({ code_etat_poste: etatA } as never).eq("code" as never, codeParentAncien as never) as any);
          }
          if (nouveauPoste) {
            await (supabase.from("ref_poste_instances" as never)
              .update({ code_etat: "AT" } as never)
              .eq("code_instance" as never, nouveauPoste as never) as any);
            const codeParentNouveau = nouveauPoste.includes("-") ? nouveauPoste.split("-").slice(0, -1).join("-") : nouveauPoste;
            const { data: iN } = await (supabase.from("ref_poste_instances" as never).select("code_etat").eq("code_poste" as never, codeParentNouveau as never) as any);
            const etatsN = ((iN as any[]) || []).map((i: any) => i.code_etat);
            const etatN = etatsN.every((e: string) => e === "VA") ? "VA" : etatsN.some((e: string) => e === "AT") ? "AT" : "EC";
            await (supabase.from("ref_poste" as never).update({ code_etat_poste: etatN } as never).eq("code" as never, codeParentNouveau as never) as any);
          }
        }
      }

      const payload = {
        collaborateur_id: collaborateurId,
        unite_id: form.unite_id || null,
        date_debut_uo: form.date_debut_uo,
        date_fin_uo: form.date_fin_uo || null,
        code_poste: form.code_poste || null,
        date_debut_poste: form.date_debut_poste || null,
        date_fin_poste: form.date_fin_poste || null,
        motif_affectation: form.motif_affectation || null,
        commentaire: form.commentaire || null,
        responsable_id: form.responsable_id || null,
        forcage_manager: form.forcage_manager || false,
        manager_n1_id: form.forcage_manager ? (form.manager_n1_id || null) : null,
        manager_n2_id: form.forcage_manager ? (form.manager_n2_id || null) : null,
      } as any;

      if (editing) {
        const { error: errEdit } = await supabase
          .from("collaborateur_affectations").update(payload).eq("id", editing.id);
        if (errEdit) console.error("Erreur lors de la mise à jour de l'affectation :", errEdit.message);
      } else {
        const { error: errInsert } = await supabase
          .from("collaborateur_affectations").insert(payload);
        if (errInsert) console.error("Erreur lors de l'insertion de la nouvelle affectation :", errInsert.message);
      }

      // RG-AFF-CLASSIF : Auto-association de la classification au collaborateur
      if (form.code_poste && !editing) {
        try {
          const codePosteParent = form.code_poste.includes("-")
            ? form.code_poste.split("-").slice(0, -1).join("-")
            : form.code_poste;
          const { data: posteInfo } = await (supabase.from("ref_poste" as never)
            .select("code_classification, code_emploi" as never)
            .eq("code" as never, codePosteParent as never)
            .maybeSingle() as any);
          if (posteInfo) {
            let classif = (posteInfo as any).code_classification;
            const codeEmploi = (posteInfo as any).code_emploi;
            if (!classif && codeEmploi) {
              const { data: emploiInfo } = await (supabase.from("ref_emploi" as never)
                .select("code_classification" as never)
                .eq("code" as never, codeEmploi as never)
                .maybeSingle() as any);
              classif = (emploiInfo as any)?.code_classification || null;
            }
            if (classif || codeEmploi) {
              await (supabase.from("collaborateur_qualifications" as never)
                .insert({
                  collaborateur_id: collaborateurId,
                  code_emploi: codeEmploi || "N/A",
                  code_motif: "AFF",
                  date_evolution: form.date_debut_uo,
                  code_classification: classif || null,
                } as never) as any);
            }
          }
        } catch (e) {
          console.error("Erreur auto-classification :", e);
        }
      }
    } catch (e) {
      console.error("Erreur inattendue dans handleSave :", e);
    } finally {
      setSaving(false);
      setOpen(false);
      setQualifWarning(null);
      loadAll();
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Archiver cette affectation ?")) return;
    await supabase.from("collaborateur_affectations").update({ archive: true }).eq("id", id);
    loadAll();
  };

  const handleReactivate = async (a: Affectation) => {
    if (!confirm("Réactiver cette affectation ? L'affectation en cours sera clôturée.")) return;

    const yesterday = (() => {
      const d = new Date(); d.setDate(d.getDate() - 1);
      return d.toISOString().split("T")[0];
    })();

    // 1. Clôturer toutes les affectations actuellement actives
    const { data: activeAffs } = await supabase
      .from("collaborateur_affectations")
      .select("id, code_poste")
      .eq("collaborateur_id", collaborateurId)
      .eq("archive", false)
      .is("date_fin_uo", null);

    for (const active of ((activeAffs as any[]) || [])) {
      await supabase.from("collaborateur_affectations")
        .update({ date_fin_uo: yesterday, date_fin_poste: yesterday, updated_at: new Date().toISOString() })
        .eq("id", active.id);
      if (active.code_poste) {
        await (supabase.from("ref_poste_instances" as never)
          .update({ code_etat: "VA", collaborateur_id: null } as never)
          .eq("code_instance" as never, active.code_poste as never) as any);
        const parentCode = active.code_poste.includes("-") ? active.code_poste.split("-").slice(0, -1).join("-") : active.code_poste;
        const { data: insts } = await (supabase.from("ref_poste_instances" as never).select("code_etat").eq("code_poste" as never, parentCode as never) as any);
        const etats = ((insts as any[]) || []).map((i: any) => i.code_etat);
        let newEtat = "VA";
        if (etats.some((e: string) => e === "AT")) newEtat = "AT";
        else if (etats.some((e: string) => e === "EC")) newEtat = "EC";
        await (supabase.from("ref_poste" as never).update({ code_etat_poste: newEtat } as never).eq("code" as never, parentCode as never) as any);
      }
    }

    // 2. Réactiver l'affectation sélectionnée
    await supabase.from("collaborateur_affectations")
      .update({ date_fin_uo: null, date_fin_poste: null, updated_at: new Date().toISOString() } as any)
      .eq("id", a.id);

    // 3. Attribuer l'instance de poste réactivée
    if (a.code_poste) {
      await (supabase.from("ref_poste_instances" as never)
        .update({ code_etat: "AT", collaborateur_id: collaborateurId } as never)
        .eq("code_instance" as never, a.code_poste as never) as any);
      const parentCode = a.code_poste.includes("-") ? a.code_poste.split("-").slice(0, -1).join("-") : a.code_poste;
      const { data: insts } = await (supabase.from("ref_poste_instances" as never).select("code_etat").eq("code_poste" as never, parentCode as never) as any);
      const etats = ((insts as any[]) || []).map((i: any) => i.code_etat);
      let newEtat = "VA";
      if (etats.some((e: string) => e === "AT")) newEtat = "AT";
      else if (etats.some((e: string) => e === "EC")) newEtat = "EC";
      await (supabase.from("ref_poste" as never).update({ code_etat_poste: newEtat } as never).eq("code" as never, parentCode as never) as any);
    }

    loadAll();
  };

  const isEnCours = (a: Affectation) => !a.date_fin_uo;

  const ownAffectations = affectations.filter(a => !a._from_ancien);
  const hasAffectation = ownAffectations.length > 0;

  return (
    <>
      <div>
        {!hasAffectation && (
          <div className="flex items-center justify-end mb-3">
            <button onClick={openNew}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{ background: "hsl(var(--accent))", color: "white" }}>
              <Plus size={12} />Première affectation
            </button>
          </div>
        )}
        {hasAffectation && (
          <div className="mb-3 px-3 py-2 rounded-lg text-xs" style={{ background: "hsl(var(--muted) / 0.5)", color: "hsl(var(--muted-foreground))" }}>
            Les modifications d'affectation se font via les <strong>mouvements internes</strong>.
          </div>
        )}

        {loading
          ? <div className="h-12 flex items-center justify-center">
              <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
                style={{ borderColor: "hsl(var(--accent))", borderTopColor: "transparent" }} />
            </div>
          : affectations.length === 0
            ? <p className="text-sm text-center py-6" style={{ color: "hsl(var(--muted-foreground))" }}>
                Aucune affectation enregistrée
              </p>
            : (() => {
                // RG-AFFECT-ACCORDION-01 (Adil DAIA) : barre d'actions globales + cartes accordéon
                const allIds = affectations.map(a => a.id);
                const allExpanded = expandedIds.size === allIds.length;
                return (
                  <div>
                    {/* Barre d'actions globales : nb + tout déplier/replier */}
                    {affectations.length > 1 && (
                      <div className="flex items-center justify-between mb-2 text-xs"
                        style={{ color: "hsl(var(--muted-foreground))" }}>
                        <span>{affectations.length} affectation{affectations.length > 1 ? "s" : ""} — historique du plus récent au plus ancien</span>
                        <button
                          onClick={() => toggleAll(allIds)}
                          className="hover:underline font-medium"
                          style={{ color: "hsl(var(--accent))" }}>
                          {allExpanded ? "Tout replier" : "Tout déplier"}
                        </button>
                      </div>
                    )}

                    <div className="space-y-2">
                      {affectations.map(a => {
                        const isOpen = expandedIds.has(a.id);
                        const enCours = isEnCours(a);
                        const ancien = !!a._from_ancien;
                        const borderColor = ancien ? "hsl(35 90% 45% / 0.4)" : enCours ? "hsl(var(--accent) / 0.4)" : "hsl(var(--border))";
                        const bgColor    = ancien ? "hsl(35 90% 45% / 0.06)" : enCours ? "hsl(var(--accent) / 0.04)" : "transparent";
                        const dureeJours = (() => {
                          if (!a.date_debut_uo) return null;
                          const d1 = new Date(a.date_debut_uo);
                          const d2 = a.date_fin_uo ? new Date(a.date_fin_uo) : new Date();
                          const days = Math.floor((d2.getTime() - d1.getTime()) / 86400000);
                          if (days < 0) return null;
                          if (days < 30) return `${days} j`;
                          if (days < 365) return `${Math.floor(days / 30)} mois`;
                          const ans = Math.floor(days / 365);
                          const remMois = Math.floor((days % 365) / 30);
                          return remMois > 0 ? `${ans} an${ans > 1 ? "s" : ""} ${remMois} m` : `${ans} an${ans > 1 ? "s" : ""}`;
                        })();
                        return (
                          <div key={a.id} className="rounded-lg border overflow-hidden transition-all"
                            style={{ borderColor, background: bgColor }}>
                            {/* HEADER (toujours visible — clic pour déplier) */}
                            <div
                              onClick={() => toggleExpanded(a.id)}
                              className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/30 transition-colors">
                              {/* Chevron */}
                              <div className="flex-shrink-0 transition-transform" style={{
                                transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)",
                                color: "hsl(var(--muted-foreground))",
                              }}>
                                <ChevronDown size={14} />
                              </div>

                              {/* Icône UO */}
                              <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                                style={{ background: "hsl(var(--accent) / 0.15)", color: "hsl(var(--accent))" }}>
                                <Building2 size={13} />
                              </div>

                              {/* UO + période + poste résumé */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="font-semibold text-sm truncate" style={{ color: "hsl(var(--foreground))" }}>
                                    {uoMap[a.unite_id || ""] || a.unite_id || "—"}
                                  </p>
                                  {a.code_poste && (
                                    <span className="text-xs px-1.5 py-0.5 rounded" style={{
                                      background: "hsl(var(--muted))",
                                      color: "hsl(var(--muted-foreground))",
                                    }}>
                                      {posteMap[a.code_poste] || a.code_poste}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                                  {fmt(a.date_debut_uo)}
                                  <span className="mx-1">→</span>
                                  {a.date_fin_uo ? fmt(a.date_fin_uo) : <span style={{ color: "hsl(var(--accent))", fontWeight: 600 }}>aujourd'hui</span>}
                                  {dureeJours && <span className="ml-2 opacity-70">({dureeJours})</span>}
                                </p>
                              </div>

                              {/* Badges */}
                              <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                                {enCours && !ancien && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide"
                                    style={{ background: "hsl(var(--accent) / 0.15)", color: "hsl(var(--accent))" }}>
                                    En cours
                                  </span>
                                )}
                                {ancien && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold flex items-center gap-1"
                                    style={{ background: "hsl(35 90% 45% / 0.15)", color: "hsl(35 90% 45%)" }}>
                                    <Hash size={9} />Ancien mat. {a._from_ancien}
                                  </span>
                                )}
                                {a.motif_affectation && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full hidden md:inline-block" style={{
                                    background: "hsl(var(--muted))",
                                    color: "hsl(var(--muted-foreground))",
                                  }}>
                                    {motifMap[a.motif_affectation] || a.motif_affectation}
                                  </span>
                                )}
                                {!ancien && !hasAffectation && (
                                  <>
                                    <button onClick={() => openEdit(a)} className="p-1 rounded hover:bg-muted transition-colors" style={{ color: "hsl(var(--accent))" }}>
                                      <Pencil size={12} />
                                    </button>
                                    <button onClick={() => handleDelete(a.id)} className="p-1 rounded hover:bg-muted transition-colors" style={{ color: "hsl(0 84% 55%)" }}>
                                      <Trash2 size={12} />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>

                            {/* CONTENU DÉPLIABLE */}
                            {isOpen && (
                              <div className="px-3 pb-3 pt-2 border-t" style={{ borderColor: "hsl(var(--border))" }}>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                  {a.code_poste && <FieldView label="Poste" value={posteMap[a.code_poste] || a.code_poste} />}
                                  {a.date_debut_poste && <FieldView label="Début poste" value={fmt(a.date_debut_poste)} />}
                                  {a.date_fin_poste && <FieldView label="Fin poste" value={fmt(a.date_fin_poste)} />}
                                  {a.motif_affectation && (
                                    <FieldView label="Motif" value={motifMap[a.motif_affectation] || a.motif_affectation} />
                                  )}
                                  {a.responsable_id && collaborateurMap[a.responsable_id] && (
                                    <FieldView
                                      label="Responsable UO"
                                      value={`${collaborateurMap[a.responsable_id].prenom} ${collaborateurMap[a.responsable_id].nom} (${collaborateurMap[a.responsable_id].matricule})`}
                                    />
                                  )}
                                  {a.forcage_manager && (
                                    <>
                                      {a.manager_n1_id && collaborateurMap[a.manager_n1_id] && (
                                        <FieldView
                                          label="Manager N+1 (forcé)"
                                          value={`${collaborateurMap[a.manager_n1_id].prenom} ${collaborateurMap[a.manager_n1_id].nom} (${collaborateurMap[a.manager_n1_id].matricule})`}
                                        />
                                      )}
                                      {a.manager_n2_id && collaborateurMap[a.manager_n2_id] && (
                                        <FieldView
                                          label="Manager N+2 (forcé)"
                                          value={`${collaborateurMap[a.manager_n2_id].prenom} ${collaborateurMap[a.manager_n2_id].nom} (${collaborateurMap[a.manager_n2_id].matricule})`}
                                        />
                                      )}
                                    </>
                                  )}
                                  {a.commentaire && <FieldView label="Commentaire" value={a.commentaire} className="col-span-2 md:col-span-3" />}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()
        }
      </div>

      {/* Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Modifier l'affectation" : "Nouvelle affectation"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* UO */}
            <div className="rounded-lg p-3 border" style={{ background: "hsl(var(--muted) / 0.3)", borderColor: "hsl(var(--border))" }}>
              <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: "hsl(var(--accent))" }}>
                Unité Organisationnelle
              </p>
              <DropSel
                value={form.unite_id || ""}
                onChange={v => set("unite_id", v)}
                label="Unité organisationnelle *"
                options={uoOptions}
                required
              />
              <div className="grid grid-cols-2 gap-3 mt-3">
                <FI label="Date début UO" value={form.date_debut_uo} onChange={v => set("date_debut_uo", v)} type="date" required />
                <FI label="Date fin UO" value={form.date_fin_uo || ""} onChange={v => set("date_fin_uo", v)} type="date" />
              </div>
            </div>

            {/* Poste — filtré par UO */}
            <div className="rounded-lg p-3 border" style={{ background: "hsl(var(--muted) / 0.3)", borderColor: "hsl(var(--border))" }}>
              <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: "hsl(210 70% 50%)" }}>
                Poste
              </p>
              {!form.unite_id ? (
                <p className="text-xs py-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Sélectionnez d'abord une unité organisationnelle pour afficher les postes disponibles.
                </p>
              ) : instanceOptionsForUO.length === 0 ? (
                <p className="text-xs py-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Aucune instance de poste vacante rattachée à cette UO.
                </p>
              ) : (
                <DropSel
                  value={form.code_poste || ""}
                  onChange={v => set("code_poste", v)}
                  label="Instance de poste vacante (filtré par UO)"
                  options={instanceOptionsForUO}
                />
              )}
              {qualifWarning && (
                <div className="flex items-start gap-2 rounded-lg px-3 py-2 mt-2 text-xs"
                  style={{ background: "hsl(39 95% 50% / 0.1)", border: "1px solid hsl(39 95% 50% / 0.3)", color: "hsl(39 70% 35%)" }}>
                  <span style={{ flexShrink: 0, marginTop: 1 }}>⚠</span>
                  <span>{qualifWarning}</span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 mt-3">
                <FI label="Date début poste" value={form.date_debut_poste || ""} onChange={v => set("date_debut_poste", v)} type="date" />
                <FI label="Date fin poste" value={form.date_fin_poste || ""} onChange={v => set("date_fin_poste", v)} type="date" />
              </div>
            </div>

            {/* Responsable de l'UO */}
            <div className="rounded-lg p-3 border" style={{ background: "hsl(var(--muted) / 0.3)", borderColor: "hsl(var(--border))" }}>
              <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: "hsl(142 60% 40%)" }}>
                Responsable de l'UO
              </p>

              {responsableInfo ? (
                <div className="flex items-center justify-between px-3 py-2 rounded-lg border"
                  style={{ background: "hsl(142 60% 40% / 0.08)", borderColor: "hsl(142 60% 40% / 0.3)" }}>
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ background: "hsl(142 60% 40% / 0.15)", color: "hsl(142 60% 40%)" }}>
                      <UserCheck size={13} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                        {responsableInfo.prenom} {responsableInfo.nom}
                      </p>
                      <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                        Matricule : {responsableInfo.matricule}
                      </p>
                    </div>
                  </div>
                  <button type="button"
                    onClick={() => { setResponsableInfo(null); set("responsable_id", ""); setResponsableSearch(""); }}
                    className="p-1 rounded-full transition-colors"
                    style={{ color: "hsl(var(--muted-foreground))" }}>
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div style={{ position: "relative" }}>
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg border"
                    style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))" }}>
                    <Search size={13} style={{ color: "hsl(var(--muted-foreground))", flexShrink: 0 }} />
                    <input
                      type="text"
                      value={responsableSearch}
                      onChange={e => { setResponsableSearch(e.target.value); setResponsableSearchOpen(true); }}
                      onFocus={() => setResponsableSearchOpen(true)}
                      placeholder="Rechercher par matricule ou nom..."
                      className="flex-1 text-sm outline-none bg-transparent"
                      style={{ color: "hsl(var(--foreground))" }}
                    />
                  </div>
                  {responsableSearchOpen && responsableSuggestions.length > 0 && (
                    <div className="absolute z-50 w-full rounded-lg border shadow-lg mt-1"
                      style={{ background: "hsl(var(--popover))", borderColor: "hsl(var(--border))", boxShadow: "0 8px 24px hsl(0 0% 0% / 0.12)" }}>
                      {responsableSuggestions.map(s => (
                        <button key={s.id} type="button"
                          onClick={() => {
                            setResponsableInfo(s);
                            set("responsable_id", s.id);
                            setResponsableSearch("");
                            setResponsableSearchOpen(false);
                          }}
                          className="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-accent/10">
                          <span className="font-semibold" style={{ color: "hsl(var(--accent))" }}>{s.matricule}</span>
                          <span className="ml-2" style={{ color: "hsl(var(--foreground))" }}>{s.prenom} {s.nom}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {!responsableInfo && !form.code_poste && (
                <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Sélectionnez un poste pour auto-remplir, ou recherchez manuellement.
                </p>
              )}
              {!responsableInfo && form.code_poste && (
                <p className="text-xs mt-1" style={{ color: "hsl(142 60% 40%)" }}>
                  Aucun collaborateur n'est actuellement affecté à ce poste.
                </p>
              )}
            </div>

            {/* Forçage Manager */}
            <div className="rounded-lg p-3 border" style={{ background: "hsl(var(--muted) / 0.3)", borderColor: "hsl(var(--border))" }}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold uppercase tracking-wide flex items-center gap-1.5" style={{ color: "hsl(280 60% 50%)" }}>
                  <Users size={13} />Forçage Manager (Workflow)
                </p>
                <button
                  type="button"
                  onClick={() => {
                    const newVal = !form.forcage_manager;
                    set("forcage_manager", newVal);
                    if (!newVal) {
                      set("manager_n1_id", "");
                      set("manager_n2_id", "");
                      setManagerN1Info(null); setManagerN1Search("");
                      setManagerN2Info(null); setManagerN2Search("");
                    }
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors"
                  style={{
                    background: form.forcage_manager ? "hsl(280 60% 50% / 0.15)" : "hsl(var(--muted) / 0.5)",
                    color: form.forcage_manager ? "hsl(280 60% 50%)" : "hsl(var(--muted-foreground))",
                    border: `1px solid ${form.forcage_manager ? "hsl(280 60% 50% / 0.3)" : "hsl(var(--border))"}`,
                  }}
                >
                  <ToggleRight size={14} />
                  {form.forcage_manager ? "Activé" : "Désactivé"}
                </button>
              </div>

              {!form.forcage_manager ? (
                <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Le manager sera déterminé automatiquement par l'organigramme. Activez le forçage pour désigner manuellement un N+1 et/ou N+2.
                </p>
              ) : (
                <div className="space-y-3">
                  {/* N+1 */}
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Manager N+1</label>
                    {managerN1Info ? (
                      <div className="flex items-center justify-between px-3 py-2 rounded-lg border"
                        style={{ background: "hsl(280 60% 50% / 0.08)", borderColor: "hsl(280 60% 50% / 0.3)" }}>
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                            style={{ background: "hsl(280 60% 50% / 0.15)", color: "hsl(280 60% 50%)" }}>
                            <UserCheck size={11} />
                          </div>
                          <div>
                            <p className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>{managerN1Info.prenom} {managerN1Info.nom}</p>
                            <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{managerN1Info.matricule}</p>
                          </div>
                        </div>
                        <button type="button" onClick={() => { setManagerN1Info(null); set("manager_n1_id", ""); setManagerN1Search(""); }}
                          className="p-1 rounded-full" style={{ color: "hsl(var(--muted-foreground))" }}><X size={13} /></button>
                      </div>
                    ) : (
                      <div style={{ position: "relative" }}>
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border"
                          style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))" }}>
                          <Search size={13} style={{ color: "hsl(var(--muted-foreground))", flexShrink: 0 }} />
                          <input type="text" value={managerN1Search}
                            onChange={e => { setManagerN1Search(e.target.value); setManagerN1SearchOpen(true); }}
                            onFocus={() => setManagerN1SearchOpen(true)}
                            placeholder="Rechercher N+1 par matricule ou nom..."
                            className="flex-1 text-sm outline-none bg-transparent" style={{ color: "hsl(var(--foreground))" }} />
                        </div>
                        {managerN1SearchOpen && managerN1Suggestions.length > 0 && (
                          <div className="absolute z-50 w-full rounded-lg border shadow-lg mt-1"
                            style={{ background: "hsl(var(--popover))", borderColor: "hsl(var(--border))", maxHeight: 200, overflowY: "auto" }}>
                            {managerN1Suggestions.map(s => (
                              <button key={s.id} type="button"
                                onClick={() => { setManagerN1Info(s); set("manager_n1_id", s.id); setManagerN1Search(""); setManagerN1SearchOpen(false); }}
                                className="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-accent/10">
                                <span className="font-semibold" style={{ color: "hsl(var(--accent))" }}>{s.matricule}</span>
                                <span className="ml-2" style={{ color: "hsl(var(--foreground))" }}>{s.prenom} {s.nom}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* N+2 */}
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Manager N+2</label>
                    {managerN2Info ? (
                      <div className="flex items-center justify-between px-3 py-2 rounded-lg border"
                        style={{ background: "hsl(280 60% 50% / 0.08)", borderColor: "hsl(280 60% 50% / 0.3)" }}>
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                            style={{ background: "hsl(280 60% 50% / 0.15)", color: "hsl(280 60% 50%)" }}>
                            <UserCheck size={11} />
                          </div>
                          <div>
                            <p className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>{managerN2Info.prenom} {managerN2Info.nom}</p>
                            <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{managerN2Info.matricule}</p>
                          </div>
                        </div>
                        <button type="button" onClick={() => { setManagerN2Info(null); set("manager_n2_id", ""); setManagerN2Search(""); }}
                          className="p-1 rounded-full" style={{ color: "hsl(var(--muted-foreground))" }}><X size={13} /></button>
                      </div>
                    ) : (
                      <div style={{ position: "relative" }}>
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border"
                          style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))" }}>
                          <Search size={13} style={{ color: "hsl(var(--muted-foreground))", flexShrink: 0 }} />
                          <input type="text" value={managerN2Search}
                            onChange={e => { setManagerN2Search(e.target.value); setManagerN2SearchOpen(true); }}
                            onFocus={() => setManagerN2SearchOpen(true)}
                            placeholder="Rechercher N+2 par matricule ou nom..."
                            className="flex-1 text-sm outline-none bg-transparent" style={{ color: "hsl(var(--foreground))" }} />
                        </div>
                        {managerN2SearchOpen && managerN2Suggestions.length > 0 && (
                          <div className="absolute z-50 w-full rounded-lg border shadow-lg mt-1"
                            style={{ background: "hsl(var(--popover))", borderColor: "hsl(var(--border))", maxHeight: 200, overflowY: "auto" }}>
                            {managerN2Suggestions.map(s => (
                              <button key={s.id} type="button"
                                onClick={() => { setManagerN2Info(s); set("manager_n2_id", s.id); setManagerN2Search(""); setManagerN2SearchOpen(false); }}
                                className="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-accent/10">
                                <span className="font-semibold" style={{ color: "hsl(var(--accent))" }}>{s.matricule}</span>
                                <span className="ml-2" style={{ color: "hsl(var(--foreground))" }}>{s.prenom} {s.nom}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Motif & Commentaire */}
            <div className="grid grid-cols-1 gap-3">
              <DropSel
                label="Motif d'affectation"
                value={form.motif_affectation || ""}
                onChange={v => set("motif_affectation", v)}
                options={motifOptions}
              />
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Commentaire
                </label>
                <textarea
                  value={form.commentaire || ""}
                  onChange={e => set("commentaire", e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg border text-sm outline-none resize-none"
                  style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
                />
              </div>
            </div>
          </div>

          {dateErreur && (
            <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-sm"
              style={{ background: "hsl(0 84% 55% / 0.08)", border: "1px solid hsl(0 84% 55% / 0.3)", color: "hsl(0 84% 45%)" }}>
              <span className="mt-0.5 flex-shrink-0">⚠️</span>
              <span>{dateErreur}</span>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            <Button
              onClick={handleSave}
              disabled={saving || !form.date_debut_uo}
              style={{ background: "hsl(var(--accent))", color: "white" }}>
              {saving ? "Enregistrement..." : <><Save size={13} className="mr-1" />Enregistrer</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default AffectationFormComponent;
