"""
app/editions/format.py — Mise en forme des valeurs imprimées.
Auteur : Adil DAIA — lot 1 de la plateforme d'éditions unifiée (16/10/2026)

Un seul endroit formate pour toute la plateforme (aperçu, PDF, Excel, DOCX) :
les écrans ne formatent plus rien. Reprend et généralise les règles du journal
en grille (RG-GRILLE-HABILLAGE/FORMAT/VIDE/MASQUE-01), renommées RG-EDT-FORMAT-*.

Un masque est un dictionnaire de paramètres, pas une fonction codée en dur :
    {"type": "NOMBRE", "decimales": 2, "sep_milliers": " ", "sep_decimal": ",",
     "vide_si_zero": False, "zeros_inutiles": True, "prefixe": "", "suffixe": ""}
    (zeros_inutiles=False : 26,00 → « 26 », 21,50 → « 21,5 »)
    {"type": "DATE", "format": "JJ/MM/AAAA" | "LONGUE" | "MOIS_ANNEE"}
    {"type": "TEXTE", "casse": "MAJUSCULES" | "MINUSCULES" | "TITRE"}
MASQUES_STANDARD reprend les 7 masques de la grille avec un rendu identique ;
la table edt_masque (lot 1) ajoutera les masques propres à chaque société,
passés à ces fonctions par l'argument `registre`.

Règles :
    RG-EDT-FORMAT-01  calculé côté serveur ; ce qui s'affiche est ce qui s'imprime.
    RG-EDT-FORMAT-02  sans masque : montant → « 1 234,56 », entier → « 2026 »,
                      date → « 06/10/1974 », booléen → « Oui » / « Non ».
    RG-EDT-FORMAT-03  vide : None → « - », "" → rien, sinon le texte choisi ;
                      textes avant/après jamais ajoutés à une valeur vide.
    RG-EDT-FORMAT-04  masque inconnu ou inapplicable → valeur brute, sans erreur ;
                      un masque qui efface la valeur (zéro masqué) applique
                      valeur_si_vide si elle est définie, sinon rien.
    RG-EDT-FORMAT-07  arrondi commercial (la moitié monte) en Decimal, jamais
                      l'arrondi au pair des flottants.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Mapping, Optional

MOIS_LONGS = ("", "janvier", "février", "mars", "avril", "mai", "juin", "juillet",
              "août", "septembre", "octobre", "novembre", "décembre")

MASQUES_STANDARD: dict[str, dict] = {
    "DATE_FR": {"libelle": "Date JJ/MM/AAAA", "type": "DATE", "format": "JJ/MM/AAAA"},
    "DATE_LONGUE": {"libelle": "Date longue", "type": "DATE", "format": "LONGUE"},
    "MOIS_ANNEE": {"libelle": "Mois et année", "type": "DATE", "format": "MOIS_ANNEE"},
    "MONTANT": {"libelle": "Montant 1 234,56", "type": "NOMBRE", "decimales": 2},
    "MONTANT_SANS_ZERO": {"libelle": "Montant, vide si zéro", "type": "NOMBRE", "decimales": 2,
                          "vide_si_zero": True},
    "ENTIER": {"libelle": "Entier arrondi", "type": "NOMBRE", "decimales": 0},
    "POURCENTAGE": {"libelle": "Pourcentage", "type": "NOMBRE", "decimales": 2, "suffixe": " %"},
    "TAUX": {"libelle": "Taux à 4 décimales", "type": "NOMBRE", "decimales": 4},
    "QUANTITE": {"libelle": "Quantité (26 · 21,5), vide si zéro", "type": "NOMBRE", "decimales": 2,
                 "zeros_inutiles": False, "vide_si_zero": True},
    "MAJUSCULES": {"libelle": "Texte en capitales", "type": "TEXTE", "casse": "MAJUSCULES"},
}


# ---------------------------------------------------------------------------
# Conversions tolérantes
# ---------------------------------------------------------------------------
def en_decimal(v: Any) -> Optional[Decimal]:
    if isinstance(v, bool):
        return None
    if isinstance(v, Decimal):
        return v
    if isinstance(v, int):
        return Decimal(v)
    if isinstance(v, float):
        return Decimal(str(v))
    if isinstance(v, str):
        s = v.strip().replace(" ", "").replace(" ", "")
        if not s:
            return None
        if "," in s and "." in s:          # 1.234,56 → 1234.56
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", ".")
        try:
            return Decimal(s)
        except InvalidOperation:
            return None
    return None


def en_date(v: Any) -> Optional[date]:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, str):
        try:
            return date.fromisoformat(v.strip()[:10])
        except ValueError:
            return None
    return None


def _est_vide(v: Any) -> bool:
    return v is None or (isinstance(v, str) and v.strip() == "")


# ---------------------------------------------------------------------------
# Rendus élémentaires
# ---------------------------------------------------------------------------
def nombre(n: Decimal, decimales: int = 2, sep_milliers: str = " ", sep_decimal: str = ",") -> str:
    """RG-EDT-FORMAT-07 : 1234.5 → « 1 234,50 » ; 1234.5 à 0 décimale → « 1 235 »."""
    q = Decimal(1).scaleb(-decimales)
    n = n.quantize(q, rounding=ROUND_HALF_UP)
    signe = "-" if n < 0 else ""
    entier, _, frac = f"{abs(n):f}".partition(".")
    groupes = []
    while len(entier) > 3:
        groupes.insert(0, entier[-3:])
        entier = entier[:-3]
    groupes.insert(0, entier)
    texte = sep_milliers.join(groupes)
    if decimales > 0:
        texte += sep_decimal + frac.ljust(decimales, "0")[:decimales]
    return signe + texte


def date_texte(d: date, forme: str = "JJ/MM/AAAA") -> str:
    if forme == "LONGUE":
        jour = "1er" if d.day == 1 else str(d.day)
        return f"{jour} {MOIS_LONGS[d.month]} {d.year}"
    if forme == "MOIS_ANNEE":
        return f"{MOIS_LONGS[d.month]} {d.year}"
    return d.strftime("%d/%m/%Y")


def texte_par_defaut(v: Any) -> str:
    """RG-EDT-FORMAT-02 : rendu d'une valeur sans masque."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "Oui" if v else "Non"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, (Decimal, float)):
        d = en_decimal(v)
        return nombre(d, 2) if d is not None else str(v)
    if isinstance(v, (date, datetime)):
        return date_texte(en_date(v))
    return str(v)


