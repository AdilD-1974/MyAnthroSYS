/**
 * useContratValidation.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Hook de validation métier pour la saisie d'un contrat collaborateur.
 *
 * Règles implémentées :
 *   1. L'occurrence du contrat est OBLIGATOIRE.
 *   2. Date de début ≥ date de naissance + AGE_MINIMUM_TRAVAIL (paramètre RH).
 *   3. Date de fin > Date de début (si renseignée).
 *   4. Date de titularisation ≥ Date de début (si renseignée).
 *
 * Usage :
 *   const { validate, errors, reset } = useContratValidation();
 *
 *   const ok = validate({
 *     occurrence: "001",
 *     dateDebut: "2025-10-01",
 *     dateFin: "2026-09-30",
 *     dateTitularisation: null,
 *     dateNaissanceCollab: "1990-04-15",
 *     ageMinimumTravail: 18,          // lu depuis Paramètres RH
 *   });
 *
 *   if (!ok) { // afficher errors }
 */

import { useState, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ContratValidationPayload {
  /** Occurrence / numéro d'ordre du contrat – OBLIGATOIRE */
  occurrence: string | null | undefined;
  /** Date de début du contrat (ISO 8601 : YYYY-MM-DD) */
  dateDebut: string | null | undefined;
  /** Date de fin prévue (optionnelle) */
  dateFin?: string | null;
  /** Date de titularisation (optionnelle) */
  dateTitularisation?: string | null;
  /** Date de naissance du collaborateur (ISO 8601) */
  dateNaissanceCollab: string | null | undefined;
  /**
   * Valeur du paramètre RH AGE_MINIMUM_TRAVAIL (en années).
   * À récupérer depuis votre API Paramètres RH.
   * Valeur par défaut légale Maroc : 15 ans (Code du travail art. 143).
   */
  ageMinimumTravail?: number;
}

export interface ContratValidationErrors {
  occurrence?: string;
  dateDebut?: string;
  dateFin?: string;
  dateTitularisation?: string;
}

// ─── Utilitaires de date ──────────────────────────────────────────────────────

/** Convertit une chaîne ISO en objet Date (minuit UTC) */
function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Calcule la date minimale d'embauche :
 * dateNaissance + ageMinimum années (en tenant compte des années bissextiles).
 */
function dateMinimumEmbauche(dateNaissance: Date, ageMinimum: number): Date {
  const min = new Date(dateNaissance);
  min.setFullYear(min.getFullYear() + ageMinimum);
  return min;
}

/** Formate une Date en jj/mm/aaaa pour les messages d'erreur */
function formatFR(d: Date): string {
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useContratValidation() {
  const [errors, setErrors] = useState<ContratValidationErrors>({});

  /**
   * Lance la validation. Retourne true si toutes les règles sont respectées.
   * Met à jour `errors` avec les messages d'erreur par champ.
   */
  const validate = useCallback(
    (payload: ContratValidationPayload): boolean => {
      const newErrors: ContratValidationErrors = {};
      const AGE_MIN = payload.ageMinimumTravail ?? 15; // défaut légal Maroc

      // ── Règle 1 : Occurrence obligatoire ───────────────────────────────────
      if (!payload.occurrence || String(payload.occurrence).trim() === "") {
        newErrors.occurrence =
          "L'occurrence du contrat est obligatoire.";
      }

      // ── Règle 2 : Date de début obligatoire ────────────────────────────────
      const dateDebut = parseDate(payload.dateDebut);
      if (!dateDebut) {
        newErrors.dateDebut = "La date de début est obligatoire.";
      } else {
        // ── Règle 2b : dateDebut ≥ dateNaissance + âge minimum ───────────────
        const dateNaissance = parseDate(payload.dateNaissanceCollab);
        if (dateNaissance) {
          const dateMin = dateMinimumEmbauche(dateNaissance, AGE_MIN);
          if (dateDebut < dateMin) {
            newErrors.dateDebut =
              `La date de début (${formatFR(dateDebut)}) doit être ≥ à la date de naissance ` +
              `+ ${AGE_MIN} ans (âge minimum légal), soit le ${formatFR(dateMin)}.`;
          }
        }
      }

      // ── Règle 3 : dateFin > dateDebut ──────────────────────────────────────
      const dateFin = parseDate(payload.dateFin);
      if (dateFin && dateDebut && dateFin <= dateDebut) {
        newErrors.dateFin =
          `La date de fin (${formatFR(dateFin)}) doit être postérieure à la date de début (${formatFR(dateDebut)}).`;
      }

      // ── Règle 4 : dateTitularisation ≥ dateDebut ───────────────────────────
      const dateTitularisation = parseDate(payload.dateTitularisation);
      if (dateTitularisation && dateDebut && dateTitularisation < dateDebut) {
        newErrors.dateTitularisation =
          `La date de titularisation (${formatFR(dateTitularisation)}) ne peut pas être antérieure à la date de début (${formatFR(dateDebut)}).`;
      }

      setErrors(newErrors);
      return Object.keys(newErrors).length === 0;
    },
    []
  );

  const reset = useCallback(() => setErrors({}), []);

  return { validate, errors, reset };
}

// ─── Utilitaire : récupération du paramètre AGE_MINIMUM_TRAVAIL ───────────────

/**
 * Récupère la valeur du paramètre RH AGE_MINIMUM_TRAVAIL depuis l'API.
 * À appeler une fois au chargement du formulaire.
 *
 * Exemple d'utilisation :
 *   const ageMin = await fetchAgeMinimumTravail();
 */
export async function fetchAgeMinimumTravail(): Promise<number> {
  try {
    const res = await fetch("/api/parametres-rh/AGE_MINIMUM_TRAVAIL");
    if (!res.ok) throw new Error();
    const data = await res.json();
    // data = { code: "AGE_MINIMUM_TRAVAIL", valeur: 16, unite: "ans", ... }
    return Number(data.valeur) || 15;
  } catch {
    console.warn(
      "[useContratValidation] Impossible de récupérer AGE_MINIMUM_TRAVAIL, utilisation de la valeur par défaut (15 ans)"
    );
    return 15; // valeur de secours
  }
}
