import React, { Suspense, lazy } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ReadOnlyWrapper } from "@/contexts/ManagerContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";

// ─── Lazy loading : chaque page chargée uniquement à la première visite ───────
const LoginPage               = lazy(() => import("@/pages/LoginPage"));
const Dashboard               = lazy(() => import("@/pages/Dashboard"));
const ReferentielsPage        = lazy(() => import("@/pages/ReferentielsPage"));
const UtilisateursPage        = lazy(() => import("@/pages/UtilisateursPage"));
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
const JoursFeriesPage         = lazy(() => import("@/pages/JoursFeriesPage"));
const CompteurCongesPage      = lazy(() => import("@/pages/absences/CompteurCongesPage"));
const SaisieCongesPage        = lazy(() => import("@/pages/absences/SaisieCongesPage"));
const SuiviCongesPage         = lazy(() => import("@/pages/absences/SuiviCongesPage"));
const PlanningCongesPage      = lazy(() => import("@/pages/absences/PlanningCongesPage"));
const ValidationDemandesPage  = lazy(() => import("@/pages/absences/ValidationDemandesPage"));
const GestionDepartsPage      = lazy(() => import("@/pages/GestionDepartsPage"));
const CalendrierPage          = lazy(() => import("@/pages/CalendrierPage"));
const TrombinoscopePage       = lazy(() => import("@/pages/TrombinoscopePage"));
const MouvementsPage          = lazy(() => import("@/pages/MouvementsPage"));
const DepartsProvisoiresPage  = lazy(() => import("@/pages/DepartsProvisoires/DepartsProvisoiresPage"));
const MotifsDepartProvisoirePage = lazy(() => import("@/pages/DepartsProvisoires/MotifsDepartProvisoirePage"));
const ParametragePaiePage     = lazy(() => import("@/pages/paie/ParametragePaiePage"));
// Barèmes paie — 3 routes (liste, création, édition) — RG-PAIE-BAR-01 (Adil DAIA)
const BaremesListPage         = lazy(() => import("@/pages/paie/parametrage/BaremesPages").then(m => ({ default: m.BaremesListPage })));
const BaremeNewPage           = lazy(() => import("@/pages/paie/parametrage/BaremesPages").then(m => ({ default: m.BaremeNewPage })));
const BaremeEditPage          = lazy(() => import("@/pages/paie/parametrage/BaremesPages").then(m => ({ default: m.BaremeEditPage })));
const DeclarationCnssPage     = lazy(() => import("@/pages/paie/DeclarationCnssPage"));
const SalairesFixesPage       = lazy(() => import("@/pages/SalairesFixesPage"));
const ComingSoonPage          = lazy(() => import("@/pages/ComingSoonPage"));
const NotFound                = lazy(() => import("@/pages/NotFound"));

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
              <Routes>
                <Route path="/login" element={<LoginPage />} />

                <Route element={<AppLayout />}>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<Dashboard />} />

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

                  {/* ── Administration ── */}
                  <Route path="/utilisateurs" element={
                    <ProtectedRoute roles={["administrateur"]}>
                      <UtilisateursPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/profil"    element={<ProfilePage />} />
                  <Route path="/apparence" element={<AppearancePage />} />
                  <Route path="/parametres-rh" element={
                    <ProtectedRoute roles={["administrateur"]}>
                      <ParametresRHPage />
                    </ProtectedRoute>
                  } />

                  {/* ── GPEC ── */}
                  <Route path="/gpec" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh"]}>
                      <GpecPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/gpec/postes" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh"]}>
                      <PostesPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/postes" element={<Navigate to="/gpec/postes" replace />} />
                  <Route path="/gpec/referentiel-metiers" element={<ComingSoonPage />} />
                  <Route path="/gpec/cartographie"        element={<ComingSoonPage />} />
                  <Route path="/gpec/succession"          element={<ComingSoonPage />} />

                  {/* ── Référentiels & Configuration ── */}
                  <Route path="/referentiels" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh"]}>
                      <ReferentielsPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/configuration/reporting" element={
                    <ProtectedRoute roles={["administrateur"]}>
                      <ReportingKpiPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/configuration/temps" element={
                    <ProtectedRoute roles={["administrateur"]}>
                      <TypeCongesPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/configuration/temps/feries" element={
                    <ProtectedRoute roles={["administrateur"]}>
                      <JoursFeriesPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/configuration/departs-provisoires" element={
                    <ProtectedRoute roles={["administrateur"]}>
                      <MotifsDepartProvisoirePage />
                    </ProtectedRoute>
                  } />
                  <Route path="/configuration/workflows"      element={<ComingSoonPage />} />
                  <Route path="/configuration/acces"          element={<ComingSoonPage />} />
                  <Route path="/configuration/acces/espaces"  element={<ComingSoonPage />} />
                  <Route path="/configuration/acces/roles"    element={<ComingSoonPage />} />

                  {/* ── Absences & Congés ── */}
                  <Route path="/absences/compteurs" element={
                    <ProtectedRoute roles={["administrateur", "gestionnaire_rh", "manager"]}>
                      <CompteurCongesPage />
                    </ProtectedRoute>
                  } />
                  <Route path="/absences/saisie"     element={<SaisieCongesPage />} />
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
                  <Route path="/paie/traitement"             element={<ComingSoonPage />} />
                  <Route path="/paie/traitement/preparation" element={<ComingSoonPage />} />
                  <Route path="/paie/traitement/calcul"      element={<ComingSoonPage />} />
                  <Route path="/paie/fin-periode"            element={<ComingSoonPage />} />
                  <Route path="/paie/editions"               element={<ComingSoonPage />} />
                  <Route path="/paie/fin-annee"              element={<ComingSoonPage />} />
                  <Route path="/paie/declarations"           element={<ComingSoonPage />} />

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
            </Suspense>
          </ThemeProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
