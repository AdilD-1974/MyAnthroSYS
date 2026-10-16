/**
 * src/components/paie/simulation/EnTeteTriable.tsx
 *
 * Reconstruit sur le pattern RÉEL `SortHead` trouvé dans TraitementPaiePage.tsx :
 * <TableHead> shadcn/ui (pas un <th> brut), ChevronUp/ChevronDown/ChevronsUpDown
 * (pas ArrowUp/ArrowDown/ArrowUpDown), classes Tailwind sémantiques
 * (text-foreground, hover:text-foreground) — aucun style inline.
 */
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import type { SensTri } from "@/hooks/useSortableTable";

interface EnTeteTriableProps {
  label: string;
  cle: string;
  triActif: { cle: string; sens: SensTri } | null;
  onTrier: (cle: string) => void;
  align?: "left" | "right";
  className?: string;
}

export function EnTeteTriable({ label, cle, triActif, onTrier, align = "left", className = "" }: EnTeteTriableProps) {
  const actif = triActif?.cle === cle;

  return (
    <TableHead className={`relative overflow-hidden ${align === "right" ? "text-right" : "text-left"} ${className}`}>
      <button
        onClick={() => onTrier(cle)}
        className={`inline-flex items-center gap-1 hover:text-foreground max-w-full truncate ${align === "right" ? "flex-row-reverse" : ""} ${actif ? "text-foreground font-medium" : ""}`}
      >
        {label}
        {actif ? (
          triActif!.sens === "asc" ? <ChevronUp className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40 shrink-0" />
        )}
      </button>
    </TableHead>
  );
}
