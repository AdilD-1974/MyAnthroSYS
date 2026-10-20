-- =============================================================================
-- 081_editions_dictionnaire.sql — Dictionnaire des données des éditions (configurable)
-- Auteur : Adil DAIA — 20/10/2026 — RG-EDT-DICO-01..08
--
-- L'administrateur associe lui-même les informations, sans développement :
--   * champs ajoutés à une source (système ou personnalisée) : valeur lue dans une table
--     de la base à partir d'une valeur de la ligne (code → référentiel → intitulé,
--     collaborateur → table historisée à la date de la période, nombre / somme / liste…) ;
--   * sources personnalisées : une table principale, filtrée par société, ses colonnes ;
--   * relations entre sources (jeux secondaires, tableaux) ;
--   * gestion des champs existants : libellé, groupe, masque, visibilité, sensibilité.
-- Les champs ajoutés et les sources personnalisées sont aussi écrits dans edt_source /
-- edt_source_champ / edt_source_relation (colonne perso = true) : le designer et la
-- validation les voient comme les autres ; la synchronisation au démarrage n'y touche pas.
--
-- Idempotente (IF NOT EXISTS) : relançable. ROLLBACK par défaut : passer à COMMIT après
-- vérification des contrôles en fin de script.
-- =============================================================================

BEGIN;

-- nature des sources personnalisées
ALTER TABLE public.edt_source DROP CONSTRAINT IF EXISTS edt_source_nature_check;
ALTER TABLE public.edt_source ADD CONSTRAINT edt_source_nature_check
    CHECK (nature IN ('PAIE_SNAPSHOT','RH_DATE','REFERENTIEL','CALCULEE','PERSONNALISEE'));

ALTER TABLE public.edt_source_champ    ADD COLUMN IF NOT EXISTS perso boolean NOT NULL DEFAULT false;
ALTER TABLE public.edt_source_champ    ADD COLUMN IF NOT EXISTS groupe_modifie boolean NOT NULL DEFAULT false;
ALTER TABLE public.edt_source_champ    ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.edt_source_relation ADD COLUMN IF NOT EXISTS perso boolean NOT NULL DEFAULT false;
ALTER TABLE public.edt_source_relation ADD COLUMN IF NOT EXISTS libelle text;

-- RG-EDT-DICO-02 : source personnalisée = une table principale filtrée par société
CREATE TABLE IF NOT EXISTS public.edt_source_perso (
    code                  text PRIMARY KEY REFERENCES public.edt_source(code) ON DELETE CASCADE,
    description           text,
    table_principale      text NOT NULL,
    colonne_cle           text NOT NULL DEFAULT 'id',
    colonne_societe       text,              -- filtre société direct
    colonne_collaborateur text,              -- filtre société par le collaborateur, paramètre « Collaborateurs »
    conditions            jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{colonne, operateur, valeur}]
    cree_par              uuid,
    cree_le               timestamptz NOT NULL DEFAULT now(),
    modifie_le            timestamptz NOT NULL DEFAULT now()
);

-- RG-EDT-DICO-01 : définition de lecture d'un champ ajouté (libellé, groupe, type, masque,
-- sensibilité vivent dans edt_source_champ, comme pour les champs système)
CREATE TABLE IF NOT EXISTS public.edt_champ_perso (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_code         text NOT NULL REFERENCES public.edt_source(code) ON DELETE CASCADE,
    code                text NOT NULL,
    mode                text NOT NULL CHECK (mode IN ('COLONNE','RECHERCHE')),
    colonne             text,              -- COLONNE : colonne de la table principale
    cle_ligne           text,              -- RECHERCHE : valeur de la ligne (chemin) servant de clé
    table_cible         text,
    colonne_cle         text,
    colonne_valeur      text,
    colonne_date_debut  text,              -- table historisée : ligne en vigueur à la date de référence
    colonne_date_fin    text,
    date_reference      text NOT NULL DEFAULT 'PERIODE' CHECK (date_reference IN ('PERIODE','AUJOURDHUI')),
    agregat             text NOT NULL DEFAULT 'PREMIER' CHECK (agregat IN ('PREMIER','DERNIER','NB','SOMME','LISTE')),
    colonne_ordre       text,
    conditions          jsonb NOT NULL DEFAULT '[]'::jsonb,
    cree_par            uuid,
    cree_le             timestamptz NOT NULL DEFAULT now(),
    modifie_le          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_code, code)
);

-- contrôles
SELECT 'edt_source_perso' AS table_, count(*) FROM public.edt_source_perso
UNION ALL SELECT 'edt_champ_perso', count(*) FROM public.edt_champ_perso
UNION ALL SELECT 'champs perso', count(*) FROM public.edt_source_champ WHERE perso;

ROLLBACK;
-- COMMIT;
