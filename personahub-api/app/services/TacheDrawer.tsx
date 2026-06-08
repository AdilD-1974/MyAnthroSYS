// src/pages/espaces/TacheDrawer.tsx
// ------------------------------------------------------------
// Panneau latéral — détail / création / édition d'une tâche
// ------------------------------------------------------------
import { useEffect, useState } from "react";
import {
  X, Trash2, CheckCircle2, Clock, Circle, Save,
  Calendar, Flag, Tag, User, AlignLeft, Loader2,
} from "lucide-react";
import { Tache, TachePatchInput, TacheCreateInput, TacheStatut } from "@/lib/tachesApi";

// ─── Types ───────────────────────────────────────────────────

interface TacheDrawerProps {
  tache:   Tache | null;          // null = mode création
  open:    boolean;
  onClose: () => void;
  onSave:  (data: TachePatchInput | TacheCreateInput) => Promise<void>;
  onStatutChange?: (s: TacheStatut) => Promise<void>;
  onDelete?: () => Promise<void>;
}

// ─── Helpers ─────────────────────────────────────────────────

const STATUTS: { value: TacheStatut; label: string; icon: React.FC<{ size: number; style?: React.CSSProperties }> }[] = [
  { value: "a_faire",  label: "À faire",   icon: Circle       },
  { value: "en_cours", label: "En cours",  icon: Clock        },
  { value: "terminee", label: "Terminée",  icon: CheckCircle2 },
];

const PRIORITES = [
  { value: "basse",   label: "Basse",   color: "var(--color-text-tertiary)"  },
  { value: "normale", label: "Normale", color: "var(--color-text-secondary)" },
  { value: "haute",   label: "Haute",   color: "var(--color-text-warning)"   },
  { value: "urgente", label: "Urgente", color: "var(--color-text-danger)"    },
];

const TYPES = [
  { value: "personnelle", label: "Personnelle" },
  { value: "assignee",    label: "Assignée"    },
  { value: "rh_metier",   label: "RH Métier"   },
];

// ─── Composant ───────────────────────────────────────────────

