"""
app/schemas/paie_calcul.py — Schémas Pydantic du calcul de bulletin.
Auteur : Adil DAIA
"""
from datetime import datetime
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel


class CalculBulletinRequest(BaseModel):
    collaborateur_id: UUID
    periode_id: UUID
    persister: bool = False          # True = enregistre bulletin + lignes + cumuls
    type_lot: str = "UNITAIRE"       # UNITAIRE | SIMULATION


class LigneBulletinOut(BaseModel):
    code_rubrique: str
    libelle: str
    code_type: Optional[str] = None
    type_regle: Optional[str] = None
    ordre_calcul: Optional[int] = None
    ordre_affichage: int = 0
    base: Optional[Decimal] = None
    nombre: Optional[Decimal] = None
    taux: Optional[Decimal] = None
    montant: Decimal = Decimal("0")
    montant_patronal: Optional[Decimal] = None
    taux_patronal: Optional[Decimal] = None
    montant_cumul: Optional[Decimal] = None
    montant_patronal_cumul: Optional[Decimal] = None
    nombre_cumul: Optional[Decimal] = None
    sens: Optional[str] = None
    est_cotisation: bool = False
    type_periodicite: Optional[str] = None
    frequence_raz: Optional[str] = None
    date_valeur: Optional[str] = None
    texte: Optional[str] = None
    observation: Optional[str] = None


class TotauxOut(BaseModel):
    total_brut: Decimal
    total_brut_imposable: Decimal
    total_gains: Decimal
    total_retenues: Decimal
    total_cot_salariale: Decimal
    total_cot_patronale: Decimal
    net_imposable: Decimal
    net_a_payer: Decimal
    cout_employeur: Decimal


class CalculBulletinResult(BaseModel):
    bulletin_id: Optional[UUID] = None     # rempli si persister=True
    lot_id: Optional[UUID] = None
    collaborateur: dict
    periode: dict
    totaux: TotauxOut
    lignes: list[LigneBulletinOut]
    trace: list[Any]
    messages: list[str]
    a_erreur: bool = False


class BulletinLigneRead(LigneBulletinOut):
    id: UUID
    model_config = {"from_attributes": True}


class BulletinRead(BaseModel):
    id: UUID
    lot_id: UUID
    periode_id: UUID
    plan_paie_id: Optional[UUID] = None
    code_plan: Optional[str] = None
    collaborateur_id: UUID
    matricule: Optional[str] = None
    total_brut: Decimal
    total_gains: Decimal
    total_retenues: Decimal
    total_cot_salariale: Decimal
    total_cot_patronale: Decimal
    net_imposable: Decimal
    net_a_payer: Decimal
    cout_employeur: Decimal
    statut: str
    # Table d'où provient le bulletin : TEMP (précalcul) | VALIDE | HISTORIQUE
    origine: str = "VALIDE"
    a_erreur: bool
    messages: list = []
    calcule_le: datetime
    lignes: list[BulletinLigneRead] = []
    model_config = {"from_attributes": True}


# ---- Validation & historique --------------------------------------------
class ControleResultat(BaseModel):
    code: str
    libelle: str
    categorie: str
    niveau: str                 # BLOQUANT | ALERTE
    ok: bool
    message: Optional[str] = None


class RapportControle(BaseModel):
    bulletin_id: UUID
    statut: str
    controles: list[ControleResultat]
    bloquants_ko: int
    alertes_ko: int
    validable: bool


class ValiderRequest(BaseModel):
    forcer_alertes: bool = False
    commentaire: Optional[str] = None


class ValidationResult(BaseModel):
    valide: bool
    confirmation_requise: bool
    statut: str
    rapport: RapportControle


class HistoriqueRead(BaseModel):
    id: UUID
    periode_id: UUID
    bulletin_id: Optional[UUID] = None
    collaborateur_id: Optional[UUID] = None
    action: str
    statut_avant: Optional[str] = None
    statut_apres: Optional[str] = None
    decision: Optional[str] = None
    commentaire: Optional[str] = None
    utilisateur_id: Optional[UUID] = None
    created_at: datetime
    model_config = {"from_attributes": True}


# ---- Clôture annuelle ----------------------------------------------------
class ClotureAnneeRequest(BaseModel):
    plan_paie_id: UUID
    annee: int
    forcer_alertes: bool = False        # clôturer même si des bulletins ne sont pas validés
    commentaire: Optional[str] = None


class AnneePaieRead(BaseModel):
    id: UUID
    plan_paie_id: UUID
    annee: int
    statut: str
    cloture_le: Optional[datetime] = None
    cloture_par: Optional[UUID] = None
    commentaire: Optional[str] = None
    model_config = {"from_attributes": True}


