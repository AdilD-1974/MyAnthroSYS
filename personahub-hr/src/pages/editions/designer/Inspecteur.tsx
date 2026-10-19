/**
 * Inspecteur.tsx — Panneau de droite : propriétés de la sélection.
 * Auteur : Adil DAIA — lot 2 (16/10/2026)
 *
 * Rien de sélectionné → propriétés du modèle (page, paramètres, données, sortie).
 * Une bande → ses propriétés. Un élément → position, contenu, affichage, style.
 * Une propriété vidée est SUPPRIMÉE de la définition (pas de chaîne vide) : le
 * backend refuse les valeurs hors schéma, et la définition reste lisible.
 */
import { useEffect, useMemo, useState } from "react";
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter,
  AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, ArrowDown, ArrowUp, Copy, MoveHorizontal, MoveVertical,
  Maximize2, Plus, Trash2, X,
} from "lucide-react";
import {
  LIBELLES_BANDE, LIBELLES_ELEMENT, LIBELLES_PARAMETRE, RUBRIQUES_EN_TETE, copie, enLitteral, generateurIds, grilleDepuisCorps, identifiants, largeurUtile, nouvelId, tableauDepuisCorps,
  texteLitteral, type Affichage, type Bande, type Colonne, type Definition, type Element, type ElGrille, type ElImage, type ElTableau,
  type Jeu, type LigneRubrique, type Parametre, type Section, type Style, type TypeParametre,
} from "@/pages/editions/types";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import FormuleInput from "./FormuleInput";
import { ChoixImage, DialogueRognage } from "./BibliothequeImages";
import { ReglagesPage } from "./MiseEnPage";
import { PLANS, changerPlan, rangPlan } from "./plans";
import {
  aligner, alignerPage, copier, dupliquer, memeBande, memeTaille, pleineLargeur, repartir, supprimer as supprimerObjets, trouver,
  type Alignement, type AlignementPage,
} from "./selection";
import { ChoixPolice } from "./Polices";
import { ChoixArrondi, ChoixBordures, ChoixCouleur, ChoixEpaisseur, ChoixTrait, TAILLES } from "./Couleurs";
import { useReferentiels } from "./contexte";
import { ajusterColonnes } from "./Canevas";
import type { Editeur } from "./useEditeur";
import Liste from "../Liste";
import { Checkbox } from "@/components/ui/checkbox";

/** Nouveaux identifiants pour les colonnes, groupes et lignes d'un élément dupliqué. */
export function renommerSousParties(def: Definition, n: Element) {
  const id = generateurIds(def);
  n.id = id(n.type);
  if (n.type === "TABLEAU") {
    n.colonnes.forEach((c) => {
      const ancien = c.id; c.id = id("col");
      (n.sections ?? []).forEach((s) => (s.rubriques ?? []).forEach((r) => {
        if (r.valeurs && ancien in r.valeurs) { r.valeurs[c.id] = r.valeurs[ancien]; delete r.valeurs[ancien]; }
      }));
    });
    (n.sections ?? []).forEach((s) => { s.id = id("groupe"); });
  }
  if (n.type === "GRILLE") {
    n.colonnes.forEach((c) => {
      const ancien = c.id; c.id = id(`${n.id}_c`);
      n.lignes.forEach((l) => { if (l.valeurs && ancien in l.valeurs) { l.valeurs[c.id] = l.valeurs[ancien]; delete l.valeurs[ancien]; } });
    });
    n.lignes.forEach((l) => { l.id = id(`${n.id}_l`); });
  }
}

// ── petits composants de formulaire ─────────────────────────────────────────
export function Ligne({ libelle, children, aide }: { libelle: string; children: React.ReactNode; aide?: string }) {
  return (
    <label className="mb-2 block">
      <span className="mb-0.5 block text-[11px] font-medium text-muted-foreground" title={aide}>{libelle}</span>
      {children}
    </label>
  );
}

export const classeChamp = "w-full rounded-md border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring disabled:opacity-60";

export function Texte({ value, onChange, disabled, placeholder }: { value?: string | null; onChange: (v: string) => void; disabled?: boolean; placeholder?: string }) {
  return <input className={classeChamp} value={value ?? ""} disabled={disabled} placeholder={placeholder}
    onKeyDown={(e) => e.stopPropagation()} onChange={(e) => onChange(e.target.value)} />;
}

export function Nombre({ value, onChange, disabled, pas = 0.5, min }: { value?: number | null; onChange: (v: number | null) => void; disabled?: boolean; pas?: number; min?: number }) {
  return <input type="number" step={pas} min={min} className={classeChamp} value={value ?? ""} disabled={disabled}
    onKeyDown={(e) => e.stopPropagation()}
    onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />;
}

export function Choix<T extends string>({ value, options, onChange, disabled, vide }: {
  value?: T | null; options: { v: T; l: string }[]; onChange: (v: T | null) => void; disabled?: boolean; vide?: string;
}) {
  // RG-EDT-UI-02 : Select du thème (jamais de liste native)
  return (
    <Liste compact value={value ?? ""} disabled={disabled} vide={vide} onChange={(v) => onChange((v || null) as T | null)}
      options={options.map((o) => ({ v: o.v, l: o.l }))} />
  );
}

export function Case({ libelle, value, onChange, disabled }: { libelle: string; value?: boolean | null; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="mr-3 inline-flex items-center gap-1 text-xs">
      <Checkbox checked={!!value} disabled={disabled} onCheckedChange={(coche) => onChange((coche === true))} />
      {libelle}
    </label>
  );
}

