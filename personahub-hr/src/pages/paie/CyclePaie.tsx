/**
 * CyclePaie — Cycle de vie d'un bulletin : validation contrôlée, clôture, historique.
 * Auteur : Adil DAIA
 *
 * S'affiche sous l'en-tête du bulletin dès qu'il est enregistré (bulletin_id).
 * Enchaîne : Contrôler (aperçu) → Valider (avec rapport de contrôles :
 * bloquants refusent, alertes demandent confirmation) → Clôturer la période.
 */
import React, { useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2, XCircle, AlertTriangle, ShieldCheck, Lock, Unlock, History,
  Loader2, ClipboardCheck, RotateCcw,
} from "lucide-react";
import {
  controlerBulletin, validerBulletin, devaliderBulletin, historiqueBulletin,
  cloturerPeriode, rouvrirPeriode,
  type RapportControle, type HistoriqueItem,
} from "@/lib/paieApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

const STATUT_BADGE: Record<string, { label: string; cls: string }> = {
  CALCULE: { label: "Temporaire", cls: "bg-slate-100 text-slate-700" },
  VALIDE: { label: "Validé", cls: "bg-emerald-600 text-white" },
  CLOTURE: { label: "Clôturé", cls: "bg-indigo-600 text-white" },
  ERREUR: { label: "Erreur", cls: "bg-rose-600 text-white" },
};

const ACTION_LABEL: Record<string, string> = {
  CALCUL: "Calcul", VALIDATION: "Validation", DEVALIDATION: "Dévalidation",
  CLOTURE: "Clôture", REOUVERTURE: "Réouverture", FORCAGE: "Validation (forcée)",
};

