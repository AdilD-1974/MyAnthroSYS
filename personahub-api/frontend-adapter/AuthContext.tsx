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
import { api, tokenStore, type TokenResponse, type AppRole } from "@/lib/api";

interface AuthContextType {
  user: { id: string; email: string } | null;
  role: AppRole | null;
  activeRole: AppRole | null;
  allRoles: AppRole[];
  profile: { nom?: string; prenom?: string } | null;
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
  const [profile, setProfile] = useState<{ nom?: string; prenom?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  // Restaure la session depuis sessionStorage au chargement
  useEffect(() => {
    const token = tokenStore.get();
    if (!token) { setLoading(false); return; }

    api.get<{ id: string; email: string; roles: AppRole[]; nom?: string; prenom?: string }>("/auth/me")
      .then((me) => {
        const sorted = ROLE_PRIORITY.filter(r => me.roles.includes(r));
        setUser({ id: me.id, email: me.email });
        setAllRoles(sorted);
        setProfile({ nom: me.nom, prenom: me.prenom });
        const saved = sessionStorage.getItem(`active_role_${me.id}`) as AppRole | null;
        setActiveRole(saved && sorted.includes(saved) ? saved : sorted[0]);
      })
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  const signIn = async (email: string, password: string) => {
    const data: TokenResponse = await api.post("/auth/login", { email, password });
    tokenStore.set(data.access_token);
    const sorted = ROLE_PRIORITY.filter(r => data.all_roles.includes(r));
    setUser({ id: data.user_id, email });
    setAllRoles(sorted);
    setActiveRole(data.role);
    setProfile({ nom: data.nom, prenom: data.prenom });
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
