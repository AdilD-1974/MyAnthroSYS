/**
 * src/components/paie/simulation/BulletinLignesTable.tsx
 *
 * Reconstruit avec les composants Table shadcn/ui (Table/TableHeader/
 * TableBody/TableRow/TableCell) et classes Tailwind sémantiques
 * (text-muted-foreground, bg-primary/10...), conformément au pattern réel
 * de TraitementPaiePage.tsx — plus de style inline hsl(var(--...)) ni de
 * calc(--font-scale) (TraitementPaiePage n'utilise ni l'un ni l'autre).
 */
import { Table, TableBody, TableHeader, TableRow, TableCell } from "@/components/ui/table";
import { EnTeteTriable } from "./EnTeteTriable";
import { useSortableTable } from "@/hooks/useSortableTable";
import type { LigneBulletin, TotauxBulletin } from "@/lib/simulation-api";

function fmt(v: string | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = parseFloat(v);
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface BulletinLignesTableProps {
  lignes: LigneBulletin[];
  totaux: TotauxBulletin;
  codesSurcharges?: string[]; // codes rubrique surlignés (ceux modifiés par une surcharge)
}

export function BulletinLignesTable({ lignes, totaux, codesSurcharges = [] }: BulletinLignesTableProps) {
  const colonnes = {
    code_rubrique: { cle: "code_rubrique", type: "texte" as const },
    libelle: { cle: "libelle", type: "texte" as const },
    base: { cle: "base", type: "numeric" as const },
    nombre: { cle: "nombre", type: "numeric" as const },
    taux: { cle: "taux", type: "numeric" as const },
    montant: { cle: "montant", type: "numeric" as const },
    montant_patronal: { cle: "montant_patronal", type: "numeric" as const },
  };
  const { donneesTriees, tri, basculerTri } = useSortableTable(lignes, colonnes);

  return (
    <div className="space-y-3">
      <div className="rounded-md border">
        <Table className="text-sm">
          <TableHeader>
            <TableRow>
              <EnTeteTriable label="Code" cle="code_rubrique" triActif={tri} onTrier={basculerTri} />
              <EnTeteTriable label="Libellé" cle="libelle" triActif={tri} onTrier={basculerTri} />
              <EnTeteTriable label="Base" cle="base" triActif={tri} onTrier={basculerTri} align="right" />
              <EnTeteTriable label="Nombre" cle="nombre" triActif={tri} onTrier={basculerTri} align="right" />
              <EnTeteTriable label="Taux" cle="taux" triActif={tri} onTrier={basculerTri} align="right" />
              <EnTeteTriable label="Montant" cle="montant" triActif={tri} onTrier={basculerTri} align="right" />
              <EnTeteTriable label="Montant patronal" cle="montant_patronal" triActif={tri} onTrier={basculerTri} align="right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {donneesTriees.map((l) => {
              const surchargee = codesSurcharges.includes(l.code_rubrique);
              return (
                <TableRow key={l.code_rubrique} className={surchargee ? "bg-primary/5" : undefined}>
                  <TableCell className="font-mono text-xs">{l.code_rubrique}</TableCell>
                  <TableCell>
                    {l.libelle}
                    {surchargee && (
                      <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        surchargée
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(l.base)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(l.nombre)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(l.taux)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{fmt(l.montant)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{fmt(l.montant_patronal)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-md border p-4 sm:grid-cols-4">
        <TotalCell label="Total brut" valeur={totaux.total_brut} />
        <TotalCell label="Cotisations salariales" valeur={totaux.total_cot_salariale} />
        <TotalCell label="Net imposable" valeur={totaux.net_imposable} />
        <TotalCell label="Net à payer" valeur={totaux.net_a_payer} accent />
        <TotalCell label="Cotisations patronales" valeur={totaux.total_cot_patronale} />
        <TotalCell label="Coût employeur" valeur={totaux.cout_employeur} accent />
      </div>
    </div>
  );
}

function TotalCell({ label, valeur, accent = false }: { label: string; valeur: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${accent ? "text-primary" : "text-foreground"}`}>
        {fmt(valeur)}
      </div>
    </div>
  );
}
