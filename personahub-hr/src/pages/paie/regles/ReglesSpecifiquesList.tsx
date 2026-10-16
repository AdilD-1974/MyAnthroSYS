/**
 * ReglesSpecifiquesList – Bibliothèque CRUD des règles de calcul spécifiques.
 */
import React, { useEffect, useState } from "react";
import { db } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Pencil, Trash2, Copy, Search, Power, Sparkles, Hash, Percent, Wallet } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useTableSort } from "@/hooks/useTableSort";
import RegleSpecifiqueForm from "./RegleSpecifiqueForm";

interface RegleSpecifique {
  id: string;
  code: string;
  libelle: string;
  description: string | null;
  attribut_calcule: string;
  expression: string;
  date_debut_validite: string | null;
  date_fin_validite: string | null;
  decision_reference: string | null;
  actif: boolean;
}

// Une teinte du thème par type de sortie — jamais de palette Tailwind figée,
// pour que ça suive l'apparence choisie par chaque utilisateur (clair/sombre
// et couleur d'accent), cohérent avec le reste de l'écran des règles.
const ATTRIBUT_STYLE: Record<string, { token: string; Icone: React.ElementType }> = {
  NOMBRE:  { token: "--info",    Icone: Hash },
  TAUX:    { token: "--accent",  Icone: Percent },
  MONTANT: { token: "--success", Icone: Wallet },
};
const attributStyle = (a: string): React.CSSProperties => {
  const token = ATTRIBUT_STYLE[a]?.token || "--muted-foreground";
  return { background: `hsl(var(${token}) / 0.12)`, color: `hsl(var(${token}))`, borderColor: `hsl(var(${token}) / 0.25)` };
};

