"""
app/schemas/paie_simulation.py — Schémas du module Simulation (UC1 — bulletin).
Proposition pour Adil DAIA — RG-SIM-IND-* (voir CONCEPTION_ECRANS_SIMULATION.md
et PROPOSITION_MODULE_SIMULATION.md).

Volontairement dans un fichier SÉPARÉ de app/schemas/paie_calcul.py : ce
dernier n'a pas été fourni pour cette session, donc ce fichier n'y touche
pas et ne prend aucun risque de collision de noms avec des schémas
existants qu'on ne peut pas voir. À fusionner (ou pas) une fois le module
validé.
"""
from decimal import Decimal
from datetime import datetime, date
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

# Type des 3 cas d'usage — utilisé à plusieurs endroits (scénarios, export
# Excel). Oubli corrigé : ce type était référencé (ExportExcelRequest) sans
# jamais avoir été défini, faisant planter l'import du routeur au démarrage.
ModeSimulation = Literal["BULLETIN", "IMPACT", "EMBAUCHE"]


class SurchargeRubriqueSim(BaseModel):
    """
    Une surcharge ponctuelle sur un attribut de rubrique — RG-SIM-IND-04 :
    même grammaire attribut/sens qu'un élément variable réel, jamais écrite
    en base (voir ContexteCalcul._appliquer_surcharges côté moteur).

    `attribut` utilise le domaine RÉEL du moteur (colonnes element_variable :
    BASE / NOMBRE / TAUX / MONTANT) — PAS les noms courts du DSL (MT/NB/TX)
    qui désignent les ATTRIBUTS DE SORTIE d'une règle, pas les colonnes de
    saisie. Une confusion entre les deux domaines a été corrigée dans la
    documentation de conception des écrans avant ce fichier.

    `mode` : AJOUT (s'ajoute à la valeur alimentée/réelle) ou FORCAGE
    (remplace — dernier forçage retenu si plusieurs, cf. resoudre_alimentation
    du moteur réel). FORCAGE est le défaut : une surcharge de simulation
    exprime le plus souvent « remplace par », pas « en plus de ».
    """
    code_rubrique: str = Field(..., min_length=1, max_length=32)
    attribut: Literal["BASE", "NOMBRE", "TAUX", "MONTANT"]
    valeur: Decimal
    mode: Literal["AJOUT", "FORCAGE"] = "FORCAGE"


class SurchargeTableSim(BaseModel):
    """
    Une surcharge ponctuelle sur un champ de contrat simulable (conception
    des écrans §2.4 — liste fermée côté UI, non contrainte ici au niveau du
    schéma : le moteur applique le même garde-fou anti-injection
    (`_safe_ident`) que le calcul réel, et n'importe quelle table sans
    colonne `collaborateur_id` est simplement ignorée par ContexteCalcul).
    """
    table: str = Field(..., min_length=1, max_length=63)
    colonne: str = Field(..., min_length=1, max_length=63)
    valeur: Any = None


class SurchargeRegimeSim(BaseModel):
    """
    Une surcharge de taux de cotisation — RG-SIM-COTISATION-01. Deux usages
    indépendants, combinables :
      1. Augmenter/remplacer un taux (taux_salarial/taux_patronal renseignés).
      2. Simuler une affiliation à un régime auquel le collaborateur n'est
         PAS affecté (forcer_affectation=True) — jamais écrite en base,
         valable pour ce calcul uniquement.

    `code_regle` : code de la RÈGLE de cotisation (regle_calcul_cotisation.code,
    voir GET /simulation/regimes), pas le code régime — plusieurs règles
    peuvent porter le même régime (ex. part salariale/patronale séparées).
    `valeur_bareme_taux_simulee` : uniquement utile si forcer_affectation=True
    ET que la règle a un taux variable par barème (ex. CIMR) — sans elle, le
    taux fixe des composantes s'applique en repli, comme pour toute
    affectation réelle sans valeur choisie.
    """
    code_regle: str = Field(..., min_length=1, max_length=64)
    mode: Literal["AJOUT", "FORCAGE", "POURCENTAGE"] = "AJOUT"
    taux_salarial: Decimal | None = None
    taux_patronal: Decimal | None = None
    forcer_affectation: bool = False
    valeur_bareme_taux_simulee: Decimal | None = None


