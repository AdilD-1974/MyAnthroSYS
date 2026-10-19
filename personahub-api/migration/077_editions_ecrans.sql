-- =============================================================================
-- Migration 077 — Éditions : lancement depuis les menus métier
-- Auteur : Adil DAIA — 19/10/2026
--
-- RG-EDT-ECRAN-01 (Adil DAIA) : un modèle d'édition est proposé dans un ou
--   plusieurs écrans (menus) de l'application : edt_modele_ecran, par société.
-- RG-EDT-ECRAN-02 : un modèle créé est rattaché d'office aux écrans de sa
--   catégorie (ecran_lancement.categorie_edition) ; on ajuste ensuite.
-- RG-EDT-ECRAN-03 : un écran sans aucun rattachement dans la société propose
--   les modèles publiés de sa catégorie (le bulletin système marche d'emblée).
-- RG-EDT-ECRAN-04 : un modèle par défaut au plus par écran et par société.
--
-- Premier écran métier : Paie › Édition des bulletins (/paie/edition-bulletins),
-- plus le bouton « Imprimer » du traitement et de la consultation du bulletin.
--
-- Additive et rejouable. SQL standard hormis les index filtrés.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Référentiel des écrans (créé par 066/067 ; recréé ici s'il manque)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ecran_lancement (
    code_ecran          text PRIMARY KEY,
    libelle             text NOT NULL,
    contexte_disponible jsonb NOT NULL DEFAULT '[]'::jsonb,
    actif               boolean NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ecran_lancement ADD COLUMN IF NOT EXISTS chemin_route text;
ALTER TABLE public.ecran_lancement ADD COLUMN IF NOT EXISTS categorie_edition text;
ALTER TABLE public.ecran_lancement ADD COLUMN IF NOT EXISTS module_libelle text;

COMMENT ON COLUMN public.ecran_lancement.categorie_edition IS
    'RG-EDT-ECRAN-02/03 : catégorie de modèles d''édition proposée par défaut sur cet écran (BULLETIN, JOURNAL…).';

INSERT INTO public.ecran_lancement (code_ecran, libelle, contexte_disponible, chemin_route)
SELECT 'edition_bulletins', 'Édition des bulletins',
       '["periode_id", "plan_paie_id", "collaborateur_ids", "societe_id"]'::jsonb, '/paie/edition-bulletins'
WHERE NOT EXISTS (SELECT 1 FROM public.ecran_lancement WHERE code_ecran = 'edition_bulletins');

INSERT INTO public.ecran_lancement (code_ecran, libelle, contexte_disponible, chemin_route)
SELECT 'traitement_paie', 'Traitement de la paie (calcul)',
       '["collaborateur_id", "periode_id", "bulletin_id", "societe_id"]'::jsonb, '/paie/traitement/calcul'
WHERE NOT EXISTS (SELECT 1 FROM public.ecran_lancement WHERE code_ecran = 'traitement_paie');

INSERT INTO public.ecran_lancement (code_ecran, libelle, contexte_disponible, chemin_route)
SELECT 'consultation_bulletin', 'Consultation bulletin (validé/clôturé)',
       '["collaborateur_id", "periode_id", "bulletin_id", "societe_id"]'::jsonb, '/paie/consultation/bulletin-detail'
WHERE NOT EXISTS (SELECT 1 FROM public.ecran_lancement WHERE code_ecran = 'consultation_bulletin');

UPDATE public.ecran_lancement SET categorie_edition = 'BULLETIN', module_libelle = 'Paie'
WHERE code_ecran IN ('edition_bulletins', 'traitement_paie', 'consultation_bulletin')
  AND categorie_edition IS NULL;

-- -----------------------------------------------------------------------------
-- 2. Rattachement modèle ↔ écran, par société
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.edt_modele_ecran (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    modele_id   uuid NOT NULL REFERENCES public.edt_modele(id) ON DELETE CASCADE,
    code_ecran  text NOT NULL REFERENCES public.ecran_lancement(code_ecran) ON DELETE CASCADE,
    societe_id  uuid NOT NULL REFERENCES public.societes(id),
    par_defaut  boolean NOT NULL DEFAULT false,
    ordre       integer NOT NULL DEFAULT 0,
    cree_le     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_edt_modele_ecran UNIQUE (modele_id, code_ecran, societe_id)
);
CREATE INDEX IF NOT EXISTS ix_edt_modele_ecran_ecran ON public.edt_modele_ecran (societe_id, code_ecran);
-- RG-EDT-ECRAN-04 : un seul modèle par défaut par écran et par société
CREATE UNIQUE INDEX IF NOT EXISTS ux_edt_modele_ecran_defaut
    ON public.edt_modele_ecran (societe_id, code_ecran) WHERE par_defaut;

COMMENT ON TABLE public.edt_modele_ecran IS
    'RG-EDT-ECRAN-01 — Écrans (menus) où un modèle d''édition est proposé, pour une société.';

-- -----------------------------------------------------------------------------
-- 3. Menu Paie › Édition des bulletins (barre latérale + matrice d'accès)
--    Placé à côté de l'ancien menu des bulletins (/paie/editions/bulletins),
--    avec les mêmes rôles ; à défaut, dans la même section que le traitement.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    ref     record;
    nouvel  uuid;
BEGIN
    IF EXISTS (SELECT 1 FROM public.nav_menu_item WHERE code = 'paie_edition_bulletins') THEN
        RETURN;
    END IF;
    SELECT id, section_id, parent_id, ordre, module_code INTO ref
    FROM public.nav_menu_item
    WHERE chemin IN ('/paie/editions/bulletins', '/paie/editions', '/paie/traitement/calcul')
    ORDER BY CASE chemin WHEN '/paie/editions/bulletins' THEN 0 WHEN '/paie/editions' THEN 1 ELSE 2 END
    LIMIT 1;
    nouvel := gen_random_uuid();
    INSERT INTO public.nav_menu_item (id, code, label, icone, chemin, section_id, parent_id, ordre, actif, module_code)
    VALUES (nouvel, 'paie_edition_bulletins', 'Édition des bulletins', 'FileText', '/paie/edition-bulletins',
            ref.section_id, ref.parent_id, COALESCE(ref.ordre, 0), true, COALESCE(ref.module_code, 'paie'));
    IF ref.id IS NOT NULL AND EXISTS (SELECT 1 FROM public.nav_role_visibilite WHERE item_id = ref.id) THEN
        INSERT INTO public.nav_role_visibilite (id, item_id, role_code)
        SELECT gen_random_uuid(), nouvel, v.role_code FROM public.nav_role_visibilite v WHERE v.item_id = ref.id;
    ELSE
        INSERT INTO public.nav_role_visibilite (id, item_id, role_code)
        SELECT gen_random_uuid(), nouvel, r FROM (VALUES ('administrateur'), ('gestionnaire_paie'), ('gestionnaire_rh')) AS t(r);
    END IF;
END $$;

INSERT INTO public.menu_items (id, code, libelle, icone, route, ordre, module_code, actif)
SELECT gen_random_uuid(), 'paie_edition_bulletins', 'Édition des bulletins', 'printer', '/paie/edition-bulletins', 996, 'PAIE', true
WHERE NOT EXISTS (SELECT 1 FROM public.menu_items WHERE code = 'paie_edition_bulletins');

INSERT INTO public.menu_role (menu_id, role)
SELECT m.id, r.role FROM public.menu_items m
CROSS JOIN (VALUES ('gestionnaire_paie'), ('gestionnaire_rh')) AS r(role)
WHERE m.code = 'paie_edition_bulletins'
  AND NOT EXISTS (SELECT 1 FROM public.menu_role x WHERE x.menu_id = m.id AND x.role = r.role);

-- =============================================================================
-- CONTRÔLES (à lire avant COMMIT)
-- =============================================================================
-- 3 écrans de catégorie BULLETIN
SELECT code_ecran, libelle, categorie_edition, chemin_route FROM public.ecran_lancement
WHERE categorie_edition IS NOT NULL ORDER BY code_ecran;
-- le nouveau menu et ses rôles
SELECT i.code, i.label, i.chemin, string_agg(v.role_code, ', ') AS roles
FROM public.nav_menu_item i LEFT JOIN public.nav_role_visibilite v ON v.item_id = i.id
WHERE i.code = 'paie_edition_bulletins' GROUP BY i.code, i.label, i.chemin;

-- ⚠️ Remplacer ROLLBACK par COMMIT après vérification :
-- COMMIT;
ROLLBACK;
