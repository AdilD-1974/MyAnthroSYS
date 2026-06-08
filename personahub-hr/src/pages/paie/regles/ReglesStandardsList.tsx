/**
 * ReglesStandardsList – Catalogue système des règles de calcul standards.
 * Groupé par variable cible (DATE / NOMBRE / MONTANT / TAUX / SPÉCIAUX).
 */
import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Loader2, Lock, Search, Calendar, Hash, DollarSign, Percent, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";

interface RegleStandard {
  code: string;
  libelle: string;
  description: string | null;
  formule_lisible: string;
  attribut_calcule: string;
  variable_cible: string;
  unite: string | null;
  ordre_affichage: number;
}

const GROUPS: { key: string; label: string; icon: React.ElementType; color: string }[] = [
  { key: "DATE",    label: "Calculs sur DATE",    icon: Calendar,   color: "text-sky-600 bg-sky-500/10 border-sky-500/30" },
  { key: "NOMBRE",  label: "Calculs sur NOMBRE",  icon: Hash,       color: "text-blue-600 bg-blue-500/10 border-blue-500/30" },
  { key: "MONTANT", label: "Calculs sur MONTANT", icon: DollarSign, color: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30" },
  { key: "TAUX",    label: "Calculs sur TAUX",    icon: Percent,    color: "text-purple-600 bg-purple-500/10 border-purple-500/30" },
  { key: "SPECIAUX",label: "Règles spéciales",    icon: Sparkles,   color: "text-amber-600 bg-amber-500/10 border-amber-500/30" },
];

const SPECIAL_VARIABLES = ["NEANT", "LOOKUP", "CUMUL"];

const ReglesStandardsList: React.FC = () => {
  const [regles, setRegles] = useState<RegleStandard[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from("ref_regle_calcul_standard")
        .select("*")
        .eq("actif", true)
        .order("ordre_affichage");
      if (!error && data) setRegles(data as any);
      setLoading(false);
    };
    load();
  }, []);

  const filtered = regles.filter(
    (r) =>
      !search ||
      r.libelle.toLowerCase().includes(search.toLowerCase()) ||
      r.code.toLowerCase().includes(search.toLowerCase()) ||
      r.formule_lisible.toLowerCase().includes(search.toLowerCase())
  );

  const groupOf = (r: RegleStandard) =>
    SPECIAL_VARIABLES.includes(r.variable_cible) ? "SPECIAUX" : r.variable_cible;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="animate-spin mr-2" size={18} /> Chargement du catalogue…
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Lock size={15} className="text-muted-foreground" />
            Catalogue système ({regles.length} règles)
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Opérations atomiques prédéfinies non modifiables. Sélectionnables au paramétrage des rubriques.
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Rechercher une règle…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
      </div>

      <div className="space-y-5">
        {GROUPS.map(({ key, label, icon: Icon, color }) => {
          const items = filtered.filter((r) => groupOf(r) === key);
          if (items.length === 0) return null;
          return (
            <section key={key} className="rounded-xl border border-border overflow-hidden">
              <header className={`flex items-center gap-2 px-4 py-2.5 border-b border-border ${color.split(" ")[1]}`}>
                <Icon size={15} className={color.split(" ")[0]} />
                <h3 className={`text-sm font-semibold ${color.split(" ")[0]}`}>{label}</h3>
                <span className="text-[11px] text-muted-foreground ml-auto">{items.length} règle{items.length > 1 ? "s" : ""}</span>
              </header>
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 font-semibold w-44">Code</th>
                    <th className="px-4 py-2 font-semibold">Opération (libellé)</th>
                    <th className="px-4 py-2 font-semibold">Formule lisible</th>
                    <th className="px-4 py-2 font-semibold w-20 text-center">Unité</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((r) => (
                    <tr key={r.code} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5">
                        <code className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-muted text-foreground">{r.code}</code>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-foreground text-[13px]">{r.libelle}</div>
                        {r.description && (
                          <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{r.description}</div>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <code className="text-[11px] font-mono text-accent">{r.formule_lisible}</code>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {r.unite ? (
                          <Badge variant="outline" className="text-[10px]">{r.unite}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-[11px]">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}

        {filtered.length === 0 && (
          <div className="rounded-xl border border-border py-12 text-center text-sm text-muted-foreground">
            Aucune règle ne correspond à la recherche.
          </div>
        )}
      </div>
    </div>
  );
};

export default ReglesStandardsList;
