// ============================================================
// SelecteurSociete.tsx — src/components/SelecteurSociete.tsx
// ------------------------------------------------------------
// Sélecteur de société active (RG-05, multi-société façon Odoo), même
// patron visuel que SelecteurEspace.tsx (relief 3D, dropdown, mêmes
// classes/transitions) — pour rester cohérent dans la barre du haut.
//
// Différence assumée avec SelecteurEspace : pas de couleur par société.
// Les rôles ont une palette fixe dans le code (ROLE_COULEUR) parce que
// l'ensemble des rôles est fermé et connu à l'avance ; les sociétés sont
// dynamiques (table `societes`, rien dans son schéma ne porte de couleur
// de marque) — un mapping en dur serait arbitraire. Teinte neutre du
// thème à la place (--secondary), stable quelle que soit la société.
// ============================================================
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ChevronDown, Building2 } from "lucide-react";

export default function SelecteurSociete({
  className = "",
}: {
  className?: string;
}) {
  const { societes, societeActive, switchSociete } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Défensif : si le contexte n'expose pas encore ces champs (AuthContext.tsx
  // pas à jour, ou hydratation en cours), ne jamais planter tout l'arbre React
  // pour un simple sélecteur — se masquer silencieusement à la place.
  const listeSocietes = societes ?? [];
  const multi = listeSocietes.length > 1;
  const codeActif = societeActive?.code_societe || "";
  const libelleActif = societeActive?.nom_commercial || societeActive?.raison_sociale || "";

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

  const choisir = async (societeId: string) => {
    if (societeId === societeActive?.id) { setOpen(false); return; }
    setEnCours(true);
    try {
      await switchSociete(societeId);
      setOpen(false);
      // Navigation vers /dashboard après bascule : force un remontage des
      // écrans dépendant de la société active, même principe que
      // SelecteurEspace.choisir(). Un écran de détail déjà ouvert sur une
      // ressource de l'ancienne société devra gérer son propre refetch —
      // non traité ici, hors périmètre de ce composant.
      navigate("/dashboard");
    } catch {
      // Bascule refusée côté backend (société non accessible) ou erreur
      // réseau — le dropdown reste ouvert, aucune société n'a changé.
    } finally {
      setEnCours(false);
    }
  };

  // Même esthétique relief 3D que SelecteurEspace, teinte neutre du thème
  // au lieu d'une couleur par société. `--muted`/`--muted-foreground` choisis
  // plutôt que `--secondary` car ce sont les variables confirmées comme
  // définies dans le thème (--primary, --card, --border, --muted,
  // --foreground) — `--secondary` n'a pas été vérifiée, pas de pari dessus.
  const btn3D: React.CSSProperties = {
    background: `linear-gradient(180deg, rgba(255,255,255,0.32) 0%, rgba(255,255,255,0.04) 42%, rgba(0,0,0,0.24) 100%), hsl(var(--muted))`,
    color: "hsl(var(--foreground))",
    borderRadius: 11,
    border: "1px solid rgba(0,0,0,0.28)",
    boxShadow: open
      ? "inset 0 2px 5px rgba(0,0,0,0.42), 0 1px 2px rgba(0,0,0,0.30)"
      : "inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -3px 6px rgba(0,0,0,0.28), 0 6px 12px rgba(0,0,0,0.42), 0 2px 4px rgba(0,0,0,0.30)",
    transform: open ? "translateY(1px)" : "translateY(0)",
    transition: "transform .12s ease, box-shadow .12s ease",
    cursor: multi ? "pointer" : "default",
    opacity: enCours ? 0.6 : 1,
  };

  if (!societeActive) return null;

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={!multi || enCours}
        onClick={() => multi && setOpen((o) => !o)}
        style={btn3D}
        className="w-full flex items-center gap-2 px-3 py-1.5 select-none"
        title={libelleActif}
      >
        <Building2 size={13} className="flex-shrink-0 opacity-80" />
        <span className="flex-1 min-w-0 flex flex-col items-start leading-tight">
          {codeActif && (
            <span className="text-xs font-bold tracking-wide truncate w-full text-left">{codeActif}</span>
          )}
          <span className="text-[10.5px] opacity-75 truncate w-full text-left font-medium">{libelleActif}</span>
        </span>
        {multi && (
          <ChevronDown
            size={14}
            className="flex-shrink-0"
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
          {listeSocietes.map((s) => {
            const actif = s.id === societeActive.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => choisir(s.id)}
                disabled={enCours}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors"
                style={{
                  color: actif ? "#ffffff" : "rgba(255,255,255,0.85)",
                  background: actif ? "rgba(255,255,255,0.12)" : "transparent",
                }}
                onMouseEnter={(e) => { if (!actif) e.currentTarget.style.background = "rgba(255,255,255,0.07)"; }}
                onMouseLeave={(e) => { if (!actif) e.currentTarget.style.background = "transparent"; }}
              >
                <Building2 size={12} className="flex-shrink-0 opacity-70" />
                <span className="flex-1 min-w-0 flex flex-col items-start leading-tight">
                  {s.code_societe && (
                    <span className="text-xs truncate w-full text-left" style={{ fontWeight: actif ? 700 : 600 }}>
                      {s.code_societe}
                    </span>
                  )}
                  <span className="text-[10.5px] opacity-75 truncate w-full text-left" style={{ fontWeight: actif ? 600 : 400 }}>
                    {s.nom_commercial || s.raison_sociale}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
