/**
 * BalanceEcrituresAccordion — balance hiérarchique Compte -> Rubrique ->
 * Matricule d'un lot d'écritures, en pavés accordéon (repliables).
 *
 * Composant volontairement autonome (pas de dépendance à comptaApi ni à
 * l'état d'un écran particulier) pour être réutilisable tel quel :
 *  - GenerationEcrituresPage.tsx : juste après les KPI du résultat, pour
 *    consulter le détail sans quitter l'écran de génération.
 *  - VueComptabilitePage.tsx (prévu, 05/08) : même composant, pour la
 *    consultation directe d'un lot depuis la vue d'ensemble comptabilité,
 *    sans passer par la fenêtre de détail séparée.
 *
 * Mode NOMINATIF : Compte -> Rubrique -> Matricule (3 niveaux).
 * Mode GLOBAL : Compte -> lignes brutes (compte/axe), pas de rubrique ni de
 * matricule au niveau de la ligne — un seul niveau d'accordéon.
 *
 * Style harmonisé : composants shadcn/ui, couleurs via variables CSS de
 * thème (--info pour le débit, --accent pour le crédit, cohérent avec le
 * reste du module Comptabilité).
 */
import { useMemo } from "react";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface LigneBalance {
  compte: string;
  compte_libelle: string;
  montant_debit: number;
  montant_credit: number;
  axe_analytique: string | null;
  rubrique_paie_code: string | null;
  rubrique_libelle: string | null;
  matricule: string | null;
  collaborateur_nom: string | null;
}

const fmtMontant = (n?: number | null) =>
  n ? new Intl.NumberFormat("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) : "";

function TotalRow({ debit, credit }: { debit: number; credit: number }) {
  return (
    <span className="flex items-center gap-3 text-base font-semibold tabular-nums">
      <span className="w-28 text-right" style={{ color: "hsl(var(--info))" }}>{fmtMontant(debit) || "—"}</span>
      <span className="w-28 text-right" style={{ color: "hsl(var(--accent))" }}>{fmtMontant(credit) || "—"}</span>
    </span>
  );
}

export default function BalanceEcrituresAccordion({
  lignes, nominatif, titre = "Balance des écritures",
}: {
  lignes: LigneBalance[];
  nominatif: boolean;
  titre?: string;
}) {
  const parCompte = useMemo(() => {
    const map = new Map<string, { lignes: LigneBalance[]; debit: number; credit: number; libelle: string }>();
    lignes.forEach((l) => {
      const g = map.get(l.compte) ?? { lignes: [], debit: 0, credit: 0, libelle: l.compte_libelle };
      g.lignes.push(l);
      g.debit += l.montant_debit;
      g.credit += l.montant_credit;
      map.set(l.compte, g);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  }, [lignes]);

  const totaux = useMemo(
    () => lignes.reduce((acc, l) => ({ debit: acc.debit + l.montant_debit, credit: acc.credit + l.montant_credit }), { debit: 0, credit: 0 }),
    [lignes]
  );

  if (parCompte.length === 0) {
    return <p className="text-sm text-muted-foreground py-4 text-center">Aucune écriture à afficher.</p>;
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3.5 pr-7 bg-muted/30 border-b border-border">
        <span className="text-base font-bold text-foreground">{titre}</span>
        <div className="flex items-center">
          <span className="flex items-center gap-3 text-lg font-bold tabular-nums">
            <span className="w-28 text-right" style={{ color: "hsl(var(--info))" }}>{fmtMontant(totaux.debit) || "—"}</span>
            <span className="w-28 text-right" style={{ color: "hsl(var(--accent))" }}>{fmtMontant(totaux.credit) || "—"}</span>
          </span>
        </div>
      </div>

      <Accordion type="multiple" className="w-full">
        {parCompte.map(([compte, g]) => (
          <AccordionItem key={compte} value={compte} className="border-b border-border last:border-b-0 px-4">
            <AccordionTrigger className="py-2.5 hover:no-underline">
              <div className="flex items-center justify-between w-full pr-3">
                <span className="text-sm font-medium">
                  <span className="font-mono">{compte}</span>
                  {g.libelle && <span className="text-muted-foreground"> — {g.libelle}</span>}
                </span>
                <TotalRow debit={g.debit} credit={g.credit} />
              </div>
            </AccordionTrigger>
            <AccordionContent>
              {nominatif ? <BalanceParRubrique lignes={g.lignes} /> : <BalanceLignesBrutes lignes={g.lignes} />}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}

/** Niveau 2 (mode NOMINATIF) : accordéon imbriqué par rubrique. */
function BalanceParRubrique({ lignes }: { lignes: LigneBalance[] }) {
  const parRubrique = useMemo(() => {
    const map = new Map<string, { lignes: LigneBalance[]; debit: number; credit: number; libelle: string | null }>();
    lignes.forEach((l) => {
      const cle = l.rubrique_paie_code ?? "—";
      const g = map.get(cle) ?? { lignes: [], debit: 0, credit: 0, libelle: l.rubrique_libelle };
      g.lignes.push(l);
      g.debit += l.montant_debit;
      g.credit += l.montant_credit;
      map.set(cle, g);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [lignes]);

  return (
    <Accordion type="multiple" className="w-full pl-4 border-l border-border/60 ml-1">
      {parRubrique.map(([rubrique, g]) => (
        <AccordionItem key={rubrique} value={rubrique} className="border-b border-border/60 last:border-b-0">
          <AccordionTrigger className="py-2 hover:no-underline text-sm">
            <div className="flex items-center justify-between w-full pr-3">
              <span>
                <span className="font-mono text-xs">{rubrique}</span>
                {g.libelle && <span className="text-muted-foreground text-xs"> — {g.libelle}</span>}
              </span>
              <TotalRow debit={g.debit} credit={g.credit} />
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <Table className="text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead>Matricule</TableHead>
                  <TableHead>Collaborateur</TableHead>
                  <TableHead className="text-right">Débit</TableHead>
                  <TableHead className="text-right">Crédit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...g.lignes]
                  .sort((a, b) => (a.collaborateur_nom ?? "").localeCompare(b.collaborateur_nom ?? ""))
                  .map((l, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono">{l.matricule ?? "—"}</TableCell>
                      <TableCell>{l.collaborateur_nom ?? "—"}</TableCell>
                      <TableCell className="text-right" style={{ color: "hsl(var(--info))" }}>{fmtMontant(l.montant_debit)}</TableCell>
                      <TableCell className="text-right" style={{ color: "hsl(var(--accent))" }}>{fmtMontant(l.montant_credit)}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

/** Niveau 2 (mode GLOBAL, pas de rubrique/matricule) : lignes brutes du compte. */
function BalanceLignesBrutes({ lignes }: { lignes: LigneBalance[] }) {
  return (
    <Table className="text-sm">
      <TableHeader>
        <TableRow>
          <TableHead>Axe</TableHead>
          <TableHead className="text-right">Débit</TableHead>
          <TableHead className="text-right">Crédit</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lignes.map((l, i) => (
          <TableRow key={i}>
            <TableCell className="text-muted-foreground">{l.axe_analytique ?? "—"}</TableCell>
            <TableCell className="text-right" style={{ color: "hsl(var(--info))" }}>{fmtMontant(l.montant_debit)}</TableCell>
            <TableCell className="text-right" style={{ color: "hsl(var(--accent))" }}>{fmtMontant(l.montant_credit)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
