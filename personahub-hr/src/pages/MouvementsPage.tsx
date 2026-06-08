/**
 * MouvementsPage.tsx — Mouvements internes (REFONTE UI 05/2026)
 * ─────────────────────────────────────────────────────────────────────────────
 * ✓ KPI cards (total, ce mois, promotions, temporaires)
 * ✓ Avatars colorés avec initiales par collaborateur
 * ✓ Badges typés et statuts visuels
 * ✓ Modal "Nouveau mouvement" redesigné : contrat affiché, trajet côte à côte
 * ✓ Modal "Voir détail" enrichi avec timeline et sections claires
 * ✓ Alertes temporaires compactes en bandeau
 * ✓ Toute la logique API/filtres/tri inchangée
 */
import React, { useEffect, useState, useMemo } from "react";
import { db } from "@/lib/api";
import { useNavigate } from "react-router-dom";
import {
  ArrowRightLeft, Search, AlertCircle, ExternalLink, Plus, X,
  ChevronDown, Check, Calendar, Filter, RotateCcw, FileText, Info,
  ArrowUp, ArrowDown, ArrowUpDown, Eye, FileDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import MouvementForm from "@/components/mouvement/MouvementForm";

// ── Types ────────────────────────────────────────────────────────────────────
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
  date_decision?: string | null;
  statut: string;
  commentaire: string | null;
  archive?: boolean;
}

interface ContractInfo {
  type_libelle: string;
  date_debut: string;
  date_fin: string | null;
}

type ModePeriode = "TOUS" | "PLAGE" | "MOIS" | "TRIMESTRE" | "SEMESTRE" | "ANNEE";
type SortKey = "collaborateur" | "type" | "date_effet" | "trajet";
type SortDir = "asc" | "desc";

