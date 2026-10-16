"""
app/editions/definition.py — Structure d'une édition (le document JSON d'une version).
Auteur : Adil DAIA — lot 1 de la plateforme d'éditions unifiée (16/10/2026)

Une version de modèle = UN document `Definition`, stocké en JSONB dans
edt_modele_version.definition et validé ici à chaque enregistrement.
Toutes les dimensions sont en millimètres ; toutes les formules (Expr) suivent
le langage d'app/editions/expressions.py.

RG-EDT-VERSION-01 (Adil DAIA) : la forme canonique (clés triées, sans espaces)
sert à calculer l'empreinte SHA-256 posée à la publication.
RG-EDT-FORME-03 (Adil DAIA) : chaque bande, élément, colonne et section porte un
`id` stable, jamais réattribué ; les variantes de forme s'y accrochent.
"""
from __future__ import annotations

import hashlib
import json
from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field

Expr = str
Verrou = Literal["AUCUN", "FORME", "TOTAL"]

FORMATS_PAGE_MM = {"A4": (210.0, 297.0), "A3": (297.0, 420.0), "A5": (148.0, 210.0), "LETTRE": (215.9, 279.4)}
SCHEMA_VERSION = 1


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ---------------------------------------------------------------------------
# Données : paramètres et jeux
# ---------------------------------------------------------------------------
class Parametre(Strict):
    code: str = Field(pattern=r"^[a-z_][a-z0-9_]*$")
    libelle: str
    type: Literal["PERIODE", "COLLABORATEUR", "ORGANISATION", "PLAN_PAIE", "DATE", "ANNEE",
                  "TEXTE", "NOMBRE", "BOOLEEN", "LISTE"]
    obligatoire: bool = True
    multiple: bool = False
    defaut: Optional[Expr] = None
    valeurs: Optional[list[str]] = None


class Calcul(Strict):
    code: str = Field(pattern=r"^[a-z_][a-z0-9_]*$")
    expression: Expr


class Tri(Strict):
    champ: str
    sens: Literal["ASC", "DESC"] = "ASC"


class Jeu(Strict):
    code: str = Field(pattern=r"^[a-z_][a-z0-9_]*$")
    source: str
    role: Literal["PRINCIPAL", "SECONDAIRE"]
    parent: Optional[str] = None
    relation: Optional[str] = None
    champs: list[str] = []
    filtres: list[Expr] = []
    calculs: list[Calcul] = []
    tri: list[Tri] = []
    groupes: list[str] = []
    a_date: Optional[Expr] = None


# ---------------------------------------------------------------------------
# Présentation : style, affichage, éléments
# ---------------------------------------------------------------------------
class Style(Strict):
    police: Optional[str] = None
    taille: Optional[float] = Field(default=None, gt=0, le=200)
    gras: Optional[bool] = None
    italique: Optional[bool] = None
    souligne: Optional[bool] = None
    couleur: Optional[str] = None
    fond: Optional[str] = None
    alignement: Optional[Literal["GAUCHE", "CENTRE", "DROITE", "JUSTIFIE"]] = None
    alignement_vertical: Optional[Literal["HAUT", "MILIEU", "BAS"]] = None
    bordures: Optional[str] = None
    epaisseur_bordure: Optional[float] = Field(default=None, ge=0, le=5)
    rotation: Literal[0, 90, 180, 270] = 0
    langue: Literal["FR", "AR", "AUTO"] = "AUTO"


class Condition(Strict):
    expression: Expr
    sinon: Literal["VIDE", "MASQUER"] = "MASQUER"


class Affichage(Strict):
    masque: Optional[str] = None
    texte_avant: Optional[str] = None
    texte_apres: Optional[str] = None
    valeur_si_vide: Optional[str] = None


class ElementBase(Strict):
    id: str = Field(min_length=1, max_length=60)
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    l: float = Field(gt=0)
    h: float = Field(gt=0)
    style: Style = Style()
    condition: Optional[Condition] = None
    verrou: Verrou = "AUCUN"
    extensible: bool = False
    calque: int = 0


class Texte(ElementBase):
    type: Literal["TEXTE"]
    valeur: Expr
    affichage: Affichage = Affichage()


class Champ(ElementBase):
    type: Literal["CHAMP"]
    valeur: Expr
    affichage: Affichage = Affichage()


class TexteRiche(ElementBase):
    type: Literal["TEXTE_RICHE"]
    contenu: str          # texte à variables {expression} ; mise en forme riche au lot 2


