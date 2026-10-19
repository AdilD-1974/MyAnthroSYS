/**
 * MiseEnPage.tsx — Réglages de la page : format, orientation, marges, police et taille de l'état,
 * fond de page, filigrane. Bouton « Mise en page » de l'étape 2 et onglet Page de l'inspecteur.
 * Auteur : Adil DAIA — lot 2 bis (18/10/2026) — RG-EDT-PAGE-01
 */
import { useState } from "react";
import { FileText, RectangleHorizontal, RectangleVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  FORMATS_PAGE_MM, dimensionsPage, largeurUtile, texteLitteral, enLitteral,
  type Definition, type ElGrille, type ElTableau, type Page,
} from "@/pages/editions/types";
import FormuleInput from "./FormuleInput";
import { ChoixCouleur, TAILLES } from "./Couleurs";
import { ChoixPolice } from "./Polices";
import { Case, Ligne, Nombre, classeChamp } from "./Inspecteur";
import { ajusterColonnes } from "./Canevas";
import type { Editeur } from "./useEditeur";

const FORMATS: { v: NonNullable<Page["format"]>; l: string }[] = [
  { v: "A4", l: "A4" }, { v: "A3", l: "A3" }, { v: "A5", l: "A5" }, { v: "A6", l: "A6" }, { v: "B5", l: "B5" },
  { v: "LETTRE", l: "Lettre US" }, { v: "LEGAL", l: "Légal US" }, { v: "PERSONNALISE", l: "Personnalisé" },
];
const MARGES: { l: string; v: [number, number, number, number] }[] = [
  { l: "Normales", v: [15, 15, 15, 15] }, { l: "Moyennes", v: [12, 12, 12, 12] }, { l: "Étroites", v: [8, 8, 8, 8] },
  { l: "Larges", v: [25, 25, 25, 25] }, { l: "Reliure", v: [15, 15, 15, 25] }, { l: "Aucune", v: [0, 0, 0, 0] },
];
const FILIGRANES = ["DUPLICATA", "COPIE", "CONFIDENTIEL", "BROUILLON", "ANNULÉ"];

/** RG-EDT-PAGE-02 (Adil DAIA) : la largeur utile change → objets, colonnes de tableaux et de grilles suivent. */
function adapterLargeur(d: Definition, avant: number, apres: number) {
  if (!avant || Math.abs(avant - apres) < 0.05) return;
  const k = apres / avant;
  const r = (v: number) => Math.round(v * k * 10) / 10;
  for (const b of d.bandes) for (const el of b.elements) {
    el.x = r(el.x);
    el.l = Math.max(1, r(el.l));
    if (el.type === "TABLEAU") ajusterColonnes(el as ElTableau);
    if (el.type === "GRILLE") {
      const g = el as ElGrille;
      if (g.largeur_titres) g.largeur_titres = r(g.largeur_titres);
      g.colonnes.forEach((c) => { c.largeur = r(c.largeur); });
    }
  }
}

