/**
 * TriRegroupements.tsx — Tri et regroupements de l'état (mise en forme).
 * Auteur : Adil DAIA — 19/10/2026 — RG-EDT-GROUPE-01/02
 *
 * RG-EDT-GROUPE-02 (Adil DAIA) : l'utilisateur choisit dans une liste (UO, UO de 1er ou 2e
 * niveau, plan de paie, catégorie professionnelle, classification, emploi, métier, type de
 * contrat, banque…) les niveaux de regroupement puis les critères de tri. Le designer en
 * déduit le jeu principal (groupes, puis tri : les groupes d'abord, dans leur ordre) et les
 * bandes « En-tête de groupe » / « Pied de groupe » de chaque niveau, créées avec un titre et
 * un sous-total prêts à modifier ; une option fait commencer chaque groupe sur une nouvelle page.
 * Les bandes d'un niveau déplacé suivent le niveau (leur contenu est gardé).
 */
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Layers, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { largeurUtile, nouvelId, type Bande, type Definition, type Element } from "@/pages/editions/types";
import { useReferentiels } from "./contexte";
import type { Editeur } from "./useEditeur";

/** Axes proposés en premier (paie) ; les autres champs de la source restent accessibles. */
const AXES_GROUPE: [string, string][] = [
  ["affectation.uo_niveau1_libelle", "UO de 1er niveau (direction)"],
  ["affectation.uo_niveau2_libelle", "UO de 2e niveau"],
  ["affectation.organisation_libelle", "Unité organisationnelle"],
  ["affectation.uo_chemin", "UO (chemin complet)"],
  ["plan.libelle", "Plan de paie"],
  ["qualification.categorie_professionnelle_libelle", "Catégorie professionnelle"],
  ["qualification.classification_libelle", "Classification"],
  ["affectation.emploi_libelle", "Emploi"],
  ["affectation.metier_libelle", "Métier"],
  ["contrat.type_contrat_libelle", "Type de contrat"],
  ["qualification.code_grade", "Grade"],
  ["paiement.banque_libelle", "Banque"],
  ["paiement.mode_libelle", "Mode de paiement"],
  ["situation_familiale.libelle", "Situation familiale"],
];
const AXES_TRI: [string, string][] = [
  ["identite.matricule", "Matricule"], ["identite.nom", "Nom"], ["identite.prenom", "Prénom"],
  ["contrat.date_embauche", "Date d'embauche"], ["net_a_payer", "Net à payer"], ["total_brut", "Salaire brut"],
  ...AXES_GROUPE,
];

interface Niveau { champ: string; sens: "ASC" | "DESC"; entete: boolean; pied: boolean; saut: boolean; origine: number | null }
interface CritereTri { champ: string; sens: "ASC" | "DESC" }

function etatInitial(d: Definition): { niveaux: Niveau[]; tris: CritereTri[] } {
  const j = d.jeux.find((x) => x.role === "PRINCIPAL");
  const groupes = j?.groupes ?? [];
  const tri = j?.tri ?? [];
  const niveaux = groupes.map((g, i) => {
    const n = i + 1;
    const tete = d.bandes.find((b) => b.type === "EN_TETE_GROUPE" && (b.niveau_groupe ?? 1) === n);
    const pied = d.bandes.find((b) => b.type === "PIED_GROUPE" && (b.niveau_groupe ?? 1) === n);
    const t = tri.find((x) => x.champ === g);
    return { champ: g, sens: (t?.sens ?? "ASC") as "ASC" | "DESC", entete: !!tete, pied: !!pied, saut: !!tete?.saut_avant, origine: n };
  });
  const tris = tri.filter((t) => !groupes.includes(t.champ)).map((t) => ({ champ: t.champ, sens: (t.sens ?? "ASC") as "ASC" | "DESC" }));
  return { niveaux, tris };
}