const MOIS_LABELS = ["Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 8 }, (_, i) => CURRENT_YEAR - 3 + i);

// ── Couleurs avatar ───────────────────────────────────────────────────────────
const AVATAR_PALETTE = [
  { bg: "bg-blue-100 dark:bg-blue-900/40", text: "text-blue-700 dark:text-blue-300" },
  { bg: "bg-violet-100 dark:bg-violet-900/40", text: "text-violet-700 dark:text-violet-300" },
  { bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-700 dark:text-emerald-300" },
  { bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-700 dark:text-amber-300" },
  { bg: "bg-rose-100 dark:bg-rose-900/40", text: "text-rose-700 dark:text-rose-300" },
  { bg: "bg-teal-100 dark:bg-teal-900/40", text: "text-teal-700 dark:text-teal-300" },
  { bg: "bg-orange-100 dark:bg-orange-900/40", text: "text-orange-700 dark:text-orange-300" },
  { bg: "bg-indigo-100 dark:bg-indigo-900/40", text: "text-indigo-700 dark:text-indigo-300" },
];

const getAvatarColor = (id: string) => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) & 0xffffff;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
};

const getInitials = (prenom: string, nom: string) =>
  `${prenom?.[0] ?? ""}${nom?.[0] ?? ""}`.toUpperCase();

// ── Avatar ────────────────────────────────────────────────────────────────────
const Avatar: React.FC<{ id: string; prenom: string; nom: string; size?: "sm" | "md" }> = ({
  id, prenom, nom, size = "md",
}) => {
  const { bg, text } = getAvatarColor(id);
  const sizeClass = size === "sm" ? "w-7 h-7 text-[10px]" : "w-9 h-9 text-xs";
  return (
    <div className={`${sizeClass} ${bg} ${text} rounded-full flex items-center justify-center font-semibold flex-shrink-0`}>
      {getInitials(prenom, nom)}
    </div>
  );
};

// ── TypeBadge ─────────────────────────────────────────────────────────────────
const TYPE_STYLES: Record<string, string> = {
  PROM: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  TRANS: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  RECR: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  DETA: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  INTE: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  CHGT: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
};
const DEFAULT_TYPE_STYLE = "bg-muted text-muted-foreground";

const StatutBadge: React.FC<{ statut: string }> = ({ statut }) => {
  const styles: Record<string, string> = {
    ACTIF: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    CLOTURE: "bg-muted text-muted-foreground",
    ANNULE: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  };
  const labels: Record<string, string> = {
    ACTIF: "Actif", CLOTURE: "Clôturé", ANNULE: "Annulé",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${styles[statut] ?? styles.ACTIF}`}>
      {labels[statut] ?? statut}
    </span>
  );
};

// ── KPI Card ──────────────────────────────────────────────────────────────────
const KpiCard: React.FC<{
  label: string;
  value: number | string;
  sub?: string;
  accent?: string;
}> = ({ label, value, sub, accent }) => (
  <div className="rounded-xl border bg-muted/20 px-4 py-3 flex flex-col gap-1" style={{ borderColor: "hsl(var(--border))" }}>
    <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">{label}</p>
    <p className={`text-2xl font-semibold ${accent ?? "text-foreground"}`}>{value}</p>
    {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
  </div>
);

// ── MultiSelect ──────────────────────────────────────────────────────────────
interface MultiSelectProps {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}

const MultiSelect: React.FC<MultiSelectProps> = ({ label, options, selected, onChange, placeholder }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (v: string) => {
    onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);
  };

  const displayLabel =
    selected.length === 0
      ? (placeholder ?? label)
      : selected.length === 1
      ? options.find((o) => o.value === selected[0])?.label ?? selected[0]
      : `${selected.length} sélectionnés`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
          selected.length > 0
            ? "border-accent/50 bg-accent/10 text-accent"
            : "border-border bg-background text-muted-foreground hover:bg-muted/30"
        }`}
      >
        <Filter size={11} />
        <span className="max-w-[140px] truncate">{displayLabel}</span>
        {selected.length > 0 && (
          <span className="ml-0.5 w-4 h-4 rounded-full text-[9px] flex items-center justify-center font-bold bg-accent text-white">
            {selected.length}
          </span>
        )}
        <ChevronDown size={11} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 rounded-xl border shadow-lg z-50 min-w-[220px] bg-popover border-border">
          {options.length > 6 && (
            <div className="p-2 border-b border-border">
              <div className="relative">
                <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  className="w-full pl-7 pr-2 py-1.5 text-xs rounded-lg border border-border bg-transparent outline-none"
                  placeholder="Rechercher…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
          )}
          <div className="max-h-52 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground px-3 py-2 italic">Aucun résultat</p>
            ) : (
              filtered.map((opt) => {
                const checked = selected.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggle(opt.value)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-accent/10 transition-colors"
                  >
                    <span className={`w-4 h-4 rounded flex items-center justify-center border flex-shrink-0 ${
                      checked ? "bg-accent border-accent" : "border-border"
                    }`}>
                      {checked && <Check size={9} color="white" strokeWidth={3} />}
                    </span>
                    <span className="truncate">{opt.label}</span>
                  </button>
                );
              })
            )}
          </div>
          {selected.length > 0 && (
            <div className="p-2 border-t border-border">
              <button
                type="button"
                onClick={() => { onChange([]); setOpen(false); }}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <X size={10} /> Effacer la sélection
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── FiltrePeriode ─────────────────────────────────────────────────────────────
interface FiltrePeriodeProps {
  mode: ModePeriode; setMode: (m: ModePeriode) => void;
  plageDebut: string; setPlageDebut: (v: string) => void;
  plageFin: string; setPlageFin: (v: string) => void;
  mois: number; setMois: (v: number) => void;
  trimestre: number; setTrimestre: (v: number) => void;
  semestre: number; setSemestre: (v: number) => void;
  annee: number; setAnnee: (v: number) => void;
}

const FiltrePeriode: React.FC<FiltrePeriodeProps> = ({
  mode, setMode,
  plageDebut, setPlageDebut, plageFin, setPlageFin,
  mois, setMois, trimestre, setTrimestre, semestre, setSemestre,
  annee, setAnnee,
}) => {
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const modeLabel: Record<ModePeriode, string> = {
    TOUS: "Toutes les dates",
    PLAGE: "Plage personnalisée",
    MOIS: `${MOIS_LABELS[mois]} ${annee}`,
    TRIMESTRE: `T${trimestre} ${annee}`,
    SEMESTRE: `S${semestre} ${annee}`,
    ANNEE: `Année ${annee}`,
  };

  const isActive = mode !== "TOUS";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
          isActive
            ? "border-accent/50 bg-accent/10 text-accent"
            : "border-border bg-background text-muted-foreground hover:bg-muted/30"
        }`}
      >
        <Calendar size={11} />
        <span>{modeLabel[mode]}</span>
        <ChevronDown size={11} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 rounded-xl border shadow-lg z-50 min-w-[280px] p-3 space-y-3 bg-popover border-border">
          <div className="grid grid-cols-3 gap-1">
            {(["TOUS", "MOIS", "TRIMESTRE", "SEMESTRE", "ANNEE", "PLAGE"] as ModePeriode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                  mode === m ? "bg-accent text-white" : "bg-muted/40 text-muted-foreground hover:bg-muted/70"
                }`}
              >
                {m === "TOUS" ? "Tous" : m === "PLAGE" ? "Plage" : m}
              </button>
            ))}
          </div>

          {mode !== "TOUS" && mode !== "PLAGE" && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground uppercase font-medium">Année</span>
              <select
                value={annee}
                onChange={(e) => setAnnee(Number(e.target.value))}
                className="flex-1 text-xs px-2 py-1 rounded-lg border border-border bg-transparent outline-none"
              >
                {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          )}

          {mode === "MOIS" && (
            <div className="grid grid-cols-4 gap-1">
              {MOIS_LABELS.map((l, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setMois(i)}
                  className={`px-1 py-1 rounded text-[10px] font-medium transition-colors ${
                    mois === i ? "text-accent font-bold bg-accent/10" : "text-muted-foreground"
                  }`}
                >{l}</button>
              ))}
            </div>
          )}

          {mode === "TRIMESTRE" && (
            <div className="grid grid-cols-4 gap-1">
              {[1, 2, 3, 4].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTrimestre(t)}
                  className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    trimestre === t ? "bg-accent text-white" : "bg-muted/40 text-muted-foreground"
                  }`}
                >T{t}</button>
              ))}
            </div>
          )}

          {mode === "SEMESTRE" && (
            <div className="grid grid-cols-2 gap-1">
              {[1, 2].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSemestre(s)}
                  className={`px-2 py-2 rounded-lg text-xs font-medium transition-colors ${
                    semestre === s ? "bg-accent text-white" : "bg-muted/40 text-muted-foreground"
                  }`}
                >Semestre {s}</button>
              ))}
            </div>
          )}

          {mode === "PLAGE" && (
            <div className="space-y-2">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase font-medium mb-1">Du</p>
                <input
                  type="date"
                  value={plageDebut}
                  onChange={(e) => setPlageDebut(e.target.value)}
                  className="w-full text-xs px-2 py-1.5 rounded-lg border border-border bg-transparent outline-none"
                />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase font-medium mb-1">Au</p>
                <input
                  type="date"
                  value={plageFin}
                  onChange={(e) => setPlageFin(e.target.value)}
                  className="w-full text-xs px-2 py-1.5 rounded-lg border border-border bg-transparent outline-none"
                />
              </div>
            </div>
          )}

          {mode !== "TOUS" && (
            <button
              type="button"
              onClick={() => { setMode("TOUS"); setOpen(false); }}
              className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 pt-1 border-t border-border w-full"
            >
              <X size={9} /> Réinitialiser la période
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// ── En-tête triable ───────────────────────────────────────────────────────────
const SortableTh: React.FC<{
  label: string; k: SortKey; current: SortKey; dir: SortDir; onClick: (k: SortKey) => void;
}> = ({ label, k, current, dir, onClick }) => {
  const active = current === k;
  return (
    <th
      className={`text-left px-4 py-3 text-[10px] uppercase tracking-widest font-semibold cursor-pointer select-none transition-colors ${
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
      onClick={() => onClick(k)}
    >
      <span className="inline-flex items-center gap-1.5">
        {label}
        {active ? (
          dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />
        ) : (
          <ArrowUpDown size={11} className="opacity-35" />
        )}
      </span>
    </th>
  );
};

