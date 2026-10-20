/**
 * Donnees.tsx — Étape 1 du designer : ce que l'état contient, avant toute mise en forme.
 * Auteur : Adil DAIA — lot 2 bis (16/10/2026)
 *
 * Reprend les onglets du Report Manager AGIRH :
 *   Définition (corps de l'état) · Corps (colonnes, lignes, rubriques, tri) · Variables ·
 *   Paramètres et sélection · Sources · Usages · Aperçu des données (tableau brut, sans format).
 * RG-EDT-DONNEES-01 à 05 ; affectations saisies à la main (décision du 16/10/2026).
 */
import { Fragment, createContext, useContext, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Copy, Loader2, Play, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { editionsApi, type ApercuDonnees, type ErreurValidation, type RubriqueInfo, type Version } from "@/lib/editionsApi";
import ParametresForm, { parametresManquants, type Valeurs } from "@/pages/editions/ParametresForm";
import {
  ATTRIBUTS_AFFECTABLES, LIBELLES_NATURE, PERIODES_AFFECTATION, RUBRIQUES_EN_TETE, VARIABLES_BULLETIN, codeSection, colonnesExercice,
  groupesEnSections, rangerParSection, type Affectation, type SectionCorps, type AttributAffecte, type Corps, type Definition, type TypeColonneCorps, type Usages, type Variable,
} from "@/pages/editions/types";
import FormuleInput from "./FormuleInput";
import Liste from "../Liste";
import { Checkbox } from "@/components/ui/checkbox";
import { useReferentiels } from "./contexte";
import { deplacer, useGlisser } from "./glisser";
import { EMPLACEMENTS, emplacementDe, libelleBande, placementConforme, placerCorps, usagesDuCorps, type Emplacement } from "@/pages/editions/placement";
import { Case, Choix, JeuxEditeur, Ligne, Nombre, ParametresEditeur, Texte, classeChamp, poser } from "./Inspecteur";
import type { Editeur } from "./useEditeur";

type Onglet = "definition" | "corps" | "variables" | "parametres" | "sources" | "usages" | "apercu";
const ONGLETS: [Onglet, string, string][] = [
  ["definition", "Définition", "L'état et ses corps"],
  ["corps", "Corps", "Colonnes, lignes, rubriques"],
  ["variables", "Variables", "Valeurs nommées pour la forme"],
  ["parametres", "Paramètres", "Sélection au lancement"],
  ["sources", "Sources", "Jeux de données"],
  ["usages", "Usages", "Confidentialité, formes, exports"],
  ["apercu", "Aperçu des données", "Le contenu, sans format"],
];

// ── erreurs de validation : lignes en rouge et navigation vers l'anomalie ──────
export type CibleErreur = { chemin: string; n: number } | null;
const AUCUNE: ErreurValidation[] = [];
const CtxErreurs = createContext<ErreurValidation[]>(AUCUNE);
const CtxCible = createContext<CibleErreur>(null);
const sousChemin = (c: string, p: string) => c === p || c.startsWith(`${p}.`) || c.startsWith(`${p}[`);
/** Messages des erreurs situées sur (ou sous) un chemin, ex. « corps[2].affectations[5] ». */
const messagesDe = (erreurs: ErreurValidation[], p: string) => erreurs.filter((e) => sousChemin(e.chemin, p)).map((e) => e.message);
/** Attributs d'une ligne de tableau : repère pour la navigation, fond rouge et info-bulle si erreur. */
function ligneErreur(erreurs: ErreurValidation[], p: string) {
  const m = messagesDe(erreurs, p);
  return {
    "data-chemin": p,
    title: m.length ? m.join("\n") : undefined,
    rouge: m.length ? "bg-destructive/10 hover:bg-destructive/15 [&>td:first-child]:border-l-2 [&>td:first-child]:border-l-destructive" : "",
    icone: m.length ? <AlertTriangle className="mr-0.5 inline h-3 w-3 text-destructive" /> : null,
  };
}
/** Du plus précis au plus large : a.b[2].c → a.b[2] → a.b → a */
function prefixes(chemin: string): string[] {
  const r: string[] = [];
  let c = chemin;
  while (c) { r.push(c); const k = Math.max(c.lastIndexOf("."), c.lastIndexOf("[")); c = k > 0 ? c.slice(0, k) : ""; }
  return r;
}
function allerVers(chemin: string) {
  for (const p of prefixes(chemin)) {
    const el = document.querySelector<HTMLElement>(`[data-chemin="${CSS.escape(p)}"]`);
    if (!el) continue;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.style.outline = "2px solid hsl(var(--destructive))";
    el.style.outlineOffset = "-2px";
    setTimeout(() => { el.style.outline = ""; el.style.outlineOffset = ""; }, 2500);
    el.querySelector<HTMLElement>("input:not([disabled]),select:not([disabled]),textarea:not([disabled])")?.focus({ preventScroll: true });
    return;
  }
}

const CODE = (v: string) => v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "_$1").slice(0, 40);

export default function Donnees({ editeur, version, lectureSeule, enregistrer, erreurs = AUCUNE, cible = null }: {
  editeur: Editeur; version: Version; lectureSeule: boolean; enregistrer: (silencieux?: boolean) => Promise<boolean>;
  erreurs?: ErreurValidation[]; cible?: CibleErreur;
}) {
  const [onglet, setOnglet] = useState<Onglet>("definition");
  const [corpsActif, setCorpsActif] = useState<string | null>(editeur.definition?.corps?.[0]?.code ?? null);
  const [sousCorps, setSousCorps] = useState<SousCorps>("rubriques");
  const d = editeur.definition!;
  const ouvrirCorps = (code: string) => { setCorpsActif(code); setOnglet("corps"); };

  // clic sur une erreur : ouvrir l'onglet concerné puis amener la ligne fautive à l'écran
  useEffect(() => {
    if (!cible) return;
    const ch = cible.chemin;
    const m = /^corps\[(\d+)\](?:\.(affectations|colonnes|lignes))?/.exec(ch);
    if (m) {
      const c = d.corps?.[Number(m[1])];
      if (c) setCorpsActif(c.code);
      setSousCorps(m[2] === "colonnes" ? "colonnes" : m[2] === "lignes" ? "lignes" : "rubriques");
      setOnglet(m[2] ? "corps" : "definition");
    } else if (ch.startsWith("variables")) setOnglet("variables");
    else if (ch.startsWith("parametres")) setOnglet("parametres");
    else if (ch.startsWith("jeux")) setOnglet("sources");
    else if (ch.startsWith("usages")) setOnglet("usages");
    else setOnglet("definition");
    const t = setTimeout(() => allerVers(ch), 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cible]);
  const nbErreurs = (prefixe: string) => erreurs.filter((e) => e.chemin.startsWith(prefixe)).length;

  return (
    <div className="flex h-full min-h-0">
      <nav className="w-52 shrink-0 border-r bg-muted/30 p-2">
        <div className="mb-2 px-2 text-[11px] font-semibold uppercase text-muted-foreground">Ce que l'état contient</div>
        {ONGLETS.map(([k, l, aide]) => (
          <button key={k} type="button" onClick={() => setOnglet(k)}
            className={`mb-0.5 block w-full rounded px-2 py-1.5 text-left ${onglet === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
            <div className="flex items-center text-sm">{l}
              {(() => { const n = nbErreurs(({ definition: "#", corps: "corps", variables: "variables", parametres: "parametres", sources: "jeux", usages: "usages", apercu: "#" } as Record<Onglet, string>)[k]);
                return n ? <span className="ml-auto rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-destructive-foreground" title={`${n} erreur(s)`}>{n}</span> : null; })()}
            </div>
            <div className={`text-[10px] ${onglet === k ? "opacity-80" : "text-muted-foreground"}`}>{aide}</div>
          </button>
        ))}
      </nav>
      <CtxErreurs.Provider value={erreurs}><CtxCible.Provider value={cible}>
      <div className="min-w-0 flex-1 overflow-auto p-5">
        {onglet === "definition" && <OngletDefinition d={d} editeur={editeur} version={version} ro={lectureSeule} ouvrirCorps={ouvrirCorps} />}
        {onglet === "corps" && <OngletCorps d={d} editeur={editeur} ro={lectureSeule} actif={corpsActif} setActif={setCorpsActif} sous={sousCorps} setSous={setSousCorps} />}
        {onglet === "variables" && <OngletVariables d={d} editeur={editeur} ro={lectureSeule} />}
        {onglet === "parametres" && <Cadre titre="Paramètres et sélection" aide="Demandés au lancement (période, collaborateurs, plan de paie…) ; utilisables dans les formules sous la forme @code.">
          <div className="max-w-xl" data-chemin="parametres"><ParametresEditeur d={d} ro={lectureSeule} m={editeur.modifier} /></div></Cadre>}
        {onglet === "sources" && <OngletSources d={d} editeur={editeur} ro={lectureSeule} />}
        {onglet === "usages" && <OngletUsages d={d} editeur={editeur} ro={lectureSeule} />}
        {onglet === "apercu" && <OngletApercu d={d} version={version} ro={lectureSeule} enregistrer={enregistrer} />}
      </div>
      </CtxCible.Provider></CtxErreurs.Provider>
    </div>
  );
}

function Cadre({ titre, aide, children, actions }: { titre: string; aide?: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-end gap-2">
        <div>
          <h2 className="text-base font-semibold">{titre}</h2>
          {aide && <p className="text-xs text-muted-foreground">{aide}</p>}
        </div>
        <div className="ml-auto flex gap-2">{actions}</div>
      </div>
      {children}
    </section>
  );
}

const th = "border-b bg-muted/60 px-2 py-1 text-left text-[11px] font-semibold text-muted-foreground";
const td = "border-b px-1 py-0.5 align-middle";

// ── Définition : l'état et ses corps ────────────────────────────────────────
function OngletDefinition({ d, editeur, version, ro, ouvrirCorps }: { d: Definition; editeur: Editeur; version: Version; ro: boolean; ouvrirCorps: (c: string) => void }) {
  const [nouveau, setNouveau] = useState<{ libelle: string; nature: Corps["nature"] }>({ libelle: "", nature: "LIGNES" });
  const corps = d.corps ?? [];
  const erreurs = useContext(CtxErreurs);
  const dndCorps = useGlisser((de, vers) => editeur.modifier((x) => { deplacer(x.corps!, de, vers); }, "co-dnd"), !ro);
  const ajouter = () => {
    const code = CODE(nouveau.libelle) || `corps_${corps.length + 1}`;
    if (corps.some((c) => c.code === code)) { toast({ title: "Ce corps existe déjà", variant: "destructive" }); return; }
    editeur.modifier((x) => {
      const c: Corps = nouveau.nature === "LIGNES"
        ? { code, libelle: nouveau.libelle, nature: "LIGNES", colonnes: [
            { code: "base", libelle: "Base", type: "MONTANT" }, { code: "taux", libelle: "Taux", type: "TAUX" },
            { code: "gains", libelle: "Gains", type: "MONTANT", total: true }, { code: "retenues", libelle: "Retenues", type: "MONTANT", total: true }],
            affectations: [] }
        : nouveau.nature === "EXERCICE"
        ? { code, libelle: nouveau.libelle, nature: "EXERCICE", colonnes: colonnesExercice(), affectations: [] }
        : { code, libelle: nouveau.libelle, nature: "CASES", lignes: [{ code: "mois", libelle: "Mois" }, { code: "cumul", libelle: "Cumul" }],
            colonnes: [{ code: "valeur", libelle: "Valeur", type: "MONTANT" }], affectations: [] };
      x.corps = [...(x.corps ?? []), c];
    }, "corps-ajout");
    setNouveau({ libelle: "", nature: "LIGNES" });
    ouvrirCorps(code);
  };
  return (
    <>
      <Cadre titre="Définition de l'état">
        <div className="grid max-w-3xl grid-cols-3 gap-3 text-sm">
          <div><div className="text-[11px] text-muted-foreground">État</div><div className="font-medium">{version.modele.code}</div></div>
          <div className="col-span-2"><div className="text-[11px] text-muted-foreground">Intitulé</div><div className="font-medium">{version.modele.libelle}</div></div>
          <div><div className="text-[11px] text-muted-foreground">Catégorie</div><div>{version.modele.categorie}</div></div>
          <div className="col-span-2"><div className="text-[11px] text-muted-foreground">Description</div><div>{version.modele.description || "—"}</div></div>
        </div>
      </Cadre>
      <Cadre titre="Corps de l'état" aide="Un corps = un bloc de données. « Lignes » : une ligne par rubrique affectée (détail du bulletin). « Cases » : un tableau fixe lignes × colonnes (cumuls, mois / cumul). « Exercice » : une ligne par rubrique, les douze mois en colonnes (bulletin récapitulatif).">
        <table className="w-full max-w-4xl border text-sm">
          <thead><tr>{["#", "Code", "Libellé", "Nature", "Impression", "Colonnes", "Lignes", "Rubriques", ""].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>
            {corps.map((c, i) => (
              <tr key={c.code} {...dndCorps.ligne(i)} data-chemin={`corps[${i}]`} title={ligneErreur(erreurs, `corps[${i}]`).title}
                className={`hover:bg-muted/30 ${ligneErreur(erreurs, `corps[${i}]`).rouge} ${dndCorps.ligne(i).className}`}>
                <td className={`${td} w-12 whitespace-nowrap text-center text-muted-foreground`}>{dndCorps.poignee(i)} {ligneErreur(erreurs, `corps[${i}]`).icone}{i + 1}</td>
                <td className={`${td} font-mono text-xs`}>{c.code}</td>
                <td className={td}>{c.libelle}</td>
                <td className={td}>{LIBELLES_NATURE[c.nature]}</td>
                <td className={td}><EmplacementCorps d={d} c={c} editeur={editeur} ro={ro} compact /></td>
                <td className={`${td} text-center`}>{c.colonnes.length}</td>
                <td className={`${td} text-center`}>{c.nature === "CASES" ? (c.lignes ?? []).length : "variable"}</td>
                <td className={`${td} text-center`}>{(c.affectations ?? []).length}</td>
                <td className={`${td} w-40 text-right`}>
                  <Button size="sm" variant="outline" className="h-7" onClick={() => ouvrirCorps(c.code)}>Ouvrir</Button>
                  {!ro && <>
                    <button type="button" className="ml-1" title="Monter" onClick={() => editeur.modifier((x) => { const z = x.corps!; if (i > 0) [z[i - 1], z[i]] = [z[i], z[i - 1]]; }, "co")}><ArrowUp className="inline h-3 w-3" /></button>
                    <button type="button" title="Descendre" onClick={() => editeur.modifier((x) => { const z = x.corps!; if (i < z.length - 1) [z[i + 1], z[i]] = [z[i], z[i + 1]]; }, "co")}><ArrowDown className="inline h-3 w-3" /></button>
                    <button type="button" className="ml-1" title="Supprimer" onClick={() => confirm(`Supprimer le corps « ${c.libelle} » et ses ${(c.affectations ?? []).length} affectation(s) ? Les tableaux et grilles qui l'affichent seront à revoir.`)
                      && editeur.modifier((x) => { x.corps = x.corps!.filter((z) => z.code !== c.code); }, "cs")}><Trash2 className="inline h-3 w-3 text-destructive" /></button>
                  </>}
                </td>
              </tr>
            ))}
            {!corps.length && <tr><td colSpan={9} className="p-4 text-center text-sm text-muted-foreground">Aucun corps : ajoutez par exemple « Détail » (lignes) et « Cumuls » (cases).</td></tr>}
          </tbody>
        </table>
        {!ro && (
          <div className="mt-2 flex max-w-4xl items-end gap-2">
            <label className="flex-1 text-xs">Libellé du nouveau corps
              <input className={`${classeChamp} mt-1`} value={nouveau.libelle} placeholder="ex. Détail, Cumuls, Congés…"
                onChange={(e) => setNouveau({ ...nouveau, libelle: e.target.value })} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && nouveau.libelle) ajouter(); }} />
            </label>
            <label className="w-56 text-xs">Nature
              <div className="mt-1"><Liste compact value={nouveau.nature} onChange={(v) => setNouveau({ ...nouveau, nature: v as Corps["nature"] })}
                options={(Object.keys(LIBELLES_NATURE) as Corps["nature"][]).map((n) => ({ v: n, l: LIBELLES_NATURE[n] }))} /></div>
            </label>
            <Button size="sm" disabled={!nouveau.libelle.trim()} onClick={ajouter}><Plus className="mr-1 h-4 w-4" />Ajouter le corps</Button>
          </div>
        )}
      </Cadre>
    </>
  );
}

