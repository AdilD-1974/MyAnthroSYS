-- =============================================================================
-- Migration 068 — Ajout du menu "etats" dans menu_items
--
-- Contexte : décision (26/08/2026) de restreindre la création d'états au
-- générateur (MODULE_ETATS_PAIE.md §13) à administrateur + gestionnaires
-- (RH, Paie, et futurs rôles Évaluation/Recrutement/Formation/Social créés
-- dynamiquement par l'admin -- codes non figés à ce jour).
--
-- Plutôt que coder une liste de rôles en dur dans etats.py, on branche
-- l'accès sur le système RÉELLEMENT actif de gestion des menus par rôle :
-- menu_items / menu_role (confirmé par lecture de roles.py -- la table
-- acc_role_acces/ref_menus mentionnée dans les commentaires du même fichier
-- n'est référencée nulle part ailleurs dans le projet, code mort).
--
-- Cette migration ne fait qu'ajouter l'entrée menu_items -- l'admin
-- attribue ensuite l'accès à chaque rôle via l'écran existant
-- (PUT /roles/{id}/acces), sans redéploiement nécessaire pour les futurs
-- rôles Évaluation/Recrutement/Formation/Social.
-- =============================================================================

BEGIN;

INSERT INTO public.menu_items (id, code, libelle, icone, route, ordre, module_code, actif)
SELECT gen_random_uuid(), 'etats', 'Générateur d''états', 'file-text', '/etats', 999, 'PAIE', true
WHERE NOT EXISTS (SELECT 1 FROM public.menu_items WHERE code = 'etats');

-- =============================================================================
-- Vérification (à exécuter avant COMMIT)
-- =============================================================================

-- Doit renvoyer exactement 1 ligne
SELECT id, code, libelle, route, module_code, actif
FROM public.menu_items WHERE code = 'etats';

-- ⚠️ Décommenter après vérification :
-- COMMIT;

ROLLBACK;
