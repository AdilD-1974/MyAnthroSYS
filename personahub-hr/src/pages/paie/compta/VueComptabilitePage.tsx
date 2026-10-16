/**
 * VueComptabilitePage — Vue d'ensemble de la comptabilité de paie (tableau de bord).
 *
 * Route : /paie/compta/vue (admin, gestionnaire_paie).
 *
 * Synthèse des lots d'écritures comptables générés (tous plans/périodes
 * confondus par défaut) : avancement par statut (brouillon → généré →
 * exporté → comptabilisé), masses débit/crédit, écarts de contrôle, et
 * détail filtrable par plan de paie / année / statut — sur le même modèle
 * que VueTraitementPage.tsx (paie).
 *
 * ⚠️ Branché sur comptaApi.ts (04/08), pas comptaPaieApi.ts (retiré — écrit
 * sur la spec, incompatible avec le backend réel). comptaApi.listerLots()
 * fait la jointure plan_paie/calendrier_paie côté JS, ces libellés n'existant
 * pas directement sur lot_ecriture_paie (plan_paie_id/periode_id seulement).
 *
 * Style : composants shadcn/ui + couleurs exclusivement via variables CSS
 * de thème (hsl(var(--…))), harmonisé avec GenerationEcrituresPage.tsx et
 * ExportComptaPage.tsx.
 */
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Wallet, Scale, Layers, AlertTriangle, CheckCircle2, FileSpreadsheet,
  ChevronsUpDown, RotateCcw, Filter, Download, ArrowRight, Eye, Trash2,
} from "lucide-react";
import { comptaApi, type LotAvecLibelles } from "@/lib/comptaApi";
import EcrituresDetailDialog from "@/components/paie/compta/EcrituresDetailDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";

const fmtMontant = (n?: number | null) =>
  new Intl.NumberFormat("fr-MA", { style: "currency", currency: "MAD", maximumFractionDigits: 0 }).format(n ?? 0);

const STATUTS = ["BROUILLON", "GENERE", "EXPORTE", "COMPTABILISE"] as const;

function statutTone(statut: string) {
  switch (statut) {
    case "GENERE": return "--warning";
    case "EXPORTE": return "--info";
    case "COMPTABILISE": return "--success";
    default: return "--muted-foreground";
  }
}

function statutLabel(statut: string) {
  switch (statut) {
    case "BROUILLON": return "Brouillon";
    case "GENERE": return "Généré";
    case "EXPORTE": return "Exporté";
    case "COMPTABILISE": return "Comptabilisé";
    default: return statut;
  }
}

function StatutBadge({ statut }: { statut: string }) {
  const tone = statutTone(statut);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: `hsl(var(${tone}) / 0.1)`, color: `hsl(var(${tone}))`, boxShadow: `inset 0 0 0 1px hsl(var(${tone}) / 0.25)` }}
    >
      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: `hsl(var(${tone}))` }} />
      {statutLabel(statut)}
    </span>
  );
}

function Stat({
  icon, label, value, sub, tone, accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "--success" | "--warning" | "--destructive" | "--info" | "--accent" | "--muted-foreground";
  accent?: boolean;
}) {
  return (
    <Card className={accent ? "border-primary/40 bg-primary/5 shadow-sm" : ""}>
      <CardContent className="p-3">
        <div className="flex items-center gap-1 text-[10.5px] font-medium text-muted-foreground">
          <span className="shrink-0 [&>svg]:h-3 [&>svg]:w-3">{icon}</span>
          <span className="truncate">{label}</span>
        </div>
        <div className="mt-1 text-[15px] font-semibold tabular-nums leading-snug" style={tone ? { color: `hsl(var(${tone}))` } : undefined}>
          {value}
        </div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{sub}</div>}
      </CardContent>
    </Card>
  );
}

