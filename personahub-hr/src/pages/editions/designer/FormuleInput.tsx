/**
 * FormuleInput.tsx — Saisie d'une formule d'édition, avec autocomplétion et
 * vérification en direct par le serveur (POST /editions/expressions/analyser).
 * Auteur : Adil DAIA — lot 2 (16/10/2026)
 *
 * Suggestions selon ce qui précède le curseur :
 *   @…   paramètres du modèle          [ …  rubriques de paie (→ [CODE].MT)
 *   #…   constantes                   sinon champs de la source et fonctions
 * Le serveur reste seul juge : l'analyse locale ne sert qu'à proposer.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { editionsApi, type Analyse } from "@/lib/editionsApi";
import { ATTRIBUTS_RUBRIQUE, RUBRIQUES_EN_TETE } from "@/pages/editions/types";
import { sourceDuJeu, useReferentiels } from "./contexte";
import AssistantFormule from "./AssistantFormule";

interface Props {
  value: string;
  onChange: (v: string) => void;
  jeu?: string | null;          // jeu de contexte (tableau) ; défaut : principal
  placeholder?: string;
  lignes?: number;
  disabled?: boolean;
  verifier?: boolean;           // false : pas d'appel serveur (ex. texte à variables)
}

interface Suggestion { texte: string; insertion: string; detail: string; genre: string }

const cache = new Map<string, Analyse>();
const MOTIF_JETON = /(\[[A-Za-z0-9_]+\]\.[A-Za-z]*|@[A-Za-z0-9_.]*|\[[A-Za-z0-9_]*|#[A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_.]*)$/;

export default function FormuleInput({ value, onChange, jeu, placeholder, lignes = 1, disabled, verifier = true }: Props) {
  const { sources, fonctions, rubriques, definition } = useReferentiels();
  const zone = useRef<HTMLTextAreaElement>(null);
  const [jeton, setJeton] = useState<{ texte: string; debut: number } | null>(null);
  const [indice, setIndice] = useState(0);
  const [analyse, setAnalyse] = useState<Analyse | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [assistant, setAssistant] = useState(false);

  const source = jeu?.startsWith("corps:") ? undefined : sourceDuJeu(definition, jeu);
  const parametres = useMemo(() => (definition?.parametres ?? []).map((p) => p.code), [definition]);

  // ── vérification serveur, différée ───────────────────────────────────────
  useEffect(() => {
    if (!verifier || !value?.trim()) { setAnalyse(null); return; }
    const cle = `${source}|${parametres.join(",")}|${value}`;
    if (cache.has(cle)) { setAnalyse(cache.get(cle)!); return; }
    setEnCours(true);
    const t = setTimeout(() => {
      editionsApi.analyser(value, source, parametres)
        .then((a) => { cache.set(cle, a); setAnalyse(a); })
        .catch(() => setAnalyse(null))
        .finally(() => setEnCours(false));
    }, 450);
    return () => { clearTimeout(t); setEnCours(false); };
  }, [value, source, parametres, verifier]);

  // ── suggestions ──────────────────────────────────────────────────────────
  const suggestions: Suggestion[] = useMemo(() => {
    if (!jeton) return [];
    const t = jeton.texte;
    const bas = t.toLowerCase();
    if (t.startsWith("@")) {
      const q = bas.slice(1);
      return (definition?.parametres ?? [])
        .filter((p) => p.code.startsWith(q))
        .flatMap((p) => p.type === "PERIODE"
          ? [{ texte: `@${p.code}`, insertion: `@${p.code}`, detail: p.libelle, genre: "Paramètre" },
             ...["id", "code", "intitule", "date_debut", "date_fin", "annee", "mois"].map((a) => ({
               texte: `@${p.code}.${a}`, insertion: `@${p.code}.${a}`, detail: `${p.libelle} — ${a}`, genre: "Paramètre" }))]
          : [{ texte: `@${p.code}`, insertion: `@${p.code}`, detail: p.libelle, genre: "Paramètre" }])
        .filter((s) => s.texte.toLowerCase().startsWith(bas))
        .slice(0, 30);
    }
    const attr = /^\[([A-Za-z0-9_]+)\]\.([A-Za-z]*)$/.exec(t);
    if (attr) {
      return ATTRIBUTS_RUBRIQUE
        .filter((a) => a.code.toLowerCase().startsWith(attr[2].toLowerCase()))
        .map((a) => ({ texte: `[${attr[1]}].${a.code}`, insertion: `[${attr[1]}].${a.code}`, detail: a.libelle, genre: "Attribut" }));
    }
    if (t.startsWith("[")) {
      const q = bas.slice(1);
      return [...rubriques, ...RUBRIQUES_EN_TETE]
        .filter((r) => r.code.toLowerCase().includes(q) || r.libelle.toLowerCase().includes(q))
        .slice(0, 30)
        .map((r) => ({ texte: `[${r.code}]`, insertion: `[${r.code}].`, detail: r.libelle, genre: "Rubrique" }));
    }
    if (t.startsWith("#") || t.length < 2) return [];
    const corpsCtx = jeu?.startsWith("corps:") ? (definition?.corps ?? []).find((c) => c.code === jeu.slice(6).split(",")[0]) : undefined;
    const principal = sourceDuJeu(definition, undefined);
    const champs = [
      ...(corpsCtx ? [{ code: "libelle", libelle: "Libellé de la ligne" }, { code: "code_rubrique", libelle: "Code rubrique" },
        { code: "groupe", libelle: "Groupe" }, ...corpsCtx.colonnes.map((c) => ({ code: c.code, libelle: `Colonne ${c.libelle}` }))]
        .map((c) => ({ ...c, groupe: "Corps", type_donnee: "TEXTE" as const, masque_defaut: null, sensible: false })) : []),
      ...(definition?.variables ?? []).map((v) => ({ code: `var.${v.code}`, libelle: v.libelle, groupe: "Variables", type_donnee: "TEXTE" as const, masque_defaut: null, sensible: false })),
      ...(definition?.corps ?? []).filter((c) => c.nature === "CASES").flatMap((c) => (c.lignes ?? []).flatMap((l) => c.colonnes.map((col) => ({
        code: `corps.${c.code}.${l.code}.${col.code}`, libelle: `${c.libelle} · ${l.libelle} · ${col.libelle}`, groupe: "Corps", type_donnee: "TEXTE" as const, masque_defaut: null, sensible: false })))),
      ...(sources.find((s) => s.code === (corpsCtx ? principal : source))?.champs ?? []).map((c) => ({ ...c, code: c.code })),
      ...(sources.find((s) => s.code === "SOCIETE")?.champs ?? []).map((c) => ({ ...c, code: `societe.${c.code}` })),
    ];
    const deChamps = champs
      .filter((c) => !c.code.includes("*") && (c.code.toLowerCase().includes(bas) || c.libelle.toLowerCase().includes(bas)))
      .slice(0, 20)
      .map((c) => ({ texte: c.code, insertion: c.code, detail: c.libelle + (c.sensible ? " · sensible" : ""), genre: "Champ" }));
    const deFonctions = fonctions
      .filter((f) => f.nom.toLowerCase().startsWith(bas))
      .slice(0, 12)
      .map((f) => ({ texte: f.nom, insertion: `${f.nom}(`, detail: f.signature, genre: "Fonction" }));
    return [...deChamps, ...deFonctions];
  }, [jeton, sources, source, fonctions, rubriques, definition, jeu]);

  useEffect(() => setIndice(0), [jeton?.texte]);

  const relire = (el: HTMLTextAreaElement) => {
    const avant = el.value.slice(0, el.selectionStart ?? 0);
    const m = MOTIF_JETON.exec(avant);
    // pas de suggestion à l'intérieur d'un texte entre guillemets
    const guillemets = (avant.match(/"/g) ?? []).length % 2 === 1;
    setJeton(m && !guillemets ? { texte: m[1], debut: avant.length - m[1].length } : null);
  };

  const inserer = (s: Suggestion) => {
    const el = zone.current;
    if (!el || !jeton) return;
    const fin = el.selectionStart ?? value.length;
    const nouveau = value.slice(0, jeton.debut) + s.insertion + value.slice(fin);
    onChange(nouveau);
    setJeton(null);
    const curseur = jeton.debut + s.insertion.length;
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(curseur, curseur); if (s.insertion.endsWith("].")) relire(el); });
  };

  const clavier = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();                               // pas de raccourcis du canevas pendant la saisie
    if (suggestions.length && jeton) {
      if (e.key === "ArrowDown") { e.preventDefault(); setIndice((i) => (i + 1) % suggestions.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setIndice((i) => (i - 1 + suggestions.length) % suggestions.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); inserer(suggestions[indice]); return; }
      if (e.key === "Escape") { e.preventDefault(); setJeton(null); return; }
    }
    if (e.key === "Enter" && lignes === 1) e.preventDefault();
  };

  const erreur = analyse && !analyse.valide ? analyse.erreurs[0] : null;

  return (
    <div className="relative">
      <textarea
        ref={zone}
        value={value ?? ""}
        disabled={disabled}
        rows={lignes}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); relire(e.target); }}
        onKeyUp={(e) => { if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) relire(e.currentTarget); }}
        onClick={(e) => relire(e.currentTarget)}
        onKeyDown={clavier}
        onBlur={() => setTimeout(() => setJeton(null), 150)}
        className={`w-full resize-y rounded-md border bg-background py-1.5 pl-2 pr-8 font-mono text-xs leading-5 outline-none focus:ring-2 focus:ring-ring ${erreur ? "border-destructive" : "border-input"}`}
      />
      {!disabled && (
        <button type="button" title="Assistant de formule : tout ce qu'on peut écrire, des recettes, et un test sur de vrais bulletins"
          onClick={() => setAssistant(true)}
          className="absolute right-1 top-1 rounded px-1 font-serif text-xs italic text-primary hover:bg-primary/10">ƒx</button>
      )}
      {assistant && <AssistantFormule valeur={value ?? ""} jeu={jeu} onValider={onChange} onFermer={() => setAssistant(false)} />}
      {jeton && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 z-50 mt-1 max-h-64 overflow-auto rounded-md border bg-popover shadow-lg">
          {suggestions.map((s, i) => (
            <button
              key={s.genre + s.texte}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); inserer(s); }}
              className={`flex w-full items-baseline gap-2 px-2 py-1 text-left text-xs ${i === indice ? "bg-accent" : "hover:bg-muted"}`}
            >
              <span className="font-mono">{s.texte}</span>
              <span className="truncate text-muted-foreground">{s.detail}</span>
              <span className="ml-auto shrink-0 text-[10px] uppercase text-muted-foreground">{s.genre}</span>
            </button>
          ))}
        </div>
      )}
      {verifier && value?.trim() && (
        <div className="mt-1 flex items-start gap-1 text-[11px]">
          {enCours ? <Loader2 className="mt-0.5 h-3 w-3 animate-spin text-muted-foreground" />
            : erreur ? <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />
            : analyse ? <CheckCircle2 className="mt-0.5 h-3 w-3 text-emerald-600" /> : null}
          {erreur && <span className="text-destructive">{erreur.message}{erreur.debut != null ? ` (position ${erreur.debut + 1})` : ""}</span>}
        </div>
      )}
    </div>
  );
}
