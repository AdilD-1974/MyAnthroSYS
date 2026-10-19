-- =============================================================================
-- Migration 080 — Retrait de l'ancien écran « Journal de paie » (/paie/editions)
-- Auteur : Adil DAIA — 19/10/2026
--
-- L'écran Modèle / Périmètre / Aperçu est remplacé par Paie › Éditions de la paie
-- (arborescence, filtres de population, journal en grille). Le menu est désactivé,
-- pas supprimé (réactivable depuis Gestion navigation) ; l'adresse redirige vers
-- le nouveau menu. Rejouable.
-- =============================================================================
BEGIN;

UPDATE public.nav_menu_item SET actif = false WHERE chemin = '/paie/editions';

-- contrôle : l'ancien menu inactif, le nouveau actif
SELECT code, label, chemin, actif FROM public.nav_menu_item
WHERE chemin IN ('/paie/editions', '/paie/editions-paie');

-- ⚠️ Remplacer ROLLBACK par COMMIT après vérification :
-- COMMIT;
ROLLBACK;
