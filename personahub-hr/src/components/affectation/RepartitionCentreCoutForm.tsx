import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Check, X, AlertTriangle } from "lucide-react";

/**
 * Répartition analytique d'un collaborateur sur un ou plusieurs centres de
 * coût, avec pourcentage (clé de répartition).
 *
 * Priorité à la génération des écritures comptables (comptabilisation_engine.py,
 * _resoudre_axes) : si des lignes actives existent ici pour le collaborateur,
 * elles priment sur l'UO ; sinon repli sur l'UO comme aujourd'hui (inchangé).
 *
 * Schéma (migration_numero_generation.sql) :
 * - centres_cout(id, code, libelle, actif, date_debut, date_fin)
 * - collaborateur_centre_cout(id, collaborateur_id, centre_cout_id,
 *     pourcentage, date_debut, date_fin, actif)
 *   Un trigger côté base refuse déjà un total > 100% sur les lignes actives —
 *   ce formulaire avertit *avant* l'enregistrement pour ne pas laisser
 *   l'utilisateur découvrir l'erreur seulement après coup.
 */

interface CentreCout {
  id: string;
  code: string;
  libelle: string;
}

interface RepartitionRow {
  id: string;
  collaborateur_id: string;
  centre_cout_id: string;
  pourcentage: number;
  date_debut: string;
  date_fin: string | null;
  actif: boolean;
  centres_cout?: CentreCout;
}

interface Props {
  collaborateurId: string;
}

const emptyDraft = () => ({
  centre_cout_id: "",
  pourcentage: "" as string | number,
  date_debut: new Date().toISOString().slice(0, 10),
  date_fin: "",
});