const ReglesSpecifiquesList: React.FC = () => {
  const [regles, setRegles] = useState<RegleSpecifique[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "NOMBRE" | "TAUX" | "MONTANT">("all");
  const [editId, setEditId] = useState<string | null>(null);
  const [duplicateId, setDuplicateId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await db.list<any>("regle_calcul_specifique", { archive: false, select: "*", order: "-created_at" });
      setRegles(data as any);
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleToggleActif = async (r: RegleSpecifique) => {
    try {
      await db.update("regle_calcul_specifique", { id: r.id }, { actif: !r.actif });
      toast({ title: "Statut modifié", description: `Règle ${!r.actif ? "activée" : "désactivée"}.` });
      load();
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    }
  };

  const handleDelete = async (r: RegleSpecifique) => {
    if (!confirm(`Supprimer la règle "${r.libelle}" ?`)) return;
    try {
      await db.update("regle_calcul_specifique", { id: r.id }, { archive: true });
      toast({ title: "Règle supprimée" });
      load();
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    }
  };

  // RG-REACT-HOOKS-01 : tous les hooks avant tout return conditionnel.
  const filtered = regles.filter(
    (r) =>
      (filter === "all" || r.attribut_calcule === filter) &&
      (!search ||
        r.libelle.toLowerCase().includes(search.toLowerCase()) ||
        r.code.toLowerCase().includes(search.toLowerCase()))
  );

  const { sortedData, toggleSort, SortIcon } = useTableSort(filtered, {
    getValue: (row, key) => row[key as keyof RegleSpecifique],
  });

  if (showForm) {
    return (
      <RegleSpecifiqueForm
        editId={editId}
        duplicateId={duplicateId}
        onBack={() => {
          setShowForm(false);
          setEditId(null);
          setDuplicateId(null);
          load();
        }}
      />
    );
  }

  const nbActives = regles.filter((r) => r.actif).length;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Sparkles size={16} className="text-accent" /> Règles spécifiques
            <span className="text-sm font-normal text-muted-foreground">
              ({regles.length}, {nbActives} active{nbActives > 1 ? "s" : ""})
            </span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Bibliothèque métier réutilisable pour vos rubriques de paie.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditId(null);
            setDuplicateId(null);
            setShowForm(true);
          }}
          className="gap-1.5"
        >
          <Plus size={14} /> Nouvelle règle
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Rechercher un code ou un libellé…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
        <div className="flex items-center gap-1">
          {(["all", "NOMBRE", "TAUX", "MONTANT"] as const).map((f) => {
            const actifFiltre = filter === f;
            const style = f !== "all" ? attributStyle(f) : undefined;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className="px-3 py-1.5 text-xs font-medium rounded-md border transition-colors"
                style={
                  actifFiltre
                    ? (style ?? { background: "hsl(var(--accent))", color: "hsl(var(--accent-foreground))", borderColor: "hsl(var(--accent))" })
                    : { background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }
                }
              >
                {f === "all" ? "Tous" : f}
              </button>
            );
          })}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="animate-spin mr-2" size={16} /> Chargement…
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead style={{ background: "hsl(var(--muted) / 0.5)" }}>
              <tr className="text-left text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                <th onClick={() => toggleSort("code")} className="px-4 py-2.5 w-32 cursor-pointer select-none hover:text-foreground transition-colors">
                  Code <SortIcon column="code" />
                </th>
                <th onClick={() => toggleSort("libelle")} className="px-4 py-2.5 cursor-pointer select-none hover:text-foreground transition-colors">
                  Libellé <SortIcon column="libelle" />
                </th>
                <th onClick={() => toggleSort("attribut_calcule")} className="px-4 py-2.5 w-32 cursor-pointer select-none hover:text-foreground transition-colors">
                  Calcule <SortIcon column="attribut_calcule" />
                </th>
                <th onClick={() => toggleSort("actif")} className="px-4 py-2.5 w-24 cursor-pointer select-none hover:text-foreground transition-colors">
                  Statut <SortIcon column="actif" />
                </th>
                <th className="px-4 py-2.5 w-32 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedData.map((r) => {
                const meta = ATTRIBUT_STYLE[r.attribut_calcule];
                const Icone = meta?.Icone;
                return (
                  <tr
                    key={r.id}
                    className="hover:bg-muted/40 transition-colors cursor-pointer"
                    style={{ borderLeft: `3px solid ${meta ? `hsl(var(${meta.token}) / 0.5)` : "transparent"}` }}
                    onDoubleClick={() => { setEditId(r.id); setDuplicateId(null); setShowForm(true); }}
                    title="Double-cliquez pour modifier"
                  >
                    <td className="px-4 py-3">
                      <code className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-accent/10" style={{ color: "hsl(var(--accent))" }}>{r.code}</code>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{r.libelle}</div>
                      {r.description && <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{r.description}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border"
                        style={attributStyle(r.attribut_calcule)}
                      >
                        {Icone && <Icone size={10} />} {r.attribut_calcule}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={r.actif ? "default" : "secondary"} className="text-[10px]">
                        {r.actif ? "Actif" : "Inactif"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-0.5">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleToggleActif(r)} title={r.actif ? "Désactiver" : "Activer"}>
                          <Power size={13} style={{ color: "hsl(var(--warning))" }} />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setDuplicateId(r.id); setEditId(null); setShowForm(true); }} title="Dupliquer">
                          <Copy size={13} style={{ color: "hsl(var(--info))" }} />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditId(r.id); setDuplicateId(null); setShowForm(true); }} title="Modifier">
                          <Pencil size={13} style={{ color: "hsl(var(--accent))" }} />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(r)} title="Supprimer">
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {sortedData.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-14 text-center">
                    <Sparkles size={22} className="mx-auto mb-2 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">
                      {regles.length === 0 ? "Aucune règle spécifique." : "Aucune règle ne correspond à cette recherche."}
                    </p>
                    {regles.length === 0 && (
                      <button
                        className="text-primary underline text-sm mt-1"
                        onClick={() => { setEditId(null); setDuplicateId(null); setShowForm(true); }}
                      >
                        Créer la première règle
                      </button>
                    )}
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

export default ReglesSpecifiquesList;