# ---- Lancement en masse (population + lot) --------------------------------
class PopulationFiltres(BaseModel):
    """
    RG-POPULATION-EMPLOI-01 (Adil DAIA, décision explicite, 2026-08-11) :
    `codes_emploi` cible l'EMPLOI d'affiliation (ref_emploi.code) — tout
    collaborateur dont le poste actuel (une fois l'instance résolue vers son
    poste parent, via ref_poste) est rattaché à un de ces emplois est
    concerné. Remplace l'ancien `codes_poste` (correspondance exacte sur une
    INSTANCE de poste, ex. "DEV-001" — trop fin, ne représentait pas
    correctement "tous les développeurs" par exemple).

    RG-POPULATION-STATUT-01 (Adil DAIA) : aucun critère de statut de contrat
    — "le statut entre déjà dans le calcul" (un contrat doit être actif à
    la date de référence pour compter, cf. resolution service), un critère
    dédié aurait été redondant.
    """
    # Unités organisationnelles (UUID) : cocher une UO inclut ses sous-unités.
    unite_ids: list[UUID] = []
    codes_emploi: list[str] = []

    types_contrat: list[str] = []
    temps: list[str] = []
    statuts_collaborateur: list[str] = []
    regimes: list[str] = []
    nationalites: list[str] = []
    matricule: Optional[str] = None
    collaborateur_ids: list[UUID] = []


class PopulationRequest(BaseModel):
    plan_paie_id: UUID
    periode_id: UUID
    filtres: PopulationFiltres = PopulationFiltres()


class CollaborateurCible(BaseModel):
    id: UUID
    matricule: Optional[str] = None
    nom: Optional[str] = None
    prenom: Optional[str] = None
    # RG-POPULATION-APERCU-ENRICHI-01 (Adil DAIA) : contexte affiché dans
    # l'aperçu d'une population (liste des collaborateurs correspondants) —
    # unité/catégorie/type de contrat COURANTS, à la date du jour (calculés
    # côté routeur, jamais None que si réellement absent pour ce
    # collaborateur, ex. pas de contrat actif).
    unite_libelle: Optional[str] = None
    type_contrat: Optional[str] = None
    categorie_professionnelle: Optional[str] = None


class LotCalculRequest(PopulationRequest):
    persister: bool = True


class LigneLotResultat(BaseModel):
    collaborateur_id: UUID
    matricule: Optional[str] = None
    nom: Optional[str] = None
    net_a_payer: Optional[Decimal] = None
    a_erreur: bool = False
    message: Optional[str] = None


class LotCalculResult(BaseModel):
    nb_total: int
    nb_ok: int
    nb_erreur: int
    # Bulletins déjà validés : laissés intacts, ni recalculés ni comptés en erreur
    nb_ignores: int = 0
    total_net: Decimal
    total_cout: Decimal
    resultats: list[LigneLotResultat]


# ---- Validation en masse (lot) ------------------------------------------
class LotValiderRequest(PopulationRequest):
    forcer_alertes: bool = False


class LigneLotValidation(BaseModel):
    collaborateur_id: UUID
    matricule: Optional[str] = None
    nom: Optional[str] = None
    statut: str                    # VALIDE | BLOQUE | ALERTE | SANS_BULLETIN | DEJA_VALIDE
    bloquants: int = 0
    alertes: int = 0
    message: Optional[str] = None


class LotValidationResult(BaseModel):
    nb_total: int
    nb_valides: int
    # RG-LOT-DEJA-VALIDE-01 (Adil DAIA) : absent jusqu'ici de ce schéma alors
    # que le routeur (`response_model=LotValidationResult`) le renvoyait déjà
    # dans son dict — FastAPI/pydantic supprime silencieusement tout champ
    # non déclaré ici à la sérialisation. Le correctif précédent (distinguer
    # "validé(s) à l'instant" de "déjà validé(s) avant") n'avait donc jamais
    # pu atteindre le frontend tant que ce champ manquait ici.
    nb_deja_valide: int = 0
    nb_bloques: int
    nb_alertes: int
    nb_sans_bulletin: int
    resultats: list[LigneLotValidation]


# ---- Populations de paie (attribution des rubriques) ---------------------
# RG-POPULATION-RUBRIQUE-01 (Adil DAIA) : une population = les mêmes critères
# que le lancement en masse (PopulationFiltres ci-dessus), réutilisés tels
# quels — pas de référentiel de filtrage parallèle. Mode SQL : une expression
# booléenne UNIQUEMENT (jamais une requête libre), insérée dans un gabarit
# fermé côté service (app/services/population_paie.py) — validée à
# l'enregistrement (mots-clés dangereux rejetés) ET timeout court à
# l'exécution, un mauvais réglage ne doit jamais bloquer un lancement en masse.
class PopulationPaieCriteres(BaseModel):
    """
    Modélisation de la définition d'une population — voir PopulationFiltres
    ci-dessus pour le détail de `codes_emploi` (RG-POPULATION-EMPLOI-01) et
    l'absence volontaire d'un critère de statut de contrat
    (RG-POPULATION-STATUT-01).
    """
    unite_ids: list[UUID] = []
    codes_emploi: list[str] = []
    types_contrat: list[str] = []
    temps: list[str] = []
    statuts_collaborateur: list[str] = []
    regimes: list[str] = []
    nationalites: list[str] = []
    # RG-POPULATION-RUBRIQUE-03 (Adil DAIA) : classification
    # (collaborateur_qualifications — qualification la plus récente à la
    # date de référence, pas de date_fin sur cette table).
    codes_fonction: list[str] = []
    codes_categorie_professionnelle: list[str] = []
    codes_college: list[str] = []
    codes_responsabilite: list[str] = []
    codes_niveau: list[str] = []
    codes_grade: list[str] = []
    codes_echelle: list[str] = []
    codes_classe: list[str] = []
    echelons: list[str] = []          # texte libre (echelon_actuel), pas de code de référentiel
    codes_filiere: list[str] = []
    codes_activite: list[str] = []


