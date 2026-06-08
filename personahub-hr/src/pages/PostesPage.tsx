/**
 * PostesPage – Gestion du référentiel des postes
 * Auteur règles : Adil DAIA
 *
 * Règles métier :
 *  - RG-PST-SORT (Adil DAIA) : UO triées par niveau ASC, libellé ASC
 *  - RG-PST-FILTRE (Adil DAIA) : Le filtre UO restreint les postes affichés
 *  - RG-PST-STATUT (Adil DAIA) : Statut : AC (Actif) / IN (Inactif)
 *  - RG-PST-ETAT (Adil DAIA) : État : VA (Vacant) / AT (Attribué) / EC (En cours d'attribution)
 *  - RG-PST-NB-01 (Adil DAIA) : Si emploi de responsabilité → nombre de postes obligatoirement 1
 *  - RG-PST-NB-02 (Adil DAIA) : Génération automatique d'instances à la sauvegarde
 *  - RG-PST-NB-03 (Adil DAIA) : Les affectations se font sur les instances générées
 *  - RG-PST-NB-04 (Adil DAIA) : Réduction possible uniquement si des postes Vacants existent
 *  - RG-PST-DET-01 (Adil DAIA) : Au clic sur un poste, afficher le détail de toutes ses instances
 *    avec : code instance, statut, état, collaborateur affecté (si AT), date de dernière affectation
 */
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import {
  Plus, Pencil, Trash2, Search, Building2, Briefcase, ChevronDown, Loader2, AlertTriangle, Hash, Users, Eye,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import UOTreePanel, { type UOTreeSelection } from "@/components/postes/UOTreePanel";

/* ─── Types ─── */
interface UO {
  id: string;
  libelle: string;
  code: string | null;
  niveau: number | null;
  parent_id: string | null;
}

interface Emploi {
  code: string;
  libelle: string;
  /** RG-PST-NB-01 (Adil DAIA) : Indicateur emploi de responsabilité */
  est_emploi_responsabilite: boolean;
  /** Classification de base de l'emploi */
  code_classification?: string | null;
}

interface Poste {
  code: string;
  libelle: string;
  code_emploi: string | null;
  unite_id: string | null;
  description: string | null;
  actif: boolean;
  code_statut_poste: string;
  code_etat_poste: string;
  /** RG-PST-NB-01 (Adil DAIA) : Nombre de postes à générer */
  nombre_postes: number;
  /** Classification (hiérarchique : surcharge emploi si définie) */
  code_classification: string | null;
  /** Qualifications/compétences requises pour ce poste */
  qualifications_requises: string | null;
}

/**
 * RG-PST-DET-01 (Adil DAIA) : Instance de poste enrichie avec les informations du
 * collaborateur affecté et la date de la dernière affectation pour affichage dans le panneau détail.
 */
interface PosteInstance {
  id: string;
  code_poste: string;
  numero_instance: number;
  code_instance: string;
  code_etat: string;
  collaborateur_id: string | null;
  /** Nom complet du collaborateur si l'instance est attribuée */
  collaborateur_nom?: string;
  /** Date de la dernière affectation enregistrée pour cette instance */
  date_derniere_affectation?: string | null;
}

const STATUTS: { value: string; label: string; color: string }[] = [
  { value: "AC", label: "Actif", color: "hsl(142 70% 40%)" },
  { value: "IN", label: "Inactif", color: "hsl(var(--muted-foreground))" },
];

const ETATS: { value: string; label: string; color: string; bg: string }[] = [
  { value: "VA", label: "Vacant", color: "hsl(142 70% 40%)", bg: "hsl(142 70% 40% / 0.12)" },
  { value: "AT", label: "Attribué", color: "hsl(213 73% 45%)", bg: "hsl(213 73% 45% / 0.12)" },
  { value: "EC", label: "En cours d'attribution", color: "hsl(39 95% 40%)", bg: "hsl(39 95% 40% / 0.12)" },
];

// RG-PST-TRANS (Adil DAIA) : Transitions d'état autorisées entre les états de poste
const TRANSITIONS: Record<string, string[]> = {
  VA: ["EC", "AT"],
  AT: ["VA", "EC"],
  EC: ["AT", "VA"],
};

const EMPTY_FORM: Poste = {
  code: "",
  libelle: "",
  code_emploi: null,
  unite_id: null,
  description: null,
  actif: true,
  code_statut_poste: "AC",
  code_etat_poste: "VA",
  nombre_postes: 1,
  code_classification: null,
  qualifications_requises: null,
};

/* ─── Mini composants ─── */
const FI: React.FC<{
  label: string; value: string | number; onChange: (v: string) => void;
  type?: string; required?: boolean; placeholder?: string; disabled?: boolean;
  min?: number; max?: number;
}> = ({ label, value, onChange, type = "text", required, placeholder, disabled, min, max }) => (
  <div>
    <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
      {label}{required && <span style={{ color: "hsl(0 84% 55%)" }}> *</span>}
    </label>
    <input
      type={type} value={value || ""} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} disabled={disabled} min={min} max={max}
      className="w-full px-3 py-2 rounded-lg border text-sm outline-none transition-all"
      style={{
        borderColor: "hsl(var(--border))", background: disabled ? "hsl(var(--muted)/0.4)" : "hsl(var(--background))",
        color: "hsl(var(--foreground))", height: 38,
      }}
    />
  </div>
);

