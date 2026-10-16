/**
 * VueEnsemblePaiePage — Vue d'ensemble annuelle de la paie.
 * Route suggérée : /paie/consultation/vue-ensemble
 *
 * Parti pris visuel : la paie est un registre. Le gros total s'anime comme
 * une caisse qui totalise ; le ruban des 12 mois se lit comme une ligne de
 * grand livre — une barre par mois, hauteur = masse nette versée.
 */
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Landmark, TrendingUp, TrendingDown, Users2, Building2, FileBadge2, Wallet, ChevronsUpDown, ChevronDown, ChevronRight, Search } from "lucide-react";
import { db } from "@/lib/api";
import { useChartPalette } from "@/hooks/useChartPalette";
import { synthesePaie, type SyntheseResult, type SynthesePeriode, type RepartitionLigne, type TopRubrique, type SyntheseAnnee } from "@/lib/paieApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";

const MOIS_ABR = ["", "Jan", "Fév", "Mar", "Avr", "Mai", "Jun", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"];
const fmt = (n?: number | null) => new Intl.NumberFormat("fr-MA", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n ?? 0);
const fmt2 = (n?: number | null) => new Intl.NumberFormat("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0);

type Plan = { id: string; code: string; libelle: string };
type Uo = { id: string; libelle: string; parent_id: string | null };

/** Aplatit l'arbre des UO en ordre hiérarchique (un parent est immédiatement
 * suivi de ses enfants, triés alphabétiquement à chaque niveau), avec une
 * profondeur par nœud pour l'indentation visuelle. */
function aplatirHierarchie(uos: Uo[]): (Uo & { profondeur: number })[] {
  const enfantsPar = new Map<string | null, Uo[]>();
  for (const u of uos) {
    const cle = u.parent_id;
    if (!enfantsPar.has(cle)) enfantsPar.set(cle, []);
    enfantsPar.get(cle)!.push(u);
  }
  for (const liste of enfantsPar.values()) liste.sort((a, b) => a.libelle.localeCompare(b.libelle));

  const racines = uos.filter((u) => !u.parent_id || !uos.some((x) => x.id === u.parent_id));
  racines.sort((a, b) => a.libelle.localeCompare(b.libelle));

  const resultat: (Uo & { profondeur: number })[] = [];
  const visites = new Set<string>();
  const parcourir = (u: Uo, profondeur: number) => {
    if (visites.has(u.id)) return; // garde-fou anti-cycle
    visites.add(u.id);
    resultat.push({ ...u, profondeur });
    for (const enfant of enfantsPar.get(u.id) ?? []) parcourir(enfant, profondeur + 1);
  };
  for (const r of racines) parcourir(r, 0);
  return resultat;
}
type Contrat = { code: string; libelle: string };

// ---- Compteur animé (façon caisse qui totalise) --------------------------
function useCompte(cible: number, duree = 1100) {
  const [valeur, setValeur] = useState(0);
  useEffect(() => {
    let raf: number;
    const t0 = performance.now();
    const anim = (t: number) => {
      const p = Math.min(1, (t - t0) / duree);
      const ease = 1 - Math.pow(1 - p, 3);
      setValeur(cible * ease);
      if (p < 1) raf = requestAnimationFrame(anim);
    };
    raf = requestAnimationFrame(anim);
    return () => cancelAnimationFrame(raf);
  }, [cible, duree]);
  return valeur;
}

function GrandTotal({ montant, libelle }: { montant: number; libelle: string }) {
  const v = useCompte(montant);
  return (
    <div>
      <div className="text-xs uppercase tracking-[0.2em] text-rose-100/70">{libelle}</div>
      <div className="mt-1 font-mono text-5xl md:text-6xl font-semibold tabular-nums text-white">
        {fmt(v)} <span className="text-2xl text-rose-200/80">DH</span>
      </div>
    </div>
  );
}

// ---- Ruban mensuel façon grand livre --------------------------------------
function RubanMensuel({ periodes, couleur = "#9f1239" }: { periodes: SynthesePeriode[]; couleur?: string }) {
  const max = Math.max(1, ...periodes.map((p) => p.net));
  return (
    <div className="flex items-end gap-2 md:gap-3 h-44 px-1">
      {periodes.map((p) => {
        const h = p.net > 0 ? Math.max(3, (p.net / max) * 100) : 2;
        const futur = p.nb === 0;
        return (
          <div key={p.mois} className="flex-1 flex flex-col items-center gap-2 group">
            <div className="w-full flex flex-col justify-end h-32">
              <div
                className={`w-full rounded-t-[3px] transition-all duration-300 ${futur ? "border border-dashed" : "shadow-sm"}`}
                style={futur
                  ? { height: `${h}%`, backgroundColor: `${couleur}1a`, borderColor: `${couleur}55` }
                  : { height: `${h}%`, background: `linear-gradient(to top, ${couleur}, ${couleur}cc)` }}
                title={`${MOIS_ABR[p.mois]} — ${fmt2(p.net)} DH · ${p.effectif} collaborateur(s)`}
              />
            </div>
            <span className="text-[10px] font-medium tracking-widest text-muted-foreground uppercase">{MOIS_ABR[p.mois]}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---- Ligne de répartition (barre de proportion façon poste de dépense) ---
function LigneRepartition({ ligne, total, couleur = "#9f1239" }: { ligne: RepartitionLigne; total: number; couleur?: string }) {
  const pct = total > 0 ? (ligne.net / total) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium truncate pr-2">{ligne.libelle}</span>
        <span className="font-mono tabular-nums text-muted-foreground shrink-0">{fmt(ligne.net)} DH · {ligne.nb}</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: `${couleur}1a` }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(2, pct)}%`, backgroundColor: couleur }} />
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-5 flex items-start gap-3">
        <div className="rounded-lg bg-rose-50 p-2 text-rose-800"><Icon className="h-4 w-4" /></div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-lg font-semibold font-mono tabular-nums truncate">{value}</div>
          {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Comparaison pluriannuelle : l'année en cours face à ses devancières -
function ComparaisonAnnees({ anneeCourante, netCourant, precedentes, couleur = "#9f1239" }: {
  anneeCourante: number; netCourant: number; precedentes: SyntheseAnnee[]; couleur?: string;
}) {
  const toutes = [
    { annee: anneeCourante, net: netCourant, courant: true },
    ...precedentes.map((p) => ({ annee: p.annee, net: p.net, courant: false })),
  ]
    .sort((a, b) => b.annee - a.annee)
    .slice(0, 5);
  const max = Math.max(1, ...toutes.map((a) => a.net));
  return (
    <div className="space-y-2.5">
      {toutes.map((a) => (
        <div key={a.annee} className="flex items-center gap-3">
          <span className="w-12 text-sm font-mono tabular-nums shrink-0" style={{ color: a.courant ? couleur : undefined, fontWeight: a.courant ? 700 : 400 }}>
            {a.annee}
          </span>
          <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ backgroundColor: `${couleur}14` }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.max(2, (a.net / max) * 100)}%`, backgroundColor: couleur, opacity: a.courant ? 1 : 0.45 }}
            />
          </div>
          <span className="w-28 text-right text-xs font-mono tabular-nums text-muted-foreground shrink-0">{fmt(a.net)} DH</span>
        </div>
      ))}
      {toutes.length <= 1 && <p className="text-sm text-muted-foreground">Pas encore d'historique pluriannuel.</p>}
    </div>
  );
}

// ---- Sélecteur multi-choix générique à cases à cocher (plans, UO, contrats…) --
function SelecteurMulti({ items, value, onChange, labelTout, largeur = 220, note }: {
  items: { id: string; libelle: string; profondeur?: number }[]; value: string[]; onChange: (v: string[]) => void;
  labelTout: string; largeur?: number; note?: string;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const toutCoche = value.length === 0;
  const resume =
    toutCoche ? labelTout
    : value.length === 1 ? items.find((p) => p.id === value[0])?.libelle ?? "1 sélectionné"
    : `${value.length} sélectionnés`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" style={{ width: largeur }} className="justify-between font-normal">
          <span className={toutCoche ? "text-muted-foreground truncate" : "truncate"}>{resume}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent style={{ width: largeur }} className="p-0" align="end">
        <Command filter={(v, s) => (v.toLowerCase().includes(s.toLowerCase()) ? 1 : 0)}>
          <CommandList className="max-h-72">
            <CommandGroup>
              <CommandItem onSelect={() => onChange([])}>
                <Checkbox checked={toutCoche} className="mr-2 pointer-events-none" />
                {labelTout}
              </CommandItem>
              {items.map((p) => (
                <CommandItem key={p.id} value={p.libelle} onSelect={() => toggle(p.id)}>
                  <span style={{ width: (p.profondeur ?? 0) * 14 }} className="shrink-0" />
                  {(p.profondeur ?? 0) > 0 && <span className="text-muted-foreground mr-1 shrink-0">└</span>}
                  <Checkbox checked={value.includes(p.id)} className="mr-2 pointer-events-none shrink-0" />
                  <span className="truncate">{p.libelle}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {note && <div className="px-3 py-2 text-[11px] text-muted-foreground border-t">{note}</div>}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---- Sélecteur de plans à cases à cocher (un ou plusieurs à la fois) -----
function SelecteurPlans({ plans, value, onChange }: { plans: Plan[]; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const toutCoche = value.length === plans.length && plans.length > 0;
  const toggleTout = () => onChange(toutCoche ? [] : plans.map((p) => p.id));
  const resume =
    value.length === 0 ? "Aucun plan"
    : toutCoche ? "Tous les plans"
    : value.length === 1 ? plans.find((p) => p.id === value[0])?.code ?? "1 plan"
    : `${value.length} plans sélectionnés`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-[240px] justify-between font-normal">
          <span className={value.length ? "" : "text-muted-foreground"}>{resume}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-0" align="end">
        <Command>
          <CommandList>
            <CommandGroup>
              <CommandItem onSelect={toggleTout}>
                <Checkbox checked={toutCoche} className="mr-2 pointer-events-none" />
                Tous les plans
              </CommandItem>
              {plans.map((p) => (
                <CommandItem key={p.id} value={p.code + " " + p.libelle} onSelect={() => toggle(p.id)}>
                  <Checkbox checked={value.includes(p.id)} className="mr-2 pointer-events-none" />
                  {p.code} · {p.libelle}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Pavé accordéon générique — pour rendre les sections repliables. */
function Accordeon({ titre, icone: Icone, defautOuvert = true, children }: {
  titre: React.ReactNode; icone?: any; defautOuvert?: boolean; children: React.ReactNode;
}) {
  const [ouvert, setOuvert] = useState(defautOuvert);
  return (
    <Card className="overflow-hidden">
      <button onClick={() => setOuvert((o) => !o)} className="w-full flex items-center gap-2 px-6 py-4 hover:bg-muted/30 transition-colors text-left">
        {ouvert ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
        {Icone && <Icone className="h-4 w-4 shrink-0" />}
        <span className="text-base font-semibold flex-1">{titre}</span>
      </button>
      {ouvert && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
  );
}

export default function VueEnsemblePaiePage() {
  const palette = useChartPalette(4);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planIds, setPlanIds] = useState<string[]>([]);
  const [uos, setUos] = useState<Uo[]>([]);
  const [uoIds, setUoIds] = useState<string[]>([]);
  const [contrats, setContrats] = useState<Contrat[]>([]);
  const [contratCodes, setContratCodes] = useState<string[]>([]);
  const [rechercheRubrique, setRechercheRubrique] = useState("");
  const [annee, setAnnee] = useState<number>(new Date().getFullYear());
  const [synthese, setSynthese] = useState<SyntheseResult | null>(null);
  const [chargement, setChargement] = useState(false);

  useEffect(() => {
    db.list<Plan>("plan_paie", { select: "id,code,libelle", actif: true, limit: 200 })
      .then((rows) => { setPlans(rows); setPlanIds((a) => (a.length ? a : rows.map((p) => p.id))); })
      .catch((e) => toast.error("Chargement des plans impossible", { description: e.message }));
    // `unites_organisationnelles` est la table à jour (l'ancienne `organisations`
    // n'est plus alimentée — cf. rep_org côté backend).
    db.list<Uo>("unites_organisationnelles", { select: "id,libelle,parent_id", actif: true, order: "libelle", limit: 500 })
      .then(setUos)
      .catch((e) => toast.error("Chargement des UO impossible", { description: e.message }));
    db.list<Contrat>("ref_type_contrat", { select: "code,libelle", order: "libelle", limit: 200 })
      .then(setContrats)
      .catch((e) => toast.error("Chargement des types de contrat impossible", { description: e.message }));
  }, []);

  useEffect(() => {
    if (!planIds.length) { setSynthese(null); return; }
    setChargement(true);
    // officiel=true : écran de CONSULTATION → validés/clôturés uniquement,
    // jamais les précalculs (bulletin_temp) encore modifiables.
    synthesePaie(planIds, annee, { organisation_ids: uoIds, types_contrat: contratCodes }, true)
      .then(setSynthese)
      .catch((e) => toast.error("Synthèse indisponible", { description: e.message }))
      .finally(() => setChargement(false));
  }, [planIds, annee, uoIds, contratCodes]);

  const uosHierarchises = useMemo(() => aplatirHierarchie(uos), [uos]);

  const anneesDispo = useMemo(() => {
    const courante = new Date().getFullYear();
    return Array.from({ length: 6 }, (_, i) => courante - i);
  }, []);

  const totaux = synthese?.totaux;
  const evolution = useMemo(() => {
    if (!synthese) return null;
    const prec = synthese.precedentes.find((p) => p.annee === annee - 1);
    if (!prec || !prec.net) return null;
    return ((synthese.totaux.net - prec.net) / prec.net) * 100;
  }, [synthese, annee]);

  return (
    <div className="p-6 space-y-6 max-w-[1500px] mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Vue d'ensemble de la paie</h1>
          <p className="text-sm text-muted-foreground mt-1">Registre annuel — masse salariale, répartitions, tendances. Bulletins validés et clôturés uniquement.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <SelecteurPlans plans={plans} value={planIds} onChange={setPlanIds} />
          <SelecteurMulti items={uosHierarchises} value={uoIds} onChange={setUoIds} labelTout="Toutes organisations" largeur={220} note="Cocher une UO inclut ses sous-unités." />
          <SelecteurMulti items={contrats.map((c) => ({ id: c.code, libelle: c.libelle }))} value={contratCodes} onChange={setContratCodes} labelTout="Tous contrats" largeur={200} />
          <Select value={String(annee)} onValueChange={(v) => setAnnee(Number(v))}>
            <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
            <SelectContent>{anneesDispo.map((a) => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {!planIds.length && (
        <Card><CardContent className="py-16 text-center text-sm text-muted-foreground">Sélectionnez au moins un plan de paie.</CardContent></Card>
      )}

      {chargement && !synthese && (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full rounded-xl" />
          <div className="grid gap-4 md:grid-cols-4"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
        </div>
      )}

      {synthese && totaux && (
        <>
          {/* Bandeau — le total qui se compte */}
          <div className="rounded-2xl bg-gradient-to-br from-rose-950 via-rose-900 to-rose-800 px-8 py-8 relative overflow-hidden">
            <div className="absolute inset-0 opacity-[0.06] pointer-events-none" style={{
              backgroundImage: "repeating-linear-gradient(0deg, #fff 0, #fff 1px, transparent 1px, transparent 28px)",
            }} />
            <div className="relative flex flex-wrap items-end justify-between gap-6">
              <GrandTotal montant={totaux.net} libelle={`Net versé — ${annee}`} />
              {evolution !== null && (
                <div className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ${evolution >= 0 ? "bg-emerald-500/20 text-emerald-200" : "bg-rose-500/20 text-rose-200"}`}>
                  {evolution >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                  {evolution >= 0 ? "+" : ""}{evolution.toFixed(1)}% vs {annee - 1}
                </div>
              )}
            </div>
            <div className="relative mt-6 flex flex-wrap gap-x-8 gap-y-2 text-rose-100/80 text-sm font-mono tabular-nums">
              <span>Brut : {fmt(totaux.brut)} DH</span>
              <span>Cotisations : {fmt(totaux.cotisations)} DH</span>
              <span>Coût employeur : {fmt(totaux.cout)} DH</span>
              <span>Effectif : {totaux.effectif}</span>
            </div>
          </div>

          {/* Ruban mensuel */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Masse nette par mois</CardTitle></CardHeader>
            <CardContent><RubanMensuel periodes={synthese.periodes} couleur={palette[0]} /></CardContent>
          </Card>

          {/* Comparaison pluriannuelle */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Comparaison sur 5 ans</CardTitle></CardHeader>
            <CardContent>
              <ComparaisonAnnees anneeCourante={annee} netCourant={totaux.net} precedentes={synthese.precedentes} couleur={palette[0]} />
            </CardContent>
          </Card>

          {/* Stats clés */}
          <div className="grid gap-4 md:grid-cols-4">
            <Stat icon={Wallet} label="Net moyen / collaborateur" value={`${fmt(totaux.net_moyen)} DH`} />
            <Stat icon={Landmark} label="Taux de charges" value={`${totaux.taux_charges.toFixed(1)}%`} sub="cotisations / brut" />
            <Stat icon={FileBadge2} label="Bulletins validés" value={`${totaux.valides + totaux.clotures}/${totaux.effectif}`} sub={`${Math.max(0, totaux.effectif - totaux.valides - totaux.clotures)} sans bulletin validé`} />
            <Stat icon={Users2} label="En anomalie" value={String(totaux.en_erreur)} sub={`${totaux.avec_avertissement} avertissement(s)`} />
          </div>

          {/* Répartitions */}
          <div className="grid gap-4 md:grid-cols-2">
            <Accordeon titre="Par organisation" icone={Building2}>
              <div className="space-y-3">
                {synthese.repartition_organisation.slice(0, 8).map((l) => (
                  <LigneRepartition key={l.libelle} ligne={l} total={totaux.net} couleur={palette[0]} />
                ))}
                {synthese.repartition_organisation.length === 0 && <p className="text-sm text-muted-foreground">Aucune donnée.</p>}
              </div>
            </Accordeon>
            <Accordeon titre="Par type de contrat" icone={FileBadge2}>
              <div className="space-y-3">
                {synthese.repartition_contrat.slice(0, 8).map((l) => (
                  <LigneRepartition key={l.libelle} ligne={l} total={totaux.net} couleur={palette[1]} />
                ))}
                {synthese.repartition_contrat.length === 0 && <p className="text-sm text-muted-foreground">Aucune donnée.</p>}
              </div>
            </Accordeon>
          </div>

          {/* Rubriques les plus significatives — recherche + barre de proportion */}
          <Accordeon titre="Rubriques les plus significatives">
            {(() => {
              const filtrees = synthese.top_rubriques.filter((r) =>
                !rechercheRubrique.trim() ||
                r.libelle.toLowerCase().includes(rechercheRubrique.toLowerCase()) ||
                r.code.toLowerCase().includes(rechercheRubrique.toLowerCase())
              );
              const maxRub = Math.max(1, ...synthese.top_rubriques.map((r) => r.total));
              return (
                <div className="-mt-2 space-y-3">
                  <div className="relative max-w-xs">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      value={rechercheRubrique}
                      onChange={(e) => setRechercheRubrique(e.target.value)}
                      placeholder="Rechercher une rubrique…"
                      className="pl-8 h-8 text-sm"
                    />
                  </div>
                  <div className="divide-y font-mono text-sm -mx-6">
                    {filtrees.map((r: TopRubrique, i) => (
                      <div key={r.code} className="px-6 py-2.5 hover:bg-rose-50/50">
                        <div className="flex items-center justify-between gap-3 mb-1">
                          <span className="flex items-center gap-3 min-w-0">
                            <span className="text-muted-foreground w-6 text-right tabular-nums shrink-0">{i + 1}</span>
                            <span className="truncate">{r.libelle}</span>
                            <Badge variant="secondary" className="font-sans text-[10px] shrink-0">{r.code}</Badge>
                          </span>
                          <span className="tabular-nums shrink-0">{fmt(r.total)} DH</span>
                        </div>
                        <div className="h-1 rounded-full bg-rose-100 overflow-hidden ml-9">
                          <div className="h-full rounded-full" style={{ width: `${Math.max(2, (r.total / maxRub) * 100)}%`, backgroundColor: palette[0], opacity: 0.7 }} />
                        </div>
                      </div>
                    ))}
                    {filtrees.length === 0 && <p className="text-sm text-muted-foreground font-sans py-4 text-center">Aucune rubrique ne correspond à « {rechercheRubrique} ».</p>}
                  </div>
                </div>
              );
            })()}
          </Accordeon>
        </>
      )}
    </div>
  );
}
