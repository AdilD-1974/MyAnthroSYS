-- =============================================================================
-- 076_paie_part_patronale.sql — Taux patronal et cumul de la part patronale
-- Auteur : Adil DAIA — 18/10/2026
--
-- RG-PAIE-PATRONAL-01 (Adil DAIA) : chaque ligne de bulletin garde son taux patronal
--   (bulletin_*_ligne.taux_patronal), distinct du taux salarial (taux). Une rubrique qui
--   porte les deux parts d'une cotisation ne perd plus son taux salarial.
-- RG-PAIE-PATRONAL-02 (Adil DAIA) : le cumul mensuel garde la part patronale
--   (cumul.montant_patronal) : cumuls patronaux annuels/glissants comme pour le montant.
--
-- Migration ADDITIVE, rejouable. Les bulletins existants : taux_patronal reste vide
-- (il sera rempli au prochain calcul) ; le cumul patronal des périodes passées est
-- reconstitué ci-dessous depuis les lignes des bulletins validés et clôturés.
-- =============================================================================
BEGIN;

ALTER TABLE public.bulletin_temp_ligne       ADD COLUMN IF NOT EXISTS taux_patronal numeric(18,4);
ALTER TABLE public.bulletin_ligne            ADD COLUMN IF NOT EXISTS taux_patronal numeric(18,4);
ALTER TABLE public.bulletin_historique_ligne ADD COLUMN IF NOT EXISTS taux_patronal numeric(18,4);

ALTER TABLE public.cumul ADD COLUMN IF NOT EXISTS montant_patronal numeric(18,2) NOT NULL DEFAULT 0;

-- Reprise : part patronale des cumuls MENSUELS existants, depuis les bulletins réels
-- (temp, validés, clôturés) de la même période et du même collaborateur.
WITH lignes AS (
    SELECT b.collaborateur_id, b.periode_id, l.code_rubrique, l.montant_patronal
      FROM public.bulletin_temp b JOIN public.bulletin_temp_ligne l ON l.bulletin_id = b.id
     WHERE l.montant_patronal IS NOT NULL
    UNION ALL
    SELECT b.collaborateur_id, b.periode_id, l.code_rubrique, l.montant_patronal
      FROM public.bulletin b JOIN public.bulletin_ligne l ON l.bulletin_id = b.id
     WHERE l.montant_patronal IS NOT NULL
    UNION ALL
    SELECT b.collaborateur_id, b.periode_id, l.code_rubrique, l.montant_patronal
      FROM public.bulletin_historique b JOIN public.bulletin_historique_ligne l ON l.bulletin_id = b.id
     WHERE l.montant_patronal IS NOT NULL
)
UPDATE public.cumul c
   SET montant_patronal = x.pat, updated_at = now()
  FROM (SELECT collaborateur_id, periode_id, code_rubrique, SUM(montant_patronal) AS pat
          FROM lignes GROUP BY collaborateur_id, periode_id, code_rubrique) x
 WHERE c.type_cumul = 'MENSUEL'
   AND c.collaborateur_id = x.collaborateur_id
   AND c.periode_id = x.periode_id
   AND TRIM(c.code_rubrique) = TRIM(x.code_rubrique)
   AND c.montant_patronal = 0;

COMMENT ON COLUMN public.bulletin_ligne.taux_patronal IS 'Taux patronal de la cotisation (RG-PAIE-PATRONAL-01, migration 076)';
COMMENT ON COLUMN public.cumul.montant_patronal IS 'Part patronale cumulée de la période (RG-PAIE-PATRONAL-02, migration 076)';

COMMIT;
