/**
 * Couleurs.tsx — Choix d'une couleur (police, fond, trait) et des bordures, sans saisir de code.
 * Auteur : Adil DAIA — lot 2 bis (17/10/2026)
 */
import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";

/** Palette proposée : neutres, couleurs de bulletin, teintes claires pour les fonds. */
const PALETTE: { c: string; n: string }[][] = [
  [{ c: "#000000", n: "Noir" }, { c: "#404040", n: "Gris foncé" }, { c: "#808080", n: "Gris" }, { c: "#BFBFBF", n: "Gris moyen" },
   { c: "#E8E8E8", n: "Gris clair" }, { c: "#F5F5F5", n: "Gris très clair" }, { c: "#FFFFFF", n: "Blanc" }],
  [{ c: "#1F4E79", n: "Bleu marine" }, { c: "#2E75B6", n: "Bleu" }, { c: "#0E7490", n: "Bleu canard" }, { c: "#2E7D32", n: "Vert" },
   { c: "#C00000", n: "Rouge" }, { c: "#E07000", n: "Orange" }, { c: "#7030A0", n: "Violet" }],
  [{ c: "#DEEAF6", n: "Bleu pâle" }, { c: "#D9F0F5", n: "Bleu canard pâle" }, { c: "#E2EFDA", n: "Vert pâle" }, { c: "#FDE9E7", n: "Rouge pâle" },
   { c: "#FFF2CC", n: "Jaune pâle" }, { c: "#FCE4D6", n: "Orange pâle" }, { c: "#EDE2F6", n: "Violet pâle" }],
];
const NOMMEES: Record<string, string> = {
  noir: "#000000", blanc: "#FFFFFF", gris: "#808080", gris_clair: "#E8E8E8", rouge: "#C00000", bleu: "#1F4E79", vert: "#2E7D32", orange: "#E07000",
};
const RECENTES = "editions.couleurs.recentes";

export const hexDe = (v?: string | null) => (v ? NOMMEES[v.toLowerCase()] ?? v : undefined);
const nomDe = (v?: string | null) => {
  const h = hexDe(v)?.toUpperCase();
  return PALETTE.flat().find((p) => p.c === h)?.n ?? h ?? "";
};
function lireRecentes(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENTES) ?? "[]").slice(0, 7); } catch { return []; }
}
function noterRecente(c: string) {
  try { localStorage.setItem(RECENTES, JSON.stringify([c, ...lireRecentes().filter((x) => x !== c)].slice(0, 7))); } catch { /* sans stockage */ }
}

