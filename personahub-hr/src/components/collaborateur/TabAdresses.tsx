/**
 * TabAdresses — onglet "Adresses" de la fiche collaborateur.
 *
 * Style aligné sur TabContrats :
 *   - SectionCard avec titre + icône + bouton "Ajouter"
 *   - Cartes d'adresse avec border accent pour la principale
 *   - Helper Field pour les libellés
 *   - Bouton crayon en `p-1.5 rounded` (pas un composant Button)
 *   - Spinner custom (pas Loader2)
 */
import { useState } from "react";
import { MapPin, Pencil, Plus, Archive } from "lucide-react";

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
  useCollaborateurAdresses,
  type CollaborateurAdresse,
} from "@/hooks/useCollaborateurAdresses";
import { AdresseFormDialog } from "./AdresseFormDialog";

// ---------------------------------------------------------------------------
// Helpers locaux (alignés sur ceux de FicheCollaborateur.tsx)
// ---------------------------------------------------------------------------
const Field: React.FC<{ label: string; value?: string | null; className?: string }> = ({
  label, value, className,
}) => (
  <div className={className}>
    <p className="text-xs font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
      {label}
    </p>
    <p
      className="text-sm font-medium"
      style={{
        color: value
          ? "hsl(var(--foreground))"
          : "hsl(var(--muted-foreground) / 0.5)",
      }}
    >
      {value || "—"}
    </p>
  </div>
);

const SectionCard: React.FC<{
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}> = ({ title, icon, children, action }) => (
  <div
    className="rounded-xl border p-5 mb-4"
    style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
  >
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        {icon && <span style={{ color: "hsl(var(--accent))" }}>{icon}</span>}
        <h3 className="font-semibold text-sm" style={{ color: "hsl(var(--foreground))" }}>
          {title}
        </h3>
      </div>
      {action}
    </div>
    {children}
  </div>
);

// ---------------------------------------------------------------------------
// Composant principal
// ---------------------------------------------------------------------------
interface Props {
  collaborateurId: string;
}

