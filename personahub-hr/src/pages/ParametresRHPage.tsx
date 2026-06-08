/**
 * ParametresRHPage – Gestion des paramètres RH configurables.
 * Permet de définir des valeurs métier utilisées dans les calculs (âge retraite, etc.)
 */
import React, { useEffect, useState } from "react";
import { db } from "@/lib/api";
import { Settings2, Pencil, X, Check, Plus, Loader2, Trash2, Download } from "lucide-react";
import * as XLSX from "xlsx";
import FormatMasksSettings from "@/components/FormatMasksSettings";

interface Parametre {
  id: string;
  code: string;
  libelle: string;
  valeur: string;
  type_valeur: string;
  unite: string | null;
  description: string | null;
  categorie: string;
  actif: boolean;
}

const CATEGORIES: Record<string, string> = {
  retraite: "Retraite",
  embauche: "Embauche",
  contrat: "Contrat",
  conges: "Congés",
  affichage: "Affichage",
  general: "Général",
};

const TYPES = ["integer", "decimal", "text", "boolean"];

const EMPTY: Omit<Parametre, "id"> = {
  code: "", libelle: "", valeur: "", type_valeur: "integer",
  unite: "", description: "", categorie: "general", actif: true,
};

const InputField: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { label?: string }> = ({ label, ...props }) => (
  <div>
    {label && <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</label>}
    <input
      {...props}
      className="w-full px-3 py-2 rounded-lg border text-sm outline-none transition-all"
      style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))", minHeight: 36 }}
      onFocus={e => (e.currentTarget.style.borderColor = "hsl(var(--accent))")}
      onBlur={e => (e.currentTarget.style.borderColor = "hsl(var(--border))")}
    />
  </div>
);

