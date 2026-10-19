/**
 * ConsultationBulletinPage — Consultation en lecture seule d'un bulletin
 * VALIDÉ (bulletin) ou CLÔTURÉ (bulletin_historique).
 * Auteur : Adil DAIA
 *
 * Route : /paie/consultation/bulletin-detail (nouvelle entrée de menu
 *   "paie_consultation_bulletin_detail" — /paie/consultation/bulletins était
 *   déjà pris par HistoriqueCollaborateurPage)
 * - Même cascade Collaborateur → Plan actif → Année → Période que
 *   TraitementPaiePage.tsx, mais AUCUNE action de calcul/enregistrement/
 *   suppression : on affiche uniquement ce qui a déjà été persisté et
 *   officialisé (jamais un précalcul TEMP).
 * - Chargement automatique à la sélection de la période (pas de bouton
 *   "Consulter" à cliquer en plus).
 */
import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { ChevronsUpDown, Check, History, FileX2 } from "lucide-react";
import { db } from "@/lib/api";
import {
  listerBulletins, bulletinToResult,
  type CalculBulletinResult, type BulletinRead,
} from "@/lib/paieApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { buildTrail } from "@/components/navigation/ReturnTrail";
import { Resultat } from "../TraitementPaiePage";

// ---- Types locaux (mêmes conventions que TraitementPaiePage.tsx) --------
type Collab = { id: string; matricule: string; nom: string; prenom: string };
type Periode = { id: string; annee: number; mois: number; plan_paie_id: string | null; statut: string; numero_periode: number; date_ouverture?: string | null };
type Plan = { id: string; code: string; libelle: string };

