/**
 * HistoriquePaiePage — Évolution historique de paie d'un collaborateur.
 * Deux lectures : PÉRIODIQUE (une colonne par période) et CUMUL (cumul à date).
 * Filtrable sur une rubrique. Données issues des bulletins déjà calculés
 * (endpoint GET /paie/historique/collaborateur) — écran de consultation, aucune écriture.
 * Auteur : Adil DAIA
 */
import React, { useEffect, useMemo, useState } from "react";
import { api, db } from "@/lib/api";
import { useChartPalette } from "@/hooks/useChartPalette";
import { useFormatMasks } from "@/hooks/useFormatMasks";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Loader2, Check, ChevronsUpDown, ChevronRight, ChevronDown, Download, TrendingUp, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import * as XLSX from "xlsx";

type Collab = { id: string; matricule: string; nom: string; prenom: string };
type Plan = { id: string; code: string; libelle: string };
type Rubrique = { code: string; libelle: string };

interface Ligne {
  periode_id: string; plan_paie_id: string; annee: number; mois: number; numero_periode: number;
  statut_bulletin: string;
  code_rubrique: string; libelle: string; code_type: string | null; sens: string | null; est_cotisation: boolean;
  base: number | null; nombre: number | null; taux: number | null;
  montant: number | null; montant_patronal: number | null;
}
interface Total {
  periode_id: string; plan_paie_id: string; mois: number; statut: string;
  total_brut: number | null; net_imposable: number | null; total_retenues: number | null;
  net_a_payer: number | null; cout_employeur: number | null;
}
/** Colonne = une période du plan (même sans bulletin) */
interface Colonne {
  periode_id: string; plan_paie_id: string;
  annee: number; mois: number; numero_periode: number; intitule: string | null;
}
interface PlanHisto { plan_paie_id: string; code: string; libelle: string; }

