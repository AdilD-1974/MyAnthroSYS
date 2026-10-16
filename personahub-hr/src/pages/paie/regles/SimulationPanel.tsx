/**
 * SimulationPanel — Bac à sable d'exécution d'une règle spécifique.
 * On saisit les valeurs d'entrée (attributs, rubriques, constantes, cumuls,
 * précédents, barèmes) détectées dans la règle, puis on exécute sur le VRAI
 * moteur backend (/paie/regles/tester-manuel). Aucun collaborateur, aucune base.
 * Auteur : Adil DAIA
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  X, Play, Loader2, AlertTriangle, CheckCircle2, RefreshCw,
  Layers, Link2, Hash, TrendingUp, History, Table2,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  open: boolean;
  onClose: () => void;
  lignes: Array<{ numero: number; instruction: string; label?: string | null }>;
  regleLibelle?: string;
  /** RG-SIM-INLINE-01 : remonte le dernier résultat au parent (RegleSpecifiqueForm)
   * pour affichage inline dans le tableau des instructions, sans dupliquer la
   * logique d'appel — ce panneau reste la seule source de vérité de l'exécution. */
  onResult?: (result: { sorties: Record<string, any>; trace: any[]; avertissements: string[] } | null) => void;
}

const ATTRS = ["MT", "NB", "TX", "BASE", "DATE", "TEXTE"] as const;
const ATTR_LABEL: Record<string, string> = { MT: "Montant", NB: "Nombre", TX: "Taux", BASE: "Base", DATE: "Date", TEXTE: "Texte" };

