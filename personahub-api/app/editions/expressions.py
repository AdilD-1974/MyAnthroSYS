"""
app/editions/expressions.py — Langage de formules des éditions.
Auteur : Adil DAIA — lot 1 de la plateforme d'éditions unifiée (16/10/2026)

Le langage est CELUI DES RÈGLES DE PAIE (app/services/regle_dsl.py), étendu
pour les éditions. regle_dsl.py n'est PAS modifié : ce module réutilise son
analyseur et son évaluateur par héritage, et copie son registre de fonctions
avant d'y ajouter les siennes. Une règle de paie s'écrit et se calcule donc
exactement comme avant.

Syntaxe héritée de la paie :
    nombres 12 · 3.5          chaînes "CDI"            VRAI · FAUX
    + - * / % -%  ( )          = <> < > <= >=           ET · OU · NON
    [CODE].MT/NB/TX/BASE       #CONSTANTE               FONCTION(a, b)

Ajouts des éditions :
    montant · identite.nom     champ de la ligne courante (nom simple ou chemin)
    regimes.CNSS.date_affiliation   (une liste se parcourt par son « code »)
    @periode · @periode.date_fin    paramètre de lancement et son attribut
    [CODE].PAT                 part patronale d'une rubrique
    [CODE].CMT / CNB / CBASE   cumul annuel à date (montant, nombre, base) — table cumul
    VIDE                       valeur vide (≠ 0)
    « "" » dans une chaîne     guillemet doublé = un guillemet

Règles de gestion :
    RG-EDT-FORMULE-01  analysée et vérifiée à la saisie, jamais eval().
    RG-EDT-FORMULE-02  budget d'opérations par évaluation : un dépassement
                       est une erreur explicite, jamais un blocage.
    RG-EDT-FORMULE-03  champ, paramètre, rubrique ou constante absents → VIDE
                       (jamais une exception au rendu) ; signalé au resolver.
    RG-EDT-FORMULE-04  VIDE se propage dans les calculs (VIDE + 1 = VIDE) et
                       compte pour une chaîne vide dans une concaténation.
    RG-EDT-FORMULE-05  SI, ET, OU évaluent leurs arguments à la demande ;
                       SI sans « sinon » donne VIDE (et non 0 comme en paie).
    RG-EDT-FORMULE-06  SOMME et MOYENNE gardent leur sens paie (n périodes
                       précédentes) ; les agrégats d'édition s'appellent
                       TOTAL, MOYENNE_SUR, NB, MIN_SUR, MAX_SUR.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from functools import lru_cache
from typing import Any, Callable, Iterable, Optional

from app.services import regle_dsl as dsl
from app.editions import format as fmt

VIDE = None
BUDGET_PAR_DEFAUT = 10_000
ATTRIBUTS_RUBRIQUE = ("MT", "NB", "TX", "BASE", "PAT", "CMT", "CNB", "CBASE")
PORTEES = ("GROUPE", "PAGE", "REPORT", "ETAT")


# =====================================================================
# Erreurs
# =====================================================================
class ErreurFormule(Exception):
    """Erreur de syntaxe ou de calcul, avec sa position dans la formule."""

    def __init__(self, message: str, debut: Optional[int] = None, fin: Optional[int] = None):
        super().__init__(message)
        self.message = message
        self.debut = debut
        self.fin = fin

    def en_dict(self) -> dict:
        return {"message": self.message, "debut": self.debut, "fin": self.fin}


class ErreurBudget(ErreurFormule):
    pass


# =====================================================================
# 1) Découpage en jetons — ordre des alternatives = priorité
# =====================================================================
_TOKEN_RE = re.compile(r"""
    (?P<space>\s+)
  | (?P<number>\d+(?:\.\d+)?)
  | (?P<string>"(?:[^"]|"")*")
  | (?P<rubrique>\[[A-Za-z0-9_]+\])
  | (?P<constante>\#[A-Za-z0-9_]+)
  | (?P<param>@[A-Za-z_][A-Za-z0-9_]*)
  | (?P<chemin>[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+)
  | (?P<op><=|>=|<>|!=|==|-%|<|>|=|\+|\-|\*|/|%|\(|\)|,|\.)
  | (?P<ident>[A-Za-z_][A-Za-z0-9_]*)
""", re.VERBOSE)


def _decouper(src: str) -> tuple[list[tuple[str, str]], list[tuple[int, int]]]:
    """Jetons au format attendu par regle_dsl._Parser (genre, valeur), plus leurs
    positions dans une liste parallèle (pour situer les erreurs)."""
    jetons: list[tuple[str, str]] = []
    positions: list[tuple[int, int]] = []
    pos = 0
    while pos < len(src):
        m = _TOKEN_RE.match(src, pos)
        if not m:
            raise ErreurFormule(f"Caractère inattendu : {src[pos]!r}", pos, pos + 1)
        if m.lastgroup != "space":
            jetons.append((m.lastgroup, m.group()))
            positions.append((m.start(), m.end()))
        pos = m.end()
    jetons.append(("eof", ""))
    positions.append((len(src), len(src)))
    return jetons, positions


# =====================================================================
# 2) Analyse : extension du parseur de la paie
# =====================================================================
# Nœuds ajoutés à l'AST de regle_dsl :
#   ("champ", "identite.nom") · ("param", "periode", "date_fin" | None) · ("vide",)
class _ParserEdition(dsl._Parser):

    def parse_primary(self):
        genre, val = self.peek()
        if genre == "string":
            self.next()
            return ("str", val[1:-1].replace('""', '"'))
        if genre == "chemin":
            self.next()
            return ("champ", val)
        if genre == "param":
            self.next()
            attr = None
            if self.peek()[1] == ".":
                self.next()
                g2, v2 = self.next()
                if g2 != "ident":
                    raise dsl.DslError(f"Attribut attendu après « {val}. », trouvé {v2!r}")
                attr = v2
            return ("param", val[1:], attr)
        if genre == "rubrique":
            self.next()
            code = val[1:-1].upper()
            attr = "MT"
            if self.peek()[1] == ".":
                self.next()
                attr = self.next()[1].upper()
                if attr not in ATTRIBUTS_RUBRIQUE:
                    raise dsl.DslError(
                        f"Attribut de rubrique inconnu « {attr} » (attendu : {', '.join(ATTRIBUTS_RUBRIQUE)})"
                    )
            return ("rub", code, attr)
        if genre == "ident" and self.toks[self.i + 1][1] != "(":
            mot = val.upper()
            if mot == "VIDE":
                self.next()
                return ("vide",)
            if mot not in ("VRAI", "FAUX"):
                # Identifiant simple = champ de la ligne courante (montant, sens…).
                # En paie, ce serait un registre (MT, R01…) : sans objet en édition.
                self.next()
                return ("champ", val)
        return super().parse_primary()


@lru_cache(maxsize=4096)
def compiler(src: str):
    """Formule → arbre syntaxique, mis en cache (une formule publiée est compilée
    une seule fois). Lève ErreurFormule avec la position du jeton fautif."""
    if src is None or not str(src).strip():
        raise ErreurFormule("Formule vide", 0, 0)
    jetons, positions = _decouper(src)
    parseur = _ParserEdition(jetons)
    try:
        return parseur.parse()
    except dsl.DslError as e:
        i = min(parseur.i, len(positions) - 1)
        # le parseur a souvent déjà consommé le jeton fautif
        j = max(i - 1, 0) if jetons[i][0] == "eof" and i > 0 else i
        debut, fin = positions[j]
        raise ErreurFormule(str(e), debut, fin) from None
    except IndexError:
        raise ErreurFormule("Formule incomplète", len(src), len(src)) from None


# =====================================================================
# 3) Resolver des éditions : d'où viennent les valeurs
# =====================================================================
def _code_element(x: Any) -> Optional[str]:
    """Code d'un élément de liste : clé « code », sinon la première clé « code_… »
    (le snapshot range les régimes sous « code_regime »)."""
    if not isinstance(x, dict):
        return None
    if x.get("code") is not None:
        return str(x["code"]).upper()
    for k, v in x.items():
        if k.startswith("code_") and v is not None:
            return str(v).upper()
    return None


class ResolverEdition:
    """
    Fournit les valeurs à l'évaluateur. Implémente le Protocol Resolver de
    regle_dsl (attribut, constante, cumul…) et ajoute champ, parametre,
    agregat et contexte. Les fournisseurs de données et la mise en page
    peuplent ses dictionnaires ; tout ce qui manque vaut VIDE et est noté
    dans `manques` (RG-EDT-FORMULE-03).
    """

    def __init__(
        self,
        ligne: Optional[dict] = None,
        parametres: Optional[dict] = None,
        rubriques: Optional[dict] = None,
        constantes: Optional[dict] = None,
        agregats: Optional[dict] = None,
        contexte: Optional[dict] = None,
        date_jour: Optional[date] = None,
        date_paie: Optional[date] = None,
    ):
        self.ligne = ligne or {}
        self.parametres = parametres or {}
        self.rubriques = rubriques or {}       # {"SALBASE": {"MT": Decimal, "NB": …}}
        self.constantes = constantes or {}     # {"CNSS_TAUX_SALARIAL": Decimal}
        self.agregats = agregats or {}         # {(fonction, cle, portee): valeur}
        self.contexte_valeurs = contexte or {}  # {"PAGE": 1, "NB_PAGES": 3, "CHARTE.logo": …}
        self._date_jour = date_jour
        self._date_paie = date_paie
        self.manques: list[str] = []

    # ---- ajouts éditions ----
    def champ(self, chemin: str) -> Any:
        if chemin in self.ligne:                       # ligne déjà aplatie
            return self.ligne[chemin]
        courant: Any = self.ligne
        for partie in chemin.split("."):
            if isinstance(courant, dict) and partie in courant:
                courant = courant[partie]
            elif isinstance(courant, list):            # ex. regimes.CNSS.* : liste d'objets à « code »
                courant = next((x for x in courant if _code_element(x) == partie.upper()), None)
                if courant is None:
                    self.manquant(f"champ {chemin}")
                    return VIDE
            else:
                self.manquant(f"champ {chemin}")
                return VIDE
        return courant

    def parametre(self, nom: str, attr: Optional[str] = None) -> Any:
        if nom not in self.parametres:
            self.manquant(f"paramètre @{nom}")
            return VIDE
        valeur = self.parametres[nom]
        if attr is None:
            return valeur
        if isinstance(valeur, dict):
            if attr in valeur:
                return valeur[attr]
        elif hasattr(valeur, attr):
            return getattr(valeur, attr)
        self.manquant(f"paramètre @{nom}.{attr}")
        return VIDE

    def agregat(self, fonction: str, cle: str, portee: str) -> Any:
        if (fonction, cle, portee) in self.agregats:
            return self.agregats[(fonction, cle, portee)]
        self.manquant(f"agrégat {fonction}({cle}, {portee})")
        return VIDE

    def contexte(self, nom: str) -> Any:
        if nom in self.contexte_valeurs:
            return self.contexte_valeurs[nom]
        self.manquant(f"contexte {nom}")
        return VIDE

    # ---- Protocol Resolver de regle_dsl ----
    def attribut(self, code_rubrique: str, attribut: str) -> Any:
        valeurs = self.rubriques.get(code_rubrique)
        if valeurs is None:
            return VIDE                     # rubrique absente du bulletin : normal, pas un manque
        return valeurs.get(attribut, VIDE)

    def constante(self, code: str) -> Any:
        if code in self.constantes:
            return self.constantes[code]
        self.manquant(f"constante #{code}")
        return VIDE

    def cumul(self, code_rubrique: str, attribut: str = "MT", portee: str = "ANNEE") -> Any:
        return self.agregat("CUMUL", f"{code_rubrique}.{attribut}", portee)

    def precedent(self, code_rubrique: str, n: int = 1, attribut: str = "MT") -> Any:
        self.manquant(f"PREC({code_rubrique}) : non fourni par la source")
        return VIDE

    def somme(self, code_rubrique: str, n: int, attribut: str = "MT") -> Any:
        self.manquant(f"SOMME({code_rubrique}) : non fourni par la source")
        return VIDE

    def moyenne(self, code_rubrique: str, n: int, attribut: str = "MT") -> Any:
        self.manquant(f"MOYENNE({code_rubrique}) : non fourni par la source")
        return VIDE

    def bareme(self, code: str, cle: Any) -> Any:
        self.manquant(f"BAREME({code}) : non fourni par la source")
        return VIDE

    def bareme_sortie(self, code: str, cle: Any, sortie: str) -> Any:
        return self.bareme(code, cle)

    def date_jour(self) -> date:
        return self._date_jour or date.today()

    def date_paie(self) -> date:
        return self._date_paie or self.date_jour()

    def manquant(self, quoi: str) -> None:
        if quoi not in self.manques:
            self.manques.append(quoi)


# =====================================================================
# 4) Fonctions des éditions
# =====================================================================
def _est_vide(v: Any) -> bool:
    return v is None or (isinstance(v, str) and v == "")


def _txt(v: Any) -> str:
    return "" if v is None else dsl._txt(v)


def _ent(v: Any, defaut: int = 0) -> int:
    return defaut if _est_vide(v) else int(dsl._to_dec(v))


_MOTS_DEVISE = {
    "FR": ("dirham", "dirhams", "centime", "centimes", "et"),
    "AR": ("درهم", "درهم", "سنتيم", "سنتيم", "و"),
}


def montant_en_lettres(valeur: Any, langue: str = "FR") -> str:
    """1234.5 → « mille deux cent trente-quatre dirhams et cinquante centimes ».
    Orthographe traditionnelle fournie par num2words (« quatre-vingt-un »).
    Unités : dirham(s) et centime(s) ; en arabe, درهم et سنتيم."""
    if _est_vide(valeur):
        return ""
    from num2words import num2words  # dépendance déjà installée (bulletin_pdf.py)

    langue = (langue or "FR").upper()
    code = {"FR": "fr", "AR": "ar"}.get(langue)
    if code is None:
        raise ErreurFormule(f"Langue non prise en charge pour MONTANT_EN_LETTRES : {langue}")
    m = abs(dsl._to_dec(valeur)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    entier, centimes = int(m), int((m - int(m)) * 100)
    u1, un, c1, cn, et = _MOTS_DEVISE[langue]
    texte = f"{num2words(entier, lang=code)} {u1 if entier <= 1 else un}"
    if centimes:
        texte += f" {et} {num2words(centimes, lang=code)} {c1 if centimes <= 1 else cn}"
    if dsl._to_dec(valeur) < 0:
        texte = ("moins " if langue == "FR" else "سالب ") + texte
    return texte


FONCTIONS: dict[str, Callable[[list, ResolverEdition], Any]] = dict(dsl.FONCTIONS)


def _f(nom: str):
    def deco(fn):
        FONCTIONS[nom] = fn
        return fn
    return deco


# ---- Texte ----
_f("MAJUSCULE")(lambda a, r: _txt(a[0]).upper())
_f("MINUSCULE")(lambda a, r: _txt(a[0]).lower())
_f("GAUCHE")(lambda a, r: _txt(a[0])[: _ent(a[1] if len(a) > 1 else 1, 1)])
_f("DROITE")(lambda a, r: (lambda t, n: t[-n:] if n > 0 else "")(_txt(a[0]), _ent(a[1] if len(a) > 1 else 1, 1)))
_f("REMPLACER")(lambda a, r: _txt(a[0]).replace(_txt(a[1]), _txt(a[2])))
_f("SUPPRESPACE")(lambda a, r: " ".join(_txt(a[0]).split()))
_f("CONTIENT")(lambda a, r: _txt(a[1]).lower() in _txt(a[0]).lower())
_f("LONGUEUR")(lambda a, r: Decimal(len(_txt(a[0]))))
_f("SIVIDE")(lambda a, r: a[1] if _est_vide(a[0]) else a[0])

# ---- Conversion ----
_f("TEXTE")(lambda a, r: _txt(a[0]))
_f("NOMBRE")(lambda a, r: VIDE if _est_vide(a[0]) else dsl._to_dec(a[0]))
_f("FORMAT")(lambda a, r: fmt.appliquer_masque(a[0], _txt(a[1]) if len(a) > 1 else None))
_f("MONTANT_EN_LETTRES")(lambda a, r: montant_en_lettres(a[0], _txt(a[1]) if len(a) > 1 else "FR"))

# ---- Contexte de mise en page et charte ----
_f("PAGE")(lambda a, r: r.contexte("PAGE"))
_f("NB_PAGES")(lambda a, r: r.contexte("NB_PAGES"))
_f("CHARTE")(lambda a, r: r.contexte(f"CHARTE.{_txt(a[0])}"))
_f("ASSET")(lambda a, r: r.contexte(f"ASSET.{_txt(a[0]).upper()}"))
_f("UTILISATEUR")(lambda a, r: r.contexte(f"UTILISATEUR.{_txt(a[0]) if a else 'nom'}"))


# ---- Données de l'état (RG-EDT-DONNEES) ----
def _total_corps(a: list, r: "ResolverEdition") -> Any:
    """TOTAL_CORPS("corps", "colonne"[, "groupe ou ligne"]) : somme d'une colonne
    d'un corps — lignes du groupe (corps LIGNES) ou de la ligne (corps CASES)."""
    code, col = _txt(a[0]), _txt(a[1])
    filtre = _txt(a[2]) if len(a) > 2 and not _est_vide(a[2]) else None
    corps = (r.ligne.get("corps") or {}).get(code)
    if isinstance(corps, dict):
        lignes = [corps.get(filtre) or {}] if filtre else list(corps.values())
    elif isinstance(corps, list):
        lignes = [l for l in corps if filtre is None or l.get("groupe") == filtre]
    else:
        r.manquant(f"corps {code}")
        return VIDE
    total = Decimal(0)
    for l in lignes:
        v = l.get(col)
        if not _est_vide(v):
            try:
                total += dsl._to_dec(v)
            except Exception:
                pass
    return total


_f("TOTAL_CORPS")(_total_corps)


# Fonctions dont les arguments ne sont PAS évalués d'avance (RG-EDT-FORMULE-05)
# ou désignent une expression à agréger (RG-EDT-FORMULE-06).
AGREGATS = ("TOTAL", "MOYENNE_SUR", "NB", "MIN_SUR", "MAX_SUR")
PARESSEUSES = ("SI", "ET", "OU") + AGREGATS


def cle_expression(noeud) -> str:
    """Forme canonique d'un sous-arbre : clé stable d'un agrégat pour la mise en page."""
    return repr(noeud)


# =====================================================================
# 5) Évaluation
# =====================================================================
class EvaluateurEdition(dsl.Evaluator):

    def __init__(self, resolver: ResolverEdition, budget: int = BUDGET_PAR_DEFAUT):
        super().__init__(resolver, {})
        self.budget = budget

    def eval(self, node) -> Any:
        self.budget -= 1
        if self.budget < 0:
            raise ErreurBudget("Formule trop coûteuse : budget d'opérations dépassé")
        t = node[0]
        if t == "champ":
            return self.r.champ(node[1])
        if t == "param":
            return self.r.parametre(node[1], node[2])
        if t == "vide":
            return VIDE
        if t == "var":
            self.r.manquant(f"identifiant {node[1]}")
            return VIDE
        if t == "num":
            return node[1]
        if t == "unary":
            a = self.eval(node[2])
            if _est_vide(a):
                return VIDE
            return -dsl._to_dec(a) if node[1] == "-" else dsl._to_dec(a)
        if t == "bin":
            return self._arith(node[1], self.eval(node[2]), self.eval(node[3]))
        if t == "cmp":
            return self._compare(node[1], self.eval(node[2]), self.eval(node[3]))
        if t == "call":
            return self._appeler(node[1], node[2])
        return super().eval(node)   # str, rub, const, bool, not, call_attr

    # RG-EDT-FORMULE-04
    def _arith(self, op, a, b):
        if op == "+" and (isinstance(a, str) or isinstance(b, str)):
            return f"{_txt(a)}{_txt(b)}"
        if _est_vide(a) or _est_vide(b):
            return VIDE
        return super()._arith(op, a, b)

    def _compare(self, op, a, b):
        if _est_vide(a) or _est_vide(b):
            egaux = _est_vide(a) and _est_vide(b)
            if op in ("=", "=="):
                return egaux
            if op in ("<>", "!="):
                return not egaux
            return False
        return super()._compare(op, a, b)

    def _appeler(self, nom: str, args: list):
        if nom == "SI":
            if len(args) < 2:
                raise ErreurFormule("SI attend (condition, alors[, sinon])")
            if dsl._truthy(self.eval(args[0])):
                return self.eval(args[1])
            return self.eval(args[2]) if len(args) > 2 else VIDE
        if nom == "ET":
            return all(dsl._truthy(self.eval(a)) for a in args)
        if nom == "OU":
            return any(dsl._truthy(self.eval(a)) for a in args)
        if nom in AGREGATS:
            if not args:
                raise ErreurFormule(f"{nom} attend (expression[, portée])")
            portee = "GROUPE"
            if len(args) > 1:
                portee = args[1][1].upper() if args[1][0] == "champ" else _txt(self.eval(args[1])).upper()
            if portee not in PORTEES:
                raise ErreurFormule(f"Portée inconnue « {portee} » (attendu : {', '.join(PORTEES)})")
            return self.r.agregat(nom, cle_expression(args[0]), portee)
        fn = FONCTIONS.get(nom)
        if fn is None:
            raise ErreurFormule(f"Fonction inconnue : {nom}")
        valeurs = [self.eval(a) for a in args]
        try:
            return fn(valeurs, self.r)
        except ErreurFormule:
            raise
        except (IndexError, TypeError):
            raise ErreurFormule(f"Arguments incorrects pour {nom}") from None
        except (ArithmeticError, ValueError) as e:
            raise ErreurFormule(f"{nom} : {e}") from None


def evaluer(src_ou_arbre, resolver: ResolverEdition, budget: int = BUDGET_PAR_DEFAUT) -> Any:
    arbre = compiler(src_ou_arbre) if isinstance(src_ou_arbre, str) else src_ou_arbre
    try:
        return EvaluateurEdition(resolver, budget).eval(arbre)
    except ErreurFormule:
        raise
    except dsl.DslError as e:
        raise ErreurFormule(str(e)) from None


# =====================================================================
# 6) Analyse statique : références et contrôles (validation, dépendances)
# =====================================================================
@dataclass
class Analyse:
    champs: set[str] = field(default_factory=set)
    parametres: set[str] = field(default_factory=set)
    rubriques: set[str] = field(default_factory=set)
    constantes: set[str] = field(default_factory=set)
    fonctions: set[str] = field(default_factory=set)
    agregats: list[tuple[str, str, str]] = field(default_factory=list)
    erreurs: list[ErreurFormule] = field(default_factory=list)


def analyser(src: str, champs_connus: Optional[Iterable[str]] = None,
             parametres_connus: Optional[Iterable[str]] = None) -> Analyse:
    """Ce qu'une formule utilise, et ce qui ne va pas — sans l'évaluer."""
    resultat = Analyse()
    try:
        arbre = compiler(src)
    except ErreurFormule as e:
        resultat.erreurs.append(e)
        return resultat

    def visiter(n):
        t = n[0]
        if t == "champ":
            resultat.champs.add(n[1])
        elif t == "param":
            resultat.parametres.add(n[1])
        elif t == "rub":
            resultat.rubriques.add(n[1])
        elif t == "const":
            resultat.constantes.add(n[1])
        elif t == "var":
            resultat.erreurs.append(ErreurFormule(
                f"« {n[1]} » inconnu : un champ s'écrit source.champ (ex. identite.nom), "
                f"un paramètre @nom"))
        elif t in ("call", "call_attr"):
            nom = n[1]
            resultat.fonctions.add(nom)
            if nom not in FONCTIONS and nom not in PARESSEUSES:
                resultat.erreurs.append(ErreurFormule(f"Fonction inconnue : {nom}"))
            if nom in AGREGATS and n[2]:
                portee = n[2][1][1].upper() if len(n[2]) > 1 and n[2][1][0] in ("champ", "str") else "GROUPE"
                resultat.agregats.append((nom, cle_expression(n[2][0]), portee))
                visiter(n[2][0])
                return
            for a in n[2]:
                visiter(a)
        elif t in ("bin", "cmp", "bool"):
            visiter(n[2]); visiter(n[3])
        elif t in ("unary",):
            visiter(n[2])
        elif t == "not":
            visiter(n[1])

    visiter(arbre)
    if champs_connus is not None:
        connus = set(champs_connus)
        for c in sorted(resultat.champs - connus):
            resultat.erreurs.append(ErreurFormule(f"Champ inconnu : {c}"))
    if parametres_connus is not None:
        connus = set(parametres_connus)
        for p in sorted(resultat.parametres - connus):
            resultat.erreurs.append(ErreurFormule(f"Paramètre inconnu : @{p}"))
    return resultat


# =====================================================================
# 7) Texte à variables : « Né le {FORMAT(identite.date_naissance, "DATE_LONGUE")} »
# =====================================================================
def extraire_variables(texte: str) -> list[tuple[int, int, str]]:
    """Positions et sources des {expressions} d'un texte (accolades dans les
    chaînes ignorées). Une accolade non fermée lève ErreurFormule."""
    trouvees, i, n = [], 0, len(texte)
    while i < n:
        if texte[i] == "{":
            debut, j, profondeur, dans_chaine = i, i + 1, 1, False
            while j < n and profondeur:
                c = texte[j]
                if c == '"':
                    dans_chaine = not dans_chaine
                elif not dans_chaine:
                    profondeur += (c == "{") - (c == "}")
                j += 1
            if profondeur:
                raise ErreurFormule("Accolade « { » non fermée", debut, n)
            trouvees.append((debut, j, texte[debut + 1: j - 1]))
            i = j
        else:
            i += 1
    return trouvees


def interpoler(texte: str, resolver: ResolverEdition,
               formateur: Callable[[Any], str] = None) -> str:
    """Remplace chaque {expression} par sa valeur mise en forme (RG-GRILLE-VAR-01,
    généralisée : toute formule, pas seulement un champ)."""
    formateur = formateur or fmt.texte_par_defaut
    morceaux, dernier = [], 0
    for debut, fin, source in extraire_variables(texte):
        morceaux.append(texte[dernier:debut])
        valeur = evaluer(source, resolver)
        morceaux.append("" if _est_vide(valeur) else formateur(valeur))
        dernier = fin
    morceaux.append(texte[dernier:])
    return "".join(morceaux)


def catalogue() -> list[dict]:
    """Fonctions disponibles (assistant de formule du designer) : celles de la
    paie, documentées dans regle_dsl.CATALOGUE, plus celles des éditions."""
    paie = {f["nom"]: f for f in getattr(dsl, "CATALOGUE", [])}
    ajouts = {   # nom : (catégorie, signature, description, exemple)
        "MAJUSCULE": ("Texte", "MAJUSCULE(texte)", "Met en capitales", 'MAJUSCULE(identite.nom)'),
        "MINUSCULE": ("Texte", "MINUSCULE(texte)", "Met en minuscules", 'MINUSCULE(identite.prenom)'),
        "GAUCHE": ("Texte", "GAUCHE(texte, n)", "Les n premiers caractères", 'GAUCHE(identite.prenom, 1) + ". " + identite.nom'),
        "DROITE": ("Texte", "DROITE(texte, n)", "Les n derniers caractères", 'DROITE(paiement.numero_compte, 4)'),
        "REMPLACER": ("Texte", "REMPLACER(texte, cherché, remplaçant)", "Remplace un morceau de texte", 'REMPLACER(identite.cin, " ", "")'),
        "SUPPRESPACE": ("Texte", "SUPPRESPACE(texte)", "Retire les espaces en trop", 'SUPPRESPACE(adresse.adresse)'),
        "CONTIENT": ("Texte", "CONTIENT(texte, cherché)", "Vrai si le texte contient le morceau", 'CONTIENT(affectation.emploi_libelle, "Directeur")'),
        "LONGUEUR": ("Texte", "LONGUEUR(texte)", "Nombre de caractères", 'LONGUEUR(identite.cin)'),
        "SIVIDE": ("Logique", "SIVIDE(valeur, si_vide)", "Remplace une valeur absente (rubrique absente du bulletin…)", 'SIVIDE([PRIM_ANC].MT, 0)'),
        "TEXTE": ("Conversion", "TEXTE(valeur)", "Convertit en texte brut, sans masque", 'TEXTE(identite.matricule)'),
        "NOMBRE": ("Conversion", "NOMBRE(valeur)", "Convertit un texte en nombre", 'NOMBRE(situation_familiale.nb_enfants_a_charge)'),
        "FORMAT": ("Conversion", "FORMAT(valeur, \"MASQUE\")", "Met en forme avec un masque (MONTANT, DATE_LONGUE…)", 'FORMAT(periode.date_fin, "DATE_LONGUE")'),
        "MONTANT_EN_LETTRES": ("Conversion", "MONTANT_EN_LETTRES(montant, \"FR\"|\"AR\")", "Écrit un montant en toutes lettres (dirhams, centimes)", 'MONTANT_EN_LETTRES(net_a_payer)'),
        "TOTAL_CORPS": ("Données de l'état", "TOTAL_CORPS(\"corps\", \"colonne\"[, \"groupe\"])",
                        "Somme d'une colonne d'un corps, éventuellement d'un seul groupe (ou d'une ligne d'un corps « cases »)",
                        'TOTAL_CORPS("detail", "gains", "Indemnités non imposables")'),
        "TOTAL": ("Agrégats", "TOTAL(expression, GROUPE|PAGE|REPORT|ETAT)", "Somme sur les documents (journaux)", 'TOTAL(net_a_payer, ETAT)'),
        "MOYENNE_SUR": ("Agrégats", "MOYENNE_SUR(expression, portée)", "Moyenne sur les documents", 'MOYENNE_SUR(total_brut, ETAT)'),
        "NB": ("Agrégats", "NB(expression, portée)", "Nombre de documents", 'NB(matricule, GROUPE)'),
        "MIN_SUR": ("Agrégats", "MIN_SUR(expression, portée)", "Plus petite valeur", 'MIN_SUR(net_a_payer, ETAT)'),
        "MAX_SUR": ("Agrégats", "MAX_SUR(expression, portée)", "Plus grande valeur", 'MAX_SUR(net_a_payer, ETAT)'),
        "PAGE": ("Contexte", "PAGE()", "Numéro de la page", '"Page " + PAGE() + " / " + NB_PAGES()'),
        "NB_PAGES": ("Contexte", "NB_PAGES()", "Nombre de pages du document", '"Page " + PAGE() + " / " + NB_PAGES()'),
        "CHARTE": ("Contexte", "CHARTE(\"logo\")", "Élément de la charte de la société", 'CHARTE("logo")'),
        "ASSET": ("Contexte", "ASSET(\"CODE\")", "Image ou fichier déposé (signature, cachet)", 'ASSET("CACHET")'),
        "UTILISATEUR": ("Contexte", "UTILISATEUR(\"nom\")", "Utilisateur qui lance l'édition", 'UTILISATEUR("nom")'),
    }
    logique = {"SI": ("SI(condition, alors[, sinon])", "Choisit une valeur selon une condition", 'SI(net_a_payer > 0, "Virement", "Néant")'),
               "ET": ("ET(a, b, …)", "Vrai si toutes les conditions le sont", 'ET([SALBASE].MT > 0, [PRIM_ANC].MT > 0)'),
               "OU": ("OU(a, b, …)", "Vrai si une condition l'est", 'OU(sens = "GAIN", sens = "RETENUE")')}
    sortie = []
    for nom in sorted(set(FONCTIONS) | set(PARESSEUSES)):
        if nom in ajouts:
            cat, sig, desc, exemple = ajouts[nom]
            sortie.append({"nom": nom, "categorie": cat, "signature": sig, "description": desc, "exemple": exemple, "origine": "EDITION"})
        elif nom in logique:
            sig, desc, exemple = logique[nom]
            sortie.append({"nom": nom, "categorie": "Logique", "signature": sig, "description": desc, "exemple": exemple, "origine": "EDITION"})
        else:
            f = paie.get(nom, {})
            sortie.append({"nom": nom, "categorie": f.get("cat", "Paie"),
                           "signature": f.get("signature", f"{nom}(…)"),
                           "description": f.get("desc", ""), "exemple": f.get("exemple", ""), "origine": "PAIE"})
    return sortie
