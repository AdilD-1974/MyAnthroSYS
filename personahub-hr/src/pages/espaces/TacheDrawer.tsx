// src/pages/espaces/TacheDrawer.tsx
// Drawer v4 — Éditeur riche + Agent IA + Assignation équipe
import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  X, Trash2, CheckCircle2, Clock, Circle, Save,
  Calendar, Loader2, AlertTriangle, User, Check,
  Bold, Italic, List, ListOrdered, Heading2,
  Sparkles, Wand2, Layers, ChevronDown, ChevronUp,
  RotateCcw, Send,
} from "lucide-react";
import { Tache, TachePatchInput, TacheCreateInput, TacheStatut } from "@/lib/tachesApi";
import { useManagerPopulation } from "@/hooks/useManagerPopulation";
import { useAuth } from "@/contexts/AuthContext";
import { db, api } from "@/lib/api";

// ─── Types ───────────────────────────────────────────────────
interface TacheDrawerProps {
  tache:   Tache | null;
  open:    boolean;
  onClose: () => void;
  onSave:  (data: TachePatchInput | TacheCreateInput) => Promise<void>;
  onStatutChange?: (s: TacheStatut) => Promise<void>;
  onDelete?: () => Promise<void>;
}
interface CollabInfo { id: string; nom: string; prenom: string; matricule?: string; photo_url?: string; }

// ─── Constantes ──────────────────────────────────────────────
const STATUTS: { value: TacheStatut; label: string; icon: React.FC<any> }[] = [
  { value: "a_faire",  label: "À faire",  icon: Circle       },
  { value: "en_cours", label: "En cours", icon: Clock        },
  { value: "terminee", label: "Terminée", icon: CheckCircle2 },
  { value: "annulee",  label: "Annulée",  icon: X            },
];
const PRIORITES = [
  { value: "basse",   label: "🟢 Basse"   },
  { value: "normale", label: "🟡 Normale" },
  { value: "haute",   label: "🟠 Haute"   },
  { value: "urgente", label: "🔴 Urgente" },
];
const TYPES = [
  { value: "personnelle", label: "Personnelle" },
  { value: "assignee",    label: "Assignée"    },
  { value: "rh_metier",  label: "RH Métier"   },
];

