/**
 * src/hooks/useCascadePlanPeriode.ts
 *
 * Résout le plan de paie ACTIF d'un collaborateur (table collaborateur_plan_paie
 * — trouvée en lisant TraitementPaiePage.tsx, qui fait exactement cette
 * résolution), puis charge les périodes de ce plan et expose la cascade
 * Année → Période. Mirror fidèle de la logique déjà en place dans
 * TraitementPaiePage.tsx (lignes 277-319), pour ne pas dupliquer un
 * comportement différent entre écrans.
 *
 * Différence volontaire avec TraitementPaiePage : ici on ne garde que les
 * périodes OUVERTE (RG-SIM-PERIODE-01, demandée explicitement pour les
 * écrans Simulation) — TraitementPaiePage montre toutes les périodes avec
 * un badge d'avertissement sur les non-ouvertes. Passer `toutesPeriodes`
 * à true pour retrouver ce comportement si besoin d'alignement complet.
 */
import { useEffect, useState } from "react";
import { db } from "@/lib/api";

export type Plan = { id: string; code: string; libelle: string };
export type Periode = {
  id: string;
  annee: number;
  mois: number;
  plan_paie_id: string | null;
  statut: string;
  numero_periode: number;
  date_ouverture?: string | null;
};

export function useCascadePlanPeriode(collaborateurId: string, toutesPeriodes = false) {
  const [planActif, setPlanActif] = useState<Plan | null>(null);
  const [periodesPlan, setPeriodesPlan] = useState<Periode[]>([]);
  const [annee, setAnnee] = useState<number | null>(null);
  const [periodeId, setPeriodeId] = useState<string>("");
  const [resolution, setResolution] = useState(false);

  useEffect(() => {
    setPlanActif(null);
    setPeriodesPlan([]);
    setAnnee(null);
    setPeriodeId("");
    if (!collaborateurId) return;

    (async () => {
      setResolution(true);
      try {
        const today = new Date().toISOString().slice(0, 10);
        const liens = await db.list<{ plan_paie_id: string; date_debut: string; date_fin: string | null }>(
          "collaborateur_plan_paie",
          { collaborateur_id: collaborateurId, archive: false, select: "plan_paie_id,date_debut,date_fin", order: "-date_debut" }
        );
        const actif = liens.find((l) => l.date_debut <= today && (!l.date_fin || l.date_fin >= today)) || liens[0];
        if (!actif) return; // aucun plan actif — planActif reste null, l'appelant affiche l'état vide

        const plan = await db.findOne<Plan>("plan_paie", { id: actif.plan_paie_id, select: "id,code,libelle" });
        setPlanActif(plan);

        const filtreStatut = toutesPeriodes ? {} : { statut: "OUVERTE" };
        const pers = await db.list<Periode>("calendrier_paie", {
          plan_paie_id: actif.plan_paie_id,
          ...filtreStatut,
          select: "id,annee,mois,plan_paie_id,statut,numero_periode,date_ouverture",
          order: "-annee",
          limit: 600,
        });
        pers.sort((a, b) => a.annee - b.annee || a.mois - b.mois);
        setPeriodesPlan(pers);

        const anneesDispo = Array.from(new Set(pers.map((p) => p.annee))).sort((a, b) => b - a);
        setAnnee(anneesDispo[0] ?? null);
      } finally {
        setResolution(false);
      }
    })();
  }, [collaborateurId, toutesPeriodes]);

  const anneesDispo = Array.from(new Set(periodesPlan.map((p) => p.annee))).sort((a, b) => b - a);
  const periodesAnnee = periodesPlan.filter((p) => p.annee === annee);

  function changerAnnee(an: number) {
    setAnnee(an);
    setPeriodeId(periodesPlan.find((p) => p.annee === an)?.id ?? "");
  }

  return { planActif, resolution, anneesDispo, periodesAnnee, annee, changerAnnee, periodeId, setPeriodeId };
}
