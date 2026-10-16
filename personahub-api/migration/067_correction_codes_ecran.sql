-- =============================================================================
-- Migration 067 — Correction des codes ecran_lancement (alignement snake_case
-- sur nav_menu_item.code, ajout chemin_route)
--
-- Contexte : les codes seedés en migration 066 (FICHE_COLLABORATEUR,
-- TRAITEMENT_PAIE, DEPARTS, DECLARATION_CNSS, DECLARATION_CIMR) étaient des
-- suppositions non vérifiées. Confirmé par App.tsx + NavigationAdminPage.tsx :
--   - nav_menu_item.code est en snake_case minuscule (ex. "collaborateur"),
--     pas en majuscules -- ecran_lancement.code_ecran doit suivre la même
--     convention (RG-ETAT-ECRAN-04, cas particulier de nav_menu_item).
--   - Chaque item de navigation porte un `chemin` (route React) -- ajouté ici
--     comme `chemin_route` pour permettre de vérifier a posteriori qu'un
--     code_ecran correspond bien à une route réelle.
--
-- Idempotente et sûre que la migration 066 ait été committée ou rollback :
--   - Si 066 committée : nettoie les anciens codes majuscules puis réinsère.
--   - Si 066 rollback : le DELETE ne trouve rien, l'INSERT s'exécute normalement.
--
-- Sécurité avant nettoyage : vérifie qu'aucun etat_ecran_association ne
-- référence déjà un ancien code avant de le supprimer (etat_definition était
-- vide au moment de la migration 066, donc ce cas ne devrait pas se
-- présenter, mais on ne le suppose jamais -- cf. discipline de schéma).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Ajout de la colonne de traçabilité chemin_route
-- -----------------------------------------------------------------------------
ALTER TABLE public.ecran_lancement
    ADD COLUMN IF NOT EXISTS chemin_route text;

COMMENT ON COLUMN public.ecran_lancement.chemin_route IS
    'Route React correspondante (cf. App.tsx), pour vérification -- même rôle que nav_menu_item.chemin.';

-- -----------------------------------------------------------------------------
-- 2. Garde-fou : aucun ancien code (majuscule) ne doit être référencé
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    nb_references integer;
BEGIN
    SELECT count(*) INTO nb_references
    FROM public.etat_ecran_association
    WHERE code_ecran IN (
        'FICHE_COLLABORATEUR', 'TRAITEMENT_PAIE', 'DEPARTS',
        'DECLARATION_CNSS', 'DECLARATION_CIMR'
    );

    IF nb_references > 0 THEN
        RAISE EXCEPTION
            'Migration 067 arrêtée : % association(s) référence(nt) encore un ancien code_ecran majuscule. Corriger etat_ecran_association avant de relancer.',
            nb_references;
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Nettoyage des anciens codes mal seedés (migration 066)
-- -----------------------------------------------------------------------------
DELETE FROM public.ecran_lancement
WHERE code_ecran IN (
    'FICHE_COLLABORATEUR', 'TRAITEMENT_PAIE', 'DEPARTS',
    'DECLARATION_CNSS', 'DECLARATION_CIMR'
);

-- -----------------------------------------------------------------------------
-- 4. Réinsertion avec les codes/routes réels confirmés (App.tsx)
-- -----------------------------------------------------------------------------
INSERT INTO public.ecran_lancement (code_ecran, libelle, contexte_disponible, chemin_route)
SELECT 'fiche_collaborateur', 'Fiche collaborateur',
       '["collaborateur_id", "societe_id"]'::jsonb, '/collaborateurs/:id'
WHERE NOT EXISTS (SELECT 1 FROM public.ecran_lancement WHERE code_ecran = 'fiche_collaborateur');

INSERT INTO public.ecran_lancement (code_ecran, libelle, contexte_disponible, chemin_route)
SELECT 'traitement_paie', 'Traitement de la paie (calcul)',
       '["collaborateur_id", "periode_id", "bulletin_id", "societe_id"]'::jsonb, '/paie/traitement/calcul'
WHERE NOT EXISTS (SELECT 1 FROM public.ecran_lancement WHERE code_ecran = 'traitement_paie');

INSERT INTO public.ecran_lancement (code_ecran, libelle, contexte_disponible, chemin_route)
SELECT 'consultation_bulletin', 'Consultation bulletin (validé/clôturé)',
       '["collaborateur_id", "periode_id", "bulletin_id", "societe_id"]'::jsonb, '/paie/consultation/bulletin-detail'
WHERE NOT EXISTS (SELECT 1 FROM public.ecran_lancement WHERE code_ecran = 'consultation_bulletin');

INSERT INTO public.ecran_lancement (code_ecran, libelle, contexte_disponible, chemin_route)
SELECT 'departs', 'Module départs',
       '["collaborateur_id", "societe_id"]'::jsonb, '/departs'
WHERE NOT EXISTS (SELECT 1 FROM public.ecran_lancement WHERE code_ecran = 'departs');

INSERT INTO public.ecran_lancement (code_ecran, libelle, contexte_disponible, chemin_route)
SELECT 'declaration_cnss', 'Déclaration CNSS',
       '["periode_id", "societe_id"]'::jsonb, '/paie/declarations/cnss'
WHERE NOT EXISTS (SELECT 1 FROM public.ecran_lancement WHERE code_ecran = 'declaration_cnss');

INSERT INTO public.ecran_lancement (code_ecran, libelle, contexte_disponible, chemin_route)
SELECT 'declaration_cimr', 'Déclaration CIMR',
       '["periode_id", "societe_id"]'::jsonb, '/paie/declarations/cimr'
WHERE NOT EXISTS (SELECT 1 FROM public.ecran_lancement WHERE code_ecran = 'declaration_cimr');

-- =============================================================================
-- Vérifications (à exécuter avant COMMIT)
-- =============================================================================

-- Doit renvoyer exactement 6 lignes, toutes en snake_case minuscule, avec
-- chemin_route non nul
SELECT code_ecran, libelle, chemin_route, contexte_disponible
FROM public.ecran_lancement
ORDER BY code_ecran;

-- Doit renvoyer 0 (plus aucun ancien code majuscule)
SELECT count(*) AS anciens_codes_restants
FROM public.ecran_lancement
WHERE code_ecran = upper(code_ecran) AND code_ecran ~ '[A-Z]';

-- ⚠️ Décommenter après vérification des comptages ci-dessus :
-- COMMIT;

ROLLBACK;
