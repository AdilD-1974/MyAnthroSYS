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
export function cssBordures(bordures?: string | null, couleur?: string | null, epaisseurPt?: number | null, mm = 3.78): React.CSSProperties {
  const v = normaliser(bordures);
  if (!v) return {};
  const trait = `${Math.max(1, (epaisseurPt ?? 0.5) * 0.3528 * mm)}px solid ${hexDe(couleur) ?? "#111"}`;
  const cotes = v === "TOUT" ? ORDRE : v.split(",");
  return {
    ...(cotes.includes("H") ? { borderTop: trait } : {}), ...(cotes.includes("B") ? { borderBottom: trait } : {}),
    ...(cotes.includes("G") ? { borderLeft: trait } : {}), ...(cotes.includes("D") ? { borderRight: trait } : {}),
  };
}
