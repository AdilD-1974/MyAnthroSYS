/**
 * Canevas.tsx — La page à l'échelle, bande par bande.
 * Auteur : Adil DAIA — lot 2 (16/10/2026)
 *
 * Coordonnées en millimètres (comme la définition) ; 1 mm = 3,78 px × zoom.
 * Glisser un élément le déplace, la poignée en bas à droite le redimensionne,
 * le bord bas d'une bande change sa hauteur. Pas de 0,5 mm (Alt : libre).
 * On dépose dans une bande un champ du catalogue ou un type d'élément de la palette.
 */
import { useRef } from "react";
import { Lock, Image as IconeImage, QrCode, Filter } from "lucide-react";
import {
  LIBELLES_BANDE, elementParDefaut, largeurUtile, texteLitteral,
  type Bande, type Element, type ElGrille, type ElTableau, type Style, type TypeElement,
} from "@/pages/editions/types";
import type { Editeur } from "./useEditeur";

export const PX_PAR_MM = 3.7795;
const PAS_MM = 0.5;
export const TYPE_DND_CHAMP = "application/x-edt-champ";
export const TYPE_DND_ELEMENT = "application/x-edt-element";

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

  return (
    <div className="mx-auto w-fit pb-24" style={{ minWidth: largeur * mm + 160 }}>
      <Regle largeur={largeur} mm={mm} />
      {d.bandes.map((b) => (
        <BandeVue key={b.id} bande={b} editeur={editeur} mm={mm} largeur={largeur}
          lectureSeule={lectureSeule} erreursParElement={erreursParElement} />
      ))}
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

function BandeVue({ bande, editeur, mm, largeur, lectureSeule, erreursParElement }: {
  bande: Bande; editeur: Editeur; mm: number; largeur: number; lectureSeule: boolean; erreursParElement: Map<string, string>;
}) {
  const corps = useRef<HTMLDivElement>(null);
  const selectionnee = editeur.selection.bande === bande.id && !editeur.selection.element;

  const deposer = (e: React.DragEvent) => {
    if (lectureSeule) return;
    const champ = e.dataTransfer.getData(TYPE_DND_CHAMP);
    const type = e.dataTransfer.getData(TYPE_DND_ELEMENT) as TypeElement;
    if (!champ && !type) return;
    e.preventDefault();
    const r = corps.current!.getBoundingClientRect();
    const x = Math.max(0, arrondir((e.clientX - r.left) / mm, false));
    const y = Math.max(0, arrondir((e.clientY - r.top) / mm, false));
    let id = "";
    editeur.modifier((def) => {
      const el = champ ? elementParDefaut(def, "CHAMP", x, y, champ) : elementParDefaut(def, type, x, y);
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
          onDragOver={(e) => { if (!lectureSeule) e.preventDefault(); }}
          onDrop={deposer}
          onPointerDown={(e) => { if (e.target === corps.current) editeur.setSelection({ bande: bande.id, element: null }); }}
          className={`relative overflow-visible border-b border-dashed bg-white ${selectionnee ? "outline outline-2 outline-primary/40" : ""}`}
          style={{
            width: largeur * mm,
            height: Math.max(bande.hauteur * mm, 6),
            backgroundImage: "linear-gradient(to right, rgb(0 0 0 / 0.04) 1px, transparent 1px), linear-gradient(to bottom, rgb(0 0 0 / 0.04) 1px, transparent 1px)",
            backgroundSize: `${5 * mm}px ${5 * mm}px`,
          }}
        >
          {[...bande.elements].sort((a, b) => (a.calque ?? 0) - (b.calque ?? 0)).map((el) => (
            <ElementVue key={el.id} el={el} bande={bande} editeur={editeur} mm={mm} largeur={largeur}
              lectureSeule={lectureSeule} erreur={erreursParElement.get(el.id)} />
          ))}
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

  const tirer = (e: React.PointerEvent, mode: "deplacer" | "taille") => {
    e.stopPropagation();
    // un clic sur une colonne de tableau ou de grille la sélectionne (propriétés à droite)
    const colonne = (e.target as HTMLElement).closest("[data-colonne]")?.getAttribute("data-colonne") ?? null;
    editeur.setSelection({ bande: bande.id, element: el.id, colonne });
    if (lectureSeule || e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY;
    const { x, y, l, h } = el;
    const cible = e.currentTarget as HTMLElement;
    cible.setPointerCapture(e.pointerId);
    const bouger = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / mm, dy = (ev.clientY - y0) / mm;
      editeur.modifierElement(el.id, (z, b) => {
        if (mode === "deplacer") {
          z.x = Math.min(Math.max(0, arrondir(x + dx, ev.altKey)), Math.max(0, largeur - z.l));
          z.y = Math.max(0, arrondir(y + dy, ev.altKey));
        } else {
          z.l = Math.max(z.type === "LIGNE" ? 0.5 : 1, Math.min(arrondir(l + dx, ev.altKey), largeur - z.x));
          z.h = Math.max(z.type === "LIGNE" ? 0.1 : 1, arrondir(h + dy, ev.altKey));
          if (z.type === "TABLEAU") ajusterColonnes(z);
        }
        b.hauteur = Math.max(b.hauteur, z.y + z.h);
      }, `${mode}:${el.id}`);
    };
    const finir = () => { cible.removeEventListener("pointermove", bouger); cible.removeEventListener("pointerup", finir); };
    cible.addEventListener("pointermove", bouger);
    cible.addEventListener("pointerup", finir);
  };

  return (
    <div
      onPointerDown={(e) => tirer(e, "deplacer")}
      title={`${el.id}${erreur ? ` — ${erreur}` : ""}`}
      className={`absolute select-none ${lectureSeule ? "cursor-default" : "cursor-move"} ${
        selectionne ? "z-10 outline outline-2 outline-primary" : erreur ? "outline outline-1 outline-destructive" : "hover:outline hover:outline-1 hover:outline-primary/50"}`}
      style={{ left: el.x * mm, top: el.y * mm, width: el.l * mm, height: Math.max(el.h * mm, 2) }}
    >
      <Contenu el={el} mm={mm} colonne={selectionne ? editeur.selection.colonne ?? null : null} />
      {(el.verrou && el.verrou !== "AUCUN") && <Lock className="absolute -right-1 -top-1 h-3 w-3 rounded bg-amber-100 text-amber-700" />}
      {el.condition && <Filter className="absolute -left-1 -top-1 h-3 w-3 rounded bg-sky-100 text-sky-700" />}
      {selectionne && !lectureSeule && (
        <div onPointerDown={(e) => tirer(e, "taille")}
          className="absolute -bottom-1 -right-1 h-2.5 w-2.5 cursor-nwse-resize border border-primary bg-white" />
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

function styleTexte(s: Style | undefined, mm: number): React.CSSProperties {
  const taillePt = s?.taille ?? 9;
  return {
    fontSize: taillePt * 0.3528 * mm,
    lineHeight: 1.15,
    fontWeight: s?.gras ? 700 : 400,
    fontStyle: s?.italique ? "italic" : "normal",
    textDecoration: s?.souligne ? "underline" : "none",
    color: s?.couleur ?? "#111",
    background: s?.fond ?? "transparent",
    textAlign: s?.alignement === "DROITE" ? "right" : s?.alignement === "CENTRE" ? "center" : s?.alignement === "JUSTIFIE" ? "justify" : "left",
    fontFamily: "Helvetica, Arial, sans-serif",
    direction: s?.langue === "AR" ? "rtl" : undefined,
  };
}

function Contenu({ el, mm, colonne }: { el: Element; mm: number; colonne: string | null }) {
  const st = styleTexte(el.style, mm);
  switch (el.type) {
    case "TEXTE": {
      const lit = texteLitteral(el.valeur);
      return <div className="h-full w-full overflow-hidden whitespace-pre-wrap" style={st}>
        {lit ?? <span className="text-violet-700">ƒ {el.valeur}</span>}
      </div>;
    }
    case "CHAMP":
      return <div className="h-full w-full overflow-hidden whitespace-nowrap bg-sky-50/70" style={st}>
        <span className="text-sky-800">{el.affichage?.texte_avant ?? ""}{`{${el.valeur || "?"}}`}{el.affichage?.texte_apres ?? ""}</span>
      </div>;
    case "TEXTE_RICHE":
      return <div className="h-full w-full overflow-hidden whitespace-pre-wrap bg-violet-50/50" style={st}>{el.contenu}</div>;
    case "IMAGE":
      return <div className="flex h-full w-full items-center justify-center border border-dashed border-muted-foreground/40 text-[10px] text-muted-foreground">
        <IconeImage className="mr-1 h-3 w-3" />image
      </div>;
    case "LIGNE":
      return <div className="w-full" style={{ borderTop: `${Math.max(1, (el.h || 0.3) * mm)}px solid ${el.style?.couleur ?? "#111"}` }} />;
    case "CADRE":
      return <div className="h-full w-full" style={{
        border: `${Math.max(1, (el.style?.epaisseur_bordure ?? 0.3) * mm)}px solid ${el.style?.couleur ?? "#111"}`,
        borderRadius: (el.arrondi ?? 0) * mm, background: el.style?.fond ?? "transparent" }} />;
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
          style={{ width: c.largeur * mm, fontSize: fs, lineHeight: `${hl}px`, fontWeight: gras ? 700 : 400 }}>
          {contenu(c)}
        </div>
      ))}
    </div>
  );
  const titre = (texte: string, cle: string) => (
    <div key={cle} className="bg-muted/50 px-1 font-semibold" style={{ fontSize: fs, height: hl, lineHeight: `${hl}px` }}>{texte}</div>
  );
  const valeur = (c: typeof cols[number], expr?: string) => <span className="text-sky-800">{`{${expr ?? c.valeur}}`}</span>;
  const sections = t.sections?.length ? t.sections : [null];
  let lignes = 0;
  return (
    <div className="h-full w-full overflow-hidden border border-muted-foreground/30 bg-white">
      {ligne((c) => <b title="Cliquer pour modifier la colonne">{c.titre}</b>, "bg-muted")}
      {sections.map((s, i) => (
        <div key={s?.id ?? i}>
          {s?.titre && titre(s.titre, `t${i}`)}
          {s?.rubriques?.length
            ? s.rubriques.map((r, k) => { lignes++; return (
                <div key={k}>{ligne((c) => (c.valeur === "code_rubrique" ? r.code
                  : c.valeur === "libelle" ? (r.libelle ?? <span className="text-muted-foreground">{r.code}</span>)
                  : r.valeurs?.[c.id] ? valeur(c, r.valeurs[c.id]) : <span className="text-sky-800/40">{`{${c.valeur}}`}</span>),
                  "", !!r.style?.gras)}</div>); })
            : (lignes++, ligne((c) => valeur(c)))}
        </div>
      ))}
      {t.section_autres != null && t.sections?.length ? <>{t.section_autres && titre(t.section_autres, "autres")}{ligne((c) => valeur(c), "opacity-50")}</> : null}
      {Array.from({ length: Math.max(0, Math.min((t.lignes_min ?? 0) - lignes, 30)) }).map((_, i) => <div key={`v${i}`}>{ligne(() => "")}</div>)}
      {cols.some((c) => c.total && c.total !== "AUCUN") &&
        ligne((c) => (c.total && c.total !== "AUCUN" ? <b>Σ</b> : ""), "border-t bg-muted/60")}
    </div>
  );
}

function ApercuGrille({ g, mm, colonne }: { g: ElGrille; mm: number; colonne: string | null }) {
  const hl = (g.hauteur_ligne ?? 5) * mm;
  const fs = 8 * 0.3528 * mm;
  const trait = g.quadrillage === "AUCUN" ? "" : "border border-muted-foreground/40";
  const cellule = (cle: string, l: number, contenu: React.ReactNode, cls = "", col?: string) => (
    <div key={cle} data-colonne={col} className={`overflow-hidden whitespace-nowrap px-0.5 ${trait} ${cls} ${col && col === colonne ? "bg-primary/15" : ""}`}
      style={{ width: l * mm, height: hl, fontSize: fs, lineHeight: `${hl}px` }}>{contenu}</div>
  );
  return (
    <div className="h-full w-full overflow-hidden bg-white">
      {(g.entete ?? true) && (
        <div className="flex">
          {!!g.largeur_titres && cellule("vide", g.largeur_titres, "", "border-transparent")}
          {g.colonnes.map((c) => cellule(c.id, c.largeur, <b>{c.titre}</b>, "bg-muted text-center", c.id))}
        </div>
      )}
      {g.lignes.map((l) => (
        <div key={l.id} className="flex">
          {!!g.largeur_titres && cellule(`t${l.id}`, g.largeur_titres, <b>{l.titre}</b>, "bg-muted/50")}
          {g.colonnes.map((c) => cellule(`${l.id}${c.id}`, c.largeur,
            l.valeurs?.[c.id] ? <span className="text-sky-800">{`{${l.valeurs[c.id]}}`}</span> : "", "", c.id))}
        </div>
      ))}
    </div>
  );
}