export function Titre({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 mt-4 border-b pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground first:mt-0">{children}</div>;
}

/** Pose ou supprime une propriété optionnelle. */
export function poser<T extends object>(obj: T, cle: keyof T, v: unknown) {
  if (v === null || v === undefined || v === "") delete (obj as any)[cle];
  else (obj as any)[cle] = v;
}

export function nettoyer<T extends object>(obj: T | undefined): T | undefined {
  if (!obj) return obj;
  return Object.keys(obj).length ? obj : undefined;
}

// ── panneau ─────────────────────────────────────────────────────────────────
export default function Inspecteur({ editeur, lectureSeule }: { editeur: Editeur; lectureSeule: boolean }) {
  if ((editeur.selection.multi?.length ?? 0) > 1) return <InspecteurMulti editeur={editeur} ro={lectureSeule} />;
  if (editeur.element && editeur.bande) return <InspecteurElement key={editeur.element.id} editeur={editeur} el={editeur.element} bande={editeur.bande} ro={lectureSeule} />;
  if (editeur.bande) return <InspecteurBande editeur={editeur} bande={editeur.bande} ro={lectureSeule} />;
  return <InspecteurModele editeur={editeur} ro={lectureSeule} />;
}

// ── élément ─────────────────────────────────────────────────────────────────
function InspecteurElement({ editeur, el, bande, ro }: { editeur: Editeur; el: Element; bande: Bande; ro: boolean }) {
  const d = editeur.definition!;
  const { masques } = useReferentiels();
  const [idSaisi, setIdSaisi] = useState<string | null>(null);
  const maj = (fn: (e: any, b: Bande) => void, cle: string) => editeur.modifierElement(el.id, fn, `${cle}:${el.id}`);

  const renommer = (nouveau: string) => {
    setIdSaisi(null);
    const propre = nouveau.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
    if (!propre || propre === el.id) return;
    if (identifiants(d).has(propre)) { alert(`L'identifiant « ${propre} » existe déjà.`); return; }
    if (!confirm("Changer l'identifiant détache les variantes de forme qui le ciblent. Continuer ?")) return;
    editeur.modifierElement(el.id, (e) => { e.id = propre; });
    editeur.setSelection({ bande: bande.id, element: propre });
  };

  const dupliquer = () => {
    let id = "";
    editeur.modifier((def) => {
      const b = def.bandes.find((x) => x.id === bande.id)!;
      const n = copie(b.elements.find((x) => x.id === el.id)!) as Element;
      renommerSousParties(def, n);
      n.y = n.y + n.h + 1;
      b.hauteur = Math.max(b.hauteur, n.y + n.h);
      b.elements.push(n);
      id = n.id;
    });
    editeur.setSelection({ bande: bande.id, element: id });
  };

  const supprimer = () => {
    editeur.modifier((def) => {
      const b = def.bandes.find((x) => x.id === bande.id)!;
      b.elements = b.elements.filter((x) => x.id !== el.id);
    });
    editeur.setSelection({ bande: bande.id, element: null });
  };

  const changerBande = (idBande: string) => {
    editeur.modifier((def) => {
      const src = def.bandes.find((x) => x.id === bande.id)!;
      const dst = def.bandes.find((x) => x.id === idBande)!;
      const e = src.elements.find((x) => x.id === el.id)!;
      src.elements = src.elements.filter((x) => x.id !== el.id);
      dst.elements.push(e);
      dst.hauteur = Math.max(dst.hauteur, e.y + e.h);
    });
    editeur.setSelection({ bande: idBande, element: el.id });
  };

  return (
    <div className="p-3">
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase">{LIBELLES_ELEMENT[el.type]}</span>
        {!ro && <>
          <button type="button" title="Dupliquer (Ctrl+D)" onClick={dupliquer} className="ml-auto rounded p-1 hover:bg-muted"><Copy className="h-3.5 w-3.5" /></button>
          <button type="button" title="Supprimer (Suppr)" onClick={supprimer} className="rounded p-1 text-destructive hover:bg-destructive/10"><Trash2 className="h-3.5 w-3.5" /></button>
        </>}
      </div>

      <Ligne libelle="Identifiant" aide="Stable : les variantes de forme s'y accrochent (RG-EDT-FORME-03)">
        <input className={classeChamp} disabled={ro} value={idSaisi ?? el.id}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") renommer((e.target as HTMLInputElement).value); }}
          onChange={(e) => setIdSaisi(e.target.value)} onBlur={(e) => idSaisi !== null && renommer(e.target.value)} />
      </Ligne>
      <Ligne libelle="Bande">
        <Choix value={bande.id} disabled={ro} onChange={(v) => v && changerBande(v)}
          options={d.bandes.map((b) => ({ v: b.id, l: `${LIBELLES_BANDE[b.type]} (${b.id})` }))} />
      </Ligne>

      <Titre>Position et taille (mm)</Titre>
      <div className="grid grid-cols-4 gap-1">
        {(["x", "y", "l", "h"] as const).map((k) => (
          <Ligne key={k} libelle={{ x: "X", y: "Y", l: "Largeur", h: "Hauteur" }[k]}>
            <Nombre value={el[k]} disabled={ro} pas={k === "h" && el.type === "LIGNE" ? 0.1 : 0.5} min={0}
              onChange={(v) => maj((e, b) => {
                e[k] = Math.max(k === "l" || k === "h" ? 0.1 : 0, v ?? 0);
                if (k === "l" && e.type === "TABLEAU") ajusterColonnes(e);
                b.hauteur = Math.max(b.hauteur, e.y + e.h);
              }, k)} />
          </Ligne>
        ))}
      </div>
      {!ro && <AlignementPageBoutons editeur={editeur} ids={[el.id]} />}
      <div className="mb-2 grid grid-cols-2 gap-1">
        <Ligne libelle={`Superposition · plan ${rangPlan(d, bande.id, el.id).join(" / ")}`} aide="Ordre d'impression dans la bande (clic droit sur l'objet : mêmes commandes)">
          <div className="flex gap-0.5">
            {PLANS.map((p) => (
              <button key={p.v} type="button" disabled={ro} title={`${p.l} (${p.raccourci})`}
                onClick={() => editeur.modifier((def) => changerPlan(def, bande.id, el.id, p.v), `plan:${el.id}`)}
                className="flex h-8 flex-1 items-center justify-center rounded border border-input text-xs hover:bg-muted disabled:opacity-50">
                {{ PREMIER: "⤒", AVANCER: "↑", RECULER: "↓", ARRIERE: "⤓" }[p.v]}
              </button>
            ))}
          </div>
        </Ligne>
        <Ligne libelle="Verrou (variantes)" aide="FORME : les variantes ne peuvent pas modifier ; TOTAL : ni déplacer ni masquer">
          <Choix value={el.verrou ?? "AUCUN"} disabled={ro} onChange={(v) => maj((e) => poser(e, "verrou", v === "AUCUN" ? null : v), "verrou")}
            options={[{ v: "AUCUN", l: "Aucun" }, { v: "FORME", l: "Forme" }, { v: "TOTAL", l: "Total" }]} />
        </Ligne>
      </div>
      {el.type !== "LIGNE" && el.type !== "CADRE" && (
        <Case libelle="Hauteur extensible (le contenu peut l'agrandir)" value={el.extensible} disabled={ro}
          onChange={(v) => maj((e) => poser(e, "extensible", v || null), "extensible")} />
      )}

      <Titre>Contenu</Titre>
      <ContenuElement el={el} ro={ro} maj={maj} colonne={editeur.selection.colonne ?? null} />

      {(el.type === "TEXTE" || el.type === "CHAMP") && (
        <>
          <Titre>Affichage</Titre>
          <AffichageEditeur a={el.affichage} ro={ro} masques={masques}
            onChange={(a) => maj((e) => poser(e, "affichage", nettoyer(a)), "affichage")} />
        </>
      )}

      <Titre>Condition d'affichage</Titre>
      <FormuleInput value={el.condition?.expression ?? ""} disabled={ro} placeholder="ex. net_a_payer > 0"
        onChange={(v) => maj((e) => poser(e, "condition", v ? { ...(e.condition ?? {}), expression: v } : null), "condition")} />
      {el.condition && (
        <div className="mt-1">
          <Choix value={el.condition.sinon ?? "MASQUER"} disabled={ro}
            onChange={(v) => maj((e) => { e.condition.sinon = v ?? "MASQUER"; }, "sinon")}
            options={[{ v: "MASQUER", l: "Sinon : masquer (la place est libérée)" }, { v: "VIDE", l: "Sinon : laisser vide" }]} />
        </div>
      )}

      {el.type !== "LIGNE" && el.type !== "IMAGE" && el.type !== "CODE_BARRE" && (
        <>
          <Titre>Style</Titre>
          <StyleEditeur s={el.style} ro={ro} cadre={el.type === "CADRE"} onChange={(s) => maj((e) => poser(e, "style", nettoyer(s)), "style")} />
        </>
      )}
      {(el.type === "LIGNE") && (
        <>
          <Titre>Style</Titre>
          <Ligne libelle="Couleur"><ChoixCouleur value={el.style?.couleur} disabled={ro} vide="Noir (défaut)" defaut="#111111"
            onChange={(v) => maj((e) => poser(e, "style", nettoyer({ ...(e.style ?? {}), couleur: v || undefined })), "style")} /></Ligne>
          <div className="grid grid-cols-2 gap-1">
            <Ligne libelle="Épaisseur"><ChoixEpaisseur value={el.style?.epaisseur_bordure} disabled={ro}
              onChange={(v) => maj((e) => poser(e, "style", nettoyer({ ...(e.style ?? {}), epaisseur_bordure: v ?? undefined })), "style")} /></Ligne>
            <Ligne libelle="Trait"><ChoixTrait value={el.style?.style_trait} disabled={ro}
              onChange={(v) => maj((e) => poser(e, "style", nettoyer({ ...(e.style ?? {}), style_trait: v ?? undefined })), "style")} /></Ligne>
          </div>
          <Ligne libelle="Orientation">
            <Choix value={el.l >= el.h ? "H" : "V"} disabled={ro} onChange={(v) => maj((e, b) => {
              if ((v === "V") === (e.l < e.h)) return;
              const l = e.l; e.l = Math.max(0.3, e.h); e.h = l; b.hauteur = Math.max(b.hauteur, e.y + e.h);
            }, "orient")} options={[{ v: "H", l: "Horizontale" }, { v: "V", l: "Verticale" }]} />
          </Ligne>
        </>
      )}
    </div>
  );
}

function ContenuElement({ el, ro, maj, colonne }: { el: Element; ro: boolean; maj: (fn: (e: any, b: Bande) => void, cle: string) => void; colonne: string | null }) {
  const d = useReferentiels().definition!;
  switch (el.type) {
    case "TEXTE":
      return <TexteEditeur el={el} ro={ro} maj={maj} />;
    case "CHAMP":
      return <Ligne libelle="Valeur (formule)"><FormuleInput value={el.valeur} disabled={ro} lignes={2}
        placeholder="identite.nom + &quot; &quot; + identite.prenom" onChange={(v) => maj((e) => { e.valeur = v; }, "valeur")} /></Ligne>;
    case "TEXTE_RICHE":
      return <Ligne libelle="Texte — {formule} insère une valeur" aide="ex. Né le {FORMAT(identite.date_naissance, &quot;DATE_LONGUE&quot;)}">
        <textarea className={`${classeChamp} font-mono`} rows={6} disabled={ro} value={el.contenu} onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => maj((z) => { z.contenu = e.target.value; }, "contenu")} />
      </Ligne>;
    case "IMAGE":
      return <>
        <div className="mb-3"><ChoixImage valeur={el.valeur} ro={ro} onChoisir={(f) => maj((e) => { e.valeur = f; }, "valeur")} /></div>
        <Ligne libelle="Image (formule)" aide='CHARTE("logo"), ASSET("CODE"), ou une formule qui choisit selon le document'><FormuleInput value={el.valeur} disabled={ro} onChange={(v) => maj((e) => { e.valeur = v; }, "valeur")} /></Ligne>
        <Ligne libelle="Ajustement dans le cadre"><Choix value={el.ajustement ?? "CONTENIR"} disabled={ro} onChange={(v) => maj((e) => { e.ajustement = v; }, "ajustement")}
          options={[{ v: "CONTENIR", l: "Contenir (entière, centrée)" }, { v: "REMPLIR", l: "Remplir (bords coupés)" }, { v: "ETIRER", l: "Étirer (déformée)" }]} /></Ligne>
        <RognageImage el={el} ro={ro} maj={maj} />
      </>;
    case "CADRE":
      return <Ligne libelle="Coins"><ChoixArrondi value={el.arrondi} disabled={ro} onChange={(v) => maj((e) => poser(e, "arrondi", v || null), "arrondi")} /></Ligne>;
    case "CODE_BARRE":
      return <>
        <Ligne libelle="Valeur encodée (formule)"><FormuleInput value={el.valeur} disabled={ro} onChange={(v) => maj((e) => { e.valeur = v; }, "valeur")} /></Ligne>
        <Ligne libelle="Symbologie"><Choix value={el.symbologie ?? "QR"} disabled={ro} onChange={(v) => maj((e) => { e.symbologie = v; }, "symbologie")}
          options={[{ v: "QR", l: "QR code" }, { v: "CODE128", l: "Code 128" }]} /></Ligne>
      </>;
    case "TABLEAU":
      return <TableauEditeur t={el} d={d} ro={ro} maj={maj} colonne={colonne} />;
    case "GRILLE":
      return <GrilleEditeur g={el} d={d} ro={ro} maj={maj} colonne={colonne} />;
    case "LIGNE":
      return <p className="text-xs text-muted-foreground">Ligne horizontale ; son épaisseur est sa hauteur.</p>;
  }
}

/** Texte fixe (saisi tel quel, stocké entre guillemets) ou formule. */
function TexteEditeur({ el, ro, maj }: { el: Extract<Element, { type: "TEXTE" }>; ro: boolean; maj: (fn: (e: any, b: Bande) => void, cle: string) => void }) {
  const lit = texteLitteral(el.valeur);
  const [formule, setFormule] = useState(lit === null);
  const versTexte = () => {
    if (lit === null && el.valeur.trim() && !confirm("La formule sera remplacée par un texte fixe. Continuer ?")) return;
    if (lit === null) maj((e) => { e.valeur = enLitteral(""); }, "mode");
    setFormule(false);
  };
  return (
    <>
      <div className="mb-1 flex gap-3 text-[11px]">
        <button type="button" disabled={ro} onClick={versTexte}
          className={!formule ? "font-semibold text-primary" : "text-muted-foreground"}>Texte fixe</button>
        <button type="button" disabled={ro} onClick={() => setFormule(true)}
          className={formule ? "font-semibold text-primary" : "text-muted-foreground"}>Formule</button>
      </div>
      {formule
        ? <FormuleInput value={el.valeur} disabled={ro} lignes={2} onChange={(v) => maj((e) => { e.valeur = v; }, "valeur")} />
        : <textarea className={classeChamp} rows={2} disabled={ro} value={lit ?? ""} onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => maj((z) => { z.valeur = enLitteral(e.target.value); }, "valeur")} />}
    </>
  );
}

function AffichageEditeur({ a, ro, masques, onChange }: { a?: Affichage; ro: boolean; masques: { code: string; libelle: string; exemple: string }[]; onChange: (a: Affichage) => void }) {
  const v = a ?? {};
  const set = (k: keyof Affichage, x: string | null) => { const n = { ...v }; poser(n, k, x); onChange(n); };
  return (
    <>
      <Ligne libelle="Masque">
        <Choix value={v.masque} disabled={ro} vide="— aucun —" onChange={(x) => set("masque", x)}
          options={masques.map((m) => ({ v: m.code, l: `${m.libelle} (${m.exemple})` }))} />
      </Ligne>
      <div className="grid grid-cols-2 gap-1">
        <Ligne libelle="Texte avant"><Texte value={v.texte_avant} disabled={ro} onChange={(x) => set("texte_avant", x)} /></Ligne>
        <Ligne libelle="Texte après"><Texte value={v.texte_apres} disabled={ro} onChange={(x) => set("texte_apres", x)} /></Ligne>
      </div>
      <Ligne libelle="Si vide, afficher" aide="Par défaut : « - »"><Texte value={v.valeur_si_vide} disabled={ro} placeholder="-" onChange={(x) => set("valeur_si_vide", x)} /></Ligne>
    </>
  );
}