// ── Corps : colonnes, lignes, rubriques ─────────────────────────────────────
/** Renomme une colonne ou une ligne d'un corps partout où elle sert (affectations, tableaux, grilles). */
function renommerDansCorps(x: Definition, corps: string, genre: "colonne" | "ligne", ancien: string, nouveau: string) {
  const c = x.corps!.find((z) => z.code === corps)!;
  for (const a of c.affectations ?? []) {
    for (const k of Object.keys(a.cibles) as AttributAffecte[]) {
      const v = a.cibles[k]!;
      if (c.nature !== "CASES" && genre === "colonne" && v === ancien) a.cibles[k] = nouveau;
      if (c.nature === "CASES") {
        const [l, col] = v.split(".");
        if (genre === "ligne" && l === ancien) a.cibles[k] = `${nouveau}.${col}`;
        if (genre === "colonne" && col === ancien) a.cibles[k] = `${l}.${nouveau}`;
      }
    }
  }
  const motif = genre === "ligne" ? new RegExp(`corps\\.${corps}\\.${ancien}\\.`, "g") : new RegExp(`(corps\\.${corps}\\.[a-z0-9_]+\\.)${ancien}\\b`, "g");
  const formes = [{ bandes: x.bandes }, ...(x.formes ?? [])];
  for (const f of formes) for (const b of f.bandes) for (const e of b.elements) {
    if (e.type === "TABLEAU" && e.corps === corps && genre === "colonne") e.colonnes.forEach((col) => { if (col.valeur === ancien) col.valeur = nouveau; });
    if (e.type === "GRILLE") e.lignes.forEach((lg) => Object.keys(lg.valeurs ?? {}).forEach((k) => {
      lg.valeurs![k] = lg.valeurs![k].replace(motif, genre === "ligne" ? `corps.${corps}.${nouveau}.` : `$1${nouveau}`);
    }));
  }
}

type SousCorps = "rubriques" | "sections" | "colonnes" | "lignes";
const LIBELLES_ATTRIBUT: Record<string, string> = {
  MT: "Montant", NB: "Nombre", BASE: "Base", TX: "Taux (dernier du mois)", PAT: "Part patronale", TXP: "Taux patronal",
};
/** Une affectation « formule » (même encore vide) ou « rubrique ». */
const estFormule = (a?: Affectation) => !!a && !a.rubrique && a.formule !== undefined && a.formule !== null;

