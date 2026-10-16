import React, { useMemo, useState, useRef, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Search,
  X,
  SlidersHorizontal,
  ArrowUpDown,
  Wallet,
  Receipt,
  Banknote,
  Building2,
} from "lucide-react";

/* ------------------------------------------------------------------------ */
/*  TYPES                                                                    */
/* ------------------------------------------------------------------------ */
type Categorie = "Assiette" | "Cotisation patronale" | "Cotisation salariale" | "Retenue" | "Gain" | "Avantage";

export interface Rubrique {
  code: string;
  libelle: string;
  categorie: Categorie;
  montant: number;
  /** 12 valeurs mensuelles, Janvier -> Décembre */
  periodes: number[];
}

interface SortState {
  key: "code" | "libelle" | "categorie" | "montant" | null;
  dir: "asc" | "desc" | null;
}

/* ------------------------------------------------------------------------ */
/*  ⚠️ BRANCHEMENT API — remplacez ce bloc par votre vrai appel backend      */
/* ------------------------------------------------------------------------ */
// Exemple avec votre API FastAPI (D:\SOLGEIS\personahub-api) :
//
// async function fetchRubriques(periodeId: string): Promise<Rubrique[]> {
//   const res = await fetch(`/api/plan-paie/${periodeId}/rubriques`);
//   if (!res.ok) throw new Error("Erreur de chargement des rubriques");
//   return res.json();
// }
//
// Puis dans le composant, remplacez la ligne `const [rubriques] = useState(MOCK_RUBRIQUES)`
// par un `useEffect` qui appelle `fetchRubriques(periodeId)` et stocke le résultat
// avec `useState<Rubrique[]>([])`.