// ── Dialog visualisation lecture seule ────────────────────────────────────────
interface ViewProps {
  mouvement: MouvementRow | null;
  onClose: () => void;
  collabMap: Record<string, { nom: string; prenom: string; matricule: string }>;
  typeMap: Record<string, { libelle: string; est_temporaire: boolean; est_definitif: boolean }>;
  uoMap: Record<string, string>;
  posteMap: Record<string, string>;
}

const ViewMouvementDialog: React.FC<ViewProps> = ({
  mouvement, onClose, collabMap, typeMap, uoMap, posteMap,
}) => {
  if (!mouvement) return null;
  const m = mouvement;
  const c = collabMap[m.collaborateur_id];
  const t = typeMap[m.code_type_mouvement];

  const resolvePoste = (code: string | null) => {
    if (!code) return "—";
    const parent = code.includes("-") ? code.split("-").slice(0, -1).join("-") : code;
    return posteMap[parent] || posteMap[code] || code;
  };

  const fmtDate = (d: string | null | undefined) =>
    d ? new Date(d).toLocaleDateString("fr-FR") : "—";

  const Field: React.FC<{ label: string; value?: React.ReactNode }> = ({ label, value }) => (
    <div>
      <p className="text-[10px] text-muted-foreground uppercase font-medium tracking-wider mb-0.5">{label}</p>
      <p className="text-sm font-medium">{value ?? "—"}</p>
    </div>
  );

  const typeStyle = TYPE_STYLES[m.code_type_mouvement] ?? DEFAULT_TYPE_STYLE;

  return (
    <Dialog open={!!mouvement} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye size={16} className="text-muted-foreground" />
            Détail du mouvement
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 mt-1">
          {/* Bandeau collaborateur */}
          <div className="flex items-center gap-3 p-4 rounded-xl bg-muted/20 border border-border">
            {c && <Avatar id={m.collaborateur_id} prenom={c.prenom} nom={c.nom} />}
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">{c ? `${c.prenom} ${c.nom}` : "—"}</p>
              <p className="text-xs text-muted-foreground">{c?.matricule}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold ${typeStyle}`}>
                {t?.libelle || m.code_type_mouvement}
                {t?.est_temporaire && <span className="ml-1.5 opacity-70">· temp.</span>}
              </span>
              <StatutBadge statut={m.statut} />
            </div>
          </div>

          {/* Type & date */}
          <section className="grid grid-cols-2 gap-4">
            <Field label="Date d'effet" value={fmtDate(m.date_effet)} />
            <Field
              label="Nature"
              value={
                <span className="flex items-center gap-1.5">
                  {t?.est_temporaire && <span className="px-1.5 py-0.5 rounded text-[9px] bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300">Temporaire</span>}
                  {t?.est_definitif && <span className="px-1.5 py-0.5 rounded text-[9px] bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">Définitif</span>}
                  {!t?.est_temporaire && !t?.est_definitif && "—"}
                </span>
              }
            />
          </section>

          {(m.date_fin_prevue || m.date_fin_effective) && (
            <section className="grid grid-cols-2 gap-4">
              <Field label="Date fin prévue" value={fmtDate(m.date_fin_prevue)} />
              <Field label="Date fin effective" value={fmtDate(m.date_fin_effective)} />
            </section>
          )}

          {/* Trajet */}
          <section className="rounded-xl border border-border overflow-hidden">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 py-2 bg-muted/30 text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
              <span>Depuis</span>
              <ArrowRightLeft size={12} />
              <span>Vers</span>
            </div>
            <div className="grid grid-cols-2 divide-x divide-border">
              <div className="px-4 py-3">
                <p className="text-xs font-medium">{resolvePoste(m.ancien_poste)}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {m.ancienne_unite_id ? uoMap[m.ancienne_unite_id] || "—" : "—"}
                </p>
              </div>
              <div className="px-4 py-3">
                <p className="text-xs font-medium">{resolvePoste(m.nouveau_poste)}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {m.nouvelle_unite_id ? uoMap[m.nouvelle_unite_id] || "—" : "—"}
                </p>
              </div>
            </div>
          </section>

          {/* Décision */}
          <section className="grid grid-cols-2 gap-4">
            <Field label="Référence décision" value={m.reference_decision} />
            <Field label="Date décision" value={fmtDate(m.date_decision)} />
          </section>

          {/* Commentaire */}
          {m.commentaire && (
            <section>
              <p className="text-[10px] text-muted-foreground uppercase font-medium tracking-wider mb-1.5">Commentaire</p>
              <p className="text-sm italic whitespace-pre-wrap p-3 rounded-lg bg-muted/30 border border-border">
                {m.commentaire}
              </p>
            </section>
          )}
        </div>

        <div className="flex justify-end mt-4 pt-4 border-t border-border">
          <Button size="sm" variant="outline" onClick={onClose}>Fermer</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Page principale
// ─────────────────────────────────────────────────────────────────────────────
const MouvementsPage: React.FC = () => {
  const [rows, setRows] = useState<MouvementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Filtres
  const [filterCollabs, setFilterCollabs] = useState<string[]>([]);
  const [filterStatuts, setFilterStatuts] = useState<string[]>([]);
  const [filterTypes, setFilterTypes] = useState<string[]>([]);
  const [filterNature, setFilterNature] = useState<string[]>([]);
  const [filterUOs, setFilterUOs] = useState<string[]>([]);

  // Période
  const [modePeriode, setModePeriode] = useState<ModePeriode>("TOUS");
  const [plageDebut, setPlageDebut] = useState("");
  const [plageFin, setPlageFin] = useState("");
  const [moisFiltre, setMoisFiltre] = useState(new Date().getMonth());
  const [trimestreFiltre, setTrimestreFiltre] = useState(Math.ceil((new Date().getMonth() + 1) / 3));
  const [semestreFiltre, setSemestreFiltre] = useState(new Date().getMonth() < 6 ? 1 : 2);
  const [anneeFiltre, setAnneeFiltre] = useState(CURRENT_YEAR);

  // Maps de référence
  const [collabMap, setCollabMap] = useState<Record<string, { nom: string; prenom: string; matricule: string }>>({});
  const [typeMap, setTypeMap] = useState<Record<string, { libelle: string; est_temporaire: boolean; est_definitif: boolean }>>({});
  const [uoMap, setUoMap] = useState<Record<string, string>>({});
  const [posteMap, setPosteMap] = useState<Record<string, string>>({});

  // Dialog "Nouveau mouvement"
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [selectedCollabId, setSelectedCollabId] = useState<string | null>(null);
  const [currentContract, setCurrentContract] = useState<ContractInfo | null>(null);
  const [collabSearch, setCollabSearch] = useState("");
  const [collabList, setCollabList] = useState<{ id: string; nom: string; prenom: string; matricule: string }[]>([]);

  // Tri
  const [sortKey, setSortKey] = useState<SortKey>("date_effet");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Dialog visualisation
  const [viewMvt, setViewMvt] = useState<MouvementRow | null>(null);

  const navigate = useNavigate();

  // ── Chargement initial ──────────────────────────────────────────────────────
  const loadAll = async () => {
    setLoading(true);
    try {
      const [mvts, collabs, types, uos, postes] = await Promise.all([
        db.list<MouvementRow>("collaborateur_mouvements", { archive: false, order: "-date_effet" }),
        db.list<any>("collaborateurs", { archive: false }),
        db.list<any>("ref_type_mouvement"),
        db.list<any>("unites_organisationnelles"),
        db.list<any>("ref_poste"),
      ]);
      setRows(mvts);

      const collabArr = collabs.filter((c: any) => c.statut_collaborateur !== "SORTI");
      const cm: Record<string, { nom: string; prenom: string; matricule: string }> = {};
      collabArr.forEach((c: any) => { cm[c.id] = { nom: c.nom, prenom: c.prenom, matricule: c.matricule }; });
      setCollabMap(cm);
      setCollabList(collabArr.map((c: any) => ({ id: c.id, nom: c.nom, prenom: c.prenom, matricule: c.matricule })));

      const tm: Record<string, { libelle: string; est_temporaire: boolean; est_definitif: boolean }> = {};
      types.forEach((t: any) => { tm[t.code] = { libelle: t.libelle, est_temporaire: !!t.est_temporaire, est_definitif: !!t.est_definitif }; });
      setTypeMap(tm);

      const um: Record<string, string> = {};
      uos.forEach((u: any) => { um[u.id] = u.libelle; });
      setUoMap(um);

      const pm: Record<string, string> = {};
      postes.forEach((p: any) => { pm[p.code] = p.libelle; });
      setPosteMap(pm);
    } catch (e: any) {
      console.error("Erreur chargement mouvements :", e);
      toast.error(e?.message ?? "Erreur de chargement des mouvements");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  // ── Récupération contrat en cours ───────────────────────────────────────────
  useEffect(() => {
    const fetchContract = async () => {
      if (!selectedCollabId) { setCurrentContract(null); return; }
      try {
        const contract = await db.findOne<any>("collaborateur_contrats", {
          collaborateur_id: selectedCollabId,
          archive: false,
          order: "-date_debut",
        });
        if (!contract) { setCurrentContract(null); return; }

        let typeLibelle = "—";
        const codeOrId = contract.code_type_contrat ?? contract.ref_type_contrat_id ?? contract.type_contrat_id;
        if (codeOrId) {
          try {
            const found = await db.findOne<any>("ref_type_contrat", { code: codeOrId });
            if (found?.libelle) typeLibelle = found.libelle;
            else {
              const byId = await db.findOne<any>("ref_type_contrat", { id: codeOrId });
              if (byId?.libelle) typeLibelle = byId.libelle;
            }
          } catch { /* tolérant */ }
        }
        setCurrentContract({ date_debut: contract.date_debut, date_fin: contract.date_fin ?? null, type_libelle: typeLibelle });
      } catch (e: any) {
        console.error("Erreur fetch contrat :", e);
        setCurrentContract(null);
      }
    };
    fetchContract();
  }, [selectedCollabId]);

  // ── Période ─────────────────────────────────────────────────────────────────
  const toISO = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const periodRange = useMemo(() => {
    switch (modePeriode) {
      case "TOUS": return { debut: null as string | null, fin: null as string | null };
      case "PLAGE": return { debut: plageDebut || null, fin: plageFin || null };
      case "MOIS": {
        const debut = new Date(anneeFiltre, moisFiltre, 1);
        const fin = new Date(anneeFiltre, moisFiltre + 1, 0);
        return { debut: toISO(debut), fin: toISO(fin) };
      }
      case "TRIMESTRE": {
        const startMonth = (trimestreFiltre - 1) * 3;
        return { debut: toISO(new Date(anneeFiltre, startMonth, 1)), fin: toISO(new Date(anneeFiltre, startMonth + 3, 0)) };
      }
      case "SEMESTRE": {
        const startMonth = semestreFiltre === 1 ? 0 : 6;
        return { debut: toISO(new Date(anneeFiltre, startMonth, 1)), fin: toISO(new Date(anneeFiltre, startMonth + 6, 0)) };
      }
      case "ANNEE": return { debut: `${anneeFiltre}-01-01`, fin: `${anneeFiltre}-12-31` };
    }
  }, [modePeriode, plageDebut, plageFin, moisFiltre, trimestreFiltre, semestreFiltre, anneeFiltre]);

  // ── Filtrage ────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filterCollabs.length > 0 && !filterCollabs.includes(r.collaborateur_id)) return false;
      if (filterStatuts.length > 0 && !filterStatuts.includes(r.statut)) return false;
      if (filterTypes.length > 0 && !filterTypes.includes(r.code_type_mouvement)) return false;
      if (filterNature.length > 0) {
        const t = typeMap[r.code_type_mouvement];
        const natures: string[] = [];
        if (t?.est_temporaire) natures.push("TEMPORAIRE");
        if (t?.est_definitif) natures.push("DEFINITIF");
        if (!natures.some((n) => filterNature.includes(n))) return false;
      }
      if (filterUOs.length > 0) {
        const matchOld = r.ancienne_unite_id && filterUOs.includes(r.ancienne_unite_id);
        const matchNew = r.nouvelle_unite_id && filterUOs.includes(r.nouvelle_unite_id);
        if (!matchOld && !matchNew) return false;
      }
      if (periodRange.debut && r.date_effet < periodRange.debut) return false;
      if (periodRange.fin && r.date_effet > periodRange.fin) return false;
      if (search) {
        const c = collabMap[r.collaborateur_id];
        const haystack = [c?.nom, c?.prenom, c?.matricule, typeMap[r.code_type_mouvement]?.libelle, r.reference_decision]
          .filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(search.toLowerCase())) return false;
      }
      return true;
    });
  }, [rows, filterCollabs, filterStatuts, filterTypes, filterNature, filterUOs, periodRange, search, collabMap, typeMap]);

  // ── Tri ─────────────────────────────────────────────────────────────────────
  const resolvePoste = (code: string | null) => {
    if (!code) return "";
    const parent = code.includes("-") ? code.split("-").slice(0, -1).join("-") : code;
    return posteMap[parent] || posteMap[code] || code;
  };

  const getSortValue = (r: MouvementRow, key: SortKey): string => {
    switch (key) {
      case "collaborateur": {
        const c = collabMap[r.collaborateur_id];
        return c ? `${c.nom} ${c.prenom}`.toLowerCase() : "";
      }
      case "type": return (typeMap[r.code_type_mouvement]?.libelle || r.code_type_mouvement || "").toLowerCase();
      case "date_effet": return r.date_effet || "";
      case "trajet": {
        const a = resolvePoste(r.ancien_poste) || (r.ancienne_unite_id ? uoMap[r.ancienne_unite_id] || "" : "");
        const b = resolvePoste(r.nouveau_poste) || (r.nouvelle_unite_id ? uoMap[r.nouvelle_unite_id] || "" : "");
        return `${a} → ${b}`.toLowerCase();
      }
    }
  };

  const sortedFiltered = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      const va = getSortValue(a, sortKey);
      const vb = getSortValue(b, sortKey);
      if (va === vb) return 0;
      const cmp = va < vb ? -1 : 1;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortKey, sortDir, collabMap, typeMap, uoMap, posteMap]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };

  // ── Alertes ─────────────────────────────────────────────────────────────────
  const alertes = rows.filter((r) => {
    if (r.statut !== "ACTIF" || !typeMap[r.code_type_mouvement]?.est_temporaire) return false;
    if (!r.date_fin_prevue) return true;
    const diff = (new Date(r.date_fin_prevue).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return diff <= 30;
  });

  // ── KPIs (calculés sur la sélection filtrée) ────────────────────────────────
  const now = new Date();
  const kpiMois = sortedFiltered.filter((r) => {
    if (!r.date_effet) return false;
    const d = new Date(r.date_effet);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const kpiPromotions = sortedFiltered.filter((r) => typeMap[r.code_type_mouvement]?.libelle?.toLowerCase().includes("promo")).length;
  const kpiTemp = sortedFiltered.filter((r) => typeMap[r.code_type_mouvement]?.est_temporaire).length;

  // ── Export Excel (CSV UTF-8 BOM — s'ouvre nativement dans Excel) ────────────
  const exportExcel = () => {
    const fmtDate = (d: string | null | undefined) =>
      d ? new Date(d).toLocaleDateString("fr-FR") : "";

    const resolvePosteExport = (code: string | null) => {
      if (!code) return "";
      const parent = code.includes("-") ? code.split("-").slice(0, -1).join("-") : code;
      return posteMap[parent] || posteMap[code] || code;
    };

    const headers = [
      "Matricule", "Prénom", "Nom",
      "Type de mouvement", "Nature",
      "Date effet", "Date fin prévue", "Date fin effective",
      "Depuis (UO)", "Depuis (Poste)",
      "Vers (UO)", "Vers (Poste)",
      "Statut", "Référence décision", "Date décision", "Commentaire",
    ];

    const rows_csv = sortedFiltered.map((r) => {
      const c = collabMap[r.collaborateur_id];
      const t = typeMap[r.code_type_mouvement];
      const nature = t?.est_temporaire ? "Temporaire" : t?.est_definitif ? "Définitif" : "";
      const cell = (v: string | null | undefined) => `"${(v ?? "").replace(/"/g, '""')}"`;
      return [
        cell(c?.matricule),
        cell(c?.prenom),
        cell(c?.nom),
        cell(t?.libelle || r.code_type_mouvement),
        cell(nature),
        cell(fmtDate(r.date_effet)),
        cell(fmtDate(r.date_fin_prevue)),
        cell(fmtDate(r.date_fin_effective)),
        cell(r.ancienne_unite_id ? uoMap[r.ancienne_unite_id] : ""),
        cell(resolvePosteExport(r.ancien_poste)),
        cell(r.nouvelle_unite_id ? uoMap[r.nouvelle_unite_id] : ""),
        cell(resolvePosteExport(r.nouveau_poste)),
        cell(r.statut),
        cell(r.reference_decision),
        cell(fmtDate(r.date_decision)),
        cell(r.commentaire),
      ].join(";");
    });

    // BOM UTF-8 pour Excel
    const bom = "\uFEFF";
    const csv = bom + [headers.join(";"), ...rows_csv].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const today = new Date().toISOString().slice(0, 10);
    a.download = `mouvements_${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${sortedFiltered.length} mouvement(s) exporté(s)`);
  };

  const hasActiveFilters =
    filterCollabs.length > 0 || filterStatuts.length > 0 || filterTypes.length > 0 ||
    filterNature.length > 0 || filterUOs.length > 0 || modePeriode !== "TOUS" || !!search;

  const resetFilters = () => {
    setFilterCollabs([]); setFilterStatuts([]); setFilterTypes([]); setFilterNature([]); setFilterUOs([]);
    setModePeriode("TOUS"); setSearch(""); setPlageDebut(""); setPlageFin("");
  };

  const collabOptions = useMemo(
    () => Object.entries(collabMap).map(([id, c]) => ({ value: id, label: `${c.prenom} ${c.nom}` })).sort((a, b) => a.label.localeCompare(b.label)),
    [collabMap]
  );
  const typeOptions = useMemo(
    () => Object.entries(typeMap).map(([code, info]) => ({ value: code, label: info.libelle })),
    [typeMap]
  );

  // ── Rendu ───────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ArrowRightLeft size={20} className="text-muted-foreground" />
            Mouvements internes
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Suivi des transferts, promotions et mutations de collaborateurs
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={exportExcel}
            title="Exporter la sélection en Excel"
          >
            <FileDown size={14} className="mr-1.5" /> Exporter
            {hasActiveFilters && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-accent text-white">
                {sortedFiltered.length}
              </span>
            )}
          </Button>
          <Button
            size="sm"
            onClick={() => { setShowNewDialog(true); setSelectedCollabId(null); setCollabSearch(""); }}
          >
            <Plus size={14} className="mr-1.5" /> Nouveau mouvement
          </Button>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label="Mouvements"
          value={sortedFiltered.length}
          sub={hasActiveFilters ? `sur ${rows.length} au total` : "au total"}
        />
        <KpiCard
          label="Ce mois"
          value={kpiMois}
          sub={`${MOIS_LABELS[now.getMonth()]} ${now.getFullYear()}`}
        />
        <KpiCard
          label="Promotions"
          value={kpiPromotions}
          sub={hasActiveFilters ? "dans la sélection" : "actives"}
          accent="text-emerald-600 dark:text-emerald-400"
        />
        <KpiCard
          label="Temporaires"
          value={kpiTemp}
          sub={alertes.length > 0 ? `${alertes.length} alerte(s)` : hasActiveFilters ? "dans la sélection" : "en cours"}
          accent={alertes.length > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
        />
      </div>

      {/* ── Alertes ── */}
      {alertes.length > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4 flex items-start gap-3">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              {alertes.length} mouvement(s) temporaire(s) à échéance proche ou sans date de fin
            </p>
            <ul className="mt-1.5 space-y-0.5">
              {alertes.slice(0, 5).map((r) => {
                const c = collabMap[r.collaborateur_id];
                return (
                  <li key={r.id} className="text-xs text-amber-700 dark:text-amber-400">
                    {c ? `${c.prenom} ${c.nom}` : "—"} — {typeMap[r.code_type_mouvement]?.libelle || r.code_type_mouvement}
                    {r.date_fin_prevue
                      ? ` (fin prévue : ${new Date(r.date_fin_prevue).toLocaleDateString("fr-FR")})`
                      : " (pas de date fin)"}
                  </li>
                );
              })}
              {alertes.length > 5 && (
                <li className="text-xs italic text-amber-600 dark:text-amber-500">… et {alertes.length - 5} autre(s)</li>
              )}
            </ul>
          </div>
        </div>
      )}

      {/* ── Barre de filtres ── */}
      <div className="rounded-xl border border-border bg-muted/10 p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Recherche */}
          <div className="relative flex-1 min-w-[200px]">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              className="w-full pl-8 pr-8 py-1.5 rounded-lg border border-border bg-background text-xs outline-none focus:ring-1 focus:ring-accent/40 transition-shadow"
              placeholder="Rechercher par nom, matricule, type…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <MultiSelect label="Collaborateurs" options={collabOptions} selected={filterCollabs} onChange={setFilterCollabs} placeholder="Collaborateurs" />
          <MultiSelect label="Types" options={typeOptions} selected={filterTypes} onChange={setFilterTypes} placeholder="Types" />
          <FiltrePeriode
            mode={modePeriode} setMode={setModePeriode}
            plageDebut={plageDebut} setPlageDebut={setPlageDebut}
            plageFin={plageFin} setPlageFin={setPlageFin}
            mois={moisFiltre} setMois={setMoisFiltre}
            trimestre={trimestreFiltre} setTrimestre={setTrimestreFiltre}
            semestre={semestreFiltre} setSemestre={setSemestreFiltre}
            annee={anneeFiltre} setAnnee={setAnneeFiltre}
          />

          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-destructive/10 hover:border-destructive/30 hover:text-destructive transition-colors"
            >
              <RotateCcw size={11} /> Réinitialiser
            </button>
          )}
        </div>

        {/* Tags filtres actifs */}
        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-border">
            <span className="text-[10px] text-muted-foreground uppercase font-medium mr-1">Actifs :</span>
            {filterCollabs.map((id) => (
              <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-accent/10 text-accent">
                {collabMap[id] ? `${collabMap[id].prenom} ${collabMap[id].nom}` : id}
                <button type="button" onClick={() => setFilterCollabs((v) => v.filter((x) => x !== id))}><X size={8} /></button>
              </span>
            ))}
            {filterTypes.map((code) => (
              <span key={code} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary">
                {typeMap[code]?.libelle || code}
                <button type="button" onClick={() => setFilterTypes((v) => v.filter((x) => x !== code))}><X size={8} /></button>
              </span>
            ))}
            {modePeriode !== "TOUS" && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                <Calendar size={9} />
                {modePeriode === "PLAGE" ? `${plageDebut || "…"} → ${plageFin || "…"}` :
                 modePeriode === "MOIS" ? `${MOIS_LABELS[moisFiltre]} ${anneeFiltre}` :
                 modePeriode === "TRIMESTRE" ? `T${trimestreFiltre} ${anneeFiltre}` :
                 modePeriode === "SEMESTRE" ? `S${semestreFiltre} ${anneeFiltre}` :
                 `${anneeFiltre}`}
                <button type="button" onClick={() => setModePeriode("TOUS")}><X size={8} /></button>
              </span>
            )}
            {search && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground">
                "{search}"
                <button type="button" onClick={() => setSearch("")}><X size={8} /></button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Tableau ── */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground gap-2">
          <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
          Chargement…
        </div>
      ) : sortedFiltered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <ArrowRightLeft size={32} className="opacity-20" />
          <p className="text-sm">Aucun mouvement trouvé</p>
          {hasActiveFilters && (
            <button type="button" onClick={resetFilters} className="text-xs text-accent underline underline-offset-2">
              Réinitialiser les filtres
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/20">
                  <SortableTh label="Collaborateur" k="collaborateur" current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortableTh label="Type" k="type" current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortableTh label="Date effet" k="date_effet" current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortableTh label="Trajet" k="trajet" current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <th className="px-4 py-3 text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">Statut</th>
                  <th className="px-4 py-3 w-24"></th>
                </tr>
              </thead>
              <tbody>
                {sortedFiltered.map((row) => {
                  const c = collabMap[row.collaborateur_id];
                  const ancien = resolvePoste(row.ancien_poste) || (row.ancienne_unite_id ? uoMap[row.ancienne_unite_id] : "—") || "—";
                  const nouveau = resolvePoste(row.nouveau_poste) || (row.nouvelle_unite_id ? uoMap[row.nouvelle_unite_id] : "—") || "—";
                  const typeStyle = TYPE_STYLES[row.code_type_mouvement] ?? DEFAULT_TYPE_STYLE;
                  const typInfo = typeMap[row.code_type_mouvement];

                  return (
                    <tr key={row.id} className="border-t border-border hover:bg-muted/20 transition-colors group">
                      {/* Collaborateur */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          {c ? (
                            <Avatar id={row.collaborateur_id} prenom={c.prenom} nom={c.nom} size="sm" />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-muted flex-shrink-0" />
                          )}
                          <div>
                            <p className="font-medium text-foreground leading-tight">
                              {c ? `${c.prenom} ${c.nom}` : "—"}
                            </p>
                            <p className="text-[10px] text-muted-foreground">{c?.matricule}</p>
                          </div>
                        </div>
                      </td>

                      {/* Type */}
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${typeStyle}`}>
                          {typInfo?.libelle || row.code_type_mouvement}
                        </span>
                        {typInfo?.est_temporaire && (
                          <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                            Temp.
                          </span>
                        )}
                      </td>

                      {/* Date effet */}
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {row.date_effet ? new Date(row.date_effet).toLocaleDateString("fr-FR") : "—"}
                      </td>

                      {/* Trajet */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-muted-foreground max-w-xs">
                          <span className="truncate text-foreground">{ancien}</span>
                          <ArrowRightLeft size={10} className="flex-shrink-0 opacity-50" />
                          <span className="truncate text-foreground">{nouveau}</span>
                        </div>
                      </td>

                      {/* Statut */}
                      <td className="px-4 py-3">
                        <StatutBadge statut={row.statut} />
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            title="Voir le détail"
                            onClick={() => setViewMvt(row)}
                          >
                            <Eye size={13} />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            title="Fiche collaborateur"
                            onClick={() => navigate(`/collaborateurs/${row.collaborateur_id}`)}
                          >
                            <ExternalLink size={13} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Footer tableau */}
          <div className="px-4 py-2.5 border-t border-border bg-muted/10 flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">
              {sortedFiltered.length} mouvement(s) affiché(s)
              {hasActiveFilters && ` sur ${rows.length}`}
            </p>
          </div>
        </div>
      )}

      {/* ── Dialog Nouveau mouvement ── */}
      <Dialog
        open={showNewDialog}
        onOpenChange={(open) => {
          if (!open) { setShowNewDialog(false); setSelectedCollabId(null); loadAll(); }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus size={16} className="text-muted-foreground" />
              Nouveau mouvement interne
            </DialogTitle>
          </DialogHeader>

          {!selectedCollabId ? (
            /* Étape 1 : choix collaborateur */
            <div className="mt-2">
              <p className="text-sm text-muted-foreground mb-3">Sélectionnez un collaborateur :</p>
              <div className="relative mb-3">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-accent/40"
                  placeholder="Rechercher par nom, prénom ou matricule…"
                  value={collabSearch}
                  onChange={(e) => setCollabSearch(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {collabList
                  .filter((c) => !collabSearch || `${c.nom} ${c.prenom} ${c.matricule}`.toLowerCase().includes(collabSearch.toLowerCase()))
                  .slice(0, 50)
                  .map((c) => (
                    <button
                      key={c.id}
                      className="w-full text-left px-3 py-2.5 hover:bg-muted/30 text-sm flex items-center gap-3 transition-colors"
                      onClick={() => setSelectedCollabId(c.id)}
                    >
                      <Avatar id={c.id} prenom={c.prenom} nom={c.nom} size="sm" />
                      <span className="font-medium flex-1">{c.prenom} {c.nom}</span>
                      <span className="text-xs text-muted-foreground">{c.matricule}</span>
                    </button>
                  ))}
              </div>
            </div>
          ) : (
            /* Étape 2 : formulaire */
            <div className="space-y-5 mt-2">
              {/* Bandeau collaborateur sélectionné */}
              <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/20 border border-border">
                {(() => {
                  const c = collabMap[selectedCollabId];
                  return c ? <Avatar id={selectedCollabId} prenom={c.prenom} nom={c.nom} /> : null;
                })()}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">
                    {collabMap[selectedCollabId]?.prenom} {collabMap[selectedCollabId]?.nom}
                  </p>
                  <p className="text-xs text-muted-foreground">{collabMap[selectedCollabId]?.matricule}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSelectedCollabId(null)} className="h-8 text-xs gap-1">
                  <X size={12} /> Changer
                </Button>
              </div>

              {/* Contrat en cours */}
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/20 border-b border-border">
                  <Info size={13} className="text-muted-foreground" />
                  <span className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">Contrat en cours</span>
                </div>
                {currentContract ? (
                  <div className="grid grid-cols-3 divide-x divide-border">
                    <div className="px-4 py-3">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Type</p>
                      <p className="text-sm font-medium">{currentContract.type_libelle}</p>
                    </div>
                    <div className="px-4 py-3">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Date début</p>
                      <p className="text-sm font-medium">{new Date(currentContract.date_debut).toLocaleDateString("fr-FR")}</p>
                    </div>
                    <div className="px-4 py-3">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Date fin</p>
                      <p className="text-sm font-medium">
                        {currentContract.date_fin ? new Date(currentContract.date_fin).toLocaleDateString("fr-FR") : "Indéterminée"}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic px-4 py-3">
                    Aucun contrat actif trouvé pour ce collaborateur.
                  </p>
                )}
              </div>

              {/* Formulaire mouvement */}
              <MouvementForm
                collaborateurId={selectedCollabId}
                dateDebutContrat={currentContract?.date_debut}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Dialog visualisation ── */}
      <ViewMouvementDialog
        mouvement={viewMvt}
        onClose={() => setViewMvt(null)}
        collabMap={collabMap}
        typeMap={typeMap}
        uoMap={uoMap}
        posteMap={posteMap}
      />
    </div>
  );
};

export default MouvementsPage;