const MOIS = ["", "Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];
const SEL_KEY = "paie.consultation.selection";

/**
 * Ne retient que les bulletins « officiels » (validés ou clôturés) — jamais
 * un précalcul TEMP, qui n'a de sens que sur l'écran de traitement. En
 * théorie une période n'a qu'un seul état persistant à un instant donné
 * (bulletin_temp → bulletin → bulletin_historique, migration, pas
 * duplication), mais on privilégie HISTORIQUE/CLOTURE si jamais les deux
 * devaient coexister, la version clôturée étant définitive. CLOTURE (encore
 * dans `bulletin`, avant clôture annuelle) et HISTORIQUE (dans
 * `bulletin_historique`) sont toutes deux "clôturées" pour l'utilisateur —
 * seule la table physique diffère (RG-BULLETIN-ORIGINE-VRAI-STATUT-01).
 */
function bulletinOfficiel(list: BulletinRead[]): BulletinRead | null {
  const officiels = list.filter((b) => b.origine === "VALIDE" || b.origine === "HISTORIQUE" || b.origine === "CLOTURE");
  if (!officiels.length) return null;
  const ordre: Record<string, number> = { HISTORIQUE: 0, CLOTURE: 0, VALIDE: 1 };
  return [...officiels].sort((a, b) => (ordre[a.origine] ?? 9) - (ordre[b.origine] ?? 9))[0];
}

export default function ConsultationBulletinPage() {
  const [collabs, setCollabs] = useState<Collab[]>([]);
  const [plans, setPlans] = useState<Record<string, Plan>>({});
  const [refLoading, setRefLoading] = useState(true);

  const [collabId, setCollabId] = useState<string>("");
  const [collabOpen, setCollabOpen] = useState(false);

  const [planActif, setPlanActif] = useState<Plan | null>(null);
  const [periodesPlan, setPeriodesPlan] = useState<Periode[]>([]);
  const [annee, setAnnee] = useState<number | null>(null);
  const [periodeId, setPeriodeId] = useState<string>("");
  const [pendingSel, setPendingSel] = useState<{ annee?: number; periodeId?: string } | null>(null);

  const [result, setResult] = useState<CalculBulletinResult | null>(null);
  const [prevTotaux, setPrevTotaux] = useState<CalculBulletinResult["totaux"] | null>(null);
  const [chargement, setChargement] = useState(false);
  // Distingue "jamais interrogé" de "interrogé, rien d'officiel trouvé" pour
  // ne pas afficher le message d'absence avant la première sélection.
  const [introuvable, setIntrouvable] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();

  // Restauration du contexte (retour via fil d'Ariane ou reprise de session)
  useEffect(() => {
    const restore = (location.state as any)?.restore as { collabId?: string; annee?: number; periodeId?: string } | undefined;
    if (restore?.collabId) {
      setCollabId(restore.collabId);
      setPendingSel({ annee: restore.annee, periodeId: restore.periodeId });
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

  useEffect(() => {
    if (collabId) sessionStorage.setItem(SEL_KEY, JSON.stringify({ collabId, annee, periodeId }));
  }, [collabId, annee, periodeId]);

  const trailVersIci = () =>
    buildTrail(
      { path: "/paie/consultation/bulletin-detail", label: "Consultation du bulletin", state: { restore: { collabId, annee, periodeId } } },
      (location.state as any)?.returnTo,
    );

  const ouvrirRubrique = (code: string) =>
    navigate("/paie/parametrage", { state: { openRubrique: code, returnTo: trailVersIci() } });

  const ouvrirCollaborateur = () => {
    if (collabId) navigate(`/collaborateurs/${collabId}`, { state: { returnTo: trailVersIci() } });
  };

  // Référentiels
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

  // Cascade : plan actif + périodes du collaborateur sélectionné
  useEffect(() => {
    if (!collabId || Object.keys(plans).length === 0) return;
    (async () => {
      setPlanActif(null); setPeriodesPlan([]); setAnnee(null); setPeriodeId(""); setResult(null); setIntrouvable(false);
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
        const anneesDispo = Array.from(new Set(pers.map((p) => p.annee))).sort((a, b) => b - a);
        const anSel = (pendingSel?.annee && anneesDispo.includes(pendingSel.annee)) ? pendingSel.annee : (anneesDispo[0] ?? null);
        setAnnee(anSel);
        const dansAnnee = pers.filter((p) => p.annee === anSel);
        // Contrairement au traitement, on part de préférence sur la période
        // la plus récente déjà passée (plus de chances d'avoir un bulletin
        // officiel) plutôt que la première période ouverte à venir.
        const perSel = (pendingSel?.periodeId && dansAnnee.some((p) => p.id === pendingSel.periodeId))
          ? pendingSel.periodeId
          : ([...dansAnnee].sort((a, b) => b.mois - a.mois)[0]?.id || "");
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
    setPeriodeId([...dans].sort((a, b) => b.mois - a.mois)[0]?.id || "");
  };

  const collab = collabs.find((c) => c.id === collabId);
  const periodeLabel = (p: Periode) => `${MOIS[p.mois]} ${p.annee}`;

  // Chargement automatique du bulletin officiel dès que la période change
  useEffect(() => {
    if (!collabId || !periodeId) { setResult(null); setIntrouvable(false); return; }
    let annule = false;
    (async () => {
      setChargement(true);
      setResult(null);
      setIntrouvable(false);
      try {
        const list = await listerBulletins({ collaborateur_id: collabId, periode_id: periodeId });
        if (annule) return;
        const bulletin = bulletinOfficiel(list);
        if (!bulletin) { setIntrouvable(true); return; }
        setResult(bulletinToResult(bulletin));
      } catch (e: any) {
        if (!annule) toast.error("Consultation impossible", { description: e.message });
      } finally {
        if (!annule) setChargement(false);
      }
    })();
    return () => { annule = true; };
  }, [collabId, periodeId]);

  // Variance vs période officielle précédente
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
        const b = bulletinOfficiel(list);
        setPrevTotaux(b ? bulletinToResult(b).totaux : null);
      } catch { if (!annule) setPrevTotaux(null); }
    })();
    return () => { annule = true; };
  }, [result, collabId, periodeId, periodesPlan]);

  return (
    <div className="p-6 space-y-6 w-full">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Consultation du bulletin</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Consulte le bulletin déjà validé ou clôturé d'un collaborateur pour une période — lecture seule.
        </p>
      </div>

      {/* Barre de sélection */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1.6fr_1.1fr_0.7fr_1fr] md:items-end">
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

            {/* Plan de paie actif */}
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
                    <SelectItem key={p.id} value={p.id}>{periodeLabel(p)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {(refLoading || chargement) && <Skeleton className="h-40 w-full" />}

      {!chargement && result && (
        <>
          <div className="flex items-center gap-2">
            <Badge
              className="inline-flex items-center gap-1"
              style={
                result.origine === "HISTORIQUE" || result.origine === "CLOTURE"
                  ? { background: "hsl(var(--muted-foreground))", color: "#fff" }
                  : { background: "hsl(var(--success))", color: "#fff" }
              }
            >
              <History className="h-3 w-3" />
              {result.origine === "HISTORIQUE" || result.origine === "CLOTURE" ? "Clôturé (archivé)" : "Validé"}
            </Badge>
          </div>
          <Resultat
            result={result}
            prevTotaux={prevTotaux}
            onOpenCollab={ouvrirCollaborateur}
            onOpenRubrique={ouvrirRubrique}
            panneauCycle={false}
            ecranEdition="consultation_bulletin"
          />
        </>
      )}

      {!chargement && !result && introuvable && (
        <div className="flex flex-col items-center gap-2 text-center text-sm text-muted-foreground py-16 border border-dashed rounded-lg">
          <FileX2 className="h-8 w-8 opacity-50" />
          <div>Aucun bulletin validé ou clôturé pour cette période.</div>
          <div className="text-xs">
            Un précalcul existe peut-être encore — utilisez l'écran « Traitement de la paie » pour le valider.
          </div>
        </div>
      )}

      {!refLoading && !chargement && !result && !introuvable && (
        <div className="text-center text-sm text-muted-foreground py-16 border border-dashed rounded-lg">
          Sélectionne un collaborateur et une période.
        </div>
      )}
    </div>
  );
}
