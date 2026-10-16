/**
 * src/components/paie/simulation/PaveAccordeon.tsx
 *
 * HYPOTHÈSE (à vérifier) : shadcn/ui Accordion est déjà présent sous
 * @/components/ui/accordion (import { Accordion, AccordionItem,
 * AccordionTrigger, AccordionContent } from "@/components/ui/accordion"),
 * conformément à la stack documentée (React + shadcn/ui). Si ce n'est pas
 * le cas, seule cette section d'imports change.
 *
 * Convention du projet (mémoire) : chevron à GAUCHE, rotation -90deg quand
 * FERMÉ (donc chevron vers le bas quand ouvert, vers la droite quand fermé)
 * — le chevron par défaut de shadcn/ui est à droite et tourne de 180deg à
 * l'ouverture : on le masque et on le remplace.
 *
 * Tous les "pavés" groupés du module Simulation (Sélection / Surcharges /
 * Résultat, etc.) utilisent ce composant plutôt qu'une simple Card, comme
 * demandé.
 */
import { ChevronDown } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export interface SectionAccordeon {
  valeur: string;
  titre: string;
  contenu: React.ReactNode;
  badge?: React.ReactNode; // ex. nombre de surcharges, indicateur d'erreur
}

interface PaveAccordeonProps {
  sections: SectionAccordeon[];
  ouvertsParDefaut?: string[];
  className?: string;
}

export function PaveAccordeon({ sections, ouvertsParDefaut, className = "" }: PaveAccordeonProps) {
  return (
    <Accordion
      type="multiple"
      defaultValue={ouvertsParDefaut ?? sections.map((s) => s.valeur)}
      className={`rounded-lg border bg-card ${className}`}
    >
      {sections.map((section) => (
        <AccordionItem key={section.valeur} value={section.valeur}>
          <AccordionTrigger className="group px-4 py-3 hover:no-underline [&>svg]:hidden">
            <span className="flex w-full items-center gap-2">
              <ChevronDown
                className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=closed]:-rotate-90"
                aria-hidden="true"
              />
              <span className="text-sm font-medium">{section.titre}</span>
              {section.badge && <span className="ml-auto">{section.badge}</span>}
            </span>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">{section.contenu}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