const TabAdresses: React.FC<Props> = ({ collaborateurId }) => {
  const { adresses, isLoading, archive } = useCollaborateurAdresses(collaborateurId);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CollaborateurAdresse | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<CollaborateurAdresse | null>(null);

  const handleNew = () => {
    setEditing(null);
    setShowForm(true);
  };

  const handleEdit = (a: CollaborateurAdresse) => {
    setEditing(a);
    setShowForm(true);
  };

  // Adresse principale active pour l'alerte d'en-tête (équivalent du "contrat en cours")
  const adressePrincipale = adresses.find(
    (a) => a.is_adresse_principale && !a.archive,
  );

  return (
    <>
      {/* Alerte adresse principale (style identique à l'alerte contrat en cours) */}
      {adressePrincipale && (
        <div
          className="mb-4 px-4 py-2.5 rounded-lg text-xs flex items-center gap-2 border"
          style={{
            background: "hsl(84 55% 50% / 0.08)",
            borderColor: "hsl(84 55% 50% / 0.25)",
            color: "hsl(84 55% 32%)",
          }}
        >
          <span className="text-base">🏠</span>
          <span>
            Adresse principale :{" "}
            <strong>{adressePrincipale.adresse}</strong>
            {adressePrincipale.libelle_ville && ` — ${adressePrincipale.libelle_ville}`}
            {adressePrincipale.code_postal && ` (${adressePrincipale.code_postal})`}
          </span>
        </div>
      )}

      <SectionCard
        title="Liste des adresses"
        icon={<MapPin size={15} />}
        action={
          <button
            onClick={handleNew}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: "hsl(var(--accent))", color: "white" }}
          >
            <Plus size={12} />
            Nouvelle adresse
          </button>
        }
      >
        {isLoading ? (
          <div className="h-20 flex items-center justify-center">
            <div
              className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
              style={{
                borderColor: "hsl(var(--accent))",
                borderTopColor: "transparent",
              }}
            />
          </div>
        ) : adresses.length === 0 ? (
          <p className="text-sm text-center py-8" style={{ color: "hsl(var(--muted-foreground))" }}>
            Aucune adresse enregistrée
          </p>
        ) : (
          <div className="space-y-3">
            {adresses.map((a) => {
              const isPrincipale = a.is_adresse_principale && !a.archive;
              return (
                <div
                  key={a.id}
                  className="rounded-lg p-4 border"
                  style={{
                    borderColor: isPrincipale
                      ? "hsl(84 55% 50% / 0.4)"
                      : "hsl(var(--border))",
                    background: isPrincipale
                      ? "hsl(84 55% 50% / 0.04)"
                      : "hsl(var(--muted) / 0.3)",
                    opacity: a.archive ? 0.55 : 1,
                  }}
                >
                  {/* Bandeau de rôles + actions */}
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {a.is_adresse_principale && (
                        <span
                          className="text-xs font-semibold px-2 py-0.5 rounded-full"
                          style={{
                            background: "hsl(84 55% 50% / 0.15)",
                            color: "hsl(84 55% 35%)",
                          }}
                        >
                          Principale
                        </span>
                      )}
                      {a.is_adresse_correspondance && (
                        <span
                          className="text-xs font-semibold px-2 py-0.5 rounded-full"
                          style={{
                            background: "hsl(215 30% 55% / 0.15)",
                            color: "hsl(215 30% 40%)",
                          }}
                        >
                          Correspondance
                        </span>
                      )}
                      {a.is_adresse_residence && (
                        <span
                          className="text-xs font-semibold px-2 py-0.5 rounded-full"
                          style={{
                            background: "hsl(265 40% 60% / 0.15)",
                            color: "hsl(265 40% 45%)",
                          }}
                        >
                          Résidence
                        </span>
                      )}
                      {a.is_adresse_professionnelle && (
                        <span
                          className="text-xs font-semibold px-2 py-0.5 rounded-full"
                          style={{
                            background: "hsl(35 80% 55% / 0.15)",
                            color: "hsl(35 80% 40%)",
                          }}
                        >
                          Professionnelle
                        </span>
                      )}
                      {a.archive && (
                        <span
                          className="text-xs font-semibold px-2 py-0.5 rounded-full"
                          style={{
                            background: "hsl(var(--muted))",
                            color: "hsl(var(--muted-foreground))",
                          }}
                        >
                          Archivée
                        </span>
                      )}
                    </div>

                    {/* Actions (style aligné sur TabContrats : bouton crayon couleur accent) */}
                    {!a.archive && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => handleEdit(a)}
                          className="p-1.5 rounded"
                          style={{ color: "hsl(var(--accent))" }}
                          title="Modifier"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => setConfirmArchive(a)}
                          className="p-1.5 rounded"
                          style={{ color: "hsl(var(--muted-foreground))" }}
                          title="Archiver"
                        >
                          <Archive size={14} />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Champs en grille (4 colonnes comme TabContrats) */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Field
                      label="Adresse"
                      value={a.adresse}
                      className="md:col-span-2"
                    />
                    <Field label="Complément" value={a.complement_adresse} />
                    <Field label="Code postal" value={a.code_postal} />
                    <Field label="Ville" value={a.libelle_ville} />
                    <Field label="Région" value={a.libelle_region} />
                    <Field label="Pays" value={a.libelle_pays} />
                    <Field label="Téléphone" value={a.telephone} />
                    {a.telephone_bis && (
                      <Field label="Téléphone bis" value={a.telephone_bis} />
                    )}
                    {a.email && <Field label="Email" value={a.email} />}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* Modale création / édition */}
      <AdresseFormDialog
        open={showForm}
        onOpenChange={setShowForm}
        collaborateurId={collaborateurId}
        adresse={editing}
      />

      {/* Confirmation archivage */}
      <AlertDialog
        open={!!confirmArchive}
        onOpenChange={(o) => !o && setConfirmArchive(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archiver cette adresse ?</AlertDialogTitle>
            <AlertDialogDescription>
              L'adresse sera masquée mais restera consultable dans l'historique.
              {confirmArchive?.is_adresse_principale && (
                <span className="block mt-2 text-destructive">
                  ⚠️ Cette adresse est marquée comme principale. Assurez-vous d'avoir
                  une autre adresse principale active avant d'archiver celle-ci.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmArchive) archive.mutate({ id: confirmArchive.id });
                setConfirmArchive(null);
              }}
            >
              Archiver
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default TabAdresses;
