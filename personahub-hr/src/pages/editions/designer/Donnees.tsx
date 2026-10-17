/**
 * Donnees.tsx — Étape 1 du designer : ce que l'état contient, avant toute mise en forme.
 * Auteur : Adil DAIA — lot 2 bis (16/10/2026)
 *
 * Reprend les onglets du Report Manager AGIRH :
 *   Définition (corps de l'état) · Corps (colonnes, lignes, rubriques, tri) · Variables ·
 *   Paramètres et sélection · Sources · Usages · Aperçu des données (tableau brut, sans format).
 * RG-EDT-DONNEES-01 à 05 ; affectations saisies à la main (décision du 16/10/2026).
 */
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Loader2, Play, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { editionsApi, type ApercuDonnees, type Version } from "@/lib/editionsApi";
import ParametresForm, { parametresManquants, type Valeurs } from "@/pages/editions/ParametresForm";
import {
  ATTRIBUTS_AFFECTABLES, RUBRIQUES_EN_TETE, VARIABLES_BULLETIN,
  type Affectation, type AttributAffecte, type Corps, type Definition, type TypeColonneCorps, type Usages, type Variable,
} from "@/pages/editions/types";
import FormuleInput from "./FormuleInput";
import { useReferentiels } from "./contexte";
import { deplacer, useGlisser } from "./glisser";
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

const CODE = (v: string) => v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "_$1").slice(0, 40);

