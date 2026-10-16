-- =============================================================================
-- Configuration de référence B1 — Corps "Détail" d'un bulletin de paie
--
-- Reproduit la structure du vrai bulletin fourni (colonnes Base/Taux/Gain/
-- Retenue/MontantP, rubriques réelles confirmées via rubrique_paie).
--
-- ⚠️ LIMITE CONNUE, PAS CORRIGÉE ICI : les lignes spéciales
-- (etat_corps_ligne_speciale) s'affichent TOUJOURS en fin de corps dans le
-- moteur actuel (rapport_generateur_engine.py) -- jamais intercalées entre
-- des groupes de rubriques comme sur le bulletin réel (BRUT IMPOSABLE après
-- les gains, SALAIRE NET IMPOSABLE après les cotisations). Les deux lignes
-- spéciales ci-dessous apparaîtront donc à la fin du tableau, pas à leur
-- position réelle -- à corriger séparément si l'ordre exact est nécessaire.
--
-- ⚠️ Crée un NOUVEAU corps (corps_code = 'detail_ref'), n'écrase rien de ce
-- qui a pu être configuré manuellement dans l'assistant -- à supprimer/
-- fusionner ensuite si besoin.
--
-- Remplacer 'REMPLACER_PAR_ETAT_ID' par le vrai id de l'état cible (visible
-- dans l'URL de l'assistant : /etats/{id}/modifier) avant exécution.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Le corps lui-même
-- -----------------------------------------------------------------------------
INSERT INTO public.etat_corps (etat_id, corps_code, libelle, ordre_affichage, visible)
VALUES ('REMPLACER_PAR_ETAT_ID', 'detail_ref', 'Détail', 0, true);

-- -----------------------------------------------------------------------------
-- 2. Les 5 colonnes, dans l'ordre du bulletin réel
-- -----------------------------------------------------------------------------
INSERT INTO public.etat_corps_colonne (etat_corps_id, code_colonne, libelle, format, ordre_affichage)
SELECT c.id, v.code_colonne, v.libelle, 'MONTANT_2DEC', v.ordre
FROM public.etat_corps c
CROSS JOIN (VALUES
    ('base',     'Nbre/Base', 0),
    ('taux',     'Taux',      1),
    ('gain',     'Gains',     2),
    ('retenue',  'Retenues',  3),
    ('montantp', 'MontantP',  4)
) AS v(code_colonne, libelle, ordre)
WHERE c.etat_id = 'REMPLACER_PAR_ETAT_ID' AND c.corps_code = 'detail_ref';

-- -----------------------------------------------------------------------------
-- 3. Les rubriques rattachées au corps
-- -----------------------------------------------------------------------------
INSERT INTO public.etat_corps_rubrique (etat_corps_id, rubrique_paie_code, ordre_affichage)
SELECT c.id, v.rubrique_paie_code, v.ordre
FROM public.etat_corps c
CROSS JOIN (VALUES
    ('SALBASE',       0),
    ('PRIM_ANC',      1),
    ('INDTRSP',       2),
    ('INDREPR',       3),
    ('CNSS_SAL',      4),
    ('CNSS_AMO_SAL',  5),
    ('RET_IR',        6)
) AS v(rubrique_paie_code, ordre)
WHERE c.etat_id = 'REMPLACER_PAR_ETAT_ID' AND c.corps_code = 'detail_ref';