export function ChoixCouleur({ value, onChange, disabled, vide = "Aucune", defaut }: {
  value?: string | null; onChange: (v: string | null) => void; disabled?: boolean; vide?: string; defaut?: string;
}) {
  const [ouvert, setOuvert] = useState(false);
  const zone = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ouvert) return;
    const fermer = (e: MouseEvent) => { if (!zone.current?.contains(e.target as Node)) setOuvert(false); };
    document.addEventListener("mousedown", fermer);
    return () => document.removeEventListener("mousedown", fermer);
  }, [ouvert]);
  const hex = hexDe(value);
  const choisir = (c: string | null) => { if (c) noterRecente(c); onChange(c); setOuvert(false); };
  const pastille = (c: string, n: string) => (
    <button key={c} type="button" title={n} onClick={() => choisir(c)}
      className="relative h-5 w-5 rounded border border-black/15 hover:scale-110" style={{ background: c }}>
      {hex?.toUpperCase() === c.toUpperCase() && <Check className="absolute inset-0 m-auto h-3 w-3" style={{ color: ["#FFFFFF", "#F5F5F5", "#E8E8E8"].includes(c) || c.length === 7 && parseInt(c.slice(1, 3), 16) > 200 ? "#000" : "#fff" }} />}
    </button>
  );
  return (
    <div ref={zone} className="relative">
      <button type="button" disabled={disabled} onClick={() => setOuvert((o) => !o)}
        className="flex h-8 w-full items-center gap-2 rounded-md border border-input bg-background px-2 text-left text-xs disabled:opacity-60">
        <span className="h-4 w-4 shrink-0 rounded border border-black/20"
          style={hex ? { background: hex } : { background: defaut ?? "repeating-linear-gradient(45deg,#fff 0 3px,#e5e7eb 3px 6px)" }} />
        <span className={`truncate ${hex ? "" : "text-muted-foreground"}`}>{hex ? nomDe(value) : vide}</span>
      </button>
      {ouvert && (
        <div className="absolute right-0 z-50 mt-1 w-56 rounded-md border bg-popover p-2 shadow-lg">
          <div className="space-y-1">{PALETTE.map((rang, i) => <div key={i} className="flex gap-1">{rang.map((p) => pastille(p.c, p.n))}</div>)}</div>
          {lireRecentes().length > 0 && <>
            <div className="mb-1 mt-2 text-[10px] uppercase text-muted-foreground">Récentes</div>
            <div className="flex gap-1">{lireRecentes().map((c) => pastille(c, c))}</div>
          </>}
          <div className="mt-2 flex items-center gap-2 border-t pt-2">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs hover:underline">
              <input type="color" className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0" value={hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#000000"}
                onChange={(e) => onChange(e.target.value.toUpperCase())} onBlur={(e) => noterRecente(e.target.value.toUpperCase())} />
              Autre couleur…
            </label>
            <button type="button" onClick={() => choisir(null)} className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />{vide}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Bordures d'un objet : une liste de cas usuels (stockée H,B,G,D / TOUT). */
export const BORDURES: { v: string; l: string }[] = [
  { v: "", l: "Aucune" },
  { v: "TOUT", l: "Encadré (4 côtés)" },
  { v: "B", l: "En bas (souligné)" },
  { v: "H", l: "En haut" },
  { v: "H,B", l: "En haut et en bas" },
  { v: "G", l: "À gauche" },
  { v: "D", l: "À droite" },
  { v: "G,D", l: "À gauche et à droite" },
  { v: "H,G,D", l: "Ouvert en bas" },
  { v: "B,G,D", l: "Ouvert en haut" },
];
const ORDRE = ["H", "B", "G", "D"];
const normaliser = (v?: string | null) => {
  const t = (v ?? "").toUpperCase().replace(/\s/g, "");
  if (!t || t === "TOUT") return t;
  const c = ORDRE.filter((x) => t.split(",").includes(x));
  return c.length === 4 ? "TOUT" : c.join(",");
};

export function ChoixBordures({ value, onChange, disabled }: { value?: string | null; onChange: (v: string | null) => void; disabled?: boolean }) {
  const v = normaliser(value);
  const connue = BORDURES.some((b) => b.v === v);
  return (
    <select disabled={disabled} value={v} onChange={(e) => onChange(e.target.value || null)}
      className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs">
      {!connue && <option value={v}>Personnalisé ({v})</option>}
      {BORDURES.map((b) => <option key={b.v} value={b.v}>{b.l}</option>)}
    </select>
  );
}

/** Bordures en CSS pour le canevas. */
export function cssBordures(bordures?: string | null, couleur?: string | null, epaisseurPt?: number | null, mm = 3.78,
  styleTrait?: string | null): React.CSSProperties {
  const v = normaliser(bordures);
  if (!v) return {};
  const motif = { TIRETS: "dashed", POINTILLES: "dotted", TIRET_POINT: "dashed" }[styleTrait ?? ""] ?? "solid";
  const trait = `${Math.max(1, (epaisseurPt ?? 0.5) * 0.3528 * mm)}px ${motif} ${hexDe(couleur) ?? "#111"}`;
  const cotes = v === "TOUT" ? ORDRE : v.split(",");
  return {
    ...(cotes.includes("H") ? { borderTop: trait } : {}), ...(cotes.includes("B") ? { borderBottom: trait } : {}),
    ...(cotes.includes("G") ? { borderLeft: trait } : {}), ...(cotes.includes("D") ? { borderRight: trait } : {}),
  };
}

// ── listes visuelles : épaisseur, style de trait, arrondi ────────────────────
interface OptionVisuelle<T> { v: T; l: string; apercu: React.ReactNode }

/** Liste déroulante dont chaque choix montre un aperçu (trait, arrondi…). */
export function ListeVisuelle<T extends string | number>({ value, options, onChange, disabled, vide }: {
  value: T | null | undefined; options: OptionVisuelle<T>[]; onChange: (v: T | null) => void; disabled?: boolean; vide?: string;
}) {
  const [ouvert, setOuvert] = useState(false);
  const zone = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ouvert) return;
    const fermer = (e: MouseEvent) => { if (!zone.current?.contains(e.target as Node)) setOuvert(false); };
    document.addEventListener("mousedown", fermer);
    return () => document.removeEventListener("mousedown", fermer);
  }, [ouvert]);
  const courant = options.find((o) => o.v === value);
  return (
    <div ref={zone} className="relative">
      <button type="button" disabled={disabled} onClick={() => setOuvert((o) => !o)}
        className="flex h-8 w-full items-center gap-2 rounded-md border border-input bg-background px-2 text-left text-xs disabled:opacity-60">
        <span className="flex w-10 shrink-0 items-center justify-center">{courant?.apercu}</span>
        <span className={`truncate ${courant ? "" : "text-muted-foreground"}`}>{courant?.l ?? vide ?? "—"}</span>
      </button>
      {ouvert && (
        <div className="absolute left-0 right-0 z-50 mt-1 max-h-72 overflow-auto rounded-md border bg-popover py-1 shadow-lg">
          {options.map((o) => (
            <button key={String(o.v)} type="button" onClick={() => { onChange(o.v); setOuvert(false); }}
              className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent ${o.v === value ? "bg-accent/60 font-medium" : ""}`}>
              <span className="flex w-10 shrink-0 items-center justify-center">{o.apercu}</span>{o.l}
              {o.v === value && <Check className="ml-auto h-3 w-3" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const trait = (pt: number, style: string = "solid") => (
  <span className="block w-10" style={{ borderTop: `${Math.max(1, pt * 1.33)}px ${style} #111` }} />
);

/** Épaisseurs en points (1 pt = 0,35 mm), comme dans les traitements de texte. */
export const EPAISSEURS = [0.25, 0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6];
export function ChoixEpaisseur({ value, onChange, disabled }: { value?: number | null; onChange: (v: number | null) => void; disabled?: boolean }) {
  const noms: Record<number, string> = { 0.25: "Très fin", 0.5: "Fin (défaut)", 1: "Normal", 1.5: "Moyen", 2.25: "Épais", 3: "Très épais" };
  const liste = EPAISSEURS.includes(value ?? 0.5) ? EPAISSEURS : [...EPAISSEURS, value!].sort((a, b) => a - b);
  return (
    <ListeVisuelle value={value ?? 0.5} disabled={disabled} onChange={(v) => onChange(v === 0.5 ? null : v)}
      options={liste.map((e) => ({ v: e, l: `${String(e).replace(".", ",")} pt${noms[e] ? ` · ${noms[e]}` : ""}`, apercu: trait(e) }))} />
  );
}

export type StyleTrait = "PLEIN" | "TIRETS" | "POINTILLES" | "TIRET_POINT";
export const CSS_TRAIT: Record<StyleTrait, string> = { PLEIN: "solid", TIRETS: "dashed", POINTILLES: "dotted", TIRET_POINT: "dashed" };
export function ChoixTrait({ value, onChange, disabled }: { value?: StyleTrait | null; onChange: (v: StyleTrait | null) => void; disabled?: boolean }) {
  return (
    <ListeVisuelle<StyleTrait> value={value ?? "PLEIN"} disabled={disabled} onChange={(v) => onChange(v === "PLEIN" ? null : v)}
      options={[
        { v: "PLEIN", l: "Continu", apercu: trait(1.5) },
        { v: "TIRETS", l: "Tirets", apercu: trait(1.5, "dashed") },
        { v: "POINTILLES", l: "Pointillés", apercu: trait(1.5, "dotted") },
        { v: "TIRET_POINT", l: "Tiret-point", apercu: <svg width="40" height="4"><line x1="0" y1="2" x2="40" y2="2" stroke="#111" strokeWidth="2" strokeDasharray="7 3 2 3" /></svg> },
      ]} />
  );
}

export function ChoixArrondi({ value, onChange, disabled }: { value?: number | null; onChange: (v: number | null) => void; disabled?: boolean }) {
  const liste = [0, 0.5, 1, 2, 3, 5, 8];
  const noms: Record<number, string> = { 0: "Angles droits", 1: "Léger", 3: "Moyen", 8: "Prononcé" };
  return (
    <ListeVisuelle value={value ?? 0} disabled={disabled} onChange={(v) => onChange(v ? v : null)}
      options={(liste.includes(value ?? 0) ? liste : [...liste, value!].sort((a, b) => a - b)).map((r) => ({
        v: r, l: `${String(r).replace(".", ",")} mm${noms[r] ? ` · ${noms[r]}` : ""}`,
        apercu: <span className="block h-4 w-7 border-2 border-foreground/80" style={{ borderRadius: r * 1.6 }} />,
      }))} />
  );
}

/** Tailles de police usuelles, proposées dans une liste (saisie libre possible). */
export const TAILLES = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48];
