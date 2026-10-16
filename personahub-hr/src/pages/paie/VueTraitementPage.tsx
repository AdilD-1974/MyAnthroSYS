/**
 * VueTraitementPage — Vue d'ensemble du traitement de la paie (tableau de bord).
 * Auteur : Adil DAIA
 *
 * Route : /paie/traitement
 * Synthèse mensuelle de l'année en cours (bulletins, statuts, net, coût) +
 * récap comparatif des deux années précédentes.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ CHANGEMENTS REQUIS CÔTÉ BACKEND (lib/paieApi.ts)
 * ─────────────────────────────────────────────────────────────────────────
 * `synthesePaie` doit désormais accepter un 3e paramètre `filters` et
 * l'appliquer (AND) en plus des `planIds` :
 *
 *   synthesePaie(planIds: string[], annee: number, filters?: PaieFilters): Promise<SyntheseResult>
 *
 *   type PaieFilters = {
 *     categorieIds?: string[];       // filtre catégorie salariale
 *     contratIds?: string[];         // filtre type de contrat
 *     organisationIds?: string[];    // filtre organisation / structure
 *   };
 *
 * Un tableau vide ou `undefined` pour une clé de filtre = pas de restriction
 * sur ce critère (contrairement à `planIds` qui, lui, reste obligatoire :
 * liste vide = aucune donnée, comportement inchangé).
 *
 * Si vous n'avez pas encore adapté le backend, le composant continuera de
 * fonctionner (les filtres additionnels seront simplement ignorés par
 * l'API tant qu'elle ne lit pas `filters`), mais les résultats affichés ne
 * seront pas filtrés par Catégorie / Contrat / Organisation.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ AUTRES PRÉ-REQUIS (facultatifs mais recommandés)
 * ─────────────────────────────────────────────────────────────────────────
 */
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Wallet, Building2, FileText, ShieldCheck, TrendingUp, TrendingDown, Minus,
  Users, Coins, Percent, ChevronsUpDown, ChevronRight, ChevronDown, RotateCcw, Filter,
} from "lucide-react";
import { db } from "@/lib/api";
import { synthesePaie, type SyntheseResult } from "@/lib/paieApi";
import { useChartPalette } from "@/hooks/useChartPalette";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";