function StyleEditeur({ s, ro, cadre, onChange }: { s?: Style; ro: boolean; cadre?: boolean; onChange: (s: Style) => void }) {
  const v = s ?? {};
  const set = (k: keyof Style, x: unknown) => { const n = { ...v }; poser(n, k, x === false ? null : x); onChange(n); };
  return (
    <>
      {!cadre && <>
        <Ligne libelle="Police"><ChoixPolice value={v.police} disabled={ro} onChange={(x) => set("police", x)} /></Ligne>
        <div className="grid grid-cols-2 gap-1">
          <Ligne libelle="Taille (pt)">
            <Liste compact disabled={ro} value={v.taille ? String(v.taille) : ""} vide="9 (défaut)" onChange={(x) => set("taille", x ? Number(x) : null)}
              options={[...new Set([...TAILLES, ...(v.taille ? [v.taille] : [])])].sort((a, b) => a - b).map((t) => ({ v: String(t), l: String(t).replace(".", ",") }))} />
          </Ligne>
          <Ligne libelle="Alignement">
            <Choix value={v.alignement} disabled={ro} vide="Gauche" onChange={(x) => set("alignement", x === "GAUCHE" ? null : x)}
              options={[{ v: "CENTRE", l: "Centré" }, { v: "DROITE", l: "Droite" }]} />
          </Ligne>
        </div>
        <div className="grid grid-cols-2 gap-1">
          <Ligne libelle="Position verticale">
            <Choix value={v.alignement_vertical} disabled={ro} vide="Au milieu" onChange={(x) => set("alignement_vertical", x === "MILIEU" ? null : x)}
              options={[{ v: "HAUT", l: "En haut" }, { v: "BAS", l: "En bas" }]} />
          </Ligne>
          <Ligne libelle="Langue">
            <Choix value={v.langue ?? "AUTO"} disabled={ro} onChange={(x) => set("langue", x === "AUTO" ? null : x)}
              options={[{ v: "AUTO", l: "Automatique" }, { v: "FR", l: "Français" }, { v: "AR", l: "Arabe" }]} />
          </Ligne>
        </div>
        <div className="mb-2">
          <Case libelle="Gras" value={v.gras} disabled={ro} onChange={(x) => set("gras", x)} />
          <Case libelle="Italique" value={v.italique} disabled={ro} onChange={(x) => set("italique", x)} />
          <Case libelle="Souligné" value={v.souligne} disabled={ro} onChange={(x) => set("souligne", x)} />
        </div>
        <Ligne libelle="Casse" aide="Le texte d'origine n'est pas modifié : seul l'affichage change">
          <Liste compact disabled={ro} value={v.casse ?? ""} vide="Telle quelle" onChange={(x) => set("casse", x || null)}
            options={[{ v: "MAJUSCULES", l: "MAJUSCULES" }, { v: "MINUSCULES", l: "minuscules" }, { v: "INITIALES", l: "Initiales En Majuscule" },
              { v: "PETITES_MAJUSCULES", l: <span style={{ fontVariant: "small-caps" }}>Petites majuscules</span> }]} />
        </Ligne>
      </>}
      <div className="grid grid-cols-2 gap-1">
        <Ligne libelle={cadre ? "Couleur du trait" : "Couleur de la police"}>
          <ChoixCouleur value={v.couleur} disabled={ro} vide="Noir (défaut)" defaut="#111111" onChange={(x) => set("couleur", x)} /></Ligne>
        <Ligne libelle="Couleur du fond"><ChoixCouleur value={v.fond} disabled={ro} vide="Sans fond" onChange={(x) => set("fond", x)} /></Ligne>
      </div>
      {cadre
        ? <div className="grid grid-cols-2 gap-1">
            <Ligne libelle="Épaisseur du trait"><ChoixEpaisseur value={v.epaisseur_bordure} disabled={ro} onChange={(x) => set("epaisseur_bordure", x)} /></Ligne>
            <Ligne libelle="Trait"><ChoixTrait value={v.style_trait} disabled={ro} onChange={(x) => set("style_trait", x)} /></Ligne>
          </div>
        : <>
          <Ligne libelle="Bordures"><ChoixBordures value={v.bordures} disabled={ro} onChange={(x) => set("bordures", x)} /></Ligne>
          {v.bordures && <>
            <div className="grid grid-cols-2 gap-1">
              <Ligne libelle="Épaisseur"><ChoixEpaisseur value={v.epaisseur_bordure} disabled={ro} onChange={(x) => set("epaisseur_bordure", x)} /></Ligne>
              <Ligne libelle="Trait"><ChoixTrait value={v.style_trait} disabled={ro} onChange={(x) => set("style_trait", x)} /></Ligne>
            </div>
            <Ligne libelle="Couleur des bordures">
              <ChoixCouleur value={v.couleur_bordure} disabled={ro} vide="Celle de la police" onChange={(x) => set("couleur_bordure", x)} /></Ligne>
          </>}
        </>}
    </>
  );
}

