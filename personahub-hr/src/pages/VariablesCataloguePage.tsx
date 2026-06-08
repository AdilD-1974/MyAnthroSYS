/**
 * VariablesCataloguePage.tsx — Catalogue des variables disponibles
 * Auteur : Adil DAIA
 * Route  : /configuration/workflows/variables
 *
 * Permet de gérer les variables réutilisables dans les templates :
 *   - Variables globales (date_jour, societe_libelle...)
 *   - Variables par type d'objet (CONGE, DEPART, RECRUTEMENT...)
 *
 * Chaque variable a un code (ex: demandeur_nom), un libellé,
 * une catégorie (DEMANDEUR/DEMANDE/WORKFLOW/SOCIETE/GENERAL),
 * un type de donnée et un exemple.
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Plus, Pencil, Trash2, Check, X, Loader2, Search, Copy,
  Variable as VarIcon, AlertTriangle, Info,
} from "lucide-react";

interface VariableRef {
  id: string;
  code: string;
  libelle: string;
  description: string | null;
  type_objet: string | null;
  type_donnee: string;
  categorie: string;
  exemple_valeur: string | null;
  source_sql: string | null;
  actif: boolean;
  ordre: number;
}

const TYPES_OBJET = [
  { v: "GLOBAL",      l: "Globale (tous workflows)" },
  { v: "CONGE",       l: "CONGE" },
  { v: "DEPART",      l: "DEPART" },
  { v: "RECRUTEMENT", l: "RECRUTEMENT" },
  { v: "AVENANT",     l: "AVENANT" },
  { v: "MOUVEMENT",   l: "MOUVEMENT" },
  { v: "DOCUMENT",    l: "DOCUMENT" },
];

const CATEGORIES = [
  { v: "DEMANDEUR", l: "Demandeur",   couleur: "#3B82F6" },
  { v: "DEMANDE",   l: "Demande",     couleur: "#10B981" },
  { v: "WORKFLOW",  l: "Workflow",    couleur: "#8B5CF6" },
  { v: "SOCIETE",   l: "Société",     couleur: "#F59E0B" },
  { v: "GENERAL",   l: "Général",     couleur: "#64748B" },
];

const TYPES_DONNEE = ["TEXTE","NOMBRE","DATE","DATETIME","BOOLEEN","MONTANT"];

const inp = "px-3 py-1.5 rounded-lg border text-sm outline-none w-full";
const inpStyle = { borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" };

const VariablesCataloguePage: React.FC = () => {
  const [variables, setVariables] = useState<VariableRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filterObjet, setFilterObjet] = useState<string>("ALL");
  const [filterCat, setFilterCat] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<VariableRef | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase.from("ref_workflow_variable" as never) as any)
      .select("*").order("type_objet").order("categorie").order("ordre");
    setVariables(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => variables.filter(v => {
    if (filterObjet === "GLOBAL" && v.type_objet !== null) return false;
    if (filterObjet !== "ALL" && filterObjet !== "GLOBAL" && v.type_objet !== filterObjet) return false;
    if (filterCat !== "ALL" && v.categorie !== filterCat) return false;
    if (search && !(`${v.code} ${v.libelle}`.toLowerCase().includes(search.toLowerCase()))) return false;
    return true;
  }), [variables, filterObjet, filterCat, search]);

  const grouped = useMemo(() => {
    const out: Record<string, VariableRef[]> = {};
    filtered.forEach(v => {
      const key = `${v.type_objet || "GLOBAL"} · ${v.categorie}`;
      if (!out[key]) out[key] = [];
      out[key].push(v);
    });
    return out;
  }, [filtered]);

  const openNew = () => {
    setEditing({
      id: "", code: "", libelle: "", description: "",
      type_objet: null, type_donnee: "TEXTE", categorie: "DEMANDE",
      exemple_valeur: "", source_sql: "", actif: true, ordre: 99,
    });
    setError(null);
  };

  const openEdit = (v: VariableRef) => {
    setEditing({ ...v,
      description: v.description || "",
      exemple_valeur: v.exemple_valeur || "",
      source_sql: v.source_sql || "",
    });
    setError(null);
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.code || !editing.libelle) {
      setError("Code et libellé obligatoires.");
      return;
    }
    if (!/^[a-z][a-z0-9_]*$/.test(editing.code)) {
      setError("Le code doit être en minuscules avec underscore (ex: demandeur_nom)");
      return;
    }
    setSaving(true); setError(null);
    try {
      const payload = {
        code: editing.code,
        libelle: editing.libelle,
        description: editing.description || null,
        type_objet: editing.type_objet,
        type_donnee: editing.type_donnee,
        categorie: editing.categorie,
        exemple_valeur: editing.exemple_valeur || null,
        source_sql: editing.source_sql || null,
        actif: editing.actif,
        ordre: editing.ordre,
      };

      if (editing.id) {
        const { error: e } = await (supabase.from("ref_workflow_variable" as never) as any)
          .update(payload).eq("id", editing.id);
        if (e) throw e;
      } else {
        const { error: e } = await (supabase.from("ref_workflow_variable" as never) as any).insert(payload);
        if (e) throw e;
      }
      await load();
      setEditing(null);
    } catch (err: any) {
      setError(err.message || "Erreur");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (v: VariableRef) => {
    if (!confirm(`Supprimer la variable "${v.code}" ?`)) return;
    await (supabase.from("ref_workflow_variable" as never) as any).delete().eq("id", v.id);
    load();
  };

  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(`{${code}}`);
  };

  // ── Render édition ──
  if (editing) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium">{editing.id ? `Modifier : ${editing.code}` : "Nouvelle variable"}</h2>
          <div className="flex gap-2">
            <button onClick={() => setEditing(null)} className="px-3 py-1.5 rounded-lg text-sm border" style={{ borderColor: "hsl(var(--border))" }}>Annuler</button>
            <button onClick={save} disabled={saving}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium"
              style={{ background: "hsl(var(--accent))", color: "white" }}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
            style={{ background: "hsl(0 84% 55% / 0.1)", color: "hsl(0 84% 45%)" }}>
            <AlertTriangle size={13} /> {error}
          </div>
        )}

        <div className="rounded-xl border p-4 grid grid-cols-2 gap-3" style={{ borderColor: "hsl(var(--border))" }}>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Code * (snake_case minuscule)</label>
            <input className={inp} style={{ ...inpStyle, fontFamily: "var(--font-mono)" }} value={editing.code} disabled={!!editing.id}
              onChange={e => setEditing({ ...editing, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
              placeholder="demandeur_nom" />
            <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
              S'utilise comme {`{${editing.code || "code"}}`} dans les templates
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Libellé *</label>
            <input className={inp} style={inpStyle} value={editing.libelle}
              onChange={e => setEditing({ ...editing, libelle: e.target.value })}
              placeholder="Nom du demandeur" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Description</label>
            <input className={inp} style={inpStyle} value={editing.description || ""}
              onChange={e => setEditing({ ...editing, description: e.target.value })}
              placeholder="À quoi sert cette variable" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Type d'objet</label>
            <select className={inp} style={inpStyle} value={editing.type_objet || "GLOBAL"}
              onChange={e => setEditing({ ...editing, type_objet: e.target.value === "GLOBAL" ? null : e.target.value })}>
              {TYPES_OBJET.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Catégorie</label>
            <select className={inp} style={inpStyle} value={editing.categorie}
              onChange={e => setEditing({ ...editing, categorie: e.target.value })}>
              {CATEGORIES.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Type de donnée</label>
            <select className={inp} style={inpStyle} value={editing.type_donnee}
              onChange={e => setEditing({ ...editing, type_donnee: e.target.value })}>
              {TYPES_DONNEE.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Exemple de valeur</label>
            <input className={inp} style={inpStyle} value={editing.exemple_valeur || ""}
              onChange={e => setEditing({ ...editing, exemple_valeur: e.target.value })}
              placeholder="DAIA" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
              Source SQL (optionnel) — comment cette variable est calculée
            </label>
            <textarea className="px-3 py-2 rounded-lg border text-sm outline-none w-full font-mono"
              style={{ ...inpStyle, minHeight: 80, fontSize: 11 }}
              value={editing.source_sql || ""}
              onChange={e => setEditing({ ...editing, source_sql: e.target.value })}
              placeholder="SELECT nom FROM collaborateurs WHERE id = :demandeur_id" />
            <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
              <Info size={11} className="inline" /> Documentation pour les développeurs — utilisée si tu veux générer la valeur dynamiquement
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Render liste ─────────────
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-medium">Catalogue de variables</h1>
          <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
            Variables disponibles dans les templates de notifications et de documents • {variables.length} variable(s)
          </p>
        </div>
        <button onClick={openNew}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
          style={{ background: "hsl(var(--accent))", color: "white" }}>
          <Plus size={13} /> Nouvelle variable
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <select className={inp} style={{ ...inpStyle, width: "auto", fontSize: 12 }}
          value={filterObjet} onChange={e => setFilterObjet(e.target.value)}>
          <option value="ALL">Tous les contextes</option>
          <option value="GLOBAL">Globales uniquement</option>
          {TYPES_OBJET.filter(t => t.v !== "GLOBAL").map(t =>
            <option key={t.v} value={t.v}>{t.l}</option>
          )}
        </select>
        <select className={inp} style={{ ...inpStyle, width: "auto", fontSize: 12 }}
          value={filterCat} onChange={e => setFilterCat(e.target.value)}>
          <option value="ALL">Toutes catégories</option>
          {CATEGORIES.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
        </select>
        <div className="relative ml-auto">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2"
            style={{ color: "hsl(var(--muted-foreground))" }} />
          <input className="pl-7 pr-3 py-1.5 rounded-lg border text-xs w-64"
            style={inpStyle}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher un code ou libellé…" />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin" style={{ color: "hsl(var(--accent))" }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 rounded-xl border border-dashed"
          style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
          <VarIcon size={32} strokeWidth={1} className="mx-auto mb-2" />
          <p className="text-sm">Aucune variable</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {Object.entries(grouped).map(([groupe, vars]) => {
            const cat = CATEGORIES.find(c => groupe.endsWith(c.v));
            return (
              <div key={groupe} className="rounded-xl border overflow-hidden"
                style={{ borderColor: "hsl(var(--border))" }}>
                <div className="px-4 py-2 border-b text-xs font-semibold uppercase tracking-wide flex items-center gap-2"
                  style={{ borderColor: "hsl(var(--border))", background: (cat?.couleur || "#64748B") + "10",
                           color: cat?.couleur || "hsl(var(--muted-foreground))" }}>
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: cat?.couleur || "#64748B" }} />
                  {groupe} <span className="opacity-60">({vars.length})</span>
                </div>
                <div className="divide-y" style={{ borderColor: "hsl(var(--border))" }}>
                  {vars.map(v => (
                    <div key={v.id} className="flex items-center gap-3 px-4 py-2 hover:bg-muted/30">
                      <button onClick={() => copyToClipboard(v.code)}
                        className="font-mono text-xs px-2 py-0.5 rounded flex-shrink-0 hover:bg-muted"
                        style={{ background: "hsl(var(--muted))", color: "hsl(var(--accent))" }}
                        title="Cliquer pour copier">
                        {`{${v.code}}`}
                      </button>
                      <span className="text-sm flex-1 min-w-0 truncate" style={{ color: "hsl(var(--foreground))" }}>
                        {v.libelle}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded flex-shrink-0"
                        style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                        {v.type_donnee}
                      </span>
                      {v.exemple_valeur && (
                        <span className="text-xs italic flex-shrink-0 max-w-[180px] truncate"
                          style={{ color: "hsl(var(--muted-foreground))" }}>
                          ex: {v.exemple_valeur}
                        </span>
                      )}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => openEdit(v)} className="p-1.5 rounded hover:bg-muted">
                          <Pencil size={11} style={{ color: "hsl(var(--muted-foreground))" }} />
                        </button>
                        <button onClick={() => remove(v)} className="p-1.5 rounded hover:bg-muted">
                          <Trash2 size={11} style={{ color: "hsl(0 84% 55%)" }} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default VariablesCataloguePage;
