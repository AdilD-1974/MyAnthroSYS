/**
 * EcrituresDetailDialog — fenêtre de détail des écritures d'un lot comptable.
 *
 * Ouverte depuis VueComptabilitePage.tsx (icône œil sur une ligne de lot).
 *
 * Deux vues :
 *  - Balance : composant BalanceEcrituresAccordion (même que la section
 *    Résultat de GenerationEcrituresPage.tsx) — Compte -> Rubrique ->
 *    Matricule en pavés accordéon.
 *  - Par UO : groupé par UO d'affectation RÉSOLUE (code — libellé, ex.
 *    "DGL — Direction Générale"), pas par la valeur brute de l'axe — voir
 *    axe_libelle dans comptaApi.ts (résolution par id OU par code, 05/08).
 *    Dépliable vers le détail par matricule (NOMINATIF) ou par compte
 *    (GLOBAL, pas de collaborateur disponible à ce niveau).
 *
 * Les deux onglets proposent un export Excel Global (une ligne par
 * compte/UO) ou Détaillé (toutes les lignes), via SheetJS (xlsx) — ⚠️
 * dépendance à installer si absente : `npm install xlsx`.
 *
 * ⚠️ mode_generation et numero_generation sont des PROPS (fournies par
 * VueComptabilitePage.tsx via LotAvecLibelles) plutôt que relues ici.
 *
 * Style harmonisé : composants shadcn/ui, couleurs via variables CSS de
 * thème (--info débit, --accent crédit, cohérent avec BalanceEcrituresAccordion).
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Download } from "lucide-react";
import * as XLSX from "xlsx";
import { comptaApi, type DetailEcrituresLot, type EcritureAffichage, type ModeGeneration } from "@/lib/comptaApi";
import BalanceEcrituresAccordion from "@/components/paie/compta/BalanceEcrituresAccordion";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";

const fmtMontant = (n?: number | null) =>
  n ? new Intl.NumberFormat("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) : "";

interface Props {
  lotId: string | null;
  lotLabel?: string;
  modeGeneration?: ModeGeneration;
  numeroGeneration?: number;
  onOpenChange: (open: boolean) => void;
}

/** Génère et télécharge un classeur Excel à partir d'un tableau d'objets. */
function exporterExcel(nomFichier: string, feuille: string, lignes: Record<string, string | number>[]) {
  const ws = XLSX.utils.json_to_sheet(lignes);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, feuille);
  XLSX.writeFile(wb, `${nomFichier}.xlsx`);
}

/** Deux boutons d'export (Global / Détaillé), factorisés entre les deux onglets. */
function BoutonsExport({ onGlobal, onDetaille }: { onGlobal: () => void; onDetaille: () => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={onGlobal}>
        <Download size={12} /> Export global
      </Button>
      <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={onDetaille}>
        <Download size={12} /> Export détaillé
      </Button>
    </div>
  );
}

