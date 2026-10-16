/**
 * SmartRuleEditor — éditeur pour le DSL des règles de calcul spécifiques.
 * Auteur : Adil DAIA
 *
 * Remplace RubriqueAutocompleteInput (mode Tableur) + <Textarea> brute
 * (mode Texte) par un composant unique, réutilisé dans les deux modes
 * (prop `multiline`), qui apporte :
 *
 *   1. Coloration syntaxique EN DIRECT — technique du calque superposé
 *      (backdrop <div> avec le texte coloré, en-dessous d'un <textarea>/
 *      <input> réel dont le texte est rendu transparent — seul le curseur
 *      reste visible). Le calque et le champ réel partagent EXACTEMENT les
 *      mêmes classes Tailwind (police, padding, line-height) pour rester
 *      alignés caractère par caractère.
 *   2. Autocomplétion à la frappe — fusionne fonctions/mots-clés/cibles
 *      (catalogue moteur), rubriques ([COD…]) et constantes (#COD…) dans
 *      un seul menu déroulant, navigable au clavier (↑ ↓ Entrée Tab Échap).
 *   3. Insertion externe — expose un "inserteur" au parent (registerInserter)
 *      pour que la sidebar "Syntaxe disponible" puisse insérer un extrait
 *      directement à la position du curseur, sur clic.
 *
 * Les couleurs de coloration syntaxique forment une palette de type éditeur
 * de code (indépendante du thème d'apparence de l'application, comme dans
 * n'importe quel IDE) — à la différence des couleurs d'interface (boutons,
 * badges…) qui restent sur les variables CSS du thème ailleurs dans l'app.
 */
import React, { useCallback, useMemo, useRef, useState, useEffect, useLayoutEffect } from "react";

export interface PaletteItem { syntax: string; desc: string; cat?: string }
export interface RefItem { code: string; libelle: string; valeur?: string | null }

interface Suggestion { label: string; insert: string; desc: string; kind: string }

const TOKEN_COLORS: Record<string, { color: string; weight?: string; style?: string }> = {
  comment:   { color: "hsl(220 9% 55%)", style: "italic" },
  string:    { color: "hsl(25 75% 45%)" },
  rubrique:  { color: "hsl(266 60% 52%)" },
  constante: { color: "hsl(199 70% 42%)" },
  keyword:   { color: "hsl(330 65% 48%)", weight: "600" },
  func:      { color: "hsl(155 55% 33%)", weight: "600" },
  cible:     { color: "hsl(4 70% 48%)", weight: "700" },
  registre:  { color: "hsl(28 80% 45%)" },
  number:    { color: "hsl(210 10% 35%)" },
};

// Miroir (simplifié, coloration uniquement) du tokenizer regle_dsl.py.
const TOKEN_RE = new RegExp(
  [
    "(?<comment>//.*|#-.*)",
    '(?<string>"[^"]*")',
    "(?<rubrique>\\[[A-Za-z0-9_]+\\](?:\\.[A-Za-z0-9_]+)?)",
    "(?<constante>#[A-Za-z0-9_]+)",
    "(?<keyword>\\b(?:SI|ALORS|BRANCH|ALLER|GOTO|FIN|END|STOP|ET|OU|NON|VRAI|FAUX)\\b)",
    "(?<cible>\\b(?:MT|NB|TX|BASE|DATE|TEXTE)\\b)",
    "(?<registre>\\b(?:R|T|D)\\d{2}\\b)",
    "(?<func>\\b[A-Za-z_][A-Za-z0-9_]*(?=\\s*\\())",
    "(?<number>\\d+(?:\\.\\d+)?)",
  ].join("|"),
  "gm",
);

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlightHtml(src: string): string {
  if (!src) return "&nbsp;";
  let out = "";
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(src))) {
    if (m.index > last) out += escapeHtml(src.slice(last, m.index));
    const groups = m.groups || {};
    const type = Object.keys(groups).find((k) => groups[k] !== undefined) || "";
    const style = TOKEN_COLORS[type];
    out += style
      ? `<span style="color:${style.color};${style.weight ? `font-weight:${style.weight};` : ""}${style.style ? `font-style:${style.style};` : ""}">${escapeHtml(m[0])}</span>`
      : escapeHtml(m[0]);
    last = m.index + m[0].length;
  }
  out += escapeHtml(src.slice(last));
  // Une ligne finale vide en mode multiligne évite que le calque "s'affaisse"
  // d'une ligne par rapport au textarea quand la valeur finit par \n.
  return out + "\n";
}

