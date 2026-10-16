"""
app/schemas/pret.py   [RÉÉCRIT pour coller exactement au contrat frontend
réel découvert dans MesPretsPage.tsx / GestionPretsPage.tsx / pretsApi.ts]
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

# ---------------------------------------------------------------------------
# Enums (miroir des types PostgreSQL réels)
# ---------------------------------------------------------------------------

AlgoAmortissement = Literal["lineaire", "french_amortissement", "in_fine"]

PretStatut = Literal[
    "brouillon", "en_attente_validation", "valide", "debloque", "en_cours",
    "suspendu", "solde", "refuse", "annule",
    "cloture_stc_solde", "cloture_stc_reste_du",
]

EcheanceStatut = Literal["planifiee", "prelevee", "reportee", "forcee", "annulee"]
MotifSuspension = Literal["conge_sans_solde", "conge_parental", "maladie_longue_duree", "disponibilite", "autre"]
ModeSuspension = Literal["gel_echeance", "hors_paie"]


# ---------------------------------------------------------------------------
# Référentiels
# ---------------------------------------------------------------------------

class TypePret(BaseModel):
    code: str
    libelle: str
    description: Optional[str] = None
    categorie_code: str
    origine_code: str
    taux_annuel_defaut: Decimal
    duree_max_mois: int
    montant_max: Optional[Decimal] = None
    algo_defaut: str
    avance_sur_salaire: bool
    justificatif_requis: bool
    icone: str
    couleur: str

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Simulation (pas de persistance)
# ---------------------------------------------------------------------------

class TrancheMensualiteIn(BaseModel):
    ordre: int
    montant_mensualite: Decimal
    date_debut: date
    date_fin: Optional[date] = None


class SimulationPretRequest(BaseModel):
    type_code: str
    montant: Decimal = Field(gt=0)
    nb_echeance: int = Field(gt=0)
    date_premiere_echeance: date
    taux_annuel: Optional[Decimal] = None
    taux_tva: Optional[Decimal] = None
    algo_name: Optional[AlgoAmortissement] = None
    tranches: Optional[list[TrancheMensualiteIn]] = None

    @field_validator("montant", "taux_annuel", "taux_tva")
    @classmethod
    def _non_negatif(cls, v: Optional[Decimal]) -> Optional[Decimal]:
        if v is not None and v < 0:
            raise ValueError("Valeur négative non autorisée")
        return v


class EcheanceSimulee(BaseModel):
    numero: int
    date_echeance: date
    capital_du: Decimal
    mt_capital: Decimal
    mt_interet: Decimal
    mt_total: Decimal
    capital_restant: Decimal
    capital_rembourse_cumule: Decimal
    mt_tva_interet: Decimal = Decimal("0")


class SimulationPretResponse(BaseModel):
    type_code: str
    algo_name: AlgoAmortissement
    montant: Decimal
    taux_annuel: Decimal
    nb_echeance_demande: int
    nb_echeance_retenu: int
    mensualite_theorique: Decimal
    cout_total_interets: Decimal
    borne_fin_annee_civile_appliquee: bool
    echeancier: list[EcheanceSimulee]
    avertissements: list[str] = []


# ---------------------------------------------------------------------------
# Éligibilité
# ---------------------------------------------------------------------------

class ResultatRegleEligibilite(BaseModel):
    code_regle: str
    libelle: str
    niveau: Literal["BLOQUANT", "ALERTE"]
    respectee: bool
    message: str
    derogation_rh_autorisee: bool


class VerificationEligibiliteResponse(BaseModel):
    eligible: bool
    resultats: list[ResultatRegleEligibilite]


# ---------------------------------------------------------------------------
# Demande (self-service)
# ---------------------------------------------------------------------------

class DemandePretCreate(BaseModel):
    type_code: str
    montant: Decimal = Field(gt=0)
    nb_echeance: int = Field(gt=0)
    date_premiere_echeance: date
    objet: Optional[str] = None
    motif: Optional[str] = None
    derogations_regles: Optional[list[str]] = None


# ---------------------------------------------------------------------------
# Pret / PretDetail - MIROIR EXACT du type frontend Pret / PretDetail
# ---------------------------------------------------------------------------

class PretOut(BaseModel):
    id: UUID
    matricule: str
    collab_nom: Optional[str] = None
    ref_pret: Optional[str] = None
    type_code: Optional[str] = None
    type_libelle: Optional[str] = None
    type_icone: Optional[str] = None
    type_couleur: Optional[str] = None
    pret_interne: bool
    objet: Optional[str] = None
    mt_pret: Decimal
    tx_interets: Decimal
    taux_tva: Decimal = Decimal("0")
    nb_echeance: int
    mt_echeance: Optional[Decimal] = None
    mt_echeance_plus: Decimal
    algo_name: AlgoAmortissement
    statut: PretStatut
    capital_restant: Decimal
    echeance_restant: Optional[int] = None
    mt_rembourse: Decimal
    mt_debloque: Optional[Decimal] = None
    dt_demande: date
    dt_deblocage: Optional[date] = None
    dt_premiere_retenue: Optional[date] = None
    dt_proch_echeance: Optional[date] = None
    fin_prevue: Optional[date] = None
    tx_endettement_avant: Optional[Decimal] = None
    tx_endettement_apres: Optional[Decimal] = None
    tx_endettement_i: Optional[Decimal] = None
    avantage_nature_mensuel: Decimal
    rubrique_lib: Optional[str] = None
    rubrique_paie_code: Optional[str] = None
    pret_suspendu: bool
    motif_suspension: Optional[MotifSuspension] = None
    mode_suspension: Optional[ModeSuspension] = None
    dt_debut_suspension: Optional[date] = None
    dt_fin_suspension: Optional[date] = None
    organisme_credit: Optional[str] = None
    etab_credit: Optional[str] = None
    no_compte: Optional[str] = None
    code_bqe: Optional[str] = None
    clerib: Optional[str] = None
    dt_decision: Optional[date] = None
    ref_decision: Optional[str] = None
    matric_decideur: Optional[str] = None
    competenc_decideur: Optional[str] = None
    motif_decision: Optional[str] = None
    pret_debloque: bool

    # Champs complémentaires (dossier fonctionnel — écrans Descriptif/Banque)
    motif: Optional[str] = None
    dt_debut_pret: Optional[date] = None
    dt_debut_remb: Optional[date] = None
    justificatif_fourni: bool = False
    justificatif_date: Optional[date] = None
    observations_rh: Optional[str] = None
    no_cheque: Optional[str] = None
    banque_emettrice: Optional[str] = None
    code_guichet: Optional[str] = None
    intitule_compte: Optional[str] = None
    hypotheque: bool = False
    reconnaissance_dette: bool = False
    priorite_prelevement: Optional[int] = None
    manuel: bool = False
    forcage: bool = False
    security_level: Optional[int] = None
    created_date: Optional[datetime] = None
    modified_date: Optional[datetime] = None
    created_by: Optional[str] = None
    modified_by: Optional[str] = None

    class Config:
        from_attributes = True


class EcheanceOut(BaseModel):
    numero: int
    date_echeance: date
    capital_du: Decimal
    mt_capital: Decimal
    mt_interet: Decimal
    mt_total: Decimal
    capital_restant: Decimal
    statut: EcheanceStatut
    reliquat: Decimal
    reference_paie: Optional[str] = None
    mt_tva_interet: Decimal = Decimal("0")

    # Traitement réel par la paie — NULL tant que la clôture de paie n'a
    # pas traité cette échéance (voir migration 42).
    dt_reelle_remboursement: Optional[date] = None
    periode_paie_code: Optional[str] = None
    mois_paie: Optional[int] = None
    annee_paie: Optional[int] = None

    class Config:
        from_attributes = True


class RemboursementAnticipeOut(BaseModel):
    id: UUID
    date_remboursement: date
    type_remboursement: Literal["PARTIEL", "TOTAL"]
    montant: Decimal
    mode_paiement: Literal["CHEQUE", "VIREMENT", "ESPECES"]
    reference_paiement: Optional[str] = None
    capital_restant_avant: Decimal
    capital_restant_apres: Decimal
    impact_amortissement: Literal["REDUCTION_MENSUALITE", "REDUCTION_DUREE"]
    recalcul_effectue: bool
    created_by: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class BanqueUpdateIn(BaseModel):
    """Coordonnées RIB du compte vers lequel virer la retenue à la source
    (organisme de crédit externe, ou compte du collaborateur pour un prêt
    interne si un virement — plutôt qu'une simple retenue paie — est requis).
    Éditable après création, pas seulement à la saisie initiale."""
    organisme_credit: Optional[str] = None
    etab_credit: Optional[str] = None
    code_bqe: Optional[str] = None
    code_guichet: Optional[str] = None
    no_compte: Optional[str] = None
    clerib: Optional[str] = None
    intitule_compte: Optional[str] = None
    hypotheque: Optional[bool] = None
    reconnaissance_dette: Optional[bool] = None


class PretExterneUpdateIn(BaseModel):
    """Édition des éléments descriptifs d'un prêt EXTERNE — contrairement à
    un prêt interne, aucun moteur d'amortissement ne recalcule quoi que ce
    soit ici : l'échéancier vient de l'établissement de crédit (saisi ou
    importé séparément), donc rien n'empêche de corriger ces champs à
    n'importe quel moment, y compris après déblocage.
    fin_prevue n'est PAS saisissable ici : elle est systématiquement
    recalculée côté serveur = dt_debut_pret + nb_echeance mois."""
    mt_pret: Optional[Decimal] = Field(default=None, gt=0)
    nb_echeance: Optional[int] = Field(default=None, gt=0)
    tx_interets: Optional[Decimal] = Field(default=None, ge=0)
    taux_tva: Optional[Decimal] = Field(default=None, ge=0)
    dt_debut_pret: Optional[date] = None
    dt_debut_remb: Optional[date] = None
    ref_pret: Optional[str] = None
    motif: Optional[str] = None
    # Situation de début — image du prêt au moment de sa contraction/saisie
    # (utile si le prêt existait déjà avant d'être saisi dans le système).
    deja_debloque: Optional[bool] = None
    montant_debloque: Optional[Decimal] = None
    date_deblocage: Optional[date] = None
    capital_restant_saisie: Optional[Decimal] = None


class RecalculEcheancierIn(BaseModel):
    """Recalcul manuel de l'échéancier à partir d'un nouveau capital restant
    et d'un nouveau nombre d'échéances (ex. après un ajustement métier
    exceptionnel). Les échéances déjà 'prelevee' ne sont JAMAIS touchées —
    seule la suite du tableau est régénérée à partir de date_reprise."""
    nouveau_capital_restant: Decimal = Field(gt=0)
    nouveau_nb_echeances: int = Field(gt=0)
    date_reprise: date
    motif: str = Field(min_length=1)


class SuspensionHistoriqueOut(BaseModel):
    id: UUID
    motif_suspension: Optional[MotifSuspension] = None
    mode_suspension: Optional[ModeSuspension] = None
    dt_debut_suspension: date
    dt_fin_suspension: Optional[date] = None
    nb_mois_decale: int
    fin_prevue_avant: Optional[date] = None
    fin_prevue_apres: Optional[date] = None
    demandeur_ref: Optional[str] = None
    gestionnaire_paie_ref: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class AuditEntryOut(BaseModel):
    id: UUID
    action: str
    champ: Optional[str] = None
    ancienne_valeur: Optional[str] = None
    nouvelle_valeur: Optional[str] = None
    operateur: str
    security_level_operateur: Optional[int] = None
    horodatage: datetime

    class Config:
        from_attributes = True


class PretDetailOut(PretOut):
    echeancier: list[EcheanceOut] = []
    audit: list[AuditEntryOut] = []


class PretStatsOut(BaseModel):
    en_attente: int
    actifs: int
    suspendus: int
    encours_total: Decimal
    capital_restant: Decimal
    enveloppe_disponible: Decimal
    plafond_interne_annuel: Decimal
    enveloppe_interne_utilisee: Decimal


class AlerteOut(BaseModel):
    id: UUID
    type_alerte: str
    ref_pret: Optional[str] = None
    matricule: Optional[str] = None
    message: str
    cree_le: datetime
    lue: bool

    class Config:
        from_attributes = True


class PretConfigOut(BaseModel):
    code: str
    libelle: str
    valeur: Decimal
    description: Optional[str] = None
    modifie_par: Optional[str] = None

    class Config:
        from_attributes = True


class PretConfigUpdateIn(BaseModel):
    valeur: Decimal


# ---------------------------------------------------------------------------
# Payloads des actions de gestion (GestionPretsPage.tsx)
# ---------------------------------------------------------------------------

class ValidationDecisionIn(BaseModel):
    decision: Literal["approuve", "refuse"]
    ref_decision: Optional[str] = None
    motif_decision: Optional[str] = None
    competenc_decideur: Optional[str] = None


class GenererAmortissementIn(BaseModel):
    date_premiere_echeance: date


class LigneEcheancierImportIn(BaseModel):
    """Une ligne d'échéancier fourni par l'établissement de crédit externe
    (saisie manuelle) ou extraite d'un import (dossier fonctionnel — prêts
    externes/cessions). numero est optionnel : si absent, il est attribué
    séquentiellement à la suite de l'échéancier déjà en base."""
    numero: Optional[int] = Field(default=None, gt=0)
    date_echeance: date
    mt_capital: Decimal = Field(ge=0)
    mt_interet: Decimal = Field(ge=0)
    mt_tva_interet: Decimal = Field(default=Decimal("0"), ge=0)