/** Emplacement à l'impression d'un corps et son état dans la mise en forme courante (RG-EDT-DONNEES-07). */
function EmplacementCorps({ d, c, editeur, ro, compact }: { d: Definition; c: Corps; editeur: Editeur; ro: boolean; compact?: boolean }) {
  const e = emplacementDe(c);
  const ok = placementConforme(d, c);
  const usages = usagesDuCorps(d, c.code);
  const appliquer = (nouveau?: Emplacement) => {
    let compte = "";
    editeur.modifier((x) => {
      const z = x.corps!.find((y) => y.code === c.code)!;
      if (nouveau) poser(z, "emplacement", nouveau === (z.nature === "CASES" ? "BAS_DE_PAGE" : "DETAIL") ? null : nouveau);
      compte = placerCorps(x, c.code);
    }, `emp:${c.code}`);
    if (compte) toast({ title: "Mise en forme mise à jour", description: compte });
  };
  const etat = e === "MASQUE" ? (ok ? "non imprimé" : "encore imprimé dans la mise en forme")
    : ok ? usages.map((u) => `${u.element.id} · ${libelleBande(u.bande.type)}`).join(", ")
    : usages.length ? `imprimé ailleurs : ${usages.map((u) => libelleBande(u.bande.type)).join(", ")}` : "pas encore dans la mise en forme";
  if (compact) return (
    <span className={`whitespace-nowrap text-xs ${ok ? "" : "font-medium text-[hsl(var(--warning))]"}`} title={etat}>
      {EMPLACEMENTS.find((x) => x.v === e)?.l}{!ok && " ⚠"}
    </span>
  );
  return (
    <label className="text-xs">Emplacement à l'impression
      <div className="mt-1 flex items-center gap-2">
        <Liste compact className="w-44" disabled={ro} value={e} onChange={(v) => appliquer(v as Emplacement)}
          options={EMPLACEMENTS.map((x) => ({ v: x.v, l: x.l, titre: x.aide }))} />
        <span className={`max-w-xs truncate ${ok ? "text-muted-foreground" : "font-medium text-[hsl(var(--warning))]"}`} title={etat}>
          {ok ? "✓ " : "⚠ "}{etat}
        </span>
        {!ok && !ro && <Button size="sm" variant="outline" className="h-7" onClick={() => appliquer()}>Placer</Button>}
      </div>
    </label>
  );
}
function OngletCorps({ d, editeur, ro, actif, setActif, sous, setSous }: {
  d: Definition; editeur: Editeur; ro: boolean; actif: string | null; setActif: (c: string) => void; sous: SousCorps; setSous: (s: SousCorps) => void;
}) {
  const erreurs = useContext(CtxErreurs);
  const corps = d.corps ?? [];
  const c = corps.find((z) => z.code === actif) ?? corps[0];
  const ci = c ? corps.indexOf(c) : -1;
  if (!c) return <p className="text-sm text-muted-foreground">Aucun corps. Ajoutez-en un dans l'onglet Définition.</p>;
  const majC = (fn: (c: Corps) => void, cle: string) => editeur.modifier((x) => { const z = x.corps!.find((y) => y.code === c.code); if (z) fn(z); }, `${cle}:${c.code}`);

  return (
    <div className="flex gap-4">
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <label className="text-xs">Libellé<input className={`${classeChamp} mt-1 w-64 text-sm`} disabled={ro} value={c.libelle}
            onKeyDown={(e) => e.stopPropagation()} onChange={(e) => majC((z) => { z.libelle = e.target.value; }, "lib")} /></label>
          <div className="text-xs"><div className="text-muted-foreground">Code · nature</div>
            <div className="mt-1 py-1 text-sm"><span className="font-mono">{c.code}</span> · {LIBELLES_NATURE[c.nature].toLowerCase()}</div></div>
          {c.nature !== "CASES" && (
            <label className="flex items-center gap-1.5 self-center pt-4 text-xs" title="Titre imprimé au-dessus des lignes du corps qui n'ont pas de groupe">
              <Checkbox disabled={ro} checked={c.afficher_titre ?? true}
                onCheckedChange={(coche) => majC((z) => poser(z, "afficher_titre", (coche === true) ? null : false), "titre")} />
              Imprimer le titre du corps
            </label>
          )}
          <EmplacementCorps d={d} c={c} editeur={editeur} ro={ro} />
          {c.nature !== "CASES" && (
            <label className="text-xs">Tri des lignes
              <div className="mt-1 w-56"><Liste compact disabled={ro} value={c.tri ?? "AFFECTATION"}
                onChange={(v) => majC((z) => poser(z, "tri", v === "AFFECTATION" ? null : v), "tri")}
                options={[{ v: "AFFECTATION", l: "Ordre des affectations" }, { v: "PAIE", l: "Ordre d'affichage de la paie" }, { v: "CODE", l: "Code rubrique" }]} /></div></label>
          )}
        </div>
        <div className="mb-3 flex gap-1 border-b text-sm">
          {([["rubriques", `Rubriques (${(c.affectations ?? []).length})`],
            ...(c.nature !== "CASES" ? [["sections", `Sections (${(c.sections ?? []).length})`]] : []),
            ["colonnes", `Colonnes (${c.colonnes.length})`],
            ...(c.nature === "CASES" ? [["lignes", `Lignes (${(c.lignes ?? []).length})`]] : [])] as [typeof sous, string][]).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setSous(k)}
              className={`-mb-px border-b-2 px-3 py-1.5 ${sous === k ? "border-primary font-medium" : "border-transparent text-muted-foreground"}`}>{l}
              {(() => { const n = messagesDe(erreurs, `corps[${ci}].${k === "rubriques" ? "affectations" : k}`).length;
                return n ? <span className="ml-1 rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-destructive-foreground">{n}</span> : null; })()}</button>
          ))}
        </div>
        {sous === "colonnes" && <GrilleColonnes c={c} ci={ci} ro={ro} majC={majC} editeur={editeur} />}
        {sous === "lignes" && c.nature === "CASES" && <GrilleLignes c={c} ci={ci} ro={ro} majC={majC} editeur={editeur} />}
        {sous === "rubriques" && <GrilleAffectations c={c} ci={ci} d={d} ro={ro} majC={majC} editeur={editeur} />}
        {sous === "sections" && c.nature !== "CASES" && <GrilleSections c={c} ci={ci} ro={ro} majC={majC} />}
      </div>
      <aside className="w-40 shrink-0">
        <div className="rounded border p-2">
          <div className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">Corps</div>
          {corps.map((z, zi) => (
            <label key={z.code} className={`flex cursor-pointer items-center gap-1.5 py-0.5 text-sm ${messagesDe(erreurs, `corps[${zi}]`).length ? "text-destructive" : ""}`}>
              <input type="radio" checked={z.code === c.code} onChange={() => setActif(z.code)} />
              <span className="truncate">{z.libelle}</span>
              {messagesDe(erreurs, `corps[${zi}]`).length > 0 && <AlertTriangle className="ml-auto h-3 w-3 shrink-0" />}
            </label>
          ))}
        </div>
      </aside>
    </div>
  );
}

const TYPES_COLONNE: { v: TypeColonneCorps; l: string }[] = [
  { v: "MONTANT", l: "Montant" }, { v: "NOMBRE", l: "Nombre" }, { v: "TAUX", l: "Taux" }, { v: "TEXTE", l: "Texte" }, { v: "DATE", l: "Date" },
];

