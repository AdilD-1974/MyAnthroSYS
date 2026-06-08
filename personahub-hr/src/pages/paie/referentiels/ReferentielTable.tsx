/**
 * Tableau de gestion d'un référentiel paie.
 * Recherche + filtre actif + boutons d'action.
 * Utilise <ReferentielFormDialog/> pour la création/édition.
 */
import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2, RotateCcw, Search } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
import {
  REFERENTIELS_META,
  useReferentielsPaie,
  type ReferentielItem,
  type ReferentielSlug,
} from "@/hooks/useReferentielsPaie";
import { ReferentielFormDialog } from "./ReferentielFormDialog";

interface Props {
  slug: ReferentielSlug;
}

export function ReferentielTable({ slug }: Props) {
  const meta = REFERENTIELS_META[slug];
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const { items, isLoading, update, remove } = useReferentielsPaie(slug, {
    actif: showInactive ? undefined : true,
    search: search || undefined,
  });

  const [editing, setEditing] = useState<ReferentielItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ReferentielItem | null>(
    null,
  );

  const sorted = useMemo(
    () =>
      [...items].sort(
        (a, b) => a.ordre - b.ordre || a.libelle.localeCompare(b.libelle),
      ),
    [items],
  );

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-[240px] max-w-md">
          <div className="relative w-full">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher par code ou libellé…"
              className="pl-8"
            />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id={`${slug}-show-inactive`}
              checked={showInactive}
              onCheckedChange={setShowInactive}
            />
            <Label htmlFor={`${slug}-show-inactive`} className="text-sm">
              Afficher les inactifs
            </Label>
          </div>
          <Button onClick={() => setCreating(true)} size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Ajouter
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[80px]">Ordre</TableHead>
              <TableHead className="w-[160px]">Code</TableHead>
              <TableHead>Libellé</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-[100px]">Statut</TableHead>
              <TableHead className="w-[120px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  Chargement…
                </TableCell>
              </TableRow>
            ) : sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  Aucun élément.{" "}
                  <button
                    className="text-primary underline underline-offset-2"
                    onClick={() => setCreating(true)}
                  >
                    Créer le premier
                  </button>
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((item) => (
                <TableRow key={item.id} className={!item.actif ? "opacity-60" : ""}>
                  <TableCell>{item.ordre}</TableCell>
                  <TableCell>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                      {item.code}
                    </code>
                  </TableCell>
                  <TableCell className="font-medium">{item.libelle}</TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                    {item.description ?? "—"}
                  </TableCell>
                  <TableCell>
                    {item.actif ? (
                      <Badge variant="default">Actif</Badge>
                    ) : (
                      <Badge variant="secondary">Inactif</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditing(item)}
                        title="Modifier"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {item.actif ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setConfirmDelete(item)}
                          title="Désactiver"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            update.mutate({ id: item.id, payload: { actif: true } })
                          }
                          title="Réactiver"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Dialog création */}
      <ReferentielFormDialog
        open={creating}
        onOpenChange={setCreating}
        slug={slug}
        title={`Nouvelle ${meta.singular.toLowerCase()}`}
      />

      {/* Dialog édition */}
      <ReferentielFormDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        slug={slug}
        item={editing}
        title={`Modifier ${meta.singular.toLowerCase()}`}
      />

      {/* Confirmation de désactivation */}
      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Désactiver cet élément&nbsp;?</AlertDialogTitle>
            <AlertDialogDescription>
              L'élément <strong>{confirmDelete?.libelle}</strong> ne sera plus
              proposé dans les listes déroulantes. Les rubriques qui l'utilisent
              déjà ne seront pas impactées. Vous pourrez le réactiver à tout
              moment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDelete) remove.mutate({ id: confirmDelete.id });
                setConfirmDelete(null);
              }}
            >
              Désactiver
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
