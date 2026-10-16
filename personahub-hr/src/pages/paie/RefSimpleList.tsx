/**
 * RefSimpleList — CRUD générique pour les petites tables référentielles
 * (code, libelle, actif) : familles/types/flux/fréquences de rubriques.
 * Auteur : Adil DAIA
 *
 * RG-REF-GENERIQUE-01 : clé métier = `code` (pas de colonne `id` supposée —
 * seuls code/libelle/actif sont garantis exister sur ces 4 tables, d'après
 * leur usage confirmé ailleurs dans l'app : db.list(table, {select:
 * "code,libelle", actif:true})). Toutes les opérations (update/delete)
 * ciblent donc `code`, jamais un id UUID non vérifié.
 */
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Pencil, Trash2, Loader2, Check, X, Search, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

interface RefRow {
  code: string;
  libelle: string;
  actif: boolean;
}

interface Props {
  table: string;
  titre: string;
  placeholderCode?: string;
}

const EMPTY = { code: "", libelle: "", actif: true };

const RefSimpleList: React.FC<Props> = ({ table, titre, placeholderCode }) => {
  const [items, setItems] = useState<RefRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editCode, setEditCode] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [triDir, setTriDir] = useState<"asc" | "desc">("asc");

  const load = async () => {
    setLoading(true);
    const { data, error: err } = await supabase.from(table as never).select("code,libelle,actif" as never).order("code" as never);
    if (err) setError(err.message);
    setItems((data || []) as RefRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [table]);

  const resetForm = () => { setForm({ ...EMPTY }); setEditCode(null); setShowNew(false); setError(null); };
  const startEdit = (r: RefRow) => { setEditCode(r.code); setForm({ ...r }); setShowNew(false); setError(null); };

  const handleSave = async () => {
    if (!form.code || !form.libelle) { setError("Code et libellé sont requis."); return; }
    setSaving(true); setError(null);
    if (editCode) {
      const { error: err } = await supabase.from(table as never)
        .update({ libelle: form.libelle, actif: form.actif } as never).eq("code" as never, editCode as never);
      if (err) { setError(err.message); setSaving(false); return; }
    } else {
      const { error: err } = await supabase.from(table as never)
        .insert({ code: form.code.toUpperCase(), libelle: form.libelle, actif: form.actif } as never);
      if (err) { setError(err.message.includes("duplicate") ? "Ce code existe déjà." : err.message); setSaving(false); return; }
    }
    setSaving(false); resetForm(); load();
  };

  const handleDelete = async (code: string) => {
    if (!confirm(`Supprimer « ${code} » ?`)) return;
    const { error: err } = await supabase.from(table as never).delete().eq("code" as never, code as never);
    if (err) { setError(err.message); return; }
    load();
  };

  const filtered = useMemo(() => items.filter(r =>
    r.code.toLowerCase().includes(search.toLowerCase()) || r.libelle.toLowerCase().includes(search.toLowerCase())
  ), [items, search]);

  const sorted = useMemo(() => {
    const c = [...filtered];
    c.sort((a, b) => (triDir === "asc" ? 1 : -1) * a.code.localeCompare(b.code, "fr", { numeric: true }));
    return c;
  }, [filtered, triDir]);

  const inputCls = "w-full px-2 py-1.5 rounded-lg border text-xs bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all";

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{titre}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{items.length} élément{items.length > 1 ? "s" : ""}, {items.filter(i => i.actif).length} actif{items.filter(i => i.actif).length > 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher…"
              className="pl-8 pr-2 py-1.5 rounded-lg border text-xs bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all w-44" />
          </div>
          <button onClick={() => { resetForm(); setShowNew(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: "hsl(var(--accent))", color: "hsl(var(--accent-foreground))" }}>
            <Plus size={13} /> Nouveau
          </button>
        </div>
      </div>

      {error && <div className="mb-3 px-3 py-2 rounded-lg text-xs bg-destructive/10 text-destructive border border-destructive/30">{error}</div>}

      {showNew && (
        <div className="mb-3 p-3 rounded-xl border border-accent/30 bg-accent/5 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] font-medium mb-1 text-muted-foreground">Code *</label>
              <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                className={`${inputCls} font-mono`} placeholder={placeholderCode || "CODE"} autoFocus />
            </div>
            <div className="col-span-2">
              <label className="block text-[10px] font-medium mb-1 text-muted-foreground">Libellé *</label>
              <input value={form.libelle} onChange={e => setForm(f => ({ ...f, libelle: e.target.value }))} className={inputCls} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 cursor-pointer text-xs text-foreground">
              <input type="checkbox" checked={form.actif} onChange={e => setForm(f => ({ ...f, actif: e.target.checked }))} className="rounded border-border text-accent" /> Actif
            </label>
            <div className="flex-1" />
            <button onClick={resetForm} className="px-3 py-1 rounded-lg text-xs border border-border text-muted-foreground hover:bg-muted">Annuler</button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold disabled:opacity-50"
              style={{ background: "hsl(var(--accent))", color: "hsl(var(--accent-foreground))" }}>
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Créer
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin text-accent" size={18} /></div>
      ) : sorted.length === 0 ? (
        <p className="text-center text-xs text-muted-foreground py-8">Aucun élément.</p>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: "hsl(var(--muted) / 0.5)" }}>
                <th className="px-2 py-2 text-left text-[10px] uppercase tracking-wide font-semibold text-muted-foreground cursor-pointer select-none w-32"
                  onClick={() => setTriDir(d => d === "asc" ? "desc" : "asc")}>
                  <span className="inline-flex items-center gap-1">Code {triDir === "asc" ? <ArrowUp size={10} /> : <ArrowDown size={10} />}</span>
                </th>
                <th className="px-2 py-2 text-left text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Libellé</th>
                <th className="px-2 py-2 text-center text-[10px] uppercase tracking-wide font-semibold text-muted-foreground w-16">Actif</th>
                <th className="px-2 py-2 w-16" />
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => (
                <tr key={r.code} className="border-t border-border hover:bg-muted/40 transition-colors">
                  {editCode === r.code ? (
                    <>
                      <td className="px-2 py-1.5 font-mono text-foreground">{r.code}</td>
                      <td className="px-2 py-1.5"><input value={form.libelle} onChange={e => setForm(f => ({ ...f, libelle: e.target.value }))} className="w-full px-1.5 py-1 rounded border text-xs bg-background border-border" /></td>
                      <td className="px-2 py-1.5 text-center"><input type="checkbox" checked={form.actif} onChange={e => setForm(f => ({ ...f, actif: e.target.checked }))} className="rounded border-border text-accent" /></td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          <button onClick={handleSave} disabled={saving} className="p-1 rounded hover:bg-muted text-accent">{saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}</button>
                          <button onClick={resetForm} className="p-1 rounded hover:bg-muted text-muted-foreground"><X size={12} /></button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-2 py-1.5 font-mono font-medium text-foreground">{r.code}</td>
                      <td className="px-2 py-1.5 text-foreground">{r.libelle}</td>
                      <td className="px-2 py-1.5 text-center">
                        <span className="inline-block w-2 h-2 rounded-full" style={{ background: r.actif ? "hsl(var(--success))" : "hsl(var(--muted-foreground) / 0.3)" }} />
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          <button onClick={() => startEdit(r)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground" title="Modifier"><Pencil size={12} /></button>
                          <button onClick={() => handleDelete(r.code)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive" title="Supprimer"><Trash2 size={12} /></button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default RefSimpleList;
