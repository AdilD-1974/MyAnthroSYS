import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

type AppRole = "administrateur" | "gestionnaire_rh" | "gestionnaire_paie" | "manager" | "collaborateur";

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** Rôles autorisés à accéder à cette route. Si absent, tous les utilisateurs connectés sont autorisés. */
  roles?: AppRole[];
  /** Route de redirection si accès refusé (défaut : /dashboard) */
  redirectTo?: string;
}

/**
 * ProtectedRoute — Garde de route déclaratif par rôle.
 * Usage :
 *   <Route path="/utilisateurs" element={
 *     <ProtectedRoute roles={["administrateur"]}>
 *       <UtilisateursPage />
 *     </ProtectedRoute>
 *   } />
 */
const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  roles,
  redirectTo = "/dashboard",
}) => {
  const { role, loading } = useAuth();

  // Attendre que l'authentification soit chargée
  if (loading) return null;

  // Non connecté → login
  if (!role) return <Navigate to="/login" replace />;

  // Rôle non autorisé → dashboard
  if (roles && role !== "administrateur" && !roles.includes(role as AppRole)) {
    return <Navigate to={redirectTo} replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
