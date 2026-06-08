/**
 * SalairesFixesPage – Vue globale de tous les éléments fixes de salaire.
 */
import React, { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CreditCard, Search, Download, Loader2, Eye } from "lucide-react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { useZoneFixeLabels } from "@/hooks/useZoneFixeLabels";

const ALL_ZONE_KEYS = [
  "zone_fixe_01", "zone_fixe_02", "zone_fixe_03", "zone_fixe_04", "zone_fixe_05",
  "zone_fixe_06", "zone_fixe_07", "zone_fixe_08", "zone_fixe_09", "zone_fixe_10",
  "zone_fixe_11", "zone_fixe_12", "zone_fixe_13", "zone_fixe_14", "zone_fixe_15",
  "zone_fixe_16", "zone_fixe_17", "zone_fixe_18", "zone_fixe_19", "zone_fixe_20",
] as const;

interface SalaireRow {
  id: string;
  collaborateur_id: string;
  date_debut: string;
  date_fin: string | null;
  salaire_base: number;
  salaire_horaire: number | null;
  salaire_journalier: number | null;
  prime_anciennete: number | null;
  prime_logement: number | null;
  prime_transport: number | null;
  indemnite_fonction: number | null;
  indemnite_representation: number | null;
  indemnite_caisse: number | null;
  indemnite_risque: number | null;
  indemnite_telephone: number | null;
  allocation_familiale: number | null;
  zone_fixe_01: number | null; zone_fixe_02: number | null; zone_fixe_03: number | null;
  zone_fixe_04: number | null; zone_fixe_05: number | null; zone_fixe_06: number | null;
  zone_fixe_07: number | null; zone_fixe_08: number | null; zone_fixe_09: number | null;
  zone_fixe_10: number | null; zone_fixe_11: number | null; zone_fixe_12: number | null;
  zone_fixe_13: number | null; zone_fixe_14: number | null; zone_fixe_15: number | null;
  zone_fixe_16: number | null; zone_fixe_17: number | null; zone_fixe_18: number | null;
  zone_fixe_19: number | null; zone_fixe_20: number | null;
  decision_ref: string | null;
  commentaire: string | null;
  matricule?: string;
  nom?: string;
  prenom?: string;
}

