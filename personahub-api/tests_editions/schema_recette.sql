-- Schéma de recette généré depuis lot0_resultat.json (colonnes réelles d'AnthroBase, 16/10/2026)
CREATE TABLE public.bulletin (
  "id" uuid DEFAULT gen_random_uuid(),
  "lot_id" uuid,
  "periode_id" uuid,
  "collaborateur_id" uuid,
  "matricule" text,
  "total_brut" numeric,
  "total_brut_imposable" numeric,
  "total_gains" numeric,
  "total_retenues" numeric,
  "total_cot_salariale" numeric,
  "total_cot_patronale" numeric,
  "net_imposable" numeric,
  "net_a_payer" numeric,
  "cout_employeur" numeric,
  "statut" text,
  "a_erreur" boolean,
  "trace" jsonb,
  "messages" jsonb,
  "calcule_le" timestamptz DEFAULT now(),
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  "plan_paie_id" uuid,
  "code_plan" text,
  "valide_le" timestamptz DEFAULT now(),
  "valide_par" uuid
);

CREATE TABLE public.bulletin_historique (
  "id" uuid DEFAULT gen_random_uuid(),
  "lot_id" uuid,
  "periode_id" uuid,
  "collaborateur_id" uuid,
  "matricule" text,
  "total_brut" numeric,
  "total_brut_imposable" numeric,
  "total_gains" numeric,
  "total_retenues" numeric,
  "total_cot_salariale" numeric,
  "total_cot_patronale" numeric,
  "net_imposable" numeric,
  "net_a_payer" numeric,
  "cout_employeur" numeric,
  "statut" text,
  "a_erreur" boolean,
  "trace" jsonb,
  "messages" jsonb,
  "calcule_le" timestamptz DEFAULT now(),
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  "plan_paie_id" uuid,
  "code_plan" text,
  "cloture_le" timestamptz DEFAULT now(),
  "cloture_par" uuid
);

CREATE TABLE public.bulletin_ligne (
  "id" uuid DEFAULT gen_random_uuid(),
  "bulletin_id" uuid,
  "code_rubrique" text,
  "libelle" text,
  "code_type" text,
  "type_regle" text,
  "ordre_calcul" integer,
  "ordre_affichage" integer,
  "base" numeric,
  "nombre" numeric,
  "taux" numeric,
  "montant" numeric,
  "montant_patronal" numeric,
  "sens" text,
  "est_cotisation" boolean,
  "created_at" timestamptz DEFAULT now(),
  "type_periodicite" text,
  "date_valeur" date,
  "texte" text,
  "observation" text
);

CREATE TABLE public.bulletin_historique_ligne (
  "id" uuid DEFAULT gen_random_uuid(),
  "bulletin_id" uuid,
  "code_rubrique" text,
  "libelle" text,
  "code_type" text,
  "type_regle" text,
  "ordre_calcul" integer,
  "ordre_affichage" integer,
  "base" numeric,
  "nombre" numeric,
  "taux" numeric,
  "montant" numeric,
  "montant_patronal" numeric,
  "sens" text,
  "est_cotisation" boolean,
  "created_at" timestamptz DEFAULT now(),
  "type_periodicite" text,
  "date_valeur" date,
  "texte" text,
  "observation" text
);

CREATE TABLE public.bulletin_snapshot_collaborateur (
  "id" uuid DEFAULT gen_random_uuid(),
  "bulletin_id" uuid,
  "donnees" jsonb,
  "date_capture" timestamptz DEFAULT now(),
  "calcul_origine" text
);

CREATE TABLE public.calendrier_paie (
  "id" uuid DEFAULT gen_random_uuid(),
  "plan_paie_id" uuid,
  "annee" integer,
  "mois" integer,
  "numero_periode" integer,
  "date_debut" date,
  "date_fin" date,
  "est_fin_mois" boolean,
  "est_fin_trimestre" boolean,
  "est_fin_semestre" boolean,
  "est_fin_annee" boolean,
  "type_periode" text,
  "statut" text,
  "date_limite_saisie" date,
  "date_limite_validation" date,
  "observations" text,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  "date_reference" date,
  "date_ouverture" date,
  "intitule" text,
  "societe_id" uuid
);

CREATE TABLE public.plan_paie (
  "id" uuid DEFAULT gen_random_uuid(),
  "code" text,
  "libelle" text,
  "frequence" text,
  "description" text,
  "actif" boolean,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  "frequence_calcul" text,
  "frequence_raz_cumuls" text
);

CREATE TABLE public.rubrique_paie (
  "code" text,
  "libelle" text,
  "libelle_edition" text,
  "description" text,
  "code_famille" text,
  "code_flux" text,
  "code_type" text,
  "code_frequence" text,
  "date_debut" date,
  "date_fin" date,
  "traiter" boolean,
  "simulation" boolean,
  "v_batch" boolean,
  "v_externe" boolean,
  "v_ajout" boolean,
  "v_forcage" boolean,
  "v_regularisation" boolean,
  "v_glissant" boolean,
  "v_historique" boolean,
  "pr_cumulee" boolean,
  "ordre_calcul" integer,
  "conditionnee" boolean,
  "code_regle" text,
  "archive" boolean,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  "zone_fixe_key" text,
  "frequence_calcul" text,
  "frequence_raz_cumuls" text,
  "type_regle" text,
  "ne_editer_si_mt_zero" boolean,
  "ne_editer_si_nb_zero" boolean,
  "ne_editer_si_ty_zero" boolean,
  "v_annulation" boolean,
  "v_reprise" boolean,
  "v_import" boolean,
  "mode_arrondi" text,
  "nb_decimales_arrondi" integer,
  "attribut_controle_non_zero" text,
  "rubrique_en_net" boolean,
  "simulation_seulement" boolean,
  "societe_id" uuid
);

CREATE TABLE public.ref_constante_paie (
  "id" uuid DEFAULT gen_random_uuid(),
  "code" text,
  "libelle" text,
  "type_constante" text,
  "valeur" text,
  "actif" boolean,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  "date_debut" date,
  "date_fin" date,
  "societe_id" uuid
);

CREATE TABLE public.societes (
  "id" uuid DEFAULT gen_random_uuid(),
  "siret" text,
  "raison_sociale" text,
  "nom_commercial" text,
  "code_convention_collective" text,
  "code_secteur_activite" text,
  "code_naf" text,
  "adresse" text,
  "code_postal" text,
  "ville" text,
  "code_departement" text,
  "code_region" text,
  "code_pays" text,
  "telephone" text,
  "email" text,
  "site_web" text,
  "effectif" integer,
  "actif" boolean,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  "forme_juridique" text,
  "identifiant_fiscal" text,
  "registre_commerce" text,
  "ice" text,
  "capital_social" numeric,
  "nom_gerant" text,
  "conseil_administration" text,
  "logo_path" text,
  "date_creation_societe" date,
  "code_ville" text,
  "code_societe" text,
  "patente" text,
  "code_devise_capital" text
);

CREATE TABLE public.societe_affiliations (
  "id" uuid DEFAULT gen_random_uuid(),
  "societe_id" uuid,
  "code_type_affiliation" text,
  "numero_affiliation" text,
  "date_adhesion" date,
  "date_fin" date,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

CREATE TABLE public.users (
  "id" uuid DEFAULT gen_random_uuid(),
  "email" text,
  "hashed_password" text,
  "is_active" boolean,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  "must_change_password" boolean,
  "societe_active_id" uuid
);

ALTER TABLE societes ADD PRIMARY KEY (id); ALTER TABLE users ADD PRIMARY KEY (id); ALTER TABLE bulletin ADD PRIMARY KEY (id); ALTER TABLE bulletin_snapshot_collaborateur ADD UNIQUE (bulletin_id);

CREATE TABLE menu_items(id uuid primary key, code text, libelle text, icone text, route text, ordre int, module_code text, actif bool); CREATE TABLE menu_role(menu_id uuid, role text);

CREATE TABLE public.cumul (
  "id" uuid DEFAULT gen_random_uuid(),
  "collaborateur_id" uuid,
  "code_rubrique" text,
  "type_cumul" text,
  "annee" integer,
  "mois" integer,
  "periode_id" uuid,
  "code_plan" text,
  "montant" numeric,
  "nombre" numeric,
  "base" numeric
);
