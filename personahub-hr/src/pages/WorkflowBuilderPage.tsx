/**
 * WorkflowBuilderPage.tsx — Constructeur de workflows paramétrables
 * Auteur : Adil DAIA
 * Route  : /configuration/processus/workflows
 *
 * RG-WF-01 : Un workflow est versionné — modifier un workflow actif crée une v+1.
 * RG-WF-02 : Les étapes sont ordonnées et peuvent être conditionnelles.
 * RG-WF-03 : Chaque étape a ses propres acteurs, décisions et actions.
 * RG-WF-04 : Un workflow ACTIF ne peut pas être supprimé — seulement archivé.
 */

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Plus, Pencil, Trash2, Check, X, Loader2, ChevronDown,
  ChevronRight, GripVertical, Copy, Archive, Eye,
  ArrowRight, Bell, Mail, MessageSquare, FileText,
  Zap, Globe, Users, User, Building2, Network,
  Clock, AlertTriangle, Settings, PlayCircle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WfTemplate { id: string; code: string; libelle: string; type_canal: string; }

interface WfActeur {
  _id: string; id?: string;
  type_acteur: string; valeur: string | null;
  ordre_delegation: number; est_observateur: boolean;
  peut_deleguer: boolean; delai_relance_h: number | null;
  fallback_type: string | null; fallback_valeur: string | null;
}

interface WfDecision {
  _id: string; id?: string;
  code: string; libelle: string; type_decision: string;
  obligatoire_commentaire: boolean; couleur: string; icone: string; ordre: number;
}

interface WfAction {
  _id: string; id?: string;
  declencheur: string; type_action: string;
  ordre: number; configuration: Record<string, any>;
  condition_exec: string | null;
}

interface WfEtape {
  _id: string; id?: string;
  code: string; libelle: string; description: string;
  ordre: number; type_etape: string; mode_validation: string;
  delai_heures: number | null; delai_relance_heures: number | null;
  obligatoire_commentaire: boolean; pj_autorisees: boolean;
  condition_sql: string | null; couleur: string;
  auto_skip_si_deja_decide: boolean;
  acteurs: WfActeur[]; decisions: WfDecision[]; actions: WfAction[];
}

