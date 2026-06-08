/**
 * SimulationPanel — Sandbox d'exécution d'une règle spécifique.
 * Permet de saisir des valeurs d'entrée (accesseurs détectés dans la règle)
 * et d'afficher la trace pas-à-pas + sorties calculées, sans toucher à la prod.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Play, X, AlertTriangle, CheckCircle2, ArrowRight, Sparkles, RefreshCw,
} from "lucide-react";
import { simulateRegle, type SimulationContext, type SimulationResult, type AccessorKind } from "./engine/simulator";

interface Props {
  open: boolean;
  onClose: () => void;
  lignes: Array<{ numero: number; instruction: string; label?: string | null }>;
  regleLibelle?: string;
}

const ACCESSOR_LABELS: Record<AccessorKind, string> = {
  MT: "Montant courant",
  NB: "Nombre courant",
  TY: "Taux courant",
  MTC: "Montant cumulé",
  NBC: "Nombre cumulé",
  MTP: "Montant précédente paie",
  NBP: "Nombre précédente paie",
  TYP: "Taux précédente paie",
  DTP: "Date précédente paie",
};

const ACCESSOR_RE = /\b(MT|NB|TY|MTC|NBC|MTP|NBP|TYP|DTP)\.([A-Z0-9_]+)\b/g;

const SimulationPanel: React.FC<Props> = ({ open, onClose, lignes, regleLibelle }) => {
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [result, setResult] = useState<SimulationResult | null>(null);

  // Détecter tous les accesseurs utilisés dans les instructions
  const detectedAccessors = useMemo(() => {
    const set = new Set<string>();
    lignes.forEach((l) => {
      const matches = l.instruction.matchAll(ACCESSOR_RE);
      for (const m of matches) set.add(`${m[1]}.${m[2]}`);
    });
    return Array.from(set).sort();
  }, [lignes]);

  // Reset inputs quand on ouvre le panneau
  useEffect(() => {
    if (open) {
      setInputs((prev) => {
        const next = { ...prev };
        detectedAccessors.forEach((a) => {
          if (!(a in next)) next[a] = "";
        });
        return next;
      });
      setResult(null);
    }
  }, [open, detectedAccessors]);

  if (!open) return null;

  const runSimulation = () => {
    // Construire le contexte
    const rubriques: SimulationContext["rubriques"] = {};
    detectedAccessors.forEach((a) => {
      const [kind, rub] = a.split(".") as [AccessorKind, string];
      const v = inputs[a];
      if (v === undefined || v === "") return;
      if (!rubriques[kind]) rubriques[kind] = {};
      // DTP = date string, autres = number
      rubriques[kind]![rub] = kind === "DTP" ? v : parseFloat(v) || 0;
    });
    const ctx: SimulationContext = {
      rubriques,
      dateJour: new Date().toISOString().slice(0, 10),
      datePaie: new Date().toISOString().slice(0, 10),
    };
    setResult(simulateRegle(lignes, ctx));
  };

  const resetInputs = () => {
    const cleared: Record<string, string> = {};
    detectedAccessors.forEach((a) => (cleared[a] = ""));
    setInputs(cleared);
    setResult(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-foreground/40 backdrop-blur-sm">
      <div className="w-full max-w-2xl h-full bg-background border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-accent/15 text-accent">
              <Sparkles size={16} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Simulation de la règle</h3>
              <p className="text-[11px] text-muted-foreground">
                {regleLibelle || "Test sandbox — aucune écriture en base"}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>

        {/* Body scrollable */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Inputs */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Valeurs d'entrée ({detectedAccessors.length})
              </Label>
              {detectedAccessors.length > 0 && (
                <Button variant="ghost" size="sm" onClick={resetInputs} className="h-7 text-[11px] gap-1">
                  <RefreshCw size={11} /> Réinitialiser
                </Button>
              )}
            </div>
            {detectedAccessors.length === 0 ? (
              <div className="text-[12px] text-muted-foreground italic p-3 rounded-lg border border-dashed border-border bg-muted/20">
                Aucun accesseur détecté dans la règle. Ajoutez des références (ex: <code className="font-mono">MT.IGRA</code>, <code className="font-mono">NBP.HSUP</code>) puis relancez.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {detectedAccessors.map((a) => {
                  const [kind, rub] = a.split(".") as [AccessorKind, string];
                  return (
                    <div key={a} className="space-y-1">
                      <Label className="text-[11px] font-mono text-foreground flex items-center gap-1.5">
                        {a}
                        <span className="text-[9px] text-muted-foreground font-sans normal-case">
                          {ACCESSOR_LABELS[kind]}
                        </span>
                      </Label>
                      <Input
                        type={kind === "DTP" ? "date" : "number"}
                        step={kind === "TY" || kind === "TYP" ? "0.01" : "1"}
                        value={inputs[a] || ""}
                        onChange={(e) => setInputs({ ...inputs, [a]: e.target.value })}
                        placeholder={kind === "DTP" ? "" : "0"}
                        className="h-8 text-xs font-mono"
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Résultats */}
          {result && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                {result.ok ? (
                  <CheckCircle2 size={14} className="text-emerald-600" />
                ) : (
                  <AlertTriangle size={14} className="text-destructive" />
                )}
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Résultat
                </Label>
              </div>

              {result.erreurGlobale && (
                <div className="text-[12px] text-destructive p-2 rounded border border-destructive/40 bg-destructive/5">
                  {result.erreurGlobale}
                </div>
              )}

              {/* Sorties */}
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                <div className="text-[10px] uppercase tracking-wide text-emerald-700 font-semibold mb-1.5">
                  Sorties calculées
                </div>
                {Object.keys(result.sorties).length === 0 ? (
                  <p className="text-[12px] text-muted-foreground italic">
                    Aucune affectation de sortie (MT, NB, TY, BASE).
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(result.sorties).map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between bg-background/60 rounded px-2 py-1.5">
                        <span className="text-[11px] font-mono text-foreground">{k}</span>
                        <span className="text-sm font-mono font-semibold text-emerald-700">
                          {typeof v === "number" ? v.toLocaleString("fr-MA", { maximumFractionDigits: 4 }) : v}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Registres */}
              {Object.keys(result.registres).length > 0 && (
                <details className="rounded-lg border border-border bg-muted/20" open>
                  <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Registres ({Object.keys(result.registres).length})
                  </summary>
                  <div className="grid grid-cols-3 gap-1.5 p-3 pt-0">
                    {Object.entries(result.registres)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between bg-background rounded px-2 py-1 border border-border">
                          <span className="text-[10px] font-mono text-muted-foreground">{k}</span>
                          <span className="text-[11px] font-mono font-semibold text-foreground">
                            {v.toLocaleString("fr-MA", { maximumFractionDigits: 4 })}
                          </span>
                        </div>
                      ))}
                  </div>
                </details>
              )}

              {/* Trace */}
              <details className="rounded-lg border border-border bg-muted/20">
                <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Trace d'exécution ({result.trace.length})
                </summary>
                <ol className="divide-y divide-border">
                  {result.trace.map((s, idx) => (
                    <li key={idx} className="px-3 py-2 text-[11px] font-mono">
                      <div className="flex items-start gap-2">
                        <span className="text-muted-foreground w-8 flex-shrink-0">{s.numero}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-foreground">{s.instruction}</div>
                          {s.resolu && s.resolu !== s.instruction && (
                            <div className="text-muted-foreground mt-0.5 flex items-center gap-1">
                              <ArrowRight size={9} />
                              <span className="break-all">{s.resolu}</span>
                            </div>
                          )}
                          {s.affectation && (
                            <Badge variant="secondary" className="mt-1 text-[9px] font-mono">
                              {s.affectation.cible} = {String(s.affectation.valeur)}
                            </Badge>
                          )}
                          {s.branchement && (
                            <Badge
                              variant={s.branchement.pris ? "default" : "outline"}
                              className="mt-1 ml-1 text-[9px] font-mono"
                            >
                              {s.branchement.pris ? "✓" : "✗"} BRANCH {s.branchement.vers}
                            </Badge>
                          )}
                          {s.erreur && (
                            <div className="text-[10px] text-amber-600 mt-1 flex items-center gap-1">
                              <AlertTriangle size={9} /> {s.erreur}
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </details>
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border bg-muted/10 flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground">
            🔒 Aucune donnée n'est écrite — environnement de test isolé.
          </p>
          <Button onClick={runSimulation} className="gap-1.5" size="sm">
            <Play size={13} /> Lancer la simulation
          </Button>
        </div>
      </div>
    </div>
  );
};

export default SimulationPanel;