class PopulationPaieWrite(BaseModel):
    code: str
    libelle: str
    mode: str = "CRITERES"          # CRITERES | SQL
    criteres: PopulationPaieCriteres = PopulationPaieCriteres()
    condition_sql: Optional[str] = None
    actif: bool = True


class PopulationPaieRead(PopulationPaieWrite):
    id: UUID
    archive: bool = False
    created_at: datetime
    nb_rubriques: int = 0            # nombre de rubriques ATTRIBUEES — pour l'écran de liste
    nb_retirees: int = 0             # nombre de rubriques RETIREES (RG-POPULATION-RUBRIQUE-04)
    model_config = {"from_attributes": True}


class PopulationApercuRequest(BaseModel):
    """Aperçu de la population AVANT enregistrement (ou d'une population déjà
    enregistrée, via population_id) — réutilise le même mécanisme que l'aperçu
    de population du lancement en masse."""
    population_id: Optional[UUID] = None
    mode: Optional[str] = None
    criteres: Optional[PopulationPaieCriteres] = None
    condition_sql: Optional[str] = None


class ConditionSqlValidation(BaseModel):
    ok: bool
    erreur: Optional[str] = None


class RubriquePopulationsWrite(BaseModel):
    """Remplace intégralement l'attribution de populations d'une rubrique
    (pas d'ajout/retrait unitaire côté API — plus simple à raisonner, l'écran
    envoie toujours l'état complet du multi-select)."""
    population_ids: list[UUID] = []


class LignePopulationRubrique(BaseModel):
    code_rubrique: str
    type_attribution: str = "ATTRIBUEE"     # ATTRIBUEE | RETIREE


class PopulationRubriquesWrite(BaseModel):
    """Sens inverse de RubriquePopulationsWrite : remplace intégralement les
    rubriques attribuées à CETTE population. C'est la direction d'édition
    retenue pour l'écran (RG-POPULATION-RUBRIQUE-02, Adil DAIA) — une
    rubrique peut appartenir à plusieurs populations gérées par des
    personnes différentes ; l'éditer depuis la fiche rubrique risquait de la
    retirer par erreur d'une population à laquelle quelqu'un d'autre
    l'avait rattachée entre-temps. RubriquePopulationsWrite reste utilisable
    programmatiquement mais n'est plus appelée depuis RubriqueForm.tsx.

    RG-POPULATION-RUBRIQUE-04 : chaque ligne porte désormais un type
    (ATTRIBUEE ou RETIREE) — voir rubriques_eligibles() dans
    population_paie.py pour la règle de priorité du retrait."""
    lignes: list[LignePopulationRubrique] = []


class RubriqueDependanceWrite(BaseModel):
    """Rubriques "déclencheurs" : avoir accès à l'une d'elles suffit à débloquer
    la rubrique courante, même sans population qui lui soit propre."""
    codes_declencheurs: list[str] = []



class InstructionIn(BaseModel):
    numero: int = 0
    instruction: str = ""
    label: Optional[str] = None


class ReglesValiderRequest(BaseModel):
    instructions: list[InstructionIn] = []


class ReglesValiderResult(BaseModel):
    ok: bool
    erreurs: list[str] = []
    avertissements: list[str] = []


class ReglesTesterRequest(BaseModel):
    instructions: list[InstructionIn] = []
    collaborateur_id: UUID
    periode_id: UUID
    seed: Optional[dict] = None


class ReglesTesterResult(BaseModel):
    sorties: dict
    trace: list
    avertissements: list[str] = []


class ReglesTesterManuelRequest(BaseModel):
    instructions: list[InstructionIn] = []
    seed: Optional[dict] = None
    rubriques: Optional[dict] = None       # {"CODE": {"MT":..,"NB":..,"TX":..,"BASE":..}}
    constantes: Optional[dict] = None      # {"CODE": valeur}
    cumuls: Optional[dict] = None          # {"CODE": valeur}
    precedents: Optional[dict] = None      # {"CODE": valeur} ou {"CODE:n": valeur}
    baremes: Optional[dict] = None         # {"CODE": valeur}
    date_paie: Optional[str] = None
    date_jour: Optional[str] = None
