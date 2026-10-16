// ============================================================
// NavMenuItem.tsx — src/components/nav/NavMenuItem.tsx
// Élément de menu récursif : gère un nombre illimité de niveaux
// de sous-menus. Niveau 0 = barre horizontale (ouverture vers le
// bas). Niveaux > 0 = flyout vers la droite (comme un menu OS).
// ============================================================

import { useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { cn } from "@/lib/utils";
import type { NavItemArbre } from "@/lib/navTree";

interface NavMenuItemProps {
  item: NavItemArbre;
  /** 0 = item de la barre principale, 1+ = sous-niveaux imbriqués */
  niveau?: number;
  /** Ferme tout le menu (propagé depuis la racine au clic sur une feuille) */
  onNavigate?: () => void;
}

export function NavMenuItem({ item, niveau = 0, onNavigate }: NavMenuItemProps) {
  const [ouvert, setOuvert] = useState(false);
  const fermetureTimer = useRef<ReturnType<typeof setTimeout>>();

  const aDesEnfants = item.enfants.length > 0;

  const ouvrir = () => {
    clearTimeout(fermetureTimer.current);
    setOuvert(true);
  };

  const fermer = () => {
    // petit délai pour laisser la souris traverser vers le sous-menu
    fermetureTimer.current = setTimeout(() => setOuvert(false), 150);
  };

  const contenuDeclencheur = aDesEnfants ? (
    <button
      type="button"
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-sm",
        "text-foreground/80 hover:bg-muted hover:text-foreground",
        ouvert && "bg-muted text-foreground",
      )}
      onClick={() => setOuvert((v) => !v)} // support tactile / clic
      aria-expanded={ouvert}
      aria-haspopup="menu"
    >
      <span>{item.label}</span>
      <ChevronRight
        className={cn(
          "h-3.5 w-3.5 shrink-0 transition-transform",
          niveau === 0 && "rotate-90", // pointe vers le bas au niveau racine
        )}
      />
    </button>
  ) : (
    <NavLink
      to={item.chemin ?? "#"}
      className="flex w-full items-center rounded-md px-3 py-2 text-sm text-foreground/80 hover:bg-muted hover:text-foreground"
      activeClassName="bg-muted text-primary font-medium"
      onClick={onNavigate}
    >
      {item.label}
    </NavLink>
  );

  return (
    <div className="relative" onMouseEnter={ouvrir} onMouseLeave={fermer}>
      {contenuDeclencheur}

      {aDesEnfants && ouvert && (
        <div
          role="menu"
          className={cn(
            "absolute z-50 min-w-[220px] rounded-md border bg-popover p-1 shadow-md",
            niveau === 0
              ? "left-0 top-full mt-1"      // niveau 0 : tombe sous le bouton
              : "left-full top-0 ml-1",     // niveaux suivants : flyout à droite
          )}
        >
          {item.enfants.map((enfant) => (
            <NavMenuItem key={enfant.id} item={enfant} niveau={niveau + 1} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  );
}
