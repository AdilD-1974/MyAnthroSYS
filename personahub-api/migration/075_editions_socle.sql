-- =============================================================================
-- Migration 075 — Socle de la plateforme d'éditions unifiée (schéma edt_*)
-- Auteur : Adil DAIA — lot 1 (16/10/2026)
-- Conception : « Plateforme d'états unifiée — Dossier de conception », onglet
-- « Lot 1 — Spécification », section DDL.
--
-- Crée 20 tables, toutes préfixées edt_, sans toucher aux tables existantes :
--   catalogue      edt_source, edt_source_champ, edt_source_relation, edt_fonction, edt_masque
--   modèles        edt_modele, edt_modele_version, edt_modele_dependance,
--                  edt_variante, edt_variante_version, edt_charte, edt_asset,
--                  edt_point_lancement
--   production     edt_demande, edt_document, edt_planification, edt_canal, edt_diffusion
--   gouvernance    edt_droit, edt_audit
-- Ajoute les entrées de menu « editions » et « requeteur » dans menu_items
-- (accès par rôle piloté par l'écran des rôles, comme la migration 068).
--
-- Idempotente (IF NOT EXISTS / NOT EXISTS) : relançable sans effet de bord.
-- Les anciennes tables etat_*, rapport_*, requeteur_* restent en place
-- jusqu'à la bascule du lot 4.
--
-- Pattern société : societe_id NULL = générique, renseigné = propre à une société.
-- Les colonnes d'utilisateur référencent users(id), ON DELETE SET NULL.
--
-- ROLLBACK par défaut : passer à COMMIT après vérification des contrôles en fin
-- de script.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. CATALOGUE — RG-EDT-SOURCE-04 : alimenté par les fournisseurs Python au
--    démarrage ; seuls libellés, sensibilité et visibilité s'administrent.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.edt_source (
    code             text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
    libelle          text NOT NULL,
    nature           text NOT NULL CHECK (nature IN ('PAIE_SNAPSHOT','RH_DATE','REFERENTIEL','CALCULEE')),
    fournisseur      text NOT NULL,
    contexte_requis  jsonb NOT NULL DEFAULT '[]'::jsonb,
    actif            boolean NOT NULL DEFAULT true,
    synchronise_le   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.edt_source_champ (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_code    text NOT NULL REFERENCES public.edt_source(code) ON DELETE CASCADE,
    code           text NOT NULL,
    libelle        text NOT NULL,
    groupe         text,
    type_donnee    text NOT NULL CHECK (type_donnee IN ('TEXTE','NOMBRE','MONTANT','DATE','BOOLEEN','IMAGE')),
    chemin         text NOT NULL,
    masque_defaut  text,
    sensible       boolean NOT NULL DEFAULT false,
    visible        boolean NOT NULL DEFAULT true,
    actif          boolean NOT NULL DEFAULT true,     -- false = disparu du fournisseur
    libelle_modifie boolean NOT NULL DEFAULT false,   -- true = la synchro ne l'écrase plus
    ordre          integer NOT NULL DEFAULT 0,
    UNIQUE (source_code, code)
);

CREATE TABLE IF NOT EXISTS public.edt_source_relation (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_code  text NOT NULL REFERENCES public.edt_source(code) ON DELETE CASCADE,
    cible_code   text NOT NULL REFERENCES public.edt_source(code) ON DELETE CASCADE,
    code         text NOT NULL,
    cardinalite  text NOT NULL CHECK (cardinalite IN ('UN','PLUSIEURS')),
    cle_source   text NOT NULL,
    cle_cible    text NOT NULL,
    UNIQUE (source_code, code)
);

CREATE TABLE IF NOT EXISTS public.edt_fonction (
    code       text PRIMARY KEY,
    categorie  text NOT NULL,
    signature  text NOT NULL,
    aide       text,
    exemple    text,
    origine    text NOT NULL DEFAULT 'EDITION' CHECK (origine IN ('PAIE','EDITION'))
);

-- Masques propres à une société ; les masques standard vivent dans le code
-- (app/editions/format.py, MASQUES_STANDARD) et ne sont pas dupliqués ici.
CREATE TABLE IF NOT EXISTS public.edt_masque (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code         text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
    libelle      text NOT NULL,
    type_donnee  text NOT NULL CHECK (type_donnee IN ('NOMBRE','DATE','TEXTE')),
    parametres   jsonb NOT NULL,
    societe_id   uuid REFERENCES public.societes(id),
    actif        boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_edt_masque_code
    ON public.edt_masque (code, COALESCE(societe_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- -----------------------------------------------------------------------------
-- 2. MODÈLES ET VERSIONS — RG-EDT-MODELE-01..03, RG-EDT-VERSION-01..05
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.edt_modele (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code                text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
    libelle             text NOT NULL,
    description         text,
    categorie           text NOT NULL CHECK (categorie IN ('BULLETIN','JOURNAL','ATTESTATION','COURRIER',
                                                           'LISTE','DECLARATION','AUTRE')),
    moteur              text NOT NULL DEFAULT 'NATIF' CHECK (moteur IN ('NATIF','CRYSTAL')),
    societe_id          uuid REFERENCES public.societes(id),
    proprietaire_id     uuid REFERENCES public.users(id) ON DELETE SET NULL,
    visibilite          text NOT NULL DEFAULT 'PRIVE' CHECK (visibilite IN ('PRIVE','SOCIETE','GLOBAL')),
    est_systeme         boolean NOT NULL DEFAULT false,
    modele_origine_id   uuid REFERENCES public.edt_modele(id),
    version_publiee_id  uuid,                                  -- FK posée plus bas
    archive             boolean NOT NULL DEFAULT false,
    cree_le             timestamptz NOT NULL DEFAULT now(),
    modifie_le          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_edt_modele_code
    ON public.edt_modele (code, COALESCE(societe_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE IF NOT EXISTS public.edt_modele_version (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    modele_id          uuid NOT NULL REFERENCES public.edt_modele(id),
    numero             integer NOT NULL CHECK (numero > 0),
    statut             text NOT NULL DEFAULT 'BROUILLON'
                       CHECK (statut IN ('BROUILLON','EN_REVUE','PUBLIEE','RETIREE')),
    definition         jsonb NOT NULL,
    schema_version     integer NOT NULL DEFAULT 1,
    empreinte          char(64),
    jeton_concurrence  uuid NOT NULL DEFAULT gen_random_uuid(),
    note               text,
    cree_par           uuid REFERENCES public.users(id) ON DELETE SET NULL,
    cree_le            timestamptz NOT NULL DEFAULT now(),
    modifie_le         timestamptz NOT NULL DEFAULT now(),
    publie_par         uuid REFERENCES public.users(id) ON DELETE SET NULL,
    publie_le          timestamptz,
    UNIQUE (modele_id, numero),
    -- RG-EDT-VERSION-01 : une version publiée ou retirée porte son empreinte
    CHECK (statut IN ('BROUILLON','EN_REVUE') OR empreinte IS NOT NULL)
);
-- RG-EDT-VERSION-02 : au plus un brouillon ouvert par modèle
CREATE UNIQUE INDEX IF NOT EXISTS ux_edt_version_brouillon
    ON public.edt_modele_version (modele_id) WHERE statut IN ('BROUILLON','EN_REVUE');
-- RG-EDT-VERSION-02 : au plus une version publiée par modèle
CREATE UNIQUE INDEX IF NOT EXISTS ux_edt_version_publiee
    ON public.edt_modele_version (modele_id) WHERE statut = 'PUBLIEE';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_edt_modele_version_publiee') THEN
        ALTER TABLE public.edt_modele
            ADD CONSTRAINT fk_edt_modele_version_publiee
            FOREIGN KEY (version_publiee_id) REFERENCES public.edt_modele_version(id);
    END IF;
END $$;

-- RG-EDT-VERSION-01 : une version publiée ne se modifie plus (définition,
-- empreinte, numéro). Seul le passage PUBLIEE → RETIREE reste possible.
CREATE OR REPLACE FUNCTION public.edt_version_immuable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.statut IN ('PUBLIEE','RETIREE') THEN
        IF NEW.definition IS DISTINCT FROM OLD.definition
           OR NEW.empreinte IS DISTINCT FROM OLD.empreinte
           OR NEW.numero <> OLD.numero
           OR NEW.modele_id <> OLD.modele_id
           OR (OLD.statut = 'RETIREE' AND NEW.statut <> 'RETIREE')
           OR (OLD.statut = 'PUBLIEE' AND NEW.statut NOT IN ('PUBLIEE','RETIREE')) THEN
            RAISE EXCEPTION 'RG-EDT-VERSION-01 : la version % (n° %) est figée', OLD.id, OLD.numero
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_edt_version_immuable ON public.edt_modele_version;
CREATE TRIGGER trg_edt_version_immuable
    BEFORE UPDATE ON public.edt_modele_version
    FOR EACH ROW EXECUTE FUNCTION public.edt_version_immuable();

CREATE OR REPLACE FUNCTION public.edt_version_non_supprimable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.statut IN ('PUBLIEE','RETIREE') THEN
        RAISE EXCEPTION 'RG-EDT-MODELE-03 : une version publiée ne se supprime pas (n° %)', OLD.numero
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_edt_version_non_supprimable ON public.edt_modele_version;
CREATE TRIGGER trg_edt_version_non_supprimable
    BEFORE DELETE ON public.edt_modele_version
    FOR EACH ROW EXECUTE FUNCTION public.edt_version_non_supprimable();

CREATE TABLE IF NOT EXISTS public.edt_modele_dependance (
    version_id  uuid NOT NULL REFERENCES public.edt_modele_version(id) ON DELETE CASCADE,
    type        text NOT NULL CHECK (type IN ('SOURCE','CHAMP','RUBRIQUE','CONSTANTE','MASQUE',
                                              'ASSET','SOUS_MODELE','TABLE')),
    code        text NOT NULL,
    PRIMARY KEY (version_id, type, code)
);
CREATE INDEX IF NOT EXISTS ix_edt_dependance_code ON public.edt_modele_dependance (type, code);

-- Variantes de forme — RG-EDT-FORME-01..04
CREATE TABLE IF NOT EXISTS public.edt_variante (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    modele_id           uuid NOT NULL REFERENCES public.edt_modele(id),
    code                text NOT NULL,
    libelle             text NOT NULL,
    societe_id          uuid REFERENCES public.societes(id),
    par_defaut          boolean NOT NULL DEFAULT false,
    version_publiee_id  uuid,
    archive             boolean NOT NULL DEFAULT false,
    cree_le             timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_edt_variante_code
    ON public.edt_variante (modele_id, code, COALESCE(societe_id, '00000000-0000-0000-0000-000000000000'::uuid));
-- une seule variante par défaut par modèle et par société
CREATE UNIQUE INDEX IF NOT EXISTS ux_edt_variante_defaut
    ON public.edt_variante (modele_id, COALESCE(societe_id, '00000000-0000-0000-0000-000000000000'::uuid))
    WHERE par_defaut AND NOT archive;

CREATE TABLE IF NOT EXISTS public.edt_variante_version (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    variante_id      uuid NOT NULL REFERENCES public.edt_variante(id),
    numero           integer NOT NULL CHECK (numero > 0),
    statut           text NOT NULL DEFAULT 'BROUILLON' CHECK (statut IN ('BROUILLON','PUBLIEE','RETIREE')),
    base_version_id  uuid NOT NULL REFERENCES public.edt_modele_version(id),
    surcharges       jsonb NOT NULL DEFAULT '[]'::jsonb,
    conflits         jsonb NOT NULL DEFAULT '[]'::jsonb,
    jeton_concurrence uuid NOT NULL DEFAULT gen_random_uuid(),
    cree_par         uuid REFERENCES public.users(id) ON DELETE SET NULL,
    cree_le          timestamptz NOT NULL DEFAULT now(),
    publie_par       uuid REFERENCES public.users(id) ON DELETE SET NULL,
    publie_le        timestamptz,
    UNIQUE (variante_id, numero)
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_edt_variante_version_publiee') THEN
        ALTER TABLE public.edt_variante
            ADD CONSTRAINT fk_edt_variante_version_publiee
            FOREIGN KEY (version_publiee_id) REFERENCES public.edt_variante_version(id);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.edt_asset (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text NOT NULL,
    type        text NOT NULL CHECK (type IN ('IMAGE','POLICE','SIGNATURE','CACHET','RPT')),
    fichier     text NOT NULL,             -- chemin relatif sous la racine de stockage
    sha256      char(64) NOT NULL,
    taille      integer NOT NULL CHECK (taille >= 0),
    type_mime   text,
    societe_id  uuid REFERENCES public.societes(id),
    protege     boolean NOT NULL DEFAULT false,   -- signatures et cachets : droit SIGNER
    cree_par    uuid REFERENCES public.users(id) ON DELETE SET NULL,
    cree_le     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_edt_asset_code
    ON public.edt_asset (code, COALESCE(societe_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE IF NOT EXISTS public.edt_charte (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code            text NOT NULL,
    societe_id      uuid REFERENCES public.societes(id),
    polices         jsonb NOT NULL DEFAULT '{}'::jsonb,
    couleurs        jsonb NOT NULL DEFAULT '{}'::jsonb,
    logo_asset_id   uuid REFERENCES public.edt_asset(id),
    entete_defaut   jsonb,
    pied_defaut     jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_edt_charte_code
    ON public.edt_charte (code, COALESCE(societe_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE IF NOT EXISTS public.edt_point_lancement (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    modele_id                uuid NOT NULL REFERENCES public.edt_modele(id) ON DELETE CASCADE,
    code_ecran               text NOT NULL,
    correspondance_contexte  jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {"collaborateur": "collaborateur_id"}
    libelle_bouton           text,
    ordre                    integer NOT NULL DEFAULT 0,
    UNIQUE (modele_id, code_ecran)
);

-- -----------------------------------------------------------------------------
-- 3. PRODUCTION ET DIFFUSION — RG-EDT-PROD-01, RG-EDT-DIFF-01/02
--    edt_demande sert aussi de file d'attente (SELECT … FOR UPDATE SKIP LOCKED)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.edt_demande (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id           uuid NOT NULL REFERENCES public.edt_modele_version(id),
    variante_version_id  uuid REFERENCES public.edt_variante_version(id),
    parametres           jsonb NOT NULL DEFAULT '{}'::jsonb,
    formats              text NOT NULL DEFAULT 'PDF',
    origine              text NOT NULL CHECK (origine IN ('ECRAN','LOT','PLANIFICATION','WORKFLOW','API','APERCU')),
    statut               text NOT NULL DEFAULT 'EN_ATTENTE'
                         CHECK (statut IN ('EN_ATTENTE','EN_COURS','TERMINEE','ECHEC','ANNULEE')),
    progression          integer NOT NULL DEFAULT 0 CHECK (progression BETWEEN 0 AND 100),
    nb_documents         integer NOT NULL DEFAULT 0,
    demandeur_id         uuid REFERENCES public.users(id) ON DELETE SET NULL,
    societe_id           uuid NOT NULL REFERENCES public.societes(id),
    planification_id     uuid,
    cree_le              timestamptz NOT NULL DEFAULT now(),
    debut                timestamptz,
    fin                  timestamptz,
    erreur               text
);
CREATE INDEX IF NOT EXISTS ix_edt_demande_file ON public.edt_demande (cree_le) WHERE statut = 'EN_ATTENTE';
CREATE INDEX IF NOT EXISTS ix_edt_demande_demandeur ON public.edt_demande (demandeur_id, cree_le DESC);

CREATE TABLE IF NOT EXISTS public.edt_document (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    demande_id         uuid NOT NULL REFERENCES public.edt_demande(id),
    cle_objet          uuid,                      -- ex. collaborateur_id en cas d'éclatement
    format             text NOT NULL CHECK (format IN ('PDF','XLSX','DOCX','CSV','HTML','ZIP')),
    nom_fichier        text NOT NULL,
    stockage           text NOT NULL,             -- chemin relatif sous la racine de stockage
    sha256             char(64) NOT NULL,
    empreinte_donnees  char(64),
    nb_pages           integer,
    contient_sensible  boolean NOT NULL DEFAULT false,
    code_verification  text UNIQUE,
    genere_le          timestamptz NOT NULL DEFAULT now(),
    expire_le          timestamptz
);
CREATE INDEX IF NOT EXISTS ix_edt_document_demande ON public.edt_document (demande_id);
CREATE INDEX IF NOT EXISTS ix_edt_document_objet ON public.edt_document (cle_objet) WHERE cle_objet IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.edt_planification (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    modele_id            uuid NOT NULL REFERENCES public.edt_modele(id),
    libelle              text NOT NULL,
    cron                 text,
    evenement            text,
    parametres_relatifs  jsonb NOT NULL DEFAULT '{}'::jsonb,
    diffusion            jsonb NOT NULL DEFAULT '{}'::jsonb,
    societe_id           uuid NOT NULL REFERENCES public.societes(id),
    actif                boolean NOT NULL DEFAULT true,
    prochaine_execution  timestamptz,
    cree_par             uuid REFERENCES public.users(id) ON DELETE SET NULL,
    CHECK (cron IS NOT NULL OR evenement IS NOT NULL)
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_edt_demande_planification') THEN
        ALTER TABLE public.edt_demande
            ADD CONSTRAINT fk_edt_demande_planification
            FOREIGN KEY (planification_id) REFERENCES public.edt_planification(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Canaux : l'e-mail réutilise param_smtp ; cette table ne porte que des
-- surcharges par société et les autres canaux. Secrets chiffrés côté API.
CREATE TABLE IF NOT EXISTS public.edt_canal (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code           text NOT NULL,
    type           text NOT NULL CHECK (type IN ('EMAIL','DOSSIER','PORTAIL','CRYSTAL')),
    societe_id     uuid REFERENCES public.societes(id),
    configuration  jsonb NOT NULL DEFAULT '{}'::jsonb,
    actif          boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_edt_canal_code
    ON public.edt_canal (code, COALESCE(societe_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE IF NOT EXISTS public.edt_diffusion (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id      uuid NOT NULL REFERENCES public.edt_document(id),
    canal_id         uuid REFERENCES public.edt_canal(id),
    canal_type       text NOT NULL CHECK (canal_type IN ('EMAIL','DOSSIER','PORTAIL')),
    destinataire     text NOT NULL,
    statut           text NOT NULL DEFAULT 'EN_ATTENTE'
                     CHECK (statut IN ('EN_ATTENTE','EN_COURS','ENVOYE','ECHEC','ANNULE')),
    tentatives       integer NOT NULL DEFAULT 0,
    prochaine_tentative timestamptz,
    cle_idempotence  char(64) NOT NULL UNIQUE,      -- RG-EDT-DIFF-01
    envoye_le        timestamptz,
    erreur           text
);
CREATE INDEX IF NOT EXISTS ix_edt_diffusion_file ON public.edt_diffusion (prochaine_tentative)
    WHERE statut IN ('EN_ATTENTE','ECHEC');

-- -----------------------------------------------------------------------------
-- 4. GOUVERNANCE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.edt_droit (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cible           text NOT NULL CHECK (cible IN ('MODELE','CATEGORIE','TOUT')),
    cible_code      text,                 -- id du modèle ou code de catégorie ; NULL pour TOUT
    role_code       text,
    utilisateur_id  uuid REFERENCES public.users(id) ON DELETE CASCADE,
    permission      text NOT NULL CHECK (permission IN ('VOIR','LANCER','CONCEVOIR','PUBLIER','DIFFUSER',
                                                        'DONNEES_SENSIBLES','SIGNER','ADMINISTRER')),
    societe_id      uuid REFERENCES public.societes(id),
    CHECK ((role_code IS NULL) <> (utilisateur_id IS NULL)),
    CHECK ((cible = 'TOUT') = (cible_code IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_edt_droit
    ON public.edt_droit (cible, COALESCE(cible_code, ''), COALESCE(role_code, ''),
                         COALESCE(utilisateur_id, '00000000-0000-0000-0000-000000000000'::uuid), permission,
                         COALESCE(societe_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- RG-EDT-AUDIT-01 : nouvelle table (l'inventaire du 16/10 n'a trouvé que des
-- journaux spécialisés : acc_audit_role, pret_audit_log).
CREATE TABLE IF NOT EXISTS public.edt_audit (
    id              bigserial PRIMARY KEY,
    horodatage      timestamptz NOT NULL DEFAULT now(),
    utilisateur_id  uuid REFERENCES public.users(id) ON DELETE SET NULL,
    societe_id      uuid,
    action          text NOT NULL,
    objet_type      text NOT NULL,
    objet_id        uuid,
    details         jsonb
);
CREATE INDEX IF NOT EXISTS ix_edt_audit_objet ON public.edt_audit (objet_type, objet_id, horodatage DESC);
CREATE INDEX IF NOT EXISTS ix_edt_audit_utilisateur ON public.edt_audit (utilisateur_id, horodatage DESC);

-- -----------------------------------------------------------------------------
-- 5. MENUS — accès par rôle via l'écran des rôles (menu_items / menu_role)
--    « requeteur » : requis par le correctif de sécurité du 16/10
--    (require_menu_access("requeteur") dans app/routers/requeteur.py).
-- -----------------------------------------------------------------------------
INSERT INTO public.menu_items (id, code, libelle, icone, route, ordre, module_code, actif)
SELECT gen_random_uuid(), 'editions', 'Éditions', 'file-text', '/editions', 998, 'PAIE', true
WHERE NOT EXISTS (SELECT 1 FROM public.menu_items WHERE code = 'editions');

INSERT INTO public.menu_items (id, code, libelle, icone, route, ordre, module_code, actif)
SELECT gen_random_uuid(), 'requeteur', 'Requêteur', 'database', '/requeteur', 997, 'PAIE', true
WHERE NOT EXISTS (SELECT 1 FROM public.menu_items WHERE code = 'requeteur');

-- =============================================================================
-- CONTRÔLES (à lire avant COMMIT)
-- =============================================================================

-- Doit renvoyer 20
SELECT count(*) AS tables_edt
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE 'edt\_%';

-- Doit renvoyer 2 lignes (editions, requeteur)
SELECT code, libelle, route, actif FROM public.menu_items WHERE code IN ('editions', 'requeteur');

-- Rôles qui ont déjà accès au requêteur (à cocher dans l'écran des rôles sinon)
SELECT mr.role FROM public.menu_role mr
JOIN public.menu_items m ON m.id = mr.menu_id
WHERE m.code = 'requeteur';

-- ⚠️ Remplacer ROLLBACK par COMMIT après vérification :
-- COMMIT;

ROLLBACK;