const MOIS_COURT = ["", "Janv", "Févr", "Mars", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc"];
const anneeCourante = new Date().getFullYear();

/** Mini-tendance : la forme de l'évolution plutôt que 12 chiffres à lire un par un. */
function Sparkline({ valeurs, couleur = "#9f1239" }: { valeurs: (number | null)[]; couleur?: string }) {
  const vals = valeurs.map((v) => v ?? 0);
  const max = Math.max(...vals), min = Math.min(...vals);
  if (max === min && max === 0) return <span className="text-[11px] text-muted-foreground">—</span>;
  const norm = (v: number) => (max === min ? 0.5 : (v - min) / (max - min));
  const n = vals.length || 1;
  const pts = vals.map((v, i) => `${(i / Math.max(1, n - 1)) * 100},${22 - norm(v) * 18 - 2}`).join(" ");
  return (
    <svg viewBox="0 0 100 22" className="w-20 h-6 overflow-visible shrink-0" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={couleur} strokeWidth="2" opacity={0.7} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Pavé accordéon générique — utilisé pour les plans et les groupes de rubriques. */
function Accordeon({ titre, meta, defautOuvert = true, children }: {
  titre: React.ReactNode; meta?: React.ReactNode; defautOuvert?: boolean; children: React.ReactNode;
}) {
  const [ouvert, setOuvert] = useState(defautOuvert);
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <button
        onClick={() => setOuvert((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-muted/40 hover:bg-muted/60 transition-colors text-left"
      >
        {ouvert ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
        <span className="text-sm font-semibold flex-1 min-w-0">{titre}</span>
        {meta}
      </button>
      {ouvert && <div className="p-4">{children}</div>}
    </div>
  );
}

/** Graphique d'évolution (aire + ligne) — SVG maison, aucune dépendance de charting. */
function GraphiqueEvolution({ cols, series, libelleColonne }: {
  cols: Colonne[];
  series: { nom: string; couleur: string; valeurs: (number | null)[] }[];
  libelleColonne: (c: Colonne) => string;
}) {
  const W = 100, H = 42;
  const toutesValeurs = series.flatMap((s) => s.valeurs.map((v) => v ?? 0));
  const max = Math.max(1, ...toutesValeurs);
  const x = (i: number) => (cols.length > 1 ? (i / (cols.length - 1)) * W : W / 2);
  const y = (v: number) => H - (v / max) * (H - 6) - 3;

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-center gap-4 mb-2">
        {series.map((s) => (
          <span key={s.nom} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.couleur }} />
            {s.nom}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-36" preserveAspectRatio="none">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="currentColor" className="text-border" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
        ))}
        {series.map((s) => {
          const vals = s.valeurs.map((v) => v ?? 0);
          const ligne = vals.map((v, i) => `${x(i)},${y(v)}`).join(" ");
          const aire = `${x(0)},${H} ${ligne} ${x(vals.length - 1)},${H}`;
          return (
            <g key={s.nom}>
              <polygon points={aire} fill={s.couleur} opacity={0.08} />
              <polyline points={ligne} fill="none" stroke={s.couleur} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              {vals.map((v, i) => (
                <circle key={i} cx={x(i)} cy={y(v)} r="1.1" fill={s.couleur} vectorEffect="non-scaling-stroke" />
              ))}
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1 px-0.5">
        {cols.map((c) => <span key={c.periode_id}>{libelleColonne(c)}</span>)}
      </div>
    </div>
  );
}

/** Barres empilées : Net à payer + Retenues = Brut, période par période. */
function GraphiqueBarresEmpilees({ cols, totauxPlan, libelleColonne, couleurNet = "#9f1239", couleurRetenues = "#f59e0b" }: {
  cols: Colonne[]; totauxPlan: (Total | undefined)[]; libelleColonne: (c: Colonne) => string; couleurNet?: string; couleurRetenues?: string;
}) {
  const W = 100, H = 42;
  const net = totauxPlan.map((t) => t?.net_a_payer ?? 0);
  const ret = totauxPlan.map((t) => t?.total_retenues ?? 0);
  const max = Math.max(1, ...net.map((n, i) => n + ret[i]));
  const n = Math.max(1, cols.length);
  const largeur = (W / n) * 0.55;

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-center gap-4 mb-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: couleurNet }} />Net à payer</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: couleurRetenues }} />Retenues</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-36" preserveAspectRatio="none">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="currentColor" className="text-border" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
        ))}
        {cols.map((c, i) => {
          const x = (i + 0.5) * (W / n) - largeur / 2;
          const hNet = (net[i] / max) * (H - 6);
          const hRet = (ret[i] / max) * (H - 6);
          return (
            <g key={c.periode_id}>
              <rect x={x} y={H - hNet} width={largeur} height={Math.max(0, hNet)} fill={couleurNet} rx="0.5" />
              <rect x={x} y={H - hNet - hRet} width={largeur} height={Math.max(0, hRet)} fill={couleurRetenues} rx="0.5" />
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1 px-0.5">
        {cols.map((c) => <span key={c.periode_id}>{libelleColonne(c)}</span>)}
      </div>
    </div>
  );
}

/** Camembert de répartition — construit avec l'astuce `pathLength=100` (pas de calcul de circonférence). */
function GraphiqueDonut({ titre, parts }: { titre: string; parts: { nom: string; valeur: number; couleur: string }[] }) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.valeur), 0);
  let cumul = 0;
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="text-xs font-medium text-muted-foreground mb-3">{titre}</div>
      {total <= 0 ? (
        <p className="text-xs text-muted-foreground">Pas encore de données.</p>
      ) : (
        <div className="flex items-center gap-5">
          <svg viewBox="0 0 42 42" className="w-24 h-24 -rotate-90 shrink-0">
            <circle cx="21" cy="21" r="15.9155" fill="transparent" stroke="currentColor" className="text-muted" strokeWidth="6" />
            {parts.filter((p) => p.valeur > 0).map((p) => {
              const pct = (p.valeur / total) * 100;
              const decalage = -cumul;
              cumul += pct;
              return (
                <circle
                  key={p.nom} cx="21" cy="21" r="15.9155" fill="transparent" stroke={p.couleur} strokeWidth="6"
                  pathLength={100} strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={decalage}
                />
              );
            })}
          </svg>
          <div className="space-y-1.5 min-w-0">
            {parts.map((p) => (
              <div key={p.nom} className="flex items-center gap-2 text-xs">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.couleur }} />
                <span className="text-muted-foreground truncate">{p.nom}</span>
                <span className="font-semibold tabular-nums shrink-0">{total > 0 ? Math.round((p.valeur / total) * 100) : 0}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const HistoriquePaiePage: React.FC = () => {
  const palette = useChartPalette(6);
  // Le hook expose `formatMoney` ; repli défensif si l'implémentation diffère.
  const masks = useFormatMasks() as any;
  const money = (v: number | null | undefined) => {
    if (v === null || v === undefined) return "—";
    const f = masks.formatMoney ?? masks.formatCurrency;
    return typeof f === "function" ? f(v) : v.toLocaleString("fr-MA", { minimumFractionDigits: 2 });
  };

  const [collabs, setCollabs] = useState<Collab[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [rubriques, setRubriques] = useState<Rubrique[]>([]);

  const [collabId, setCollabId] = useState("");
  const [planId, setPlanId] = useState("");
  const [annee, setAnnee] = useState(anneeCourante);
  const [codeRubriques, setCodeRubriques] = useState<string[]>([]);
  const [vue, setVue] = useState<"PERIODE" | "CUMUL">("PERIODE");
  // Tri du tableau détaillé : "code" | "libelle" | "total" | un periode_id
  const [tri, setTri] = useState<{ cle: string; sens: 1 | -1 }>({ cle: "code", sens: 1 });
  const trier = (cle: string) =>
    setTri((t) => (t.cle === cle ? { cle, sens: (t.sens * -1) as 1 | -1 } : { cle, sens: 1 }));
  const IconeTri = ({ cle }: { cle: string }) =>
    tri.cle !== cle ? <ArrowUpDown className="h-3 w-3 opacity-30" />
    : tri.sens === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;

  const [collabOpen, setCollabOpen] = useState(false);
  const [rubOpen, setRubOpen] = useState(false);
  const [ouverts, setOuverts] = useState<Set<string>>(new Set());
  const basculer = (cle: string) => setOuverts((s) => {
    const n = new Set(s);
    n.has(cle) ? n.delete(cle) : n.add(cle);
    return n;
  });
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [totaux, setTotaux] = useState<Total[]>([]);
  const [colonnes, setColonnes] = useState<Colonne[]>([]);
  const [plansHisto, setPlansHisto] = useState<PlanHisto[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    db.list<Collab>("collaborateurs", { archive: false, select: "id,matricule,nom,prenom", order: "matricule", limit: 5000 }).then(setCollabs).catch(() => {});
    db.list<Plan>("plan_paie", { actif: true, select: "id,code,libelle", order: "code", limit: 200 }).then(setPlans).catch(() => {});
    db.list<Rubrique>("rubrique_paie", { archive: false, select: "code,libelle", order: "code", limit: 2000 }).then(setRubriques).catch(() => {});
  }, []);

  const charger = async () => {
    if (!collabId) { toast({ title: "Choisissez un collaborateur", variant: "destructive" }); return; }
    setLoading(true);
    try {
      const q = new URLSearchParams({ collaborateur_id: collabId, annee: String(annee) });
      if (planId) q.set("plan_paie_id", planId);
      codeRubriques.forEach((code) => q.append("code_rubrique", code));
      const r = await api.get<{ lignes: Ligne[]; totaux: Total[]; colonnes: Colonne[]; plans: PlanHisto[] }>(
        `/paie/historique/collaborateur?${q}`);
      setLignes(r.lignes); setTotaux(r.totaux);
      setColonnes(r.colonnes || []); setPlansHisto(r.plans || []);
      if (!r.lignes.length) toast({ title: "Aucun bulletin", description: `Aucun bulletin calculé pour ${annee}.` });
    } catch (e: any) {
      toast({ title: "Chargement impossible", description: e.message, variant: "destructive" });
    }
    setLoading(false);
  };
  useEffect(() => { if (collabId) charger(); /* eslint-disable-next-line */ }, [collabId, planId, annee, codeRubriques]);

  /** Un bloc par plan : colonnes = TOUTES les périodes du plan (même sans bulletin),
   *  lignes = toutes les rubriques calculées sur ce plan. */
  const blocs = useMemo(() => {
    return plansHisto.map((plan) => {
      const cols = colonnes
        .filter((c) => c.plan_paie_id === plan.plan_paie_id)
        .sort((a, b) => a.mois - b.mois || a.numero_periode - b.numero_periode);

      const rubs = new Map<string, { libelle: string; parPeriode: Map<string, number>; categorie: string }>();
      lignes.filter((l) => l.plan_paie_id === plan.plan_paie_id).forEach((l) => {
        if (!rubs.has(l.code_rubrique)) {
          const categorie = l.est_cotisation ? "Cotisations" : l.sens === "RETENUE" ? "Retenues" : l.sens === "GAIN" ? "Gains" : "Autres";
          rubs.set(l.code_rubrique, { libelle: l.libelle, parPeriode: new Map(), categorie });
        }
        const r = rubs.get(l.code_rubrique)!;
        r.parPeriode.set(l.periode_id, (r.parPeriode.get(l.periode_id) || 0) + (l.montant || 0));
      });

      const matrice = [...rubs.entries()].map(([code, r]) => {
        const valeurs: (number | null)[] = [];
        let cumul = 0;
        cols.forEach((c) => {
          const brut = r.parPeriode.get(c.periode_id);
          // null = pas de bulletin sur cette période (distinct d'un montant nul)
          const v = brut === undefined ? null : brut;
          if (v !== null) cumul += v;
          valeurs.push(vue === "CUMUL" ? (r.parPeriode.size ? cumul : null) : v);
        });
        return { code, libelle: r.libelle, categorie: r.categorie, valeurs, total: [...r.parPeriode.values()].reduce((a, b) => a + b, 0) };
      }).sort((a, b) => {
        if (tri.cle === "code") return tri.sens * a.code.localeCompare(b.code);
        if (tri.cle === "libelle") return tri.sens * a.libelle.localeCompare(b.libelle);
        if (tri.cle === "total") return tri.sens * ((a.total ?? 0) - (b.total ?? 0));
        const idx = cols.findIndex((c) => c.periode_id === tri.cle);
        if (idx < 0) return a.code.localeCompare(b.code); // colonne triée absente de ce plan : repli stable
        return tri.sens * ((a.valeurs[idx] ?? -Infinity) - (b.valeurs[idx] ?? -Infinity));
      });

      // Regroupement pour l'affichage ergonomique : Gains → Cotisations → Retenues → Autres
      const ORDRE_CATEGORIES = ["Gains", "Cotisations", "Retenues", "Autres"];
      const groupes = ORDRE_CATEGORIES
        .map((nom) => ({ nom, lignes: matrice.filter((m) => m.categorie === nom) }))
        .filter((g) => g.lignes.length > 0);

      const totauxPlan = cols.map((c) => totaux.find((t) => t.periode_id === c.periode_id));
      return { plan, cols, matrice, groupes, totauxPlan };
    }).filter((b) => b.matrice.length > 0);
  }, [plansHisto, colonnes, lignes, totaux, vue, tri]);

  // Export : une feuille par plan de paie
  const exporter = () => {
    if (!blocs.length) return;
    const wb = XLSX.utils.book_new();
    blocs.forEach(({ plan, cols, matrice }) => {
      const data = matrice.map((r) => {
        const row: any = { Code: r.code, Libellé: r.libelle };
        cols.forEach((c, i) => { row[libCol(c)] = r.valeurs[i]; });
        row["Total"] = r.total;
        return row;
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), plan.code.slice(0, 28));
    });
    const c = collabs.find((x) => x.id === collabId);
    XLSX.writeFile(wb, `historique_${c?.matricule || "paie"}_${annee}.xlsx`);
  };

  /** Libellé d'une colonne : intitulé si présent, sinon mois (+ n° si multi-périodes) */
  const libCol = (c: Colonne) =>
    c.intitule || `${MOIS_COURT[c.mois]}${c.numero_periode > 1 ? ` #${c.numero_periode}` : ""}`;

  const collab = collabs.find((c) => c.id === collabId);
  const resumeRub =
    codeRubriques.length === 0 ? "Toutes"
    : codeRubriques.length === 1 ? codeRubriques[0]
    : `${codeRubriques.length} rubriques`;
  const annees = Array.from({ length: 6 }, (_, i) => anneeCourante - i);

  return (
    <div className="p-5 space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Évolution historique de paie</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Consultation des bulletins calculés d'un collaborateur sur une année. Vue périodique ou cumulée.
        </p>
      </div>

      {/* Critères */}
      <div className="rounded-xl border border-border p-4 grid grid-cols-1 md:grid-cols-5 gap-3">
        <div className="md:col-span-2 space-y-1.5">
          <Label className="text-xs">Collaborateur</Label>
          <Popover open={collabOpen} onOpenChange={setCollabOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                <span className="truncate">{collab ? `${collab.nom} ${collab.prenom} — ${collab.matricule}` : "Sélectionner…"}</span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command filter={(v, s) => (v.toLowerCase().includes(s.toLowerCase()) ? 1 : 0)}>
                <CommandInput placeholder="Nom, prénom ou matricule…" />
                <CommandList>
                  <CommandEmpty>Aucun collaborateur.</CommandEmpty>
                  <CommandGroup>
                    {collabs.map((c) => (
                      <CommandItem key={c.id} value={`${c.nom} ${c.prenom} ${c.matricule}`}
                        onSelect={() => { setCollabId(c.id); setCollabOpen(false); }}>
                        <Check className={`mr-2 h-4 w-4 ${c.id === collabId ? "opacity-100" : "opacity-0"}`} />
                        <span className="flex-1">{c.nom} {c.prenom}</span>
                        <span className="text-xs text-muted-foreground">{c.matricule}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
        <div>
          <Label className="text-xs">Plan de paie</Label>
          <Select value={planId || "all"} onValueChange={(v) => setPlanId(v === "all" ? "" : v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous</SelectItem>
              {plans.map((p) => <SelectItem key={p.id} value={p.id}>{p.code}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Année</Label>
          <Select value={String(annee)} onValueChange={(v) => setAnnee(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{annees.map((a) => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Rubrique{codeRubriques.length > 1 ? "s" : ""}</Label>
          <Popover open={rubOpen} onOpenChange={setRubOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                <span className="truncate">{resumeRub}</span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command filter={(v, s) => (v.toLowerCase().includes(s.toLowerCase()) ? 1 : 0)}>
                <CommandInput placeholder="Code ou intitulé…" />
                <CommandList>
                  <CommandEmpty>Aucune rubrique.</CommandEmpty>
                  <CommandGroup>
                    <CommandItem value="toutes" onSelect={() => setCodeRubriques([])}>
                      <Checkbox checked={codeRubriques.length === 0} className="mr-2 pointer-events-none" /> Toutes
                    </CommandItem>
                    {rubriques.map((r) => (
                      <CommandItem key={r.code} value={`${r.code} ${r.libelle}`}
                        onSelect={() => setCodeRubriques((v) => v.includes(r.code) ? v.filter((x) => x !== r.code) : [...v, r.code])}>
                        <Checkbox checked={codeRubriques.includes(r.code)} className="mr-2 pointer-events-none" />
                        <code className="text-xs text-accent mr-2">{r.code}</code>
                        <span className="text-muted-foreground truncate">{r.libelle}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Bascule de vue + tri + export */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-lg border border-border overflow-hidden text-xs">
            {([["PERIODE", "Périodiques"], ["CUMUL", "Cumuls"]] as const).map(([v, lbl]) => (
              <button key={v} onClick={() => setVue(v)}
                className={`px-4 py-1.5 transition-colors ${vue === v ? "bg-accent text-accent-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}>
                {lbl}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            Trier par
            <button onClick={() => trier("code")} className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-muted hover:text-foreground">
              Code <IconeTri cle="code" />
            </button>
            <button onClick={() => trier("total")} className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-muted hover:text-foreground">
              Total annuel <IconeTri cle="total" />
            </button>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={exporter} disabled={!blocs.length} className="gap-1.5">
          <Download size={14} /> Exporter
        </Button>
      </div>

      {/* Un pavé par plan de paie */}
      {loading ? (
        <div className="rounded-xl border border-border flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="animate-spin mr-2" size={16} /> Chargement…
        </div>
      ) : !collabId ? (
        <div className="rounded-xl border border-border py-12 text-center text-sm text-muted-foreground">
          Sélectionnez un collaborateur.
        </div>
      ) : !blocs.length ? (
        <div className="rounded-xl border border-border py-12 text-center text-sm text-muted-foreground">
          Aucun bulletin calculé pour {annee}.
        </div>
      ) : (
        blocs.map(({ plan, cols, groupes, totauxPlan }) => (
          <Accordeon
            key={plan.plan_paie_id}
            defautOuvert
            titre={<span className="flex items-center gap-2"><Badge variant="outline" className="font-mono text-[11px]">{plan.code}</Badge>{plan.libelle}</span>}
            meta={<span className="text-xs text-muted-foreground font-normal">{cols.length} période(s)</span>}
          >
            <div className="space-y-3">
              {/* Totaux du bulletin — cartes lisibles, tendance visible d'un coup d'œil */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {([["total_brut", "Brut"], ["net_imposable", "Net imposable"], ["net_a_payer", "Net à payer"], ["cout_employeur", "Coût employeur"]] as const).map(([k, lbl], i) => {
                  const valeurs = totauxPlan.map((t) => (t?.[k] ?? null));
                  const derniere = [...valeurs].reverse().find((v) => v !== null) ?? null;
                  return (
                    <div key={k} className="rounded-xl border border-border p-3">
                      <div className="text-xs text-muted-foreground">{lbl}</div>
                      <div className="mt-1 flex items-end justify-between gap-2">
                        <span className="text-lg font-semibold tabular-nums">{money(derniere)}</span>
                        <Sparkline valeurs={valeurs} couleur={palette[i % palette.length]} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Graphiques : évolution, composition brut/net/retenues, répartition par catégorie */}
              <div className="grid md:grid-cols-2 gap-3">
                <GraphiqueEvolution
                  cols={cols}
                  libelleColonne={libCol}
                  series={[
                    { nom: "Net à payer", couleur: palette[0], valeurs: totauxPlan.map((t) => t?.net_a_payer ?? null) },
                    { nom: "Coût employeur", couleur: palette[1], valeurs: totauxPlan.map((t) => t?.cout_employeur ?? null) },
                  ]}
                />
                <GraphiqueBarresEmpilees cols={cols} totauxPlan={totauxPlan} libelleColonne={libCol} couleurNet={palette[0]} couleurRetenues={palette[2]} />
              </div>

              <GraphiqueDonut
                titre="Répartition annuelle par catégorie"
                parts={[
                  { nom: "Gains", couleur: palette[0], valeur: groupes.find((g) => g.nom === "Gains")?.lignes.reduce((s, l) => s + l.total, 0) ?? 0 },
                  { nom: "Cotisations", couleur: palette[2], valeur: groupes.find((g) => g.nom === "Cotisations")?.lignes.reduce((s, l) => s + l.total, 0) ?? 0 },
                  { nom: "Retenues", couleur: palette[1], valeur: groupes.find((g) => g.nom === "Retenues")?.lignes.reduce((s, l) => s + l.total, 0) ?? 0 },
                ]}
              />

              {/* Rubriques groupées par catégorie — chaque groupe est lui-même repliable */}
              <div className="space-y-3">
                {groupes.map((groupe) => (
                  <Accordeon
                    key={groupe.nom}
                    defautOuvert
                    titre={<span className="text-xs uppercase tracking-wide text-muted-foreground">{groupe.nom}</span>}
                    meta={<span className="text-xs text-muted-foreground font-normal">{groupe.lignes.length} rubrique(s)</span>}
                  >
                    <div className="-m-4 divide-y">
                      {groupe.lignes.map((r) => {
                        const cle = `${plan.plan_paie_id}:${r.code}`;
                        const ouvert = ouverts.has(cle);
                        return (
                          <div key={r.code}>
                            <button
                              onClick={() => basculer(cle)}
                              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/20 transition-colors"
                            >
                              {ouvert ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                              <code className="text-[11px] text-accent w-24 shrink-0 truncate">{r.code}</code>
                              <span className="text-xs flex-1 truncate">{r.libelle}</span>
                              <Sparkline valeurs={r.valeurs} couleur={palette[0]} />
                              <span className="text-xs font-semibold tabular-nums w-28 text-right shrink-0">{money(r.total)}</span>
                            </button>
                            {ouvert && (
                              <div className="px-4 pb-3 pl-11">
                                <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
                                  {cols.map((c, i) => (
                                    <span key={c.periode_id} className="flex items-baseline gap-1.5">
                                      <span className="text-muted-foreground">{libCol(c)}</span>
                                      <span className={`tabular-nums font-medium ${!r.valeurs[i] ? "text-muted-foreground" : ""}`}>
                                        {r.valeurs[i] === null ? "—" : money(r.valeurs[i])}
                                      </span>
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </Accordeon>
                ))}
              </div>
            </div>
          </Accordeon>
        ))
      )}

      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        <TrendingUp size={12} />
        Vue <strong>{vue === "CUMUL" ? "Cumuls" : "Périodiques"}</strong> :
        {vue === "CUMUL" ? " chaque colonne affiche le cumul à date." : " chaque colonne affiche le montant de la période."}
        {" "}Seuls les bulletins calculés apparaissent.
      </p>
    </div>
  );
};

export default HistoriquePaiePage;
