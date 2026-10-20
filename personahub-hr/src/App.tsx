import React, { Suspense, lazy } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { NavProvider } from "@/contexts/NavContext";
import { ReadOnlyWrapper } from "@/contexts/ManagerContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";

// ─── Lazy loading : chaque page chargée uniquement à la première visite ───────
const LoginPage               = lazy(() => import("@/pages/LoginPage"));
const Dashboard               = lazy(() => import("@/pages/Dashboard"));
const AccueilLauncher         = lazy(() => import("@/pages/AccueilLauncher"));
const GestionEnfantsPage      = lazy(() => import("@/pages/famille/GestionEnfantsPage"));
const ReferentielsPage        = lazy(() => import("@/pages/ReferentielsPage"));
const UtilisateursPage        = lazy(() => import("@/pages/UtilisateursPage"));
const HabilitationsPage       = lazy(() => import("@/pages/admin/HabilitationsPage"));
const LicencePage             = lazy(() => import("@/pages/LicencePage"));
const OrganisationsPage       = lazy(() => import("@/pages/OrganisationsPage"));
const CollaborateursPage      = lazy(() => import("@/pages/CollaborateursPage"));
const FicheCollaborateur      = lazy(() => import("@/pages/FicheCollaborateur"));
const NouveauCollaborateur    = lazy(() => import("@/pages/NouveauCollaborateur"));
const ProfilePage             = lazy(() => import("@/pages/ProfilePage"));
const AppearancePage          = lazy(() => import("@/pages/AppearancePage"));
const ParametresRHPage        = lazy(() => import("@/pages/ParametresRHPage"));
const PostesPage              = lazy(() => import("@/pages/PostesPage"));
const GpecPage                = lazy(() => import("@/pages/GpecPage"));
const ReportingKpiPage        = lazy(() => import("@/pages/ReportingKpiPage"));
const TypeCongesPage          = lazy(() => import("@/pages/TypeCongesPage"));
const BaremesDroitsPage        = lazy(() => import("@/pages/BaremesDroitsPage"));
const JoursFeriesPage         = lazy(() => import("@/pages/JoursFeriesPage"));
const CompteurCongesPage      = lazy(() => import("@/pages/absences/CompteurCongesPage"));
const SaisieCongesPage        = lazy(() => import("@/pages/absences/SaisieCongesPage"));
const SaisieDirecteCongePage  = lazy(() => import("@/pages/absences/SaisieDirecteCongePage"));
const SuiviCongesPage         = lazy(() => import("@/pages/absences/SuiviCongesPage"));
const ListeCongesPage         = lazy(() => import("@/pages/absences/ListeCongesPage"));
const PlanningCongesPage      = lazy(() => import("@/pages/absences/PlanningCongesPage"));
const ValidationDemandesPage  = lazy(() => import("@/pages/absences/ValidationDemandesPage"));
const GestionDepartsPage      = lazy(() => import("@/pages/GestionDepartsPage"));
const CalendrierPage          = lazy(() => import("@/pages/CalendrierPage"));
const TrombinoscopePage       = lazy(() => import("@/pages/TrombinoscopePage"));
const MouvementsPage          = lazy(() => import("@/pages/MouvementsPage"));
const DepartsProvisoiresPage  = lazy(() => import("@/pages/DepartsProvisoires/DepartsProvisoiresPage"));
const MotifsDepartProvisoirePage = lazy(() => import("@/pages/DepartsProvisoires/MotifsDepartProvisoirePage"));
const ParametragePaiePage     = lazy(() => import("@/pages/paie/ParametragePaiePage"));
const SaisieIndividuellePage  = lazy(() => import("@/pages/paie/preparation/SaisieIndividuellePage"));
const SaisieMassePage         = lazy(() => import("@/pages/paie/preparation/SaisieMassePage"));
const ImportExcelPage         = lazy(() => import("@/pages/paie/preparation/ImportExcelPage"));
const RecuperationModulesPage = lazy(() => import("@/pages/paie/preparation/RecuperationModulesPage"));
const HistoriquePaiePage      = lazy(() => import("@/pages/paie/consultation/HistoriquePaiePage"));
const VueEnsemblePaiePage     = lazy(() => import("@/pages/paie/consultation/VueEnsemblePaiePage"));  // synthèse annuelle + comparatif (nouveau)
const HistoriqueCollaborateurPage = lazy(() => import("@/pages/paie/consultation/HistoriqueCollaborateurPage"));  // talons détachables, parcours visuel (nouveau)
const RechercheBulletinsPage  = lazy(() => import("@/pages/paie/consultation/RechercheBulletinsPage"));  // recherche transverse, tous collaborateurs (nouveau)
const AnomaliesPaiePage       = lazy(() => import("@/pages/paie/consultation/AnomaliesPaiePage"));  // bulletins en erreur/avertissement (nouveau)
const ConsultationBulletinPage = lazy(() => import("@/pages/paie/consultation/ConsultationBulletinPage"));  // détail d'un bulletin validé/clôturé, lecture seule (Adil DAIA)
const JournalGrilleConfigPage = lazy(() => import("@/pages/paie/rapports/JournalGrilleConfigPage"));  // config Journal grille officielle (nouveau)
const RapportTemplatesPage    = lazy(() => import("@/pages/paie/rapports/RapportTemplatesPage"));  // liste des Journaux/Bulletins (nouveau)
const BulletinConfigPage      = lazy(() => import("@/pages/paie/rapports/BulletinConfigPage"));  // config des 5 modèles de Bulletin (nouveau)
const FormatMasksSettings     = lazy(() => import("@/components/FormatMasksSettings"));
const MonEspacePage           = lazy(() => import("@/pages/espaces/MonEspacePage"));
const MesDelegationsPage      = lazy(() => import("@/pages/espaces/MesDelegationsPage"));
const ChatPage                = lazy(() => import("@/pages/espaces/ChatPage"));
const MonEquipePage           = lazy(() => import("@/pages/espaces/MonEquipePage"));
const ManagerSpace            = lazy(() => import("@/pages/espaces/ManagerSpace"));
const CongesPage              = lazy(() => import("@/pages/espaces/manager/conges/CongesPage"));
const GestionDemandesPage     = lazy(() => import("@/pages/espaces/manager/GestionDemandesPage"));
const GestionRolesPage        = lazy(() => import("@/pages/configuration/acces/GestionRolesPage"));
const EspacesAccessPage       = lazy(() => import("@/pages/configuration/acces/EspacesAccessPage"));
const WorkflowDesignerPage    = lazy(() => import("@/pages/configuration/WorkflowDesignerPage"));
const WorkflowRolesPage       = lazy(() => import("@/pages/configuration/WorkflowRolesPage"));
const CatalogueVariablesPage  = lazy(() => import("@/pages/configuration/CatalogueVariablesPage"));
const NotificationTemplatesPage = lazy(() => import("@/pages/configuration/NotificationTemplatesPage"));
const EmailConfigPage         = lazy(() => import("@/pages/configuration/EmailConfigPage"));
const SmsConfigPage           = lazy(() => import("@/pages/configuration/SmsConfigPage"));
const DocumentTemplatesPage   = lazy(() => import("@/pages/configuration/DocumentTemplatesPage"));
// Barèmes paie — 3 routes (liste, création, édition) — RG-PAIE-BAR-01 (Adil DAIA)
const BaremesListPage         = lazy(() => import("@/pages/paie/parametrage/BaremesPages").then(m => ({ default: m.BaremesListPage })));
const BaremeNewPage           = lazy(() => import("@/pages/paie/parametrage/BaremesPages").then(m => ({ default: m.BaremeNewPage })));
const BaremeEditPage          = lazy(() => import("@/pages/paie/parametrage/BaremesPages").then(m => ({ default: m.BaremeEditPage })));
// Populations de paie (attribution des rubriques) — RG-POPULATION-RUBRIQUE-01 (Adil DAIA)
const PopulationsPaiePage     = lazy(() => import("@/pages/paie/parametrage/PopulationsPaiePage"));
const DeclarationCnssPage     = lazy(() => import("@/pages/paie/DeclarationCnssPage"));
const DeclarationCimrPage     = lazy(() => import("@/pages/paie/DeclarationCimrPage"));
const DeclarationIrPage       = lazy(() => import("@/pages/paie/DeclarationIrPage"));  // Déclaration IR - État 9421 / DTS (nouveau)
const VueDeclarationsPage     = lazy(() => import("@/pages/paie/VueDeclarationsPage"));
const TraitementPaiePage      = lazy(() => import("@/pages/paie/TraitementPaiePage"));  // moteur de paie (Adil DAIA)
const EtatsPage               = lazy(() => import("@/pages/configuration/Editions/EtatsPage"));  // ✅ GÉNÉRATEUR D'ÉTATS (MODULE_ETATS_PAIE.md)
const EtatNouveauPage         = lazy(() => import("@/pages/configuration/Editions/EtatNouveauPage"));  // ✅ Assistant de création (4 étapes, §15.5)
const EditionsPage            = lazy(() => import("@/pages/editions/EditionsPage"));             // ✅ ÉDITIONS UNIFIÉES — bibliothèque et lancement
const EditionsDesignerPage    = lazy(() => import("@/pages/editions/designer/DesignerPage"));    // ✅ ÉDITIONS UNIFIÉES — designer (lot 2)
const EditionsDictionnairePage = lazy(() => import("@/pages/editions/DictionnairePage"));     // ✅ ÉDITIONS — dictionnaire des données (RG-EDT-DICO, Adil DAIA)
const EditionsPaiePage        = lazy(() => import("@/pages/editions/MenuEditions").then(m => ({ default: m.EditionsPaiePage })));  // ✅ Paie › Éditions de la paie, arborescence (RG-EDT-MENU-01, Adil DAIA)
const ClotureAnnuellePage     = lazy(() => import("@/pages/paie/ClotureAnnuellePage"));  // clôture annuelle (Adil DAIA)
const LancementPaiePage       = lazy(() => import("@/pages/paie/LancementPaiePage"));    // lancement en masse (Adil DAIA)
const VueTraitementPage       = lazy(() => import("@/pages/paie/VueTraitementPage"));     // vue d'ensemble traitement (Adil DAIA)
// Module Simulation individuelle (UC1 Bulletin / UC2 Impact / UC3 Embauche)
const SimulationIndividuellePage = lazy(() => import("@/pages/paie/simulation/SimulationIndividuellePage"));
const MesScenariosPage        = lazy(() => import("@/pages/paie/simulation/MesScenariosPage"));
const SimulationPopulationPage = lazy(() => import("@/pages/paie/simulation/SimulationPopulationPage"));  // lancement en masse par population (Adil DAIA)
const ConsultationSimulationsPage = lazy(() => import("@/pages/paie/simulation/ConsultationSimulationsPage"));  // historique/consultation des lancements (Adil DAIA)
const CloturePeriodePage      = lazy(() => import("@/pages/paie/CloturePeriodePage"));   // clôture de période (Adil DAIA)
const GenerationEcrituresPage = lazy(() => import("@/pages/paie/compta/GenerationEcrituresPage"));  // comptabilisation de la paie — génération (nouveau)
const ExportComptaPage        = lazy(() => import("@/pages/paie/compta/ExportComptaPage"));         // comptabilisation de la paie — export (nouveau)
const VueComptabilitePage     = lazy(() => import("@/pages/paie/compta/VueComptabilitePage"));       // comptabilisation de la paie — vue d'ensemble (nouveau)
const SalairesFixesPage       = lazy(() => import("@/pages/SalairesFixesPage"));
const ComingSoonPage          = lazy(() => import("@/pages/ComingSoonPage"));
const NotFound                = lazy(() => import("@/pages/NotFound"));
// ✅ TACHES
const TachesPage              = lazy(() => import("@/pages/espaces/TachesPage"));
// ✅ PRÊTS
const MesPretsPage            = lazy(() => import("@/pages/espaces/MesPretsPage"));
const GestionPretsPage        = lazy(() => import("@/pages/espaces/manager/GestionPretsPage"));
const PretsDashboardPage      = lazy(() => import("@/pages/espaces/manager/PretsDashboardPage"));
const ParametragePretsPage    = lazy(() => import("@/pages/configuration/ParametragePretsPage"));
// ✅ VIREMENTS (salaires & retenues à la source)
const OrdresVirementPage      = lazy(() => import("@/pages/espaces/manager/OrdresVirementPage"));
const TiersRetenuesPage       = lazy(() => import("@/pages/espaces/manager/TiersRetenuesPage"));
const ComptesEmetteursPage    = lazy(() => import("@/pages/configuration/ComptesEmetteursPage"));
// ✅ NAVIGATION ADMIN
const NavigationAdminPage     = lazy(() => import("@/pages/admin/NavigationAdminPage"));
const BureauPage              = lazy(() => import("@/pages/BureauPage"));
// ✅ REQUÊTEUR
const RequeteurPage           = lazy(() => import("@/pages/RequeteurPage"));

