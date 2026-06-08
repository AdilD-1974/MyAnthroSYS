/**
 * Page : Paramétrage paie → Référentiels.
 *
 * Un onglet par référentiel. Le composant `ReferentielTable` ci-dessous est
 * réutilisé pour les 5 onglets (lecture/recherche/édition/désactivation).
 *
 * Route suggérée :
 *   /paie/referentiels   (à ajouter dans le routeur React de l'app)
 */
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  REFERENTIELS_META,
  type ReferentielSlug,
} from "@/hooks/useReferentielsPaie";
import { ReferentielTable } from "@/components/paie/referentiels/ReferentielTable";

const SLUGS: ReferentielSlug[] = [
  "familles",
  "types",
  "flux",
  "frequences",
  "zones-fixes",
];

export default function ReferentielsPaiePage() {
  const [active, setActive] = useState<ReferentielSlug>("familles");

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Référentiels de paie
        </h1>
        <p className="text-sm text-muted-foreground">
          Gérez les valeurs disponibles dans les listes déroulantes du
          formulaire de configuration des rubriques (Famille, Type, Flux,
          Fréquence, Zone fixe).
        </p>
      </div>

      <Tabs
        value={active}
        onValueChange={(v) => setActive(v as ReferentielSlug)}
        className="w-full"
      >
        <TabsList className="grid grid-cols-5 w-full max-w-3xl">
          {SLUGS.map((slug) => (
            <TabsTrigger key={slug} value={slug}>
              {REFERENTIELS_META[slug].label}
            </TabsTrigger>
          ))}
        </TabsList>

        {SLUGS.map((slug) => (
          <TabsContent key={slug} value={slug} className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>{REFERENTIELS_META[slug].label}</CardTitle>
              </CardHeader>
              <CardContent>
                <ReferentielTable slug={slug} />
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