class Image(ElementBase):
    type: Literal["IMAGE"]
    valeur: Expr
    ajustement: Literal["CONTENIR", "REMPLIR", "ETIRER"] = "CONTENIR"


class Ligne(ElementBase):
    type: Literal["LIGNE"]


class Cadre(ElementBase):
    type: Literal["CADRE"]
    arrondi: float = Field(default=0, ge=0)


class CodeBarre(ElementBase):
    type: Literal["CODE_BARRE"]
    valeur: Expr
    symbologie: Literal["QR", "CODE128"] = "QR"


class Colonne(Strict):
    id: str = Field(min_length=1, max_length=60)
    titre: str
    largeur: float = Field(gt=0)
    valeur: Expr
    affichage: Affichage = Affichage()
    total: Literal["AUCUN", "SOMME", "NB", "MOYENNE"] = "AUCUN"
    style: Style = Style()
    masquee: bool = False


class Section(Strict):
    id: str = Field(min_length=1, max_length=60)
    titre: Optional[str] = None
    filtre: Expr
    sous_total: bool = False


class Tableau(ElementBase):
    type: Literal["TABLEAU"]
    jeu: str
    colonnes: list[Colonne] = Field(min_length=1)
    sections: list[Section] = []
    repeter_entete: bool = True
    zebre: bool = False
    hauteur_ligne: float = Field(default=5.0, gt=0)


Element = Annotated[Union[Texte, Champ, TexteRiche, Image, Ligne, Cadre, CodeBarre, Tableau],
                    Field(discriminator="type")]
ELEMENTS_DE_PRESENTATION = ("TEXTE", "IMAGE", "LIGNE", "CADRE")


class Bande(Strict):
    id: str = Field(min_length=1, max_length=60)
    type: Literal["EN_TETE_ETAT", "EN_TETE_PAGE", "EN_TETE_GROUPE", "CORPS",
                  "PIED_GROUPE", "PIED_PAGE", "PIED_ETAT", "FOND"]
    niveau_groupe: Optional[int] = Field(default=None, ge=1)
    hauteur: float = Field(ge=0)
    extensible: bool = False
    insecable: bool = False
    saut_avant: bool = False
    saut_apres: bool = False
    condition: Optional[Expr] = None
    elements: list[Element] = []


class Page(Strict):
    format: Literal["A4", "A3", "A5", "LETTRE"] = "A4"
    orientation: Literal["PORTRAIT", "PAYSAGE"] = "PORTRAIT"
    marges: tuple[float, float, float, float] = (15, 15, 15, 15)   # haut, droite, bas, gauche
    charte: str = "SOCIETE"
    filigrane: Optional[Expr] = None

    def dimensions(self) -> tuple[float, float]:
        l, h = FORMATS_PAGE_MM[self.format]
        return (h, l) if self.orientation == "PAYSAGE" else (l, h)

    def largeur_utile(self) -> float:
        return self.dimensions()[0] - self.marges[1] - self.marges[3]

    def hauteur_utile(self) -> float:
        return self.dimensions()[1] - self.marges[0] - self.marges[2]


class Sortie(Strict):
    formats: list[Literal["PDF", "XLSX", "DOCX", "CSV", "HTML"]] = ["PDF"]
    nom_fichier: Expr = '"edition"'
    eclatement: Optional[str] = None
    qr_verification: bool = False


class Definition(Strict):
    schema_version: Literal[1] = SCHEMA_VERSION
    parametres: list[Parametre] = []
    jeux: list[Jeu] = Field(min_length=1)
    page: Page = Page()
    bandes: list[Bande] = Field(min_length=1)
    sortie: Sortie = Sortie()

    def json_canonique(self) -> str:
        return json.dumps(self.model_dump(mode="json"), sort_keys=True, separators=(",", ":"),
                          ensure_ascii=False)

    def empreinte(self) -> str:
        return hashlib.sha256(self.json_canonique().encode("utf-8")).hexdigest()

    def jeu(self, code: str) -> Optional[Jeu]:
        return next((j for j in self.jeux if j.code == code), None)

    def jeu_principal(self) -> Optional[Jeu]:
        return next((j for j in self.jeux if j.role == "PRINCIPAL"), None)


def mettre_a_niveau(brut: dict) -> dict:
    """Convertit une définition d'une ancienne schema_version vers l'actuelle.
    Une seule version existe aujourd'hui : point d'extension pour les suivantes."""
    version = brut.get("schema_version", 1)
    if version > SCHEMA_VERSION:
        raise ValueError(f"schema_version {version} plus récente que ce serveur ({SCHEMA_VERSION})")
    return brut