// ─── Skeleton minimal pendant le chargement des pages ────────────────────────
const PageSkeleton: React.FC = () => (
  <div className="flex flex-col gap-4 p-6 animate-pulse">
    <div className="h-8 w-48 rounded-lg bg-muted" />
    <div className="h-4 w-96 rounded bg-muted" />
    <div className="h-64 rounded-xl bg-muted mt-4" />
  </div>
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <ThemeProvider>
            <Suspense fallback={<PageSkeleton />}>
              <NavProvider>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/accueil" element={<AccueilLauncher />} />

                <Route element={<AppLayout />}>
                  <Route path="/" element={<Navigate to="/accueil" replace />} />
                  <Route path="/famille/enfants" element={<GestionEnfantsPage />} />
                  <Route path="/dashboard" element={<Dashboard />} />

                  {/* ── Messagerie collaborateurs (chat) ── */}
                  <Route path="/chat" element={<ChatPage />} />

                  {/* ── ✅ TACHES ── */}
                  <Route path="/taches" element={<TachesPage />} />

                  {/* ── ✅ PRÊTS — Espace collaborateur (tous rôles connectés) ── */}
                  <Route path="/prets" element={<MesPretsPage />} />
                  {/* Alias BDD menu_items → même page */}
                  <Route path="/prets/mes-prets" element={<MesPretsPage />} />

                  {/* ── ✅ PRÊTS — Gestion RH / Paie (SL 50+) ── */}
                  <Route path="/prets/gestion" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh", "gestionnaire_paie"]}>
                      <PretsDashboardPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/prets/gestion/liste" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh", "gestionnaire_paie"]}>
                      <GestionPretsPage />
                    </ProtectedRoute>
                  } />

                  {/* ── ✅ PRÊTS — Paramétrage (types, catégories, règles) ── */}
                  <Route path="/configuration/prets" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh"]}>
                      <ParametragePretsPage />
                    </ProtectedRoute>
                  } />

                  {/* ── ✅ VIREMENTS — Gestion RH / Paie (données bancaires sensibles) ── */}
                  <Route path="/virements/ordres" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh", "gestionnaire_paie"]}>
                      <OrdresVirementPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/virements/tiers-retenues" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh", "gestionnaire_paie"]}>
                      <TiersRetenuesPage />
                    </ProtectedRoute>
                  } />

                  {/* ── ✅ VIREMENTS — Comptes émetteurs (paramétrage, accès restreint) ── */}
                  <Route path="/configuration/comptes-emetteurs" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_paie"]}>
                      <ComptesEmetteursPage />
                    </ProtectedRoute>
                  } />

                  {/* ── Organisations (RG-MGR-ORG-01 : lecture seule pour manager) ── */}
                  <Route
                    path="/organisations"
                    element={
                      <ProtectedRoute roles={["administrateur", "gestionnaire_rh", "manager"]}>
                        <ReadOnlyWrapper><OrganisationsPage /></ReadOnlyWrapper>
                      </ProtectedRoute>
                    }
                  />

                  {/* ── Collaborateurs ── */}
                  <Route path="/collaborateurs" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh", "manager"]}>
                      <CollaborateursPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/collaborateurs/nouveau" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh"]}>
                      <NouveauCollaborateur />
                    </ProtectedRoute>
                  } />
                  <Route path="/collaborateurs/:id" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh", "manager"]}>
                      <FicheCollaborateur />
                    </ProtectedRoute>
                  } />

                  {/* ── Mon Espace ── */}
                  <Route path="/mon-espace"  element={<MonEspacePage />} />
                  <Route path="/mes-delegations" element={<MesDelegationsPage mode="manager" />} />
                  <Route path="/espace-manager/delegations" element={<MesDelegationsPage mode="manager" />} />
                  <Route path="/administration/delegations" element={<MesDelegationsPage mode="admin" />} />
                  <Route path="/mon-equipe"  element={<MonEquipePage />} />
                  <Route path="/espace-manager" element={<ManagerSpace />} />
                  <Route path="/espace-manager/conges" element={<CongesPage />} />
                  <Route path="/espace-manager/demandes" element={<GestionDemandesPage />} />

                  {/* ── Routes alias BDD ── */}
                  <Route path="/gestion-demandes" element={<GestionDemandesPage />} />
                  <Route path="/espace-manager/conges/encours" element={<CongesPage />} />
                  <Route path="/espace-manager/conges/planning" element={<CongesPage />} />
                  <Route path="/espace-manager/conges/soldes" element={<CongesPage />} />
                  <Route path="/espace-manager/conges/taux" element={<CongesPage />} />
                  <Route path="/espace-manager/conges/liste" element={<ListeCongesPage />} />
                  <Route path="/conges/liste" element={<ListeCongesPage />} />
                  <Route path="/configuration/workflows" element={<WorkflowDesignerPage />} />
                  <Route path="/configuration/workflow-variables" element={<CatalogueVariablesPage />} />
                  <Route path="/configuration/workflow-notifications" element={<NotificationTemplatesPage />} />
                  <Route path="/configuration/email" element={<EmailConfigPage />} />
                  <Route path="/configuration/sms" element={<SmsConfigPage />} />
                  <Route path="/configuration/temps" element={<ComingSoonPage />} />
                  <Route path="/configuration/temps/feries" element={<JoursFeriesPage />} />
                  <Route path="/configuration/temps/baremes" element={<BaremesDroitsPage />} />
                  <Route path="/configuration/masques" element={<FormatMasksSettings />} />
                  <Route path="/configuration/departs-provisoires" element={<MotifsDepartProvisoirePage />} />
                  <Route path="/configuration/reporting" element={<ComingSoonPage />} />
                  <Route path="/gpec/referentiel-metiers" element={<GpecPage />} />
                  <Route path="/gpec/postes" element={<PostesPage />} />
                  <Route path="/gpec/cartographie" element={<ComingSoonPage />} />
                  <Route path="/gpec/succession" element={<ComingSoonPage />} />
                  <Route path="/licences" element={<LicencePage />} />
                  <Route path="/gestion-admin" element={<ComingSoonPage />} />

                  {/* ── Référentiels ── */}
                  <Route path="/referentiels" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh"]}>
                      <ReferentielsPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/referentiels/type-conges" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh"]}>
                      <TypeCongesPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/referentiels/baremes-droits" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh"]}>
                      <BaremesDroitsPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/referentiels/jours-feries" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh"]}>
                      <JoursFeriesPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/referentiels/postes" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh"]}>
                      <PostesPage />
                    </ProtectedRoute>
                  } />

                  {/* ── Paramètres RH ── */}
                  <Route path="/parametres-rh" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh"]}>
                      <ParametresRHPage />
                    </ProtectedRoute>
                  } />

                  {/* ── Utilisateurs & Habilitations ── */}
                  <Route path="/utilisateurs" element={
                    <ProtectedRoute roles={["administrateur"]}>
                      <UtilisateursPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/habilitations" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh"]}>
                      <HabilitationsPage />
                    </ProtectedRoute>
                  } />

                  {/* ── GPEC & Reporting ── */}
                  <Route path="/gpec" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh"]}>
                      <GpecPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/reporting-kpi" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh"]}>
                      <ReportingKpiPage />
                    </ProtectedRoute>
                  } />

                  {/* ── Mon profil & Apparence ── */}
                  <Route path="/profile"    element={<ProfilePage />} />
                  <Route path="/appearance" element={<AppearancePage />} />
                  <Route path="/format-masks" element={<FormatMasksSettings />} />

                  {/* ── Configuration ── */}
                  <Route path="/configuration/workflow" element={
                    <ProtectedRoute roles={["administrateur"]}>
                      <WorkflowDesignerPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/configuration/workflow-roles" element={
                    <ProtectedRoute roles={["administrateur"]}>
                      <WorkflowRolesPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/configuration/variables" element={
                    <ProtectedRoute roles={["administrateur"]}>
                      <CatalogueVariablesPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/configuration/notifications" element={
                    <ProtectedRoute roles={["administrateur"]}>
                      <NotificationTemplatesPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/configuration/workflow-documents" element={
                    <ProtectedRoute roles={["administrateur"]}>
                      <DocumentTemplatesPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/configuration/acces"          element={<ComingSoonPage />} />
                  <Route path="/configuration/acces/espaces"  element={
                    <ProtectedRoute roles={["administrateur"]}>
                      <EspacesAccessPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/configuration/acces/roles"    element={
                    <ProtectedRoute roles={["administrateur"]}>
                      <GestionRolesPage />
                    </ProtectedRoute>
                  } />

                  {/* ── ✅ NAVIGATION ADMIN ── */}
                  <Route path="/admin/navigation" element={
                    <ProtectedRoute roles={["administrateur"]}>
                      <NavigationAdminPage />
                    </ProtectedRoute>
                  } />

                  {/* ── ✅ VUE BUREAU (grille des modules) ── */}
                  <Route path="/bureau" element={<BureauPage />} />

                  {/* ── ✅ REQUÊTEUR (accès admin en attendant requeteur_droits_tables) ── */}
                  <Route path="/requeteur" element={
                    <ProtectedRoute roles={["administrateur"]}>
                      <RequeteurPage />
                    </ProtectedRoute>
                  } />

                  {/* ── Absences & Congés ── */}
                  <Route path="/absences/compteurs" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh", "manager"]}>
                      <CompteurCongesPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/absences/saisie"     element={<SaisieCongesPage />} />
                  <Route path="/conges/saisie-directe" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh"]}>
                      <SaisieDirecteCongePage />
                    </ProtectedRoute>
                  } />
                  <Route path="/absences/suivi"      element={<SuiviCongesPage />} />
                  <Route path="/absences/planning"   element={<PlanningCongesPage />} />
                  <Route path="/absences/validation" element={<ValidationDemandesPage />} />

                  {/* ── Départs & Mouvements ── */}
                  <Route path="/departs"             element={<GestionDepartsPage />} />
                  <Route path="/departs-provisoires" element={<DepartsProvisoiresPage />} />
                  <Route path="/mouvements"          element={<MouvementsPage />} />
                  <Route path="/attestations"        element={<ComingSoonPage />} />

                  {/* ── Paie ── */}
                  <Route path="/paie/parametrage" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh", "gestionnaire_paie"]}>
                      <ParametragePaiePage />
                    </ProtectedRoute>
                  } />
                  <Route path="/paie/parametrage/baremes" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh", "gestionnaire_paie"]}>
                      <BaremesListPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/paie/parametrage/baremes/new" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh", "gestionnaire_paie"]}>
                      <BaremeNewPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/paie/parametrage/baremes/:id" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh", "gestionnaire_paie"]}>
                      <BaremeEditPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/paie/parametrage/populations" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh", "gestionnaire_paie"]}>
                      <PopulationsPaiePage />
                    </ProtectedRoute>
                  } />
                  <Route path="/paie/salaires-fixes" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh", "gestionnaire_paie"]}>
                      <SalairesFixesPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/paie/declarations/cnss" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh", "gestionnaire_paie"]}>
                      <DeclarationCnssPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/paie/declarations/cimr" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh", "gestionnaire_paie"]}>
                      <DeclarationCimrPage />
                    </ProtectedRoute>
                  } />

                  {/* ── ✅ GÉNÉRATEUR D'ÉTATS — pas de ProtectedRoute à liste fixe ici :
                       l'accès est vérifié dynamiquement côté backend via
                       require_menu_access("etats") (menu_role, MODULE_ETATS_PAIE.md §13-§14),
                       pour rester valable avec des rôles créés après coup par l'administrateur
                       (ex. gestionnaire_recr, déjà créé au 27/08/2026) sans retoucher ce fichier.
                       Un utilisateur sans accès obtient un message clair dans EtatsPage.tsx
                       (403 intercepté), pas un blocage silencieux de route. ── */}
                  <Route path="/etats/nouveau" element={<EtatNouveauPage />} />
                  <Route path="/etats/:id/modifier" element={<EtatNouveauPage />} />
                  <Route path="/etats" element={<EtatsPage />} />
                  {/* ── ✅ ÉDITIONS UNIFIÉES — accès contrôlé côté serveur par require_menu_access("editions")
                       (menu_role) et par les droits fins edt_droit : pas de liste de rôles figée ici. ── */}
                  <Route path="/editions" element={<EditionsPage />} />
                  <Route path="/editions/dictionnaire" element={<EditionsDictionnairePage />} />
                  <Route path="/editions/:modeleId/designer" element={<EditionsDesignerPage />} />
                  <Route path="/paie/declarations/ir" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh", "gestionnaire_paie"]}>
                      <DeclarationIrPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/paie/traitement" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh", "gestionnaire_paie"]}>
                      <VueTraitementPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/paie/traitement/lancement" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_paie"]}>
                      <LancementPaiePage />
                    </ProtectedRoute>
                  } />
                  {/* Préparation des éléments variables (écrans à venir) */}
                  <Route path="/paie/preparation/modules"             element={<RecuperationModulesPage />} />
                  <Route path="/paie/preparation/saisie-individuelle" element={<SaisieIndividuellePage />} />
                  <Route path="/paie/preparation/saisie-masse"        element={<SaisieMassePage />} />
                  <Route path="/paie/preparation/import"              element={<ImportExcelPage />} />
                  <Route path="/paie/consultation/historique"         element={<HistoriquePaiePage />} />
                  <Route path="/paie/consultation/bulletins" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh", "gestionnaire_paie"]}>
                      <HistoriqueCollaborateurPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/paie/consultation/vue-ensemble" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh", "gestionnaire_paie"]}>
                      <VueEnsemblePaiePage />
                    </ProtectedRoute>
                  } />
                  <Route path="/paie/consultation/recherche-bulletins" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh", "gestionnaire_paie"]}>
                      <RechercheBulletinsPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/paie/consultation/anomalies" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh", "gestionnaire_paie"]}>
                      <AnomaliesPaiePage />
                    </ProtectedRoute>
                  } />
                  <Route path="/paie/consultation/bulletin-detail" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh", "gestionnaire_paie"]}>
                      <ConsultationBulletinPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/paie/traitement/calcul"      element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh", "gestionnaire_paie"]}>
                      <TraitementPaiePage />
                    </ProtectedRoute>
                  } />
                  {/* ── Module Simulation individuelle (UC1/UC2/UC3) ── */}
                  <Route path="/paie/traitement/simulation" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh", "gestionnaire_paie"]}>
                      <SimulationIndividuellePage />
                    </ProtectedRoute>
                  } />
                  <Route path="/paie/traitement/simulation/scenarios" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh", "gestionnaire_paie"]}>
                      <MesScenariosPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/paie/traitement/simulation-population" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh", "gestionnaire_paie"]}>
                      <SimulationPopulationPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/paie/traitement/simulation-population/historique" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh", "gestionnaire_paie"]}>
                      <ConsultationSimulationsPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/paie/fin-periode" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_paie"]}>
                      <CloturePeriodePage />
                    </ProtectedRoute>
                  } />
                  {/* ── Comptabilisation de la paie (nouveau) ── */}
                  <Route path="/paie/compta/generation" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_paie"]}>
                      <GenerationEcrituresPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/paie/compta/export" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_paie"]}>
                      <ExportComptaPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/paie/compta/vue" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_paie"]}>
                      <VueComptabilitePage />
                    </ProtectedRoute>
                  } />
                  {/* ancien écran « Journal de paie » (périmètre / aperçu) retiré : remplacé par Paie › Éditions de la paie (Adil DAIA, 19/10/2026) */}
                  <Route path="/paie/editions" element={<Navigate to="/paie/editions-paie" replace />} />
                  <Route path="/paie/editions/journal-grille" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_paie"]}>
                      <JournalGrilleConfigPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/paie/editions/journaux" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_paie"]}>
                      <RapportTemplatesPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/paie/editions-paie" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh", "gestionnaire_paie"]}>
                      <EditionsPaiePage />
                    </ProtectedRoute>
                  } />
                  <Route path="/paie/edition-bulletins" element={<Navigate to="/paie/editions-paie" replace />} />
                  <Route path="/paie/editions/bulletins" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_paie"]}>
                      <BulletinConfigPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/paie/fin-annee" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_paie"]}>
                      <ClotureAnnuellePage />
                    </ProtectedRoute>
                  } />
                  <Route path="/paie/declarations" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh", "gestionnaire_paie"]}>
                      <VueDeclarationsPage />
                    </ProtectedRoute>
                  } />

                  {/* ── Calendrier & Trombinoscope ── */}
                  <Route path="/calendrier"    element={<CalendrierPage />} />
                  <Route path="/trombinoscope" element={<TrombinoscopePage />} />

                  {/* ── Modules en développement ── */}
                  <Route path="/recrutement"                       element={<ComingSoonPage />} />
                  <Route path="/recrutement/campagnes"             element={<ComingSoonPage />} />
                  <Route path="/recrutement/candidatures"          element={<ComingSoonPage />} />
                  <Route path="/recrutement/onboarding"            element={<ComingSoonPage />} />
                  <Route path="/formation"                         element={<ComingSoonPage />} />
                  <Route path="/formation/catalogue"               element={<ComingSoonPage />} />
                  <Route path="/formation/inscriptions"            element={<ComingSoonPage />} />
                  <Route path="/formation/suivi"                   element={<ComingSoonPage />} />
                  <Route path="/performance"                       element={<ComingSoonPage />} />
                  <Route path="/performance/objectifs"             element={<ComingSoonPage />} />
                  <Route path="/performance/campagnes"             element={<ComingSoonPage />} />
                  <Route path="/performance/tableau-bord"          element={<ComingSoonPage />} />
                  <Route path="/relations-sociales"                element={<ComingSoonPage />} />
                  <Route path="/relations-sociales/instances"      element={<ComingSoonPage />} />
                  <Route path="/relations-sociales/accords"        element={<ComingSoonPage />} />
                  <Route path="/relations-sociales/communication"  element={<ComingSoonPage />} />
                  <Route path="/relations-sociales/enquetes"       element={<ComingSoonPage />} />
                  <Route path="/sante-securite"                    element={<ComingSoonPage />} />
                  <Route path="/sante-securite/sante"              element={<ComingSoonPage />} />
                  <Route path="/sante-securite/securite"           element={<ComingSoonPage />} />
                  <Route path="/sante-securite/qvt"               element={<ComingSoonPage />} />
                  <Route path="/sante-securite/prevention"         element={<ComingSoonPage />} />
                  <Route path="/sante-securite/accompagnement"     element={<ComingSoonPage />} />
                  <Route path="/documents-rh"                      element={<ComingSoonPage />} />
                  <Route path="/avantages"                         element={<ComingSoonPage />} />
                  <Route path="/mobilite"                          element={<ComingSoonPage />} />
                  <Route path="/pilotage"                          element={<ComingSoonPage />} />
                  <Route path="/gouvernance"                       element={<ComingSoonPage />} />
                  <Route path="/audit"                             element={<ComingSoonPage />} />
                  <Route path="/audit/historisation"               element={<ComingSoonPage />} />
                  <Route path="/audit/controles"                   element={<ComingSoonPage />} />
                  <Route path="/audit/rapports"                    element={<ComingSoonPage />} />
                </Route>

                <Route path="*" element={<NotFound />} />
              </Routes>
              </NavProvider>
            </Suspense>
          </ThemeProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
