/**
 * Canevas.tsx — La page à l'échelle, bande par bande.
 * Auteur : Adil DAIA — lot 2 (16/10/2026)
 *
 * Coordonnées en millimètres (comme la définition) ; 1 mm = 3,78 px × zoom.
 * Glisser un élément le déplace, la poignée en bas à droite le redimensionne,
 * le bord bas d'une bande change sa hauteur. Pas de 0,5 mm (Alt : libre).
 * On dépose dans une bande un champ du catalogue ou un type d'élément de la palette, une image
 * de la bibliothèque, ou un fichier image glissé depuis l'ordinateur (importé dans la bibliothèque).
 * Clic droit sur un objet : premier plan / arrière-plan, rogner une image.
 */
import { useEffect, useRef, useState } from "react";
import { Lock, QrCode, Filter } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  LIBELLES_BANDE, elementParDefaut, grilleDepuisCorps, largeurUtile, tableauDepuisCorps, texteLitteral,
  type Bande, type Element, type ElGrille, type ElImage, type ElTableau, type Style, type TypeElement,
} from "@/pages/editions/types";
import type { Editeur } from "./useEditeur";
import { ApercuImage, DialogueRognage, TYPE_DND_IMAGE, deposerFichier, tailleNaturelle, urlDe } from "./BibliothequeImages";
import { PLANS, changerPlan } from "./plans";
import { aligner, dansLeLasso, idsSelection, memeBande, repartir, trouver, type Alignement } from "./selection";
import { aimanter, poserGuides, useGuides } from "./guides";
import { cssPolice } from "./Polices";
import { CSS_TRAIT, cssBordures, hexDe } from "./Couleurs";

export const PX_PAR_MM = 3.7795;
const PAS_MM = 0.5;
export const TYPE_DND_CHAMP = "application/x-edt-champ";
export const TYPE_DND_ELEMENT = "application/x-edt-element";
export const TYPE_DND_CORPS = "application/x-edt-corps";

const arrondir = (v: number, libre: boolean) => (libre ? Math.round(v * 10) / 10 : Math.round(v / PAS_MM) * PAS_MM);

interface Props {
  editeur: Editeur;
  zoom: number;
  lectureSeule: boolean;
  erreursParElement: Map<string, string>;
}

export default function Canevas({ editeur, zoom, lectureSeule, erreursParElement }: Props) {
  const d = editeur.definition!;
  const mm = PX_PAR_MM * zoom;
  const largeur = largeurUtile(d.page);
  const racine = useRef<HTMLDivElement>(null);
  const guides = useGuides();
  PAGE_DEFAUT.police = d.page?.police; PAGE_DEFAUT.taille = d.page?.taille;
  const [lasso, setLasso] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

  /** Lasso : tirer sur le fond d'une bande sélectionne tous les objets touchés (Maj : ajoute). */
  const demarrerLasso = (e: React.PointerEvent, bandeId: string) => {
    if (e.button !== 0) return;
    const x1 = e.clientX, y1 = e.clientY, ajout = e.shiftKey || e.ctrlKey || e.metaKey;
    const avant = idsSelection(editeur.selection);
    const cible = e.currentTarget as HTMLElement;
    cible.setPointerCapture(e.pointerId);
    let r = { x1, y1, x2: x1, y2: y1 };
    const bouger = (ev: PointerEvent) => { r = { x1, y1, x2: ev.clientX, y2: ev.clientY }; setLasso(r); };
    const finir = () => {
      cible.removeEventListener("pointermove", bouger);
      cible.removeEventListener("pointerup", finir);
      setLasso(null);
      if (Math.abs(r.x2 - r.x1) < 4 && Math.abs(r.y2 - r.y1) < 4) {           // simple clic : la bande
        if (!ajout) editeur.setSelection({ bande: bandeId, element: null });
        return;
      }
      const touches = dansLeLasso(racine.current!, r);
      const ids = ajout ? [...new Set([...avant, ...touches])] : touches;
      if (!ids.length) { editeur.setSelection({ bande: bandeId, element: null }); return; }
      const principal = ids[0];
      const b = d.bandes.find((x) => x.elements.some((z) => z.id === principal));
      editeur.setSelection({ bande: b?.id ?? bandeId, element: principal, multi: ids.length > 1 ? ids : null });
    };
    cible.addEventListener("pointermove", bouger);
    cible.addEventListener("pointerup", finir);
  };

  return (
    <div ref={racine} className="relative mx-auto w-fit pb-24" style={{ minWidth: largeur * mm + 160 }}>
      <Regle largeur={largeur} mm={mm} />
      {d.bandes.map((b) => (
        <BandeVue key={b.id} bande={b} editeur={editeur} mm={mm} largeur={largeur}
          lectureSeule={lectureSeule} erreursParElement={erreursParElement} demarrerLasso={demarrerLasso}
          guidesY={guides.y.filter((g) => g.bande === b.id).map((g) => g.v)} />
      ))}
      {/* repères verticaux : toute la hauteur de la page */}
      {guides.x.map((x) => (
        <div key={x} className="pointer-events-none absolute bottom-24 top-5 z-30 w-px bg-accent" style={{ left: 150 + x * mm }} />
      ))}
      {lasso && (
        <div className="pointer-events-none fixed z-40 border border-primary bg-primary/10"
          style={{ left: Math.min(lasso.x1, lasso.x2), top: Math.min(lasso.y1, lasso.y2), width: Math.abs(lasso.x2 - lasso.x1), height: Math.abs(lasso.y2 - lasso.y1) }} />
      )}
      {d.bandes.length === 0 && (
        <div className="ml-[150px] rounded border border-dashed p-8 text-center text-sm text-muted-foreground" style={{ width: largeur * mm }}>
          Aucune bande : ajoutez-en une depuis le panneau de gauche.
        </div>
      )}
    </div>
  );
}

