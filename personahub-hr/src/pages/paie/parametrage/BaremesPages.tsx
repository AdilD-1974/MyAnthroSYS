/**
 * Pages routées pour les barèmes :
 *   /paie/parametrage/baremes              -> liste
 *   /paie/parametrage/baremes/new          -> création
 *   /paie/parametrage/baremes/:id          -> édition
 */
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Pencil, Plus, Search, Trash2, Eye } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { useBaremes, useBareme, useBaremeMutations } from "@/hooks/useBaremes";
import { useTableSort } from "@/hooks/useTableSort";
import { useFormatMasks } from "@/hooks/useFormatMasks";
import type { BaremeListItem } from "@/types/bareme";

import { BaremeForm } from "@/components/paie/baremes/BaremeForm";

// ---------------------------------------------------------------------------
// Dialog : Consultation en lecture seule des lignes d'un barème
// ---------------------------------------------------------------------------
// RG-BAREME-CONSULT-01 (Adil DAIA) : accès rapide aux valeurs sans passer par
// le formulaire d'édition complet — utile pour vérifier une tranche/un taux
// sans risque de modifier le barème par erreur.
// Sentinel utilisé pour un plafond/une borne « sans limite » — à aligner sur
// la constante réelle si elle existe déjà ailleurs dans le projet (ex.
// PLAFOND_ILLIMITE dans un fichier de constantes partagé).
const SEUIL_INFINI = 999_999_999_999;

