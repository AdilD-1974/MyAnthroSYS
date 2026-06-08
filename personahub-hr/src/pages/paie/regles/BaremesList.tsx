/**
 * BaremesList – Liste des barèmes de correspondance avec CRUD complet.
 */
import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Pencil, Trash2, Search, Table2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import BaremeForm from "./BaremeForm";

interface Bareme {
  id: string;
  code: string;
  libelle: string;
  description: string | null;
  type_cle: string;
  type_valeur: string;
  date_debut_validite: string | null;
  date_fin_validite: string | null;
  actif: boolean;
  nb_lignes?: number;
}

const BaremesList: React.FC = () => {
  const [baremes, setBaremes] = useState<Bareme[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    setLoading(true);
    const data = []; const error = null; // Supabase desactive
    if (error || !bData) {
      setLoading(false);
      return;
    }
    // Compter les lignes par barème
    const ids = bData.map((b) => b.id);
    const counts: Record<string, number> = {};
    if (ids.length > 0) {
      const data = []; const error = null; // Supabase desactive
      lines?.forEach((l: any) => {
        counts[l.bareme_id] = (counts[l.bareme_id] || 0) + 1;
      });
    }
    setBaremes(bData.map((b: any) => ({ ...b, nb_lignes: counts[b.id] || 0 })));
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (b: Bareme) => {
    if (!confirm(`Supprimer le barème "${b.libelle}" et ses ${b.nb_lignes} lignes ?`)) return;
    const { error } = await supabase.from("bareme").update({ archive: true }).eq("id", b.id);
    if (error) {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Barème supprimé" });
      load();
    }
  };

  if (showForm) {
    return (
      <BaremeForm
        editId={editId}
        onBack={() => {
          setShowForm(false);
          setEditId(null);
          load();
        }}
      />
    );
  }

  const filtered = baremes.filter(
    (b) =>
      !search ||
      b.libelle.toLowerCase().includes(search.toLowerCase()) ||
      b.code.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Barèmes ({baremes.length})</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Tables de correspondance clé → valeur (ex: indice → valeur du point, échelon → coefficient).
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditId(null);
            setShowForm(true);
          }}
          className="gap-1.5"
        >
          <Plus size={14} /> Nouveau barème
        </Button>
      </div>

      <div className="relative max-w-sm mb-3">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Rechercher…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9 text-sm" />
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
                <th className="px-4 py-2.5 font-semibold w-28">Type clé</th>
                <th className="px-4 py-2.5 font-semibold w-28">Type valeur</th>
                <th className="px-4 py-2.5 font-semibold w-24 text-center">Lignes</th>
                <th className="px-4 py-2.5 font-semibold w-24">Statut</th>
                <th className="px-4 py-2.5 font-semibold w-24 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((b) => (
                <tr key={b.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <code className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-muted">{b.code}</code>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{b.libelle}</div>
                    {b.description && <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{b.description}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="text-[10px]">{b.type_cle}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="text-[10px]">{b.type_valeur}</Badge>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                      <Table2 size={11} /> {b.nb_lignes}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={b.actif ? "default" : "secondary"} className="text-[10px]">
                      {b.actif ? "Actif" : "Inactif"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditId(b.id); setShowForm(true); }} title="Modifier">
                        <Pencil size={13} />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(b)} title="Supprimer">
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    Aucun barème. Cliquez sur « Nouveau barème » pour en créer un.
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

export default BaremesList;
