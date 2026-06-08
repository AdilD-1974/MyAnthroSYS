/**
 * BaremesDroitsPage – Gestion des barèmes de droits de congé
 * Configuration > Gestion des Temps > Barèmes de Droits
 *
 * Auteur : Adil DAIA
 *
 * RG-BAREME-01 : Un barème est composé de tranches évaluées dans l'ordre.
 *                La première tranche dont tous les critères correspondent au
 *                profil du collaborateur détermine le droit accordé.
 * RG-BAREME-02 : Les critères d'une tranche couvrent toutes les données
 *                collaborateur : général, affectations, contrats.
 * RG-BAREME-03 : Un barème peut être réutilisé sur plusieurs types de congé
 *                (droit légal, convention ou particulier).
 */

import React, { useEffect, useState, useCallback } from "react";
import { useReferentiels } from "@/hooks/useReferentiels";
import { api } from "@/lib/api";
import {
  BarChart2, Plus, Pencil, Trash2, Check, X, Loader2,
  ChevronDown, ChevronRight, AlertTriangle, Search,
  FlaskConical, GripVertical, ChevronsUpDown, Layers,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type SaisieType = "PLAGE_MOIS" | "PLAGE_ANS" | "PLAGE_ENTIER" | "PLAGE_PCT"
                | "CHOIX" | "MULTI_CHOIX" | "TEXTE";

interface OptionRef { v: string; l: string; }

interface CritereDef {
  type: string;
  label: string;
  categorie: string;
  saisie: SaisieType;
  options?: OptionRef[];
  unite?: string;
}

interface CritereValeur {
  type: string;
  valeur_min?: number | null;
  valeur_max?: number | null;
  valeur?: string | null;
  valeurs?: string[];
}

interface Tranche {
  _id: string;          // id temporaire UI
  id?: string;          // id réel en base
  libelle: string;
  criteres: CritereValeur[];
  valeur_jours: number | "";
  ordre: number;
}

interface Bareme {
  id: string;
  code: string;
  libelle: string;
  description: string | null;
  critere_principal: string;
  actif: boolean;
  ordre: number;
  tranches?: Tranche[];
}

// ─── Référentiels ─────────────────────────────────────────────────────────────

// Référentiels chargés dynamiquement via useReferentiels (ref_categorie_professionnelle, ref_type_contrat)
const REF_SITUATIONS: OptionRef[] = [
  { v: "CELIBATAIRE", l: "Célibataire" }, { v: "MARIE", l: "Marié(e)" },
  { v: "DIVORCE", l: "Divorcé(e)" }, { v: "VEUF", l: "Veuf/Veuve" },
  { v: "SEPARE", l: "Séparé(e)" },
];

// CRITERES_DISPO est maintenant une fonction pour supporter les référentiels dynamiques
const getCriteresDispos = (
  refGenres: OptionRef[],
  refCategoriesPro: OptionRef[],
  refTypesContrat: OptionRef[]
): CritereDef[] => [
  // Données générales
  { type: "ANCIENNETE",         label: "Ancienneté",                categorie: "Données générales", saisie: "PLAGE_MOIS",   unite: "mois" },
  { type: "AGE",                label: "Âge",                       categorie: "Données générales", saisie: "PLAGE_ANS",    unite: "ans" },
  { type: "GENRE",              label: "Genre",                     categorie: "Données générales", saisie: "CHOIX",
    options: refGenres.map(g => ({ v: g.code, l: g.libelle })) },
  { type: "SITUATION_FAMILIALE",label: "Situation familiale",       categorie: "Données générales", saisie: "MULTI_CHOIX",  options: REF_SITUATIONS },
  { type: "NB_ENFANTS",         label: "Nbre enfants à charge",     categorie: "Données générales", saisie: "PLAGE_ENTIER", unite: "enfants" },
  // Affectations
  { type: "CATEGORIE_PRO",      label: "Catégorie professionnelle", categorie: "Affectations",      saisie: "MULTI_CHOIX",
    options: refCategoriesPro.map(c => ({ v: c.code, l: c.libelle })) },
  { type: "GRADE",              label: "Grade / Niveau",            categorie: "Affectations",      saisie: "TEXTE" },
  { type: "ETABLISSEMENT",      label: "Établissement",             categorie: "Affectations",      saisie: "TEXTE" },
  { type: "DEPARTEMENT",        label: "Département",               categorie: "Affectations",      saisie: "TEXTE" },
  { type: "POSTE",              label: "Poste",                     categorie: "Affectations",      saisie: "TEXTE" },
  // Contrats
  { type: "TYPE_CONTRAT",       label: "Type de contrat",           categorie: "Contrats",          saisie: "MULTI_CHOIX",
    options: refTypesContrat.map(t => ({ v: t.code, l: t.libelle })) },
  { type: "TEMPS_TRAVAIL",      label: "Taux temps de travail",     categorie: "Contrats",          saisie: "PLAGE_PCT",    unite: "%" },
];

// getCritDef est maintenant dans le composant pour accéder aux refs dynamiques

const inputCls = "px-3 py-1.5 rounded-lg border text-sm outline-none transition-colors";
const inputStyle = { borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" };

const uid = () => Math.random().toString(36).slice(2);

// ─── Composant principal ───────────────────────────────────────────────────────

const BaremesDroitsPage: React.FC = () => {
  const { genres: refGenres, typesContrat: refTypesContrat, categoriesPro: refCategoriesPro } = useReferentiels();

  // Référentiels dynamiques recalculés à chaque changement
  const CRITERES_DISPO = getCriteresDispos(refGenres, refCategoriesPro, refTypesContrat);
  const getCritDef = (type: string) => CRITERES_DISPO.find(c => c.type === type);
  const [baremes, setBaremes] = useState<Bareme[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [panel, setPanel] = useState<"new" | string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [simOpen, setSimOpen] = useState(false);

  // Formulaire barème
  const EMPTY_BAREME = { code: "", libelle: "", description: "", critere_principal: "ANCIENNETE", actif: true, ordre: 0 };
  const [form, setForm] = useState(EMPTY_BAREME);
  const [tranches, setTranches] = useState<Tranche[]>([]);

  // Simulateur
  const [sim, setSim] = useState({
    anciennete_mois: 36, age: 35, genre: "H", situation_familiale: "MARIE",
    nb_enfants: 2, categorie_pro: "CP02", type_contrat: "CDI_STD",
    temps_travail: 100, grade: "", etablissement: "", departement: "", poste: "",
  });
  const [simResult, setSimResult] = useState<{ tranche: Tranche | null; valeur: number | null }>({ tranche: null, valeur: null });

  // ── Chargement ────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data: any = await api.get("/db/bareme_droit_conge?order=ordre");
      if (data) {
        // RG-BAREME-FIX-01 : criteres peut arriver comme string JSON depuis la DB
        const parseCriteres = (raw: any): any[] => {
          if (Array.isArray(raw)) return raw;
          if (typeof raw === "string") { try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; } }
          return [];
        };
        const withTranches = await Promise.all((data as Bareme[]).map(async (b: any) => {
          const tr: any = await api.get(`/db/bareme_droit_conge_tranche?code_bareme=eq.${b.code}&order=ordre`);
          return { ...b, tranches: (tr || []).map((t: any) => ({ ...t, _id: t.id || uid(), criteres: parseCriteres(t.criteres) })) };
        }));
        setBaremes(withTranches);
      }
    } catch (e: any) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Ouvrir édition ────────────────────────────────────────────────────────
  const openEdit = (b: Bareme) => {
    setForm({ code: b.code, libelle: b.libelle, description: b.description || "", critere_principal: b.critere_principal, actif: b.actif, ordre: b.ordre });
    const parseCriteres2 = (raw: any): any[] => {
      if (Array.isArray(raw)) return raw;
      if (typeof raw === "string") { try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; } }
      return [];
    };
    setTranches((b.tranches || []).map(t => ({ ...t, _id: t.id || uid(), criteres: parseCriteres2(t.criteres) })));
    setPanel(`edit:${b.code}`);
    setError(null);
  };

  const openNew = () => {
    setForm({ ...EMPTY_BAREME });
    setTranches([]);
    setPanel("new");
    setError(null);
  };

  // ── Gestion des tranches ──────────────────────────────────────────────────
  const addTranche = () => {
    setTranches(prev => [...prev, { _id: uid(), libelle: "", criteres: [], valeur_jours: "", ordre: prev.length }]);
  };

  const removeTranche = (id: string) => setTranches(prev => prev.filter(t => t._id !== id));

  const updateTranche = (id: string, field: keyof Tranche, value: any) =>
    setTranches(prev => prev.map(t => t._id === id ? { ...t, [field]: value } : t));

  const addCritere = (tid: string, type: string) =>
    setTranches(prev => prev.map(t => t._id !== tid ? t : {
      ...t, criteres: [...t.criteres, { type, valeur: null, valeur_min: null, valeur_max: null, valeurs: [] }],
    }));

  const updateCritere = (tid: string, idx: number, patch: Partial<CritereValeur>) =>
    setTranches(prev => prev.map(t => t._id !== tid ? t : {
      ...t, criteres: t.criteres.map((c, i) => i === idx ? { ...c, ...patch } : c),
    }));

  const removeCritere = (tid: string, idx: number) =>
    setTranches(prev => prev.map(t => t._id !== tid ? t : {
      ...t, criteres: t.criteres.filter((_, i) => i !== idx),
    }));

  // ── Sauvegarde ────────────────────────────────────────────────────────────
  const save = async () => {
    if (!form.code || !form.libelle) { setError("Code et libellé sont requis."); return; }
    const isEdit = panel?.startsWith("edit:");
    setSaving(true); setError(null);

    const payload = { ...form, code: form.code.toUpperCase() };
    try {
      if (isEdit) await api.patch(`/db/bareme_droit_conge?code=eq.${payload.code}`, payload);
      else await api.post("/db/bareme_droit_conge", payload);
    } catch (e: any) { setSaving(false); setError(e.message?.includes("duplicate") ? "Ce code existe déjà." : (e.message || "Erreur")); return; }

    // Remplacer les tranches
    await api.delete(`/db/bareme_droit_conge_tranche?code_bareme=eq.${payload.code}`);
    if (tranches.length > 0) {
      const rows = tranches.map((t, i) => ({
        code_bareme: payload.code,
        libelle: t.libelle || null,
        criteres: t.criteres.filter(c => {
          if (c.valeurs && c.valeurs.length > 0) return true;
          if (c.valeur != null && c.valeur !== "") return true;
          if (c.valeur_min != null || c.valeur_max != null) return true;
          return false;
        }),
        valeur_jours: Number(t.valeur_jours) || 0,
        ordre: i,
      }));
      try { await api.post("/db/bareme_droit_conge_tranche", rows); }
      catch (e: any) { setSaving(false); setError(e.message || "Erreur tranches"); return; }
    }

    setSaving(false);
    setPanel(null);
    load();
  };

  const deleteBareme = async (code: string) => {
    if (!confirm(`Supprimer le barème "${code}" ?`)) return;
    await api.delete(`/db/bareme_droit_conge_tranche?code_bareme=eq.${code}`);
    await api.delete(`/db/bareme_droit_conge?code=eq.${code}`);
    load();
  };

  // ── Simulateur ────────────────────────────────────────────────────────────
  const evaluerCritere = (c: CritereValeur): boolean => {
    const def = getCritDef(c.type);
    if (!def) return true;
    const get = (key: string) => (sim as any)[key.toLowerCase()] ?? (sim as any)[
      ({ ANCIENNETE: "anciennete_mois", AGE: "age", GENRE: "genre", SITUATION_FAMILIALE: "situation_familiale",
         NB_ENFANTS: "nb_enfants", CATEGORIE_PRO: "categorie_pro", TYPE_CONTRAT: "type_contrat",
         TEMPS_TRAVAIL: "temps_travail", GRADE: "grade", ETABLISSEMENT: "etablissement",
         DEPARTEMENT: "departement", POSTE: "poste" } as Record<string,string>)[c.type]
    ];
    const val = get(c.type);

    if (def.saisie.startsWith("PLAGE")) {
      const n = Number(val);
      if (c.valeur_min != null && n < c.valeur_min) return false;
      if (c.valeur_max != null && n > c.valeur_max) return false;
      return true;
    }
    if (def.saisie === "CHOIX") return !c.valeur || String(val) === c.valeur;
    if (def.saisie === "MULTI_CHOIX") return !c.valeurs?.length || c.valeurs.includes(String(val));
    if (def.saisie === "TEXTE") return !c.valeur || String(val).toLowerCase().includes(c.valeur.toLowerCase());
    return true;
  };

  const simuler = () => {
    const match = tranches.find(t => t.criteres.every(c => evaluerCritere(c)));
    setSimResult({ tranche: match || null, valeur: match ? Number(match.valeur_jours) : null });
    setSimOpen(true);
  };

  // ── Render critère builder ────────────────────────────────────────────────
  const renderCritere = (t: Tranche, c: CritereValeur, idx: number) => {
    const def = getCritDef(c.type);
    if (!def) return null;
    return (
      <div key={idx} className="flex items-start gap-2 p-2 rounded-lg border"
        style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted)/0.2)" }}>
        <div className="flex-1">
          <span className="text-xs font-semibold" style={{ color: "hsl(var(--accent))" }}>{def.label}</span>
          <div className="flex flex-wrap gap-2 mt-1.5">
            {def.saisie.startsWith("PLAGE") && (<>
              <div className="flex items-center gap-1">
                <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>de</span>
                <input className={inputCls} style={{ ...inputStyle, width: 80 }} type="number" min={0}
                  placeholder="Min" value={c.valeur_min ?? ""}
                  onChange={e => updateCritere(t._id, idx, { valeur_min: e.target.value ? Number(e.target.value) : null })} />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>à</span>
                <input className={inputCls} style={{ ...inputStyle, width: 80 }} type="number" min={0}
                  placeholder="Max (∞)" value={c.valeur_max ?? ""}
                  onChange={e => updateCritere(t._id, idx, { valeur_max: e.target.value ? Number(e.target.value) : null })} />
                <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>{def.unite}</span>
              </div>
            </>)}
            {def.saisie === "CHOIX" && def.options && (
              <div className="flex gap-1 flex-wrap">
                {def.options.map(o => (
                  <button key={o.v} type="button"
                    onClick={() => updateCritere(t._id, idx, { valeur: c.valeur === o.v ? null : o.v })}
                    className="px-2.5 py-1 rounded-full text-[11px] font-medium border"
                    style={{
                      background: c.valeur === o.v ? "hsl(var(--accent))" : "transparent",
                      color: c.valeur === o.v ? "white" : "hsl(var(--muted-foreground))",
                      borderColor: c.valeur === o.v ? "hsl(var(--accent))" : "hsl(var(--border))",
                    }}>{o.l}</button>
                ))}
              </div>
            )}
            {def.saisie === "MULTI_CHOIX" && def.options && (
              <div className="flex gap-1 flex-wrap">
                {def.options.map(o => {
                  const active = (c.valeurs || []).includes(o.v);
                  return (
                    <button key={o.v} type="button"
                      onClick={() => {
                        const cur = c.valeurs || [];
                        updateCritere(t._id, idx, { valeurs: active ? cur.filter(v => v !== o.v) : [...cur, o.v] });
                      }}
                      className="px-2.5 py-1 rounded-full text-[11px] font-medium border"
                      style={{
                        background: active ? "hsl(var(--accent))" : "transparent",
                        color: active ? "white" : "hsl(var(--muted-foreground))",
                        borderColor: active ? "hsl(var(--accent))" : "hsl(var(--border))",
                      }}>{o.l}</button>
                  );
                })}
              </div>
            )}
            {def.saisie === "TEXTE" && (
              <input className={inputCls} style={{ ...inputStyle, width: 160 }}
                placeholder={`Contient...`} value={c.valeur || ""}
                onChange={e => updateCritere(t._id, idx, { valeur: e.target.value || null })} />
            )}
          </div>
        </div>
        <button onClick={() => removeCritere(t._id, idx)} className="p-1 rounded hover:bg-muted mt-0.5">
          <X size={12} style={{ color: "hsl(0 84% 55%)" }} />
        </button>
      </div>
    );
  };

  // ── Render tranche ────────────────────────────────────────────────────────
  const renderTranche = (t: Tranche, idx: number) => {
    const cats = [...new Set(CRITERES_DISPO.map(c => c.categorie))];
    const usedTypes = t.criteres.map(c => c.type);
    const available = CRITERES_DISPO.filter(c => !usedTypes.includes(c.type));

    return (
      <div key={t._id} className="rounded-xl border overflow-hidden"
        style={{ borderColor: "hsl(var(--border))" }}>
        {/* Header tranche */}
        <div className="flex items-center gap-3 px-4 py-2.5"
          style={{ background: "hsl(var(--muted)/0.3)", borderBottom: "1px solid hsl(var(--border))" }}>
          <GripVertical size={14} style={{ color: "hsl(var(--muted-foreground))" }} />
          <span className="text-xs font-mono px-2 py-0.5 rounded"
            style={{ background: "hsl(var(--accent)/0.12)", color: "hsl(var(--accent))" }}>
            Tranche {idx + 1}
          </span>
          <input className={inputCls} style={{ ...inputStyle, flex: 1, fontSize: 12 }}
            placeholder="Libellé optionnel (ex: Cadres > 5 ans)"
            value={t.libelle}
            onChange={e => updateTranche(t._id, "libelle", e.target.value)} />
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-xs font-semibold" style={{ color: "hsl(var(--foreground))" }}>→</span>
            <input className={inputCls} style={{ ...inputStyle, width: 70, textAlign: "center" }}
              type="number" min={0} step={0.5} placeholder="0"
              value={t.valeur_jours}
              onChange={e => updateTranche(t._id, "valeur_jours", e.target.value)} />
            <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>jours</span>
          </div>
          <button onClick={() => removeTranche(t._id)} className="p-1.5 rounded hover:bg-muted">
            <Trash2 size={12} style={{ color: "hsl(0 84% 55%)" }} />
          </button>
        </div>

        {/* Critères */}
        <div className="p-3 flex flex-col gap-2">
          {t.criteres.length === 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
              style={{ background: "hsl(142 60% 50% / 0.08)", border: "1px solid hsl(142 60% 50% / 0.2)", color: "hsl(142 60% 35%)" }}>
              ✓ Tranche de repli — s'applique à tous les collaborateurs sans autre correspondance
            </div>
          )}
          {t.criteres.map((c, i) => renderCritere(t, c, i))}

          {/* Ajouter un critère */}
          {available.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              <span className="text-[11px] self-center mr-1" style={{ color: "hsl(var(--muted-foreground))" }}>+ Critère :</span>
              {cats.map(cat => {
                const items = available.filter(c => c.categorie === cat);
                if (!items.length) return null;
                return items.map(item => (
                  <button key={item.type} type="button"
                    onClick={() => addCritere(t._id, item.type)}
                    className="px-2 py-0.5 rounded text-[11px] border transition-all hover:border-accent"
                    style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
                    {item.label}
                  </button>
                ));
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── Render formulaire ─────────────────────────────────────────────────────
  const renderForm = () => (
    <div className="rounded-xl border p-4 mb-4"
      style={{ background: "hsl(var(--accent)/0.04)", borderColor: "hsl(var(--accent)/0.3)" }}>
      <p className="text-sm font-semibold mb-4" style={{ color: "hsl(var(--accent))" }}>
        {panel === "new" ? "Nouveau barème de droits" : `Modifier barème : ${form.code}`}
      </p>

      {/* Infos générales */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Code *</label>
          <input className={inputCls} style={{ ...inputStyle, width: "100%" }}
            value={form.code} disabled={panel?.startsWith("edit:")}
            onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
            placeholder="BAREM-CP-ANCIENNETE" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Libellé *</label>
          <input className={inputCls} style={{ ...inputStyle, width: "100%" }}
            value={form.libelle}
            onChange={e => setForm(f => ({ ...f, libelle: e.target.value }))}
            placeholder="Barème CP par ancienneté" />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Ordre</label>
          <input className={inputCls} style={{ ...inputStyle, width: "100%" }} type="number"
            value={form.ordre} onChange={e => setForm(f => ({ ...f, ordre: Number(e.target.value) }))} />
        </div>
        <div className="col-span-full">
          <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Description</label>
          <input className={inputCls} style={{ ...inputStyle, width: "100%" }}
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="Barème utilisé pour le congé payé annuel..." />
        </div>
      </div>

      {/* Tranches */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Layers size={14} style={{ color: "hsl(var(--accent))" }} />
            <span className="text-xs font-semibold" style={{ color: "hsl(var(--foreground))" }}>
              Tranches ({tranches.length})
            </span>
            <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>
              — évaluées dans l'ordre, première tranche correspondante appliquée
            </span>
          </div>
          <div className="flex gap-2">
            <button onClick={simuler} disabled={tranches.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border"
              style={{ borderColor: "hsl(var(--accent))", color: "hsl(var(--accent))" }}>
              <FlaskConical size={12} /> Simuler
            </button>
            <button onClick={addTranche}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{ background: "hsl(var(--accent))", color: "white" }}>
              <Plus size={12} /> Tranche
            </button>
          </div>
        </div>

        {tranches.length === 0 ? (
          <div className="py-8 text-center rounded-xl border border-dashed"
            style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
            <Layers size={28} strokeWidth={1} className="mx-auto mb-2" />
            <p className="text-sm">Aucune tranche — cliquez "+ Tranche" pour commencer</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {tranches.map((t, i) => renderTranche(t, i))}
          </div>
        )}
      </div>

      {/* Simulateur inline */}
      {simOpen && (
        <div className="mb-4 rounded-xl border p-4"
          style={{ borderColor: "hsl(var(--accent)/0.3)", background: "hsl(var(--accent)/0.04)" }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold flex items-center gap-2" style={{ color: "hsl(var(--accent))" }}>
              <FlaskConical size={13} /> Simulateur de profil
            </span>
            <button onClick={() => setSimOpen(false)}><X size={13} /></button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            {[
              { label: "Ancienneté (mois)", key: "anciennete_mois", type: "number" },
              { label: "Âge (ans)",          key: "age",            type: "number" },
              { label: "Nb enfants",         key: "nb_enfants",     type: "number" },
              { label: "Tps travail (%)",    key: "temps_travail",  type: "number" },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-[11px] mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>{f.label}</label>
                <input className={inputCls} style={{ ...inputStyle, width: "100%" }} type={f.type}
                  value={(sim as any)[f.key]}
                  onChange={e => setSim(s => ({ ...s, [f.key]: Number(e.target.value) }))} />
              </div>
            ))}
            {[
              { label: "Genre", key: "genre", opts: refGenres.map(g => ({v: g.code, l: g.libelle})) },
              { label: "Situation familiale", key: "situation_familiale", opts: REF_SITUATIONS },
              { label: "Catégorie pro", key: "categorie_pro", opts: refCategoriesPro.map(c => ({v: c.code, l: c.libelle})) },
              { label: "Type contrat", key: "type_contrat", opts: refTypesContrat.map(t => ({v: t.code, l: t.libelle})) },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-[11px] mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>{f.label}</label>
                <select className={inputCls} style={{ ...inputStyle, width: "100%", fontSize: 12 }}
                  value={(sim as any)[f.key]}
                  onChange={e => setSim(s => ({ ...s, [f.key]: e.target.value }))}>
                  {f.opts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
              </div>
            ))}
          </div>
          <button onClick={simuler}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold mb-3"
            style={{ background: "hsl(var(--accent))", color: "white" }}>
            Calculer
          </button>
          {simResult.valeur !== null ? (
            <div className="px-4 py-3 rounded-lg text-sm font-semibold"
              style={{ background: "hsl(142 60% 50% / 0.12)", color: "hsl(142 60% 35%)", border: "1px solid hsl(142 60% 50% / 0.3)" }}>
              ✅ Tranche «{simResult.tranche?.libelle || `Tranche ${(tranches.indexOf(simResult.tranche!) + 1)}`}» → {simResult.valeur} jours
            </div>
          ) : (
            <div className="px-4 py-3 rounded-lg text-sm"
              style={{ background: "hsl(0 84% 55% / 0.1)", color: "hsl(0 84% 45%)", border: "1px solid hsl(0 84% 55% / 0.3)" }}>
              ❌ Aucune tranche ne correspond à ce profil
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
          style={{ background: "hsl(0 84% 55% / 0.1)", color: "hsl(0 84% 45%)" }}>
          <AlertTriangle size={13} /> {error}
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={save} disabled={saving}
          className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold"
          style={{ background: "hsl(var(--accent))", color: "white" }}>
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button onClick={() => { setPanel(null); setError(null); }}
          className="px-4 py-1.5 rounded-lg text-sm border"
          style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
          Annuler
        </button>
      </div>
    </div>
  );

  // ── Render principal ──────────────────────────────────────────────────────
  const filtered = baremes.filter(b =>
    !search || b.libelle.toLowerCase().includes(search.toLowerCase()) || b.code.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl" style={{ background: "hsl(var(--accent)/0.1)" }}>
            <BarChart2 size={20} style={{ color: "hsl(var(--accent))" }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: "hsl(var(--foreground))" }}>Barèmes de Droits</h1>
            <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
              Grilles de calcul paramétrables pour les droits de congé • {baremes.length} barème(s)
            </p>
          </div>
        </div>
        <button onClick={openNew}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
          style={{ background: "hsl(var(--accent))", color: "white" }}>
          <Plus size={13} /> Nouveau barème
        </button>
      </div>

      {/* Formulaire */}
      {panel && renderForm()}

      {/* Filtre */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
        <input className="w-full pl-8 pr-3 py-1.5 rounded-lg border text-sm outline-none"
          style={inputStyle} value={search}
          onChange={e => setSearch(e.target.value)} placeholder="Rechercher un barème..." />
      </div>

      {/* Liste */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin" style={{ color: "hsl(var(--accent))" }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16" style={{ color: "hsl(var(--muted-foreground))" }}>
          <BarChart2 size={40} strokeWidth={1} className="mx-auto mb-3" />
          <p className="text-sm">Aucun barème — cliquez "+ Nouveau barème" pour commencer</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map(b => {
            const isOpen = expanded.has(b.code);
            return (
              <div key={b.code} className="rounded-xl border overflow-hidden"
                style={{ borderColor: "hsl(var(--border))" }}>
                <div className="flex items-center gap-3 px-4 py-3"
                  style={{ background: "hsl(var(--card))" }}>
                  <button onClick={() => setExpanded(prev => { const n = new Set(prev); n.has(b.code) ? n.delete(b.code) : n.add(b.code); return n; })}>
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  <span className="font-mono text-xs px-1.5 py-0.5 rounded"
                    style={{ background: "hsl(var(--accent)/0.12)", color: "hsl(var(--accent))" }}>{b.code}</span>
                  <span className="text-sm font-medium flex-1" style={{ color: "hsl(var(--foreground))" }}>{b.libelle}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full"
                    style={{ background: "hsl(var(--muted)/0.5)", color: "hsl(var(--muted-foreground))" }}>
                    {b.tranches?.length || 0} tranche(s)
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${b.actif ? "text-emerald-700" : "text-gray-400"}`}
                    style={{ background: b.actif ? "hsl(142 60% 50% / 0.12)" : "hsl(var(--muted)/0.5)" }}>
                    {b.actif ? "Actif" : "Inactif"}
                  </span>
                  <button onClick={() => openEdit(b)} className="p-1.5 rounded hover:bg-muted">
                    <Pencil size={12} style={{ color: "hsl(var(--muted-foreground))" }} />
                  </button>
                  <button onClick={() => deleteBareme(b.code)} className="p-1.5 rounded hover:bg-muted">
                    <Trash2 size={12} style={{ color: "hsl(0 84% 55%)" }} />
                  </button>
                </div>
                {isOpen && b.tranches && b.tranches.length > 0 && (
                  <table className="w-full text-xs border-t" style={{ borderColor: "hsl(var(--border))" }}>
                    <thead>
                      <tr style={{ background: "hsl(var(--muted)/0.2)" }}>
                        <th className="px-4 py-2 text-left font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Tranche</th>
                        <th className="px-4 py-2 text-left font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Critères</th>
                        <th className="px-4 py-2 text-center font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Droit (jours)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.tranches.map((t, i) => (
                        <tr key={t._id} style={{ borderTop: "1px solid hsl(var(--border))" }}>
                          <td className="px-4 py-2">{t.libelle || `Tranche ${i + 1}`}</td>
                          <td className="px-4 py-2">
                            {t.criteres.length === 0 ? (
                              <span style={{ color: "hsl(var(--muted-foreground))" }}>Tous</span>
                            ) : t.criteres.map((c, ci) => {
                              const def = getCritDef(c.type);
                              if (!def) return null;
                              let resume = def.label;
                              if (def.saisie.startsWith("PLAGE")) {
                                resume += ` : ${c.valeur_min ?? "0"} → ${c.valeur_max ?? "∞"} ${def.unite || ""}`;
                              } else if (c.valeurs?.length) {
                                resume += ` : ${c.valeurs.join(", ")}`;
                              } else if (c.valeur) {
                                resume += ` : ${c.valeur}`;
                              }
                              return (
                                <span key={ci} className="inline-block px-1.5 py-0.5 rounded mr-1 mb-1"
                                  style={{ background: "hsl(var(--accent)/0.1)", color: "hsl(var(--accent))" }}>
                                  {resume}
                                </span>
                              );
                            })}
                          </td>
                          <td className="px-4 py-2 text-center font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                            {t.valeur_jours} j
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default BaremesDroitsPage;
