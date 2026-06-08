/**
 * AuthContext.tsx — Version FastAPI (remplace la version Supabase)
 *
 * Changements par rapport à l'original :
 *   - Suppression de @supabase/supabase-js
 *   - Login via POST /api/v1/auth/login
 *   - Token JWT stocké en sessionStorage
 *   - GET /api/v1/auth/me pour récupérer le profil
 *
 * À placer dans : src/contexts/AuthContext.tsx
 */

import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { api, tokenStore, type TokenResponse, type AppRole } from "@/lib/api";

interface AuthContextType {
  user: { id: string; email: string } | null;
  role: AppRole | null;
  activeRole: AppRole | null;
  allRoles: AppRole[];
  profile: {
    user_id?: string;
    nom?: string;
    prenom?: string;
    collaborateur_id?: string | null;
    matricule?: string | null;
  } | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
  switchRole: (role: AppRole) => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null, role: null, activeRole: null, allRoles: [],
  profile: null, loading: true,
  signIn: async () => {},
  signOut: () => {},
  switchRole: () => {},
});

export const useAuth = () => useContext(AuthContext);

const ROLE_PRIORITY: AppRole[] = [
  "administrateur", "gestionnaire_rh", "gestionnaire_paie", "manager", "collaborateur"
];

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [allRoles, setAllRoles] = useState<AppRole[]>([]);
  const [activeRole, setActiveRole] = useState<AppRole | null>(null);
  const [profile, setProfile] = useState<{
    user_id?: string;
    nom?: string;
    prenom?: string;
    collaborateur_id?: string | null;
    matricule?: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  // Charge le profil complet via /auth/me (inclut collaborateur_id, matricule).
  // Utilisé au rechargement ET juste après le login, pour que le profil soit
  // toujours complet quelle que soit la voie d'entrée.
  const loadFromMe = async () => {
    const me = await api.get<{
      id: string; email: string; roles: AppRole[];
      nom?: string; prenom?: string;
      collaborateur_id?: string | null; matricule?: string | null;
    }>("/auth/me");
    const sorted = ROLE_PRIORITY.filter(r => me.roles.includes(r));
    setUser({ id: me.id, email: me.email });
    setAllRoles(sorted);
    setProfile({
      user_id: me.id,
      nom: me.nom,
      prenom: me.prenom,
      collaborateur_id: me.collaborateur_id ?? null,
      matricule: me.matricule ?? null,
    });
    const saved = sessionStorage.getItem(`active_role_${me.id}`) as AppRole | null;
    setActiveRole(saved && sorted.includes(saved) ? saved : sorted[0]);
    return me;
  };

  // Restaure la session depuis sessionStorage au chargement
  useEffect(() => {
    const token = tokenStore.get();
    if (!token) { setLoading(false); return; }

    loadFromMe()
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  const signIn = async (email: string, password: string) => {
    const data: TokenResponse = await api.post("/auth/login", { email, password });
    tokenStore.set(data.access_token);
    // Recharge le profil complet (collaborateur_id n'est pas dans /auth/login).
    try {
      await loadFromMe();
    } catch {
      // Repli : au minimum les infos du login, profil enrichi au prochain /auth/me.
      const sorted = ROLE_PRIORITY.filter(r => data.all_roles.includes(r));
      setUser({ id: data.user_id, email });
      setAllRoles(sorted);
      setActiveRole(data.role);
      setProfile({ user_id: data.user_id, nom: data.nom, prenom: data.prenom });
    }
  };

  const signOut = () => {
    if (user) sessionStorage.removeItem(`active_role_${user.id}`);
    tokenStore.clear();
    setUser(null);
    setAllRoles([]);
    setActiveRole(null);
    setProfile(null);
  };

  const switchRole = (newRole: AppRole) => {
    if (user && allRoles.includes(newRole)) {
      setActiveRole(newRole);
      sessionStorage.setItem(`active_role_${user.id}`, newRole);
    }
  };

  return (
    <AuthContext.Provider value={{
      user, role: activeRole, activeRole, allRoles, profile, loading,
      signIn, signOut, switchRole,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
