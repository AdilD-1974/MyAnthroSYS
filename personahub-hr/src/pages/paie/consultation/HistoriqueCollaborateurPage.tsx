/**
 * HistoriqueCollaborateurPage — Historique de paie d'un collaborateur.
 * Route suggérée : /paie/consultation/historique
 *
 * Trois modes d'affichage, choisis dans la barre d'outils :
 *  - Carnet     : chaque bulletin comme un talon détachable (design d'origine).
 *  - Tableau    : vue dense, une ligne par bulletin, pour scanner vite.
 *  - Rubriques  : explorateur rubrique par rubrique, avec recherche, filtre
 *    par groupe, et deux modes de comparaison :
 *      · annuelle      → une année, 12 mois en colonnes
 *      · pluriannuelle → un mois donné, jusqu'à 5 années en colonnes
 *                        + un mini-graphique superposant les années
 *
 * Le tampon de statut reste piloté par l'origine réelle du bulletin
 * (VALIDÉ / ARCHIVÉ / PRÉCALCUL / EN ERREUR).
 */
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ChevronsUpDown, ChevronDown, ChevronRight, ChevronUp, Loader2, Printer, ReceiptText,
  TrendingUp, TrendingDown, FileBadge2, Wallet, Landmark, AlertTriangle,
  Search, Filter, X, Check, CalendarRange, GitCompareArrows, Table2, BookOpen, ListFilter,
} from "lucide-react";
import { db } from "@/lib/api";
import { useChartPalette } from "@/hooks/useChartPalette";
import { listerBulletins, lireBulletin, type BulletinRead, type OrigineBulletin, type LigneBulletin } from "@/lib/paieApi";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFormatMasks } from "@/hooks/useFormatMasks";

