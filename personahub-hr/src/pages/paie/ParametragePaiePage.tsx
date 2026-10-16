/**
 * ParametragePaiePage – Paramétrage réglementaire de la paie.
 * Page principale avec sous-menus (onglets) et navigation liste ↔ formulaire.
 */
import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Settings, List, BookOpen, Calculator, FileText, Hash, CalendarDays, Timer, ArrowLeft } from "lucide-react";
import RubriquesList from "./RubriquesList";
import RubriqueForm from "./RubriqueForm";
import ConstantesList from "./ConstantesList";
import CalendrierPaiePage from "./CalendrierPaiePage";
import FrequencesCalendrierSettings from "./FrequencesCalendrierSettings";
import ReglesCalculTabs from "./regles/ReglesCalculTabs";
import RefSimpleList from "./RefSimpleList";

type SubMenu = "rubriques" | "constantes" | "calendrier" | "frequences" | "familles" | "regles";
type View = { type: "list" } | { type: "form"; code: string | null; duplicateCode?: string | null };

const SUB_MENUS: { key: SubMenu; label: string; icon: React.ElementType }[] = [
  { key: "rubriques", label: "Rubriques", icon: List },
  { key: "constantes", label: "Constantes", icon: Hash },
  { key: "calendrier", label: "Calendrier", icon: CalendarDays },
  { key: "frequences", label: "Fréquences", icon: Timer },
  { key: "familles", label: "Familles & Types", icon: BookOpen },
  { key: "regles", label: "Règles de calcul", icon: Calculator },
];

// Cartes "Familles & Types" : couleurs pilotées par les tokens du thème
// (personnalisables par le collaborateur dans Apparence), pas de teintes figées.
const FAMILLES_CARDS: {
  token: "primary" | "secondary" | "accent" | "warning" | "info" | "success";
  icon: React.ElementType;
  title: string;
  description: string;
  badge: string;
  // RG-FAMILLES-NAVIGATION-01 (Adil DAIA) : tables réelles à ouvrir au clic —
  // ces cartes étaient jusqu'ici purement décoratives (aucun onClick),
  // d'où "je clique et je ne vois rien". "Flux & Fréquences" couvre deux
  // tables distinctes, affichées l'une sous l'autre dans la même sous-vue.
  tables: { table: string; titre: string; placeholderCode?: string }[];
}[] = [
  {
    token: "accent",
    icon: BookOpen,
    title: "Familles de rubriques",
    description:
      "Organisez vos rubriques de paie par familles logiques (Brut, Net, Cotisations, Avantages...) pour une meilleure lisibilité et gestion.",
    badge: "5 familles actives",
    tables: [{ table: "ref_famille_rubrique_paie", titre: "Familles de rubriques", placeholderCode: "BRUT" }],
  },
  {
    token: "warning",
    icon: List,
    title: "Types de rubriques",
    description:
      "Définissez les types de calcul (Base, Calculée, Cotisation, Imposable...) pour structurer votre bulletin de paie.",
    badge: "4 types définis",
    tables: [{ table: "ref_type_rubrique_paie", titre: "Types de rubriques", placeholderCode: "CALC" }],
  },
  {
    token: "success",
    icon: FileText,
    title: "Flux & Fréquences",
    description:
      "Configurez les sens de flux (Gain/Retenue) et les fréquences de paiement pour chaque rubrique.",
    badge: "2 flux • 3 fréquences",
    tables: [
      { table: "ref_flux_rubrique_paie", titre: "Sens de flux", placeholderCode: "GAIN" },
      { table: "ref_frequence_rubrique_paie", titre: "Fréquences", placeholderCode: "PERIODIQUE" },
    ],
  },
];

