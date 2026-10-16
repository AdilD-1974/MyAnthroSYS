-- =============================================================================
-- Migration 071 — Modèle unifié etat_corps (remplace etat_bloc, migration 070)
--
-- Contexte : analyse du "Report Manager" existant (27/08/2026, Exemple_bulletin.
-- docx) -- révèle un modèle à généraliser, plus riche que etat_bloc :
--   - Plusieurs "corps" nommés par état (pas un seul espace de blocs) --
--     ex. Corps 1 = tableau des rubriques (4 colonnes), Corps 3 = tableau
--     cumuls (colonnes différentes).
--   - Chaque corps a des colonnes NOMMÉES avec un format d'affichage.
--   - Pour chaque rubrique attachée à un corps, CHAQUE ATTRIBUT (Nombre/
--     Montant/Taux) est mappé individuellement vers une colonne du corps --
--     pas juste "la rubrique appartient à ce corps".
--   - Des "lignes spéciales" (totaux/constantes fixes, ex. "SALAIRE BRUT
--     IMPOSABLE") coexistent avec les rubriques dynamiques dans un corps.
--
-- Décision assumée : etat_bloc/etat_bloc_rubrique sont remplacées, pas
-- conservées en parallèle -- aucune donnée réelle ne dépend encore d'elles
-- (livrées il y a quelques échanges), et maintenir deux mécanismes qui se
-- chevauchent (regroupement + style) aurait été plus confus que ce remplacement.
--
-- RG-ETAT-CORPS-01 : un etat_corps est propre à SON état (etat_id), comme
-- l'était etat_bloc -- toujours aucune classification globale de rubrique.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Suppression de l'ancien modèle (etat_bloc / etat_bloc_rubrique, migration 070)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS public.etat_bloc_rubrique;
DROP TABLE IF EXISTS public.etat_bloc;

-- -----------------------------------------------------------------------------
-- 1. etat_corps — une section nommée du corps d'un état (ex. "Rubriques",
--    "Cumuls"). Reprend le style déjà présent sur etat_bloc.
-- -----------------------------------------------------------------------------
CREATE TABLE public.etat_corps (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    etat_id             uuid NOT NULL REFERENCES public.etat_definition(id) ON DELETE CASCADE,
    corps_code          text NOT NULL,
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

    CONSTRAINT uq_etat_corps_etat_code UNIQUE (etat_id, corps_code)
);

CREATE INDEX idx_etat_corps_etat_id ON public.etat_corps (etat_id);

COMMENT ON TABLE public.etat_corps IS
    'RG-ETAT-CORPS-01 — Section nommée du corps d''un état (ex. tableau des rubriques, tableau des cumuls), propre à SON état. Remplace etat_bloc (migration 070).';

-- -----------------------------------------------------------------------------
-- 2. etat_corps_colonne — colonnes nommées d'un corps, avec format d'affichage
-- -----------------------------------------------------------------------------
CREATE TABLE public.etat_corps_colonne (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    etat_corps_id       uuid NOT NULL REFERENCES public.etat_corps(id) ON DELETE CASCADE,
    code_colonne        text NOT NULL,
    libelle             text NOT NULL,
    format              text NOT NULL DEFAULT 'MONTANT_2DEC',
    ordre_affichage     integer NOT NULL DEFAULT 0,

    CONSTRAINT uq_etat_corps_colonne UNIQUE (etat_corps_id, code_colonne),
    CONSTRAINT ck_etat_corps_colonne_format CHECK (
        format IN ('MONTANT_2DEC', 'NOMBRE_ENTIER', 'NOMBRE_DECIMAL', 'POURCENTAGE', 'TEXTE', 'DATE')
    )
);

CREATE INDEX idx_etat_corps_colonne_corps_id ON public.etat_corps_colonne (etat_corps_id);

COMMENT ON TABLE public.etat_corps_colonne IS
    'RG-ETAT-CORPS-02 — Colonnes nommées d''un corps (ex. Gains, Base, Taux, Retenues), avec format d''affichage. format en CHECK fixe : lié à une vraie capacité de rendu du moteur (comme statut/visibilite sur etat_definition), pas de la donnée de référence libre.';

-- -----------------------------------------------------------------------------
-- 3. etat_corps_rubrique — rubriques attachées à un corps
-- -----------------------------------------------------------------------------
CREATE TABLE public.etat_corps_rubrique (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    etat_corps_id       uuid NOT NULL REFERENCES public.etat_corps(id) ON DELETE CASCADE,
    rubrique_paie_code  text NOT NULL REFERENCES public.rubrique_paie(code),
    ordre_affichage     integer NOT NULL DEFAULT 0,

    CONSTRAINT uq_etat_corps_rubrique UNIQUE (etat_corps_id, rubrique_paie_code)
);

CREATE INDEX idx_etat_corps_rubrique_corps_id ON public.etat_corps_rubrique (etat_corps_id);
CREATE INDEX idx_etat_corps_rubrique_code ON public.etat_corps_rubrique (rubrique_paie_code);

COMMENT ON TABLE public.etat_corps_rubrique IS
    'RG-ETAT-CORPS-03 : une rubrique ne devrait appartenir qu''à un seul corps au sein d''un même état -- vérifié côté API (comme RG-ETAT-BLOC-03 précédemment), pas en contrainte SQL.';

