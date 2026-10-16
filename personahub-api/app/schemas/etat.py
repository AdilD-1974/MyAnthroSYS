"""
Schémas Pydantic du générateur d'états personnalisés.
RG-ETAT-GEN / RG-ETAT-ECRAN / RG-ETAT-PERIODE (MODULE_ETATS_PAIE.md §13-§14).
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, Field


class FormatSortieEtat(str, Enum):
    PDF = "PDF"
    EXCEL = "EXCEL"
    LES_DEUX = "LES_DEUX"


class StatutEtat(str, Enum):
    BROUILLON = "BROUILLON"
    PUBLIE = "PUBLIE"
    ARCHIVE = "ARCHIVE"


class VisibiliteEtat(str, Enum):
    PRIVE = "PRIVE"
    SOCIETE = "SOCIETE"
    GLOBAL = "GLOBAL"


class ModeDonneeChamp(str, Enum):
    PERIODE = "PERIODE"
    ACTUEL = "ACTUEL"


# -----------------------------------------------------------------------------
# ref_type_source_etat / ref_champ_disponible_etat (dynamiques, migration 069)
# -----------------------------------------------------------------------------
# type_source n'est plus un Enum figé côté code : il est validé contre
# ref_type_source_etat en base (FK + vérification explicite dans le router),
# pour qu'un nouveau type_source ajouté par un administrateur soit utilisable
# sans modification ni redéploiement du backend.

class TypeSourceEtatCreate(BaseModel):
    code: str
    libelle: str
    contexte_requis: list[str] = Field(default_factory=list)


class TypeSourceEtatUpdate(BaseModel):
    libelle: str | None = None
    contexte_requis: list[str] | None = None
    actif: bool | None = None


class TypeSourceEtatOut(BaseModel):
    code: str
    libelle: str
    contexte_requis: list[str]
    actif: bool


class ChampDisponibleCreate(BaseModel):
    champ_code: str
    libelle: str
    mode_donnee_defaut: ModeDonneeChamp = ModeDonneeChamp.PERIODE
    ordre_affichage: int = 0


class ChampDisponibleUpdate(BaseModel):
    libelle: str | None = None
    mode_donnee_defaut: ModeDonneeChamp | None = None
    ordre_affichage: int | None = None
    actif: bool | None = None


# -----------------------------------------------------------------------------
# etat_champ_selection
# -----------------------------------------------------------------------------

# -----------------------------------------------------------------------------
# etat_corps / etat_corps_colonne / etat_corps_rubrique / etat_corps_ligne_speciale
# (RG-ETAT-CORPS, migration 071 — remplace etat_bloc)
# -----------------------------------------------------------------------------
# Modèle à 4 niveaux : un corps (section nommée du bulletin) porte des
# colonnes nommées ; chaque rubrique qui y est attachée mappe individuellement
# chacun de ses attributs (Nombre/Montant/Taux) vers une colonne précise ;
# des lignes spéciales (constantes/totaux fixes) coexistent avec les
# rubriques dynamiques.

class FormatColonneEtat(str, Enum):
    MONTANT_2DEC = "MONTANT_2DEC"
    NOMBRE_ENTIER = "NOMBRE_ENTIER"
    NOMBRE_DECIMAL = "NOMBRE_DECIMAL"
    POURCENTAGE = "POURCENTAGE"
    TEXTE = "TEXTE"
    DATE = "DATE"


class AttributRubrique(str, Enum):
    NOMBRE = "NOMBRE"
    BASE = "BASE"
    MONTANT = "MONTANT"
    MONTANT_PATRONAL = "MONTANT_PATRONAL"
    TAUX = "TAUX"


class EtatCorpsCreate(BaseModel):
    corps_code: str
    libelle: str
    ordre_affichage: int = 0
    visible: bool = True
    couleur_fond: str | None = None
    couleur_texte: str | None = None
    police: str | None = None
    taille_police: int | None = None
    gras: bool = False


class EtatCorpsUpdate(BaseModel):
    libelle: str | None = None
    ordre_affichage: int | None = None
    visible: bool | None = None
    couleur_fond: str | None = None
    couleur_texte: str | None = None
    police: str | None = None
    taille_police: int | None = None
    gras: bool | None = None


class EtatCorpsOut(BaseModel):
    id: UUID
    etat_id: UUID
    corps_code: str
    libelle: str
    ordre_affichage: int
    visible: bool
    couleur_fond: str | None
    couleur_texte: str | None
    police: str | None
    taille_police: int | None
    gras: bool


class EtatCorpsColonneIn(BaseModel):
    code_colonne: str
    libelle: str
    format: FormatColonneEtat = FormatColonneEtat.MONTANT_2DEC
    ordre_affichage: int = 0


class EtatCorpsColonneOut(BaseModel):
    id: UUID
    code_colonne: str
    libelle: str
    format: FormatColonneEtat
    ordre_affichage: int


class EtatCorpsRubriqueMappingIn(BaseModel):
    attribut: AttributRubrique
    code_colonne: str  # référence par code_colonne, pas par id -- plus stable pour le client


class EtatCorpsRubriqueMappingOut(BaseModel):
    attribut: AttributRubrique
    code_colonne: str


class EtatCorpsRubriqueIn(BaseModel):
    rubrique_paie_code: str
    ordre_affichage: int = 0
    libelle_personnalise: str | None = None
    mappings: list[EtatCorpsRubriqueMappingIn] = Field(default_factory=list)


class EtatCorpsRubriqueOut(BaseModel):
    id: UUID
    rubrique_paie_code: str
    libelle: str | None  # libellé par défaut de la rubrique (rubrique_paie.libelle)
    libelle_personnalise: str | None  # intitulé personnalisé, si défini
    ordre_affichage: int
    mappings: list[EtatCorpsRubriqueMappingOut]


class EtatCorpsLigneSpecialeIn(BaseModel):
    code_constante: str
    libelle: str
    code_colonne: str | None = None
    ordre_affichage: int = 0


class EtatCorpsLigneSpecialeOut(BaseModel):
    id: UUID
    code_constante: str
    libelle: str
    code_colonne: str | None
    ordre_affichage: int


class EtatCorpsDetail(EtatCorpsOut):
    colonnes: list[EtatCorpsColonneOut] = Field(default_factory=list)
    rubriques: list[EtatCorpsRubriqueOut] = Field(default_factory=list)
    lignes_speciales: list[EtatCorpsLigneSpecialeOut] = Field(default_factory=list)


# -----------------------------------------------------------------------------
# etat_bloc / etat_bloc_rubrique / etat_bloc_colonne_total (migration 072)
# -----------------------------------------------------------------------------
# Regroupement VISUEL d'un sous-ensemble des rubriques d'UN corps -- ne porte
# aucune donnée propre (la donnée reste sur le corps), seulement présentation :
# style, position du libellé, et quelles colonnes affichent un total.

class PositionLibelleBloc(str, Enum):
    DEBUT = "DEBUT"
    FIN = "FIN"
    AUCUN = "AUCUN"


class PositionTotalBloc(str, Enum):
    HAUT = "HAUT"
    BAS = "BAS"
    AUCUN = "AUCUN"


class EtatBlocCreate(BaseModel):
    bloc_code: str
    libelle: str
    ordre_affichage: int = 0
    visible: bool = True
    couleur_fond: str | None = None
    couleur_texte: str | None = None
    police: str | None = None
    taille_police: int | None = None
    gras: bool = False
    position_libelle: PositionLibelleBloc = PositionLibelleBloc.DEBUT
    position_total: PositionTotalBloc = PositionTotalBloc.AUCUN


class EtatBlocUpdate(BaseModel):
    libelle: str | None = None
    ordre_affichage: int | None = None
    visible: bool | None = None
    couleur_fond: str | None = None
    couleur_texte: str | None = None
    police: str | None = None
    taille_police: int | None = None
    gras: bool | None = None
    position_libelle: PositionLibelleBloc | None = None
    position_total: PositionTotalBloc | None = None


class EtatBlocOut(BaseModel):
    id: UUID
    etat_corps_id: UUID
    bloc_code: str
    libelle: str
    ordre_affichage: int
    visible: bool
    couleur_fond: str | None
    couleur_texte: str | None
    police: str | None
    taille_police: int | None
    gras: bool
    position_libelle: PositionLibelleBloc
    position_total: PositionTotalBloc


class EtatBlocRubriqueIn(BaseModel):
    rubrique_paie_code: str
    ordre_affichage: int = 0


class EtatBlocRubriqueOut(BaseModel):
    rubrique_paie_code: str
    libelle: str | None
    ordre_affichage: int


class EtatBlocColonneTotalIn(BaseModel):
    code_colonne: str


class EtatBlocColonneTotalOut(BaseModel):
    code_colonne: str
    libelle: str


class EtatBlocDetail(EtatBlocOut):
    rubriques: list[EtatBlocRubriqueOut] = Field(default_factory=list)
    colonnes_total: list[EtatBlocColonneTotalOut] = Field(default_factory=list)


# -----------------------------------------------------------------------------
# ref_modele_etat (RG-ETAT-MODELE, migration 071)
# -----------------------------------------------------------------------------

class ModeleEtatOut(BaseModel):
    code: str
    libelle: str
    type_source_compatible: list[str]
    actif: bool


# -----------------------------------------------------------------------------
# etat_champ_selection
# -----------------------------------------------------------------------------

class EtatChampSelectionIn(BaseModel):
    champ_code: str
    visible: bool = True
    ordre_affichage: int = 0
    mode_donnee: ModeDonneeChamp = ModeDonneeChamp.PERIODE


class EtatChampSelectionOut(EtatChampSelectionIn):
    id: UUID
    etat_id: UUID


class ChampDisponible(BaseModel):
    """RG-ETAT-GEN-04 — un champ proposable dans le générateur pour une source donnée."""
    champ_code: str
    libelle: str
    mode_donnee_defaut: ModeDonneeChamp


# -----------------------------------------------------------------------------
# etat_definition
# -----------------------------------------------------------------------------

class EtatDefinitionCreate(BaseModel):
    code: str
    nom: str
    description: str | None = None
    societe_id: UUID | None = None
    type_source: str
    modele_code: str | None = None
    template_html: str | None = None
    pied_de_page_html: str | None = None
    afficher_logo: bool = True
    format_sortie: FormatSortieEtat = FormatSortieEtat.PDF
    visibilite: VisibiliteEtat = VisibiliteEtat.PRIVE


class EtatDefinitionUpdate(BaseModel):
    """Tous les champs optionnels — seuls ceux fournis sont mis à jour (PATCH)."""
    nom: str | None = None
    description: str | None = None
    modele_code: str | None = None
    template_html: str | None = None
    pied_de_page_html: str | None = None
    afficher_logo: bool | None = None
    format_sortie: FormatSortieEtat | None = None
    visibilite: VisibiliteEtat | None = None
    statut: StatutEtat | None = None


class EtatDefinitionOut(BaseModel):
    id: UUID
    code: str
    nom: str
    description: str | None
    societe_id: UUID | None
    type_source: str
    modele_code: str | None
    template_html: str | None
    pied_de_page_html: str | None
    afficher_logo: bool
    format_sortie: FormatSortieEtat
    statut: StatutEtat
    visibilite: VisibiliteEtat
    cree_par_user_id: UUID | None
    created_at: datetime
    updated_at: datetime


class EtatDefinitionDetail(EtatDefinitionOut):
    champs: list[EtatChampSelectionOut] = Field(default_factory=list)
    ecrans: list[str] = Field(default_factory=list)


# -----------------------------------------------------------------------------
# ecran_lancement / etat_ecran_association
# -----------------------------------------------------------------------------

class EcranLancementOut(BaseModel):
    code_ecran: str
    libelle: str
    contexte_disponible: list[str]
    chemin_route: str | None
    actif: bool


class EtatEcranAssociationIn(BaseModel):
    codes_ecran: list[str]



# -----------------------------------------------------------------------------
# Métadonnées (statut/visibilite/format_sortie) — restent des énumérations
# fixes côté code (workflow câblé, RG-ETAT-GEN-02/03 ; cf. note d'arbitrage
# dans etats.py), mais exposées via un seul endpoint pour que le frontend
# n'ait pas à dupliquer ses propres libellés en dur.
# -----------------------------------------------------------------------------

class OptionMetadonnee(BaseModel):
    code: str
    libelle: str


class EtatMetadonnees(BaseModel):
    statuts: list[OptionMetadonnee]
    visibilites: list[OptionMetadonnee]
    formats_sortie: list[OptionMetadonnee]
    modes_donnee: list[OptionMetadonnee]
