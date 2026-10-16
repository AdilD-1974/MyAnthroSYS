/**
 * src/components/paie/simulation/EcartsTable.tsx
 * Tableau triable des écarts ligne à ligne (UC2 — Impact), pré-calculés côté
 * serveur (_calculer_ecarts_bulletins dans paie_calcul.py). Reconstruit avec
 * les composants Table shadcn/ui et classes Tailwind sémantiques, conforme
 * au pattern réel de TraitementPaiePage.tsx.
 */
import { Table, TableBody, TableHeader, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { EnTeteTriable } from "./EnTeteTriable";
import { useSortableTable } from "@/hooks/useSortableTable";
import type { LigneEcart } from "@/lib/simulation-api";

function fmt(v: string | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = parseFloat(v);
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// --success n'existe pas forcément dans la palette shadcn par défaut (comme
// --warning, déjà utilisé via style inline dans TraitementPaiePage pour la
// même raison) — seul cas légitime de style inline conservé ici.
function couleurDelta(delta: string): string {
  const n = parseFloat(delta);
  if (Number.isNaN(n) || n === 0) return "hsl(var(--muted-foreground))";
  return n > 0 ? "hsl(var(--success, 142 71% 35%))" : "hsl(var(--destructive))";
}

interface EcartsTableProps {
  lignes: LigneEcart[];
  totaux: Record<string, { avant: string; apres: string; delta: string }>;
}

const LIBELLES_TOTAUX: Record<string, string> = {
  total_brut: "Total brut",
  total_gains: "Total gains",
  total_retenues: "Total retenues",
  total_cot_salariale: "Cotisations salariales",
  total_cot_patronale: "Cotisations patronales",
  net_imposable: "Net imposable",
  net_a_payer: "Net à payer",
  cout_employeur: "Coût employeur",
};

export function EcartsTable({ lignes, totaux }: EcartsTableProps) {
  const colonnes = {
    code_rubrique: { cle: "code_rubrique", type: "texte" as const },
    libelle: { cle: "libelle", type: "texte" as const },
    avant: { cle: "avant", type: "numeric" as const },
    apres: { cle: "apres", type: "numeric" as const },
    delta: { cle: "delta", type: "numeric" as const },
    avant_patronal: { cle: "avant_patronal", type: "numeric" as const },
    apres_patronal: { cle: "apres_patronal", type: "numeric" as const },
    delta_patronal: { cle: "delta_patronal", type: "numeric" as const },
  };
  const { donneesTriees, tri, basculerTri } = useSortableTable(lignes, colonnes, { cle: "delta", sens: "desc" });

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table className="text-sm">
          <TableHeader>
            <TableRow>
              <TableHead rowSpan={2} className="align-bottom">Code</TableHead>
              <TableHead rowSpan={2} className="align-bottom">Libellé</TableHead>
              <TableHead colSpan={4} className="border-l text-center text-muted-foreground">Part salariale</TableHead>
              <TableHead colSpan={3} className="border-l text-center text-muted-foreground">Part patronale</TableHead>
            </TableRow>
            <TableRow>
              <EnTeteTriable label="Avant" cle="avant" triActif={tri} onTrier={basculerTri} align="right" className="border-l" />
              <EnTeteTriable label="Après" cle="apres" triActif={tri} onTrier={basculerTri} align="right" />
              <EnTeteTriable label="Écart" cle="delta" triActif={tri} onTrier={basculerTri} align="right" />
              <TableHead className="text-right">%</TableHead>
              <EnTeteTriable label="Avant" cle="avant_patronal" triActif={tri} onTrier={basculerTri} align="right" className="border-l" />
              <EnTeteTriable label="Après" cle="apres_patronal" triActif={tri} onTrier={basculerTri} align="right" />
              <EnTeteTriable label="Écart" cle="delta_patronal" triActif={tri} onTrier={basculerTri} align="right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {donneesTriees.map((l) => (
              <TableRow key={l.code_rubrique}>
                <TableCell className="font-mono text-xs">{l.code_rubrique}</TableCell>
                <TableCell>{l.libelle}</TableCell>
                <TableCell className="border-l text-right tabular-nums">{fmt(l.avant)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(l.apres)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums" style={{ color: couleurDelta(l.delta) }}>
                  {parseFloat(l.delta) > 0 ? "+" : ""}
                  {fmt(l.delta)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {l.delta_pct ? `${parseFloat(l.delta_pct) > 0 ? "+" : ""}${parseFloat(l.delta_pct).toFixed(1)}%` : "—"}
                </TableCell>
                <TableCell className="border-l text-right tabular-nums text-muted-foreground">{fmt(l.avant_patronal)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{fmt(l.apres_patronal)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums" style={{ color: couleurDelta(l.delta_patronal) }}>
                  {parseFloat(l.delta_patronal) > 0 ? "+" : ""}
                  {fmt(l.delta_patronal)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-md border p-4 sm:grid-cols-4">
        {Object.entries(totaux).map(([cle, v]) => (
          <div key={cle}>
            <div className="text-xs text-muted-foreground">{LIBELLES_TOTAUX[cle] ?? cle}</div>
            <div className="text-base font-semibold tabular-nums text-foreground">{fmt(v.apres)}</div>
            <div className="text-xs tabular-nums" style={{ color: couleurDelta(v.delta) }}>
              {parseFloat(v.delta) > 0 ? "+" : ""}
              {fmt(v.delta)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
