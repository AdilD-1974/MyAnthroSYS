/**
 * useReferentiels.ts — Hook partagé pour charger tous les référentiels RH
 * Auteur : Adil DAIA
 *
 * Charge dynamiquement depuis la base :
 *   - ref_genre
 *   - ref_type_contrat
 *   - ref_categorie_professionnelle
 *   - ref_statut_collaborateur
 *   - ref_motif_depart
 *   - ref_statut_transition
 *   - ref_conge_statut_eligible
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface RefOption {
  code: string;
  libelle: string;
}

export interface StatutCollaborateur extends RefOption {
  description: string | null;
  actif_rh:    boolean;
  couleur:     string | null;
  ordre:       number;
}

export interface MotifDepart extends RefOption {
  description:    string | null;
  statut_cible:   string;
  declencheur_rh: boolean;
  ordre:          number;
}

export interface StatutTransition {
  statut_origine: string;
  statut_cible:   string;
  libelle_action: string | null;
  motif_requis:   boolean;
}

export interface CongeStatutEligible {
  code_type_conge:  string;
  code_statut:      string;
  prorata_sortie:   boolean;
  generer_droits:   boolean;
}

interface Referentiels {
  genres:              RefOption[];
  typesContrat:        RefOption[];
  categoriesPro:       RefOption[];
  statuts:             StatutCollaborateur[];
  statutsActifsRH:     StatutCollaborateur[];  // actif_rh = true
  motifsDepart:        MotifDepart[];
  transitions:         StatutTransition[];
  congeEligibilites:   CongeStatutEligible[];
  loading:             boolean;
  // Helpers
  getStatut:           (code: string) => StatutCollaborateur | undefined;
  getMotifDepart:      (code: string) => MotifDepart | undefined;
  getTransitionsFrom:  (code: string) => StatutTransition[];
  isCongeEligible:     (codeConge: string, codeStatut: string) => boolean;
}

export function useReferentiels(): Referentiels {
  const [genres,            setGenres]            = useState<RefOption[]>([]);
  const [typesContrat,      setTypesContrat]      = useState<RefOption[]>([]);
  const [categoriesPro,     setCategoriesPro]     = useState<RefOption[]>([]);
  const [statuts,           setStatuts]           = useState<StatutCollaborateur[]>([]);
  const [motifsDepart,      setMotifsDepart]      = useState<MotifDepart[]>([]);
  const [transitions,       setTransitions]       = useState<StatutTransition[]>([]);
  const [congeEligibilites, setCongeEligibilites] = useState<CongeStatutEligible[]>([]);
  const [loading,           setLoading]           = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const [g, tc, cp, sc, md, st, ce] = await Promise.all([
        (supabase.from("ref_genre" as never) as any)
          .select("code, libelle").eq("actif", true).order("libelle"),
        (supabase.from("ref_type_contrat" as never) as any)
          .select("code, libelle").eq("actif", true).order("libelle"),
        (supabase.from("ref_categorie_professionnelle" as never) as any)
          .select("code, libelle").eq("actif", true).order("libelle"),
        (supabase.from("ref_statut_collaborateur" as never) as any)
          .select("code, libelle, description, actif_rh, couleur, ordre")
          .eq("actif", true).order("ordre"),
        (supabase.from("ref_motif_depart" as never) as any)
          .select("code, libelle, description, statut_cible, declencheur_rh, ordre")
          .eq("actif", true).order("ordre"),
        (supabase.from("ref_statut_transition" as never) as any)
          .select("statut_origine, statut_cible, libelle_action, motif_requis")
          .eq("actif", true),
        (supabase.from("ref_conge_statut_eligible" as never) as any)
          .select("code_type_conge, code_statut, prorata_sortie, generer_droits"),
      ]);

      if (!cancelled) {
        setGenres(           (g.data   || []) as RefOption[]);
        setTypesContrat(     (tc.data  || []) as RefOption[]);
        setCategoriesPro(    (cp.data  || []) as RefOption[]);
        setStatuts(          (sc.data  || []) as StatutCollaborateur[]);
        setMotifsDepart(     (md.data  || []) as MotifDepart[]);
        setTransitions(      (st.data  || []) as StatutTransition[]);
        setCongeEligibilites((ce.data  || []) as CongeStatutEligible[]);
        setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, []);

  const statutsActifsRH = statuts.filter(s => s.actif_rh);

  const getStatut          = (code: string) => statuts.find(s => s.code === code);
  const getMotifDepart     = (code: string) => motifsDepart.find(m => m.code === code);
  const getTransitionsFrom = (code: string) => transitions.filter(t => t.statut_origine === code);
  const isCongeEligible    = (codeConge: string, codeStatut: string) => {
    const rule = congeEligibilites.find(
      e => e.code_type_conge === codeConge && e.code_statut === codeStatut
    );
    if (rule) return rule.generer_droits;
    // Fallback : se baser sur actif_rh si pas de règle définie
    return statuts.find(s => s.code === codeStatut)?.actif_rh ?? false;
  };

  return {
    genres, typesContrat, categoriesPro,
    statuts, statutsActifsRH,
    motifsDepart, transitions, congeEligibilites,
    loading,
    getStatut, getMotifDepart, getTransitionsFrom, isCongeEligible,
  };
}
