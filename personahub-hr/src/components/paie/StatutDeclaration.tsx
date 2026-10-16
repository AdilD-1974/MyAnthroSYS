/**
 * StatutDeclaration — badge + sélecteur pour le cycle de vie d'une déclaration
 * sociale (CNSS, CIMR, et tout futur type). Source unique de vérité pour les
 * libellés/couleurs/ordre des statuts, pour rester cohérent entre les écrans.
 */
import React, { useState } from "react";
import { Circle, CheckCircle2, FileCheck2, Send, BadgeCheck, Archive, ChevronDown } from "lucide-react";

export type CodeStatutDeclaration = "BROUILLON" | "VALIDE" | "GENEREE" | "TRANSMISE" | "TRAITEE" | "ARCHIVEE";

export interface StatutDef {
  code: CodeStatutDeclaration;
  label: string;
  ordre: number;
  color: string;
  bg: string;
  icon: React.ReactNode;
}

export const STATUTS_DECLARATION: StatutDef[] = [
  { code: "BROUILLON", label: "Brouillon", ordre: 0, color: "hsl(var(--muted-foreground))", bg: "hsl(var(--muted))", icon: <Circle size={11} /> },
  { code: "VALIDE", label: "Validé", ordre: 1, color: "hsl(var(--accent))", bg: "hsl(var(--accent) / 0.12)", icon: <CheckCircle2 size={11} /> },
  { code: "GENEREE", label: "Généré", ordre: 2, color: "hsl(var(--primary))", bg: "hsl(var(--primary) / 0.12)", icon: <FileCheck2 size={11} /> },
  { code: "TRANSMISE", label: "Transmis", ordre: 3, color: "hsl(var(--warning))", bg: "hsl(var(--warning) / 0.14)", icon: <Send size={11} /> },
  { code: "TRAITEE", label: "Traité", ordre: 4, color: "hsl(var(--success))", bg: "hsl(var(--success) / 0.12)", icon: <BadgeCheck size={11} /> },
  { code: "ARCHIVEE", label: "Archivé", ordre: 5, color: "hsl(var(--muted-foreground))", bg: "hsl(var(--muted))", icon: <Archive size={11} /> },
];

export const getStatutDef = (code: string | null | undefined): StatutDef => {
  // Alias legacy : les déclarations CNSS créées avant l'introduction de ce
  // composant utilisent "CONTROLEE" — traité comme équivalent visuel de "VALIDE".
  const codeNormalise = code === "CONTROLEE" ? "VALIDE" : code;
  return STATUTS_DECLARATION.find(s => s.code === codeNormalise) || STATUTS_DECLARATION[0];
};

// ─── Badge simple (lecture seule) ───────────────────────────────────────
export const StatutBadge: React.FC<{ code: string | null | undefined; size?: "sm" | "md" }> = ({ code, size = "sm" }) => {
  const def = getStatutDef(code);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold ${size === "sm" ? "text-[11px] px-2 py-0.5" : "text-xs px-2.5 py-1"}`}
      style={{ background: def.bg, color: def.color }}
    >
      {def.icon} {def.label}
    </span>
  );
};

// ─── Sélecteur (changement manuel, avec confirmation si on recule) ──────
export const StatutSelector: React.FC<{
  code: string | null | undefined;
  onChange: (nouveauCode: CodeStatutDeclaration) => void | Promise<void>;
  disabled?: boolean;
}> = ({ code, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const actuel = getStatutDef(code);

  const choisir = (def: StatutDef) => {
    setOpen(false);
    if (def.code === actuel.code) return;
    if (def.ordre < actuel.ordre) {
      const ok = confirm(`Revenir au statut "${def.label}" alors que la déclaration est déjà "${actuel.label}" ? Cette action est inhabituelle.`);
      if (!ok) return;
    }
    onChange(def.code);
  };

  return (
    <div className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 rounded-full text-[11px] px-2 py-0.5 font-semibold disabled:opacity-50"
        style={{ background: actuel.bg, color: actuel.color }}
      >
        {actuel.icon} {actuel.label} <ChevronDown size={11} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 mt-1 rounded-lg border shadow-lg py-1 min-w-[160px]"
            style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))" }}>
            {STATUTS_DECLARATION.map(def => (
              <button
                key={def.code}
                onClick={() => choisir(def)}
                className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-xs hover:bg-muted"
                style={def.code === actuel.code ? { fontWeight: 700 } : undefined}
              >
                <span style={{ color: def.color }}>{def.icon}</span> {def.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// ─── Timeline horizontale (pour le tableau de bord) ─────────────────────
export const StatutTimeline: React.FC<{ code: string | null | undefined }> = ({ code }) => {
  const actuel = getStatutDef(code);
  const etapes = STATUTS_DECLARATION.filter(s => s.code !== "ARCHIVEE");
  return (
    <div className="flex items-center">
      {etapes.map((def, i) => {
        const atteint = actuel.code === "ARCHIVEE" ? true : def.ordre <= actuel.ordre;
        return (
          <React.Fragment key={def.code}>
            <div className="flex flex-col items-center gap-1">
              <div className="w-6 h-6 rounded-full flex items-center justify-center"
                style={{ background: atteint ? def.bg : "hsl(var(--muted))", color: atteint ? def.color : "hsl(var(--muted-foreground))" }}>
                {def.icon}
              </div>
              <span className="text-[9px] whitespace-nowrap" style={{ color: atteint ? def.color : "hsl(var(--muted-foreground))" }}>{def.label}</span>
            </div>
            {i < etapes.length - 1 && (
              <div className="h-0.5 flex-1 mx-1 mb-4" style={{ background: def.ordre < actuel.ordre ? def.color : "hsl(var(--border))" }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};
