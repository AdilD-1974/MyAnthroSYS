-- =============================================================================
-- Migration 066 — Socle du générateur d'états personnalisés
-- RG-ETAT-GEN / RG-ETAT-ECRAN / RG-ETAT-PERIODE (MODULE_ETATS_PAIE.md §13-§14)
--
-- Crée les 4 tables du référentiel :
--   - etat_definition        : définition d'un état (source, mise en forme, statut)
--   - etat_champ_selection   : champs affichés par état, avec mode_donnee
--                              (PERIODE/ACTUEL — RG-ETAT-PERIODE §14)
--   - ecran_lancement        : référentiel des écrans pouvant lancer un état
--   - etat_ecran_association : association état <-> écran(s)
--
-- Pattern société : societe_id NULLABLE sur etat_definition, même logique
-- générique/spécifique que regle_calcul_specifique/bareme/ref_categorie_regime
-- (societe_id IS NULL = générique, override possible par société).
--
-- ⚠️ Numéro de migration à confirmer avant exécution : 066 est une
-- estimation basée sur le dernier numéro confirmé (065, Postes/GPEC). Si un
-- autre numéro a été pris entre-temps, renommer le fichier et adapter le
-- commentaire d'en-tête avant déploiement.
--
-- ROLLBACK par défaut : décommenter COMMIT en fin de script après vérification
-- que les comptages de contrôle sont à zéro / cohérents.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. etat_definition
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.etat_definition (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code                text NOT NULL,
    nom                 text NOT NULL,
    description         text,
    societe_id          uuid NULL REFERENCES public.societes(id),
    type_source         text NOT NULL,
    template_html       text,
    pied_de_page_html   text,
    afficher_logo       boolean NOT NULL DEFAULT true,
    format_sortie       text NOT NULL DEFAULT 'PDF',
    statut              text NOT NULL DEFAULT 'BROUILLON',
    visibilite          text NOT NULL DEFAULT 'PRIVE',
    cree_par_user_id    uuid NULL REFERENCES public.users(id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ck_etat_definition_type_source CHECK (
        type_source IN ('BULLETIN', 'COLLABORATEUR', 'DEPART', 'CONGE', 'PRET', 'CNSS', 'CIMR', 'LIBRE')
    ),
    CONSTRAINT ck_etat_definition_format_sortie CHECK (
        format_sortie IN ('PDF', 'EXCEL', 'LES_DEUX')
    ),
    CONSTRAINT ck_etat_definition_statut CHECK (
        statut IN ('BROUILLON', 'PUBLIE', 'ARCHIVE')
    ),
    CONSTRAINT ck_etat_definition_visibilite CHECK (
        visibilite IN ('PRIVE', 'SOCIETE', 'GLOBAL')
    ),
    -- Un code peut se répéter entre sociétés (pattern générique/spécifique),
    -- mais pas deux fois pour la même société (ou deux fois en générique).
    CONSTRAINT uq_etat_definition_code_societe UNIQUE (code, societe_id)
);

CREATE INDEX IF NOT EXISTS idx_etat_definition_societe_id
    ON public.etat_definition (societe_id);
CREATE INDEX IF NOT EXISTS idx_etat_definition_statut
    ON public.etat_definition (statut);
CREATE INDEX IF NOT EXISTS idx_etat_definition_type_source
    ON public.etat_definition (type_source);

COMMENT ON TABLE public.etat_definition IS
    'RG-ETAT-GEN — Référentiel des états personnalisés (générateur, MODULE_ETATS_PAIE.md §13). societe_id NULL = générique (visible toutes sociétés si visibilite=GLOBAL).';
COMMENT ON COLUMN public.etat_definition.statut IS
    'RG-ETAT-GEN-02/03 : BROUILLON par défaut, non lançable tant que non PUBLIE.';
COMMENT ON COLUMN public.etat_definition.visibilite IS
    'RG-ETAT-GEN-01 : PRIVE (créateur seul) par défaut pour un utilisateur standard ; SOCIETE/GLOBAL réservés à un admin.';

-- -----------------------------------------------------------------------------
-- 2. etat_champ_selection
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.etat_champ_selection (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    etat_id         uuid NOT NULL REFERENCES public.etat_definition(id) ON DELETE CASCADE,
    champ_code      text NOT NULL,
    visible         boolean NOT NULL DEFAULT true,
    ordre_affichage integer NOT NULL DEFAULT 0,
    mode_donnee     text NOT NULL DEFAULT 'PERIODE',

    CONSTRAINT ck_etat_champ_selection_mode_donnee CHECK (
        mode_donnee IN ('PERIODE', 'ACTUEL')
    ),
    CONSTRAINT uq_etat_champ_selection_etat_champ UNIQUE (etat_id, champ_code)
);

CREATE INDEX IF NOT EXISTS idx_etat_champ_selection_etat_id
    ON public.etat_champ_selection (etat_id);

COMMENT ON TABLE public.etat_champ_selection IS
    'RG-ETAT-GEN-04 / RG-ETAT-PERIODE-04 (§14) — Champs affichés par état, projection uniquement (ne filtre jamais la donnée source/le snapshot).';
COMMENT ON COLUMN public.etat_champ_selection.mode_donnee IS
    'RG-ETAT-PERIODE-04 : PERIODE (défaut) = donnée figée au snapshot de la période ; ACTUEL = lecture live, réservé aux champs sans notion temporelle sauf bascule ponctuelle utilisateur (RG-ETAT-PERIODE-03, gérée à la génération, pas ici).';

-- -----------------------------------------------------------------------------
-- 3. ecran_lancement
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ecran_lancement (
    code_ecran          text PRIMARY KEY,
    libelle             text NOT NULL,
    contexte_disponible jsonb NOT NULL DEFAULT '[]'::jsonb,
    actif               boolean NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ecran_lancement IS
    'RG-ETAT-ECRAN — Référentiel des écrans pouvant accueillir un bouton de génération d''état. contexte_disponible = tableau JSON des clés de contexte fournies par l''écran (ex. ["collaborateur_id","periode_id"]).';

-- Seed idempotent des écrans déjà identifiés dans MODULE_ETATS_PAIE.md §15.5.
-- À COMPLÉTER/CORRIGER si le code_ecran réel diffère de ce qui est deviné ici
-- (aucun de ces codes n'a été vérifié contre App.tsx/NavContext.tsx à ce stade).
INSERT INTO public.ecran_lancement (code_ecran, libelle, contexte_disponible)
SELECT 'FICHE_COLLABORATEUR', 'Fiche collaborateur', '["collaborateur_id", "societe_id"]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.ecran_lancement WHERE code_ecran = 'FICHE_COLLABORATEUR');

INSERT INTO public.ecran_lancement (code_ecran, libelle, contexte_disponible)
SELECT 'TRAITEMENT_PAIE', 'Traitement / consultation bulletin', '["collaborateur_id", "periode_id", "bulletin_id", "societe_id"]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.ecran_lancement WHERE code_ecran = 'TRAITEMENT_PAIE');

INSERT INTO public.ecran_lancement (code_ecran, libelle, contexte_disponible)
SELECT 'DEPARTS', 'Module départs', '["collaborateur_id", "societe_id"]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.ecran_lancement WHERE code_ecran = 'DEPARTS');

INSERT INTO public.ecran_lancement (code_ecran, libelle, contexte_disponible)
SELECT 'DECLARATION_CNSS', 'Déclaration CNSS', '["periode_id", "societe_id"]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.ecran_lancement WHERE code_ecran = 'DECLARATION_CNSS');

INSERT INTO public.ecran_lancement (code_ecran, libelle, contexte_disponible)
SELECT 'DECLARATION_CIMR', 'Déclaration CIMR', '["periode_id", "societe_id"]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.ecran_lancement WHERE code_ecran = 'DECLARATION_CIMR');

-- -----------------------------------------------------------------------------
-- 4. etat_ecran_association
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.etat_ecran_association (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    etat_id         uuid NOT NULL REFERENCES public.etat_definition(id) ON DELETE CASCADE,
    code_ecran      text NOT NULL REFERENCES public.ecran_lancement(code_ecran) ON DELETE CASCADE,
    ordre_affichage integer NOT NULL DEFAULT 0,

    CONSTRAINT uq_etat_ecran_association UNIQUE (etat_id, code_ecran)
);

CREATE INDEX IF NOT EXISTS idx_etat_ecran_association_code_ecran
    ON public.etat_ecran_association (code_ecran);

COMMENT ON TABLE public.etat_ecran_association IS
    'RG-ETAT-ECRAN-01 — Association d''un état publié à un ou plusieurs écrans de lancement. Cas particulier de nav_menu_item (RG-ETAT-ECRAN-04) : ne pas dupliquer la logique de NavContext.tsx côté frontend.';

-- =============================================================================
-- Vérifications (à exécuter avant COMMIT)
-- =============================================================================

-- Doit renvoyer 5 (le seed ci-dessus) au premier passage, 0 les passages suivants
SELECT count(*) AS ecrans_inseres_ce_passage
FROM public.ecran_lancement
WHERE created_at >= now() - interval '1 minute';

-- Doit renvoyer 4 lignes, toutes avec contraintes actives
SELECT conname, contype
FROM pg_constraint
WHERE conrelid IN (
    'public.etat_definition'::regclass,
    'public.etat_champ_selection'::regclass,
    'public.ecran_lancement'::regclass,
    'public.etat_ecran_association'::regclass
)
ORDER BY conrelid, conname;

-- Doit renvoyer 0 (aucune donnée ne doit exister avant la première utilisation réelle)
SELECT count(*) AS etats_existants FROM public.etat_definition;

-- ⚠️ Décommenter après vérification des comptages ci-dessus :
-- COMMIT;

ROLLBACK;
