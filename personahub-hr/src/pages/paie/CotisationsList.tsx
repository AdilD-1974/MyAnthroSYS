/**
 * CotisationsList – Liste des règles de cotisation avec navigation vers le formulaire.
 */
import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Pencil, Trash2, Loader2, Search } from "lucide-react";

interface RegleCotisation {
  id: string; code: string; regime: string | null; intitule: string;
  a_traiter: boolean; date_debut: string | null; date_fin: string | null; archive: boolean;
}

interface Props {
  onNew: () => void;
  onEdit: (id: string) => void;
}

const CotisationsList: React.FC<Props> = ({ onNew, onEdit }) => {
  const [items, setItems] = useState<RegleCotisation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    const data = []; const error = null; // Supabase desactive
    setItems((data || []) as RegleCotisation[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Supprimer cette règle de cotisation ?")) return;
    await supabase.from("regles_cotisation" as never).delete().eq("id" as never, id as never);
    load();
  };

  const filtered = items.filter(c =>
    c.code.toLowerCase().includes(search.toLowerCase()) ||
    c.intitule.toLowerCase().includes(search.toLowerCase()) ||
    (c.regime || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher…"
            className="w-full pl-9 pr-3 py-2 rounded-lg border text-sm bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all" />
        </div>
        <button onClick={onNew}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-white hover:bg-accent/90 transition-colors">
          <Plus size={14} /> Nouvelle règle
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin text-accent" size={20} /></div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-10">Aucune règle de cotisation.</p>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/30">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Code</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Régime</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Intitulé</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Début</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Fin</th>
                <th className="px-4 py-2.5 text-center text-xs font-semibold text-muted-foreground">Actif</th>
                <th className="px-4 py-2.5 w-20" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} className="border-t border-border hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => onEdit(r.id)}>
                  <td className="px-4 py-2.5 font-mono font-medium text-foreground">{r.code}</td>
                  <td className="px-4 py-2.5 text-foreground">{r.regime || "—"}</td>
                  <td className="px-4 py-2.5 text-foreground">{r.intitule}</td>
                  <td className="px-4 py-2.5 text-foreground">{r.date_debut || "—"}</td>
                  <td className="px-4 py-2.5 text-foreground">{r.date_fin || "—"}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`inline-block w-2 h-2 rounded-full ${r.a_traiter ? "bg-green-500" : "bg-muted-foreground/30"}`} />
                  </td>
                  <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <button onClick={() => onEdit(r.id)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => handleDelete(r.id)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default CotisationsList;