function BaremeConsultDialog({ baremeId, onClose }: { baremeId: string | null; onClose: () => void }) {
  const { data: bareme, isLoading } = useBareme(baremeId || undefined);
  const { formatNumber } = useFormatMasks();

  const formatValeurNombre = (v: number | string): string => {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isNaN(n)) return String(v);
    if (Math.abs(n) >= SEUIL_INFINI) return "∞";
    return formatNumber(n);
  };

  // Affichage générique d'une valeur de clé : {min,max} -> "min – max", sinon brut.
  const formatValeurCle = (v: unknown): string => {
    if (v && typeof v === "object" && "min" in (v as any) && "max" in (v as any)) {
      const { min, max } = v as { min: number | string; max: number | string };
      return `${formatValeurNombre(min)} – ${formatValeurNombre(max)}`;
    }
    if (typeof v === "number" || (typeof v === "string" && v !== "" && !Number.isNaN(Number(v)))) {
      return formatValeurNombre(v as number | string);
    }
    return v === null || v === undefined || v === "" ? "—" : String(v);
  };
  const formatValeurSortie = (v: unknown): string => {
    if (typeof v === "number" || (typeof v === "string" && v !== "" && !Number.isNaN(Number(v)))) {
      return formatValeurNombre(v as number | string);
    }
    return v === null || v === undefined || v === "" ? "—" : String(v);
  };

  return (
    <Dialog open={!!baremeId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Eye className="h-4.5 w-4.5 text-muted-foreground" />
            {bareme ? bareme.libelle : "Consultation du barème"}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {bareme && (
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{bareme.code}</code>
            )}
            {" "}Lecture seule — passez par « Modifier » pour changer ces valeurs.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-auto flex-1 -mx-1 px-1">
          {isLoading ? (
            <div className="text-center py-8 text-sm text-muted-foreground">Chargement…</div>
          ) : !bareme || bareme.lignes.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              Ce barème n'a aucune ligne renseignée.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow style={{ background: "hsl(var(--muted) / 0.5)" }}>
                  {bareme.cles.map((c) => (
                    <TableHead key={c.id} className="whitespace-nowrap text-sm font-semibold text-foreground py-3">
                      {c.libelle}
                      {c.mode !== "EXACT" && (
                        <span className="ml-1 text-xs text-muted-foreground font-normal">
                          ({c.mode === "PLAGE" ? "plage" : c.mode === "LT" ? "< x" : c.mode === "LTE" ? "≤ x" : c.mode === "GT" ? "> x" : "≥ x"})
                        </span>
                      )}
                    </TableHead>
                  ))}
                  {bareme.sorties.map((s) => (
                    <TableHead key={s.id} className="whitespace-nowrap text-right text-sm font-semibold text-foreground py-3">
                      {s.libelle}
                      {s.par_defaut && <span className="ml-1 text-xs text-primary">★</span>}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {bareme.lignes
                  .slice()
                  .sort((a, b) => a.ordre - b.ordre)
                  .map((ligne) => (
                    <TableRow key={ligne.id}>
                      {bareme.cles.map((c) => (
                        <TableCell key={c.id} className="font-mono text-sm py-2.5">
                          {formatValeurCle(ligne.valeurs_cles[c.nom_technique])}
                        </TableCell>
                      ))}
                      {bareme.sorties.map((s) => (
                        <TableCell key={s.id} className="font-mono text-sm text-right py-2.5">
                          {formatValeurSortie(ligne.valeurs_sorties[s.nom_technique])}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Page : Liste
// ---------------------------------------------------------------------------
export function BaremesListPage({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const { data: items = [], isLoading } = useBaremes({
    archive: showArchived ? undefined : false,
    search: search || undefined,
  });
  const { archive } = useBaremeMutations();
  const [confirmDelete, setConfirmDelete] = useState<BaremeListItem | null>(null);
  const [consultId, setConsultId] = useState<string | null>(null);
  const { formatDate } = useFormatMasks();

  const { sortedData, toggleSort, SortIcon } = useTableSort(items, {
    getValue: (row: any, key: string) =>
      key === "statut" ? (row.archive ? "archive" : row.actif ? "actif" : "inactif") : row[key],
  });

  const headCellCls = "text-[10px] uppercase tracking-wide font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors";

  return (
    <div className={embedded ? "space-y-4" : "container mx-auto py-6 space-y-4"}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          {embedded ? (
            <h2 className="text-base font-semibold text-foreground">Barèmes ({items.length})</h2>
          ) : (
            <h1 className="text-2xl font-semibold tracking-tight">Barèmes</h1>
          )}
          <p className={embedded ? "text-xs text-muted-foreground mt-0.5" : "text-sm text-muted-foreground"}>
            Tables de correspondance clé(s) → valeur(s) pour les calculs de paie.
          </p>
        </div>
        <Button size={embedded ? "sm" : "default"} onClick={() => navigate("/paie/parametrage/baremes/new")}>
          <Plus className="mr-2 h-4 w-4" /> Nouveau barème
        </Button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par code ou libellé…"
            className={embedded ? "pl-8 h-9 text-sm" : "pl-8"}
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="show-arch" checked={showArchived} onCheckedChange={setShowArchived} />
          <Label htmlFor="show-arch" className="text-sm">Afficher les archivés</Label>
        </div>
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow style={{ background: "hsl(var(--muted) / 0.5)" }}>
              <TableHead className={`w-32 ${headCellCls}`} onClick={() => toggleSort("code")}>
                Code <SortIcon column="code" />
              </TableHead>
              <TableHead className={headCellCls} onClick={() => toggleSort("libelle")}>
                Libellé <SortIcon column="libelle" />
              </TableHead>
              <TableHead className={`w-28 text-center ${headCellCls}`} onClick={() => toggleSort("nb_cles")}>
                Clés <SortIcon column="nb_cles" />
              </TableHead>
              <TableHead className={`w-28 text-center ${headCellCls}`} onClick={() => toggleSort("nb_sorties")}>
                Sorties <SortIcon column="nb_sorties" />
              </TableHead>
              <TableHead className={`w-28 text-center ${headCellCls}`} onClick={() => toggleSort("nb_lignes")}>
                Lignes <SortIcon column="nb_lignes" />
              </TableHead>
              <TableHead className={`w-40 ${headCellCls}`} onClick={() => toggleSort("date_debut_validite")}>
                Validité <SortIcon column="date_debut_validite" />
              </TableHead>
              <TableHead className={`w-24 ${headCellCls}`} onClick={() => toggleSort("statut")}>
                Statut <SortIcon column="statut" />
              </TableHead>
              <TableHead className="w-36 text-right text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  Chargement…
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  Aucun barème.{" "}
                  <button
                    className="text-primary underline"
                    onClick={() => navigate("/paie/parametrage/baremes/new")}
                  >
                    Créer le premier
                  </button>
                </TableCell>
              </TableRow>
            ) : (
              sortedData.map((b) => (
                <TableRow key={b.id} className={b.archive ? "opacity-50" : ""}>
                  <TableCell>
                    <code className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{b.code}</code>
                  </TableCell>
                  <TableCell className="font-medium">{b.libelle}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="secondary" className="text-[10px] font-mono">{b.nb_cles}</Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="secondary" className="text-[10px] font-mono">{b.nb_sorties}</Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="secondary" className="text-[10px] font-mono">{b.nb_lignes}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {formatDate(b.date_debut_validite)}
                    {b.date_fin_validite ? ` → ${formatDate(b.date_fin_validite)}` : ""}
                  </TableCell>
                  <TableCell>
                    {b.archive ? (
                      <Badge variant="secondary">Archivé</Badge>
                    ) : b.actif ? (
                      <Badge>Actif</Badge>
                    ) : (
                      <Badge variant="outline">Inactif</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setConsultId(b.id)}
                        title="Consulter les valeurs"
                      >
                        <Eye className="h-4 w-4" style={{ color: "hsl(var(--info))" }} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => navigate(`/paie/parametrage/baremes/${b.id}`)}
                        title="Modifier"
                      >
                        <Pencil className="h-4 w-4" style={{ color: "hsl(var(--accent))" }} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => setConfirmDelete(b)}
                        disabled={b.archive}
                        title="Archiver"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <BaremeConsultDialog baremeId={consultId} onClose={() => setConsultId(null)} />

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archiver ce barème ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le barème <strong>{confirmDelete?.libelle}</strong> sera archivé et ne sera plus
              utilisable pour les nouveaux calculs. Vous pourrez le restaurer ultérieurement.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDelete) archive.mutate({ id: confirmDelete.id });
                setConfirmDelete(null);
              }}
            >
              Archiver
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page : Création
// ---------------------------------------------------------------------------
export function BaremeNewPage() {
  return <BaremeForm />;
}

// ---------------------------------------------------------------------------
// Page : Édition
// ---------------------------------------------------------------------------
export function BaremeEditPage() {
  const { id } = useParams<{ id: string }>();
  return <BaremeForm baremeId={id} />;
}
