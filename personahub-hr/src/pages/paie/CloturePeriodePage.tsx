/**
 * CloturePeriodePage — Clôture des périodes de paie.
 * Auteur : Adil DAIA
 *
 * Route : /paie/fin-periode
 * Plan → année → tableau des périodes avec avancement (bulletins validés),
 * statut et actions Clôturer / Réouvrir. Réutilise les endpoints
 * /paie/periodes/{id}/cloturer et /rouvrir.
 */
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Lock, Unlock, Loader2, AlertTriangle, CalendarCheck } from "lucide-react";
import { db } from "@/lib/api";
import { cloturerPeriode, rouvrirPeriode, synthesePaie, type SynthesePeriode } from "@/lib/paieApi";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

const MOIS = ["", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

type Plan = { id: string; code: string; libelle: string };
type Periode = { id: string; annee: number; mois: number; statut: string; numero_periode: number; date_ouverture?: string | null };

export default function CloturePeriodePage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planId, setPlanId] = useState("");
  const [periodes, setPeriodes] = useState<Periode[]>([]);
  const [effectifs, setEffectifs] = useState<Map<string, SynthesePeriode>>(new Map());
  const [chargementEffectifs, setChargementEffectifs] = useState(false);
  const [annee, setAnnee] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; label: string; message: string } | null>(null);

  useEffect(() => {
    db.list<Plan>("plan_paie", { select: "id,code,libelle", actif: true, limit: 200 })
      .then((ps) => { setPlans(ps); if (ps[0]) setPlanId(ps[0].id); })
      .catch((e) => toast.error("Chargement des plans impossible", { description: e.message }));
  }, []);

  const charger = async (pid: string) => {
    if (!pid) return;
    setLoading(true);
    try {
      const pers = await db.list<Periode>("calendrier_paie", { plan_paie_id: pid, select: "id,annee,mois,statut,numero_periode,date_ouverture", order: "-annee", limit: 1000 });
      pers.sort((a, b) => b.annee - a.annee || a.mois - b.mois);
      setPeriodes(pers);
      const annees = Array.from(new Set(pers.map((p) => p.annee))).sort((a, b) => b - a);
      setAnnee((prev) => (prev && annees.includes(prev) ? prev : annees[0] ?? null));
    } catch (e: any) {
      toast.error("Chargement des périodes impossible", { description: e.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { charger(planId); }, [planId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Effectif RÉELLEMENT attendu par période (pas seulement les bulletins déjà
  // calculés — un collaborateur sans bulletin du tout ne doit pas passer
  // inaperçu). `detail_periodes=true` renvoie une ligne par vraie période
  // (et non un agrégat mensuel), avec periode_id pour indexer directement.
  useEffect(() => {
    if (!planId || !annee) { setEffectifs(new Map()); return; }
    setChargementEffectifs(true);
    synthesePaie([planId], annee, undefined, false, true)
      .then((r) => {
        const m = new Map<string, SynthesePeriode>();
        r.periodes.forEach((p) => { if (p.periode_id) m.set(p.periode_id, p); });
        setEffectifs(m);
      })
      .catch((e) => toast.error("Chargement de l'effectif impossible", { description: e.message }))
      .finally(() => setChargementEffectifs(false));
  }, [planId, annee]);

  const anneesDispo = useMemo(() => Array.from(new Set(periodes.map((p) => p.annee))).sort((a, b) => b - a), [periodes]);
  const periodesAnnee = useMemo(() => periodes.filter((p) => p.annee === annee), [periodes, annee]);

  async function cloturer(id: string, forcer: boolean) {
    setBusy(id);
    try {
      const res = await cloturerPeriode(id, forcer);
      if (res.cloturee) {
        setConfirm(null);
        toast.success(`Période clôturée (${res.nb_cloturees} bulletin(s))`);
        charger(planId);
      } else if (res.confirmation_requise) {
        const p = periodes.find((x) => x.id === id);
        setConfirm({ id, label: p ? `${MOIS[p.mois]} ${p.annee}` : "", message: res.message });
      }
    } catch (e: any) {
      toast.error("Clôture impossible", { description: e.message });
    } finally {
      setBusy(null);
    }
  }

  async function rouvrir(id: string) {
    setBusy(id);
    try {
      await rouvrirPeriode(id);
      toast.success("Période réouverte");
      charger(planId);
    } catch (e: any) {
      toast.error("Réouverture impossible", { description: e.message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clôture de période</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Verrouille une période : ses bulletins validés passent en clôturé et ne sont plus modifiables.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-4 sm:grid-cols-2 max-w-lg">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Plan de paie</label>
              <Select value={planId} onValueChange={setPlanId}>
                <SelectTrigger><SelectValue placeholder="Sélectionner…" /></SelectTrigger>
                <SelectContent>
                  {plans.map((p) => <SelectItem key={p.id} value={p.id}>{p.code} · {p.libelle}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Année</label>
              <Select value={annee ? String(annee) : ""} onValueChange={(v) => setAnnee(Number(v))} disabled={!anneesDispo.length}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {anneesDispo.map((a) => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : periodesAnnee.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-12 border border-dashed rounded-lg">
          Aucune période pour cette sélection.
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow style={{ background: "hsl(var(--muted) / 0.5)" }}>
                  <TableHead className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Période</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Bulletins</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Statut</TableHead>
                  <TableHead className="text-right text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periodesAnnee.map((p) => {
                  const eff = effectifs.get(p.id);
                  const effectif = eff?.effectif ?? 0;
                  const prets = (eff?.valides ?? 0) + (eff?.clotures ?? 0);
                  const manquent = Math.max(0, effectif - prets);
                  const bloque = manquent > 0;
                  const cloture = p.statut === "CLOTUREE";
                  const today = new Date().toISOString().slice(0, 10);
                  const nonOuverte = !cloture && !!p.date_ouverture && p.date_ouverture > today;
                  const pctValides = effectif ? (prets / effectif) * 100 : 0;
                  return (
                    <TableRow key={p.id} className="hover:bg-muted/40 transition-colors">
                      <TableCell className="font-medium">{MOIS[p.mois]} {p.annee}</TableCell>
                      <TableCell className="text-sm">
                        <div className="flex items-center gap-3">
                          {/* Barre à deux couleurs réelles : le segment "restants" est
                              coloré explicitement (pas juste un fond neutre vide), pour
                              que le déficit se voie autant que l'avancement. */}
                          <div className="h-2 w-56 rounded-full overflow-hidden flex shrink-0" style={{ background: "hsl(var(--muted))" }}>
                            <div className="h-full transition-all" style={{ width: `${pctValides}%`, background: "hsl(var(--success))" }} />
                            <div className="h-full transition-all" style={{ width: `${100 - pctValides}%`, background: "hsl(var(--warning))" }} />
                          </div>
                          {chargementEffectifs ? (
                            <span className="text-muted-foreground">…</span>
                          ) : (
                            <span className="whitespace-nowrap">
                              <span className="font-medium" style={{ color: "hsl(var(--success))" }}>{prets} validé{prets > 1 ? "s" : ""}</span>
                              {manquent > 0 && (
                                <>
                                  <span className="text-muted-foreground"> · </span>
                                  <span className="font-medium" style={{ color: "hsl(var(--warning))" }}>{manquent} restant{manquent > 1 ? "s" : ""}</span>
                                </>
                              )}
                              <span className="text-muted-foreground"> / {effectif}</span>
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                          style={
                            cloture
                              ? { background: "hsl(var(--accent) / 0.15)", color: "hsl(var(--accent))" }
                              : nonOuverte
                                ? { background: "hsl(var(--warning) / 0.15)", color: "hsl(var(--warning))" }
                                : { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }
                          }
                        >
                          {cloture ? <Lock className="h-3 w-3" /> : <CalendarCheck className="h-3 w-3" />}
                          {cloture ? "Clôturée" : nonOuverte ? "Non ouverte" : "Ouverte"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {cloture ? (
                          <Button variant="outline" size="sm" onClick={() => rouvrir(p.id)} disabled={busy === p.id}
                            style={{ borderColor: "hsl(var(--accent) / 0.4)", color: "hsl(var(--accent))" }}>
                            {busy === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlock className="h-4 w-4" />}
                            Réouvrir
                          </Button>
                        ) : nonOuverte ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : bloque ? (
                          <div className="flex flex-col items-end gap-1">
                            <Button size="sm" disabled title={`${manquent} bulletin(s) de l'effectif à payer non validé(s) — la clôture est bloquée tant que tout n'est pas validé.`}>
                              <Lock className="h-4 w-4" />
                              Clôturer
                            </Button>
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: "hsl(var(--warning))" }}>
                              <AlertTriangle className="h-3 w-3" />
                              {manquent} bulletin(s) non validé(s)
                            </span>
                          </div>
                        ) : (
                          <Button size="sm" onClick={() => cloturer(p.id, false)} disabled={busy === p.id}>
                            {busy === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                            Clôturer
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" style={{ color: "hsl(var(--warning))" }} /> Clôturer {confirm?.label} ?
            </DialogTitle>
            <DialogDescription>
              {confirm?.message} Les bulletins non validés ne seront pas clôturés.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Annuler</Button>
            <Button onClick={() => confirm && cloturer(confirm.id, true)} disabled={busy !== null}>
              {busy !== null ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              Clôturer quand même
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