class ImporterEcheancierIn(BaseModel):
    lignes: list[LigneEcheancierImportIn] = Field(min_length=1)


class SupprimerEcheancesIn(BaseModel):
    """Suppression d'une ou plusieurs échéances PAS ENCORE traitées (statut
    != 'prelevee') d'un prêt externe — ex. correction d'une saisie/import
    erronée. Jamais autorisé sur une échéance déjà 'prelevee'."""
    numeros: list[int] = Field(min_length=1)


class DeblocageIn(BaseModel):
    montant_debloque: Decimal = Field(gt=0)
    date_deblocage: date
    no_cheque: Optional[str] = None
    banque_emettrice: Optional[str] = None


class SuspensionIn(BaseModel):
    motif: MotifSuspension
    mode: ModeSuspension
    date_debut: date
    date_fin: Optional[date] = None


class ForcageEcheanceIn(BaseModel):
    numero_echeance: int = Field(gt=0)
    nouveau_montant: Decimal = Field(gt=0)
    note: str = Field(min_length=1)
    # Comment régénérer la suite du tableau après le forçage :
    #  - reduire_mensualite : garde le même nombre d'échéances restantes,
    #    ajuste le montant de chacune (durée inchangée)
    #  - reduire_duree : garde la mensualité habituelle du prêt, ajuste
    #    le nombre d'échéances restantes en conséquence
    mode_cascade: Literal["reduire_mensualite", "reduire_duree"] = "reduire_mensualite"