export default function TacheDrawer({
  tache, open, onClose, onSave, onStatutChange, onDelete,
}: TacheDrawerProps) {

  const isNew = tache === null;

  // Formulaire
  const [titre,        setTitre]       = useState("");
  const [description,  setDescription] = useState("");
  const [statut,       setStatut]      = useState<TacheStatut>("a_faire");
  const [priorite,     setPriorite]    = useState("normale");
  const [type_tache,   setTypeTache]   = useState("personnelle");
  const [date_echeance, setDateEch]    = useState("");
  const [etiquetteInput, setEtiqIn]   = useState("");
  const [etiquettes,   setEtiquettes]  = useState<string[]>([]);

  // UI
  const [saving,    setSaving]   = useState(false);
  const [deleting,  setDeleting] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [dirty,     setDirty]    = useState(false);

  // Initialisation à l'ouverture
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

  const markDirty = () => setDirty(true);

  const handleSave = async () => {
    if (!titre.trim()) return;
    setSaving(true);
    try {
      await onSave({
        titre: titre.trim(),
        description: description || undefined,
        statut,
        priorite,
        type_tache,
        date_echeance: date_echeance || undefined,
        etiquettes,
      } as TachePatchInput);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const handleStatut = async (s: TacheStatut) => {
    setStatut(s);
    markDirty();
    if (tache && onStatutChange) {
      setSaving(true);
      try { await onStatutChange(s); }
      finally { setSaving(false); }
    }
  };

  const handleDelete = async () => {
    if (!confirmDel) { setConfirmDel(true); return; }
    if (!onDelete) return;
    setDeleting(true);
    try { await onDelete(); }
    finally { setDeleting(false); }
  };

  const addEtiquette = () => {
    const v = etiquetteInput.trim().toLowerCase();
    if (v && !etiquettes.includes(v)) {
      setEtiquettes(prev => [...prev, v]);
      markDirty();
    }
    setEtiqIn("");
  };

  // Overlay + drawer
  const drawerW = 460;

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.3)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.2s",
          zIndex: 400,
        }}
      />

      {/* Panneau */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0,
        width: drawerW,
        background: "var(--color-background-primary)",
        borderLeft: "1px solid var(--color-border-tertiary)",
        transform: open ? "translateX(0)" : `translateX(${drawerW}px)`,
        transition: "transform 0.25s cubic-bezier(0.4,0,0.2,1)",
        zIndex: 401,
        display: "flex", flexDirection: "column",
        overflowY: "auto",
      }}>

        {/* ── Header ── */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "16px 20px",
          borderBottom: "1px solid var(--color-border-tertiary)",
          flexShrink: 0,
        }}>
          <h2 style={{ flex: 1, margin: 0, fontSize: 15, fontWeight: 500, color: "var(--color-text-primary)" }}>
            {isNew ? "Nouvelle tâche" : "Détail de la tâche"}
          </h2>
          {saving && <Loader2 size={15} style={{ color: "var(--color-text-secondary)", animation: "spin 1s linear infinite" }} />}
          <button onClick={onClose} style={iconBtnStyle}>
            <X size={16} />
          </button>
        </div>

        {/* ── Corps ── */}
        <div style={{ flex: 1, padding: "20px", overflowY: "auto" }}>

          {/* Statut (boutons) */}
          {!isNew && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", gap: 6 }}>
                {STATUTS.map(s => {
                  const Icon = s.icon;
                  const active = statut === s.value;
                  return (
                    <button
                      key={s.value}
                      onClick={() => handleStatut(s.value)}
                      style={{
                        display: "flex", alignItems: "center", gap: 5,
                        padding: "5px 10px", fontSize: 12, fontWeight: active ? 600 : 400,
                        borderRadius: "var(--border-radius-md)", cursor: "pointer",
                        border: `1px solid ${active ? "var(--color-border-primary)" : "var(--color-border-tertiary)"}`,
                        background: active ? "var(--color-background-tertiary)" : "transparent",
                        color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                      }}
                    >
                      <Icon size={13} style={{ color: active ? "var(--color-text-info)" : undefined }} />
                      {s.label}
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
              onChange={e => { setTitre(e.target.value); markDirty(); }}
              placeholder="Nom de la tâche…"
              style={inputStyle}
              autoFocus={isNew}
            />
          </Field>

          {/* Description */}
          <Field label="Description">
            <textarea
              value={description}
              onChange={e => { setDescription(e.target.value); markDirty(); }}
              placeholder="Détails, contexte, lien vers un dossier…"
              rows={3}
              style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
            />
          </Field>

          {/* Ligne : Priorité + Type */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <Field label="Priorité">
              <select
                value={priorite}
                onChange={e => { setPriorite(e.target.value); markDirty(); }}
                style={inputStyle}
              >
                {PRIORITES.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Type">
              <select
                value={type_tache}
                onChange={e => { setTypeTache(e.target.value); markDirty(); }}
                style={inputStyle}
                disabled={!isNew && (tache?.type_tache === "workflow")}
              >
                {TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
                {!isNew && tache?.type_tache === "workflow" && (
                  <option value="workflow">Workflow (automatique)</option>
                )}
              </select>
            </Field>
          </div>

          {/* Échéance */}
          <Field label="Échéance">
            <input
              type="date"
              value={date_echeance}
              onChange={e => { setDateEch(e.target.value); markDirty(); }}
              style={inputStyle}
            />
          </Field>

          {/* Étiquettes */}
          <Field label="Étiquettes">
            <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
              {etiquettes.map(e => (
                <span key={e} style={{
                  display: "flex", alignItems: "center", gap: 4,
                  fontSize: 11, padding: "2px 7px",
                  background: "var(--color-background-info)",
                  color: "var(--color-text-info)",
                  borderRadius: 4,
                }}>
                  {e}
                  <button
                    onClick={() => { setEtiquettes(prev => prev.filter(t => t !== e)); markDirty(); }}
                    style={{ border: "none", background: "none", cursor: "pointer", padding: 0, display: "flex" }}
                  >
                    <X size={9} />
                  </button>
                </span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                value={etiquetteInput}
                onChange={e => setEtiqIn(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addEtiquette(); } }}
                placeholder="Ajouter une étiquette…"
                style={{ ...inputStyle, flex: 1, margin: 0 }}
              />
              <button onClick={addEtiquette} style={{
                padding: "6px 10px", fontSize: 12,
                background: "var(--color-background-tertiary)",
                border: "1px solid var(--color-border-secondary)",
                borderRadius: "var(--border-radius-md)", cursor: "pointer",
                color: "var(--color-text-secondary)",
              }}>
                +
              </button>
            </div>
          </Field>

          {/* Infos lecture seule (workflow) */}
          {tache?.wf_instance_id && (
            <div style={{
              marginTop: 8, padding: "10px 12px",
              background: "var(--color-background-secondary)",
              border: "1px solid var(--color-border-tertiary)",
              borderRadius: "var(--border-radius-md)",
              fontSize: 12, color: "var(--color-text-secondary)",
            }}>
              <span style={{ fontWeight: 500 }}>Tâche liée au workflow</span>
              <br />Instance : {tache.wf_instance_id.slice(0,8)}…
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{
          padding: "14px 20px",
          borderTop: "1px solid var(--color-border-tertiary)",
          display: "flex", gap: 8, alignItems: "center", flexShrink: 0,
        }}>
          {/* Supprimer */}
          {!isNew && onDelete && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "7px 12px", fontSize: 13,
                background: confirmDel ? "var(--color-background-danger)" : "transparent",
                color: confirmDel ? "var(--color-text-danger)" : "var(--color-text-secondary)",
                border: `1px solid ${confirmDel ? "var(--color-border-danger)" : "var(--color-border-tertiary)"}`,
                borderRadius: "var(--border-radius-md)", cursor: "pointer",
              }}
            >
              {deleting ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Trash2 size={13} />}
              {confirmDel ? "Confirmer ?" : "Supprimer"}
            </button>
          )}

          {confirmDel && (
            <button
              onClick={() => setConfirmDel(false)}
              style={{
                padding: "7px 10px", fontSize: 12,
                background: "transparent", border: "1px solid var(--color-border-tertiary)",
                borderRadius: "var(--border-radius-md)", cursor: "pointer",
                color: "var(--color-text-secondary)",
              }}
            >
              Annuler
            </button>
          )}

          <div style={{ flex: 1 }} />

          {/* Annuler */}
          <button onClick={onClose} style={{
            padding: "7px 14px", fontSize: 13,
            background: "transparent",
            border: "1px solid var(--color-border-tertiary)",
            borderRadius: "var(--border-radius-md)", cursor: "pointer",
            color: "var(--color-text-secondary)",
          }}>
            {dirty ? "Annuler" : "Fermer"}
          </button>

          {/* Sauvegarder */}
          <button
            onClick={handleSave}
            disabled={saving || !titre.trim() || (!dirty && !isNew)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "7px 16px", fontSize: 13, fontWeight: 500,
              background: "var(--color-text-primary)", color: "var(--color-background-primary)",
              border: "none", borderRadius: "var(--border-radius-md)",
              cursor: saving || !titre.trim() ? "not-allowed" : "pointer",
              opacity: !titre.trim() || (!dirty && !isNew) ? 0.5 : 1,
            }}
          >
            {saving
              ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
              : <Save size={14} />
            }
            {isNew ? "Créer" : "Enregistrer"}
          </button>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

// ─── Petits composants utilitaires ───────────────────────────

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{
        display: "block", fontSize: 12, fontWeight: 500,
        color: "var(--color-text-secondary)", marginBottom: 5,
      }}>
        {label}{required && <span style={{ color: "var(--color-text-danger)", marginLeft: 2 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "7px 10px", fontSize: 13,
  background: "var(--color-background-secondary)",
  border: "1px solid var(--color-border-tertiary)",
  borderRadius: "var(--border-radius-md)",
  color: "var(--color-text-primary)", outline: "none",
  boxSizing: "border-box",
};

const iconBtnStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center",
  width: 28, height: 28, border: "none", background: "transparent",
  borderRadius: "var(--border-radius-md)", cursor: "pointer",
  color: "var(--color-text-secondary)",
};
