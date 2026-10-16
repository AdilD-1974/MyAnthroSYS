"""
app/services/regle_dsl.py — Moteur de règles de calcul SPÉCIFIQUES (DSL).
Auteur : Adil DAIA

Un programme = une suite d'instructions exécutées dans l'ordre :

    CIBLE = <expression>              affecte le résultat à un attribut / registre
    SI <condition> ALORS <label>      saut conditionnel vers un label (ou FIN)
    SI <condition> ALORS CIBLE=<expr> affectation conditionnelle inline —
                                       n'exécute l'affectation que si la
                                       condition est vraie ; poursuit ensuite
                                       à la ligne suivante (ce n'est PAS un
                                       saut, contrairement à la forme ci-dessus)
    ALLER <label>                     saut inconditionnel
    FIN                               arrête la règle

CIBLES (attributs de la rubrique courante) :
    MT   montant        NB   nombre        TX   taux
    BASE base           DATE date          TEXTE texte
    Rxx  registre nombre (R00 … R99)        non persisté
    Txx  registre texte  (T00 … T99)        non persisté
    Dxx  registre date   (D00 … D99)        non persisté

EXPRESSIONS :
    nombres (12, 3.5)                chaînes ("CDI")
    + - * / %  et parenthèses        comparaisons  =  <>  <  >  <=  >=
    booléens   ET  OU  NON           fonctions     FONC(arg, …)
    accesseurs :
        MT NB TX BASE DATE TEXTE     attribut de la rubrique courante
        [CODE].MT                    attribut d'une autre rubrique de la paie
        #CODE                        constante de paie
        Rxx                          registre

FONCTIONS (registre extensible, voir FONCTIONS) :
    Math    ARRONDI TRONQUER MIN MAX ABS PLAFOND PLANCHER PUISSANCE RACINE MOD SIGNE
    Logique SI ET OU NON ESTVIDE COALESCE ENTRE
    Dates   DATEJOUR DATEPAIE ANNEE MOIS JOUR ANNEES MOISENTRE JOURS DATEPLUS DATEMOINS
            FINMOIS FINTRIMESTRE FINSEMESTRE FINANNEE
            ESTFINMOIS ESTFINTRIMESTRE ESTFINSEMESTRE ESTFINANNEE ESTFINCONTRAT
    Paie    VALEUR CUMUL PREC SOMME MOYENNE BAREME

Le moteur ne connaît pas la base de données : il délègue tous les accès
« métier » (valeur d'une rubrique, cumul, paie précédente, barème, dates) à un
objet `Resolver`. Cela le rend testable en isolation et réutilisable.
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP, ROUND_DOWN
from typing import Any, Callable, Protocol

D0 = Decimal("0")
D100 = Decimal("100")
CIBLES = ("MT", "NB", "TX", "BASE", "DATE", "TEXTE")


class DslError(Exception):
    """Erreur de syntaxe ou d'exécution d'une règle."""


# =====================================================================
# Interface d'accès aux données de paie (implémentée par le moteur de paie)
# =====================================================================
class Resolver(Protocol):
    def attribut(self, code_rubrique: str, attribut: str) -> Any: ...
    def constante(self, code: str) -> Any: ...
    def cumul(self, code_rubrique: str, attribut: str = "MT", portee: str = "ANNEE") -> Decimal: ...
    def precedent(self, code_rubrique: str, n: int = 1, attribut: str = "MT") -> Decimal: ...
    def somme(self, code_rubrique: str, n: int, attribut: str = "MT") -> Decimal: ...
    def moyenne(self, code_rubrique: str, n: int, attribut: str = "MT") -> Decimal: ...
    def bareme(self, code: str, cle: Any) -> Decimal: ...
    def bareme_sortie(self, code: str, cle: Any, sortie: str) -> Decimal: ...
    def date_paie(self) -> date: ...
    def date_jour(self) -> date: ...
    # RG-DSL-DATES-PERIODIQUES-01 (Adil DAIA) : propriétés de LA PÉRIODE DE
    # PAIE COURANTE (flags calendrier_paie.est_fin_*), pas des dates. Comme
    # date_fin_contrat, optionnelles côté Protocol (détectées via hasattr) —
    # un resolver sans notion de période (bac à sable isolé) ne les a pas.
    def est_fin_mois(self) -> bool: ...
    def est_fin_trimestre(self) -> bool: ...
    def est_fin_semestre(self) -> bool: ...
    def est_fin_annee(self) -> bool: ...
    def date_fin_contrat(self) -> "date | None": ...
    def manquant(self, quoi: str) -> None: ...   # signale un accès non résolu (→ 0)


# =====================================================================
# 1) TOKENIZER
# =====================================================================
_TOKEN_RE = re.compile(r"""
    (?P<space>\s+)
  | (?P<number>\d+(?:\.\d+)?)
  | (?P<string>"[^"]*")
  | (?P<rubrique>\[[A-Za-z0-9_]+\])
  | (?P<constante>\#[A-Za-z0-9_]+)
  | (?P<op><=|>=|<>|!=|==|-%|<|>|=|\+|\-|\*|/|%|\(|\)|,|\.)
  | (?P<ident>[A-Za-z_][A-Za-z0-9_]*)
""", re.VERBOSE)

_KEYWORDS = {"ET", "OU", "NON", "VRAI", "FAUX"}


def _tokenize(src: str) -> list[tuple[str, str]]:
    toks: list[tuple[str, str]] = []
    pos = 0
    while pos < len(src):
        m = _TOKEN_RE.match(src, pos)
        if not m:
            raise DslError(f"Caractère inattendu : {src[pos]!r}")
        pos = m.end()
        kind = m.lastgroup
        val = m.group()
        if kind == "space":
            continue
        toks.append((kind, val))
    toks.append(("eof", ""))
    return toks


# =====================================================================
# 2) PARSEUR (descente récursive) → AST (tuples)
# =====================================================================
# AST : ("num", Decimal) | ("str", s) | ("var", name) | ("rub", code, attr)
#     | ("const", code) | ("call", name, [args]) | ("bin", op, a, b)
#     | ("unary", op, a) | ("bool", op, a, b) | ("not", a)
class _Parser:
    def __init__(self, toks: list[tuple[str, str]]):
        self.toks = toks
        self.i = 0

    def peek(self): return self.toks[self.i]
    def next(self):
        t = self.toks[self.i]; self.i += 1; return t

    def expect(self, val: str):
        k, v = self.next()
        if v.upper() != val.upper():
            raise DslError(f"Attendu {val!r}, trouvé {v!r}")

    def parse(self):
        node = self.parse_ou()
        if self.peek()[0] != "eof":
            raise DslError(f"Jeton en trop : {self.peek()[1]!r}")
        return node

    # OU (précédence la plus faible)
    def parse_ou(self):
        node = self.parse_et()
        while self.peek()[1].upper() == "OU":
            self.next(); node = ("bool", "OU", node, self.parse_et())
        return node

    def parse_et(self):
        node = self.parse_non()
        while self.peek()[1].upper() == "ET":
            self.next(); node = ("bool", "ET", node, self.parse_non())
        return node

    def parse_non(self):
        if self.peek()[1].upper() == "NON":
            self.next(); return ("not", self.parse_non())
        return self.parse_cmp()

    def parse_cmp(self):
        node = self.parse_add()
        while self.peek()[0] == "op" and self.peek()[1] in ("=", "==", "<>", "!=", "<", ">", "<=", ">="):
            op = self.next()[1]; node = ("cmp", op, node, self.parse_add())
        return node

    def parse_add(self):
        node = self.parse_mul()
        while self.peek()[0] == "op" and self.peek()[1] in ("+", "-"):
            op = self.next()[1]; node = ("bin", op, node, self.parse_mul())
        return node

    def parse_mul(self):
        node = self.parse_unary()
        while self.peek()[0] == "op" and self.peek()[1] in ("*", "/", "%", "-%"):
            op = self.next()[1]; node = ("bin", op, node, self.parse_unary())
        return node

    def parse_unary(self):
        if self.peek()[0] == "op" and self.peek()[1] in ("+", "-"):
            op = self.next()[1]; return ("unary", op, self.parse_unary())
        return self.parse_primary()

    def parse_primary(self):
        k, v = self.peek()
        if k == "number":
            self.next(); return ("num", Decimal(v))
        if k == "string":
            self.next(); return ("str", v[1:-1])
        if k == "rubrique":
            self.next(); code = v[1:-1].upper()
            attr = "MT"
            if self.peek()[1] == ".":
                self.next(); attr = self.next()[1].upper()
            return ("rub", code, attr)
        if k == "constante":
            self.next(); return ("const", v[1:].upper())
        if k == "op" and v == "(":
            self.next(); node = self.parse_ou(); self.expect(")"); return node
        if k == "ident":
            name = v.upper(); self.next()
            if name == "VRAI": return ("num", Decimal(1))
            if name == "FAUX": return ("num", D0)
            if self.peek()[1] == "(":            # appel de fonction
                self.next(); args = []
                if self.peek()[1] != ")":
                    args.append(self.parse_ou())
                    while self.peek()[1] == ",":
                        self.next(); args.append(self.parse_ou())
                self.expect(")")
                node = ("call", name, args)
                # RG-DSL-ATTR-SUFFIXE-01 (Adil DAIA) : FONCTION(...).ATTR — sélectionne
                # un attribut ou une sortie précise en suffixe (ex. CUMUL("RUB").MT,
                # BAREME("CODE", clé).TAUX), alternative à l'argument positionnel déjà
                # supporté (ex. CUMUL("RUB", "MT")). Accepté syntaxiquement après
                # n'importe quel appel (cohérent avec [CODE].MT), mais seules
                # VALEUR/CUMUL/PREC/SOMME/MOYENNE/BAREME l'interprètent réellement.
                if self.peek()[1] == ".":
                    self.next()
                    k2, v2 = self.next()
                    if k2 != "ident":
                        raise DslError(f"Nom de sortie attendu après '.', trouvé {v2!r}")
                    node = ("call_attr", name, args, v2.upper())
                return node
            if self.peek()[1] == ".":             # ACCES attribut rubrique courante ? non → var.attr non géré
                # ex : DATE.something — non supporté, on renvoie la var simple
                return ("var", name)
            return ("var", name)
        raise DslError(f"Expression invalide près de {v!r}")


def compiler_expression(src: str):
    """Compile une expression en AST (réutilisable). Lève DslError si invalide."""
    return _Parser(_tokenize(src)).parse()


# =====================================================================
# 3) ÉVALUATEUR
# =====================================================================
def _to_dec(v: Any) -> Decimal:
    if isinstance(v, Decimal): return v
    if isinstance(v, bool): return Decimal(1) if v else D0
    if isinstance(v, (int, float)): return Decimal(str(v))
    if isinstance(v, date): return Decimal(v.toordinal())
    if v is None or v == "": return D0
    try: return Decimal(str(v))
    except Exception: return D0


def _truthy(v: Any) -> bool:
    if isinstance(v, bool): return v
    if isinstance(v, Decimal): return v != D0
    if isinstance(v, date): return True
    return bool(v)


class Evaluator:
    def __init__(self, resolver: Resolver, vars_locales: dict):
        self.r = resolver
        self.v = vars_locales   # MT/NB/TX/BASE/DATE/TEXTE + Rxx

    def eval(self, node) -> Any:
        t = node[0]
        if t == "num": return node[1]
        if t == "str": return node[1]
        if t == "var":
            name = node[1]
            if name in self.v: return self.v[name]
            self.r.manquant(f"variable {name}")
            return D0
        if t == "rub":
            _, code, attr = node
            return self.r.attribut(code, attr)
        if t == "const":
            return self.r.constante(node[1])
        if t == "unary":
            a = self.eval(node[2])
            return -_to_dec(a) if node[1] == "-" else _to_dec(a)
        if t == "bin":
            return self._arith(node[1], self.eval(node[2]), self.eval(node[3]))
        if t == "cmp":
            return self._compare(node[1], self.eval(node[2]), self.eval(node[3]))
        if t == "bool":
            a = _truthy(self.eval(node[2]))
            if node[1] == "ET": return a and _truthy(self.eval(node[3]))
            return a or _truthy(self.eval(node[3]))
        if t == "not":
            return not _truthy(self.eval(node[1]))
        if t == "call":
            return self._call(node[1], node[2])
        if t == "call_attr":
            return self._call_attr(node[1], node[2], node[3])
        raise DslError(f"Nœud inconnu : {t}")

    def _arith(self, op, a, b):
        # concaténation de texte avec '+'
        if op == "+" and (isinstance(a, str) or isinstance(b, str)) \
                and not (isinstance(a, Decimal) and isinstance(b, Decimal)):
            return f"{_txt(a)}{_txt(b)}"
        x, y = _to_dec(a), _to_dec(b)
        if op == "+": return x + y
        if op == "-": return x - y
        if op == "*": return x * y
        if op == "/": return x / y if y != D0 else D0
        # RG-DSL-POURCENTAGE-01 : depuis juillet 2026, % = "pourcentage de"
        # (A % B = A × B / 100), PAS un modulo — le modulo classique n'avait
        # aucun cas d'usage réel en paie (primes, taux, retenues) et % en
        # avait un quasi systématique. Le vrai modulo reste disponible via
        # MOD(a, b). Ce fichier appliquait encore l'ancienne sémantique
        # (`x % y` Python = reste de division), corrigé ici.
        if op == "%": return x * y / D100
        # -% = "diminué de x pourcent" (A -% B = A × (100 − B) / 100) —
        # documenté depuis juillet 2026 mais jamais câblé dans ce fichier
        # (absent du tokenizer ET de l'évaluateur avant ce correctif).
        if op == "-%": return x * (D100 - y) / D100
        raise DslError(f"Opérateur inconnu : {op}")

    def _compare(self, op, a, b):
        if isinstance(a, str) or isinstance(b, str):
            x, y = _txt(a), _txt(b)
        else:
            x, y = _to_dec(a), _to_dec(b)
        if op in ("=", "=="): return x == y
        if op in ("<>", "!="): return x != y
        if op == "<": return x < y
        if op == ">": return x > y
        if op == "<=": return x <= y
        if op == ">=": return x >= y
        raise DslError(f"Comparateur inconnu : {op}")

    def _call(self, name, arg_nodes):
        fn = FONCTIONS.get(name)
        if fn is None:
            self.r.manquant(f"fonction {name}")
            raise DslError(f"Fonction inconnue : {name}")
        args = [self.eval(a) for a in arg_nodes]
        return fn(args, self.r)

    def _call_attr(self, name, arg_nodes, attr):
        # RG-DSL-ATTR-SUFFIXE-01 (Adil DAIA) : le suffixe .ATTR après un appel
        # (déjà utilisé pour BAREME(...).SORTIE) est étendu aux fonctions Paie
        # qui acceptent déjà un attribut en dernier argument positionnel
        # (VALEUR/CUMUL/PREC/SOMME/MOYENNE) — syntaxe alternative plus lisible,
        # cohérente avec [RUB].MT. Le suffixe REMPLACE l'argument attribut
        # positionnel : les arguments restants gardent leur position habituelle
        # (n, portée...) comme si l'attribut avait été omis.
        args = [self.eval(a) for a in arg_nodes]

        if name == "BAREME":
            if len(args) < 2:
                raise DslError(f"BAREME(...).{attr} attend au moins (code, clé)")
            return self.r.bareme_sortie(_txt(args[0]).upper(), args[1], attr)

        if name == "VALEUR":
            if len(args) < 1:
                raise DslError(f"VALEUR(...).{attr} attend au moins (code)")
            return self.r.attribut(_txt(args[0]).upper(), attr)

        if name == "CUMUL":
            if len(args) < 1:
                raise DslError(f"CUMUL(...).{attr} attend au moins (code)")
            portee = _txt(args[1]).upper() if len(args) > 1 else "ANNEE"
            return self.r.cumul(_txt(args[0]).upper(), attr, portee)

        if name == "PREC":
            if len(args) < 1:
                raise DslError(f"PREC(...).{attr} attend au moins (code)")
            n = int(_to_dec(args[1])) if len(args) > 1 else 1
            return self.r.precedent(_txt(args[0]).upper(), n, attr)

        if name == "SOMME":
            if len(args) < 2:
                raise DslError(f"SOMME(...).{attr} attend (code, n)")
            return self.r.somme(_txt(args[0]).upper(), int(_to_dec(args[1])), attr)

        if name == "MOYENNE":
            if len(args) < 2:
                raise DslError(f"MOYENNE(...).{attr} attend (code, n)")
            return self.r.moyenne(_txt(args[0]).upper(), int(_to_dec(args[1])), attr)

        raise DslError(
            f"'.{attr}' n'est pris en charge qu'après VALEUR/CUMUL/PREC/SOMME/MOYENNE/BAREME(...), "
            f"pas après {name}(...)"
        )


def _txt(v: Any) -> str:
    if isinstance(v, Decimal):
        return format(v.normalize(), "f")
    if isinstance(v, date):
        return v.isoformat()
    return str(v)


def _as_date(v: Any) -> date | None:
    if isinstance(v, date): return v
    if isinstance(v, str):
        try: return date.fromisoformat(v[:10])
        except Exception: return None
    if isinstance(v, Decimal):
        try: return date.fromordinal(int(v))
        except Exception: return None
    return None


# =====================================================================
# 4) BIBLIOTHÈQUE DE FONCTIONS
# =====================================================================
def _rnd(x: Decimal, n: int = 2) -> Decimal:
    q = Decimal(1).scaleb(-n)
    return x.quantize(q, rounding=ROUND_HALF_UP)


FONCTIONS: dict[str, Callable[[list, Resolver], Any]] = {}


def _f(name):
    def deco(fn): FONCTIONS[name] = fn; return fn
    return deco


# ---- Math ----
_f("ARRONDI")(lambda a, r: _rnd(_to_dec(a[0]), int(_to_dec(a[1])) if len(a) > 1 else 2))
_f("TRONQUER")(lambda a, r: _to_dec(a[0]).quantize(Decimal(1).scaleb(-(int(_to_dec(a[1])) if len(a) > 1 else 0)), rounding=ROUND_DOWN))
_f("MIN")(lambda a, r: min(_to_dec(x) for x in a))
_f("MAX")(lambda a, r: max(_to_dec(x) for x in a))
_f("ABS")(lambda a, r: abs(_to_dec(a[0])))
_f("PLAFOND")(lambda a, r: _to_dec(a[0]).to_integral_value(rounding="ROUND_CEILING"))
_f("PLANCHER")(lambda a, r: _to_dec(a[0]).to_integral_value(rounding="ROUND_FLOOR"))
_f("PUISSANCE")(lambda a, r: _to_dec(a[0]) ** int(_to_dec(a[1])))
_f("MOD")(lambda a, r: _to_dec(a[0]) % _to_dec(a[1]) if _to_dec(a[1]) != D0 else D0)
_f("SIGNE")(lambda a, r: Decimal(0 if _to_dec(a[0]) == D0 else (1 if _to_dec(a[0]) > D0 else -1)))


@_f("RACINE")
def _racine(a, r):
    x = _to_dec(a[0])
    return x.sqrt() if x >= D0 else D0


# ---- Logique ----
_f("SI")(lambda a, r: a[1] if _truthy(a[0]) else (a[2] if len(a) > 2 else D0))
_f("ET")(lambda a, r: all(_truthy(x) for x in a))
_f("OU")(lambda a, r: any(_truthy(x) for x in a))
_f("NON")(lambda a, r: not _truthy(a[0]))
_f("ESTVIDE")(lambda a, r: (a[0] is None) or (a[0] == "") or (isinstance(a[0], Decimal) and a[0] == D0))
_f("ENTRE")(lambda a, r: _to_dec(a[1]) <= _to_dec(a[0]) <= _to_dec(a[2]))


@_f("COALESCE")
def _coalesce(a, r):
    for x in a:
        if x is not None and x != "" and not (isinstance(x, Decimal) and x == D0):
            return x
    return a[-1] if a else D0


# ---- Dates ----
_f("DATEJOUR")(lambda a, r: r.date_jour())
_f("DATEPAIE")(lambda a, r: r.date_paie())
_f("ANNEE")(lambda a, r: Decimal((_as_date(a[0]) or r.date_jour()).year))
_f("MOIS")(lambda a, r: Decimal((_as_date(a[0]) or r.date_jour()).month))
_f("JOUR")(lambda a, r: Decimal((_as_date(a[0]) or r.date_jour()).day))
_f("DATEPLUS")(lambda a, r: (_as_date(a[0]) or r.date_jour()) + timedelta(days=int(_to_dec(a[1]))))
_f("DATEMOINS")(lambda a, r: (_as_date(a[0]) or r.date_jour()) - timedelta(days=int(_to_dec(a[1]))))
_f("JOURS")(lambda a, r: Decimal(((_as_date(a[0]) or r.date_jour()) - (_as_date(a[1]) or r.date_jour())).days))


@_f("MOISENTRE")
def _moisentre(a, r):
    d1 = _as_date(a[0]) or r.date_jour(); d2 = _as_date(a[1]) or r.date_jour()
    return Decimal((d1.year - d2.year) * 12 + (d1.month - d2.month))


@_f("ANNEES")
def _annees(a, r):
    d1 = _as_date(a[0]) or r.date_jour(); d2 = _as_date(a[1]) or r.date_jour()
    ans = d1.year - d2.year - ((d1.month, d1.day) < (d2.month, d2.day))
    return Decimal(ans)


@_f("FINMOIS")
def _finmois(a, r):
    d = _as_date(a[0]) or r.date_jour()
    nxt = date(d.year + (d.month == 12), (d.month % 12) + 1, 1)
    return nxt - timedelta(days=1)


@_f("FINTRIMESTRE")
def _fintrimestre(a, r):
    d = _as_date(a[0]) or r.date_jour()
    mois_fin = ((d.month - 1) // 3 + 1) * 3          # 3, 6, 9 ou 12
    nxt = date(d.year + (mois_fin == 12), (mois_fin % 12) + 1, 1)
    return nxt - timedelta(days=1)


@_f("FINSEMESTRE")
def _finsemestre(a, r):
    d = _as_date(a[0]) or r.date_jour()
    mois_fin = 6 if d.month <= 6 else 12
    nxt = date(d.year + (mois_fin == 12), (mois_fin % 12) + 1, 1)
    return nxt - timedelta(days=1)


_f("FINANNEE")(lambda a, r: date((_as_date(a[0]) or r.date_jour()).year, 12, 31))

# ---- Tests de date (RG-DSL-DATES-PERIODIQUES-01, Adil DAIA) ---------------
# Pratiques pour un SI en tête de règle (ex. prime trimestrielle : ne calculer
# que si la période de paie courante est une fin de trimestre). Délégués au
# resolver, qui lit les flags déjà existants sur calendrier_paie
# (est_fin_mois/est_fin_trimestre/est_fin_semestre/est_fin_annee, cochés
# explicitement dans Paramétrage > Calendrier — colonnes "Fin T/S/A") plutôt
# que recalculés par arithmétique de dates : un trimestre/semestre "métier"
# ne correspond pas forcément à un trimestre/semestre calendaire strict
# (exercice décalé, périodes personnalisées…), les flags sont la seule
# source fiable. Pas d'argument : ce sont des propriétés de LA PÉRIODE DE
# PAIE COURANTE, pas d'une date arbitraire passée en paramètre.
_f("ESTFINMOIS")(lambda a, r: bool(r.est_fin_mois()) if hasattr(r, "est_fin_mois") else _abs_manquant(r, "ESTFINMOIS"))
_f("ESTFINTRIMESTRE")(lambda a, r: bool(r.est_fin_trimestre()) if hasattr(r, "est_fin_trimestre") else _abs_manquant(r, "ESTFINTRIMESTRE"))
_f("ESTFINSEMESTRE")(lambda a, r: bool(r.est_fin_semestre()) if hasattr(r, "est_fin_semestre") else _abs_manquant(r, "ESTFINSEMESTRE"))
_f("ESTFINANNEE")(lambda a, r: bool(r.est_fin_annee()) if hasattr(r, "est_fin_annee") else _abs_manquant(r, "ESTFINANNEE"))


def _abs_manquant(r, nom: str) -> bool:
    r.manquant(f"{nom} : resolver sans notion de période de paie (bac à sable ?)")
    return False


@_f("ESTFINCONTRAT")
def _estfincontrat(a, r):
    """
    VRAI si le collaborateur a une date de fin de contrat ET qu'elle tombe
    dans la période de paie courante (mois calendaire de DATEPAIE() par
    défaut, ou du mois de la date donnée en argument optionnel).
    Délégué au resolver (r.date_fin_contrat()) — nécessite une donnée du
    collaborateur, pas seulement des dates arithmétiques comme les FIN*
    ci-dessus. Si le resolver ne l'implémente pas (ex. bac à sable de
    simulation sans collaborateur réel), `manquant()` est signalé et la
    fonction renvoie FAUX plutôt que de lever une exception.
    """
    dfc = r.date_fin_contrat() if hasattr(r, "date_fin_contrat") else None
    if dfc is None:
        r.manquant("ESTFINCONTRAT : pas de date de fin de contrat pour ce collaborateur")
        return False
    ref = _as_date(a[0]) if a else r.date_paie()
    ref = ref or r.date_paie()
    return dfc.year == ref.year and dfc.month == ref.month


# ---- Paie (délégué au resolver) ----
_f("VALEUR")(lambda a, r: r.attribut(_txt(a[0]).upper(), _txt(a[1]).upper() if len(a) > 1 else "MT"))
_f("CUMUL")(lambda a, r: r.cumul(_txt(a[0]).upper(), _txt(a[1]).upper() if len(a) > 1 else "MT",
                                 _txt(a[2]).upper() if len(a) > 2 else "ANNEE"))
_f("PREC")(lambda a, r: r.precedent(_txt(a[0]).upper(), int(_to_dec(a[1])) if len(a) > 1 else 1,
                                    _txt(a[2]).upper() if len(a) > 2 else "MT"))
_f("SOMME")(lambda a, r: r.somme(_txt(a[0]).upper(), int(_to_dec(a[1])), _txt(a[2]).upper() if len(a) > 2 else "MT"))
_f("MOYENNE")(lambda a, r: r.moyenne(_txt(a[0]).upper(), int(_to_dec(a[1])), _txt(a[2]).upper() if len(a) > 2 else "MT"))
_f("BAREME")(lambda a, r: r.bareme(_txt(a[0]).upper(), a[1]))


# =====================================================================
# 5) EXÉCUTEUR DE PROGRAMME (instructions)
# =====================================================================
_ASSIGN_RE = re.compile(r"^(R\d{2}|T\d{2}|D\d{2}|MT|NB|TX|BASE|DATE|TEXTE)\s*=\s*(.+)$", re.I | re.S)
# RG-DSL-SI-INLINE-01 (Adil DAIA) : SI <condition> ALORS <cible> = <expr> —
# affectation exécutée conditionnellement, PAS un saut. Distincte de _SI_RE
# (SI <condition> ALORS <label>) par construction : ALORS y est suivi d'une
# cible connue + "=", jamais d'un simple mot isolé. Testée AVANT _SI_RE dans
# l'exécuteur/le validateur pour ne jamais laisser _SI_RE happer le "ALORS
# TEXTE" comme s'il s'agissait d'un nom de label.
_SI_ASSIGN_RE = re.compile(
    r"^SI\s+(.+?)\s+(?:ALORS|BRANCH|=>)\s+(R\d{2}|T\d{2}|D\d{2}|MT|NB|TX|BASE|DATE|TEXTE)\s*=\s*(.+)$",
    re.I | re.S,
)
_SI_RE = re.compile(r"^SI\s+(.+?)\s+(?:ALORS|BRANCH|=>)\s+(\w+)\s*$", re.I)
_ALLER_RE = re.compile(r"^(?:ALLER|GOTO)\s+(\w+)\s*$", re.I)
_FIN_RE = re.compile(r"^(FIN|END|STOP)\s*$", re.I)


def _typer_cible(cible: str, val):
    """Type une valeur selon la cible visée (MT/NB/TX/BASE/Rxx → Decimal,
    DATE/Dxx → date, TEXTE/Txx → texte) — factorisé entre l'affectation
    directe (CIBLE = expr) et l'affectation conditionnelle inline
    (SI cond ALORS CIBLE = expr)."""
    if cible in ("MT", "NB", "TX", "BASE") or re.fullmatch(r"R\d{2}", cible):
        return _to_dec(val)
    if cible == "DATE" or re.fullmatch(r"D\d{2}", cible):
        return _as_date(val) or val
    if cible == "TEXTE" or re.fullmatch(r"T\d{2}", cible):
        return _txt(val)
    return val


def executer(instructions: list[dict], resolver: Resolver, seed: dict) -> tuple[dict, list, list]:
    """
    Exécute une règle spécifique.
    - instructions : liste de dicts {numero, instruction, label?}
    - seed : valeurs initiales des attributs (MT/NB/TX/BASE/DATE/TEXTE)
    Retourne (sorties, trace, avertissements).
    """
    vars_: dict[str, Any] = {}
    for k in CIBLES:
        vars_[k] = seed.get(k, D0 if k not in ("DATE", "TEXTE") else (None if k == "DATE" else ""))
    for k, v in seed.items():
        vars_[k.upper()] = v

    trace: list = []
    avert: list = []
    _mq: list = []

    class _R:
        """Adaptateur : intercepte les accès manquants pour la trace."""
        def __init__(self, base): self._b = base
        def attribut(self, c, a): return self._b.attribut(c, a)
        def constante(self, c): return self._b.constante(c)
        def cumul(self, c, a="MT", p="ANNEE"): return self._b.cumul(c, a, p)
        def precedent(self, c, n=1, a="MT"): return self._b.precedent(c, n, a)
        def somme(self, c, n, a="MT"): return self._b.somme(c, n, a)
        def moyenne(self, c, n, a="MT"): return self._b.moyenne(c, n, a)
        def bareme(self, c, k): return self._b.bareme(c, k)
        def bareme_sortie(self, c, k, s):
            # Repli défensif : si le resolver concret (ResolverPaie /
            # ResolverManuel) n'a pas encore la méthode bareme_sortie
            # (mise à jour à faire séparément), on traite l'accès comme
            # "non résolu" (→ 0 + avertissement) plutôt que de planter toute
            # la règle — cohérent avec la philosophie générale du moteur.
            try:
                return self._b.bareme_sortie(c, k, s)
            except AttributeError:
                self.manquant(f"BAREME {c}.{s} (resolver non mis à jour pour les sorties multiples)")
                return D0
        def date_paie(self): return self._b.date_paie()
        def date_jour(self): return self._b.date_jour()
        # RG-DSL-DATES-PERIODIQUES-01 (Adil DAIA) : hasattr(r, ...) est utilisé
        # côté ESTFINMOIS/ESTFINTRIMESTRE/ESTFINSEMESTRE/ESTFINANNEE/
        # ESTFINCONTRAT pour détecter si LE VRAI resolver les implémente — sans
        # ces méthodes forwardées ici, hasattr() sur `_R` échouait TOUJOURS
        # (même quand ResolverPaie les a bel et bien), quel que soit le
        # resolver sous-jacent : ces 5 fonctions étaient silencieusement
        # cassées pour toute règle passant par l'exécuteur (donc en pratique
        # tout le monde). `getattr(..., None)` : ne définit PAS la méthode
        # sur `_R` si la base ne l'a pas, pour que hasattr() reste fidèle au
        # vrai resolver plutôt que de toujours répondre "oui, ça existe".
        if hasattr(resolver, "est_fin_mois"): est_fin_mois = lambda self: self._b.est_fin_mois()
        if hasattr(resolver, "est_fin_trimestre"): est_fin_trimestre = lambda self: self._b.est_fin_trimestre()
        if hasattr(resolver, "est_fin_semestre"): est_fin_semestre = lambda self: self._b.est_fin_semestre()
        if hasattr(resolver, "est_fin_annee"): est_fin_annee = lambda self: self._b.est_fin_annee()
        if hasattr(resolver, "date_fin_contrat"): date_fin_contrat = lambda self: self._b.date_fin_contrat()
        def manquant(self, quoi):
            _mq.append(quoi)
            try: self._b.manquant(quoi)
            except Exception: pass

    r = _R(resolver)
    ordered = sorted([i for i in instructions if (i.get("instruction") or "").strip()],
                     key=lambda x: x.get("numero", 0))
    labels = {(i.get("label") or "").upper(): idx for idx, i in enumerate(ordered) if i.get("label")}

    idx, safety = 0, 0
    while idx < len(ordered):
        safety += 1
        if safety > 5000:
            avert.append("Boucle d'exécution (>5000) — règle interrompue")
            break
        instr = ordered[idx]["instruction"].strip()
        numero_ligne = ordered[idx].get("numero")
        _mq.clear()

        # commentaire // ou # en début de ligne
        if instr.startswith("//") or instr.startswith("#-"):
            idx += 1; continue

        m = _FIN_RE.match(instr)
        if m:
            trace.append({"instruction": instr, "resolu": "FIN", "numero": numero_ligne}); break

        m = _ALLER_RE.match(instr)
        if m:
            tgt = m.group(1).upper()
            if tgt in ("FIN", "END", "STOP"):
                trace.append({"instruction": instr, "resolu": "→ FIN", "numero": numero_ligne}); break
            if tgt in labels:
                trace.append({"instruction": instr, "resolu": f"→ {tgt}", "numero": numero_ligne}); idx = labels[tgt]; continue
            avert.append(f"Label introuvable : {tgt}")
            idx += 1; continue

        m = _SI_ASSIGN_RE.match(instr)
        if m:
            try:
                cond = Evaluator(r, vars_).eval(compiler_expression(m.group(1)))
            except DslError as e:
                avert.append(f"[{instr}] {e}"); idx += 1; continue
            pris = _truthy(cond)
            cible = m.group(2).upper()
            avert_cond = sorted(set(_mq))  # avertissements de la CONDITION — à ne pas perdre si non prise
            if pris:
                _mq.clear()
                try:
                    val = Evaluator(r, vars_).eval(compiler_expression(m.group(3)))
                except DslError as e:
                    avert.append(f"[{instr}] {e}"); idx += 1; continue
                val = _typer_cible(cible, val)
                vars_[cible] = val
                entry = {"instruction": instr, "resolu": f"SI ({_txt(cond)}) → {cible} = {_txt(val)}", "pris": pris, "numero": numero_ligne}
                tous_mq = sorted(set(avert_cond) | set(_mq))
                if tous_mq:
                    entry["avert"] = f"Accès à 0 : {', '.join(tous_mq)}"
                    avert.extend(tous_mq)
            else:
                entry = {"instruction": instr, "resolu": f"SI ({_txt(cond)}) → non exécuté", "pris": pris, "numero": numero_ligne}
                if avert_cond:
                    entry["avert"] = f"Accès à 0 : {', '.join(avert_cond)}"
                    avert.extend(avert_cond)
            trace.append(entry)
            idx += 1; continue

        m = _SI_RE.match(instr)
        if m:
            try:
                cond = Evaluator(r, vars_).eval(compiler_expression(m.group(1)))
            except DslError as e:
                avert.append(f"[{instr}] {e}"); idx += 1; continue
            pris = _truthy(cond)
            tgt = m.group(2).upper()
            trace.append({"instruction": instr, "resolu": f"SI ({_txt(cond)})", "pris": pris, "vers": tgt, "numero": numero_ligne})
            if pris:
                if tgt in ("FIN", "END", "STOP"): break
                if tgt in labels: idx = labels[tgt]; continue
                avert.append(f"Label introuvable : {tgt}")
            idx += 1; continue

        m = _ASSIGN_RE.match(instr)
        if m:
            cible = m.group(1).upper()
            try:
                val = Evaluator(r, vars_).eval(compiler_expression(m.group(2)))
            except DslError as e:
                avert.append(f"[{instr}] {e}"); idx += 1; continue
            val = _typer_cible(cible, val)
            vars_[cible] = val
            entry = {"instruction": instr, "resolu": f"{cible} = {_txt(val)}", "numero": numero_ligne}
            if _mq:
                entry["avert"] = f"Accès à 0 : {', '.join(sorted(set(_mq)))}"
                avert.extend(sorted(set(_mq)))
            trace.append(entry)
            idx += 1; continue

        trace.append({"instruction": instr, "avert": "Instruction non reconnue", "numero": numero_ligne})
        avert.append(f"Instruction non reconnue : {instr}")
        idx += 1

    sorties = {k: vars_.get(k) for k in CIBLES}
    return sorties, trace, avert


def valider_programme(instructions: list[dict]) -> list[str]:
    """Contrôle syntaxique statique. Retourne la liste des erreurs (vide si OK)."""
    erreurs: list[str] = []
    for i in sorted(instructions, key=lambda x: x.get("numero", 0)):
        instr = (i.get("instruction") or "").strip()
        if not instr or instr.startswith("//"):
            continue
        if _FIN_RE.match(instr) or _ALLER_RE.match(instr):
            continue
        m_si_assign = _SI_ASSIGN_RE.match(instr)
        if m_si_assign:
            for expr in (m_si_assign.group(1), m_si_assign.group(3)):
                try:
                    compiler_expression(expr)
                except DslError as e:
                    erreurs.append(f"Ligne {i.get('numero')}: {e}")
            continue
        m = _SI_RE.match(instr) or _ASSIGN_RE.match(instr)
        if not m:
            erreurs.append(f"Ligne {i.get('numero')}: instruction non reconnue « {instr} »")
            continue
        expr = m.group(1) if _SI_RE.match(instr) else m.group(2)
        try:
            compiler_expression(expr)
        except DslError as e:
            erreurs.append(f"Ligne {i.get('numero')}: {e}")
    return erreurs


# =====================================================================
# 6) CATALOGUE (métadonnées exposées à l'éditeur de règles)
# =====================================================================
# Source de vérité unique : l'éditeur lit ce catalogue via l'API, il n'y a
# donc aucune liste de fonctions codée en dur côté front.
CATALOGUE: list[dict] = [
    # --- Math ---
    {"nom": "ARRONDI",  "cat": "Math", "signature": "ARRONDI(x[, n])",  "desc": "Arrondit x à n décimales (2 par défaut)"},
    {"nom": "TRONQUER", "cat": "Math", "signature": "TRONQUER(x[, n])", "desc": "Tronque x à n décimales"},
    {"nom": "MIN",      "cat": "Math", "signature": "MIN(a, b, …)",     "desc": "Plus petite valeur"},
    {"nom": "MAX",      "cat": "Math", "signature": "MAX(a, b, …)",     "desc": "Plus grande valeur"},
    {"nom": "ABS",      "cat": "Math", "signature": "ABS(x)",           "desc": "Valeur absolue"},
    {"nom": "PLAFOND",  "cat": "Math", "signature": "PLAFOND(x)",       "desc": "Arrondi à l'entier supérieur"},
    {"nom": "PLANCHER", "cat": "Math", "signature": "PLANCHER(x)",      "desc": "Arrondi à l'entier inférieur"},
    {"nom": "PUISSANCE","cat": "Math", "signature": "PUISSANCE(x, n)",  "desc": "x élevé à la puissance n"},
    {"nom": "RACINE",   "cat": "Math", "signature": "RACINE(x)",        "desc": "Racine carrée"},
    {"nom": "MOD",      "cat": "Math", "signature": "MOD(a, b)",        "desc": "Reste de la division"},
    {"nom": "SIGNE",    "cat": "Math", "signature": "SIGNE(x)",         "desc": "-1, 0 ou 1 selon le signe"},
    # --- Logique ---
    {"nom": "SI",       "cat": "Logique", "signature": "SI(cond, a, b)",     "desc": "Renvoie a si la condition est vraie, sinon b"},
    {"nom": "ET",       "cat": "Logique", "signature": "ET(a, b, …)",        "desc": "Vrai si toutes les conditions sont vraies"},
    {"nom": "OU",       "cat": "Logique", "signature": "OU(a, b, …)",        "desc": "Vrai si au moins une condition est vraie"},
    {"nom": "NON",      "cat": "Logique", "signature": "NON(x)",             "desc": "Inverse la condition"},
    {"nom": "ESTVIDE",  "cat": "Logique", "signature": "ESTVIDE(x)",         "desc": "Vrai si x est vide ou nul"},
    {"nom": "COALESCE", "cat": "Logique", "signature": "COALESCE(a, b, …)",  "desc": "Première valeur non vide"},
    {"nom": "ENTRE",    "cat": "Logique", "signature": "ENTRE(x, min, max)", "desc": "Vrai si min ≤ x ≤ max"},
    # --- Dates ---
    {"nom": "DATEJOUR",  "cat": "Dates", "signature": "DATEJOUR()",        "desc": "Date du jour"},
    {"nom": "DATEPAIE",  "cat": "Dates", "signature": "DATEPAIE()",        "desc": "Date de référence de la paie courante"},
    {"nom": "ANNEE",     "cat": "Dates", "signature": "ANNEE(d)",          "desc": "Année d'une date"},
    {"nom": "MOIS",      "cat": "Dates", "signature": "MOIS(d)",           "desc": "Mois d'une date"},
    {"nom": "JOUR",      "cat": "Dates", "signature": "JOUR(d)",           "desc": "Jour d'une date"},
    {"nom": "ANNEES",    "cat": "Dates", "signature": "ANNEES(d1, d2)",    "desc": "Nombre d'années entières entre deux dates"},
    {"nom": "MOISENTRE", "cat": "Dates", "signature": "MOISENTRE(d1, d2)", "desc": "Nombre de mois entre deux dates"},
    {"nom": "JOURS",     "cat": "Dates", "signature": "JOURS(d1, d2)",     "desc": "Nombre de jours entre deux dates"},
    {"nom": "DATEPLUS",  "cat": "Dates", "signature": "DATEPLUS(d, n)",    "desc": "Date + n jours"},
    {"nom": "DATEMOINS", "cat": "Dates", "signature": "DATEMOINS(d, n)",   "desc": "Date − n jours"},
    {"nom": "FINMOIS",   "cat": "Dates", "signature": "FINMOIS(d)",        "desc": "Dernier jour du mois de la date"},
    {"nom": "FINTRIMESTRE", "cat": "Dates", "signature": "FINTRIMESTRE(d)", "desc": "Dernier jour du trimestre de la date"},
    {"nom": "FINSEMESTRE",  "cat": "Dates", "signature": "FINSEMESTRE(d)",  "desc": "Dernier jour du semestre de la date"},
    {"nom": "FINANNEE",     "cat": "Dates", "signature": "FINANNEE(d)",     "desc": "31 décembre de l'année de la date"},
    {"nom": "ESTFINMOIS",       "cat": "Dates", "signature": "ESTFINMOIS()",       "desc": "VRAI si la période de paie courante est une fin de mois (calendrier_paie)"},
    {"nom": "ESTFINTRIMESTRE",  "cat": "Dates", "signature": "ESTFINTRIMESTRE()",  "desc": "VRAI si la période de paie courante est une fin de trimestre (calendrier_paie)"},
    {"nom": "ESTFINSEMESTRE",   "cat": "Dates", "signature": "ESTFINSEMESTRE()",   "desc": "VRAI si la période de paie courante est une fin de semestre (calendrier_paie)"},
    {"nom": "ESTFINANNEE",      "cat": "Dates", "signature": "ESTFINANNEE()",      "desc": "VRAI si la période de paie courante est une fin d'année (calendrier_paie)"},
    {"nom": "ESTFINCONTRAT",    "cat": "Dates", "signature": "ESTFINCONTRAT([d])",    "desc": "VRAI si le contrat du collaborateur se termine dans le mois de d (ou DATEPAIE)"},
    # --- Paie ---
    {"nom": "VALEUR",  "cat": "Paie", "signature": 'VALEUR("RUB")[.ATTR]',        "desc": "Attribut d'une rubrique de la paie courante (.MT par défaut, ou en 2e argument)"},
    {"nom": "CUMUL",   "cat": "Paie", "signature": 'CUMUL("RUB")[.ATTR]',         "desc": "Cumul annuel d'une rubrique (périodes antérieures) — .MT par défaut"},
    {"nom": "PREC",    "cat": "Paie", "signature": 'PREC("RUB"[, n])[.ATTR]',     "desc": "Valeur il y a n périodes (1 = mois précédent) — .MT par défaut"},
    {"nom": "SOMME",   "cat": "Paie", "signature": 'SOMME("RUB", n)[.ATTR]',      "desc": "Somme des n dernières périodes — .MT par défaut"},
    {"nom": "MOYENNE", "cat": "Paie", "signature": 'MOYENNE("RUB", n)[.ATTR]',    "desc": "Moyenne des n dernières périodes — .MT par défaut"},
    {"nom": "BAREME",  "cat": "Paie", "signature": 'BAREME("CODE", clé)[.SORTIE]', "desc": "Recherche dans un barème — ajoutez .NOM_SORTIE (ex. .TAUX, .MONTANT) pour une sortie précise ; sans suffixe, la sortie par défaut du barème est utilisée"},
]

# Grammaire du langage (attributs, registres, mots-clés, opérateurs)
GRAMMAIRE: dict = {
    "attributs": [
        {"nom": "MT", "desc": "Montant"}, {"nom": "NB", "desc": "Nombre"},
        {"nom": "TX", "desc": "Taux"},    {"nom": "BASE", "desc": "Base"},
        {"nom": "DATE", "desc": "Date"},  {"nom": "TEXTE", "desc": "Texte"},
    ],
    "registres": [
        {"nom": "Rxx", "desc": "Registre nombre (R00 à R99)"},
        {"nom": "Txx", "desc": "Registre texte (T00 à T99)"},
        {"nom": "Dxx", "desc": "Registre date (D00 à D99)"},
    ],
    "accesseurs": [
        {"nom": "[RUB].MT", "desc": "Attribut d'une autre rubrique (défaut .MT)"},
        {"nom": "#CONST",   "desc": "Constante de paie"},
    ],
    "instructions": [
        {"nom": "CIBLE = expr",              "desc": "Affectation"},
        {"nom": "SI <cond> ALORS CIBLE=expr","desc": "Affectation conditionnelle inline — n'exécute que si <cond> est vraie, poursuit ensuite à la ligne suivante"},
        {"nom": "SI <cond> ALORS <label>",   "desc": "Branchement conditionnel (label ou FIN)"},
        {"nom": "ALLER <label>",             "desc": "Branchement inconditionnel"},
        {"nom": "FIN",                       "desc": "Fin de traitement"},
    ],
    "operateurs": [
        {"nom": "+  -  *  /  %  -%",  "desc": "Arithmétique — % = pourcentage de (A%B = A×B/100) ; -% = diminué de x% (A-%B = A×(100−B)/100) ; modulo classique : MOD(a,b)"},
        {"nom": "=  <>  <  >  <=  >=", "desc": "Comparaison"},
        {"nom": "ET  OU  NON",         "desc": "Logique"},
    ],
}


def catalogue() -> dict:
    """Catalogue réel du moteur : seules les fonctions effectivement enregistrées
    sont exposées ; toute fonction ajoutée à FONCTIONS sans métadonnées apparaît
    quand même (avec une description vide) — le front reste ainsi toujours à jour."""
    connues = {f["nom"] for f in CATALOGUE}
    extra = [{"nom": n, "cat": "Autres", "signature": f"{n}(…)", "desc": ""}
             for n in sorted(FONCTIONS) if n not in connues]
    fns = [f for f in CATALOGUE if f["nom"] in FONCTIONS] + extra
    return {"fonctions": fns, "grammaire": GRAMMAIRE}


# =====================================================================
# 7) EXPLICATION EN LANGAGE NATUREL (pour l'infobulle du bulletin)
# =====================================================================
_LIB_ATTR = {"MT": "le montant", "NB": "le nombre", "TX": "le taux",
             "BASE": "la base", "DATE": "la date", "TEXTE": "le texte"}

_LIB_FONC = {
    "ARRONDI": "arrondi de", "TRONQUER": "troncature de", "MIN": "le plus petit de",
    "MAX": "le plus grand de", "ABS": "la valeur absolue de", "PLAFOND": "l'entier supérieur de",
    "PLANCHER": "l'entier inférieur de", "RACINE": "la racine carrée de", "MOD": "le reste de",
    "SI": "une valeur conditionnelle", "COALESCE": "la première valeur non vide",
    "ENTRE": "un test d'encadrement", "CUMUL": "le cumul annuel de", "PREC": "la valeur précédente de",
    "SOMME": "la somme des dernières périodes de", "MOYENNE": "la moyenne des dernières périodes de",
    "BAREME": "une recherche dans le barème", "DATEJOUR": "la date du jour",
    "DATEPAIE": "la date de paie", "ANNEES": "le nombre d'années entre deux dates",
    "JOURS": "le nombre de jours entre deux dates", "FINMOIS": "la fin du mois",
    # RG-DSL-VALEUR-KEYERROR-01 (Adil DAIA) : bug documenté depuis longtemps
    # (MODULE_PAIE.md §10) — VALEUR absente d'ici faisait planter tout calcul
    # de bulletin en 500 dès qu'une règle spécifique active l'utilisait
    # (_sources_libelle() la cite via le même regex que CUMUL/PREC/SOMME/
    # MOYENNE, ligne ~840, mais la clé n'existait pas). Contournement
    # jusqu'ici : remplacer VALEUR("CODE").ATTR par [CODE].ATTR dans les
    # règles existantes (strictement équivalent) — plus nécessaire pour les
    # nouvelles règles, mais les règles déjà contournées n'ont pas besoin
    # d'être remises en VALEUR(...).
    "VALEUR": "l'attribut de",
}


def _cible_libelle(c: str) -> str:
    c = c.upper()
    if c in _LIB_ATTR:
        return _LIB_ATTR[c]
    if re.fullmatch(r"R\d{2}", c): return f"le registre {c}"
    if re.fullmatch(r"T\d{2}", c): return f"le registre texte {c}"
    if re.fullmatch(r"D\d{2}", c): return f"le registre date {c}"
    return c


def _nom(code: str, libelles: dict | None, prefixe: str = "") -> str:
    """« CODE (Intitulé) » si l'intitulé est connu, sinon « CODE »."""
    lib = (libelles or {}).get(code.upper()) if libelles else None
    base = f"{prefixe}{code.upper()}"
    return f"{base} ({lib})" if lib else base


