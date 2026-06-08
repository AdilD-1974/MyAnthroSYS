/**
 * DuplicateAlertModal.tsx
 * ──────────────────────────────────────────────────────────────────────────────
 * Popup d'alerte affiché lorsque des identifiants sont déjà attribués
 * à un autre collaborateur.
 *
 * L'utilisateur peut :
 *   - "Modifier ma saisie"  →  ferme le popup pour corriger
 *   - "Valider quand même"  →  force l'enregistrement (si toléré par les règles métier)
 */

import React from "react";
import { AlertTriangle, User, X, CheckCircle2, Edit3 } from "lucide-react";
import type { DuplicateEntry } from "./useIdentifiantsUnicity";

// ─── Props ────────────────────────────────────────────────────────────────────

interface DuplicateAlertModalProps {
  duplicates: DuplicateEntry[];
  onConfirm: () => void;   // "Valider quand même"
  onCancel: () => void;    // "Modifier ma saisie"
  /** Si false, l'utilisateur NE PEUT PAS forcer la validation */
  allowForce?: boolean;
}

// ─── Composant ────────────────────────────────────────────────────────────────

export const DuplicateAlertModal: React.FC<DuplicateAlertModalProps> = ({
  duplicates,
  onConfirm,
  onCancel,
  allowForce = true,
}) => {
  if (duplicates.length === 0) return null;

  const totalConflicts = duplicates.reduce(
    (acc, d) => acc + d.conflicting.length,
    0
  );

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }}
      onClick={onCancel}
    >
      {/* Panneau */}
      <div
        className="relative w-full max-w-lg mx-4 rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: "hsl(var(--background))" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div
          className="px-6 py-4 flex items-start gap-3"
          style={{ background: "hsl(38 95% 55% / 0.12)", borderBottom: "1px solid hsl(38 95% 55% / 0.25)" }}
        >
          <div
            className="p-2 rounded-xl flex-shrink-0"
            style={{ background: "hsl(38 95% 55% / 0.2)" }}
          >
            <AlertTriangle size={22} style={{ color: "hsl(38 95% 40%)" }} />
          </div>
          <div className="flex-1">
            <h2 className="font-bold text-base" style={{ color: "hsl(38 95% 30%)" }}>
              Identifiant(s) déjà attribué(s)
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "hsl(38 95% 40%)" }}>
              {duplicates.length} champ{duplicates.length > 1 ? "s" : ""} en doublon
              avec {totalConflicts} collaborateur{totalConflicts > 1 ? "s" : ""} existant{totalConflicts > 1 ? "s" : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 mt-0.5"
          >
            <X size={16} />
          </button>
        </div>

        {/* Corps : liste des doublons */}
        <div className="px-6 py-4 space-y-4 max-h-72 overflow-y-auto">
          {duplicates.map((dup, idx) => (
            <div key={idx}>
              {/* Champ concerné */}
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
                  style={{
                    background: "hsl(var(--destructive) / 0.1)",
                    color: "hsl(var(--destructive))",
                  }}
                >
                  {dup.field}
                </span>
                <span
                  className="font-mono text-xs px-2 py-0.5 rounded"
                  style={{
                    background: "hsl(var(--muted))",
                    color: "hsl(var(--muted-foreground))",
                  }}
                >
                  {dup.value}
                </span>
              </div>

              {/* Collaborateurs en conflit */}
              <div className="space-y-1.5 pl-2 border-l-2" style={{ borderColor: "hsl(var(--destructive) / 0.3)" }}>
                {dup.conflicting.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-2 p-2 rounded-lg"
                    style={{ background: "hsl(var(--muted) / 0.5)" }}
                  >
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold"
                      style={{ background: "hsl(var(--primary) / 0.15)", color: "hsl(var(--primary))" }}
                    >
                      {c.prenom[0]}{c.nom[0]}
                    </div>
                    <div>
                      <p className="text-xs font-semibold leading-tight">
                        {c.prenom} {c.nom}
                      </p>
                      <p className="text-[10px] text-muted-foreground">#{c.matricule}</p>
                    </div>
                    <User size={12} className="ml-auto text-muted-foreground" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Avertissement */}
        <div
          className="mx-6 mb-4 px-3 py-2 rounded-lg text-xs"
          style={{
            background: "hsl(var(--destructive) / 0.06)",
            color: "hsl(var(--destructive))",
            border: "1px solid hsl(var(--destructive) / 0.2)",
          }}
        >
          <strong>Attention :</strong> attribuer le même identifiant à plusieurs collaborateurs
          peut provoquer des incohérences dans la paie, les déclarations sociales et la gestion RH.
        </div>

        {/* Boutons d'action */}
        <div
          className="px-6 py-4 flex justify-end gap-3"
          style={{ borderTop: "1px solid hsl(var(--border))" }}
        >
          {/* Modifier la saisie (action principale recommandée) */}
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
            style={{
              background: "hsl(var(--primary))",
              color: "white",
              boxShadow: "0 2px 8px hsl(var(--primary) / 0.3)",
            }}
          >
            <Edit3 size={14} />
            Modifier ma saisie
          </button>

          {/* Forcer la validation (optionnel selon règles métier) */}
          {allowForce && (
            <button
              type="button"
              onClick={onConfirm}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all border"
              style={{
                borderColor: "hsl(var(--border))",
                color: "hsl(var(--muted-foreground))",
              }}
            >
              <CheckCircle2 size={14} />
              Valider quand même
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
