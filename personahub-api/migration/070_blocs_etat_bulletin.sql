-- =============================================================================
-- Migration 070 — Blocs du corps d'un état (RG-ETAT-BLOC)
--
-- Contexte : décision (27/08/2026) — la classification d'une rubrique dans
-- un bloc (ex. "gain imposable", "indemnité exonérée", "cotisation
-- salariale") est PROPRE À CHAQUE ÉTAT, pas une donnée globale de
-- rubrique_paie. Un même code de rubrique peut donc être classé
-- différemment (ou absent) d'un état à l'autre -- aucune table de
-- référence partagée entre états pour cette classification.
--
-- etat_bloc_rubrique.rubrique_paie_code référence rubrique_paie(code) en
-- vraie FOREIGN KEY -- confirmé le 27/08/2026 que rubrique_paie a sa PRIMARY
-- KEY sur code seul (pas de doublon par société malgré rubrique_paie.
-- societe_id nullable -- ce champ sert à autre chose que la mémoire projet
-- ne décrivait, à ne pas supposer être un pattern générique/société à
-- codes dupliqués pour cette table précise).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. etat_bloc — un bloc de présentation propre à un état
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.etat_bloc (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    etat_id             uuid NOT NULL REFERENCES public.etat_definition(id) ON DELETE CASCADE,
    bloc_code           text NOT NULL,
    libelle             text NOT NULL,
    ordre_affichage     integer NOT NULL DEFAULT 0,
    visible             boolean NOT NULL DEFAULT true,
    couleur_fond        text,
    couleur_texte       text,
    police              text,
    taille_police       integer,
    gras                boolean NOT NULL DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_etat_bloc_etat_code UNIQUE (etat_id, bloc_code)
);

CREATE INDEX IF NOT EXISTS idx_etat_bloc_etat_id ON public.etat_bloc (etat_id);

COMMENT ON TABLE public.etat_bloc IS
    'RG-ETAT-BLOC — Bloc de regroupement du corps d''un état (ex. gain imposable, cotisation salariale), avec sa présentation (couleur, police). Propre à un etat_id : pas de classification globale des rubriques, aucun catalogue partagé entre états.';
COMMENT ON COLUMN public.etat_bloc.bloc_code IS
    'Code choisi par le créateur de l''état, unique dans le périmètre de CET état seulement (pas globalement).';

-- -----------------------------------------------------------------------------
-- 2. etat_bloc_rubrique — quelles rubriques appartiennent à ce bloc
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.etat_bloc_rubrique (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    etat_bloc_id        uuid NOT NULL REFERENCES public.etat_bloc(id) ON DELETE CASCADE,
    rubrique_paie_code  text NOT NULL REFERENCES public.rubrique_paie(code),
    ordre_affichage     integer NOT NULL DEFAULT 0,

    CONSTRAINT uq_etat_bloc_rubrique UNIQUE (etat_bloc_id, rubrique_paie_code)
);

CREATE INDEX IF NOT EXISTS idx_etat_bloc_rubrique_bloc_id ON public.etat_bloc_rubrique (etat_bloc_id);
CREATE INDEX IF NOT EXISTS idx_etat_bloc_rubrique_code ON public.etat_bloc_rubrique (rubrique_paie_code);

COMMENT ON TABLE public.etat_bloc_rubrique IS
    'RG-ETAT-BLOC-02 — Rattachement d''une rubrique de paie à un bloc, pour un état donné. RG-ETAT-BLOC-03 (appliquée côté API, pas en contrainte SQL) : une même rubrique ne devrait appartenir qu''à un seul bloc au sein d''un même état, pour éviter un double comptage à l''édition.';

-- =============================================================================
-- Vérifications (à exécuter avant COMMIT)
-- =============================================================================

-- Doit renvoyer 0 (tables neuves, aucune donnée avant la première utilisation réelle)
SELECT count(*) AS blocs_existants FROM public.etat_bloc;
SELECT count(*) AS rattachements_existants FROM public.etat_bloc_rubrique;

-- Doit renvoyer les contraintes attendues (uq_etat_bloc_etat_code, FK etat_id,
-- uq_etat_bloc_rubrique, FK etat_bloc_id, FK rubrique_paie_code)
SELECT conrelid::regclass AS table_nom, conname, contype
FROM pg_constraint
WHERE conrelid IN ('public.etat_bloc'::regclass, 'public.etat_bloc_rubrique'::regclass)
ORDER BY table_nom, conname;

-- ⚠️ Décommenter après vérification :
-- COMMIT;

ROLLBACK;