class CreationDirectePretIn(BaseModel):
    """Saisie directe par un Gestionnaire RH/Administrateur (dossier
    fonctionnel §5.2/§5.3) : pour un prêt externe, une reprise d'historique,
    ou simplement un dossier créé sans passer par le self-service. Aucun
    circuit de validation n'est déclenché — le dossier est créé "valide"
    directement (ou "debloque" si les infos de déblocage sont fournies,
    typique d'une reprise d'un prêt déjà en cours ailleurs)."""
    collaborateur_id: UUID
    type_code: str
    montant: Decimal = Field(gt=0)
    nb_echeance: int = Field(gt=0)
    taux_annuel: Optional[Decimal] = None
    taux_tva: Optional[Decimal] = None
    date_premiere_echeance: date
    objet: Optional[str] = None
    motif: Optional[str] = None

    # Caractéristiques complémentaires (écran "Descriptif" du dossier fonctionnel)
    ref_pret: Optional[str] = None
    mt_echeance_plus: Optional[Decimal] = None
    dt_debut_pret: Optional[date] = None
    dt_debut_remb: Optional[date] = None
    justificatif_fourni: bool = False
    justificatif_date: Optional[date] = None
    observations_rh: Optional[str] = None

    # Renseignés uniquement si le prêt est repris déjà débloqué (reprise
    # d'historique) — sinon laissez vide, le déblocage se fera plus tard
    # via l'action "Débloquer" habituelle.
    deja_debloque: bool = False
    montant_debloque: Optional[Decimal] = None
    date_deblocage: Optional[date] = None
    capital_restant_saisie: Optional[Decimal] = None

    # Banque (écran "Banque" du dossier fonctionnel — pas réservé aux prêts externes)
    organisme_credit: Optional[str] = None
    etab_credit: Optional[str] = None
    code_bqe: Optional[str] = None
    code_guichet: Optional[str] = None
    no_compte: Optional[str] = None
    clerib: Optional[str] = None
    intitule_compte: Optional[str] = None
    hypotheque: bool = False
    reconnaissance_dette: bool = False


