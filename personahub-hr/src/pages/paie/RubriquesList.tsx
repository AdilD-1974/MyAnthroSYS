/**
 * RubriquesList – Liste des rubriques de paie avec filtres et export.
 */
import React, { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Settings, Plus, Pencil, Trash2, Loader2, Download, Search, ChevronDown, ChevronUp, Copy } from "lucide-react";
import * as XLSX from "xlsx";
import { useTableSort } from "@/hooks/useTableSort";
import { setListNavigationContext } from "@/hooks/useListNavigationContext";
import MultiSelectFilter from "@/components/paie/MultiSelectFilter";

interface Ref { code: string; libelle: string }
interface Rubrique {
  code: string; libelle: string; libelle_edition: string | null; description: string | null;
  code_famille: string | null; code_flux: string | null; code_type: string | null; code_frequence: string | null;
  frequence_calcul: string; frequence_raz_cumuls: string;
  date_debut: string | null; date_fin: string | null;
  traiter: boolean; simulation: boolean; v_batch: boolean; v_externe: boolean; v_ajout: boolean;
  v_forcage: boolean; v_regularisation: boolean; v_glissant: boolean; v_historique: boolean; pr_cumulee: boolean;
  ordre_calcul: number | null; conditionnee: boolean; code_regle: string | null; archive: boolean;
}

const FREQ_LABELS: Record<string, string> = {
  MENSUELLE: "Mensuelle", PERIODIQUE: "Périodique", TRIMESTRIELLE: "Trimestrielle",
  SEMESTRIELLE: "Semestrielle", ANNUELLE: "Annuelle",
};
interface Imputation {
  id?: string; code_rubrique: string; numero_imputation: number; code_compte: string; sens: string;
}

const BOOL_FLAGS: { key: keyof Rubrique; label: string }[] = [
  { key: "traiter", label: "Traiter" }, { key: "simulation", label: "Simulation" },
  { key: "v_batch", label: "Batch" }, { key: "v_externe", label: "Externe" },
  { key: "v_ajout", label: "Ajout" }, { key: "v_forcage", label: "Forçage" },
  { key: "v_regularisation", label: "Régul." }, { key: "v_glissant", label: "Glissant" },
  { key: "v_historique", label: "Historique" }, { key: "pr_cumulee", label: "Pr.Cumulée" },
  { key: "conditionnee", label: "Conditionnée" },
];

// Couleurs par type de rubrique
const getCodeColorClass = (codeType: string | null): string => {
  switch (codeType) {
    case "ASS": // Assiette
      return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border border-blue-200 dark:border-blue-800";
    case "CALC": // Calculée
      return "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 border border-purple-200 dark:border-purple-800";
    case "BASE": // Base
      return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-800";
    case "COT": // Cotisation
      return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 border border-orange-200 dark:border-orange-800";
    case "ALIM": // Alimentation
      return "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-800";
    default:
      return "bg-accent/10 text-accent border border-accent/20";
  }
};

interface Props {
  onNew: () => void;
  onEdit: (code: string) => void;
  onDuplicate: (code: string) => void;
}