const ParametresRHPage: React.FC = () => {
  const [params, setParams] = useState<Parametre[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Omit<Parametre, "id">>(EMPTY);
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState<Omit<Parametre, "id">>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeCategorie, setActiveCategorie] = useState<string>("all");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await db.list<Parametre>("parametres_rh", { order: "code" });
      setParams(data);
    } catch (e: any) {
      setError(e?.message ?? "Erreur de chargement des paramètres");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const startEdit = (p: Parametre) => {
    setEditId(p.id);
    setEditForm({ code: p.code, libelle: p.libelle, valeur: p.valeur, type_valeur: p.type_valeur, unite: p.unite, description: p.description, categorie: p.categorie, actif: p.actif });
    setShowNew(false);
  };

  const cancelEdit = () => { setEditId(null); setError(null); };

  const saveEdit = async () => {
    if (!editForm.code || !editForm.libelle || !editForm.valeur) { setError("Code, libellé et valeur sont requis."); return; }
    setSaving(true); setError(null);
    try {
      await db.update(
        "parametres_rh",
        { id: editId },
        { ...editForm, unite: editForm.unite || null, description: editForm.description || null }
      );
      setEditId(null);
      load();
    } catch (e: any) {
      setError(e?.message ?? "Erreur de mise à jour");
    } finally {
      setSaving(false);
    }
  };

  const saveNew = async () => {
    if (!newForm.code || !newForm.libelle || !newForm.valeur) { setError("Code, libellé et valeur sont requis."); return; }
    setSaving(true); setError(null);
    try {
      await db.create("parametres_rh", {
        ...newForm,
        code: newForm.code.toUpperCase(),
        unite: newForm.unite || null,
        description: newForm.description || null,
      });
      setShowNew(false);
      setNewForm(EMPTY);
      load();
    } catch (e: any) {
      const msg = e?.message ?? "Erreur de création";
      setError(msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique") ? "Ce code existe déjà." : msg);
    } finally {
      setSaving(false);
    }
  };

  const deleteParam = async (id: string) => {
    if (!confirm("Supprimer ce paramètre ?")) return;
    try {
      await db.remove("parametres_rh", { id });
      load();
    } catch (e: any) {
      setError(e?.message ?? "Erreur de suppression");
    }
  };

  const filtered = activeCategorie === "all" ? params : params.filter(p => p.categorie === activeCategorie);
  const categories = ["all", ...Array.from(new Set(params.map(p => p.categorie)))];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl" style={{ background: "hsl(var(--accent) / 0.1)" }}>
            <Settings2 size={20} style={{ color: "hsl(var(--accent))" }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: "hsl(var(--foreground))" }}>Paramètres RH</h1>
            <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Valeurs configurables utilisées dans les calculs (âge de retraite, durées légales...)</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const exportData = filtered.map(p => ({
                Code: p.code, Libellé: p.libelle, Valeur: p.valeur,
                Type: p.type_valeur, Unité: p.unite || "", Catégorie: CATEGORIES[p.categorie] || p.categorie,
                Description: p.description || "", Actif: p.actif ? "Oui" : "Non",
              }));
              const ws = XLSX.utils.json_to_sheet(exportData);
              const wb = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb, ws, "Paramètres RH");
              XLSX.writeFile(wb, "parametres_rh_export.xlsx");
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors border"
            style={{ borderColor: "hsl(84 55% 46% / 0.3)", background: "hsl(84 55% 46% / 0.1)", color: "hsl(84 55% 36%)" }}
          >
            <Download size={14} /> Exporter
          </button>
          <button
            onClick={() => { setShowNew(true); setEditId(null); setError(null); setNewForm(EMPTY); }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={{ background: "hsl(var(--accent))", color: "white" }}
          >
            <Plus size={14} /> Nouveau paramètre
          </button>
        </div>
      </div>

      {/* Catégorie filter */}
      <div className="flex gap-2 flex-wrap mb-5">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategorie(cat)}
            className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
            style={{
              background: activeCategorie === cat ? "hsl(var(--accent))" : "hsl(var(--muted) / 0.5)",
              color: activeCategorie === cat ? "white" : "hsl(var(--muted-foreground))",
            }}
          >
            {cat === "all" ? "Tous" : (CATEGORIES[cat] || cat)}
          </button>
        ))}
      </div>

      {/* Affichage category → dedicated UI */}
      {activeCategorie === "affichage" ? (
        <FormatMasksSettings />
      ) : (
      <>
      {/* Error */}
      {error && (
        <div className="mb-4 px-3 py-2 rounded-lg text-sm" style={{ background: "hsl(0 84% 55% / 0.1)", color: "hsl(0 84% 45%)", border: "1px solid hsl(0 84% 55% / 0.3)" }}>
          {error}
        </div>
      )}

      {/* New form */}
      {showNew && (
        <div className="rounded-xl border mb-4 p-4" style={{ background: "hsl(var(--accent) / 0.04)", borderColor: "hsl(var(--accent) / 0.3)" }}>
          <p className="text-sm font-semibold mb-3" style={{ color: "hsl(var(--accent))" }}>Nouveau paramètre</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
            <InputField label="Code *" value={newForm.code} onChange={e => setNewForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="AGE_RETRAITE" />
            <InputField label="Libellé *" value={newForm.libelle} onChange={e => setNewForm(f => ({ ...f, libelle: e.target.value }))} placeholder="Âge de retraite" className="col-span-2" />
            <InputField label="Valeur *" value={newForm.valeur} onChange={e => setNewForm(f => ({ ...f, valeur: e.target.value }))} placeholder="60" />
            <InputField label="Unité" value={newForm.unite || ""} onChange={e => setNewForm(f => ({ ...f, unite: e.target.value }))} placeholder="ans, mois..." />
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Type</label>
              <select
                value={newForm.type_valeur}
                onChange={e => setNewForm(f => ({ ...f, type_valeur: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
              >
                {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Catégorie</label>
              <select
                value={newForm.categorie}
                onChange={e => setNewForm(f => ({ ...f, categorie: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
              >
                {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <InputField label="Description" value={newForm.description || ""} onChange={e => setNewForm(f => ({ ...f, description: e.target.value }))} placeholder="Description..." className="col-span-full sm:col-span-2" />
          </div>
          <div className="flex gap-2">
            <button onClick={saveNew} disabled={saving} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: "hsl(var(--accent))", color: "white" }}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              {saving ? "Enregistrement…" : "Créer"}
            </button>
            <button onClick={() => { setShowNew(false); setError(null); }} className="px-4 py-2 rounded-lg text-sm border" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin" style={{ color: "hsl(var(--accent))" }} />
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "hsl(var(--muted) / 0.4)", borderBottom: "1px solid hsl(var(--border))" }}>
                <th className="px-4 py-3 text-left text-xs font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>Code</th>
                <th className="px-4 py-3 text-left text-xs font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>Libellé</th>
                <th className="px-4 py-3 text-left text-xs font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>Valeur</th>
                <th className="px-4 py-3 text-left text-xs font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>Unité</th>
                <th className="px-4 py-3 text-left text-xs font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>Catégorie</th>
                <th className="px-4 py-3 text-left text-xs font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>Description</th>
                <th className="px-4 py-3 w-20" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => (
                <tr
                  key={p.id}
                  style={{
                    background: i % 2 === 0 ? "hsl(var(--card))" : "hsl(var(--muted) / 0.15)",
                    borderBottom: "1px solid hsl(var(--border))",
                  }}
                >
                  {editId === p.id ? (
                    <>
                      <td className="px-3 py-2">
                        <input value={editForm.code} onChange={e => setEditForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                          className="w-24 px-2 py-1 rounded border text-xs outline-none"
                          style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }} />
                      </td>
                      <td className="px-3 py-2">
                        <input value={editForm.libelle} onChange={e => setEditForm(f => ({ ...f, libelle: e.target.value }))}
                          className="w-full px-2 py-1 rounded border text-xs outline-none"
                          style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }} />
                      </td>
                      <td className="px-3 py-2">
                        <input value={editForm.valeur} onChange={e => setEditForm(f => ({ ...f, valeur: e.target.value }))}
                          className="w-20 px-2 py-1 rounded border text-xs outline-none"
                          style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }} />
                      </td>
                      <td className="px-3 py-2">
                        <input value={editForm.unite || ""} onChange={e => setEditForm(f => ({ ...f, unite: e.target.value }))}
                          className="w-16 px-2 py-1 rounded border text-xs outline-none"
                          style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }} />
                      </td>
                      <td className="px-3 py-2">
                        <select value={editForm.categorie} onChange={e => setEditForm(f => ({ ...f, categorie: e.target.value }))}
                          className="px-2 py-1 rounded border text-xs outline-none"
                          style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}>
                          {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input value={editForm.description || ""} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                          className="w-full px-2 py-1 rounded border text-xs outline-none"
                          style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }} />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <button onClick={saveEdit} disabled={saving} className="p-1.5 rounded transition-colors" style={{ background: "hsl(var(--accent) / 0.1)", color: "hsl(var(--accent))" }}>
                            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                          </button>
                          <button onClick={cancelEdit} className="p-1.5 rounded transition-colors hover:bg-muted">
                            <X size={12} style={{ color: "hsl(var(--muted-foreground))" }} />
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs px-1.5 py-0.5 rounded" style={{ background: "hsl(var(--accent) / 0.1)", color: "hsl(var(--accent))" }}>
                          {p.code}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-sm" style={{ color: "hsl(var(--foreground))" }}>{p.libelle}</td>
                      <td className="px-4 py-3">
                        <span className="font-semibold" style={{ color: "hsl(var(--foreground))" }}>{p.valeur}</span>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{p.unite || "—"}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "hsl(var(--muted) / 0.5)", color: "hsl(var(--muted-foreground))" }}>
                          {CATEGORIES[p.categorie] || p.categorie}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs max-w-xs truncate" style={{ color: "hsl(var(--muted-foreground))" }}>{p.description || "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => startEdit(p)} className="p-1.5 rounded transition-colors hover:bg-muted">
                            <Pencil size={12} style={{ color: "hsl(var(--muted-foreground))" }} />
                          </button>
                          <button onClick={() => deleteParam(p.id)} className="p-1.5 rounded transition-colors hover:bg-muted">
                            <Trash2 size={12} style={{ color: "hsl(0 84% 55%)" }} />
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Aucun paramètre trouvé
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      </>
      )}
    </div>
  );
};

export default ParametresRHPage;