const MOIS = ["", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const fmt = (n?: number | null) => new Intl.NumberFormat("fr-MA", { maximumFractionDigits: 0 }).format(n ?? 0);
const fmt2 = (n?: number | null) => new Intl.NumberFormat("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0);

// ── Référentiels ────────────────────────────────────────────────────────
type Ref = { id: string; code: string; libelle: string };
type Plan = Ref;
// `intitule` est renvoyé par l'API (agrégé si plusieurs périodes distinctes
// partagent le même mois, ex. quinzaines) ; on garde un repli "Mois Année"
// pour les enregistrements plus anciens où il serait vide.
type PeriodeRow = SyntheseResult["periodes"][number];

// Couleurs distinctes par plan : dérivées dynamiquement du thème choisi dans
// Apparence via useChartPalette() (voir le composant principal), plutôt que
// des variables CSS --chart-N figées.

type PaieFilters = {
  categorieIds?: string[];
  contratIds?: string[];
  organisationIds?: string[];
};

// Ajustez ces noms de table/colonnes selon votre schéma réel si besoin.
const REF_TABLES = {
  categorie: { table: "categorie_salariale", select: "id,code,libelle" },
  contrat: { table: "type_contrat", select: "id,code,libelle" },
  organisation: { table: "organisation", select: "id,code,libelle" },
} as const;

function statutBadge(s: PeriodeRow["statut_periode"]) {
  const cfg =
    s === "CLOTUREE"    ? { l: "Clôturée",    v: "--accent" } :
    s === "NON_OUVERTE" ? { l: "Non ouverte", v: "--warning" } :
    s === "EN_COURS"    ? { l: "En cours",    v: "--info" } :
    s === "VALIDEE"     ? { l: "Validée",     v: "--success" } :
    s === "EN_ERREUR"   ? { l: "En erreur",   v: "--destructive" } :
                          { l: "Ouverte",     v: "--muted-foreground" };
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium"
      style={{ background: `hsl(var(${cfg.v}) / 0.1)`, color: `hsl(var(${cfg.v}))`, boxShadow: `inset 0 0 0 1px hsl(var(${cfg.v}) / 0.25)` }}
    >
      <span className="h-1 w-1 rounded-full shrink-0" style={{ background: `hsl(var(${cfg.v}))` }} />
      {cfg.l}
    </span>
  );
}

// Intitulé affiché pour une période : celui renvoyé par l'API si présent,
// sinon un intitulé de repli "<Mois> <Année>". `null` = volontairement vide
// (ligne agrégée multi-plans : concaténer les intitulés de plans différents
// n'aurait pas de sens — l'intitulé n'est affiché qu'au niveau d'un plan).
function periodeIntitule(p: PeriodeRow, annee: number): string | null {
  return p.intitule?.trim() || `${MOIS[p.mois]} ${annee}`;
}

function PeriodeCell({ row, annee, masquerIntitule = false }: { row: PeriodeRow; annee: number; masquerIntitule?: boolean }) {
  const intitule = masquerIntitule ? null : periodeIntitule(row, annee);
  return intitule
    ? <span className="text-xs font-medium leading-tight">{intitule}</span>
    : <span className="text-xs text-muted-foreground">—</span>;
}

export default function VueTraitementPage() {
  const palette = useChartPalette(8);
  // Référentiels
  const [plans, setPlans] = useState<Plan[]>([]);
  const [categories, setCategories] = useState<Ref[]>([]);
  const [contrats, setContrats] = useState<Ref[]>([]);
  const [organisations, setOrganisations] = useState<Ref[]>([]);
  const [calRows, setCalRows] = useState<{ annee: number; plan_paie_id: string }[]>([]);

  // Filtres sélectionnés (multicritères, combinés en ET)
  const [planIds, setPlanIds] = useState<string[]>([]);
  const [categorieIds, setCategorieIds] = useState<string[]>([]);
  const [contratIds, setContratIds] = useState<string[]>([]);
  const [organisationIds, setOrganisationIds] = useState<string[]>([]);
  const [annee, setAnnee] = useState<number | null>(null);

  // Données
  const [data, setData] = useState<SyntheseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [perPlanPeriodes, setPerPlanPeriodes] = useState<Record<string, PeriodeRow[]>>({});
  const [loadingGroupe, setLoadingGroupe] = useState(false);

  const filters: PaieFilters = useMemo(() => ({
    categorieIds: categorieIds.length ? categorieIds : undefined,
    contratIds: contratIds.length ? contratIds : undefined,
    organisationIds: organisationIds.length ? organisationIds : undefined,
  }), [categorieIds, contratIds, organisationIds]);

  const nbFiltresActifs = categorieIds.length + contratIds.length + organisationIds.length;

  useEffect(() => {
    const aujourdhui = new Date().toISOString().slice(0, 10);
    Promise.all([
      db.list<Plan>("plan_paie", { select: "id,code,libelle", actif: true, limit: 200 }),
      // Rattachements actifs, pour ne garder que les plans ayant un effectif
      // réel (RG-VUE-TRAITEMENT-PLAN-EFFECTIF-01, même règle que
      // LancementPaiePage.tsx) — un plan sans aucun collaborateur rattaché
      // n'a rien à montrer ici (lignes à 0 partout, comme QUINZ).
      db.list<any>("collaborateur_plan_paie", {
        archive: false, select: "plan_paie_id,date_debut,date_fin", limit: 5000,
      }).catch(() => null), // null = échec distinct de [] (vide) : sert de repli plus bas
      db.list<{ annee: number; plan_paie_id: string }>("calendrier_paie", { select: "annee,plan_paie_id", limit: 10000 }).catch(() => []),
      db.list<Ref>(REF_TABLES.categorie.table, { select: REF_TABLES.categorie.select, limit: 200 }).catch(() => []),
      db.list<Ref>(REF_TABLES.contrat.table, { select: REF_TABLES.contrat.select, limit: 200 }).catch(() => []),
      db.list<Ref>(REF_TABLES.organisation.table, { select: REF_TABLES.organisation.select, limit: 200 }).catch(() => []),
    ]).then(([ps, rattachements, cal, cats, cons, orgs]) => {
      let psFiltres = ps;
      if (rattachements) {
        const plansAvecEffectif = new Set(
          rattachements
            .filter((l: any) => l.date_debut <= aujourdhui && (!l.date_fin || l.date_fin >= aujourdhui))
            .map((l: any) => l.plan_paie_id),
        );
        psFiltres = ps.filter((p) => plansAvecEffectif.has(p.id));
      } // rattachements === null (requête en échec) : repli sur la liste complète, ne pas tout masquer
      setPlans(psFiltres);
      setPlanIds(psFiltres.map((p) => p.id)); // par défaut : tous les plans AVEC effectif (vue consolidée)
      setCalRows(cal);
      setCategories(cats);
      setContrats(cons);
      setOrganisations(orgs);
    }).catch((e) => toast.error("Chargement impossible", { description: e.message }));
  }, []);

  // Années disponibles pour les plans sélectionnés (union)
  const annees = useMemo(() => {
    const set = new Set(calRows.filter((r) => planIds.includes(r.plan_paie_id)).map((r) => r.annee));
    return Array.from(set).sort((a, b) => b - a);
  }, [calRows, planIds]);

  useEffect(() => {
    setAnnee((prev) => (prev && annees.includes(prev) ? prev : annees[0] ?? null));
  }, [annees]);

  // Synthèse consolidée (KPIs, répartitions, top rubriques, comparatif) — respecte tous les critères
  useEffect(() => {
    if (planIds.length === 0 || !annee) { setData(null); return; }
    setLoading(true);
    synthesePaie(planIds, annee, filters)
      .then(setData)
      .catch((e) => toast.error("Chargement de la synthèse impossible", { description: e.message }))
      .finally(() => setLoading(false));
  }, [planIds, annee, filters]);

  // Détail par période réelle (une ligne par quinzaine/rappel/etc.), pour le
  // tableau détaillé — qu'il y ait un seul plan (table simple) ou plusieurs
  // (regroupement Mois > Plan > Période).
  useEffect(() => {
    if (planIds.length === 0 || !annee) { setPerPlanPeriodes({}); return; }
    setLoadingGroupe(true);
    Promise.all(
      planIds.map((pid) =>
        synthesePaie([pid], annee, filters, false, true)
          .then((r) => [pid, r.periodes] as const)
          .catch(() => [pid, [] as PeriodeRow[]] as const)
      )
    )
      .then((entries) => setPerPlanPeriodes(Object.fromEntries(entries)))
      .finally(() => setLoadingGroupe(false));
  }, [planIds, annee, filters]);

  const netMaxGroupe = useMemo(
    () => Math.max(1, ...Object.values(perPlanPeriodes).flat().map((p) => p.net)),
    [perPlanPeriodes]
  );
  const avancement = data && data.totaux.nb > 0
    ? Math.round(((data.totaux.valides + data.totaux.clotures) / data.totaux.nb) * 100) : 0;

  const delta = (courant: number, precedent: number) => {
    if (!precedent) return null;
    return ((courant - precedent) / precedent) * 100;
  };

  const resetFiltres = () => {
    setPlanIds(plans.map((p) => p.id));
    setCategorieIds([]);
    setContratIds([]);
    setOrganisationIds([]);
  };

  const groupe = planIds.length > 1;

  return (
    <div className="px-6 py-4 space-y-3 w-full">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Vue d'ensemble du traitement</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Synthèse des paies de l'année en cours et comparatif des exercices précédents.</p>
        </div>
      </div>

      {/* Barre de filtres multicritères */}
      <Card>
        <CardContent className="py-3 px-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mr-1">
              <Filter className="h-3.5 w-3.5" /> Filtres
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Plans</label>
              <MultiSelectFilter items={plans} value={planIds} onChange={setPlanIds} allLabel="Tous les plans" emptyLabel="Aucun plan" emptyMeansAll={false} width={220} />
            </div>
            {categories.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Catégorie</label>
                <MultiSelectFilter items={categories} value={categorieIds} onChange={setCategorieIds} allLabel="Toutes catégories" emptyLabel="Toutes catégories" emptyMeansAll width={200} />
              </div>
            )}
            {contrats.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Contrat</label>
                <MultiSelectFilter items={contrats} value={contratIds} onChange={setContratIds} allLabel="Tous les contrats" emptyLabel="Tous les contrats" emptyMeansAll width={200} />
              </div>
            )}
            {organisations.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Organisation</label>
                <MultiSelectFilter items={organisations} value={organisationIds} onChange={setOrganisationIds} allLabel="Toutes organisations" emptyLabel="Toutes organisations" emptyMeansAll width={200} />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Année</label>
              <Select value={annee ? String(annee) : ""} onValueChange={(v) => setAnnee(Number(v))} disabled={!annees.length}>
                <SelectTrigger className="w-[110px]"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{annees.map((a) => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {nbFiltresActifs > 0 && (
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={resetFiltres}>
                <RotateCcw className="h-3.5 w-3.5" /> Réinitialiser
              </Button>
            )}
          </div>
          {nbFiltresActifs > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {categorieIds.map((id) => (
                <Badge key={id} variant="secondary" className="gap-1">
                  {categories.find((c) => c.id === id)?.libelle}
                  <button onClick={() => setCategorieIds((v) => v.filter((x) => x !== id))} className="ml-0.5">×</button>
                </Badge>
              ))}
              {contratIds.map((id) => (
                <Badge key={id} variant="secondary" className="gap-1">
                  {contrats.find((c) => c.id === id)?.libelle}
                  <button onClick={() => setContratIds((v) => v.filter((x) => x !== id))} className="ml-0.5">×</button>
                </Badge>
              ))}
              {organisationIds.map((id) => (
                <Badge key={id} variant="secondary" className="gap-1">
                  {organisations.find((c) => c.id === id)?.libelle}
                  <button onClick={() => setOrganisationIds((v) => v.filter((x) => x !== id))} className="ml-0.5">×</button>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : !data ? (
        <div className="text-center text-sm text-muted-foreground py-12 border border-dashed rounded-lg">Aucune donnée pour cette sélection.</div>
      ) : (
        <>
          {/* KPI de l'année en cours */}
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-4 xl:grid-cols-8">
            <Stat icon={<Wallet className="h-4 w-4" />} label={`Masse nette ${data.annee}`} value={`${fmt2(data.totaux.net)} DH`} accent />
            <Stat icon={<TrendingUp className="h-4 w-4" />} label="Masse brute" value={`${fmt2(data.totaux.brut)} DH`} />
            <Stat icon={<Building2 className="h-4 w-4" />} label="Coût employeur" value={`${fmt2(data.totaux.cout)} DH`} />
            <Stat icon={<Coins className="h-4 w-4" />} label="Cotisations" value={`${fmt2(data.totaux.cotisations)} DH`} />
            <Stat icon={<Users className="h-4 w-4" />} label="Effectif payé" value={String(data.totaux.effectif)} sub={`${data.totaux.nb} bulletin(s)`} />
            <Stat icon={<FileText className="h-4 w-4" />} label="Net moyen" value={`${fmt(data.totaux.net_moyen)} DH`} sub={`coût moyen ${fmt(data.totaux.cout_moyen)} DH`} />
            <Stat icon={<Percent className="h-4 w-4" />} label="Taux de charges" value={`${data.totaux.taux_charges.toFixed(1)} %`} sub="cotisations / brut" />
            <Stat icon={<ShieldCheck className="h-4 w-4" />} label="Avancement" value={`${avancement}%`} sub={`${data.totaux.a_valider} à valider · ${data.totaux.en_erreur} en erreur`} />
          </div>

          {/* KPI complémentaires */}
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
            <Stat icon={<TrendingUp className="h-4 w-4" />} label="Salaire brut moyen" value={`${fmt(data.totaux.brut_moyen)} DH`} />
            <Stat icon={<Percent className="h-4 w-4" />} label="Ratio net / brut" value={`${data.totaux.ratio_net_brut.toFixed(1)} %`} sub="part du brut versée" />
            <Stat icon={<Coins className="h-4 w-4" />} label="Cotisations salariales" value={`${fmt2(data.totaux.cot_salariale)} DH`} />
            <Stat icon={<Building2 className="h-4 w-4" />} label="Cotisations patronales" value={`${fmt2(data.totaux.cot_patronale)} DH`} />
          </div>

          {/* Détail mensuel — groupé Mois > Plan > Période dès que plusieurs plans sont sélectionnés */}
          <Card>
            <CardContent className="p-0">
              {groupe ? (
                loadingGroupe ? (
                  <div className="p-4"><Skeleton className="h-48 w-full" /></div>
                ) : (
                  <GroupedTable
                    periodesAgregees={data.periodes}
                    perPlanPeriodes={perPlanPeriodes}
                    plans={plans.filter((p) => planIds.includes(p.id))}
                    netMax={netMaxGroupe}
                    annee={data.annee}
                    palette={palette}
                  />
                )
              ) : loadingGroupe ? (
                <div className="p-4"><Skeleton className="h-48 w-full" /></div>
              ) : (
                <>
                {planIds.length === 1 && (
                  <div className="px-4 pt-4 pb-2 flex items-center gap-2 text-sm border-b">
                    <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: palette[0] }} />
                    <span className="text-muted-foreground">Plan :</span>
                    <span className="font-medium">
                      {plans.find((p) => p.id === planIds[0])?.code}
                      {" · "}
                      {plans.find((p) => p.id === planIds[0])?.libelle}
                    </span>
                  </div>
                )}
                <Table className="text-sm [&_td]:py-1.5 [&_th]:py-2">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mois</TableHead>
                      <TableHead>Période</TableHead>
                      <TableHead>Statut</TableHead>
                      <TableHead className="text-right">Effectif</TableHead>
                      <TableHead className="text-right">Bulletins</TableHead>
                      <TableHead className="text-right">Validés</TableHead>
                      <TableHead className="text-right">Clôturés</TableHead>
                      <TableHead className="text-right">Net à payer</TableHead>
                      <TableHead className="min-w-[120px]">Répartition</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(perPlanPeriodes[planIds[0]] ?? []).map((p, idx) => (
                      <TableRow key={p.periode_id ?? `${p.mois}-${idx}`}>
                        <TableCell className="font-medium">{MOIS[p.mois]}</TableCell>
                        <TableCell><PeriodeCell row={p} annee={data.annee} /></TableCell>
                        <TableCell>{statutBadge(p.statut_periode)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{p.effectif}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.nb}</TableCell>
                        <TableCell className="text-right tabular-nums" style={{ color: "hsl(var(--success))" }}>{p.valides}</TableCell>
                        <TableCell className="text-right tabular-nums" style={{ color: "hsl(var(--accent))" }}>{p.clotures}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{fmt(p.net)}</TableCell>
                        <TableCell>
                          <div className="h-1.5 w-full rounded bg-muted overflow-hidden">
                            <div className="h-full bg-primary/70" style={{ width: `${(p.net / netMaxGroupe) * 100}%` }} />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {data.periodes.length === 0 && (
                      <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">Aucune période sur {data.annee}.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
                </>
              )}
            </CardContent>
          </Card>

          {/* Répartitions */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Repartition titre="Masse salariale par organisation" lignes={data.repartition_organisation} />
            <Repartition titre="Masse salariale par type de contrat" lignes={data.repartition_contrat} />
          </div>

          {data.top_rubriques.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <div className="text-sm font-semibold mb-2">Top rubriques de gain</div>
                <div className="space-y-2">
                  {(() => {
                    const max = Math.max(1, ...data.top_rubriques.map((r) => r.total));
                    return data.top_rubriques.map((r) => (
                      <div key={r.code} className="flex items-center gap-3 text-sm">
                        <div className="w-80 shrink-0 truncate" title={`${r.libelle} (${r.code})`}>
                          {r.libelle} <span className="text-xs text-muted-foreground">({r.code})</span>
                        </div>
                        <div className="flex-1 h-2 rounded bg-muted overflow-hidden">
                          <div className="h-full" style={{ width: `${(r.total / max) * 100}%`, background: "hsl(var(--success) / 0.7)" }} />
                        </div>
                        <div className="w-28 text-right tabular-nums font-medium">{fmt(r.total)} DH</div>
                      </div>
                    ));
                  })()}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Comparatif des années précédentes */}
          {data.precedentes.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Exercices précédents</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {data.precedentes.map((a) => {
                  const d = delta(data.totaux.net, a.net);
                  return (
                    <Card key={a.annee}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="text-lg font-semibold">{a.annee}</div>
                          {d != null && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: d > 0 ? "hsl(var(--success))" : d < 0 ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))" }}>
                              {d > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : d < 0 ? <TrendingDown className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                              {Math.abs(d).toFixed(1)}% vs {data.annee}
                            </span>
                          )}
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
                          <div>
                            <div className="text-xs text-muted-foreground">Net à payer</div>
                            <div className="font-medium tabular-nums">{fmt2(a.net)} DH</div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">Coût employeur</div>
                            <div className="font-medium tabular-nums">{fmt2(a.cout)} DH</div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">Bulletins</div>
                            <div className="font-medium tabular-nums">{a.nb}</div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Tableau groupé Mois > Plan > Période.
 * Chaque groupe "Mois" est repliable ; il affiche une ligne agrégée (tous
 * plans sélectionnés confondus) puis, une fois déplié, une sous-ligne par
 * plan avec sa période correspondante pour ce mois.
 *
 * Point d'extension : si un plan peut avoir plusieurs runs de paie dans le
 * même mois (ex. quinzaine), remplacez la ligne unique par plan/mois par
 * une boucle sur les périodes réelles renvoyées par le backend pour ce
 * couple (plan, mois).
 */
function GroupedTable({
  periodesAgregees, perPlanPeriodes, plans, netMax, annee, palette,
}: {
  periodesAgregees: PeriodeRow[];
  perPlanPeriodes: Record<string, PeriodeRow[]>;
  plans: Plan[];
  netMax: number;
  annee: number;
  palette: string[];
}) {
  const [expanded, setExpanded] = useState<Set<number>>(
    () => new Set(periodesAgregees.filter((p) => p.nb > 0).map((p) => p.mois))
  );
  const toggle = (mois: number) =>
    setExpanded((s) => { const n = new Set(s); n.has(mois) ? n.delete(mois) : n.add(mois); return n; });

  return (
    <Table className="text-sm [&_td]:py-1.5 [&_th]:py-2">
      <TableHeader>
        <TableRow>
          <TableHead>Mois / Plan</TableHead>
          <TableHead>Période</TableHead>
          <TableHead>Statut</TableHead>
          <TableHead className="text-right">Effectif</TableHead>
          <TableHead className="text-right">Bulletins</TableHead>
          <TableHead className="text-right">Validés</TableHead>
          <TableHead className="text-right">Clôturés</TableHead>
          <TableHead className="text-right">Net à payer</TableHead>
          <TableHead className="min-w-[120px]">Répartition</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {periodesAgregees.map((agg) => {
          const isOpen = expanded.has(agg.mois);
          return (
            <React.Fragment key={agg.mois}>
              <TableRow className="bg-muted/40 hover:bg-muted/60 cursor-pointer" onClick={() => toggle(agg.mois)}>
                <TableCell className="font-semibold">
                  <span className="inline-flex items-center gap-1.5">
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                    {MOIS[agg.mois]}
                    <span className="text-xs font-normal text-muted-foreground">({plans.length} plans)</span>
                  </span>
                </TableCell>
                <TableCell><PeriodeCell row={agg} annee={annee} masquerIntitule /></TableCell>
                <TableCell>{statutBadge(agg.statut_periode)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{agg.effectif}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{agg.nb}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold" style={{ color: "hsl(var(--success))" }}>{agg.valides}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold" style={{ color: "hsl(var(--accent))" }}>{agg.clotures}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{fmt(agg.net)}</TableCell>
                <TableCell>
                  <div className="h-1.5 w-full rounded bg-muted overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${(agg.net / netMax) * 100}%` }} />
                  </div>
                </TableCell>
              </TableRow>
              {isOpen && plans.map((plan, planIndex) => {
                // ⚠️ FIX quinzaines : on récupère TOUTES les périodes du
                // plan pour ce mois avec .filter() (pas .find()).
                // Un plan "QUINZ" peut avoir plusieurs runs dans le même mois.
                const periodesDuMois = (perPlanPeriodes[plan.id] ?? [])
                  .filter((row) => row.mois === agg.mois);
                const couleur = palette[planIndex % palette.length];

                if (periodesDuMois.length === 0) {
                  return (
                    <TableRow key={`${agg.mois}-${plan.id}-vide`} className="text-muted-foreground [&_td]:py-1.5">
                      <TableCell className="pl-9">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-block h-2 w-2 rounded-full shrink-0 opacity-30" style={{ backgroundColor: couleur }} />
                          <span className="font-medium opacity-50">{plan.code}</span>
                          <span className="text-xs ml-1 opacity-40">{plan.libelle}</span>
                        </span>
                      </TableCell>
                      <TableCell><span className="text-xs text-muted-foreground">—</span></TableCell>
                      <TableCell><span className="text-xs text-muted-foreground">—</span></TableCell>
                      {[...Array(5)].map((_, i) => (
                        <TableCell key={i} className="text-right tabular-nums text-muted-foreground/40">0</TableCell>
                      ))}
                      <TableCell><div className="h-1.5 w-full rounded bg-muted/40" /></TableCell>
                    </TableRow>
                  );
                }

                // Une ligne par période réelle (quinzaine 1, quinzaine 2, rappel…)
                return periodesDuMois.map((p, pIdx) => (
                  <TableRow
                    key={`${agg.mois}-${plan.id}-${pIdx}`}
                    className="text-muted-foreground [&_td]:py-1.5"
                  >
                    <TableCell className={pIdx === 0 ? "pl-9" : "pl-14"}>
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="inline-block rounded-full shrink-0"
                          style={{
                            backgroundColor: couleur,
                            width: pIdx === 0 ? 8 : 6,
                            height: pIdx === 0 ? 8 : 6,
                            opacity: pIdx === 0 ? 1 : 0.55,
                          }}
                        />
                        {pIdx === 0 ? (
                          <>
                            <span className="text-foreground font-medium">{plan.code}</span>
                            <span className="text-xs ml-1 text-muted-foreground">{plan.libelle}</span>
                            {periodesDuMois.length > 1 && (
                              <span className="ml-1 text-[10px] bg-muted text-muted-foreground rounded px-1 py-0.5">
                                {periodesDuMois.length} périodes
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-[11px] text-muted-foreground italic">
                            {p.intitule ?? `Période ${pIdx + 1}`}
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell><PeriodeCell row={p} annee={annee} /></TableCell>
                    <TableCell>{statutBadge(p.statut_periode)}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.effectif ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.nb ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums" style={{ color: "hsl(var(--success))" }}>{p.valides ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums" style={{ color: "hsl(var(--accent))" }}>{p.clotures ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium text-foreground">{fmt(p.net)}</TableCell>
                    <TableCell>
                      <div className="h-1.5 w-full rounded bg-muted overflow-hidden">
                        <div className="h-full transition-all" style={{ width: `${(p.net / netMax) * 100}%`, backgroundColor: couleur, opacity: pIdx === 0 ? 1 : 0.6 }} />
                      </div>
                    </TableCell>
                  </TableRow>
                ));
              })}
            </React.Fragment>
          );
        })}
        {periodesAgregees.length === 0 && (
          <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">Aucune période sur cette sélection.</TableCell></TableRow>
        )}
      </TableBody>
    </Table>
  );
}

/** Sélecteur multi-critères générique, réutilisé pour Plans / Catégorie / Contrat / Organisation. */
function MultiSelectFilter({
  items, value, onChange, allLabel, emptyLabel, emptyMeansAll, width = 220,
}: {
  items: Ref[];
  value: string[];
  onChange: (v: string[]) => void;
  allLabel: string;
  emptyLabel: string;
  emptyMeansAll: boolean;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const single = value.length === 1 ? items.find((i) => i.id === value[0]) : undefined;
  const resume = value.length === 0 ? emptyLabel
    : value.length === items.length ? allLabel
    : single ? `${single.code} · ${single.libelle}`
    : `${value.length} sélectionné(s)`;
  const allChecked = emptyMeansAll ? value.length === 0 : value.length === items.length;
  const toggleAll = () => onChange(emptyMeansAll ? (allChecked ? items.map((i) => i.id) : []) : (allChecked ? [] : items.map((i) => i.id)));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" style={{ width }} className="justify-between font-normal">
          <span className={`truncate ${value.length ? "" : "text-muted-foreground"}`} title={resume}>{resume}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent style={{ width }} className="p-0" align="start">
        <Command>
          <CommandList>
            <CommandGroup>
              <CommandItem onSelect={toggleAll}>
                <Checkbox checked={allChecked} className="mr-2 pointer-events-none" />
                {allLabel}
              </CommandItem>
              {items.map((i) => (
                <CommandItem key={i.id} value={i.code + " " + i.libelle} onSelect={() => toggle(i.id)}>
                  <Checkbox checked={value.includes(i.id)} className="mr-2 pointer-events-none" />
                  {i.code} · {i.libelle}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function Repartition({ titre, lignes }: { titre: string; lignes: { libelle: string; net: number; cout: number; nb: number }[] }) {
  const max = Math.max(1, ...lignes.map((l) => l.net));
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-sm font-semibold mb-2">{titre}</div>
        {lignes.length === 0 ? (
          <div className="text-sm text-muted-foreground">Aucune donnée.</div>
        ) : (
          <div className="space-y-1.5">
            {lignes.slice(0, 10).map((l) => (
              <div key={l.libelle} className="flex items-center gap-3 text-sm">
                <div className="w-40 shrink-0 truncate" title={l.libelle}>{l.libelle}</div>
                <div className="flex-1 h-2 rounded bg-muted overflow-hidden">
                  <div className="h-full bg-primary/70" style={{ width: `${(l.net / max) * 100}%` }} />
                </div>
                <div className="w-24 text-right tabular-nums font-medium">{fmt(l.net)}</div>
                <div className="w-8 text-right text-xs text-muted-foreground">{l.nb}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <Card className={`overflow-hidden ${accent ? "border-primary/40 bg-primary/5 shadow-sm" : ""}`}>
      <CardContent className="p-3">
        <div className="flex items-center gap-1 text-[10.5px] font-medium text-muted-foreground">
          <span className="shrink-0 [&>svg]:h-3 [&>svg]:w-3">{icon}</span>
          <span className="truncate">{label}</span>
        </div>
        <div className="mt-1 text-[15px] font-semibold tabular-nums leading-snug">{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{sub}</div>}
      </CardContent>
    </Card>
  );
}