def _sources_libelle(expr: str, libelles: dict | None = None) -> list[str]:
    """Décrit les éléments référencés dans une expression (avec intitulés si connus).
    `libelles` = {"rubriques": {...}, "constantes": {...}, "baremes": {...}}"""
    L = libelles or {}
    out: list[str] = []
    for code, attr in re.findall(r"\[([A-Za-z0-9_]+)\](?:\.(MT|NB|TX|BASE|DATE|TEXTE))?", expr, re.I):
        a = (attr or "MT").upper()
        out.append(f"{_LIB_ATTR.get(a, a)} de la rubrique {_nom(code, L.get('rubriques'))}")
    for c in re.findall(r"#([A-Za-z0-9_]+)", expr):
        out.append(f"la constante {_nom(c, L.get('constantes'))}")
    # Fonctions "paie" : on cite la rubrique concernée -> « le cumul annuel de SALBASE »
    for f, code in re.findall(r'\b(CUMUL|PREC|SOMME|MOYENNE|VALEUR)\s*\(\s*"([A-Za-z0-9_]+)"', expr, re.I):
        out.append(f"{_LIB_FONC[f.upper()]} {_nom(code, L.get('rubriques'))}")
    for code in re.findall(r'\bBAREME\s*\(\s*"([A-Za-z0-9_]+)"', expr, re.I):
        out.append(f"une recherche dans le barème {_nom(code, L.get('baremes'))}")
    # Fonctions de calcul : mentionnées sans complément
    _SANS_COMP = {"ARRONDI", "TRONQUER", "MIN", "MAX", "ABS", "PLAFOND", "PLANCHER",
                  "RACINE", "MOD", "SI", "COALESCE", "ENTRE", "DATEJOUR", "DATEPAIE",
                  "ANNEES", "JOURS", "FINMOIS", "FINTRIMESTRE", "FINSEMESTRE", "FINANNEE",
                  "ESTFINMOIS", "ESTFINTRIMESTRE", "ESTFINSEMESTRE", "ESTFINANNEE", "ESTFINCONTRAT"}
    _NOM_FONC = {"ARRONDI": "un arrondi", "TRONQUER": "une troncature", "MIN": "un minimum",
                 "MAX": "un maximum", "ABS": "une valeur absolue", "PLAFOND": "un arrondi supérieur",
                 "PLANCHER": "un arrondi inférieur", "RACINE": "une racine carrée",
                 "MOD": "un reste de division", "SI": "une condition", "COALESCE": "une valeur par défaut",
                 "ENTRE": "un encadrement", "DATEJOUR": "la date du jour", "DATEPAIE": "la date de paie",
                 "ANNEES": "un écart en années", "JOURS": "un écart en jours", "FINMOIS": "une fin de mois",
                 "FINTRIMESTRE": "une fin de trimestre", "FINSEMESTRE": "une fin de semestre",
                 "FINANNEE": "une fin d'année", "ESTFINMOIS": "un test de fin de mois",
                 "ESTFINTRIMESTRE": "un test de fin de trimestre", "ESTFINSEMESTRE": "un test de fin de semestre",
                 "ESTFINANNEE": "un test de fin d'année", "ESTFINCONTRAT": "un test de fin de contrat"}
    for f in re.findall(r"\b([A-Z_]{2,})\s*\(", expr.upper()):
        if f in _SANS_COMP:
            out.append(_NOM_FONC[f])
    for reg in sorted(set(re.findall(r"\b([RTD]\d{2})\b", expr.upper()))):
        out.append(f"le registre {reg}")
    for a in sorted(set(re.findall(r"(?<![\w.\]#])(MT|NB|TX|BASE|DATE|TEXTE)\b", expr.upper()))):
        out.append(f"{_LIB_ATTR[a]} de la rubrique courante")
    # dédoublonnage en conservant l'ordre
    vus, res = set(), []
    for x in out:
        if x not in vus:
            vus.add(x); res.append(x)
    return res


