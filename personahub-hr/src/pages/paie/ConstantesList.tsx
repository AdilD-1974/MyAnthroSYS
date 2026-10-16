/**
 * ConstantesList – CRUD des constantes de paie (ref_constante_paie).
 */
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Pencil, Trash2, Loader2, Check, X, Search, Copy, ArrowUp, ArrowDown, ArrowUpDown, Hash } from "lucide-react";
import { useFormatMasks } from "@/hooks/useFormatMasks";

interface Constante {
  id: string;
  code: string;
  libelle: string;
  type_constante: string;
  valeur: string;
  date_debut: string | null;
  date_fin: string | null;
  actif: boolean;
}

const TYPES = [
  { value: "NUMERIQUE", label: "Numérique" },
  { value: "DATE", label: "Date" },
  { value: "TEXTE", label: "Texte" },
];

const EMPTY_FORM = { code: "", libelle: "", type_constante: "NUMERIQUE", valeur: "", date_debut: "", date_fin: "", actif: true };

// Couleurs par type de constante — une teinte par nature de valeur (Numérique,
// Date, Texte), dérivées des tokens du thème comme pour les rubriques, pour
// repérer le type d'un coup d'œil plutôt qu'un badge gris uniforme.
const getTypeConstanteStyle = (type: string): React.CSSProperties => {
  const token = type === "NUMERIQUE" ? "--primary"
    : type === "DATE" ? "--info"
    : type === "TEXTE" ? "--accent"
    : "--secondary";
  return { background: `hsl(var(${token}) / 0.12)`, color: `hsl(var(${token}))` };
};

type Colonne = "code" | "libelle" | "type_constante" | "valeur" | "date_debut" | "date_fin" | "actif";

