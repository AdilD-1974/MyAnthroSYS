-- ============================================================================
-- lot0_inventaire_editions.sql — Plateforme d'éditions, lot 0 (Adil DAIA)
-- Découverte en LECTURE SEULE : uniquement des SELECT, aucune écriture.
--
-- MODE D'EMPLOI (DBeaver, base AnthroBase) — UNE seule requête :
--   1. Ctrl+A puis Ctrl+Entrée (ou clic dans la requête puis Ctrl+Entrée).
--   2. Le résultat est UNE cellule « lot0 ». Clic sur la cellule, puis F7
--      (panneau Valeur) → Ctrl+A → Ctrl+C, et coller dans la conversation
--      ou dans lot0_resultat.txt.
-- En cas d'erreur : copier le message d'erreur complet.
-- ============================================================================

-- ─── REQUÊTE UNIQUE ─────────────────────────────────────────────────────────
WITH
-- 1. Tables du périmètre éditions (anciennes + celles à réutiliser)
perimetre AS (
  SELECT c.relname AS t
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m')
    AND (   c.relname ~ '^(etat_|rapport_|requeteur_|kpi_)'
         OR c.relname IN (
              'ref_type_source_etat','ref_champ_disponible_etat','ref_modele_etat',
              'ecran_lancement','requetes_sauvegardees',
              'ref_template_document','ref_workflow_variable',
              'bulletin','bulletin_historique','bulletin_temp',
              'bulletin_ligne','bulletin_historique_ligne','bulletin_temp_ligne',
              'bulletin_snapshot_collaborateur','calendrier_paie','plan_paie',
              'rubrique_paie','ref_constante_paie','societes','societe_affiliations',
              'users','user_roles','acc_roles','param_smtp','nav_menu_item',
              'collaborateurs','collaborateur_departs','cong_demandes',
              'prets','pret_echeances','ordre_virement','declaration_cimr',
              'cumul_paie','bulletin_cumul'))
),
colonnes AS (
  SELECT c.table_name,
         jsonb_agg(jsonb_build_object(
           'col', c.column_name, 'type', c.data_type,
           'null', c.is_nullable, 'defaut', c.column_default)
           ORDER BY c.ordinal_position) AS cols
  FROM information_schema.columns c
  JOIN perimetre p ON p.t = c.table_name
  WHERE c.table_schema = 'public'
  GROUP BY c.table_name
),
volumes AS (
  SELECT c.relname AS table_name, c.reltuples::bigint AS lignes_estimees,
         pg_size_pretty(pg_total_relation_size(c.oid)) AS taille
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN perimetre p ON p.t = c.relname
  WHERE n.nspname = 'public' AND c.relkind = 'r'
),
-- 2. Clés étrangères entrantes et sortantes du périmètre
fks AS (
  SELECT conrelid::regclass::text AS de, confrelid::regclass::text AS vers,
         conname, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
  WHERE contype = 'f'
    AND (conrelid::regclass::text  ~ '^(etat_|rapport_|requeteur_|ref_type_source_etat|ref_champ_disponible_etat|ref_modele_etat|ecran_lancement|ref_template_document|ref_workflow_variable|kpi_)'
      OR confrelid::regclass::text ~ '^(etat_|rapport_|requeteur_|ref_type_source_etat|ref_champ_disponible_etat|ref_modele_etat|ecran_lancement|ref_template_document|ref_workflow_variable|kpi_)')
),
-- 3. Vues qui dépendent des anciennes tables
vues AS (
  SELECT DISTINCT v.relname AS vue, s.relname AS table_source
  FROM pg_depend d
  JOIN pg_rewrite r ON r.oid = d.objid
  JOIN pg_class v ON v.oid = r.ev_class
  JOIN pg_class s ON s.oid = d.refobjid
  WHERE s.relname ~ '^(etat_|rapport_|requeteur_|kpi_)' AND v.relname <> s.relname
),
-- 4. Fonctions et triggers qui citent ces tables
routines AS (
  SELECT p.proname
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosrc ~ '(etat_|rapport_|requeteur_|bulletin_snapshot)'
)
SELECT jsonb_pretty(jsonb_build_object(
  'structure', jsonb_build_object(
  'genere_le', now(),
  'version_pg', version(),
  'colonnes', (SELECT jsonb_object_agg(table_name, cols) FROM colonnes),
  'tables_attendues_absentes', (
      SELECT jsonb_agg(x) FROM unnest(ARRAY[
        'bulletin_historique_ligne','bulletin_temp_ligne','cumul_paie','bulletin_cumul',
        'prets','pret_echeances','ordre_virement','declaration_cimr','nav_menu_item',
        'collaborateur_departs','cong_demandes']) x
      WHERE NOT EXISTS (SELECT 1 FROM perimetre p WHERE p.t = x)),
  'volumes', (SELECT jsonb_agg(to_jsonb(v) ORDER BY v.table_name) FROM volumes v),
  'cles_etrangeres', (SELECT jsonb_agg(to_jsonb(f) ORDER BY f.vers, f.de) FROM fks f),
  'vues_dependantes', (SELECT jsonb_agg(to_jsonb(v)) FROM vues v),
  'routines_dependantes', (SELECT jsonb_agg(proname) FROM routines),
  'schemas', (SELECT jsonb_agg(nspname) FROM pg_namespace
              WHERE nspname NOT LIKE 'pg\_%' AND nspname <> 'information_schema'),
  'roles_pg', (SELECT jsonb_agg(rolname) FROM pg_roles WHERE rolname NOT LIKE 'pg\_%')
  ),
  'bulletins', jsonb_build_object(
  'bulletins_dans_les_deux_tables',
     (SELECT count(*) FROM bulletin b WHERE EXISTS (SELECT 1 FROM bulletin_historique h WHERE h.id = b.id)),
  -- Écarts de montants entre la ligne live et sa copie historique (doit être 0)
  'bulletins_ecart_live_historique',
     (SELECT count(*) FROM bulletin b JOIN bulletin_historique h ON h.id = b.id
       WHERE (b.net_a_payer, b.total_gains, b.total_retenues)
             IS DISTINCT FROM (h.net_a_payer, h.total_gains, h.total_retenues)),
  'bulletins_sans_snapshot',
     (SELECT count(*) FROM (SELECT id FROM bulletin UNION SELECT id FROM bulletin_historique) b
       WHERE NOT EXISTS (SELECT 1 FROM bulletin_snapshot_collaborateur s WHERE s.bulletin_id = b.id)),
  'calendriers_sans_societe',
     (SELECT count(*) FROM calendrier_paie WHERE societe_id IS NULL),
  'sens_bulletin_ligne',
     (SELECT jsonb_object_agg(coalesce(sens, '(null)'), n)
        FROM (SELECT sens, count(*) n FROM bulletin_ligne GROUP BY sens) x)
  ),
  'requeteur', jsonb_build_object(
  'requeteur_tables_exclues', (SELECT jsonb_agg(nom_table ORDER BY nom_table) FROM requeteur_tables_exclues),
  'requeteur_tables_sensibles_NON_exclues', (
     SELECT jsonb_agg(t) FROM unnest(ARRAY['users','user_roles','param_smtp','param_sms',
        'collaborateur_paiements','bulletin','bulletin_ligne','bulletin_historique',
        'bulletin_snapshot_collaborateur','licence','acc_roles']) t
     WHERE to_regclass('public.' || t) IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM requeteur_tables_exclues e WHERE e.nom_table = t)),
  'requetes_sauvegardees', (SELECT count(*) FROM requetes_sauvegardees)
  ),
  'etats_rapports', jsonb_build_object(
  'etats_par_statut', (SELECT jsonb_object_agg(statut, n) FROM (SELECT statut, count(*) n FROM etat_definition GROUP BY statut) x),
  'etats_par_visibilite', (SELECT jsonb_object_agg(visibilite, n) FROM (SELECT visibilite, count(*) n FROM etat_definition GROUP BY visibilite) x),
  'etats_globaux', (SELECT jsonb_agg(jsonb_build_object('code', code, 'statut', statut)) FROM etat_definition WHERE visibilite = 'GLOBAL'),
  'rapport_templates', (SELECT jsonb_agg(jsonb_build_object('code', code, 'type', type_rapport, 'actif', actif)) FROM rapport_template),
  -- colonnes inconnues : on renvoie le volume et les 3 dernières lignes brutes
  'generations_nombre', (SELECT count(*) FROM rapport_generation_historique),
  'generations_exemples', (SELECT jsonb_agg(to_jsonb(r)) FROM
        (SELECT * FROM rapport_generation_historique ORDER BY 1 DESC LIMIT 3) r)
  ),
  'documents_menus', jsonb_build_object(
  'templates_document', (SELECT jsonb_agg(jsonb_build_object('code', code, 'type', type_document, 'objet', type_objet, 'actif', actif)) FROM ref_template_document),
  'variables_avec_sql', (SELECT count(*) FROM ref_workflow_variable WHERE coalesce(source_sql, '') <> ''),
  'menus_editions', (SELECT jsonb_agg(to_jsonb(m)) FROM nav_menu_item m
        WHERE to_jsonb(m)::text ~* '(etats|editions|journal|bulletin|requeteur|rapport|kpi)')
  )
)) AS lot0;
