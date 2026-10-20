-- 083 — Éditions : dossier « Départs et sortie » (module RH) — Adil DAIA, 20/10/2026 — RG-EDT-RH / RG-EDT-THEME-05
-- Range le certificat de travail, le reçu pour solde de tout compte et la fiche de sortie.
-- (Créé aussi au démarrage s'il manque : themes.assurer_themes_systeme.)
INSERT INTO edt_theme (code, libelle, module, categorie_defaut, ordre)
SELECT 'RH_DEPARTS', 'Départs et sortie', 'RH', NULL, 30
WHERE NOT EXISTS (SELECT 1 FROM edt_theme WHERE code = 'RH_DEPARTS' AND societe_id IS NULL);
