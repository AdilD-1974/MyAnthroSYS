// src/pages/espaces/TacheDrawer.tsx
import React, { useEffect, useState } from "react";
import { X, Trash2, CheckCircle2, Clock, Circle, Save, Calendar, Loader2, AlertTriangle } from "lucide-react";
import { Tache, TachePatchInput, TacheCreateInput, TacheStatut } from "@/lib/tachesApi";

interface TacheDrawerProps {
  tache:   Tache | null;
  open:    boolean;
  onClose: () => void;
  onSave:  (data: TachePatchInput | TacheCreateInput) => Promise<void>;
  onStatutChange?: (s: TacheStatut) => Promise<void>;
  onDelete?: () => Promise<void>;
}

const STATUTS: { value: TacheStatut; label: string; icon: React.FC<any> }[] = [
  { value: "a_faire",  label: "À faire",  icon: Circle       },
  { value: "en_cours", label: "En cours", icon: Clock        },
  { value: "terminee", label: "Terminée", icon: CheckCircle2 },
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

export default function TacheDrawer({ tache, open, onClose, onSave, onStatutChange, onDelete }: TacheDrawerProps) {
  const isNew = tache === null;

  const [titre,        setTitre]       = useState("");
  const [description,  setDescription] = useState("");
  const [statut,       setStatut]      = useState<TacheStatut>("a_faire");
  const [priorite,     setPriorite]    = useState("normale");
  const [type_tache,   setTypeTache]   = useState("personnelle");
  const [date_echeance, setDateEch]    = useState("");
  const [etiquetteInput, setEtiqIn]   = useState("");
  const [etiquettes,   setEtiquettes]  = useState<string[]>([]);

  const [saving,     setSaving]    = useState(false);
  const [deleting,   setDeleting]  = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [dirty,      setDirty]     = useState(false);

  useEffect(() => {
    if (open) {
      setTitre(tache?.titre        ?? "");
      setDescription(tache?.description ?? "");
      setStatut(tache?.statut      ?? "a_faire");
      setPriorite(tache?.priorite  ?? "normale");
      setTypeTache(tache?.type_tache ?? "personnelle");
      setDateEch(tache?.date_echeance ?? "");
      setEtiquettes(tache?.etiquettes ?? []);
      setEtiqIn("");
      setDirty(false);
      setConfirmDel(false);
    }
  }, [open, tache]);

  const mark = () => setDirty(true);

  const handleSave = async () => {
    if (!titre.trim()) return;
    setSaving(true);
    try {
      await onSave({ titre: titre.trim(), description: description || undefined, statut, priorite, type_tache, date_echeance: date_echeance || undefined, etiquettes } as any);
      setDirty(false);
    } finally { setSaving(false); }
  };

  const handleStatut = async (s: TacheStatut) => {
    setStatut(s); mark();
    if (tache && onStatutChange) { setSaving(true); try { await onStatutChange(s); } finally { setSaving(false); } }
  };

  const handleDelete = async () => {
    if (!confirmDel) { setConfirmDel(true); return; }
    if (!onDelete) return;
    setDeleting(true);
    try { await onDelete(); } finally { setDeleting(false); }
  };

  const addEtiquette = () => {
    const v = etiquetteInput.trim().toLowerCase();
    if (v && !etiquettes.includes(v)) { setEtiquettes(p => [...p, v]); mark(); }
    setEtiqIn("");
  };

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-40 transition-opacity duration-200"
        style={{ background: "hsl(0 0% 0% / 0.45)", opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none" }}
      />

      {/* Panneau latéral */}
      <div
        className="fixed top-0 right-0 bottom-0 z-50 flex flex-col shadow-2xl transition-transform duration-300"
        style={{
          width: 480,
          background: "hsl(var(--card))",
          borderLeft: "1px solid hsl(var(--border))",
          transform: open ? "translateX(0)" : "translateX(480px)",
        }}
      >
        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-6 py-4 border-b" style={{ borderColor: "hsl(var(--border))" }}>
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
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X size={16} style={{ color: "hsl(var(--muted-foreground))" }} />
          </button>
        </div>

        {/* ── Corps scrollable ── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Statut — boutons */}
          {!isNew && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: "hsl(var(--accent))" }}>Statut</p>
              <div className="flex gap-2">
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
          )}

          {/* Titre */}
          <Field label="Titre" required>
            <input
              value={titre}
              onChange={e => { setTitre(e.target.value); mark(); }}
              placeholder="Nom de la tâche…"
              autoFocus={isNew}
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none transition-colors focus:border-accent"
              style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
            />
          </Field>

          {/* Description */}
          <Field label="Description">
            <textarea
              value={description}
              onChange={e => { setDescription(e.target.value); mark(); }}
              placeholder="Détails, contexte, lien vers un dossier…"
              rows={3}
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none resize-y leading-relaxed transition-colors"
              style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
            />
          </Field>

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
                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
              />
            </div>
          </Field>

          {/* Étiquettes */}
          <Field label="Étiquettes">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {etiquettes.map(e => (
                <span key={e} className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md"
                  style={{ background: "hsl(var(--accent) / 0.1)", color: "hsl(var(--accent))" }}>
                  {e}
                  <button onClick={() => { setEtiquettes(p => p.filter(t => t !== e)); mark(); }}
                    className="hover:opacity-70">
                    <X size={9} />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={etiquetteInput}
                onChange={e => setEtiqIn(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addEtiquette(); } }}
                placeholder="Ajouter une étiquette…"
                className="flex-1 px-3 py-2 rounded-lg border text-sm outline-none"
                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
              />
              <button onClick={addEtiquette}
                className="px-3 py-2 rounded-lg border text-sm font-medium transition-colors hover:bg-muted"
                style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
                +
              </button>
            </div>
          </Field>

          {/* Lien workflow */}
          {tache?.wf_instance_id && (
            <div className="rounded-xl p-3 text-xs border"
              style={{ background: "hsl(var(--accent) / 0.05)", borderColor: "hsl(var(--accent) / 0.3)", color: "hsl(var(--muted-foreground))" }}>
              <span className="font-semibold" style={{ color: "hsl(var(--accent))" }}>Liée au workflow</span>
              <br />Instance : {tache.wf_instance_id.slice(0, 8)}…
            </div>
          )}

          {/* Alerte retard */}
          {tache?.en_retard && (
            <div className="rounded-xl p-3 flex items-center gap-2 border text-xs font-medium"
              style={{ background: "hsl(0 70% 50% / 0.08)", borderColor: "hsl(0 70% 50% / 0.3)", color: "hsl(0 70% 42%)" }}>
              <AlertTriangle size={14} /> Cette tâche est en retard
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center gap-2 px-6 py-4 border-t" style={{ borderColor: "hsl(var(--border))" }}>
          {/* Supprimer */}
          {!isNew && onDelete && (
            <button onClick={handleDelete} disabled={deleting}
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
              className="px-3 py-2 rounded-lg text-xs border transition-colors"
              style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
              Annuler
            </button>
          )}

          <div className="flex-1" />

          {/* Fermer */}
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors hover:bg-muted"
            style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
            {dirty ? "Annuler" : "Fermer"}
          </button>

          {/* Sauvegarder */}
          <button onClick={handleSave}
            disabled={saving || !titre.trim() || (!dirty && !isNew)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={{
              background: "hsl(var(--accent))",
              color: "white",
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
      <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5"
        style={{ color: "hsl(var(--accent))" }}>
        {label}{required && <span className="ml-1" style={{ color: "hsl(var(--destructive))" }}>*</span>}
      </label>
      {children}
    </div>
  );
}