const MOIS = ["", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const fmt = (n?: number | null) => new Intl.NumberFormat("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0);

// ---- Palette (reprise à l'identique de PlanDePaieEcran.tsx, pour un
// habillage visuel cohérent entre les deux écrans) --------------------------
const TEAL = { 50: "#E1F5EE", 100: "#9FE1CB", 200: "#5DCAA5", 400: "#1D9E75", 600: "#0F6E56", 800: "#085041" };
const COULEUR = {
  succes: TEAL[400],
  destructif: "#D85A30",
  avertissement: "#BA7517",
  muet: "#888780",
  accent: "#378ADD",
};

/** Ajoute une transparence à une couleur hex (ex. alpha("#1D9E75", 0.12) -> teinte de fond pour un badge). */
function alpha(hex: string, a: number): string {
  const v = Math.round(a * 255).toString(16).padStart(2, "0");
  return `${hex}${v}`;
}

type Plan = { id: string; code: string; libelle: string };
type Periode = { id: string; annee: number; mois: number };
type Collab = { id: string; matricule: string; nom: string; prenom: string };
type ModeAffichage = "carnet" | "tableau" | "rubriques";

const TAMPON: Record<OrigineBulletin, { libelle: string; couleur: string }> = {
  VALIDE:     { libelle: "Validé",   couleur: COULEUR.succes },
  // CLOTURE (encore dans `bulletin`) et HISTORIQUE (dans `bulletin_historique`
  // après clôture annuelle) sont toutes deux "figées" du point de vue de
  // l'utilisateur — même tampon, seule la table physique diffère.
  CLOTURE:    { libelle: "Archivé",  couleur: COULEUR.muet },
  HISTORIQUE: { libelle: "Archivé",  couleur: COULEUR.muet },
  TEMP:       { libelle: "Précalcul", couleur: COULEUR.avertissement },
};

// ---- Sélecteur de collaborateur (recherche) -------------------------------
function SelecteurCollaborateur({ collabs, value, onChange }: { collabs: Collab[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const courant = collabs.find((c) => c.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-[300px] justify-between font-normal">
          <span className={courant ? "" : "text-slate-500"}>
            {courant ? `${courant.matricule} · ${courant.nom} ${courant.prenom}` : "Choisir un collaborateur…"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Nom, matricule…" />
          <CommandList>
            <CommandEmpty>Aucun résultat.</CommandEmpty>
            <CommandGroup>
              {collabs.map((c) => (
                <CommandItem key={c.id} value={`${c.matricule} ${c.nom} ${c.prenom}`} onSelect={() => { onChange(c.id); setOpen(false); }}>
                  <span className="font-mono text-xs text-slate-500 w-14 shrink-0">{c.matricule}</span>
                  {c.nom} {c.prenom}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---- Filtre multi-select générique (groupes, années…) ----------------------
function FiltreMultiSelect({ label, icon: Icon = Filter, options, selected, onChange, maxSelection }: {
  label: string;
  icon?: any;
  options: { value: string; label: string; couleur?: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
  maxSelection?: number;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (v: string) => {
    if (selected.includes(v)) { onChange(selected.filter((x) => x !== v)); return; }
    if (maxSelection && selected.length >= maxSelection) {
      toast.warning(`Vous pouvez comparer ${maxSelection} années maximum`);
      return;
    }
    onChange([...selected, v]);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={`gap-1.5 h-8 text-xs ${selected.length ? "border-primary/50 text-[#0F6E56]" : ""}`}>
          <Icon className="h-3.5 w-3.5" /> {label}
          {selected.length > 0 && (
            <span className="ml-0.5 rounded-full bg-[#E1F5EE] text-[#0F6E56] px-1.5 text-[10px] font-semibold">{selected.length}</span>
          )}
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandList>
            <CommandGroup>
              {options.map((o) => {
                const checked = selected.includes(o.value);
                return (
                  <CommandItem key={o.value} onSelect={() => toggle(o.value)} className="gap-2 cursor-pointer">
                    <span className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border shrink-0 ${checked ? "bg-[#0F6E56] border-[#0F6E56]" : "border-slate-200"}`}>
                      {checked && <Check className="h-3 w-3 text-[#0F6E56]-foreground" />}
                    </span>
                    {o.couleur && <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: o.couleur }} />}
                    {o.label}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        {selected.length > 0 && (
          <button onClick={() => onChange([])} className="w-full text-left text-xs text-slate-500 hover:text-slate-800 px-3 py-2 border-t border-slate-200">
            Effacer la sélection
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ---- Grand graphique de tendance (aire + ligne) ---------------------------
function GraphiqueTendance({ points, couleur = TEAL[400] }: { points: { libelle: string; valeur: number }[]; couleur?: string }) {
  if (points.length < 2) {
    return <p className="text-sm text-slate-500 py-8 text-center">Pas assez de données pour une tendance.</p>;
  }
  const W = 100, H = 40;
  const vals = points.map((p) => p.valeur);
  const max = Math.max(...vals), min = Math.min(...vals);
  const norm = (v: number) => (max === min ? 0.5 : (v - min) / (max - min));
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => H - norm(v) * (H - 6) - 3;
  const ligne = points.map((p, i) => `${x(i)},${y(p.valeur)}`).join(" ");
  const aire = `${x(0)},${H} ${ligne} ${x(points.length - 1)},${H}`;
  // n'affiche qu'un sous-ensemble d'étiquettes si la série est longue, pour éviter le chevauchement
  const pas = Math.max(1, Math.ceil(points.length / 8));

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-36" preserveAspectRatio="none">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="currentColor" className="text-border" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
        ))}
        <polygon points={aire} fill={couleur} opacity={0.1} />
        <polyline points={ligne} fill="none" stroke={couleur} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.valeur)} r="1.1" fill={couleur} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-slate-500 mt-1 px-0.5">
        {points.map((p, i) => <span key={i} className={i % pas !== 0 && i !== points.length - 1 ? "invisible" : ""}>{p.libelle}</span>)}
      </div>
    </div>
  );
}

// ---- Mini tendance (12 points, dans une cellule de tableau) ----------------
function MiniSparkline({ valeurs, couleur }: { valeurs: number[]; couleur: string }) {
  if (valeurs.length < 2) return <span className="text-[11px] text-slate-500">—</span>;
  const w = 64, h = 20;
  const max = Math.max(...valeurs, 0.0001);
  const min = Math.min(...valeurs, 0);
  const range = max - min || 1;
  const pts = valeurs
    .map((v, i) => {
      const x = (i / (valeurs.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0">
      <polyline points={pts} fill="none" stroke={couleur} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ---- Graphique superposant plusieurs années pour UNE rubrique --------------
function GraphiqueMultiAnnees({ rubrique, entrees, annees, palette }: {
  rubrique: RubriqueHistorique;
  entrees: { bulletin: BulletinRead; periode: Periode }[];
  annees: number[];
  palette: string[];
}) {
  const W = 100, H = 44;
  const series = annees.map((a, i) => {
    const points = Array.from({ length: 12 }, (_, m) => {
      const e = entrees.find((e) => e.periode.annee === a && e.periode.mois === m + 1);
      return e ? rubrique.parPeriode.get(e.bulletin.periode_id) ?? 0 : null;
    });
    return { annee: a, points, couleur: palette[i % palette.length] };
  });
  const toutesValeurs = series.flatMap((s) => s.points.filter((v): v is number => v !== null));
  if (toutesValeurs.length === 0) {
    return <p className="text-xs text-slate-500 py-4 text-center">Pas de données à comparer pour cette rubrique.</p>;
  }
  const max = Math.max(...toutesValeurs), min = Math.min(0, ...toutesValeurs);
  const norm = (v: number) => (max === min ? 0.5 : (v - min) / (max - min));
  const x = (i: number) => (i / 11) * W;
  const y = (v: number) => H - norm(v) * (H - 6) - 3;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32" preserveAspectRatio="none">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="currentColor" className="text-border" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
        ))}
        {series.map((s) => {
          const pts = s.points.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(" ");
          return <polyline key={s.annee} points={pts} fill="none" stroke={s.couleur} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />;
        })}
      </svg>
      <div className="flex justify-between text-[9px] text-slate-500 mt-1 px-0.5">
        {MOIS.slice(1).map((m) => <span key={m}>{m.slice(0, 1)}</span>)}
      </div>
      <div className="flex flex-wrap gap-3 mt-2">
        {series.map((s) => (
          <span key={s.annee} className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: s.couleur }} /> {s.annee}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---- Pavé accordéon générique (groupement par année) ----------------------
function Accordeon({ titre, meta, defautOuvert = true, children }: {
  titre: React.ReactNode; meta?: React.ReactNode; defautOuvert?: boolean; children: React.ReactNode;
}) {
  const [ouvert, setOuvert] = useState(defautOuvert);
  return (
    <div>
      <button onClick={() => setOuvert((o) => !o)} className="w-full flex items-center gap-2 py-2 text-left group">
        {ouvert ? <ChevronDown className="h-4 w-4 text-slate-500 shrink-0" /> : <ChevronRight className="h-4 w-4 text-slate-500 shrink-0" />}
        <span className="text-sm font-semibold flex-1">{titre}</span>
        <span className="text-xs text-slate-500 font-normal">{meta}</span>
      </button>
      {ouvert && <div className="space-y-3 pb-2">{children}</div>}
    </div>
  );
}

// ---- Carte KPI ---------------------------------------------------------
// ---- Mini sparkline SVG (reprise à l'identique de PlanDePaieEcran.tsx) ----
function Sparkline({ values, color = TEAL[400] }: { values: number[]; color?: string }) {
  const w = 72, h = 22;
  if (values.length < 2) return <svg width={w} height={h} className="shrink-0" />;
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

// ---- Carte KPI ---------------------------------------------------------
function CarteKpi({ icon: Icon, label, value, sub, values, couleur = TEAL[400] }: {
  icon: any; label: string; value: string; sub?: string; values?: number[]; couleur?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200/80 p-3 bg-white hover:shadow-sm transition-shadow">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-slate-500"><Icon className="h-3.5 w-3.5" style={{ color: couleur }} /> {label}</div>
        {values && values.length >= 2 && <Sparkline values={values} color={couleur} />}
      </div>
      <div className="text-lg font-semibold tabular-nums mt-0.5 text-slate-800">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

// ---- Groupement des lignes (mêmes règles que Resultat/TraitementPaiePage,
// condensé à 4 groupes — "Assiettes & totaux" plié dans "Éléments & bases" :
// une carte de talon est plus compacte qu'une page pleine, pas la peine d'y
// répliquer les 5 groupes) --------------------------------------------------
type GroupeTalon = "gains" | "cotisations" | "retenues" | "elements";
function categoriserLigne(l: LigneBulletin): GroupeTalon {
  if (l.est_cotisation) return "cotisations";
  if (l.sens === "GAIN") return "gains";
  if (l.sens === "RETENUE") return "retenues";
  return "elements";
}
function grouperLignes(lignes: LigneBulletin[]): Record<GroupeTalon, LigneBulletin[]> {
  const map: Record<GroupeTalon, LigneBulletin[]> = { gains: [], cotisations: [], retenues: [], elements: [] };
  lignes.forEach((l) => map[categoriserLigne(l)].push(l));
  return map;
}
const GROUPE_LABELS: Record<GroupeTalon, string> = { gains: "Gains", cotisations: "Cotisations", retenues: "Retenues", elements: "Éléments & bases" };
const GROUPE_VAR: Record<GroupeTalon, string> = { gains: COULEUR.succes, cotisations: COULEUR.avertissement, retenues: COULEUR.destructif, elements: COULEUR.muet };

// ---- Historique par rubrique (agrégé sur tous les bulletins chargés) ------
type SortKey = "code" | "libelle" | "groupe" | "total" | "moyenne";
interface RubriqueHistorique {
  code: string;
  libelle: string;
  groupe: GroupeTalon;
  parPeriode: Map<string, number>; // periode_id -> montant
}
function construireHistoriqueRubriques(bulletins: BulletinRead[]): RubriqueHistorique[] {
  const map = new Map<string, RubriqueHistorique>();
  for (const b of bulletins) {
    for (const l of b.lignes ?? []) {
      if (!map.has(l.code_rubrique)) {
        map.set(l.code_rubrique, { code: l.code_rubrique, libelle: l.libelle, groupe: categoriserLigne(l), parPeriode: new Map() });
      }
      const r = map.get(l.code_rubrique)!;
      r.parPeriode.set(b.periode_id, (r.parPeriode.get(b.periode_id) ?? 0) + (Number(l.montant) || 0));
    }
  }
  return [...map.values()];
}

// ---- En-tête de colonne triable (tableaux du mode Rubriques) --------------
function EnteteTriable({ label, sortKey, tri, onTri, align = "left" }: {
  label: string; sortKey: SortKey; tri: { cle: SortKey | null; sens: "asc" | "desc" | null }; onTri: (k: SortKey) => void; align?: "left" | "right";
}) {
  const actif = tri.cle === sortKey;
  return (
    <th className={`py-2 px-2.5 font-medium select-none whitespace-nowrap ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        onClick={() => onTri(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-slate-800 transition-colors ${actif ? "text-[#0F6E56]" : "text-slate-500"} ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        {label}
        {actif ? (tri.sens === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </th>
  );
}

// ---- Badge de groupe (couleur pilotée par variable de thème) --------------
function BadgeGroupe({ groupe }: { groupe: GroupeTalon }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap"
      style={{ background: alpha(GROUPE_VAR[groupe], 0.12), color: GROUPE_VAR[groupe] }}
    >
      {GROUPE_LABELS[groupe]}
    </span>
  );
}

// ---- Badge KPI coloré (couleur pilotée par variable de thème, jamais une
// classe Tailwind figée — respecte les préférences d'apparence de chaque
// utilisateur, même logique que PERIODICITE/TYPE_LIGNE dans
// TraitementPaiePage.tsx) --------------------------------------------------
function BadgeKpi({ label, valeur, couleur, clignotant = false }: {
  label: string; valeur?: number | null; couleur: string; clignotant?: boolean;
}) {
  const { formatMoney } = useFormatMasks();
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${clignotant ? "animate-pulse ring-1" : ""}`}
      style={{
        background: alpha(couleur, 0.12),
        color: couleur,
        ...(clignotant ? ({ "--tw-ring-color": alpha(couleur, 0.5) } as React.CSSProperties) : {}),
      }}
    >
      {label} <b className="font-mono tabular-nums">{formatMoney(valeur ?? 0)}</b>
    </span>
  );
}

// Pas de dépendance PDF côté client : une fenêtre dédiée, mise en forme
// minimale, puis le dialogue d'impression du navigateur (« Enregistrer en
// PDF » est une destination standard de ce dialogue sur tous les OS).
function imprimerBulletin(b: BulletinRead, collab: Collab | undefined, periode?: Periode) {
  const fenetre = window.open("", "_blank", "width=800,height=1000");
  if (!fenetre) { toast.error("Fenêtre d'impression bloquée par le navigateur"); return; }

  const gains = b.lignes.filter((l) => !l.est_cotisation && l.code_type !== "ASS");
  const cotisations = b.lignes.filter((l) => l.est_cotisation);
  const ligne = (l: (typeof b.lignes)[number]) =>
    `<tr><td>${l.libelle}</td><td class="mt">${fmt(l.montant)}</td></tr>`;
  const titre = periode ? `${MOIS[periode.mois]} ${periode.annee}` : "";

  fenetre.document.write(`<!doctype html><html><head><meta charset="utf-8">
    <title>Bulletin ${titre}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: ui-monospace, "SF Mono", Consolas, monospace; padding: 48px; color:#1a1a1a; max-width: 640px; margin: 0 auto; }
      h1 { font-family: system-ui, sans-serif; font-size: 19px; margin: 0 0 2px; }
      .sub { font-family: system-ui, sans-serif; color:#666; font-size:12px; margin-bottom: 28px; }
      table { width:100%; border-collapse: collapse; font-size: 13px; margin-bottom: 22px; }
      td { padding: 5px 0; border-bottom: 1px dashed #ddd; }
      .mt { text-align: right; }
      .section-titre { font-family: system-ui, sans-serif; text-transform:uppercase; letter-spacing: 0.12em; font-size:10.5px; color:#888; margin: 22px 0 6px; }
      .total { display:flex; justify-content:space-between; align-items:baseline; font-size: 22px; font-weight:700; border-top: 2px solid #1a1a1a; padding-top:14px; margin-top: 6px; }
      .total span:first-child { font-family: system-ui, sans-serif; font-size: 13px; font-weight: 400; text-transform: uppercase; letter-spacing: 0.08em; color:#666; }
      @media print { body { padding: 0; } }
    </style></head><body>
      <h1>Bulletin de paie — ${titre}</h1>
      <div class="sub">${collab ? `${collab.matricule} · ${collab.nom} ${collab.prenom}` : ""}</div>
      <div class="section-titre">Gains</div>
      <table>${gains.map(ligne).join("") || "<tr><td>—</td><td class=\"mt\">0,00</td></tr>"}</table>
      <div class="section-titre">Cotisations</div>
      <table>${cotisations.map(ligne).join("") || "<tr><td>—</td><td class=\"mt\">0,00</td></tr>"}</table>
      <div class="total"><span>Net à payer</span><span>${fmt(b.net_a_payer)} DH</span></div>
    </body></html>`);
  fenetre.document.close();
  fenetre.focus();
  setTimeout(() => fenetre.print(), 300);
}

// ---- Talon de bulletin (le signature element) ------------------------------
function TalonBulletin({ b, collab, periode, precedent, ouvert, onToggle, couleur = TEAL[400] }: {
  b: BulletinRead; collab?: Collab; periode?: Periode; precedent?: BulletinRead; ouvert: boolean; onToggle: () => void; couleur?: string;
}) {
  const { formatMoney, formatNumber } = useFormatMasks();
  const tampon = b.a_erreur ? { libelle: "En erreur", couleur: COULEUR.destructif } : TAMPON[b.origine];
  const gains = b.lignes.filter((l) => !l.est_cotisation && l.montant >= 0 && l.code_type !== "ASS");
  const cotisations = b.lignes.filter((l) => l.est_cotisation);
  const totalGains = gains.reduce((s, l) => s + (l.montant || 0), 0);
  const totalCot = cotisations.reduce((s, l) => s + (l.montant || 0), 0);
  const partGains = totalGains + totalCot > 0 ? (totalGains / (totalGains + totalCot)) * 100 : 50;

  const delta = precedent && precedent.net_a_payer
    ? ((Number(b.net_a_payer) - Number(precedent.net_a_payer)) / Number(precedent.net_a_payer)) * 100
    : null;

  return (
    <div className="relative flex bg-white rounded-xl border shadow-sm overflow-hidden">
      {/* Souche gauche : période, verticale */}
      <button
        onClick={onToggle}
        className="w-24 shrink-0 flex flex-col items-center justify-center gap-1 bg-[#E1F5EE]/70 hover:bg-[#E1F5EE] transition-colors py-4 border-r"
      >
        <span className="text-[10px] uppercase tracking-widest text-[#085041]/70 [writing-mode:vertical-rl] rotate-180">
          {periode ? `${MOIS[periode.mois]} ${periode.annee}` : "—"}
        </span>
      </button>

      {/* Ligne perforée */}
      <div className="relative w-0">
        <div className="absolute inset-y-2 left-0 border-l-2 border-dashed border-[#9FE1CB]" />
        <div className="absolute -left-[7px] -top-[7px] w-3.5 h-3.5 rounded-full bg-[--stub-bg,#f8fafc]" />
        <div className="absolute -left-[7px] -bottom-[7px] w-3.5 h-3.5 rounded-full bg-[--stub-bg,#f8fafc]" />
      </div>

      {/* Corps du talon */}
      <div className="flex-1 min-w-0 px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs text-slate-500">Net à payer</div>
            <div className="flex items-baseline gap-2">
              <div className="font-mono text-2xl font-semibold tabular-nums">{formatMoney(b.net_a_payer)}</div>
              {delta !== null && Math.abs(delta) >= 0.05 && (
                <span
                  className="inline-flex items-center gap-0.5 text-xs font-medium"
                  style={{ color: delta > 0 ? COULEUR.succes : COULEUR.destructif }}
                >
                  {delta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {delta > 0 ? "+" : ""}{delta.toFixed(1)}%
                </span>
              )}
            </div>
          </div>
          <span
            className="shrink-0 rotate-[-8deg] border-2 rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider opacity-80"
            style={{ fontFamily: "ui-monospace, monospace", borderColor: tampon.couleur, color: tampon.couleur }}
          >
            {tampon.libelle}
          </span>
        </div>

        {ouvert && (
          <div className="mt-3 flex justify-end">
            <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs" onClick={() => imprimerBulletin(b, collab, periode)}>
              <Printer className="h-3.5 w-3.5" /> Imprimer / PDF
            </Button>
          </div>
        )}

        <div className="mt-2 flex flex-wrap gap-1.5">
          <BadgeKpi label="Net à payer" valeur={b.net_a_payer} couleur={TEAL[600]} clignotant />
          <BadgeKpi label="Brut" valeur={b.total_brut} couleur={COULEUR.accent} />
          <BadgeKpi label="Retenues" valeur={b.total_retenues} couleur={COULEUR.destructif} />
          <BadgeKpi label="Coût employeur" valeur={b.cout_employeur} couleur={COULEUR.avertissement} />
        </div>
        <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ backgroundColor: "#E2E8F0" }} title={`Gains ${partGains.toFixed(0)}% · Cotisations ${(100 - partGains).toFixed(0)}%`}>
          <div className="h-full" style={{ width: `${partGains}%`, backgroundColor: couleur, opacity: 0.7 }} />
        </div>

        {ouvert && (() => {
          const groupes = grouperLignes(b.lignes);
          // "Éléments & bases" (compteurs internes : jours travaillés, date
          // d'embauche…) volontairement exclu ici — quasi toujours à 0/non
          // câblé, sans intérêt pour la lecture d'un talon. Idem pour
          // b.messages : la quasi-totalité de ces avertissements concerne
          // justement ces mêmes rubriques — les avertissements réellement
          // rattachés à une rubrique payée restent visibles via l'icône ⚠️
          // sur sa ligne (l.observation).
          const groupesAffiches: { key: GroupeTalon; label: string }[] = [
            { key: "gains", label: "Gains" },
            { key: "cotisations", label: "Cotisations" },
            { key: "retenues", label: "Retenues" },
          ];
          return (
            <div className="mt-4 pt-4 border-t space-y-3">
              {groupesAffiches.map(({ key, label }) => {
                const lignesGroupe = groupes[key];
                if (lignesGroupe.length === 0) return null;
                const total = lignesGroupe.reduce((s, l) => s + (Number(l.montant) || 0), 0);
                return (
                  <div key={key}>
                    <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1 px-0.5">
                      <span>{label} <span className="font-normal normal-case text-slate-500/60">({lignesGroupe.length})</span></span>
                      <span className="font-mono tabular-nums font-bold text-slate-800">{formatMoney(total)}</span>
                    </div>
                    <div className="rounded-lg border overflow-hidden bg-white">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-slate-50/60 text-[10px] uppercase tracking-wide text-slate-500">
                            <th className="py-1 pl-2.5 pr-2 text-left font-medium">Rubrique</th>
                            <th className="py-1 px-2 text-right font-medium">Base</th>
                            <th className="py-1 px-2 text-right font-medium">Nb</th>
                            <th className="py-1 px-2 text-right font-medium">Taux</th>
                            <th className="py-1 px-2 text-right font-medium">Montant</th>
                            <th className="py-1 pr-2.5 text-right font-medium">Part patr.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lignesGroupe.map((l) => (
                            <tr key={l.code_rubrique} className="border-b last:border-0 border-dashed border-slate-100">
                              <td className="py-1.5 pl-2.5 pr-2 font-sans text-slate-800/85">
                                <span className="inline-flex items-center gap-1">
                                  {l.observation && (
                                    <span title={l.observation}>
                                      <AlertTriangle className="h-3 w-3 shrink-0" style={{ color: COULEUR.avertissement }} />
                                    </span>
                                  )}
                                  <span className="truncate">{l.libelle}</span>
                                </span>
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono tabular-nums text-slate-500 whitespace-nowrap">
                                {l.base ? formatNumber(l.base) : ""}
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono tabular-nums text-slate-500 whitespace-nowrap">
                                {l.nombre ? formatNumber(l.nombre, 4) : ""}
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono tabular-nums text-slate-500 whitespace-nowrap">
                                {l.taux ? formatNumber(l.taux, 4) : ""}
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono tabular-nums font-medium whitespace-nowrap">
                                {formatNumber(l.montant)}
                              </td>
                              <td className="py-1.5 pr-2.5 text-right font-mono tabular-nums text-slate-500 whitespace-nowrap">
                                {l.montant_patronal != null ? formatNumber(l.montant_patronal) : ""}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ---- Mode "Tableau" : une ligne dense par bulletin -------------------------
function TableauBulletins({ tries, periodeParId, formatMoney }: {
  tries: BulletinRead[]; periodeParId: Map<string, Periode>; formatMoney: (n?: number | null) => string;
}) {
  if (tries.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-slate-50/60 text-slate-500 uppercase tracking-wide text-[10px]">
            <th className="py-2 px-3 text-left font-medium">Période</th>
            <th className="py-2 px-3 text-left font-medium">Statut</th>
            <th className="py-2 px-3 text-right font-medium">Brut</th>
            <th className="py-2 px-3 text-right font-medium">Retenues</th>
            <th className="py-2 px-3 text-right font-medium">Net à payer</th>
            <th className="py-2 px-3 text-right font-medium">Coût employeur</th>
            <th className="py-2 px-3 text-right font-medium">Variation</th>
          </tr>
        </thead>
        <tbody>
          {tries.map((b, idx) => {
            const p = periodeParId.get(b.periode_id);
            const precedent = tries[idx + 1];
            const delta = precedent && Number(precedent.net_a_payer)
              ? ((Number(b.net_a_payer) - Number(precedent.net_a_payer)) / Number(precedent.net_a_payer)) * 100
              : null;
            const tampon = b.a_erreur ? { libelle: "En erreur", couleur: COULEUR.destructif } : TAMPON[b.origine];
            return (
              <tr key={b.id} className="border-b last:border-0 border-slate-100 hover:bg-[#E1F5EE]/40">
                <td className="py-2 px-3 font-medium whitespace-nowrap">{p ? `${MOIS[p.mois]} ${p.annee}` : "—"}</td>
                <td className="py-2 px-3">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap"
                    style={{ background: alpha(tampon.couleur, 0.12), color: tampon.couleur }}
                  >
                    {tampon.libelle}
                  </span>
                </td>
                <td className="py-2 px-3 text-right font-mono tabular-nums">{formatMoney(b.total_brut)}</td>
                <td className="py-2 px-3 text-right font-mono tabular-nums">{formatMoney(b.total_retenues)}</td>
                <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold">{formatMoney(b.net_a_payer)}</td>
                <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-500">{formatMoney(b.cout_employeur)}</td>
                <td className="py-2 px-3 text-right">
                  {delta === null ? (
                    <span className="text-slate-500/40 text-xs">—</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap" style={{ color: delta >= 0 ? COULEUR.succes : COULEUR.destructif }}>
                      {delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {delta > 0 ? "+" : ""}{delta.toFixed(1)}%
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- Mode "Rubriques" — historique complet (une rubrique = une ligne,
// dépliable pour voir le détail période par période) ------------------------
function TableHistoriqueComplet({ rows, entrees, tri, onTri, ligneDepliee, onToggleLigne, formatMoney, formatNumber }: {
  rows: RubriqueHistorique[];
  entrees: { bulletin: BulletinRead; periode: Periode }[];
  tri: { cle: SortKey | null; sens: "asc" | "desc" | null };
  onTri: (k: SortKey) => void;
  ligneDepliee: string | null;
  onToggleLigne: (c: string | null) => void;
  formatMoney: (n?: number | null) => string;
  formatNumber: (n?: number | null, d?: number) => string;
}) {
  if (rows.length === 0) return <div className="py-10 text-center text-sm text-slate-500">Aucune rubrique ne correspond aux filtres.</div>;
  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden bg-white">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-slate-50/60 text-slate-500 uppercase tracking-wide text-[10px]">
            <th className="w-6"></th>
            <EnteteTriable label="Rubrique" sortKey="code" tri={tri} onTri={onTri} />
            <EnteteTriable label="Groupe" sortKey="groupe" tri={tri} onTri={onTri} />
            <th className="py-2 px-2.5 font-medium text-right">Tendance</th>
            <EnteteTriable label="Total" sortKey="total" tri={tri} onTri={onTri} align="right" />
            <EnteteTriable label="Moyenne" sortKey="moyenne" tri={tri} onTri={onTri} align="right" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const valeurs = entrees.map((e) => r.parPeriode.get(e.bulletin.periode_id) ?? 0);
            const total = valeurs.reduce((s, v) => s + v, 0);
            const moyenne = total / (valeurs.length || 1);
            const ouvert = ligneDepliee === r.code;
            return (
              <React.Fragment key={r.code}>
                <tr onClick={() => onToggleLigne(ouvert ? null : r.code)} className="border-b last:border-0 border-slate-100 hover:bg-[#E1F5EE]/50 cursor-pointer transition-colors">
                  <td className="pl-3">{ouvert ? <ChevronDown className="h-3.5 w-3.5 text-[#0F6E56]" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-500" />}</td>
                  <td className="py-2 px-2.5">
                    <div className="font-mono text-[10px] text-slate-500">{r.code}</div>
                    <div className="text-slate-800/90">{r.libelle}</div>
                  </td>
                  <td className="py-2 px-2.5"><BadgeGroupe groupe={r.groupe} /></td>
                  <td className="py-2 px-2.5"><div className="flex justify-end"><MiniSparkline valeurs={valeurs} couleur={GROUPE_VAR[r.groupe]} /></div></td>
                  <td className="py-2 px-2.5 text-right font-mono tabular-nums font-medium">{formatMoney(total)}</td>
                  <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-500">{formatMoney(moyenne)}</td>
                </tr>
                {ouvert && (
                  <tr className="bg-slate-50/40 border-b border-slate-100">
                    <td></td>
                    <td colSpan={5} className="py-3 px-2.5">
                      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                        <table className="w-full text-[11px] min-w-[640px]">
                          <thead>
                            <tr className="bg-slate-50/50 text-slate-500">
                              <th className="py-1.5 px-2 text-left font-medium">Période</th>
                              {entrees.map((e, i) => (
                                <th key={i} className="py-1.5 px-1.5 text-right font-medium whitespace-nowrap">
                                  {MOIS[e.periode.mois].slice(0, 3)} {String(e.periode.annee).slice(2)}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td className="py-1.5 px-2 text-slate-500">Montant</td>
                              {valeurs.map((v, i) => (
                                <td key={i} className="py-1.5 px-1.5 text-right font-mono tabular-nums">
                                  {v === 0 ? <span className="text-slate-500/40">—</span> : formatNumber(v)}
                                </td>
                              ))}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- Mode "Rubriques" — comparaison annuelle (12 mois d'une année) --------
function TableComparaisonAnnuelle({ rows, annee, periodeIdParAnneeMois, tri, onTri, formatMoney }: {
  rows: RubriqueHistorique[];
  annee: number | null;
  periodeIdParAnneeMois: Map<string, string>;
  tri: { cle: SortKey | null; sens: "asc" | "desc" | null };
  onTri: (k: SortKey) => void;
  formatMoney: (n?: number | null) => string;
}) {
  if (!annee) return null;
  if (rows.length === 0) return <div className="py-10 text-center text-sm text-slate-500">Aucune rubrique ne correspond aux filtres.</div>;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-xs min-w-[920px]">
        <thead>
          <tr className="bg-slate-50/60 text-slate-500 uppercase tracking-wide text-[10px]">
            <EnteteTriable label="Rubrique" sortKey="code" tri={tri} onTri={onTri} />
            <EnteteTriable label="Groupe" sortKey="groupe" tri={tri} onTri={onTri} />
            {MOIS.slice(1).map((m) => <th key={m} className="py-2 px-2 text-right font-medium">{m.slice(0, 3)}</th>)}
            <th className="py-2 px-2.5 text-right font-medium bg-[#E1F5EE]/50">Total</th>
            <EnteteTriable label="Moyenne" sortKey="moyenne" tri={tri} onTri={onTri} align="right" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const valeurs = Array.from({ length: 12 }, (_, i) => {
              const pid = periodeIdParAnneeMois.get(`${annee}-${i + 1}`);
              return pid ? r.parPeriode.get(pid) ?? 0 : null;
            });
            const connues = valeurs.filter((v): v is number => v !== null);
            const total = connues.reduce((s, v) => s + v, 0);
            const moyenne = connues.length ? total / connues.length : 0;
            return (
              <tr key={r.code} className="border-b last:border-0 border-slate-100 hover:bg-[#E1F5EE]/25">
                <td className="py-2 px-2.5">
                  <div className="font-mono text-[10px] text-slate-500">{r.code}</div>
                  <div className="text-slate-800/90">{r.libelle}</div>
                </td>
                <td className="py-2 px-2.5"><BadgeGroupe groupe={r.groupe} /></td>
                {valeurs.map((v, i) => {
                  const ecart = v !== null && moyenne ? (v - moyenne) / moyenne : 0;
                  const teinte = v === null || Math.abs(ecart) < 0.03
                    ? "transparent"
                    : ecart > 0
                      ? alpha(COULEUR.succes, Math.min(Math.abs(ecart), 0.4))
                      : alpha(COULEUR.destructif, Math.min(Math.abs(ecart), 0.4));
                  return (
                    <td key={i} className="py-2 px-2 text-right font-mono tabular-nums whitespace-nowrap" style={{ background: teinte }}>
                      {v === null ? <span className="text-slate-500/30">·</span> : v === 0 ? <span className="text-slate-500/40">—</span> : formatMoney(v)}
                    </td>
                  );
                })}
                <td className="py-2 px-2.5 text-right font-mono tabular-nums font-semibold bg-[#E1F5EE]/25">{formatMoney(total)}</td>
                <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-500">{formatMoney(moyenne)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- Mode "Rubriques" — comparaison pluriannuelle (un mois, jusqu'à 5
// années), avec mini-graphique dépliable par rubrique ------------------------
function TableComparaisonPluriannuelle({ rows, mois, annees, periodeIdParAnneeMois, tri, onTri, formatMoney, palette, entrees }: {
  rows: RubriqueHistorique[];
  mois: number;
  annees: number[];
  periodeIdParAnneeMois: Map<string, string>;
  tri: { cle: SortKey | null; sens: "asc" | "desc" | null };
  onTri: (k: SortKey) => void;
  formatMoney: (n?: number | null) => string;
  palette: string[];
  entrees: { bulletin: BulletinRead; periode: Periode }[];
}) {
  const [ligneDepliee, setLigneDepliee] = useState<string | null>(null);
  if (annees.length === 0) {
    return <div className="py-10 text-center text-sm text-slate-500">Choisissez au moins une année à comparer (5 maximum).</div>;
  }
  if (rows.length === 0) return <div className="py-10 text-center text-sm text-slate-500">Aucune rubrique ne correspond aux filtres.</div>;
  const anneesTri = [...annees].sort((a, b) => a - b);

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        Comparaison de <b className="text-slate-800">{MOIS[mois]}</b> sur {anneesTri.length} année(s) : {anneesTri.join(", ")}.
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50/60 text-slate-500 uppercase tracking-wide text-[10px]">
              <th className="w-6"></th>
              <EnteteTriable label="Rubrique" sortKey="code" tri={tri} onTri={onTri} />
              <EnteteTriable label="Groupe" sortKey="groupe" tri={tri} onTri={onTri} />
              {anneesTri.map((a) => <th key={a} className="py-2 px-2.5 text-right font-medium">{a}</th>)}
              <th className="py-2 px-2.5 text-right font-medium">Évolution</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const valeurs = anneesTri.map((a) => {
                const pid = periodeIdParAnneeMois.get(`${a}-${mois}`);
                return pid ? r.parPeriode.get(pid) ?? 0 : null;
              });
              const premier = valeurs.find((v) => v !== null) ?? null;
              const dernier = [...valeurs].reverse().find((v) => v !== null) ?? null;
              const evolution = premier && dernier && premier !== 0 ? ((dernier - premier) / premier) * 100 : null;
              const ouvert = ligneDepliee === r.code;
              return (
                <React.Fragment key={r.code}>
                  <tr onClick={() => setLigneDepliee(ouvert ? null : r.code)} className="border-b last:border-0 border-slate-100 hover:bg-[#E1F5EE]/40 cursor-pointer transition-colors">
                    <td className="pl-3">{ouvert ? <ChevronDown className="h-3.5 w-3.5 text-[#0F6E56]" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-500" />}</td>
                    <td className="py-2 px-2.5">
                      <div className="font-mono text-[10px] text-slate-500">{r.code}</div>
                      <div className="text-slate-800/90">{r.libelle}</div>
                    </td>
                    <td className="py-2 px-2.5"><BadgeGroupe groupe={r.groupe} /></td>
                    {valeurs.map((v, i) => (
                      <td key={i} className="py-2 px-2.5 text-right font-mono tabular-nums">
                        {v === null ? <span className="text-slate-500/30">·</span> : v === 0 ? <span className="text-slate-500/40">—</span> : formatMoney(v)}
                      </td>
                    ))}
                    <td className="py-2 px-2.5 text-right">
                      {evolution === null ? (
                        <span className="text-slate-500/40 text-xs">—</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap" style={{ color: evolution >= 0 ? COULEUR.succes : COULEUR.destructif }}>
                          {evolution >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                          {evolution > 0 ? "+" : ""}{evolution.toFixed(1)}%
                        </span>
                      )}
                    </td>
                  </tr>
                  {ouvert && (
                    <tr className="bg-slate-50/40 border-b border-slate-100">
                      <td></td>
                      <td colSpan={anneesTri.length + 3} className="py-3 px-3">
                        <GraphiqueMultiAnnees rubrique={r} entrees={entrees} annees={anneesTri} palette={palette} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Explorateur de rubriques : filtres + 3 sous-modes ---------------------
function ExplorateurRubriques({ entrees, chargement, palette }: {
  entrees: { bulletin: BulletinRead; periode: Periode }[];
  chargement: boolean;
  palette: string[];
}) {
  const { formatMoney, formatNumber } = useFormatMasks();
  const [modeComparaison, setModeComparaison] = useState<"historique" | "annuelle" | "pluriannuelle">("historique");
  const [recherche, setRecherche] = useState("");
  const [groupesSelectionnes, setGroupesSelectionnes] = useState<GroupeTalon[]>([]);
  const [masquerZero, setMasquerZero] = useState(false);
  const [tri, setTri] = useState<{ cle: SortKey | null; sens: "asc" | "desc" | null }>({ cle: null, sens: null });
  const [ligneDepliee, setLigneDepliee] = useState<string | null>(null);

  const [anneeChoisie, setAnneeChoisie] = useState<number | null>(null);
  const [moisChoisi, setMoisChoisi] = useState<number>(new Date().getMonth() + 1);
  const [anneesChoisies, setAnneesChoisies] = useState<number[]>([]);

  const anneesDisponibles = useMemo(() => [...new Set(entrees.map((e) => e.periode.annee))].sort((a, b) => b - a), [entrees]);

  useEffect(() => {
    if (anneeChoisie === null && anneesDisponibles.length) setAnneeChoisie(anneesDisponibles[0]);
  }, [anneesDisponibles, anneeChoisie]);
  useEffect(() => {
    if (anneesChoisies.length === 0 && anneesDisponibles.length) setAnneesChoisies(anneesDisponibles.slice(0, 5));
  }, [anneesDisponibles]); // eslint-disable-line react-hooks/exhaustive-deps

  const toutesRubriques = useMemo(() => construireHistoriqueRubriques(entrees.map((e) => e.bulletin)), [entrees]);

  const rubriquesFiltrees = useMemo(() => {
    let rows = toutesRubriques.filter((r) => {
      const matchRecherche = !recherche || r.code.toLowerCase().includes(recherche.toLowerCase()) || r.libelle.toLowerCase().includes(recherche.toLowerCase());
      const matchGroupe = groupesSelectionnes.length === 0 || groupesSelectionnes.includes(r.groupe);
      const total = [...r.parPeriode.values()].reduce((s, v) => s + v, 0);
      const matchZero = !masquerZero || total !== 0;
      return matchRecherche && matchGroupe && matchZero;
    });
    if (tri.cle) {
      rows = [...rows].sort((a, b) => {
        let cmp: number;
        if (tri.cle === "total" || tri.cle === "moyenne") {
          const totalA = [...a.parPeriode.values()].reduce((s, v) => s + v, 0);
          const totalB = [...b.parPeriode.values()].reduce((s, v) => s + v, 0);
          cmp = tri.cle === "moyenne" ? totalA / (a.parPeriode.size || 1) - totalB / (b.parPeriode.size || 1) : totalA - totalB;
        } else if (tri.cle === "groupe") {
          cmp = GROUPE_LABELS[a.groupe].localeCompare(GROUPE_LABELS[b.groupe], "fr");
        } else {
          cmp = String(a[tri.cle as "code" | "libelle"]).localeCompare(String(b[tri.cle as "code" | "libelle"]), "fr");
        }
        return tri.sens === "asc" ? cmp : -cmp;
      });
    }
    return rows;
  }, [toutesRubriques, recherche, groupesSelectionnes, masquerZero, tri]);

  const periodeIdParAnneeMois = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of entrees) m.set(`${e.periode.annee}-${e.periode.mois}`, e.bulletin.periode_id);
    return m;
  }, [entrees]);

  const handleTri = (cle: SortKey) => setTri((t) => (t.cle !== cle ? { cle, sens: "asc" } : t.sens === "asc" ? { cle, sens: "desc" } : { cle: null, sens: null }));
  const filtresActifs = Boolean(recherche || groupesSelectionnes.length || masquerZero || tri.cle);
  const reinitialiser = () => { setRecherche(""); setGroupesSelectionnes([]); setMasquerZero(false); setTri({ cle: null, sens: null }); };

  if (chargement) {
    return <div className="flex items-center justify-center py-16 text-slate-500 gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Chargement du détail des rubriques…</div>;
  }
  if (entrees.length === 0) {
    return <div className="py-16 text-center text-sm text-slate-500">Aucune donnée de rubrique disponible pour ce collaborateur.</div>;
  }

  return (
    <div className="space-y-4">
      {/* barre d'outils */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
          <input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher une rubrique…"
            className="h-8 pl-8 pr-3 w-56 rounded-md border border-slate-200 bg-white text-xs placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#1D9E75]"
          />
        </div>

        <FiltreMultiSelect
          label="Groupe"
          icon={ListFilter}
          options={(["gains", "cotisations", "retenues", "elements"] as GroupeTalon[]).map((g) => ({ value: g, label: GROUPE_LABELS[g], couleur: GROUPE_VAR[g] }))}
          selected={groupesSelectionnes}
          onChange={(v) => setGroupesSelectionnes(v as GroupeTalon[])}
        />

        <Button variant={masquerZero ? "secondary" : "outline"} size="sm" className="h-8 text-xs" onClick={() => setMasquerZero((v) => !v)}>
          Masquer les montants nuls
        </Button>

        {filtresActifs && (
          <Button variant="ghost" size="sm" className="h-8 text-xs gap-1 text-slate-500" onClick={reinitialiser}>
            <X className="h-3.5 w-3.5" /> Réinitialiser
          </Button>
        )}

        <div className="ml-auto inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs">
          {([
            ["historique", "Historique complet"],
            ["annuelle", "Comparaison annuelle"],
            ["pluriannuelle", "Comparaison pluriannuelle"],
          ] as const).map(([v, lbl]) => (
            <button
              key={v}
              onClick={() => setModeComparaison(v)}
              className={`px-3 py-1.5 transition-colors whitespace-nowrap ${modeComparaison === v ? "bg-white text-[#085041] shadow-sm" : "bg-white text-slate-500 hover:text-slate-800"}`}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {modeComparaison === "historique" && (
        <TableHistoriqueComplet
          rows={rubriquesFiltrees}
          entrees={entrees}
          tri={tri}
          onTri={handleTri}
          ligneDepliee={ligneDepliee}
          onToggleLigne={setLigneDepliee}
          formatMoney={formatMoney}
          formatNumber={formatNumber}
        />
      )}

      {modeComparaison === "annuelle" && (
        <>
          <div className="flex items-center gap-2 text-xs">
            <CalendarRange className="h-3.5 w-3.5 text-slate-500" />
            <span className="text-slate-500">Année :</span>
            <Select value={anneeChoisie ? String(anneeChoisie) : undefined} onValueChange={(v) => setAnneeChoisie(Number(v))}>
              <SelectTrigger className="w-24 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{anneesDisponibles.map((a) => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <TableComparaisonAnnuelle rows={rubriquesFiltrees} annee={anneeChoisie} periodeIdParAnneeMois={periodeIdParAnneeMois} tri={tri} onTri={handleTri} formatMoney={formatMoney} />
        </>
      )}

      {modeComparaison === "pluriannuelle" && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="flex items-center gap-2">
              <CalendarRange className="h-3.5 w-3.5 text-slate-500" />
              <span className="text-slate-500">Période :</span>
              <Select value={String(moisChoisi)} onValueChange={(v) => setMoisChoisi(Number(v))}>
                <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{MOIS.slice(1).map((m, i) => <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <FiltreMultiSelect
              label="Années (5 max)"
              icon={GitCompareArrows}
              options={anneesDisponibles.map((a) => ({ value: String(a), label: String(a) }))}
              selected={anneesChoisies.map(String)}
              onChange={(v) => setAnneesChoisies(v.map(Number).sort((a, b) => a - b))}
              maxSelection={5}
            />
          </div>
          <TableComparaisonPluriannuelle
            rows={rubriquesFiltrees}
            mois={moisChoisi}
            annees={anneesChoisies}
            periodeIdParAnneeMois={periodeIdParAnneeMois}
            tri={tri}
            onTri={handleTri}
            formatMoney={formatMoney}
            palette={palette}
            entrees={entrees}
          />
        </>
      )}
    </div>
  );
}

export default function HistoriqueCollaborateurPage() {
  const palette = useChartPalette(6);
  const { formatMoney } = useFormatMasks();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planId, setPlanId] = useState("");
  const [filtreOrigine, setFiltreOrigine] = useState<OrigineBulletin | "TOUS">("TOUS");
  const [periodes, setPeriodes] = useState<Periode[]>([]);
  const [collabs, setCollabs] = useState<Collab[]>([]);
  const [collabId, setCollabId] = useState("");
  const [mode, setMode] = useState<ModeAffichage>("carnet");

  const [bulletinsResume, setBulletinsResume] = useState<BulletinRead[]>([]);
  const [detailCache, setDetailCache] = useState<Record<string, BulletinRead>>({});
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [chargement, setChargement] = useState(false);
  const [chargementDetail, setChargementDetail] = useState<string | null>(null);
  const [chargementRubriques, setChargementRubriques] = useState(false);

  useEffect(() => {
    Promise.allSettled([
      db.list<Plan>("plan_paie", { select: "id,code,libelle", actif: true, limit: 200 }),
      db.list<Collab>("collaborateurs", { select: "id,matricule,nom,prenom", archive: false, order: "nom", limit: 2000 }),
    ]).then(([rp, rc]) => {
      if (rp.status === "fulfilled") { setPlans(rp.value); if (rp.value[0]) setPlanId((a) => a || rp.value[0].id); }
      if (rc.status === "fulfilled") setCollabs(rc.value);
    });
  }, []);

  useEffect(() => {
    if (!planId) return;
    db.list<Periode>("calendrier_paie", { plan_paie_id: planId, select: "id,annee,mois", limit: 1000 })
      .then(setPeriodes)
      .catch((e) => toast.error("Chargement des périodes impossible", { description: e.message }));
  }, [planId]);

  useEffect(() => {
    if (!collabId) { setBulletinsResume([]); return; }
    setChargement(true);
    listerBulletins({ collaborateur_id: collabId })
      .then((rows) => setBulletinsResume(rows.filter((b) => !planId || b.plan_paie_id === planId)))
      .catch((e) => toast.error("Historique indisponible", { description: e.message }))
      .finally(() => setChargement(false));
  }, [collabId, planId]);

  const periodeParId = useMemo(() => new Map(periodes.map((p) => [p.id, p])), [periodes]);

  const tries = useMemo(() => {
    // Onglet "Archivé" (bouton HISTORIQUE) : accepte aussi CLOTURE — un
    // bulletin clôturé mais pas encore migré vers bulletin_historique (pas
    // de clôture annuelle) est déjà "figé" pour l'utilisateur, voir TAMPON.
    const filtres = filtreOrigine === "TOUS"
      ? bulletinsResume
      : filtreOrigine === "HISTORIQUE"
        ? bulletinsResume.filter((b) => b.origine === "HISTORIQUE" || b.origine === "CLOTURE")
        : bulletinsResume.filter((b) => b.origine === filtreOrigine);
    return [...filtres].sort((a, b) => {
      const pa = periodeParId.get(a.periode_id), pb = periodeParId.get(b.periode_id);
      const ka = pa ? pa.annee * 12 + pa.mois : 0, kb = pb ? pb.annee * 12 + pb.mois : 0;
      return kb - ka;
    });
  }, [bulletinsResume, periodeParId, filtreOrigine]);

  const tendanceNet = useMemo(() =>
    [...tries].reverse().map((b) => {
      const p = periodeParId.get(b.periode_id);
      return { libelle: p ? `${MOIS[p.mois].slice(0, 3)} ${String(p.annee).slice(2)}` : "", valeur: Number(b.net_a_payer) };
    }), [tries, periodeParId]);

  const parAnnee = useMemo(() => {
    const groupes = new Map<number, BulletinRead[]>();
    for (const b of tries) {
      const annee = periodeParId.get(b.periode_id)?.annee ?? 0;
      if (!groupes.has(annee)) groupes.set(annee, []);
      groupes.get(annee)!.push(b);
    }
    return [...groupes.entries()].sort((a, b) => b[0] - a[0]);
  }, [tries, periodeParId]);

  const kpi = useMemo(() => {
    if (tries.length === 0) return null;
    const nets = tries.map((b) => Number(b.net_a_payer));
    const anneeCourante = parAnnee[0];
    const netCumuleAnnee = anneeCourante ? anneeCourante[1].reduce((s, b) => s + Number(b.net_a_payer), 0) : 0;
    const derniereVariation = tries.length > 1 && Number(tries[1].net_a_payer)
      ? ((Number(tries[0].net_a_payer) - Number(tries[1].net_a_payer)) / Number(tries[1].net_a_payer)) * 100
      : null;

    // Séries chronologiques (plus ancien -> plus récent) pour les sparklines
    // des cartes KPI — dérivées de `tries` déjà chargé, aucun appel réseau
    // supplémentaire.
    const chrono = [...tries].reverse();
    const serieNet = chrono.map((b) => Number(b.net_a_payer));
    const serieCumulBulletins = chrono.map((_, i) => i + 1);
    let cumul = 0;
    const chronoAnneeCourante = anneeCourante ? [...anneeCourante[1]].reverse() : [];
    const serieCumulAnnee = chronoAnneeCourante.map((b) => (cumul += Number(b.net_a_payer)));

    return {
      nb: tries.length,
      moyenne: nets.reduce((s, v) => s + v, 0) / nets.length,
      cumulAnnee: netCumuleAnnee,
      anneeCourante: anneeCourante?.[0],
      derniereVariation,
      serieNet,
      serieCumulBulletins,
      serieCumulAnnee,
    };
  }, [tries, parAnnee]);

  async function basculer(b: BulletinRead) {
    if (ouvert === b.id) { setOuvert(null); return; }
    setOuvert(b.id);
    if (!detailCache[b.id]) {
      setChargementDetail(b.id);
      try {
        const full = await lireBulletin(b.id);
        setDetailCache((c) => ({ ...c, [b.id]: full }));
      } catch (e: any) {
        toast.error("Détail indisponible", { description: e.message });
      } finally {
        setChargementDetail(null);
      }
    }
  }

  // Le mode "Rubriques" a besoin des lignes détaillées de TOUS les bulletins
  // affichés (pas seulement celui qu'on déplie dans le carnet) — on les
  // charge donc en une fois quand ce mode est activé, plutôt qu'un par un.
  useEffect(() => {
    if (mode !== "rubriques" || tries.length === 0) return;
    const manquants = tries.filter((b) => !detailCache[b.id]);
    if (manquants.length === 0) return;
    setChargementRubriques(true);
    Promise.allSettled(manquants.map((b) => lireBulletin(b.id).then((full) => ({ id: b.id, full }))))
      .then((resultats) => {
        setDetailCache((c) => {
          const next = { ...c };
          for (const r of resultats) if (r.status === "fulfilled") next[r.value.id] = r.value.full;
          return next;
        });
        const echecs = resultats.filter((r) => r.status === "rejected").length;
        if (echecs > 0) toast.error(`${echecs} bulletin(s) n'ont pas pu être chargés pour l'analyse par rubrique`);
      })
      .finally(() => setChargementRubriques(false));
  }, [mode, tries, detailCache]);

  const entreesRubriques = useMemo(() => {
    return tries
      .map((b) => ({ bulletin: detailCache[b.id], periode: periodeParId.get(b.periode_id) }))
      .filter((e): e is { bulletin: BulletinRead; periode: Periode } => !!e.bulletin?.lignes?.length && !!e.periode)
      .sort((a, b) => a.periode.annee * 12 + a.periode.mois - (b.periode.annee * 12 + b.periode.mois));
  }, [tries, detailCache, periodeParId]);

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto bg-slate-50 min-h-screen" style={{ ["--stub-bg" as any]: "#f8fafc" }}>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2"><ReceiptText className="h-6 w-6 text-[#0F6E56]" /> Historique de paie</h1>
        <p className="text-sm text-slate-500 mt-1">Le carnet de bulletins d'un collaborateur, du plus récent au plus ancien.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SelecteurCollaborateur collabs={collabs} value={collabId} onChange={setCollabId} />
        <Select value={planId} onValueChange={setPlanId}>
          <SelectTrigger className="w-[220px]"><SelectValue placeholder="Plan de paie" /></SelectTrigger>
          <SelectContent>{plans.map((p) => <SelectItem key={p.id} value={p.id}>{p.code} · {p.libelle}</SelectItem>)}</SelectContent>
        </Select>
        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs">
          {([["TOUS", "Tous"], ["VALIDE", "Validé"], ["HISTORIQUE", "Archivé"], ["TEMP", "Précalcul"]] as const).map(([v, lbl]) => (
            <button
              key={v}
              onClick={() => setFiltreOrigine(v)}
              className={`px-3 py-1.5 transition-colors ${filtreOrigine === v ? "bg-white text-[#085041] shadow-sm" : "bg-white text-slate-500 hover:text-slate-800"}`}
            >
              {lbl}
            </button>
          ))}
        </div>

        {/* Options d'affichage de l'écran entier */}
        <div className="ml-auto inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs">
          {([
            ["carnet", BookOpen, "Carnet"],
            ["tableau", Table2, "Tableau"],
            ["rubriques", ListFilter, "Rubriques"],
          ] as const).map(([v, Icon, lbl]) => (
            <button
              key={v}
              onClick={() => setMode(v)}
              className={`px-3 py-1.5 inline-flex items-center gap-1.5 transition-colors ${mode === v ? "bg-white text-[#085041] shadow-sm" : "bg-white text-slate-500 hover:text-slate-800"}`}
            >
              <Icon className="h-3.5 w-3.5" /> {lbl}
            </button>
          ))}
        </div>
      </div>

      {!collabId && (
        <Card><CardContent className="py-16 text-center text-sm text-slate-500">Choisissez un collaborateur pour ouvrir son carnet de paie.</CardContent></Card>
      )}

      {collabId && chargement && (
        <div className="flex items-center justify-center py-16 text-slate-500 gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Chargement du carnet…</div>
      )}

      {collabId && !chargement && tries.length === 0 && (
        <Card><CardContent className="py-16 text-center text-sm text-slate-500">
          {filtreOrigine === "TOUS" ? "Aucun bulletin trouvé pour ce plan." : "Aucun bulletin ne correspond à ce filtre pour ce plan."}
        </CardContent></Card>
      )}

      {collabId && tries.length > 0 && kpi && (
        <div className="space-y-5">
          {/* Bandeau KPI, commun aux trois modes */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <CarteKpi icon={FileBadge2} label="Bulletins" value={String(kpi.nb)} values={kpi.serieCumulBulletins} couleur={COULEUR.accent} />
            <CarteKpi icon={Wallet} label="Net moyen" value={formatMoney(kpi.moyenne)} values={kpi.serieNet} couleur={TEAL[400]} />
            <CarteKpi icon={Landmark} label={`Cumul ${kpi.anneeCourante ?? ""}`} value={formatMoney(kpi.cumulAnnee)} values={kpi.serieCumulAnnee} couleur={TEAL[600]} />
            <CarteKpi
              icon={kpi.derniereVariation !== null && kpi.derniereVariation < 0 ? TrendingDown : TrendingUp}
              label="Dernière variation"
              value={kpi.derniereVariation === null ? "—" : `${kpi.derniereVariation > 0 ? "+" : ""}${kpi.derniereVariation.toFixed(1)}%`}
              sub="vs période précédente"
              values={kpi.serieNet}
              couleur={kpi.derniereVariation !== null && kpi.derniereVariation < 0 ? COULEUR.destructif : COULEUR.succes}
            />
          </div>

          {mode === "carnet" && (
            <div className="grid lg:grid-cols-[1fr_320px] gap-6 items-start">
              {/* Colonne principale : carnet de talons groupé par année */}
              <div className="space-y-1 order-2 lg:order-1">
                {parAnnee.map(([annee, bulletinsAnnee]) => (
                  <Accordeon
                    key={annee}
                    titre={annee || "Année inconnue"}
                    meta={`${bulletinsAnnee.length} bulletin(s) · ${formatMoney(bulletinsAnnee.reduce((s, b) => s + Number(b.net_a_payer), 0))}`}
                    defautOuvert={annee === kpi.anneeCourante}
                  >
                    {bulletinsAnnee.map((b) => {
                      const idx = tries.findIndex((x) => x.id === b.id);
                      return (
                        <div key={b.id} className="relative">
                          <TalonBulletin
                            b={detailCache[b.id] ?? b}
                            collab={collabs.find((c) => c.id === collabId)}
                            periode={periodeParId.get(b.periode_id)}
                            precedent={tries[idx + 1] ? (detailCache[tries[idx + 1].id] ?? tries[idx + 1]) : undefined}
                            ouvert={ouvert === b.id}
                            onToggle={() => basculer(b)}
                            couleur={palette[0]}
                          />
                          {chargementDetail === b.id && (
                            <div className="absolute inset-0 bg-white/60 flex items-center justify-center rounded-xl">
                              <Loader2 className="h-4 w-4 animate-spin text-[#0F6E56]" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </Accordeon>
                ))}
              </div>

              {/* Colonne latérale : grand graphique de tendance, collée en haut */}
              <div className="order-1 lg:order-2 lg:sticky lg:top-6">
                <Card>
                  <CardContent className="pt-5">
                    <div className="flex items-center gap-2 text-sm font-medium mb-3"><TrendingUp className="h-4 w-4 text-[#0F6E56]" /> Tendance du net à payer</div>
                    <GraphiqueTendance points={tendanceNet} couleur={palette[0]} />
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {mode === "tableau" && (
            <div className="grid lg:grid-cols-[1fr_320px] gap-6 items-start">
              <div className="order-2 lg:order-1">
                <TableauBulletins tries={tries} periodeParId={periodeParId} formatMoney={formatMoney} />
              </div>
              <div className="order-1 lg:order-2 lg:sticky lg:top-6">
                <Card>
                  <CardContent className="pt-5">
                    <div className="flex items-center gap-2 text-sm font-medium mb-3"><TrendingUp className="h-4 w-4 text-[#0F6E56]" /> Tendance du net à payer</div>
                    <GraphiqueTendance points={tendanceNet} couleur={palette[0]} />
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {mode === "rubriques" && (
            <ExplorateurRubriques entrees={entreesRubriques} chargement={chargementRubriques} palette={palette} />
          )}
        </div>
      )}
    </div>
  );
}
