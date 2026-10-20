/**
 * EcranNavigation.tsx — Écrans d'édition dans la navigation de l'application.
 * Auteur : Adil DAIA — 20/10/2026 — RG-EDT-NAV-02..04
 *
 * BoutonEcranNavigation : fait d'un état publié (ou d'un dossier du menu d'éditions) un ÉCRAN de
 *   l'application, visible ensuite dans Configuration › Navigation (section, ordre, rôles s'y règlent).
 * EtatEcranPage (/editions/etat/:code?module=PAIE) : l'écran généré pour un état — ses paramètres
 *   et sa production, sans passer par l'arborescence.
 */
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { KeyRound, Loader2, MonitorCheck, MonitorUp, MonitorX, ShieldCheck } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ReturnTrail from "@/components/navigation/ReturnTrail";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { editionsApi, type AccesEtat, type ModeleEcran } from "@/lib/editionsApi";
import { PanneauProduction } from "./LanceurEcran";
import "./editions.css";

type Etat = { disponible: boolean; existe: boolean; peut_generer: boolean; chemin?: string; libelle?: string };

export function BoutonEcranNavigation({ type, id, libelle, compact }: { type: "MODELE" | "DOSSIER"; id: string; libelle: string; compact?: boolean }) {
  const [etat, setEtat] = useState<Etat | null>(null);
  const [occupe, setOccupe] = useState(false);
  const charger = () => editionsApi.ecranNavigation(type, id).then(setEtat).catch(() => setEtat(null));
  useEffect(() => { charger(); }, [type, id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!etat?.disponible || (!etat.peut_generer && !etat.existe)) return null;
  const quoi = type === "MODELE" ? "cet état" : "ce dossier";
  const generer = async () => {
    setOccupe(true);
    try {
      const r = await editionsApi.genererEcran(type, id);
      toast({ title: r.cree ? "Écran créé dans la navigation" : "Écran mis à jour",
        description: `« ${r.libelle} » (${r.chemin}) — placez-le et choisissez ses rôles dans Configuration › Navigation, puis rechargez la page.` });
      charger();
    } catch (e: any) { toast({ title: "Création impossible", description: e.message, variant: "destructive" }); } finally { setOccupe(false); }
  };
  const retirer = async () => {
    if (!window.confirm(`Retirer l'écran « ${etat.libelle ?? libelle} » de la navigation ? ${type === "MODELE" ? "L'état" : "Le dossier"} reste disponible ici.`)) return;
    setOccupe(true);
    try { await editionsApi.retirerEcran(type, id); toast({ title: "Écran retiré de la navigation" }); charger(); }
    catch (e: any) { toast({ title: "Retrait impossible", description: e.message, variant: "destructive" }); } finally { setOccupe(false); }
  };
  if (etat.existe) {
    return (
      <span className="inline-flex items-center gap-1 text-xs">
        <span className="inline-flex items-center gap-1 rounded bg-[hsl(var(--success)/0.12)] px-1.5 py-0.5 text-[hsl(var(--success))]"
          title={`Écran de la navigation : ${etat.chemin}`}><MonitorCheck className="h-3.5 w-3.5" />{compact ? "" : "Écran dans la navigation"}</span>
        {etat.peut_generer && (
          <button type="button" disabled={occupe} onClick={retirer} title="Retirer l'écran de la navigation"
            className="rounded p-1 hover:bg-muted"><MonitorX className="h-3.5 w-3.5 text-[hsl(var(--destructive))]" /></button>
        )}
      </span>
    );
  }
  return compact ? (
    <button type="button" disabled={occupe} onClick={generer} title={`Créer un écran de la navigation pour ${quoi}`} className="rounded p-0.5 hover:bg-background">
      {occupe ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MonitorUp className="h-3.5 w-3.5" />}
    </button>
  ) : (
    <Button size="sm" variant="outline" disabled={occupe} onClick={generer}
      title={`Ajoute ${quoi} comme écran dans Configuration › Navigation (section, ordre et rôles s'y règlent)`}>
      {occupe ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <MonitorUp className="mr-1.5 h-4 w-4" />}Créer l'écran dans la navigation
    </Button>
  );
}

/** RG-EDT-ACCES-01..03 (Adil DAIA) : qui voit et lance cet état (ou les états de ce dossier). Les rôles sont ceux
 *  de son écran dans Configuration › Navigation ; l'écran est créé s'il n'existe pas. Sans écran propre, l'état
 *  hérite de son dossier, puis des droits des éditions. */
export function BoutonAcces({ type, id, libelle, compact, onChange }: { type: "MODELE" | "DOSSIER"; id: string; libelle: string; compact?: boolean; onChange?: () => void }) {
  const [ouvert, setOuvert] = useState(false);
  const [acces, setAcces] = useState<AccesEtat | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [occupe, setOccupe] = useState(false);
  const ouvrir = () => {
    setOuvert(true); setAcces(null);
    editionsApi.acces(type, id).then((a) => { setAcces(a); setRoles(a.roles); })
      .catch((e) => { toast({ title: "Accès indisponible", description: e.message, variant: "destructive" }); setOuvert(false); });
  };
  const enregistrer = async () => {
    setOccupe(true);
    try {
      const a = await editionsApi.reglerAcces(type, id, roles);
      setAcces(a);
      toast({ title: "Accès enregistré", description: roles.length ? `${libelle} : ${roles.length} rôle(s).` : `${libelle} : réservé à l'administrateur.` });
      setOuvert(false);
      onChange?.();
    } catch (e: any) { toast({ title: "Enregistrement impossible", description: e.message, variant: "destructive" }); } finally { setOccupe(false); }
  };
  const quoi = type === "MODELE" ? "cet état" : "les états de ce dossier";
  return (
    <>
      {compact ? (
        <button type="button" onClick={(e) => { e.stopPropagation(); ouvrir(); }} title={`Accès : qui voit ${quoi}`} className="rounded p-0.5 hover:bg-background">
          <KeyRound className="h-3.5 w-3.5" style={{ color: "hsl(var(--warning))" }} /></button>
      ) : (
        <Button size="sm" variant="outline" onClick={ouvrir} title={`Rôles qui voient et lancent ${quoi}`}>
          <KeyRound className="mr-1.5 h-4 w-4" style={{ color: "hsl(var(--warning))" }} />Accès</Button>
      )}
      <Dialog open={ouvert} onOpenChange={setOuvert}>
        <DialogContent className="ecran-editions-texte max-w-md" onClick={(e) => e.stopPropagation()}>
          <DialogHeader><DialogTitle>Accès — {libelle}</DialogTitle></DialogHeader>
          {!acces ? <div className="flex items-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Chargement…</div> : (
            <div className="space-y-3 text-sm">
              <p className="text-xs text-muted-foreground">
                Rôles qui voient {quoi} dans le menu d'éditions et peuvent le lancer. Ce sont les rôles de son écran dans
                Configuration › Navigation (les deux restent synchronisés). L'administrateur voit toujours tout.
              </p>
              {!acces.existe && (
                <div className="rounded border border-dashed px-2 py-1.5 text-xs text-muted-foreground">
                  {acces.herite_de === "dossier"
                    ? <>Aujourd'hui : hérité de son dossier ({acces.roles.length ? acces.roles.join(", ") : "aucun rôle"}). Enregistrer lui donne ses propres rôles.</>
                    : <>Aujourd'hui : droits généraux des éditions (tous les utilisateurs du menu). Enregistrer crée son écran avec ces rôles.</>}
                </div>
              )}
              {acces.existe && acces.actif === false && (
                <div className="rounded border border-[hsl(var(--warning)/0.4)] bg-[hsl(var(--warning)/0.08)] px-2 py-1.5 text-xs">L'écran est désactivé dans la navigation : personne ne voit {quoi}.</div>
              )}
              <div className="grid grid-cols-2 gap-1.5">
                {acces.roles_disponibles.map((r) => (
                  <label key={r.code} className="flex items-center gap-2">
                    <Checkbox disabled={!acces.peut_regler} checked={roles.includes(r.code)}
                      onCheckedChange={(v) => setRoles((x) => (v === true ? [...x, r.code] : x.filter((y) => y !== r.code)))} />
                    {r.libelle}
                  </label>
                ))}
              </div>
              {!acces.peut_regler && <p className="text-xs text-muted-foreground">Régler l'accès demande le droit « Administrer » des éditions.</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOuvert(false)}>Fermer</Button>
            {acces?.peut_regler && <Button disabled={occupe} onClick={enregistrer}>{occupe && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Enregistrer</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** /editions/etat/:code — écran généré pour un état publié. */
export default function EtatEcranPage() {
  const { code = "" } = useParams();
  const [recherche] = useSearchParams();
  const module = (recherche.get("module") || "PAIE").toUpperCase();
  const [modele, setModele] = useState<ModeleEcran | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    setModele(null); setErreur(null);
    editionsApi.menuModule(module)
      .then((a) => {
        const m = a.themes.flatMap((t) => t.modeles).find((x) => x.code.toUpperCase() === code.toUpperCase());
        if (m) setModele(m); else setErreur("Cet état n'est pas disponible : il n'est pas publié, il est inactif, ou vous n'y avez pas accès.");
      })
      .catch((e) => setErreur(e.statut === 403 ? "Vous n'avez pas accès à cet état." : e.message));
  }, [code, module]);
  return (
    <div className="ecran-editions w-full">
      <ReturnTrail current={modele?.libelle ?? code} />
      <div className="w-full max-w-5xl space-y-3 px-6 py-4">
        <div>
          <h1 className="titre-ecran text-xl font-semibold tracking-tight">{modele?.libelle ?? code}</h1>
          {modele?.description && <p className="mt-0.5 text-xs text-muted-foreground">{modele.description}</p>}
        </div>
        {erreur && <div className="rounded border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{erreur}</div>}
        {!modele && !erreur && <div className="flex items-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Chargement…</div>}
        {modele && (
          <PanneauProduction modele={modele} lancer={(c) => editionsApi.lancerMenu(module, c)}
            entete={<div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
              {modele.code} · version {modele.numero_publie}
              {modele.est_systeme && <span className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"><ShieldCheck className="h-2.5 w-2.5" />Système</span>}
            </div>} />
        )}
      </div>
    </div>
  );
}