export function appliquer(d: Definition, niveaux: Niveau[], tris: CritereTri[], libelle: (c: string) => string, sourceBulletin: boolean) {
  const j = d.jeux.find((x) => x.role === "PRINCIPAL");
  if (!j) return;
  const valides = niveaux.filter((n) => n.champ);
  j.groupes = valides.map((n) => n.champ);
  const vus = new Set<string>();
  j.tri = [...valides.map((n) => ({ champ: n.champ, sens: n.sens })), ...tris.filter((t) => t.champ)]
    .filter((t) => (vus.has(t.champ) ? false : (vus.add(t.champ), true)))
    .map((t) => (t.sens === "DESC" ? { champ: t.champ, sens: "DESC" as const } : { champ: t.champ }));

  const L = largeurUtile(d.page);
  const anciens = d.bandes.filter((b) => b.type === "EN_TETE_GROUPE" || b.type === "PIED_GROUPE");
  const autres = d.bandes.filter((b) => b.type !== "EN_TETE_GROUPE" && b.type !== "PIED_GROUPE");
  const tetes: Bande[] = [];
  const pieds: Bande[] = [];
  valides.forEach((n, i) => {
    const niveau = i + 1;
    const lib = libelle(n.champ);
    const reprise = (type: Bande["type"]) =>
      n.origine ? anciens.find((b) => b.type === type && (b.niveau_groupe ?? 1) === n.origine) : undefined;
    if (n.entete || n.saut) {
      const b = reprise("EN_TETE_GROUPE") ?? {
        id: nouvelId(d, `groupe_${niveau}_entete`), type: "EN_TETE_GROUPE", hauteur: 8, elements: [{
          id: nouvelId(d, `groupe_${niveau}_titre`), type: "CHAMP", x: 0, y: 1, l: L, h: 6,
          valeur: `"${lib.replace(/"/g, '""')} : " + SIVIDE(${n.champ}, "(non renseigné)")`,
          style: { gras: true, taille: 9 - Math.min(niveau - 1, 2) * 0.5, couleur: "#0E3D5C", fond: niveau === 1 ? "#E8F1F5" : "#F3F7F9" },
        } as Element],
      } as Bande;
      b.niveau_groupe = niveau;
      b.saut_avant = n.saut || undefined;
      tetes.push(b);
    }
    if (n.pied) {
      const elements: Element[] = [{
        id: nouvelId(d, `groupe_${niveau}_soustotal`), type: "CHAMP", x: 0, y: 1, l: sourceBulletin ? L - 50 : L, h: 5.5,
        valeur: `"Sous-total " + SIVIDE(${n.champ}, "") + " — " + NB(id, GROUPE) + " document(s)"`,
        style: { gras: true, taille: 8, couleur: "#0E3D5C", bordures: "H", couleur_bordure: "#0E3D5C" },
      } as Element];
      if (sourceBulletin) elements.push({
        id: nouvelId(d, `groupe_${niveau}_net`), type: "CHAMP", x: L - 50, y: 1, l: 50, h: 5.5,
        valeur: "TOTAL(net_a_payer, GROUPE)", affichage: { masque: "MONTANT", texte_avant: "Net : " },
        style: { gras: true, taille: 8, alignement: "DROITE", couleur: "#0E3D5C", bordures: "H", couleur_bordure: "#0E3D5C" },
      } as Element);
      const b = reprise("PIED_GROUPE") ?? ({ id: nouvelId(d, `groupe_${niveau}_pied`), type: "PIED_GROUPE", hauteur: 8, elements } as Bande);
      b.niveau_groupe = niveau;
      pieds.push(b);
    }
  });
  // ordre d'affichage dans le designer : en-têtes avant le corps, pieds après (niveau 1 à l'extérieur)
  const iCorps = autres.findIndex((b) => b.type === "CORPS");
  const iDernier = autres.map((b) => b.type).lastIndexOf("CORPS");
  if (iCorps < 0) { d.bandes = [...autres, ...tetes, ...pieds.reverse()]; return; }
  d.bandes = [...autres.slice(0, iCorps), ...tetes, ...autres.slice(iCorps, iDernier + 1), ...pieds.reverse(), ...autres.slice(iDernier + 1)];
}