-- -----------------------------------------------------------------------------
-- 4. etat_corps_rubrique_colonne — LE VRAI AJOUT : quel attribut de la
--    rubrique (Nombre/Montant/Taux) atterrit dans quelle colonne du corps
-- -----------------------------------------------------------------------------
CREATE TABLE public.etat_corps_rubrique_colonne (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    etat_corps_rubrique_id  uuid NOT NULL REFERENCES public.etat_corps_rubrique(id) ON DELETE CASCADE,
    attribut                text NOT NULL,
    etat_corps_colonne_id   uuid NOT NULL REFERENCES public.etat_corps_colonne(id) ON DELETE CASCADE,

    CONSTRAINT uq_etat_corps_rubrique_colonne_attribut UNIQUE (etat_corps_rubrique_id, attribut),
    CONSTRAINT ck_etat_corps_rubrique_colonne_attribut CHECK (attribut IN ('NOMBRE', 'MONTANT', 'TAUX'))
);

CREATE INDEX idx_etat_corps_rubrique_colonne_rubrique ON public.etat_corps_rubrique_colonne (etat_corps_rubrique_id);
CREATE INDEX idx_etat_corps_rubrique_colonne_colonne ON public.etat_corps_rubrique_colonne (etat_corps_colonne_id);

COMMENT ON TABLE public.etat_corps_rubrique_colonne IS
    'RG-ETAT-CORPS-04 — Mapping attribut de rubrique -> colonne du corps (ex. Nombre -> colonne "Base", Montant -> colonne "Gains", Taux -> colonne "Taux"), un par attribut au maximum par rubrique.';

-- -----------------------------------------------------------------------------
-- 5. etat_corps_ligne_speciale — lignes fixes/constantes, distinctes des
--    rubriques dynamiques (ex. "SALAIRE BRUT IMPOSABLE", "GAIN NET")
-- -----------------------------------------------------------------------------
CREATE TABLE public.etat_corps_ligne_speciale (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    etat_corps_id           uuid NOT NULL REFERENCES public.etat_corps(id) ON DELETE CASCADE,
    code_constante          text NOT NULL,
    libelle                 text NOT NULL,
    etat_corps_colonne_id   uuid REFERENCES public.etat_corps_colonne(id) ON DELETE SET NULL,
    ordre_affichage         integer NOT NULL DEFAULT 0,

    CONSTRAINT uq_etat_corps_ligne_speciale UNIQUE (etat_corps_id, code_constante)
);

CREATE INDEX idx_etat_corps_ligne_speciale_corps_id ON public.etat_corps_ligne_speciale (etat_corps_id);

COMMENT ON TABLE public.etat_corps_ligne_speciale IS
    'RG-ETAT-CORPS-05 — Lignes fixes (totaux, constantes de calcul) au sein d''un corps, distinctes des rubriques dynamiques. code_constante en texte libre, NON vérifié par FK : schéma de la table des constantes de paie (ref_constante_paie ?) non confirmé à ce stade -- validation applicative à ajouter une fois ce schéma vérifié.';

-- -----------------------------------------------------------------------------
-- 6. ref_modele_etat — catalogue des modèles de rendu codés (équivalent du
--    "Modèle Qrp" du Report Manager)
-- -----------------------------------------------------------------------------
CREATE TABLE public.ref_modele_etat (
    code                    text PRIMARY KEY,
    libelle                 text NOT NULL,
    type_source_compatible  jsonb NOT NULL DEFAULT '[]'::jsonb,
    actif                   boolean NOT NULL DEFAULT true,
    created_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ref_modele_etat IS
    'RG-ETAT-MODELE — Catalogue des modèles de rendu disponibles (équivalent "Modèle Qrp" du Report Manager). type_source_compatible = tableau JSON des type_source pouvant utiliser ce modèle. Le chemin/référence technique du template réel (non fourni à ce stade) est à ajouter une fois les 5 templates de bulletin existants confirmés (Classique/Moderne/Compact/Détaillé/Minimaliste).';

-- Seed des 5 modèles de bulletin déjà mentionnés en mémoire projet -- codes
-- et libellés seulement, PAS de référence technique de template (chemin de
-- fichier non confirmé, à compléter une fois vérifié).
INSERT INTO public.ref_modele_etat (code, libelle, type_source_compatible) VALUES
    ('bulletin_classique', 'Classique', '["BULLETIN"]'),
    ('bulletin_moderne',   'Moderne',   '["BULLETIN"]'),
    ('bulletin_compact',   'Compact',   '["BULLETIN"]'),
    ('bulletin_detaille',  'Détaillé',  '["BULLETIN"]'),
    ('bulletin_minimal',   'Minimaliste', '["BULLETIN"]');

ALTER TABLE public.etat_definition
    ADD COLUMN modele_code text REFERENCES public.ref_modele_etat(code);

COMMENT ON COLUMN public.etat_definition.modele_code IS
    'RG-ETAT-MODELE — Modèle de rendu choisi (catalogue ref_modele_etat), équivalent du champ "Modèle" du Report Manager. NULL = pas encore de moteur de rendu générique branché (chantier séparé) -- l''état reste utilisable via template_html en attendant.';

-- =============================================================================
-- Vérifications (à exécuter avant COMMIT)
-- =============================================================================

-- Doit renvoyer 0 (anciennes tables bien supprimées)
SELECT count(*) AS anciennes_tables_restantes
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('etat_bloc', 'etat_bloc_rubrique');

-- Doit renvoyer 5 lignes
SELECT code, libelle, type_source_compatible FROM public.ref_modele_etat ORDER BY code;

-- Doit renvoyer toutes les tables neuves créées
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
      'etat_corps', 'etat_corps_colonne', 'etat_corps_rubrique',
      'etat_corps_rubrique_colonne', 'etat_corps_ligne_speciale', 'ref_modele_etat'
  )
ORDER BY table_name;

-- Doit renvoyer la nouvelle colonne modele_code sur etat_definition
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'etat_definition' AND column_name = 'modele_code';

-- ⚠️ Décommenter après vérification :
-- COMMIT;

ROLLBACK;