function TableauEditeur({ t, d, ro, maj, colonne }: { t: ElTableau; d: Definition; ro: boolean; maj: (fn: (e: any, b: Bande) => void, cle: string) => void; colonne: string | null }) {
  const { masques } = useReferentiels();
  const [ouverte, setOuverte] = useState<string | null>(colonne);
  useEffect(() => { if (colonne) setOuverte(colonne); }, [colonne]);
  const jeuxSecondaires = d.jeux.filter((j) => j.role === "SECONDAIRE");
  const majCol = (id: string, fn: (c: Colonne) => void, cle: string) =>
    maj((e: ElTableau) => { const c = e.colonnes.find((x) => x.id === id); if (c) fn(c); }, `${cle}:${id}`);
  const majSec = (id: string, fn: (s: Section, e: ElTableau) => void, cle: string) =>
    maj((e: ElTableau) => { const s = (e.sections ?? []).find((x) => x.id === id); if (s) fn(s, e); }, `${cle}:${id}`);
  const somme = t.colonnes.filter((c) => !c.masquee).reduce((s, c) => s + c.largeur, 0);

  const corpsLignes = (d.corps ?? []).filter((c) => c.nature !== "CASES");
  const affiches = t.corps ? [t.corps, ...(t.corps_suivants ?? [])] : [];
  /** Corps affichés, dans l'ordre de la définition ; [] = retour au jeu de lignes (mode expert). */
  const lier = (codes: string[]) => {
    const premierChangement = !t.corps && codes.length;
    if (premierChangement && !confirm("Les colonnes du tableau seront recréées à partir de celles du corps. Continuer ?")) return;
    maj((e: ElTableau, b) => {
      if (!codes.length) { delete e.corps; delete e.corps_suivants; e.jeu = jeuxSecondaires[0]?.code ?? ""; return; }
      e.corps = codes[0]; e.jeu = "";
      if (codes.length > 1) e.corps_suivants = codes.slice(1); else delete e.corps_suivants;
      if (premierChangement) {
        e.colonnes = tableauDepuisCorps(d, codes.map((code) => d.corps!.find((c) => c.code === code)!), e.x, e.y, e.l, e.id).colonnes;
        delete e.sections; delete e.section_autres;
      }
      b.hauteur = Math.max(b.hauteur, e.y + e.h);
    }, "source");
  };
  return (
    <>
      <div className="mb-2">
        <div className="mb-0.5 text-[11px] font-medium text-muted-foreground">Lignes affichées : corps de données (dans l'ordre)</div>
        {corpsLignes.length ? corpsLignes.map((c) => (
          <label key={c.code} className="flex items-center gap-1.5 text-xs">
            <Checkbox disabled={ro} checked={affiches.includes(c.code)}
              onCheckedChange={(coche) => lier(corpsLignes.map((x) => x.code).filter((code) => (code === c.code ? (coche === true) : affiches.includes(code))))} />
            {c.libelle}
          </label>
        )) : <p className="text-[11px] text-muted-foreground">Aucun corps « lignes » : définissez-en à l'étape « 1. Données ».</p>}
        {!affiches.length && corpsLignes.length > 0 && <p className="mt-1 text-[10px] text-[hsl(var(--warning))]">Le tableau affiche encore un jeu de lignes (mode expert) : cochez vos corps pour qu'il imprime ce que vous avez défini.</p>}
      </div>
      {t.corps ? (
        <div className="mb-2 rounded bg-primary/5 p-1.5 text-[11px]">
          Les rubriques, leurs valeurs et leurs groupes viennent des corps : modifiez-les à l'étape « 1. Données ». Ici : largeur, titre, masque, style. Sans groupe, le titre est le libellé du corps.
          <div className="mt-1"><Case libelle="Un titre par groupe (Gains, Retenues…)" value={t.grouper ?? true} disabled={ro}
            onChange={(v) => maj((e) => poser(e, "grouper", v ? null : false), "grp")} />
          {!ro && <button type="button" className="text-primary underline" onClick={() => {
            if (confirm("Recréer les colonnes depuis le corps (largeurs et titres actuels perdus) ?")) {
              maj((e: ElTableau) => { e.colonnes = tableauDepuisCorps(d, affiches.map((code) => d.corps!.find((c) => c.code === code)!).filter(Boolean), e.x, e.y, e.l, e.id).colonnes; }, "regen");
            }
          }}>Recréer les colonnes</button>}</div>
        </div>
      ) : (
        <Ligne libelle="Jeu de lignes">
          <Choix value={t.jeu} disabled={ro} onChange={(v) => maj((e) => { e.jeu = v; }, "jeu")}
            options={(jeuxSecondaires.length ? jeuxSecondaires : d.jeux).map((j) => ({ v: j.code, l: `${j.code} — ${j.source}` }))} />
        </Ligne>
      )}
      <div className="grid grid-cols-3 gap-1">
        <Ligne libelle="Haut. ligne (mm)"><Nombre value={t.hauteur_ligne ?? 5} disabled={ro} min={1} onChange={(v) => maj((e) => { e.hauteur_ligne = v ?? 5; }, "hl")} /></Ligne>
        <Ligne libelle="Lignes min." aide="Complète par des lignes vides, comme un bulletin pré-imprimé">
          <Nombre value={t.lignes_min ?? 0} pas={1} min={0} disabled={ro} onChange={(v) => maj((e) => poser(e, "lignes_min", v || null), "lmin")} />
        </Ligne>
        <Ligne libelle="Quadrillage">
          <Choix value={t.quadrillage ?? "AUCUN"} disabled={ro} onChange={(v) => maj((e) => poser(e, "quadrillage", v === "AUCUN" ? null : v), "quad")}
            options={[{ v: "AUCUN", l: "Aucun" }, { v: "COLONNES", l: "Colonnes" }, { v: "COMPLET", l: "Complet" }]} />
        </Ligne>
      </div>
      <div className="mb-2">
        <Case libelle="Ligne d'en-tête des colonnes" value={t.entete ?? true} disabled={ro} onChange={(v) => maj((e) => poser(e, "entete", v ? null : false), "ent")} />
        <Case libelle="Ligne des totaux" value={t.ligne_total ?? true} disabled={ro} onChange={(v) => maj((e) => poser(e, "ligne_total", v ? null : false), "ltot")} />
        {(t.entete ?? true) && <BlocStyle titre="Style de la ligne d'en-tête" s={t.style_entete} ro={ro}
          onChange={(s) => maj((e) => poser(e, "style_entete", nettoyer(s)), "se")} />}
        <Case libelle="Zébré" value={t.zebre} disabled={ro} onChange={(v) => maj((e) => poser(e, "zebre", v || null), "zebre")} />
        <Case libelle="En-tête répété" value={t.repeter_entete ?? true} disabled={ro} onChange={(v) => maj((e) => poser(e, "repeter_entete", v ? null : false), "rep")} />
      </div>

      {/* ── colonnes ── */}
      <div className="mb-1 mt-3 flex items-center text-[11px] font-semibold uppercase text-muted-foreground">
        Colonnes <span className={`ml-2 font-normal normal-case ${Math.abs(somme - t.l) > 0.05 ? "text-destructive" : ""}`}>{somme.toFixed(1)} / {t.l} mm</span>
        {!ro && Math.abs(somme - t.l) > 0.05 && (
          <button type="button" className="ml-auto font-normal normal-case text-primary underline" onClick={() => maj((e) => ajusterColonnes(e), "ajuster")}>Ajuster</button>
        )}
      </div>
      <p className="mb-1 text-[10px] text-muted-foreground">Cliquez une colonne (ici ou sur la page) pour la modifier.</p>
      {t.colonnes.map((c, i) => (
        <div key={c.id} className={`mb-1 rounded border ${c.masquee ? "opacity-60" : ""} ${ouverte === c.id ? "border-primary" : ""}`}>
          <div className="flex items-center gap-1 px-1.5 py-1 text-xs">
            <button type="button" className="flex-1 truncate text-left font-medium" onClick={() => setOuverte(ouverte === c.id ? null : c.id)}>
              {c.titre || c.id} <span className="font-normal text-muted-foreground">· {c.largeur} mm · <span className="font-mono">{c.valeur}</span></span>
            </button>
            {!ro && <>
              <button type="button" title="Monter" onClick={() => maj((e: ElTableau) => { if (i > 0) [e.colonnes[i - 1], e.colonnes[i]] = [e.colonnes[i], e.colonnes[i - 1]]; }, "ordre")}><ArrowUp className="h-3 w-3" /></button>
              <button type="button" title="Descendre" onClick={() => maj((e: ElTableau) => { if (i < e.colonnes.length - 1) [e.colonnes[i + 1], e.colonnes[i]] = [e.colonnes[i], e.colonnes[i + 1]]; }, "ordre")}><ArrowDown className="h-3 w-3" /></button>
              <button type="button" title="Supprimer" disabled={t.colonnes.length === 1}
                onClick={() => maj((e: ElTableau) => { e.colonnes = e.colonnes.filter((x) => x.id !== c.id); }, "suppr")}><Trash2 className="h-3 w-3 text-destructive" /></button>
            </>}
          </div>
          {ouverte === c.id && (
            <div className="border-t p-1.5">
              <div className="grid grid-cols-3 gap-1">
                <div className="col-span-2"><Ligne libelle="Titre"><Texte value={c.titre} disabled={ro} onChange={(v) => majCol(c.id, (x) => { x.titre = v; }, "titre")} /></Ligne></div>
                <Ligne libelle="Largeur"><Nombre value={c.largeur} disabled={ro} min={1} onChange={(v) => majCol(c.id, (x) => { x.largeur = Math.max(1, v ?? 1); }, "larg")} /></Ligne>
              </div>
              <Ligne libelle="Valeur de chaque ligne (formule)" aide="Champs de la ligne : code_rubrique, libelle, base, nombre, taux, montant, montant_patronal, sens…">
                <FormuleInput value={c.valeur} jeu={t.corps ? `corps:${affiches.join(",")}` : t.jeu} disabled={ro} onChange={(v) => majCol(c.id, (x) => { x.valeur = v; }, "val")} />
              </Ligne>
              <div className="grid grid-cols-2 gap-1">
                <Ligne libelle="Masque">
                  <Choix value={c.affichage?.masque} disabled={ro} vide="— aucun —"
                    onChange={(v) => majCol(c.id, (x) => { const a = { ...(x.affichage ?? {}) }; poser(a, "masque", v); poser(x, "affichage", nettoyer(a)); }, "masque")}
                    options={masques.map((m) => ({ v: m.code, l: m.libelle }))} />
                </Ligne>
                <Ligne libelle="Total en bas">
                  <Choix value={c.total ?? "AUCUN"} disabled={ro} onChange={(v) => majCol(c.id, (x) => poser(x, "total", v === "AUCUN" ? null : v), "total")}
                    options={[{ v: "AUCUN", l: "Aucun" }, { v: "SOMME", l: "Somme" }, { v: "NB", l: "Nombre" }, { v: "MOYENNE", l: "Moyenne" }]} />
                </Ligne>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <Ligne libelle="Alignement">
                  <Choix value={c.style?.alignement} disabled={ro} vide="Auto"
                    onChange={(v) => majCol(c.id, (x) => { const s = { ...(x.style ?? {}) }; poser(s, "alignement", v); poser(x, "style", nettoyer(s)); }, "al")}
                    options={[{ v: "GAUCHE", l: "Gauche" }, { v: "CENTRE", l: "Centré" }, { v: "DROITE", l: "Droite" }]} />
                </Ligne>
                <Ligne libelle="Taille (pt)">
                  <Nombre value={c.style?.taille} pas={0.5} min={1} disabled={ro}
                    onChange={(v) => majCol(c.id, (x) => { const s = { ...(x.style ?? {}) }; poser(s, "taille", v); poser(x, "style", nettoyer(s)); }, "ta")} />
                </Ligne>
              </div>
              <Ligne libelle="Police">
                <ChoixPolice value={c.style?.police} disabled={ro} vide="Celle du tableau"
                  onChange={(v) => majCol(c.id, (x) => { const s = { ...(x.style ?? {}) }; poser(s, "police", v); poser(x, "style", nettoyer(s)); }, "po")} />
              </Ligne>
              <Case libelle="Masquée" value={c.masquee} disabled={ro} onChange={(v) => majCol(c.id, (x) => poser(x, "masquee", v || null), "masq")} />
            </div>
          )}
        </div>
      ))}
      {!ro && (
        <button type="button" className="mb-3 flex items-center gap-1 text-xs text-primary"
          onClick={() => maj((e: ElTableau) => {
            const col = { id: nouvelId(d, "col"), titre: "Colonne", largeur: 20, valeur: "" };
            e.colonnes.push(col);
            ajusterColonnes(e);
            setOuverte(col.id);
          }, "ajout")}>
          <Plus className="h-3 w-3" /> Colonne
        </button>
      )}

      {/* ── lignes affichées : groupes (mode expert, tableau sur un jeu) ── */}
      {!t.corps && <>
      <div className="mb-1 mt-3 text-[11px] font-semibold uppercase text-muted-foreground">Lignes affichées</div>
      <p className="mb-2 text-[10px] text-muted-foreground">
        Sans groupe, toutes les lignes du jeu s'impriment. Un groupe liste <b>ses rubriques, dans l'ordre voulu</b> (ou retient les
        lignes d'un filtre), sous un titre.
      </p>
      {(t.sections ?? []).map((s, i) => {
        // plan de rubriques : une liste remplie, ou un groupe sans filtre utile (« FAUX » posé à la création)
        const plan = (s.rubriques?.length ?? 0) > 0 || !s.filtre?.trim() || s.filtre.trim().toUpperCase() === "FAUX";
        return (
          <div key={s.id} className="mb-2 rounded border p-1.5">
            <div className="mb-1 flex items-center gap-1">
              <div className="flex-1"><Texte value={s.titre} disabled={ro} placeholder="Titre du groupe (facultatif)"
                onChange={(v) => majSec(s.id, (x) => poser(x, "titre", v), "st")} /></div>
              {!ro && <>
                <button type="button" title="Monter" onClick={() => maj((e: ElTableau) => { const z = e.sections!; if (i > 0) [z[i - 1], z[i]] = [z[i], z[i - 1]]; }, "sordre")}><ArrowUp className="h-3 w-3" /></button>
                <button type="button" title="Descendre" onClick={() => maj((e: ElTableau) => { const z = e.sections!; if (i < z.length - 1) [z[i + 1], z[i]] = [z[i], z[i + 1]]; }, "sordre")}><ArrowDown className="h-3 w-3" /></button>
                <button type="button" title="Supprimer le groupe" onClick={() => maj((e: ElTableau) => { e.sections = e.sections!.filter((z) => z.id !== s.id); if (!e.sections.length) { delete e.sections; delete e.section_autres; } }, "ssuppr")}>
                  <Trash2 className="h-3 w-3 text-destructive" /></button>
              </>}
            </div>
            <div className="mb-1 flex gap-3 text-[11px]">
              <button type="button" disabled={ro} className={plan ? "font-semibold text-primary" : "text-muted-foreground"}
                onClick={() => !plan && majSec(s.id, (x) => { x.rubriques = []; x.filtre = "FAUX"; }, "mode")}>Rubriques choisies</button>
              <button type="button" disabled={ro} className={!plan ? "font-semibold text-primary" : "text-muted-foreground"}
                onClick={() => plan && (!(s.rubriques ?? []).length || confirm("La liste des rubriques de ce groupe sera vidée. Continuer ?"))
                  && majSec(s.id, (x) => { delete x.rubriques; x.filtre = 'sens = "GAIN"'; }, "mode")}>Filtre</button>
              <span className="ml-auto"><Case libelle="Sous-total" value={s.sous_total} disabled={ro} onChange={(v) => majSec(s.id, (x) => poser(x, "sous_total", v || null), "sst")} /></span>
            </div>
            {plan
              ? <PlanRubriques s={s} colonnes={t.colonnes.filter((c) => !c.masquee)} jeu={t.jeu} ro={ro} maj={(fn, cle) => majSec(s.id, fn, cle)} />
              : <FormuleInput value={s.filtre ?? ""} jeu={t.jeu} disabled={ro} placeholder='sens = "GAIN"'
                  onChange={(v) => majSec(s.id, (x) => poser(x, "filtre", v), "sf")} />}
          </div>
        );
      })}
      {!ro && (
        <button type="button" className="mb-2 flex items-center gap-1 text-xs text-primary"
          onClick={() => maj((e: ElTableau) => { e.sections = [...(e.sections ?? []), { id: nouvelId(d, "groupe"), titre: "Nouveau groupe", rubriques: [], filtre: "FAUX" }]; }, "sajout")}>
          <Plus className="h-3 w-3" /> Groupe de lignes
        </button>
      )}
      {!!t.sections?.length && (
        <div className="rounded bg-muted/40 p-1.5">
          <Case libelle="Imprimer aussi les lignes hors groupes" value={t.section_autres != null} disabled={ro}
            onChange={(v) => maj((e) => poser(e, "section_autres", v ? "Autres" : null), "autres")} />
          {t.section_autres != null && (
            <div className="mt-1"><Texte value={t.section_autres} disabled={ro} placeholder="sans titre"
              onChange={(v) => maj((e) => { e.section_autres = v; }, "autrest")} /></div>
          )}
        </div>
      )}
      </>}
    </>
  );
}

/** Plan explicite d'un groupe : les rubriques imprimées, leur ordre, leur libellé et leurs valeurs (RG-EDT-LIGNES-01). */
function PlanRubriques({ s, colonnes, jeu, ro, maj }: {
  s: Section; colonnes: Colonne[]; jeu: string; ro: boolean; maj: (fn: (s: Section) => void, cle: string) => void;
}) {
  const { rubriques } = useReferentiels();
  const [detail, setDetail] = useState<number | null>(null);
  const liste = s.rubriques ?? [];
  const nomRub = (code: string) => rubriques.find((r) => r.code === code)?.libelle ?? RUBRIQUES_EN_TETE.find((r) => r.code === code)?.libelle ?? code;
  const majL = (k: number, fn: (l: LigneRubrique) => void, cle: string) => maj((x) => fn(x.rubriques![k]), `${cle}${k}`);

  return (
    <div>
      {liste.map((lr, k) => (
        <div key={`${lr.code}${k}`} className="mb-0.5 rounded bg-muted/30">
          <div className="flex items-center gap-1 px-1 py-0.5">
            <span className="w-24 shrink-0 truncate font-mono text-[10px]" title={nomRub(lr.code)}>{lr.code}</span>
            <input className={`${classeChamp} py-0.5 ${lr.style?.gras ? "font-bold" : ""}`} disabled={ro} value={lr.libelle ?? ""} placeholder={nomRub(lr.code)}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => majL(k, (l) => poser(l, "libelle", e.target.value), "lib")} />
            <button type="button" disabled={ro} title="Gras" onClick={() => majL(k, (l) => poser(l, "style", l.style?.gras ? null : { ...(l.style ?? {}), gras: true }), "g")}
              className={`rounded px-1 text-[11px] font-bold ${lr.style?.gras ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>G</button>
            <button type="button" disabled={ro} title="Toujours imprimée (même absente ou à zéro)" onClick={() => majL(k, (l) => poser(l, "toujours", l.toujours ? null : true), "t")}
              className={`rounded px-1 text-[11px] ${lr.toujours ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>∞</button>
            <button type="button" title="Valeurs particulières par colonne" onClick={() => setDetail(detail === k ? null : k)}
              className={`rounded px-1 text-[11px] ${lr.valeurs && Object.keys(lr.valeurs).length ? "text-primary" : "text-muted-foreground"}`}>ƒ</button>
            {!ro && <>
              <button type="button" title="Monter" onClick={() => maj((x) => { const z = x.rubriques!; if (k > 0) [z[k - 1], z[k]] = [z[k], z[k - 1]]; }, "o")}><ArrowUp className="h-3 w-3" /></button>
              <button type="button" title="Descendre" onClick={() => maj((x) => { const z = x.rubriques!; if (k < z.length - 1) [z[k + 1], z[k]] = [z[k], z[k + 1]]; }, "o")}><ArrowDown className="h-3 w-3" /></button>
              <button type="button" title="Retirer" onClick={() => maj((x) => { x.rubriques!.splice(k, 1); }, "r")}><Trash2 className="h-3 w-3 text-destructive" /></button>
            </>}
          </div>
          {detail === k && (
            <div className="border-t px-1.5 py-1">
              <p className="mb-1 text-[10px] text-muted-foreground">
                Laisser vide : la formule de la colonne s'applique. Ex. pour un total en colonne Base : <span className="font-mono">montant</span> ; pour masquer : <span className="font-mono">VIDE</span>.
              </p>
              {colonnes.map((c) => (
                <Ligne key={c.id} libelle={c.titre || c.id}>
                  <FormuleInput value={lr.valeurs?.[c.id] ?? ""} jeu={jeu} disabled={ro} placeholder={c.valeur}
                    onChange={(v) => majL(k, (l) => { const vals = { ...(l.valeurs ?? {}) }; poser(vals, c.id, v); poser(l, "valeurs", Object.keys(vals).length ? vals : null); }, `v${c.id}`)} />
                </Ligne>
              ))}
            </div>
          )}
        </div>
      ))}
      {!liste.length && <p className="mb-1 text-[11px] text-muted-foreground">Aucune rubrique : ajoutez celles à imprimer dans ce groupe.</p>}
      {!ro && <ChoixRubrique exclues={new Set(liste.map((l) => l.code))} onChoisir={(code) => maj((x) => { x.rubriques = [...(x.rubriques ?? []), { code }]; }, "add")} />}
    </div>
  );
}

/** Recherche d'une rubrique de paie (ou d'un total du bulletin) à ajouter. */
function ChoixRubrique({ exclues, onChoisir }: { exclues: Set<string>; onChoisir: (code: string) => void }) {
  const { rubriques } = useReferentiels();
  const [q, setQ] = useState("");
  const [ouvert, setOuvert] = useState(false);
  const toutes = useMemo(() => [...rubriques.map((r) => ({ ...r, total: false })), ...RUBRIQUES_EN_TETE.map((r) => ({ ...r, total: true }))], [rubriques]);
  const bas = q.trim().toLowerCase();
  const proposees = toutes.filter((r) => !exclues.has(r.code) && (!bas || r.code.toLowerCase().includes(bas) || r.libelle.toLowerCase().includes(bas))).slice(0, 40);
  return (
    <div className="relative mt-1">
      <input className={`${classeChamp} py-0.5`} value={q} placeholder="+ Ajouter une rubrique (code ou libellé)…"
        onFocus={() => setOuvert(true)} onBlur={() => setTimeout(() => setOuvert(false), 150)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && proposees[0]) { onChoisir(proposees[0].code); setQ(""); } }}
        onChange={(e) => { setQ(e.target.value); setOuvert(true); }} />
      {ouvert && proposees.length > 0 && (
        <div className="absolute left-0 right-0 z-50 mt-1 max-h-56 overflow-auto rounded-md border bg-popover shadow-lg">
          {proposees.map((r) => (
            <button key={r.code} type="button" onMouseDown={(e) => { e.preventDefault(); onChoisir(r.code); setQ(""); }}
              className="flex w-full items-baseline gap-2 px-2 py-1 text-left text-xs hover:bg-muted">
              <span className="font-mono">{r.code}</span>
              <span className="truncate text-muted-foreground">{r.libelle}</span>
              {r.total && <span className="ml-auto text-[10px] uppercase text-muted-foreground">total</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Grille : lignes × colonnes, une formule par case (RG-EDT-GRILLE-01). */
function GrilleEditeur({ g, d, ro, maj, colonne }: { g: ElGrille; d: Definition; ro: boolean; maj: (fn: (e: any, b: Bande) => void, cle: string) => void; colonne: string | null }) {
  const { masques } = useReferentiels();
  const [ligneOuverte, setLigneOuverte] = useState<string | null>(g.lignes[0]?.id ?? null);
  const somme = (g.largeur_titres ?? 0) + g.colonnes.reduce((s, c) => s + c.largeur, 0);
  const ajuster = (e: ElGrille) => {
    const dispo = e.l - (e.largeur_titres ?? 0);
    const total = e.colonnes.reduce((s, c) => s + c.largeur, 0);
    if (total > 0 && dispo > 0) e.colonnes.forEach((c) => { c.largeur = Math.round(c.largeur * dispo / total * 10) / 10; });
  };
  const deplacer = <T,>(z: T[], i: number, sens: number) => { const j = i + sens; if (j >= 0 && j < z.length) [z[i], z[j]] = [z[j], z[i]]; };
  return (
    <>
      <Ligne libelle="Lier à un corps « cases »" aide="Recrée lignes et colonnes depuis le corps ; chaque case lit corps.<corps>.<ligne>.<colonne>">
        <Choix value="" disabled={ro} vide="— choisir pour (re)générer —"
          options={(d.corps ?? []).filter((c) => c.nature === "CASES").map((c) => ({ v: c.code, l: c.libelle }))}
          onChange={(code) => code && confirm("Lignes, colonnes et formules de la grille seront recréées depuis le corps. Continuer ?") && maj((e: ElGrille, b) => {
            const n = grilleDepuisCorps(d, d.corps!.find((c) => c.code === code)!, e.x, e.y, e.l, e.id);
            e.colonnes = n.colonnes; e.lignes = n.lignes; e.largeur_titres = n.largeur_titres; e.h = Math.max(e.h, n.h);
            b.hauteur = Math.max(b.hauteur, e.y + e.h);
          }, "lier")} />
      </Ligne>
      <p className="mb-2 text-[10px] text-muted-foreground">
        Chaque case est une formule : <span className="font-mono">corps.cumuls.mois.brut</span>, <span className="font-mono">cumul.total_brut</span>, <span className="font-mono">[SALBASE].CMT</span> (cumul annuel), <span className="font-mono">[CONGE_PRIS].NB</span>…
      </p>
      <div className="grid grid-cols-3 gap-1">
        <Ligne libelle="Titres de ligne (mm)" aide="0 : pas de colonne de titres"><Nombre value={g.largeur_titres ?? 0} min={0} disabled={ro} onChange={(v) => maj((e) => poser(e, "largeur_titres", v || null), "lt")} /></Ligne>
        <Ligne libelle="Haut. ligne (mm)"><Nombre value={g.hauteur_ligne ?? 5} min={1} disabled={ro} onChange={(v) => maj((e) => { e.hauteur_ligne = v ?? 5; e.h = Math.max(e.h, (e.hauteur_ligne) * (e.lignes.length + ((e.entete ?? true) ? 1 : 0))); }, "hl")} /></Ligne>
        <Ligne libelle="Quadrillage">
          <Choix value={g.quadrillage ?? "COMPLET"} disabled={ro} onChange={(v) => maj((e) => poser(e, "quadrillage", v === "COMPLET" ? null : v), "q")}
            options={[{ v: "COMPLET", l: "Complet" }, { v: "COLONNES", l: "Colonnes" }, { v: "AUCUN", l: "Aucun" }]} />
        </Ligne>
      </div>
      <Case libelle="Ligne d'en-tête (titres des colonnes)" value={g.entete ?? true} disabled={ro} onChange={(v) => maj((e) => poser(e, "entete", v ? null : false), "ent")} />
      <Case libelle="Retour à la ligne des intitulés trop longs" value={g.retour_ligne ?? true} disabled={ro}
        onChange={(v) => maj((e) => poser(e, "retour_ligne", v ? null : false), "rl")} />
      <BlocStyle titre="Style des titres de colonnes" s={g.style_entete} ro={ro}
        onChange={(s) => maj((e) => poser(e, "style_entete", nettoyer(s)), "se")} />
      {!!g.largeur_titres && <BlocStyle titre="Style des titres de lignes" s={g.style_titres} ro={ro}
        onChange={(s) => maj((e) => poser(e, "style_titres", nettoyer(s)), "st")} />}

      <div className="mb-1 mt-3 flex items-center text-[11px] font-semibold uppercase text-muted-foreground">
        Colonnes <span className={`ml-2 font-normal normal-case ${somme > g.l + 0.05 ? "text-destructive" : ""}`}>{somme.toFixed(1)} / {g.l} mm</span>
        {!ro && Math.abs(somme - g.l) > 0.05 && <button type="button" className="ml-auto font-normal normal-case text-primary underline" onClick={() => maj((e) => ajuster(e), "aj")}>Ajuster</button>}
      </div>
      {g.colonnes.map((c, i) => (
        <div key={c.id} className={`mb-1 grid grid-cols-[1fr_52px_86px_auto] items-center gap-1 rounded border p-1 ${colonne === c.id ? "border-primary" : ""}`}>
          <input className={`${classeChamp} py-0.5`} disabled={ro} value={c.titre ?? ""} placeholder="Titre" onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => maj((x: ElGrille) => { x.colonnes[i].titre = e.target.value; }, `ct${c.id}`)} />
          <Nombre value={c.largeur} min={1} disabled={ro} onChange={(v) => maj((x: ElGrille) => { x.colonnes[i].largeur = Math.max(1, v ?? 1); }, `cl${c.id}`)} />
          <Choix value={c.affichage?.masque} disabled={ro} vide="Masque…"
            onChange={(v) => maj((x: ElGrille) => { const a = { ...(x.colonnes[i].affichage ?? {}) }; poser(a, "masque", v); poser(x.colonnes[i], "affichage", nettoyer(a)); }, `cm${c.id}`)}
            options={masques.map((m) => ({ v: m.code, l: m.libelle }))} />
          {!ro && <span className="flex gap-0.5">
            <button type="button" onClick={() => maj((x: ElGrille) => deplacer(x.colonnes, i, -1), "co")}><ArrowUp className="h-3 w-3" /></button>
            <button type="button" onClick={() => maj((x: ElGrille) => deplacer(x.colonnes, i, 1), "co")}><ArrowDown className="h-3 w-3" /></button>
            <button type="button" disabled={g.colonnes.length === 1} onClick={() => maj((x: ElGrille) => {
              x.colonnes.splice(i, 1); x.lignes.forEach((l) => { if (l.valeurs) delete l.valeurs[c.id]; });
            }, "cs")}><Trash2 className="h-3 w-3 text-destructive" /></button>
          </span>}
        </div>
      ))}
      {!ro && <button type="button" className="mb-3 flex items-center gap-1 text-xs text-primary"
        onClick={() => maj((x: ElGrille) => { x.colonnes.push({ id: nouvelId(d, `${g.id}_c`), titre: "Colonne", largeur: 25, affichage: { masque: "MONTANT" } }); ajuster(x); }, "ca")}>
        <Plus className="h-3 w-3" /> Colonne</button>}

      <div className="mb-1 mt-3 text-[11px] font-semibold uppercase text-muted-foreground">Lignes et formules</div>
      {g.lignes.map((l, k) => (
        <div key={l.id} className={`mb-1 rounded border ${ligneOuverte === l.id ? "border-primary/60" : ""}`}>
          <div className="flex items-center gap-1 p-1">
            <input className={`${classeChamp} py-0.5 ${l.style?.gras ? "font-bold" : ""}`} disabled={ro} value={l.titre ?? ""} placeholder="Titre de la ligne"
              onKeyDown={(e) => e.stopPropagation()} onChange={(e) => maj((x: ElGrille) => { x.lignes[k].titre = e.target.value; }, `lt${l.id}`)} />
            <button type="button" className="text-[11px] text-primary" onClick={() => setLigneOuverte(ligneOuverte === l.id ? null : l.id)}>
              {ligneOuverte === l.id ? "Fermer" : "Formules"}</button>
            {!ro && <>
              <button type="button" onClick={() => maj((x: ElGrille) => deplacer(x.lignes, k, -1), "lo")}><ArrowUp className="h-3 w-3" /></button>
              <button type="button" onClick={() => maj((x: ElGrille) => deplacer(x.lignes, k, 1), "lo")}><ArrowDown className="h-3 w-3" /></button>
              <button type="button" disabled={g.lignes.length === 1} onClick={() => maj((x: ElGrille) => { x.lignes.splice(k, 1); }, "ls")}><Trash2 className="h-3 w-3 text-destructive" /></button>
            </>}
          </div>
          {ligneOuverte === l.id && (
            <div className="border-t p-1.5">
              {g.colonnes.map((c) => (
                <Ligne key={c.id} libelle={c.titre || c.id}>
                  <FormuleInput value={l.valeurs?.[c.id] ?? ""} disabled={ro} placeholder="vide"
                    onChange={(v) => maj((x: ElGrille) => {
                      const lg = x.lignes[k]; const vals = { ...(lg.valeurs ?? {}) }; poser(vals, c.id, v);
                      poser(lg, "valeurs", Object.keys(vals).length ? vals : null);
                    }, `lv${l.id}${c.id}`)} />
                </Ligne>
              ))}
            </div>
          )}
        </div>
      ))}
      {!ro && <button type="button" className="flex items-center gap-1 text-xs text-primary"
        onClick={() => maj((x: ElGrille) => {
          const id = nouvelId(d, `${g.id}_l`);
          x.lignes.push({ id, titre: "Ligne" });
          x.h = Math.max(x.h, (x.hauteur_ligne ?? 5) * (x.lignes.length + ((x.entete ?? true) ? 1 : 0)));
          setLigneOuverte(id);
        }, "la")}>
        <Plus className="h-3 w-3" /> Ligne</button>}
    </>
  );
}

// ── bande ───────────────────────────────────────────────────────────────────
function InspecteurBande({ editeur, bande, ro }: { editeur: Editeur; bande: Bande; ro: boolean }) {
  const maj = (fn: (b: Bande) => void, cle: string) => editeur.modifierBande(bande.id, fn, `${cle}:${bande.id}`);
  const supprimer = () => {
    if (bande.elements.length && !confirm(`Supprimer la bande et ses ${bande.elements.length} élément(s) ?`)) return;
    editeur.modifier((d) => { d.bandes = d.bandes.filter((b) => b.id !== bande.id); });
    editeur.setSelection({ bande: null, element: null });
  };
  const groupe = bande.type === "EN_TETE_GROUPE" || bande.type === "PIED_GROUPE";
  return (
    <div className="p-3">
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase">Bande</span>
        <span className="text-xs">{LIBELLES_BANDE[bande.type]}</span>
        {!ro && <button type="button" title="Supprimer la bande" onClick={supprimer} className="ml-auto rounded p-1 text-destructive hover:bg-destructive/10"><Trash2 className="h-3.5 w-3.5" /></button>}
      </div>
      <Ligne libelle="Identifiant"><Texte value={bande.id} disabled onChange={() => {}} /></Ligne>
      <div className="grid grid-cols-2 gap-1">
        <Ligne libelle="Hauteur (mm)"><Nombre value={bande.hauteur} min={0} disabled={ro}
          onChange={(v) => maj((b) => { b.hauteur = Math.max(v ?? 0, ...b.elements.map((e) => e.y + e.h), 0); }, "h")} /></Ligne>
        {groupe && <Ligne libelle="Niveau de groupe"><Nombre value={bande.niveau_groupe ?? 1} pas={1} min={1} disabled={ro} onChange={(v) => maj((b) => { b.niveau_groupe = Math.max(1, v ?? 1); }, "niv")} /></Ligne>}
      </div>
      <div className="mb-2 space-y-1">
        <Case libelle="Extensible" value={bande.extensible} disabled={ro} onChange={(v) => maj((b) => poser(b, "extensible", v || null), "ext")} />
        <Case libelle="Insécable" value={bande.insecable} disabled={ro} onChange={(v) => maj((b) => poser(b, "insecable", v || null), "ins")} />
        <br />
        <Case libelle="Saut de page avant" value={bande.saut_avant} disabled={ro} onChange={(v) => maj((b) => poser(b, "saut_avant", v || null), "sav")} />
        <Case libelle="Saut de page après" value={bande.saut_apres} disabled={ro} onChange={(v) => maj((b) => poser(b, "saut_apres", v || null), "sap")} />
      </div>
      <Ligne libelle="Condition d'impression">
        <FormuleInput value={bande.condition ?? ""} disabled={ro} placeholder="toujours imprimée"
          onChange={(v) => maj((b) => poser(b, "condition", v), "cond")} />
      </Ligne>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Le corps est imprimé une fois par ligne du jeu principal (ou une fois par document si la sortie est éclatée).
      </p>
    </div>
  );
}

// ── modèle : page, paramètres, données, sortie ──────────────────────────────
function InspecteurModele({ editeur, ro }: { editeur: Editeur; ro: boolean }) {
  const d = editeur.definition!;
  const { sources } = useReferentiels();
  const [onglet, setOnglet] = useState<"page" | "parametres" | "donnees" | "sortie">("page");
  const m = (fn: (d: Definition) => void, cle: string) => editeur.modifier(fn, cle);
  const page = d.page ?? {};
  const marges = page.marges ?? [15, 15, 15, 15];

  return (
    <div className="p-3">
      <div className="mb-3 flex flex-wrap gap-1 text-[11px]">
        {([["page", "Page"], ["parametres", "Paramètres"], ["donnees", "Données"], ["sortie", "Sortie"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setOnglet(k)}
            className={`rounded px-2 py-1 ${onglet === k ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{l}</button>
        ))}
      </div>

      {onglet === "page" && <ReglagesPage editeur={editeur} ro={ro} />}

      {onglet === "parametres" && <ParametresEditeur d={d} ro={ro} m={m} />}
      {onglet === "donnees" && <JeuxEditeur d={d} ro={ro} m={m} sources={sources} />}

      {onglet === "sortie" && <>
        <Ligne libelle="Nom du fichier (formule, sans .pdf)">
          <FormuleInput value={d.sortie?.nom_fichier ?? '"edition"'} disabled={ro}
            onChange={(v) => m((x) => { x.sortie = { ...(x.sortie ?? {}), nom_fichier: v || '"edition"' }; }, "nf")} />
        </Ligne>
        <Ligne libelle="Un document par…" aide="Éclatement : un PDF par valeur de ce champ (ex. collaborateur_id pour les bulletins)">
          <Texte value={d.sortie?.eclatement ?? ""} disabled={ro} placeholder="un seul document"
            onChange={(v) => m((x) => { const s = { ...(x.sortie ?? {}) }; poser(s, "eclatement", v); x.sortie = s; }, "ecl")} />
        </Ligne>
        <Case libelle="QR code de vérification" value={d.sortie?.qr_verification} disabled={ro}
          onChange={(v) => m((x) => { x.sortie = { ...(x.sortie ?? {}), qr_verification: v }; }, "qr")} />
      </>}
    </div>
  );
}

const TYPES_PARAMETRE = Object.entries(LIBELLES_PARAMETRE).map(([v, l]) => ({ v: v as TypeParametre, l }));

export function ParametresEditeur({ d, ro, m }: { d: Definition; ro: boolean; m: (fn: (d: Definition) => void, cle: string) => void }) {
  const majP = (i: number, fn: (p: Parametre) => void, cle: string) => m((x) => fn(x.parametres[i]), `p${i}:${cle}`);
  return (
    <>
      <p className="mb-2 text-[11px] text-muted-foreground">Demandés au lancement ; utilisés dans les formules sous la forme @code.</p>
      {d.parametres.map((p, i) => (
        <div key={i} className="mb-2 rounded border p-2">
          <div className="grid grid-cols-2 gap-1">
            <Ligne libelle="Code"><Texte value={p.code} disabled={ro} onChange={(v) => majP(i, (x) => { x.code = v.toLowerCase().replace(/[^a-z0-9_]/g, ""); }, "c")} /></Ligne>
            <Ligne libelle="Type"><Choix value={p.type} disabled={ro} options={TYPES_PARAMETRE} onChange={(v) => majP(i, (x) => { x.type = v ?? "TEXTE"; }, "t")} /></Ligne>
          </div>
          <Ligne libelle="Libellé"><Texte value={p.libelle} disabled={ro} onChange={(v) => majP(i, (x) => { x.libelle = v; }, "l")} /></Ligne>
          {p.type === "LISTE" && (
            <Ligne libelle="Valeurs (séparées par ;)"><Texte value={(p.valeurs ?? []).join(";")} disabled={ro}
              onChange={(v) => majP(i, (x) => poser(x, "valeurs", v ? v.split(";").map((s) => s.trim()).filter(Boolean) : null), "v")} /></Ligne>
          )}
          <Ligne libelle="Valeur par défaut (formule)"><FormuleInput value={p.defaut ?? ""} disabled={ro} verifier={false}
            onChange={(v) => majP(i, (x) => poser(x, "defaut", v), "d")} /></Ligne>
          <div className="flex items-center">
            <Case libelle="Obligatoire" value={p.obligatoire ?? true} disabled={ro} onChange={(v) => majP(i, (x) => poser(x, "obligatoire", v ? null : false), "o")} />
            <Case libelle="Plusieurs valeurs" value={p.multiple} disabled={ro} onChange={(v) => majP(i, (x) => poser(x, "multiple", v || null), "m")} />
            {!ro && <button type="button" className="ml-auto" title="Supprimer" onClick={() => m((x) => { x.parametres.splice(i, 1); }, "psuppr")}><Trash2 className="h-3 w-3 text-destructive" /></button>}
          </div>
        </div>
      ))}
      {!ro && <button type="button" className="flex items-center gap-1 text-xs text-primary"
        onClick={() => m((x) => { x.parametres.push({ code: `param_${x.parametres.length + 1}`, libelle: "Nouveau paramètre", type: "TEXTE", obligatoire: false }); }, "pajout")}>
        <Plus className="h-3 w-3" /> Paramètre</button>}
    </>
  );
}

export function JeuxEditeur({ d, ro, m, sources }: { d: Definition; ro: boolean; m: (fn: (d: Definition) => void, cle: string) => void; sources: { code: string; libelle: string; relations: { code: string; cible: string }[] }[] }) {
  const majJ = (i: number, fn: (j: Jeu) => void, cle: string) => m((x) => fn(x.jeux[i]), `j${i}:${cle}`);
  return (
    <>
      <p className="mb-2 text-[11px] text-muted-foreground">
        Le jeu PRINCIPAL donne les lignes du document ; un jeu SECONDAIRE (ex. les lignes de bulletin) alimente un tableau.
      </p>
      {d.jeux.map((j, i) => {
        const parent = j.parent ? d.jeux.find((x) => x.code === j.parent) : null;
        const relations = parent ? sources.find((s) => s.code === parent.source)?.relations ?? [] : [];
        return (
          <div key={i} className="mb-2 rounded border p-2">
            <div className="mb-1 flex items-center gap-2 text-xs">
              <b>{j.code}</b>
              <span className="rounded bg-muted px-1 text-[10px]">{j.role}</span>
              {!ro && j.role === "SECONDAIRE" && <button type="button" className="ml-auto" title="Supprimer" onClick={() => m((x) => { x.jeux.splice(i, 1); }, "jsuppr")}><Trash2 className="h-3 w-3 text-destructive" /></button>}
            </div>
            {j.role === "PRINCIPAL"
              ? <Ligne libelle="Source"><Choix value={j.source} disabled={ro} onChange={(v) => majJ(i, (x) => { x.source = v ?? x.source; }, "s")}
                  options={sources.filter((s) => s.code !== "SOCIETE").map((s) => ({ v: s.code, l: s.libelle }))} /></Ligne>
              : <Ligne libelle="Relation depuis le jeu parent">
                  <Choix value={j.relation} disabled={ro} vide="—"
                    onChange={(v) => majJ(i, (x) => { x.relation = v; const r = relations.find((z) => z.code === v); if (r) x.source = r.cible; }, "r")}
                    options={relations.map((r) => ({ v: r.code, l: `${r.code} → ${r.cible}` }))} />
                </Ligne>}
            <div className="mb-1 text-[11px] font-medium text-muted-foreground">Filtres (tous doivent être vrais)</div>
            {(j.filtres ?? []).map((f, k) => (
              <div key={k} className="mb-1 flex gap-1">
                <div className="flex-1"><FormuleInput value={f} jeu={j.code} disabled={ro} onChange={(v) => majJ(i, (x) => { x.filtres![k] = v; }, `f${k}`)} /></div>
                {!ro && <button type="button" onClick={() => majJ(i, (x) => { x.filtres!.splice(k, 1); }, "fs")}><Trash2 className="h-3 w-3 text-destructive" /></button>}
              </div>
            ))}
            {!ro && <button type="button" className="mb-2 flex items-center gap-1 text-xs text-primary"
              onClick={() => majJ(i, (x) => { x.filtres = [...(x.filtres ?? []), ""]; }, "fa")}><Plus className="h-3 w-3" /> Filtre</button>}
            <div className="mb-1 text-[11px] font-medium text-muted-foreground">Tri</div>
            {(j.tri ?? []).map((t, k) => (
              <div key={k} className="mb-1 flex gap-1">
                <div className="flex-1"><Texte value={t.champ} disabled={ro} onChange={(v) => majJ(i, (x) => { x.tri![k].champ = v; }, `t${k}`)} /></div>
                <div className="w-20"><Choix value={t.sens ?? "ASC"} disabled={ro} onChange={(v) => majJ(i, (x) => poser(x.tri![k], "sens", v === "ASC" ? null : v), `ts${k}`)}
                  options={[{ v: "ASC", l: "Croiss." }, { v: "DESC", l: "Décr." }]} /></div>
                {!ro && <button type="button" onClick={() => majJ(i, (x) => { x.tri!.splice(k, 1); }, "tsup")}><Trash2 className="h-3 w-3 text-destructive" /></button>}
              </div>
            ))}
            {!ro && <button type="button" className="flex items-center gap-1 text-xs text-primary"
              onClick={() => majJ(i, (x) => { x.tri = [...(x.tri ?? []), { champ: "" }]; }, "ta")}><Plus className="h-3 w-3" /> Critère de tri</button>}
          </div>
        );
      })}
      {!ro && (
        <button type="button" className="flex items-center gap-1 text-xs text-primary"
          onClick={() => m((x) => {
            const p = x.jeux.find((z) => z.role === "PRINCIPAL");
            const rel = sources.find((s) => s.code === p?.source)?.relations[0];
            const codes = new Set(x.jeux.map((z) => z.code));
            let code = "l"; let n = 1;
            while (codes.has(code)) code = `l${++n}`;
            x.jeux.push({ code, source: rel?.cible ?? "", role: "SECONDAIRE", parent: p?.code ?? null, relation: rel?.code ?? null });
          }, "jajout")}>
          <Plus className="h-3 w-3" /> Jeu secondaire
        </button>
      )}
    </>
  );
}


function RognageImage({ el, ro, maj }: { el: ElImage; ro: boolean; maj: (fn: (e: any, b: Bande) => void, cle: string) => void }) {
  const [ouvert, setOuvert] = useState(false);
  const r = el.rognage;
  const resume = r ? (["haut", "bas", "gauche", "droite"] as const).filter((k) => r[k]).map((k) => `${k} ${r[k]} %`).join(", ") : "aucun";
  return (
    <Ligne libelle="Rognage" aide="Aussi : double-clic sur l'image dans la page">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" className="h-8" disabled={ro} onClick={() => setOuvert(true)}>Rogner…</Button>
        <span className="truncate text-xs text-muted-foreground">{resume}</span>
        {r && !ro && <button type="button" className="ml-auto text-xs text-muted-foreground hover:underline" onClick={() => maj((e) => { delete e.rognage; }, "rogn")}>Retirer</button>}
      </div>
      <DialogueRognage el={el} ouvert={ouvert} onFermer={() => setOuvert(false)}
        onValider={(x) => maj((e) => { if (x) e.rognage = x; else delete e.rognage; }, "rogn")} />
    </Ligne>
  );
}


// ── sélection multiple (RG-EDT-FORME-05) ─────────────────────────────────────
function Outil({ titre, onClick, disabled, children }: { titre: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" title={titre} disabled={disabled} onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded border border-input hover:bg-muted disabled:cursor-not-allowed disabled:opacity-35">
      {children}
    </button>
  );
}

function AlignementPageBoutons({ editeur, ids }: { editeur: Editeur; ids: string[] }) {
  const largeur = largeurUtile(editeur.definition!.page);
  const page = (m: AlignementPage) => editeur.modifier((d) => alignerPage(d, ids, m, largeur), `page:${ids.join(",")}`);
  return (
    <Ligne libelle="Sur la page" aide="Aligne sur la largeur utile de la page (entre les marges)">
      <div className="flex gap-1">
        <Outil titre="Contre la marge gauche" onClick={() => page("GAUCHE")}><AlignStartVertical className="h-4 w-4" /></Outil>
        <Outil titre="Centré sur la page" onClick={() => page("CENTRE")}><AlignCenterVertical className="h-4 w-4" /></Outil>
        <Outil titre="Contre la marge droite" onClick={() => page("DROITE")}><AlignEndVertical className="h-4 w-4" /></Outil>
        <Outil titre="Toute la largeur de la page" onClick={() => editeur.modifier((d) => pleineLargeur(d, ids, largeur), `pleine:${ids.join(",")}`)}>
          <MoveHorizontal className="h-4 w-4" /></Outil>
      </div>
    </Ligne>
  );
}

function InspecteurMulti({ editeur, ro }: { editeur: Editeur; ro: boolean }) {
  const d = editeur.definition!;
  const ids = editeur.selection.multi ?? [];
  const objets = trouver(d, ids);
  const ref = editeur.selection.element ?? ids[0];
  const vertical = memeBande(d, ids);
  const m = (fn: (x: Definition) => void, cle: string) => editeur.modifier(fn, `${cle}:${ids.join(",")}`);
  const al = (a: Alignement) => m((x) => aligner(x, ids, a, ref), "al");
  const refEl = objets.find((o) => o.el.id === ref)?.el;
  const avecStyle = objets.filter((o) => !["LIGNE", "IMAGE", "CODE_BARRE"].includes(o.el.type));
  const retirer = (id: string) => {
    const reste = ids.filter((x) => x !== id);
    const principal = reste.includes(ref) ? ref : reste[0];
    const b = d.bandes.find((x) => x.elements.some((z) => z.id === principal));
    editeur.setSelection({ bande: b?.id ?? null, element: principal ?? null, multi: reste.length > 1 ? reste : null });
  };
  return (
    <div className="p-3">
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">{ids.length} objets</span>
        {!ro && <>
          <button type="button" title="Dupliquer (Ctrl+D)" className="ml-auto rounded p-1 hover:bg-muted" onClick={() => {
            let n: string[] = [];
            editeur.modifier((x) => { n = dupliquer(x, ids); });
            editeur.setSelection({ bande: editeur.selection.bande, element: n[0] ?? null, multi: n.length > 1 ? n : null });
          }}><Copy className="h-3.5 w-3.5" /></button>
          <button type="button" title="Supprimer (Suppr)" className="rounded p-1 text-destructive hover:bg-destructive/10" onClick={() => {
            editeur.modifier((x) => supprimerObjets(x, ids));
            editeur.setSelection({ bande: editeur.selection.bande, element: null });
          }}><Trash2 className="h-3.5 w-3.5" /></button>
        </>}
      </div>
      <p className="mb-3 text-[11px] text-muted-foreground">
        Référence : <b className="font-mono">{ref}</b> (contour plein) — les autres s'alignent sur elle. Maj+clic ajoute ou retire un objet ;
        tirer sur le fond d'une bande sélectionne au lasso ; Ctrl+A tout sélectionne.
      </p>

      <Titre>Aligner</Titre>
      <div className="mb-1 flex gap-1">
        <Outil titre="Aligner à gauche" disabled={ro} onClick={() => al("GAUCHE")}><AlignStartVertical className="h-4 w-4" /></Outil>
        <Outil titre="Centrer horizontalement" disabled={ro} onClick={() => al("CENTRE_H")}><AlignCenterVertical className="h-4 w-4" /></Outil>
        <Outil titre="Aligner à droite" disabled={ro} onClick={() => al("DROITE")}><AlignEndVertical className="h-4 w-4" /></Outil>
        <span className="mx-1 w-px bg-border" />
        <Outil titre={vertical ? "Aligner en haut" : "Objets de bandes différentes : alignement vertical impossible"} disabled={ro || !vertical} onClick={() => al("HAUT")}><AlignStartHorizontal className="h-4 w-4" /></Outil>
        <Outil titre={vertical ? "Centrer verticalement" : "Objets de bandes différentes"} disabled={ro || !vertical} onClick={() => al("MILIEU_V")}><AlignCenterHorizontal className="h-4 w-4" /></Outil>
        <Outil titre={vertical ? "Aligner en bas" : "Objets de bandes différentes"} disabled={ro || !vertical} onClick={() => al("BAS")}><AlignEndHorizontal className="h-4 w-4" /></Outil>
      </div>

      <Titre>Répartir et uniformiser</Titre>
      <div className="mb-1 flex gap-1">
        <Outil titre="Répartir horizontalement (espaces égaux, 3 objets au moins)" disabled={ro || ids.length < 3} onClick={() => m((x) => repartir(x, ids, "H"), "rh")}>
          <AlignHorizontalDistributeCenter className="h-4 w-4" /></Outil>
        <Outil titre={vertical ? "Répartir verticalement (3 objets au moins)" : "Objets de bandes différentes"} disabled={ro || ids.length < 3 || !vertical} onClick={() => m((x) => repartir(x, ids, "V"), "rv")}>
          <AlignVerticalDistributeCenter className="h-4 w-4" /></Outil>
        <span className="mx-1 w-px bg-border" />
        <Outil titre="Même largeur que la référence" disabled={ro} onClick={() => m((x) => memeTaille(x, ids, "LARGEUR", ref), "tl")}><MoveHorizontal className="h-4 w-4" /></Outil>
        <Outil titre="Même hauteur que la référence" disabled={ro} onClick={() => m((x) => memeTaille(x, ids, "HAUTEUR", ref), "th")}><MoveVertical className="h-4 w-4" /></Outil>
        <Outil titre="Même taille que la référence" disabled={ro} onClick={() => m((x) => memeTaille(x, ids, "LES_DEUX", ref), "tt")}><Maximize2 className="h-4 w-4" /></Outil>
      </div>
      {!ro && <AlignementPageBoutons editeur={editeur} ids={ids} />}

      <Titre>Superposition</Titre>
      <div className="mb-2 flex gap-1">
        {PLANS.map((p) => (
          <button key={p.v} type="button" disabled={ro} title={`${p.l} (${p.raccourci})`}
            onClick={() => m((x) => { for (const o of trouver(x, ids)) changerPlan(x, o.bande.id, o.el.id, p.v); }, `plan${p.v}`)}
            className="flex h-8 flex-1 items-center justify-center rounded border border-input text-xs hover:bg-muted disabled:opacity-50">
            {{ PREMIER: "⤒", AVANCER: "↑", RECULER: "↓", ARRIERE: "⤓" }[p.v]}
          </button>
        ))}
      </div>

      {avecStyle.length > 0 && refEl && <>
        <Titre>Style commun ({avecStyle.length} objet{avecStyle.length > 1 ? "s" : ""} de texte)</Titre>
        <p className="mb-1 text-[11px] text-muted-foreground">Ce que vous changez ici s'applique à tous ; le reste de leur style est conservé.</p>
        <StyleEditeur s={avecStyle.find((o) => o.el.id === ref)?.el.style ?? avecStyle[0].el.style} ro={ro}
          onChange={(nouveau) => {
            const avant = (avecStyle.find((o) => o.el.id === ref)?.el.style ?? avecStyle[0].el.style ?? {}) as Record<string, unknown>;
            const n = nouveau as Record<string, unknown>;
            const cles = [...new Set([...Object.keys(avant), ...Object.keys(n)])].filter((k) => JSON.stringify(avant[k]) !== JSON.stringify(n[k]));
            if (!cles.length) return;
            m((x) => {
              for (const { el } of trouver(x, avecStyle.map((o) => o.el.id))) {
                const st = { ...(el.style ?? {}) } as Record<string, unknown>;
                for (const k of cles) { if (n[k] === undefined || n[k] === null) delete st[k]; else st[k] = n[k]; }
                poser(el, "style", nettoyer(st as Style));
              }
            }, `style:${cles.join(",")}`);
          }} />
      </>}

      <Titre>Objets sélectionnés</Titre>
      <div className="space-y-0.5">
        {objets.map(({ el, bande }) => (
          <div key={el.id} className={`flex items-center gap-2 rounded px-1.5 py-1 text-xs ${el.id === ref ? "bg-primary/10" : "hover:bg-muted"}`}>
            <button type="button" className="truncate text-left" title="Faire de cet objet la référence d'alignement"
              onClick={() => editeur.setSelection({ bande: bande.id, element: el.id, multi: ids })}>
              <span className="font-mono">{el.id}</span> <span className="text-muted-foreground">· {LIBELLES_ELEMENT[el.type]} · {LIBELLES_BANDE[bande.type]}</span>
            </button>
            <button type="button" className="ml-auto text-muted-foreground hover:text-foreground" title="Retirer de la sélection" onClick={() => retirer(el.id)}>
              <X className="h-3 w-3" /></button>
          </div>
        ))}
      </div>
      {!ro && (
        <Button size="sm" variant="ghost" className="mt-2 w-full" onClick={() => {
          const n = copier(d, ids);
          toast({ title: `${n} objet(s) copié(s)`, description: "Ctrl+V pour coller, ici ou dans un autre modèle." });
        }}>Copier (Ctrl+C)</Button>
      )}
    </div>
  );
}


/** Réglages de style repliables (en-tête, titres de lignes…). */
function BlocStyle({ titre, s, ro, onChange }: { titre: string; s?: Style; ro: boolean; onChange: (s: Style) => void }) {
  const regle = !!s && Object.keys(s).length > 0;
  return (
    <details className="my-1 rounded border px-2 py-1" open={false}>
      <summary className="cursor-pointer select-none text-xs font-medium">
        {titre} {regle ? <span className="text-primary">· personnalisé</span> : <span className="text-muted-foreground">· par défaut</span>}
      </summary>
      <div className="pt-2">
        <StyleEditeur s={s} ro={ro} onChange={onChange} />
        {regle && !ro && <button type="button" className="mb-1 text-[11px] text-muted-foreground underline" onClick={() => onChange({})}>Revenir au style par défaut</button>}
      </div>
    </details>
  );
}
