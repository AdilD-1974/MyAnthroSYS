/**
 * ReturnTrail — Fil d'Ariane de retour (navigation contextuelle façon Odoo).
 * Auteur : Adil DAIA
 *
 * S'affiche en haut d'un écran ouvert « en drill-down » depuis un autre écran.
 * Lit la pile de retour transmise via l'état de navigation (location.state.returnTo)
 * et permet de revenir à l'écran d'origine EN RESTAURANT son contexte.
 *
 * Usage :
 *   // écran d'origine — au double-clic sur un enregistrement :
 *   navigate("/collaborateurs/" + id, { state: { returnTo: [
 *     { path: "/paie/traitement/calcul", label: "Traitement de la paie",
 *       state: { restore: { collabId, periodeId } } },
 *   ] } });
 *
 *   // écran cible — tout en haut du rendu :
 *   <ReturnTrail current="Fiche collaborateur" />
 *
 * La pile est chaînable : un écran cible qui ouvre lui-même un autre écran
 * ajoute un maillon (voir buildTrail plus bas), exactement comme le fil
 * d'Ariane d'Odoo.
 */
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronRight, CornerUpLeft } from "lucide-react";

export interface TrailCrumb {
  path: string;
  label: string;
  /** État à réinjecter à l'écran d'origine (ex. { restore: {...} }). */
  state?: Record<string, unknown>;
}

/**
 * Construit la pile de retour à transmettre lors d'une navigation drill-down.
 * Empile le nouveau maillon au-dessus de la pile courante (chaînage Odoo).
 */
export function buildTrail(current: TrailCrumb, existing?: unknown): TrailCrumb[] {
  const prev = Array.isArray(existing) ? (existing as TrailCrumb[]) : [];
  return [...prev, current];
}

export function ReturnTrail({ current }: { current?: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const trail = (location.state as any)?.returnTo as TrailCrumb[] | undefined;

  if (!trail || trail.length === 0) return null;

  const go = (index: number) => {
    const crumb = trail[index];
    const upstream = trail.slice(0, index); // maillons au-dessus (retour en cascade)
    navigate(crumb.path, {
      state: { ...(crumb.state ?? {}), ...(upstream.length ? { returnTo: upstream } : {}) },
    });
  };

  return (
    <nav className="flex items-center gap-1.5 text-sm px-6 pt-4 flex-wrap" aria-label="Fil d'Ariane">
      <button
        onClick={() => go(trail.length - 1)}
        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        title="Revenir à l'écran précédent"
      >
        <CornerUpLeft className="h-3.5 w-3.5" />
      </button>
      {trail.map((c, i) => (
        <React.Fragment key={i}>
          <button onClick={() => go(i)} className="text-primary hover:underline font-medium">
            {c.label}
          </button>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        </React.Fragment>
      ))}
      {current && <span className="text-muted-foreground">{current}</span>}
    </nav>
  );
}

export default ReturnTrail;
