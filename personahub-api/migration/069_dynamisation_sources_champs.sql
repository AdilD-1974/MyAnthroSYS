-- =============================================================================
-- Migration 069 — Dynamisation de type_source et des champs disponibles
--
-- Contexte : décision (27/08/2026) de sortir du code Python deux éléments
-- jusqu'ici codés en dur dans etats.py :
--   - CONTEXTE_REQUIS_PAR_TYPE_SOURCE (dict Python)
--   - CHAMPS_DISPONIBLES_BULLETIN (liste Python)
--
-- statut / visibilite / format_sortie restent des CHECK fixes (etat_definition,
-- migration 066) -- décision assumée : ce sont des états de workflow câblés
-- dans le code (RG-ETAT-GEN-02/03), pas de la donnée de référence. Les rendre
-- dynamiques déplacerait le risque d'une CHECK constraint (échec explicite)
-- vers un comportement silencieusement faux en production.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. ref_type_source_etat -- remplace l'énumération figée type_source
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ref_type_source_etat (
    code            text PRIMARY KEY,
    libelle         text NOT NULL,
    contexte_requis jsonb NOT NULL DEFAULT '[]'::jsonb,
    actif           boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ref_type_source_etat IS
    'RG-ETAT-GEN — Sources de données disponibles pour le générateur d''états (MODULE_ETATS_PAIE.md §13). Remplace l''ancien CHECK figé + le dict CONTEXTE_REQUIS_PAR_TYPE_SOURCE codé en dur dans etats.py.';
COMMENT ON COLUMN public.ref_type_source_etat.contexte_requis IS
    'RG-ETAT-ECRAN-02/03 : tableau JSON des clés de contexte requises (ex. ["collaborateur_id","periode_id"]) pour qu''un état de cette source soit lançable depuis un écran donné.';

INSERT INTO public.ref_type_source_etat (code, libelle, contexte_requis) VALUES
    ('BULLETIN',      'Bulletin de paie', '["collaborateur_id", "periode_id"]'),
    ('COLLABORATEUR', 'Collaborateur',    '["collaborateur_id"]'),
    ('DEPART',        'Départ',           '["collaborateur_id"]'),
    ('CONGE',         'Congé',            '["collaborateur_id"]'),
    ('PRET',          'Prêt',             '["collaborateur_id"]'),
    ('CNSS',          'CNSS',             '["periode_id"]'),
    ('CIMR',          'CIMR',             '["periode_id"]'),
    ('LIBRE',         'Libre',            '[]')
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. ref_champ_disponible_etat -- remplace CHAMPS_DISPONIBLES_BULLETIN
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ref_champ_disponible_etat (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    type_source_code    text NOT NULL REFERENCES public.ref_type_source_etat(code),
    champ_code          text NOT NULL,
    libelle             text NOT NULL,
    mode_donnee_defaut  text NOT NULL DEFAULT 'PERIODE',
    ordre_affichage     integer NOT NULL DEFAULT 0,
    actif               boolean NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ck_champ_disponible_mode_donnee CHECK (mode_donnee_defaut IN ('PERIODE', 'ACTUEL')),
    CONSTRAINT uq_champ_disponible_type_champ UNIQUE (type_source_code, champ_code)
);

CREATE INDEX IF NOT EXISTS idx_champ_disponible_type_source
    ON public.ref_champ_disponible_etat (type_source_code);

COMMENT ON TABLE public.ref_champ_disponible_etat IS
    'RG-ETAT-GEN-04 / RG-ETAT-PERIODE-04 (§14) — Champs proposables dans le générateur pour chaque source. Remplace la liste CHAMPS_DISPONIBLES_BULLETIN codée en dur dans etats.py.';

-- Seed : reprise exacte de CHAMPS_DISPONIBLES_BULLETIN (etats.py, avant dynamisation),
-- avec mode_donnee_defaut = ACTUEL pour les deux champs déjà identifiés comme
-- sans notion temporelle utile (CHAMPS_SANS_HISTORIQUE).
INSERT INTO public.ref_champ_disponible_etat (type_source_code, champ_code, libelle, mode_donnee_defaut, ordre_affichage) VALUES
    ('BULLETIN', 'identite.matricule',                  'Matricule',                          'PERIODE', 1),
    ('BULLETIN', 'identite.civilite',                   'Civilité',                           'PERIODE', 2),
    ('BULLETIN', 'identite.nom',                        'Nom',                                'PERIODE', 3),
    ('BULLETIN', 'identite.prenom',                     'Prénom',                             'PERIODE', 4),
    ('BULLETIN', 'identite.cin',                        'CIN',                                'PERIODE', 5),
    ('BULLETIN', 'identite.date_naissance',              'Date de naissance',                 'PERIODE', 6),
    ('BULLETIN', 'identite.num_cnss',                    'N° CNSS',                            'PERIODE', 7),
    ('BULLETIN', 'identite.num_amo',                     'N° AMO',                             'PERIODE', 8),
    ('BULLETIN', 'affectation.organisation_libelle',     'Organisation',                       'PERIODE', 9),
    ('BULLETIN', 'affectation.poste_reference_libelle',  'Poste',                              'PERIODE', 10),
    ('BULLETIN', 'affectation.emploi_libelle',           'Emploi',                             'PERIODE', 11),
    ('BULLETIN', 'affectation.metier_libelle',           'Métier',                             'PERIODE', 12),
    ('BULLETIN', 'qualification.code_grade',             'Grade',                              'PERIODE', 13),
    ('BULLETIN', 'qualification.echelon_actuel',         'Échelon',                            'PERIODE', 14),
    ('BULLETIN', 'qualification.classification_libelle', 'Classification',                     'PERIODE', 15),
    ('BULLETIN', 'qualification.qualification_libelle',  'Qualification',                      'PERIODE', 16),
    ('BULLETIN', 'qualification.points_attribues',       'Points attribués',                   'PERIODE', 17),
    ('BULLETIN', 'contrat.code_type_contrat',             'Type de contrat',                   'PERIODE', 18),
    ('BULLETIN', 'contrat.code_statut_contrat',           'Statut du contrat',                 'PERIODE', 19),
    ('BULLETIN', 'contrat.date_embauche',                 'Date d''embauche',                  'PERIODE', 20),
    ('BULLETIN', 'situation_familiale.code',              'Situation familiale',               'PERIODE', 21),
    ('BULLETIN', 'situation_familiale.nb_enfants_a_charge','Nombre d''enfants à charge',        'PERIODE', 22),
    ('BULLETIN', 'situation_familiale.nb_personnes_a_charge','Nombre de personnes à charge',    'PERIODE', 23),
    ('BULLETIN', 'adresse.adresse',                       'Adresse',                           'PERIODE', 24),
    ('BULLETIN', 'adresse.code_ville',                    'Ville',                             'PERIODE', 25),
    ('BULLETIN', 'adresse.telephone',                     'Téléphone',                         'ACTUEL',  26),
    ('BULLETIN', 'adresse.email',                         'Email',                             'ACTUEL',  27),
    ('BULLETIN', 'paiement.code_banque',                  'Banque',                            'PERIODE', 28),
    ('BULLETIN', 'paiement.code_iban',                    'IBAN',                              'PERIODE', 29),
    ('BULLETIN', 'paiement.intitule_compte',              'Intitulé du compte',                'PERIODE', 30)
ON CONFLICT (type_source_code, champ_code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. etat_definition.type_source : CHECK figé → FK vers la table de référence
-- -----------------------------------------------------------------------------
ALTER TABLE public.etat_definition
    DROP CONSTRAINT IF EXISTS ck_etat_definition_type_source;

ALTER TABLE public.etat_definition
    ADD CONSTRAINT fk_etat_definition_type_source
    FOREIGN KEY (type_source) REFERENCES public.ref_type_source_etat(code);

-- =============================================================================
-- Vérifications (à exécuter avant COMMIT)
-- =============================================================================

-- Doit renvoyer 8 lignes
SELECT code, libelle, contexte_requis FROM public.ref_type_source_etat ORDER BY code;

-- Doit renvoyer 30 lignes, toutes rattachées à BULLETIN
SELECT count(*) AS nb_champs_bulletin
FROM public.ref_champ_disponible_etat WHERE type_source_code = 'BULLETIN';

-- Doit renvoyer la nouvelle contrainte FK, plus de CHECK ck_etat_definition_type_source
SELECT conname, contype
FROM pg_constraint
WHERE conrelid = 'public.etat_definition'::regclass
  AND conname LIKE '%type_source%';

-- ⚠️ Décommenter après vérification :
-- COMMIT;

ROLLBACK;
