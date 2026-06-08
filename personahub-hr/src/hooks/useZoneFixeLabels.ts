import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Charge les associations zone_fixe → rubrique depuis rubrique_paie.zone_fixe_key
 * et retourne un map clé → libellé de la rubrique.
 */
export function useZoneFixeLabels() {
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("rubrique_paie" as never)
        .select("code, libelle, zone_fixe_key" as never)
        .not("zone_fixe_key" as never, "is" as never, null as never);

      const result: Record<string, string> = {};
      if (data) {
        for (const r of data as any[]) {
          if (r.zone_fixe_key) {
            result[r.zone_fixe_key] = r.libelle;
          }
        }
      }

      setLabels(result);
      setLoading(false);
    })();
  }, []);

  return { labels, loading };
}