class SimulationBulletinRequest(BaseModel):
    """
    Requête UC1 — POST /paie/simulation/bulletin. Ne persiste JAMAIS
    (RG-SIM-IND-01) : pas de champ `persister` ni `type_lot`, volontairement,
    contrairement à CalculBulletinRequest.
    """
    collaborateur_id: UUID
    periode_id: UUID
    surcharges_rubrique: list[SurchargeRubriqueSim] = []
    surcharges_table: list[SurchargeTableSim] = []
    surcharges_regime: list[SurchargeRegimeSim] = []


class SimulationImpactRequest(BaseModel):
    """
    Requête UC2 — POST /paie/simulation/impact. La situation « avant » est
    TOUJOURS calculée sans aucune surcharge (photo de l'état réel) ; les
    surcharges fournies ici décrivent uniquement la situation « après ».
    """
    collaborateur_id: UUID
    periode_id: UUID
    surcharges_rubrique: list[SurchargeRubriqueSim] = []
    surcharges_table: list[SurchargeTableSim] = []
    surcharges_regime: list[SurchargeRegimeSim] = []


class SimulationEmbaucheRequest(BaseModel):
    """
    Requête UC3 — POST /paie/simulation/embauche.

    `collaborateur_reference_id` : collaborateur RÉEL existant utilisé comme
    gabarit (même régime de cotisation que le futur poste) — PAS un profil
    virtuel sans existence en base. Voir la note dans
    simuler_embauche_collaborateur() côté routeur pour la raison technique
    (cotisation_engine.calculer_cotisation() reçoit collaborateur_id
    directement, module non fourni pour cette session — impossible de
    garantir l'absence de lecture propre en base à partir de cet ID).

    Les surcharges décrivent tout ce qui diffère du gabarit : salaire
    proposé, poste, temps de travail, type de contrat, date d'entrée,
    avantages. L'identité du collaborateur de référence n'apparaît JAMAIS
    dans la réponse (RG-SIM-IND-06).
    """
    collaborateur_reference_id: UUID
    periode_id: UUID
    surcharges_rubrique: list[SurchargeRubriqueSim] = []
    surcharges_table: list[SurchargeTableSim] = []
    surcharges_regime: list[SurchargeRegimeSim] = []


class SimulationBulletinPhoto(BaseModel):
    """
    Reflet fidèle du dict renvoyé par simuler_bulletin()/calculer_bulletin()
    (collaborateur/periode/totaux/lignes/trace/messages/a_erreur) — pas de
    typage strict champ par champ ici (le moteur reste seul propriétaire de
    cette forme), volontairement pour ne dupliquer aucune règle de validation
    déjà assurée côté moteur.
    """
    collaborateur: dict
    periode: dict
    totaux: dict
    lignes: list[dict]
    trace: list[dict] = []
    messages: list[str] = []
    a_erreur: bool = False


class SimulationImpactResult(BaseModel):
    """Réponse UC2 : deux photos (avant/après) + écarts précalculés, pour que
    l'écran n'ait aucun calcul de delta à refaire côté client."""
    avant: SimulationBulletinPhoto
    apres: SimulationBulletinPhoto
    ecarts: dict