def expliquer(instruction: str, libelles: dict | None = None) -> str:
    """Traduit une instruction du DSL en une phrase française.
    `libelles` : {"rubriques": {code: libelle}, "constantes": {...}, "baremes": {...}}"""
    instr = (instruction or "").strip()
    if not instr:
        return ""
    if _FIN_RE.match(instr):
        return "Arrête le traitement de la règle."
    m = _ALLER_RE.match(instr)
    if m:
        return f"Poursuit le traitement à l'étape « {m.group(1)} »."
    m = _SI_ASSIGN_RE.match(instr)
    if m:
        cond, cible, expr = m.group(1), m.group(2).upper(), m.group(3).strip()
        srcs_cond = _sources_libelle(cond, libelles)
        srcs_expr = _sources_libelle(expr, libelles)
        detail_cond = f" (utilise {', '.join(srcs_cond)})" if srcs_cond else ""
        detail_expr = f", en utilisant {', '.join(srcs_expr)}" if srcs_expr else ""
        return (f"Si la condition « {cond.strip()} » est vraie{detail_cond}, "
                f"calcule {_cible_libelle(cible)} à partir de « {expr} »{detail_expr}.")
    m = _SI_RE.match(instr)
    if m:
        cond, cible = m.group(1), m.group(2)
        srcs = _sources_libelle(cond, libelles)
        detail = f" (utilise {', '.join(srcs)})" if srcs else ""
        suite = "arrête la règle" if cible.upper() in ("FIN", "END", "STOP") else f"saute à « {cible} »"
        return f"Si la condition « {cond.strip()} » est vraie, {suite}{detail}."
    m = _ASSIGN_RE.match(instr)
    if m:
        cible, expr = m.group(1).upper(), m.group(2).strip()
        srcs = _sources_libelle(expr, libelles)
        base = f"Calcule {_cible_libelle(cible)} à partir de « {expr} »"
        return base + (f", en utilisant {', '.join(srcs)}." if srcs else ".")
    return "Instruction non reconnue."


def references(instructions: list[dict]) -> dict:
    """
    Extrait les références externes d'un programme (pour validation sémantique) :
    rubriques [CODE], constantes #CODE, barèmes BAREME("CODE"), et rubriques
    citées dans les fonctions de paie CUMUL/PREC/SOMME/MOYENNE/VALEUR("CODE").
    """
    rubs: set[str] = set()
    csts: set[str] = set()
    bars: set[str] = set()
    for i in instructions:
        src = (i.get("instruction") or "")
        if not src.strip() or src.strip().startswith("//"):
            continue
        rubs.update(m.upper() for m in re.findall(r"\[([A-Za-z0-9_]+)\]", src))
        csts.update(m.upper() for m in re.findall(r"#([A-Za-z0-9_]+)", src))
        bars.update(m.upper() for m in re.findall(r'\bBAREME\s*\(\s*"([A-Za-z0-9_]+)"', src, re.I))
        rubs.update(m.upper() for m in re.findall(
            r'\b(?:CUMUL|PREC|SOMME|MOYENNE|VALEUR)\s*\(\s*"([A-Za-z0-9_]+)"', src, re.I))
    return {"rubriques": sorted(rubs), "constantes": sorted(csts), "baremes": sorted(bars)}
