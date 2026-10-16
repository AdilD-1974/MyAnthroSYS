// src/components/prets/SimulateurPret.tsx
//
// Composant réutilisé par MesPretsPage.tsx (onglet "Simulateur") et par
// NouvelleDemandeDialog.tsx. Purement dans le style existant (bordures,
// classes utilitaires nues, pas de composants shadcn additionnels non déjà
// utilisés dans MesPretsPage.tsx pour rester cohérent).
import React, { useEffect, useState } from "react";
import * as LucideIcons from "lucide-react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  pretsApi, TypePret, SimulationPretResponse,
  formatMontant, formatDate,
} from "@/lib/pretsApi";

const DynIcon: React.FC<{ name?: string; size?: number; color?: string }> = ({
  name = "Banknote", size = 16, color,
}) => {
  const Icon = (LucideIcons as Record<string, any>)[name];
  return Icon ? <Icon size={size} color={color} /> : <LucideIcons.Banknote size={size} color={color} />;
};

export interface SimulateurPretProps {
  /** Type pré-sélectionné (ex. ouverture depuis "Faire une demande" sur un type précis). */
  typeCodeInitial?: string;
  /** Affiche le bouton "Adopter cette simulation" et remonte le résultat au parent. */
  showAdopter?: boolean;
  onAdopter?: (params: { type_code: string; montant: number; nb_echeance: number; date_premiere_echeance: string }) => void;
}

const SimulateurPret: React.FC<SimulateurPretProps> = ({ typeCodeInitial, showAdopter, onAdopter }) => {
  const [types, setTypes] = useState<TypePret[]>([]);
  const [typeCode, setTypeCode] = useState(typeCodeInitial ?? "");
  const [montant, setMontant] = useState("");
  const [nbEcheance, setNbEcheance] = useState("");
  const [datePremiere, setDatePremiere] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1, 1);
    return d.toISOString().slice(0, 10);
  });

  const [simulation, setSimulation] = useState<SimulationPretResponse | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    pretsApi.listerTypes(true).then(setTypes).catch(() => setErreur("Impossible de charger les types de prêt."));
  }, []);

  const typeSelectionne = types.find(t => t.code === typeCode) ?? null;

  useEffect(() => {
    setSimulation(null);
    setErreur(null);
    const montantNum = Number(montant);
    const nbEcheanceNum = Number(nbEcheance);
    if (!typeCode || !montantNum || montantNum <= 0 || !nbEcheanceNum || nbEcheanceNum <= 0 || !datePremiere) return;

    const timeout = setTimeout(() => {
      setChargement(true);
      pretsApi.simuler({ type_code: typeCode, montant: montantNum, nb_echeance: nbEcheanceNum, date_premiere_echeance: datePremiere })
        .then(setSimulation)
        .catch((e: any) => setErreur(e?.message ?? "Erreur lors de la simulation."))
        .finally(() => setChargement(false));
    }, 400);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeCode, montant, nbEcheance, datePremiere]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="text-xs text-muted-foreground mb-1 block">Type de prêt</label>
          <select
            className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
            value={typeCode}
            onChange={e => setTypeCode(e.target.value)}
          >
            <option value="">Sélectionnez un type</option>
            {types.map(t => (
              <option key={t.code} value={t.code}>
                {t.libelle} {t.taux_annuel_defaut === 0 ? "(taux 0%)" : `(${t.taux_annuel_defaut}%/an)`}
              </option>
            ))}
          </select>
          {typeSelectionne && (
            <div className="flex items-center gap-1.5 mt-1 text-[11px] text-muted-foreground">
              <DynIcon name={typeSelectionne.icone} size={12} color={typeSelectionne.couleur} />
              {typeSelectionne.description ?? `Durée max. ${typeSelectionne.duree_max_mois} mois`}
              {typeSelectionne.montant_max ? ` · Plafond ${formatMontant(typeSelectionne.montant_max)}` : ""}
            </div>
          )}
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Montant souhaité</label>
          <input
            type="number" min={0} step="0.01"
            className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
            value={montant} onChange={e => setMontant(e.target.value)}
            placeholder="Montant (DH)"
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Durée (mensualités)</label>
          <input
            type="number" min={1}
            className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
            value={nbEcheance} onChange={e => setNbEcheance(e.target.value)}
            placeholder="Nombre de mois"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="text-xs text-muted-foreground mb-1 block">Date de la première échéance</label>
          <input
            type="date"
            className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
            value={datePremiere} onChange={e => setDatePremiere(e.target.value)}
          />
        </div>
      </div>

      {chargement && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={13} className="animate-spin" /> Calcul en cours…
        </div>
      )}

      {erreur && (
        <div className="flex items-center gap-2 text-xs text-destructive">
          <AlertTriangle size={13} /> {erreur}
        </div>
      )}

      {simulation && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Mensualité", value: formatMontant(simulation.mensualite_theorique) },
              { label: "Nb échéances", value: String(simulation.nb_echeance_retenu) },
              { label: "Coût des intérêts", value: formatMontant(simulation.cout_total_interets) },
              { label: "Taux annuel", value: `${simulation.taux_annuel}%` },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-md border border-border bg-secondary/20 p-2.5 text-center">
                <p className="text-[10px] text-muted-foreground">{label}</p>
                <p className="text-sm font-semibold">{value}</p>
              </div>
            ))}
          </div>

          {simulation.avertissements.length > 0 && (
            <div
              className="rounded-md p-2.5 text-xs space-y-1"
              style={{
                border: "1px solid hsl(var(--warning) / 0.3)",
                background: "hsl(var(--warning) / 0.08)",
                color: "hsl(var(--warning))",
              }}
            >
              {simulation.avertissements.map((a, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" /> {a}
                </div>
              ))}
            </div>
          )}

          <div className="max-h-56 overflow-y-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead className="bg-secondary/40 sticky top-0">
                <tr>
                  {["N°", "Échéance", "Capital", "Intérêt", "Mensualité", "Restant"].map(h => (
                    <th key={h} className="px-2.5 py-1.5 text-left font-medium text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {simulation.echeancier.map(e => (
                  <tr key={e.numero} className="border-t border-border">
                    <td className="px-2.5 py-1">{e.numero}</td>
                    <td className="px-2.5 py-1">{formatDate(e.date_echeance)}</td>
                    <td className="px-2.5 py-1">{formatMontant(e.mt_capital)}</td>
                    <td className="px-2.5 py-1 text-muted-foreground">{formatMontant(e.mt_interet)}</td>
                    <td className="px-2.5 py-1 font-medium">{formatMontant(e.mt_total)}</td>
                    <td className="px-2.5 py-1 text-muted-foreground">{formatMontant(e.capital_restant)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {showAdopter && (
            <button
              type="button"
              className="h-8 px-3 text-[13px] font-medium rounded-[var(--radius)]"
              style={{ background: "hsl(var(--primary))", color: "white" }}
              onClick={() => onAdopter?.({
                type_code: typeCode,
                montant: Number(montant),
                nb_echeance: simulation.nb_echeance_retenu,
                date_premiere_echeance: datePremiere,
              })}
            >
              Adopter cette simulation
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default SimulateurPret;
