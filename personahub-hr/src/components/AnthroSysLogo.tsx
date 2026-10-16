// ============================================================
// AnthroSysLogo.tsx — src/components/AnthroSysLogo.tsx
// ------------------------------------------------------------
// Utilise l'EMBLÈME réel ANTHRO-SYS (/logo-mark.png, PNG
// transparent) + le mot "ANTHRO-SYS" en texte, pour rester
// lisible sur la sidebar bleu nuit (le wordmark du PNG d'origine
// est bleu marine → illisible sur fond sombre).
//   • variant="full" : emblème + sur-titre + "ANTHRO-SYS"
//   • variant="mark" : emblème seul (sidebar repliée)
//
// Prérequis : copier logo-mark.png (et logo-full.png) dans /public.
// "ANTHRO" suit currentColor (clair sur sombre) ; "SYS" en teal.
// ============================================================

import React from "react";

interface Props {
  variant?: "full" | "mark";
  className?: string;
  title?: string;
}

const TEAL = "#1DCFCF";

function Embleme({ size = 28 }: { size?: number }) {
  return (
    <img
      src="/logo-mark.png"
      alt=""
      aria-hidden="true"
      style={{ height: size, width: "auto" }}
      className="object-contain shrink-0 select-none"
      draggable={false}
    />
  );
}

export default function AnthroSysLogo({ variant = "full", className, title = "ANTHRO-SYS" }: Props) {
  if (variant === "mark") {
    return (
      <span className={className} role="img" aria-label={title}>
        <Embleme size={28} />
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`} role="img" aria-label={title}>
      <Embleme size={30} />
      <span className="flex flex-col leading-none">
        <span className="uppercase opacity-60" style={{ fontSize: 6.5, letterSpacing: "1.5px", fontWeight: 600 }}>
          Système d'information RH
        </span>
        <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: "0.3px" }}>
          ANTHRO<span style={{ color: TEAL }}>-SYS</span>
        </span>
      </span>
    </span>
  );
}
