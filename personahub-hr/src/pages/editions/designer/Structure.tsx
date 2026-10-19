/**
 * Structure.tsx — Panneau de gauche : palette, bandes et éléments, catalogue des champs.
 * Auteur : Adil DAIA — lot 2 (16/10/2026)
 */
import { useMemo, useState } from "react";
import {
  ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Search,
  Type, Braces, FileText, Image as IconeImage, Minus, Square, QrCode, Table2, Grid3x3, ShieldAlert,
} from "lucide-react";
import {
  LIBELLES_BANDE, LIBELLES_ELEMENT, ORDRE_BANDES, bandeParDefaut, elementParDefaut, grilleDepuisCorps, tableauDepuisCorps,
  type TypeBande, type TypeElement,
} from "@/pages/editions/types";
import { sourceDuJeu, useReferentiels } from "./contexte";
import { TYPE_DND_CHAMP, TYPE_DND_CORPS, TYPE_DND_ELEMENT } from "./Canevas";
import { PaletteImages } from "./BibliothequeImages";
import type { Editeur } from "./useEditeur";

const ICONES: Record<TypeElement, React.ComponentType<{ className?: string }>> = {
  TEXTE: Type, CHAMP: Braces, TEXTE_RICHE: FileText, IMAGE: IconeImage,
  LIGNE: Minus, CADRE: Square, CODE_BARRE: QrCode, TABLEAU: Table2, GRILLE: Grid3x3,
};

