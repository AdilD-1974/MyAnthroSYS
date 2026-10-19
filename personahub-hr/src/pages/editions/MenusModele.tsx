/**
 * MenusModele.tsx — Menus de l'application où un modèle d'édition est proposé.
 * Auteur : Adil DAIA — 19/10/2026 — RG-EDT-ECRAN-01..04
 *
 * Un modèle créé est rattaché d'office aux menus de sa catégorie (un bulletin : Paie ›
 * Édition des bulletins, traitement et consultation du bulletin). Ce dialogue permet
 * d'ajouter ou de retirer des menus, et de choisir le modèle proposé par défaut.
 */
import { useEffect, useState } from "react";
import { Loader2, MonitorCheck, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { CATEGORIES, editionsApi, type Categorie, type Ecran, type Theme } from "@/lib/editionsApi";
import { Switch } from "@/components/ui/switch";

type ModeleRegle = { id: string; libelle: string; version_publiee_id?: string | null; categorie?: Categorie;
  actif?: boolean; theme_id?: string | null; est_systeme?: boolean };

/** Thèmes à plat, dans l'ordre de l'arbre, avec leur profondeur (listes déroulantes). */
export function themesEnArbre(themes: Theme[]): { t: Theme; niveau: number }[] {
  const res: { t: Theme; niveau: number }[] = [];
  const visiter = (parent: string | null, niveau: number) =>
    themes.filter((t) => (t.parent_id ?? null) === parent).sort((a, b) => a.ordre - b.ordre || a.libelle.localeCompare(b.libelle))
      .forEach((t) => { res.push({ t, niveau }); visiter(t.id, niveau + 1); });
  visiter(null, 0);
  return res;
}

type Choix = Record<string, { coche: boolean; defaut: boolean }>;

let ecransCache: Promise<Ecran[]> | null = null;
export const chargerEcrans = () => (ecransCache ??= editionsApi.ecrans().catch((e) => { ecransCache = null; throw e; }));

/** « Paie › Édition des bulletins » */
export const libelleEcran = (e: { libelle?: string; module_libelle?: string | null }) =>
  `${e.module_libelle ? `${e.module_libelle} › ` : ""}${e.libelle ?? ""}`;

/** Menus proposés d'office pour une catégorie (aide de la création). */
export function useEcransCategorie(categorie: Categorie | null): Ecran[] {
  const [ecrans, setEcrans] = useState<Ecran[]>([]);
  useEffect(() => { chargerEcrans().then(setEcrans).catch(() => setEcrans([])); }, []);
  return categorie ? ecrans.filter((e) => e.categorie_edition === categorie) : [];
}

export function DialogueMenus({ modele, ouvert, onFermer, onChange }: {
  modele: ModeleRegle | null;
  ouvert: boolean;
  onFermer: () => void;
  onChange?: () => void;
}) {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [themeId, setThemeId] = useState<string>("");
  const [actif, setActif] = useState(true);
  const [libelle, setLibelle] = useState("");
  const [categorie, setCategorie] = useState<Categorie | "">("");
  const [ecrans, setEcrans] = useState<Ecran[] | null>(null);
  const [choix, setChoix] = useState<Choix>({});
  const [implicite, setImplicite] = useState(false);
  const [occupe, setOccupe] = useState(false);

  useEffect(() => {
    if (!ouvert || !modele) return;
    setEcrans(null);
    setThemeId(modele.theme_id ?? "");
    setActif(modele.actif !== false);
    setLibelle(modele.libelle);
    setCategorie(modele.categorie ?? "");
    Promise.all([chargerEcrans(), editionsApi.ecransDuModele(modele.id), editionsApi.themes().catch(() => [] as Theme[])])
      .then(([tous, rattaches, th]) => {
        setThemes(th.filter((t) => t.actif));
        const c: Choix = {};
        tous.forEach((e) => { c[e.code_ecran] = { coche: false, defaut: false }; });
        rattaches.forEach((r) => { c[r.code_ecran] = { coche: true, defaut: r.par_defaut }; });
        setImplicite(rattaches.some((r) => r.implicite));
        setChoix(c);
        setEcrans(tous);
      })
      .catch((e) => { toast({ title: "Menus indisponibles", description: e.message, variant: "destructive" }); onFermer(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert, modele?.id]);

  const enregistrer = async () => {
    if (!modele) return;
    setOccupe(true);
    try {
      // RG-EDT-MODELE-03 : identité d'abord (la nouvelle catégorie rattache ses écrans), puis les choix de l'écran
      const identite: { libelle?: string; categorie?: Categorie } = {};
      if (libelle.trim() && libelle.trim() !== modele.libelle) identite.libelle = libelle.trim();
      if (categorie && categorie !== modele.categorie) identite.categorie = categorie;
      if (Object.keys(identite).length) await editionsApi.modifierModele(modele.id, identite);
      const liste = Object.entries(choix).filter(([, v]) => v.coche).map(([code_ecran, v]) => ({ code_ecran, par_defaut: v.defaut }));
      await editionsApi.rattacher(modele.id, liste);
      if ((themeId || null) !== (modele.theme_id ?? null) || actif !== (modele.actif !== false))
        await editionsApi.reglerModele(modele.id, { actif, theme_id: themeId || null });
      toast({ title: "Classement enregistré",
        description: `${CATEGORIES.find((c) => c.code === (categorie || modele.categorie))?.libelle ?? ""} · ${actif ? "Actif" : "Inactif"} · ${liste.length} écran(s)` });
      onChange?.();
      onFermer();
    } catch (e: any) {
      toast({ title: "Enregistrement impossible", description: e.message, variant: "destructive" });
    } finally { setOccupe(false); }
  };

  const groupes = (ecrans ?? []).reduce<Record<string, Ecran[]>>((g, e) => {
    (g[e.module_libelle ?? "Autres"] ??= []).push(e);
    return g;
  }, {});

  return (
    <Dialog open={ouvert} onOpenChange={(o) => !o && onFermer()}>
      <DialogContent className="ecran-editions-texte max-w-lg">
        <DialogHeader><DialogTitle>Classement et menus — {modele?.libelle}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-[1fr_180px] gap-3">
          <label className="block text-xs font-medium">Libellé
            <input className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:opacity-60"
              value={libelle} disabled={modele?.est_systeme} onChange={(e) => setLibelle(e.target.value)} />
          </label>
          <label className="block text-xs font-medium" title="Le type range le modèle dans l'onglet de la bibliothèque, le dossier par défaut et les écrans Imprimer">
            Type (catégorie)
            <select className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:opacity-60"
              value={categorie} disabled={modele?.est_systeme}
              onChange={(e) => {
                const c = e.target.value as Categorie;
                setCategorie(c);
                // les écrans « Imprimer » suivent le type : ceux du nouveau type cochés, ceux de l'ancien décochés
                setChoix((p) => {
                  const n = { ...p };
                  (ecrans ?? []).forEach((x) => {
                    if (x.categorie_edition === c) n[x.code_ecran] = { coche: true, defaut: n[x.code_ecran]?.defaut ?? false };
                    else if (x.categorie_edition && x.categorie_edition === modele?.categorie) n[x.code_ecran] = { coche: false, defaut: false };
                  });
                  return n;
                });
              }}>
              {CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.libelle}</option>)}
            </select>
          </label>
        </div>
        {modele?.est_systeme && <p className="-mt-2 text-[11px] text-muted-foreground">Modèle système : libellé et type fixes (copiez-le pour les changer).</p>}
        <div className="grid grid-cols-[1fr_auto] items-end gap-3 rounded border bg-muted/30 p-2">
          <label className="block text-xs font-medium">Dossier (thème) du menu d'éditions
            <select className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" value={themeId} onChange={(e) => setThemeId(e.target.value)}>
              <option value="">Selon le type ({(CATEGORIES.find((c) => c.code === (categorie || modele?.categorie))?.libelle ?? "").toLowerCase()})</option>
              {themesEnArbre(themes).map(({ t, niveau }) => (
                <option key={t.id} value={t.id}>{"\u00a0\u00a0\u00a0".repeat(niveau)}{niveau ? "└ " : ""}{t.module === "RH" ? "RH › " : niveau ? "" : "Paie › "}{t.libelle}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 pb-1.5 text-xs font-medium" title="Inactif : l'état n'est plus proposé dans les menus ni lançable">
            <Switch checked={actif} onCheckedChange={setActif} />{actif ? "Actif" : "Inactif"}
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Écrans où ce modèle a un bouton « Imprimer » : cochez-les. L'étoile en fait le modèle imprimé par défaut dans ce menu.
          {!modele?.version_publiee_id && <span className="mt-1 block text-[hsl(var(--warning))]">Le modèle n'apparaîtra dans les menus qu'une fois publié.</span>}
          {implicite && <span className="mt-1 block">Proposé d'office : aucun modèle n'est encore rattaché à ces menus pour la société.</span>}
        </p>
        {!ecrans && <div className="flex items-center py-6 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Chargement…</div>}
        {ecrans && (
          <div className="max-h-[50vh] space-y-3 overflow-auto">
            {Object.entries(groupes).map(([module, liste]) => (
              <div key={module}>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{module}</div>
                <div className="divide-y rounded border">
                  {liste.map((e) => {
                    const c = choix[e.code_ecran] ?? { coche: false, defaut: false };
                    return (
                      <div key={e.code_ecran} className="flex items-center gap-2 px-2 py-1.5">
                        <input type="checkbox" checked={c.coche} id={`ecr-${e.code_ecran}`}
                          onChange={(x) => setChoix((p) => ({ ...p, [e.code_ecran]: { coche: x.target.checked, defaut: x.target.checked && c.defaut } }))} />
                        <label htmlFor={`ecr-${e.code_ecran}`} className="min-w-0 flex-1 cursor-pointer">
                          <div className="truncate text-sm">{e.libelle}</div>
                          {e.chemin_route && <div className="truncate text-[10px] text-muted-foreground">{e.chemin_route}</div>}
                        </label>
                        <button type="button" disabled={!c.coche} title="Modèle par défaut de ce menu"
                          onClick={() => setChoix((p) => ({ ...p, [e.code_ecran]: { ...c, defaut: !c.defaut } }))}
                          className="rounded p-1 hover:bg-muted disabled:opacity-30">
                          <Star className={`h-4 w-4 ${c.defaut ? "fill-[hsl(var(--warning))] text-[hsl(var(--warning))]" : "text-muted-foreground"}`} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onFermer}>Annuler</Button>
          <Button disabled={!ecrans || occupe} onClick={enregistrer}>
            {occupe && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Bouton « Menus » (bibliothèque, designer). */
export function BoutonMenus({ modele, taille = "sm", variante = "ghost", onChange }: {
  modele: ModeleRegle;
  taille?: "sm" | "default"; variante?: "ghost" | "outline"; onChange?: () => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <>
      <Button size={taille} variant={variante} onClick={() => setOuvert(true)} title="Dossier du menu d'éditions, actif, écrans où le modèle est proposé">
        <MonitorCheck className="mr-1 h-3.5 w-3.5" />Classement
      </Button>
      <DialogueMenus modele={modele} ouvert={ouvert} onFermer={() => setOuvert(false)} onChange={onChange} />
    </>
  );
}
