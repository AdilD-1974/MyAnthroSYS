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


class LigneRubrique(Strict):
    """Une rubrique du plan des lignes (RG-EDT-LIGNES-01)."""
    code: str = Field(min_length=1, max_length=40)
    libelle: Optional[str] = None             # libellé imprimé ; défaut : libellé d'édition de la rubrique
    style: Style = Style()                    # ex. gras pour « **** BRUT IMPOSABLE **** »
    valeurs: dict[str, Expr] = {}             # id de colonne → formule qui remplace celle de la colonne
    toujours: bool = False                    # imprimée même absente du bulletin ou à zéro


class Section(Strict):
    id: str = Field(min_length=1, max_length=60)
    titre: Optional[str] = None
    filtre: Optional[Expr] = None             # lignes retenues ; ignoré si `rubriques` est rempli
    rubriques: list[LigneRubrique] = []       # plan explicite : ces rubriques, dans cet ordre
    sous_total: bool = False


class Tableau(ElementBase):
    type: Literal["TABLEAU"]
    jeu: str = ""                             # jeu SECONDAIRE affiché (mode expert)…
    corps: Optional[str] = None               # …ou corps de données « lignes » (RG-EDT-DONNEES-01)
    corps_suivants: list[str] = []            # autres corps « lignes » imprimés à la suite, dans l'ordre
    entete: bool = True                       # ligne des titres de colonnes
    grouper: bool = True                      # corps : un titre par groupe d'affectations
    colonnes: list[Colonne] = Field(min_length=1)
    sections: list[Section] = []
    repeter_entete: bool = True
    zebre: bool = False
    hauteur_ligne: float = Field(default=5.0, gt=0)
    section_autres: Optional[str] = None      # avec des sections : titre des lignes restées hors section (None : masquées)
    quadrillage: Literal["AUCUN", "COLONNES", "COMPLET"] = "AUCUN"
    lignes_min: int = Field(default=0, ge=0, le=200)   # complète par des lignes vides (bulletin « formulaire »)


class ColonneGrille(Strict):
    id: str = Field(min_length=1, max_length=60)
    titre: str = ""
    largeur: float = Field(gt=0)
    affichage: Affichage = Affichage()
    style: Style = Style()


class LigneGrille(Strict):
    id: str = Field(min_length=1, max_length=60)
    titre: str = ""
    valeurs: dict[str, Expr] = {}             # id de colonne → formule
    style: Style = Style()


class Grille(ElementBase):
    """Zone libre de lignes × colonnes, chaque case étant une formule (cumuls,
    congés, mode de paiement…). RG-EDT-GRILLE-01."""
    type: Literal["GRILLE"]
    colonnes: list[ColonneGrille] = Field(min_length=1)
    lignes: list[LigneGrille] = Field(min_length=1)
    largeur_titres: float = Field(default=0, ge=0)   # colonne des titres de ligne (0 : aucune)
    entete: bool = True
    hauteur_ligne: float = Field(default=5.0, gt=0)
    quadrillage: Literal["AUCUN", "COLONNES", "COMPLET"] = "COMPLET"


