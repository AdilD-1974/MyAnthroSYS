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
import { editionsApi, type Categorie, type Ecran } from "@/lib/editionsApi";

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

export function DialogueMenus({ modele, ouvert, onFermer }: {
  modele: { id: string; libelle: string; version_publiee_id?: string | null } | null;
  ouvert: boolean;
  onFermer: () => void;
}) {
  const [ecrans, setEcrans] = useState<Ecran[] | null>(null);
  const [choix, setChoix] = useState<Choix>({});
  const [implicite, setImplicite] = useState(false);
  const [occupe, setOccupe] = useState(false);

  useEffect(() => {
    if (!ouvert || !modele) return;
    setEcrans(null);
    Promise.all([chargerEcrans(), editionsApi.ecransDuModele(modele.id)])
      .then(([tous, rattaches]) => {
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
      const liste = Object.entries(choix).filter(([, v]) => v.coche).map(([code_ecran, v]) => ({ code_ecran, par_defaut: v.defaut }));
      await editionsApi.rattacher(modele.id, liste);
      toast({ title: "Menus enregistrés", description: liste.length ? `${liste.length} menu(s)` : "Le modèle n'est plus proposé dans les menus" });
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
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Menus de lancement — {modele?.libelle}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">
          Cochez les menus où ce modèle est proposé. L'étoile en fait le modèle imprimé par défaut dans ce menu.
          {!modele?.version_publiee_id && <span className="mt-1 block text-amber-700">Le modèle n'apparaîtra dans les menus qu'une fois publié.</span>}
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
                          <Star className={`h-4 w-4 ${c.defaut ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
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
export function BoutonMenus({ modele, taille = "sm", variante = "ghost" }: {
  modele: { id: string; libelle: string; version_publiee_id?: string | null };
  taille?: "sm" | "default"; variante?: "ghost" | "outline";
}) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <>
      <Button size={taille} variant={variante} onClick={() => setOuvert(true)} title="Menus de l'application où ce modèle est proposé">
        <MonitorCheck className="mr-1 h-3.5 w-3.5" />Menus
      </Button>
      <DialogueMenus modele={modele} ouvert={ouvert} onFermer={() => setOuvert(false)} />
    </>
  );
}
