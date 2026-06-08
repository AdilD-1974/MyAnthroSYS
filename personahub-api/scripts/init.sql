-- ─────────────────────────────────────────────────────────────────────────────
-- PersonaHub HR — Données initiales PostgreSQL
-- Exécuté automatiquement par Docker au premier démarrage
-- ─────────────────────────────────────────────────────────────────────────────

-- Jours fériés marocains 2025
INSERT INTO jours_feries (id, date, libelle, annee, recurrent) VALUES
  (gen_random_uuid(), '2025-01-01', 'Nouvel An',                     2025, true),
  (gen_random_uuid(), '2025-01-11', 'Manifeste de l''Indépendance',  2025, true),
  (gen_random_uuid(), '2025-05-01', 'Fête du Travail',               2025, true),
  (gen_random_uuid(), '2025-07-30', 'Fête du Trône',                 2025, true),
  (gen_random_uuid(), '2025-08-14', 'Allégeance Oued Eddahab',       2025, true),
  (gen_random_uuid(), '2025-08-20', 'Révolution du Roi et du Peuple',2025, true),
  (gen_random_uuid(), '2025-08-21', 'Fête de la Jeunesse',           2025, true),
  (gen_random_uuid(), '2025-11-06', 'Marche Verte',                  2025, true),
  (gen_random_uuid(), '2025-11-18', 'Fête de l''Indépendance',       2025, true)
ON CONFLICT DO NOTHING;

-- Types de congé standards Maroc
INSERT INTO types_conge (id, code, libelle, duree_max_annuelle, deductible_paie, actif) VALUES
  (gen_random_uuid(), 'CA',  'Congé Annuel',             18,   false, true),
  (gen_random_uuid(), 'CM',  'Congé Maladie',            NULL, true,  true),
  (gen_random_uuid(), 'CS',  'Congé Sans Solde',         NULL, true,  true),
  (gen_random_uuid(), 'CE',  'Congé Exceptionnel',       NULL, false, true),
  (gen_random_uuid(), 'CMT', 'Congé Maternité',          98,   false, true),
  (gen_random_uuid(), 'CP',  'Congé Paternité',          3,    false, true)
ON CONFLICT DO NOTHING;

-- Cotisations réglementaires Maroc (taux 2024)
INSERT INTO cotisations (id, code, libelle, taux_salarial, taux_patronal, plafond, actif) VALUES
  (gen_random_uuid(), 'CNSS_LT', 'CNSS Longterme maladie',           4.48, 8.98,  NULL,    true),
  (gen_random_uuid(), 'CNSS_CT', 'CNSS Court terme (prest. fam.)',   0.52, 6.40,  6000.00, true),
  (gen_random_uuid(), 'AMO',     'AMO (Assurance Maladie Obligatoire)', 2.26, 3.77, NULL, true),
  (gen_random_uuid(), 'CIMR',   'CIMR (Retraite complémentaire)',    3.00, 3.00,  NULL,    true)
ON CONFLICT DO NOTHING;

-- Barème IGR 2024 (simplifié)
DO $$
DECLARE
  bid UUID := gen_random_uuid();
BEGIN
  INSERT INTO baremes (id, code, libelle, type_cle, type_valeur, actif)
  VALUES (bid, 'IGR', 'Barème IGR mensuel 2024', 'montant', 'taux', true)
  ON CONFLICT DO NOTHING;

  INSERT INTO bareme_lignes (id, bareme_id, cle, valeur, ordre) VALUES
    (gen_random_uuid(), bid, '0',     0,    0),
    (gen_random_uuid(), bid, '2500',  10,   1),
    (gen_random_uuid(), bid, '4166',  20,   2),
    (gen_random_uuid(), bid, '5000',  30,   3),
    (gen_random_uuid(), bid, '6666',  34,   4),
    (gen_random_uuid(), bid, '15000', 38,   5)
  ON CONFLICT DO NOTHING;
END $$;