/** Sélecteur multi-critères générique (repris de VueTraitementPage.tsx). */
function MultiSelectFilter({
  items, value, onChange, allLabel, emptyLabel, emptyMeansAll, width = 200,
}: {
  items: { id: string; label: string }[];
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
    : single ? single.label
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
                <CommandItem key={i.id} value={i.label} onSelect={() => toggle(i.id)}>
                  <Checkbox checked={value.includes(i.id)} className="mr-2 pointer-events-none" />
                  {i.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function VueComptabilitePage() {
  const navigate = useNavigate();

  const [lots, setLots] = useState<LotAvecLibelles[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLotId, setDetailLotId] = useState<string | null>(null);
  const [suppressionEnCours, setSuppressionEnCours] = useState<string | null>(null);

  // Filtres
  const [planIds, setPlanIds] = useState<string[]>([]);
  const [annees, setAnnees] = useState<string[]>([]);
  const [statuts, setStatuts] = useState<string[]>([]);

  useEffect(() => {
    setLoading(true);
    comptaApi.listerLots()
      .then(setLots)
      .catch((e: any) => toast.error("Chargement impossible", { description: e.message }))
      .finally(() => setLoading(false));
  }, []);

  // Référentiels dérivés des lots chargés (plans / années présents dans les données)
  const plansDisponibles = useMemo(() => {
    const map = new Map<string, string>();
    lots.forEach((l) => map.set(l.plan_paie_id, l.plan_paie_code));
    return Array.from(map, ([id, label]) => ({ id, label }));
  }, [lots]);

  const anneesDisponibles = useMemo(
    () => Array.from(new Set(lots.filter((l) => l.annee != null).map((l) => String(l.annee)))).sort((a, b) => Number(b) - Number(a)),
    [lots]
  );

  const lotsFiltres = useMemo(() => lots.filter((l) => {
    if (planIds.length && !planIds.includes(l.plan_paie_id)) return false;
    if (annees.length && !annees.includes(String(l.annee))) return false;
    if (statuts.length && !statuts.includes(l.statut)) return false;
    return true;
  }), [lots, planIds, annees, statuts]);

  const nbFiltresActifs = planIds.length + annees.length + statuts.length;
  const resetFiltres = () => { setPlanIds([]); setAnnees([]); setStatuts([]); };

  // Réservé aux lots BROUILLON (le backend refuse aussi pour tout autre
  // statut, cf. supprimer_lot() dans compta_paie.py — double protection).
  async function supprimerLot(l: LotAvecLibelles) {
    if (l.statut !== "BROUILLON") return;
    const label = `${l.plan_paie_code} — ${l.annee ?? "?"}${l.numero_periode ? `/${String(l.numero_periode).padStart(2, "0")}` : ""}`;
    if (!window.confirm(`Supprimer le lot brouillon ${label} ? Cette action est irréversible.`)) return;
    setSuppressionEnCours(l.id);
    try {
      await comptaApi.supprimerLot(l.id);
      setLots((prev) => prev.filter((x) => x.id !== l.id));
      toast.success("Lot supprimé", { description: label });
    } catch (e: any) {
      toast.error("Suppression impossible", { description: e.message });
    } finally {
      setSuppressionEnCours(null);
    }
  }

  // KPI globaux (sur la sélection filtrée)
  const totaux = useMemo(() => {
    const parStatut: Record<string, number> = { BROUILLON: 0, GENERE: 0, EXPORTE: 0, COMPTABILISE: 0 };
    let debit = 0, credit = 0, ecarts = 0;
    lotsFiltres.forEach((l) => {
      parStatut[l.statut] = (parStatut[l.statut] ?? 0) + 1;
      debit += l.total_debit ?? 0;
      credit += l.total_credit ?? 0;
      if (l.controle_ok === false) ecarts += 1;
    });
    return { parStatut, debit, credit, ecarts, total: lotsFiltres.length };
  }, [lotsFiltres]);

  const equilibre = Math.abs(totaux.debit - totaux.credit) < 0.01;

  return (
    <div className="px-6 py-4 space-y-3 w-full">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Vue d'ensemble de la comptabilité</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Synthèse des lots d'écritures comptables générés depuis la paie, tous plans et périodes confondus.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate("/paie/compta/generation")}>
            <FileSpreadsheet className="h-3.5 w-3.5" /> Générer des écritures
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate("/paie/compta/export")}>
            <Download className="h-3.5 w-3.5" /> Export comptable
          </Button>
        </div>
      </div>

      {/* Barre de filtres */}
      <Card>
        <CardContent className="py-3 px-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mr-1">
              <Filter className="h-3.5 w-3.5" /> Filtres
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Plan de paie</label>
              <MultiSelectFilter items={plansDisponibles} value={planIds} onChange={setPlanIds} allLabel="Tous les plans" emptyLabel="Tous les plans" emptyMeansAll width={200} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Année</label>
              <MultiSelectFilter
                items={anneesDisponibles.map((a) => ({ id: a, label: a }))}
                value={annees} onChange={setAnnees} allLabel="Toutes les années" emptyLabel="Toutes les années" emptyMeansAll width={160}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Statut</label>
              <MultiSelectFilter
                items={STATUTS.map((s) => ({ id: s, label: statutLabel(s) }))}
                value={statuts} onChange={setStatuts} allLabel="Tous les statuts" emptyLabel="Tous les statuts" emptyMeansAll width={180}
              />
            </div>
            {nbFiltresActifs > 0 && (
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={resetFiltres}>
                <RotateCcw className="h-3.5 w-3.5" /> Réinitialiser
              </Button>
            )}
          </div>
          {nbFiltresActifs > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {planIds.map((id) => (
                <Badge key={id} variant="secondary" className="gap-1">
                  {plansDisponibles.find((p) => p.id === id)?.label}
                  <button onClick={() => setPlanIds((v) => v.filter((x) => x !== id))} className="ml-0.5">×</button>
                </Badge>
              ))}
              {annees.map((a) => (
                <Badge key={a} variant="secondary" className="gap-1">
                  {a}
                  <button onClick={() => setAnnees((v) => v.filter((x) => x !== a))} className="ml-0.5">×</button>
                </Badge>
              ))}
              {statuts.map((s) => (
                <Badge key={s} variant="secondary" className="gap-1">
                  {statutLabel(s)}
                  <button onClick={() => setStatuts((v) => v.filter((x) => x !== s))} className="ml-0.5">×</button>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : lots.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-12 border border-dashed rounded-lg">
          Aucun lot d'écritures pour le moment.{" "}
          <button onClick={() => navigate("/paie/compta/generation")} className="text-accent font-semibold underline hover:no-underline">
            Générer des écritures
          </button>
        </div>
      ) : (
        <>
          {/* KPI globaux */}
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-4 xl:grid-cols-7">
            <Stat icon={<Layers className="h-4 w-4" />} label="Lots (sélection)" value={String(totaux.total)} accent />
            <Stat icon={<Layers className="h-4 w-4" />} label="Brouillons" value={String(totaux.parStatut.BROUILLON)} tone="--muted-foreground" />
            <Stat icon={<Layers className="h-4 w-4" />} label="Générés" value={String(totaux.parStatut.GENERE)} tone="--warning" />
            <Stat icon={<Layers className="h-4 w-4" />} label="Exportés" value={String(totaux.parStatut.EXPORTE)} tone="--info" />
            <Stat icon={<Layers className="h-4 w-4" />} label="Comptabilisés" value={String(totaux.parStatut.COMPTABILISE)} tone="--success" />
            <Stat icon={<Wallet className="h-4 w-4" />} label="Total débit" value={fmtMontant(totaux.debit)} tone="--info" />
            <Stat icon={<Wallet className="h-4 w-4" />} label="Total crédit" value={fmtMontant(totaux.credit)} tone="--accent" />
          </div>

          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
            <Stat
              icon={<Scale className="h-4 w-4" />} label="Équilibre débit / crédit"
              value={equilibre ? "Équilibré" : `Écart de ${fmtMontant(Math.abs(totaux.debit - totaux.credit))}`}
              tone={equilibre ? "--success" : "--destructive"}
            />
            <Stat
              icon={<AlertTriangle className="h-4 w-4" />} label="Lots générés avec forçage"
              value={String(totaux.ecarts)} tone={totaux.ecarts > 0 ? "--warning" : "--success"}
              sub={totaux.ecarts > 0 ? "contrôle d'effectif en écart" : "aucun écart"}
            />
            <Stat
              icon={<CheckCircle2 className="h-4 w-4" />} label="Taux de traitement"
              value={totaux.total > 0 ? `${Math.round(((totaux.parStatut.EXPORTE + totaux.parStatut.COMPTABILISE) / totaux.total) * 100)}%` : "—"}
              tone="--info"
              sub="exportés ou comptabilisés"
            />
          </div>

          {/* Détail des lots */}
          <Card>
            <CardContent className="p-0">
              <Table className="text-sm [&_td]:py-1.5 [&_th]:py-2">
                <TableHeader>
                  <TableRow>
                    <TableHead>Plan</TableHead>
                    <TableHead>Période</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead className="text-right">Débit</TableHead>
                    <TableHead className="text-right">Crédit</TableHead>
                    <TableHead className="text-right">Lignes exclues</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lotsFiltres
                    .slice()
                    .sort((a, b) => (b.annee ?? 0) - (a.annee ?? 0) || (b.numero_periode ?? 0) - (a.numero_periode ?? 0))
                    .map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="font-medium">{l.plan_paie_code}</TableCell>
                        <TableCell>
                          {l.annee ?? "?"}{l.numero_periode ? `/${String(l.numero_periode).padStart(2, "0")}` : ""}
                          {l.periode_intitule && <span className="text-muted-foreground"> — {l.periode_intitule}</span>}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{l.mode_generation === "GLOBAL" ? "Global" : "Nominatif"}</TableCell>
                        <TableCell><StatutBadge statut={l.statut} /></TableCell>
                        <TableCell className="text-right tabular-nums">{fmtMontant(l.total_debit)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtMontant(l.total_credit)}</TableCell>
                        <TableCell className="text-right tabular-nums" style={l.nb_lignes_exclues > 0 ? { color: `hsl(var(--warning))` } : undefined}>
                          {l.nb_lignes_exclues ?? 0}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7"
                              onClick={() => setDetailLotId(l.id)}
                              title="Voir le détail des écritures"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7"
                              onClick={() => navigate("/paie/compta/export", { state: { lotId: l.id } })}
                              title="Aller à l'export"
                            >
                              <ArrowRight className="h-3.5 w-3.5" />
                            </Button>
                            {l.statut === "BROUILLON" && (
                              <Button
                                variant="ghost" size="icon" className="h-7 w-7"
                                onClick={() => supprimerLot(l)}
                                disabled={suppressionEnCours === l.id}
                                title="Supprimer ce lot brouillon"
                                style={{ color: `hsl(var(--destructive))` }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  {lotsFiltres.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">Aucun lot sur cette sélection.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      <EcrituresDetailDialog
        lotId={detailLotId}
        lotLabel={(() => {
          const l = lots.find((x) => x.id === detailLotId);
          return l ? `${l.plan_paie_code} — ${l.annee ?? "?"}${l.numero_periode ? `/${String(l.numero_periode).padStart(2, "0")}` : ""}` : undefined;
        })()}
        modeGeneration={lots.find((x) => x.id === detailLotId)?.mode_generation}
        numeroGeneration={lots.find((x) => x.id === detailLotId)?.numero_generation}
        onOpenChange={(open) => { if (!open) setDetailLotId(null); }}
      />
    </div>
  );
}