/* ── Dropdown générique ── */
const DropdownSelect: React.FC<{
  label?: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string; meta?: string }[];
  placeholder?: string; required?: boolean; disabled?: boolean;
  emptyLabel?: string;
}> = ({ label, value, onChange, options, placeholder = "— Sélectionner —", required, disabled, emptyLabel }) => {
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
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm outline-none text-left transition-all"
        style={{
          borderColor: open ? "hsl(var(--accent))" : "hsl(var(--border))",
          background: disabled ? "hsl(var(--muted)/0.4)" : "hsl(var(--background))",
          color: selected ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
          minHeight: 38, cursor: disabled ? "not-allowed" : "pointer",
          boxShadow: open ? "0 0 0 2px hsl(var(--accent)/0.2)" : "none",
        }}
      >
        <span className="truncate">{selected?.label || placeholder}</span>
        <ChevronDown size={14} style={{
          color: "hsl(var(--muted-foreground))",
          transform: open ? "rotate(180deg)" : "rotate(0)",
          transition: "transform 0.15s", flexShrink: 0, marginLeft: 6
        }} />
      </button>
      {open && (
        <div className="absolute z-50 w-full rounded-lg border shadow-lg mt-1"
          style={{
            background: "hsl(var(--popover))", borderColor: "hsl(var(--border))",
            boxShadow: "0 8px 24px hsl(0 0% 0%/0.12)", maxHeight: 300, display: "flex", flexDirection: "column",
          }}>
          <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: "hsl(var(--border))" }}>
            <Search size={13} style={{ color: "hsl(var(--muted-foreground))", flexShrink: 0 }} />
            <input autoFocus type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher..." className="flex-1 text-sm outline-none bg-transparent"
              style={{ color: "hsl(var(--foreground))" }} />
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
            <button type="button" onClick={() => { onChange(""); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm"
              style={{ color: "hsl(var(--muted-foreground))" }}>
              {emptyLabel || "— Sélectionner —"}
            </button>
            {filtered.map(opt => (
              <button key={opt.value} type="button"
                onClick={() => { onChange(opt.value); setOpen(false); setSearch(""); }}
                className="w-full text-left px-3 py-2 text-sm transition-colors"
                style={{
                  background: opt.value === value ? "hsl(var(--accent)/0.12)" : "transparent",
                  color: opt.value === value ? "hsl(var(--accent))" : "hsl(var(--foreground))",
                  fontWeight: opt.value === value ? 600 : 400,
                }}
              >
                {opt.meta && (
                  <span className="text-xs mr-2" style={{ color: "hsl(var(--muted-foreground))" }}>{opt.meta}</span>
                )}
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

/* ─── Badges ─── */
const EtatBadge: React.FC<{ etat: string }> = ({ etat }) => {
  const e = ETATS.find(x => x.value === etat);
  if (!e) return <span>—</span>;
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{ background: e.bg, color: e.color }}>
      {e.label}
    </span>
  );
};

const StatutBadge: React.FC<{ statut: string }> = ({ statut }) => {
  const s = STATUTS.find(x => x.value === statut);
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{
        backgroundColor: s?.color ? `${s.color}20` : "hsl(var(--muted)/0.3)",
        color: s?.color || "hsl(var(--muted-foreground))",
      }}>
      {s?.label || statut}
    </span>
  );
};

/**
 * RG-PST-DET-01 (Adil DAIA) : Dialogue détail des instances d'un poste.
 * Affiche pour chaque instance : code, statut, état, collaborateur (si AT), date dernière affectation.
 * Permet également de changer l'état d'une instance directement depuis ce panneau.
 */
const InstancesDetailDialog: React.FC<{
  poste: Poste | null;
  instances: PosteInstance[];
  loading: boolean;
  onClose: () => void;
  onChangeEtat: (instanceId: string, newEtat: string) => void;
}> = ({ poste, instances, loading, onClose, onChangeEtat }) => {
  if (!poste) return null;

  // RG-PST-DET-01 (Adil DAIA) : Calcul des compteurs par état pour le résumé du panneau
  const countByEtat = ETATS.reduce((acc, e) => {
    acc[e.value] = instances.filter(i => i.code_etat === e.value).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <Dialog open={!!poste} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Hash size={16} style={{ color: "hsl(var(--accent))" }} />
            Instances du poste —{" "}
            <span style={{ color: "hsl(var(--accent))" }}>{poste.code}</span>
            <span className="text-base font-normal ml-1" style={{ color: "hsl(var(--muted-foreground))" }}>
              {poste.libelle}
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* RG-PST-DET-01 (Adil DAIA) : Résumé synthétique des états */}
        <div className="flex gap-3 pb-3 border-b" style={{ borderColor: "hsl(var(--border))" }}>
          {ETATS.map(e => (
            <div key={e.value} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm flex-1"
              style={{ background: e.bg, border: `1px solid ${e.color}30` }}>
              <span className="text-xl font-bold" style={{ color: e.color }}>{countByEtat[e.value] || 0}</span>
              <span className="text-xs font-medium" style={{ color: e.color }}>{e.label}</span>
            </div>
          ))}
        </div>

        {/* Tableau des instances */}
        <div className="overflow-y-auto flex-1 mt-1">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin" style={{ color: "hsl(var(--accent))" }} />
            </div>
          ) : instances.length === 0 ? (
            <div className="text-center py-12 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
              Aucune instance générée pour ce poste
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0" style={{ background: "hsl(var(--card))" }}>
                <tr style={{ borderBottom: "1px solid hsl(var(--border))", background: "hsl(var(--muted)/0.4)" }}>
                  {["Instance", "Statut", "État", "Collaborateur affecté", "Dernière affectation", "Actions"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                      style={{ color: "hsl(var(--muted-foreground))" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {instances.map((inst, idx) => {
                  const etatInfo = ETATS.find(e => e.value === inst.code_etat);
                  // RG-PST-TRANS (Adil DAIA) : Calculer les transitions disponibles pour cette instance
                  const transitions = ETATS.filter(e => e.value !== inst.code_etat && TRANSITIONS[inst.code_etat]?.includes(e.value));
                  const isAttribue = inst.code_etat === "AT";

                  return (
                    <tr key={inst.id}
                      style={{
                        borderBottom: "1px solid hsl(var(--border))",
                        background: idx % 2 === 0 ? "transparent" : "hsl(var(--muted)/0.15)",
                      }}>
                      {/* Code instance */}
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs font-bold px-2 py-1 rounded"
                          style={{ background: "hsl(var(--accent)/0.1)", color: "hsl(var(--accent))" }}>
                          {inst.code_instance}
                        </span>
                      </td>

                      {/* Statut du poste parent */}
                      <td className="px-4 py-3">
                        <StatutBadge statut={poste.code_statut_poste} />
                      </td>

                      {/* État de l'instance */}
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
                          style={{ background: etatInfo?.bg, color: etatInfo?.color }}>
                          {etatInfo?.label || inst.code_etat}
                        </span>
                      </td>

                      {/* RG-PST-DET-01 (Adil DAIA) : Collaborateur affiché uniquement si l'instance est Attribuée */}
                      <td className="px-4 py-3">
                        {isAttribue && inst.collaborateur_nom ? (
                          <div className="flex items-center gap-1.5">
                            <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                              style={{ background: "hsl(var(--accent)/0.15)", color: "hsl(var(--accent))" }}>
                              {inst.collaborateur_nom.charAt(0).toUpperCase()}
                            </div>
                            <span className="text-xs font-medium" style={{ color: "hsl(var(--foreground))" }}>
                              {inst.collaborateur_nom}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs italic" style={{ color: "hsl(var(--muted-foreground))" }}>
                            {isAttribue ? "—" : "Non attribué"}
                          </span>
                        )}
                      </td>

                      {/* RG-PST-DET-01 (Adil DAIA) : Date de la dernière affectation enregistrée */}
                      <td className="px-4 py-3">
                        {inst.date_derniere_affectation ? (
                          <span className="text-xs" style={{ color: "hsl(var(--foreground))" }}>
                            {new Date(inst.date_derniere_affectation).toLocaleDateString("fr-FR")}
                          </span>
                        ) : (
                          <span className="text-xs italic" style={{ color: "hsl(var(--muted-foreground))" }}>—</span>
                        )}
                      </td>

                      {/* Actions : transitions d'état */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 flex-wrap">
                          {transitions.map(t => (
                            <button key={t.value}
                              onClick={() => onChangeEtat(inst.id, t.value)}
                              className="text-xs px-2 py-0.5 rounded-full border transition-colors"
                              style={{ borderColor: t.color, color: t.color, background: "transparent" }}>
                              → {t.label}
                            </button>
                          ))}
                          {transitions.length === 0 && (
                            <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={onClose}>Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/* ─── Page principale ─── */
const PostesPage: React.FC = () => {
  const navigate = useNavigate();
  const [postes, setPostes] = useState<Poste[]>([]);
  const [instances, setInstances] = useState<Record<string, PosteInstance[]>>({});
  /** RG-PST-DET-01 (Adil DAIA) : Compteurs par état pour chaque poste, chargés au démarrage */
  const [instanceCounts, setInstanceCounts] = useState<Record<string, { VA: number; AT: number; EC: number }>>({});
  const [uo, setUo] = useState<UO[]>([]);
  const [emplois, setEmplois] = useState<Emploi[]>([]);
  const [classifications, setClassifications] = useState<{ value: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterUO, setFilterUO] = useState("");
  // RG-PST-ARBRE-01 (Adil DAIA) : sélection arborescente UO + mode (directs / descendants)
  const [treeSel, setTreeSel] = useState<UOTreeSelection>({ unite_id: null, mode: "directs" });
  const [filterStatut, setFilterStatut] = useState("");
  const [filterEtat, setFilterEtat] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Poste | null>(null);
  const [form, setForm] = useState<Poste>({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** RG-PST-DET-01 (Adil DAIA) : Poste sélectionné pour le dialogue de détail des instances */
  const [detailPoste, setDetailPoste] = useState<Poste | null>(null);
  const [detailInstances, setDetailInstances] = useState<PosteInstance[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [postesRes, uoRes, emploiRes, classifRes] = await Promise.all([
      supabase.from("ref_poste" as never).select("*").order("libelle" as never),
      (supabase.from("unites_organisationnelles" as never)
        .select("id, libelle, code, actif, type_uo, parent_id, niveau")
        .eq("actif" as never, true as never) as any),
      // RG-PST-NB-01 (Adil DAIA) : Chargement de l'indicateur est_emploi_responsabilite + classification
      supabase.from("ref_emploi" as never).select("code, libelle, est_emploi_responsabilite, code_classification").eq("actif" as never, true as never).order("libelle" as never),
      supabase.from("ref_classification" as never).select("code, libelle").eq("actif" as never, true as never).order("libelle" as never),
    ]);

    // RG-PST-FIX-01 (Adil DAIA — 07/05/2026) : utiliser directement le champ
    // niveau de unites_organisationnelles (déjà dénormalisé) au lieu de joindre
    // ref_type_uo (l'ancien code utilisait une requête désactivée).
    const uoRaw = (uoRes.data as any[]) || [];
    const uoList: UO[] = uoRaw.map((u: any) => ({
      id: u.id,
      libelle: u.libelle,
      code: u.code,
      niveau: u.niveau ?? 99,
      parent_id: u.parent_id ?? null,
    }));
    // RG-PST-SORT (Adil DAIA) : Trier par niveau ASC, puis libellé ASC
    uoList.sort((a, b) => {
      if ((a.niveau ?? 99) !== (b.niveau ?? 99)) return (a.niveau ?? 99) - (b.niveau ?? 99);
      return a.libelle.localeCompare(b.libelle);
    });

    const postesList = ((postesRes.data as any[]) || []).map((p: any) => ({
      ...p,
      nombre_postes: p.nombre_postes ?? 1,
    }));

    setUo(uoList);
    setPostes(postesList);
    setEmplois(((emploiRes.data as any[]) || []).map((e: any) => ({
      code: e.code,
      libelle: e.libelle,
      est_emploi_responsabilite: e.est_emploi_responsabilite ?? false,
      code_classification: e.code_classification || null,
    })));
    setClassifications(((classifRes.data as any[]) || []).map((c: any) => ({
      value: c.code,
      label: c.libelle,
    })));

    // RG-PST-DET-01 (Adil DAIA) : Charger les compteurs d'instances par état pour tous les postes
    // afin d'afficher le nombre d'attribués directement dans la liste sans ouvrir le détail
    if (postesList.length > 0) {
      const codes = postesList.map((p: Poste) => p.code);
      const { data: allInstances } = await (supabase
        .from("ref_poste_instances" as never)
        .select("code_poste, code_etat")
        .in("code_poste" as never, codes as never) as any);

      const counts: Record<string, { VA: number; AT: number; EC: number }> = {};
      ((allInstances as any[]) || []).forEach((inst: any) => {
        if (!counts[inst.code_poste]) counts[inst.code_poste] = { VA: 0, AT: 0, EC: 0 };
        if (inst.code_etat in counts[inst.code_poste]) {
          counts[inst.code_poste][inst.code_etat as "VA" | "AT" | "EC"]++;
        }
      });
      setInstanceCounts(counts);
    }

    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const uoMap = React.useMemo(() => {
    const m: Record<string, UO> = {};
    uo.forEach(u => { m[u.id] = u; });
    return m;
  }, [uo]);

  const emploiMap = React.useMemo(() => {
    const m: Record<string, Emploi> = {};
    emplois.forEach(e => { m[e.code] = e; });
    return m;
  }, [emplois]);

  // RG-PST-ARBRE-FILTER-01 (Adil DAIA) : ensemble des unite_id retenus selon
  // la sélection arborescente. Si treeSel.unite_id est null → toutes les UO.
  // Si mode="descendants" → on inclut récursivement tous les enfants.
  const arboreUnitIds = useMemo(() => {
    if (!treeSel.unite_id) return null; // null = pas de filtre
    if (treeSel.mode === "directs") return new Set([treeSel.unite_id]);
    // Mode "descendants" : parcours en largeur de l'arbre
    const childrenByParent: Record<string, string[]> = {};
    uo.forEach(u => {
      if (u.parent_id) {
        if (!childrenByParent[u.parent_id]) childrenByParent[u.parent_id] = [];
        childrenByParent[u.parent_id].push(u.id);
      }
    });
    const result = new Set<string>([treeSel.unite_id]);
    const queue = [treeSel.unite_id];
    while (queue.length) {
      const id = queue.shift()!;
      (childrenByParent[id] || []).forEach(childId => {
        if (!result.has(childId)) {
          result.add(childId);
          queue.push(childId);
        }
      });
    }
    return result;
  }, [treeSel, uo]);

  const filtered = postes.filter(p => {
    // Filtre arborescent (panneau gauche)
    if (arboreUnitIds && (!p.unite_id || !arboreUnitIds.has(p.unite_id))) return false;
    if (filterUO && p.unite_id !== filterUO) return false;
    if (filterStatut && p.code_statut_poste !== filterStatut) return false;
    if (filterEtat && p.code_etat_poste !== filterEtat) return false;
    if (search) {
      const s = search.toLowerCase();
      return p.code.toLowerCase().includes(s) || p.libelle.toLowerCase().includes(s);
    }
    return true;
  });

  const set = (k: keyof Poste, v: any) => setForm(f => {
    const updated = { ...f, [k]: v };
    // RG-PST-NB-01 (Adil DAIA) : Si l'emploi sélectionné est un emploi de responsabilité,
    // forcer nombre_postes = 1 et verrouiller le champ
    if (k === "code_emploi" && v) {
      const emp = emploiMap[v];
      if (emp?.est_emploi_responsabilite) {
        updated.nombre_postes = 1;
      }
    }
    return updated;
  });

  const openNew = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, unite_id: filterUO || null });
    setError(null);
    setOpen(true);
  };

  const openEdit = (p: Poste) => {
    setEditing(p);
    setForm({ ...p, nombre_postes: p.nombre_postes ?? 1 });
    setError(null);
    setOpen(true);
  };

  /**
   * RG-PST-DET-01 (Adil DAIA) : Ouverture du dialogue de détail des instances d'un poste.
   * Charge les instances enrichies avec les informations du collaborateur affecté
   * et la date de la dernière affectation depuis la table collaborateur_affectations.
   */
  const openDetail = async (p: Poste) => {
    setDetailPoste(p);
    setDetailInstances([]);
    setDetailLoading(true);

    // Charger toutes les instances du poste
    const { data: rawInstances } = await (supabase
      .from("ref_poste_instances" as never)
      .select("*")
      .eq("code_poste" as never, p.code as never)
      .order("numero_instance" as never) as any);

    const instList: PosteInstance[] = (rawInstances as any[]) || [];

    // RG-PST-DET-01 (Adil DAIA) : Pour chaque instance attribuée (AT),
    // récupérer le collaborateur depuis la dernière affectation au poste
    const enriched = await Promise.all(instList.map(async (inst: any) => {
      let collaborateur_nom: string | undefined;
      let date_derniere_affectation: string | null = null;

      // Chercher l'affectation active liée à cette instance de poste
      const { data: affectations } = await (supabase
        .from("collaborateur_affectations" as never)
        .select("collaborateur_id, date_debut_poste, date_fin_poste")
        .eq("code_poste" as never, inst.code_instance as never)
        .is("date_fin_poste" as never, null as never)
        .order("date_debut_poste" as never, { ascending: false } as never)
        .limit(1) as any);

      const lastAffectation = (affectations as any[])?.[0];

      if (lastAffectation) {
        date_derniere_affectation = lastAffectation.date_debut_poste;

        // RG-PST-DET-01 (Adil DAIA) : Récupérer le nom complet du collaborateur affecté
        const { data: collab } = await (supabase
          .from("collaborateurs" as never)
          .select("nom, prenom, matricule")
          .eq("id" as never, lastAffectation.collaborateur_id as never)
          .single() as any);

        if (collab) {
          collaborateur_nom = `${(collab as any).prenom} ${(collab as any).nom} (${(collab as any).matricule})`;
        }
      } else {
        // Si pas d'affectation active, chercher la dernière affectation terminée pour la date
        const { data: lastFinished } = await (supabase
          .from("collaborateur_affectations" as never)
          .select("date_debut_poste, date_fin_poste")
          .eq("code_poste" as never, inst.code_instance as never)
          .not("date_fin_poste" as never, "is" as never, null as never)
          .order("date_fin_poste" as never, { ascending: false } as never)
          .limit(1) as any);

        const last = (lastFinished as any[])?.[0];
        if (last) {
          date_derniere_affectation = last.date_fin_poste;
        }
      }

      return {
        ...inst,
        collaborateur_nom,
        date_derniere_affectation,
      } as PosteInstance;
    }));

    setDetailInstances(enriched);
    setDetailLoading(false);
  };

  /**
   * RG-PST-NB-02 (Adil DAIA) : Génération automatique des instances de postes.
   * Lors de la sauvegarde, le système génère autant d'instances que le nombre_postes indiqué.
   * Chaque instance est identifiée par un code unique : code_poste + numéro à 3 chiffres (ex: DIR01-001).
   */
  const generateInstances = async (codePoste: string, nombrePostes: number, existingInstances: PosteInstance[]) => {
    const currentCount = existingInstances.length;

    if (nombrePostes > currentCount) {
      // RG-PST-NB-02 (Adil DAIA) : Ajout des nouvelles instances manquantes
      const newInstances = [];
      for (let i = currentCount + 1; i <= nombrePostes; i++) {
        const num = String(i).padStart(3, "0");
        newInstances.push({
          code_poste: codePoste,
          numero_instance: i,
          code_instance: `${codePoste}-${num}`,
          code_etat: "VA", // Nouvelle instance = Vacant
        });
      }
      await (supabase.from("ref_poste_instances" as never).insert(newInstances as never) as any);
    } else if (nombrePostes < currentCount) {
      // RG-PST-NB-04 (Adil DAIA) : Réduction uniquement si des instances vacantes existent.
      // On supprime en priorité les instances Vacantes en partant de la fin.
      const vacantes = existingInstances
        .filter(i => i.code_etat === "VA")
        .sort((a, b) => b.numero_instance - a.numero_instance);
      const toDelete = vacantes.slice(0, currentCount - nombrePostes);
      if (toDelete.length > 0) {
        await (supabase.from("ref_poste_instances" as never)
          .delete()
          .in("id" as never, toDelete.map(i => i.id) as never) as any);
      }
    }
  };

  const handleSave = async () => {
    if (!form.code.trim() || !form.libelle.trim()) {
      setError("Le code et le libellé sont obligatoires.");
      return;
    }

    // RG-PST-NB-01 (Adil DAIA) : Validation - emploi de responsabilité → nombre = 1 obligatoire
    const emploiSelectionne = form.code_emploi ? emploiMap[form.code_emploi] : null;
    if (emploiSelectionne?.est_emploi_responsabilite && form.nombre_postes !== 1) {
      setError("RG-PST-NB-01 : Un emploi de responsabilité impose obligatoirement 1 seul poste.");
      return;
    }

    if (form.nombre_postes < 1) {
      setError("Le nombre de postes doit être au minimum 1.");
      return;
    }

    setSaving(true);
    setError(null);

    const payload = {
      code: form.code.trim().toUpperCase(),
      libelle: form.libelle.trim(),
      code_emploi: form.code_emploi || null,
      unite_id: form.unite_id || null,
      description: form.description || null,
      actif: form.code_statut_poste === "AC",
      code_statut_poste: form.code_statut_poste,
      code_etat_poste: form.code_etat_poste,
      nombre_postes: form.nombre_postes,
      code_classification: form.code_classification || null,
      qualifications_requises: form.qualifications_requises || null,
    };

    if (editing) {
      const { error: err } = await (supabase.from("ref_poste" as never).update(payload as never).eq("code" as never, editing.code as never) as any);
      if (err) { setError(err.message); setSaving(false); return; }

      // RG-PST-NB-02 / RG-PST-NB-04 (Adil DAIA) : Synchroniser les instances après modification
      const { data: existingInst } = await (supabase.from("ref_poste_instances" as never)
        .select("*").eq("code_poste" as never, editing.code as never).order("numero_instance" as never) as any);
      await generateInstances(editing.code, form.nombre_postes, (existingInst as PosteInstance[]) || []);
    } else {
      const { error: err } = await (supabase.from("ref_poste" as never).insert(payload as never) as any);
      if (err) {
        setError(err.message.includes("duplicate") ? "Ce code existe déjà." : err.message);
        setSaving(false); return;
      }
      // RG-PST-NB-02 (Adil DAIA) : Génération initiale des instances pour le nouveau poste
      await generateInstances(payload.code, form.nombre_postes, []);
    }

    setSaving(false);
    setOpen(false);
    loadAll();
  };

  const handleDelete = async (code: string) => {
    if (!confirm(`Supprimer le poste "${code}" ? Toutes ses instances seront supprimées.`)) return;
    await (supabase.from("ref_poste" as never).delete().eq("code" as never, code as never) as any);
    loadAll();
  };

  // RG-PST-ETAT (Adil DAIA) : Changer l'état d'un poste principal depuis la liste
  const handleChangeEtat = async (poste: Poste, newEtat: string) => {
    const actif = poste.code_statut_poste === "AC";
    if (!actif) return;
    await (supabase.from("ref_poste" as never).update({ code_etat_poste: newEtat } as never).eq("code" as never, poste.code as never) as any);
    loadAll();
  };

  /**
   * RG-PST-DET-01 (Adil DAIA) : Changement d'état d'une instance depuis le dialogue de détail.
   * Après la modification, recharge les instances enrichies du poste en cours de consultation.
   */
  const handleChangeInstanceEtat = async (instanceId: string, newEtat: string) => {
    await (supabase.from("ref_poste_instances" as never)
      .update({ code_etat: newEtat } as never)
      .eq("id" as never, instanceId as never) as any);

    // Recharger le détail du poste actuellement affiché
    if (detailPoste) {
      await openDetail(detailPoste);
    }
    // Recharger les compteurs dans la liste
    loadAll();
  };

  const uoOptions = uo.map(u => ({
    value: u.id,
    label: u.libelle,
    meta: u.code || undefined,
  }));

  const emploiOptions = emplois.map(e => ({
    value: e.code,
    label: e.libelle + (e.est_emploi_responsabilite ? " ★" : ""),
    meta: e.code
  }));

  const getTransitions = (etat: string) => ETATS.filter(e => e.value !== etat && TRANSITIONS[etat]?.includes(e.value));

  // RG-PST-NB-01 (Adil DAIA) : Détecter si l'emploi sélectionné est un emploi de responsabilité
  const isEmploiResponsabilite = form.code_emploi ? (emploiMap[form.code_emploi]?.est_emploi_responsabilite ?? false) : false;

  // RG-PST-NB-04 (Adil DAIA) : Calculer le nombre max autorisé pour réduction
  const getMaxReduction = (codePoste: string): number => {
    const insts = instances[codePoste] || [];
    const nonVacantes = insts.filter(i => i.code_etat !== "VA").length;
    return Math.max(nonVacantes, 1);
  };

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      {/* Fil d'Ariane */}
      <nav className="flex items-center gap-1 text-xs mb-5" style={{ color: "hsl(var(--muted-foreground))" }}>
        <button onClick={() => navigate("/gpec")} className="hover:underline" style={{ color: "hsl(var(--accent))" }}>
          GPEC
        </button>
        <span>/</span>
        <span style={{ color: "hsl(var(--foreground))" }}>Postes</span>
      </nav>

      {/* En-tête */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "hsl(var(--foreground))" }}>
            Référentiel des postes
          </h1>
          <p className="text-sm mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
            Gestion des postes par unité organisationnelle
          </p>
        </div>
        <Button onClick={openNew} className="gap-2">
          <Plus size={16} /> Nouveau poste
        </Button>
      </div>

      {/* Layout 2 panneaux : arbre UO à gauche + filtres/stats/tableau à droite (RG-PST-ARBRE-01) */}
      <div className="grid gap-5" style={{ gridTemplateColumns: "320px minmax(0, 1fr)" }}>
        {/* Panneau GAUCHE — Arbre UO */}
        <UOTreePanel selection={treeSel} onChange={setTreeSel} />

        {/* Panneau DROITE — Filtres + Stats + Tableau */}
        <div>
      {/* Filtres */}
      <div className="rounded-xl border p-4 mb-5 grid grid-cols-1 md:grid-cols-4 gap-3"
        style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher un poste..."
            className="w-full pl-8 pr-3 py-2 rounded-lg border text-sm outline-none"
            style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))", height: 38 }}
          />
        </div>
        <DropdownSelect value={filterUO} onChange={setFilterUO} options={uoOptions} placeholder="Toutes les UO" emptyLabel="Toutes les UO" />
        <DropdownSelect value={filterStatut} onChange={setFilterStatut} options={STATUTS.map(s => ({ value: s.value, label: s.label }))} placeholder="Tous les statuts" emptyLabel="Tous les statuts" />
        <DropdownSelect value={filterEtat} onChange={setFilterEtat} options={ETATS.map(e => ({ value: e.value, label: e.label }))} placeholder="Tous les états" emptyLabel="Tous les états" />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          { label: "Total postes", count: postes.reduce((acc, p) => acc + (p.nombre_postes || 1), 0), color: "hsl(var(--accent))" },
          { label: "Postes vacants", count: Object.values(instanceCounts).reduce((acc, c) => acc + (c.VA || 0), 0), color: "hsl(142 70% 40%)" },
          { label: "Attribués", count: Object.values(instanceCounts).reduce((acc, c) => acc + (c.AT || 0), 0), color: "hsl(213 73% 45%)" },
          { label: "En cours", count: Object.values(instanceCounts).reduce((acc, c) => acc + (c.EC || 0), 0), color: "hsl(39 95% 40%)" },
        ].map(stat => (
          <div key={stat.label} className="rounded-xl border p-4"
            style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
            <p className="text-2xl font-bold" style={{ color: stat.color }}>{stat.count}</p>
            <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Tableau */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "hsl(var(--muted)/0.4)", borderBottom: "1px solid hsl(var(--border))" }}>
                {["Code", "Libellé", "Unité organisationnelle", "Emploi", "Instances", "Statut", "État", "Transitions", "Actions"].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                    style={{ color: "hsl(var(--muted-foreground))" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="text-center py-12">
                    <Loader2 size={24} className="animate-spin mx-auto" style={{ color: "hsl(var(--accent))" }} />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Aucun poste trouvé
                  </td>
                </tr>
              ) : filtered.map((p, i) => {
                const uoInfo = p.unite_id ? uoMap[p.unite_id] : null;
                const emploiInfo = p.code_emploi ? emploiMap[p.code_emploi] : null;
                const transitions = getTransitions(p.code_etat_poste);
                const isInactif = p.code_statut_poste === "IN";
                // RG-PST-DET-01 (Adil DAIA) : Récupérer les compteurs par état pour affichage dans la liste
                const counts = instanceCounts[p.code] || { VA: 0, AT: 0, EC: 0 };
                const totalInstances = (counts.VA || 0) + (counts.AT || 0) + (counts.EC || 0);

                return (
                  <tr key={p.code}
                    style={{
                      borderBottom: "1px solid hsl(var(--border))",
                      background: isInactif ? "hsl(var(--muted)/0.2)" : i % 2 === 0 ? "transparent" : "hsl(var(--muted)/0.15)",
                      opacity: isInactif ? 0.65 : 1,
                    }}>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded"
                        style={{ background: "hsl(var(--accent)/0.1)", color: "hsl(var(--accent))" }}>
                        {p.code}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium" style={{ color: "hsl(var(--foreground))" }}>
                      {p.libelle}
                      {p.description && (
                        <p className="text-xs mt-0.5 line-clamp-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                          {p.description}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {uoInfo ? (
                        <div className="flex items-center gap-1.5">
                          <Building2 size={13} style={{ color: "hsl(var(--accent))", flexShrink: 0 }} />
                          <span className="text-xs" style={{ color: "hsl(var(--foreground))" }}>{uoInfo.libelle}</span>
                        </div>
                      ) : <span style={{ color: "hsl(var(--muted-foreground))" }}>—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {emploiInfo ? (
                        <div className="flex items-center gap-1">
                          <Briefcase size={11} style={{ color: "hsl(var(--muted-foreground))" }} />
                          <span style={{ color: "hsl(var(--foreground))" }}>{emploiInfo.libelle}</span>
                          {/* RG-EMP-01 (Adil DAIA) : Indicateur visuel emploi de responsabilité */}
                          {emploiInfo.est_emploi_responsabilite && (
                            <span className="text-xs px-1 rounded" style={{ background: "hsl(280 55% 50%/0.12)", color: "hsl(280 55% 50%)" }} title="Emploi de responsabilité">★</span>
                          )}
                        </div>
                      ) : <span style={{ color: "hsl(var(--muted-foreground))" }}>—</span>}
                    </td>

                    {/* RG-PST-DET-01 (Adil DAIA) : Colonne Instances avec compteurs par état.
                        Un clic ouvre le dialogue de détail des instances du poste. */}
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openDetail(p)}
                        title="Voir le détail des instances"
                        className="flex items-center gap-2 px-2 py-1.5 rounded-lg border transition-colors hover:border-accent/50 group"
                        style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted)/0.3)" }}
                      >
                        {/* Total */}
                        <div className="flex items-center gap-1">
                          <Hash size={10} style={{ color: "hsl(var(--muted-foreground))" }} />
                          <span className="text-xs font-bold" style={{ color: "hsl(var(--foreground))" }}>{totalInstances}</span>
                        </div>
                        {/* Attribués */}
                        {counts.AT > 0 && (
                          <div className="flex items-center gap-0.5">
                            <Users size={10} style={{ color: "hsl(213 73% 45%)" }} />
                            <span className="text-xs font-semibold" style={{ color: "hsl(213 73% 45%)" }}>{counts.AT}</span>
                          </div>
                        )}
                        {/* Vacants */}
                        {counts.VA > 0 && (
                          <span className="text-xs font-medium px-1 rounded-sm"
                            style={{ background: "hsl(142 70% 40%/0.12)", color: "hsl(142 70% 40%)" }}>
                            {counts.VA}V
                          </span>
                        )}
                        {/* En cours */}
                        {counts.EC > 0 && (
                          <span className="text-xs font-medium px-1 rounded-sm"
                            style={{ background: "hsl(39 95% 40%/0.12)", color: "hsl(39 95% 40%)" }}>
                            {counts.EC}EC
                          </span>
                        )}
                        <Eye size={10} className="ml-0.5 opacity-50 group-hover:opacity-100 transition-opacity"
                          style={{ color: "hsl(var(--accent))" }} />
                      </button>
                    </td>

                    <td className="px-4 py-3"><StatutBadge statut={p.code_statut_poste} /></td>
                    <td className="px-4 py-3"><EtatBadge etat={p.code_etat_poste} /></td>
                    <td className="px-4 py-3">
                      {!isInactif && transitions.length > 0 ? (
                        <div className="flex items-center gap-1 flex-wrap">
                          {transitions.map(t => (
                            <button key={t.value} onClick={() => handleChangeEtat(p, t.value)}
                              className="text-xs px-2 py-0.5 rounded-full border transition-colors"
                              style={{ borderColor: t.color, color: t.color, background: "transparent" }}
                              title={`Passer à : ${t.label}`}>
                              → {t.label}
                            </button>
                          ))}
                        </div>
                      ) : <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(p)}
                          className="p-1.5 rounded transition-colors"
                          style={{ color: "hsl(var(--accent))" }}>
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => handleDelete(p.code)}
                          className="p-1.5 rounded transition-colors"
                          style={{ color: "hsl(0 84% 55%)" }}>
                          <Trash2 size={14} />
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

        </div>
      </div>
      {/* Fin du layout 2 panneaux */}

      {/* RG-PST-DET-01 (Adil DAIA) : Dialogue de détail des instances d'un poste */}
      <InstancesDetailDialog
        poste={detailPoste}
        instances={detailInstances}
        loading={detailLoading}
        onClose={() => setDetailPoste(null)}
        onChangeEtat={handleChangeInstanceEtat}
      />

      {/* Dialog création/édition */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Modifier le poste" : "Nouveau poste"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <FI label="Code" value={form.code} onChange={v => set("code", v.toUpperCase())}
                required disabled={!!editing} placeholder="EX: DIR01" />
              <FI label="Libellé" value={form.libelle} onChange={v => set("libelle", v)} required />
            </div>

            {/* UO */}
            <DropdownSelect
              label="Unité organisationnelle *"
              value={form.unite_id || ""} onChange={v => set("unite_id", v || null)}
              options={uoOptions} required
            />

            {/* Emploi */}
            <DropdownSelect
              label="Emploi rattaché"
              value={form.code_emploi || ""} onChange={v => set("code_emploi", v || null)}
              options={emploiOptions}
            />

            {/* RG-EMP-01 (Adil DAIA) : Alerte emploi de responsabilité */}
            {isEmploiResponsabilite && (
              <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs"
                style={{ background: "hsl(280 55% 50%/0.1)", border: "1px solid hsl(280 55% 50%/0.3)", color: "hsl(280 55% 45%)" }}>
                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                <span><strong>RG-PST-NB-01 :</strong> Emploi de responsabilité — le nombre de postes est obligatoirement limité à 1.</span>
              </div>
            )}

            {/* RG-PST-NB-01 (Adil DAIA) : Champ nombre de postes */}
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                Nombre de postes *
                {isEmploiResponsabilite && (
                  <span className="ml-2 text-xs" style={{ color: "hsl(280 55% 50%)" }}>(Emploi responsabilité : max 1)</span>
                )}
              </label>
              <input
                type="number"
                min={1}
                max={isEmploiResponsabilite ? 1 : 999}
                value={form.nombre_postes}
                onChange={e => {
                  const val = parseInt(e.target.value) || 1;
                  // RG-PST-NB-01 (Adil DAIA) : Bloquer à 1 si emploi de responsabilité
                  set("nombre_postes", isEmploiResponsabilite ? 1 : Math.max(1, val));
                }}
                disabled={isEmploiResponsabilite}
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none transition-all"
                style={{
                  borderColor: "hsl(var(--border))",
                  background: isEmploiResponsabilite ? "hsl(var(--muted)/0.4)" : "hsl(var(--background))",
                  color: "hsl(var(--foreground))", height: 38,
                  cursor: isEmploiResponsabilite ? "not-allowed" : "auto",
                }}
              />
              {editing && instances[editing.code] && (
                <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                  {/* RG-PST-NB-04 (Adil DAIA) : Information sur la réduction possible */}
                  {instances[editing.code].filter(i => i.code_etat !== "VA").length > 0 && (
                    <span style={{ color: "hsl(39 95% 40%)" }}>
                      ⚠ {instances[editing.code].filter(i => i.code_etat !== "VA").length} instance(s) non-vacante(s) — la réduction est limitée.
                    </span>
                  )}
                </p>
              )}
            </div>

            {/* Classification (hiérarchique : surcharge l'emploi si définie) */}
            <DropdownSelect
              label="Classification (surcharge emploi)"
              value={form.code_classification || ""} onChange={v => set("code_classification", v || null)}
              options={classifications}
              placeholder="— Hériter de l'emploi —"
            />

            {/* Qualifications requises */}
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                Qualifications / Compétences requises
              </label>
              <textarea
                value={form.qualifications_requises || ""} onChange={e => set("qualifications_requises", e.target.value)}
                rows={2} className="w-full px-3 py-2 rounded-lg border text-sm outline-none resize-none"
                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
                placeholder="Ex: Licence en gestion, 3 ans d'expérience..."
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                Description
              </label>
              <textarea
                value={form.description || ""} onChange={e => set("description", e.target.value)}
                rows={2} className="w-full px-3 py-2 rounded-lg border text-sm outline-none resize-none"
                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
              />
            </div>

            {/* Statut + État */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Statut
                </label>
                <div className="flex gap-2">
                  {STATUTS.map(s => (
                    <button key={s.value} type="button"
                      onClick={() => {
                        set("code_statut_poste", s.value);
                        set("actif", s.value === "AC");
                      }}
                      className="flex-1 py-1.5 rounded-lg border text-xs font-semibold transition-all"
                      style={{
                        borderColor: form.code_statut_poste === s.value ? s.color : "hsl(var(--border))",
                        background: form.code_statut_poste === s.value ? `${s.color}20` : "transparent",
                        color: form.code_statut_poste === s.value ? s.color : "hsl(var(--muted-foreground))",
                      }}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>
                  État
                </label>
                <div className="flex gap-1">
                  {ETATS.map(e => {
                    const allowed = editing
                      ? (form.code_etat_poste === e.value || TRANSITIONS[form.code_etat_poste]?.includes(e.value))
                      : true;
                    return (
                      <button key={e.value} type="button"
                        disabled={!allowed}
                        onClick={() => allowed && set("code_etat_poste", e.value)}
                        className="flex-1 py-1.5 rounded-lg border text-xs font-semibold transition-all"
                        style={{
                          borderColor: form.code_etat_poste === e.value ? e.color : "hsl(var(--border))",
                          background: form.code_etat_poste === e.value ? e.bg : "transparent",
                          color: form.code_etat_poste === e.value ? e.color : "hsl(var(--muted-foreground))",
                          opacity: !allowed ? 0.35 : 1,
                          cursor: !allowed ? "not-allowed" : "pointer",
                        }}
                        title={e.label}>
                        {e.value}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                  {ETATS.find(e => e.value === form.code_etat_poste)?.label}
                </p>
              </div>
            </div>

            {/* Règles de transition */}
            {editing && (
              <div className="rounded-lg p-3 text-xs" style={{ background: "hsl(var(--muted)/0.4)", color: "hsl(var(--muted-foreground))" }}>
                <p className="font-semibold mb-1">Transitions autorisées depuis {ETATS.find(e => e.value === editing.code_etat_poste)?.label} :</p>
                {TRANSITIONS[editing.code_etat_poste]?.map(t => {
                  const etat = ETATS.find(e => e.value === t);
                  return <span key={t} className="mr-2" style={{ color: etat?.color }}>→ {etat?.label}</span>;
                })}
              </div>
            )}

            {error && <p className="text-sm" style={{ color: "hsl(0 84% 55%)" }}>{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PostesPage;
