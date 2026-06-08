/**
 * TemplatesNotificationPage.tsx — Gestion des modèles de notifications
 * Auteur : Adil DAIA
 * Route  : /configuration/workflows/templates-notification
 *
 * Permet de créer, modifier et prévisualiser les modèles utilisés
 * dans les actions automatiques des workflows :
 *   - EMAIL    : sujet + corps multi-lignes
 *   - SMS      : message court
 *   - WHATSAPP : message
 *   - NOTIFICATION : titre + message in-app
 *   - PUSH     : titre + corps
 *
 * Variables : {demandeur_nom}, {date_debut}, {nb_jours}, etc.
 * Le catalogue des variables disponibles est chargé depuis
 * ref_workflow_variable.
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Plus, Pencil, Trash2, Check, X, Loader2, Search,
  Bell, Mail, MessageSquare, Smartphone, Eye, Copy,
  ChevronDown, ChevronRight, Variable as VarIcon, AlertTriangle,
} from "lucide-react";

interface Template {
  id: string;
  code: string;
  libelle: string;
  type_canal: string;
  sujet: string | null;
  corps: string;
  variables: string[];
  actif: boolean;
}

interface VariableRef {
  code: string;
  libelle: string;
  description: string | null;
  type_objet: string | null;
  type_donnee: string;
  categorie: string;
  exemple_valeur: string | null;
}

const CANAUX = [
  { code: "EMAIL",         libelle: "Email",                icon: <Mail size={13} />,         couleur: "#0EA5E9", aSujet: true },
  { code: "SMS",           libelle: "SMS",                  icon: <Smartphone size={13} />,   couleur: "#10B981", aSujet: false },
  { code: "WHATSAPP",      libelle: "WhatsApp",             icon: <MessageSquare size={13} />,couleur: "#22C55E", aSujet: false },
  { code: "NOTIFICATION",  libelle: "Notification interne", icon: <Bell size={13} />,         couleur: "#8B5CF6", aSujet: true  },
  { code: "PUSH",          libelle: "Push mobile",          icon: <Bell size={13} />,         couleur: "#EC4899", aSujet: true  },
];

const inp = "px-3 py-1.5 rounded-lg border text-sm outline-none w-full";
const inpStyle = { borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" };

// Données fictives pour le rendu de l'aperçu
const SAMPLE_VARS: Record<string, string> = {
  demandeur_nom: "DAIA",
  demandeur_prenom: "Adil",
  demandeur_nom_complet: "M. Adil DAIA",
  demandeur_matricule: "00001",
  demandeur_email: "a.daia@solgeis.ma",
  demandeur_fonction: "Directeur",
  type_conge: "Congé Payé Annuel",
  date_debut: "15/05/2026",
  date_fin: "19/05/2026",
  nb_jours: "5",
  solde_restant: "19",
  workflow_libelle: "Validation Cadres",
  etape_libelle: "Validation N+1",
  delai_h: "48",
  commentaire: "OK pour moi",
  date_jour: new Date().toLocaleDateString("fr-FR"),
  societe_libelle: "SOLGEIS",
  lien_validation: "http://localhost:8080/workflow/instance/abc-123",
  motif_conge: "Vacances familiales",
};

const renderPreview = (text: string): string => {
  if (!text) return "";
  return text.replace(/\{(\w+)\}/g, (_match, key) => SAMPLE_VARS[key] ?? `{${key}}`);
};

const TemplatesNotificationPage: React.FC = () => {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [variables, setVariables] = useState<VariableRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filtres
  const [filterCanal, setFilterCanal] = useState<string>("ALL");
  const [search, setSearch] = useState("");

  // Édition
  const [editing, setEditing] = useState<Template | null>(null);
  const [openVars, setOpenVars] = useState(true);
  const [filterTypeObjet, setFilterTypeObjet] = useState<string>("ALL");

  // ── Chargement ──────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: tpls }, { data: vars }] = await Promise.all([
      (supabase.from("ref_workflow_template" as never) as any)
        .select("*").order("type_canal").order("libelle"),
      (supabase.from("ref_workflow_variable" as never) as any)
        .select("*").eq("actif", true).order("type_objet").order("categorie").order("ordre"),
    ]);
    setTemplates(tpls || []);
    setVariables(vars || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Filtres mémoizés ────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return templates.filter(t => {
      if (filterCanal !== "ALL" && t.type_canal !== filterCanal) return false;
      if (search && !(`${t.code} ${t.libelle}`.toLowerCase().includes(search.toLowerCase()))) return false;
      return true;
    });
  }, [templates, filterCanal, search]);

  const variablesGroupees = useMemo(() => {
    const filtered = variables.filter(v => {
      if (filterTypeObjet === "ALL") return true;
      if (filterTypeObjet === "GLOBAL") return v.type_objet === null;
      return v.type_objet === filterTypeObjet || v.type_objet === null;
    });
    const par_cat: Record<string, VariableRef[]> = {};
    filtered.forEach(v => {
      if (!par_cat[v.categorie]) par_cat[v.categorie] = [];
      par_cat[v.categorie].push(v);
    });
    return par_cat;
  }, [variables, filterTypeObjet]);

  // ── Édition ─────────────────────────────────────────────────────────────
  const openNew = () => {
    setEditing({
      id: "", code: "", libelle: "",
      type_canal: "NOTIFICATION", sujet: "", corps: "",
      variables: [], actif: true,
    });
    setError(null);
  };

  const openEdit = (t: Template) => {
    setEditing({ ...t, sujet: t.sujet || "", variables: t.variables || [] });
    setError(null);
  };

  const insertVariable = (code: string) => {
    if (!editing) return;
    const target = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    const placeholder = `{${code}}`;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
      const start = target.selectionStart || 0;
      const end = target.selectionEnd || 0;
      const before = target.value.substring(0, start);
      const after = target.value.substring(end);
      const newVal = before + placeholder + after;
      // Trouver quel champ : sujet ou corps
      const isSujet = target.getAttribute("data-field") === "sujet";
      setEditing({
        ...editing,
        [isSujet ? "sujet" : "corps"]: newVal,
      });
      setTimeout(() => {
        target.focus();
        target.setSelectionRange(start + placeholder.length, start + placeholder.length);
      }, 0);
    } else {
      // Pas de champ focus → ajouter à la fin du corps
      setEditing({ ...editing, corps: editing.corps + " " + placeholder });
    }
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.code || !editing.libelle || !editing.corps) {
      setError("Code, libellé et corps sont obligatoires.");
      return;
    }
    setSaving(true); setError(null);
    try {
      // Extraire variables depuis sujet + corps
      const usedVars = new Set<string>();
      const re = /\{(\w+)\}/g;
      [editing.sujet || "", editing.corps].forEach(t => {
        let m;
        while ((m = re.exec(t)) !== null) usedVars.add(m[1]);
      });

      const payload = {
        code: editing.code,
        libelle: editing.libelle,
        type_canal: editing.type_canal,
        sujet: editing.sujet || null,
        corps: editing.corps,
        variables: Array.from(usedVars),
        actif: editing.actif,
      };

      if (editing.id) {
        const { error: e } = await (supabase.from("ref_workflow_template" as never) as any)
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", editing.id);
        if (e) throw e;
      } else {
        const { error: e } = await (supabase.from("ref_workflow_template" as never) as any).insert(payload);
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

  const remove = async (t: Template) => {
    if (!confirm(`Supprimer le template "${t.libelle}" ?`)) return;
    await (supabase.from("ref_workflow_template" as never) as any).delete().eq("id", t.id);
    load();
  };

  const duplicate = async (t: Template) => {
    const newCode = prompt("Nouveau code pour la copie :", `${t.code}_COPIE`);
    if (!newCode) return;
    await (supabase.from("ref_workflow_template" as never) as any).insert({
      code: newCode, libelle: `${t.libelle} (copie)`,
      type_canal: t.type_canal, sujet: t.sujet, corps: t.corps,
      variables: t.variables, actif: true,
    });
    load();
  };

  // ── Render édition ──────────────────────────────────────────────────────
  if (editing) {
    const canal = CANAUX.find(c => c.code === editing.type_canal)!;
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-medium" style={{ color: "hsl(var(--foreground))" }}>
              {editing.id ? `Modifier : ${editing.libelle}` : "Nouveau template"}
            </h2>
            <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
              Cliquez sur une variable à droite pour l'insérer dans le champ actif
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setEditing(null)}
              className="px-3 py-1.5 rounded-lg text-sm border"
              style={{ borderColor: "hsl(var(--border))" }}>
              Annuler
            </button>
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

        <div className="grid grid-cols-3 gap-4">
          {/* Formulaire */}
          <div className="col-span-2 flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Code *</label>
                <input className={inp} style={inpStyle}
                  value={editing.code}
                  disabled={!!editing.id}
                  onChange={e => setEditing({ ...editing, code: e.target.value.toUpperCase().replace(/\s/g, "_") })}
                  placeholder="WF_NOTIF_NOUVELLE_DEMANDE" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Libellé *</label>
                <input className={inp} style={inpStyle}
                  value={editing.libelle}
                  onChange={e => setEditing({ ...editing, libelle: e.target.value })}
                  placeholder="Notification de nouvelle demande" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Type de canal *</label>
              <div className="flex flex-wrap gap-2">
                {CANAUX.map(c => (
                  <button key={c.code}
                    onClick={() => setEditing({ ...editing, type_canal: c.code })}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border transition-colors"
                    style={{
                      borderColor: editing.type_canal === c.code ? c.couleur : "hsl(var(--border))",
                      background: editing.type_canal === c.code ? c.couleur + "15" : "transparent",
                      color: editing.type_canal === c.code ? c.couleur : "hsl(var(--foreground))",
                    }}>
                    {c.icon} {c.libelle}
                  </button>
                ))}
              </div>
            </div>

            {canal.aSujet && (
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Sujet {editing.type_canal === "EMAIL" ? "(de l'email)" : "(titre de la notification)"}
                </label>
                <input className={inp} style={inpStyle}
                  data-field="sujet"
                  value={editing.sujet || ""}
                  onChange={e => setEditing({ ...editing, sujet: e.target.value })}
                  placeholder={editing.type_canal === "EMAIL"
                    ? "Demande de {type_conge} – {demandeur_nom}"
                    : "Nouvelle demande à traiter"} />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                Corps du message *
              </label>
              <textarea className="px-3 py-2 rounded-lg border text-sm outline-none w-full font-mono"
                style={{ ...inpStyle, minHeight: editing.type_canal === "SMS" || editing.type_canal === "WHATSAPP" ? 80 : 200, fontSize: 12, lineHeight: 1.6 }}
                data-field="corps"
                value={editing.corps}
                onChange={e => setEditing({ ...editing, corps: e.target.value })}
                placeholder={"Bonjour {acteur_nom},\n\n{demandeur_nom_complet} a soumis une demande de {type_conge} du {date_debut} au {date_fin} ({nb_jours} jours).\n\nCliquez ici pour la traiter : {lien_validation}"} />
              <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                {editing.type_canal === "SMS" && `${editing.corps.length} caractères — max recommandé 160`}
                {editing.type_canal === "WHATSAPP" && `${editing.corps.length} caractères`}
              </p>
            </div>

            {/* Aperçu */}
            <div className="rounded-lg border p-4" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted)/0.3)" }}>
              <div className="flex items-center gap-2 mb-2">
                <Eye size={13} style={{ color: "hsl(var(--accent))" }} />
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Aperçu — variables remplacées par des données fictives
                </span>
              </div>
              {canal.aSujet && editing.sujet && (
                <p className="font-medium text-sm mb-2 pb-2 border-b" style={{ borderColor: "hsl(var(--border))" }}>
                  {renderPreview(editing.sujet)}
                </p>
              )}
              <p className="text-sm whitespace-pre-wrap" style={{ color: "hsl(var(--foreground))" }}>
                {renderPreview(editing.corps) || <span className="text-muted-foreground italic">(corps vide)</span>}
              </p>
            </div>
          </div>

          {/* Catalogue de variables */}
          <div className="border rounded-lg overflow-hidden h-fit sticky top-4" style={{ borderColor: "hsl(var(--border))" }}>
            <div className="px-3 py-2 border-b flex items-center gap-2" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted)/0.3)" }}>
              <VarIcon size={13} style={{ color: "hsl(var(--accent))" }} />
              <span className="text-xs font-semibold">Variables disponibles</span>
            </div>
            <div className="p-2 border-b" style={{ borderColor: "hsl(var(--border))" }}>
              <select className={inp} style={{ ...inpStyle, fontSize: 11 }}
                value={filterTypeObjet}
                onChange={e => setFilterTypeObjet(e.target.value)}>
                <option value="ALL">Tous les contextes</option>
                <option value="GLOBAL">Globales uniquement</option>
                <option value="CONGE">CONGE (+ globales)</option>
                <option value="DEPART">DEPART (+ globales)</option>
                <option value="RECRUTEMENT">RECRUTEMENT (+ globales)</option>
              </select>
            </div>
            <div className="max-h-[480px] overflow-auto">
              {Object.entries(variablesGroupees).map(([cat, vars]) => (
                <div key={cat} className="border-b" style={{ borderColor: "hsl(var(--border))" }}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider px-3 pt-2 pb-1"
                    style={{ color: "hsl(var(--muted-foreground))" }}>
                    {cat}
                  </p>
                  {vars.map(v => (
                    <button key={v.code + (v.type_objet || "")}
                      onClick={() => insertVariable(v.code)}
                      className="w-full text-left px-3 py-1.5 hover:bg-muted/50 transition-colors flex items-start gap-2"
                      title={v.description || ""}>
                      <span className="font-mono text-[11px] mt-0.5"
                        style={{ color: "hsl(var(--accent))" }}>
                        {`{${v.code}}`}
                      </span>
                      <span className="text-[11px] flex-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                        {v.libelle}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Render liste ────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-medium" style={{ color: "hsl(var(--foreground))" }}>Modèles de notifications</h1>
          <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
            Gabarits Email, SMS, WhatsApp et notifications utilisés dans les workflows • {templates.length} template(s)
          </p>
        </div>
        <button onClick={openNew}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
          style={{ background: "hsl(var(--accent))", color: "white" }}>
          <Plus size={13} /> Nouveau template
        </button>
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button onClick={() => setFilterCanal("ALL")}
          className="px-3 py-1.5 rounded-lg text-xs font-medium border"
          style={{
            background: filterCanal === "ALL" ? "hsl(var(--accent))" : "transparent",
            color: filterCanal === "ALL" ? "white" : "hsl(var(--foreground))",
            borderColor: filterCanal === "ALL" ? "hsl(var(--accent))" : "hsl(var(--border))",
          }}>
          Tous ({templates.length})
        </button>
        {CANAUX.map(c => {
          const count = templates.filter(t => t.type_canal === c.code).length;
          const active = filterCanal === c.code;
          return (
            <button key={c.code} onClick={() => setFilterCanal(c.code)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
              style={{
                background: active ? c.couleur + "15" : "transparent",
                color: active ? c.couleur : "hsl(var(--foreground))",
                borderColor: active ? c.couleur : "hsl(var(--border))",
              }}>
              {c.icon} {c.libelle} ({count})
            </button>
          );
        })}
        <div className="relative ml-auto">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2"
            style={{ color: "hsl(var(--muted-foreground))" }} />
          <input className="pl-7 pr-3 py-1.5 rounded-lg border text-xs w-64"
            style={inpStyle}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher…" />
        </div>
      </div>

      {/* Liste */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin" style={{ color: "hsl(var(--accent))" }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 rounded-xl border border-dashed"
          style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
          <Bell size={32} strokeWidth={1} className="mx-auto mb-2" />
          <p className="text-sm">Aucun template — cliquez "+ Nouveau template"</p>
        </div>
      ) : (
        <div className="grid gap-2">
          {filtered.map(t => {
            const canal = CANAUX.find(c => c.code === t.type_canal);
            return (
              <div key={t.id} className="rounded-xl border p-3 flex items-center gap-3"
                style={{ borderColor: "hsl(var(--border))" }}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: (canal?.couleur || "#94A3B8") + "15", color: canal?.couleur || "#94A3B8" }}>
                  {canal?.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs px-1.5 py-0.5 rounded flex-shrink-0"
                      style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                      {t.code}
                    </span>
                    <span className="text-sm font-medium truncate" style={{ color: "hsl(var(--foreground))" }}>
                      {t.libelle}
                    </span>
                  </div>
                  <p className="text-xs truncate mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                    {t.sujet ? `${t.sujet} — ` : ""}{t.corps.substring(0, 100)}{t.corps.length > 100 ? "…" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => duplicate(t)} title="Dupliquer"
                    className="p-1.5 rounded hover:bg-muted">
                    <Copy size={12} style={{ color: "hsl(var(--muted-foreground))" }} />
                  </button>
                  <button onClick={() => openEdit(t)} title="Modifier"
                    className="p-1.5 rounded hover:bg-muted">
                    <Pencil size={12} style={{ color: "hsl(var(--muted-foreground))" }} />
                  </button>
                  <button onClick={() => remove(t)} title="Supprimer"
                    className="p-1.5 rounded hover:bg-muted">
                    <Trash2 size={12} style={{ color: "hsl(0 84% 55%)" }} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TemplatesNotificationPage;
