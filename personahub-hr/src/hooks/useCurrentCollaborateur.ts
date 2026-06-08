/**
 * useCurrentCollaborateur — Résout le collaborateur lié au compte connecté.
 *
 * STRATÉGIE DE RÉSOLUTION (défensive, essaie dans l'ordre) :
 *   1. profiles.collaborateur_id    (lien explicite — idéal)
 *   2. profiles.matricule → collaborateurs.matricule
 *   3. user.email → collaborateurs.email_professionnel
 *
 * ⚠️ À ADAPTER si ton schéma de liaison compte↔collaborateur diffère :
 *    seule la fonction resolveCollaborateurId() est à toucher.
 *
 * Retourne :
 *   - collaborateur : l'objet collaborateur complet (ou null)
 *   - collaborateurId : son uuid
 *   - loading / error
 *   - isLinked : true si un collaborateur a été trouvé
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

export interface CurrentCollaborateur {
  id: string;
  matricule: string;
  nom: string;
  prenom: string;
  civilite?: string;
  email_professionnel?: string;
  photo_path?: string;
  statut_collaborateur?: string;
  date_naissance?: string;
  [key: string]: any;
}

export interface UseCurrentCollaborateurResult {
  collaborateur: CurrentCollaborateur | null;
  collaborateurId: string | null;
  loading: boolean;
  error: string | null;
  isLinked: boolean;
}

export function useCurrentCollaborateur(): UseCurrentCollaborateurResult {
  const auth = useAuth() as any;
  const [state, setState] = useState<UseCurrentCollaborateurResult>({
    collaborateur: null,
    collaborateurId: null,
    loading: true,
    error: null,
    isLinked: false,
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // ── Récupérer l'identité du compte connecté ──────────────────────
        // useAuth() expose { role, allRoles, activeRole, switchRole, profile, signOut }.
        // Le profil (table profiles) porte le lien vers le collaborateur.
        const profile = auth?.profile || null;
        const userId = profile?.id || profile?.user_id || auth?.userId || null;
        const userEmail = profile?.email || profile?.email_professionnel || auth?.email || null;
        const profileCollabId = profile?.collaborateur_id || null;
        const profileMatricule = profile?.matricule || null;

        let collaborateurId: string | null = null;

        // ── Stratégie 1 : profile.collaborateur_id (déjà en mémoire) ─────
        if (profileCollabId) {
          collaborateurId = profileCollabId;
        }

        // ── Stratégie 1bis : retrouver via profiles si pas dans le profile ─
        if (!collaborateurId && userId) {
          try {
            const profiles: any[] = await api.get(
              `/db/profiles?id=eq.${userId}&select=collaborateur_id,matricule&limit=1`
            );
            const p = profiles?.[0];
            if (p?.collaborateur_id) {
              collaborateurId = p.collaborateur_id;
            } else if (p?.matricule) {
              const c: any[] = await api.get(
                `/db/collaborateurs?matricule=eq.${encodeURIComponent(p.matricule)}&select=id&limit=1`
              );
              if (c?.[0]?.id) collaborateurId = c[0].id;
            }
          } catch { /* on tente la stratégie suivante */ }
        }

        // ── Stratégie 2 : matricule du profile → collaborateurs ──────────
        if (!collaborateurId && profileMatricule) {
          try {
            const c: any[] = await api.get(
              `/db/collaborateurs?matricule=eq.${encodeURIComponent(profileMatricule)}&select=id&limit=1`
            );
            if (c?.[0]?.id) collaborateurId = c[0].id;
          } catch { /* ignore */ }
        }

        // ── Stratégie 3 : email → email_professionnel ────────────────────
        if (!collaborateurId && userEmail) {
          try {
            const c: any[] = await api.get(
              `/db/collaborateurs?email_professionnel=eq.${encodeURIComponent(userEmail)}&select=id&limit=1`
            );
            if (c?.[0]?.id) collaborateurId = c[0].id;
          } catch { /* ignore */ }
        }

        if (!collaborateurId) {
          if (!cancelled) {
            setState({
              collaborateur: null,
              collaborateurId: null,
              loading: false,
              error: "Compte non rattaché à un collaborateur",
              isLinked: false,
            });
          }
          return;
        }

        // ── Charger le collaborateur complet ─────────────────────────────
        const rows: any[] = await api.get(
          `/db/collaborateurs?id=eq.${collaborateurId}&limit=1`
        );
        const collab = rows?.[0] || null;

        if (!cancelled) {
          setState({
            collaborateur: collab,
            collaborateurId,
            loading: false,
            error: collab ? null : "Collaborateur introuvable",
            isLinked: !!collab,
          });
        }
      } catch (e: any) {
        if (!cancelled) {
          setState({
            collaborateur: null,
            collaborateurId: null,
            loading: false,
            error: e?.message || "Erreur de résolution du collaborateur",
            isLinked: false,
          });
        }
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.profile]);

  return state;
}

export default useCurrentCollaborateur;