const SimulationPanel: React.FC<Props> = ({ open, onClose, lignes, regleLibelle, onResult }) => {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ sorties: Record<string, any>; trace: any[]; avertissements: string[] } | null>(null);

  const src = useMemo(() => lignes.map((l) => l.instruction).join("\n"), [lignes]);

  const detected = useMemo(() => {
    const rubs = new Map<string, Set<string>>();
    const consts = new Set<string>();
    const cumuls = new Set<string>();
    const precs = new Set<string>();
    const baremes = new Set<string>();
    let m: RegExpExecArray | null;

    const reRub = /\[([A-Z0-9_]+)\](?:\.(MT|NB|TX|BASE|DATE|TEXTE))?/gi;
    while ((m = reRub.exec(src))) {
      const code = m[1].toUpperCase();
      if (!rubs.has(code)) rubs.set(code, new Set());
      rubs.get(code)!.add((m[2] || "MT").toUpperCase());
    }
    const reConst = /#([A-Z0-9_]+)/g;
    while ((m = reConst.exec(src))) consts.add(m[1].toUpperCase());
    const reCumul = /\b(?:CUMUL|SOMME|MOYENNE)\s*\(\s*"([A-Z0-9_]+)"/gi;
    while ((m = reCumul.exec(src))) cumuls.add(m[1].toUpperCase());
    const rePrec = /\bPREC\s*\(\s*"([A-Z0-9_]+)"\s*(?:,\s*(\d+))?/gi;
    while ((m = rePrec.exec(src))) precs.add(`${m[1].toUpperCase()}:${m[2] || "1"}`);
    const reBareme = /\bBAREME\s*\(\s*"([A-Z0-9_]+)"/gi;
    while ((m = reBareme.exec(src))) baremes.add(m[1].toUpperCase());

    const seed = new Set<string>();
    lignes.forEach((l) => {
      const line = l.instruction;
      const cible = line.match(/^\s*(MT|NB|TX|BASE|DATE|TEXTE)\s*=/i)?.[1]?.toUpperCase();
      const rhs = cible ? line.slice(line.indexOf("=") + 1) : line;
      ATTRS.forEach((a) => {
        if (new RegExp(`(?<![\\w.\\]])${a}\\b`, "i").test(rhs)) seed.add(a);
      });
    });

    return { rubs, consts, cumuls, precs, baremes, seed };
  }, [src, lignes]);

  useEffect(() => { if (open) setResult(null); }, [open]);

  const set = (k: string, v: string) => setVals((p) => ({ ...p, [k]: v }));
  const num = (v?: string) => (v === undefined || v === "" ? undefined : parseFloat(v));
  const reset = () => { setVals({}); setResult(null); onResult?.(null); };

  const lancer = async () => {
    setBusy(true); setResult(null);
    try {
      const seed: Record<string, any> = {};
      detected.seed.forEach((a) => {
        const v = vals[`seed:${a}`];
        if (v !== undefined && v !== "") seed[a] = a === "DATE" || a === "TEXTE" ? v : num(v);
      });
      const rubriques: Record<string, Record<string, any>> = {};
      detected.rubs.forEach((attrs, code) => {
        attrs.forEach((a) => {
          const v = vals[`rub:${code}:${a}`];
          if (v !== undefined && v !== "") (rubriques[code] ||= {})[a] = a === "DATE" || a === "TEXTE" ? v : num(v);
        });
      });
      const constantes: Record<string, any> = {};
      detected.consts.forEach((c) => { const v = num(vals[`const:${c}`]); if (v !== undefined) constantes[c] = v; });
      const cumuls: Record<string, any> = {};
      detected.cumuls.forEach((c) => { const v = num(vals[`cumul:${c}`]); if (v !== undefined) cumuls[c] = v; });
      const precedents: Record<string, any> = {};
      detected.precs.forEach((c) => { const v = num(vals[`prec:${c}`]); if (v !== undefined) precedents[c] = v; });
      const baremes: Record<string, any> = {};
      detected.baremes.forEach((c) => { const v = num(vals[`bareme:${c}`]); if (v !== undefined) baremes[c] = v; });

      const r = await api.post<{ sorties: Record<string, any>; trace: any[]; avertissements: string[] }>(
        "/paie/regles/tester-manuel",
        { instructions: lignes, seed, rubriques, constantes, cumuls, precedents, baremes },
      );
      setResult(r);
      onResult?.(r);
    } catch (e: any) {
      toast({ title: "Test impossible", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const sortiesList = useMemo(() => {
    if (!result) return [];
    return ATTRS.map((k) => [ATTR_LABEL[k], result.sorties[k]] as const)
      .filter(([, v]) => v !== null && v !== undefined && v !== "");
  }, [result]);

  if (!open) return null;

  const field = (key: string, label: string, hint: string, type = "number") => (
    <div key={key} className="space-y-1">
      <Label className="text-[11px] font-mono text-foreground flex items-center gap-1.5">
        {label}
        <span className="text-[9px] text-muted-foreground font-sans normal-case">{hint}</span>
      </Label>
      <Input type={type} value={vals[key] || ""} onChange={(e) => set(key, e.target.value)}
        placeholder={type === "date" ? "" : "0"} className="h-8 text-xs font-mono" />
    </div>
  );

  const nbInputs = detected.seed.size + [...detected.rubs.values()].reduce((n, s) => n + s.size, 0)
    + detected.consts.size + detected.cumuls.size + detected.precs.size + detected.baremes.size;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-foreground/40 backdrop-blur-sm">
      <div className="w-full max-w-3xl h-full bg-background border-l border-border shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/20">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Simulation de la règle</h3>
            <p className="text-[11px] text-muted-foreground">{regleLibelle || "Bac à sable — aucune écriture en base"}</p>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}><X size={16} /></Button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Valeurs d'entrée ({nbInputs})</Label>
            {nbInputs > 0 && (
              <Button variant="ghost" size="sm" onClick={reset} className="h-7 text-[11px] gap-1"><RefreshCw size={11} /> Réinitialiser</Button>
            )}
          </div>

          {nbInputs === 0 && (
            <div className="text-[12px] text-muted-foreground italic p-3 rounded-lg border border-dashed border-border bg-muted/20">
              Aucune valeur d'entrée à saisir. Cliquez sur « Exécuter » pour lancer directement.
            </div>
          )}

          {detected.seed.size > 0 && (
            <section>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2 flex items-center gap-1.5"><Layers size={12} /> Attributs de la rubrique (départ)</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[...detected.seed].map((a) => field(`seed:${a}`, a, ATTR_LABEL[a], a === "DATE" ? "date" : a === "TEXTE" ? "text" : "number"))}
              </div>
            </section>
          )}

          {detected.rubs.size > 0 && (
            <section>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2 flex items-center gap-1.5"><Link2 size={12} /> Rubriques référencées [CODE]</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[...detected.rubs.entries()].flatMap(([code, attrs]) =>
                  [...attrs].map((a) => field(`rub:${code}:${a}`, `[${code}].${a}`, ATTR_LABEL[a], a === "DATE" ? "date" : a === "TEXTE" ? "text" : "number")))}
              </div>
            </section>
          )}

          {detected.consts.size > 0 && (
            <section>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2 flex items-center gap-1.5"><Hash size={12} /> Constantes #</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[...detected.consts].map((c) => field(`const:${c}`, `#${c}`, "constante"))}
              </div>
            </section>
          )}

          {detected.cumuls.size > 0 && (
            <section>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2 flex items-center gap-1.5"><TrendingUp size={12} /> Cumuls (CUMUL / SOMME / MOYENNE)</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[...detected.cumuls].map((c) => field(`cumul:${c}`, `CUMUL("${c}")`, "cumul annuel"))}
              </div>
            </section>
          )}

          {detected.precs.size > 0 && (
            <section>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2 flex items-center gap-1.5"><History size={12} /> Paies précédentes (PREC)</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[...detected.precs].map((c) => { const [code, n] = c.split(":"); return field(`prec:${c}`, `PREC("${code}",${n})`, `il y a ${n} période(s)`); })}
              </div>
            </section>
          )}

          {detected.baremes.size > 0 && (
            <section>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2 flex items-center gap-1.5"><Table2 size={12} /> Barèmes (BAREME)</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[...detected.baremes].map((c) => field(`bareme:${c}`, `BAREME("${c}")`, "valeur retournée"))}
              </div>
            </section>
          )}

          {result && (
            <section className="space-y-3 pt-2 border-t border-border">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={14} style={{ color: "hsl(var(--success))" }} />
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Résultat</Label>
              </div>
              <div className="rounded-lg p-3" style={{ border: "1px solid hsl(var(--success) / 0.3)", background: "hsl(var(--success) / 0.05)" }}>
                {sortiesList.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground italic">Aucune sortie (affectez MT, NB, TX, BASE, DATE ou TEXTE).</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {sortiesList.map(([lbl, v]) => (
                      <div key={lbl as string} className="rounded-md bg-background/70 px-2.5 py-2">
                        <div className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold">{lbl}</div>
                        <div className="text-base font-mono font-semibold tabular-nums" style={{ color: "hsl(var(--success))" }}>{String(v)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {result.avertissements.length > 0 && (
                <div className="rounded-lg p-2.5 text-[11px]" style={{ border: "1px solid hsl(var(--warning) / 0.3)", background: "hsl(var(--warning) / 0.05)", color: "hsl(var(--warning))" }}>
                  <div className="font-semibold mb-1 flex items-center gap-1.5"><AlertTriangle size={11} /> Avertissements</div>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {[...new Set(result.avertissements)].map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                </div>
              )}

              <details className="rounded-lg border border-border bg-muted/20" open>
                <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Trace d'exécution ({result.trace.length})</summary>
                <ol className="divide-y divide-border">
                  {result.trace.map((s, i) => (
                    <li key={i} className="px-3 py-1.5 text-[11px] font-mono flex items-start gap-2 hover:bg-muted/30 transition-colors">
                      <span className="text-muted-foreground w-6 text-right flex-shrink-0">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <span className="text-foreground break-all">{s.resolu || s.instruction}</span>
                        {s.avert && <div className="mt-0.5" style={{ color: "hsl(var(--warning))" }}>{s.avert}</div>}
                      </div>
                    </li>
                  ))}
                </ol>
              </details>
            </section>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border bg-muted/10 flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground">🔒 Aucune donnée n'est écrite — bac à sable isolé.</p>
          <Button onClick={lancer} disabled={busy} className="gap-1.5" size="sm">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play size={13} />} Exécuter
          </Button>
        </div>
      </div>
    </div>
  );
};

export default SimulationPanel;