function GrilleColonnes({ c, ci, ro, majC, editeur }: { c: Corps; ci: number; ro: boolean; majC: (fn: (c: Corps) => void, cle: string) => void; editeur: Editeur }) {
  const dnd = useGlisser((de, vers) => majC((z) => { deplacer(z.colonnes, de, vers); }, "co-dnd"), !ro);
  const erreurs = useContext(CtxErreurs);
  const { masques } = useReferentiels();
  const [codes, setCodes] = useState<Record<number, string>>({});
  const fixes = c.nature === "EXERCICE";             // RG-EDT-EXERCICE-01 : m01…m12 et total
  const renommer = (i: number) => {
    const nouveau = CODE(codes[i] ?? "");
    setCodes((s) => { const n = { ...s }; delete n[i]; return n; });
    const ancien = c.colonnes[i].code;
    if (!nouveau || nouveau === ancien) return;
    if (c.colonnes.some((x) => x.code === nouveau)) { toast({ title: `La colonne « ${nouveau} » existe déjà`, variant: "destructive" }); return; }
    editeur.modifier((x) => { x.corps!.find((z) => z.code === c.code)!.colonnes[i].code = nouveau; renommerDansCorps(x, c.code, "colonne", ancien, nouveau); }, "col-ren");
  };
  return (
    <>
      <p className="mb-2 text-xs text-muted-foreground">{fixes
        ? "Corps « exercice » : une colonne par mois et le total, fixes. Vous pouvez en changer l'intitulé, le type et le masque."
        : "Les colonnes reçoivent les valeurs des rubriques (onglet Rubriques). La mise en forme en reprendra le libellé, le type et le masque."}</p>
      <table className="w-full max-w-4xl border text-sm">
        <thead><tr>{["#", "Code", "Intitulé colonne", "Sigle", "Type", "Masque", "Total", ""].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>
          {c.colonnes.map((col, i) => { const er = ligneErreur(erreurs, `corps[${ci}].colonnes[${i}]`); return (
            <tr key={i} {...dnd.ligne(i)} data-chemin={er["data-chemin"]} title={er.title} className={`${er.rouge} ${dnd.ligne(i).className}`}>
              <td className={`${td} w-12 whitespace-nowrap text-center text-muted-foreground`}>{dnd.poignee(i)} {er.icone}{i + 1}</td>
              <td className={`${td} w-32`}><input className={`${classeChamp} font-mono`} disabled={ro || fixes} value={codes[i] ?? col.code}
                onChange={(e) => setCodes({ ...codes, [i]: e.target.value })} onBlur={() => codes[i] !== undefined && renommer(i)}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") renommer(i); }} /></td>
              <td className={td}><input className={classeChamp} disabled={ro} value={col.libelle} onKeyDown={(e) => e.stopPropagation()}
                onChange={(e) => majC((z) => { z.colonnes[i].libelle = e.target.value; }, `cl${i}`)} /></td>
              <td className={`${td} w-24`}><input className={classeChamp} disabled={ro} value={col.sigle ?? ""} onKeyDown={(e) => e.stopPropagation()}
                onChange={(e) => majC((z) => poser(z.colonnes[i], "sigle", e.target.value), `cs${i}`)} /></td>
              <td className={`${td} w-28`}><Choix value={col.type ?? "MONTANT"} disabled={ro} options={TYPES_COLONNE}
                onChange={(v) => majC((z) => poser(z.colonnes[i], "type", v === "MONTANT" ? null : v), `ct${i}`)} /></td>
              <td className={`${td} w-44`}><Choix value={col.masque} disabled={ro} vide="Selon le type" options={masques.map((m) => ({ v: m.code, l: `${m.libelle} (${m.exemple})` }))}
                onChange={(v) => majC((z) => poser(z.colonnes[i], "masque", v), `cm${i}`)} /></td>
              <td className={`${td} w-14 text-center`}><Checkbox disabled={ro} checked={!!col.total}
                onCheckedChange={(coche) => majC((z) => poser(z.colonnes[i], "total", (coche === true) || null), `cto${i}`)} /></td>
              <td className={`${td} w-20 text-right`}>{!ro && !fixes && <>
                <button type="button" onClick={() => majC((z) => { if (i > 0) [z.colonnes[i - 1], z.colonnes[i]] = [z.colonnes[i], z.colonnes[i - 1]]; }, "co")}><ArrowUp className="inline h-3 w-3" /></button>
                <button type="button" onClick={() => majC((z) => { if (i < z.colonnes.length - 1) [z.colonnes[i + 1], z.colonnes[i]] = [z.colonnes[i], z.colonnes[i + 1]]; }, "co")}><ArrowDown className="inline h-3 w-3" /></button>
                <button type="button" disabled={c.colonnes.length === 1} onClick={() => {
                  const utilisee = (c.affectations ?? []).some((a) => Object.values(a.cibles).some((v) => v === col.code || v?.endsWith(`.${col.code}`)));
                  if (!utilisee || confirm("Des rubriques alimentent cette colonne ; leurs affectations vers elle seront retirées. Continuer ?"))
                    majC((z) => {
                      z.colonnes.splice(i, 1);
                      (z.affectations ?? []).forEach((a) => (Object.keys(a.cibles) as AttributAffecte[]).forEach((k) => {
                        const v = a.cibles[k]!; if (v === col.code || v.endsWith(`.${col.code}`)) delete a.cibles[k];
                      }));
                    }, "csup");
                }}><Trash2 className="inline h-3 w-3 text-destructive" /></button></>}</td>
            </tr>
          ); })}
        </tbody>
      </table>
      {!ro && !fixes && <Button size="sm" variant="outline" className="mt-2" onClick={() => majC((z) => {
        let n = z.colonnes.length + 1; while (z.colonnes.some((x) => x.code === `colonne_${n}`)) n++;
        z.colonnes.push({ code: `colonne_${n}`, libelle: `Colonne ${n}` });
      }, "cadd")}><Plus className="mr-1 h-4 w-4" />Colonne</Button>}
    </>
  );
}

function GrilleLignes({ c, ci, ro, majC, editeur }: { c: Corps; ci: number; ro: boolean; majC: (fn: (c: Corps) => void, cle: string) => void; editeur: Editeur }) {
  const lignes = c.lignes ?? [];
  const dnd = useGlisser((de, vers) => majC((z) => { deplacer(z.lignes!, de, vers); }, "lo-dnd"), !ro);
  const erreurs = useContext(CtxErreurs);
  const [codes, setCodes] = useState<Record<number, string>>({});
  const renommer = (i: number) => {
    const nouveau = CODE(codes[i] ?? "");
    setCodes((s) => { const n = { ...s }; delete n[i]; return n; });
    const ancien = lignes[i].code;
    if (!nouveau || nouveau === ancien) return;
    if (lignes.some((x) => x.code === nouveau)) { toast({ title: `La ligne « ${nouveau} » existe déjà`, variant: "destructive" }); return; }
    editeur.modifier((x) => { x.corps!.find((z) => z.code === c.code)!.lignes![i].code = nouveau; renommerDansCorps(x, c.code, "ligne", ancien, nouveau); }, "lig-ren");
  };
  return (
    <>
      <p className="mb-2 text-xs text-muted-foreground">Lignes fixes du corps (ex. Mois, Cumul). Chaque case est ligne × colonne.</p>
      <table className="w-full max-w-2xl border text-sm">
        <thead><tr>{["#", "Code", "Intitulé ligne", ""].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>
          {lignes.map((l, i) => { const er = ligneErreur(erreurs, `corps[${ci}].lignes[${i}]`); return (
            <tr key={i} {...dnd.ligne(i)} data-chemin={er["data-chemin"]} title={er.title} className={`${er.rouge} ${dnd.ligne(i).className}`}>
              <td className={`${td} w-12 whitespace-nowrap text-center text-muted-foreground`}>{dnd.poignee(i)} {er.icone}{i + 1}</td>
              <td className={`${td} w-40`}><input className={`${classeChamp} font-mono`} disabled={ro} value={codes[i] ?? l.code}
                onChange={(e) => setCodes({ ...codes, [i]: e.target.value })} onBlur={() => codes[i] !== undefined && renommer(i)}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") renommer(i); }} /></td>
              <td className={td}><input className={classeChamp} disabled={ro} value={l.libelle} onKeyDown={(e) => e.stopPropagation()}
                onChange={(e) => majC((z) => { z.lignes![i].libelle = e.target.value; }, `ll${i}`)} /></td>
              <td className={`${td} w-20 text-right`}>{!ro && <>
                <button type="button" onClick={() => majC((z) => { const y = z.lignes!; if (i > 0) [y[i - 1], y[i]] = [y[i], y[i - 1]]; }, "lo")}><ArrowUp className="inline h-3 w-3" /></button>
                <button type="button" onClick={() => majC((z) => { const y = z.lignes!; if (i < y.length - 1) [y[i + 1], y[i]] = [y[i], y[i + 1]]; }, "lo")}><ArrowDown className="inline h-3 w-3" /></button>
                <button type="button" disabled={lignes.length === 1} onClick={() => majC((z) => {
                  z.lignes!.splice(i, 1);
                  (z.affectations ?? []).forEach((a) => (Object.keys(a.cibles) as AttributAffecte[]).forEach((k) => { if (a.cibles[k]!.startsWith(`${l.code}.`)) delete a.cibles[k]; }));
                }, "lsup")}><Trash2 className="inline h-3 w-3 text-destructive" /></button></>}</td>
            </tr>
          ); })}
        </tbody>
      </table>
      {!ro && <Button size="sm" variant="outline" className="mt-2" onClick={() => majC((z) => {
        let n = (z.lignes ?? []).length + 1; while ((z.lignes ?? []).some((x) => x.code === `ligne_${n}`)) n++;
        z.lignes = [...(z.lignes ?? []), { code: `ligne_${n}`, libelle: `Ligne ${n}` }];
      }, "ladd")}><Plus className="mr-1 h-4 w-4" />Ligne</Button>}
    </>
  );
}

/** Cibles possibles : colonnes (corps LIGNES) ou cases ligne.colonne (corps CASES). */
function ciblesDuCorps(c: Corps): { v: string; l: string }[] {
  if (c.nature === "EXERCICE") return [{ v: "mois", l: "Mois (ventilé)" }];
  return c.nature !== "CASES"
    ? c.colonnes.map((col) => ({ v: col.code, l: col.libelle }))
    : (c.lignes ?? []).flatMap((l) => c.colonnes.map((col) => ({ v: `${l.code}.${col.code}`, l: `${l.libelle} · ${col.libelle}` })));
}

function GrilleAffectations({ c, ci, d, ro, majC, editeur }: { c: Corps; ci: number; d: Definition; ro: boolean; majC: (fn: (c: Corps) => void, cle: string) => void; editeur: Editeur }) {
  const { rubriques } = useReferentiels();
  const [q, setQ] = useState("");
  const [filtreSection, setFiltreSection] = useState("");
  const [ajout, setAjout] = useState(false);
  // RG-EDT-RUBRIQUES-02 (Adil DAIA) : sélection multiple → rattacher à une section, retirer, supprimer
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [cibleSection, setCibleSection] = useState("");
  const affs = c.affectations ?? [];
  const sections = c.sections ?? [];
  const libSection = (code?: string | null) => sections.find((x) => x.code === code)?.libelle ?? "";
  const anciensGroupes = c.nature !== "CASES" ? affs.filter((a) => a.groupe && !a.section).length : 0;
  const cibles = ciblesDuCorps(c);
  const nomRub = (code?: string | null) => (code ? rubriques.find((r) => r.code === code)?.libelle ?? RUBRIQUES_EN_TETE.find((r) => r.code === code)?.libelle ?? "?" : "");
  const bas = q.trim().toLowerCase();
  const visibles = affs.map((a, i) => ({ a, i }))
    .filter(({ a }) => !filtreSection || (filtreSection === "__sans__" ? !a.section : a.section === filtreSection))
    .filter(({ a }) => !bas || (a.rubrique ?? "").toLowerCase().includes(bas)
    || nomRub(a.rubrique).toLowerCase().includes(bas) || (a.groupe ?? "").toLowerCase().includes(bas)
    || libSection(a.section).toLowerCase().includes(bas) || (a.formule ?? "").toLowerCase().includes(bas));
  // RG-EDT-SECTION-01 : nouvelle section créée depuis la liste d'une rubrique
  const nouvelleSection = (i: number | null): string | null => {
    const libelle = window.prompt("Nom de la nouvelle section (ex. Éléments de rémunération)")?.trim();
    if (!libelle) return null;
    const code = codeSection(libelle, new Set(sections.map((x) => x.code)));
    majC((z) => { z.sections = [...(z.sections ?? []), { code, libelle }]; if (i !== null) { z.affectations![i].section = code; delete z.affectations![i].groupe; } rangerParSection(z); }, "sadd");
    return code;
  };
  const majA = (i: number, fn: (a: Affectation) => void, cle: string) => majC((z) => fn(z.affectations![i]), `${cle}${i}`);
  useEffect(() => { setSel(new Set()); }, [affs.length, c.code]);
  const basculerSel = (i: number) => setSel((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const toutesVisiblesCochees = visibles.length > 0 && visibles.every(({ i }) => sel.has(i));
  const reparerFusions = (y: Affectation[]) => y.forEach((a, k) => { if (a.fusion && (k === 0 || estFormule(a) !== estFormule(y[k - 1]))) delete a.fusion; });
  const supprimerSelection = () => {
    if (!sel.size || !window.confirm(`Retirer ${sel.size} rubrique(s) de ce corps ?`)) return;
    const indices = [...sel].sort((x, y) => y - x);
    majC((z) => { indices.forEach((k) => z.affectations!.splice(k, 1)); reparerFusions(z.affectations!); }, "asel-sup");
    setSel(new Set());
  };
  const rattacherSelection = (code: string) => {
    if (!sel.size) return;
    majC((z) => {
      const y = z.affectations!;
      sel.forEach((k) => {
        // une rubrique emmène les lignes fusionnées sous elle
        for (let n = k; n < y.length && (n === k || y[n].fusion); n++) { if (code) { y[n].section = code; delete y[n].groupe; } else delete y[n].section; }
      });
      rangerParSection(z);
    }, "asel-sec");
    setSel(new Set());
    setCibleSection("");
  };
  const autres = (d.corps ?? []).filter((z) => z.code !== c.code);
  const erreurs = useContext(CtxErreurs);
  const cible = useContext(CtxCible);
  useEffect(() => { if (cible?.chemin.startsWith(`corps[${ci}].affectations`)) setQ(""); }, [cible, ci]);   // la ligne visée ne reste pas cachée par le filtre
  // RG-EDT-LIGNES-02 (Adil DAIA) : une ligne fusionnée voyage avec les rubriques qui lui sont jointes ;
  // on ne dépose jamais entre une rubrique et ses fusions, et une fusion sans rubrique au-dessus est défaite.
  const dnd = useGlisser((de, vers) => majC((z) => {
    const y = z.affectations!;
    let nb = 1;
    if (!y[de].fusion) while (de + nb < y.length && y[de + nb].fusion) nb++;
    while (vers < y.length && y[vers]?.fusion && !(vers > de && vers <= de + nb - 1)) vers++;
    const pos = deplacer(y, de, vers, nb);
    // RG-EDT-SECTION-01 : déposée parmi les rubriques d'une section, la rubrique y entre
    if (z.sections?.length) {
      const voisin = y[pos - 1] ?? y[pos + nb];
      for (let n = pos; n < pos + nb; n++) { if (voisin?.section) y[n].section = voisin.section; else delete y[n].section; }
    }
    y.forEach((a, k) => { if (a.fusion && (k === 0 || estFormule(a) !== estFormule(y[k - 1]))) delete a.fusion; });
    rangerParSection(z);
  }, "ao-dnd"), !ro);

  const exo = c.nature === "EXERCICE";              // RG-EDT-EXERCICE-01 : un attribut ventilé sur les mois
  const selCible = (a: Affectation, i: number, attr: AttributAffecte) => {
    const interdit = a.periode === "CUMUL" && (attr === "TX" || attr === "TXP");
    return (
      <Liste compact className={`min-w-[96px] ${a.cibles[attr] ? "bg-primary/5 font-medium" : ""}`} disabled={ro || interdit}
        title={interdit ? "Pas de cumul pour cet attribut" : undefined} value={a.cibles[attr] ?? ""} vide="—"
        onChange={(v) => majA(i, (z) => { if (v) z.cibles[attr] = v; else delete z.cibles[attr]; }, `t${attr}`)}
        options={cibles} />
    );
  };

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
          <input className={`${classeChamp} pl-7`} placeholder="Filtrer les affectations…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </div>
        {c.nature !== "CASES" && sections.length > 0 && (
          <Liste compact className="w-52" value={filtreSection} onChange={setFiltreSection} vide="Toutes les sections"
            options={[...sections.map((x) => ({ v: x.code, l: x.libelle })), { v: "__sans__", l: "Sans section" }]} />
        )}
        {!ro && anciensGroupes > 0 && (
          <Button size="sm" variant="outline" title="Chaque groupe saisi en texte libre devient une section du corps (titre, ordre, sous-total)"
            onClick={() => majC((z) => { const n = groupesEnSections(z); toast({ title: `${n} rubrique(s) rangée(s) dans des sections` }); }, "g2s")}>
            Convertir les groupes en sections ({anciensGroupes})</Button>
        )}
        <span className="text-xs text-muted-foreground">{exo
          ? "Chaque rubrique : l'attribut (montant, nombre, base…) imprimé mois par mois, total en fin de ligne. Une rubrique sans aucune valeur n'est jamais imprimée."
          : "Nb, Mt, Tx, Base, Patronal : colonne qui reçoit la valeur. Comparaison / Écart : période de comparaison (mois précédent ou choisie). Une rubrique sans aucune valeur n'est jamais imprimée ; à zéro, seulement si « Nulls »."}</span>
        {!ro && <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={() => setAjout(true)}><Plus className="mr-1 h-4 w-4" />Ajouter des rubriques</Button>
          <Button size="sm" variant="outline" onClick={() => majC((z) => { z.affectations = [...(z.affectations ?? []), { formule: "", cibles: exo ? { VAL: "mois" } : {} }]; }, "fadd")}>Ajouter une formule</Button>
        </div>}
      </div>
      {!ro && sel.size > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded border border-primary/30 bg-primary/5 px-2 py-1.5 text-xs">
          <b>{sel.size} rubrique(s) sélectionnée(s)</b>
          {c.nature !== "CASES" && <>
            <span className="ml-2 text-muted-foreground">Rattacher à</span>
            <Liste compact className="w-56" value={cibleSection} onChange={setCibleSection} placeholder="Choisir une section…"
              options={[...sections.map((x) => ({ v: x.code, l: x.libelle })), { v: "__sans__", l: "Sans section" }]} />
            <Button size="sm" variant="outline" disabled={!cibleSection} onClick={() => rattacherSelection(cibleSection === "__sans__" ? "" : cibleSection)}>Rattacher</Button>
          </>}
          <Button size="sm" variant="outline" className="text-destructive" onClick={supprimerSelection}><Trash2 className="mr-1 h-3.5 w-3.5" />Retirer du corps</Button>
          <button type="button" className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setSel(new Set())}>Tout désélectionner</button>
        </div>
      )}
      <div className="overflow-auto rounded border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10"><tr>
            <th className={`${th} w-8 text-center`}>{!ro && <Checkbox checked={toutesVisiblesCochees} title="Tout cocher (rubriques affichées)"
              onCheckedChange={(v) => setSel(v === true ? new Set([...sel, ...visibles.map(({ i }) => i)]) : new Set([...sel].filter((k) => !visibles.some((x) => x.i === k))))} />}</th>
            {["#", "Rubrique", ...(exo ? ["Valeur imprimée chaque mois"] : ["Période", ...ATTRIBUTS_AFFECTABLES.map((x) => `${x.libelle} →`)]), ...(c.nature !== "CASES" ? ["Section"] : []), "Libellé imprimé", "en –", "Nulls",
              ...(c.nature !== "CASES" ? ["Fusion ↑", "Gras"] : []), ""].map((h) => <th key={h} className={th}
                title={h === "Nulls" ? "Imprimée même quand ses valeurs sont à zéro. Une rubrique sans aucune valeur n'est jamais imprimée." : h === "Fusion ↑" ? "Même ligne que celle du dessus. Rubriques : valeurs additionnées (« en – » soustrait). Formules : plusieurs formules sur une ligne, chacune dans sa colonne" : h === "Gras" ? "Ligne imprimée en gras (par défaut pour une formule)" : undefined}>{h}</th>)}
          </tr></thead>
          <tbody>
            {visibles.map(({ a, i }, k) => { const er = ligneErreur(erreurs, `corps[${ci}].affectations[${i}]`);
              const entete = sections.length > 0 && !a.fusion && (k === 0 || (visibles[k - 1].a.section ?? "") !== (a.section ?? ""));
              return (<Fragment key={i}>
              {entete && <tr className="bg-muted/40"><td colSpan={16} className="px-2 py-1 text-xs font-semibold text-primary">
                {a.section ? libSection(a.section) || a.section : "Sans section"}
                <span className="ml-2 font-normal text-muted-foreground">· {affs.filter((x) => (x.section ?? "") === (a.section ?? "") && !x.fusion).length} rubrique(s)</span></td></tr>}
              <tr {...dnd.ligne(i)} data-chemin={er["data-chemin"]} title={er.title}
                className={`hover:bg-muted/30 ${sel.has(i) ? "bg-primary/10" : a.fusion && !er.rouge ? "bg-primary/5" : ""} ${er.rouge} ${dnd.ligne(i).className}`}>
                <td className={`${td} w-8 text-center`}>{!ro && <Checkbox checked={sel.has(i)} onCheckedChange={() => basculerSel(i)} />}</td>
                <td className={`${td} w-12 whitespace-nowrap text-center text-xs text-muted-foreground`}>{dnd.poignee(i)} {er.icone}{a.fusion ? "↳" : i + 1}</td>
                {a.formule !== undefined && a.formule !== null && !a.rubrique ? (
                  <>
                    <td className={`${td} min-w-[240px]`} colSpan={exo ? 1 : 2}>
                      <FormuleInput value={a.formule ?? ""} disabled={ro} placeholder={exo ? "Formule du mois (ex. [SALBASE].MT + [PRIM_ANC].MT)" : "Formule (ex. cumul.total_brut)"} corpsCourant={c.code}
                        onChange={(v) => majA(i, (z) => { z.formule = v; if (exo) z.cibles = { VAL: "mois" }; }, "f")} />
                    </td>
                    {exo ? <td className={`${td} text-xs text-muted-foreground`}>Évaluée mois par mois</td> : <td className={td} colSpan={ATTRIBUTS_AFFECTABLES.length}>
                      <span className="mr-2 text-xs text-muted-foreground">Valeur →</span>
                      <span className="inline-block w-48 align-middle"><Liste compact disabled={ro} value={a.cibles.VAL ?? ""} vide="—"
                        onChange={(v) => majA(i, (z) => { z.cibles = v ? { VAL: v } : {}; }, "fv")} options={cibles} /></span>
                    </td>}
                  </>
                ) : (
                  <>
                    <td className={`${td} min-w-[180px]`}>
                      <div className="font-mono text-xs">{a.rubrique}</div>
                      <div className="truncate text-[11px] text-muted-foreground" title={nomRub(a.rubrique)}>{nomRub(a.rubrique)}</div>
                    </td>
                    {exo ? (
                      <td className={`${td} w-56`}>
                        <Liste compact className={Object.keys(a.cibles).length ? "bg-primary/5 font-medium" : ""} disabled={ro}
                          value={Object.keys(a.cibles)[0] ?? ""} vide="—"
                          onChange={(v) => majA(i, (z) => { z.cibles = v ? { [v]: "mois" } : {}; }, "ex")}
                          options={ATTRIBUTS_AFFECTABLES.map((x) => ({ v: x.code, l: LIBELLES_ATTRIBUT[x.code] }))} />
                      </td>
                    ) : <>
                    <td className={`${td} w-28`}>
                      <Liste compact disabled={ro} value={a.periode ?? "MOIS"}
                        title={PERIODES_AFFECTATION.find((p) => p.v === (a.periode ?? "MOIS"))?.aide}
                        onChange={(v) => majA(i, (z) => {
                          poser(z, "periode", v === "MOIS" ? null : v);
                          if (v === "CUMUL") { delete z.cibles.TX; delete z.cibles.TXP; }
                        }, "p")}
                        options={PERIODES_AFFECTATION.map((p) => ({ v: p.v, l: p.l, titre: p.aide }))} />
                    </td>
                    {ATTRIBUTS_AFFECTABLES.map((x) => <td key={x.code} className={td}>{selCible(a, i, x.code)}</td>)}
                    </>}
                  </>
                )}
                {c.nature !== "CASES" && <td className={`${td} w-44`}>
                  {a.fusion ? <span className="px-1 text-[11px] text-muted-foreground">(ligne au-dessus)</span> : (
                    <Liste compact disabled={ro} value={a.section ?? ""} vide={a.groupe && !a.section ? `${a.groupe} (groupe)` : "—"}
                      title={a.groupe && !a.section ? "Ancien groupe en texte libre : « Convertir les groupes en sections »" : undefined}
                      options={[...sections.map((x) => ({ v: x.code, l: x.libelle })), ...(ro ? [] : [{ v: "__nouvelle__", l: "+ Nouvelle section…" }])]}
                      onChange={(v) => {
                        if (v === "__nouvelle__") { nouvelleSection(i); return; }
                        majC((z) => {
                          const y = z.affectations!;
                          for (let n = i; n < y.length && (n === i || y[n].fusion); n++) { poser(y[n], "section", v || null); if (v) delete y[n].groupe; }
                          rangerParSection(z);
                        }, `sec${i}`);
                      }} />
                  )}</td>}
                <td className={`${td} min-w-[150px]`}><input className={classeChamp} disabled={ro || !!a.fusion} value={a.fusion ? "" : a.libelle ?? ""} placeholder={a.fusion ? "(ligne au-dessus)" : nomRub(a.rubrique) || "—"}
                  onKeyDown={(e) => e.stopPropagation()} onChange={(e) => majA(i, (z) => poser(z, "libelle", e.target.value), "l")} /></td>
                <td className={`${td} w-12 text-center`}><Checkbox disabled={ro} checked={!!a.negatif} onCheckedChange={(coche) => majA(i, (z) => poser(z, "negatif", (coche === true) || null), "n")} /></td>
                <td className={`${td} w-12 text-center`}><Checkbox disabled={ro} checked={!!a.nulle} onCheckedChange={(coche) => majA(i, (z) => poser(z, "nulle", (coche === true) || null), "z")} /></td>
                {c.nature !== "CASES" && <>
                  <td className={`${td} w-14 text-center`}><Checkbox disabled={ro || i === 0 || estFormule(a) !== estFormule(affs[i - 1])}
                    title={estFormule(a) ? "Même ligne que la formule au-dessus (chaque formule dans sa colonne)" : "S'ajoute à la ligne au-dessus"} checked={!!a.fusion} onCheckedChange={(coche) => majA(i, (z) => poser(z, "fusion", (coche === true) || null), "fu")} /></td>
                  <td className={`${td} w-12 text-center`}><Checkbox disabled={ro || !!a.fusion}
                    checked={a.gras ?? !!a.formule} onCheckedChange={(coche) => majA(i, (z) => poser(z, "gras", (coche === true) === !!z.formule ? null : (coche === true)), "gr")} /></td>
                </>}
                <td className={`${td} w-28 whitespace-nowrap text-right`}>{!ro && <>
                  <button type="button" title="Monter (dans sa section)" disabled={i === 0 || (affs[i - 1].section ?? "") !== (a.section ?? "")} className="disabled:opacity-30"
                    onClick={() => majC((z) => { const y = z.affectations!; if (i > 0) [y[i - 1], y[i]] = [y[i], y[i - 1]]; }, "ao")}><ArrowUp className="inline h-3 w-3" /></button>
                  <button type="button" title="Descendre (dans sa section)" disabled={i === affs.length - 1 || (affs[i + 1].section ?? "") !== (a.section ?? "")} className="disabled:opacity-30"
                    onClick={() => majC((z) => { const y = z.affectations!; if (i < y.length - 1) [y[i + 1], y[i]] = [y[i], y[i + 1]]; }, "ao")}><ArrowDown className="inline h-3 w-3" /></button>
                  <button type="button" title="Dupliquer (ex. version Cumul)" onClick={() => majC((z) => { z.affectations!.splice(i + 1, 0, JSON.parse(JSON.stringify(a))); }, "ad")}><Copy className="inline h-3 w-3" /></button>
                  {autres.length > 0 && (
                    <Liste compact className="ml-1 inline-flex h-6 w-9 border-0 bg-transparent px-1 shadow-none" title="Copier vers un autre corps"
                      value="" placeholder="⇢" largeurMenu="w-56"
                      options={autres.map((z) => ({ v: z.code, l: `Copier vers « ${z.libelle} »` }))}
                      onChange={(cible) => {
                        if (!cible) return;
                        editeur.modifier((x) => { const z = x.corps!.find((y) => y.code === cible)!; z.affectations = [...(z.affectations ?? []), { ...JSON.parse(JSON.stringify(a)), cibles: {} }]; }, "acp");
                        toast({ title: "Affectation copiée", description: "Choisissez ses colonnes dans l'autre corps." });
                      }} />
                  )}
                  <button type="button" className="ml-1" title="Retirer" onClick={() => majC((z) => { z.affectations!.splice(i, 1); }, "as")}><Trash2 className="inline h-3 w-3 text-destructive" /></button>
                </>}</td>
              </tr></Fragment>
            ); })}
            {!affs.length && <tr><td colSpan={16} className="p-6 text-center text-sm text-muted-foreground">
              Aucune rubrique. « Ajouter des rubriques » permet d'en choisir plusieurs et de leur donner la même répartition.</td></tr>}
          </tbody>
        </table>
      </div>
      {ajout && <AjoutRubriques c={c} onFermer={() => setAjout(false)}
        onAjouter={(nouvelles, section) => {
          majC((z) => {
            if (section && !(z.sections ?? []).some((x) => x.code === section.code)) z.sections = [...(z.sections ?? []), section];
            z.affectations = [...(z.affectations ?? []), ...nouvelles];
            rangerParSection(z);
          }, "radd");
          setAjout(false);
        }} />}
    </>
  );
}

/** RG-EDT-SECTION-01 (Adil DAIA) : sections du corps — ordre d'impression, titre, sous-total. Les rubriques
 *  y sont rangées dans l'onglet Rubriques (colonne Section). */
function GrilleSections({ c, ci, ro, majC }: { c: Corps; ci: number; ro: boolean; majC: (fn: (c: Corps) => void, cle: string) => void }) {
  const sections = c.sections ?? [];
  const affs = c.affectations ?? [];
  const [nom, setNom] = useState("");
  const erreurs = useContext(CtxErreurs);
  const dnd = useGlisser((de, vers) => majC((z) => { deplacer(z.sections!, de, vers); rangerParSection(z); }, "so-dnd"), !ro);
  const nb = (code: string) => affs.filter((a) => a.section === code).length;
  const anciens = affs.filter((a) => a.groupe && !a.section).length;
  const ajouter = () => {
    const libelle = nom.trim();
    if (!libelle) return;
    majC((z) => { z.sections = [...(z.sections ?? []), { code: codeSection(libelle, new Set((z.sections ?? []).map((x) => x.code))), libelle }]; }, "sadd");
    setNom("");
  };
  // les rubriques suivent l'ordre des sections dans la grille (comme à l'impression) ; une ligne fusionnée suit la sienne
  const ranger = () => majC((z) => { rangerParSection(z); }, "sranger");
  return (
    <>
      <p className="mb-2 text-xs text-muted-foreground">
        Les sections regroupent les rubriques à l'impression : dans cet ordre, avec leur titre et, si coché, une ligne de sous-total
        (somme des colonnes numériques). Rangez chaque rubrique dans sa section depuis l'onglet Rubriques (colonne Section) ;
        les rubriques sans section s'impriment en premier. La grille des rubriques suit toujours cet ordre.
      </p>
      {!ro && anciens > 0 && (
        <div className="mb-2 flex items-center gap-2 rounded border border-dashed p-2 text-xs">
          {anciens} rubrique(s) ont un ancien groupe en texte libre.
          <Button size="sm" variant="outline" onClick={() => majC((z) => { groupesEnSections(z); }, "g2s")}>Convertir les groupes en sections</Button>
        </div>
      )}
      <table className="w-full max-w-4xl border text-sm">
        <thead><tr>{["#", "Section (titre imprimé)", "Code", "Titre", "Sous-total", "Libellé du sous-total", "Rubriques", ""].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>
          {sections.map((x, i) => { const er = ligneErreur(erreurs, `corps[${ci}].sections[${i}]`); return (
            <tr key={x.code} {...dnd.ligne(i)} data-chemin={er["data-chemin"]} title={er.title} className={`${er.rouge} ${dnd.ligne(i).className}`}>
              <td className={`${td} w-12 whitespace-nowrap text-center text-muted-foreground`}>{dnd.poignee(i)} {er.icone}{i + 1}</td>
              <td className={td}><input className={classeChamp} disabled={ro} value={x.libelle} onKeyDown={(e) => e.stopPropagation()}
                onChange={(e) => majC((z) => { z.sections![i].libelle = e.target.value; }, `sl${i}`)} /></td>
              <td className={`${td} w-40 font-mono text-xs text-muted-foreground`}>{x.code}</td>
              <td className={`${td} w-14 text-center`}><Checkbox disabled={ro} checked={x.titre ?? true}
                onCheckedChange={(coche) => majC((z) => poser(z.sections![i], "titre", coche === true ? null : false), `st${i}`)} /></td>
              <td className={`${td} w-20 text-center`}><Checkbox disabled={ro} checked={!!x.sous_total}
                onCheckedChange={(coche) => majC((z) => poser(z.sections![i], "sous_total", (coche === true) || null), `ss${i}`)} /></td>
              <td className={`${td} w-56`}><input className={classeChamp} disabled={ro || !x.sous_total} value={x.libelle_total ?? ""}
                placeholder={`Total ${x.libelle}`} onKeyDown={(e) => e.stopPropagation()}
                onChange={(e) => majC((z) => poser(z.sections![i], "libelle_total", e.target.value || null), `slt${i}`)} /></td>
              <td className={`${td} w-20 text-center text-xs`}>{nb(x.code)}</td>
              <td className={`${td} w-20 text-right`}>{!ro && <>
                <button type="button" title="Monter" onClick={() => majC((z) => { const y = z.sections!; if (i > 0) [y[i - 1], y[i]] = [y[i], y[i - 1]]; rangerParSection(z); }, "so")}><ArrowUp className="inline h-3 w-3" /></button>
                <button type="button" title="Descendre" onClick={() => majC((z) => { const y = z.sections!; if (i < y.length - 1) [y[i + 1], y[i]] = [y[i], y[i + 1]]; rangerParSection(z); }, "so")}><ArrowDown className="inline h-3 w-3" /></button>
                <button type="button" title="Supprimer la section (ses rubriques restent, sans section)" onClick={() => majC((z) => {
                  z.sections!.splice(i, 1);
                  if (!z.sections!.length) delete z.sections;
                  (z.affectations ?? []).forEach((a) => { if (a.section === x.code) delete a.section; });
                }, "ssup")}><Trash2 className="inline h-3 w-3 text-destructive" /></button></>}</td>
            </tr>
          ); })}
          {!sections.length && <tr><td colSpan={8} className="p-6 text-center text-sm text-muted-foreground">Aucune section : les rubriques s'impriment dans l'ordre des affectations, sans titre.</td></tr>}
        </tbody>
      </table>
      {!ro && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input className={`${classeChamp} w-72`} value={nom} placeholder="Nouvelle section (ex. Cotisations et retenues)"
            onChange={(e) => setNom(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") ajouter(); }} />
          <Button size="sm" variant="outline" disabled={!nom.trim()} onClick={ajouter}><Plus className="mr-1 h-4 w-4" />Section</Button>
          {sections.length > 1 && <Button size="sm" variant="outline" className="ml-auto" onClick={ranger}
            title="Réordonne la grille des rubriques comme à l'impression (fait d'office à chaque changement)">Ranger les rubriques par section</Button>}
        </div>
      )}
    </>
  );
}

/** Choix de plusieurs rubriques avec une répartition commune (saisie manuelle rapide). */
function AjoutRubriques({ c, onFermer, onAjouter }: { c: Corps; onFermer: () => void; onAjouter: (a: Affectation[], nouvelleSection?: SectionCorps) => void }) {
  const [section, setSection] = useState<string>("");
  const [nomSection, setNomSection] = useState("");
  const { rubriques } = useReferentiels();
  const [q, setQ] = useState("");
  const [choisies, setChoisies] = useState<string[]>([]);
  const [modele, setModele] = useState<Affectation>({ periode: "MOIS", cibles: c.nature === "EXERCICE" ? { MT: "mois" } : {} });
  const exo = c.nature === "EXERCICE";
  const [uneLigne, setUneLigne] = useState<{ actif: boolean; libelle: string }>({ actif: false, libelle: "" });
  const cibles = ciblesDuCorps(c);
  const deja = new Set((c.affectations ?? []).map((a) => `${a.rubrique}|${a.periode ?? "MOIS"}`));
  const toutes = useMemo(() => [...rubriques.map((r) => ({ ...r, total: false })), ...RUBRIQUES_EN_TETE.map((r) => ({ ...r, total: true }))] as (RubriqueInfo & { total: boolean })[], [rubriques]);
  // RG-EDT-RUBRIQUES-01 (Adil DAIA) : filtres sur le nom, la famille, la nature, le flux, l'assiette alimentée
  const [famille, setFamille] = useState("");
  const [nature, setNature] = useState("");
  const [flux, setFlux] = useState("");
  const [assiette, setAssiette] = useState("");
  const [cacherDeja, setCacherDeja] = useState(false);
  const valeurs = (cle: "famille" | "type" | "flux") => {
    const m = new Map<string, string>();
    rubriques.forEach((r) => { const v = r[cle]; if (v) m.set(v, (r[`${cle}_libelle` as const] as string | null | undefined) || v); });
    return [...m].sort((x, y) => x[1].localeCompare(y[1])).map(([v, l]) => ({ v, l: l === v ? v : `${l} (${v})` }));
  };
  const familles = useMemo(() => valeurs("famille"), [rubriques]); // eslint-disable-line react-hooks/exhaustive-deps
  const natures = useMemo(() => valeurs("type"), [rubriques]); // eslint-disable-line react-hooks/exhaustive-deps
  const fluxs = useMemo(() => valeurs("flux"), [rubriques]); // eslint-disable-line react-hooks/exhaustive-deps
  const assiettes = useMemo(() => [...new Set(rubriques.flatMap((r) => r.assiettes ?? []))].sort()
    .map((a) => ({ v: a, l: `${rubriques.find((r) => r.code === a)?.libelle ?? a} (${a})` })), [rubriques]);
  const bas = q.trim().toLowerCase();
  const liste = toutes.filter((r) => (!bas || r.code.toLowerCase().includes(bas) || r.libelle.toLowerCase().includes(bas))
    && (!famille || r.famille === famille) && (!nature || r.type === nature) && (!flux || r.flux === flux)
    && (!assiette || (r.assiettes ?? []).includes(assiette))
    && (!cacherDeja || !deja.has(`${r.code}|${modele.periode ?? "MOIS"}`)));
  const nbFiltres = [famille, nature, flux, assiette].filter(Boolean).length + (cacherDeja ? 1 : 0);
  const basculer = (code: string) => setChoisies((s) => (s.includes(code) ? s.filter((x) => x !== code) : [...s, code]));

  return (
    <Dialog open onOpenChange={(o) => !o && onFermer()}>
      <DialogContent className="ecran-editions-texte max-w-4xl">
        <DialogHeader><DialogTitle>Ajouter des rubriques au corps « {c.libelle} »</DialogTitle></DialogHeader>
        <div className="grid grid-cols-[1fr_260px] gap-4">
          <div>
            <div className="relative mb-2">
              <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
              <input autoFocus className={`${classeChamp} py-1.5 pl-8 text-sm`} placeholder="Code ou libellé…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
            </div>
            <div className="mb-2 grid grid-cols-2 gap-1.5">
              <Liste compact value={famille} onChange={setFamille} vide="Toutes les familles" options={familles} />
              <Liste compact value={nature} onChange={setNature} vide="Toutes les natures" options={natures} />
              <Liste compact value={flux} onChange={setFlux} vide="Tous les flux" options={fluxs} />
              <Liste compact value={assiette} onChange={setAssiette} vide="Toutes les assiettes" options={assiettes} largeurMenu="min-w-[18rem]"
                title="Rubriques qui alimentent cette assiette" />
              <label className="col-span-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Checkbox checked={cacherDeja} onCheckedChange={(v) => setCacherDeja(v === true)} />Masquer les rubriques déjà dans ce corps
                {nbFiltres > 0 && <button type="button" className="ml-auto text-primary" onClick={() => { setFamille(""); setNature(""); setFlux(""); setAssiette(""); setCacherDeja(false); }}>
                  Effacer les filtres ({nbFiltres})</button>}
              </label>
            </div>
            <div className="mb-1 flex gap-3 text-xs">
              <button type="button" className="text-primary" onClick={() => setChoisies([...new Set([...choisies, ...liste.map((r) => r.code)])])}>Tout cocher ({liste.length})</button>
              <button type="button" className="text-muted-foreground" onClick={() => setChoisies(choisies.filter((x) => !liste.some((r) => r.code === x)))}>Décocher la liste</button>
              <button type="button" className="text-muted-foreground" onClick={() => setChoisies([])}>Tout décocher</button>
              <span className="ml-auto text-muted-foreground">{choisies.length} choisie(s)</span>
            </div>
            <div className="h-80 overflow-auto rounded border">
              {liste.map((r) => {
                const present = deja.has(`${r.code}|${modele.periode ?? "MOIS"}`);
                return (
                  <label key={r.code} className={`flex cursor-pointer items-center gap-2 border-b px-2 py-1 text-sm hover:bg-muted/40 ${present ? "opacity-50" : ""}`}>
                    <Checkbox checked={choisies.includes(r.code)} onCheckedChange={() => basculer(r.code)} />
                    <span className="w-28 shrink-0 font-mono text-xs">{r.code}</span>
                    <span className="min-w-0 flex-1 truncate">{r.libelle}</span>
                    {(r.type_libelle || r.type) && <span className="shrink-0 rounded bg-muted px-1 text-[10px]" title="Nature">{r.type_libelle || r.type}</span>}
                    {(r.famille_libelle || r.famille) && <span className="max-w-[8rem] shrink-0 truncate rounded bg-muted px-1 text-[10px] text-muted-foreground" title="Famille">{r.famille_libelle || r.famille}</span>}
                    {r.total && <span className="ml-auto text-[10px] uppercase text-muted-foreground">total</span>}
                    {present && <span className="ml-auto text-[10px] text-muted-foreground">déjà affectée</span>}
                  </label>
                );
              })}
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Répartition commune</div>
            {exo ? (
              <Ligne libelle="Imprimé chaque mois">
                <Choix value={Object.keys(modele.cibles)[0]} options={ATTRIBUTS_AFFECTABLES.map((x) => ({ v: x.code, l: LIBELLES_ATTRIBUT[x.code] }))}
                  onChange={(v) => setModele((m) => ({ ...m, cibles: v ? { [v]: "mois" } : {} }))} />
              </Ligne>
            ) : <>
            <Ligne libelle="Période">
              <Choix value={modele.periode ?? "MOIS"} options={PERIODES_AFFECTATION.map((p) => ({ v: p.v, l: p.l }))}
                onChange={(v) => setModele((m) => { const n = { ...m, periode: (v ?? "MOIS") as Affectation["periode"], cibles: { ...m.cibles } }; if (v === "CUMUL") { delete n.cibles.TX; delete n.cibles.TXP; } return n; })} />
            </Ligne>
            {ATTRIBUTS_AFFECTABLES.map((x) => (
              <Ligne key={x.code} libelle={`${x.libelle} →`}>
                <Choix value={modele.cibles[x.code]} vide="—" disabled={modele.periode === "CUMUL" && !x.cumul} options={cibles}
                  onChange={(v) => setModele((m) => { const cb = { ...m.cibles }; if (v) cb[x.code] = v; else delete cb[x.code]; return { ...m, cibles: cb }; })} />
              </Ligne>
            ))}
            </>}
            {c.nature !== "CASES" && <>
              <Ligne libelle="Section"><Choix value={section} vide="—" options={[...(c.sections ?? []).map((x) => ({ v: x.code, l: x.libelle })), { v: "__nouvelle__", l: "+ Nouvelle section…" }]}
                onChange={(v) => setSection(v ?? "")} /></Ligne>
              {section === "__nouvelle__" && <Ligne libelle="Nom"><Texte value={nomSection} placeholder="ex. Retenues" onChange={(v) => setNomSection(v ?? "")} /></Ligne>}
            </>}
            <Case libelle="en –" value={modele.negatif} onChange={(v) => setModele((m) => ({ ...m, negatif: v || undefined }))} />
            <Case libelle="Nulls" value={modele.nulle} onChange={(v) => setModele((m) => ({ ...m, nulle: v || undefined }))} />
            {c.nature !== "CASES" && (
              <div className="mt-2 rounded border p-1.5">
                <Case libelle="Toutes sur UNE seule ligne (additionnées)" value={uneLigne.actif} onChange={(v) => setUneLigne((u) => ({ ...u, actif: v }))} />
                {uneLigne.actif && <div className="mt-1"><Texte value={uneLigne.libelle} placeholder="Libellé de la ligne" onChange={(v) => setUneLigne((u) => ({ ...u, libelle: v }))} /></div>}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFermer}>Annuler</Button>
          <Button disabled={!choisies.length || (section === "__nouvelle__" && !nomSection.trim())} onClick={() => {
            const nouvelle = section === "__nouvelle__" ? { code: codeSection(nomSection.trim(), new Set((c.sections ?? []).map((x) => x.code))), libelle: nomSection.trim() } : undefined;
            const code_section = nouvelle ? nouvelle.code : section || null;
            onAjouter(choisies.map((code, k) => {
            const a: Affectation = { rubrique: code, cibles: { ...modele.cibles } };
            if (uneLigne.actif && k > 0) a.fusion = true;
            if (uneLigne.actif && k === 0 && uneLigne.libelle) a.libelle = uneLigne.libelle;
            if (modele.periode && modele.periode !== "MOIS" && !exo) a.periode = modele.periode;
            if (code_section && !(uneLigne.actif && k > 0)) a.section = code_section;
            if (modele.negatif) a.negatif = true;
            if (modele.nulle) a.nulle = true;
            return a;
          }), nouvelle);
          }}>Ajouter {choisies.length || ""} rubrique(s)</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Variables ───────────────────────────────────────────────────────────────
function OngletVariables({ d, editeur, ro }: { d: Definition; editeur: Editeur; ro: boolean }) {
  const vars = d.variables ?? [];
  const majV = (i: number, fn: (v: Variable) => void, cle: string) => editeur.modifier((x) => fn(x.variables![i]), `v${i}:${cle}`);
  const dnd = useGlisser((de, vers) => editeur.modifier((x) => { deplacer(x.variables!, de, vers); }, "vo-dnd"), !ro);
  const erreurs = useContext(CtxErreurs);
  const manquantes = VARIABLES_BULLETIN.filter((v) => !vars.some((x) => x.code === v.code));
  return (
    <Cadre titre="Variables" aide="Valeurs nommées que les mises en forme affichent (var.code), sans connaître leur origine : changer la source ne touche aucune mise en forme."
      actions={!ro && <>
        {manquantes.length > 0 && <Button size="sm" variant="outline" onClick={() => editeur.modifier((x) => { x.variables = [...(x.variables ?? []), ...manquantes]; }, "vstd")}>
          Ajouter les variables usuelles du bulletin ({manquantes.length})</Button>}
        <Button size="sm" onClick={() => editeur.modifier((x) => {
          let n = vars.length + 1; while (vars.some((v) => v.code === `variable_${n}`)) n++;
          x.variables = [...(x.variables ?? []), { code: `variable_${n}`, libelle: `Variable ${n}`, valeur: "" }];
        }, "vadd")}><Plus className="mr-1 h-4 w-4" />Variable</Button>
      </>}>
      <table className="w-full border text-sm">
        <thead><tr>{["#", "Code", "Libellé", "Type", "Valeur (formule)", ""].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>
          {vars.map((v, i) => (
            <tr key={i} {...dnd.ligne(i)} data-chemin={`variables[${i}]`} title={ligneErreur(erreurs, `variables[${i}]`).title}
              className={`align-top ${ligneErreur(erreurs, `variables[${i}]`).rouge} ${dnd.ligne(i).className}`}>
              <td className={`${td} w-8 whitespace-nowrap pt-2 text-center`}>{dnd.poignee(i)}{ligneErreur(erreurs, `variables[${i}]`).icone}</td>
              <td className={`${td} w-44`}><input className={`${classeChamp} font-mono`} disabled={ro} value={v.code} onKeyDown={(e) => e.stopPropagation()}
                onChange={(e) => majV(i, (z) => { z.code = CODE(e.target.value) || z.code; }, "c")} /><div className="mt-0.5 text-[10px] text-muted-foreground">var.{v.code}</div></td>
              <td className={`${td} w-52`}><input className={classeChamp} disabled={ro} value={v.libelle} onKeyDown={(e) => e.stopPropagation()}
                onChange={(e) => majV(i, (z) => { z.libelle = e.target.value; }, "l")} /></td>
              <td className={`${td} w-32`}><Choix value={v.type ?? "TEXTE"} disabled={ro} onChange={(t) => majV(i, (z) => poser(z, "type", t === "TEXTE" ? null : t), "t")}
                options={[{ v: "TEXTE", l: "Texte" }, { v: "NOMBRE", l: "Nombre" }, { v: "MONTANT", l: "Montant" }, { v: "DATE", l: "Date" }, { v: "BOOLEEN", l: "Oui / non" }]} /></td>
              <td className={td}><FormuleInput value={v.valeur} disabled={ro} onChange={(x) => majV(i, (z) => { z.valeur = x; }, "f")} /></td>
              <td className={`${td} w-20 text-right`}>{!ro && <>
                <button type="button" onClick={() => editeur.modifier((x) => { const z = x.variables!; if (i > 0) [z[i - 1], z[i]] = [z[i], z[i - 1]]; }, "vo")}><ArrowUp className="inline h-3 w-3" /></button>
                <button type="button" onClick={() => editeur.modifier((x) => { const z = x.variables!; if (i < z.length - 1) [z[i + 1], z[i]] = [z[i], z[i + 1]]; }, "vo")}><ArrowDown className="inline h-3 w-3" /></button>
                <button type="button" onClick={() => editeur.modifier((x) => { x.variables!.splice(i, 1); }, "vs")}><Trash2 className="inline h-3 w-3 text-destructive" /></button></>}</td>
            </tr>
          ))}
          {!vars.length && <tr><td colSpan={6} className="p-4 text-center text-sm text-muted-foreground">Aucune variable.</td></tr>}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted-foreground">Une variable peut lire les précédentes (var.x) et les cases des corps (corps.cumuls.mois.brut).</p>
    </Cadre>
  );
}

// ── Sources ─────────────────────────────────────────────────────────────────
function OngletSources({ d, editeur, ro }: { d: Definition; editeur: Editeur; ro: boolean }) {
  const { sources } = useReferentiels();
  return (
    <Cadre titre="Sources des données" aide="Le jeu principal donne un document par ligne (un bulletin par collaborateur). Les corps lisent ses rubriques ; un jeu secondaire ne sert qu'aux tableaux en mode expert.">
      <div className="max-w-xl"><JeuxEditeur d={d} ro={ro} m={editeur.modifier} sources={sources} /></div>
    </Cadre>
  );
}

// ── Usages ──────────────────────────────────────────────────────────────────
function OngletUsages({ d, editeur, ro }: { d: Definition; editeur: Editeur; ro: boolean }) {
  const u = d.usages ?? {};
  const set = (k: keyof Usages, v: unknown) => editeur.modifier((x) => { const n = { ...(x.usages ?? {}) }; poser(n, k, v); x.usages = n; }, `u:${k}`);
  const formes = [{ code: d.forme_code ?? "standard", libelle: d.forme_libelle ?? "Mise en forme standard" }, ...(d.formes ?? [])];
  return (
    <Cadre titre="Usages" aide="Règles d'utilisation de l'état, indépendantes de sa mise en forme.">
      <div className="grid max-w-3xl grid-cols-2 gap-x-6">
        <Ligne libelle="Niveau de confidentialité (0 à 5)" aide="Appliqué aux droits de lancement et de téléchargement (lot 6)">
          <Nombre value={u.confidentialite ?? 0} pas={1} min={0} disabled={ro} onChange={(v) => set("confidentialite", v ? Math.min(5, v) : null)} /></Ligne>
        <Ligne libelle="Nombre d'exemplaires"><Nombre value={u.nb_exemplaires ?? 1} pas={1} min={1} disabled={ro} onChange={(v) => set("nb_exemplaires", v && v > 1 ? v : null)} /></Ligne>
        <Ligne libelle="Mise en forme imprimée par défaut">
          <Choix value={u.forme_par_defaut ?? d.forme_code ?? "standard"} disabled={ro} options={formes.map((f) => ({ v: f.code, l: f.libelle }))}
            onChange={(v) => set("forme_par_defaut", v)} /></Ligne>
        <Ligne libelle="Fréquence" aide="Planification (lot 5)">
          <Choix value={u.frequence} disabled={ro} vide="—" onChange={(v) => set("frequence", v)}
            options={[{ v: "MENSUELLE", l: "Mensuelle" }, { v: "TRIMESTRIELLE", l: "Trimestrielle" }, { v: "ANNUELLE", l: "Annuelle" }]} /></Ligne>
        <div className="col-span-2 mb-3 space-y-1">
          <div><Case libelle="Autoriser le choix de la mise en forme au lancement" value={u.formes_au_choix} disabled={ro} onChange={(v) => set("formes_au_choix", v || null)} /></div>
          <div><Case libelle="Duplicata (mention « DUPLICATA » sur les réimpressions)" value={u.duplicata} disabled={ro} onChange={(v) => set("duplicata", v || null)} /></div>
          <div><Case libelle="Interdire les copies multiples" value={u.interdire_copies} disabled={ro} onChange={(v) => set("interdire_copies", v || null)} /></div>
          <div><Case libelle="Export fichier texte" value={u.export_texte} disabled={ro} onChange={(v) => set("export_texte", v || null)} /></div>
        </div>
        {u.export_texte && <div className="col-span-2"><Ligne libelle="Nom du fichier d'export (formule)">
          <FormuleInput value={u.nom_export ?? ""} disabled={ro} placeholder='"Export_" + @periode.code' onChange={(v) => set("nom_export", v)} /></Ligne></div>}
      </div>
      <p className="text-xs text-muted-foreground">Duplicata, copies et export texte sont enregistrés dès maintenant et appliqués à la production (lot 4).</p>
    </Cadre>
  );
}

// ── Aperçu des données ─────────────────────────────────────────────────────
const nf = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const affiche = (v: unknown) => (v === null || v === undefined || v === "" ? "" : typeof v === "number" ? nf.format(v) : String(v));

function OngletApercu({ d, version, ro, enregistrer }: { d: Definition; version: Version; ro: boolean; enregistrer: (s?: boolean) => Promise<boolean> }) {
  const [valeurs, setValeurs] = useState<Valeurs>({});
  const [res, setRes] = useState<ApercuDonnees | null>(null);
  const [doc, setDoc] = useState(0);
  const [occupe, setOccupe] = useState(false);
  const calculer = async () => {
    const manquants = parametresManquants(d.parametres, valeurs);
    if (manquants.length) { toast({ title: "Paramètres manquants", description: manquants.join(", "), variant: "destructive" }); return; }
    if (!ro && !(await enregistrer(true))) return;
    setOccupe(true);
    try { setRes(await editionsApi.donnees(version.id, valeurs)); setDoc(0); }
    catch (e: any) { toast({ title: "Aperçu impossible", description: e.message, variant: "destructive" }); }
    finally { setOccupe(false); }
  };
  const l = res?.lignes[doc];
  return (
    <Cadre titre="Aperçu des données" aide="Le contenu calculé sur des bulletins réels, sans aucune mise en page : vérifiez ce que l'état contient avant de travailler le format.">
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div className="w-96"><ParametresForm parametres={d.parametres} valeurs={valeurs} onChange={setValeurs} /></div>
        <Button onClick={calculer} disabled={occupe}>{occupe ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />}Calculer</Button>
      </div>
      {res && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">{res.nb_lignes} document(s) ; {res.lignes.length} affiché(s) :</span>
            {res.lignes.map((x, i) => (
              <button key={x.id} type="button" onClick={() => setDoc(i)}
                className={`rounded px-2 py-0.5 text-xs ${i === doc ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{x.titre || x.id.slice(0, 8)}</button>
            ))}
          </div>
          {l && (
            <div className="space-y-5">
              {l.anomalies.length > 0 && (
                <div className="rounded border border-[hsl(var(--warning)/0.5)] bg-[hsl(var(--warning)/0.08)] p-2 text-xs text-[hsl(var(--warning))]">
                  {l.anomalies.map((a, i) => <div key={i}><b>{a.element}</b> : {a.message}</div>)}
                </div>
              )}
              {(d.corps ?? []).map((c) => {
                const v = l.corps[c.code];
                return (
                  <div key={c.code}>
                    <div className="mb-1 text-sm font-semibold">{c.libelle} <span className="font-normal text-muted-foreground">· {LIBELLES_NATURE[c.nature].toLowerCase()}</span></div>
                    {c.nature !== "CASES" ? (
                      <table className="border text-xs">
                        <thead><tr>{["Groupe", "Rubrique", "Libellé", ...c.colonnes.map((col) => col.libelle)].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                        <tbody>
                          {(v as Record<string, unknown>[] ?? []).map((ligne, i) => (
                            <tr key={i} className={ligne.gras ? "font-bold" : ""}>
                              <td className={`${td} px-2 text-muted-foreground`}>{affiche(ligne.groupe)}</td>
                              <td className={`${td} px-2 font-mono`}>{affiche(ligne.code_rubrique)}</td>
                              <td className={`${td} px-2`}>{affiche(ligne.libelle)}</td>
                              {c.colonnes.map((col) => <td key={col.code} className={`${td} px-2 text-right tabular-nums`}>{affiche(ligne[col.code])}</td>)}
                            </tr>
                          ))}
                          {!(v as unknown[] ?? []).length && <tr><td colSpan={3 + c.colonnes.length} className="p-2 text-center text-muted-foreground">Aucune ligne pour ce document.</td></tr>}
                        </tbody>
                      </table>
                    ) : (
                      <table className="border text-xs">
                        <thead><tr><th className={th} />{c.colonnes.map((col) => <th key={col.code} className={th}>{col.libelle}</th>)}</tr></thead>
                        <tbody>
                          {(c.lignes ?? []).map((lg) => (
                            <tr key={lg.code}>
                              <td className={`${td} px-2 font-semibold`}>{lg.libelle}</td>
                              {c.colonnes.map((col) => <td key={col.code} className={`${td} px-2 text-right tabular-nums`}>
                                {affiche((v as Record<string, Record<string, unknown>> ?? {})[lg.code]?.[col.code])}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
              {(d.variables ?? []).length > 0 && (
                <div>
                  <div className="mb-1 text-sm font-semibold">Variables</div>
                  <table className="border text-xs">
                    <tbody>{(d.variables ?? []).map((x) => (
                      <tr key={x.code}><td className={`${td} px-2 font-mono text-muted-foreground`}>var.{x.code}</td><td className={`${td} px-2`}>{x.libelle}</td>
                        <td className={`${td} px-2 font-medium`}>{affiche(l.variables[x.code])}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
              {(l.rubriques ?? []).length > 0 && (
                <details className="rounded border bg-muted/20 p-2">
                  <summary className="cursor-pointer text-sm font-semibold">
                    Contrôle des rubriques <span className="font-normal text-muted-foreground">— valeurs brutes du bulletin, avant affectation (Mt = montant de la ligne, Patronal = montant patronal)</span>
                  </summary>
                  <table className="mt-2 border text-xs">
                    <thead><tr>{["Rubrique", "Libellé", "Nb", "Base", "Taux", "Mt", "Patronal", "Taux pat.", "Cumul Nb", "Cumul Base", "Cumul Mt", "Cumul pat."].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                    <tbody>{(l.rubriques ?? []).map((r) => (
                      <tr key={r.code} className={r.absente ? "text-muted-foreground" : ""}>
                        <td className={`${td} px-2 font-mono`}>{r.code}</td>
                        <td className={`${td} px-2`}>{r.absente ? <i>absente du bulletin et des cumuls</i> : r.libelle}</td>
                        {(["NB", "BASE", "TX", "MT", "PAT", "TXP", "CNB", "CBASE", "CMT", "CPAT"] as const).map((k) => (
                          <td key={k} className={`${td} px-2 text-right tabular-nums ${r[k] != null && Number(r[k]) !== 0 ? "font-medium" : "text-muted-foreground/60"}`}>
                            {r[k] == null ? "" : affiche(Number(r[k]))}</td>
                        ))}
                      </tr>
                    ))}</tbody>
                  </table>
                </details>
              )}
            </div>
          )}
        </>
      )}
    </Cadre>
  );
}
