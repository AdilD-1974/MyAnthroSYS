/**
 * retour.ts — Retour à l'écran appelant dans les éditions (RG-EDT-NAV-01, Adil DAIA, 19/10/2026).
 *
 * Quand les éditions (bibliothèque, designer) sont ouvertes depuis un autre écran (menu
 * Éditions de la paie, administration…), on revient sur CET écran, avec son contexte.
 * S'appuie sur la pile de retour commune de l'application (components/navigation/ReturnTrail).
 */
import { useLocation, useNavigate } from "react-router-dom";
import { buildTrail, type TrailCrumb } from "@/components/navigation/ReturnTrail";

export function useRetour() {
  const location = useLocation();
  const navigate = useNavigate();
  const pile = ((location.state as { returnTo?: TrailCrumb[] } | null)?.returnTo) ?? [];

  /** Ouvre `chemin` en empilant l'écran courant (libellé `ici`) : le retour y ramènera. */
  const ouvrir = (chemin: string, ici: string, etatIci?: Record<string, unknown>) =>
    navigate(chemin, { state: { returnTo: buildTrail({ path: location.pathname + location.search, label: ici, state: etatIci }, pile) } });

  /** Navigation interne à l'écran (remplacement d'URL) sans perdre la pile de retour. */
  const remplacer = (chemin: string) => navigate(chemin, { replace: true, state: location.state });

  /** Retour à l'écran appelant, sinon à `defaut`. */
  const revenir = (defaut: string) => {
    if (!pile.length) { navigate(defaut); return; }
    const dernier = pile[pile.length - 1];
    const amont = pile.slice(0, -1);
    navigate(dernier.path, { state: { ...(dernier.state ?? {}), ...(amont.length ? { returnTo: amont } : {}) } });
  };

  return { pile, origine: pile.length ? pile[pile.length - 1].label : null, ouvrir, remplacer, revenir };
}
