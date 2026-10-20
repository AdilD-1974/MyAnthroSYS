-- =============================================================================
-- 082_editions_fiche_collaborateur.sql — Attestations proposées sur la fiche collaborateur
-- Auteur : Adil DAIA — 20/10/2026 — RG-EDT-ECRAN-07
--
-- La fiche collaborateur (/collaborateurs/:id) a son bouton « Imprimer » : sans rattachement explicite
-- (bouton Classement d'un modèle), elle propose d'office les modèles de la catégorie ATTESTATION.
-- Idempotente. ROLLBACK par défaut : passer à COMMIT après vérification.
-- =============================================================================
BEGIN;

UPDATE public.ecran_lancement SET categorie_edition = 'ATTESTATION'
WHERE code_ecran = 'fiche_collaborateur' AND categorie_edition IS NULL;

-- contrôle
SELECT code_ecran, libelle, categorie_edition, chemin_route FROM public.ecran_lancement WHERE code_ecran = 'fiche_collaborateur';

ROLLBACK;
-- COMMIT;
