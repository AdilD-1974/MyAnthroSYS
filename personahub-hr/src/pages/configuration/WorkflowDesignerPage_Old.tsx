import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  GitBranch, Plus, Save, Loader2, Trash2, ChevronRight, ChevronDown, ArrowRight, Copy, Power,
  Users, GitFork, Zap, UserCheck, Bell, PenLine, Split, CornerDownRight,
} from "lucide-react";
import {
  useWorkflows, loadWorkflowFull, saveWorkflowFull,
  EditWorkflow, EditEtape, EditActeur, EditDecision, EditAction,
  STATUTS, TYPES_ETAPE, MODES_VALIDATION, TYPES_ACTEUR, TYPES_DECISION, DECLENCHEURS, TYPES_ACTION, TYPES_OBJET,
} from "@/hooks/useWorkflow";

// ── Identité visuelle par type d'étape ─────────────────────────────────────
const ETAPE_META: Record<string, { label: string; color: string; Icon: any }> = {
  VALIDATION:  { label: "Validation",  color: "#3B6FE4", Icon: UserCheck },
  INFORMATION: { label: "Information", color: "#0EA5E9", Icon: Bell },
  SIGNATURE:   { label: "Signature",   color: "#8B5CF6", Icon: PenLine },
  PARALLELE:   { label: "Parallèle",   color: "#14B8A6", Icon: Split },
  AUTOMATIQUE: { label: "Automatique", color: "#64748B", Icon: Zap },
  CONDITION:   { label: "Condition",   color: "#E07B39", Icon: GitFork },
};
const metaOf = (t: string) => ETAPE_META[t] || { label: t, color: "#64748B", Icon: GitBranch };

const ACTEUR_LABEL: Record<string, string> = {
  DEMANDEUR: "Demandeur", HIERARCHIE_N1: "Hiérarchie N+1", HIERARCHIE_N2: "Hiérarchie N+2",
  UO_RESPONSABLE: "Responsable d'UO", UO_PARENTE_RESPONSABLE: "Responsable UO parente",
  UO_GRAND_PARENTE_RESPONSABLE: "Responsable UO grand-parente", UO_RACINE_RESPONSABLE: "Responsable UO racine",
  ROLE: "Rôle", GROUPE: "Groupe", UTILISATEUR_FIXE: "Utilisateur fixe", DYNAMIQUE: "Dynamique (expression)",
};
const ACTEUR_AVEC_VALEUR = ["ROLE", "GROUPE", "UTILISATEUR_FIXE", "DYNAMIQUE"];
const DECISION_META: Record<string, { label: string; color: string }> = {
  VALIDER: { label: "Valider", color: "#16A34A" }, REJETER: { label: "Rejeter", color: "#DC2626" },
  RENVOYER: { label: "Renvoyer", color: "#E07B39" }, DELEGUER: { label: "Déléguer", color: "#3B6FE4" },
  VISER: { label: "Viser", color: "#6366F1" }, DEMANDER_INFO: { label: "Demander info", color: "#64748B" },
  ACCUSER_RECEPTION: { label: "Accuser réception", color: "#14B8A6" },
};
const decMeta = (t: string) => DECISION_META[t] || { label: t, color: "#64748B" };
const MODE_LABEL: Record<string, string> = { TOUS: "Tous", UN_SUFFISANT: "Un suffisant", MAJORITE: "Majorité" };
const DECL_LABEL: Record<string, string> = {
  ENTREE: "À l'entrée", VALIDATION: "Sur validation", REJET: "Sur rejet", TIMEOUT: "Sur timeout",
  RELANCE: "Sur relance", COMMENTAIRE: "Sur commentaire", DELEGATION: "Sur délégation", FINALISATION: "À la finalisation",
};
const ACTION_LABEL: Record<string, string> = {
  NOTIFICATION_INTERNE: "Notification interne", EMAIL: "Email", SMS: "SMS", WHATSAPP: "WhatsApp",
  GENERER_DOCUMENT: "Générer document", TACHE_SYSTEME: "Tâche système", WEBHOOK: "Webhook", PUSH_MOBILE: "Push mobile",
};
const STATUT_COLOR: Record<string, string> = { BROUILLON: "#94A3B8", ACTIF: "#16A34A", ARCHIVE: "#64748B" };

const optEtape = TYPES_ETAPE.map((t) => ({ v: t, l: metaOf(t).label }));
const optActeur = TYPES_ACTEUR.map((t) => ({ v: t, l: ACTEUR_LABEL[t] || t }));
const optDecision = TYPES_DECISION.map((t) => ({ v: t, l: decMeta(t).label }));
const optMode = MODES_VALIDATION.map((t) => ({ v: t, l: MODE_LABEL[t] || t }));
const optDecl = DECLENCHEURS.map((t) => ({ v: t, l: DECL_LABEL[t] || t }));
const optAction = TYPES_ACTION.map((t) => ({ v: t, l: ACTION_LABEL[t] || t }));

