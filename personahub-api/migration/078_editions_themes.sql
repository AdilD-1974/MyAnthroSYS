-- =============================================================================
-- Migration 078 — Éditions : thèmes (dossiers), indicateur Actif, menu
--                 « Éditions de la paie » en arborescence
-- Auteur : Adil DAIA — 19/10/2026
--
-- RG-EDT-THEME-01 (Adil DAIA) : les états sont rangés dans des thèmes (dossiers)
--   d'un module (PAIE, RH…), éventuellement imbriqués : États standard, Journaux
--   de paie, États de contrôle, États de synthèse… Un thème peut contenir
--   plusieurs modèles (plusieurs bulletins, plusieurs journaux…).
-- RG-EDT-THEME-02 : thèmes système (societe_id NULL) livrés ; chaque société
--   ajoute les siens. Un modèle sans classement va dans le thème de sa catégorie
--   (edt_theme.categorie_defaut).
-- RG-EDT-ACTIF-01 : chaque état a un indicateur Actif, par société : inactif, il
--   n'est plus proposé dans les menus ni lançable (il reste modifiable).
--
-- Additive et rejouable (dépend de 075 et 077).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Thèmes
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.edt_theme (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code              text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
    libelle           text NOT NULL,
    module            text NOT NULL DEFAULT 'PAIE',
    parent_id         uuid REFERENCES public.edt_theme(id) ON DELETE CASCADE,
    societe_id        uuid REFERENCES public.societes(id),
    categorie_defaut  text,
    ordre             integer NOT NULL DEFAULT 0,
    actif             boolean NOT NULL DEFAULT true,
    cree_le           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_edt_theme_code
    ON public.edt_theme (code, COALESCE(societe_id, '00000000-0000-0000-0000-000000000000'::uuid));

COMMENT ON TABLE public.edt_theme IS
    'RG-EDT-THEME-01/02 — Dossiers des états (arborescence des menus d''éditions par module).';

-- thèmes système de la paie (ordre d'affichage de l'arborescence)
INSERT INTO public.edt_theme (code, libelle, module, categorie_defaut, ordre)
SELECT x.code, x.libelle, 'PAIE', x.cat, x.ordre
FROM (VALUES ('PAIE_BULLETINS',   'Bulletins de paie',         'BULLETIN',    10),
             ('PAIE_STANDARD',    'États standard',            'LISTE',       20),
             ('PAIE_JOURNAUX',    'Journaux de paie',          'JOURNAL',     30),
             ('PAIE_CONTROLE',    'États de contrôle paie',    NULL,          40),
             ('PAIE_SYNTHESE',    'États de synthèse',         NULL,          50),
             ('PAIE_DECLARATIONS','Déclarations',              'DECLARATION', 60),
             ('RH_ATTESTATIONS',  'Attestations',              'ATTESTATION', 10),
             ('RH_COURRIERS',     'Courriers',                 'COURRIER',    20)
     ) AS x(code, libelle, cat, ordre)
WHERE NOT EXISTS (SELECT 1 FROM public.edt_theme t WHERE t.code = x.code AND t.societe_id IS NULL);
UPDATE public.edt_theme SET module = 'RH' WHERE code IN ('RH_ATTESTATIONS', 'RH_COURRIERS') AND societe_id IS NULL;

-- -----------------------------------------------------------------------------
-- 2. Réglage d'un modèle pour une société : actif, thème, ordre
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.edt_modele_reglage (
    modele_id   uuid NOT NULL REFERENCES public.edt_modele(id) ON DELETE CASCADE,
    societe_id  uuid NOT NULL REFERENCES public.societes(id),
    actif       boolean NOT NULL DEFAULT true,
    theme_id    uuid REFERENCES public.edt_theme(id) ON DELETE SET NULL,
    ordre       integer NOT NULL DEFAULT 0,
    modifie_le  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (modele_id, societe_id)
);
COMMENT ON TABLE public.edt_modele_reglage IS
    'RG-EDT-ACTIF-01 / RG-EDT-THEME-01 — Actif et classement d''un modèle pour une société (le modèle système compris).';

-- -----------------------------------------------------------------------------
-- 3. Le menu de la paie devient « Éditions de la paie » (arborescence)
--    L'écran « edition_bulletins » de 077 est remplacé ; les boutons Imprimer du
--    traitement et de la consultation restent.
-- -----------------------------------------------------------------------------
UPDATE public.nav_menu_item SET label = 'Éditions de la paie', chemin = '/paie/editions-paie'
WHERE code = 'paie_edition_bulletins';
UPDATE public.menu_items SET libelle = 'Éditions de la paie', route = '/paie/editions-paie'
WHERE code = 'paie_edition_bulletins';
UPDATE public.ecran_lancement SET actif = false WHERE code_ecran = 'edition_bulletins';

-- =============================================================================
-- CONTRÔLES (à lire avant COMMIT)
-- =============================================================================
SELECT module, code, libelle, categorie_defaut FROM public.edt_theme WHERE societe_id IS NULL ORDER BY module, ordre;
SELECT code, label, chemin FROM public.nav_menu_item WHERE code = 'paie_edition_bulletins';

-- ⚠️ Remplacer ROLLBACK par COMMIT après vérification :
-- COMMIT;
ROLLBACK;