// ─── Éditeur Riche ───────────────────────────────────────────
function RichEditor({
  value, onChange, placeholder, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isUpdating = useRef(false);

  useEffect(() => {
    if (!editorRef.current || isUpdating.current) return;
    if (editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value || "";
    }
  }, [value]);

  const exec = (cmd: string, val?: string) => {
    document.execCommand(cmd, false, val);
    editorRef.current?.focus();
    handleInput();
  };

  const handleInput = () => {
    isUpdating.current = true;
    onChange(editorRef.current?.innerHTML || "");
    setTimeout(() => { isUpdating.current = false; }, 0);
  };

  const tools = [
    { icon: Bold,         title: "Gras",         cmd: "bold"        },
    { icon: Italic,       title: "Italique",      cmd: "italic"      },
    { icon: Heading2,     title: "Titre",         cmd: "formatBlock", val: "h3" },
    { icon: List,         title: "Liste à puces", cmd: "insertUnorderedList"    },
    { icon: ListOrdered,  title: "Liste numérotée", cmd: "insertOrderedList"   },
  ];

  return (
    <div className="rounded-xl border overflow-hidden"
      style={{ borderColor: "hsl(var(--border))" }}>
      {/* Barre d'outils */}
      <div className="flex items-center gap-1 px-3 py-2 border-b"
        style={{ background: "hsl(var(--muted) / 0.4)", borderColor: "hsl(var(--border))" }}>
        {tools.map(t => (
          <button key={t.cmd} title={t.title}
            onMouseDown={e => { e.preventDefault(); exec(t.cmd, t.val); }}
            className="p-1.5 rounded transition-colors hover:bg-muted"
            style={{ color: "hsl(var(--muted-foreground))" }}>
            <t.icon size={14} />
          </button>
        ))}
        <div className="w-px h-4 mx-1" style={{ background: "hsl(var(--border))" }} />
        <button title="Annuler"
          onMouseDown={e => { e.preventDefault(); exec("undo"); }}
          className="p-1.5 rounded transition-colors hover:bg-muted"
          style={{ color: "hsl(var(--muted-foreground))" }}>
          <RotateCcw size={14} />
        </button>
      </div>

      {/* Zone d'édition */}
      <div
        ref={editorRef}
        contentEditable={!disabled}
        onInput={handleInput}
        data-placeholder={placeholder}
        className="outline-none px-3 py-2.5 text-sm min-h-[100px] max-h-[220px] overflow-y-auto"
        style={{
          color: "hsl(var(--foreground))",
          background: "hsl(var(--background))",
          lineHeight: 1.6,
        }}
        suppressContentEditableWarning
      />

      <style>{`
        [contenteditable]:empty:before {
          content: attr(data-placeholder);
          color: hsl(var(--muted-foreground));
          pointer-events: none;
        }
        [contenteditable] h3 { font-size: 13px; font-weight: 600; margin: 6px 0 2px; }
        [contenteditable] ul, [contenteditable] ol { padding-left: 18px; margin: 4px 0; }
        [contenteditable] li { margin: 2px 0; }
        [contenteditable] strong { font-weight: 600; }
      `}</style>
    </div>
  );
}

// ─── Panneau IA ───────────────────────────────────────────────
function PanneauIA({
  titre, description, typeTache, priorite,
  onApply, onClose,
}: {
  titre: string;
  description: string;
  typeTache: string;
  priorite: string;
  onApply: (html: string) => void;
  onClose: () => void;
}) {
  const [mode,      setMode]      = useState<"rediger"|"ameliorer"|"decomposer">("rediger");
  const [contexte,  setContexte]  = useState("");
  const [loading,   setLoading]   = useState(false);
  const [result,    setResult]    = useState("");
  const [sousTaches, setSousTaches] = useState<{titre:string;priorite:string}[]>([]);

  const call = async () => {
    setLoading(true);
    setResult("");
    setSousTaches([]);
    try {
      if (mode === "rediger") {
        const r = await api.post<{description:string}>("/ai/tache/rediger", {
          titre, type_tache: typeTache, priorite, contexte: contexte || undefined,
        });
        setResult(r.description);
      } else if (mode === "ameliorer") {
        const r = await api.post<{description:string}>("/ai/tache/ameliorer", {
          titre, description, type_tache: typeTache,
        });
        setResult(r.description);
      } else {
        const r = await api.post<{sous_taches:{titre:string;priorite:string}[]}>("/ai/tache/decomposer", {
          titre, description: description || undefined,
        });
        setSousTaches(r.sous_taches || []);
      }
    } catch (e) {
      setResult("<p style='color:red'>Erreur lors de la génération. Vérifiez la clé ANTHROPIC_API_KEY.</p>");
    } finally { setLoading(false); }
  };

  return (
    <div className="rounded-xl border overflow-hidden"
      style={{ background: "hsl(var(--accent) / 0.04)", borderColor: "hsl(var(--accent) / 0.3)" }}>

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b"
        style={{ background: "hsl(var(--accent) / 0.08)", borderColor: "hsl(var(--accent) / 0.2)" }}>
        <Sparkles size={15} style={{ color: "hsl(var(--accent))" }} />
        <span className="text-xs font-bold uppercase tracking-wider flex-1"
          style={{ color: "hsl(var(--accent))" }}>
          Assistant IA
        </span>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted">
          <X size={13} style={{ color: "hsl(var(--muted-foreground))" }} />
        </button>
      </div>

      <div className="p-4 space-y-3">
        {/* Onglets mode */}
        <div className="flex gap-1.5 flex-wrap">
          {[
            { k: "rediger",    label: "✍️ Rédiger",   title: "Générer depuis le titre" },
            { k: "ameliorer",  label: "✨ Améliorer",  title: "Améliorer le texte existant" },
            { k: "decomposer", label: "🧩 Décomposer", title: "Suggérer des sous-tâches" },
          ].map(m => (
            <button key={m.k} onClick={() => { setMode(m.k as any); setResult(""); setSousTaches([]); }}
              title={m.title}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all"
              style={{
                background: mode === m.k ? "hsl(var(--accent))" : "transparent",
                borderColor: mode === m.k ? "hsl(var(--accent))" : "hsl(var(--border))",
                color: mode === m.k ? "white" : "hsl(var(--muted-foreground))",
              }}>
              {m.label}
            </button>
          ))}
        </div>

        {/* Contexte supplémentaire (mode rédiger) */}
        {mode === "rediger" && (
          <textarea
            value={contexte}
            onChange={e => setContexte(e.target.value)}
            placeholder="Contexte supplémentaire (optionnel) — ex: pour quel collaborateur, quelle deadline imposée, quel outil..."
            rows={2}
            className="w-full px-3 py-2 rounded-lg border text-xs outline-none resize-none"
            style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
          />
        )}

        {/* Bouton générer */}
        <button onClick={call} disabled={loading || !titre.trim()}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
          style={{
            background: !titre.trim() ? "hsl(var(--muted))" : "hsl(var(--accent))",
            color: !titre.trim() ? "hsl(var(--muted-foreground))" : "white",
          }}>
          {loading
            ? <><Loader2 size={14} className="animate-spin" /> Génération en cours…</>
            : <><Send size={14} />
              {mode === "rediger" ? "Générer la description"
                : mode === "ameliorer" ? "Améliorer le texte"
                : "Suggérer des sous-tâches"}
            </>
          }
        </button>

        {/* Résultat texte */}
        {result && (
          <div className="space-y-2">
            <div className="rounded-lg border p-3 text-sm"
              style={{
                borderColor: "hsl(var(--accent) / 0.3)",
                background: "hsl(var(--background))",
                color: "hsl(var(--foreground))",
                lineHeight: 1.6,
              }}
              dangerouslySetInnerHTML={{ __html: result }}
            />
            <button onClick={() => onApply(result)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors"
              style={{
                background: "hsl(var(--accent) / 0.1)",
                borderColor: "hsl(var(--accent) / 0.4)",
                color: "hsl(var(--accent))",
              }}>
              <Check size={13} /> Insérer dans la description
            </button>
          </div>
        )}

        {/* Résultat sous-tâches */}
        {sousTaches.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "hsl(var(--accent))" }}>
              Sous-tâches suggérées
            </p>
            {sousTaches.map((st, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg border"
                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))" }}>
                <span className="text-[10px] px-2 py-0.5 rounded font-medium"
                  style={{
                    background: st.priorite === "urgente" ? "hsl(0 70% 50% / 0.1)"
                      : st.priorite === "haute" ? "hsl(38 92% 50% / 0.1)"
                      : "hsl(var(--muted))",
                    color: st.priorite === "urgente" ? "hsl(0 70% 42%)"
                      : st.priorite === "haute" ? "hsl(38 92% 38%)"
                      : "hsl(var(--muted-foreground))",
                  }}>
                  {st.priorite}
                </span>
                <span className="flex-1 text-sm" style={{ color: "hsl(var(--foreground))" }}>{st.titre}</span>
              </div>
            ))}
            <p className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>
              💡 Vous pourrez créer ces sous-tâches manuellement depuis le Kanban.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Drawer principal ─────────────────────────────────────────
export default function TacheDrawer({
  tache, open, onClose, onSave, onStatutChange, onDelete,
}: TacheDrawerProps) {
  const isNew = tache === null;
  const { role } = useAuth();
  const isManager = ["manager","administrateur","gestionnaire_rh"].includes(role ?? "");

  const { collaborateurIds, loading: loadingEquipe } = useManagerPopulation();
  const [equipe, setEquipe] = useState<CollabInfo[]>([]);

  const [titre,         setTitre]        = useState("");
  const [description,   setDescription]  = useState("");
  const [statut,        setStatut]       = useState<TacheStatut>("a_faire");
  const [priorite,      setPriorite]     = useState("normale");
  const [type_tache,    setTypeTache]    = useState("personnelle");
  const [date_echeance, setDateEch]      = useState("");
  const [etiquetteInput, setEtiqIn]     = useState("");
  const [etiquettes,    setEtiquettes]   = useState<string[]>([]);
  const [assignataires, setAssignataires] = useState<string[]>([]);
  const [searchEquipe,  setSearchEquipe] = useState("");

  const [showIA,     setShowIA]    = useState(false);
  const [saving,     setSaving]    = useState(false);
  const [deleting,   setDeleting]  = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [dirty,      setDirty]     = useState(false);
  const [prevStatut, setPrevStatut] = useState<TacheStatut>("a_faire");

  useEffect(() => {
    if (!isManager || collaborateurIds.length === 0) { setEquipe([]); return; }
    db.list<CollabInfo>("collaborateurs", {
      select: "id,nom,prenom,matricule,photo_url",
      id: `in.(${collaborateurIds.join(",")})`, archive: false,
    }).then(setEquipe).catch(() => setEquipe([]));
  }, [collaborateurIds, isManager]);

  useEffect(() => {
    if (open) {
      setTitre(tache?.titre        ?? "");
      setDescription(tache?.description ?? "");
      setStatut(tache?.statut      ?? "a_faire");
      setPrevStatut(tache?.statut  ?? "a_faire");
      setPriorite(tache?.priorite  ?? "normale");
      setTypeTache(tache?.type_tache ?? "personnelle");
      setDateEch(tache?.date_echeance ?? "");
      setEtiquettes(tache?.etiquettes ?? []);
      setAssignataires(tache?.assignations?.map(a => a.collaborateur_id) ?? []);
      setSearchEquipe("");
      setEtiqIn("");
      setDirty(false);
      setConfirmDel(false);
      setShowIA(false);
    }
  }, [open, tache]);

  const mark = () => setDirty(true);

  const notifierManager = async (newStatut: TacheStatut) => {
    if (!tache || newStatut !== "terminee" || prevStatut === "terminee") return;
    if (!tache.createur_id || tache.createur_id === tache.proprietaire_id) return;
    try {
      await api.post("/notifications", {
        destinataire_id: tache.createur_id,
        type_notif: "tache_terminee",
        titre: "Tâche terminée",
        message: `« ${tache.titre} » a été marquée comme terminée.`,
        lien: `/taches/${tache.id}`,
      });
    } catch {}
  };

  const handleSave = async () => {
    if (!titre.trim()) return;
    setSaving(true);
    try {
      await onSave({
        titre: titre.trim(),
        description: description || undefined,
        statut, priorite, type_tache,
        date_echeance: date_echeance || undefined,
        etiquettes,
        assignations: assignataires.length > 0
          ? assignataires.map(id => ({ collaborateur_id: id, role: "responsable" }))
          : undefined,
      } as any);
      setDirty(false);
    } finally { setSaving(false); }
  };

  const handleStatut = async (s: TacheStatut) => {
    setStatut(s); mark();
    if (tache && onStatutChange) {
      setSaving(true);
      try { await onStatutChange(s); await notifierManager(s); setPrevStatut(s); }
      finally { setSaving(false); }
    }
  };

  const toggleAssignataire = (id: string) => {
    setAssignataires(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
    mark();
  };

  const addEtiquette = () => {
    const v = etiquetteInput.trim().toLowerCase();
    if (v && !etiquettes.includes(v)) { setEtiquettes(p => [...p, v]); mark(); }
    setEtiqIn("");
  };

  const equipeFiltrée = equipe.filter(c => {
    if (!searchEquipe) return true;
    const q = searchEquipe.toLowerCase();
    return c.nom.toLowerCase().includes(q)
      || c.prenom.toLowerCase().includes(q)
      || (c.matricule?.toLowerCase().includes(q) ?? false);
  });

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-40 transition-opacity duration-200"
        style={{ background: "hsl(0 0% 0% / 0.45)", opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none" }} />

      <div className="fixed top-0 right-0 bottom-0 z-50 flex flex-col shadow-2xl transition-transform duration-300"
        style={{
          width: 540,
          background: "hsl(var(--card))",
          borderLeft: "1px solid hsl(var(--border))",
          transform: open ? "translateX(0)" : "translateX(540px)",
        }}>

        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-6 py-4 border-b flex-shrink-0"
          style={{ borderColor: "hsl(var(--border))" }}>
          <div className="flex-1">
            <h2 className="font-semibold text-base" style={{ fontFamily: "'Poppins', sans-serif", color: "hsl(var(--foreground))" }}>
              {isNew ? "Nouvelle tâche" : "Détail de la tâche"}
            </h2>
            {!isNew && tache?.cree_le && (
              <p className="text-[11px] mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                Créée le {new Date(tache.cree_le).toLocaleDateString("fr-FR")}
              </p>
            )}
          </div>
          {saving && <Loader2 size={16} className="animate-spin" style={{ color: "hsl(var(--accent))" }} />}
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted">
            <X size={16} style={{ color: "hsl(var(--muted-foreground))" }} />
          </button>
        </div>

        {/* ── Corps scrollable ── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Statut */}
          <div>
            <Label>Statut</Label>
            <div className="flex gap-2 flex-wrap">
              {STATUTS.map(s => {
                const Icon = s.icon;
                const active = statut === s.value;
                return (
                  <button key={s.value} onClick={() => handleStatut(s.value)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all"
                    style={{
                      background: active ? "hsl(var(--accent) / 0.1)" : "transparent",
                      borderColor: active ? "hsl(var(--accent))" : "hsl(var(--border))",
                      color: active ? "hsl(var(--accent))" : "hsl(var(--muted-foreground))",
                      fontWeight: active ? 600 : 400,
                    }}>
                    <Icon size={13} /> {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Titre */}
          <Field label="Titre" required>
            <input value={titre} onChange={e => { setTitre(e.target.value); mark(); }}
              placeholder="Nom de la tâche…" autoFocus={isNew}
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
              style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }} />
          </Field>

          {/* Description + bouton IA */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "hsl(var(--accent))" }}>
                Description
              </label>
              <button
                onClick={() => setShowIA(v => !v)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all"
                style={{
                  background: showIA ? "hsl(var(--accent))" : "hsl(var(--accent) / 0.08)",
                  borderColor: "hsl(var(--accent) / 0.4)",
                  color: showIA ? "white" : "hsl(var(--accent))",
                }}>
                <Sparkles size={12} />
                Assistant IA
                {showIA ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              </button>
            </div>

            <RichEditor
              value={description}
              onChange={v => { setDescription(v); mark(); }}
              placeholder="Décrivez la tâche — objectif, actions à réaliser, critères de complétion…"
            />
          </div>

          {/* Panneau IA */}
          {showIA && (
            <PanneauIA
              titre={titre}
              description={description}
              typeTache={type_tache}
              priorite={priorite}
              onApply={html => { setDescription(html); mark(); setShowIA(false); }}
              onClose={() => setShowIA(false)}
            />
          )}

          {/* Priorité + Type */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Priorité">
              <select value={priorite} onChange={e => { setPriorite(e.target.value); mark(); }}
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}>
                {PRIORITES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </Field>
            <Field label="Type">
              <select value={type_tache} onChange={e => { setTypeTache(e.target.value); mark(); }}
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
                disabled={!isNew && tache?.type_tache === "workflow"}>
                {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                {!isNew && tache?.type_tache === "workflow" && <option value="workflow">Workflow (auto)</option>}
              </select>
            </Field>
          </div>

          {/* Échéance */}
          <Field label="Échéance">
            <div className="relative">
              <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
              <input type="date" value={date_echeance} onChange={e => { setDateEch(e.target.value); mark(); }}
                className="w-full pl-9 pr-3 py-2 rounded-lg border text-sm outline-none"
                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }} />
            </div>
          </Field>

          {/* Assignation */}
          {isManager && (
            <Field label="Assigner à l'équipe">
              {loadingEquipe ? (
                <div className="flex items-center gap-2 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                  <Loader2 size={12} className="animate-spin" /> Chargement…
                </div>
              ) : equipe.length === 0 ? (
                <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun collaborateur dans votre équipe</p>
              ) : (
                <div>
                  <input placeholder="Rechercher par nom ou matricule…"
                    value={searchEquipe} onChange={e => setSearchEquipe(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border text-sm outline-none mb-2"
                    style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }} />
                  <div className="space-y-1.5 max-h-44 overflow-y-auto">
                    {equipeFiltrée.map(c => {
                      const selected = assignataires.includes(c.id);
                      return (
                        <button key={c.id} onClick={() => toggleAssignataire(c.id)}
                          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg border transition-all text-left"
                          style={{
                            background: selected ? "hsl(var(--accent) / 0.08)" : "transparent",
                            borderColor: selected ? "hsl(var(--accent) / 0.5)" : "hsl(var(--border))",
                          }}>
                          <div className="w-8 h-8 rounded-full flex-shrink-0 overflow-hidden"
                            style={{ border: selected ? "2px solid hsl(var(--accent))" : "1px solid hsl(var(--border))" }}>
                            {c.photo_url
                              ? <img src={c.photo_url} alt={c.prenom} className="w-full h-full object-cover"
                                  onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                              : <div className="w-full h-full flex items-center justify-center text-xs font-bold"
                                  style={{ background: selected ? "hsl(var(--accent))" : "hsl(var(--sidebar-primary) / 0.15)", color: selected ? "white" : "hsl(var(--accent))" }}>
                                  {c.prenom[0]?.toUpperCase()}{c.nom[0]?.toUpperCase()}
                                </div>
                            }
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate" style={{ color: "hsl(var(--foreground))" }}>
                              {c.prenom} {c.nom}
                            </p>
                            {c.matricule && (
                              <p className="text-[10px] font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>{c.matricule}</p>
                            )}
                          </div>
                          {selected
                            ? <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "hsl(var(--accent))" }}>
                                <Check size={11} color="white" />
                              </div>
                            : <div className="w-5 h-5 rounded-full border flex-shrink-0" style={{ borderColor: "hsl(var(--border))" }} />
                          }
                        </button>
                      );
                    })}
                  </div>
                  {assignataires.length > 0 && (
                    <p className="text-[11px] mt-2" style={{ color: "hsl(var(--accent))" }}>
                      {assignataires.length} personne{assignataires.length > 1 ? "s" : ""} assignée{assignataires.length > 1 ? "s" : ""}
                      {" · "}Notification au manager à la complétion.
                    </p>
                  )}
                </div>
              )}
            </Field>
          )}

          {/* Étiquettes */}
          <Field label="Étiquettes">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {etiquettes.map(e => (
                <span key={e} className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md"
                  style={{ background: "hsl(var(--accent) / 0.1)", color: "hsl(var(--accent))" }}>
                  {e}
                  <button onClick={() => { setEtiquettes(p => p.filter(t => t !== e)); mark(); }}><X size={9} /></button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={etiquetteInput} onChange={e => setEtiqIn(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addEtiquette(); } }}
                placeholder="Ajouter une étiquette…"
                className="flex-1 px-3 py-2 rounded-lg border text-sm outline-none"
                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }} />
              <button onClick={addEtiquette}
                className="px-3 py-2 rounded-lg border text-sm font-medium hover:bg-muted"
                style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>+</button>
            </div>
          </Field>

          {/* Alertes */}
          {tache?.en_retard && (
            <div className="rounded-xl p-3 flex items-center gap-2 border text-xs font-medium"
              style={{ background: "hsl(0 70% 50% / 0.08)", borderColor: "hsl(0 70% 50% / 0.3)", color: "hsl(0 70% 42%)" }}>
              <AlertTriangle size={14} /> Cette tâche est en retard
            </div>
          )}
          {tache?.wf_instance_id && (
            <div className="rounded-xl p-3 text-xs border"
              style={{ background: "hsl(var(--accent) / 0.05)", borderColor: "hsl(var(--accent) / 0.3)", color: "hsl(var(--muted-foreground))" }}>
              <span className="font-semibold" style={{ color: "hsl(var(--accent))" }}>Liée au workflow</span>
              {" · "}Instance : {tache.wf_instance_id.slice(0, 8)}…
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center gap-2 px-6 py-4 border-t flex-shrink-0"
          style={{ borderColor: "hsl(var(--border))" }}>
          {!isNew && onDelete && (
            <button onClick={async () => {
              if (!confirmDel) { setConfirmDel(true); return; }
              setDeleting(true);
              try { await onDelete?.(); } finally { setDeleting(false); }
            }} disabled={deleting}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-all"
              style={{
                background: confirmDel ? "hsl(0 70% 50% / 0.08)" : "transparent",
                borderColor: confirmDel ? "hsl(0 70% 50% / 0.5)" : "hsl(var(--border))",
                color: confirmDel ? "hsl(0 70% 42%)" : "hsl(var(--muted-foreground))",
              }}>
              {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              {confirmDel ? "Confirmer ?" : "Supprimer"}
            </button>
          )}
          {confirmDel && (
            <button onClick={() => setConfirmDel(false)}
              className="px-3 py-2 rounded-lg text-xs border"
              style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
              Annuler
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium border hover:bg-muted"
            style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
            {dirty ? "Annuler" : "Fermer"}
          </button>
          <button onClick={handleSave} disabled={saving || !titre.trim() || (!dirty && !isNew)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold"
            style={{
              background: "hsl(var(--accent))", color: "white",
              opacity: !titre.trim() || (!dirty && !isNew) ? 0.5 : 1,
              cursor: !titre.trim() ? "not-allowed" : "pointer",
            }}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {isNew ? "Créer" : "Enregistrer"}
          </button>
        </div>
      </div>
    </>
  );
}

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "hsl(var(--accent))" }}>
        {label}{required && <span className="ml-1" style={{ color: "hsl(var(--destructive))" }}>*</span>}
      </label>
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: "hsl(var(--accent))" }}>{children}</p>;
}
