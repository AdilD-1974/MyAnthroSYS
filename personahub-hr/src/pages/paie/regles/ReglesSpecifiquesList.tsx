/**
 * ReglesSpecifiquesList – Bibliothèque CRUD des règles de calcul spécifiques.
 */
import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Pencil, Trash2, Copy, Search, Power } from "lucide-react";
import { toast } from "@/hooks/use-toast";
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

const ATTRIBUT_COLORS: Record<string, string> = {
  NOMBRE: "bg-blue-500/10 text-blue-600 border-blue-500/30",
  TAUX: "bg-purple-500/10 text-purple-600 border-purple-500/30",
  MONTANT: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
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
    const { data, error } = await supabase
      .from("regle_calcul_specifique")
      .select("*")
      .eq("archive", false)
      .order("created_at", { ascending: false });
    if (!error && data) setRegles(data as any);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleToggleActif = async (r: RegleSpecifique) => {
    const { error } = await supabase
      .from("regle_calcul_specifique")
      .update({ actif: !r.actif })
      .eq("id", r.id);
    if (error) {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Statut modifié", description: `Règle ${!r.actif ? "activée" : "désactivée"}.` });
      load();
    }
  };

  const handleDelete = async (r: RegleSpecifique) => {
    if (!confirm(`Supprimer la règle "${r.libelle}" ?`)) return;
    const { error } = await supabase
      .from("regle_calcul_specifique")
      .update({ archive: true })
      .eq("id", r.id);
    if (error) {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Règle supprimée" });
      load();
    }
  };

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

  const filtered = regles.filter(
    (r) =>
      (filter === "all" || r.attribut_calcule === filter) &&
      (!search ||
        r.libelle.toLowerCase().includes(search.toLowerCase()) ||
        r.code.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Règles spécifiques ({regles.length})</h2>
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
            placeholder="Rechercher…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
        <div className="flex items-center gap-1">
          {(["all", "NOMBRE", "TAUX", "MONTANT"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                filter === f ? "bg-accent text-accent-foreground border-accent" : "bg-background border-border hover:bg-muted"
              }`}
            >
              {f === "all" ? "Tous" : f}
            </button>
          ))}
        </div>
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
                <th className="px-4 py-2.5 font-semibold w-32">Code</th>
                <th className="px-4 py-2.5 font-semibold">Libellé</th>
                <th className="px-4 py-2.5 font-semibold w-28">Calcule</th>
                <th className="px-4 py-2.5 font-semibold">Expression</th>
                <th className="px-4 py-2.5 font-semibold w-24">Statut</th>
                <th className="px-4 py-2.5 font-semibold w-32 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <code className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-muted">{r.code}</code>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{r.libelle}</div>
                    {r.description && <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{r.description}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className={`text-[10px] ${ATTRIBUT_COLORS[r.attribut_calcule] || ""}`}>
                      {r.attribut_calcule}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-[11px] font-mono text-accent line-clamp-1 max-w-xs block">{r.expression}</code>
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
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setDuplicateId(r.id); setEditId(null); setShowForm(true); }} title="Dupliquer">
                        <Copy size={13} />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditId(r.id); setDuplicateId(null); setShowForm(true); }} title="Modifier">
                        <Pencil size={13} />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(r)} title="Supprimer">
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    Aucune règle spécifique. Cliquez sur « Nouvelle règle » pour en créer une.
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
