/**
 * src/components/paie/simulation/PeriodePicker.tsx
 *
 * Reconstruit après lecture de TraitementPaiePage.tsx : le plan de paie
 * n'est PLUS un choix manuel — il est résolu automatiquement depuis le
 * collaborateur sélectionné (table collaborateur_plan_paie, découverte en
 * lisant la vraie logique de cascade déjà en place). Affiché en lecture
 * seule, exactement comme le fait TraitementPaiePage.
 *
 * RG-SIM-PERIODE-01 (toujours en vigueur pour la Simulation, différence
 * volontaire avec TraitementPaiePage) : seules les périodes OUVERTE sont
 * proposées — voir useCascadePlanPeriode.
 */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCascadePlanPeriode } from "@/hooks/useCascadePlanPeriode";

const MOIS = ["", "Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];

interface PeriodePickerProps {
  collaborateurId: string;
  periodeId: string;
  onChange: (periodeId: string) => void;
}

export function PeriodePicker({ collaborateurId, periodeId, onChange }: PeriodePickerProps) {
  const { planActif, resolution, anneesDispo, periodesAnnee, annee, changerAnnee } =
    useCascadePlanPeriode(collaborateurId);

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Plan de paie</label>
        <div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm">
          {!collaborateurId ? (
            <span className="text-muted-foreground">—</span>
          ) : resolution ? (
            <span className="text-muted-foreground">Résolution…</span>
          ) : planActif ? (
            <span className="font-medium">
              {planActif.code}
              <span className="text-muted-foreground font-normal"> · {planActif.libelle}</span>
            </span>
          ) : (
            <span style={{ color: "hsl(var(--warning))" }}>Aucun plan actif</span>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Année</label>
        <Select value={annee ? String(annee) : ""} onValueChange={(v) => changerAnnee(Number(v))} disabled={!planActif}>
          <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            {anneesDispo.map((an) => (
              <SelectItem key={an} value={String(an)}>{an}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Période</label>
        <Select value={periodeId} onValueChange={onChange} disabled={!planActif || !annee}>
          <SelectTrigger><SelectValue placeholder="Sélectionner…" /></SelectTrigger>
          <SelectContent>
            {periodesAnnee.map((p) => (
              <SelectItem key={p.id} value={p.id}>{MOIS[p.mois]} {p.annee}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {planActif && periodesAnnee.length === 0 && (
          <p className="text-xs text-muted-foreground">Aucune période ouverte pour cette année.</p>
        )}
      </div>
    </div>
  );
}