Element = Annotated[Union[Texte, Champ, TexteRiche, Image, Ligne, Cadre, CodeBarre, Tableau, Grille],
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


# ---------------------------------------------------------------------------
# Données de l'état, définies AVANT la forme (lot 2 bis, Report Manager AGIRH)
# ---------------------------------------------------------------------------
CodeDonnee = Annotated[str, Field(pattern=r"^[a-z_][a-z0-9_]*$", max_length=40)]
ATTRIBUTS_AFFECTABLES = ("NB", "MT", "TX", "BASE", "PAT")


class ColonneCorps(Strict):
    code: CodeDonnee
    libelle: str
    sigle: Optional[str] = None
    type: Literal["MONTANT", "NOMBRE", "TAUX", "TEXTE", "DATE"] = "MONTANT"
    masque: Optional[str] = None
    total: bool = False


class LigneCorps(Strict):
    code: CodeDonnee
    libelle: str


class Affectation(Strict):
    """Une rubrique (ou une formule) et les colonnes qui reçoivent ses valeurs
    (onglet « Rubriques » du Report Manager). RG-EDT-DONNEES-02 à 05."""
    rubrique: Optional[str] = Field(default=None, max_length=40)
    formule: Optional[Expr] = None            # à la place d'une rubrique : cible « VAL »
    periode: Literal["MOIS", "CUMUL"] = "MOIS"
    cibles: dict[str, str] = {}               # NB|MT|TX|BASE|PAT|VAL → colonne (LIGNES) ou « ligne.colonne » (CASES)
    groupe: Optional[str] = None              # titre d'impression (corps LIGNES)
    libelle: Optional[str] = None
    negatif: bool = False                     # « en – » : soustraite (seule ou dans une ligne fusionnée)
    nulle: bool = False                       # « Nulls » : imprimée même à zéro (jamais sans aucune valeur)
    fusion: bool = False                      # s'ajoute à la ligne de l'affectation précédente (une seule ligne imprimée)
    gras: Optional[bool] = None               # défaut : gras pour une formule, normal pour une rubrique


class Corps(Strict):
    code: CodeDonnee
    libelle: str
    nature: Literal["LIGNES", "CASES"]
    colonnes: list[ColonneCorps] = Field(min_length=1)
    lignes: list[LigneCorps] = []             # CASES
    affectations: list[Affectation] = []
    tri: Literal["AFFECTATION", "PAIE", "CODE"] = "AFFECTATION"
    afficher_titre: bool = True               # titre du corps imprimé au-dessus de ses lignes sans groupe


class Variable(Strict):
    code: CodeDonnee
    libelle: str
    type: Literal["TEXTE", "NOMBRE", "MONTANT", "DATE", "BOOLEEN"] = "TEXTE"
    valeur: Expr


class Usages(Strict):
    confidentialite: int = Field(default=0, ge=0, le=5)
    formes_au_choix: bool = False             # « Autoriser choix Qrp »
    forme_par_defaut: Optional[str] = None    # code de la mise en forme imprimée sans choix (défaut : forme_code)
    nb_exemplaires: int = Field(default=1, ge=1, le=20)
    duplicata: bool = False
    interdire_copies: bool = False
    export_texte: bool = False
    nom_export: Optional[Expr] = None
    frequence: Optional[str] = None


class FormeAlternative(Strict):
    """Autre mise en forme des mêmes données (« Multiple modèle »)."""
    code: CodeDonnee
    libelle: str
    page: Page = Page()
    bandes: list[Bande] = Field(min_length=1)
    sortie: Sortie = Sortie()


class Definition(Strict):
    schema_version: Literal[1] = SCHEMA_VERSION
    # ---- données (le « quoi ») ----
    parametres: list[Parametre] = []
    jeux: list[Jeu] = Field(min_length=1)
    corps: list[Corps] = []
    variables: list[Variable] = []
    usages: Usages = Usages()
    # ---- mise en forme par défaut (le « comment ») ----
    forme_code: CodeDonnee = "standard"
    forme_libelle: str = "Mise en forme standard"
    page: Page = Page()
    bandes: list[Bande] = Field(min_length=1)
    sortie: Sortie = Sortie()
    formes: list[FormeAlternative] = []       # autres mises en forme des mêmes données

    def avec_forme(self, code: Optional[str]) -> "Definition":
        """La même définition avec la mise en forme `code` à la place de celle par défaut."""
        if not code or code == self.forme_code:
            return self
        f = next((x for x in self.formes if x.code == code), None)
        if f is None:
            raise ValueError(f"Mise en forme inconnue : {code}")
        return self.model_copy(update={"forme_code": f.code, "forme_libelle": f.libelle,
                                       "page": f.page, "bandes": f.bandes, "sortie": f.sortie})

    def corps_par_code(self, code: str) -> Optional[Corps]:
        return next((c for c in self.corps if c.code == code), None)

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