// Extrait le premier "mot" d'une signature de catalogue (ex. "ARRONDI(x[, n])" → "ARRONDI").
function nomDe(syntax: string): string {
  return syntax.split(/[\s(]/)[0].replace(/[.…]/g, "").trim();
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  palette: PaletteItem[];
  rubriques: RefItem[];
  constantes: RefItem[];
  multiline?: boolean;
  placeholder?: string;
  className?: string;
  registerInserter?: (insert: ((text: string) => void) | null) => void;
}

// Fonctions dont le premier argument (entre guillemets) est un CODE de
// rubrique — dès qu'on tape le " ouvrant après l'une d'elles, on propose
// les rubriques exactement comme pour [ (même avant toute frappe).
const FONCTIONS_RUBRIQUE = ["CUMUL", "PREC", "SOMME", "MOYENNE", "VALEUR", "BAREME"];
const RE_DANS_APPEL_RUBRIQUE = new RegExp(`\\b(${FONCTIONS_RUBRIQUE.join("|")})\\(\\s*"$`, "i");

const SmartRuleEditor: React.FC<Props> = ({
  value, onChange, palette, rubriques, constantes, multiline, placeholder, className, registerInserter,
}) => {
  const elRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState(0);
  const [openSuggest, setOpenSuggest] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  // RG-EDITOR-CURSEUR-01 (Adil DAIA) : le parent transforme la valeur à la
  // frappe (upperKeepStrings — mise en majuscule hors guillemets) avant de la
  // renvoyer via `value`. Ce type de transformation "sur place" est le cas
  // classique où un champ contrôlé React perd la position du curseur (le
  // navigateur place le curseur en fin de champ dès que la valeur reçue en
  // retour ne correspond pas exactement à ce qu'il vient d'afficher). On
  // capture donc la position NATIVE juste après la frappe (avant toute
  // transformation), et on la réapplique explicitement une fois la nouvelle
  // valeur rendue — indépendamment de la cause exacte côté parent.
  const curseurEnAttente = useRef<number | null>(null);

  const majCaret = useCallback(() => {
    const el = elRef.current;
    if (el) setCaret(el.selectionStart ?? 0);
  }, []);

  const syncScroll = useCallback(() => {
    const el = elRef.current, bd = backdropRef.current;
    if (el && bd) { bd.scrollTop = el.scrollTop; bd.scrollLeft = el.scrollLeft; }
  }, []);

  // Jeton en cours de saisie (mot sous le curseur, [ # . _ inclus pour capter [COD, #COD…).
  const tokenInfo = useMemo(() => {
    let start = caret;
    while (start > 0 && /[A-Za-z0-9_[\]#.]/.test(value[start - 1])) start--;
    return { start, token: value.slice(start, caret) };
  }, [value, caret]);

  const suggestions: Suggestion[] = useMemo(() => {
    const { token, start } = tokenInfo;
    const avant = value.slice(0, start);
    const dansAppelRubrique = RE_DANS_APPEL_RUBRIQUE.test(avant);
    // Le garde-fou "au moins 1 caractère" ne s'applique pas juste après le "
    // ouvrant d'un appel de fonction — comme pour [, la liste complète doit
    // apparaître immédiatement pour guider la saisie.
    if ((!token || token.length < 1) && !dansAppelRubrique) return [];
    const t = token.toUpperCase();
    const out: Suggestion[] = [];
    if (t.startsWith("[")) {
      const partiel = t.slice(1);
      rubriques.filter((r) => r.code.toUpperCase().startsWith(partiel)).slice(0, 8)
        .forEach((r) => out.push({ label: `[${r.code}]`, insert: `[${r.code}].MT`, desc: r.libelle, kind: "Rubrique" }));
    } else if (t.startsWith("#")) {
      const partiel = t.slice(1);
      constantes.filter((c) => c.code.toUpperCase().startsWith(partiel)).slice(0, 8)
        .forEach((c) => out.push({ label: `#${c.code}`, insert: `#${c.code}`, desc: c.libelle + (c.valeur ? ` = ${c.valeur}` : ""), kind: "Constante" }));
    } else if (dansAppelRubrique) {
      // Déjà à l'intérieur des guillemets : on insère juste le CODE, pas de
      // crochets ni de guillemets supplémentaires (déjà tapés par l'utilisateur).
      rubriques.filter((r) => r.code.toUpperCase().startsWith(t)).slice(0, 10)
        .forEach((r) => out.push({ label: r.code, insert: r.code, desc: r.libelle, kind: "Rubrique" }));
    } else {
      palette.filter((p) => nomDe(p.syntax).toUpperCase().startsWith(t)).slice(0, 10)
        .forEach((p) => {
          const nom = nomDe(p.syntax);
          const estFonction = p.syntax.includes("(");
          out.push({ label: nom, insert: estFonction ? `${nom}(` : nom, desc: p.desc, kind: p.cat || "Mot-clé" });
        });
    }
    return out;
  }, [tokenInfo, palette, rubriques, constantes, value]);

  useEffect(() => { setHighlightIdx(0); }, [suggestions.length]);
  useEffect(() => { setOpenSuggest(suggestions.length > 0); }, [suggestions]);

  // Réapplique la position capturée dans onChange, une fois `value` rendu
  // (donc après la transformation éventuelle du parent) — voir RG-EDITOR-CURSEUR-01.
  useLayoutEffect(() => {
    if (curseurEnAttente.current == null) return;
    const el = elRef.current;
    if (el) {
      const pos = Math.min(curseurEnAttente.current, value.length);
      el.setSelectionRange(pos, pos);
    }
    curseurEnAttente.current = null;
  }, [value]);

  const inserer = useCallback((texte: string, remplaceToken = false) => {
    const el = elRef.current;
    if (!el) return;
    const debut = remplaceToken ? tokenInfo.start : caret;
    const before = value.slice(0, debut);
    const after = value.slice(caret);
    const next = before + texte + after;
    onChange(next);
    const nouvelleCaret = (before + texte).length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(nouvelleCaret, nouvelleCaret);
      setCaret(nouvelleCaret);
    });
    setOpenSuggest(false);
  }, [value, caret, tokenInfo, onChange]);

  const accepter = useCallback((s: Suggestion) => inserer(s.insert, true), [inserer]);

  // Exposé au parent : la sidebar "Syntaxe disponible" insère dans l'éditeur
  // le plus récemment focalisé (le parent conserve la dernière fonction reçue).

  const handleFocus = useCallback(() => {
    registerInserter?.((texte: string) => inserer(texte, false));
    majCaret();
  }, [registerInserter, inserer, majCaret]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (openSuggest && suggestions.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setHighlightIdx((i) => (i + 1) % suggestions.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setHighlightIdx((i) => (i - 1 + suggestions.length) % suggestions.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); accepter(suggestions[highlightIdx]); return; }
      if (e.key === "Escape") { setOpenSuggest(false); return; }
    }
    if (!multiline && e.key === "Enter") e.preventDefault();
  };

  // Classes IDENTIQUES entre le calque et le champ réel — alignement caractère
  // par caractère indispensable à la technique du calque superposé.
  const classesPartagees = `${className || ""} w-full whitespace-pre-wrap break-words`;

  const Tag: any = multiline ? "textarea" : "input";

  return (
    <div className="relative w-full">
      <div
        ref={backdropRef}
        aria-hidden
        className={`${classesPartagees} absolute inset-0 overflow-hidden pointer-events-none select-none`}
        style={{ color: "hsl(var(--foreground))" }}
        dangerouslySetInnerHTML={{ __html: highlightHtml(value) }}
      />
      <Tag
        ref={elRef}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
          curseurEnAttente.current = e.target.selectionStart ?? null;
          onChange(e.target.value);
          majCaret();
        }}
        onKeyUp={majCaret}
        onClick={majCaret}
        onSelect={majCaret}
        onScroll={syncScroll}
        onFocus={handleFocus}
        onBlur={() => setTimeout(() => setOpenSuggest(false), 150)}
        onKeyDown={handleKeyDown}
        className={`${classesPartagees} relative bg-transparent caret-foreground resize-none`}
        style={{ color: "transparent", WebkitTextFillColor: "transparent" }}
      />
      {openSuggest && suggestions.length > 0 && (
        <div className="absolute z-20 left-0 top-full mt-1 w-96 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg py-1">
          {suggestions.map((s, i) => (
            <button
              key={`${s.kind}-${s.label}`}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); accepter(s); }}
              onMouseEnter={() => setHighlightIdx(i)}
              className={`w-full text-left pl-2.5 pr-3 py-2 flex items-center gap-2.5 border-l-2 transition-colors ${
                i === highlightIdx ? "bg-accent/15 border-l-accent" : "border-l-transparent hover:bg-muted/50"}`}
            >
              <code className="text-[11px] font-mono font-semibold text-accent shrink-0 min-w-[64px]">{s.label}</code>
              <span className="text-[11px] text-muted-foreground flex-1 min-w-0">{s.desc}</span>
              <span className="text-[9px] uppercase tracking-wide text-muted-foreground/60 shrink-0 rounded bg-muted px-1.5 py-0.5">{s.kind}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default SmartRuleEditor;
