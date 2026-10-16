// src/pages/prets/self-service/NouvelleDemandePage.tsx
//
// Dossier fonctionnel §4.1 : le collaborateur choisit un type de prêt, saisit
// montant + durée, voit une simulation instantanée du tableau d'amortissement,
// puis soumet sa demande (éligibilité vérifiée côté serveur avant soumission).
//
// Hypothèses de style non vérifiables depuis cet environnement : composants
// shadcn/ui (Card, Button, Input, Select, Alert) déjà présents dans le
// projet, comme évoqué pour RubriqueForm.tsx / AppearancePage.tsx. Ajuster
// les chemins d'import si votre structure diffère.
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import {
  pretsApi, type TypePret, type SimulationPretResponse,
  type VerificationEligibiliteResponse,
} from "@/lib/pretsApi";

function formatMontant(v: number): string {
  return new Intl.NumberFormat("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
}

export default function NouvelleDemandePage() {
  const [types, setTypes] = useState<TypePret[]>([]);
  const [typeCode, setTypeCode] = useState<string>("");
  const [montant, setMontant] = useState<string>("");
  const [nbEcheance, setNbEcheance] = useState<string>("");
  const [datePremiere, setDatePremiere] = useState<string>(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1, 1);
    return d.toISOString().slice(0, 10);
  });

  const [simulation, setSimulation] = useState<SimulationPretResponse | null>(null);
  const [eligibilite, setEligibilite] = useState<VerificationEligibiliteResponse | null>(null);
  const [chargementSimulation, setChargementSimulation] = useState(false);
  const [chargementSoumission, setChargementSoumission] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const typeSelectionne = useMemo(
    () => types.find((t) => t.code === typeCode) ?? null,
    [types, typeCode],
  );

  useEffect(() => {
    pretsApi.listerTypes(true).then(setTypes).catch(() => setErreur("Impossible de charger les types de prêt disponibles."));
  }, []);

  useEffect(() => {
    setSimulation(null);
    setEligibilite(null);
    setErreur(null);
    setConfirmation(null);

    const montantNum = Number(montant);
    const nbEcheanceNum = Number(nbEcheance);
    if (!typeCode || !montantNum || montantNum <= 0 || !nbEcheanceNum || nbEcheanceNum <= 0 || !datePremiere) {
      return;
    }

    const timeout = setTimeout(() => {
      setChargementSimulation(true);
      pretsApi
        .simuler({ type_code: typeCode, montant: montantNum, nb_echeance: nbEcheanceNum, date_premiere_echeance: datePremiere })
        .then(setSimulation)
        .catch((e) => setErreur(e?.message ?? "Erreur lors de la simulation."))
        .finally(() => setChargementSimulation(false));
    }, 400); // debounce léger — évite un appel réseau par frappe

    return () => clearTimeout(timeout);
  }, [typeCode, montant, nbEcheance, datePremiere]);

  async function verifierEligibilite() {
    if (!typeCode || !simulation) return;
    setErreur(null);
    try {
      const resultat = await pretsApi.verifierEligibilite({
        type_code: typeCode,
        montant: Number(montant),
        nb_echeance: Number(nbEcheance),
        date_premiere_echeance: datePremiere,
      });
      setEligibilite(resultat);
    } catch (e: any) {
      setErreur(e?.message ?? "Erreur lors de la vérification d'éligibilité.");
    }
  }

  async function soumettre() {
    if (!typeCode) return;
    setChargementSoumission(true);
    setErreur(null);
    try {
      await pretsApi.soumettreDemande({
        type_code: typeCode,
        montant: Number(montant),
        nb_echeance: Number(nbEcheance),
        date_premiere_echeance: datePremiere,
      });
      setConfirmation("Votre demande a bien été soumise. Vous serez notifié à chaque étape de validation.");
    } catch (e: any) {
      setErreur(e?.message ?? "Erreur lors de la soumission de la demande.");
    } finally {
      setChargementSoumission(false);
    }
  }

  const bloqueParEligibilite = eligibilite !== null && !eligibilite.eligible;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nouvelle demande de prêt</h1>
        <p className="text-sm text-muted-foreground">
          Choisissez un type de prêt, simulez votre échéancier, puis soumettez votre demande.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Votre demande</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="type-pret">Type de prêt</Label>
            <Select value={typeCode} onValueChange={setTypeCode}>
              <SelectTrigger id="type-pret">
                <SelectValue placeholder="Sélectionnez un type de prêt" />
              </SelectTrigger>
              <SelectContent>
                {types.map((t) => (
                  <SelectItem key={t.code} value={t.code}>
                    {t.libelle}
                    {t.taux_annuel_defaut === 0 ? " (taux 0%)" : ` (${t.taux_annuel_defaut}%/an)`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {typeSelectionne?.description && (
              <p className="text-xs text-muted-foreground">{typeSelectionne.description}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="montant">Montant souhaité</Label>
            <Input
              id="montant" type="number" min={0} step="0.01" value={montant}
              onChange={(e) => setMontant(e.target.value)}
              placeholder={typeSelectionne?.montant_max ? `Max. ${formatMontant(typeSelectionne.montant_max)}` : "Montant"}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="duree">Durée (nombre de mensualités)</Label>
            <Input
              id="duree" type="number" min={1} value={nbEcheance}
              onChange={(e) => setNbEcheance(e.target.value)}
              placeholder={typeSelectionne ? `Max. ${typeSelectionne.duree_max_mois} mois` : "Durée en mois"}
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="date-premiere">Date de la première échéance</Label>
            <Input
              id="date-premiere" type="date" value={datePremiere}
              onChange={(e) => setDatePremiere(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {chargementSimulation && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Calcul de la simulation...
        </div>
      )}

      {simulation && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Simulation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Mensualité" value={`${formatMontant(simulation.mensualite_theorique)} DH`} />
              <Stat label="Nombre d'échéances" value={String(simulation.nb_echeance_retenu)} />
              <Stat label="Coût total des intérêts" value={`${formatMontant(simulation.cout_total_interets)} DH`} />
              <Stat label="Taux annuel" value={`${simulation.taux_annuel}%`} />
            </div>

            {simulation.avertissements.length > 0 && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>À noter</AlertTitle>
                <AlertDescription>
                  {simulation.avertissements.map((a, i) => <div key={i}>{a}</div>)}
                </AlertDescription>
              </Alert>
            )}

            <div className="max-h-80 overflow-y-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">N°</th>
                    <th className="px-3 py-2">Échéance</th>
                    <th className="px-3 py-2 text-right">Capital</th>
                    <th className="px-3 py-2 text-right">Intérêt</th>
                    <th className="px-3 py-2 text-right">Mensualité</th>
                    <th className="px-3 py-2 text-right">Capital restant</th>
                  </tr>
                </thead>
                <tbody>
                  {simulation.echeancier.map((e) => (
                    <tr key={e.numero} className="border-t">
                      <td className="px-3 py-1.5">{e.numero}</td>
                      <td className="px-3 py-1.5">{e.date_echeance}</td>
                      <td className="px-3 py-1.5 text-right">{formatMontant(e.mt_capital)}</td>
                      <td className="px-3 py-1.5 text-right">{formatMontant(e.mt_interet)}</td>
                      <td className="px-3 py-1.5 text-right font-medium">{formatMontant(e.mt_total)}</td>
                      <td className="px-3 py-1.5 text-right text-muted-foreground">{formatMontant(e.capital_restant)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={verifierEligibilite}>
                Vérifier mon éligibilité
              </Button>
              <Button onClick={soumettre} disabled={chargementSoumission || bloqueParEligibilite}>
                {chargementSoumission && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Soumettre la demande
              </Button>
            </div>

            {eligibilite && (
              <div className="space-y-2">
                {eligibilite.resultats.map((r) => (
                  <div
                    key={r.code_regle}
                    className={`flex items-start gap-2 rounded-md border p-2 text-sm ${
                      r.respectee ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"
                    }`}
                  >
                    {r.respectee
                      ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />}
                    <div>
                      <div className="font-medium">{r.libelle}</div>
                      <div className="text-muted-foreground">{r.message}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {erreur && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Erreur</AlertTitle>
          <AlertDescription>{erreur}</AlertDescription>
        </Alert>
      )}

      {confirmation && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Demande soumise</AlertTitle>
          <AlertDescription>{confirmation}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