# ---------------------------------------------------------------------------
# Scénarios sauvegardés (table simulation_individuelle — voir la migration
# 057_simulation_individuelle.sql)
# ---------------------------------------------------------------------------
class ScenarioSimulationWrite(BaseModel):
    """
    Création/sauvegarde d'un scénario. `type_simulation='EMBAUCHE'` (UC3) est
    désormais accepté par le routeur — hypotheses doit alors contenir
    `collaborateur_reference_id` (voir SimulationEmbaucheRequest), PAS un
    `collaborateur_id` réel du candidat (qui n'existe pas encore).

    `population_id` (RG-SIM-SCENARIO-05, Adil DAIA) : restriction OPTIONNELLE
    — None = scénario libre (applicable à n'importe quelle population au
    lancement en masse, comportement historique) ; renseigné = restreint aux
    collaborateurs de CETTE population uniquement, même si le lancement
    cible "toutes les populations" ou une population différente.

    `date_application` (RG-SIM-SCENARIO-06, Adil DAIA) : date OPTIONNELLE —
    None = le scénario s'applique dès la première période simulée
    (comportement historique) ; renseignée = ne s'applique qu'à partir de la
    première période (année/mois) contenant cette date — les périodes avant
    restent "tel quel", non affectées par ce scénario.
    """
    type_simulation: ModeSimulation
    nom: str = Field(..., min_length=1, max_length=200)
    collaborateur_id: UUID | None = None
    population_id: UUID | None = None
    periode_id: UUID | None = None
    periode_reference: dict = Field(default_factory=dict)
    hypotheses: dict
    resultat_calcule: dict | None = None
    partage: bool = False
    date_application: date | None = None


class ScenarioSimulationPatch(BaseModel):
    """Modification partielle — seuls les champs fournis sont mis à jour.
    `hypotheses` (RG-SIM-SCENARIO-04, proposition — Adil DAIA) : permet de
    modifier les surcharges d'un scénario déjà enregistré, en place, sans
    passer par l'écran de simulation individuelle — utile en particulier
    pour un scénario orienté population (collaborateur_id NULL), qui n'a
    justement pas de collaborateur de référence sur lequel "ouvrir" un
    calcul individuel. `population_id` / `date_application` : voir
    ScenarioSimulationWrite."""
    nom: str | None = Field(None, min_length=1, max_length=200)
    partage: bool | None = None
    archive: bool | None = None
    hypotheses: dict | None = None
    population_id: UUID | None = None
    date_application: date | None = None


