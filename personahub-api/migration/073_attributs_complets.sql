-- =============================================================================
-- Migration 073 — Attributs de rubrique complets (BASE, MONTANT_PATRONAL)
--
-- Contexte : confirmation du schéma bulletin_ligne (28/08/2026) révèle 5
-- champs numériques mappables (base, nombre, montant, montant_patronal,
-- taux), pas 3 -- AttributRubrique (migration 071) n'en couvrait que 3.
-- Nécessaire avant le moteur de rendu générique pour reproduire fidèlement
-- les colonnes du vrai bulletin ("Nbre/Base", "Montant Part. Patronale").
-- =============================================================================

BEGIN;

ALTER TABLE public.etat_corps_rubrique_colonne
    DROP CONSTRAINT ck_etat_corps_rubrique_colonne_attribut;

ALTER TABLE public.etat_corps_rubrique_colonne
    ADD CONSTRAINT ck_etat_corps_rubrique_colonne_attribut
    CHECK (attribut IN ('NOMBRE', 'BASE', 'MONTANT', 'MONTANT_PATRONAL', 'TAUX'));

COMMENT ON COLUMN public.etat_corps_rubrique_colonne.attribut IS
    'Un des 5 champs numériques de bulletin_ligne : NOMBRE (nombre), BASE (base), MONTANT (montant), MONTANT_PATRONAL (montant_patronal), TAUX (taux).';

-- =============================================================================
-- Vérification
-- =============================================================================

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.etat_corps_rubrique_colonne'::regclass
  AND conname = 'ck_etat_corps_rubrique_colonne_attribut';

-- ⚠️ Décommenter après vérification :
-- COMMIT;

ROLLBACK;
