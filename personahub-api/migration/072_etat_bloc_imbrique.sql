-- =============================================================================
-- Migration 072 — etat_bloc, imbriqué DANS un corps (correction hiérarchie)
--
-- Contexte : clarification (28/08/2026) — le corps (migration 071) définit
-- la DONNÉE (colonnes, mapping attribut->colonne par rubrique). Le bloc est
-- un regroupement VISUEL d'un sous-ensemble des rubriques déjà rattachées à
-- un corps, avec son propre style ET :
--   - position du libellé du bloc (début / fin / aucun)
--   - position du total (haut / bas / aucun), PAR COLONNE, au choix -- un
--     bloc peut afficher un total pour certaines colonnes du corps
--     seulement, pas forcément toutes.
--
-- etat_bloc_rubrique référence etat_corps_rubrique (pas rubrique_paie
-- directement) : un bloc ne peut regrouper qu'une rubrique DÉJÀ rattachée
-- au corps parent -- pas de rubrique orpheline hors du corps.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. etat_bloc — regroupement visuel, imbriqué dans un corps
-- -----------------------------------------------------------------------------
CREATE TABLE public.etat_bloc (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    etat_corps_id       uuid NOT NULL REFERENCES public.etat_corps(id) ON DELETE CASCADE,
    bloc_code           text NOT NULL,
    libelle             text NOT NULL,
    ordre_affichage     integer NOT NULL DEFAULT 0,
    visible             boolean NOT NULL DEFAULT true,
    couleur_fond        text,
    couleur_texte       text,
    police              text,
    taille_police       integer,
    gras                boolean NOT NULL DEFAULT false,
    position_libelle    text NOT NULL DEFAULT 'DEBUT',
    position_total      text NOT NULL DEFAULT 'AUCUN',
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_etat_bloc_corps_code UNIQUE (etat_corps_id, bloc_code),
    CONSTRAINT ck_etat_bloc_position_libelle CHECK (position_libelle IN ('DEBUT', 'FIN', 'AUCUN')),
    CONSTRAINT ck_etat_bloc_position_total CHECK (position_total IN ('HAUT', 'BAS', 'AUCUN'))
);

CREATE INDEX idx_etat_bloc_corps_id ON public.etat_bloc (etat_corps_id);

COMMENT ON TABLE public.etat_bloc IS
    'RG-ETAT-BLOC — Regroupement visuel d''un sous-ensemble des rubriques d''UN corps (etat_corps_id), avec son propre style et position du libellé/total. Ne porte aucune donnée propre : la donnée (colonnes, mapping) reste sur le corps parent.';
COMMENT ON COLUMN public.etat_bloc.position_total IS
    'HAUT/BAS = où afficher la ligne de total du bloc par rapport à ses lignes ; AUCUN = pas de total. Les colonnes concernées par ce total sont choisies individuellement via etat_bloc_colonne_total (pas forcément toutes).';

-- -----------------------------------------------------------------------------
-- 2. etat_bloc_rubrique — quelles rubriques (déjà rattachées au corps
--    parent) appartiennent à ce bloc
-- -----------------------------------------------------------------------------
CREATE TABLE public.etat_bloc_rubrique (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    etat_bloc_id            uuid NOT NULL REFERENCES public.etat_bloc(id) ON DELETE CASCADE,
    etat_corps_rubrique_id  uuid NOT NULL REFERENCES public.etat_corps_rubrique(id) ON DELETE CASCADE,
    ordre_affichage         integer NOT NULL DEFAULT 0,

    CONSTRAINT uq_etat_bloc_rubrique UNIQUE (etat_bloc_id, etat_corps_rubrique_id)
);

CREATE INDEX idx_etat_bloc_rubrique_bloc_id ON public.etat_bloc_rubrique (etat_bloc_id);
CREATE INDEX idx_etat_bloc_rubrique_corps_rubrique_id ON public.etat_bloc_rubrique (etat_corps_rubrique_id);

COMMENT ON TABLE public.etat_bloc_rubrique IS
    'RG-ETAT-BLOC-02 — Rattache une rubrique DU CORPS PARENT (etat_corps_rubrique, pas rubrique_paie directement) à un bloc. RG-ETAT-BLOC-03 (appli, pas SQL) : une rubrique ne devrait appartenir qu''à un seul bloc au sein d''un même corps.';

-- -----------------------------------------------------------------------------
-- 3. etat_bloc_colonne_total — colonnes du corps pour lesquelles CE bloc
--    affiche un total (choix libre, pas forcément toutes)
-- -----------------------------------------------------------------------------
CREATE TABLE public.etat_bloc_colonne_total (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    etat_bloc_id            uuid NOT NULL REFERENCES public.etat_bloc(id) ON DELETE CASCADE,
    etat_corps_colonne_id   uuid NOT NULL REFERENCES public.etat_corps_colonne(id) ON DELETE CASCADE,

    CONSTRAINT uq_etat_bloc_colonne_total UNIQUE (etat_bloc_id, etat_corps_colonne_id)
);

CREATE INDEX idx_etat_bloc_colonne_total_bloc_id ON public.etat_bloc_colonne_total (etat_bloc_id);

COMMENT ON TABLE public.etat_bloc_colonne_total IS
    'RG-ETAT-BLOC-04 — Colonnes du corps parent pour lesquelles ce bloc affiche un total (position définie par etat_bloc.position_total). Une ligne = une colonne totalisée ; absence de ligne = pas de total pour cette colonne.';

-- =============================================================================
-- Vérifications (à exécuter avant COMMIT)
-- =============================================================================

SELECT count(*) AS blocs_existants FROM public.etat_bloc;
SELECT count(*) AS rattachements_rubrique FROM public.etat_bloc_rubrique;
SELECT count(*) AS totaux_existants FROM public.etat_bloc_colonne_total;

SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('etat_bloc', 'etat_bloc_rubrique', 'etat_bloc_colonne_total')
ORDER BY table_name;

SELECT conname, contype FROM pg_constraint
WHERE conrelid = 'public.etat_bloc'::regclass
ORDER BY conname;

-- ⚠️ Décommenter après vérification :
-- COMMIT;

ROLLBACK;
