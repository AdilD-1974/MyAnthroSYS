// ============================================================
// BrandingMark.tsx — src/components/BrandingMark.tsx
// ------------------------------------------------------------
// Affiche le LOGO CLIENT (titulaire de la licence) de manière
// TRANSPARENTE et ANIMÉE. Lit la marque enregistrée (branding.ts),
// disponible même hors connexion (stockée dans le navigateur), et
// se met à jour en direct via l'événement "branding:change".
//
// Deux usages :
//   • variant="watermark" (défaut) → grand filigrane discret, qui
//     apparaît en fondu puis flotte doucement. Idéal en fond du
//     panneau de marque de la page de connexion.
//   • variant="cobrand" → petit logo (option : nom), pour afficher
//     « propulsé pour [client] » à côté du logo ANTHRO-SYS.
//
// Exemples :
//   <BrandingMark className="absolute inset-0 m-auto" />
//   <BrandingMark variant="watermark" opacity={0.12} maxWidth={420}
//                 className="pointer-events-none absolute right-6 bottom-6" />
//   <BrandingMark variant="cobrand" showName maxWidth={120} />
// ============================================================
import React, { useEffect, useState } from "react";
import { getBranding, type Branding } from "@/lib/branding";

type Animation = "float" | "pulse" | "fade" | "drift" | "none";

interface Props {
  variant?: "watermark" | "cobrand";
  className?: string;
  maxWidth?: number;   // largeur max du logo en px
  opacity?: number;    // 0 → 1
  animation?: Animation;
  showName?: boolean;  // afficher le nom de l'entreprise (cobrand)
}

// Keyframes injectées une seule fois (animations nommées bm-*).
const KEYFRAMES = `
@keyframes bm-fade { from { opacity: 0; } to { opacity: var(--bm-op, 1); } }
@keyframes bm-float {
  0%   { transform: translateY(0) rotate(0deg); }
  50%  { transform: translateY(-12px) rotate(-0.6deg); }
  100% { transform: translateY(0) rotate(0deg); }
}
@keyframes bm-pulse {
  0%, 100% { opacity: calc(var(--bm-op, 1) * 0.65); transform: scale(1); }
  50%      { opacity: var(--bm-op, 1);             transform: scale(1.03); }
}
@keyframes bm-drift {
  0%   { transform: translate(2vw, 6vh)  rotate(0deg)  scale(1); }
  20%  { transform: translate(60vw, 4vh) rotate(3deg)  scale(1.05); }
  40%  { transform: translate(66vw, 52vh) rotate(-2deg) scale(1); }
  60%  { transform: translate(30vw, 64vh) rotate(2deg)  scale(1.06); }
  80%  { transform: translate(4vw, 46vh) rotate(-3deg) scale(1); }
  100% { transform: translate(2vw, 6vh)  rotate(0deg)  scale(1); }
}`;

let keyframesInjectees = false;
function useKeyframes() {
  useEffect(() => {
    if (keyframesInjectees) return;
    const tag = document.createElement("style");
    tag.setAttribute("data-branding-mark", "");
    tag.textContent = KEYFRAMES;
    document.head.appendChild(tag);
    keyframesInjectees = true;
  }, []);
}

export default function BrandingMark({
  variant = "watermark",
  className = "",
  maxWidth = variant === "cobrand" ? 120 : 360,
  opacity = variant === "cobrand" ? 0.9 : 0.14,
  animation = "float",
  showName = false,
}: Props) {
  useKeyframes();
  const [b, setB] = useState<Branding>(getBranding());
  useEffect(() => {
    const maj = () => setB(getBranding());
    window.addEventListener("branding:change", maj);
    return () => window.removeEventListener("branding:change", maj);
  }, []);

  if (!b.logoDataUrl) return null;

  // Le fondu d'entrée s'applique au conteneur ; le flottement/pulse au logo,
  // pour pouvoir combiner « apparition » + « mouvement continu ».
  const animLogo =
    animation === "float" ? "bm-float 6s ease-in-out infinite"
    : animation === "pulse" ? "bm-pulse 4.5s ease-in-out infinite"
    : animation === "drift" ? "bm-drift 34s ease-in-out infinite"
    : undefined;

  return (
    <div
      className={className}
      style={{
        // variable CSS utilisée par les keyframes pour viser la bonne opacité
        ["--bm-op" as any]: opacity,
        opacity,
        animation: animation === "none" ? undefined : "bm-fade 1.2s ease-out both",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
      }}
      aria-hidden={variant === "watermark"}
    >
      <img
        src={b.logoDataUrl}
        alt={b.clientName || "Logo client"}
        draggable={false}
        style={{
          maxWidth,
          width: "100%",
          height: "auto",
          objectFit: "contain",
          animation: animLogo,
          filter: undefined, // couleurs réelles du logo (aucune désaturation)
          userSelect: "none",
        }}
      />
      {showName && b.clientName && (
        <span
          style={{
            fontSize: variant === "cobrand" ? 12 : 14,
            fontWeight: 600,
            letterSpacing: "0.02em",
            color: "currentColor",
            opacity: 0.85,
          }}
        >
          {b.clientName}
        </span>
      )}
    </div>
  );
}
