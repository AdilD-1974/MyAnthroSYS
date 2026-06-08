/**
 * ParametragePaiePage – Paramétrage réglementaire de la paie.
 * Page principale avec sous-menus (onglets) et navigation liste ↔ formulaire.
 */
import React, { useState } from "react";
import { Settings, List, BookOpen, Calculator, FileText, Hash, Shield, CalendarDays, Timer } from "lucide-react";
import RubriquesList from "./RubriquesList";
import RubriqueForm from "./RubriqueForm";
import ConstantesList from "./ConstantesList";
import CotisationsList from "./CotisationsList";
import CotisationForm from "./CotisationForm";
import CalendrierPaiePage from "./CalendrierPaiePage";
import FrequencesCalendrierSettings from "./FrequencesCalendrierSettings";
import ReglesCalculTabs from "./regles/ReglesCalculTabs";

type SubMenu = "rubriques" | "constantes" | "cotisations" | "calendrier" | "frequences" | "familles" | "regles";
type View = { type: "list" } | { type: "form"; code: string | null; duplicateCode?: string | null };

const SUB_MENUS: { key: SubMenu; label: string; icon: React.ElementType }[] = [
  { key: "rubriques", label: "Rubriques", icon: List },
  { key: "constantes", label: "Constantes", icon: Hash },
  { key: "cotisations", label: "Cotisations", icon: Shield },
  { key: "calendrier", label: "Calendrier", icon: CalendarDays },
  { key: "frequences", label: "Fréquences", icon: Timer },
  { key: "familles", label: "Familles & Types", icon: BookOpen },
  { key: "regles", label: "Règles de calcul", icon: Calculator },
];

const ParametragePaiePage: React.FC = () => {
  const [activeMenu, setActiveMenu] = useState<SubMenu>("rubriques");
  const [view, setView] = useState<View>({ type: "list" });

  const handleMenuChange = (menu: SubMenu) => {
    setActiveMenu(menu);
    setView({ type: "list" });
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header global */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-xl bg-accent/10">
          <Settings size={20} className="text-accent" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Paramétrage réglementaire de la paie</h1>
          <p className="text-xs text-muted-foreground">Configuration des rubriques, familles, règles et imputations comptables</p>
        </div>
      </div>

      {/* Sous-menus / onglets */}
      <div className="flex items-center gap-1 mb-6 border-b border-border">
        {SUB_MENUS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => handleMenuChange(key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeMenu === key
                ? "border-accent text-accent"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {/* Contenu */}
      {activeMenu === "rubriques" && (
        <>
          {view.type === "list" ? (
            <RubriquesList
              onNew={() => setView({ type: "form", code: null })}
              onEdit={(code) => setView({ type: "form", code })}
              onDuplicate={(code) => setView({ type: "form", code: null, duplicateCode: code })}
            />
          ) : (
            <RubriqueForm
              editCode={view.code}
              duplicateCode={view.duplicateCode || null}
              onBack={() => setView({ type: "list" })}
              onSwitchTo={(code) => setView({ type: "form", code })}
            />
          )}
        </>
      )}

      {activeMenu === "constantes" && <ConstantesList />}

      {activeMenu === "cotisations" && (
        <>
          {view.type === "list" ? (
            <CotisationsList
              onNew={() => setView({ type: "form", code: null })}
              onEdit={(id) => setView({ type: "form", code: id })}
            />
          ) : (
            <CotisationForm
              editId={view.code}
              onBack={() => setView({ type: "list" })}
            />
          )}
        </>
      )}

      {activeMenu === "calendrier" && <CalendrierPaiePage />}

      {activeMenu === "frequences" && <FrequencesCalendrierSettings />}

      {activeMenu === "familles" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          <div className="group relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-violet-500/10 via-background to-background p-6 transition-all hover:shadow-lg hover:border-violet-500/30">
            <div className="absolute top-4 right-4 p-3 rounded-xl bg-violet-500/15 text-violet-600 group-hover:scale-110 transition-transform">
              <BookOpen size={24} />
            </div>
            <div className="mt-8">
              <h3 className="text-lg font-semibold text-foreground mb-2">Familles de rubriques</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Organisez vos rubriques de paie par familles logiques (Brut, Net, Cotisations, Avantages...) pour une meilleure lisibilité et gestion.
              </p>
              <div className="mt-4 flex items-center gap-2 text-xs font-medium text-violet-600">
                <span className="px-2 py-1 rounded-full bg-violet-500/10">5 familles actives</span>
              </div>
            </div>
          </div>

          <div className="group relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-amber-500/10 via-background to-background p-6 transition-all hover:shadow-lg hover:border-amber-500/30">
            <div className="absolute top-4 right-4 p-3 rounded-xl bg-amber-500/15 text-amber-600 group-hover:scale-110 transition-transform">
              <List size={24} />
            </div>
            <div className="mt-8">
              <h3 className="text-lg font-semibold text-foreground mb-2">Types de rubriques</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Définissez les types de calcul (Base, Calculée, Cotisation, Imposable...) pour structurer votre bulletin de paie.
              </p>
              <div className="mt-4 flex items-center gap-2 text-xs font-medium text-amber-600">
                <span className="px-2 py-1 rounded-full bg-amber-500/10">4 types définis</span>
              </div>
            </div>
          </div>

          <div className="group relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-emerald-500/10 via-background to-background p-6 transition-all hover:shadow-lg hover:border-emerald-500/30">
            <div className="absolute top-4 right-4 p-3 rounded-xl bg-emerald-500/15 text-emerald-600 group-hover:scale-110 transition-transform">
              <FileText size={24} />
            </div>
            <div className="mt-8">
              <h3 className="text-lg font-semibold text-foreground mb-2">Flux & Fréquences</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Configurez les sens de flux (Gain/Retenue) et les fréquences de paiement pour chaque rubrique.
              </p>
              <div className="mt-4 flex items-center gap-2 text-xs font-medium text-emerald-600">
                <span className="px-2 py-1 rounded-full bg-emerald-500/10">2 flux • 3 fréquences</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeMenu === "regles" && <ReglesCalculTabs />}

    </div>
  );
};

export default ParametragePaiePage;