export default function Donnees({ editeur, version, lectureSeule, enregistrer }: {
  editeur: Editeur; version: Version; lectureSeule: boolean; enregistrer: (silencieux?: boolean) => Promise<boolean>;
}) {
  const [onglet, setOnglet] = useState<Onglet>("definition");
  const [corpsActif, setCorpsActif] = useState<string | null>(editeur.definition?.corps?.[0]?.code ?? null);
  const d = editeur.definition!;
  const ouvrirCorps = (code: string) => { setCorpsActif(code); setOnglet("corps"); };

  return (
    <div className="flex h-full min-h-0">
      <nav className="w-52 shrink-0 border-r bg-muted/30 p-2">
        <div className="mb-2 px-2 text-[11px] font-semibold uppercase text-muted-foreground">Ce que l'état contient</div>
        {ONGLETS.map(([k, l, aide]) => (
          <button key={k} type="button" onClick={() => setOnglet(k)}
            className={`mb-0.5 block w-full rounded px-2 py-1.5 text-left ${onglet === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
            <div className="text-sm">{l}</div>
            <div className={`text-[10px] ${onglet === k ? "opacity-80" : "text-muted-foreground"}`}>{aide}</div>
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-auto p-5">
        {onglet === "definition" && <OngletDefinition d={d} editeur={editeur} version={version} ro={lectureSeule} ouvrirCorps={ouvrirCorps} />}
        {onglet === "corps" && <OngletCorps d={d} editeur={editeur} ro={lectureSeule} actif={corpsActif} setActif={setCorpsActif} />}
        {onglet === "variables" && <OngletVariables d={d} editeur={editeur} ro={lectureSeule} />}
        {onglet === "parametres" && <Cadre titre="Paramètres et sélection" aide="Demandés au lancement (période, collaborateurs, plan de paie…) ; utilisables dans les formules sous la forme @code.">
          <div className="max-w-xl"><ParametresEditeur d={d} ro={lectureSeule} m={editeur.modifier} /></div></Cadre>}
        {onglet === "sources" && <OngletSources d={d} editeur={editeur} ro={lectureSeule} />}
        {onglet === "usages" && <OngletUsages d={d} editeur={editeur} ro={lectureSeule} />}
        {onglet === "apercu" && <OngletApercu d={d} version={version} ro={lectureSeule} enregistrer={enregistrer} />}
      </div>
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
      <Cadre titre="Corps de l'état" aide="Un corps = un bloc de données. « Lignes » : une ligne par rubrique affectée (détail du bulletin). « Cases » : un tableau fixe lignes × colonnes (cumuls, mois / cumul).">
        <table className="w-full max-w-4xl border text-sm">
          <thead><tr>{["#", "Code", "Libellé", "Nature", "Colonnes", "Lignes", "Rubriques", ""].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>
            {corps.map((c, i) => (
              <tr key={c.code} {...dndCorps.ligne(i)} className={`hover:bg-muted/30 ${dndCorps.ligne(i).className}`}>
                <td className={`${td} w-12 whitespace-nowrap text-center text-muted-foreground`}>{dndCorps.poignee(i)} {i + 1}</td>
                <td className={`${td} font-mono text-xs`}>{c.code}</td>
                <td className={td}>{c.libelle}</td>
                <td className={td}>{c.nature === "LIGNES" ? "Lignes de rubriques" : "Cases"}</td>
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
            {!corps.length && <tr><td colSpan={8} className="p-4 text-center text-sm text-muted-foreground">Aucun corps : ajoutez par exemple « Détail » (lignes) et « Cumuls » (cases).</td></tr>}
          </tbody>
        </table>
        {!ro && (
          <div className="mt-2 flex max-w-4xl items-end gap-2">
            <label className="flex-1 text-xs">Libellé du nouveau corps
              <input className={`${classeChamp} mt-1`} value={nouveau.libelle} placeholder="ex. Détail, Cumuls, Congés…"
                onChange={(e) => setNouveau({ ...nouveau, libelle: e.target.value })} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && nouveau.libelle) ajouter(); }} />
            </label>
            <label className="w-56 text-xs">Nature
              <select className={`${classeChamp} mt-1`} value={nouveau.nature} onChange={(e) => setNouveau({ ...nouveau, nature: e.target.value as Corps["nature"] })}>
                <option value="LIGNES">Lignes de rubriques</option><option value="CASES">Cases (lignes × colonnes)</option>
              </select>
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
      if (c.nature === "LIGNES" && genre === "colonne" && v === ancien) a.cibles[k] = nouveau;
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

function OngletCorps({ d, editeur, ro, actif, setActif }: { d: Definition; editeur: Editeur; ro: boolean; actif: string | null; setActif: (c: string) => void }) {
  const corps = d.corps ?? [];
  const c = corps.find((z) => z.code === actif) ?? corps[0];
  const [sous, setSous] = useState<"rubriques" | "colonnes" | "lignes">("rubriques");
  if (!c) return <p className="text-sm text-muted-foreground">Aucun corps. Ajoutez-en un dans l'onglet Définition.</p>;
  const majC = (fn: (c: Corps) => void, cle: string) => editeur.modifier((x) => { const z = x.corps!.find((y) => y.code === c.code); if (z) fn(z); }, `${cle}:${c.code}`);

  return (
    <div className="flex gap-4">
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <label className="text-xs">Libellé<input className={`${classeChamp} mt-1 w-64 text-sm`} disabled={ro} value={c.libelle}
            onKeyDown={(e) => e.stopPropagation()} onChange={(e) => majC((z) => { z.libelle = e.target.value; }, "lib")} /></label>
          <div className="text-xs"><div className="text-muted-foreground">Code · nature</div>
            <div className="mt-1 py-1 text-sm"><span className="font-mono">{c.code}</span> · {c.nature === "LIGNES" ? "lignes de rubriques" : "cases"}</div></div>
          {c.nature === "LIGNES" && (
            <label className="flex items-center gap-1.5 self-center pt-4 text-xs" title="Titre imprimé au-dessus des lignes du corps qui n'ont pas de groupe">
              <input type="checkbox" disabled={ro} checked={c.afficher_titre ?? true}
                onChange={(e) => majC((z) => poser(z, "afficher_titre", e.target.checked ? null : false), "titre")} />
              Imprimer le titre du corps
            </label>
          )}
          {c.nature === "LIGNES" && (
            <label className="text-xs">Tri des lignes
              <select className={`${classeChamp} mt-1 w-56`} disabled={ro} value={c.tri ?? "AFFECTATION"}
                onChange={(e) => majC((z) => poser(z, "tri", e.target.value === "AFFECTATION" ? null : e.target.value), "tri")}>
                <option value="AFFECTATION">Ordre des affectations</option><option value="PAIE">Ordre d'affichage de la paie</option><option value="CODE">Code rubrique</option>
              </select></label>
          )}
        </div>
        <div className="mb-3 flex gap-1 border-b text-sm">
          {([["rubriques", `Rubriques (${(c.affectations ?? []).length})`], ["colonnes", `Colonnes (${c.colonnes.length})`],
            ...(c.nature === "CASES" ? [["lignes", `Lignes (${(c.lignes ?? []).length})`]] : [])] as [typeof sous, string][]).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setSous(k)}
              className={`-mb-px border-b-2 px-3 py-1.5 ${sous === k ? "border-primary font-medium" : "border-transparent text-muted-foreground"}`}>{l}</button>
          ))}
        </div>
        {sous === "colonnes" && <GrilleColonnes c={c} ro={ro} majC={majC} editeur={editeur} />}
        {sous === "lignes" && c.nature === "CASES" && <GrilleLignes c={c} ro={ro} majC={majC} editeur={editeur} />}
        {sous === "rubriques" && <GrilleAffectations c={c} d={d} ro={ro} majC={majC} editeur={editeur} />}
      </div>
      <aside className="w-40 shrink-0">
        <div className="rounded border p-2">
          <div className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">Corps</div>
          {corps.map((z) => (
            <label key={z.code} className="flex cursor-pointer items-center gap-1.5 py-0.5 text-sm">
              <input type="radio" checked={z.code === c.code} onChange={() => setActif(z.code)} />
              <span className="truncate">{z.libelle}</span>
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

function GrilleColonnes({ c, ro, majC, editeur }: { c: Corps; ro: boolean; majC: (fn: (c: Corps) => void, cle: string) => void; editeur: Editeur }) {
  const dnd = useGlisser((de, vers) => majC((z) => { deplacer(z.colonnes, de, vers); }, "co-dnd"), !ro);
  const { masques } = useReferentiels();
  const [codes, setCodes] = useState<Record<number, string>>({});
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
      <p className="mb-2 text-xs text-muted-foreground">Les colonnes reçoivent les valeurs des rubriques (onglet Rubriques). La mise en forme en reprendra le libellé, le type et le masque.</p>
      <table className="w-full max-w-4xl border text-sm">
        <thead><tr>{["#", "Code", "Intitulé colonne", "Sigle", "Type", "Masque", "Total", ""].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>
          {c.colonnes.map((col, i) => (
            <tr key={i} {...dnd.ligne(i)}>
              <td className={`${td} w-12 whitespace-nowrap text-center text-muted-foreground`}>{dnd.poignee(i)} {i + 1}</td>
              <td className={`${td} w-32`}><input className={`${classeChamp} font-mono`} disabled={ro} value={codes[i] ?? col.code}
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
              <td className={`${td} w-14 text-center`}><input type="checkbox" disabled={ro} checked={!!col.total}
                onChange={(e) => majC((z) => poser(z.colonnes[i], "total", e.target.checked || null), `cto${i}`)} /></td>
              <td className={`${td} w-20 text-right`}>{!ro && <>
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
          ))}
        </tbody>
      </table>
      {!ro && <Button size="sm" variant="outline" className="mt-2" onClick={() => majC((z) => {
        let n = z.colonnes.length + 1; while (z.colonnes.some((x) => x.code === `colonne_${n}`)) n++;
        z.colonnes.push({ code: `colonne_${n}`, libelle: `Colonne ${n}` });
      }, "cadd")}><Plus className="mr-1 h-4 w-4" />Colonne</Button>}
    </>
  );
}

function GrilleLignes({ c, ro, majC, editeur }: { c: Corps; ro: boolean; majC: (fn: (c: Corps) => void, cle: string) => void; editeur: Editeur }) {
  const lignes = c.lignes ?? [];
  const dnd = useGlisser((de, vers) => majC((z) => { deplacer(z.lignes!, de, vers); }, "lo-dnd"), !ro);
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
          {lignes.map((l, i) => (
            <tr key={i} {...dnd.ligne(i)}>
              <td className={`${td} w-12 whitespace-nowrap text-center text-muted-foreground`}>{dnd.poignee(i)} {i + 1}</td>
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
          ))}
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
  return c.nature === "LIGNES"
    ? c.colonnes.map((col) => ({ v: col.code, l: col.libelle }))
    : (c.lignes ?? []).flatMap((l) => c.colonnes.map((col) => ({ v: `${l.code}.${col.code}`, l: `${l.libelle} · ${col.libelle}` })));
}

function GrilleAffectations({ c, d, ro, majC, editeur }: { c: Corps; d: Definition; ro: boolean; majC: (fn: (c: Corps) => void, cle: string) => void; editeur: Editeur }) {
  const { rubriques } = useReferentiels();
  const [q, setQ] = useState("");
  const [ajout, setAjout] = useState(false);
  const affs = c.affectations ?? [];
  const cibles = ciblesDuCorps(c);
  const nomRub = (code?: string | null) => (code ? rubriques.find((r) => r.code === code)?.libelle ?? RUBRIQUES_EN_TETE.find((r) => r.code === code)?.libelle ?? "?" : "");
  const bas = q.trim().toLowerCase();
  const visibles = affs.map((a, i) => ({ a, i })).filter(({ a }) => !bas || (a.rubrique ?? "").toLowerCase().includes(bas)
    || nomRub(a.rubrique).toLowerCase().includes(bas) || (a.groupe ?? "").toLowerCase().includes(bas) || (a.formule ?? "").toLowerCase().includes(bas));
  const majA = (i: number, fn: (a: Affectation) => void, cle: string) => majC((z) => fn(z.affectations![i]), `${cle}${i}`);
  const autres = (d.corps ?? []).filter((z) => z.code !== c.code);
  // RG-EDT-LIGNES-02 (Adil DAIA) : une ligne fusionnée voyage avec les rubriques qui lui sont jointes ;
  // on ne dépose jamais entre une rubrique et ses fusions, et une fusion sans rubrique au-dessus est défaite.
  const dnd = useGlisser((de, vers) => majC((z) => {
    const y = z.affectations!;
    let nb = 1;
    if (!y[de].fusion) while (de + nb < y.length && y[de + nb].fusion) nb++;
    while (vers < y.length && y[vers]?.fusion && !(vers > de && vers <= de + nb - 1)) vers++;
    deplacer(y, de, vers, nb);
    y.forEach((a, k) => { if (a.fusion && (k === 0 || !a.rubrique || !y[k - 1].rubrique)) delete a.fusion; });
  }, "ao-dnd"), !ro);

  const selCible = (a: Affectation, i: number, attr: AttributAffecte) => {
    const interdit = a.periode === "CUMUL" && (attr === "TX" || attr === "PAT");
    return (
      <select className={`${classeChamp} min-w-[88px] ${a.cibles[attr] ? "bg-primary/5 font-medium" : ""}`} disabled={ro || interdit}
        title={interdit ? "Pas de cumul pour cet attribut" : undefined} value={a.cibles[attr] ?? ""}
        onChange={(e) => majA(i, (z) => { if (e.target.value) z.cibles[attr] = e.target.value; else delete z.cibles[attr]; }, `t${attr}`)}>
        <option value="">—</option>
        {cibles.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    );
  };

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
          <input className={`${classeChamp} pl-7`} placeholder="Filtrer les affectations…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </div>
        <span className="text-xs text-muted-foreground">Nb, Mt, Tx, Base, Patronal : colonne qui reçoit la valeur. Une rubrique sans aucune valeur n'est jamais imprimée ; à zéro, seulement si « Nulls ».</span>
        {!ro && <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={() => setAjout(true)}><Plus className="mr-1 h-4 w-4" />Ajouter des rubriques</Button>
          <Button size="sm" variant="outline" onClick={() => majC((z) => { z.affectations = [...(z.affectations ?? []), { formule: "", cibles: {} }]; }, "fadd")}>Ajouter une formule</Button>
        </div>}
      </div>
      <div className="overflow-auto rounded border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10"><tr>
            {["#", "Rubrique", "Période", ...ATTRIBUTS_AFFECTABLES.map((x) => `${x.libelle} →`), ...(c.nature === "LIGNES" ? ["Groupe"] : []), "Libellé imprimé", "en –", "Nulls",
              ...(c.nature === "LIGNES" ? ["Fusion ↑", "Gras"] : []), ""].map((h) => <th key={h} className={th}
                title={h === "Nulls" ? "Imprimée même quand ses valeurs sont à zéro. Une rubrique sans aucune valeur n'est jamais imprimée." : h === "Fusion ↑" ? "S'ajoute à la ligne au-dessus : une seule ligne imprimée (somme ; « en – » soustrait)" : h === "Gras" ? "Ligne imprimée en gras (par défaut pour une formule)" : undefined}>{h}</th>)}
          </tr></thead>
          <tbody>
            {visibles.map(({ a, i }) => (
              <tr key={i} {...dnd.ligne(i)} className={`hover:bg-muted/30 ${a.fusion ? "bg-sky-50/60" : ""} ${dnd.ligne(i).className}`}>
                <td className={`${td} w-12 whitespace-nowrap text-center text-xs text-muted-foreground`}>{dnd.poignee(i)} {a.fusion ? "↳" : i + 1}</td>
                {a.formule !== undefined && a.formule !== null && !a.rubrique ? (
                  <>
                    <td className={`${td} min-w-[240px]`} colSpan={2}>
                      <FormuleInput value={a.formule ?? ""} disabled={ro} placeholder="Formule (ex. cumul.total_brut)"
                        onChange={(v) => majA(i, (z) => { z.formule = v; }, "f")} />
                    </td>
                    <td className={td} colSpan={ATTRIBUTS_AFFECTABLES.length}>
                      <span className="mr-2 text-xs text-muted-foreground">Valeur →</span>
                      <select className={`${classeChamp} inline-block w-48`} disabled={ro} value={a.cibles.VAL ?? ""}
                        onChange={(e) => majA(i, (z) => { z.cibles = e.target.value ? { VAL: e.target.value } : {}; }, "fv")}>
                        <option value="">—</option>{cibles.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                      </select>
                    </td>
                  </>
                ) : (
                  <>
                    <td className={`${td} min-w-[180px]`}>
                      <div className="font-mono text-xs">{a.rubrique}</div>
                      <div className="truncate text-[11px] text-muted-foreground" title={nomRub(a.rubrique)}>{nomRub(a.rubrique)}</div>
                    </td>
                    <td className={`${td} w-24`}>
                      <select className={classeChamp} disabled={ro} value={a.periode ?? "MOIS"}
                        onChange={(e) => majA(i, (z) => {
                          poser(z, "periode", e.target.value === "MOIS" ? null : e.target.value);
                          if (e.target.value === "CUMUL") { delete z.cibles.TX; delete z.cibles.PAT; }
                        }, "p")}>
                        <option value="MOIS">Mois</option><option value="CUMUL">Cumul</option>
                      </select>
                    </td>
                    {ATTRIBUTS_AFFECTABLES.map((x) => <td key={x.code} className={td}>{selCible(a, i, x.code)}</td>)}
                  </>
                )}
                {c.nature === "LIGNES" && <td className={`${td} w-32`}><input className={classeChamp} disabled={ro || !!a.fusion} value={a.fusion ? "" : a.groupe ?? ""} placeholder={a.fusion ? "(ligne au-dessus)" : "ex. Gains"}
                  list={`groupes-${c.code}`} onKeyDown={(e) => e.stopPropagation()} onChange={(e) => majA(i, (z) => poser(z, "groupe", e.target.value), "g")} /></td>}
                <td className={`${td} min-w-[150px]`}><input className={classeChamp} disabled={ro || !!a.fusion} value={a.fusion ? "" : a.libelle ?? ""} placeholder={a.fusion ? "(ligne au-dessus)" : nomRub(a.rubrique) || "—"}
                  onKeyDown={(e) => e.stopPropagation()} onChange={(e) => majA(i, (z) => poser(z, "libelle", e.target.value), "l")} /></td>
                <td className={`${td} w-12 text-center`}><input type="checkbox" disabled={ro} checked={!!a.negatif} onChange={(e) => majA(i, (z) => poser(z, "negatif", e.target.checked || null), "n")} /></td>
                <td className={`${td} w-12 text-center`}><input type="checkbox" disabled={ro} checked={!!a.nulle} onChange={(e) => majA(i, (z) => poser(z, "nulle", e.target.checked || null), "z")} /></td>
                {c.nature === "LIGNES" && <>
                  <td className={`${td} w-14 text-center`}><input type="checkbox" disabled={ro || i === 0 || !!a.formule || !!affs[i - 1]?.formule}
                    title="S'ajoute à la ligne au-dessus" checked={!!a.fusion} onChange={(e) => majA(i, (z) => poser(z, "fusion", e.target.checked || null), "fu")} /></td>
                  <td className={`${td} w-12 text-center`}><input type="checkbox" disabled={ro || !!a.fusion}
                    checked={a.gras ?? !!a.formule} onChange={(e) => majA(i, (z) => poser(z, "gras", e.target.checked === !!z.formule ? null : e.target.checked), "gr")} /></td>
                </>}
                <td className={`${td} w-28 whitespace-nowrap text-right`}>{!ro && <>
                  <button type="button" title="Monter" onClick={() => majC((z) => { const y = z.affectations!; if (i > 0) [y[i - 1], y[i]] = [y[i], y[i - 1]]; }, "ao")}><ArrowUp className="inline h-3 w-3" /></button>
                  <button type="button" title="Descendre" onClick={() => majC((z) => { const y = z.affectations!; if (i < y.length - 1) [y[i + 1], y[i]] = [y[i], y[i + 1]]; }, "ao")}><ArrowDown className="inline h-3 w-3" /></button>
                  <button type="button" title="Dupliquer (ex. version Cumul)" onClick={() => majC((z) => { z.affectations!.splice(i + 1, 0, JSON.parse(JSON.stringify(a))); }, "ad")}><Copy className="inline h-3 w-3" /></button>
                  {autres.length > 0 && (
                    <select className="ml-1 w-5 cursor-pointer appearance-none bg-transparent text-xs" title="Copier vers un autre corps" value=""
                      onChange={(e) => {
                        const cible = e.target.value; if (!cible) return;
                        editeur.modifier((x) => { const z = x.corps!.find((y) => y.code === cible)!; z.affectations = [...(z.affectations ?? []), { ...JSON.parse(JSON.stringify(a)), cibles: {} }]; }, "acp");
                        toast({ title: "Affectation copiée", description: "Choisissez ses colonnes dans l'autre corps." });
                      }}>
                      <option value="">⇢</option>{autres.map((z) => <option key={z.code} value={z.code}>{z.libelle}</option>)}
                    </select>
                  )}
                  <button type="button" className="ml-1" title="Retirer" onClick={() => majC((z) => { z.affectations!.splice(i, 1); }, "as")}><Trash2 className="inline h-3 w-3 text-destructive" /></button>
                </>}</td>
              </tr>
            ))}
            {!affs.length && <tr><td colSpan={14} className="p-6 text-center text-sm text-muted-foreground">
              Aucune rubrique. « Ajouter des rubriques » permet d'en choisir plusieurs et de leur donner la même répartition.</td></tr>}
          </tbody>
        </table>
        <datalist id={`groupes-${c.code}`}>{[...new Set(affs.map((a) => a.groupe).filter(Boolean))].map((g) => <option key={g!} value={g!} />)}</datalist>
      </div>
      {ajout && <AjoutRubriques c={c} onFermer={() => setAjout(false)}
        onAjouter={(nouvelles) => { majC((z) => { z.affectations = [...(z.affectations ?? []), ...nouvelles]; }, "radd"); setAjout(false); }} />}
    </>
  );
}

/** Choix de plusieurs rubriques avec une répartition commune (saisie manuelle rapide). */
function AjoutRubriques({ c, onFermer, onAjouter }: { c: Corps; onFermer: () => void; onAjouter: (a: Affectation[]) => void }) {
  const { rubriques } = useReferentiels();
  const [q, setQ] = useState("");
  const [choisies, setChoisies] = useState<string[]>([]);
  const [modele, setModele] = useState<Affectation>({ periode: "MOIS", cibles: {} });
  const [uneLigne, setUneLigne] = useState<{ actif: boolean; libelle: string }>({ actif: false, libelle: "" });
  const cibles = ciblesDuCorps(c);
  const deja = new Set((c.affectations ?? []).map((a) => `${a.rubrique}|${a.periode ?? "MOIS"}`));
  const toutes = useMemo(() => [...rubriques.map((r) => ({ ...r, total: false })), ...RUBRIQUES_EN_TETE.map((r) => ({ ...r, total: true }))], [rubriques]);
  const bas = q.trim().toLowerCase();
  const liste = toutes.filter((r) => !bas || r.code.toLowerCase().includes(bas) || r.libelle.toLowerCase().includes(bas));
  const basculer = (code: string) => setChoisies((s) => (s.includes(code) ? s.filter((x) => x !== code) : [...s, code]));

  return (
    <Dialog open onOpenChange={(o) => !o && onFermer()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Ajouter des rubriques au corps « {c.libelle} »</DialogTitle></DialogHeader>
        <div className="grid grid-cols-[1fr_260px] gap-4">
          <div>
            <div className="relative mb-2">
              <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
              <input autoFocus className={`${classeChamp} py-1.5 pl-8 text-sm`} placeholder="Code ou libellé…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
            </div>
            <div className="mb-1 flex gap-3 text-xs">
              <button type="button" className="text-primary" onClick={() => setChoisies([...new Set([...choisies, ...liste.map((r) => r.code)])])}>Tout cocher ({liste.length})</button>
              <button type="button" className="text-muted-foreground" onClick={() => setChoisies([])}>Tout décocher</button>
              <span className="ml-auto text-muted-foreground">{choisies.length} choisie(s)</span>
            </div>
            <div className="h-80 overflow-auto rounded border">
              {liste.map((r) => {
                const present = deja.has(`${r.code}|${modele.periode ?? "MOIS"}`);
                return (
                  <label key={r.code} className={`flex cursor-pointer items-center gap-2 border-b px-2 py-1 text-sm hover:bg-muted/40 ${present ? "opacity-50" : ""}`}>
                    <input type="checkbox" checked={choisies.includes(r.code)} onChange={() => basculer(r.code)} />
                    <span className="w-28 shrink-0 font-mono text-xs">{r.code}</span>
                    <span className="truncate">{r.libelle}</span>
                    {r.total && <span className="ml-auto text-[10px] uppercase text-muted-foreground">total</span>}
                    {present && <span className="ml-auto text-[10px] text-muted-foreground">déjà affectée</span>}
                  </label>
                );
              })}
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Répartition commune</div>
            <Ligne libelle="Période">
              <Choix value={modele.periode ?? "MOIS"} options={[{ v: "MOIS", l: "Mois" }, { v: "CUMUL", l: "Cumul annuel" }]}
                onChange={(v) => setModele((m) => { const n = { ...m, periode: v ?? "MOIS", cibles: { ...m.cibles } }; if (v === "CUMUL") { delete n.cibles.TX; delete n.cibles.PAT; } return n; })} />
            </Ligne>
            {ATTRIBUTS_AFFECTABLES.map((x) => (
              <Ligne key={x.code} libelle={`${x.libelle} →`}>
                <Choix value={modele.cibles[x.code]} vide="—" disabled={modele.periode === "CUMUL" && !x.cumul} options={cibles}
                  onChange={(v) => setModele((m) => { const cb = { ...m.cibles }; if (v) cb[x.code] = v; else delete cb[x.code]; return { ...m, cibles: cb }; })} />
              </Ligne>
            ))}
            {c.nature === "LIGNES" && <Ligne libelle="Groupe"><Texte value={modele.groupe} placeholder="ex. Retenues" onChange={(v) => setModele((m) => ({ ...m, groupe: v || null }))} /></Ligne>}
            <Case libelle="en –" value={modele.negatif} onChange={(v) => setModele((m) => ({ ...m, negatif: v || undefined }))} />
            <Case libelle="Nulls" value={modele.nulle} onChange={(v) => setModele((m) => ({ ...m, nulle: v || undefined }))} />
            {c.nature === "LIGNES" && (
              <div className="mt-2 rounded border p-1.5">
                <Case libelle="Toutes sur UNE seule ligne (additionnées)" value={uneLigne.actif} onChange={(v) => setUneLigne((u) => ({ ...u, actif: v }))} />
                {uneLigne.actif && <div className="mt-1"><Texte value={uneLigne.libelle} placeholder="Libellé de la ligne" onChange={(v) => setUneLigne((u) => ({ ...u, libelle: v }))} /></div>}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFermer}>Annuler</Button>
          <Button disabled={!choisies.length} onClick={() => onAjouter(choisies.map((code, k) => {
            const a: Affectation = { rubrique: code, cibles: { ...modele.cibles } };
            if (uneLigne.actif && k > 0) a.fusion = true;
            if (uneLigne.actif && k === 0 && uneLigne.libelle) a.libelle = uneLigne.libelle;
            if (modele.periode === "CUMUL") a.periode = "CUMUL";
            if (modele.groupe) a.groupe = modele.groupe;
            if (modele.negatif) a.negatif = true;
            if (modele.nulle) a.nulle = true;
            return a;
          }))}>Ajouter {choisies.length || ""} rubrique(s)</Button>
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
            <tr key={i} {...dnd.ligne(i)} className={`align-top ${dnd.ligne(i).className}`}>
              <td className={`${td} w-8 pt-2 text-center`}>{dnd.poignee(i)}</td>
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
                <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                  {l.anomalies.map((a, i) => <div key={i}><b>{a.element}</b> : {a.message}</div>)}
                </div>
              )}
              {(d.corps ?? []).map((c) => {
                const v = l.corps[c.code];
                return (
                  <div key={c.code}>
                    <div className="mb-1 text-sm font-semibold">{c.libelle} <span className="font-normal text-muted-foreground">· {c.nature === "LIGNES" ? "lignes" : "cases"}</span></div>
                    {c.nature === "LIGNES" ? (
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
                    <thead><tr>{["Rubrique", "Libellé", "Nb", "Base", "Taux", "Mt", "Patronal", "Cumul Nb", "Cumul Base", "Cumul Mt"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                    <tbody>{(l.rubriques ?? []).map((r) => (
                      <tr key={r.code} className={r.absente ? "text-muted-foreground" : ""}>
                        <td className={`${td} px-2 font-mono`}>{r.code}</td>
                        <td className={`${td} px-2`}>{r.absente ? <i>absente du bulletin et des cumuls</i> : r.libelle}</td>
                        {(["NB", "BASE", "TX", "MT", "PAT", "CNB", "CBASE", "CMT"] as const).map((k) => (
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
