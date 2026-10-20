/**
 * MenuEditions.tsx — Menu d'éditions d'un module en arborescence (Paie › Éditions de la paie).
 * Auteur : Adil DAIA — 19/10/2026 (migration 078)
 *
 * RG-EDT-MENU-01 : à gauche, l'arbre des thèmes (dossiers) et de leurs états publiés et
 * actifs ; à droite, les paramètres de l'état choisi et sa production.
 * Mode « Organiser » (concepteurs) : créer, renommer, imbriquer et supprimer les dossiers
 * de la société, et glisser un état d'un dossier à l'autre (RG-EDT-THEME-01..03).
 */
import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { toast } from "sonner";
import {
  ChevronDown, ChevronRight, FileText, Folder, FolderOpen, FolderPlus, Loader2, MonitorUp, Pencil,
  Search, Settings2, ShieldCheck, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { editionsApi, type ArbreMenu, type ModeleEcran, type ThemeMenu } from "@/lib/editionsApi";
import { PanneauProduction } from "./LanceurEcran";
import { BoutonAcces, BoutonEcranNavigation } from "./EcranNavigation";
import { useParams, useSearchParams } from "react-router-dom";
import { useRetour } from "./retour";
import "./editions.css";
import ReturnTrail from "@/components/navigation/ReturnTrail";

const TYPE_DND = "application/x-edition-modele";
const cleChoix = (module: string) => `editions.menu.${module}.modele`;
const cleOuverts = (module: string) => `editions.menu.${module}.ouverts`;
const lire = (cle: string) => { try { return localStorage.getItem(cle); } catch { return null; } };
const ecrire = (cle: string, v: string) => { try { localStorage.setItem(cle, v); } catch { /* préférence facultative */ } };

interface Noeud { theme: ThemeMenu; enfants: Noeud[]; total: number }

function construire(themes: ThemeMenu[], filtre: string): Noeud[] {
  const bas = filtre.trim().toLowerCase();
  const garde = (m: ModeleEcran) => !bas || m.libelle.toLowerCase().includes(bas) || m.code.toLowerCase().includes(bas);
  const par: Record<string, Noeud> = {};
  themes.forEach((t) => { par[t.id] = { theme: { ...t, modeles: t.modeles.filter(garde) }, enfants: [], total: 0 }; });
  const racines: Noeud[] = [];
  themes.forEach((t) => (t.parent_id && par[t.parent_id] ? par[t.parent_id].enfants : racines).push(par[t.id]));
  const compter = (n: Noeud): number => (n.total = n.theme.modeles.length + n.enfants.reduce((s, e) => s + compter(e), 0));
  racines.forEach(compter);
  const elaguer = (l: Noeud[]): Noeud[] => l.filter((n) => n.total > 0).map((n) => ({ ...n, enfants: elaguer(n.enfants) }));
  return bas ? elaguer(racines) : racines;
}

export default function MenuEditions({ module, titre, description }: { module: string; titre: string; description?: string }) {
  const retour = useRetour();
  const [arbre, setArbre] = useState<ArbreMenu | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [organiser, setOrganiser] = useState(false);
  const [filtre, setFiltre] = useState("");
  const [choix, setChoix] = useState<string | null>(() => lire(cleChoix(module)));
  const [ouverts, setOuverts] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(lire(cleOuverts(module)) ?? "null") ?? []); } catch { return new Set(); }
  });
  const [survol, setSurvol] = useState<string | null>(null);
  const [saisie, setSaisie] = useState<{ titre: string; valeur: string; valider: (v: string) => Promise<unknown> } | null>(null);
  // RG-EDT-NAV-05 : publier l'arborescence comme sous-menus de « Éditions de la paie »
  const [publication, setPublication] = useState<{ avecEtats: boolean; occupe: boolean } | null>(null);
  const publierNavigation = async () => {
    if (!publication) return;
    setPublication({ ...publication, occupe: true });
    try {
      const b = await editionsApi.publierNavigation(module, publication.avecEtats);
      toast.success("Menu publié dans la navigation", {
        description: `${b.crees} écran(s) créé(s), ${b.mis_a_jour} mis à jour, ${b.retires} retiré(s). Rechargez la page pour voir le menu ; rôles et ordre se règlent dans Configuration › Navigation.` });
      setPublication(null);
    } catch (e: any) {
      toast.error("Publication impossible", { description: e.message });
      setPublication((p) => p && { ...p, occupe: false });
    }
  };

  const charger = useCallback(() => {
    editionsApi.menuModule(module, organiser)
      .then((a) => {
        setArbre(a); setErreur(null);
        // premier passage : dossiers ouverts
        setOuverts((o) => (o.size ? o : new Set(a.themes.map((t) => t.id))));
      })
      .catch((e) => setErreur(e.statut === 403 ? "Vous n'avez pas accès aux éditions de ce module." : e.message));
  }, [module, organiser]);
  useEffect(charger, [charger]);
  useEffect(() => { ecrire(cleOuverts(module), JSON.stringify([...ouverts])); }, [ouverts, module]);

  // RG-EDT-NAV-02 : écran généré pour un dossier (?dossier=<id>) : l'arborescence se limite à ce dossier
  const [recherche] = useSearchParams();
  const dossier = recherche.get("dossier");
  const themeDossier = dossier ? arbre?.themes.find((t) => t.id === dossier) : undefined;
  const racines = useMemo(() => {
    const tout = construire(arbre?.themes ?? [], filtre);
    if (!dossier) return tout;
    const chercher = (l: Noeud[]): Noeud | null => { for (const n of l) { if (n.theme.id === dossier) return n; const t = chercher(n.enfants); if (t) return t; } return null; };
    const n = chercher(tout);
    return n ? [n] : [];
  }, [arbre, filtre, dossier]);
  const tous = useMemo(() => (arbre?.themes ?? []).flatMap((t) => t.modeles.map((m) => ({ m, t }))), [arbre]);
  const selection = tous.find((x) => x.m.id === choix) ?? null;
  const chemin = (t: ThemeMenu | undefined): string[] => {
    const res: string[] = [];
    let c = t;
    while (c) { res.unshift(c.libelle); c = arbre?.themes.find((x) => x.id === c!.parent_id); }
    return res;
  };

  const basculer = (id: string) => setOuverts((o) => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const choisir = (m: ModeleEcran) => { setChoix(m.id); ecrire(cleChoix(module), m.id); };

  const action = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast.success(ok); charger(); } catch (e: any) { toast.error("Action impossible", { description: e.message }); }
  };
  const nouveauDossier = (parent: ThemeMenu | null) => setSaisie({
    titre: parent ? `Nouveau dossier dans « ${parent.libelle} »` : "Nouveau dossier", valeur: "",
    valider: (v) => action(() => editionsApi.creerTheme({ libelle: v, module, parent_id: parent?.id ?? null }), "Dossier créé"),
  });
  const renommer = (t: ThemeMenu) => setSaisie({
    titre: "Renommer le dossier", valeur: t.libelle,
    valider: (v) => action(() => editionsApi.modifierTheme(t.id, { libelle: v }), "Dossier renommé"),
  });
  const supprimer = (t: ThemeMenu) => {
    if (!confirm(`Supprimer le dossier « ${t.libelle} » et ses sous-dossiers ?\nSes états retournent dans le dossier de leur catégorie.`)) return;
    action(() => editionsApi.supprimerTheme(t.id), "Dossier supprimé");
  };
  const deposer = (e: DragEvent, t: ThemeMenu) => {
    e.preventDefault(); setSurvol(null);
    const id = e.dataTransfer.getData(TYPE_DND);
    if (id) action(() => editionsApi.reglerModele(id, { theme_id: t.id }), `État classé dans « ${t.libelle} »`);
  };

  const rendreNoeud = (n: Noeud, niveau: number) => {
    const t = n.theme;
    const ouvert = ouverts.has(t.id) || !!filtre;
    return (
      <div key={t.id}>
        <div
          className={`group flex items-center gap-1 rounded px-1 py-0.5 text-sm hover:bg-muted ${survol === t.id ? "bg-primary/10 ring-1 ring-primary" : ""}`}
          style={{ paddingLeft: 4 + niveau * 16 }}
          onClick={() => basculer(t.id)}
          onDragOver={organiser ? (e) => { if (e.dataTransfer.types.includes(TYPE_DND)) { e.preventDefault(); setSurvol(t.id); } } : undefined}
          onDragLeave={organiser ? () => setSurvol((s) => (s === t.id ? null : s)) : undefined}
          onDrop={organiser ? (e) => deposer(e, t) : undefined}>
          {ouvert ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          {ouvert ? <FolderOpen className="h-4 w-4 shrink-0 text-[hsl(var(--warning))]" /> : <Folder className="h-4 w-4 shrink-0 fill-[hsl(var(--warning)/0.3)] text-[hsl(var(--warning))]" />}
          <span className="min-w-0 flex-1 truncate font-medium">{t.libelle}</span>
          <span className="text-[10px] text-muted-foreground">{n.total}</span>
          {organiser && (
            <span className="ml-1 hidden items-center gap-0.5 group-hover:inline-flex" onClick={(e) => e.stopPropagation()}>
              <button type="button" title="Nouveau sous-dossier" className="rounded p-0.5 hover:bg-background" onClick={() => nouveauDossier(t)}><FolderPlus className="h-3.5 w-3.5" /></button>
              <BoutonAcces type="DOSSIER" id={t.id} libelle={t.libelle} compact onChange={charger} />
              <BoutonEcranNavigation type="DOSSIER" id={t.id} libelle={t.libelle} compact />
              {!t.est_systeme && <>
                <button type="button" title="Renommer" className="rounded p-0.5 hover:bg-background" onClick={() => renommer(t)}><Pencil className="h-3.5 w-3.5" /></button>
                <button type="button" title="Supprimer" className="rounded p-0.5 text-destructive hover:bg-background" onClick={() => supprimer(t)}><Trash2 className="h-3.5 w-3.5" /></button>
              </>}
            </span>
          )}
        </div>
        {ouvert && (
          <div>
            {n.enfants.map((e) => rendreNoeud(e, niveau + 1))}
            {t.modeles.map((m) => (
              <div key={m.id}
                draggable={organiser}
                onDragStart={(e) => { e.dataTransfer.setData(TYPE_DND, m.id); e.dataTransfer.effectAllowed = "move"; }}
                onClick={() => choisir(m)}
                title={organiser ? "Glissez l'état sur un dossier pour le classer" : m.code}
                className={`flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-sm ${m.id === choix ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                style={{ paddingLeft: 22 + (niveau + 1) * 16 }}>
                <FileText className={`h-4 w-4 shrink-0 ${m.id === choix ? "" : "text-primary"}`} />
                <span className="min-w-0 flex-1 truncate">{m.libelle}</span>
                {m.est_systeme && <ShieldCheck className={`h-3 w-3 shrink-0 ${m.id === choix ? "" : "text-primary"}`} />}
              </div>
            ))}
            {organiser && !t.modeles.length && !n.enfants.length && (
              <div className="py-0.5 text-[11px] italic text-muted-foreground" style={{ paddingLeft: 22 + (niveau + 1) * 16 }}>dossier vide — glissez-y un état</div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="ecran-editions w-full">
      <ReturnTrail current={themeDossier?.libelle ?? titre} />
      <div className="w-full space-y-3 px-6 py-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="titre-ecran text-xl font-semibold tracking-tight">{themeDossier?.libelle ?? titre}</h1>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        <Button variant={organiser ? "default" : "outline"} size="sm" onClick={() => setOrganiser((o) => !o)}
          title="Créer des dossiers et y classer les états (glisser-déposer)">
          <FolderPlus className="mr-1.5 h-4 w-4" />{organiser ? "Terminer l'organisation" : "Organiser"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setPublication({ avecEtats: true, occupe: false })}
          title="Les dossiers (et les états) de ce menu deviennent les sous-menus de « Éditions de la paie » dans la navigation">
          <MonitorUp className="mr-1.5 h-4 w-4" />Publier dans la navigation
        </Button>
        <Button variant="outline" size="sm" onClick={() => retour.ouvrir("/editions", titre)} title="Concevoir les états, les activer ou les désactiver">
          <Settings2 className="mr-1.5 h-4 w-4" />Gérer les états
        </Button>
      </div>

      {erreur && <div className="rounded border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{erreur}</div>}
      {!arbre && !erreur && <div className="flex items-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Chargement…</div>}

      {arbre && (
        <div className="grid gap-4 lg:grid-cols-[minmax(300px,26%)_1fr]">
          <Card className="carte-edition flex max-h-[calc(100vh-11rem)] flex-col">
            <div className="border-b p-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input value={filtre} onChange={(e) => setFiltre(e.target.value)} placeholder="Rechercher un état…" className="h-9 pl-8" />
              </div>
            </div>
            <div className="flex-1 overflow-auto p-1.5 select-none">
              <div className="flex items-center gap-1 px-1 py-0.5 text-sm font-semibold">
                <FolderOpen className="h-4 w-4 text-[hsl(var(--warning))]" />États {arbre.libelle}
                {organiser && <button type="button" className="ml-auto rounded p-0.5 hover:bg-muted" title="Nouveau dossier" onClick={() => nouveauDossier(null)}><FolderPlus className="h-4 w-4" /></button>}
              </div>
              {racines.map((n) => rendreNoeud(n, 1))}
              {!racines.length && (
                <p className="p-4 text-center text-xs text-muted-foreground">
                  {filtre ? "Aucun état ne correspond." : "Aucun état publié et actif dans ce module."}
                </p>
              )}
            </div>
          </Card>

          <div>
            {selection ? (
              <PanneauProduction
                modele={selection.m}
                lancer={(c) => editionsApi.lancerMenu(module, c)}
                entete={
                  <div className="mb-4 border-b pb-3">
                    <div className="text-[11px] text-muted-foreground">{chemin(selection.t).join(" › ")}</div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-semibold">{selection.m.libelle}</h2>
                      {selection.m.est_systeme && <span className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"><ShieldCheck className="h-2.5 w-2.5" />Système</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">{selection.m.code} · version {selection.m.numero_publie}
                      <span className="ml-auto flex items-center gap-1.5"><BoutonAcces type="MODELE" id={selection.m.code} libelle={selection.m.libelle} onChange={charger} />
                        <BoutonEcranNavigation key={`${selection.m.code}`} type="MODELE" id={selection.m.code} libelle={selection.m.libelle} /></span></div>
                    {selection.m.description && <p className="mt-1 text-xs text-muted-foreground">{selection.m.description}</p>}
                  </div>
                } />
            ) : (
              <div className="flex h-full min-h-[240px] items-center justify-center rounded-lg border border-dashed bg-card text-sm text-muted-foreground">
                Choisissez un état dans l'arborescence.
              </div>
            )}
          </div>
        </div>
      )}

      </div>
      <Dialog open={!!publication} onOpenChange={(o) => !o && setPublication(null)}>
        <DialogContent className="ecran-editions-texte max-w-md">
          <DialogHeader><DialogTitle>Publier le menu dans la navigation</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Chaque dossier de ce menu devient un sous-menu de « Éditions de la paie », dans le même ordre et la même
            arborescence, avec les rôles de « Éditions de la paie ». Les dossiers créés, renommés ou supprimés ensuite
            suivront d'eux-mêmes.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={!!publication?.avecEtats} onCheckedChange={(v) => setPublication((p) => p && { ...p, avecEtats: v === true })} />
            Inclure les états (un écran par état, sous son dossier)
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublication(null)}>Annuler</Button>
            <Button disabled={publication?.occupe} onClick={publierNavigation}>
              {publication?.occupe && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Publier</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!saisie} onOpenChange={(o) => !o && setSaisie(null)}>
        <DialogContent className="ecran-editions-texte max-w-sm">
          <DialogHeader><DialogTitle>{saisie?.titre}</DialogTitle></DialogHeader>
          <Input autoFocus value={saisie?.valeur ?? ""} onChange={(e) => setSaisie((x) => x && { ...x, valeur: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter" && saisie?.valeur.trim()) { saisie.valider(saisie.valeur.trim()); setSaisie(null); } }}
            placeholder="ex. Journal de paie Cema" />
          <DialogFooter>
            <Button disabled={!saisie?.valeur.trim()} onClick={() => { saisie!.valider(saisie!.valeur.trim()); setSaisie(null); }}>Valider</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Paie › Éditions de la paie (/paie/editions-paie). */
export function EditionsPaiePage() {
  return (
    <MenuEditions module="PAIE" titre="Éditions de la paie"
      description="Bulletins, journaux, états de contrôle et de synthèse : choisissez un état, renseignez ses paramètres et imprimez." />
  );
}

/** Menu d'éditions d'un autre module (/editions/menu/:module), ex. RH ; ?dossier=<id> pour un écran de dossier. */
export function EditionsModulePage() {
  const { module = "PAIE" } = useParams();
  const m = module.toUpperCase();
  return <MenuEditions module={m} titre={m === "RH" ? "Éditions RH" : `Éditions ${m}`} />;
}
