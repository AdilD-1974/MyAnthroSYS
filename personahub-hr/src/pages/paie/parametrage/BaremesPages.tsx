/**
 * Pages routées pour les barèmes :
 *   /paie/parametrage/baremes              -> liste
 *   /paie/parametrage/baremes/new          -> création
 *   /paie/parametrage/baremes/:id          -> édition
 */
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";

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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { useBaremes, useBaremeMutations } from "@/hooks/useBaremes";
import type { BaremeListItem } from "@/types/bareme";

import { BaremeForm } from "@/components/paie/baremes/BaremeForm";

// ---------------------------------------------------------------------------
// Page : Liste
// ---------------------------------------------------------------------------
export function BaremesListPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const { data: items = [], isLoading } = useBaremes({
    archive: showArchived ? undefined : false,
    search: search || undefined,
  });
  const { archive } = useBaremeMutations();
  const [confirmDelete, setConfirmDelete] = useState<BaremeListItem | null>(null);

  return (
    <div className="container mx-auto py-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Barèmes</h1>
          <p className="text-sm text-muted-foreground">
            Tables de correspondance clé(s) → valeur(s) pour les calculs de paie.
          </p>
        </div>
        <Button onClick={() => navigate("/paie/parametrage/baremes/new")}>
          <Plus className="mr-2 h-4 w-4" /> Nouveau barème
        </Button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par code ou libellé…"
            className="pl-8"
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="show-arch" checked={showArchived} onCheckedChange={setShowArchived} />
          <Label htmlFor="show-arch" className="text-sm">Afficher les archivés</Label>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Code</TableHead>
              <TableHead>Libellé</TableHead>
              <TableHead className="w-28 text-center">Clés</TableHead>
              <TableHead className="w-28 text-center">Sorties</TableHead>
              <TableHead className="w-28 text-center">Lignes</TableHead>
              <TableHead className="w-40">Validité</TableHead>
              <TableHead className="w-24">Statut</TableHead>
              <TableHead className="w-28 text-right">Actions</TableHead>
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
              items.map((b) => (
                <TableRow key={b.id} className={b.archive ? "opacity-50" : ""}>
                  <TableCell>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{b.code}</code>
                  </TableCell>
                  <TableCell className="font-medium">{b.libelle}</TableCell>
                  <TableCell className="text-center">{b.nb_cles}</TableCell>
                  <TableCell className="text-center">{b.nb_sorties}</TableCell>
                  <TableCell className="text-center">{b.nb_lignes}</TableCell>
                  <TableCell className="text-xs">
                    {b.date_debut_validite}
                    {b.date_fin_validite ? ` → ${b.date_fin_validite}` : ""}
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
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => navigate(`/paie/parametrage/baremes/${b.id}`)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setConfirmDelete(b)}
                      disabled={b.archive}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

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