# ---------------------------------------------------------------------------
# Masques
# ---------------------------------------------------------------------------
def _definition(masque: Any, registre: Optional[Mapping[str, dict]]) -> Optional[dict]:
    if masque is None or masque == "":
        return None
    if isinstance(masque, dict):
        return masque
    code = str(masque).strip().upper()
    if registre and code in registre:
        return registre[code]
    return MASQUES_STANDARD.get(code)


def appliquer_masque(valeur: Any, masque: Any, registre: Optional[Mapping[str, dict]] = None) -> str:
    """Valeur brute → texte selon le masque. RG-EDT-FORMAT-04 : masque inconnu ou
    valeur inconvertible → rendu par défaut, jamais d'erreur."""
    if _est_vide(valeur):
        return ""
    d = _definition(masque, registre)
    if d is None:
        return texte_par_defaut(valeur)
    genre = d.get("type")
    if genre == "NOMBRE":
        n = en_decimal(valeur)
        if n is None:
            return texte_par_defaut(valeur)
        if d.get("vide_si_zero") and n == 0:
            return ""
        texte = nombre(n, int(d.get("decimales", 2)), d.get("sep_milliers", " "), d.get("sep_decimal", ","))
        if d.get("zeros_inutiles") is False and d.get("sep_decimal", ",") in texte:
            texte = texte.rstrip("0").rstrip(d.get("sep_decimal", ","))
        return f"{d.get('prefixe', '')}{texte}{d.get('suffixe', '')}"
    if genre == "DATE":
        dt = en_date(valeur)
        return date_texte(dt, d.get("format", "JJ/MM/AAAA")) if dt else texte_par_defaut(valeur)
    if genre == "TEXTE":
        t = texte_par_defaut(valeur)
        casse = d.get("casse")
        if casse == "MAJUSCULES":
            return t.upper()
        if casse == "MINUSCULES":
            return t.lower()
        if casse == "TITRE":
            return t.title()
        return t
    return texte_par_defaut(valeur)


def formater(valeur: Any, masque: Any = None, texte_avant: Optional[str] = None,
             texte_apres: Optional[str] = None, valeur_si_vide: Optional[str] = None,
             registre: Optional[Mapping[str, dict]] = None) -> str:
    """Rendu complet d'un élément : vide, masque, textes avant et après
    (RG-EDT-FORMAT-02/03/04, mêmes résultats que _formater_case de la grille)."""
    if _est_vide(valeur):
        return "-" if valeur_si_vide is None else valeur_si_vide
    texte = appliquer_masque(valeur, masque, registre)
    if texte == "":
        return valeur_si_vide or ""
    return f"{texte_avant or ''}{texte}{texte_apres or ''}"


def liste_masques(registre: Optional[Mapping[str, dict]] = None) -> list[dict]:
    """Masques disponibles avec un exemple rendu (pour le designer)."""
    exemples = {"NOMBRE": Decimal("1234.5"), "DATE": date(1974, 10, 6), "TEXTE": "Direction Générale"}
    tous = {**MASQUES_STANDARD, **(registre or {})}
    return [
        {"code": code, "libelle": d.get("libelle", code), "type": d.get("type"),
         "exemple": appliquer_masque(exemples.get(d.get("type"), "abc"), d)}
        for code, d in tous.items()
    ]