# ---------------------------------------------------------------------------
# Paramétrage (admin) — catégories, types de prêt, règles d'éligibilité
# ---------------------------------------------------------------------------

class CategoriePretIn(BaseModel):
    code: str
    libelle: str
    description: Optional[str] = None
    icone: str = "Tag"
    couleur: str = "#6b7280"
    ordre: int = 10
    actif: bool = True


class CategoriePretOut(CategoriePretIn):
    class Config:
        from_attributes = True


class TypePretAdminIn(BaseModel):
    code: str
    libelle: str
    description: Optional[str] = None
    categorie_code: str
    origine_code: str
    taux_annuel_defaut: Decimal = Decimal("0")
    duree_max_mois: int = 36
    montant_max: Optional[Decimal] = None
    anciennete_min_mois: int = 6
    algo_defaut: AlgoAmortissement = "lineaire"
    rubrique_paie_code: Optional[str] = None
    rubrique_paie_lib: Optional[str] = None
    rubrique_paie_code_interet: Optional[str] = None
    rubrique_paie_lib_interet: Optional[str] = None
    rubrique_paie_code_tva: Optional[str] = None
    rubrique_paie_lib_tva: Optional[str] = None
    imputable_paie: bool = True
    nb_max_simultanes: int = 1
    renouvelable: bool = False
    justificatif_requis: bool = False
    double_validation: bool = False
    avance_sur_salaire: bool = False
    workflow_actif: bool = True
    code_workflow: Optional[str] = None
    autorise_remboursement_anticipe: bool = True
    autorise_suspension: bool = True
    report_max_consecutif: int = 1
    mode_amortissement_defaut: Literal["AUTO", "MANUEL", "IMPORT"] = "AUTO"
    priorite_retenue: int = 40
    quotite_max_pourcent_override: Optional[Decimal] = None
    types_contrat_autorises: Optional[list[str]] = None
    icone: str = "Banknote"
    couleur: str = "#0ea5e9"
    ordre: int = 10
    actif: bool = True


class TypePretAdminOut(TypePretAdminIn):
    class Config:
        from_attributes = True


class RegleCatalogueOut(BaseModel):
    code: str
    libelle: str
    description: Optional[str] = None
    parametres_attendus: Optional[str] = None
    actif: bool

    class Config:
        from_attributes = True


class TypeRegleIn(BaseModel):
    code_regle: str
    parametres: dict = Field(default_factory=dict)
    niveau: Literal["BLOQUANT", "ALERTE"] = "BLOQUANT"
    derogation_rh_autorisee: bool = False
    ordre: int = 10
    actif: bool = True


class TypeRegleOut(TypeRegleIn):
    id: UUID

    class Config:
        from_attributes = True