const blankEtape = (n: number): EditEtape => ({
  code: `etape_${n}`, libelle: "Nouvelle étape", description: "", ordre: n, type_etape: "VALIDATION",
  mode_validation: "TOUS", delai_heures: null, delai_relance_heures: null, condition_sql: "",
  si_vrai_code: "", si_faux_code: "", obligatoire_commentaire: false, pj_autorisees: false,
  retour_possible: true, auto_skip_si_deja_decide: false, couleur: "", actif: true,
  acteurs: [], decisions: [], actions: [],
});
const blankWf = (): EditWorkflow => ({
  code: "", libelle: "", description: "", type_objet: "generique", version: 1, statut: "BROUILLON",
  criteres: {}, delai_global_heures: null, actif: true, couleur: "", icone: "", ordre: 0,
  etapes: [blankEtape(1)], _initialEtapeIds: [],
});

export default function WorkflowDesignerPage() {
  const qc = useQueryClient();
  const { workflows, loading, refetch } = useWorkflows();
  const [wf, setWf] = useState<EditWorkflow | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [loadingDef, setLoadingDef] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openStep, setOpenStep] = useState<number | null>(0);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  const select = async (id: string) => {
    setLoadingDef(true);
    try { setWf(await loadWorkflowFull(id)); setIsNew(false); setOpenStep(0); }
    catch { toast({ title: "Chargement impossible", variant: "destructive" }); }
    finally { setLoadingDef(false); }
  };
  const nouveau = () => { setWf(blankWf()); setIsNew(true); setOpenStep(0); };

  const patchWf = (p: Partial<EditWorkflow>) => setWf((w) => w ? { ...w, ...p } : w);
  const setEtapes = (etapes: EditEtape[]) => setWf((w) => w ? { ...w, etapes } : w);
  const setEtape = (i: number, p: Partial<EditEtape>) => wf && setEtapes(wf.etapes.map((e, k) => k === i ? { ...e, ...p } : e));
  const addEtape = () => { if (!wf) return; const e = [...wf.etapes, blankEtape(wf.etapes.length + 1)]; setEtapes(e); setOpenStep(e.length - 1); };
  const delEtape = (i: number) => wf && setEtapes(wf.etapes.filter((_, k) => k !== i));
  const dupEtape = (i: number) => {
    if (!wf) return;
    const src = wf.etapes[i];
    const codesExistants = new Set(wf.etapes.map((e) => e.code));
    let nouveauCode = `${src.code}_copie`;
    let n = 2;
    while (codesExistants.has(nouveauCode)) { nouveauCode = `${src.code}_copie${n}`; n++; }
    const copie: EditEtape = {
      ...src,
      id: undefined,                       // nouvelle étape (pas de patch sur l'originale)
      code: nouveauCode,
      libelle: `${src.libelle} (copie)`,
      ordre: src.ordre + 1,                // sera renormalisé à l'enregistrement
      // enfants dupliqués sans leur id (réinsérés à l'enregistrement)
      acteurs: src.acteurs.map((a) => ({ ...a, id: undefined })),
      decisions: src.decisions.map((d) => ({ ...d, id: undefined })),
      actions: src.actions.map((ac) => ({ ...ac, id: undefined })),
    };
    const next = [...wf.etapes.slice(0, i + 1), copie, ...wf.etapes.slice(i + 1)];
    setEtapes(next);
    setOpenStep(i + 1);
  };

  const codes = wf?.etapes.map((e) => e.code).filter(Boolean) || [];
  const codeOpts = [{ v: "", l: "—" }, ...codes.map((c) => ({ v: c, l: c }))];
  const libByCode: Record<string, string> = {};
  wf?.etapes.forEach((e) => { libByCode[e.code] = e.libelle; });

  const save = async () => {
    if (!wf) return;
    if (!wf.code.trim() || !wf.libelle.trim()) { toast({ title: "Code et libellé obligatoires", variant: "destructive" }); return; }
    const dup = wf.etapes.map((e) => e.code).filter((c, i, a) => a.indexOf(c) !== i);
    if (dup.length) { toast({ title: "Codes d'étape en double", description: dup.join(", "), variant: "destructive" }); return; }
    setSaving(true);
    try {
      const { id, etapesDesactivees } = await saveWorkflowFull(wf);
      if (etapesDesactivees.length) {
        toast({
          title: "Workflow enregistré",
          description: `Étape(s) utilisée(s) par des demandes désactivée(s) plutôt que supprimée(s), pour préserver l'historique : ${etapesDesactivees.join(", ")}.`,
        });
      } else {
        toast({ title: "Workflow enregistré" });
      }
      qc.invalidateQueries({ queryKey: ["ref-workflows"] });
      await refetch();
      await select(id);
    } catch { toast({ title: "Échec de l'enregistrement", description: "Vérifiez l'API (POST/PATCH/DELETE sur ref_workflow*).", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const publier = async () => {
    if (!wf || isNew) return;
    setSaving(true);
    try {
      const versions = workflows.filter((w) => w.code === wf.code).map((w) => w.version);
      const next = Math.max(...versions, wf.version) + 1;
      await saveWorkflowFull({ ...wf, id: undefined, version: next, statut: "ACTIF", actif: true, _initialEtapeIds: [],
        etapes: wf.etapes.map((e) => ({ ...e, id: undefined, acteurs: e.acteurs.map(a => ({ ...a, id: undefined })), decisions: e.decisions.map(d => ({ ...d, id: undefined })), actions: e.actions.map(ac => ({ ...ac, id: undefined })) })) });
      if (wf.id) { const { api } = await import("@/lib/api"); await api.patch(`/db/ref_workflow?id=eq.${wf.id}`, { actif: false, statut: "ARCHIVE" }); }
      toast({ title: `Version ${next} publiée`, description: "Version précédente archivée." });
      qc.invalidateQueries({ queryKey: ["ref-workflows"] }); await refetch();
    } catch { toast({ title: "Échec de la publication", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const archiverWorkflow = async () => {
    if (!wf?.id) return;
    setDeleting(true);
    try {
      const { api } = await import("@/lib/api");
      await api.patch(`/workflow/${wf.id}/archiver`, {});
      toast({ title: "Workflow archivé", description: "Il ne démarre plus de nouvelles demandes ; l'historique est conservé." });
      setShowDelete(false); setDeleteConfirm("");
      qc.invalidateQueries({ queryKey: ["ref-workflows"] }); await refetch();
      setWf(null);
    } catch { toast({ title: "Échec de l'archivage", variant: "destructive" }); }
    finally { setDeleting(false); }
  };

  // Archiver depuis la barre (sans passer par la modale de suppression)
  const archiverDepuisBarre = async () => {
    if (!wf?.id) return;
    if (!window.confirm(`Archiver le workflow « ${wf.libelle} » ? Il ne démarrera plus de nouvelles demandes.`)) return;
    await archiverWorkflow();
  };

  // Réactiver un workflow archivé : statut ACTIF + actif true
  const reactiverWorkflow = async () => {
    if (!wf?.id) return;
    setSaving(true);
    try {
      const { api } = await import("@/lib/api");
      await api.patch(`/db/ref_workflow?id=eq.${wf.id}`, { statut: "ACTIF", actif: true });
      patchWf({ statut: "ACTIF", actif: true });
      toast({ title: "Workflow réactivé" });
      qc.invalidateQueries({ queryKey: ["ref-workflows"] }); await refetch();
    } catch { toast({ title: "Échec de la réactivation", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  // Dupliquer le workflow : copie indépendante, nouveau code, en BROUILLON
  const dupliquerWorkflow = () => {
    if (!wf) return;
    const codesExistants = new Set(workflows.map((w) => w.code));
    let nouveauCode = `${wf.code}_copie`;
    let n = 2;
    while (codesExistants.has(nouveauCode)) { nouveauCode = `${wf.code}_copie${n}`; n++; }
    setWf({
      ...wf,
      id: undefined,
      code: nouveauCode,
      libelle: `${wf.libelle} (copie)`,
      version: 1,
      statut: "BROUILLON",
      actif: true,
      _initialEtapeIds: [],
      etapes: wf.etapes.map((e) => ({
        ...e, id: undefined,
        acteurs: e.acteurs.map((a) => ({ ...a, id: undefined })),
        decisions: e.decisions.map((d) => ({ ...d, id: undefined })),
        actions: e.actions.map((ac) => ({ ...ac, id: undefined })),
      })),
    });
    setIsNew(true); setOpenStep(0);
    toast({ title: "Workflow dupliqué", description: `Copie « ${nouveauCode} » en brouillon. Ajustez puis enregistrez.` });
  };

  const supprimerWorkflow = async () => {
    if (!wf?.id) return;
    setDeleting(true);
    try {
      const { api } = await import("@/lib/api");
      await api.delete(`/workflow/${wf.id}`);
      toast({ title: "Workflow supprimé" });
      setShowDelete(false); setDeleteConfirm("");
      qc.invalidateQueries({ queryKey: ["ref-workflows"] }); await refetch();
      setWf(null);
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      if (status === 409) {
        // Utilisé par des demandes → on propose l'archivage (la modale reste ouverte)
        toast({
          title: "Suppression impossible",
          description: "Ce workflow est utilisé par des demandes. Vous pouvez l'archiver pour préserver l'historique.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Échec de la suppression", variant: "destructive" });
      }
    }
    finally { setDeleting(false); }
  };

  return (
    <div className="p-5">
      <div className="flex items-center gap-2 mb-4">
        <GitBranch size={20} />
        <h1 className="text-xl font-bold" style={{ color: "hsl(var(--foreground))" }}>Concepteur de workflows</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
        {/* Liste */}
        <div className="rounded-2xl border p-3 h-fit" style={{ borderColor: "hsl(var(--border))" }}>
          <Button onClick={nouveau} className="w-full gap-1.5 mb-3"><Plus size={15} /> Nouveau workflow</Button>
          {loading ? <div className="flex justify-center py-8"><Loader2 className="animate-spin" size={18} /></div> : (
            <div className="space-y-1">
              {workflows.map((d) => (
                <button key={d.id} onClick={() => select(d.id)} className="w-full text-left px-3 py-2 rounded-xl text-sm transition-colors"
                  style={{ background: wf?.id === d.id ? "hsl(var(--primary) / 0.1)" : "transparent", borderLeft: `3px solid ${wf?.id === d.id ? "hsl(var(--primary))" : "transparent"}`, color: "hsl(var(--foreground))" }}>
                  <div className="font-medium flex items-center gap-1.5">{d.libelle}
                    <ColorBadge color={STATUT_COLOR[d.statut] || "#64748B"}>{d.statut}</ColorBadge>{!d.actif && <Badge>inactif</Badge>}
                  </div>
                  <div className="text-[11px] font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>{d.code} · v{d.version} · {d.type_objet}</div>
                </button>
              ))}
              {workflows.length === 0 && <p className="text-[12px] px-2 py-4" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun workflow.</p>}
            </div>
          )}
        </div>

        {/* Éditeur */}
        {loadingDef ? (
          <div className="rounded-2xl border p-10 flex justify-center" style={{ borderColor: "hsl(var(--border))" }}><Loader2 className="animate-spin" size={20} /></div>
        ) : !wf ? (
          <div className="rounded-2xl border p-10 text-center" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>Sélectionnez ou créez un workflow.</div>
        ) : (
          <div className="space-y-4">
            {/* Métadonnées */}
            <div className="rounded-2xl border p-4 space-y-3" style={{ borderColor: "hsl(var(--border))" }}>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Field label="Code *"><Input value={wf.code} disabled={!isNew} onChange={(e) => patchWf({ code: e.target.value })} placeholder="conges_standard" /></Field>
                <Field label="Libellé *"><Input value={wf.libelle} onChange={(e) => patchWf({ libelle: e.target.value })} /></Field>
                <Field label="Objet métier"><Select value={wf.type_objet} onChange={(v) => patchWf({ type_objet: v })} options={TYPES_OBJET.map(o => ({ v: o, l: o }))} /></Field>
                <Field label="Statut"><Select value={wf.statut} onChange={(v) => patchWf({ statut: v })} options={STATUTS.map(o => ({ v: o, l: o }))} /></Field>
                <Field label="Délai global (h)"><Input type="number" value={wf.delai_global_heures ?? ""} onChange={(e) => patchWf({ delai_global_heures: e.target.value ? parseInt(e.target.value) : null })} /></Field>
                <Field label="Version"><Input value={String(wf.version)} disabled /></Field>
              </div>
              <Field label="Description"><Input value={wf.description} onChange={(e) => patchWf({ description: e.target.value })} /></Field>
            </div>

            {/* Étapes */}
            <div className="rounded-2xl border p-4" style={{ borderColor: "hsl(var(--border))" }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm" style={{ color: "hsl(var(--foreground))" }}>Étapes ({wf.etapes.length})</h3>
                <Button size="sm" variant="outline" onClick={addEtape} className="gap-1"><Plus size={14} /> Étape</Button>
              </div>
              <div className="space-y-2.5">
                {wf.etapes.map((e, i) => {
                  const m = metaOf(e.type_etape); const open = openStep === i;
                  return (
                    <div key={i} className="rounded-xl border overflow-hidden" style={{ borderColor: open ? m.color + "66" : "hsl(var(--border))" }}>
                      {/* En-tête pavé */}
                      <div className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer" onClick={() => setOpenStep(open ? null : i)}
                        style={{ borderLeft: `4px solid ${m.color}`, background: open ? m.color + "0F" : "transparent" }}>
                        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: m.color + "22", color: m.color }}><m.Icon size={15} /></span>
                        <span className="font-semibold text-sm" style={{ color: "hsl(var(--foreground))" }}>{e.libelle}</span>
                        <ColorBadge color={m.color}>{m.label}</ColorBadge>
                        {!e.actif && <Badge>inactif</Badge>}
                        <span className="text-[10px] font-mono ml-auto px-1.5 py-0.5 rounded" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>{e.code}</span>
                        <button onClick={(ev) => { ev.stopPropagation(); dupEtape(i); }} title="Dupliquer l'étape" className="p-1 rounded hover:bg-muted" style={{ color: "hsl(var(--muted-foreground))" }}><Copy size={13} /></button>
                        <button onClick={(ev) => { ev.stopPropagation(); delEtape(i); }} title="Supprimer l'étape" className="p-1 rounded hover:bg-destructive/10" style={{ color: "hsl(var(--destructive))" }}><Trash2 size={13} /></button>
                      </div>

                      {open && (
                        <div className="px-4 pb-4 pt-3 space-y-3" style={{ background: m.color + "07" }}>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <Field label="Code"><Input value={e.code} onChange={(ev) => setEtape(i, { code: ev.target.value })} /></Field>
                            <Field label="Libellé"><Input value={e.libelle} onChange={(ev) => setEtape(i, { libelle: ev.target.value })} /></Field>
                            <Field label="Type"><Select value={e.type_etape} onChange={(v) => setEtape(i, { type_etape: v })} options={optEtape} accent={m.color} /></Field>
                            <Field label="Ordre"><Input type="number" value={e.ordre} onChange={(ev) => setEtape(i, { ordre: parseInt(ev.target.value) || 0 })} /></Field>
                          </div>

                          {e.type_etape === "VALIDATION" && (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              <Field label="Mode validation"><Select value={e.mode_validation} onChange={(v) => setEtape(i, { mode_validation: v })} options={optMode} /></Field>
                              <Field label="Délai (h)"><Input type="number" value={e.delai_heures ?? ""} onChange={(ev) => setEtape(i, { delai_heures: ev.target.value ? parseInt(ev.target.value) : null })} /></Field>
                              <Field label="Relance (h)"><Input type="number" value={e.delai_relance_heures ?? ""} onChange={(ev) => setEtape(i, { delai_relance_heures: ev.target.value ? parseInt(ev.target.value) : null })} /></Field>
                            </div>
                          )}

                          {e.type_etape === "CONDITION" && (
                            <div className="space-y-3 rounded-lg p-3" style={{ background: ETAPE_META.CONDITION.color + "12", border: `1px solid ${ETAPE_META.CONDITION.color}33` }}>
                              <Field label="Condition SQL"><Input value={e.condition_sql} onChange={(ev) => setEtape(i, { condition_sql: ev.target.value })} placeholder="nb_jours > 5" /></Field>
                              <div className="grid grid-cols-2 gap-3">
                                <Field label="Si VRAI → étape"><Select value={e.si_vrai_code} onChange={(v) => setEtape(i, { si_vrai_code: v })} options={codeOpts} accent="#16A34A" /></Field>
                                <Field label="Si FAUX → étape"><Select value={e.si_faux_code} onChange={(v) => setEtape(i, { si_faux_code: v })} options={codeOpts} accent="#DC2626" /></Field>
                              </div>
                            </div>
                          )}

                          <div className="space-y-1.5">
                            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>Options</p>
                            <div className="flex flex-wrap gap-2">
                              <Check label="Commentaire obligatoire" v={e.obligatoire_commentaire} on={(b) => setEtape(i, { obligatoire_commentaire: b })} />
                              <Check label="PJ autorisées" v={e.pj_autorisees} on={(b) => setEtape(i, { pj_autorisees: b })} />
                              <Check label="Retour possible" v={e.retour_possible} on={(b) => setEtape(i, { retour_possible: b })} />
                              <Check label="Auto-skip si déjà décidé" v={e.auto_skip_si_deja_decide} on={(b) => setEtape(i, { auto_skip_si_deja_decide: b })} />
                            </div>
                          </div>

                          <ActeursEditor etape={e} onChange={(acteurs) => setEtape(i, { acteurs })} />
                          {e.type_etape !== "CONDITION" && e.type_etape !== "AUTOMATIQUE" &&
                            <DecisionsEditor etape={e} codeOpts={codeOpts} onChange={(decisions) => setEtape(i, { decisions })} />}
                          <ActionsEditor etape={e} onChange={(actions) => setEtape(i, { actions })} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Aperçu en pavés colorés */}
            <div className="rounded-2xl border p-4" style={{ borderColor: "hsl(var(--border))" }}>
              <h3 className="font-semibold text-sm mb-3" style={{ color: "hsl(var(--foreground))" }}>Aperçu du circuit</h3>
              <div className="flex flex-col gap-2.5">
                {wf.etapes.map((e) => {
                  const m = metaOf(e.type_etape);
                  return (
                    <div key={e.code}>
                      <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border" style={{ borderColor: m.color + "55", background: m.color + "10" }}>
                        <span className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: m.color + "26", color: m.color }}><m.Icon size={13} /></span>
                        <span className="font-medium text-sm" style={{ color: "hsl(var(--foreground))" }}>{e.libelle}</span>
                        <ColorBadge color={m.color}>{m.label}</ColorBadge>
                      </div>
                      {e.type_etape === "CONDITION" ? (
                        <div className="ml-7 mt-1.5 flex flex-col gap-1 text-[12px]">
                          <Branch color="#16A34A" label={`si ${e.condition_sql || "?"}`} cible={libByCode[e.si_vrai_code] || e.si_vrai_code} />
                          <Branch color="#DC2626" label="sinon" cible={libByCode[e.si_faux_code] || e.si_faux_code} />
                        </div>
                      ) : (
                        <div className="ml-7 mt-1.5 flex flex-col gap-1">
                          {e.decisions.map((d, k) => {
                            const dm = decMeta(d.type_decision);
                            return <Branch key={k} color={dm.color} label={d.libelle || dm.label} cible={libByCode[d.cible_code] || d.cible_code} />;
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* Légende */}
              <div className="flex flex-wrap gap-3 mt-4 pt-3 border-t" style={{ borderColor: "hsl(var(--border))" }}>
                {Object.entries(ETAPE_META).map(([k, v]) => (
                  <span key={k} className="flex items-center gap-1.5 text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                    <span className="w-3 h-3 rounded" style={{ background: v.color }} /> {v.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 sticky bottom-0 py-3 border-t mt-1" style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))" }}>
              <Button onClick={save} disabled={saving} className="gap-1.5">{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Enregistrer</Button>
              {!isNew && <Button variant="outline" onClick={publier} disabled={saving} className="gap-1.5"><Copy size={14} /> Publier nouvelle version</Button>}
              {!isNew && <Button variant="outline" onClick={dupliquerWorkflow} disabled={saving} className="gap-1.5"><Copy size={14} /> Dupliquer</Button>}
              {!isNew && wf.statut === "ARCHIVE"
                ? <Button variant="outline" onClick={reactiverWorkflow} disabled={saving} className="gap-1.5"><Power size={14} /> Réactiver</Button>
                : !isNew && <Button variant="outline" onClick={archiverDepuisBarre} disabled={saving} className="gap-1.5"><Power size={14} /> Archiver</Button>}
              {!isNew && (
                <Button variant="outline" onClick={() => { setShowDelete(true); setDeleteConfirm(""); }} className="gap-1.5 ml-auto"
                  style={{ color: "hsl(var(--destructive))", borderColor: "hsl(var(--destructive) / 0.4)" }}>
                  <Trash2 size={14} /> Supprimer
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modale de suppression de workflow (confirmation par code) */}
      {showDelete && wf && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "hsl(0 0% 0% / 0.5)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowDelete(false); }}>
          <div className="w-full max-w-md rounded-2xl shadow-2xl" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
            <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: "hsl(var(--border))" }}>
              <Trash2 size={18} style={{ color: "hsl(var(--destructive))" }} />
              <h2 className="font-semibold text-base" style={{ color: "hsl(var(--foreground))" }}>Supprimer le workflow</h2>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm" style={{ color: "hsl(var(--foreground))" }}>
                Cette action supprime définitivement le workflow <strong>{wf.libelle}</strong> et toutes ses étapes, acteurs, décisions et actions. Elle est <strong>irréversible</strong>.
              </p>
              <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                Si le workflow a déjà été utilisé par des demandes, la suppression sera refusée — vous pourrez alors l'archiver pour préserver l'historique.
              </p>
              <div className="space-y-1">
                <label className="text-[12px] font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Pour confirmer, saisissez le code : <code className="font-mono font-bold" style={{ color: "hsl(var(--foreground))" }}>{wf.code}</code>
                </label>
                <Input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder={wf.code} autoFocus />
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 px-5 py-4 border-t" style={{ borderColor: "hsl(var(--border))" }}>
              <Button variant="outline" onClick={archiverWorkflow} disabled={deleting} className="gap-1.5">
                <Power size={14} /> Archiver plutôt
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => setShowDelete(false)} disabled={deleting}>Annuler</Button>
                <Button onClick={supprimerWorkflow} disabled={deleting || deleteConfirm.trim() !== wf.code}
                  className="gap-1.5" style={{ background: "hsl(var(--destructive))", color: "white" }}>
                  {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Supprimer définitivement
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sous-éditeurs colorés ───────────────────────────────────────────────────
const ActeursEditor: React.FC<{ etape: EditEtape; onChange: (a: EditActeur[]) => void }> = ({ etape, onChange }) => {
  const set = (i: number, p: Partial<EditActeur>) => onChange(etape.acteurs.map((a, k) => k === i ? { ...a, ...p } : a));
  const add = () => onChange([...etape.acteurs, { type_acteur: "HIERARCHIE_N1", valeur: "", ordre_delegation: etape.acteurs.length, est_observateur: false, peut_deleguer: true, delai_relance_h: null, fallback_type: "", fallback_valeur: "" }]);
  return (
    <SubBlock icon={<Users size={13} />} title="Acteurs" color="#3B6FE4" onAdd={add}>
      {etape.acteurs.map((a, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border p-2" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
          <Select value={a.type_acteur} onChange={(v) => set(i, { type_acteur: v })} options={optActeur} accent="#3B6FE4" className="min-w-44" />
          {ACTEUR_AVEC_VALEUR.includes(a.type_acteur) &&
            <Input value={a.valeur} onChange={(e) => set(i, { valeur: e.target.value })} placeholder={a.type_acteur === "ROLE" ? "code rôle" : a.type_acteur === "UTILISATEUR_FIXE" ? "user id" : a.type_acteur === "GROUPE" ? "code groupe" : "expression"} className="h-9 w-40" />}
          <div className="flex items-center gap-2 ml-auto">
            <Check label="observateur" v={a.est_observateur} on={(b) => set(i, { est_observateur: b })} />
            <Check label="peut déléguer" v={a.peut_deleguer} on={(b) => set(i, { peut_deleguer: b })} />
            <button onClick={() => onChange(etape.acteurs.filter((_, k) => k !== i))} className="p-1.5 rounded-lg hover:bg-destructive/10" style={{ color: "hsl(var(--destructive))" }}><Trash2 size={13} /></button>
          </div>
        </div>
      ))}
      {etape.acteurs.length === 0 && <Empty>Aucun acteur.</Empty>}
    </SubBlock>
  );
};

const DecisionsEditor: React.FC<{ etape: EditEtape; codeOpts: { v: string; l: string }[]; onChange: (d: EditDecision[]) => void }> = ({ etape, codeOpts, onChange }) => {
  const set = (i: number, p: Partial<EditDecision>) => onChange(etape.decisions.map((d, k) => k === i ? { ...d, ...p } : d));
  const add = () => onChange([...etape.decisions, { code: "approuver", libelle: "Approuver", type_decision: "VALIDER", cible_code: "", obligatoire_commentaire: false, couleur: "#16A34A", icone: "check", ordre: etape.decisions.length }]);
  return (
    <SubBlock icon={<GitFork size={13} />} title="Décisions (transitions)" color="#E07B39" onAdd={add}>
      {etape.decisions.map((d, i) => {
        const dm = decMeta(d.type_decision);
        return (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border p-2" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))", borderLeft: `3px solid ${dm.color}` }}>
            <Input value={d.libelle} onChange={(e) => set(i, { libelle: e.target.value })} placeholder="libellé" className="h-9 w-32" />
            <Select value={d.type_decision} onChange={(v) => set(i, { type_decision: v })} options={optDecision} accent={dm.color} />
            <ArrowRight size={14} style={{ color: dm.color }} className="flex-shrink-0" />
            <Select value={d.cible_code} onChange={(v) => set(i, { cible_code: v })} options={codeOpts} className="min-w-40" />
            <div className="flex items-center gap-2 ml-auto">
              <Check label="commentaire requis" v={d.obligatoire_commentaire} on={(b) => set(i, { obligatoire_commentaire: b })} />
              <button onClick={() => onChange(etape.decisions.filter((_, k) => k !== i))} className="p-1.5 rounded-lg hover:bg-destructive/10" style={{ color: "hsl(var(--destructive))" }}><Trash2 size={13} /></button>
            </div>
          </div>
        );
      })}
      {etape.decisions.length === 0 && <Empty>Aucune décision.</Empty>}
    </SubBlock>
  );
};

const ActionsEditor: React.FC<{ etape: EditEtape; onChange: (a: EditAction[]) => void }> = ({ etape, onChange }) => {
  const set = (i: number, p: Partial<EditAction>) => onChange(etape.actions.map((a, k) => k === i ? { ...a, ...p } : a));
  const add = () => onChange([...etape.actions, { declencheur: "ENTREE", type_action: "NOTIFICATION_INTERNE", ordre: etape.actions.length, configuration: {}, condition_exec: "" }]);
  return (
    <SubBlock icon={<Zap size={13} />} title="Actions automatiques" color="#8B5CF6" onAdd={add}>
      {etape.actions.map((a, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border p-2" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))", borderLeft: "3px solid #8B5CF6" }}>
          <Select value={a.declencheur} onChange={(v) => set(i, { declencheur: v })} options={optDecl} />
          <Select value={a.type_action} onChange={(v) => set(i, { type_action: v })} options={optAction} accent="#8B5CF6" />
          <Input value={(a.configuration?.value as string) || ""} onChange={(e) => set(i, { configuration: { ...a.configuration, value: e.target.value } })} placeholder="paramètre (modèle / proc / message)" className="h-9 flex-1 min-w-40" />
          <button onClick={() => onChange(etape.actions.filter((_, k) => k !== i))} className="p-1.5 rounded-lg hover:bg-destructive/10" style={{ color: "hsl(var(--destructive))" }}><Trash2 size={13} /></button>
        </div>
      ))}
      {etape.actions.length === 0 && <Empty>Aucune action.</Empty>}
    </SubBlock>
  );
};

// ── Primitives UI ──────────────────────────────────────────────────────────
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col gap-1 min-w-0">
    <label className="text-[11px] font-medium leading-4 truncate" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</label>
    <div className="[&_input]:w-full [&_select]:w-full [&_input]:h-9 w-full">{children}</div>
  </div>
);
const Select: React.FC<{ value: string; onChange: (v: string) => void; options: { v: string; l: string }[]; className?: string; accent?: string }> = ({ value, onChange, options, className, accent }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} className={`h-9 rounded-md border px-2 text-sm bg-background ${className || ""}`}
    style={{ borderColor: accent ? accent + "66" : "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
    {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
  </select>
);
const Check: React.FC<{ label: string; v: boolean; on: (b: boolean) => void }> = ({ label, v, on }) => (
  <label className="flex items-center gap-2 text-[12px] cursor-pointer select-none px-2.5 py-1.5 rounded-lg border transition-colors"
    style={{ borderColor: v ? "hsl(var(--primary) / 0.5)" : "hsl(var(--border))", background: v ? "hsl(var(--primary) / 0.08)" : "transparent", color: v ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))" }}>
    <input type="checkbox" checked={v} onChange={(e) => on(e.target.checked)} className="accent-[hsl(var(--primary))]" /> {label}
  </label>
);
const Badge: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="text-[9px] px-1.5 py-0.5 rounded font-mono" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>{children}</span>
);
const ColorBadge: React.FC<{ color: string; children: React.ReactNode }> = ({ color, children }) => (
  <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide" style={{ background: color + "1F", color }}>{children}</span>
);
const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-[11px] italic" style={{ color: "hsl(var(--muted-foreground))" }}>{children}</p>
);
const Branch: React.FC<{ color: string; label: string; cible?: string }> = ({ color, label, cible }) => (
  <div className="flex items-center gap-1.5 text-[12px]" style={{ color: "hsl(var(--muted-foreground))" }}>
    <CornerDownRight size={12} style={{ color }} />
    <span className="px-1.5 py-0.5 rounded text-[11px] font-medium" style={{ background: color + "1A", color }}>{label}</span>
    <ArrowRight size={11} />
    <strong style={{ color: "hsl(var(--foreground))" }}>{cible || "(fin)"}</strong>
  </div>
);
const SubBlock: React.FC<{ icon: React.ReactNode; title: string; color: string; onAdd: () => void; children: React.ReactNode }> = ({ icon, title, color, onAdd, children }) => (
  <div className="rounded-lg p-3" style={{ background: color + "0D", border: `1px solid ${color}26` }}>
    <div className="flex items-center justify-between mb-2">
      <span className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color }}>{icon} {title}</span>
      <button onClick={onAdd} className="text-[11px] font-medium hover:underline flex items-center gap-0.5" style={{ color }}><Plus size={11} /> ajouter</button>
    </div>
    <div className="space-y-2">{children}</div>
  </div>
);
