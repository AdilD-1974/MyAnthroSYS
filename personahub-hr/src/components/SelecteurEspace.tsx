// ============================================================
// SelecteurEspace.tsx — src/components/SelecteurEspace.tsx
// ------------------------------------------------------------
// Sélecteur d'espace (rôle) en relief 3D, autonome.
// Le bouton prend AUTOMATIQUEMENT la couleur de l'espace actif
// (mêmes couleurs que les bandeaux du dashboard). Le reflet/relief
// 3D est superposé par-dessus, donc l'effet fonctionne quelle que
// soit la couleur. Réutilisable partout (bandeau, sidebar…).
// ============================================================
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ChevronDown } from "lucide-react";

const LABEL_ROLE: Record<string, string> = {
  administrateur: "Administrateur",
  gestionnaire_rh: "Gestionnaire RH",
  gestionnaire_paie: "Gestionnaire Paie",
  manager: "Manager",
  collaborateur: "Collaborateur",
};
const libelleRole = (r?: string | null) => (r && LABEL_ROLE[r]) || (r ?? "");

// Couleur d'espace par rôle — alignée sur roleBanners du Dashboard.
const ROLE_COULEUR: Record<string, string> = {
  administrateur: "hsl(var(--primary))",
  gestionnaire_rh: "hsl(197 100% 42%)",
  gestionnaire_paie: "hsl(84 55% 45%)",
  manager: "hsl(39 95% 50%)",
  collaborateur: "hsl(280 60% 55%)",
};
const couleurEspace = (r?: string | null) => (r && ROLE_COULEUR[r]) || "hsl(var(--primary))";
// Rôles à fond clair -> texte foncé (meilleure lisibilité).
const ROLE_TEXTE_FONCE = new Set(["manager", "gestionnaire_paie"]);

export default function SelecteurEspace({
  className = "",
  couleur,
}: {
  className?: string;
  /** Force une couleur (sinon = couleur de l'espace actif). */
  couleur?: string;
}) {
  const { activeRole, allRoles, switchRole } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const roleActif = activeRole ?? allRoles[0] ?? "collaborateur";
  const multi = allRoles.length > 1;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const choisir = (r: string) => {
    switchRole(r as typeof activeRole);
    setOpen(false);
    navigate("/dashboard");
  };

  const base = couleur ?? couleurEspace(roleActif);
  const texteFonce = !couleur && ROLE_TEXTE_FONCE.has(roleActif);
  const couleurTexte = texteFonce ? "#231700" : "#ffffff";
  const ombreTexte = texteFonce
    ? "0 1px 0 rgba(255,255,255,0.40)"
    : "0 1px 2px rgba(0,0,0,0.40)";

  // Reflet 3D superposé à la couleur d'espace (clair en haut, sombre en bas).
  const btn3D: React.CSSProperties = {
    background: `linear-gradient(180deg, rgba(255,255,255,0.32) 0%, rgba(255,255,255,0.04) 42%, rgba(0,0,0,0.24) 100%), ${base}`,
    color: couleurTexte,
    borderRadius: 11,
    border: "1px solid rgba(0,0,0,0.28)",
    boxShadow: open
      ? "inset 0 2px 5px rgba(0,0,0,0.42), 0 1px 2px rgba(0,0,0,0.30)"
      : "inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -3px 6px rgba(0,0,0,0.28), 0 6px 12px rgba(0,0,0,0.42), 0 2px 4px rgba(0,0,0,0.30)",
    transform: open ? "translateY(1px)" : "translateY(0)",
    transition: "transform .12s ease, box-shadow .12s ease",
    cursor: multi ? "pointer" : "default",
  };

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={!multi}
        onClick={() => multi && setOpen((o) => !o)}
        style={btn3D}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold select-none"
      >
        <span className="flex-1 text-left truncate" style={{ textShadow: ombreTexte }}>
          {libelleRole(roleActif)}
        </span>
        {multi && (
          <ChevronDown
            size={14}
            style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s ease" }}
          />
        )}
      </button>

      {open && multi && (
        <div
          className="absolute left-0 right-0 mt-1.5 z-50 p-1 rounded-xl"
          style={{
            background: "linear-gradient(180deg, #15496B 0%, #0E3D5C 100%)",
            border: "1px solid rgba(255,255,255,0.10)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.12), 0 16px 30px rgba(0,0,0,0.55), 0 5px 10px rgba(0,0,0,0.40)",
          }}
        >
          {allRoles.map((r) => {
            const actif = r === roleActif;
            return (
              <button
                key={r}
                type="button"
                onClick={() => choisir(r)}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-left transition-colors"
                style={{
                  color: actif ? "#ffffff" : "rgba(255,255,255,0.85)",
                  background: actif ? "rgba(255,255,255,0.12)" : "transparent",
                  fontWeight: actif ? 700 : 500,
                }}
                onMouseEnter={(e) => { if (!actif) e.currentTarget.style.background = "rgba(255,255,255,0.07)"; }}
                onMouseLeave={(e) => { if (!actif) e.currentTarget.style.background = "transparent"; }}
              >
                {/* pastille = couleur de l'espace, aperçu pour chaque rôle */}
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ background: couleurEspace(r), border: "1px solid rgba(255,255,255,0.35)" }}
                />
                <span className="flex-1 truncate">{libelleRole(r)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