export function BoutonTriRegroupements({ editeur, ro }: { editeur: Editeur; ro: boolean }) {
  const { sources } = useReferentiels();
  const d = editeur.definition!;
  const principal = d.jeux.find((j) => j.role === "PRINCIPAL");
  const champs = useMemo(() => sources.find((s) => s.code === principal?.source)?.champs ?? [], [sources, principal?.source]);
  const libelles = useMemo(() => {
    const m = new Map<string, string>(champs.map((c) => [c.code, c.libelle]));
    AXES_TRI.forEach(([c, l]) => m.set(c, l));
    return m;
  }, [champs]);
  const existe = (c: string) => !champs.length || champs.some((x) => x.code === c);
  const axesGroupe = AXES_GROUPE.filter(([c]) => existe(c));
  const axesTri = AXES_TRI.filter(([c]) => existe(c));
  const autresChamps = champs.filter((c) => !libelles.has(c.code) || !AXES_TRI.some(([a]) => a === c.code));
  const libelle = (c: string) => libelles.get(c) ?? c;

  const [ouvert, setOuvert] = useState(false);
  const [niveaux, setNiveaux] = useState<Niveau[]>([]);
  const [tris, setTris] = useState<CritereTri[]>([]);
  const ouvrir = () => { const e = etatInitial(d); setNiveaux(e.niveaux); setTris(e.tris); setOuvert(true); };
  const resume = (principal?.groupes ?? []).length
    ? (principal!.groupes ?? []).map(libelle).join(" › ")
    : "aucun regroupement";

  const deplacer = <T,>(liste: T[], i: number, sens: -1 | 1) => {
    const n = [...liste]; const j = i + sens;
    if (j < 0 || j >= n.length) return liste;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  };
  const choixChamp = (valeur: string, onChange: (v: string) => void, axes: [string, string][]) => (
    <select className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs" value={valeur} disabled={ro}
      onChange={(e) => onChange(e.target.value)}>
      <option value="">— choisir —</option>
      <optgroup label="Axes usuels">{axes.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</optgroup>
      {autresChamps.length > 0 && (
        <optgroup label="Autres champs">{autresChamps.map((c) => <option key={c.code} value={c.code}>{c.groupe ? `${c.groupe} · ` : ""}{c.libelle}</option>)}</optgroup>
      )}
      {valeur && !libelles.has(valeur) && <option value={valeur}>{valeur}</option>}
    </select>
  );
  const sens = (v: "ASC" | "DESC", onChange: (v: "ASC" | "DESC") => void) => (
    <select className="h-8 w-24 rounded-md border border-input bg-background px-1 text-xs" value={v} disabled={ro}
      onChange={(e) => onChange(e.target.value as "ASC" | "DESC")}>
      <option value="ASC">Croissant</option><option value="DESC">Décroissant</option>
    </select>
  );
  const boutonsOrdre = (i: number, n: number, haut: () => void, bas: () => void, suppr: () => void) => (
    <div className="flex shrink-0 items-center">
      <button type="button" disabled={ro || i === 0} onClick={haut} className="rounded p-1 hover:bg-muted disabled:opacity-30" title="Monter"><ArrowUp className="h-3.5 w-3.5" /></button>
      <button type="button" disabled={ro || i === n - 1} onClick={bas} className="rounded p-1 hover:bg-muted disabled:opacity-30" title="Descendre"><ArrowDown className="h-3.5 w-3.5" /></button>
      <button type="button" disabled={ro} onClick={suppr} className="rounded p-1 text-destructive hover:bg-destructive/10 disabled:opacity-30" title="Retirer"><Trash2 className="h-3.5 w-3.5" /></button>
    </div>
  );

  return (
    <>
      <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={ouvrir} title="Regrouper (UO, catégorie…) et trier les documents de l'état">
        <Layers className="h-3.5 w-3.5" />Tri et regroupements <span className="max-w-[220px] truncate text-muted-foreground">· {resume}</span>
      </Button>
      <Dialog open={ouvert} onOpenChange={setOuvert}>
        <DialogContent className="ecran-editions-texte max-w-2xl" onKeyDown={(e) => e.stopPropagation()}>
          <DialogHeader><DialogTitle>Tri et regroupements</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <section>
              <div className="mb-1 flex items-center">
                <h3 className="text-sm font-semibold">Regroupements</h3>
                <span className="ml-2 text-[11px] text-muted-foreground">du plus large au plus fin (ex. direction › service)</span>
              </div>
              <div className="space-y-1.5">
                {niveaux.map((n, i) => (
                  <div key={i} className="rounded-md border p-2">
                    <div className="flex items-center gap-2">
                      <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">Niveau {i + 1}</span>
                      {choixChamp(n.champ, (v) => setNiveaux((l) => l.map((x, k) => (k === i ? { ...x, champ: v } : x))), axesGroupe)}
                      {sens(n.sens, (v) => setNiveaux((l) => l.map((x, k) => (k === i ? { ...x, sens: v } : x))))}
                      {boutonsOrdre(i, niveaux.length, () => setNiveaux((l) => deplacer(l, i, -1)), () => setNiveaux((l) => deplacer(l, i, 1)),
                        () => setNiveaux((l) => l.filter((_, k) => k !== i)))}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 pl-[72px] text-xs">
                      {([["entete", "En-tête de groupe (titre)"], ["pied", "Pied de groupe (sous-totaux)"], ["saut", "Nouvelle page à chaque groupe"]] as const).map(([cle, l]) => (
                        <label key={cle} className="flex items-center gap-1.5">
                          <input type="checkbox" disabled={ro} checked={n[cle]}
                            onChange={(e) => setNiveaux((liste) => liste.map((x, k) => (k === i ? { ...x, [cle]: e.target.checked, ...(cle === "saut" && e.target.checked ? { entete: true } : {}) } : x)))} />
                          {l}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {!ro && (
                <button type="button" className="mt-1.5 flex items-center gap-1 text-xs text-primary"
                  onClick={() => setNiveaux((l) => [...l, { champ: "", sens: "ASC", entete: true, pied: true, saut: false, origine: null }])}>
                  <Plus className="h-3.5 w-3.5" /> Niveau de regroupement
                </button>
              )}
            </section>
            <section>
              <div className="mb-1 flex items-center">
                <h3 className="text-sm font-semibold">Tri</h3>
                <span className="ml-2 text-[11px] text-muted-foreground">à l'intérieur des groupes</span>
              </div>
              <div className="space-y-1.5">
                {tris.map((t, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-xs text-muted-foreground">{i === 0 ? "Trier par" : "puis par"}</span>
                    {choixChamp(t.champ, (v) => setTris((l) => l.map((x, k) => (k === i ? { ...x, champ: v } : x))), axesTri)}
                    {sens(t.sens, (v) => setTris((l) => l.map((x, k) => (k === i ? { ...x, sens: v } : x))))}
                    {boutonsOrdre(i, tris.length, () => setTris((l) => deplacer(l, i, -1)), () => setTris((l) => deplacer(l, i, 1)),
                      () => setTris((l) => l.filter((_, k) => k !== i)))}
                  </div>
                ))}
              </div>
              {!ro && (
                <button type="button" className="mt-1.5 flex items-center gap-1 text-xs text-primary"
                  onClick={() => setTris((l) => [...l, { champ: "", sens: "ASC" }])}>
                  <Plus className="h-3.5 w-3.5" /> Critère de tri
                </button>
              )}
            </section>
            <p className="text-[11px] text-muted-foreground">
              Les bandes de groupe sont créées avec un titre et un sous-total : modifiez-les ensuite sur le canevas
              (TOTAL(champ, GROUPE), NB(champ, GROUPE)…). Retirer un niveau supprime ses bandes.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOuvert(false)}>Annuler</Button>
            <Button disabled={ro} onClick={() => {
              editeur.modifier((x) => appliquer(x, niveaux, tris, libelle, principal?.source === "BULLETIN"), "tri-regroupements");
              setOuvert(false);
            }}>Appliquer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