export function ReglagesPage({ editeur, ro }: { editeur: Editeur; ro: boolean }) {
  const d = editeur.definition!;
  const page = d.page ?? {};
  const marges = page.marges ?? [15, 15, 15, 15];
  const [adapter, setAdapter] = useState(true);
  /** Toute modification de page ; avec « adapter », les objets suivent la nouvelle largeur utile. */
  const changer = (fn: (p: Page) => void, cle: string) => editeur.modifier((x) => {
    const avant = largeurUtile(x.page);
    const p = { ...(x.page ?? {}) } as Page;
    fn(p);
    Object.keys(p).forEach((k) => { const v = (p as Record<string, unknown>)[k]; if (v === null || v === undefined || v === "") delete (p as Record<string, unknown>)[k]; });
    x.page = p;
    if (adapter) adapterLargeur(x, avant, largeurUtile(x.page));
  }, `page:${cle}`);
  const dim = dimensionsPage(page);
  const ech = 120 / Math.max(dim.l, dim.h);
  const fil = texteLitteral(page.filigrane ?? "");

  return (
    <div className="space-y-3">
      <div className="flex gap-4">
        {/* aperçu de la feuille et des marges */}
        <div className="flex h-[130px] w-[130px] shrink-0 items-center justify-center rounded bg-muted/50">
          <div className="relative border bg-white shadow-sm" style={{ width: dim.l * ech, height: dim.h * ech, background: page.couleur_fond ?? "white" }}>
            <div className="absolute border border-dashed border-primary/60"
              style={{ top: marges[0] * ech, right: marges[1] * ech, bottom: marges[2] * ech, left: marges[3] * ech }} />
          </div>
        </div>
        <div className="flex-1 space-y-2">
          <Ligne libelle="Orientation">
            <div className="grid grid-cols-2 gap-1">
              {([["PORTRAIT", "Portrait", RectangleVertical], ["PAYSAGE", "Paysage", RectangleHorizontal]] as const).map(([v, l, Icone]) => (
                <button key={v} type="button" disabled={ro} onClick={() => changer((p) => { p.orientation = v; }, "or")}
                  className={`flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-xs ${(page.orientation ?? "PORTRAIT") === v ? "border-primary bg-primary/10 font-semibold text-primary" : "hover:bg-muted"}`}>
                  <Icone className="h-4 w-4" />{l}
                </button>
              ))}
            </div>
          </Ligne>
          <Ligne libelle="Format">
            <select className={classeChamp} disabled={ro} value={page.format ?? "A4"}
              onChange={(e) => changer((p) => {
                p.format = e.target.value as Page["format"];
                if (p.format === "PERSONNALISE" && (!p.largeur || !p.hauteur)) { p.largeur = 210; p.hauteur = 297; }
              }, "fmt")}>
              {FORMATS.map((f) => <option key={f.v} value={f.v}>
                {f.l}{f.v !== "PERSONNALISE" ? ` — ${FORMATS_PAGE_MM[f.v][0]} × ${FORMATS_PAGE_MM[f.v][1]} mm` : ""}</option>)}
            </select>
          </Ligne>
          {page.format === "PERSONNALISE" && (
            <div className="grid grid-cols-2 gap-1">
              <Ligne libelle="Largeur (mm)"><Nombre value={page.largeur} min={30} disabled={ro} onChange={(v) => changer((p) => { p.largeur = Math.max(30, v ?? 210); }, "pl")} /></Ligne>
              <Ligne libelle="Hauteur (mm)"><Nombre value={page.hauteur} min={30} disabled={ro} onChange={(v) => changer((p) => { p.hauteur = Math.max(30, v ?? 297); }, "ph")} /></Ligne>
            </div>
          )}
        </div>
      </div>

      <Ligne libelle="Marges (mm)">
        <div className="mb-1 flex flex-wrap gap-1">
          {MARGES.map((m) => {
            const actif = m.v.every((x, i) => x === marges[i]);
            return (
              <button key={m.l} type="button" disabled={ro} onClick={() => changer((p) => { p.marges = [...m.v]; }, "mg")}
                className={`rounded border px-2 py-0.5 text-[11px] ${actif ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`}>{m.l}</button>
            );
          })}
        </div>
        <div className="grid grid-cols-4 gap-1">
          {["Haut", "Droite", "Bas", "Gauche"].map((l, i) => (
            <Ligne key={l} libelle={l}><Nombre value={marges[i]} min={0} disabled={ro}
              onChange={(v) => changer((p) => { const mg = [...marges] as [number, number, number, number]; mg[i] = Math.max(0, v ?? 0); p.marges = mg; }, `m${i}`)} /></Ligne>
          ))}
        </div>
      </Ligne>
      <Case libelle="Adapter les objets à la nouvelle largeur (orientation, format, marges)" value={adapter} disabled={ro} onChange={setAdapter} />
      <p className="text-[11px] text-muted-foreground">
        Page {dim.l.toFixed(1)} × {dim.h.toFixed(1)} mm · largeur utile {largeurUtile(page).toFixed(1)} mm
      </p>

      <div className="grid grid-cols-2 gap-1 border-t pt-3">
        <Ligne libelle="Police de l'état" aide="Pour tous les objets qui n'ont pas leur propre police">
          <ChoixPolice value={page.police} disabled={ro} onChange={(v) => changer((p) => { p.police = v; }, "pol")} /></Ligne>
        <Ligne libelle="Taille par défaut (pt)">
          <select className={classeChamp} disabled={ro} value={page.taille ?? ""} onChange={(e) => changer((p) => { p.taille = e.target.value ? Number(e.target.value) : null; }, "tai")}>
            <option value="">9 (défaut)</option>
            {TAILLES.filter((t) => t <= 24).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Ligne>
      </div>
      <Ligne libelle="Couleur de fond des pages">
        <ChoixCouleur value={page.couleur_fond} disabled={ro} vide="Blanc (aucune)" onChange={(v) => changer((p) => { p.couleur_fond = v; }, "fond")} />
      </Ligne>

      <Ligne libelle="Filigrane" aide="Texte en diagonale sur chaque page ; une formule peut le rendre conditionnel">
        <div className="mb-1 flex flex-wrap gap-1">
          <button type="button" disabled={ro} onClick={() => changer((p) => { p.filigrane = null; }, "fil")}
            className={`rounded border px-2 py-0.5 text-[11px] ${!page.filigrane ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`}>Aucun</button>
          {FILIGRANES.map((f) => (
            <button key={f} type="button" disabled={ro} onClick={() => changer((p) => { p.filigrane = enLitteral(f); }, "fil")}
              className={`rounded border px-2 py-0.5 text-[11px] ${fil === f ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`}>{f}</button>
          ))}
        </div>
        <FormuleInput value={page.filigrane ?? ""} disabled={ro} placeholder='ex. "DUPLICATA" ou SI(@copie, "COPIE", "")'
          onChange={(v) => changer((p) => { p.filigrane = v || null; }, "filf")} />
      </Ligne>
    </div>
  );
}

/** Bouton de la barre de l'étape « Mise en forme ». */
export function BoutonMiseEnPage({ editeur, ro }: { editeur: Editeur; ro: boolean }) {
  const [ouvert, setOuvert] = useState(false);
  const p = editeur.definition?.page ?? {};
  const resume = `${FORMATS.find((f) => f.v === (p.format ?? "A4"))?.l ?? p.format} · ${(p.orientation ?? "PORTRAIT") === "PAYSAGE" ? "paysage" : "portrait"}`;
  return (
    <>
      <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={() => setOuvert(true)} title="Format, orientation, marges, police de l'état, fond, filigrane">
        <FileText className="h-3.5 w-3.5" />Mise en page <span className="text-muted-foreground">· {resume}</span>
      </Button>
      <Dialog open={ouvert} onOpenChange={setOuvert}>
        <DialogContent className="ecran-editions-texte max-w-xl" onKeyDown={(e) => e.stopPropagation()}>
          <DialogHeader><DialogTitle>Mise en page</DialogTitle></DialogHeader>
          <ReglagesPage editeur={editeur} ro={ro} />
          <DialogFooter><Button onClick={() => setOuvert(false)}>Fermer</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