const ParametragePaiePage: React.FC = () => {
  const location = useLocation();
  const [activeMenu, setActiveMenu] = useState<SubMenu>("rubriques");
  const [view, setView] = useState<View>({ type: "list" });
  // RG-FAMILLES-NAVIGATION-01 : quelle carte "Familles & Types" est ouverte (null = grille de cartes)
  const [familleOuverte, setFamilleOuverte] = useState<number | null>(null);

  // RG-RUB-OUVERTURE-DIRECTE-01 (Adil DAIA) : arrivée depuis un double-clic sur
  // une ligne de bulletin (TraitementPaiePage → ouvrirRubrique) ou tout autre
  // écran qui navigue ici avec `state: { openRubrique: code }`. Sans ce hook,
  // on atterrissait toujours sur la liste des Rubriques au lieu du formulaire
  // de la rubrique visée — ne s'exécute qu'au montage, une seule fois.
  useEffect(() => {
    const st = location.state as { openRubrique?: string } | null;
    if (st?.openRubrique) {
      setActiveMenu("rubriques");
      setView({ type: "form", code: st.openRubrique });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMenuChange = (menu: SubMenu) => {
    setActiveMenu(menu);
    setView({ type: "list" });
    setFamilleOuverte(null);
  };

  return (
    <div className="max-w-[1800px] mx-auto">
      {/* Fil d'Ariane */}
      <div className="flex items-center gap-1.5 px-6 pt-4 pb-2 text-[13px]" style={{ color: "hsl(var(--muted-foreground))" }}>
        <span>Paie</span>
        <span style={{ opacity: 0.5 }}>/</span>
        <span className="font-semibold" style={{ color: "hsl(var(--foreground))" }}>Paramétrage réglementaire</span>
      </div>

      {/* Onglets façon "notebook" Odoo — boîtes connectées au panneau de contenu,
          identique au pattern utilisé sur la Fiche Collaborateur / Organisations */}
      <div className="flex gap-0.5 px-6 -mb-px relative z-[1] overflow-x-auto">
        {SUB_MENUS.map(({ key, label, icon: Icon }) => {
          const active = activeMenu === key;
          return (
            <button
              key={key}
              onClick={() => handleMenuChange(key)}
              className="flex items-center gap-2 px-4 py-2.5 text-[13px] whitespace-nowrap transition-all duration-150"
              style={{
                color: active ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                fontWeight: active ? 600 : 500,
                background: active ? "hsl(var(--card))" : "hsl(var(--muted) / 0.5)",
                border: "1px solid hsl(var(--border))",
                borderBottom: active ? "1px solid hsl(var(--card))" : "1px solid hsl(var(--border))",
                borderTopLeftRadius: "var(--radius)",
                borderTopRightRadius: "var(--radius)",
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = "hsl(var(--foreground))"; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = "hsl(var(--muted-foreground))"; }}
            >
              <Icon size={15} style={{ color: active ? "hsl(var(--primary))" : "currentColor" }} />
              {label}
            </button>
          );
        })}
      </div>

      {/* Panneau de contenu */}
      <div
        className="p-6"
        style={{
          border: "1px solid hsl(var(--border))",
          borderRadius: "var(--radius)",
          background: "hsl(var(--card))",
        }}
      >
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

        {activeMenu === "calendrier" && <CalendrierPaiePage />}

        {activeMenu === "frequences" && <FrequencesCalendrierSettings />}

        {activeMenu === "familles" && (
          familleOuverte === null ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {FAMILLES_CARDS.map(({ token, icon: Icon, title, description, badge }, idx) => (
                <button
                  key={title}
                  onClick={() => setFamilleOuverte(idx)}
                  className="group relative overflow-hidden p-6 text-left transition-all"
                  style={{
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "var(--radius)",
                    background: `linear-gradient(135deg, hsl(var(--${token}) / 0.08), hsl(var(--card)) 70%)`,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = `hsl(var(--${token}) / 0.35)`;
                    e.currentTarget.style.boxShadow = `0 4px 20px hsl(var(--${token}) / 0.12)`;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "hsl(var(--border))";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                >
                  <div
                    className="absolute top-4 right-4 p-3 rounded-xl transition-transform group-hover:scale-110"
                    style={{ background: `hsl(var(--${token}) / 0.15)`, color: `hsl(var(--${token}))` }}
                  >
                    <Icon size={24} />
                  </div>
                  <div className="mt-8">
                    <h3 className="text-lg font-semibold mb-2" style={{ color: "hsl(var(--foreground))" }}>
                      {title}
                    </h3>
                    <p className="text-sm leading-relaxed" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {description}
                    </p>
                    <div className="mt-4 flex items-center gap-2 text-xs font-medium" style={{ color: `hsl(var(--${token}))` }}>
                      <span className="px-2 py-1 rounded-full" style={{ background: `hsl(var(--${token}) / 0.1)` }}>
                        {badge}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div>
              <button
                onClick={() => setFamilleOuverte(null)}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
              >
                <ArrowLeft size={14} /> Retour
              </button>
              <div className="space-y-8">
                {FAMILLES_CARDS[familleOuverte].tables.map((t) => (
                  <RefSimpleList key={t.table} table={t.table} titre={t.titre} placeholderCode={t.placeholderCode} />
                ))}
              </div>
            </div>
          )
        )}

        {activeMenu === "regles" && <ReglesCalculTabs />}
      </div>
    </div>
  );
};

export default ParametragePaiePage;