function Regle({ largeur, mm }: { largeur: number; mm: number }) {
  const graduations = [];
  for (let x = 0; x <= largeur; x += 10) graduations.push(x);
  return (
    <div className="sticky top-0 z-20 ml-[150px] h-5 border-b bg-muted/80 backdrop-blur" style={{ width: largeur * mm }}>
      {graduations.map((x) => (
        <div key={x} className="absolute top-0 h-full border-l border-muted-foreground/40" style={{ left: x * mm }}>
          <span className="ml-0.5 text-[9px] text-muted-foreground">{x}</span>
        </div>
      ))}
    </div>
  );
}

function BandeVue({ bande, editeur, mm, largeur, lectureSeule, erreursParElement, demarrerLasso, guidesY }: {
  bande: Bande; editeur: Editeur; mm: number; largeur: number; lectureSeule: boolean; erreursParElement: Map<string, string>;
  demarrerLasso: (e: React.PointerEvent, bandeId: string) => void; guidesY: number[];
}) {
  const corps = useRef<HTMLDivElement>(null);
  const selectionnee = editeur.selection.bande === bande.id && !editeur.selection.element;

  /** Pose une image (code de la bibliothèque) en gardant ses proportions, largeur 40 mm par défaut. */
  const poserImage = async (code: string, x: number, y: number) => {
    const u = await urlDe(code);
    const n = u ? await tailleNaturelle(u) : { w: 4, h: 3 };
    let id = "";
    editeur.modifier((def) => {
      const el = elementParDefaut(def, "IMAGE", x, y) as ElImage;
      el.valeur = `ASSET("${code}")`;
      el.l = Math.min(40, largeur);
      el.h = Math.max(2, Math.round((el.l * n.h / n.w) * 2) / 2);
      el.x = Math.min(x, Math.max(0, largeur - el.l));
      id = el.id;
      const b = def.bandes.find((z) => z.id === bande.id)!;
      b.elements.push(el);
      b.hauteur = Math.max(b.hauteur, el.y + el.h);
    }, `image:${code}`);
    editeur.setSelection({ bande: bande.id, element: id });
  };

  const deposer = (e: React.DragEvent) => {
    if (lectureSeule) return;
    const r0 = corps.current!.getBoundingClientRect();
    const px = Math.max(0, arrondir((e.clientX - r0.left) / mm, false));
    const py = Math.max(0, arrondir((e.clientY - r0.top) / mm, false));
    // une image de la bibliothèque
    const codeImage = e.dataTransfer.getData(TYPE_DND_IMAGE);
    if (codeImage) { e.preventDefault(); void poserImage(codeImage, px, py); return; }
    // un fichier image venu de l'ordinateur : importé dans la bibliothèque, puis posé
    const fichiers = Array.from(e.dataTransfer.files ?? []).filter((f) => /^image\/(png|jpe?g)$/.test(f.type));
    if (fichiers.length) {
      e.preventDefault();
      void (async () => {
        let dy = 0;
        for (const f of fichiers) {
          try {
            const img = await deposerFichier(f);
            await poserImage(img.code, px, py + dy);
            dy += 5;
            toast({ title: "Image importée", description: `${f.name} → ${img.formule}` });
          } catch (err) {
            toast({ title: `Image refusée : ${f.name}`, description: (err as Error).message, variant: "destructive" });
          }
        }
      })();
      return;
    }
    if (e.dataTransfer.files?.length) {
      e.preventDefault();
      toast({ title: "Format non accepté", description: "Images PNG ou JPEG uniquement.", variant: "destructive" });
      return;
    }
    const champ = e.dataTransfer.getData(TYPE_DND_CHAMP);
    const type = e.dataTransfer.getData(TYPE_DND_ELEMENT) as TypeElement;
    const corpsCode = e.dataTransfer.getData(TYPE_DND_CORPS);
    if (!champ && !type && !corpsCode) return;
    e.preventDefault();
    const r = corps.current!.getBoundingClientRect();
    const x = Math.max(0, arrondir((e.clientX - r.left) / mm, false));
    const y = Math.max(0, arrondir((e.clientY - r.top) / mm, false));
    let id = "";
    editeur.modifier((def) => {
      const corps = corpsCode ? (def.corps ?? []).find((c) => c.code === corpsCode) : undefined;
      const el = corps
        ? (corps.nature === "LIGNES" ? tableauDepuisCorps(def, corps, 0, y) : grilleDepuisCorps(def, corps, x, y))
        : champ ? elementParDefaut(def, "CHAMP", x, y, champ) : elementParDefaut(def, type, x, y);
      el.x = Math.min(x, Math.max(0, largeur - el.l));
      id = el.id;
      const b = def.bandes.find((z) => z.id === bande.id)!;
      b.elements.push(el);
      b.hauteur = Math.max(b.hauteur, el.y + el.h);
    });
    editeur.setSelection({ bande: bande.id, element: id });
  };

  // redimensionnement de la bande par son bord bas
  const tirerBord = (e: React.PointerEvent) => {
    if (lectureSeule) return;
    e.preventDefault();
    e.stopPropagation();
    const y0 = e.clientY;
    const h0 = bande.hauteur;
    const bas = Math.max(0, ...bande.elements.map((el) => el.y + el.h));
    const cible = e.currentTarget as HTMLElement;
    cible.setPointerCapture(e.pointerId);
    const bouger = (ev: PointerEvent) => {
      const h = Math.max(bas, arrondir(h0 + (ev.clientY - y0) / mm, ev.altKey));
      editeur.modifierBande(bande.id, (b) => { b.hauteur = h; }, `hauteur:${bande.id}`);
    };
    const finir = () => { cible.removeEventListener("pointermove", bouger); cible.removeEventListener("pointerup", finir); };
    cible.addEventListener("pointermove", bouger);
    cible.addEventListener("pointerup", finir);
  };

  return (
    <div className="flex">
      <button
        type="button"
        onClick={() => editeur.setSelection({ bande: bande.id, element: null })}
        className={`w-[150px] shrink-0 border-b border-r px-2 py-1 text-left text-[11px] leading-tight ${selectionnee ? "bg-primary/10 font-medium text-primary" : "bg-muted/40 text-muted-foreground hover:bg-muted"}`}
        title={bande.id}
      >
        <div>{LIBELLES_BANDE[bande.type]}{bande.niveau_groupe ? ` ${bande.niveau_groupe}` : ""}</div>
        <div className="text-[10px] opacity-70">
          {bande.hauteur} mm{bande.extensible ? " · ext." : ""}{bande.condition ? " · si" : ""}
          {bande.saut_avant ? " · saut ↑" : ""}{bande.saut_apres ? " · saut ↓" : ""}
        </div>
      </button>
      <div className="relative">
        <div
          ref={corps}
          data-bande={bande.id}
          onDragOver={(e) => { if (!lectureSeule) e.preventDefault(); }}
          onDrop={deposer}
          onPointerDown={(e) => { if (e.target === corps.current) demarrerLasso(e, bande.id); }}
          className={`relative overflow-visible border-b border-dashed bg-white ${selectionnee ? "outline outline-2 outline-primary/40" : ""}`}
          style={{
            width: largeur * mm,
            height: Math.max(bande.hauteur * mm, 6),
            backgroundColor: hexDe(editeur.definition?.page?.couleur_fond) ?? "white",
            backgroundImage: "linear-gradient(to right, rgb(0 0 0 / 0.04) 1px, transparent 1px), linear-gradient(to bottom, rgb(0 0 0 / 0.04) 1px, transparent 1px)",
            backgroundSize: `${5 * mm}px ${5 * mm}px`,
          }}
        >
          {[...bande.elements].sort((a, b) => (a.calque ?? 0) - (b.calque ?? 0)).map((el) => (
            <ElementVue key={el.id} el={el} bande={bande} editeur={editeur} mm={mm} largeur={largeur}
              lectureSeule={lectureSeule} erreur={erreursParElement.get(el.id)} />
          ))}
          {guidesY.map((y) => <div key={y} className="pointer-events-none absolute left-0 right-0 z-30 h-px bg-accent" style={{ top: y * mm }} />)}
        </div>
        {!lectureSeule && (
          <div onPointerDown={tirerBord} title="Hauteur de la bande"
            className="absolute -bottom-1 left-0 right-0 z-10 h-2 cursor-ns-resize hover:bg-primary/30" />
        )}
      </div>
    </div>
  );
}

