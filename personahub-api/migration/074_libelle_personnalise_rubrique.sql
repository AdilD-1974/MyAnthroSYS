-- =============================================================================
-- Migration 074 — Libellé personnalisé par rubrique dans un corps
--
-- Contexte : permettre d'afficher un intitulé différent de rubrique_paie.
-- libelle sur le document (ex. "Salaire" au lieu de "SALAIRE DE BASE (M)"),
-- sans jamais modifier le libellé de référence de la rubrique elle-même.
-- NULL = utiliser le libellé par défaut de la rubrique (comportement inchangé).
-- =============================================================================

BEGIN;

ALTER TABLE public.etat_corps_rubrique
    ADD COLUMN libelle_personnalise text;

COMMENT ON COLUMN public.etat_corps_rubrique.libelle_personnalise IS
    'Intitulé affiché sur le document, si différent du libellé par défaut de la rubrique (rubrique_paie.libelle). NULL = utiliser le libellé par défaut.';

-- =============================================================================
-- Vérification
-- =============================================================================

SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'etat_corps_rubrique' AND column_name = 'libelle_personnalise';

-- ⚠️ Décommenter après vérification :
-- COMMIT;

ROLLBACK;