export default function Structure({ editeur, lectureSeule }: { editeur: Editeur; lectureSeule: boolean }) {
  const d = editeur.definition!;
  const [onglet, setOnglet] = useState<"structure" | "champs">("structure");

  const bandeCible = () => editeur.selection.bande ?? d.bandes.find((b) => b.type === "CORPS")?.id ?? d.bandes[0]?.id;

  const ajouterElement = (type: TypeElement, valeur?: string) => {
    const idBande = bandeCible();
    if (!idBande || lectureSeule) return;
    let id = "";
    editeur.modifier((def) => {
      const b = def.bandes.find((x) => x.id === idBande)!;
      const bas = Math.max(0, ...b.elements.map((e) => e.y + e.h));
      const el = elementParDefaut(def, type, 0, b.type === "CORPS" ? 0 : bas, valeur);
      if (b.type === "CORPS") el.y = 0;
      id = el.id;
      b.elements.push(el);
      b.hauteur = Math.max(b.hauteur, el.y + el.h);
    });
    editeur.setSelection({ bande: idBande, element: id });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex border-b text-xs">
        {(["structure", "champs"] as const).map((o) => (
          <button key={o} type="button" onClick={() => setOnglet(o)}
            className={`flex-1 px-2 py-2 ${onglet === o ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}>
            {o === "structure" ? "Structure" : "Champs"}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {onglet === "structure"
          ? <>
              {!lectureSeule && <Palette onAjouter={ajouterElement} />}
              {!lectureSeule && <PaletteImages ro={lectureSeule} />}
              <ListeBandes editeur={editeur} lectureSeule={lectureSeule} />
            </>
          : <>
              <DonneesEtat lectureSeule={lectureSeule} onChamp={(c) => ajouterElement("CHAMP", c)} onCorps={(code) => {
                const idBande = bandeCible();
                if (!idBande || lectureSeule) return;
                let id = "";
                editeur.modifier((def) => {
                  const corps = (def.corps ?? []).find((c) => c.code === code)!;
                  const b = def.bandes.find((x) => x.id === idBande)!;
                  const y = Math.max(0, ...b.elements.map((e) => e.y + e.h));
                  const el = corps.nature === "LIGNES" ? tableauDepuisCorps(def, corps, 0, y) : grilleDepuisCorps(def, corps, 0, y);
                  id = el.id;
                  b.elements.push(el);
                  b.hauteur = Math.max(b.hauteur, el.y + el.h);
                });
                editeur.setSelection({ bande: idBande, element: id });
              }} />
              <CatalogueChamps lectureSeule={lectureSeule} onAjouter={(c) => ajouterElement("CHAMP", c)} />
            </>}
      </div>
    </div>
  );
}

function Palette({ onAjouter }: { onAjouter: (t: TypeElement) => void }) {
  return (
    <div className="border-b p-2">
      <div className="mb-1 text-[11px] font-medium uppercase text-muted-foreground">Ajouter</div>
      <div className="grid grid-cols-4 gap-1">
        {(Object.keys(LIBELLES_ELEMENT) as TypeElement[]).map((t) => {
          const Icone = ICONES[t];
          return (
            <button key={t} type="button" draggable
              onDragStart={(e) => e.dataTransfer.setData(TYPE_DND_ELEMENT, t)}
              onClick={() => onAjouter(t)}
              title={`${LIBELLES_ELEMENT[t]} — cliquer pour l'ajouter à la bande sélectionnée, ou glisser sur la page`}
              className="flex flex-col items-center gap-0.5 rounded border p-1 text-[10px] hover:bg-muted">
              <Icone className="h-4 w-4" />
              <span className="w-full truncate text-center">{LIBELLES_ELEMENT[t]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ListeBandes({ editeur, lectureSeule }: { editeur: Editeur; lectureSeule: boolean }) {
  const d = editeur.definition!;
  const [ouvertes, setOuvertes] = useState<Record<string, boolean>>({});
  const [nouveau, setNouveau] = useState<TypeBande>("EN_TETE_PAGE");

  const deplacer = (i: number, sens: -1 | 1) => editeur.modifier((def) => {
    const j = i + sens;
    if (j < 0 || j >= def.bandes.length) return;
    [def.bandes[i], def.bandes[j]] = [def.bandes[j], def.bandes[i]];
  });

  const ajouterBande = () => {
    let id = "";
    editeur.modifier((def) => {
      const b = bandeParDefaut(def, nouveau);
      id = b.id;
      // insérée à sa place naturelle dans l'ordre de rendu
      const rang = ORDRE_BANDES.indexOf(nouveau);
      const pos = def.bandes.findIndex((x) => ORDRE_BANDES.indexOf(x.type) > rang);
      def.bandes.splice(pos < 0 ? def.bandes.length : pos, 0, b);
    });
    editeur.setSelection({ bande: id, element: null });
  };

  return (
    <div className="p-2">
      <div className="mb-1 text-[11px] font-medium uppercase text-muted-foreground">Bandes</div>
      {d.bandes.map((b, i) => {
        const ouverte = ouvertes[b.id] ?? true;
        const sel = editeur.selection.bande === b.id && !editeur.selection.element;
        return (
          <div key={b.id} className="mb-1">
            <div className={`group flex items-center gap-1 rounded px-1 py-0.5 text-xs ${sel ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}>
              <button type="button" onClick={() => setOuvertes({ ...ouvertes, [b.id]: !ouverte })} className="text-muted-foreground">
                {ouverte ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </button>
              <button type="button" className="flex-1 truncate text-left" onClick={() => editeur.setSelection({ bande: b.id, element: null })}>
                {LIBELLES_BANDE[b.type]} <span className="text-muted-foreground">({b.elements.length})</span>
              </button>
              {!lectureSeule && (
                <span className="hidden gap-0.5 group-hover:flex">
                  <button type="button" title="Monter" onClick={() => deplacer(i, -1)}><ArrowUp className="h-3 w-3" /></button>
                  <button type="button" title="Descendre" onClick={() => deplacer(i, 1)}><ArrowDown className="h-3 w-3" /></button>
                </span>
              )}
            </div>
            {ouverte && (
              <div className="ml-4 border-l pl-1">
                {b.elements.map((e) => {
                  const Icone = ICONES[e.type];
                  const actif = editeur.selection.element === e.id;
                  return (
                    <button key={e.id} type="button" onClick={() => editeur.setSelection({ bande: b.id, element: e.id })}
                      className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] ${actif ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}>
                      <Icone className="h-3 w-3 shrink-0" />
                      <span className="truncate">{e.id}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {!lectureSeule && (
        <div className="mt-2 flex gap-1">
          <select value={nouveau} onChange={(e) => setNouveau(e.target.value as TypeBande)}
            className="min-w-0 flex-1 rounded border bg-background px-1 py-1 text-xs">
            {ORDRE_BANDES.map((t) => <option key={t} value={t}>{LIBELLES_BANDE[t]}</option>)}
          </select>
          <button type="button" onClick={ajouterBande} className="rounded border px-2 text-xs hover:bg-muted" title="Ajouter la bande">
            <Plus className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

function CatalogueChamps({ lectureSeule, onAjouter }: { lectureSeule: boolean; onAjouter: (code: string) => void }) {
  const { sources, definition } = useReferentiels();
  const [q, setQ] = useState("");
  const [jeu, setJeu] = useState<string>("");
  const codeJeu = jeu || definition?.jeux.find((j) => j.role === "PRINCIPAL")?.code || "";
  const source = sourceDuJeu(definition, codeJeu);

  const groupes = useMemo(() => {
    const champs = [
      ...(sources.find((s) => s.code === source)?.champs ?? []),
      ...(sources.find((s) => s.code === "SOCIETE")?.champs ?? []).map((c) => ({ ...c, code: `societe.${c.code}`, groupe: "Société" })),
    ].filter((c) => !c.code.includes("*"));
    const bas = q.trim().toLowerCase();
    const filtres = bas ? champs.filter((c) => c.code.toLowerCase().includes(bas) || c.libelle.toLowerCase().includes(bas)) : champs;
    const map = new Map<string, typeof filtres>();
    for (const c of filtres) {
      const g = c.groupe ?? "Général";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(c);
    }
    return [...map.entries()];
  }, [sources, source, q]);

  return (
    <div className="p-2">
      <select value={codeJeu} onChange={(e) => setJeu(e.target.value)} className="mb-2 w-full rounded border bg-background px-1 py-1 text-xs">
        {(definition?.jeux ?? []).map((j) => <option key={j.code} value={j.code}>Jeu « {j.code} » — {j.source}</option>)}
      </select>
      <div className="relative mb-2">
        <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher un champ…"
          onKeyDown={(e) => e.stopPropagation()}
          className="w-full rounded border bg-background py-1 pl-7 pr-2 text-xs" />
      </div>
      <p className="mb-2 text-[10px] text-muted-foreground">
        Glissez un champ sur la page{lectureSeule ? "" : ", ou cliquez pour l'ajouter à la bande sélectionnée"}.
      </p>
      {groupes.map(([g, champs]) => (
        <div key={g} className="mb-2">
          <div className="text-[11px] font-medium text-muted-foreground">{g}</div>
          {champs.map((c) => (
            <button key={c.code} type="button" draggable={!lectureSeule}
              onDragStart={(e) => e.dataTransfer.setData(TYPE_DND_CHAMP, c.code)}
              onClick={() => !lectureSeule && onAjouter(c.code)}
              title={c.code}
              className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] hover:bg-muted">
              <span className="truncate">{c.libelle}</span>
              {c.sensible && <ShieldAlert className="h-3 w-3 shrink-0 text-[hsl(var(--warning))]" aria-label="Donnée sensible" />}
              <span className="ml-auto shrink-0 text-[9px] uppercase text-muted-foreground">{c.type_donnee}</span>
            </button>
          ))}
        </div>
      ))}
      {!groupes.length && <p className="text-xs text-muted-foreground">Aucun champ.</p>}
    </div>
  );
}

/** Corps et variables définis à l'étape Données : à glisser sur la page. */
function DonneesEtat({ lectureSeule, onChamp, onCorps }: { lectureSeule: boolean; onChamp: (c: string) => void; onCorps: (c: string) => void }) {
  const { definition } = useReferentiels();
  const corps = definition?.corps ?? [];
  const vars = definition?.variables ?? [];
  if (!corps.length && !vars.length) {
    return <p className="border-b p-2 text-[11px] text-muted-foreground">Définissez des corps et des variables à l'étape « 1. Données » : ils apparaîtront ici, prêts à placer.</p>;
  }
  return (
    <div className="border-b bg-primary/5 p-2">
      <div className="mb-1 text-[11px] font-semibold uppercase text-primary">Données de l'état</div>
      {corps.map((c) => (
        <button key={c.code} type="button" draggable={!lectureSeule}
          onDragStart={(e) => e.dataTransfer.setData(TYPE_DND_CORPS, c.code)}
          onClick={() => !lectureSeule && onCorps(c.code)}
          title={c.nature === "LIGNES" ? "Placer un tableau lié à ce corps" : "Placer une grille liée à ce corps"}
          className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] hover:bg-muted">
          {c.nature === "LIGNES" ? <Table2 className="h-3 w-3 shrink-0" /> : <Grid3x3 className="h-3 w-3 shrink-0" />}
          <span className="truncate">{c.libelle}</span>
          <span className="ml-auto text-[9px] uppercase text-muted-foreground">corps</span>
        </button>
      ))}
      {vars.map((v) => (
        <button key={v.code} type="button" draggable={!lectureSeule}
          onDragStart={(e) => e.dataTransfer.setData(TYPE_DND_CHAMP, `var.${v.code}`)}
          onClick={() => !lectureSeule && onChamp(`var.${v.code}`)} title={`var.${v.code}`}
          className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] hover:bg-muted">
          <Braces className="h-3 w-3 shrink-0" /><span className="truncate">{v.libelle}</span>
          <span className="ml-auto text-[9px] uppercase text-muted-foreground">variable</span>
        </button>
      ))}
    </div>
  );
}