function ElementVue({ el, bande, editeur, mm, largeur, lectureSeule, erreur }: {
  el: Element; bande: Bande; editeur: Editeur; mm: number; largeur: number; lectureSeule: boolean; erreur?: string;
}) {
  const selectionne = editeur.selection.element === el.id;
  const multi = editeur.selection.multi ?? [];
  const dansMulti = multi.length > 1 && multi.includes(el.id);

  const tirer = (e: React.PointerEvent, mode: "deplacer" | "taille") => {
    e.stopPropagation();
    if (e.button !== 0 && dansMulti) return;                          // clic droit sur une sélection : on la garde
    // Maj ou Ctrl + clic : ajoute / retire l'objet de la sélection (RG-EDT-FORME-05)
    if (mode === "deplacer" && (e.shiftKey || e.ctrlKey || e.metaKey)) {
      const actuels = idsSelection(editeur.selection);
      const ids = actuels.includes(el.id) ? actuels.filter((x) => x !== el.id) : [...actuels, el.id];
      const principal = ids.includes(editeur.selection.element ?? "") ? editeur.selection.element : ids[ids.length - 1] ?? null;
      const bandePrincipale = principal ? editeur.definition!.bandes.find((b) => b.elements.some((x) => x.id === principal))?.id ?? null : null;
      editeur.setSelection({ bande: bandePrincipale, element: principal, multi: ids.length > 1 ? ids : null });
      return;
    }
    // un clic sur une colonne de tableau ou de grille la sélectionne (propriétés à droite)
    const colonne = (e.target as HTMLElement).closest("[data-colonne]")?.getAttribute("data-colonne") ?? null;
    const groupe = dansMulti && mode === "deplacer" ? multi : [el.id];
    editeur.setSelection(dansMulti && mode === "deplacer"
      ? { bande: bande.id, element: el.id, multi }
      : { bande: bande.id, element: el.id, colonne });
    if (lectureSeule || e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY;
    const { x, y, l, h } = el;
    const depart = new Map(trouver(editeur.definition!, groupe).map((o) => [o.el.id, { x: o.el.x, y: o.el.y }]));
    const cible = e.currentTarget as HTMLElement;
    const hauteurBande0 = bande.hauteur;
    const prise = (y0 - cible.getBoundingClientRect().top) / mm;      // point saisi, depuis le haut de l'élément
    const seuil = 6 / mm;                                              // ~6 px d'aimantation, quel que soit le zoom
    cible.setPointerCapture(e.pointerId);
    let bouge = false;
    const bouger = (ev: PointerEvent) => {
      let dx = (ev.clientX - x0) / mm, dy = (ev.clientY - y0) / mm;
      if (!bouge && Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3) return;   // un simple clic ne déplace rien
      bouge = true;
      if (mode === "deplacer") {
        // aimantation sur les bords et centres des autres objets (Alt : libre)
        let nx = arrondir(x + dx, ev.altKey), ny = arrondir(y + dy, ev.altKey);
        if (!ev.altKey) {
          const a = aimanter(editeur.definition!, bande.id, groupe, { x: nx, y: ny, l, h }, largeur, seuil);
          nx += a.dx; ny += a.dy;
          poserGuides(a.guides);
        }
        dx = nx - x; dy = ny - y;
        editeur.modifier((d) => {
          for (const { el: z, bande: b } of trouver(d, groupe)) {
            const p0 = depart.get(z.id)!;
            z.x = Math.min(Math.max(0, Math.round((p0.x + dx) * 10) / 10), Math.max(0, largeur - z.l));
            z.y = Math.max(0, Math.round((p0.y + dy) * 10) / 10);
            b.hauteur = Math.max(b.hauteur, z.y + z.h);
          }
        }, `deplacer:${groupe.join(",")}`);
      } else {
        editeur.modifierElement(el.id, (z, b) => {
          z.l = Math.max(z.type === "LIGNE" ? 0.5 : 1, Math.min(arrondir(l + dx, ev.altKey), largeur - z.x));
          z.h = Math.max(z.type === "LIGNE" ? 0.1 : 1, arrondir(h + dy, ev.altKey));
          if (z.type === "TABLEAU") ajusterColonnes(z);
          b.hauteur = Math.max(b.hauteur, z.y + z.h);
        }, `taille:${el.id}`);
      }
    };
    const finir = (ev: PointerEvent) => {
      cible.removeEventListener("pointermove", bouger);
      cible.removeEventListener("pointerup", finir);
      poserGuides({ x: [], y: [] });
      if (!bouge && groupe.length > 1) { editeur.setSelection({ bande: bande.id, element: el.id, colonne }); return; }   // clic : cet objet seul
      if (mode !== "deplacer" || !bouge || groupe.length > 1) return;
      // RG-EDT-FORME (Adil DAIA) : lâché au-dessus d'une autre bande (en-tête, détail, pied…), l'élément y passe
      const sous = document.elementsFromPoint(ev.clientX, ev.clientY)
        .filter((n) => !cible.contains(n))
        .map((n) => (n as HTMLElement).closest?.("[data-bande]") as HTMLElement | null)
        .find((n) => !!n);
      const idCible = sous?.getAttribute("data-bande");
      if (!sous || !idCible || idCible === bande.id) return;
      const haut = sous.getBoundingClientRect().top;
      const ny = Math.max(0, arrondir((ev.clientY - haut) / mm - prise, ev.altKey));
      editeur.modifier((d) => {
        const src = d.bandes.find((b) => b.id === bande.id);
        const dst = d.bandes.find((b) => b.id === idCible);
        const i = src?.elements.findIndex((z) => z.id === el.id) ?? -1;
        if (!src || !dst || i < 0) return;
        const [z] = src.elements.splice(i, 1);
        src.hauteur = hauteurBande0;                                    // la bande quittée retrouve sa hauteur
        z.y = ny;
        dst.elements.push(z);
        dst.hauteur = Math.max(dst.hauteur, z.y + z.h);
      }, `bande:${el.id}`);
      editeur.setSelection({ bande: idCible, element: el.id });
    };
    cible.addEventListener("pointermove", bouger);
    cible.addEventListener("pointerup", finir);
  };

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [rogner, setRogner] = useState(false);
  useEffect(() => {
    if (!menu) return;
    const fermer = () => setMenu(null);
    window.addEventListener("pointerdown", fermer);
    window.addEventListener("scroll", fermer, true);
    return () => { window.removeEventListener("pointerdown", fermer); window.removeEventListener("scroll", fermer, true); };
  }, [menu]);

  return (
    <div
      data-element={el.id}
      onPointerDown={(e) => tirer(e, "deplacer")}
      onContextMenu={(e) => {
        if (lectureSeule) return;
        e.preventDefault();
        if (!dansMulti) editeur.setSelection({ bande: bande.id, element: el.id });
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      onDoubleClick={() => { if (!lectureSeule && el.type === "IMAGE") setRogner(true); }}
      title={`${el.id}${erreur ? ` — ${erreur}` : ""}${el.type === "IMAGE" ? " — double-clic : rogner" : ""}`}
      className={`absolute select-none ${lectureSeule ? "cursor-default" : "cursor-move"} ${
        selectionne && !dansMulti ? "z-10 outline outline-2 outline-primary"
          : dansMulti ? `z-10 outline outline-2 ${selectionne ? "outline-primary" : "outline-dashed outline-primary/70"} bg-primary/5`
          : erreur ? "outline outline-1 outline-destructive" : "hover:outline hover:outline-1 hover:outline-primary/50"}`}
      style={{ left: el.x * mm, top: el.y * mm, width: el.l * mm, height: Math.max(el.h * mm, 2) }}
    >
      <Contenu el={el} mm={mm} colonne={selectionne ? editeur.selection.colonne ?? null : null} />
      {(el.verrou && el.verrou !== "AUCUN") && <Lock className="absolute -right-1 -top-1 h-3 w-3 rounded bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]" />}
      {el.condition && <Filter className="absolute -left-1 -top-1 h-3 w-3 rounded bg-primary/10 text-primary" />}
      {selectionne && !dansMulti && !lectureSeule && (
        <div onPointerDown={(e) => tirer(e, "taille")}
          className="absolute -bottom-1 -right-1 h-2.5 w-2.5 cursor-nwse-resize border border-primary bg-white" />
      )}
      {menu && (
        <div className="fixed z-[100] w-60 rounded-md border bg-popover py-1 text-xs shadow-lg" style={{ left: menu.x, top: menu.y }}
          onPointerDown={(e) => e.stopPropagation()}>
          {dansMulti && <>
            <div className="px-3 pb-1 pt-0.5 text-[10px] uppercase text-muted-foreground">{multi.length} objets sélectionnés</div>
            {([["GAUCHE", "Aligner à gauche"], ["CENTRE_H", "Centrer horizontalement"], ["DROITE", "Aligner à droite"],
               ["HAUT", "Aligner en haut"], ["MILIEU_V", "Centrer verticalement"], ["BAS", "Aligner en bas"]] as [Alignement, string][]).map(([m, l]) => (
              <button key={m} type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent disabled:opacity-40"
                disabled={["HAUT", "MILIEU_V", "BAS"].includes(m) && !memeBande(editeur.definition!, multi)}
                onClick={() => { editeur.modifier((d) => aligner(d, multi, m, editeur.selection.element ?? undefined), `aligner`); setMenu(null); }}>{l}</button>
            ))}
            <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent disabled:opacity-40" disabled={multi.length < 3}
              onClick={() => { editeur.modifier((d) => repartir(d, multi, "H"), "repartir"); setMenu(null); }}>Répartir horizontalement</button>
            <div className="my-1 border-t" />
          </>}
          {!dansMulti && PLANS.map((p) => (
            <button key={p.v} type="button" className="flex w-full items-center px-3 py-1.5 text-left hover:bg-accent"
              onClick={() => { editeur.modifier((d) => changerPlan(d, bande.id, el.id, p.v), `plan:${el.id}`); setMenu(null); }}>
              {p.l}<span className="ml-auto text-muted-foreground">{p.raccourci}</span>
            </button>
          ))}
          {el.type === "IMAGE" && <>
            <div className="my-1 border-t" />
            <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent" onClick={() => { setMenu(null); setRogner(true); }}>Rogner l'image…</button>
            {el.rognage && (
              <button type="button" className="w-full px-3 py-1.5 text-left hover:bg-accent"
                onClick={() => { editeur.modifierElement(el.id, (z) => { delete (z as ElImage).rognage; }, `rogn:${el.id}`); setMenu(null); }}>Annuler le rognage</button>
            )}
          </>}
        </div>
      )}
      {el.type === "IMAGE" && (
        // le dialogue est rendu ailleurs (portail) mais ses événements remontent l'arbre React : on les arrête ici
        <div className="contents" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
          <DialogueRognage el={el} ouvert={rogner} onFermer={() => setRogner(false)}
            onValider={(r) => editeur.modifierElement(el.id, (z) => { const i = z as ElImage; if (r) i.rognage = r; else delete i.rognage; }, `rogn:${el.id}`)} />
        </div>
      )}
    </div>
  );
}

/** Les colonnes d'un tableau suivent sa largeur, au prorata. */
export function ajusterColonnes(t: ElTableau) {
  const visibles = t.colonnes.filter((c) => !c.masquee);
  const total = visibles.reduce((s, c) => s + c.largeur, 0);
  if (!total) return;
  const k = t.l / total;
  let reste = t.l;
  visibles.forEach((c, i) => {
    c.largeur = i === visibles.length - 1 ? Math.round(reste * 10) / 10 : Math.round(c.largeur * k * 10) / 10;
    reste -= c.largeur;
  });
}

/** Police et taille de l'état (Mise en page), reprises par les objets sans réglage propre. */
const PAGE_DEFAUT: { police?: string | null; taille?: number | null } = {};

function styleTexte(s: Style | undefined, mm: number): React.CSSProperties {
  const taillePt = s?.taille ?? PAGE_DEFAUT.taille ?? 9;
  return {
    fontSize: taillePt * 0.3528 * mm,
    lineHeight: 1.15,
    fontWeight: s?.gras ? 700 : 400,
    fontStyle: s?.italique ? "italic" : "normal",
    textDecoration: s?.souligne ? "underline" : "none",
    textTransform: s?.casse === "MAJUSCULES" ? "uppercase" : s?.casse === "MINUSCULES" ? "lowercase" : s?.casse === "INITIALES" ? "capitalize" : undefined,
    fontVariant: s?.casse === "PETITES_MAJUSCULES" ? "small-caps" : undefined,
    color: hexDe(s?.couleur) ?? "#111",
    background: hexDe(s?.fond) ?? "transparent",
    ...cssBordures(s?.bordures, s?.couleur_bordure ?? s?.couleur, s?.epaisseur_bordure, mm, s?.style_trait),
    ...(s?.alignement_vertical ? { display: "flex", flexDirection: "column" as const,
      justifyContent: s.alignement_vertical === "HAUT" ? "flex-start" : s.alignement_vertical === "BAS" ? "flex-end" : "center" } : {}),
    textAlign: s?.alignement === "DROITE" ? "right" : s?.alignement === "CENTRE" ? "center" : s?.alignement === "JUSTIFIE" ? "justify" : "left",
    fontFamily: cssPolice(s?.police ?? PAGE_DEFAUT.police),
    direction: s?.langue === "AR" ? "rtl" : undefined,
  };
}

function Contenu({ el, mm, colonne }: { el: Element; mm: number; colonne: string | null }) {
  const st = styleTexte(el.style, mm);
  switch (el.type) {
    case "TEXTE": {
      const lit = texteLitteral(el.valeur);
      return <div className="h-full w-full overflow-hidden whitespace-pre-wrap" style={st}>
        {lit ?? <span className="text-[hsl(var(--accent))]">ƒ {el.valeur}</span>}
      </div>;
    }
    case "CHAMP":
      return <div className="h-full w-full overflow-hidden whitespace-nowrap bg-primary/5" style={st}>
        <span className="text-primary">{el.affichage?.texte_avant ?? ""}{`{${el.valeur || "?"}}`}{el.affichage?.texte_apres ?? ""}</span>
      </div>;
    case "TEXTE_RICHE":
      return <div className="h-full w-full overflow-hidden whitespace-pre-wrap bg-[hsl(var(--accent)/0.08)]" style={st}>{el.contenu}</div>;
    case "IMAGE":
      return <ApercuImage el={el} l={el.l * mm} h={Math.max(el.h * mm, 2)} />;
    case "LIGNE":
      return el.l >= el.h
        ? <div className="absolute inset-x-0 top-1/2 -translate-y-1/2" style={{ borderTop: `${Math.max(1, (el.style?.epaisseur_bordure ?? 0.5) * 0.3528 * mm)}px ${CSS_TRAIT[el.style?.style_trait ?? "PLEIN"]} ${hexDe(el.style?.couleur) ?? "#111"}` }} />
        : <div className="absolute inset-y-0 left-1/2 -translate-x-1/2" style={{ borderLeft: `${Math.max(1, (el.style?.epaisseur_bordure ?? 0.5) * 0.3528 * mm)}px ${CSS_TRAIT[el.style?.style_trait ?? "PLEIN"]} ${hexDe(el.style?.couleur) ?? "#111"}` }} />;
    case "CADRE":
      return <div className="h-full w-full" style={{
        border: `${Math.max(1, (el.style?.epaisseur_bordure ?? 0.5) * 0.3528 * mm)}px ${CSS_TRAIT[el.style?.style_trait ?? "PLEIN"]} ${hexDe(el.style?.couleur) ?? "#111"}`,
        borderRadius: (el.arrondi ?? 0) * mm, background: hexDe(el.style?.fond) ?? "transparent" }} />;
    case "CODE_BARRE":
      return <div className="flex h-full w-full items-center justify-center border border-muted-foreground/40 bg-white">
        <QrCode className="h-3/4 w-3/4 text-muted-foreground" />
      </div>;
    case "TABLEAU":
      return <ApercuTableau t={el} mm={mm} colonne={colonne} />;
    case "GRILLE":
      return <ApercuGrille g={el} mm={mm} colonne={colonne} />;
  }
}

function ApercuTableau({ t, mm, colonne }: { t: ElTableau; mm: number; colonne: string | null }) {
  const cols = t.colonnes.filter((c) => !c.masquee);
  const hl = (t.hauteur_ligne ?? 5) * mm;
  const fs = 8 * 0.3528 * mm;
  const traits = t.quadrillage === "COMPLET" ? "border border-muted-foreground/40" : t.quadrillage === "COLONNES" ? "border-x border-muted-foreground/40" : "border-r border-muted-foreground/10";
  const ligne = (contenu: (c: typeof cols[number]) => React.ReactNode, cls = "", gras = false) => (
    <div className={`flex ${cls}`} style={{ height: hl }}>
      {cols.map((c) => (
        <div key={c.id} data-colonne={c.id}
          className={`overflow-hidden whitespace-nowrap px-0.5 ${traits} ${colonne === c.id ? "bg-primary/15" : ""}`}
          style={{ width: c.largeur * mm, fontSize: (c.style?.taille ?? t.style?.taille) ? (c.style?.taille ?? t.style?.taille)! * 0.3528 * mm : fs,
            lineHeight: `${hl}px`, fontWeight: gras ? 700 : 400, fontFamily: cssPolice(c.style?.police ?? t.style?.police) }}>
          {contenu(c)}
        </div>
      ))}
    </div>
  );
  const titre = (texte: string, cle: string) => (
    <div key={cle} className="bg-muted/50 px-1 font-semibold" style={{ fontSize: fs, height: hl, lineHeight: `${hl}px` }}>{texte}</div>
  );
  const valeur = (c: typeof cols[number], expr?: string) => <span className="text-primary">{`{${expr ?? c.valeur}}`}</span>;
  const sections = t.sections?.length ? t.sections : [null];
  let lignes = 0;
  return (
    <div className="h-full w-full overflow-hidden border border-muted-foreground/30 bg-white">
      {(t.entete ?? true)
        ? ligne((c) => <b title="Cliquer pour modifier la colonne">{c.titre}</b>, "bg-muted")
        : ligne((c) => <span className="text-[0.85em] text-muted-foreground/60" title="En-tête masqué à l'impression">{c.titre}</span>, "bg-muted/20 border-b border-dashed")}
      {sections.map((s, i) => (
        <div key={s?.id ?? i}>
          {s?.titre && titre(s.titre, `t${i}`)}
          {s?.rubriques?.length
            ? s.rubriques.map((r, k) => { lignes++; return (
                <div key={k}>{ligne((c) => (c.valeur === "code_rubrique" ? r.code
                  : c.valeur === "libelle" ? (r.libelle ?? <span className="text-muted-foreground">{r.code}</span>)
                  : r.valeurs?.[c.id] ? valeur(c, r.valeurs[c.id]) : <span className="text-primary/40">{`{${c.valeur}}`}</span>),
                  "", !!r.style?.gras)}</div>); })
            : (lignes++, ligne((c) => valeur(c)))}
        </div>
      ))}
      {t.section_autres != null && t.sections?.length ? <>{t.section_autres && titre(t.section_autres, "autres")}{ligne((c) => valeur(c), "opacity-50")}</> : null}
      {Array.from({ length: Math.max(0, Math.min((t.lignes_min ?? 0) - lignes, 30)) }).map((_, i) => <div key={`v${i}`}>{ligne(() => "")}</div>)}
      {(t.ligne_total ?? true) && cols.some((c) => c.total && c.total !== "AUCUN") &&
        ligne((c) => (c.total && c.total !== "AUCUN" ? <b>Σ</b> : ""), "border-t bg-muted/60")}
    </div>
  );
}

function ApercuGrille({ g, mm, colonne }: { g: ElGrille; mm: number; colonne: string | null }) {
  const hl = (g.hauteur_ligne ?? 5) * mm;
  const fs = 8 * 0.3528 * mm;
  const retour = g.retour_ligne ?? true;
  const trait = g.quadrillage === "AUCUN" ? "" : "border border-muted-foreground/40";
  const base = g.style ?? {};
  const fusion = (...ss: (Style | undefined)[]) => Object.assign({}, base, ...ss.map((x) => x ?? {})) as Style;
  const cellule = (cle: string, l: number, contenu: React.ReactNode, st: React.CSSProperties, cls = "", col?: string, entete = false) => (
    <div key={cle} data-colonne={col}
      className={`overflow-hidden px-0.5 ${retour && entete ? "whitespace-normal break-words" : "whitespace-nowrap"} ${trait} ${cls} ${col && col === colonne ? "ring-1 ring-inset ring-primary" : ""}`}
      style={{ width: l * mm, minHeight: hl, fontSize: fs, lineHeight: retour && entete ? 1.15 : `${hl}px`, display: "flex", alignItems: "center", ...st }}>
      <div className="w-full">{contenu}</div>
    </div>
  );
  const stEntete = styleTexte(fusion({ gras: true, fond: "#E8E8E8", alignement: "CENTRE" }, g.style_entete), mm);
  const stTitres = styleTexte(fusion({ gras: true, fond: "#F4F4F4" }, g.style_titres), mm);
  return (
    <div className="h-full w-full overflow-hidden bg-white">
      {(g.entete ?? true) && (
        <div className="flex items-stretch">
          {!!g.largeur_titres && cellule("vide", g.largeur_titres, "", {}, "border-transparent")}
          {g.colonnes.map((c) => cellule(c.id, c.largeur, c.titre, { ...stEntete, ...(c.style?.taille ? { fontSize: c.style.taille * 0.3528 * mm } : {}) }, "", c.id, true))}
        </div>
      )}
      {g.lignes.map((l) => (
        <div key={l.id} className="flex items-stretch">
          {!!g.largeur_titres && cellule(`t${l.id}`, g.largeur_titres, l.titre, stTitres, "", undefined, true)}
          {g.colonnes.map((c) => cellule(`${l.id}${c.id}`, c.largeur,
            l.valeurs?.[c.id] ? <span className="text-primary">{`{${l.valeurs[c.id]}}`}</span> : "", { fontFamily: cssPolice(base.police) }, "", c.id))}
        </div>
      ))}
    </div>
  );
}
