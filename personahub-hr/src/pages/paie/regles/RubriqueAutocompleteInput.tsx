/**
 * RubriqueAutocompleteInput — Champ d'instruction de règle avec assistant de saisie :
 *   • "["  → liste des RUBRIQUES  (recherche par code ou intitulé) → insère [CODE]
 *   • "#"  → liste des CONSTANTES (recherche par code ou intitulé) → insère #CODE
 * Navigation clavier (↑ ↓ Entrée/Tab Échap) ou souris.
 * Auteur : Adil DAIA
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

export interface OptionItem { code: string; libelle: string; valeur?: string | null; }

interface Props {
  value: string;
  onChange: (v: string) => void;
  rubriques: OptionItem[];
  constantes?: OptionItem[];
  placeholder?: string;
  className?: string;
}

// Token ouvert juste avant le curseur
const RE_RUB = /\[([^\]\n]*)$/;      // "[xxx" non fermé
const RE_CST = /#([A-Za-z0-9_]*)$/;  // "#xxx"

type Mode = "RUB" | "CST" | null;

const RubriqueAutocompleteInput: React.FC<Props> = ({ value, onChange, rubriques, constantes = [], placeholder, className }) => {
  const ref = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  // Position fixe : la liste doit échapper aux conteneurs "overflow-hidden" (tableau)
  const [pos, setPos] = useState<{ top: number; left: number; width: number; haut: boolean; maxH: number } | null>(null);

  const source = mode === "CST" ? constantes : rubriques;

  const matches = useMemo(() => {
    if (!mode) return [];
    const q = query.trim().toLowerCase();
    return source
      .filter((r) => !q || r.code.toLowerCase().includes(q) || (r.libelle || "").toLowerCase().includes(q))
      .slice(0, 8);
  }, [mode, query, source]);

  // Détecte le contexte depuis la valeur réelle du DOM (toujours à jour)
  const refresh = () => {
    const el = ref.current;
    if (!el) return;
    const pos = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, pos);
    const mr = before.match(RE_RUB);
    const mc = before.match(RE_CST);
    const openWith = (m: Mode, q: string) => {
      const r = el.getBoundingClientRect();
      const MARGE = 8;
      const espaceBas = window.innerHeight - r.bottom - MARGE;
      const espaceHaut = r.top - MARGE;
      // On privilégie TOUJOURS l'ouverture vers le bas (le champ reste visible).
      // On ne bascule vers le haut que si le bas est vraiment trop court ET que le haut est plus grand.
      const haut = espaceBas < 120 && espaceHaut > espaceBas;
      const maxH = Math.min(240, Math.max(120, haut ? espaceHaut : espaceBas));
      setPos({
        top: haut ? r.top - 4 : r.bottom + 4,
        left: r.left, width: Math.max(r.width, 320), haut, maxH,
      });
      setMode(m); setQuery(q); setHi(0);
    };
    if (mr) openWith("RUB", mr[1]);
    else if (mc) openWith("CST", mc[1]);
    else setMode(null);
  };

  // Le placement est calculé à l'ouverture : on ferme si la page bouge.
  useEffect(() => {
    if (!mode) return;
    const close = () => setMode(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [mode]);

  const choose = (r: OptionItem) => {
    const el = ref.current;
    if (!el || !mode) return;
    const pos = el.selectionStart ?? el.value.length;
    const inserted = mode === "CST" ? `#${r.code}` : `[${r.code}]`;
    const before = el.value.slice(0, pos).replace(mode === "CST" ? RE_CST : RE_RUB, inserted);
    const after = el.value.slice(pos);
    onChange(before + after);
    setMode(null);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(before.length, before.length); });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!mode || matches.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => (h + 1) % matches.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => (h - 1 + matches.length) % matches.length); }
    else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(matches[hi]); }
    else if (e.key === "Escape") { e.preventDefault(); setMode(null); }
  };

  return (
    <div className="relative">
      <Input
        ref={ref}
        value={value}
        placeholder={placeholder}
        className={className}
        onChange={(e) => onChange(e.target.value)}
        onKeyUp={refresh}
        onClick={refresh}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setMode(null), 150)}
        autoComplete="off"
      />
      {mode && matches.length > 0 && pos && (
        <div
          style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 9999,
                   maxHeight: pos.maxH, transform: pos.haut ? "translateY(-100%)" : undefined }}
          className="overflow-auto rounded-md border border-border bg-popover shadow-xl">
          <div className="px-2.5 py-1 text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/50 sticky top-0">
            {mode === "CST" ? "Constantes de paie" : "Rubriques"}
          </div>
          {matches.map((r, i) => (
            <button
              key={r.code}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); choose(r); }}
              className={`w-full text-left px-2.5 py-1.5 text-xs flex items-center gap-2 ${i === hi ? "bg-accent/15" : "hover:bg-muted"}`}
            >
              <code className="font-mono text-[11px] text-accent shrink-0">{r.code}</code>
              <span className="text-muted-foreground truncate flex-1">{r.libelle}</span>
              {mode === "CST" && r.valeur != null && (
                <span className="text-[10px] font-mono text-foreground/70 shrink-0">{r.valeur}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default RubriqueAutocompleteInput;
