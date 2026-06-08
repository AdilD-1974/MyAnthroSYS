/**
 * ReglesCalculTabs – Conteneur des 3 sous-onglets du module "Règles de calcul"
 * (Standards / Spécifiques / Barèmes).
 */
import React, { useState } from "react";
import { BookOpenCheck, Sparkles, Table2, Shield } from "lucide-react";
import ReglesStandardsList from "./ReglesStandardsList";
import ReglesSpecifiquesList from "./ReglesSpecifiquesList";
import ReglesCotisationList from "./ReglesCotisationList";
// ⚠️ Ancien composant remplacé par le nouveau (refonte multi-clés / multi-sorties)
// import BaremesList from "./BaremesList";
import { BaremesListPage } from "@/pages/paie/parametrage/BaremesPages";

type SubTab = "standards" | "specifiques" | "cotisations" | "baremes";

const TABS: { key: SubTab; label: string; icon: React.ElementType; description: string }[] = [
  { key: "standards", label: "Règles standards", icon: BookOpenCheck, description: "Catalogue système prédéfini" },
  { key: "specifiques", label: "Règles spécifiques", icon: Sparkles, description: "Bibliothèque métier personnalisée" },
  { key: "cotisations", label: "Règles de cotisation", icon: Shield, description: "CNSS, AMO, IR, CIMR — taux et plafonds" },
  { key: "baremes", label: "Barèmes", icon: Table2, description: "Tables de correspondance clé → valeur" },
];

const ReglesCalculTabs: React.FC = () => {
  const [active, setActive] = useState<SubTab>("standards");

  return (
    <div>
      {/* Sous-onglets */}
      <div className="flex flex-wrap items-stretch gap-2 mb-5">
        {TABS.map(({ key, label, icon: Icon, description }) => {
          const isActive = active === key;
          return (
            <button
              key={key}
              onClick={() => setActive(key)}
              className={`group flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left ${
                isActive
                  ? "border-accent bg-accent/10 shadow-sm"
                  : "border-border bg-background hover:border-accent/40 hover:bg-accent/5"
              }`}
            >
              <div className={`p-2 rounded-lg ${isActive ? "bg-accent/20 text-accent" : "bg-muted text-muted-foreground group-hover:text-accent"}`}>
                <Icon size={18} />
              </div>
              <div>
                <div className={`text-sm font-semibold ${isActive ? "text-accent" : "text-foreground"}`}>{label}</div>
                <div className="text-[11px] text-muted-foreground">{description}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Contenu */}
      <div className="rounded-2xl border border-border bg-background p-5">
        {active === "standards" && <ReglesStandardsList />}
        {active === "specifiques" && <ReglesSpecifiquesList />}
        {active === "cotisations" && <ReglesCotisationList />}
        {active === "baremes" && <BaremesListPage />}
      </div>
    </div>
  );
};

export default ReglesCalculTabs;