const ConstantesList: React.FC = () => {
  const { formatDate, formatNumber } = useFormatMasks();
  const [items, setItems] = useState<Constante[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // RG-CONST-TRI-01 (Adil DAIA) : tri local autonome (pas de dépendance à
  // useTableSort dont l'API exacte n'était pas vérifiable dans ce contexte).
  const [triCol, setTriCol] = useState<Colonne>("code");
  const [triDir, setTriDir] = useState<"asc" | "desc">("asc");

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("ref_constante_paie" as never)
      .select("*")
      .order("code" as never);
    setItems((data || []) as Constante[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setForm({ ...EMPTY_FORM });
    setEditId(null);
    setShowNew(false);
    setError(null);
  };

  const startEdit = (c: Constante) => {
    setEditId(c.id);
    setForm({ code: c.code, libelle: c.libelle, type_constante: c.type_constante, valeur: c.valeur, date_debut: c.date_debut || "", date_fin: c.date_fin || "", actif: c.actif });
    setShowNew(false);
  };

  // RG-CONST-DUPLIQUER-01 : préremplit le formulaire "Nouvelle constante"
  // avec toutes les valeurs de la source, code vidé (obligatoire, doit être
  // unique) — l'utilisateur n'a plus qu'à choisir un nouveau code et Créer.
  const startDuplicate = (c: Constante) => {
    setEditId(null);
    setForm({ code: "", libelle: `${c.libelle} (copie)`, type_constante: c.type_constante, valeur: c.valeur, date_debut: c.date_debut || "", date_fin: c.date_fin || "", actif: c.actif });
    setShowNew(true);
    setError(null);
  };

  const handleSave = async () => {
    if (!form.code || !form.libelle || !form.valeur) { setError("Code, libellé et valeur sont requis."); return; }
    setSaving(true); setError(null);
    const payload: any = {
      libelle: form.libelle, type_constante: form.type_constante, valeur: form.valeur, actif: form.actif,
      date_debut: form.date_debut || null, date_fin: form.date_fin || null,
    };

    if (editId) {
      const { error: err } = await supabase.from("ref_constante_paie" as never)
        .update(payload as never).eq("id" as never, editId as never);
      if (err) { setError(err.message); setSaving(false); return; }
    } else {
      const { error: err } = await supabase.from("ref_constante_paie" as never)
        .insert({ ...payload, code: form.code.toUpperCase() } as never);
      if (err) { setError(err.message.includes("duplicate") ? "Ce code existe déjà." : err.message); setSaving(false); return; }
    }

    setSaving(false);
    resetForm();
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Supprimer cette constante ?")) return;
    await supabase.from("ref_constante_paie" as never).delete().eq("id" as never, id as never);
    load();
  };

  const filtered = items.filter(c =>
    c.code.toLowerCase().includes(search.toLowerCase()) ||
    c.libelle.toLowerCase().includes(search.toLowerCase())
  );

  const sorted = useMemo(() => {
    const copie = [...filtered];
    copie.sort((a, b) => {
      const av = a[triCol], bv = b[triCol];
      let cmp: number;
      if (typeof av === "boolean" || typeof bv === "boolean") cmp = (av ? 1 : 0) - (bv ? 1 : 0);
      else cmp = String(av ?? "").localeCompare(String(bv ?? ""), "fr", { numeric: true });
      return triDir === "asc" ? cmp : -cmp;
    });
    return copie;
  }, [filtered, triCol, triDir]);

  const trierPar = (col: Colonne) => {
    if (triCol === col) setTriDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setTriCol(col); setTriDir("asc"); }
  };
  const IconeTri = ({ col }: { col: Colonne }) =>
    triCol !== col ? <ArrowUpDown size={11} className="opacity-30" />
      : triDir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />;

  const inputCls = "w-full px-2 py-1.5 rounded-lg border text-xs bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all";
  const inputSmCls = "w-full px-1.5 py-1 rounded border text-xs bg-background border-border";
  const thCls = "px-2 py-2 text-left text-[10px] uppercase tracking-wide font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors";

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Hash size={16} className="text-accent" /> Constantes
            <span className="text-sm font-normal text-muted-foreground">({items.length})</span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">Valeurs réglementaires paramétrables (plafonds, taux, seuils…).</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher…"
              className="pl-9 pr-3 py-2 rounded-lg border text-sm bg-background text-foreground border-border focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all w-56" />
          </div>
          <button onClick={() => { resetForm(); setShowNew(true); }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={{ background: "hsl(var(--accent))", color: "hsl(var(--accent-foreground))" }}>
            <Plus size={14} /> Nouvelle constante
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 px-4 py-2 rounded-lg text-sm bg-destructive/10 text-destructive border border-destructive/30">{error}</div>
      )}

      {/* Formulaire inline (nouveau / duplication) */}
      {showNew && (
        <div className="mb-4 p-4 rounded-xl border border-accent/30 bg-accent/5 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Nouvelle constante</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1 text-muted-foreground">Code *</label>
              <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                className={`${inputCls} font-mono`} placeholder="SMIG" autoFocus />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium mb-1 text-muted-foreground">Libellé *</label>
              <input value={form.libelle} onChange={e => setForm(f => ({ ...f, libelle: e.target.value }))}
                className={inputCls} placeholder="Salaire minimum" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-muted-foreground">Type</label>
              <select value={form.type_constante} onChange={e => setForm(f => ({ ...f, type_constante: e.target.value }))}
                className={inputCls}>
                {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-muted-foreground">Valeur *</label>
              <input
                type={form.type_constante === "NUMERIQUE" ? "number" : form.type_constante === "DATE" ? "date" : "text"}
                value={form.valeur} onChange={e => setForm(f => ({ ...f, valeur: e.target.value }))}
                className={inputCls} placeholder={form.type_constante === "NUMERIQUE" ? "0.00" : ""} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-muted-foreground">Date début</label>
              <input type="date" value={form.date_debut} onChange={e => setForm(f => ({ ...f, date_debut: e.target.value }))}
                min="1950-01-01" max="2099-12-31" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-muted-foreground">Date fin</label>
              <input type="date" value={form.date_fin} onChange={e => setForm(f => ({ ...f, date_fin: e.target.value }))}
                min="1950-01-01" max="2099-12-31" className={inputCls} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.actif} onChange={e => setForm(f => ({ ...f, actif: e.target.checked }))}
                className="rounded border-border text-accent" />
              <span className="text-sm text-foreground">Actif</span>
            </label>
            <div className="flex-1" />
            <button onClick={resetForm} className="px-3 py-1.5 rounded-lg text-sm border border-border text-muted-foreground hover:bg-muted transition-colors">
              <X size={14} className="inline mr-1" />Annuler
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50"
              style={{ background: "hsl(var(--accent))", color: "hsl(var(--accent-foreground))" }}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Créer
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin text-accent" size={20} /></div>
      ) : sorted.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-10">Aucune constante trouvée.</p>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: "hsl(var(--muted) / 0.5)" }}>
                <th className={thCls} onClick={() => trierPar("code")}><span className="inline-flex items-center gap-1">Code <IconeTri col="code" /></span></th>
                <th className={thCls} onClick={() => trierPar("libelle")}><span className="inline-flex items-center gap-1">Libellé <IconeTri col="libelle" /></span></th>
                <th className={thCls} onClick={() => trierPar("type_constante")}><span className="inline-flex items-center gap-1">Type <IconeTri col="type_constante" /></span></th>
                <th className={thCls} onClick={() => trierPar("valeur")}><span className="inline-flex items-center gap-1">Valeur <IconeTri col="valeur" /></span></th>
                <th className={thCls} onClick={() => trierPar("date_debut")}><span className="inline-flex items-center gap-1">Début <IconeTri col="date_debut" /></span></th>
                <th className={thCls} onClick={() => trierPar("date_fin")}><span className="inline-flex items-center gap-1">Fin <IconeTri col="date_fin" /></span></th>
                <th className={`${thCls} text-center`} onClick={() => trierPar("actif")}><span className="inline-flex items-center gap-1 justify-center">Actif <IconeTri col="actif" /></span></th>
                <th className="px-2 py-2 w-24" />
              </tr>
            </thead>
            <tbody>
              {sorted.map(c => (
                <tr key={c.id} className="border-t border-border hover:bg-muted/40 transition-colors">
                  {editId === c.id ? (
                    <>
                      <td className="px-2 py-1.5"><span className="font-mono text-foreground text-xs">{c.code}</span></td>
                      <td className="px-2 py-1.5">
                        <input value={form.libelle} onChange={e => setForm(f => ({ ...f, libelle: e.target.value }))} className={inputSmCls} />
                      </td>
                      <td className="px-2 py-1.5">
                        <select value={form.type_constante} onChange={e => setForm(f => ({ ...f, type_constante: e.target.value }))} className={inputSmCls}>
                          {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <input type={form.type_constante === "NUMERIQUE" ? "number" : form.type_constante === "DATE" ? "date" : "text"}
                          value={form.valeur} onChange={e => setForm(f => ({ ...f, valeur: e.target.value }))} className={inputSmCls} />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="date" value={form.date_debut} onChange={e => setForm(f => ({ ...f, date_debut: e.target.value }))}
                          min="1950-01-01" max="2099-12-31" className={inputSmCls} />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="date" value={form.date_fin} onChange={e => setForm(f => ({ ...f, date_fin: e.target.value }))}
                          min="1950-01-01" max="2099-12-31" className={inputSmCls} />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <input type="checkbox" checked={form.actif} onChange={e => setForm(f => ({ ...f, actif: e.target.checked }))}
                          className="rounded border-border text-accent" />
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          <button onClick={handleSave} disabled={saving} className="p-1 rounded hover:bg-muted text-accent">
                            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                          </button>
                          <button onClick={resetForm} className="p-1 rounded hover:bg-muted text-muted-foreground">
                            <X size={12} />
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-2 py-1.5 font-mono font-medium text-foreground">{c.code}</td>
                      <td className="px-2 py-1.5 text-foreground">{c.libelle}</td>
                      <td className="px-2 py-1.5">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={getTypeConstanteStyle(c.type_constante)}>
                          {TYPES.find(t => t.value === c.type_constante)?.label || c.type_constante}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 font-mono text-foreground">
                        {c.type_constante === "NUMERIQUE" && c.valeur !== "" && !Number.isNaN(Number(c.valeur))
                          ? formatNumber(c.valeur)
                          : c.valeur}
                      </td>
                      <td className="px-2 py-1.5 text-foreground">{formatDate(c.date_debut) || "—"}</td>
                      <td className="px-2 py-1.5 text-foreground">{formatDate(c.date_fin) || "—"}</td>
                      <td className="px-2 py-1.5 text-center">
                        <span className="inline-block w-2 h-2 rounded-full" style={{ background: c.actif ? "hsl(var(--success))" : "hsl(var(--muted-foreground) / 0.3)" }} />
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => startEdit(c)}
                            className="p-1 rounded hover:bg-muted transition-colors"
                            style={{ color: "hsl(var(--accent))" }}
                            title="Modifier"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            onClick={() => startDuplicate(c)}
                            className="p-1 rounded hover:bg-muted transition-colors"
                            style={{ color: "hsl(var(--info))" }}
                            title="Dupliquer"
                          >
                            <Copy size={12} />
                          </button>
                          <button
                            onClick={() => handleDelete(c.id)}
                            className="p-1 rounded hover:bg-muted transition-colors"
                            style={{ color: "hsl(var(--destructive))" }}
                            title="Supprimer"
                          >
                            <Trash2 size={12} />
                          </button>
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

export default ConstantesList;
