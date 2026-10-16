// src/data/reglesStandardsCatalogue.ts
//
// Données du catalogue système des « règles standards » (opérations
// atomiques prédéfinies, non modifiables, sélectionnables au paramétrage
// des rubriques). Format statique en attendant le branchement réel sur
// GET /paie/regles/catalogue (voir MODULE_PAIE.md §10 — l'endpoint existe
// déjà côté API et expose le catalogue réel du moteur, palette non codée
// en dur). CatalogueReglesStandards.tsx accepte les groupes en prop avec
// ce tableau comme valeur par défaut : il suffit de remplacer la source
// par le résultat de l'appel API, la forme des données ne change pas.

export type UniteRegle = 'jour' | 'mois' | 'an' | null;

export interface RegleStandard {
  code: string;
  operation: string;
  description: string;
  formule: string;
  unite: UniteRegle;
}

export interface GroupeReglesStandard {
  id: string;
  libelle: string;
  icone: 'calendar' | 'hash' | 'wallet';
  couleur: 'accent' | 'success' | 'warning';
  regles: RegleStandard[];
}

export const GROUPES_REGLES_STANDARDS: GroupeReglesStandard[] = [
  {
    id: 'date',
    libelle: 'Calculs sur date',
    icone: 'calendar',
    couleur: 'accent',
    regles: [
      { code: 'DATE_MOINS_NB_JOUR', operation: 'date = date - nombre (jour)', description: 'Soustrait un nombre de jours à la date courante', formule: 'date := date - nombre', unite: 'jour' },
      { code: 'DATE_PLUS_NB_JOUR', operation: 'date = date + nombre (jour)', description: 'Ajoute un nombre de jours à la date courante', formule: 'date := date + nombre', unite: 'jour' },
      { code: 'DATE_EQ_DATEJOUR', operation: 'date = datejour', description: 'Affecte la date du jour', formule: 'date := DATEJOUR', unite: null },
      { code: 'DATE_DATEJOUR_MOINS_NBJ', operation: 'date = datejour - nbr (jour)', description: 'Date du jour moins un nombre de jours', formule: 'date := DATEJOUR - nombre', unite: 'jour' },
      { code: 'DATE_DATEJOUR_PLUS_NBJ', operation: 'date = datejour + nbr (jour)', description: 'Date du jour plus un nombre de jours', formule: 'date := DATEJOUR + nombre', unite: 'jour' },
      { code: 'DATE_EQ_DATEPAIE', operation: 'date = datepaie', description: 'Date de référence de la paie courante', formule: 'date := DATEPAIE', unite: null },
      { code: 'DATE_DATEPAIE_MOINS_NBJ', operation: 'date = datepaie - nbre (jour)', description: 'Date de paie moins un nombre de jours', formule: 'date := DATEPAIE - nombre', unite: 'jour' },
      { code: 'DATE_DATEPAIE_PLUS_NBJ', operation: 'date = datepaie + nbre (jour)', description: 'Date de paie plus un nombre de jours', formule: 'date := DATEPAIE + nombre', unite: 'jour' },
    ],
  },
  {
    id: 'nombre',
    libelle: 'Calculs sur nombre',
    icone: 'hash',
    couleur: 'success',
    regles: [
      { code: 'NB_AN_DATEJOUR_DATE', operation: 'nbre (an) = datejour - date', description: 'Différence en années entre la date du jour et la date', formule: 'nombre := YEARS(DATEJOUR - date)', unite: 'an' },
      { code: 'NB_JOUR_DATEPAIE_DATE', operation: 'nbre (jour) = date paie - date', description: 'Différence en jours entre la date de paie et la date', formule: 'nombre := DAYS(DATEPAIE - date)', unite: 'jour' },
      { code: 'NB_JOUR_DATEJOUR_DATE', operation: 'nbre (jour) = datejour - date', description: 'Différence en jours entre la date du jour et la date', formule: 'nombre := DAYS(DATEJOUR - date)', unite: 'jour' },
      { code: 'NB_MOIS_DATEPAIE_DATE', operation: 'nbre (mois) = date paie - date', description: 'Différence en mois entre la date de paie et la date', formule: 'nombre := MONTHS(DATEPAIE - date)', unite: 'mois' },
      { code: 'NB_MOIS_DATEJOUR_DATE', operation: 'nbre (mois) = datejour - date', description: 'Différence en mois entre la date du jour et la date', formule: 'nombre := MONTHS(DATEJOUR - date)', unite: 'mois' },
      { code: 'NB_PLUS_1', operation: 'nombre = nombre + 1', description: 'Incrémente le nombre de 1', formule: 'nombre := nombre + 1', unite: null },
      { code: 'NB_MOINS_1', operation: 'nombre = nombre - 1', description: 'Décrémente le nombre de 1', formule: 'nombre := nombre - 1', unite: null },
      { code: 'NB_EQ_MT_DIV_TX', operation: 'nombre = montant / taux', description: 'Calcule le nombre par division montant / taux', formule: 'nombre := montant / taux', unite: null },
    ],
  },
  {
    id: 'montant',
    libelle: 'Calculs sur montant',
    icone: 'wallet',
    couleur: 'warning',
    regles: [
      { code: 'MT_MOINS_NB', operation: 'montant = montant - nombre', description: 'Soustrait un nombre du montant', formule: 'montant := montant - nombre', unite: null },
      { code: 'MT_MOINS_PCT_TX', operation: 'montant = montant - % taux', description: 'Diminution en pourcentage du taux', formule: 'montant := montant - (montant * taux / 100)', unite: null },
      { code: 'MT_PLUS_NB', operation: 'montant = montant + nombre', description: 'Ajoute un nombre au montant', formule: 'montant := montant + nombre', unite: null },
      { code: 'MT_PLUS_PCT_TX', operation: 'montant = montant + % taux', description: 'Augmentation en pourcentage du taux', formule: 'montant := montant + (montant * taux / 100)', unite: null },
      { code: 'MT_EQ_NB_X_TX', operation: 'montant = nombre * taux', description: 'Calcule le montant : nombre × taux', formule: 'montant := nombre * taux', unite: null },
      { code: 'MT_EQ_NB_X_TX_DIV_100', operation: 'montant = nombre * taux / 100', description: 'Calcule le montant : nombre × taux / 100', formule: 'montant := nombre * taux / 100', unite: null },
      { code: 'MT_EQ_BASE_X_TX_DIV_100', operation: 'montant = base * taux / 100', description: 'Calcule le montant : base × taux / 100 (cotisations)', formule: 'montant := base * taux / 100', unite: null },
      { code: 'PRORATA_TEMPOREL', operation: 'montant = base × jours présence / jours mois', description: 'Prorata temporel (entrée/sortie en cours de mois)', formule: 'montant := base * jrs_presents / jrs_mois', unite: null },
      { code: 'PLAFONNEMENT', operation: 'montant = MIN(montant, plafond)', description: 'Plafonnement du montant', formule: 'montant := MIN(montant, plafond)', unite: null },
      { code: 'PLANCHER', operation: 'montant = MAX(montant, plancher)', description: 'Plancher du montant', formule: 'montant := MAX(montant, plancher)', unite: null },
      { code: 'CUMUL_RUBRIQUES', operation: 'montant = SOMME(rubriques)', description: "Somme des montants d'une liste de rubriques", formule: 'montant := SUM(MT.rub1, MT.rub2, ...)', unite: null },
    ],
  },
];