export default function CyclePaie({ bulletinId, periodeId, statutInitial, onStatut }: {
  bulletinId: string; periodeId: string; statutInitial?: string | null; onStatut?: (s: string) => void;
}) {
  const [statut, setStatut] = useState(statutInitial || "CALCULE");
  const [rapport, setRapport] = useState<RapportControle | null>(null);
  const [rapportOpen, setRapportOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [histOpen, setHistOpen] = useState(false);
  const [hist, setHist] = useState<HistoriqueItem[]>([]);
  const [clotureMsg, setClotureMsg] = useState<string | null>(null);

  const maj = (s: string) => { setStatut(s); onStatut?.(s); };
  const badge = STATUT_BADGE[statut] ?? STATUT_BADGE.CALCULE;

  async function apercu() {
    setBusy("controler");
    try {
      const r = await controlerBulletin(bulletinId);
      setRapport(r); setRapportOpen(true);
    } catch (e: any) { toast.error("Contrôle impossible", { description: e.message }); }
    finally { setBusy(null); }
  }

  async function valider(forcer: boolean) {
    setBusy("valider");
    try {
      const res = await validerBulletin(bulletinId, forcer);
      setRapport(res.rapport);
      if (res.valide) {
        maj(res.statut); setRapportOpen(false);
        toast.success("Bulletin validé");
      } else if (res.confirmation_requise) {
        setRapportOpen(true);
        toast.warning(`${res.rapport.alertes_ko} alerte(s) — confirme la validation`);
      } else {
        setRapportOpen(true);
        toast.error(`${res.rapport.bloquants_ko} contrôle(s) bloquant(s) — validation refusée`);
      }
    } catch (e: any) { toast.error("Validation impossible", { description: e.message }); }
    finally { setBusy(null); }
  }

  async function devalider() {
    setBusy("devalider");
    try {
      const res = await devaliderBulletin(bulletinId);
      maj(res.statut); toast.success("Bulletin repassé en temporaire");
    } catch (e: any) { toast.error("Dévalidation impossible", { description: e.message }); }
    finally { setBusy(null); }
  }

  async function cloturer(forcer: boolean) {
    setBusy("cloturer");
    try {
      const res = await cloturerPeriode(periodeId, forcer);
      if (res.cloturee) {
        maj("CLOTURE"); setClotureMsg(null);
        toast.success(`Période clôturée (${res.nb_cloturees} bulletin(s))`);
      } else if (res.confirmation_requise) {
        setClotureMsg(res.message);
        toast.warning(res.message);
      }
    } catch (e: any) { toast.error("Clôture impossible", { description: e.message }); }
    finally { setBusy(null); }
  }

  async function rouvrir() {
    setBusy("rouvrir");
    try {
      await rouvrirPeriode(periodeId);
      maj("VALIDE"); toast.success("Période réouverte");
    } catch (e: any) { toast.error("Réouverture impossible", { description: e.message }); }
    finally { setBusy(null); }
  }

  async function ouvrirHistorique() {
    try {
      setHist(await historiqueBulletin(bulletinId)); setHistOpen(true);
    } catch (e: any) { toast.error("Historique indisponible", { description: e.message }); }
  }

  const spin = (k: string) => busy === k;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-4 py-2.5">
      <span className={`rounded px-2 py-0.5 text-xs font-medium ${badge.cls}`}>{badge.label}</span>
      <span className="text-sm text-muted-foreground mr-2">Cycle de vie</span>

      <Button variant="outline" size="sm" onClick={apercu} disabled={!!busy}>
        {spin("controler") ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
        Contrôler
      </Button>

      {statut === "CALCULE" && (
        <Button size="sm" onClick={() => valider(false)} disabled={!!busy}>
          {spin("valider") ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          Valider
        </Button>
      )}

      {statut === "VALIDE" && (
        <>
          <Button variant="outline" size="sm" onClick={devalider} disabled={!!busy}>
            {spin("devalider") ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            Dévalider
          </Button>
          <Button size="sm" onClick={() => cloturer(false)} disabled={!!busy}>
            {spin("cloturer") ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            Clôturer la période
          </Button>
        </>
      )}

      {statut === "CLOTURE" && (
        <Button variant="outline" size="sm" onClick={rouvrir} disabled={!!busy}>
          {spin("rouvrir") ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlock className="h-4 w-4" />}
          Réouvrir la période
        </Button>
      )}

      <Button variant="ghost" size="sm" onClick={ouvrirHistorique} disabled={!!busy}>
        <History className="h-4 w-4" /> Historique
      </Button>

      {clotureMsg && (
        <div className="flex items-center gap-2 w-full text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-1.5 mt-1">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {clotureMsg}
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => cloturer(true)} disabled={!!busy}>
            Clôturer quand même
          </Button>
        </div>
      )}

      {/* Rapport de contrôles */}
      <Dialog open={rapportOpen} onOpenChange={setRapportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Rapport de contrôles</DialogTitle>
            <DialogDescription>
              {rapport && (
                <>
                  {rapport.bloquants_ko > 0 && <span className="text-rose-600 font-medium">{rapport.bloquants_ko} bloquant(s). </span>}
                  {rapport.alertes_ko > 0 && <span className="text-amber-700 font-medium">{rapport.alertes_ko} alerte(s). </span>}
                  {rapport.bloquants_ko === 0 && rapport.alertes_ko === 0 && <span className="text-emerald-700 font-medium">Tous les contrôles passent.</span>}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[50vh] pr-3">
            <ul className="space-y-1.5">
              {rapport?.controles.map((c) => (
                <li key={c.code} className="flex items-start gap-2 text-sm">
                  {c.ok ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                  ) : c.niveau === "BLOQUANT" ? (
                    <XCircle className="h-4 w-4 text-rose-600 mt-0.5 shrink-0" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                  )}
                  <div>
                    <span className={c.ok ? "text-muted-foreground" : "font-medium"}>{c.libelle}</span>
                    <span className="text-xs text-muted-foreground ml-1.5">({c.categorie.toLowerCase()})</span>
                    {!c.ok && c.message && <div className="text-xs text-muted-foreground">{c.message}</div>}
                  </div>
                </li>
              ))}
            </ul>
          </ScrollArea>
          <DialogFooter>
            {rapport && rapport.bloquants_ko === 0 && rapport.alertes_ko > 0 && statut === "CALCULE" && (
              <Button onClick={() => valider(true)} disabled={!!busy}>
                {spin("valider") ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Valider malgré les alertes
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Historique */}
      <Dialog open={histOpen} onOpenChange={setHistOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Historique du bulletin</DialogTitle></DialogHeader>
          <ScrollArea className="max-h-[50vh] pr-3">
            {hist.length === 0 ? (
              <div className="text-sm text-muted-foreground">Aucun événement enregistré.</div>
            ) : (
              <ul className="space-y-2">
                {hist.map((h) => (
                  <li key={h.id} className="text-sm border-l-2 border-muted pl-3">
                    <div className="font-medium">{ACTION_LABEL[h.action] ?? h.action}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(h.created_at).toLocaleString("fr-MA")}
                      {h.statut_avant && h.statut_apres && ` · ${h.statut_avant} → ${h.statut_apres}`}
                    </div>
                    {h.decision && <div className="text-xs text-muted-foreground">{h.decision}</div>}
                    {h.commentaire && <div className="text-xs italic text-muted-foreground">{h.commentaire}</div>}
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