export default function EcrituresDetailDialog({
  lotId, lotLabel, modeGeneration, numeroGeneration, onOpenChange,
}: Props) {
  const [data, setData] = useState<DetailEcrituresLot | null>(null);
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!lotId || !modeGeneration || numeroGeneration == null) { setData(null); return; }
    setLoading(true);
    setErreur(null);
    comptaApi.listerEcritures(lotId, modeGeneration, numeroGeneration)
      .then(setData)
      .catch((e: any) => setErreur(e.message || "Erreur de chargement."))
      .finally(() => setLoading(false));
  }, [lotId, modeGeneration, numeroGeneration]);

  const nomBase = (lotLabel || "ecritures").replace(/[^a-zA-Z0-9]+/g, "_");

  function exportBalanceGlobal() {
    if (!data) return;
    const parCompte = new Map<string, { libelle: string; debit: number; credit: number }>();
    data.lignes.forEach((l) => {
      const g = parCompte.get(l.compte) ?? { libelle: l.compte_libelle, debit: 0, credit: 0 };
      g.debit += l.montant_debit; g.credit += l.montant_credit;
      parCompte.set(l.compte, g);
    });
    const lignes = Array.from(parCompte.entries())
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([compte, g]) => ({ Compte: compte, Libellé: g.libelle, Débit: g.debit, Crédit: g.credit }));
    exporterExcel(`balance_globale_${nomBase}`, "Balance", lignes);
  }

  function exportBalanceDetaille() {
    if (!data) return;
    const lignes = data.lignes.map((l) => ({
      Compte: l.compte, "Libellé compte": l.compte_libelle,
      ...(data.nominatif ? { Rubrique: l.rubrique_paie_code ?? "", "Libellé rubrique": l.rubrique_libelle ?? "" } : {}),
      ...(data.nominatif ? { Matricule: l.matricule ?? "", Collaborateur: l.collaborateur_nom ?? "" } : {}),
      Débit: l.montant_debit, Crédit: l.montant_credit,
    }));
    exporterExcel(`balance_detaillee_${nomBase}`, "Écritures", lignes);
  }

  function exportUoGlobal() {
    if (!data) return;
    const parUo = new Map<string, { debit: number; credit: number }>();
    data.lignes.forEach((l) => {
      const cle = l.axe_libelle || l.axe_analytique || "Sans affectation UO";
      const g = parUo.get(cle) ?? { debit: 0, credit: 0 };
      g.debit += l.montant_debit; g.credit += l.montant_credit;
      parUo.set(cle, g);
    });
    const lignes = Array.from(parUo.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([uo, g]) => ({ UO: uo, Débit: g.debit, Crédit: g.credit }));
    exporterExcel(`par_uo_global_${nomBase}`, "Par UO", lignes);
  }

  function exportUoDetaille() {
    if (!data) return;
    const lignes = data.lignes.map((l) => ({
      UO: l.axe_libelle || l.axe_analytique || "Sans affectation UO",
      ...(data.nominatif ? { Matricule: l.matricule ?? "", Collaborateur: l.collaborateur_nom ?? "" } : {}),
      Compte: l.compte, Libellé: l.compte_libelle,
      Débit: l.montant_debit, Crédit: l.montant_credit,
    }));
    exporterExcel(`par_uo_detaille_${nomBase}`, "Par UO", lignes);
  }

  return (
    <Dialog open={!!lotId} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0">
          <DialogTitle>Détail des écritures{lotLabel ? ` — ${lotLabel}` : ""}</DialogTitle>
          <DialogDescription>
            {data
              ? `${data.lignes.length} ligne(s) · ${data.nominatif ? "Détail nominatif" : "Écriture globale"}`
              : "Chargement des écritures du lot…"}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center flex-1">
            <Loader2 className="animate-spin text-muted-foreground" size={20} />
          </div>
        )}

        {erreur && (
          <div className="mx-6 px-4 py-3 rounded-lg text-sm bg-destructive/10 text-destructive border border-destructive/30">
            {erreur}
          </div>
        )}

        {data && !loading && (
          <Tabs defaultValue="balance" className="flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between mx-6 shrink-0">
              <TabsList className="w-fit">
                <TabsTrigger value="balance">Balance</TabsTrigger>
                <TabsTrigger value="uo">Par UO</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="balance" className="flex-1 min-h-0 overflow-y-auto px-6 mt-2 pb-4 space-y-2">
              <div className="flex justify-end">
                <BoutonsExport onGlobal={exportBalanceGlobal} onDetaille={exportBalanceDetaille} />
              </div>
              <BalanceEcrituresAccordion lignes={data.lignes} nominatif={data.nominatif} titre="Balance des écritures" />
            </TabsContent>

            <TabsContent value="uo" className="flex-1 min-h-0 overflow-y-auto px-6 mt-2 pb-4 space-y-2">
              <div className="flex justify-end">
                <BoutonsExport onGlobal={exportUoGlobal} onDetaille={exportUoDetaille} />
              </div>
              <GroupedTable
                lignes={data.lignes}
                groupBy={(l) => l.axe_libelle || l.axe_analytique || "Sans affectation UO"}
                groupLabel="UO"
                detailColumns={data.nominatif ? ["matricule", "nom", "compte", "libelle"] : ["compte", "libelle"]}
              />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Tableau groupé (par UO), dépliable ligne par ligne vers le détail — mêmes
 * couleurs Débit (--info) / Crédit (--accent) que BalanceEcrituresAccordion. */
function GroupedTable({
  lignes, groupBy, groupLabel, detailColumns,
}: {
  lignes: EcritureAffichage[];
  groupBy: (l: EcritureAffichage) => string;
  groupLabel: string;
  detailColumns: ("matricule" | "nom" | "compte" | "libelle")[];
}) {
  const [ouverts, setOuverts] = useState<Set<string>>(new Set());
  const toggle = (cle: string) =>
    setOuverts((prev) => {
      const next = new Set(prev);
      next.has(cle) ? next.delete(cle) : next.add(cle);
      return next;
    });

  const groupes = useMemo(() => {
    const map = new Map<string, { lignes: EcritureAffichage[]; debit: number; credit: number }>();
    lignes.forEach((l) => {
      const cle = groupBy(l);
      const g = map.get(cle) ?? { lignes: [], debit: 0, credit: 0 };
      g.lignes.push(l);
      g.debit += l.montant_debit;
      g.credit += l.montant_credit;
      map.set(cle, g);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [lignes, groupBy]);

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <Table className="text-sm">
        <TableHeader className="sticky top-0 bg-background z-10">
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>{groupLabel}</TableHead>
            <TableHead className="text-right">Débit</TableHead>
            <TableHead className="text-right">Crédit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groupes.map(([cle, g]) => {
            const ouvert = ouverts.has(cle);
            return (
              <Fragment key={cle}>
                <TableRow onClick={() => toggle(cle)} className="cursor-pointer">
                  <TableCell className="text-muted-foreground">
                    {ouvert ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </TableCell>
                  <TableCell className="font-medium">
                    {cle} <span className="text-xs font-normal text-muted-foreground">({g.lignes.length})</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold" style={{ color: "hsl(var(--info))" }}>
                    {fmtMontant(g.debit)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold" style={{ color: "hsl(var(--accent))" }}>
                    {fmtMontant(g.credit)}
                  </TableCell>
                </TableRow>
                {ouvert && (
                  <TableRow className="bg-muted/20 hover:bg-muted/20">
                    <TableCell colSpan={4} className="p-0">
                      <Table className="text-sm">
                        <TableHeader>
                          <TableRow>
                            {detailColumns.includes("matricule") && <TableHead>Matricule</TableHead>}
                            {detailColumns.includes("nom") && <TableHead>Collaborateur</TableHead>}
                            {detailColumns.includes("compte") && <TableHead>Compte</TableHead>}
                            {detailColumns.includes("libelle") && <TableHead>Libellé</TableHead>}
                            <TableHead className="text-right">Débit</TableHead>
                            <TableHead className="text-right">Crédit</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {g.lignes.map((l, i) => (
                            <TableRow key={i}>
                              {detailColumns.includes("matricule") && <TableCell className="font-mono">{l.matricule || "—"}</TableCell>}
                              {detailColumns.includes("nom") && <TableCell>{l.collaborateur_nom || "—"}</TableCell>}
                              {detailColumns.includes("compte") && <TableCell className="font-mono">{l.compte}</TableCell>}
                              {detailColumns.includes("libelle") && <TableCell className="text-muted-foreground">{l.compte_libelle || "—"}</TableCell>}
                              <TableCell className="text-right tabular-nums" style={{ color: "hsl(var(--info))" }}>
                                {fmtMontant(l.montant_debit)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums" style={{ color: "hsl(var(--accent))" }}>
                                {fmtMontant(l.montant_credit)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
          {groupes.length === 0 && (
            <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">Aucune donnée.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
