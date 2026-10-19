/**
 * Liste.tsx — Liste déroulante des éditions, sur le composant Select du thème.
 * Auteur : Adil DAIA — 19/10/2026 — RG-EDT-UI-02
 *
 * RG-EDT-UI-02 (Adil DAIA) : aucune liste native (<select>) dans les éditions. Une liste native
 * s'ouvre avec le style du système d'exploitation (gris, police et arrondis du navigateur) et
 * ignore les préférences d'apparence ; celle-ci reprend le Select de l'application (couleurs,
 * arrondi, police, ombres du thème), comme les écrans de paie.
 *
 * Même usage qu'un <select> : `value` texte, `onChange(v)` reçoit "" pour le choix vide.
 */
import type { CSSProperties, ReactNode } from "react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const VIDE = "__vide__";                    // Radix n'accepte pas "" comme valeur d'option

export interface OptionListe {
  v: string;
  l: ReactNode;
  groupe?: string;                          // titre de groupe (équivalent d'un <optgroup>)
  style?: CSSProperties;                    // ex. aperçu d'une police
  titre?: string;                           // info-bulle
  desactivee?: boolean;
}

export default function Liste({
  value, onChange, options, vide, placeholder = "—", disabled, className, compact, title, style, "aria-label": ariaLabel, largeurMenu,
}: {
  value?: string | null;
  onChange: (v: string) => void;
  options: OptionListe[];
  /** libellé du choix vide (absent : pas de choix vide) */
  vide?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** hauteur réduite (designer, grilles) */
  compact?: boolean;
  title?: string;
  style?: CSSProperties;
  "aria-label"?: string;
  largeurMenu?: string;
}) {
  // une option de valeur "" (héritée d'un <select>) devient le choix vide
  const optionVide = options.find((o) => o.v === "");
  if (optionVide) { vide = vide ?? (typeof optionVide.l === "string" ? optionVide.l : "—"); options = options.filter((o) => o.v !== ""); }
  const valeur = value === undefined || value === null || value === "" ? (vide !== undefined ? VIDE : undefined) : String(value);
  const groupes: (string | undefined)[] = [];
  options.forEach((o) => { if (!groupes.includes(o.groupe)) groupes.push(o.groupe); });
  const item = (o: OptionListe) => (
    <SelectItem key={o.v} value={o.v} disabled={o.desactivee} style={o.style} title={o.titre}
      className={compact ? "py-1 text-xs" : undefined}>{o.l}</SelectItem>
  );
  return (
    <Select value={valeur} onValueChange={(v) => onChange(v === VIDE ? "" : v)} disabled={disabled}>
      <SelectTrigger title={title} aria-label={ariaLabel} style={style}
        className={cn(compact ? "h-8 px-2 text-xs" : "", "min-w-0", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className={cn("max-h-80", largeurMenu)}>
        {vide !== undefined && <SelectItem value={VIDE} className={cn("text-muted-foreground", compact ? "py-1 text-xs" : "")}>{vide}</SelectItem>}
        {groupes.length <= 1 && !groupes[0]
          ? options.map(item)
          : groupes.map((g) => (
            <SelectGroup key={g ?? "_"}>
              {g && <SelectLabel className="text-xs text-muted-foreground">{g}</SelectLabel>}
              {options.filter((o) => o.groupe === g).map(item)}
            </SelectGroup>
          ))}
      </SelectContent>
    </Select>
  );
}