-- -----------------------------------------------------------------------------
-- 4. Mapping attribut -> colonne, par rubrique (cf. tableau validé en échange)
-- -----------------------------------------------------------------------------
INSERT INTO public.etat_corps_rubrique_colonne (etat_corps_rubrique_id, attribut, etat_corps_colonne_id)
SELECT cr.id, v.attribut, col.id
FROM public.etat_corps c
JOIN public.etat_corps_rubrique cr ON cr.etat_corps_id = c.id
JOIN public.etat_corps_colonne col ON col.etat_corps_id = c.id
CROSS JOIN (VALUES
    ('SALBASE',      'NOMBRE',           'base'),
    ('SALBASE',      'TAUX',             'taux'),
    ('SALBASE',      'MONTANT',          'gain'),
    ('PRIM_ANC',     'BASE',             'base'),
    ('PRIM_ANC',     'TAUX',             'taux'),
    ('PRIM_ANC',     'MONTANT',          'gain'),
    ('INDTRSP',      'MONTANT',          'gain'),
    ('INDREPR',      'MONTANT',          'gain'),
    ('CNSS_SAL',     'BASE',             'base'),
    ('CNSS_SAL',     'TAUX',             'taux'),
    ('CNSS_SAL',     'MONTANT',          'retenue'),
    ('CNSS_SAL',     'MONTANT_PATRONAL', 'montantp'),
    ('CNSS_AMO_SAL', 'BASE',             'base'),
    ('CNSS_AMO_SAL', 'TAUX',             'taux'),
    ('CNSS_AMO_SAL', 'MONTANT',          'retenue'),
    ('CNSS_AMO_SAL', 'MONTANT_PATRONAL', 'montantp'),
    ('RET_IR',       'BASE',             'base'),
    ('RET_IR',       'TAUX',             'taux'),
    ('RET_IR',       'MONTANT',          'retenue')
) AS v(rubrique_paie_code, attribut, code_colonne)
WHERE c.etat_id = 'REMPLACER_PAR_ETAT_ID' AND c.corps_code = 'detail_ref'
  AND cr.rubrique_paie_code = v.rubrique_paie_code
  AND col.code_colonne = v.code_colonne;

-- -----------------------------------------------------------------------------
-- 5. Lignes spéciales (totaux fixes, lus depuis les colonnes agrégées de
--    `bulletin` -- cf. hypothèse documentée dans rapport_generateur_engine.py)
-- -----------------------------------------------------------------------------
INSERT INTO public.etat_corps_ligne_speciale (etat_corps_id, code_constante, libelle, etat_corps_colonne_id, ordre_affichage)
SELECT c.id, v.code_constante, v.libelle, col.id, v.ordre
FROM public.etat_corps c
JOIN public.etat_corps_colonne col ON col.etat_corps_id = c.id
CROSS JOIN (VALUES
    ('total_brut_imposable', '**** BRUT IMPOSABLE ***',        'gain', 0),
    ('net_imposable',        '**** SALAIRE NET IMPOSABLE ****', 'base', 1)
) AS v(code_constante, libelle, code_colonne, ordre)
WHERE c.etat_id = 'REMPLACER_PAR_ETAT_ID' AND c.corps_code = 'detail_ref'
  AND col.code_colonne = v.code_colonne;

-- =============================================================================
-- Vérifications (à exécuter avant COMMIT)
-- =============================================================================

-- Doit renvoyer 1 ligne
SELECT id, libelle FROM public.etat_corps
WHERE etat_id = 'REMPLACER_PAR_ETAT_ID' AND corps_code = 'detail_ref';

-- Doit renvoyer 5 lignes
SELECT code_colonne, libelle, ordre_affichage FROM public.etat_corps_colonne col
JOIN public.etat_corps c ON c.id = col.etat_corps_id
WHERE c.etat_id = 'REMPLACER_PAR_ETAT_ID' AND c.corps_code = 'detail_ref'
ORDER BY ordre_affichage;

-- Doit renvoyer 7 lignes
SELECT rubrique_paie_code, ordre_affichage FROM public.etat_corps_rubrique cr
JOIN public.etat_corps c ON c.id = cr.etat_corps_id
WHERE c.etat_id = 'REMPLACER_PAR_ETAT_ID' AND c.corps_code = 'detail_ref'
ORDER BY ordre_affichage;

-- Doit renvoyer 19 lignes (total des mappings ci-dessus)
SELECT cr.rubrique_paie_code, m.attribut, col.code_colonne
FROM public.etat_corps_rubrique_colonne m
JOIN public.etat_corps_rubrique cr ON cr.id = m.etat_corps_rubrique_id
JOIN public.etat_corps_colonne col ON col.id = m.etat_corps_colonne_id
JOIN public.etat_corps c ON c.id = cr.etat_corps_id
WHERE c.etat_id = 'REMPLACER_PAR_ETAT_ID' AND c.corps_code = 'detail_ref'
ORDER BY cr.rubrique_paie_code, m.attribut;

-- Doit renvoyer 2 lignes
SELECT code_constante, libelle FROM public.etat_corps_ligne_speciale l
JOIN public.etat_corps c ON c.id = l.etat_corps_id
WHERE c.etat_id = 'REMPLACER_PAR_ETAT_ID' AND c.corps_code = 'detail_ref';

-- ⚠️ Décommenter après vérification :
-- COMMIT;

ROLLBACK;
