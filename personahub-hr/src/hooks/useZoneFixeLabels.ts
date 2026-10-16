import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * RG-ZONEFIXE-LABELS-02 (Adil DAIA) : charge les associations zone_fixe →
 * rubrique depuis rubrique_paie_alimentation (le mécanisme "Alimentation des
 * rubriques", Table=collaborateur_salaires_fixes + Champ=zone_fixe_XX,
 * configuré depuis RubriqueForm.tsx), PAS depuis l'ancien champ
 * rubrique_paie.zone_fixe_key — devenu orphelin depuis que ce champ a été
 * retiré de l'écran Rubrique (plus aucune rubrique ne peut plus l'alimenter
 * depuis l'UI). Ne retient que les zones alimentant une rubrique ACTIVE
 * (traiter=true, archive=false) — cohérent avec la vérification d'unicité
 * faite côté RubriqueForm.tsx (RG-RUB-ZONEFIXE-UNICITE-01).
 */
export function useZoneFixeLabels() {
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: alimentations } = await supabase
        .from("rubrique_paie_alimentation" as never)
        .select("code_rubrique, donnee_source" as never)
        .eq("table_source" as never, "collaborateur_salaires_fixes" as never)
        .like("donnee_source" as never, "zone_fixe_%" as never);

      const alim = (alimentations as any[]) || [];
      if (alim.length === 0) {
        setLabels({});
        setLoading(false);
        return;
      }

      const codes = Array.from(new Set(alim.map((a) => a.code_rubrique)));
      const { data: rubriques } = await supabase
        .from("rubrique_paie" as never)
        .select("code, libelle, traiter, archive" as never)
        .in("code" as never, codes as never);

      const actives = new Map<string, string>(
        ((rubriques as any[]) || [])
          .filter((r) => r.traiter && !r.archive)
          .map((r) => [r.code, r.libelle])
      );

      const result: Record<string, string> = {};
      for (const a of alim) {
        const libelle = actives.get(a.code_rubrique);
        if (libelle) result[a.donnee_source] = libelle;
      }

      setLabels(result);
      setLoading(false);
    })();
  }, []);

  return { labels, loading };
}
