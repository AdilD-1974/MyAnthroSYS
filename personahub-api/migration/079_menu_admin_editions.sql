-- =============================================================================
-- Migration 079 — Éditions (création et configuration des états) dans
--                 l'Administration, à côté du Requêteur
-- Auteur : Adil DAIA — 19/10/2026
--
-- RG-EDT-NAV-02 (Adil DAIA) : la bibliothèque des éditions (/editions : concevoir,
--   publier, activer, classer les états) est une tuile du menu Administration,
--   dans la même section, le même parent et le même module que le Requêteur, avec
--   les mêmes rôles. Les menus métier (Paie › Éditions de la paie) restent ceux
--   qui PRODUISENT les états.
-- Rejouable : si une entrée /editions existe déjà, elle est seulement déplacée.
-- =============================================================================

BEGIN;

-- module de la tuile (couleur propre, comme le Requêteur)
INSERT INTO public.nav_module (code, label, couleur, icone, ordre, actif)
SELECT 'editions', 'Éditions', '#60A5FA', 'FileStack',
       COALESCE((SELECT ordre FROM public.nav_module WHERE code = 'requeteur'), 900) + 1, true
WHERE NOT EXISTS (SELECT 1 FROM public.nav_module WHERE code = 'editions');

DO $$
DECLARE
    ref    record;
    cible  uuid;
BEGIN
    SELECT id, section_id, parent_id, ordre INTO ref
    FROM public.nav_menu_item WHERE chemin = '/requeteur' ORDER BY actif DESC LIMIT 1;
    IF ref.id IS NULL THEN
        RAISE NOTICE 'Menu Requêteur introuvable : tuile Éditions non créée (à placer depuis Gestion navigation)';
        RETURN;
    END IF;

    SELECT id INTO cible FROM public.nav_menu_item WHERE chemin = '/editions' OR code = 'editions' LIMIT 1;
    IF cible IS NULL THEN
        cible := gen_random_uuid();
        INSERT INTO public.nav_menu_item (id, code, label, icone, chemin, section_id, parent_id, ordre, actif, module_code)
        VALUES (cible, 'editions', 'Éditions', 'FileStack', '/editions', ref.section_id, ref.parent_id,
                COALESCE(ref.ordre, 0) + 1, true, 'editions');
    ELSE
        UPDATE public.nav_menu_item
        SET section_id = ref.section_id, parent_id = ref.parent_id, ordre = COALESCE(ref.ordre, 0) + 1,
            label = 'Éditions', actif = true, module_code = 'editions'
        WHERE id = cible;
    END IF;

    -- mêmes rôles que le Requêteur
    INSERT INTO public.nav_role_visibilite (id, item_id, role_code)
    SELECT gen_random_uuid(), cible, v.role_code
    FROM public.nav_role_visibilite v
    WHERE v.item_id = ref.id
      AND NOT EXISTS (SELECT 1 FROM public.nav_role_visibilite x WHERE x.item_id = cible AND x.role_code = v.role_code);
END $$;

-- =============================================================================
-- CONTRÔLES (à lire avant COMMIT) : les deux tuiles côte à côte, mêmes rôles
-- =============================================================================
SELECT i.code, i.label, i.chemin, i.section_id, i.parent_id, i.ordre, i.module_code,
       string_agg(v.role_code, ', ' ORDER BY v.role_code) AS roles
FROM public.nav_menu_item i LEFT JOIN public.nav_role_visibilite v ON v.item_id = i.id
WHERE i.chemin IN ('/requeteur', '/editions')
GROUP BY i.code, i.label, i.chemin, i.section_id, i.parent_id, i.ordre, i.module_code;

-- ⚠️ Remplacer ROLLBACK par COMMIT après vérification :
   COMMIT;
-- ROLLBACK;