const MONTHS = ["Janv", "Févr", "Mars", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc"];

function seededRand(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}
function genPeriods(base: number, code: string): number[] {
  if (!base) return MONTHS.map(() => 0);
  return MONTHS.map((_, i) => {
    const r = seededRand(code.length * 7 + i * 13.31);
    const factor = 1 + (r - 0.5) * 0.16;
    return Math.max(0, Math.round(base * factor * 100) / 100);
  });
}

// Données factices utilisées tant que l'API n'est pas branchée.
// Une fois le fetch réel en place, supprimez ce tableau.
const MOCK_BASE: Omit<Rubrique, "periodes">[] = [
  { code: "ASSIETTE_ANC", libelle: "Base de calcul de l'ancienneté", categorie: "Assiette", montant: 26682.68 },
  { code: "ASSIETTE_CIMR", libelle: "Base de la CIMR", categorie: "Assiette", montant: 29350.95 },
  { code: "ASSIETTE_CNSS", libelle: "Base de la CNSS", categorie: "Assiette", montant: 29350.95 },
  { code: "ASSIETTE_FP", libelle: "Assiette des Frais Professionnels", categorie: "Assiette", montant: 29350.95 },
  { code: "ATRISK", libelle: "AT (Part Patronale)", categorie: "Cotisation patronale", montant: 0 },
  { code: "BRUT_IMP", libelle: "Brut Imposable", categorie: "Assiette", montant: 29350.95 },
  { code: "CIMR_PAT", libelle: "Cotisations CIMR Patronale", categorie: "Cotisation patronale", montant: 0 },
  { code: "CIMR_SAL", libelle: "Cotisations CIMR Salariale", categorie: "Cotisation salariale", montant: 0 },
  { code: "CNSS_ALF_PAT", libelle: "CNSS Aloc. Fam. (Part Patronale)", categorie: "Cotisation patronale", montant: 0 },
  { code: "CNSS_AMO_PAT", libelle: "CNSS AMO (Part Patronale)", categorie: "Cotisation patronale", montant: 0 },
  { code: "CNSS_AMO_SAL", libelle: "Cotisations CNSS AMO", categorie: "Cotisation salariale", montant: 663.36 },
  { code: "CNSS_FORPRO_PAT", libelle: "CNSS Formation Prof. (Part Patronale)", categorie: "Cotisation patronale", montant: 0 },
  { code: "CNSS_PRESOC_PAT", libelle: "CNSS Prest. Soc. (Part Patronale)", categorie: "Cotisation patronale", montant: 0 },
  { code: "CNSS_VIEIL_PAT", libelle: "CNSS Vieillesse (Part Patronale)", categorie: "Cotisation patronale", montant: 0 },
  { code: "CNSS_VIEIL_SAL", libelle: "CNSS Vieillesse (Part Salariale)", categorie: "Cotisation salariale", montant: 288.94 },
  { code: "IR_RETENUE", libelle: "IR Retenu à la source", categorie: "Retenue", montant: 762.63 },
  { code: "SALBASE", libelle: "Salaire de base", categorie: "Gain", montant: 6500.0 },
  { code: "PRIM_ANC", libelle: "Prime d'ancienneté", categorie: "Gain", montant: 650.0 },
  { code: "INDTRSP", libelle: "Indemnité de transport", categorie: "Gain", montant: 500.0 },
  { code: "IND_PANIER", libelle: "Indemnité de panier", categorie: "Gain", montant: 405.0 },
  { code: "TITRE_REST", libelle: "Titres restaurant (30 DH/j)", categorie: "Gain", montant: 660.0 },
  { code: "AVT_LOGEMENT", libelle: "Avantage en nature - Logement", categorie: "Avantage", montant: 0 },
  { code: "AVT_VOITURE", libelle: "Avantage en nature - Voiture", categorie: "Avantage", montant: 0 },
  { code: "IND_KM", libelle: "Indemnité kilométrique", categorie: "Gain", montant: 0 },
  { code: "ALLOC_FAM", libelle: "Allocations familiales", categorie: "Gain", montant: 300.0 },
];
const MOCK_RUBRIQUES: Rubrique[] = MOCK_BASE.map((r) => ({ ...r, periodes: genPeriods(r.montant, r.code) }));

/* ------------------------------------------------------------------------ */
/*  PALETTE (proche du vert existant de l'application)                      */
/* ------------------------------------------------------------------------ */
const TEAL = { 50: "#E1F5EE", 100: "#9FE1CB", 200: "#5DCAA5", 400: "#1D9E75", 600: "#0F6E56", 800: "#085041" };

const CAT_COLORS: Record<Categorie, { bg: string; fg: string; dot: string }> = {
  Assiette: { bg: "#F1EFE8", fg: "#444441", dot: "#888780" },
  "Cotisation patronale": { bg: "#FAEEDA", fg: "#633806", dot: "#BA7517" },
  "Cotisation salariale": { bg: "#FAECE7", fg: "#712B13", dot: "#D85A30" },
  Retenue: { bg: "#FCEBEB", fg: "#791F1F", dot: "#E24B4A" },
  Gain: { bg: TEAL[50], fg: TEAL[800], dot: TEAL[400] },
  Avantage: { bg: "#E6F1FB", fg: "#0C447C", dot: "#378ADD" },
};

function fmtMAD(n: number) {
  return new Intl.NumberFormat("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + " MAD";
}

/* ------------------------------------------------------------------------ */
/*  Mini sparkline SVG                                                      */
/* ------------------------------------------------------------------------ */
function Sparkline({ values, color = TEAL[400] }: { values: number[]; color?: string }) {
  const w = 72,
    h = 22;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------------ */
/*  Carte KPI                                                                */
/* ------------------------------------------------------------------------ */
function KpiCard({
  icon: Icon,
  label,
  value,
  values,
  color,
}: {
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  label: string;
  value: string;
  values: number[];
  color: string;
}) {
  return (
    <div className="flex-1 min-w-[180px] bg-white border border-slate-200/80 rounded-xl p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-center justify-between mb-2.5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <Icon size={13} style={{ color }} /> {label}
        </span>
        <Sparkline values={values} color={color} />
      </div>
      <p className="text-xl font-semibold text-slate-800 tabular-nums">{value}</p>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/*  Donut de répartition par catégorie                                      */
/* ------------------------------------------------------------------------ */
function DonutRepartition({ rubriques, categories }: { rubriques: Rubrique[]; categories: Categorie[] }) {
  const parts = categories
    .map((c) => ({ cat: c, total: rubriques.filter((r) => r.categorie === c).reduce((s, r) => s + r.montant, 0) }))
    .filter((p) => p.total > 0);
  const grand = parts.reduce((s, p) => s + p.total, 0);

  if (grand === 0) {
    return (
      <div className="bg-white border border-slate-200/80 rounded-xl p-4 text-sm text-slate-400">
        Répartition annuelle par catégorie — pas encore de données.
      </div>
    );
  }

  let acc = 0;
  const stops = parts
    .map((p) => {
      const start = (acc / grand) * 360;
      acc += p.total;
      const end = (acc / grand) * 360;
      return `${CAT_COLORS[p.cat].dot} ${start}deg ${end}deg`;
    })
    .join(", ");

  return (
    <div className="bg-white border border-slate-200/80 rounded-xl p-4 flex items-center gap-6">
      <div className="w-28 h-28 rounded-full shrink-0 grid place-items-center" style={{ background: `conic-gradient(${stops})` }}>
        <div className="w-16 h-16 rounded-full bg-white grid place-items-center text-center">
          <span className="text-[10px] text-slate-400 leading-tight">
            Total
            <br />
            annuel
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 text-sm">
        {parts
          .sort((a, b) => b.total - a.total)
          .map((p) => (
            <div key={p.cat} className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CAT_COLORS[p.cat].dot }} />
              <span className="text-slate-600">{p.cat}</span>
              <span className="text-slate-400 text-xs">{((p.total / grand) * 100).toFixed(0)}%</span>
            </div>
          ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/*  Filtre multi-select                                                     */
/* ------------------------------------------------------------------------ */
function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: Categorie[];
  selected: Categorie[];
  onChange: (v: Categorie[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const toggle = (opt: Categorie) => {
    onChange(selected.includes(opt) ? selected.filter((o) => o !== opt) : [...selected, opt]);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 h-9 px-3 rounded-lg border text-sm font-medium transition-colors ${
          selected.length ? "border-[#1D9E75] text-[#085041] bg-[#E1F5EE]" : "border-slate-300 text-slate-600 bg-white hover:bg-slate-50"
        }`}
      >
        <SlidersHorizontal size={14} />
        {label}
        {selected.length > 0 && (
          <span className="bg-[#0F6E56] text-white text-[11px] leading-none rounded-full px-1.5 py-0.5">{selected.length}</span>
        )}
        <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-20 mt-1.5 w-64 bg-white border border-slate-200 rounded-lg shadow-lg p-1">
          <div className="max-h-64 overflow-y-auto">
            {options.map((opt) => (
              <label key={opt} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 cursor-pointer text-sm text-slate-700">
                <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} className="accent-[#0F6E56] w-3.5 h-3.5" />
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: CAT_COLORS[opt]?.dot || "#ccc" }} />
                {opt}
              </label>
            ))}
          </div>
          {selected.length > 0 && (
            <button
              onClick={() => onChange([])}
              className="w-full text-left text-xs text-slate-500 hover:text-slate-700 px-2 py-1.5 border-t border-slate-100 mt-1"
            >
              Effacer la sélection
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/*  En-tête de colonne triable                                              */
/* ------------------------------------------------------------------------ */
function SortableTh({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: NonNullable<SortState["key"]>;
  sort: SortState;
  onSort: (key: NonNullable<SortState["key"]>) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === sortKey;
  return (
    <th className={`py-2.5 px-3 font-medium select-none ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-slate-700 transition-colors ${active ? "text-[#0F6E56]" : ""} ${
          align === "right" ? "flex-row-reverse" : ""
        }`}
      >
        {label}
        {active ? sort.dir === "asc" ? <ChevronUp size={13} /> : <ChevronDown size={13} /> : <ArrowUpDown size={12} className="text-slate-300" />}
      </button>
    </th>
  );
}

/* ------------------------------------------------------------------------ */
/*  Tableau des périodes (détail d'une rubrique)                            */
/* ------------------------------------------------------------------------ */
function PeriodesTable({ r }: { r: Rubrique }) {
  const total = r.periodes.reduce((s, v) => s + v, 0);
  const moyenne = total / r.periodes.length;
  const max = Math.max(...r.periodes, 1);
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-xs min-w-[760px]">
        <thead>
          <tr className="bg-slate-50 text-slate-500">
            <th className="py-2 px-2.5 text-left font-medium">Période</th>
            {MONTHS.map((m) => (
              <th key={m} className="py-2 px-2 text-right font-medium">
                {m}
              </th>
            ))}
            <th className="py-2 px-2.5 text-right font-medium text-[#085041] bg-[#E1F5EE]">Total</th>
            <th className="py-2 px-2.5 text-right font-medium">Moyenne</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="py-2 px-2.5 text-slate-500">Montant</td>
            {r.periodes.map((v, i) => (
              <td key={i} className="py-2 px-2 text-right tabular-nums text-slate-700">
                {v === 0 ? <span className="text-slate-300">—</span> : v.toLocaleString("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
            ))}
            <td className="py-2 px-2.5 text-right tabular-nums font-semibold text-[#085041] bg-[#E1F5EE]">
              {total.toLocaleString("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </td>
            <td className="py-2 px-2.5 text-right tabular-nums text-slate-500">
              {moyenne.toLocaleString("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </td>
          </tr>
          <tr className="border-t border-slate-100">
            <td className="py-2 px-2.5"></td>
            {r.periodes.map((v, i) => (
              <td key={i} className="py-1.5 px-2">
                <div className="h-6 w-full flex items-end">
                  <div
                    className="w-full rounded-sm"
                    style={{ height: `${max ? (v / max) * 100 : 0}%`, background: CAT_COLORS[r.categorie]?.dot || TEAL[400], minHeight: v ? 2 : 0 }}
                  />
                </div>
              </td>
            ))}
            <td colSpan={2}></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/*  ÉCRAN PRINCIPAL                                                          */
/* ------------------------------------------------------------------------ */
export interface PlanDePaieEcranProps {
  /** ID de la période sélectionnée (utile une fois l'API branchée) */
  periodeId?: string;
  /** Nombre de périodes affiché dans le badge d'en-tête */
  nbPeriodes?: number;
}

export default function PlanDePaieEcran({ periodeId, nbPeriodes = 12 }: PlanDePaieEcranProps) {
  // 👉 Remplacez cette ligne par un vrai chargement de données (voir bloc "BRANCHEMENT API" plus haut).
  const [rubriques] = useState<Rubrique[]>(MOCK_RUBRIQUES);

  const categories = useMemo(() => [...new Set(rubriques.map((r) => r.categorie))] as Categorie[], [rubriques]);

  const [query, setQuery] = useState("");
  const [selectedCats, setSelectedCats] = useState<Categorie[]>([]);
  const [masquerZero, setMasquerZero] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: null, dir: null });
  const [expanded, setExpanded] = useState<string | null>(null);

  const handleSort = (key: NonNullable<SortState["key"]>) => {
    setSort((s) => {
      if (s.key !== key) return { key, dir: "asc" };
      if (s.dir === "asc") return { key, dir: "desc" };
      return { key: null, dir: null };
    });
  };

  const filtered = useMemo(() => {
    let rows = rubriques.filter((r) => {
      const matchQuery = !query || r.code.toLowerCase().includes(query.toLowerCase()) || r.libelle.toLowerCase().includes(query.toLowerCase());
      const matchCat = selectedCats.length === 0 || selectedCats.includes(r.categorie);
      const matchZero = !masquerZero || r.montant !== 0;
      return matchQuery && matchCat && matchZero;
    });
    if (sort.key) {
      rows = [...rows].sort((a, b) => {
        let cmp: number;
        if (sort.key === "montant") cmp = a.montant - b.montant;
        else cmp = String(a[sort.key as "code" | "libelle" | "categorie"]).localeCompare(String(b[sort.key as "code" | "libelle" | "categorie"]), "fr");
        return sort.dir === "asc" ? cmp : -cmp;
      });
    }
    return rows;
  }, [rubriques, query, selectedCats, masquerZero, sort]);

  const resetFiltres = () => {
    setQuery("");
    setSelectedCats([]);
    setMasquerZero(false);
    setSort({ key: null, dir: null });
  };
  const filtresActifs = Boolean(query || selectedCats.length > 0 || masquerZero || sort.key);

  return (
    <div className="w-full bg-slate-50 min-h-screen p-6 font-sans text-slate-800">
      <div className="max-w-6xl mx-auto flex flex-col gap-5">
        {/* En-tête écran */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-[#0F6E56] uppercase tracking-wide mb-0.5">MENS</p>
            <h1 className="text-lg font-semibold text-slate-800">Plan de Paie Mensuel</h1>
          </div>
          <span className="text-xs text-slate-400 bg-white border border-slate-200 rounded-full px-3 py-1">{nbPeriodes} période(s)</span>
        </div>

        {/* KPI — remplacez les valeurs statiques par vos vrais totaux calculés côté API */}
        <div className="flex flex-wrap gap-4">
          <KpiCard icon={Wallet} label="Brut" value="8 055,00 MAD" values={genPeriods(8055, "BRUT")} color={TEAL[400]} />
          <KpiCard icon={Receipt} label="Net imposable" value="4 732,07 MAD" values={genPeriods(4732, "NETIMP")} color="#378ADD" />
          <KpiCard icon={Banknote} label="Net à payer" value="7 490,94 MAD" values={genPeriods(7490, "NETPAY")} color={TEAL[600]} />
          <KpiCard icon={Building2} label="Coût employeur" value="9 034,48 MAD" values={genPeriods(9034, "COUT")} color="#BA7517" />
        </div>

        {/* Répartition */}
        <DonutRepartition rubriques={rubriques} categories={categories} />

        {/* Pavé Autres */}
        <div className="bg-white border border-slate-200/80 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 pt-4 pb-3">
            <h3 className="text-sm font-semibold tracking-wide text-slate-700 uppercase">Autres</h3>
            <span className="text-xs text-slate-400">
              {filtered.length} / {rubriques.length} rubrique(s)
            </span>
          </div>

          {/* Filtres */}
          <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher un code ou un libellé…"
                className="h-9 pl-8 pr-3 w-64 rounded-lg border border-slate-300 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#1D9E75] focus:border-[#1D9E75]"
              />
            </div>

            <MultiSelect label="Catégorie" options={categories} selected={selectedCats} onChange={setSelectedCats} />

            <button
              onClick={() => setMasquerZero((v) => !v)}
              className={`h-9 px-3 rounded-lg border text-sm font-medium transition-colors ${
                masquerZero ? "border-[#1D9E75] text-[#085041] bg-[#E1F5EE]" : "border-slate-300 text-slate-600 bg-white hover:bg-slate-50"
              }`}
            >
              Masquer les montants à 0
            </button>

            {filtresActifs && (
              <button onClick={resetFiltres} className="h-9 px-2.5 flex items-center gap-1 rounded-lg text-sm text-slate-500 hover:text-slate-700">
                <X size={14} /> Réinitialiser
              </button>
            )}
          </div>

          {/* Tableau */}
          <div className="overflow-x-auto border-t border-slate-100">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100 bg-slate-50/60">
                  <th className="w-8"></th>
                  <SortableTh label="Code" sortKey="code" sort={sort} onSort={handleSort} />
                  <SortableTh label="Libellé" sortKey="libelle" sort={sort} onSort={handleSort} />
                  <SortableTh label="Catégorie" sortKey="categorie" sort={sort} onSort={handleSort} />
                  <th className="py-2.5 px-3 font-medium text-right">Tendance</th>
                  <SortableTh label="Montant" sortKey="montant" sort={sort} onSort={handleSort} align="right" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, idx) => (
                  <React.Fragment key={r.code}>
                    <tr
                      onClick={() => setExpanded(expanded === r.code ? null : r.code)}
                      className={`border-b border-slate-50 hover:bg-[#E1F5EE]/40 cursor-pointer transition-colors ${idx % 2 ? "bg-slate-50/40" : ""}`}
                    >
                      <td className="pl-3">
                        {expanded === r.code ? <ChevronDown size={14} className="text-[#0F6E56]" /> : <ChevronRight size={14} className="text-slate-400" />}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-xs text-[#0F6E56]">{r.code}</td>
                      <td className="py-2.5 px-3">{r.libelle}</td>
                      <td className="py-2.5 px-3">
                        <span
                          className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ background: CAT_COLORS[r.categorie]?.bg, color: CAT_COLORS[r.categorie]?.fg }}
                        >
                          {r.categorie}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 flex justify-end">
                        <Sparkline values={r.periodes} color={CAT_COLORS[r.categorie]?.dot || TEAL[400]} />
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium tabular-nums">{fmtMAD(r.montant)}</td>
                    </tr>
                    {expanded === r.code && (
                      <tr className="bg-slate-50/70 border-b border-slate-100">
                        <td></td>
                        <td colSpan={5} className="py-3 px-3">
                          <PeriodesTable r={r} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-sm text-slate-400">
                      Aucune rubrique ne correspond aux filtres sélectionnés.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
