/**
 * TemplatesDocumentPage.tsx — Gestion des modèles de documents
 * Auteur : Adil DAIA
 * Route  : /configuration/workflows/templates-document
 *
 * Permet de gérer les modèles utilisés par l'action GENERER_DOCUMENT :
 *   - WORD  : fichier .docx avec placeholders {variable}
 *   - HTML  : contenu HTML stocké directement
 *   - TEXTE : texte brut converti en PDF
 *
 * Le moteur backend remplace les variables et génère un PDF/Word.
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Plus, Pencil, Trash2, Check, X, Loader2, Search, Eye,
  FileText, Upload, Download, AlertTriangle, Variable as VarIcon, Copy,
} from "lucide-react";

interface DocTemplate {
  id: string;
  code: string;
  libelle: string;
  description: string | null;
  type_objet: string | null;
  type_document: string;       // WORD / HTML / PDF / TEXTE
  chemin_fichier: string | null;
  contenu: string | null;
  variables: string[];
  extension_sortie: string;    // pdf / docx / html
  nom_fichier_pattern: string | null;
  actif: boolean;
}

interface VariableRef {
  code: string;
  libelle: string;
  type_objet: string | null;
  type_donnee: string;
  categorie: string;
}

const TYPES_OBJET = [
  { v: "GENERIQUE",   l: "Générique" },
  { v: "CONGE",       l: "Congé" },
  { v: "DEPART",      l: "Départ" },
  { v: "RECRUTEMENT", l: "Recrutement" },
  { v: "AVENANT",     l: "Avenant" },
  { v: "ATTESTATION", l: "Attestation" },
  { v: "CONTRAT",     l: "Contrat" },
];

const TYPES_DOC = [
  { v: "TEXTE", l: "Texte simple",  desc: "Idéal pour attestations courtes — converti en PDF" },
  { v: "HTML",  l: "HTML",          desc: "Mise en page CSS — converti en PDF" },
  { v: "WORD",  l: "Word (.docx)",  desc: "Fichier Word uploadé avec placeholders" },
  { v: "PDF",   l: "PDF (lecture)", desc: "PDF déjà constitué (cas rare)" },
];

const inp = "px-3 py-1.5 rounded-lg border text-sm outline-none w-full";
const inpStyle = { borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" };

const SAMPLE: Record<string, string> = {
  civilite: "M.", nom: "DAIA", prenom: "Adil", nom_complet: "M. Adil DAIA",
  matricule: "00001", fonction: "Directeur Technique",
  date_debut: "15/05/2026", date_fin: "19/05/2026", nb_jours: "5",
  date_jour: new Date().toLocaleDateString("fr-FR"),
  ville_societe: "Rabat", societe_libelle: "SOLGEIS",
  motif_depart: "DEMISSION", date_entree: "01/03/2018", date_sortie: "30/06/2026",
  objet_mission: "Audit fournisseur", destination: "Casablanca",
  cin: "AB123456", adresse: "5 rue Mohamed V, Rabat",
  code_type_contrat: "CDI", categorie_pro: "Cadres Supérieurs", salaire_base: "25 000 MAD",
  date_naissance: "12/04/1985",
};

const renderPreview = (s: string) =>
  (s || "").replace(/\{(\w+)\}/g, (_m, k) => SAMPLE[k] ?? `{${k}}`);

const TemplatesDocumentPage: React.FC = () => {
  const [templates, setTemplates] = useState<DocTemplate[]>([]);
  const [variables, setVariables] = useState<VariableRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filterObjet, setFilterObjet] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<DocTemplate | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: tpls }, { data: vars }] = await Promise.all([
      (supabase.from("ref_template_document" as never) as any)
        .select("*").order("type_objet").order("libelle"),
      (supabase.from("ref_workflow_variable" as never) as any)
        .select("*").eq("actif", true).order("type_objet").order("categorie").order("ordre"),
    ]);
    setTemplates(tpls || []);
    setVariables(vars || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => templates.filter(t => {
    if (filterObjet !== "ALL" && (t.type_objet || "GENERIQUE") !== filterObjet) return false;
    if (search && !(`${t.code} ${t.libelle}`.toLowerCase().includes(search.toLowerCase()))) return false;
    return true;
  }), [templates, filterObjet, search]);

  const variablesGroupees = useMemo(() => {
    const filtered = variables.filter(v =>
      !editing?.type_objet || v.type_objet === null || v.type_objet === editing.type_objet
    );
    const par_cat: Record<string, VariableRef[]> = {};
    filtered.forEach(v => {
      if (!par_cat[v.categorie]) par_cat[v.categorie] = [];
      par_cat[v.categorie].push(v);
    });
    return par_cat;
  }, [variables, editing?.type_objet]);

  const openNew = () => {
    setEditing({
      id: "", code: "", libelle: "", description: "",
      type_objet: "CONGE", type_document: "TEXTE",
      chemin_fichier: null, contenu: "",
      variables: [], extension_sortie: "pdf",
      nom_fichier_pattern: "", actif: true,
    });
    setError(null);
  };

  const openEdit = (t: DocTemplate) => {
    setEditing({ ...t, contenu: t.contenu || "", description: t.description || "",
                 nom_fichier_pattern: t.nom_fichier_pattern || "",
                 variables: t.variables || [] });
    setError(null);
  };

  const insertVariable = (code: string) => {
    if (!editing) return;
    const target = document.activeElement as HTMLTextAreaElement | HTMLInputElement | null;
    const placeholder = `{${code}}`;
    const field = target?.getAttribute("data-field");

    if (target && field === "contenu" && target.tagName === "TEXTAREA") {
      const start = target.selectionStart || 0;
      const end = target.selectionEnd || 0;
      const newVal = target.value.substring(0, start) + placeholder + target.value.substring(end);
      setEditing({ ...editing, contenu: newVal });
      setTimeout(() => {
        target.focus();
        target.setSelectionRange(start + placeholder.length, start + placeholder.length);
      }, 0);
    } else if (target && field === "pattern") {
      const start = target.selectionStart || 0;
      const end = target.selectionEnd || 0;
      const newVal = target.value.substring(0, start) + placeholder + target.value.substring(end);
      setEditing({ ...editing, nom_fichier_pattern: newVal });
    } else {
      setEditing({ ...editing, contenu: (editing.contenu || "") + " " + placeholder });
    }
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.code || !editing.libelle) {
      setError("Code et libellé sont obligatoires.");
      return;
    }
    if (editing.type_document === "TEXTE" || editing.type_document === "HTML") {
      if (!editing.contenu) {
        setError("Le contenu est obligatoire pour les types TEXTE et HTML.");
        return;
      }
    }
    setSaving(true); setError(null);
    try {
      const usedVars = new Set<string>();
      const re = /\{(\w+)\}/g;
      [editing.contenu || "", editing.nom_fichier_pattern || ""].forEach(t => {
        let m;
        while ((m = re.exec(t)) !== null) usedVars.add(m[1]);
      });

      const payload = {
        code: editing.code,
        libelle: editing.libelle,
        description: editing.description || null,
        type_objet: editing.type_objet,
        type_document: editing.type_document,
        chemin_fichier: editing.chemin_fichier,
        contenu: editing.contenu || null,
        variables: Array.from(usedVars),
        extension_sortie: editing.extension_sortie,
        nom_fichier_pattern: editing.nom_fichier_pattern || null,
        actif: editing.actif,
      };

      if (editing.id) {
        const { error: e } = await (supabase.from("ref_template_document" as never) as any)
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", editing.id);
        if (e) throw e;
      } else {
        const { error: e } = await (supabase.from("ref_template_document" as never) as any).insert(payload);
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

  const remove = async (t: DocTemplate) => {
    if (!confirm(`Supprimer le template "${t.libelle}" ?`)) return;
    await (supabase.from("ref_template_document" as never) as any).delete().eq("id", t.id);
    load();
  };

  const duplicate = async (t: DocTemplate) => {
    const newCode = prompt("Nouveau code :", `${t.code}_COPIE`);
    if (!newCode) return;
    await (supabase.from("ref_template_document" as never) as any).insert({
      code: newCode, libelle: `${t.libelle} (copie)`,
      description: t.description, type_objet: t.type_objet,
      type_document: t.type_document, contenu: t.contenu,
      variables: t.variables, extension_sortie: t.extension_sortie,
      nom_fichier_pattern: t.nom_fichier_pattern, actif: true,
    });
    load();
  };

  // ── Render édition ─────────────────────────────────────────────────────
  if (editing) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-medium">{editing.id ? `Modifier : ${editing.libelle}` : "Nouveau modèle de document"}</h2>
            <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
              Cliquez sur une variable à droite pour l'insérer dans le contenu
            </p>
          </div>
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

        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 flex flex-col gap-3">
            {/* Infos */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Code *</label>
                <input className={inp} style={inpStyle} value={editing.code} disabled={!!editing.id}
                  onChange={e => setEditing({ ...editing, code: e.target.value.toUpperCase().replace(/\s/g, "_") })}
                  placeholder="TPL_ATTEST_CONGE" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Libellé *</label>
                <input className={inp} style={inpStyle} value={editing.libelle}
                  onChange={e => setEditing({ ...editing, libelle: e.target.value })}
                  placeholder="Attestation de congé" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Description</label>
              <input className={inp} style={inpStyle} value={editing.description || ""}
                onChange={e => setEditing({ ...editing, description: e.target.value })} />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Type d'objet</label>
                <select className={inp} style={inpStyle} value={editing.type_objet || "GENERIQUE"}
                  onChange={e => setEditing({ ...editing, type_objet: e.target.value === "GENERIQUE" ? null : e.target.value })}>
                  {TYPES_OBJET.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Type de document</label>
                <select className={inp} style={inpStyle} value={editing.type_document}
                  onChange={e => setEditing({ ...editing, type_document: e.target.value })}>
                  {TYPES_DOC.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Format de sortie</label>
                <select className={inp} style={inpStyle} value={editing.extension_sortie}
                  onChange={e => setEditing({ ...editing, extension_sortie: e.target.value })}>
                  <option value="pdf">PDF</option>
                  <option value="docx">Word (.docx)</option>
                  <option value="html">HTML</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                Pattern du nom de fichier
              </label>
              <input className={inp} style={inpStyle}
                data-field="pattern"
                value={editing.nom_fichier_pattern || ""}
                onChange={e => setEditing({ ...editing, nom_fichier_pattern: e.target.value })}
                placeholder="Attestation_{matricule}_{date_debut}" />
              <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                Aperçu : <span className="font-mono">{renderPreview(editing.nom_fichier_pattern || "document") + "." + editing.extension_sortie}</span>
              </p>
            </div>

            {/* Contenu / Upload */}
            {(editing.type_document === "TEXTE" || editing.type_document === "HTML") ? (
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Contenu * — utilisez les variables {`{nom}`}, {`{date_debut}`}, etc.
                </label>
                <textarea
                  className="px-3 py-2 rounded-lg border text-sm outline-none w-full font-mono"
                  style={{ ...inpStyle, minHeight: 280, fontSize: "calc(12px * var(--font-scale))", lineHeight: 1.6 }}
                  data-field="contenu"
                  value={editing.contenu || ""}
                  onChange={e => setEditing({ ...editing, contenu: e.target.value })}
                  placeholder={editing.type_document === "HTML"
                    ? "<h1>Attestation</h1><p>Nous attestons que {nom_complet}…</p>"
                    : "ATTESTATION\n\nNous attestons que {nom_complet}, matricule {matricule}…"} />
              </div>
            ) : (
              <div className="rounded-lg border-2 border-dashed p-6 text-center"
                style={{ borderColor: "hsl(var(--border))" }}>
                <Upload size={32} strokeWidth={1} className="mx-auto mb-2"
                  style={{ color: "hsl(var(--muted-foreground))" }} />
                <p className="text-sm font-medium mb-1">Modèle Word (.docx)</p>
                <p className="text-xs mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Upload du fichier non encore connecté — le moteur backend python-docx
                  doit être ajouté pour traiter les .docx
                </p>
                <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                  En attendant, vous pouvez créer des templates TEXTE ou HTML qui seront
                  convertis en PDF automatiquement.
                </p>
              </div>
            )}

            {/* Aperçu */}
            {(editing.type_document === "TEXTE" || editing.type_document === "HTML") && editing.contenu && (
              <div className="rounded-lg border p-4"
                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted)/0.3)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <Eye size={13} style={{ color: "hsl(var(--accent))" }} />
                  <span className="text-xs font-semibold uppercase tracking-wide"
                    style={{ color: "hsl(var(--muted-foreground))" }}>
                    Aperçu — données fictives
                  </span>
                </div>
                {editing.type_document === "HTML" ? (
                  <div className="text-sm" dangerouslySetInnerHTML={{ __html: renderPreview(editing.contenu) }} />
                ) : (
                  <pre className="text-sm whitespace-pre-wrap font-sans" style={{ color: "hsl(var(--foreground))" }}>
                    {renderPreview(editing.contenu)}
                  </pre>
                )}
              </div>
            )}
          </div>

          {/* Variables */}
          <div className="border rounded-lg overflow-hidden h-fit sticky top-4"
            style={{ borderColor: "hsl(var(--border))" }}>
            <div className="px-3 py-2 border-b flex items-center gap-2"
              style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted)/0.3)" }}>
              <VarIcon size={13} style={{ color: "hsl(var(--accent))" }} />
              <span className="text-xs font-semibold">Variables disponibles</span>
            </div>
            <div className="max-h-[520px] overflow-auto">
              {Object.entries(variablesGroupees).map(([cat, vars]) => (
                <div key={cat} className="border-b" style={{ borderColor: "hsl(var(--border))" }}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider px-3 pt-2 pb-1"
                    style={{ color: "hsl(var(--muted-foreground))" }}>{cat}</p>
                  {vars.map(v => (
                    <button key={v.code + (v.type_objet || "")}
                      onClick={() => insertVariable(v.code)}
                      className="w-full text-left px-3 py-1.5 hover:bg-muted/50 transition-colors flex items-start gap-2">
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

  // ── Render liste ───────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-medium">Modèles de documents</h1>
          <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
            Modèles d'attestations, ordres de mission, contrats utilisés par les workflows • {templates.length} modèle(s)
          </p>
        </div>
        <button onClick={openNew}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
          style={{ background: "hsl(var(--accent))", color: "white" }}>
          <Plus size={13} /> Nouveau modèle
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <button onClick={() => setFilterObjet("ALL")}
          className="px-3 py-1.5 rounded-lg text-xs font-medium border"
          style={{
            background: filterObjet === "ALL" ? "hsl(var(--accent))" : "transparent",
            color: filterObjet === "ALL" ? "white" : "hsl(var(--foreground))",
            borderColor: filterObjet === "ALL" ? "hsl(var(--accent))" : "hsl(var(--border))",
          }}>
          Tous ({templates.length})
        </button>
        {TYPES_OBJET.map(o => {
          const count = templates.filter(t => (t.type_objet || "GENERIQUE") === o.v).length;
          if (count === 0) return null;
          const active = filterObjet === o.v;
          return (
            <button key={o.v} onClick={() => setFilterObjet(o.v)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border"
              style={{
                background: active ? "hsl(var(--accent)/0.15)" : "transparent",
                color: active ? "hsl(var(--accent))" : "hsl(var(--foreground))",
                borderColor: active ? "hsl(var(--accent))" : "hsl(var(--border))",
              }}>
              {o.l} ({count})
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

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin" style={{ color: "hsl(var(--accent))" }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 rounded-xl border border-dashed"
          style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
          <FileText size={32} strokeWidth={1} className="mx-auto mb-2" />
          <p className="text-sm">Aucun modèle</p>
        </div>
      ) : (
        <div className="grid gap-2">
          {filtered.map(t => (
            <div key={t.id} className="rounded-xl border p-3 flex items-center gap-3"
              style={{ borderColor: "hsl(var(--border))" }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: "hsl(var(--accent)/0.1)", color: "hsl(var(--accent))" }}>
                <FileText size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs px-1.5 py-0.5 rounded"
                    style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                    {t.code}
                  </span>
                  <span className="text-sm font-medium truncate">{t.libelle}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded ml-auto flex-shrink-0"
                    style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                    {t.type_document} → {t.extension_sortie}
                  </span>
                </div>
                {t.description && (
                  <p className="text-xs truncate mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                    {t.description}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => duplicate(t)} className="p-1.5 rounded hover:bg-muted" title="Dupliquer">
                  <Copy size={12} style={{ color: "hsl(var(--muted-foreground))" }} />
                </button>
                <button onClick={() => openEdit(t)} className="p-1.5 rounded hover:bg-muted" title="Modifier">
                  <Pencil size={12} style={{ color: "hsl(var(--muted-foreground))" }} />
                </button>
                <button onClick={() => remove(t)} className="p-1.5 rounded hover:bg-muted" title="Supprimer">
                  <Trash2 size={12} style={{ color: "hsl(0 84% 55%)" }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TemplatesDocumentPage;