const RepartitionCentreCoutForm: React.FC<Props> = ({ collaborateurId }) => {
  const [centresCout, setCentresCout] = useState<CentreCout[]>([]);
  const [rows, setRows] = useState<RepartitionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addingRow, setAddingRow] = useState(false);
  const [draft, setDraft] = useState(emptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, unknown>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: cc }, { data: rep }] = await Promise.all([
      supabase.from("centres_cout" as never)
        .select("id, code, libelle" as never)
        .eq("actif" as never, true as never)
        .order("code" as never),
      supabase.from("collaborateur_centre_cout" as never)
        .select("id, collaborateur_id, centre_cout_id, pourcentage, date_debut, date_fin, actif, centres_cout(id, code, libelle)" as never)
        .eq("collaborateur_id" as never, collaborateurId as never)
        .order("date_debut" as never, { ascending: false } as never),
    ]);
    setCentresCout(((cc || []) as unknown) as CentreCout[]);
    setRows(((rep || []) as unknown) as RepartitionRow[]);
    setLoading(false);
  }, [collaborateurId]);

  useEffect(() => { load(); }, [load]);

  // Total des lignes actives — c'est ce total-là que le trigger côté base
  // vérifie (actif=true, sans tenir compte des dates de la ligne).
  const totalActif = rows
    .filter(r => r.actif)
    .reduce((sum, r) => sum + Number(r.pourcentage || 0), 0);

  const totalBadge = () => {
    if (totalActif > 100) return { label: `${totalActif}% — dépasse 100%`, color: "hsl(var(--destructive))" };
    if (totalActif === 100) return { label: "100% — complet", color: "hsl(142 71% 40%)" };
    return { label: `${totalActif}% — incomplet (repli sur l'UO pour le reste)`, color: "hsl(var(--warning))" };
  };

  const handleAdd = async () => {
    if (!draft.centre_cout_id || !draft.pourcentage || !draft.date_debut) {
      toast.error("Centre de coût, pourcentage et date de début sont requis.");
      return;
    }
    const pct = Number(draft.pourcentage);
    if (pct <= 0 || pct > 100) {
      toast.error("Le pourcentage doit être compris entre 0 et 100.");
      return;
    }
    if (totalActif + pct > 100) {
      toast.error(`Le total dépasserait 100% (actuellement ${totalActif}%). La base refusera l'enregistrement.`);
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("collaborateur_centre_cout" as never).insert([{
      collaborateur_id: collaborateurId,
      centre_cout_id: draft.centre_cout_id,
      pourcentage: pct,
      date_debut: draft.date_debut,
      date_fin: draft.date_fin || null,
      actif: true,
    }] as never);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Répartition ajoutée");
    setAddingRow(false);
    setDraft(emptyDraft());
    load();
  };

  const startEdit = (row: RepartitionRow) => {
    setEditingId(row.id);
    setEditDraft({
      centre_cout_id: row.centre_cout_id,
      pourcentage: row.pourcentage,
      date_debut: row.date_debut,
      date_fin: row.date_fin || "",
      actif: row.actif,
    });
  };

  const handleSaveEdit = async (id: string) => {
    const pct = Number(editDraft.pourcentage);
    if (!pct || pct <= 0 || pct > 100) {
      toast.error("Le pourcentage doit être compris entre 0 et 100.");
      return;
    }
    const autresActifs = rows
      .filter(r => r.id !== id && r.actif)
      .reduce((sum, r) => sum + Number(r.pourcentage || 0), 0);
    if (editDraft.actif && autresActifs + pct > 100) {
      toast.error(`Le total dépasserait 100% (autres lignes actives : ${autresActifs}%).`);
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("collaborateur_centre_cout" as never)
      .update({
        centre_cout_id: editDraft.centre_cout_id,
        pourcentage: pct,
        date_debut: editDraft.date_debut,
        date_fin: editDraft.date_fin || null,
        actif: editDraft.actif,
      } as never)
      .eq("id" as never, id as never);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Répartition mise à jour");
    setEditingId(null);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Supprimer cette ligne de répartition ?")) return;
    const { error } = await supabase.from("collaborateur_centre_cout" as never)
      .delete().eq("id" as never, id as never);
    if (error) { toast.error(error.message); return; }
    toast.success("Ligne supprimée");
    load();
  };

  const inputStyle: React.CSSProperties = {
    borderColor: "hsl(var(--border))", background: "hsl(var(--background))",
    color: "hsl(var(--foreground))", borderRadius: "var(--radius)",
    padding: "6px 10px", fontSize: "13px", border: "1px solid hsl(var(--border))",
  };

  if (loading) {
    return <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Chargement…</p>;
  }

  const badge = totalBadge();

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
          Ventilation de cet agent sur un ou plusieurs centres de coût. Sans ligne active ici,
          l'imputation comptable retombe automatiquement sur l'unité organisationnelle (onglet ci-dessus).
        </p>
        {rows.some(r => r.actif) && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
            style={{ background: `${badge.color} / 0.12`, color: badge.color, border: `1px solid ${badge.color}` }}>
            {totalActif !== 100 && <AlertTriangle size={12} />}
            {badge.label}
          </span>
        )}
      </div>

      <table className="w-full text-sm border-collapse mb-3">
        <thead>
          <tr style={{ borderBottom: "1px solid hsl(var(--border))" }}>
            <th className="text-left py-2 px-2 text-xs font-semibold uppercase" style={{ color: "hsl(var(--muted-foreground))" }}>Centre de coût</th>
            <th className="text-left py-2 px-2 text-xs font-semibold uppercase w-24" style={{ color: "hsl(var(--muted-foreground))" }}>%</th>
            <th className="text-left py-2 px-2 text-xs font-semibold uppercase w-32" style={{ color: "hsl(var(--muted-foreground))" }}>Début</th>
            <th className="text-left py-2 px-2 text-xs font-semibold uppercase w-32" style={{ color: "hsl(var(--muted-foreground))" }}>Fin</th>
            <th className="text-left py-2 px-2 text-xs font-semibold uppercase w-20" style={{ color: "hsl(var(--muted-foreground))" }}>Actif</th>
            <th className="w-20" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && !addingRow ? (
            <tr>
              <td colSpan={6} className="text-center py-6 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                Aucune répartition — l'agent est imputé sur son UO par défaut.
              </td>
            </tr>
          ) : rows.map(row => {
            const isEditing = editingId === row.id;
            return (
              <tr key={row.id} className="border-b" style={{ borderColor: "hsl(var(--border))" }}>
                <td className="py-1.5 px-2">
                  {isEditing ? (
                    <select value={editDraft.centre_cout_id as string}
                      onChange={e => setEditDraft({ ...editDraft, centre_cout_id: e.target.value })}
                      style={{ ...inputStyle, width: "100%" }}>
                      {centresCout.map(c => <option key={c.id} value={c.id}>{c.code} — {c.libelle}</option>)}
                    </select>
                  ) : (
                    row.centres_cout ? `${row.centres_cout.code} — ${row.centres_cout.libelle}` : "—"
                  )}
                </td>
                <td className="py-1.5 px-2">
                  {isEditing ? (
                    <input type="number" min={0} max={100} step="0.01" value={editDraft.pourcentage as number}
                      onChange={e => setEditDraft({ ...editDraft, pourcentage: e.target.value })}
                      style={{ ...inputStyle, width: 80 }} />
                  ) : `${row.pourcentage}%`}
                </td>
                <td className="py-1.5 px-2">
                  {isEditing ? (
                    <input type="date" value={editDraft.date_debut as string}
                      onChange={e => setEditDraft({ ...editDraft, date_debut: e.target.value })}
                      style={inputStyle} />
                  ) : row.date_debut}
                </td>
                <td className="py-1.5 px-2">
                  {isEditing ? (
                    <input type="date" value={editDraft.date_fin as string}
                      onChange={e => setEditDraft({ ...editDraft, date_fin: e.target.value })}
                      style={inputStyle} />
                  ) : (row.date_fin || "—")}
                </td>
                <td className="py-1.5 px-2">
                  {isEditing ? (
                    <input type="checkbox" checked={editDraft.actif as boolean}
                      onChange={e => setEditDraft({ ...editDraft, actif: e.target.checked })} />
                  ) : (
                    <span style={{ color: row.actif ? "hsl(142 71% 40%)" : "hsl(var(--muted-foreground))" }}>
                      {row.actif ? "Oui" : "Non"}
                    </span>
                  )}
                </td>
                <td className="py-1.5 px-2">
                  <div className="flex gap-1">
                    {isEditing ? (
                      <>
                        <button onClick={() => handleSaveEdit(row.id)} disabled={saving}
                          className="p-1.5 rounded-lg" style={{ background: "hsl(142 71% 40%)", color: "white" }}>
                          <Check size={12} />
                        </button>
                        <button onClick={() => setEditingId(null)} className="p-1.5 rounded-lg"
                          style={{ background: "hsl(var(--muted))", color: "hsl(var(--foreground))" }}>
                          <X size={12} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startEdit(row)} className="p-1.5 rounded" style={{ color: "hsl(197 100% 38%)" }}>
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => handleDelete(row.id)} className="p-1.5 rounded" style={{ color: "hsl(0 84% 58%)" }}>
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}

          {addingRow && (
            <tr style={{ background: "hsl(84 55% 50% / 0.05)" }}>
              <td className="py-1.5 px-2">
                <select value={draft.centre_cout_id}
                  onChange={e => setDraft({ ...draft, centre_cout_id: e.target.value })}
                  style={{ ...inputStyle, width: "100%" }}>
                  <option value="">— Choisir —</option>
                  {centresCout.map(c => <option key={c.id} value={c.id}>{c.code} — {c.libelle}</option>)}
                </select>
              </td>
              <td className="py-1.5 px-2">
                <input type="number" min={0} max={100} step="0.01" placeholder="%"
                  value={draft.pourcentage}
                  onChange={e => setDraft({ ...draft, pourcentage: e.target.value })}
                  style={{ ...inputStyle, width: 80 }} />
              </td>
              <td className="py-1.5 px-2">
                <input type="date" value={draft.date_debut}
                  onChange={e => setDraft({ ...draft, date_debut: e.target.value })}
                  style={inputStyle} />
              </td>
              <td className="py-1.5 px-2">
                <input type="date" value={draft.date_fin}
                  onChange={e => setDraft({ ...draft, date_fin: e.target.value })}
                  style={inputStyle} />
              </td>
              <td className="py-1.5 px-2 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Oui</td>
              <td className="py-1.5 px-2">
                <div className="flex gap-1">
                  <button onClick={handleAdd} disabled={saving} className="p-1.5 rounded-lg" style={{ background: "hsl(84 55% 50%)", color: "white" }}>
                    <Check size={12} />
                  </button>
                  <button onClick={() => { setAddingRow(false); setDraft(emptyDraft()); }} className="p-1.5 rounded-lg"
                    style={{ background: "hsl(var(--muted))", color: "hsl(var(--foreground))" }}>
                    <X size={12} />
                  </button>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {!addingRow && (
        <button onClick={() => setAddingRow(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
          style={{ background: "hsl(var(--primary))", color: "white" }}>
          <Plus size={13} /> Ajouter une répartition
        </button>
      )}
    </div>
  );
};

export default RepartitionCentreCoutForm;
