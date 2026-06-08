/**
 * ReglesCotisationList – CRUD des règles de cotisation (regle_calcul_cotisation).
 * Auteur : Adil DAIA
 *
 * Une règle de cotisation = un régime (CNSS, AMO, IR…) + une assiette + des taux salarial/patronal.
 * À chaque collaborateur (ou population) on peut affecter un ou plusieurs régimes.
 */
import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Pencil, Trash2, Search, Power, Info, Users } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useTableSort } from "@/hooks/useTableSort";
import RegleCotisationForm from "./RegleCotisationForm";

interface Regime { code: string; libelle: string; organisme: string | null; }

interface RegleCotisation {
  id: string;
  code: string;
  libelle: string;
  description: string | null;
  code_regime: string | null;
  code_rubrique_assiette: string | null;
  taux_salarial: number | null;
  taux_patronal: number | null;
  plafond_mensuel: number | null;
  date_debut_validite: string | null;
  date_fin_validite: string | null;
  actif: boolean;
  archive: boolean;
  // RG-COTIS-COMPO-01 : agrégats des composantes
  nb_composantes?: number;
  total_taux_salarial?: number;
  total_taux_patronal?: number;
}

const ReglesCotisationList: React.FC = () => {
  const [regimes, setRegimes] = useState<Regime[]>([]);
  const [regles, setRegles] = useState<RegleCotisation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterRegime, setFilterRegime] = useState<string>("all");
  const [editId, setEditId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: regs }, { data: r }, { data: compos }] = await Promise.all([
      supabase.from("ref_regime_cotisation" as never)
        .select("code,libelle,organisme").eq("actif" as never, true as never).order("ordre" as never),
      supabase.from("regle_calcul_cotisation" as never)
        .select("*").eq("archive" as never, false as never).order("code_regime" as never).order("code" as never),
      supabase.from("regle_calcul_cotisation_composante" as never)
        .select("id_regle,taux_salarial,taux_patronal").eq("actif" as never, true as never),
    ]);
    setRegimes((regs || []) as Regime[]);
    // Agréger par règle
    const aggregates: Record<string, { nb: number; ts: number; tp: number }> = {};
    ((compos || []) as any[]).forEach(c => {
      const k = c.id_regle;
      if (!aggregates[k]) aggregates[k] = { nb: 0, ts: 0, tp: 0 };
      aggregates[k].nb += 1;
      aggregates[k].ts += Number(c.taux_salarial || 0);
      aggregates[k].tp += Number(c.taux_patronal || 0);
    });
    const enriched = ((r || []) as RegleCotisation[]).map(reg => ({
      ...reg,
      nb_composantes: aggregates[reg.id]?.nb || 0,
      total_taux_salarial: aggregates[reg.id]?.ts || 0,
      total_taux_patronal: aggregates[reg.id]?.tp || 0,
    }));
    setRegles(enriched);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleToggleActif = async (r: RegleCotisation) => {
    const { error } = await supabase.from("regle_calcul_cotisation" as never)
      .update({ actif: !r.actif } as never).eq("id" as never, r.id as never);
    if (error) toast({ title: "Erreur", description: error.message, variant: "destructive" });
    else { toast({ title: r.actif ? "Règle désactivée" : "Règle activée" }); load(); }
  };

  const handleDelete = async (r: RegleCotisation) => {
    if (!confirm(`Archiver la règle "${r.libelle}" ?`)) return;
    const { error } = await supabase.from("regle_calcul_cotisation" as never)
      .update({ archive: true } as never).eq("id" as never, r.id as never);
    if (error) toast({ title: "Erreur", description: error.message, variant: "destructive" });
    else { toast({ title: "Règle archivée" }); load(); }
  };

  // RG-REACT-HOOKS-01 (Adil DAIA) : Tous les hooks doivent être appelés AVANT
  // tout return conditionnel (sinon "Rendered fewer hooks than expected").
  const labelRegime = (c: string | null) => regimes.find(r => r.code === c)?.libelle || c || "";

  const filtered = regles.filter(r =>
    (filterRegime === "all" || r.code_regime === filterRegime) &&
    (!search ||
      r.libelle.toLowerCase().includes(search.toLowerCase()) ||
      r.code.toLowerCase().includes(search.toLowerCase()))
  );

  // Tri tri-état au clic sur les colonnes
  const { sortedData, toggleSort, SortIcon } = useTableSort(filtered, {
    getValue: (row, key) => key === "regime" ? labelRegime(row.code_regime) : row[key],
  });

  // Early return AFTER all hooks
  if (showForm) {
    return (
      <RegleCotisationForm
        editId={editId}
        regimes={regimes}
        onBack={() => { setShowForm(false); setEditId(null); load(); }}
      />
    );
  }

  return (
    <div>
      {/* Header + info régime */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Règles de cotisation ({regles.length})</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Cotisations sociales et fiscales (CNSS, AMO, IR…) — chaque règle peut regrouper plusieurs composantes (PF, LCT, CT…).
          </p>
        </div>
        <Button size="sm" onClick={() => { setEditId(null); setShowForm(true); }} className="gap-1.5">
          <Plus size={14} /> Nouvelle règle
        </Button>
      </div>

      <div className="mb-3 flex items-start gap-2 px-3 py-2 rounded-lg text-xs"
        style={{ background: "hsl(var(--muted)/0.4)", color: "hsl(var(--muted-foreground))" }}>
        <Info size={12} className="mt-0.5 flex-shrink-0" />
        <span>
          L'affectation d'un collaborateur à un régime de cotisation se fait depuis sa fiche
          (onglet Cotisations & Régimes). Une même règle peut s'appliquer à plusieurs régimes via le sélecteur ci-dessous.
        </span>
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Rechercher…" value={search} onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm" />
        </div>
        <select value={filterRegime} onChange={e => setFilterRegime(e.target.value)}
          className="h-9 px-3 rounded-md border text-sm bg-background border-border text-foreground">
          <option value="all">Tous les régimes</option>
          {regimes.map(r => <option key={r.code} value={r.code}>{r.libelle}</option>)}
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="animate-spin mr-2" size={16} /> Chargement…
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th onClick={() => toggleSort("code")} className="px-4 py-2.5 font-semibold cursor-pointer select-none hover:text-foreground transition-colors">
                  Code <SortIcon column="code" />
                </th>
                <th onClick={() => toggleSort("libelle")} className="px-4 py-2.5 font-semibold cursor-pointer select-none hover:text-foreground transition-colors">
                  Libellé <SortIcon column="libelle" />
                </th>
                <th onClick={() => toggleSort("regime")} className="px-4 py-2.5 font-semibold cursor-pointer select-none hover:text-foreground transition-colors">
                  Régime <SortIcon column="regime" />
                </th>
                <th onClick={() => toggleSort("nb_composantes")} className="px-4 py-2.5 font-semibold cursor-pointer select-none hover:text-foreground transition-colors text-center">
                  Composantes <SortIcon column="nb_composantes" />
                </th>
                <th onClick={() => toggleSort("total_taux_salarial")} className="px-4 py-2.5 font-semibold cursor-pointer select-none hover:text-foreground transition-colors text-right">
                  Total Sal. <SortIcon column="total_taux_salarial" />
                </th>
                <th onClick={() => toggleSort("total_taux_patronal")} className="px-4 py-2.5 font-semibold cursor-pointer select-none hover:text-foreground transition-colors text-right">
                  Total Pat. <SortIcon column="total_taux_patronal" />
                </th>
                <th onClick={() => toggleSort("actif")} className="px-4 py-2.5 font-semibold w-20 cursor-pointer select-none hover:text-foreground transition-colors">
                  Statut <SortIcon column="actif" />
                </th>
                <th className="px-4 py-2.5 font-semibold w-32 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedData.map(r => (
                <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <code className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-muted">{r.code}</code>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{r.libelle}</div>
                    {r.description && <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{r.description}</div>}
                  </td>
                  <td className="px-4 py-3">
                    {r.code_regime ? (
                      <Badge variant="outline" className="text-[10px]">{labelRegime(r.code_regime)}</Badge>
                    ) : <span className="text-muted-foreground text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant="secondary" className="text-[10px] font-mono">
                      {r.nb_composantes || 0}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">
                    {r.total_taux_salarial ? `${Number(r.total_taux_salarial).toFixed(2)} %` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">
                    {r.total_taux_patronal ? `${Number(r.total_taux_patronal).toFixed(2)} %` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={r.actif ? "default" : "secondary"} className="text-[10px]">
                      {r.actif ? "Actif" : "Inactif"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleToggleActif(r)} title={r.actif ? "Désactiver" : "Activer"}>
                        <Power size={13} />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7"
                        onClick={() => { setEditId(r.id); setShowForm(true); }} title="Modifier">
                        <Pencil size={13} />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(r)} title="Archiver">
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {sortedData.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    Aucune règle de cotisation. Cliquez sur « Nouvelle règle » pour en créer une.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default ReglesCotisationList;
