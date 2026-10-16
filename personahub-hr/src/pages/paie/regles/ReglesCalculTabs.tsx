/**
 * ReglesCalculTabs – conteneur de l'onglet « Règles de calcul »
 * (Paie / Paramétrage réglementaire), monté par ParametragePaiePage.tsx.
 *
 * 4 cartes de sélection (icône + libellé + sous-titre), carte active
 * surlignée par une bordure d'accent. Câblé sur les composants réels :
 *   - Règles standards     -> CatalogueReglesStandards (nouveau, catalogue statique repliable)
 *   - Règles spécifiques   -> ReglesSpecifiquesList (export default)
 *   - Règles de cotisation -> ReglesCotisationList (export default)
 *   - Barèmes              -> BaremesListPage (export nommé, gère elle-même
 *                              la navigation vers /paie/parametrage/baremes/new
 *                              et /paie/parametrage/baremes/:id)
 */
import React, { useState } from "react";
import { ListChecks, Sparkles, Landmark, Table2 } from "lucide-react";

import { CatalogueReglesStandards } from "./CatalogueReglesStandards";
import ReglesSpecifiquesList from "./ReglesSpecifiquesList";
import ReglesCotisationList from "./ReglesCotisationList";
import { BaremesListPage } from "../parametrage/BaremesPages";

type OngletRegle = "standards" | "specifiques" | "cotisation" | "baremes";

interface OngletDef {
  id: OngletRegle;
  libelle: string;
  sousTitre: string;
  icone: React.ElementType;
}

const ONGLETS: OngletDef[] = [
  { id: "standards", libelle: "Règles standards", sousTitre: "Catalogue système prédéfini", icone: ListChecks },
  { id: "specifiques", libelle: "Règles spécifiques", sousTitre: "Bibliothèque métier personnalisée", icone: Sparkles },
  { id: "cotisation", libelle: "Règles de cotisation", sousTitre: "CNSS, AMO, IR, CIMR — taux et plafonds", icone: Landmark },
  { id: "baremes", libelle: "Barèmes", sousTitre: "Tables de correspondance clé → valeur", icone: Table2 },
];

const ReglesCalculTabs: React.FC = () => {
  const [onglet, setOnglet] = useState<OngletRegle>("standards");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {ONGLETS.map((o) => (
          <SelecteurOnglet key={o.id} def={o} actif={onglet === o.id} onClick={() => setOnglet(o.id)} />
        ))}
      </div>

      <div>
        {onglet === "standards" && <CatalogueReglesStandards />}
        {onglet === "specifiques" && <ReglesSpecifiquesList />}
        {onglet === "cotisation" && <ReglesCotisationList />}
        {onglet === "baremes" && <BaremesListPage embedded />}
      </div>
    </div>
  );
};

function SelecteurOnglet({ def, actif, onClick }: { def: OngletDef; actif: boolean; onClick: () => void }) {
  const Icone = def.icone;
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border p-3 text-left transition-colors"
      style={
        actif
          ? { borderColor: "hsl(var(--accent))", borderWidth: 2, background: "hsl(var(--accent) / 0.06)" }
          : { borderColor: "hsl(var(--border))" }
      }
      onMouseEnter={(e) => {
        if (!actif) e.currentTarget.style.background = "hsl(var(--muted) / 0.4)";
      }}
      onMouseLeave={(e) => {
        if (!actif) e.currentTarget.style.background = "transparent";
      }}
    >
      <div className="mb-1 flex items-center gap-2">
        <Icone size={18} className="shrink-0" style={{ color: actif ? "hsl(var(--accent))" : "hsl(var(--muted-foreground))" }} />
        <span className="text-sm font-medium" style={{ color: actif ? "hsl(var(--accent))" : "hsl(var(--foreground))" }}>
          {def.libelle}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{def.sousTitre}</p>
    </button>
  );
}

export default ReglesCalculTabs;