const RubriquesList: React.FC<Props> = ({ onNew, onEdit, onDuplicate }) => {
  const [rubriques, setRubriques] = useState<Rubrique[]>([]);
  const [familles, setFamilles] = useState<Ref[]>([]);
  const [types, setTypes] = useState<Ref[]>([]);
  const [flux, setFlux] = useState<Ref[]>([]);
  const [frequences, setFrequences] = useState<Ref[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  // RG-FILTER-MULTI-01 (Adil DAIA — 07/05/2026) : filtres multi-sélection
  const [filterFamille, setFilterFamille] = useState<string[]>([]);
  const [filterType, setFilterType] = useState<string[]>([]);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [imputations, setImputations] = useState<Imputation[]>([]);

  const loadAll = async () => {
    setLoading(true);
    const [rRes, fRes, tRes, flRes, frRes] = await Promise.all([
      supabase.from("rubrique_paie" as never).select("*").order("code"),
      supabase.from("ref_famille_rubrique_paie" as never).select("code,libelle").eq("actif" as never, true as never),
      supabase.from("ref_type_rubrique_paie" as never).select("code,libelle").eq("actif" as never, true as never),
      supabase.from("ref_flux_rubrique_paie" as never).select("code,libelle").eq("actif" as never, true as never),
      supabase.from("ref_frequence_rubrique_paie" as never).select("code,libelle").eq("actif" as never, true as never),
    ]);
    if (rRes.data) setRubriques(rRes.data as Rubrique[]);
    if (fRes.data) setFamilles(fRes.data as Ref[]);
    if (tRes.data) setTypes(tRes.data as Ref[]);
    if (flRes.data) setFlux(flRes.data as Ref[]);
    if (frRes.data) setFrequences(frRes.data as Ref[]);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  const loadImputations = async (code: string) => {
    const data = []; const error = null; // Supabase desactive
    setImputations((data || []) as Imputation[]);
  };

  const filtered = useMemo(() => {
    let list = rubriques;
    if (filterFamille.length > 0) list = list.filter(r => filterFamille.includes(r.code_famille));
    if (filterType.length > 0) list = list.filter(r => filterType.includes(r.code_type));
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(r => r.code.toLowerCase().includes(s) || r.libelle.toLowerCase().includes(s));
    }
    return list;
  }, [rubriques, filterFamille, filterType, search]);

  // RG-RUB-SORT-01 (Adil DAIA — 07/05/2026) : Tri tri-état au clic sur en-tête
  const { sortedData: sorted, toggleSort, SortIcon } = useTableSort(filtered, {
    getValue: (row, key) => (row as any)[key],
  });

  const refLabel = (refs: Ref[], code: string | null) => refs.find(r => r.code === code)?.libelle || code || "—";

  const deleteRubrique = async (code: string) => {
    if (!confirm("Supprimer cette rubrique ?")) return;
    await supabase.from("rubrique_paie" as never).delete().eq("code" as never, code as never);
    loadAll();
  };

  const toggleExpand = (code: string) => {
    if (expandedRow === code) { setExpandedRow(null); return; }
    setExpandedRow(code);
    loadImputations(code);
  };

  const exportExcel = () => {
    const data = filtered.map(r => ({
      Code: r.code, Libellé: r.libelle, "Lib. Édition": r.libelle_edition || "",
      Famille: refLabel(familles, r.code_famille), Type: refLabel(types, r.code_type),
      Flux: refLabel(flux, r.code_flux), Fréquence: refLabel(frequences, r.code_frequence),
      "Fréq. Calcul": FREQ_LABELS[r.frequence_calcul] || r.frequence_calcul,
      "Fréq. RAZ": FREQ_LABELS[r.frequence_raz_cumuls] || r.frequence_raz_cumuls,
      "Date début": r.date_debut || "", "Date fin": r.date_fin || "",
      Traiter: r.traiter ? "Oui" : "Non", Simulation: r.simulation ? "Oui" : "Non",
      "Ordre calcul": r.ordre_calcul ?? "", Règle: r.code_regle || "",
      Description: r.description || "", Archive: r.archive ? "Oui" : "Non",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rubriques Paie");
    XLSX.writeFile(wb, "rubriques_paie_export.xlsx");
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-accent/10">
            <Settings size={20} className="text-accent" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Rubriques de paie</h1>
            <p className="text-xs text-muted-foreground">Liste des rubriques, familles, types et imputations comptables</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportExcel}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 transition-colors">
            <Download size={14} /> Exporter
          </button>
          <button onClick={onNew}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-white hover:bg-accent/90 transition-colors">
            <Plus size={14} /> Nouvelle rubrique
          </button>
        </div>
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher..."
            className="pl-9 pr-3 py-2 rounded-lg border text-sm outline-none bg-background text-foreground border-border w-56" />
        </div>
        <MultiSelectFilter
          label="Familles"
          options={familles.map(f => ({ value: f.code, label: f.libelle }))}
          selected={filterFamille}
          onChange={setFilterFamille}
        />
        <MultiSelectFilter
          label="Types"
          options={types.map(t => ({ value: t.code, label: t.libelle }))}
          selected={filterType}
          onChange={setFilterType}
        />
        <span className="self-center text-xs text-muted-foreground">{filtered.length} rubrique(s)</span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-accent" />
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground w-8" />
                <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("code")}>Code <SortIcon column="code" /></th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("libelle")}>Libellé <SortIcon column="libelle" /></th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("code_famille")}>Famille <SortIcon column="code_famille" /></th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("code_type")}>Type <SortIcon column="code_type" /></th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("code_flux")}>Flux <SortIcon column="code_flux" /></th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("code_frequence")}>Fréq. <SortIcon column="code_frequence" /></th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("ordre_affichage")}>Ordre <SortIcon column="ordre_affichage" /></th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("a_traiter")}>Traiter <SortIcon column="a_traiter" /></th>
                <th className="px-3 py-3 w-20" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <React.Fragment key={r.code}>
                  <tr
                    className={`border-b border-border cursor-pointer ${i % 2 === 0 ? "bg-card" : "bg-muted/15"} hover:bg-accent/5 transition-colors`}
                    onClick={() => {
                      setListNavigationContext("rubriques", sorted.map(x => x.code));
                      onEdit(r.code);
                    }}
                  >
                    <td className="px-3 py-3" onClick={e => { e.stopPropagation(); toggleExpand(r.code); }}>
                      <button className="p-1 rounded hover:bg-muted">
                        {expandedRow === r.code ? <ChevronUp size={12} className="text-muted-foreground" /> : <ChevronDown size={12} className="text-muted-foreground" />}
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`font-mono text-xs px-1.5 py-0.5 rounded ${getCodeColorClass(r.code_type)}`}>
                        {r.code}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-medium text-foreground">{r.libelle}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{refLabel(familles, r.code_famille)}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{refLabel(types, r.code_type)}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{refLabel(flux, r.code_flux)}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{refLabel(frequences, r.code_frequence)}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{r.ordre_calcul ?? "—"}</td>
                    <td className="px-3 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${r.traiter ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-muted text-muted-foreground"}`}>
                        {r.traiter ? "Oui" : "Non"}
                      </span>
                    </td>
                    <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <button onClick={() => {
                      setListNavigationContext("rubriques", sorted.map(x => x.code));
                      onEdit(r.code);
                    }} className="p-1.5 rounded hover:bg-muted" title="Modifier">
                          <Pencil size={12} className="text-muted-foreground" />
                        </button>
                        <button onClick={() => onDuplicate(r.code)} className="p-1.5 rounded hover:bg-muted" title="Dupliquer">
                          <Copy size={12} className="text-muted-foreground" />
                        </button>
                        <button onClick={() => deleteRubrique(r.code)} className="p-1.5 rounded hover:bg-muted" title="Supprimer">
                          <Trash2 size={12} className="text-destructive" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandedRow === r.code && (
                    <tr className="bg-muted/10 border-b border-border" onClick={e => e.stopPropagation()}>
                      <td colSpan={10} className="px-6 py-4">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-3">
                          <div><span className="text-xs text-muted-foreground">Lib. édition:</span> <span className="text-xs text-foreground font-medium ml-1">{r.libelle_edition || "—"}</span></div>
                          <div><span className="text-xs text-muted-foreground">Règle:</span> <span className="text-xs text-foreground font-medium ml-1">{r.code_regle || "—"}</span></div>
                          <div><span className="text-xs text-muted-foreground">Date début:</span> <span className="text-xs text-foreground font-medium ml-1">{r.date_debut || "—"}</span></div>
                          <div><span className="text-xs text-muted-foreground">Date fin:</span> <span className="text-xs text-foreground font-medium ml-1">{r.date_fin || "—"}</span></div>
                          <div><span className="text-xs text-muted-foreground">Fréq. calcul:</span> <span className="text-xs font-medium ml-1 px-1.5 py-0.5 rounded bg-accent/10 text-accent">{FREQ_LABELS[r.frequence_calcul] || r.frequence_calcul}</span></div>
                          <div><span className="text-xs text-muted-foreground">Fréq. RAZ:</span> <span className="text-xs font-medium ml-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">{FREQ_LABELS[r.frequence_raz_cumuls] || r.frequence_raz_cumuls}</span></div>
                        </div>
                        <div className="flex flex-wrap gap-2 mb-3">
                          {BOOL_FLAGS.map(({ key, label }) => (
                            <span key={key} className={`text-xs px-2 py-0.5 rounded-full ${r[key] ? "bg-accent/10 text-accent" : "bg-muted/50 text-muted-foreground"}`}>
                              {label}: {r[key] ? "✓" : "✗"}
                            </span>
                          ))}
                        </div>
                        {r.description && <p className="text-xs text-muted-foreground mb-3">{r.description}</p>}
                        <div>
                          <p className="text-xs font-semibold text-foreground mb-2">Imputations comptables</p>
                          {imputations.length === 0 ? (
                            <p className="text-xs text-muted-foreground">Aucune imputation</p>
                          ) : (
                            <table className="text-xs border border-border rounded">
                              <thead>
                                <tr className="bg-muted/30">
                                  <th className="px-3 py-1 text-left text-muted-foreground">N°</th>
                                  <th className="px-3 py-1 text-left text-muted-foreground">Compte</th>
                                  <th className="px-3 py-1 text-left text-muted-foreground">Sens</th>
                                </tr>
                              </thead>
                              <tbody>
                                {imputations.map(imp => (
                                  <tr key={imp.numero_imputation} className="border-t border-border">
                                    <td className="px-3 py-1">{imp.numero_imputation}</td>
                                    <td className="px-3 py-1 font-mono">{imp.code_compte}</td>
                                    <td className="px-3 py-1">{imp.sens === "D" ? "Débit" : "Crédit"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Aucune rubrique trouvée
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default RubriquesList;
