/**
 * TraitementPaiePage — Exécution & consultation de la paie d'un collaborateur.
 * Auteur : Adil DAIA
 *
 * Route : /paie/traitement/calcul
 * - Sélection collaborateur + période
 * - Calculer (simulation), Calculer et enregistrer (persiste bulletin/lignes/cumuls)
 * - Consulter le bulletin enregistré
 * - Onglets : Bulletin (lignes groupées + totaux) / Trace de calcul (pas à pas)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import {
  Calculator, Save, FileText, ListTree, AlertTriangle, RefreshCw, Check,
  ChevronsUpDown, Loader2, Wallet, TrendingUp, TrendingDown, Building2, Trash2,
  ChevronUp, ChevronDown, ChevronRight, Minus, Columns3, FileSpreadsheet,
} from "lucide-react";
import * as XLSX from "xlsx";
import { db } from "@/lib/api";
import {
  calculerBulletin, listerBulletins, bulletinToResult, supprimerBulletin,
  type CalculBulletinResult, type LigneBulletin, type TraceEtape,
} from "@/lib/paieApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { buildTrail } from "@/components/navigation/ReturnTrail";
import { useFormatMasks } from "@/hooks/useFormatMasks";
import CyclePaie from "./CyclePaie";

// ---- Types locaux -------------------------------------------------------
type Collab = { id: string; matricule: string; nom: string; prenom: string };
type Periode = { id: string; annee: number; mois: number; plan_paie_id: string | null; statut: string; numero_periode: number; date_ouverture?: string | null };

// Une période est OUVERTE (effective) si non clôturée et sa date d'ouverture est atteinte.
const _todayISO = () => new Date().toISOString().slice(0, 10);
const periodeEstOuverte = (p: Periode, today = _todayISO()) =>
  p.statut !== "CLOTUREE" && (!p.date_ouverture || p.date_ouverture <= today);
// Première période ouverte (non traitée), en ordre chronologique ascendant.
const premiereOuverte = (arr: Periode[]): Periode | undefined => {
  const asc = [...arr].sort((a, b) => a.annee - b.annee || a.mois - b.mois);
  return asc.find(periodeEstOuverte) || asc[0];
};
type Plan = { id: string; code: string; libelle: string };

const MOIS = ["", "Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];
const SEL_KEY = "paie.traitement.selection";

// RG-BULLETIN-COL-RESIZE-01 (Adil DAIA) : colonnes redimensionnables à la
// souris, largeurs mémorisées par onglet (session courante). Ordre = ordre
// d'affichage des colonnes du tableau ; "detail" = colonne icône calculatrice.
const COLWIDTHS_KEY = "paie.traitement.colwidths";
const DEFAULT_COL_WIDTHS: Record<string, number> = {
  rubrique: 260, type: 95, base: 95, nombre: 70, taux: 70,
  montant: 110, patronal: 100, date: 100, texte: 120, observation: 200, detail: 44,
};
const COL_ORDER = ["rubrique", "type", "base", "nombre", "taux", "montant", "patronal", "date", "texte", "observation", "detail"];
const MIN_COL_WIDTH = 40;

// ---- Catégorisation des lignes -----------------------------------------
type Groupe = "gains" | "cotisations" | "retenues" | "elements" | "totaux";
const GROUPES: { key: Groupe; label: string }[] = [
  { key: "gains", label: "Gains" },
  { key: "cotisations", label: "Cotisations" },
  { key: "retenues", label: "Retenues" },
  { key: "elements", label: "Éléments & bases" },
  { key: "totaux", label: "Assiettes & totaux" },
];
function categoriser(l: LigneBulletin): Groupe {
  if (l.code_type === "ASS") return "totaux";
  if (l.est_cotisation) return "cotisations";
  if (l.sens === "GAIN") return "gains";
  if (l.sens === "RETENUE") return "retenues";
  return "elements";
}

// Périodicité (Périodique / Cumul / Glissant) — couleurs dérivées du thème
// (var(--muted)/--accent/--warning), pas de palette Tailwind figée, pour
// respecter les préférences d'apparence de chaque utilisateur.
const PERIODICITE: Record<string, { label: string; style: React.CSSProperties }> = {
  PERIODIQUE: { label: "Périodique", style: { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" } },
  CUMUL: { label: "Cumul", style: { background: "hsl(var(--accent) / 0.15)", color: "hsl(var(--accent))" } },
  GLISSANT: { label: "Glissant", style: { background: "hsl(var(--warning) / 0.15)", color: "hsl(var(--warning))" } },
};

// Badge du TYPE DE LIGNE (une rubrique cumulée produit une ligne Période + une ligne Cumul)
const TYPE_LIGNE = {
  PERIODE: { label: "Période", style: { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" } },
  CUMUL: { label: "Cumul", style: { background: "hsl(var(--accent) / 0.15)", color: "hsl(var(--accent))" } },
};
// Une rubrique produit une ligne Cumul dès qu'une fréquence de RAZ « cumulante »
// est définie (annuelle / semestrielle / trimestrielle). Mensuelle / périodique
// remettent à zéro chaque période → pas de cumul distinct.
const RAZ_CUMUL = new Set(["ANNUELLE", "SEMESTRIELLE", "TRIMESTRIELLE"]);
const estCumulee = (l: LigneBulletin) => !!l.frequence_raz && RAZ_CUMUL.has(l.frequence_raz);

function sortLignes(arr: LigneBulletin[], sort: { col: string; dir: "asc" | "desc" } | null): LigneBulletin[] {
  // RG-BULLETIN-ORDRE-CALCUL-01 (Adil DAIA) : tri par défaut sur l'ordre de
  // calcul de la rubrique (rubrique_paie.ordre_calcul — même valeur que la
  // colonne "Ordre" de RubriquesList.tsx), pas l'ordre d'affichage générique.
  // Repli sur ordre_affichage si ordre_calcul n'est pas présent sur la ligne
  // (API pas encore mise à jour pour l'exposer sur le bulletin).
  if (!sort) {
    return [...arr].sort((a, b) => {
      const oa = (a as any).ordre_calcul ?? a.ordre_affichage;
      const ob = (b as any).ordre_calcul ?? b.ordre_affichage;
      return oa - ob;
    });
  }
  const dir = sort.dir === "asc" ? 1 : -1;
  const num = (v: unknown): number => {
    if (v === null || v === undefined || v === "") return -Infinity;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isNaN(n) ? -Infinity : n;
  };
  const val = (l: LigneBulletin): string | number => {
    switch (sort.col) {
      case "rubrique": return (l.libelle || "").toLowerCase();
      case "type": return l.type_periodicite || "";
      case "base": return num(l.base);
      case "nombre": return num(l.nombre);
      case "taux": return num(l.taux);
      case "montant": return num(l.montant);
      case "patronal": return num(l.montant_patronal);
      case "date": return l.date_valeur || "";
      case "texte": return (l.texte || "").toLowerCase();
      case "observation": return (l.observation || "").toLowerCase();
      default: return 0;
    }
  };
  return [...arr].sort((a, b) => {
    const va = val(a), vb = val(b);
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return 0;
  });
}

function ColResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <span
      onMouseDown={onMouseDown}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      title="Glisser pour redimensionner"
      className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize select-none touch-none hover:bg-accent/60 active:bg-accent"
      style={{ transform: "translateX(50%)" }}
    />
  );
}

function SortHead({ label, col, sort, onSort, align = "left", className = "", width, onResizeStart }: {
  label: string; col: string; sort: { col: string; dir: "asc" | "desc" } | null;
  onSort: (c: string) => void; align?: "left" | "right"; className?: string;
  width?: number; onResizeStart?: (e: React.MouseEvent) => void;
}) {
  const active = sort?.col === col;
  return (
    <TableHead
      className={`relative overflow-hidden text-center ${className}`}
      style={width ? { width, minWidth: width, maxWidth: width } : undefined}
    >
      <button
        onClick={() => onSort(col)}
        className={`inline-flex items-center justify-center gap-1 hover:text-foreground max-w-full truncate mx-auto ${active ? "text-foreground font-medium" : ""}`}
      >
        {label}
        {active ? (
          sort!.dir === "asc" ? <ChevronUp className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40 shrink-0" />
        )}
      </button>
      {onResizeStart && <ColResizeHandle onMouseDown={onResizeStart} />}
    </TableHead>
  );
}

export default function TraitementPaiePage() {
  const [collabs, setCollabs] = useState<Collab[]>([]);
  const [plans, setPlans] = useState<Record<string, Plan>>({});
  const [refLoading, setRefLoading] = useState(true);

  const [collabId, setCollabId] = useState<string>("");
  const [collabOpen, setCollabOpen] = useState(false);

  // Cascade : plan actif du collaborateur → année → période
  const [planActif, setPlanActif] = useState<Plan | null>(null);
  const [periodesPlan, setPeriodesPlan] = useState<Periode[]>([]);
  const [annee, setAnnee] = useState<number | null>(null);
  const [periodeId, setPeriodeId] = useState<string>("");
  const [pendingSel, setPendingSel] = useState<{ annee?: number; periodeId?: string } | null>(null);

  const [result, setResult] = useState<CalculBulletinResult | null>(null);
  const [prevTotaux, setPrevTotaux] = useState<CalculBulletinResult["totaux"] | null>(null);
  const [busy, setBusy] = useState<null | "calc" | "save" | "load" | "del">(null);

  const navigate = useNavigate();
  const location = useLocation();
  const [pendingCalc, setPendingCalc] = useState(false);
  const { formatMoney } = useFormatMasks();

  // Restauration du contexte : retour via fil d'Ariane (location.state.restore)
  // ou reprise silencieuse de la dernière sélection (sessionStorage).
  useEffect(() => {
    const restore = (location.state as any)?.restore as { collabId?: string; annee?: number; periodeId?: string } | undefined;
    if (restore?.collabId) {
      setCollabId(restore.collabId);
      setPendingSel({ annee: restore.annee, periodeId: restore.periodeId });
      setPendingCalc(true); // on régénère l'écran tel qu'il était
      return;
    }
    try {
      const saved = JSON.parse(sessionStorage.getItem(SEL_KEY) || "null");
      if (saved?.collabId) {
        setCollabId(saved.collabId);
        setPendingSel({ annee: saved.annee, periodeId: saved.periodeId });
      }
    } catch { /* ignore */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Mémorise la sélection pour la reprise et le retour
  useEffect(() => {
    if (collabId) sessionStorage.setItem(SEL_KEY, JSON.stringify({ collabId, annee, periodeId }));
  }, [collabId, annee, periodeId]);

  // Fil d'Ariane à transmettre lors d'un drill-down (rubrique / collaborateur)
  const trailVersIci = () =>
    buildTrail(
      { path: "/paie/traitement/calcul", label: "Traitement de la paie", state: { restore: { collabId, annee, periodeId } } },
      (location.state as any)?.returnTo,
    );

  const ouvrirRubrique = (code: string) =>
    navigate("/paie/parametrage", { state: { openRubrique: code, returnTo: trailVersIci() } });

  const ouvrirCollaborateur = () => {
    if (collabId) navigate(`/collaborateurs/${collabId}`, { state: { returnTo: trailVersIci() } });
  };

  // Au retour (restore), régénère le bulletin une fois les référentiels chargés
  useEffect(() => {
    if (pendingCalc && !refLoading && collabId && periodeId && !busy) {
      setPendingCalc(false);
      lancer(false);
    }
  }, [pendingCalc, refLoading, collabId, periodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Chargement des référentiels (collaborateurs + plans)
  useEffect(() => {
    (async () => {
      try {
        const [cs, pls] = await Promise.all([
          db.list<Collab>("collaborateurs", { select: "id,matricule,nom,prenom", archive: false, order: "nom", limit: 2000 }),
          db.list<Plan>("plan_paie", { select: "id,code,libelle", limit: 200 }),
        ]);
        cs.sort((a, b) => (a.nom + a.prenom).localeCompare(b.nom + b.prenom));
        setCollabs(cs);
        setPlans(Object.fromEntries(pls.map((p) => [p.id, p])));
      } catch (e: any) {
        toast.error("Chargement impossible", { description: e.message });
      } finally {
        setRefLoading(false);
      }
    })();
  }, []);

  // Cascade : à la sélection du collaborateur, résoudre le plan actif + ses périodes
  useEffect(() => {
    if (!collabId || Object.keys(plans).length === 0) return;
    (async () => {
      setPlanActif(null); setPeriodesPlan([]); setAnnee(null); setPeriodeId("");
      try {
        const today = new Date().toISOString().slice(0, 10);
        const liens = await db.list<any>("collaborateur_plan_paie", {
          collaborateur_id: collabId, archive: false,
          select: "plan_paie_id,date_debut,date_fin", order: "-date_debut",
        });
        const actif = liens.find((l: any) => l.date_debut <= today && (!l.date_fin || l.date_fin >= today)) || liens[0];
        if (!actif) { toast.warning("Aucun plan de paie actif pour ce collaborateur"); setPendingSel(null); return; }
        setPlanActif(plans[actif.plan_paie_id] || null);
        const pers = await db.list<Periode>("calendrier_paie", {
          plan_paie_id: actif.plan_paie_id,
          select: "id,annee,mois,plan_paie_id,statut,numero_periode,date_ouverture", order: "-annee", limit: 600,
        });
        pers.sort((a, b) => a.annee - b.annee || a.mois - b.mois);
        setPeriodesPlan(pers);
        // Sélection : reprise (pendingSel) sinon 1ʳᵉ période ouverte de l'année la plus récente
        const anneesDispo = Array.from(new Set(pers.map((p) => p.annee))).sort((a, b) => b - a);
        const anSel = (pendingSel?.annee && anneesDispo.includes(pendingSel.annee)) ? pendingSel.annee : (anneesDispo[0] ?? null);
        setAnnee(anSel);
        const dansAnnee = pers.filter((p) => p.annee === anSel);
        const perSel = (pendingSel?.periodeId && dansAnnee.some((p) => p.id === pendingSel.periodeId))
          ? pendingSel.periodeId
          : (premiereOuverte(dansAnnee)?.id || "");
        setPeriodeId(perSel);
        setPendingSel(null);
      } catch (e: any) {
        toast.error("Résolution du plan impossible", { description: e.message });
      }
    })();
  }, [collabId, plans]); // eslint-disable-line react-hooks/exhaustive-deps

  const anneesDispo = Array.from(new Set(periodesPlan.map((p) => p.annee))).sort((a, b) => b - a);
  const periodesAnnee = periodesPlan.filter((p) => p.annee === annee);

  const changerAnnee = (an: number) => {
    setAnnee(an);
    const dans = periodesPlan.filter((p) => p.annee === an);
    setPeriodeId((premiereOuverte(dans)?.id) || "");
  };

  const collab = collabs.find((c) => c.id === collabId);
  const periode = periodesPlan.find((p) => p.id === periodeId);
  const periodeLabel = (p: Periode) => `${MOIS[p.mois]} ${p.annee}`;

  const _today = new Date().toISOString().slice(0, 10);
  const estOuverte = (p?: Periode) => !!p && p.statut !== "CLOTUREE" && (!p.date_ouverture || p.date_ouverture <= _today);
  const peutCalculer = collabId && planActif && periodeId && estOuverte(periode) && !busy;

  async function lancer(persister: boolean) {
    if (!collabId || !periodeId) return;
    setBusy(persister ? "save" : "calc");
    setResult(null);
    try {
      const res = await calculerBulletin({ collaborateur_id: collabId, periode_id: periodeId, persister });
      setResult(res);
      toast.success(persister ? "Bulletin calculé et enregistré" : "Bulletin calculé", {
        description: `Net à payer : ${formatMoney(res.totaux.net_a_payer)}`,
      });
    } catch (e: any) {
      toast.error("Échec du calcul", { description: e.message });
    } finally {
      setBusy(null);
    }
  }

  async function consulter() {
    if (!collabId || !periodeId) return;
    setBusy("load");
    setResult(null);
    try {
      const list = await listerBulletins({ collaborateur_id: collabId, periode_id: periodeId });
      if (!list.length) {
        toast.info("Aucun bulletin enregistré", { description: "Lance un calcul puis enregistre-le." });
        return;
      }
      // L'API renvoie les trois états. On travaille en priorité sur le précalcul,
      // puis sur le validé, enfin sur l'archive.
      const ordre: Record<string, number> = { TEMP: 0, VALIDE: 1, CLOTURE: 2, HISTORIQUE: 3 };
      const bulletin = [...list].sort((a, b) => (ordre[a.origine] ?? 9) - (ordre[b.origine] ?? 9))[0];
      setResult(bulletinToResult(bulletin));
      const etat = bulletin.origine === "TEMP" ? "précalculé"
        : bulletin.origine === "VALIDE" ? "validé" : "clôturé";
      toast.success(`Bulletin ${etat} chargé`);
    } catch (e: any) {
      toast.error("Consultation impossible", { description: e.message });
    } finally {
      setBusy(null);
    }
  }

  async function supprimer() {
    if (!result?.bulletin_id) return;
    setBusy("del");
    try {
      await supprimerBulletin(result.bulletin_id);
      toast.success("Bulletin supprimé");
      setResult(null);
    } catch (e: any) {
      toast.error("Suppression impossible", { description: e.message });
    } finally {
      setBusy(null);
    }
  }

  // Variance vs période précédente (même collaborateur) sur les tuiles KPI —
  // repli silencieux à null si pas de bulletin antérieur (nouveau collaborateur,
  // première période, etc.), sans jamais bloquer l'affichage du résultat courant.
  useEffect(() => {
    if (!result || !collabId) { setPrevTotaux(null); return; }
    const idx = periodesPlan.findIndex((p) => p.id === periodeId);
    const prev = idx > 0 ? periodesPlan[idx - 1] : undefined;
    if (!prev) { setPrevTotaux(null); return; }
    let annule = false;
    (async () => {
      try {
        const list = await listerBulletins({ collaborateur_id: collabId, periode_id: prev.id });
        if (annule) return;
        if (!list.length) { setPrevTotaux(null); return; }
        const ordre: Record<string, number> = { VALIDE: 0, CLOTURE: 1, HISTORIQUE: 2, TEMP: 3 };
        const b = [...list].sort((a, b2) => (ordre[a.origine] ?? 9) - (ordre[b2.origine] ?? 9))[0];
        setPrevTotaux(bulletinToResult(b).totaux);
      } catch { if (!annule) setPrevTotaux(null); }
    })();
    return () => { annule = true; };
  }, [result, collabId, periodeId, periodesPlan]);

  return (
    <div className="p-6 space-y-6 w-full">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Traitement de la paie</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Calcule, enregistre et consulte le bulletin d'un collaborateur pour une période.
        </p>
      </div>

      {/* Barre de sélection */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1.6fr_1.1fr_0.7fr_1fr_auto] md:items-end">
            {/* Collaborateur */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Collaborateur</label>
              <Popover open={collabOpen} onOpenChange={setCollabOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full justify-between font-normal" disabled={refLoading}>
                    {collab ? `${collab.nom} ${collab.prenom} — ${collab.matricule}` : "Sélectionner…"}
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
                          <CommandItem
                            key={c.id}
                            value={`${c.nom} ${c.prenom} ${c.matricule}`}
                            onSelect={() => { setCollabId(c.id); setCollabOpen(false); }}
                          >
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

            {/* Plan de paie actif (déterminé par le collaborateur) */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Plan de paie</label>
              <div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm">
                {!collabId ? (
                  <span className="text-muted-foreground">—</span>
                ) : planActif ? (
                  <span className="font-medium">{planActif.code}<span className="text-muted-foreground font-normal"> · {planActif.libelle}</span></span>
                ) : (
                  <span style={{ color: "hsl(var(--warning))" }}>Aucun plan actif</span>
                )}
              </div>
            </div>

            {/* Année */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Année</label>
              <Select value={annee ? String(annee) : ""} onValueChange={(v) => changerAnnee(Number(v))} disabled={!planActif}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {anneesDispo.map((an) => (
                    <SelectItem key={an} value={String(an)}>{an}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Période */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Période</label>
              <Select value={periodeId} onValueChange={setPeriodeId} disabled={!planActif || !annee}>
                <SelectTrigger><SelectValue placeholder="Sélectionner…" /></SelectTrigger>
                <SelectContent>
                  {periodesAnnee.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {periodeLabel(p)}
                      {!estOuverte(p) ? <span style={{ color: "hsl(var(--warning))" }}> · {p.statut === "CLOTUREE" ? "clôturée" : "non ouverte"}</span>
                        : p.statut !== "OUVERTE" && <span className="text-muted-foreground"> · {p.statut.toLowerCase()}</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <Button onClick={() => lancer(false)} disabled={!peutCalculer}>
                {busy === "calc" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
                Calculer
              </Button>
              <Button variant="secondary" onClick={() => lancer(true)} disabled={!peutCalculer}>
                {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Enregistrer
              </Button>
              <Button variant="outline" onClick={consulter} disabled={!peutCalculer} title="Charger le bulletin enregistré">
                {busy === "load" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {refLoading && <Skeleton className="h-40 w-full" />}

      {result && <Resultat result={result} prevTotaux={prevTotaux} onDelete={result.bulletin_id ? supprimer : undefined} deleting={busy === "del"} onOpenCollab={ouvrirCollaborateur} onOpenRubrique={ouvrirRubrique} />}

      {!result && !refLoading && (
        <div className="text-center text-sm text-muted-foreground py-16 border border-dashed rounded-lg">
          Sélectionne un collaborateur et une période, puis lance le calcul.
        </div>
      )}
    </div>
  );
}

// ---- Export Excel (SheetJS) — reflète exactement ce qui est affiché à
// l'écran : mêmes groupes/ordre, et même substitution Base→Nb pour les
// cotisations (RG-COTISATION-BASE-TAUX-01) que le tableau.
//
// RG-EXPORT-EXCEL-NUMERIQUE-01 (Adil DAIA) : l'API sérialise les Decimal en
// chaînes (même remarque que RG-BULLETIN-SOUSTOTAL-TYPE-01 plus haut dans ce
// fichier) — sans coercition explicite, ces cellules partent en TEXTE dans
// Excel : pas de tri numérique, pas de somme possible, alignées à gauche.
// `num()` coerce systématiquement (montants, taux, cumuls, KPI, totaux) et
// renvoie `null` — pas 0 — quand la valeur est absente, pour laisser la
// cellule vide plutôt que d'y écrire un zéro trompeur.
function _num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isNaN(n) ? null : n;
}
// Date "pure" (YYYY-MM-DD, sans heure) → Date locale à midi, jamais UTC :
// construire directement via `new Date(iso)` interprète la chaîne comme UTC
// minuit, ce qui affiche la veille dans un fuseau à l'ouest de Greenwich
// (le Maroc passe à l'heure d'été UTC+1 une partie de l'année).
function _dateExcel(iso?: string | null): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12);
}

const FORMAT_MONTANT = "#,##0.00";
const FORMAT_TAUX = "0.0000";
const FORMAT_DATE = "dd/mm/yyyy";

// Applique un format de cellule (`.z`) à toutes les lignes de données d'une
// colonne — SheetJS n'a pas de notion de "format de colonne", juste des
// formats par cellule ; obligé de boucler sur la plage réellement écrite.
function _formaterColonne(ws: XLSX.WorkSheet, colIndex: number, ligneDebut: number, ligneFin: number, format: string) {
  for (let r = ligneDebut; r <= ligneFin; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: colIndex });
    const cell = ws[addr];
    if (cell && typeof cell.v === "number") cell.z = format;
  }
}

function exporterExcel(result: CalculBulletinResult, lignesParGroupe: Record<Groupe, LigneBulletin[]>) {
  const lignesExport: Record<string, string | number | Date | null>[] = [];
  GROUPES.forEach(({ key, label }) => {
    const lignes = lignesParGroupe[key];
    lignes.forEach((l) => {
      lignesExport.push({
        "Groupe": label,
        "Rubrique": l.libelle,
        "Code": l.code_rubrique,
        "Type": l.type_periodicite ? (PERIODICITE[l.type_periodicite]?.label ?? l.type_periodicite) : "",
        "Base": l.est_cotisation ? null : _num(l.base),
        "Nb": l.est_cotisation ? _num(l.base) : _num(l.nombre),
        "Taux": _num(l.taux),
        "Montant": _num(l.montant) ?? 0,
        // Cumul (mêmes valeurs que la sous-ligne "cumul ..." affichée sous
        // Nb/Montant en vue "Les deux" pour une rubrique cumulée — vide pour
        // les rubriques non cumulées ou les cotisations, où le cumul n'a pas
        // le même sens que le "Nb" substitué par la base).
        "Nb (cumul)": !l.est_cotisation && estCumulee(l) ? _num(l.nombre_cumul) : null,
        "Montant (cumul)": estCumulee(l) ? _num(l.montant_cumul) : null,
        "Part patronale": _num(l.montant_patronal),
        "Date": _dateExcel(l.date_valeur) ?? "",
        "Texte": l.texte ?? "",
        "Observation": l.observation ?? "",
      });
    });
  });

  const c = result.collaborateur;
  const t = result.totaux;
  const wb = XLSX.utils.book_new();

  // Bloc KPI (mêmes chiffres que les 4 tuiles en haut de l'écran) suivi d'une
  // ligne vide, puis du tableau des lignes en dessous, sur la même feuille —
  // sheet_add_json avec `origin` reprend juste après (pas de json_to_sheet
  // direct ici, qui écraserait ces lignes d'en-tête).
  const kpiRows: (string | number)[][] = [
    ["Collaborateur", `${c.nom ?? ""} ${c.prenom ?? ""}`.trim(), "Matricule", c.matricule ?? ""],
    ["Période", result.periode.libelle || "", "Plan", result.periode.code_plan || ""],
    [],
    ["Net à payer", _num(t.net_a_payer) ?? 0],
    ["Total gains", _num(t.total_gains) ?? 0],
    ["Total retenues", _num(t.total_retenues) ?? 0],
    ["Coût employeur", _num(t.cout_employeur) ?? 0],
    [],
  ];
  const LIGNE_KPI_MONTANTS = [3, 4, 5, 6]; // index 0-based des 4 lignes chiffrées ci-dessus
  const wsBulletin = XLSX.utils.aoa_to_sheet(kpiRows);
  LIGNE_KPI_MONTANTS.forEach((r) => _formaterColonne(wsBulletin, 1, r, r, FORMAT_MONTANT));

  const ligneEnteteTableau = kpiRows.length; // 1ʳᵉ ligne écrite par sheet_add_json = l'en-tête
  XLSX.utils.sheet_add_json(wsBulletin, lignesExport, { origin: ligneEnteteTableau, skipHeader: false });
  const ligneDebutDonnees = ligneEnteteTableau + 1;
  const ligneFinDonnees = ligneEnteteTableau + lignesExport.length;
  // Colonnes (0-indexées) : 0 Groupe, 1 Rubrique, 2 Code, 3 Type, 4 Base,
  // 5 Nb, 6 Taux, 7 Montant, 8 Nb(cumul), 9 Montant(cumul), 10 Part patr.,
  // 11 Date, 12 Texte, 13 Observation.
  [4, 8].forEach((col) => _formaterColonne(wsBulletin, col, ligneDebutDonnees, ligneFinDonnees, FORMAT_MONTANT)); // Base, Nb(cumul)
  _formaterColonne(wsBulletin, 6, ligneDebutDonnees, ligneFinDonnees, FORMAT_TAUX); // Taux
  [7, 9, 10].forEach((col) => _formaterColonne(wsBulletin, col, ligneDebutDonnees, ligneFinDonnees, FORMAT_MONTANT)); // Montant, Montant(cumul), Part patr.
  // "Nb" (colonne 5) mélange nombre (4 décimales, ex. 26,0000) et base
  // substituée pour les cotisations (2 décimales, ex. 6 875,00) — pas un
  // format homogène pour toute la colonne, on applique le format 4 décimales
  // qui correspond à l'affichage écran pour la majorité des lignes (Nb réel).
  _formaterColonne(wsBulletin, 5, ligneDebutDonnees, ligneFinDonnees, FORMAT_TAUX);
  _formaterColonne(wsBulletin, 11, ligneDebutDonnees, ligneFinDonnees, FORMAT_DATE); // Date

  wsBulletin["!cols"] = [
    { wch: 16 }, { wch: 30 }, { wch: 14 }, { wch: 12 }, { wch: 11 }, { wch: 11 },
    { wch: 11 }, { wch: 12 }, { wch: 12 }, { wch: 15 }, { wch: 13 }, { wch: 12 }, { wch: 26 }, { wch: 32 },
  ];
  XLSX.utils.book_append_sheet(wb, wsBulletin, "Bulletin");

  const totauxData: [string, number | null][] = [
    ["Total brut", _num(t.total_brut)],
    ["Brut imposable", _num(t.total_brut_imposable)],
    ["Total gains", _num(t.total_gains)],
    ["Cotisations salariales", _num(t.total_cot_salariale)],
    ["Cotisations patronales", _num(t.total_cot_patronale)],
    ["Net imposable", _num(t.net_imposable)],
    ["Total retenues", _num(t.total_retenues)],
    ["Net à payer", _num(t.net_a_payer)],
    ["Coût employeur", _num(t.cout_employeur)],
  ];
  const wsTotaux = XLSX.utils.json_to_sheet(totauxData.map(([libelle, montant]) => ({ "Libellé": libelle, "Montant": montant ?? 0 })));
  _formaterColonne(wsTotaux, 1, 1, totauxData.length, FORMAT_MONTANT);
  wsTotaux["!cols"] = [{ wch: 24 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsTotaux, "Totaux");

  const periodeSlug = (result.periode.libelle || "periode").replace(/\s+/g, "_");
  const identCollab = c.matricule || c.id?.slice(0, 8) || "collaborateur";
  XLSX.writeFile(wb, `Bulletin_${identCollab}_${periodeSlug}.xlsx`);
}

// ============================ Résultat ====================================
export function Resultat({ result, prevTotaux, onDelete, deleting, onOpenCollab, onOpenRubrique, panneauCycle = true }: {
  result: CalculBulletinResult; prevTotaux?: CalculBulletinResult["totaux"] | null; onDelete?: () => void; deleting?: boolean;
  onOpenCollab?: () => void; onOpenRubrique?: (code: string) => void;
  /** Masquer le panneau CyclePaie (validation/dévalidation/clôture) — utile pour un écran de consultation pure lecture. */
  panneauCycle?: boolean;
}) {
  const t = result.totaux;
  const c = result.collaborateur;
  const nbAvert = result.messages.length;
  const { formatDate, formatNumber, formatMoney } = useFormatMasks();

  const [sort, setSort] = useState<{ col: string; dir: "asc" | "desc" } | null>(null);
  const [vue, setVue] = useState<"TOUT" | "PERIODE" | "CUMUL">("TOUT");
  // Sections repliables façon Odoo — Gains/Cotisations/Retenues ouvertes par
  // défaut (l'essentiel du bulletin), Éléments & bases/Assiettes repliées
  // (généralement de simples compteurs internes, moins consultés à l'oeil).
  const [ouverts, setOuverts] = useState<Record<Groupe, boolean>>({
    gains: true, cotisations: true, retenues: true, elements: false, totaux: false,
  });
  const toggleGroupe = (g: Groupe) => setOuverts((o) => ({ ...o, [g]: !o[g] }));

  // RG-BULLETIN-COL-RESIZE-01 (Adil DAIA) : largeurs de colonnes ajustables à
  // la souris, mémorisées pour la session en cours (comme la sélection
  // collaborateur/période, voir SEL_KEY).
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(COLWIDTHS_KEY) || "null");
      return saved && typeof saved === "object" ? { ...DEFAULT_COL_WIDTHS, ...saved } : { ...DEFAULT_COL_WIDTHS };
    } catch {
      return { ...DEFAULT_COL_WIDTHS };
    }
  });
  useEffect(() => {
    try { sessionStorage.setItem(COLWIDTHS_KEY, JSON.stringify(colWidths)); } catch { /* ignore */ }
  }, [colWidths]);

  const resizing = useRef<{ col: string; startX: number; startWidth: number } | null>(null);
  const onResizeMove = useCallback((e: MouseEvent) => {
    if (!resizing.current) return;
    const { col, startX, startWidth } = resizing.current;
    const next = Math.max(MIN_COL_WIDTH, startWidth + (e.clientX - startX));
    setColWidths((w) => ({ ...w, [col]: next }));
  }, []);
  const onResizeEnd = useCallback(() => {
    resizing.current = null;
    window.removeEventListener("mousemove", onResizeMove);
    window.removeEventListener("mouseup", onResizeEnd);
  }, [onResizeMove]);
  const startResize = useCallback((col: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = { col, startX: e.clientX, startWidth: colWidths[col] ?? DEFAULT_COL_WIDTHS[col] ?? 100 };
    window.addEventListener("mousemove", onResizeMove);
    window.addEventListener("mouseup", onResizeEnd);
  }, [colWidths, onResizeMove, onResizeEnd]);
  // Filet de sécurité si le composant démonte pendant un drag en cours.
  useEffect(() => () => {
    window.removeEventListener("mousemove", onResizeMove);
    window.removeEventListener("mouseup", onResizeEnd);
  }, [onResizeMove, onResizeEnd]);
  const resetColWidths = () => setColWidths({ ...DEFAULT_COL_WIDTHS });

  // Zones Date / Texte / Observation : toujours affichées (demande Adil)
  const colCount = 11; // Rubrique, Type, Base, Nb, Taux, Montant, Part patr., Date, Texte, Observation, détail

  const toggleSort = (col: string) =>
    setSort((s) => (s?.col === col ? (s.dir === "asc" ? { col, dir: "desc" } : null) : { col, dir: "asc" }));

  const lignesParGroupe = useMemo(() => {
    const map: Record<Groupe, LigneBulletin[]> = { gains: [], cotisations: [], retenues: [], elements: [], totaux: [] };
    result.lignes.forEach((l) => map[categoriser(l)].push(l));
    (Object.keys(map) as Groupe[]).forEach((k) => (map[k] = sortLignes(map[k], sort)));
    return map;
  }, [result.lignes, sort]);

  // Sous-total affiché dans l'en-tête de groupe (Odoo affiche systématiquement
  // un total de groupe dans les vues groupées) : somme des montants pour les
  // groupes financiers, simple décompte pour Éléments/Assiettes où "montant"
  // n'a pas de sens agrégé homogène (mélange de NB/TY/MT selon la rubrique).
  const sousTotalGroupe = (g: Groupe, lignes: LigneBulletin[]): string => {
    if (g === "elements" || g === "totaux") return `${lignes.length} ligne${lignes.length > 1 ? "s" : ""}`;
    // RG-BULLETIN-SOUSTOTAL-TYPE-01 (Adil DAIA) : l.montant peut arriver en
    // chaîne depuis l'API (sérialisation Decimal côté backend) — un simple
    // `s + l.montant` fait alors de la concaténation de texte au lieu d'une
    // addition dès la 2e ligne ("0" + "721.15" + "680.00" + ... au lieu de
    // 1901.15). Number(...) force la coercition numérique comme le fait déjà
    // formatNumberWith/formatMoneyWith dans useFormatMasks.
    const total = lignes.reduce((s, l) => s + (Number(l.montant) || 0), 0);
    return formatMoney(total);
  };
  const groupeAAvertissement = (lignes: LigneBulletin[]) => lignes.some((l) => !!l.observation);

  return (
    <div className="space-y-4">
      {/* En-tête + résumé */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div
            className="text-lg font-semibold hover:text-primary cursor-pointer inline-block"
            onDoubleClick={onOpenCollab}
            title="Double-cliquez pour ouvrir la fiche du collaborateur"
          >
            {c.nom ?? ""} {c.prenom ?? ""} {c.matricule && <span className="text-muted-foreground font-normal">· {c.matricule}</span>}
          </div>
          <div className="flex items-center gap-2 mt-1">
            {result.periode.libelle && <Badge variant="outline">{result.periode.libelle}</Badge>}
            {result.periode.code_plan && <Badge variant="secondary">{result.periode.code_plan}</Badge>}
            {result.bulletin_id
              ? <Badge style={{ background: "hsl(var(--success))", color: "#fff" }}>Enregistré</Badge>
              : <Badge variant="outline">Simulation</Badge>}
            {result.a_erreur && <Badge variant="destructive">Erreur</Badge>}
          </div>
        </div>
        {onDelete && (
          <Button variant="outline" size="sm" onClick={onDelete} disabled={deleting}>
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Supprimer
          </Button>
        )}
      </div>

      {result.bulletin_id && panneauCycle && (
        <CyclePaie
          bulletinId={result.bulletin_id}
          periodeId={result.periode.id}
          /* L'origine (table réelle) prime sur le statut : elle reflète où vit
             le bulletin — précalcul, validé ou archivé. */
          statutInitial={
            result.origine === "VALIDE" ? "VALIDE"
            : result.origine === "HISTORIQUE" ? "CLOTURE"
            : result.statut ?? "CALCULE"
          }
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<Wallet className="h-4 w-4" />} label="Net à payer" value={t.net_a_payer} accent previous={prevTotaux?.net_a_payer} />
        <StatCard icon={<TrendingUp className="h-4 w-4" />} label="Total gains" value={t.total_gains} previous={prevTotaux?.total_gains} />
        <StatCard icon={<TrendingDown className="h-4 w-4" />} label="Total retenues" value={t.total_retenues} previous={prevTotaux?.total_retenues} sensPositif={false} />
        <StatCard icon={<Building2 className="h-4 w-4" />} label="Coût employeur" value={t.cout_employeur} previous={prevTotaux?.cout_employeur} sensPositif={false} />
      </div>

      <Tabs defaultValue="bulletin">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="bulletin"><FileText className="h-4 w-4 mr-1.5" /> Bulletin</TabsTrigger>
            <TabsTrigger value="trace" disabled={!result.trace.length}>
              <ListTree className="h-4 w-4 mr-1.5" /> Trace de calcul
            </TabsTrigger>
          </TabsList>
          {/* Filtre d'affichage : période, cumul ou les deux */}
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border bg-card p-0.5 text-sm">
              {([["TOUT", "Les deux"], ["PERIODE", "Période"], ["CUMUL", "Cumul"]] as const).map(([v, lbl]) => (
                <button
                  key={v}
                  onClick={() => setVue(v)}
                  className={`px-3 py-1 rounded ${vue === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {lbl}
                </button>
              ))}
            </div>
            <button
              onClick={() => exporterExcel(result, lignesParGroupe)}
              title="Exporter le bulletin en Excel"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border bg-card text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
            </button>
            <button
              onClick={resetColWidths}
              title="Réinitialiser la largeur des colonnes"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border bg-card text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Columns3 className="h-3.5 w-3.5" /> Colonnes
            </button>
          </div>
        </div>

        {/* --- Bulletin --- */}
        <TabsContent value="bulletin" className="mt-4">
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table
                className="text-sm [&_td]:py-1 [&_th]:py-1.5 [&_td]:leading-tight"
                style={{ tableLayout: "fixed", width: COL_ORDER.reduce((s, k) => s + (colWidths[k] ?? DEFAULT_COL_WIDTHS[k] ?? 0), 0) }}
              >
                <TableHeader>
                  <TableRow>
                    <SortHead label="Rubrique" col="rubrique" sort={sort} onSort={toggleSort} width={colWidths.rubrique} onResizeStart={startResize("rubrique")} />
                    <TableHead className="relative overflow-hidden text-center" style={{ width: colWidths.type, minWidth: colWidths.type, maxWidth: colWidths.type }}>
                      Type
                      <ColResizeHandle onMouseDown={startResize("type")} />
                    </TableHead>
                    <SortHead label="Base" col="base" sort={sort} onSort={toggleSort} width={colWidths.base} onResizeStart={startResize("base")} />
                    <SortHead label="Nb" col="nombre" sort={sort} onSort={toggleSort} width={colWidths.nombre} onResizeStart={startResize("nombre")} />
                    <SortHead label="Taux" col="taux" sort={sort} onSort={toggleSort} width={colWidths.taux} onResizeStart={startResize("taux")} />
                    <SortHead label="Montant" col="montant" sort={sort} onSort={toggleSort} width={colWidths.montant} onResizeStart={startResize("montant")} />
                    <SortHead label="Part patr." col="patronal" sort={sort} onSort={toggleSort} width={colWidths.patronal} onResizeStart={startResize("patronal")} />
                    <SortHead label="Date" col="date" sort={sort} onSort={toggleSort} width={colWidths.date} onResizeStart={startResize("date")} />
                    <SortHead label="Texte" col="texte" sort={sort} onSort={toggleSort} width={colWidths.texte} onResizeStart={startResize("texte")} />
                    <SortHead label="Observation" col="observation" sort={sort} onSort={toggleSort} width={colWidths.observation} onResizeStart={startResize("observation")} />
                    <TableHead style={{ width: colWidths.detail, minWidth: colWidths.detail, maxWidth: colWidths.detail }} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {GROUPES.map(({ key, label }) => {
                    const lignes = lignesParGroupe[key];
                    if (lignes.length === 0) return null;
                    const aAvertissement = groupeAAvertissement(lignes);
                    // Un groupe contenant une anomalie reste visible même s'il est
                    // replié par défaut (Éléments & bases / Assiettes) : jamais
                    // masquer silencieusement un avertissement de paramétrage.
                    const ouvert = ouverts[key] || aAvertissement;
                    return (
                      <React.Fragment key={key}>
                        <TableRow className="bg-muted/50 hover:bg-muted/70 cursor-pointer transition-colors" onClick={() => toggleGroupe(key)}>
                          <TableCell colSpan={colCount} className="py-1.5">
                            <div className="flex items-center justify-between">
                              <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                {ouvert ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                {label}
                                <span className="font-normal normal-case text-muted-foreground/70">({lignes.length})</span>
                                {aAvertissement && (
                                  <span className="inline-flex items-center gap-1 font-normal normal-case" style={{ color: "hsl(var(--warning))" }}>
                                    <AlertTriangle className="h-3 w-3" /> à vérifier
                                  </span>
                                )}
                              </span>
                              <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                                {sousTotalGroupe(key, lignes)}
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                        {ouvert && lignes.map((l) => {
                          const alerte = !!l.observation;
                          const couleurMontant = l.sens === "RETENUE" ? "hsl(var(--destructive))" : l.sens === "GAIN" ? "hsl(var(--success))" : undefined;
                          return (
                            <React.Fragment key={l.code_rubrique}>
                              {vue !== "CUMUL" ? (
                                /* Ligne unique Période (+ sous-valeur Cumul en vue "Les deux" —
                                   plus de ligne dupliquée sous chaque rubrique cumulée). */
                                <TableRow
                                  className="cursor-pointer"
                                  onDoubleClick={() => onOpenRubrique?.(l.code_rubrique)}
                                  title="Double-cliquez pour ouvrir le paramétrage de la rubrique"
                                >
                                  <TableCell>
                                    <span className="inline-flex items-center gap-1.5">
                                      {alerte && <AlertTriangle className="h-3.5 w-3.5 shrink-0" style={{ color: "hsl(var(--warning))" }} />}
                                      <span className="font-medium">{l.libelle}</span>
                                      <span className="text-xs font-medium" style={{ color: "hsl(var(--accent))" }}>({l.code_rubrique})</span>
                                    </span>
                                  </TableCell>
                                  <TableCell>
                                    <span className="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium" style={TYPE_LIGNE.PERIODE.style}>
                                      {TYPE_LIGNE.PERIODE.label}
                                    </span>
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {!l.est_cotisation && l.base ? formatNumber(l.base) : ""}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {/* Cotisation : pas de "nombre" au sens propre (ce n'est pas un
                                        compteur de jours/unités) — on y montre l'assiette (base) à la
                                        place, pour ne pas laisser la colonne vide alors que la base
                                        existe déjà en base de données (RG-COTISATION-BASE-TAUX-01). */}
                                    <div>{l.est_cotisation ? (l.base ? formatNumber(l.base) : "") : formatNumber(l.nombre, 4)}</div>
                                    {vue === "TOUT" && !l.est_cotisation && estCumulee(l) && l.nombre_cumul != null && (
                                      <div className="text-[10px] text-muted-foreground font-normal">cumul {formatNumber(l.nombre_cumul, 4)}</div>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">{formatNumber(l.taux, 4)}</TableCell>
                                  <TableCell className="text-right tabular-nums font-medium" style={{ color: couleurMontant }}>
                                    <div>{formatNumber(l.montant)}</div>
                                    {vue === "TOUT" && estCumulee(l) && l.montant_cumul != null && (
                                      <div className="text-[10px] text-muted-foreground font-normal">cumul {formatNumber(l.montant_cumul)}</div>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums text-muted-foreground">
                                    {l.montant_patronal != null ? formatNumber(l.montant_patronal) : ""}
                                  </TableCell>
                                  <TableCell className="tabular-nums text-muted-foreground">{formatDate(l.date_valeur)}</TableCell>
                                  <TableCell className="text-muted-foreground">{l.texte ?? ""}</TableCell>
                                  <TableCell
                                    className="text-xs max-w-[220px] truncate font-medium"
                                    style={alerte ? { color: "hsl(var(--warning))" } : { color: "hsl(var(--muted-foreground))", fontWeight: 400 }}
                                    title={l.observation ?? ""}
                                  >
                                    {l.observation ?? ""}
                                  </TableCell>
                                  <TableCell className="p-0 text-center">
                                    <LigneDetail ligne={l} etape={result.trace.find((e) => e.rubrique === l.code_rubrique)} />
                                  </TableCell>
                                </TableRow>
                              ) : (
                                /* Vue "Cumul" : une ligne principale par rubrique (montant cumulé) */
                                <TableRow
                                  className="cursor-pointer"
                                  onDoubleClick={() => onOpenRubrique?.(l.code_rubrique)}
                                  title="Double-cliquez pour ouvrir le paramétrage de la rubrique"
                                >
                                  <TableCell>
                                    <span className="inline-flex items-center gap-1.5">
                                      {alerte && <AlertTriangle className="h-3.5 w-3.5 shrink-0" style={{ color: "hsl(var(--warning))" }} />}
                                      <span className="font-medium">{l.libelle}</span>
                                      <span className="text-xs font-medium" style={{ color: "hsl(var(--accent))" }}>({l.code_rubrique})</span>
                                    </span>
                                  </TableCell>
                                  <TableCell>
                                    <span className="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium" style={TYPE_LIGNE.CUMUL.style}>
                                      {TYPE_LIGNE.CUMUL.label}
                                    </span>
                                  </TableCell>
                                  <TableCell />
                                  <TableCell className="text-right tabular-nums">{formatNumber(l.nombre_cumul, 4)}</TableCell>
                                  <TableCell />
                                  <TableCell className="text-right tabular-nums font-medium" style={{ color: couleurMontant }}>
                                    {formatNumber(l.montant_cumul != null ? l.montant_cumul : l.montant)}
                                  </TableCell>
                                  <TableCell /><TableCell /><TableCell /><TableCell />
                                  <TableCell className="p-0 text-center">
                                    <LigneDetail ligne={l} etape={result.trace.find((e) => e.rubrique === l.code_rubrique)} />
                                  </TableCell>
                                </TableRow>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Bandeau totaux */}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 mt-3 text-sm">
            <TotalRow label="Brut imposable" value={t.total_brut_imposable} />
            <TotalRow label="Cotisations salariales" value={t.total_cot_salariale} />
            <TotalRow label="Cotisations patronales" value={t.total_cot_patronale} />
            <TotalRow label="Net imposable" value={t.net_imposable} />
            <TotalRow label="Total retenues" value={t.total_retenues} />
            <TotalRow label="Net à payer" value={t.net_a_payer} strong />
          </div>

          {nbAvert > 0 && (
            <Card className="mt-3" style={{ borderColor: "hsl(var(--warning) / 0.4)", background: "hsl(var(--warning) / 0.05)" }}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2" style={{ color: "hsl(var(--warning))" }}>
                  <AlertTriangle className="h-4 w-4" /> {nbAvert} avertissement{nbAvert > 1 ? "s" : ""} de paramétrage
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-xs space-y-1 max-h-48 overflow-auto" style={{ color: "hsl(var(--warning))" }}>
                  {result.messages.map((m, i) => <li key={i} className="font-mono">{m}</li>)}
                </ul>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* --- Trace --- */}
        <TabsContent value="trace" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <ScrollArea className="h-[520px]">
                <div className="divide-y">
                  {result.trace.map((e, i) => <TraceLigne key={i} etape={e} />)}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ icon, label, value, accent, previous, sensPositif = true }: {
  icon: React.ReactNode; label: string; value: number; accent?: boolean; previous?: number | null; sensPositif?: boolean;
}) {
  const { masks, formatNumber } = useFormatMasks();
  // Variance vs la période précédente (même collaborateur) — repli null si
  // pas de bulletin antérieur trouvé ou base nulle (division impossible).
  const delta = previous != null && previous !== 0 ? ((value - previous) / Math.abs(previous)) * 100 : null;
  const hausse = delta != null && delta > 0.05;
  const baisse = delta != null && delta < -0.05;
  // sensPositif=true (Net à payer, Gains) : une hausse est "bonne" → vert.
  // sensPositif=false (Retenues, Coût employeur) : une hausse est un coût en plus → rouge.
  const couleurDelta = !hausse && !baisse ? "hsl(var(--muted-foreground))"
    : (hausse === sensPositif) ? "hsl(var(--success))" : "hsl(var(--destructive))";
  const symbole = <span className="text-base font-normal text-muted-foreground">{masks.currencySymbol}</span>;
  return (
    <Card className={accent ? "border-primary/40 bg-primary/5" : ""}>
      <CardContent className="pt-5">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">{icon}{label}</div>
        <div className={`mt-1 text-3xl font-semibold tabular-nums ${accent ? "text-primary" : ""}`}>
          {masks.symbolPosition === "AVANT" ? (
            <>{symbole} {formatNumber(value)}</>
          ) : (
            <>{formatNumber(value)} {symbole}</>
          )}
        </div>
        {delta != null && (
          <div className="mt-1.5 inline-flex items-center gap-1 text-sm font-medium" style={{ color: couleurDelta }}>
            {hausse ? <TrendingUp className="h-3.5 w-3.5" /> : baisse ? <TrendingDown className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
            {hausse ? "+" : ""}{delta.toFixed(1)}% vs période précédente
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  const { formatMoney } = useFormatMasks();
  return (
    <div className={`flex items-center justify-between rounded-md border px-3 py-2 ${strong ? "bg-primary/5 border-primary/40 font-semibold" : "bg-card"}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{formatMoney(value)}</span>
    </div>
  );
}

function LigneDetail({ ligne, etape }: { ligne: LigneBulletin; etape?: TraceEtape }) {
  const { formatDate, formatNumber } = useFormatMasks();
  const [hover, setHover] = useState<number | null>(null);
  const per = ligne.type_periodicite ? PERIODICITE[ligne.type_periodicite] : null;
  const Z = ({ k, v }: { k: string; v: string }) => (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="tabular-nums font-medium">{v}</span>
    </div>
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-muted text-muted-foreground"
          title="Voir le détail du calcul"
          onClick={(e) => e.stopPropagation()}
        >
          <Calculator className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[480px] max-h-[480px] overflow-auto p-0">
        <div className="p-3 border-b">
          <div className="font-semibold text-sm">{ligne.libelle}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs font-medium" style={{ color: "hsl(var(--accent))" }}>({ligne.code_rubrique})</span>
            {per && <span className="rounded px-1.5 py-0.5 text-[11px] font-medium" style={per.style}>{per.label}</span>}
          </div>
        </div>
        <div className="p-3 space-y-1 text-sm border-b">
          {ligne.base != null && <Z k="Base" v={formatNumber(ligne.base)} />}
          {ligne.nombre != null && <Z k="Nombre" v={formatNumber(ligne.nombre, 4)} />}
          {ligne.taux != null && <Z k="Taux" v={formatNumber(ligne.taux, 4)} />}
          <Z k="Montant (période)" v={formatNumber(ligne.montant)} />
          {ligne.montant_cumul != null && <Z k="Cumul à date" v={formatNumber(ligne.montant_cumul)} />}
          {ligne.montant_patronal != null && <Z k="Part patronale" v={formatNumber(ligne.montant_patronal)} />}
          {ligne.date_valeur && <Z k="Date" v={formatDate(ligne.date_valeur)} />}
          {ligne.texte && <Z k="Texte" v={ligne.texte} />}
        </div>
        <div className="p-3">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Comment c'est calculé — workflow de l'algorithme
          </div>
          {etape ? (() => {
            // Workflow de l'algorithme : trace structurée (algo) si dispo, sinon détail brut.
            const algo: { instruction?: string; resolu?: string; explication?: string; avert?: string }[] =
              (etape as any).algo?.length
                ? (etape as any).algo
                : (etape.detail ?? []).filter(Boolean).map((d: string) => ({ resolu: d }));
            const averts = etape.avert ?? [];
            if (algo.length === 0 && averts.length === 0) {
              return <div className="text-xs text-muted-foreground">Valeur directe (aucune étape intermédiaire).</div>;
            }
            return (
              <div className="space-y-2">
                {algo.length > 0 && (
                  <div className="rounded-md border border-border overflow-hidden">
                    <table className="w-full text-[11px]">
                      <thead className="bg-muted/50">
                        <tr className="text-left uppercase tracking-wide text-muted-foreground">
                          <th className="px-2 py-1.5 font-semibold w-8">#</th>
                          <th className="px-2 py-1.5 font-semibold">Instruction</th>
                          <th className="px-2 py-1.5 font-semibold">Résultat</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {algo.map((st, i) => (
                          <tr key={i}
                            title={st.explication || ""}
                            onMouseEnter={() => setHover(i)}
                            onMouseLeave={() => setHover(null)}
                            className={`${!st.avert ? "hover:bg-muted/20" : ""} ${hover === i ? "ring-1 ring-accent/40" : ""} cursor-help`}
                            style={st.avert ? { background: "hsl(var(--warning) / 0.05)" } : undefined}>
                            <td className="px-2 py-1.5 text-muted-foreground align-top">{i + 1}</td>
                            <td className="px-2 py-1.5 font-mono text-foreground align-top break-all">
                              {st.instruction || "—"}
                              {st.avert && (
                                <div className="mt-0.5 font-sans flex items-start gap-1" style={{ color: "hsl(var(--warning))" }}>
                                  <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /> {st.avert}
                                </div>
                              )}
                            </td>
                            <td className="px-2 py-1.5 font-mono text-accent align-top break-all">{st.resolu || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {/* Explication en français de la ligne survolée */}
                {hover !== null && algo[hover]?.explication && (
                  <div className="rounded-md border border-accent/30 bg-accent/5 px-2.5 py-2 text-[11px] leading-snug text-foreground">
                    <span className="font-semibold text-accent">Étape {hover + 1} — </span>
                    {algo[hover].explication}
                  </div>
                )}
                {averts.map((a, i) => (
                  <div key={i} className="text-xs flex items-start gap-1" style={{ color: "hsl(var(--warning))" }}>
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /> {a}
                  </div>
                ))}
              </div>
            );
          })() : (
            <div className="text-xs text-muted-foreground">
              Détail disponible après un calcul (non tracé sur un bulletin enregistré).
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TraceLigne({ etape }: { etape: TraceEtape }) {
  const r = etape.resultat;
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium text-sm">
          {etape.libelle || etape.rubrique}
          <span className="text-xs text-muted-foreground ml-2">
            {etape.rubrique} · {etape.type ?? "?"}/{etape.type_regle ?? "?"}
          </span>
        </div>
        {r && (
          <div className="text-xs tabular-nums text-muted-foreground shrink-0">
            MT <b className="text-foreground">{r.MT}</b>
            {r.NB !== "0.0000" && <> · NB {r.NB}</>}
            {r.TY !== "0.0000" && <> · TY {r.TY}</>}
            {r.MT_PAT && r.MT_PAT !== "0.00" && <> · PAT {r.MT_PAT}</>}
          </div>
        )}
      </div>
      {etape.detail?.filter(Boolean).map((d, i) => (
        <div key={i} className="mt-1 text-xs font-mono text-muted-foreground pl-3 border-l-2 border-muted">{d}</div>
      ))}
      {etape.avert?.map((a, i) => (
        <div key={i} className="mt-1 text-xs flex items-center gap-1 pl-3" style={{ color: "hsl(var(--warning))" }}>
          <AlertTriangle className="h-3 w-3" /> {a}
        </div>
      ))}
    </div>
  );
}
