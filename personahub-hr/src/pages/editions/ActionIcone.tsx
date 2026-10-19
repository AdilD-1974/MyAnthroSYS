/**
 * ActionIcone.tsx — Bouton d'action en icône, coloré comme dans le reste de l'application.
 * Auteur : Adil DAIA — 19/10/2026 — RG-EDT-UI-03
 *
 * RG-EDT-UI-03 (Adil DAIA) : les actions des éditions suivent la convention des listes de
 * l'application (rubriques de paie…) : icône seule sur fond transparent, survol « muted », et une
 * couleur par nature d'action, toujours tirée des préférences d'apparence (variables du thème) :
 *   lancer → succès · voir / concevoir → accent · copier → info · classement → principale
 *   archiver → texte atténué · désarchiver → avertissement · supprimer → danger
 */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export const COULEURS_ACTIONS = {
  lancer: "hsl(var(--success))",
  voir: "hsl(var(--accent))",
  copier: "hsl(var(--info))",
  classement: "hsl(var(--primary))",
  archiver: "hsl(var(--muted-foreground))",
  desarchiver: "hsl(var(--warning))",
  supprimer: "hsl(var(--destructive))",
} as const;
export type NatureAction = keyof typeof COULEURS_ACTIONS;

export default function ActionIcone({ icone: Icone, nature, titre, onClick, disabled, libelle, taille = 15, className }: {
  icone: LucideIcon;
  nature: NatureAction;
  titre: string;
  onClick: () => void;
  disabled?: boolean;
  /** texte à côté de l'icône (vue en cartes) ; absent : icône seule */
  libelle?: ReactNode;
  taille?: number;
  className?: string;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={titre} aria-label={titre}
      className={cn("inline-flex items-center gap-1 rounded p-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent", libelle ? "px-2" : "", className)}>
      <Icone size={taille} style={{ color: disabled ? "hsl(var(--muted-foreground))" : COULEURS_ACTIONS[nature] }} />
      {libelle}
    </button>
  );
}
