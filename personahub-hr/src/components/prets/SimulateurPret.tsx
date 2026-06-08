// SimulateurPret.tsx — Simulateur d'amortissement (interne & externe)
// src/components/prets/SimulateurPret.tsx
//
// Supporte les 3 algorithmes : amortissement à la française, linéaire, in fine
// Affiche : mensualité, total remboursé, coût du crédit, tableau complet
// Utilisable seul ou embarqué dans un formulaire de demande

import React, { useState, useCallback } from "react";
import { Calculator, Info, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  pretsApi, SimulationResult, ALGO_LABELS, formatMontant, formatDate,
  type PretAlgo,
} from "@/lib/pretsApi";

interface SimulateurPretProps {
  /** Montant pré-rempli (depuis le formulaire parent) */
  montantInitial?: number;
  nbEcheancesInitial?: number;
  tauxInitial?: number;
  algoInitial?: PretAlgo;
  /** Plafonds issus de pret_configuration */
  montantMax?: number;
  dureeMaxMois?: number;
  /** Callback : l'utilisateur adopte les paramètres simulés pour sa demande */
  onAdopter?: (p: { montant: number; nb_echeances: number; taux: number; algo: PretAlgo }) => void;
  showAdopter?: boolean;
  /** Mode compact (embarqué dans une modale) */
  compact?: boolean;
}

