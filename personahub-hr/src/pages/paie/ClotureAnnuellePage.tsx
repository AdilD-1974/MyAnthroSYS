/**
 * ClotureAnnuellePage — Clôture annuelle de la paie (verrou d'exercice).
 * Auteur : Adil DAIA
 *
 * Route : /paie/fin-annee
 * Choix d'un plan → tableau des exercices (années) avec avancement des
 * clôtures de période, statut de l'année, et actions Clôturer / Réouvrir.
 * La RAZ des cumuls est logique (bornage par année + fréquence de RAZ des
 * rubriques) : aucun effacement, les cumuls restent consultables.
 */
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Lock, Unlock, Loader2, AlertTriangle, CalendarCheck } from "lucide-react";
import { db } from "@/lib/api";
import { listerAnnees, cloturerAnnee, rouvrirAnnee, type AnneePaie } from "@/lib/paieApi";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

type Plan = { id: string; code: string; libelle: string };
type Cal = { annee: number; statut: string };
type LigneAnnee = { annee: number; nbPeriodes: number; nbCloturees: number; statut: string };

export default function ClotureAnnuellePage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planId, setPlanId] = useState("");
  const [lignes, setLignes] = useState<LigneAnnee[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<{ annee: number; message: string } | null>(null);

  useEffect(() => {
    db.list<Plan>("plan_paie", { select: "id,code,libelle", actif: true, limit: 200 })
      .then((ps) => { setPlans(ps); if (ps[0]) setPlanId(ps[0].id); })
      .catch((e) => toast.error("Chargement des plans impossible", { description: e.message }));
  }, []);

  const charger = async (pid: string) => {
    if (!pid) return;
    setLoading(true);
    try {
      const [cal, annees] = await Promise.all([
        db.list<Cal>("calendrier_paie", { plan_paie_id: pid, select: "annee,statut", limit: 2000 }),
        listerAnnees(pid),
      ]);
      const statutAnnee = new Map(annees.map((a: AnneePaie) => [a.annee, a.statut]));
      const parAnnee = new Map<number, { total: number; clot: number }>();
      cal.forEach((c) => {
        const e = parAnnee.get(c.annee) ?? { total: 0, clot: 0 };
        e.total += 1;
        if (c.statut === "CLOTUREE") e.clot += 1;
        parAnnee.set(c.annee, e);
      });
      const rows: LigneAnnee[] = Array.from(parAnnee.entries())
        .map(([annee, v]) => ({
          annee, nbPeriodes: v.total, nbCloturees: v.clot,
          statut: statutAnnee.get(annee) ?? (v.total > 0 && v.clot === v.total ? "CLOTUREE" : "OUVERTE"),
        }))
        .sort((a, b) => b.annee - a.annee);
      setLignes(rows);
    } catch (e: any) {
      toast.error("Chargement des exercices impossible", { description: e.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { charger(planId); }, [planId]); // eslint-disable-line react-hooks/exhaustive-deps

  const plan = useMemo(() => plans.find((p) => p.id === planId), [plans, planId]);

  async function cloturer(annee: number, forcer: boolean) {
    setBusy(annee);
    try {
      const res = await cloturerAnnee(planId, annee, forcer);
      if (res.cloturee) {
        setConfirm(null);
        toast.success(`Exercice ${annee} clôturé (${res.nb_periodes_cloturees} période(s), ${res.nb_bulletins_clotures} bulletin(s))`);
        charger(planId);
      } else if (res.confirmation_requise) {
        setConfirm({ annee, message: res.message });
      }
    } catch (e: any) {
      toast.error("Clôture impossible", { description: e.message });
    } finally {
      setBusy(null);
    }
  }

  async function rouvrir(annee: number) {
    setBusy(annee);
    try {
      await rouvrirAnnee(planId, annee);
      toast.success(`Exercice ${annee} réouvert`);
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
        <h1 className="text-2xl font-semibold tracking-tight">Clôture annuelle</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Verrouille un exercice : toutes ses périodes sont clôturées. Les cumuls restent consultables (RAZ logique).
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="max-w-sm space-y-1.5">
            <label className="text-sm font-medium">Plan de paie</label>
            <Select value={planId} onValueChange={setPlanId}>
              <SelectTrigger><SelectValue placeholder="Sélectionner…" /></SelectTrigger>
              <SelectContent>
                {plans.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.code} · {p.libelle}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : lignes.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-12 border border-dashed rounded-lg">
          Aucun exercice pour ce plan.
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Exercice</TableHead>
                  <TableHead>Avancement des clôtures</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lignes.map((l) => {
                  const cloture = l.statut === "CLOTUREE";
                  return (
                    <TableRow key={l.annee}>
                      <TableCell className="font-medium">{l.annee}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-64 rounded bg-muted overflow-hidden">
                            <div className="h-full bg-emerald-500" style={{ width: `${l.nbPeriodes ? (l.nbCloturees / l.nbPeriodes) * 100 : 0}%` }} />
                          </div>
                          {l.nbCloturees}/{l.nbPeriodes} période(s)
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${cloture ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700"}`}>
                          {cloture ? <Lock className="h-3 w-3" /> : <CalendarCheck className="h-3 w-3" />}
                          {cloture ? "Clôturé" : "Ouvert"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {cloture ? (
                          <Button variant="outline" size="sm" onClick={() => rouvrir(l.annee)} disabled={busy === l.annee}>
                            {busy === l.annee ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlock className="h-4 w-4" />}
                            Réouvrir
                          </Button>
                        ) : (
                          <Button size="sm" onClick={() => cloturer(l.annee, false)} disabled={busy === l.annee}>
                            {busy === l.annee ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
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

      {/* Confirmation si bulletins non validés */}
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" /> Clôturer l'exercice {confirm?.annee} ?
            </DialogTitle>
            <DialogDescription>
              {confirm?.message} La clôture verrouillera l'exercice malgré cela. Les bulletins non validés ne seront pas clôturés.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Annuler</Button>
            <Button onClick={() => confirm && cloturer(confirm.annee, true)} disabled={busy !== null}>
              {busy !== null ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              Clôturer quand même
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
