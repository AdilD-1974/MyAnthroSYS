/**
 * useIdentifiantsUnicity.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Hook de vérification d'unicité des identifiants d'un collaborateur.
 * Vérifie : CIN, Passeport, N° Fiscal, et tous les numéros d'affiliation.
 *
 * Usage :
 *   const { checkUnicity, duplicates, isChecking } = useIdentifiantsUnicity();
 *   await checkUnicity(payload, currentCollabId);
 *   // Si duplicates.length > 0  →  afficher <DuplicateAlertModal />
 */

import { useState, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IdentifiantsPayload {
  cin?: string | null;
  passeport?: string | null;
  num_fiscal?: string | null;
  /** Affiliations clé→valeur, ex: { cnss: "123", cimr: "456" } */
  affiliations?: Record<string, string | null | undefined>;
}

export interface DuplicateEntry {
  /** Libellé humain du champ en doublon */
  field: string;
  /** Valeur dupliquée */
  value: string;
  /** Collaborateur(s) déjà porteurs de cette valeur */
  conflicting: { id: string; nom: string; prenom: string; matricule: string }[];
}

// ─── Libellés des champs d'affiliation ───────────────────────────────────────

const AFFILIATION_LABELS: Record<string, string> = {
  cnss: "N° CNSS",
  cimr: "N° CIMR",
  mutuelle: "N° Mutuelle",
  amo: "N° AMO",
  retraite: "N° Retraite",
  at: "N° Assurance AT",
  prevoyance: "N° Prévoyance",
};

// ─── Appel API : à adapter selon votre backend ────────────────────────────────

async function apiCheckDuplicates(
  payload: IdentifiantsPayload,
  excludeId?: string
): Promise<DuplicateEntry[]> {
  /**
   * POST /api/collaborateurs/check-duplicates
   * Body : { cin, passeport, num_fiscal, affiliations, excludeId }
   * Response : DuplicateEntry[]
   *
   * ── Exemple d'implémentation côté serveur (pseudo-SQL) ──
   *
   * Pour chaque champ non vide :
   *   SELECT id, nom, prenom, matricule
   *   FROM collaborateurs
   *   WHERE <champ> = :valeur
   *     AND id != :excludeId
   *     AND actif = true
   */

  const response = await fetch("/api/collaborateurs/check-duplicates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, excludeId }),
  });

  if (!response.ok) {
    throw new Error(`Erreur vérification doublons : ${response.status}`);
  }

  return response.json();
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useIdentifiantsUnicity() {
  const [duplicates, setDuplicates] = useState<DuplicateEntry[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Lance la vérification. Retourne true si aucun doublon trouvé. */
  const checkUnicity = useCallback(
    async (
      payload: IdentifiantsPayload,
      currentCollabId?: string
    ): Promise<boolean> => {
      // Ignorer si tous les champs sont vides
      const hasValues =
        payload.cin ||
        payload.passeport ||
        payload.num_fiscal ||
        Object.values(payload.affiliations ?? {}).some(Boolean);

      if (!hasValues) return true;

      setIsChecking(true);
      setError(null);
      setDuplicates([]);

      try {
        const found = await apiCheckDuplicates(payload, currentCollabId);
        setDuplicates(found);
        return found.length === 0;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur inconnue");
        // En cas d'erreur technique on laisse passer (fail-open)
        return true;
      } finally {
        setIsChecking(false);
      }
    },
    []
  );

  const clearDuplicates = useCallback(() => setDuplicates([]), []);

  return { checkUnicity, duplicates, isChecking, error, clearDuplicates };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Construit le libellé lisible d'un champ d'affiliation */
export function affiliationLabel(key: string): string {
  return AFFILIATION_LABELS[key] ?? `Affiliation (${key})`;
}