const SalairesFixesPage: React.FC = () => {
  const [rows, setRows] = useState<SalaireRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterEnCours, setFilterEnCours] = useState(true);
  const navigate = useNavigate();
  const { labels: zoneLabels } = useZoneFixeLabels();

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("collaborateur_salaires_fixes" as never)
        .select("*, collaborateurs!collaborateur_salaires_fixes_collaborateur_id_fkey(matricule, nom, prenom)" as never)
        .eq("archive" as never, false as never)
        .order("date_debut" as never, { ascending: false });

      const mapped = ((data || []) as any[]).map(r => ({
        ...r,
        matricule: r.collaborateurs?.matricule,
        nom: r.collaborateurs?.nom,
        prenom: r.collaborateurs?.prenom,
      }));
      setRows(mapped);
      setLoading(false);
    })();
  }, []);

  const fmt = (v?: number | null) =>
    v != null ? new Intl.NumberFormat("fr-MA", { minimumFractionDigits: 2 }).format(v) : "—";

  const filtered = useMemo(() => {
    let list = rows;
    if (filterEnCours) {
      list = list.filter(r => !r.date_fin || new Date(r.date_fin) >= new Date());
    }
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(r =>
        (r.matricule || "").toLowerCase().includes(s) ||
        (r.nom || "").toLowerCase().includes(s) ||
        (r.prenom || "").toLowerCase().includes(s)
      );
    }
    return list;
  }, [rows, filterEnCours, search]);

  const totalMasse = useMemo(() => filtered.reduce((acc, r) => acc + (r.salaire_base || 0), 0), [filtered]);

  // Only show zones linked to rubriques
  const activeZones = useMemo(() => {
    return ALL_ZONE_KEYS.filter(k => !!zoneLabels[k]);
  }, [zoneLabels]);

  const zfLabel = (key: string) => zoneLabels[key] || key;

  const exportExcel = () => {
    const data = filtered.map(r => {
      const row: Record<string, any> = {
        Matricule: r.matricule || "", Nom: r.nom || "", Prénom: r.prenom || "",
        "Date début": r.date_debut || "", "Date fin": r.date_fin || "En cours",
        "Salaire base": r.salaire_base, "Salaire horaire": r.salaire_horaire ?? "",
        "Prime ancienneté": r.prime_anciennete ?? "", "Prime logement": r.prime_logement ?? "",
        "Prime transport": r.prime_transport ?? "",
        "Ind. fonction": r.indemnite_fonction ?? "", "Ind. représentation": r.indemnite_representation ?? "",
        "Ind. caisse": r.indemnite_caisse ?? "", "Ind. risque": r.indemnite_risque ?? "",
        "Ind. téléphone": r.indemnite_telephone ?? "",
        "Alloc. familiale": r.allocation_familiale ?? "",
      };
      for (const k of activeZones) {
        row[zfLabel(k)] = (r as any)[k] ?? "";
      }
      row["Réf. décision"] = r.decision_ref || "";
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Salaires Fixes");
    XLSX.writeFile(wb, "salaires_fixes_export.xlsx");
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-accent/10">
            <CreditCard size={20} className="text-accent" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Éléments fixes du salaire</h1>
            <p className="text-xs text-muted-foreground">Vue globale de la masse salariale fixe</p>
          </div>
        </div>
        <button onClick={exportExcel}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20 transition-colors">
          <Download size={14} /> Exporter
        </button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl border border-border p-4 bg-card">
          <p className="text-xs text-muted-foreground mb-1">Total collaborateurs</p>
          <p className="text-2xl font-bold text-foreground">{new Set(filtered.map(r => r.collaborateur_id)).size}</p>
        </div>
        <div className="rounded-xl border border-border p-4 bg-card">
          <p className="text-xs text-muted-foreground mb-1">Lignes de salaire</p>
          <p className="text-2xl font-bold text-foreground">{filtered.length}</p>
        </div>
        <div className="rounded-xl border border-border p-4 bg-card">
          <p className="text-xs text-muted-foreground mb-1">Masse salariale de base</p>
          <p className="text-2xl font-bold text-primary">{fmt(totalMasse)}</p>
        </div>
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher par matricule, nom…"
            className="pl-9 pr-3 py-2 rounded-lg border text-sm outline-none bg-background text-foreground border-border w-64" />
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
          <input type="checkbox" checked={filterEnCours} onChange={e => setFilterEnCours(e.target.checked)}
            className="rounded border-border" />
          Salaires en cours uniquement
        </label>
        <span className="self-center text-xs text-muted-foreground">{filtered.length} enregistrement(s)</span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-accent" />
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground">Matricule</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground">Collaborateur</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground">Période</th>
                <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground">Salaire base</th>
                <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground">Pr. ancienneté</th>
                <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground">Pr. transport</th>
                <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground">Ind. fonction</th>
                <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground">Alloc. fam.</th>
                {activeZones.map(k => (
                  <th key={k} className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground">
                    {zfLabel(k)}
                  </th>
                ))}
                <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground">Réf.</th>
                <th className="px-3 py-3 w-12" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={r.id} className={`border-b border-border ${i % 2 === 0 ? "bg-card" : "bg-muted/15"} hover:bg-accent/5 transition-colors`}>
                  <td className="px-3 py-3 font-mono text-xs text-accent font-semibold">#{r.matricule}</td>
                  <td className="px-3 py-3 font-medium text-foreground">{r.nom} {r.prenom}</td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    {r.date_debut ? new Date(r.date_debut).toLocaleDateString("fr-FR") : ""} — {r.date_fin ? new Date(r.date_fin).toLocaleDateString("fr-FR") : "En cours"}
                  </td>
                  <td className="px-3 py-3 text-right font-semibold text-foreground">{fmt(r.salaire_base)}</td>
                  <td className="px-3 py-3 text-right text-muted-foreground">{fmt(r.prime_anciennete)}</td>
                  <td className="px-3 py-3 text-right text-muted-foreground">{fmt(r.prime_transport)}</td>
                  <td className="px-3 py-3 text-right text-muted-foreground">{fmt(r.indemnite_fonction)}</td>
                  <td className="px-3 py-3 text-right text-muted-foreground">{fmt(r.allocation_familiale)}</td>
                  {activeZones.map(k => (
                    <td key={k} className="px-3 py-3 text-right text-muted-foreground">{fmt((r as any)[k])}</td>
                  ))}
                  <td className="px-3 py-3 text-xs text-muted-foreground">{r.decision_ref || "—"}</td>
                  <td className="px-3 py-3">
                    <button onClick={() => navigate(`/collaborateurs/${r.collaborateur_id}`)}
                      className="p-1.5 rounded hover:bg-muted" title="Voir fiche">
                      <Eye size={13} className="text-muted-foreground" />
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10 + activeZones.length} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Aucun salaire fixe trouvé
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

export default SalairesFixesPage;