interface Workflow {
  id: string; code: string; libelle: string; description: string | null;
  type_objet: string; version: number; statut: string;
  criteres: Record<string, any>; delai_global_heures: number | null;
  couleur: string | null; ordre: number; actif: boolean;
  etapes?: WfEtape[];
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const TYPES_OBJET = ["CONGE","DEPART","RECRUTEMENT","MOUVEMENT","AVENANT","DOCUMENT","CUSTOM"];
const TYPES_ETAPE = ["VALIDATION","INFORMATION","SIGNATURE","PARALLELE","AUTOMATIQUE","CONDITION"];
const MODES_VALID = ["TOUS","UN_SUFFISANT","MAJORITE"];
const TYPES_ACTEUR = [
  "UTILISATEUR_FIXE","ROLE","HIERARCHIE_N1","HIERARCHIE_N2","DEMANDEUR","GROUPE","DYNAMIQUE",
  "UO_RESPONSABLE","UO_PARENTE_RESPONSABLE","UO_GRAND_PARENTE_RESPONSABLE","UO_RACINE_RESPONSABLE"
];
const TYPES_DECISION = ["VALIDER","REJETER","RENVOYER","DELEGUER","VISER","DEMANDER_INFO","ACCUSER_RECEPTION"];
const DECLENCHEURS = ["ENTREE","VALIDATION","REJET","TIMEOUT","RELANCE","COMMENTAIRE","DELEGATION","FINALISATION"];
const TYPES_ACTION = ["NOTIFICATION_INTERNE","EMAIL","SMS","WHATSAPP","GENERER_DOCUMENT","TACHE_SYSTEME","WEBHOOK","PUSH_MOBILE"];

const ACTION_ICONS: Record<string, React.ReactNode> = {
  NOTIFICATION_INTERNE: <Bell size={12} />,
  EMAIL: <Mail size={12} />,
  SMS: <MessageSquare size={12} />,
  WHATSAPP: <MessageSquare size={12} />,
  GENERER_DOCUMENT: <FileText size={12} />,
  TACHE_SYSTEME: <Zap size={12} />,
  WEBHOOK: <Globe size={12} />,
  PUSH_MOBILE: <Bell size={12} />,
};

const ACTEUR_ICONS: Record<string, React.ReactNode> = {
  UTILISATEUR_FIXE: <User size={12} />,
  ROLE: <Users size={12} />,
  HIERARCHIE_N1: <Network size={12} />,
  HIERARCHIE_N2: <Network size={12} />,
  DEMANDEUR: <User size={12} />,
  GROUPE: <Building2 size={12} />,
  DYNAMIQUE: <Settings size={12} />,
  UO_RESPONSABLE: <Building2 size={12} />,
  UO_PARENTE_RESPONSABLE: <Building2 size={12} />,
  UO_GRAND_PARENTE_RESPONSABLE: <Building2 size={12} />,
  UO_RACINE_RESPONSABLE: <Building2 size={12} />,
};

const DECISION_COLORS: Record<string, string> = {
  VALIDER: "#10B981", REJETER: "#EF4444", RENVOYER: "#F59E0B",
  DELEGUER: "#6366F1", VISER: "#3B82F6", DEMANDER_INFO: "#F59E0B",
  ACCUSER_RECEPTION: "#64748B",
};

const uid = () => Math.random().toString(36).slice(2);

const inp = "px-3 py-1.5 rounded-lg border text-sm outline-none w-full";
const inpStyle = { borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" };

// ─── Composant principal ───────────────────────────────────────────────────────

const WorkflowBuilderPage: React.FC = () => {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [templates, setTemplates] = useState<WfTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Panneau
  const [panel, setPanel] = useState<"list" | "edit" | "new">("list");
  const [current, setCurrent] = useState<Workflow | null>(null);
  const [etapes, setEtapes] = useState<WfEtape[]>([]);
  const [etapeOuverte, setEtapeOuverte] = useState<string | null>(null);
  const [sousOnglet, setSousOnglet] = useState<Record<string, string>>({});

  // Formulaire workflow
  const EMPTY_WF = { code: "", libelle: "", description: "", type_objet: "CONGE",
    version: 1, statut: "BROUILLON", criteres: {}, delai_global_heures: null,
    couleur: "#3B82F6", ordre: 0, actif: true };
  const [wfForm, setWfForm] = useState<any>(EMPTY_WF);

  // ── Chargement ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: wfs }, { data: tpls }] = await Promise.all([
      (supabase.from("ref_workflow" as never) as any).select("*").order("ordre").order("libelle"),
      (supabase.from("ref_workflow_template" as never) as any).select("id,code,libelle,type_canal").eq("actif", true).order("type_canal"),
    ]);
    setWorkflows(wfs || []);
    setTemplates(tpls || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Charger étapes d'un workflow ────────────────────────────────────────────
  const loadEtapes = async (wfId: string) => {
    const { data: etps } = await (supabase.from("ref_workflow_etape" as never) as any)
      .select("*").eq("id_workflow", wfId).order("ordre");
    if (!etps) return;
    const enriched = await Promise.all((etps as any[]).map(async (e: any) => {
      const [{ data: act }, { data: dec }, { data: act2 }] = await Promise.all([
        (supabase.from("ref_workflow_acteur" as never) as any).select("*").eq("id_etape", e.id).order("ordre_delegation"),
        (supabase.from("ref_workflow_decision" as never) as any).select("*").eq("id_etape", e.id).order("ordre"),
        (supabase.from("ref_workflow_action" as never) as any).select("*").eq("id_etape", e.id).order("declencheur").order("ordre"),
      ]);
      return {
        ...e, _id: e.id,
        acteurs:   (act  || []).map((a: any) => ({ ...a, _id: a.id })),
        decisions: (dec  || []).map((d: any) => ({ ...d, _id: d.id })),
        actions:   (act2 || []).map((a: any) => ({ ...a, _id: a.id })),
      } as WfEtape;
    }));
    setEtapes(enriched);
  };

  // ── Ouvrir édition ──────────────────────────────────────────────────────────
  const openEdit = async (wf: Workflow) => {
    setCurrent(wf);
    setWfForm({ ...wf });
    await loadEtapes(wf.id);
    setPanel("edit");
    setError(null);
  };

  const openNew = () => {
    setCurrent(null);
    setWfForm({ ...EMPTY_WF });
    setEtapes([]);
    setPanel("new");
    setError(null);
  };

  // ── Gestion des étapes ─────────────────────────────────────────────────────
  const addEtape = () => {
    const n = etapes.length;
    setEtapes(prev => [...prev, {
      _id: uid(), code: `ETAPE_${n+1}`, libelle: `Étape ${n+1}`,
      description: "", ordre: n+1, type_etape: "VALIDATION",
      mode_validation: "TOUS", delai_heures: 48, delai_relance_heures: 24,
      obligatoire_commentaire: false, pj_autorisees: false,
      condition_sql: null, couleur: "#3B82F6", auto_skip_si_deja_decide: false,
      acteurs: [], decisions: [
        { _id: uid(), code: "APPROUVER", libelle: "Approuver", type_decision: "VALIDER",
          obligatoire_commentaire: false, couleur: "#10B981", icone: "check", ordre: 1 },
        { _id: uid(), code: "REFUSER", libelle: "Refuser", type_decision: "REJETER",
          obligatoire_commentaire: true, couleur: "#EF4444", icone: "x", ordre: 2 },
      ],
      actions: [
        { _id: uid(), declencheur: "ENTREE", type_action: "NOTIFICATION_INTERNE",
          ordre: 1, configuration: { template_code: "", destinataires: ["ACTEUR"] },
          condition_exec: null },
      ],
    }]);
  };

  const removeEtape = (id: string) => setEtapes(prev => prev.filter(e => e._id !== id));
  const updateEtape = (id: string, patch: Partial<WfEtape>) =>
    setEtapes(prev => prev.map(e => e._id === id ? { ...e, ...patch } : e));

  // Acteurs
  const addActeur = (eid: string) => updateEtape(eid, {
    acteurs: [...(etapes.find(e => e._id === eid)?.acteurs || []),
      { _id: uid(), type_acteur: "HIERARCHIE_N1", valeur: null,
        ordre_delegation: 1, est_observateur: false,
        peut_deleguer: true, delai_relance_h: null,
        fallback_type: null, fallback_valeur: null }]
  });
  const updateActeur = (eid: string, aid: string, patch: Partial<WfActeur>) =>
    updateEtape(eid, { acteurs: etapes.find(e => e._id === eid)!.acteurs.map(a => a._id === aid ? { ...a, ...patch } : a) });
  const removeActeur = (eid: string, aid: string) =>
    updateEtape(eid, { acteurs: etapes.find(e => e._id === eid)!.acteurs.filter(a => a._id !== aid) });

  // Décisions
  const addDecision = (eid: string) => updateEtape(eid, {
    decisions: [...(etapes.find(e => e._id === eid)?.decisions || []),
      { _id: uid(), code: "NOUVELLE_DECISION", libelle: "Nouvelle décision",
        type_decision: "VALIDER", obligatoire_commentaire: false,
        couleur: "#10B981", icone: "check", ordre: 99 }]
  });
  const updateDecision = (eid: string, did: string, patch: Partial<WfDecision>) =>
    updateEtape(eid, { decisions: etapes.find(e => e._id === eid)!.decisions.map(d => d._id === did ? { ...d, ...patch } : d) });
  const removeDecision = (eid: string, did: string) =>
    updateEtape(eid, { decisions: etapes.find(e => e._id === eid)!.decisions.filter(d => d._id !== did) });

  // Actions
  const addAction = (eid: string) => updateEtape(eid, {
    actions: [...(etapes.find(e => e._id === eid)?.actions || []),
      { _id: uid(), declencheur: "ENTREE", type_action: "NOTIFICATION_INTERNE",
        ordre: 99, configuration: { template_code: "", destinataires: ["ACTEUR"] },
        condition_exec: null }]
  });
  const updateAction = (eid: string, aid: string, patch: Partial<WfAction>) =>
    updateEtape(eid, { actions: etapes.find(e => e._id === eid)!.actions.map(a => a._id === aid ? { ...a, ...patch } : a) });
  const removeAction = (eid: string, aid: string) =>
    updateEtape(eid, { actions: etapes.find(e => e._id === eid)!.actions.filter(a => a._id !== aid) });

  // ── Sauvegarde ──────────────────────────────────────────────────────────────
  const save = async () => {
    if (!wfForm.code || !wfForm.libelle) { setError("Code et libellé requis."); return; }
    setSaving(true); setError(null);
    try {
      let wfId = current?.id;
      if (panel === "new") {
        const { data, error: e } = await (supabase.from("ref_workflow" as never) as any).insert({ ...wfForm }).select("id").single();
        if (e) throw e;
        wfId = data.id;
      } else {
        const { error: e } = await (supabase.from("ref_workflow" as never) as any).update({ ...wfForm, updated_at: new Date().toISOString() }).eq("id", wfId);
        if (e) throw e;
        // Supprimer les étapes existantes et recréer
        await (supabase.from("ref_workflow_etape" as never) as any).delete().eq("id_workflow", wfId);
      }

      // Recréer toutes les étapes
      for (const etape of etapes) {
        const { data: etpData, error: etpErr } = await (supabase.from("ref_workflow_etape" as never) as any)
          .insert({
            id_workflow: wfId, code: etape.code, libelle: etape.libelle,
            description: etape.description, ordre: etape.ordre,
            type_etape: etape.type_etape, mode_validation: etape.mode_validation,
            delai_heures: etape.delai_heures, delai_relance_heures: etape.delai_relance_heures,
            obligatoire_commentaire: etape.obligatoire_commentaire,
            pj_autorisees: etape.pj_autorisees, condition_sql: etape.condition_sql,
            couleur: etape.couleur,
            auto_skip_si_deja_decide: etape.auto_skip_si_deja_decide,
          }).select("id").single();
        if (etpErr) throw etpErr;
        const etpId = etpData.id;

        // Acteurs
        if (etape.acteurs.length > 0) {
          await (supabase.from("ref_workflow_acteur" as never) as any).insert(
            etape.acteurs.map(a => ({
              id_etape: etpId, type_acteur: a.type_acteur, valeur: a.valeur,
              ordre_delegation: a.ordre_delegation, est_observateur: a.est_observateur,
              peut_deleguer: a.peut_deleguer, delai_relance_h: a.delai_relance_h,
              fallback_type: a.fallback_type, fallback_valeur: a.fallback_valeur,
            }))
          );
        }
        // Décisions
        if (etape.decisions.length > 0) {
          await (supabase.from("ref_workflow_decision" as never) as any).insert(
            etape.decisions.map(d => ({
              id_etape: etpId, code: d.code, libelle: d.libelle,
              type_decision: d.type_decision, obligatoire_commentaire: d.obligatoire_commentaire,
              couleur: d.couleur, icone: d.icone, ordre: d.ordre,
            }))
          );
        }
        // Actions
        if (etape.actions.length > 0) {
          await (supabase.from("ref_workflow_action" as never) as any).insert(
            etape.actions.map(a => ({
              id_etape: etpId, declencheur: a.declencheur, type_action: a.type_action,
              ordre: a.ordre, configuration: a.configuration, condition_exec: a.condition_exec,
            }))
          );
        }
      }

      await load();
      setPanel("list");
    } catch (err: any) {
      setError(err.message || "Erreur lors de la sauvegarde");
    } finally {
      setSaving(false);
    }
  };

  const archiver = async (wf: Workflow) => {
    if (!confirm(`Archiver le workflow "${wf.libelle}" ?`)) return;
    await (supabase.from("ref_workflow" as never) as any).update({ statut: "ARCHIVE" }).eq("id", wf.id);
    load();
  };

  // ── Render étape ────────────────────────────────────────────────────────────
  const renderEtape = (etape: WfEtape, idx: number) => {
    const open = etapeOuverte === etape._id;
    const sous = sousOnglet[etape._id] || "acteurs";

    return (
      <div key={etape._id} className="rounded-xl border overflow-hidden mb-3"
        style={{ borderColor: etape.couleur + "60" }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 cursor-pointer"
          style={{ background: etape.couleur + "10", borderBottom: open ? `0.5px solid ${etape.couleur}40` : "none" }}
          onClick={() => setEtapeOuverte(open ? null : etape._id)}>
          <GripVertical size={14} style={{ color: "hsl(var(--muted-foreground))" }} />
          <span className="text-xs font-mono px-2 py-0.5 rounded"
            style={{ background: etape.couleur + "20", color: etape.couleur }}>
            {idx + 1}
          </span>
          <div style={{ flex: 1 }}>
            <input className="bg-transparent font-medium text-sm outline-none w-full"
              style={{ color: "hsl(var(--foreground))" }}
              value={etape.libelle}
              onChange={e => { e.stopPropagation(); updateEtape(etape._id, { libelle: e.target.value }); }}
              onClick={e => e.stopPropagation()} />
          </div>
          <div className="flex items-center gap-2 ml-auto" onClick={e => e.stopPropagation()}>
            <span className="text-xs px-2 py-0.5 rounded"
              style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
              {etape.type_etape}
            </span>
            {etape.delai_heures && (
              <span className="flex items-center gap-1 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                <Clock size={10} />{etape.delai_heures}h
              </span>
            )}
            <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
              {etape.acteurs.length} acteur(s) · {etape.actions.length} action(s)
            </span>
            <button onClick={() => removeEtape(etape._id)} className="p-1 rounded hover:bg-muted">
              <Trash2 size={12} style={{ color: "hsl(0 84% 55%)" }} />
            </button>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </div>
        </div>

        {open && (
          <div className="p-4">
            {/* Config de base */}
            <div className="grid grid-cols-4 gap-3 mb-4">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Type</label>
                <select className={inp} style={inpStyle}
                  value={etape.type_etape}
                  onChange={e => updateEtape(etape._id, { type_etape: e.target.value })}>
                  {TYPES_ETAPE.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Mode validation</label>
                <select className={inp} style={inpStyle}
                  value={etape.mode_validation}
                  onChange={e => updateEtape(etape._id, { mode_validation: e.target.value })}>
                  {MODES_VALID.map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>SLA (heures)</label>
                <input className={inp} style={inpStyle} type="number" min={0}
                  value={etape.delai_heures ?? ""}
                  onChange={e => updateEtape(etape._id, { delai_heures: e.target.value ? Number(e.target.value) : null })} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Relance (heures)</label>
                <input className={inp} style={inpStyle} type="number" min={0}
                  value={etape.delai_relance_heures ?? ""}
                  onChange={e => updateEtape(etape._id, { delai_relance_heures: e.target.value ? Number(e.target.value) : null })} />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Condition d'exécution (SQL optionnel)</label>
                <input className={inp} style={inpStyle} placeholder="ex: nb_jours > 10"
                  value={etape.condition_sql ?? ""}
                  onChange={e => updateEtape(etape._id, { condition_sql: e.target.value || null })} />
              </div>
              <div className="flex items-end gap-4 col-span-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={etape.obligatoire_commentaire}
                    onChange={e => updateEtape(etape._id, { obligatoire_commentaire: e.target.checked })} />
                  <span className="text-xs">Commentaire obligatoire</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={etape.pj_autorisees}
                    onChange={e => updateEtape(etape._id, { pj_autorisees: e.target.checked })} />
                  <span className="text-xs">Pièces jointes</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer" title="Si l'acteur résolu pour cette étape a déjà décidé sur une étape précédente, sa décision est appliquée automatiquement">
                  <input type="checkbox" checked={etape.auto_skip_si_deja_decide}
                    onChange={e => updateEtape(etape._id, { auto_skip_si_deja_decide: e.target.checked })} />
                  <span className="text-xs">Auto-skip si déjà décidé</span>
                </label>
              </div>
            </div>

            {/* Sous-onglets */}
            <div className="flex gap-4 border-b mb-3" style={{ borderColor: "hsl(var(--border))" }}>
              {[["acteurs","Acteurs"],["decisions","Décisions"],["actions","Actions auto"]].map(([k,l]) => (
                <button key={k}
                  onClick={() => setSousOnglet(prev => ({ ...prev, [etape._id]: k }))}
                  className="text-xs pb-2 font-medium transition-colors"
                  style={{
                    color: sous === k ? "hsl(var(--accent))" : "hsl(var(--muted-foreground))",
                    borderBottom: sous === k ? "2px solid hsl(var(--accent))" : "2px solid transparent",
                  }}>
                  {l} ({sous === "acteurs" ? etape.acteurs.length : sous === "decisions" ? etape.decisions.length : etape.actions.length})
                </button>
              ))}
            </div>

            {/* Acteurs */}
            {sous === "acteurs" && (
              <div>
                {etape.acteurs.map(acteur => (
                  <div key={acteur._id} className="flex items-center gap-2 mb-2 p-2 rounded-lg"
                    style={{ background: "hsl(var(--muted)/0.3)", border: "0.5px solid hsl(var(--border))" }}>
                    <span style={{ color: "hsl(var(--muted-foreground))" }}>{ACTEUR_ICONS[acteur.type_acteur]}</span>
                    <select className={inp} style={{ ...inpStyle, width: 180 }}
                      value={acteur.type_acteur}
                      onChange={e => updateActeur(etape._id, acteur._id, { type_acteur: e.target.value })}>
                      {TYPES_ACTEUR.map(t => <option key={t}>{t}</option>)}
                    </select>
                    {["UTILISATEUR_FIXE","ROLE","GROUPE","DYNAMIQUE"].includes(acteur.type_acteur) && (
                      <input className={inp} style={{ ...inpStyle, width: 160 }}
                        placeholder={acteur.type_acteur === "ROLE" ? "code_role" : acteur.type_acteur === "DYNAMIQUE" ? "expression SQL" : "UUID ou code"}
                        value={acteur.valeur || ""}
                        onChange={e => updateActeur(etape._id, acteur._id, { valeur: e.target.value || null })} />
                    )}
                    <label className="flex items-center gap-1 text-xs cursor-pointer whitespace-nowrap">
                      <input type="checkbox" checked={acteur.est_observateur}
                        onChange={e => updateActeur(etape._id, acteur._id, { est_observateur: e.target.checked })} />
                      Observateur
                    </label>
                    <button onClick={() => removeActeur(etape._id, acteur._id)} className="p-1 rounded hover:bg-muted ml-auto">
                      <X size={11} style={{ color: "hsl(0 84% 55%)" }} />
                    </button>
                  </div>
                ))}
                <button onClick={() => addActeur(etape._id)}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border mt-1"
                  style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
                  <Plus size={11} /> Ajouter un acteur
                </button>
              </div>
            )}

            {/* Décisions */}
            {sous === "decisions" && (
              <div>
                {etape.decisions.map(dec => (
                  <div key={dec._id} className="flex items-center gap-2 mb-2 p-2 rounded-lg"
                    style={{ background: dec.couleur + "08", border: `0.5px solid ${dec.couleur}40` }}>
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: dec.couleur }} />
                    <input className={inp} style={{ ...inpStyle, width: 140 }}
                      value={dec.libelle}
                      onChange={e => updateDecision(etape._id, dec._id, { libelle: e.target.value })} />
                    <select className={inp} style={{ ...inpStyle, width: 160 }}
                      value={dec.type_decision}
                      onChange={e => updateDecision(etape._id, dec._id, {
                        type_decision: e.target.value,
                        couleur: DECISION_COLORS[e.target.value] || "#64748B"
                      })}>
                      {TYPES_DECISION.map(t => <option key={t}>{t}</option>)}
                    </select>
                    <label className="flex items-center gap-1 text-xs cursor-pointer whitespace-nowrap">
                      <input type="checkbox" checked={dec.obligatoire_commentaire}
                        onChange={e => updateDecision(etape._id, dec._id, { obligatoire_commentaire: e.target.checked })} />
                      Commentaire requis
                    </label>
                    <button onClick={() => removeDecision(etape._id, dec._id)} className="p-1 rounded hover:bg-muted ml-auto">
                      <X size={11} style={{ color: "hsl(0 84% 55%)" }} />
                    </button>
                  </div>
                ))}
                <button onClick={() => addDecision(etape._id)}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border mt-1"
                  style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
                  <Plus size={11} /> Ajouter une décision
                </button>
              </div>
            )}

            {/* Actions */}
            {sous === "actions" && (
              <div>
                {etape.actions.map(action => (
                  <div key={action._id} className="mb-2 p-3 rounded-lg border"
                    style={{ borderColor: "hsl(var(--border))" }}>
                    <div className="flex items-center gap-2 mb-2">
                      <span style={{ color: "hsl(var(--accent))" }}>{ACTION_ICONS[action.type_action]}</span>
                      <select className={inp} style={{ ...inpStyle, width: 160 }}
                        value={action.declencheur}
                        onChange={e => updateAction(etape._id, action._id, { declencheur: e.target.value })}>
                        {DECLENCHEURS.map(d => <option key={d}>{d}</option>)}
                      </select>
                      <ArrowRight size={12} style={{ color: "hsl(var(--muted-foreground))" }} />
                      <select className={inp} style={{ ...inpStyle, width: 200 }}
                        value={action.type_action}
                        onChange={e => updateAction(etape._id, action._id, { type_action: e.target.value })}>
                        {TYPES_ACTION.map(t => <option key={t}>{t}</option>)}
                      </select>
                      <button onClick={() => removeAction(etape._id, action._id)} className="p-1 rounded hover:bg-muted ml-auto">
                        <X size={11} style={{ color: "hsl(0 84% 55%)" }} />
                      </button>
                    </div>
                    {/* Configuration selon type */}
                    {["NOTIFICATION_INTERNE","EMAIL","SMS","WHATSAPP"].includes(action.type_action) && (
                      <div className="flex gap-2">
                        <select className={inp} style={{ ...inpStyle, flex: 1 }}
                          value={action.configuration.template_code || ""}
                          onChange={e => updateAction(etape._id, action._id, {
                            configuration: { ...action.configuration, template_code: e.target.value }
                          })}>
                          <option value="">— Template —</option>
                          {templates
                            .filter(t => {
                              if (action.type_action === "NOTIFICATION_INTERNE") return t.type_canal === "NOTIFICATION";
                              return t.type_canal === action.type_action;
                            })
                            .map(t => <option key={t.code} value={t.code}>{t.libelle}</option>)}
                        </select>
                        <input className={inp} style={{ ...inpStyle, width: 200 }}
                          placeholder="Destinataires : ACTEUR, DEMANDEUR, email@..."
                          value={(action.configuration.destinataires || []).join(",")}
                          onChange={e => updateAction(etape._id, action._id, {
                            configuration: { ...action.configuration, destinataires: e.target.value.split(",").map(s => s.trim()) }
                          })} />
                      </div>
                    )}
                    {action.type_action === "WEBHOOK" && (
                      <div className="flex gap-2">
                        <select className={inp} style={{ ...inpStyle, width: 80 }}
                          value={action.configuration.methode || "POST"}
                          onChange={e => updateAction(etape._id, action._id, {
                            configuration: { ...action.configuration, methode: e.target.value }
                          })}>
                          {["POST","PUT","PATCH","GET"].map(m => <option key={m}>{m}</option>)}
                        </select>
                        <input className={inp} style={{ ...inpStyle, flex: 1 }}
                          placeholder="https://api.exemple.com/webhook"
                          value={action.configuration.url || ""}
                          onChange={e => updateAction(etape._id, action._id, {
                            configuration: { ...action.configuration, url: e.target.value }
                          })} />
                      </div>
                    )}
                    {action.type_action === "TACHE_SYSTEME" && (
                      <input className={inp} style={inpStyle}
                        placeholder="code_tache (ex: METTRE_A_JOUR_STATUT_DEMANDE)"
                        value={action.configuration.code_tache || ""}
                        onChange={e => updateAction(etape._id, action._id, {
                          configuration: { ...action.configuration, code_tache: e.target.value }
                        })} />
                    )}
                  </div>
                ))}
                <button onClick={() => addAction(etape._id)}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border mt-1"
                  style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
                  <Plus size={11} /> Ajouter une action
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Render formulaire ────────────────────────────────────────────────────────
  const renderForm = () => (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-medium" style={{ color: "hsl(var(--foreground))" }}>
            {panel === "new" ? "Nouveau workflow" : `Modifier : ${wfForm.libelle}`}
          </h2>
          {panel === "edit" && current && (
            <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
              v{current.version} · {current.statut}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setPanel("list")}
            className="px-3 py-1.5 rounded-lg text-sm border"
            style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
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
        <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
          style={{ background: "hsl(0 84% 55% / 0.1)", color: "hsl(0 84% 45%)" }}>
          <AlertTriangle size={13} /> {error}
        </div>
      )}

      {/* Infos générales */}
      <div className="rounded-xl border p-4 mb-4" style={{ borderColor: "hsl(var(--border))" }}>
        <p className="text-xs font-semibold mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>INFORMATIONS GÉNÉRALES</p>
        <div className="grid grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Code *</label>
            <input className={inp} style={inpStyle} value={wfForm.code} disabled={panel === "edit"}
              onChange={e => setWfForm((f: any) => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="WF_CONGE_PAYE" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Libellé *</label>
            <input className={inp} style={inpStyle} value={wfForm.libelle}
              onChange={e => setWfForm((f: any) => ({ ...f, libelle: e.target.value }))} placeholder="Validation congé payé annuel" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Type d'objet</label>
            <select className={inp} style={inpStyle} value={wfForm.type_objet}
              onChange={e => setWfForm((f: any) => ({ ...f, type_objet: e.target.value }))}>
              {TYPES_OBJET.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Description</label>
            <input className={inp} style={inpStyle} value={wfForm.description || ""}
              onChange={e => setWfForm((f: any) => ({ ...f, description: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>SLA global (heures)</label>
            <input className={inp} style={inpStyle} type="number" min={0}
              value={wfForm.delai_global_heures ?? ""}
              onChange={e => setWfForm((f: any) => ({ ...f, delai_global_heures: e.target.value ? Number(e.target.value) : null }))} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Statut</label>
            <select className={inp} style={inpStyle} value={wfForm.statut}
              onChange={e => setWfForm((f: any) => ({ ...f, statut: e.target.value }))}>
              {["BROUILLON","ACTIF","ARCHIVE"].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Étapes */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "hsl(var(--muted-foreground))" }}>
          Étapes du circuit ({etapes.length})
        </p>
        <button onClick={addEtape}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
          style={{ background: "hsl(var(--accent))", color: "white" }}>
          <Plus size={12} /> Ajouter une étape
        </button>
      </div>

      {etapes.length === 0 ? (
        <div className="py-12 text-center rounded-xl border border-dashed"
          style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
          <PlayCircle size={32} strokeWidth={1} className="mx-auto mb-2" />
          <p className="text-sm">Aucune étape — cliquez "+ Ajouter une étape" pour commencer</p>
        </div>
      ) : (
        <div>
          {etapes.map((e, i) => renderEtape(e, i))}
        </div>
      )}
    </div>
  );

  // ── Render liste ─────────────────────────────────────────────────────────────
  const renderList = () => (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-medium" style={{ color: "hsl(var(--foreground))" }}>Workflows paramétrables</h1>
          <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
            Circuits de validation pour congés, départs, recrutements et plus • {workflows.length} workflow(s)
          </p>
        </div>
        <button onClick={openNew}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
          style={{ background: "hsl(var(--accent))", color: "white" }}>
          <Plus size={13} /> Nouveau workflow
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin" style={{ color: "hsl(var(--accent))" }} />
        </div>
      ) : workflows.length === 0 ? (
        <div className="text-center py-16" style={{ color: "hsl(var(--muted-foreground))" }}>
          <PlayCircle size={40} strokeWidth={1} className="mx-auto mb-3" />
          <p className="text-sm">Aucun workflow — cliquez "+ Nouveau workflow"</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {workflows.map(wf => (
            <div key={wf.id} className="rounded-xl border overflow-hidden"
              style={{ borderColor: "hsl(var(--border))" }}>
              <div className="flex items-center gap-3 px-4 py-3"
                style={{ background: "hsl(var(--card))" }}>
                <div className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ background: wf.couleur || "#64748B" }} />
                <span className="font-mono text-xs px-1.5 py-0.5 rounded"
                  style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                  {wf.code}
                </span>
                <div style={{ flex: 1 }}>
                  <span className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>{wf.libelle}</span>
                  <span className="ml-2 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>v{wf.version}</span>
                </div>
                <span className="text-xs px-2 py-0.5 rounded"
                  style={{ background: "hsl(var(--muted)/0.5)", color: "hsl(var(--muted-foreground))" }}>
                  {wf.type_objet}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium`}
                  style={{
                    background: wf.statut === "ACTIF" ? "#D1FAE5" : wf.statut === "BROUILLON" ? "#FEF3C7" : "#F1F5F9",
                    color: wf.statut === "ACTIF" ? "#065F46" : wf.statut === "BROUILLON" ? "#92400E" : "#475569",
                  }}>
                  {wf.statut}
                </span>
                <button onClick={() => openEdit(wf)} className="p-1.5 rounded hover:bg-muted">
                  <Pencil size={12} style={{ color: "hsl(var(--muted-foreground))" }} />
                </button>
                {wf.statut !== "ARCHIVE" && (
                  <button onClick={() => archiver(wf)} className="p-1.5 rounded hover:bg-muted">
                    <Archive size={12} style={{ color: "hsl(var(--muted-foreground))" }} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="p-6">
      {panel === "list" ? renderList() : renderForm()}
    </div>
  );
};

export default WorkflowBuilderPage;
