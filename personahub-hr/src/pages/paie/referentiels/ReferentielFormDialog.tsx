/**
 * Modale de création / édition d'un élément de référentiel paie.
 * react-hook-form + Zod + shadcn/ui.
 */
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

import {
  useReferentielsPaie,
  type ReferentielItem,
  type ReferentielSlug,
} from "@/hooks/useReferentielsPaie";

// ---------------------------------------------------------------------------
// Schéma de validation
// ---------------------------------------------------------------------------
const schema = z.object({
  code: z
    .string()
    .min(1, "Code obligatoire")
    .max(50, "50 caractères max")
    .regex(
      /^[A-Z0-9_]+$/,
      "Le code doit être en MAJUSCULES, chiffres et underscores uniquement (ex: SAL_BASE)",
    ),
  libelle: z.string().min(1, "Libellé obligatoire").max(200),
  description: z.string().max(2000).optional().or(z.literal("")),
  ordre: z.coerce.number().int().min(0).max(9999).default(0),
  actif: z.boolean().default(true),
});

type FormValues = z.infer<typeof schema>;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: ReferentielSlug;
  item?: ReferentielItem | null;
  title: string;
}

// ---------------------------------------------------------------------------
// Composant
// ---------------------------------------------------------------------------
export function ReferentielFormDialog({
  open,
  onOpenChange,
  slug,
  item,
  title,
}: Props) {
  const { create, update } = useReferentielsPaie(slug);
  const isEdit = !!item;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      code: "",
      libelle: "",
      description: "",
      ordre: 0,
      actif: true,
    },
  });

  // Pré-remplit le formulaire à l'ouverture en mode édition
  useEffect(() => {
    if (open) {
      form.reset({
        code: item?.code ?? "",
        libelle: item?.libelle ?? "",
        description: item?.description ?? "",
        ordre: item?.ordre ?? 0,
        actif: item?.actif ?? true,
      });
    }
  }, [open, item, form]);

  const onSubmit = async (values: FormValues) => {
    const payload = {
      ...values,
      description: values.description?.trim() || null,
    };

    if (isEdit && item) {
      await update.mutateAsync({ id: item.id, payload });
    } else {
      await create.mutateAsync(payload);
    }
    onOpenChange(false);
  };

  const isPending = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Modifiez les informations puis enregistrez."
              : "Renseignez les informations de ce nouvel élément."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4 py-2"
          >
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Code *</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Ex: SAL_BASE"
                      onChange={(e) =>
                        field.onChange(e.target.value.toUpperCase())
                      }
                    />
                  </FormControl>
                  <FormDescription>
                    Identifiant technique unique. MAJUSCULES, chiffres et `_`
                    autorisés.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="libelle"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Libellé *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Ex: Salaire de base" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={3}
                      placeholder="Description détaillée (optionnelle)"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="ordre"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ordre d'affichage</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} max={9999} {...field} />
                    </FormControl>
                    <FormDescription className="text-xs">
                      Plus petit = plus haut dans la liste
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="actif"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Actif</FormLabel>
                    <FormControl>
                      <div className="flex items-center h-10">
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                        <span className="ml-3 text-sm text-muted-foreground">
                          {field.value
                            ? "Visible dans les listes"
                            : "Masqué des listes"}
                        </span>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending
                  ? "Enregistrement…"
                  : isEdit
                  ? "Enregistrer"
                  : "Créer"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