class ScenarioSimulationRead(BaseModel):
    id: UUID
    type_simulation: str
    nom: str
    created_by: UUID
    collaborateur_id: UUID | None
    population_id: UUID | None
    periode_id: UUID | None
    periode_reference: dict
    hypotheses: dict
    resultat_calcule: dict | None
    partage: bool
    archive: bool
    date_application: date | None = None
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Lancement en masse par population (RG-SIM-POPULATION-01, proposition —
# Adil DAIA). Résout une population (ou l'ensemble des populations actives)
# en liste de collaborateurs via app/services/population_paie.py.
#
# Produit destiné à des clients pouvant dépasser 300 collaborateurs : le
# lancement est ASYNCHRONE (job en tâche de fond, table
# simulation_population_job — migration 062) — l'écran crée le job, reçoit
# immédiatement un job_id, puis interroge GET /simulation/population/jobs/{id}
# jusqu'à TERMINE/ERREUR. Jamais persisté dans bulletin/bulletin_ligne, même
# principe que le reste du module Simulation.
#
# Double vue TOUJOURS calculée et affichée ensemble pour chaque collaborateur
# (jamais un choix exclusif) :
#   • Fusion    : toutes les surcharges de tous les scénarios sélectionnés,
#                 combinées en UN SEUL calcul ("et si on combinait tout ça ?").
#   • Par scénario : CHAQUE scénario appliqué séparément (isolé des autres),
#                 pour comparer leur impact individuel côte à côte.
# Coût : (2 + nb_scénarios) calculs par collaborateur (tel quel + fusion +
# un par scénario) — c'est précisément pourquoi ce lancement doit être
# asynchrone dès que la population dépasse quelques dizaines de personnes.
# ---------------------------------------------------------------------------
class SimulationPopulationRequest(BaseModel):
    """
    `population_id=None` → toutes les populations actives (union — voir
    resoudre_toutes_populations_actives()).

    `periode_debut_id`/`periode_fin_id` : plage de périodes CONSÉCUTIVES du
    MÊME plan de paie (RG-SIM-POPULATION-02) — le résultat cumule l'impact
    sur toutes les périodes de la plage par collaborateur (net_avant,
    net_apres_fusion, etc. = SOMME sur la plage), pas un détail période par
    période. Une seule période = periode_debut_id == periode_fin_id.

    `scenario_ids=[]` (RG-SIM-PROJECTION-01) : lancement "tel quel" pur, sans
    aucune hypothèse de changement — utile pour une simple PROJECTION dans le
    futur (ex. coût de la masse salariale sur l'exercice 2028). Dans ce cas,
    la projection retraite/fin de contrat prévisionnelle (voir
    _collaborateur_actif_prevu) EXCLUT automatiquement, période par période,
    les collaborateurs qui ne seraient plus actifs à cette date.

    `avec_ecarts=False` (RG-SIM-POPULATION-10, Adil DAIA) : contrôle
    UNIQUEMENT l'affichage des écarts (masqués dans le résultat : ligne,
    résumé fusion, résumé par scénario — seuls les montants "après" restent
    disponibles), jamais une contrainte technique. Réduit le temps de calcul
    dans le cas général (saute le calcul "tel quel"). SEULE EXCEPTION
    interne : si un scénario sélectionné contient une surcharge rubrique en
    mode "POURCENTAGE" (ex. "+10% du salaire de base"), le calcul "tel quel"
    reste structurellement nécessaire pour résoudre "après" lui-même (pas
    seulement l'écart — sans lui, on ne sait pas sur quel montant appliquer
    le %) : il a alors lieu en interne malgré tout, mais les écarts restent
    MASQUÉS dans le résultat exactement comme demandé — cette exception ne
    change rien à ce que le frontend affiche.
    """
    population_id: UUID | None = None
    periode_debut_id: UUID
    periode_fin_id: UUID
    scenario_ids: list[UUID] = Field(default_factory=list, max_length=20)
    avec_ecarts: bool = True


class SimulationPopulationJobCree(BaseModel):
    """Réponse immédiate de POST /simulation/population/lancer."""
    job_id: UUID
    nb_total: int


class ResultatScenarioIndividuel(BaseModel):
    """Impact d'UN scénario appliqué seul (isolé des autres), pour un collaborateur."""
    scenario_id: UUID
    scenario_nom: str
    net_apres: str | None = None
    ecart_net: str | None = None
    cout_employeur_apres: str | None = None
    ecart_cout_employeur: str | None = None


class LigneResultatPopulation(BaseModel):
    """Une ligne du tableau de résultats — un collaborateur de la population résolue."""
    collaborateur_id: UUID
    matricule: str
    nom: str
    prenom: str
    a_erreur: bool
    message_erreur: str | None = None
    net_avant: str | None = None
    cout_employeur_avant: str | None = None
    # Fusion (tous les scénarios combinés en un seul calcul)
    net_apres_fusion: str | None = None
    ecart_net_fusion: str | None = None
    cout_employeur_apres_fusion: str | None = None
    ecart_cout_employeur_fusion: str | None = None
    # Chaque scénario appliqué séparément, pour comparaison côte à côte
    par_scenario: list[ResultatScenarioIndividuel] = []
    # RG-SIM-PROJECTION-01 : nombre de périodes RÉELLEMENT calculées sur la
    # plage (peut être < nb_periodes total si le collaborateur est projeté
    # retraité/en fin de contrat avant la fin de la plage) + motif si partiel.
    nb_periodes_calculees: int = 0
    note_projection: str | None = None


class ResumeScenarioIndividuel(BaseModel):
    """Totaux agrégés (toute la population) pour UN scénario appliqué seul."""
    scenario_id: UUID
    scenario_nom: str
    net_apres: str
    ecart_net: str | None = None
    cout_employeur_apres: str
    ecart_cout_employeur: str | None = None


class SimulationPopulationResult(BaseModel):
    population_id: UUID | None
    population_nom: str
    periode_debut_id: UUID
    periode_fin_id: UUID
    periode_debut_libelle: str
    periode_fin_libelle: str
    nb_periodes: int  # nombre de périodes cumulées dans la plage (1 si période unique)
    scenarios: list[dict]  # [{"id":..., "nom":...}, ...] — scénarios réellement appliqués
    nb_collaborateurs: int
    nb_erreurs: int
    # RG-SIM-POPULATION-10 (Adil DAIA) : reflète tel quel la préférence
    # demandée — contrôle UNIQUEMENT l'affichage des écarts (resume_fusion,
    # resume_par_scenario) ci-dessous. Le calcul "tel quel" peut avoir lieu
    # en interne pour une autre raison (surcharge rubrique en mode
    # Pourcentage — structurellement nécessaire pour résoudre "après", pas
    # seulement pour l'écart), mais ça n'affecte jamais ce champ ni ce qui
    # est exposé ici : si avec_ecarts=False, les écarts restent masqués,
    # sans exception.
    avec_ecarts: bool = True
    resume_fusion: dict  # {net_avant, net_apres, ecart_net, cout_employeur_avant, cout_employeur_apres, ecart_cout_employeur} — CUMULÉS sur la plage ; net_avant/ecart_* à None si avec_ecarts=False
    resume_par_scenario: list[ResumeScenarioIndividuel]
    lignes: list[LigneResultatPopulation]


class SimulationPopulationJobStatut(BaseModel):
    """Réponse de GET /simulation/population/jobs/{id} — polling pendant le traitement."""
    id: UUID
    statut: str  # EN_ATTENTE | EN_COURS | TERMINE | ERREUR
    population_nom: str
    nb_total: int
    nb_traites: int
    erreur: str | None = None
    resultat: SimulationPopulationResult | None = None
    created_at: datetime
    termine_at: datetime | None = None


class SimulationPopulationJobResume(BaseModel):
    """
    Réponse de GET /simulation/population/jobs (RG-SIM-POPULATION-06 —
    historique des lancements) : résumé LÉGER, sans le `resultat` complet
    (potentiellement volumineux) — le détail se récupère via
    GET /simulation/population/jobs/{id} au clic sur une ligne.
    """
    id: UUID
    statut: str
    population_nom: str
    periode_debut_libelle: str | None = None
    periode_fin_libelle: str | None = None
    nb_total: int
    nb_traites: int
    created_by: UUID
    created_by_nom: str
    # RG-SIM-POPULATION-09 (Adil DAIA) : noms des scénarios appliqués — pour
    # distinguer d'un coup d'œil deux lancements par ailleurs identiques
    # (même population, même plage). Noms seulement (pas les id/hypotheses
    # complets) — reste un résumé LÉGER, cohérent avec le reste de ce schéma.
    scenario_noms: list[str] = []
    created_at: datetime
    termine_at: datetime | None = None


# ---------------------------------------------------------------------------
# Liste des bulletins simulés (RG-SIM-POPULATION-03, proposition —
# Adil DAIA) : un bulletin par (collaborateur, période) — table dédiée
# simulation_population_bulletin (migration 066), regroupable par UO/
# période/collaborateur, avec détail des rubriques au clic.
# ---------------------------------------------------------------------------
ModeRegroupementBulletins = Literal["aucun", "uo", "periode", "annee", "mois", "collaborateur"]


class BulletinSimulePopulation(BaseModel):
    """Une ligne de la liste plate (mode 'aucun', ou drill-down après clic sur un groupe)."""
    id: UUID
    collaborateur_id: UUID
    matricule: str
    nom: str
    prenom: str
    unite_libelle: str | None
    periode_id: UUID
    periode_annee: int
    periode_mois: int
    a_erreur: bool
    message_erreur: str | None
    exclu_projection: bool
    motif_exclusion: str | None
    net_avant: str | None
    net_apres_fusion: str | None
    ecart_net_fusion: str | None
    cout_employeur_avant: str | None
    cout_employeur_apres_fusion: str | None
    ecart_cout_employeur_fusion: str | None
    brut_imposable_avant: str | None = None
    brut_imposable_apres_fusion: str | None = None
    ecart_brut_imposable_fusion: str | None = None
    cot_patronale_avant: str | None = None
    cot_patronale_apres_fusion: str | None = None
    ecart_cot_patronale_fusion: str | None = None
    # Situation du collaborateur (demande Adil DAIA, ajout consultation) :
    # "avant" = situation réelle actuelle (collaborateur_contrats/
    # collaborateur_qualifications/collaborateur_affectations, à la date du
    # jour) ; "après" = la même valeur, SAUF si un des scénarios du job la
    # surcharge via une surcharges_table sur ce champ (auquel cas la valeur
    # surchargée est identique pour tout le job — voir _surcharges_apres_job).
    # None si non applicable au mode de regroupement (uo/periode/annee/mois).
    type_contrat_avant: str | None = None
    type_contrat_apres: str | None = None
    college_avant: str | None = None
    college_apres: str | None = None
    categorie_professionnelle_avant: str | None = None
    categorie_professionnelle_apres: str | None = None
    code_emploi_avant: str | None = None
    libelle_emploi_avant: str | None = None
    code_emploi_apres: str | None = None
    libelle_emploi_apres: str | None = None


class BulletinSimuleDetail(BulletinSimulePopulation):
    """Détail complet d'UN bulletin — réponse de GET .../bulletins/{id}, pour la vue rubriques au clic."""
    lignes_avant: list[dict] | None
    lignes_apres_fusion: list[dict] | None
    par_scenario: list[dict] | None
    # Totaux COMPLETS (total_brut, total_brut_imposable, net_imposable, etc.)
    # tels que renvoyés par simuler_bulletin().totaux — jamais reconstruits
    # à partir des lignes (des règles fiscales comme "imposable ou non" ne
    # sont pas déductibles de façon fiable depuis sens/est_cotisation seuls).
    totaux_avant: dict | None = None
    totaux_apres_fusion: dict | None = None


class GroupeBulletinsPopulation(BaseModel):
    """Une ligne agrégée (mode uo/periode/collaborateur)."""
    cle: str            # libellé du groupe affiché (UO, "Juil. 2026", "M00042 — Nom Prénom")
    cle_filtre: str      # valeur brute à repasser en filtre pour le drill-down (unite_libelle / periode_id / collaborateur_id)
    nb_bulletins: int
    nb_erreurs: int
    nb_exclus_projection: int
    # RG-SIM-POPULATION-10 (Adil DAIA) : None si le job a été lancé avec
    # avec_ecarts=False — toujours, sans exception (contrôle uniquement
    # l'affichage, voir lister_bulletins_population/avant_disponible).
    net_avant: str | None = None
    net_apres_fusion: str
    ecart_net_fusion: str | None = None
    cout_employeur_avant: str | None = None
    cout_employeur_apres_fusion: str
    ecart_cout_employeur_fusion: str | None = None
    brut_imposable_avant: str | None = "0"
    brut_imposable_apres_fusion: str = "0"
    ecart_brut_imposable_fusion: str | None = "0"
    cot_patronale_avant: str | None = "0"
    cot_patronale_apres_fusion: str = "0"
    ecart_cot_patronale_fusion: str | None = "0"
    # Situation du collaborateur — uniquement renseignée en mode
    # groupby="collaborateur" (une ligne = une personne) ; None pour les
    # autres modes de regroupement, où ces champs n'ont pas de sens.
    type_contrat_avant: str | None = None
    type_contrat_apres: str | None = None
    college_avant: str | None = None
    college_apres: str | None = None
    categorie_professionnelle_avant: str | None = None
    categorie_professionnelle_apres: str | None = None
    code_emploi_avant: str | None = None
    libelle_emploi_avant: str | None = None
    code_emploi_apres: str | None = None
    libelle_emploi_apres: str | None = None


class ListeBulletinsPopulationResult(BaseModel):
    """
    Réponse de GET /simulation/population/jobs/{id}/bulletins.

    `groupes` renseigné si un regroupement est demandé SANS filtre de
    drill-down (vue agrégée). `bulletins` renseigné si mode_regroupement=
    "aucun", OU si un filtre de drill-down est fourni (liste des bulletins
    individuels DANS ce groupe, après clic).
    """
    mode_regroupement: ModeRegroupementBulletins
    groupes: list[GroupeBulletinsPopulation] | None = None
    bulletins: list[BulletinSimulePopulation] | None = None


# ---------------------------------------------------------------------------
# Ergonomie de sélection (recherche collaborateur, cascade plan/année/période)
# ---------------------------------------------------------------------------
class CollaborateurOption(BaseModel):
    """Résultat de recherche — GET /simulation/collaborateurs/recherche."""
    id: UUID
    matricule: str
    nom: str
    prenom: str


class PlanPaieOption(BaseModel):
    """GET /simulation/plans-paie. Sélection manuelle pour l'instant : la
    table qui relierait un collaborateur à son plan de paie par défaut n'a
    pas été identifiée (le moteur lit le plan depuis la période choisie,
    jamais depuis le collaborateur) — voir CONCEPTION_ECRANS_SIMULATION.md,
    point à lever avec Adil DAIA avant d'automatiser cette étape."""
    id: UUID
    code: str
    libelle: str


class PeriodeOption(BaseModel):
    """GET /simulation/periodes. RG-SIM-PERIODE-01 : uniquement les périodes
    au statut OUVERTE (choix ergonomique par défaut du sélecteur — le moteur
    lui-même accepte n'importe quel statut en simulation, RG-SIM-IND-02)."""
    id: UUID
    annee: int
    mois: int
    numero_periode: int | None
    statut: str


class RubriqueSimulable(BaseModel):
    """GET /simulation/rubriques — pour peupler la liste déroulante d'une
    surcharge « Rubrique » (EditeurSurcharges.tsx). Exclut volontairement
    code_type IN ('COT', 'ASS') : les cotisations sont pilotées par
    cotisation_engine (pas surchargeables comme une rubrique normale) et les
    assiettes sont des accumulateurs internes, jamais une cible de saisie
    directe (même principe que les populations, cf. mémoire projet)."""
    code: str
    libelle: str
    code_type: str
    code_famille: str | None


class RegimeSimulable(BaseModel):
    """GET /simulation/regimes — pour peupler la liste déroulante d'une
    surcharge de taux de régime. `code` est le code de la RÈGLE de
    cotisation (regle_calcul_cotisation.code), pas le code régime : c'est la
    clé technique réellement utilisée par cotisation_engine.calculer_cotisation()
    (plusieurs règles peuvent porter le même régime — ex. part salariale et
    patronale séparées)."""
    code: str
    libelle: str
    code_regime: str | None


class PopulationSimulable(BaseModel):
    """GET /simulation/populations — pour le sélecteur de lancement en masse."""
    id: UUID
    libelle: str
    mode: str


class ValeurReferentielle(BaseModel):
    """Une ligne du référentiel pointé par un champ de contrat simulable.
    `parent_id` présent seulement si la table référencée a une colonne
    `parent_id` (hiérarchie auto-référencée, ex. unites_organisationnelles) —
    None sinon (référentiel plat)."""
    code: str
    libelle: str
    parent_id: str | None = None


class ReferentielChampResult(BaseModel):
    """
    GET /simulation/referentiel-valeurs?table=...&colonne=...

    `a_un_referentiel=False` signifie que ce champ n'est pas une clé
    étrangère (ex. salaire_base, un montant libre, ou date_debut, une date)
    — le front doit alors afficher une saisie libre adaptée au type plutôt
    qu'une liste déroulante. La détection est faite par introspection de
    contrainte FOREIGN KEY réelle (information_schema), pas par une liste de
    référentiels connus à l'avance — nouveau champ simulable ajouté demain,
    aucune modification de cet endpoint à prévoir tant qu'une vraie FK existe.

    `table` : nom de la table référencée résolue par introspection (None si
    a_un_referentiel=False) — exposé pour que le front puisse, au besoin,
    aller chercher des colonnes supplémentaires sur cette même table (ex.
    hiérarchie via parent_id, déjà inclus dans chaque ValeurReferentielle).
    """
    a_un_referentiel: bool
    table: str | None = None
    valeurs: list[ValeurReferentielle] = []


class ExportExcelRequest(BaseModel):
    """
    POST /simulation/export-excel. `resultat` est repris TEL QUEL depuis la
    réponse d'un des calculs de simulation (ResultatBulletin pour
    BULLETIN/EMBAUCHE, ResultatImpact pour IMPACT, SimulationPopulationResult
    pour POPULATION) ou depuis ScenarioSimulation.resultat_calcule d'un
    scénario déjà sauvegardé — non validé en détail ici, sa forme est
    garantie par l'endpoint qui l'a produit.

    `type_simulation` accepte "POPULATION" en plus des 3 valeurs de
    ModeSimulation — DÉLIBÉRÉMENT pas fusionné dans ModeSimulation lui-même :
    un scénario sauvegardé (ScenarioSimulationWrite.type_simulation) ne peut
    jamais être de type "POPULATION" (un lancement en masse n'est pas un
    scénario individuel qu'on sauvegarde), donc élargir ModeSimulation
    aurait permis à tort de créer un scénario de ce type.
    """
    titre: str = Field(..., min_length=1, max_length=200)
    type_simulation: Literal["BULLETIN", "IMPACT", "EMBAUCHE", "POPULATION"]
    resultat: dict


# ---------------------------------------------------------------------------
# Référentiel « Gabarits d'embauche » (table simulation_gabarit_embauche —
# voir 058_simulation_gabarits_embauche.sql)
# ---------------------------------------------------------------------------
class GabaritEmbaucheWrite(BaseModel):
    """
    `collaborateur_reference_id` est le SEUL champ structurant du calcul
    (garantit des cotisations fiables, voir la note dans la migration SQL) —
    tous les autres champs sont indicatifs, pour pré-remplir le formulaire
    UC3 uniquement.
    """
    nom: str = Field(..., min_length=1, max_length=200)
    collaborateur_reference_id: UUID
    code_poste: str | None = None
    plan_paie_id: UUID | None = None
    type_contrat: str | None = None
    salaire_indicatif_min: Decimal | None = None
    salaire_indicatif_max: Decimal | None = None
    actif: bool = True


class GabaritEmbauchePatch(BaseModel):
    nom: str | None = Field(None, min_length=1, max_length=200)
    collaborateur_reference_id: UUID | None = None
    code_poste: str | None = None
    plan_paie_id: UUID | None = None
    type_contrat: str | None = None
    salaire_indicatif_min: Decimal | None = None
    salaire_indicatif_max: Decimal | None = None
    actif: bool | None = None
    archive: bool | None = None


class GabaritEmbaucheRead(BaseModel):
    id: UUID
    nom: str
    collaborateur_reference_id: UUID
    code_poste: str | None
    plan_paie_id: UUID | None
    type_contrat: str | None
    salaire_indicatif_min: Decimal | None
    salaire_indicatif_max: Decimal | None
    actif: bool
    archive: bool
    created_at: datetime
    updated_at: datetime