const SimulateurPret: React.FC<SimulateurPretProps> = ({
  montantInitial = 10000,
  nbEcheancesInitial = 12,
  tauxInitial = 0,
  algoInitial = "french_amortissement",
  montantMax = 100000,
  dureeMaxMois = 48,
  onAdopter,
  showAdopter = false,
  compact = false,
}) => {
  const [montant, setMontant] = useState(montantInitial);
  const [nb, setNb] = useState(nbEcheancesInitial);
  const [taux, setTaux] = useState(tauxInitial);
  const [algo, setAlgo] = useState<PretAlgo>(algoInitial);

  const [result, setResult] = useState<SimulationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTableau, setShowTableau] = useState(false);

  const depasse = montant > montantMax;
  const depasseDuree = nb > dureeMaxMois;

  const simuler = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await pretsApi.simuler({
        montant,
        nb_echeances: nb,
        taux_annuel: taux,
        algo,
      });
      setResult(r);
      setShowTableau(false);
    } catch {
      setError("Erreur lors de la simulation.");
    } finally {
      setLoading(false);
    }
  }, [montant, nb, taux, algo]);

  return (
    <div className="space-y-4">
      {/* Paramètres */}
      <div className={`grid gap-3 ${compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4"}`}>
        <div>
          <Label className="text-xs mb-1.5 block">Montant (MAD)</Label>
          <Input
            type="number" value={montant} min={100} max={montantMax} step={500}
            onChange={e => setMontant(Number(e.target.value))}
            className={depasse ? "border-destructive focus-visible:ring-destructive" : ""}
          />
          {depasse && <p className="text-[11px] text-destructive mt-0.5">Max : {formatMontant(montantMax)}</p>}
        </div>

        <div>
          <Label className="text-xs mb-1.5 block">Durée (mois)</Label>
          <Input
            type="number" value={nb} min={1} max={dureeMaxMois} step={1}
            onChange={e => setNb(Number(e.target.value))}
            className={depasseDuree ? "border-destructive focus-visible:ring-destructive" : ""}
          />
          {depasseDuree && <p className="text-[11px] text-destructive mt-0.5">Max : {dureeMaxMois} mois</p>}
        </div>

        <div>
          <Label className="text-xs mb-1.5 block">Taux annuel (%)</Label>
          <Input
            type="number" value={taux} min={0} max={30} step={0.25}
            onChange={e => setTaux(Number(e.target.value))}
          />
        </div>

        <div>
          <Label className="text-xs mb-1.5 block">Algorithme</Label>
          <Select value={algo} onValueChange={v => setAlgo(v as PretAlgo)}>
            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(ALGO_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {taux === 0 && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info size={11} />
          Taux à 0% → remboursement linéaire sans coût du crédit (avantage en nature calculé côté RH si interne)
        </div>
      )}

      <Button
        size="sm" className="gap-1.5"
        onClick={simuler}
        disabled={loading || depasse || depasseDuree || montant <= 0 || nb <= 0}
      >
        <Calculator size={13} />
        {loading ? "Calcul…" : "Simuler"}
      </Button>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Résultats */}
      {result && (
        <div className="rounded-lg border bg-card overflow-hidden">
          {/* Résumé 3 chiffres */}
          <div className="grid grid-cols-3 divide-x">
            <div className="p-3 text-center">
              <p className="text-[11px] text-muted-foreground mb-0.5">Mensualité</p>
              <p className="text-base font-semibold">{formatMontant(result.mensualite)}</p>
            </div>
            <div className="p-3 text-center">
              <p className="text-[11px] text-muted-foreground mb-0.5">Total remboursé</p>
              <p className="text-base font-semibold">{formatMontant(result.total_rembourse)}</p>
            </div>
            <div className="p-3 text-center">
              <p className="text-[11px] text-muted-foreground mb-0.5">Coût du crédit</p>
              <p className={`text-base font-semibold ${result.cout_credit > 0 ? "text-orange-600" : "text-green-600"}`}>
                {result.cout_credit > 0 ? formatMontant(result.cout_credit) : "Gratuit"}
              </p>
            </div>
          </div>

          {/* Tableau détaillé */}
          <div className="border-t px-3 py-2">
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-primary hover:underline"
              onClick={() => setShowTableau(v => !v)}
            >
              {showTableau ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              {showTableau ? "Masquer" : "Voir"} le tableau d'amortissement complet
              ({result.echeances.length} lignes)
            </button>
          </div>

          {showTableau && (
            <div className="border-t max-h-56 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-secondary/50 sticky top-0">
                  <tr>
                    {["N°", "Échéance", "Capital dû", "Capital", "Intérêts", "Total mois", "Restant"].map(h => (
                      <th key={h} className="px-2 py-1.5 text-right first:text-left font-medium text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.echeances.map(e => (
                    <tr key={e.numero} className="border-t hover:bg-secondary/30">
                      <td className="px-2 py-1">{e.numero}</td>
                      <td className="px-2 py-1 text-right">{formatDate(e.date_echeance)}</td>
                      <td className="px-2 py-1 text-right">{formatMontant(e.capital_du)}</td>
                      <td className="px-2 py-1 text-right">{formatMontant(e.mt_capital)}</td>
                      <td className="px-2 py-1 text-right text-muted-foreground">{formatMontant(e.mt_interet)}</td>
                      <td className="px-2 py-1 text-right font-medium">{formatMontant(e.mt_capital + e.mt_interet)}</td>
                      <td className="px-2 py-1 text-right text-muted-foreground">{formatMontant(e.capital_restant)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-secondary/30 font-medium text-xs border-t">
                  <tr>
                    <td className="px-2 py-1.5" colSpan={3}>Total</td>
                    <td className="px-2 py-1.5 text-right">{formatMontant(result.echeances.reduce((s,e) => s + e.mt_capital, 0))}</td>
                    <td className="px-2 py-1.5 text-right text-orange-600">{formatMontant(result.echeances.reduce((s,e) => s + e.mt_interet, 0))}</td>
                    <td className="px-2 py-1.5 text-right">{formatMontant(result.total_rembourse)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Bouton adopter */}
          {showAdopter && onAdopter && (
            <div className="border-t p-3">
              <Button
                size="sm" variant="default" className="w-full"
                onClick={() => onAdopter({ montant, nb_echeances: nb, taux, algo })}
              >
                Utiliser ces paramètres pour ma demande
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SimulateurPret;
