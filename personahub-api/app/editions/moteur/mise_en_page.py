"""
app/editions/moteur/mise_en_page.py — Des données et d'une définition à des pages abstraites.
Auteur : Adil DAIA — lot 1 de la plateforme d'éditions unifiée (16/10/2026)

La mise en page ne dessine rien : elle produit des `Page` faites de `Boite`
positionnées en millimètres (origine en haut à gauche), avec un texte déjà
formaté et découpé en lignes. Le PDF, l'aperçu HTML et, plus tard, l'Excel
« fidèle » dessinent ces mêmes pages : la pagination est identique partout.

Algorithme (une passe, plus une seconde pour NB_PAGES et les totaux d'état) :
  1. une page s'ouvre avec FOND, EN_TETE_PAGE, et EN_TETE_ETAT sur la première ;
     la hauteur du PIED_PAGE est réservée ;
  2. les lignes du jeu principal sont parcourues ; à chaque rupture de groupe,
     PIED_GROUPE puis EN_TETE_GROUPE ;
  3. chaque bande est découpée en TRANCHES verticales : un bloc d'éléments, ou
     l'en-tête, les titres de section, chaque ligne et la ligne de total d'un
     tableau ; une tranche ne se coupe jamais ;
  4. une tranche qui ne tient pas ouvre une nouvelle page ; l'en-tête du
     tableau y est répété (RG-EDT-RENDU-03) ; une bande `insecable` part
     entière sur la page suivante si elle y tient ;
  5. PIED_ETAT à la fin, PIED_PAGE sur chaque page.

RG-EDT-RENDU-03 (Adil DAIA) : un tableau coupé répète son en-tête de colonnes.
RG-EDT-RENDU-04 (Adil DAIA) : une erreur de formule au rendu n'arrête pas le
    document : la case affiche « #ERR » et l'anomalie est remontée.
RG-EDT-LIGNES-01 (Adil DAIA) : une section à plan explicite imprime ses rubriques
    dans l'ordre du plan : la ligne du bulletin si elle existe (quels que soient les
    filtres du jeu), sinon une ligne reconstituée depuis [CODE] (lignes NEUTRE,
    totaux d'en-tête) si une valeur est non nulle, ou si la rubrique est marquée
    « toujours ». Ses valeurs par colonne remplacent la formule de la colonne.
RG-EDT-DONNEES-01 à 05 (Adil DAIA) : les corps de données sont compilés une fois par
    ligne principale (bulletin) : un corps LIGNES donne une ligne par affectation dont
    une valeur affectée est non nulle (ou « nulle » cochée), dans l'ordre choisi ; un
    corps CASES additionne ses affectations dans ses cases. « en – » change le signe
    avant la somme. Les formules lisent corps.<corps>.<ligne>.<colonne> et var.<code>.
RG-EDT-DONNEES-06 (Adil DAIA) : des affectations « fusion » forment UNE ligne (somme ;
    « en – » soustrait) ; une ligne de formule s'imprime en gras sauf avis contraire.
RG-EDT-GRILLE-01 (Adil DAIA) : une grille est une zone fixe de lignes × colonnes,
    chaque case une formule évaluée dans le contexte du document (cumuls…).
RG-EDT-RENDU-05 (Adil DAIA) : agrégats — GROUPE = groupe en cours (le plus
    fin dans le corps) ; PAGE = lignes commencées sur la page ; REPORT = cumul
    depuis le début (en en-tête de page : le report des pages précédentes) ;
    ETAT = total final, connu dès la première page.
"""
from __future__ import annotations

import copy
import logging
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Callable, Optional

from app.editions import expressions as ex
from app.editions import format as fmt
from app.editions.definition import Bande, Corps, Definition, Grille, LigneRubrique, Style, Tableau
from app.editions.moteur import texte as tx

log = logging.getLogger(__name__)
ERREUR = "#ERR"


# =============================================================================
# Structures produites
# =============================================================================
@dataclass
class Boite:
    x: float
    y: float
    l: float
    h: float
    genre: str                       # TEXTE | LIGNE | CADRE | IMAGE | CODE_BARRE
    lignes: list[str] = field(default_factory=list)
    police: str = "Helvetica"
    taille: float = tx.TAILLE_DEFAUT
    style: Any = None                # definition.Style
    valeur: Any = None               # chemin d'image, contenu du QR
    ajustement: str = "CONTENIR"     # IMAGE
    rognage: Any = None              # IMAGE : definition.Rognage
    arrondi: float = 0               # CADRE : rayon des coins (mm)
    source_id: str = ""


@dataclass
class Page:
    numero: int
    boites: list[Boite] = field(default_factory=list)


@dataclass
class Anomalie:
    source_id: str
    message: str


@dataclass
class Tranche:
    hauteur: float
    boites: list[Boite]               # y relatif au haut de la tranche
    genre: str = "BLOC"               # BLOC | ENTETE_TABLEAU | LIGNE_TABLEAU
    tableau_id: Optional[str] = None


# =============================================================================
# Agrégats (RG-EDT-RENDU-05)
# =============================================================================
class Accumulateur:
    def __init__(self):
        self.somme: dict[str, Decimal] = {}
        self.nb: dict[str, int] = {}
        self.mini: dict[str, Any] = {}
        self.maxi: dict[str, Any] = {}

    def ajouter(self, cle: str, valeur: Any):
        if valeur is None or valeur == "":
            return
        self.nb[cle] = self.nb.get(cle, 0) + 1
        try:
            d = Decimal(str(valeur))
            self.somme[cle] = self.somme.get(cle, Decimal(0)) + d
            self.mini[cle] = d if cle not in self.mini else min(self.mini[cle], d)
            self.maxi[cle] = d if cle not in self.maxi else max(self.maxi[cle], d)
        except Exception:
            pass

    def valeur(self, fonction: str, cle: str) -> Any:
        if fonction == "TOTAL":
            return self.somme.get(cle, Decimal(0))
        if fonction == "NB":
            return Decimal(self.nb.get(cle, 0))
        if fonction == "MOYENNE_SUR":
            n = self.nb.get(cle, 0)
            return (self.somme.get(cle, Decimal(0)) / n) if n else None
        if fonction == "MIN_SUR":
            return self.mini.get(cle)
        if fonction == "MAX_SUR":
            return self.maxi.get(cle)
        return None


def specs_agregats(d: Definition) -> list[tuple[str, str, str, Any]]:
    """(fonction, clé, portée, arbre de l'expression) de tous les agrégats des bandes."""
    vus, specs = set(), []
    for bande in d.bandes:
        formules = [bande.condition] if bande.condition else []
        for el in bande.elements:
            if getattr(el, "condition", None):
                formules.append(el.condition.expression)
            if hasattr(el, "valeur") and not isinstance(el, Tableau):
                formules.append(el.valeur)
            if el.type == "TEXTE_RICHE":
                formules += [s for _, _, s in ex.extraire_variables(el.contenu)]
        for f in formules:
            try:
                arbre = ex.compiler(f)
            except ex.ErreurFormule:
                continue
            for n in _noeuds(arbre):
                if n[0] == "call" and n[1] in ex.AGREGATS and n[2]:
                    cle = ex.cle_expression(n[2][0])
                    if (n[1], cle) not in vus:
                        vus.add((n[1], cle))
                        specs.append((n[1], cle, "", n[2][0]))
    return specs


def _noeuds(n):
    yield n
    if isinstance(n, tuple):
        for x in n[1:]:
            if isinstance(x, tuple):
                yield from _noeuds(x)
            elif isinstance(x, list):
                for y in x:
                    if isinstance(y, tuple):
                        yield from _noeuds(y)


# =============================================================================
# Contexte de rendu d'un document
# =============================================================================
@dataclass
class Contexte:
    definition: Definition
    lignes: list[dict]                                  # jeu principal du document
    enfants: dict[str, dict[Any, list[dict]]]           # jeu secondaire → clé parent → lignes
    parametres: dict
    societe: dict
    constantes: dict
    rubriques: dict[str, dict]                          # bulletin_id → {code: {MT…}}
    contexte_fixe: dict = field(default_factory=dict)  # CHARTE.logo, ASSET.x, UTILISATEUR.nom
    registre_masques: Optional[dict] = None
    racine_fichiers: str = "storage"
    libelles_rubriques: dict = field(default_factory=dict)  # code → libellé d'édition (plans de lignes)
    parametrage_rubriques: dict = field(default_factory=dict)  # code → rubrique_paie (ne_editer_si_*)


def alias_corps(d) -> dict:
    """{corps (code ou libellé, minuscules): (code, {colonne (code ou libellé, minuscules): code})}.
    Un code l'emporte toujours sur un libellé homonyme."""
    def colonnes(c):
        cols = {col.libelle.strip().lower(): col.code for col in c.colonnes}
        cols.update({col.code.lower(): col.code for col in c.colonnes})
        return cols
    res = {c.libelle.strip().lower(): (c.code, colonnes(c)) for c in reversed(d.corps)}
    res.update({c.code.lower(): (c.code, colonnes(c)) for c in d.corps})
    return res


class Composeur:
    """Compose un document (un ensemble de lignes principales) en pages."""

    def __init__(self, ctx: Contexte):
        self.ctx = ctx
        self.d = ctx.definition
        self.page_l = self.d.page.largeur_utile()
        self.page_h = self.d.page.hauteur_utile()
        self.marge_haut, _, _, self.marge_gauche = self.d.page.marges
        self.principal = self.d.jeu_principal()
        self.specs = specs_agregats(self.d)
        self.anomalies: list[Anomalie] = []
        # RG-EDT-DONNEES-08 : TOTAL_CORPS accepte le code OU le libellé du corps et de la colonne
        self.ctx.contexte_fixe = {**self.ctx.contexte_fixe, "CORPS_ALIAS": alias_corps(self.d)}
        self.bandes = {t: [b for b in self.d.bandes if b.type == t] for t in
                       ("FOND", "EN_TETE_ETAT", "EN_TETE_PAGE", "EN_TETE_GROUPE", "CORPS",
                        "PIED_GROUPE", "PIED_PAGE", "PIED_ETAT")}
        self.niveaux = len(self.principal.groupes) if self.principal else 0
        self._cache_donnees: dict[int, dict] = {}
        self.totaux_etat = self._totaux_etat()

    # ---------------------------------------------------------------- évaluation
    def _resolver(self, ligne: Optional[dict], agregats: dict, page: Optional[int], nb_pages: Optional[int],
                  ligne_enfant: Optional[dict] = None, avec_donnees: bool = True) -> ex.ResolverEdition:
        base = dict(ligne or {})
        base["societe"] = self.ctx.societe
        if ligne and avec_donnees and (self.d.corps or self.d.variables):
            base.update(self._donnees(ligne))
        if ligne_enfant is not None:
            base = {**base, **ligne_enfant}
        periode = self.ctx.parametres.get("periode")
        date_paie = periode.get("date_fin") if isinstance(periode, dict) else None
        rub = self.ctx.rubriques.get(str((ligne or {}).get("id")), {}) if ligne else {}
        contexte = dict(self.ctx.contexte_fixe)
        if page is not None:
            contexte["PAGE"] = Decimal(page)
        contexte["NB_PAGES"] = Decimal(nb_pages) if nb_pages else "?"
        return ex.ResolverEdition(ligne=base, parametres=self.ctx.parametres, rubriques=rub,
                                  constantes=self.ctx.constantes, agregats=agregats,
                                  contexte=contexte, date_paie=date_paie)

    def _evaluer(self, src: str, r: ex.ResolverEdition, source_id: str) -> Any:
        try:
            return ex.evaluer(src, r)
        except ex.ErreurFormule as e:
            self.anomalies.append(Anomalie(source_id, e.message))
            return ERREUR

    def _texte(self, src: str, r, el, defaut_vide: Optional[str]) -> str:
        v = self._evaluer(src, r, el.id)
        if v == ERREUR:
            return ERREUR
        aff = getattr(el, "affichage", None)
        si_vide = aff.valeur_si_vide if aff and aff.valeur_si_vide is not None else defaut_vide
        return fmt.formater(v, aff.masque if aff else None, aff.texte_avant if aff else None,
                            aff.texte_apres if aff else None, si_vide, self.ctx.registre_masques)

    def _totaux_etat(self) -> dict:
        acc = Accumulateur()
        for ligne in self.ctx.lignes:
            r = self._resolver(ligne, {}, None, None)
            for fonction, cle, _, arbre in self.specs:
                try:
                    acc.ajouter(cle, ex.EvaluateurEdition(r).eval(arbre))
                except ex.ErreurFormule:
                    pass
        return {(f, cle, "ETAT"): acc.valeur(f, cle) for f, cle, _, _ in self.specs}

    # ---------------------------------------------------------------- éléments → boîtes
    def _style_police(self, style, texte: str) -> tuple[str, float]:
        # RG-EDT-PAGE-01 : à défaut de réglage sur l'objet, police et taille de l'état
        taille = style.taille or self.d.page.taille or tx.TAILLE_DEFAUT
        arabe = style.langue == "AR" or (style.langue == "AUTO" and tx.contient_arabe(texte))
        return tx.nom_police(style.police or self.d.page.police, bool(style.gras), bool(style.italique), arabe), taille

    def _boite_texte(self, el, texte: str, x: float, y: float) -> Boite:
        police, taille = self._style_police(el.style, texte)
        texte = tx.appliquer_casse(texte, el.style.casse)
        lignes = tx.decouper(texte, police, taille, el.l, multiligne=el.extensible or el.type == "TEXTE_RICHE")
        h = max(el.h, tx.hauteur_lignes_mm(len(lignes), taille)) if (el.extensible or el.type == "TEXTE_RICHE") else el.h
        return Boite(x, y, el.l, h, "TEXTE", lignes, police, taille, el.style, source_id=el.id)

    def _elements(self, bande: Bande, r: ex.ResolverEdition) -> list[Boite]:
        boites: list[Boite] = []
        for el in sorted(bande.elements, key=lambda e: e.calque):
            if isinstance(el, Tableau):
                continue
            vide_force = False
            if el.condition:
                ok = self._evaluer(el.condition.expression, r, el.id)
                if ok == ERREUR or not _vrai(ok):
                    if el.condition.sinon == "MASQUER" and ok != ERREUR:
                        continue
                    vide_force = True
            if el.type in ("TEXTE", "CHAMP"):
                defaut = "" if el.type == "TEXTE" else None
                t = "" if vide_force else self._texte(el.valeur, r, el, defaut)
                boites.append(self._boite_texte(el, t, el.x, el.y))
            elif el.type == "TEXTE_RICHE":
                try:
                    t = "" if vide_force else ex.interpoler(el.contenu, r)
                except ex.ErreurFormule as e:
                    self.anomalies.append(Anomalie(el.id, e.message))
                    t = ERREUR
                boites.append(self._boite_texte(el, t, el.x, el.y))
            elif el.type in ("LIGNE", "CADRE"):
                boites.append(Boite(el.x, el.y, el.l, el.h, el.type, style=el.style, source_id=el.id,
                                    arrondi=getattr(el, "arrondi", 0) or 0))
            elif el.type == "IMAGE":
                v = None if vide_force else self._evaluer(el.valeur, r, el.id)
                if v not in (None, "", ERREUR):
                    boites.append(Boite(el.x, el.y, el.l, el.h, "IMAGE", style=el.style, valeur=str(v),
                                        source_id=el.id, ajustement=el.ajustement, rognage=el.rognage))
            elif el.type == "GRILLE":
                boites += self._grille(el, r, vide_force)
            elif el.type == "CODE_BARRE":
                v = None if vide_force else self._evaluer(el.valeur, r, el.id)
                if v not in (None, "", ERREUR):
                    boites.append(Boite(el.x, el.y, el.l, el.h, "CODE_BARRE", style=el.style,
                                        valeur=fmt.texte_par_defaut(v), source_id=el.id))
        return boites

    def _grille(self, g: Grille, r: ex.ResolverEdition, vide: bool) -> list[Boite]:
        """RG-EDT-GRILLE-01 : en-tête de colonnes, titres de lignes, une formule par case.
        RG-EDT-GRILLE-02 : avec « retour à la ligne », un texte trop long passe sur plusieurs
        lignes et toute la rangée prend la hauteur de sa case la plus haute."""
        boites: list[Boite] = []
        hl = g.hauteur_ligne
        bord_tete = "TOUT" if g.quadrillage != "AUCUN" else None
        bord = {"COMPLET": "TOUT", "COLONNES": "G,D", "AUCUN": None}[g.quadrillage]

        def preparer(x, l, txt, style, *, gras=False, fond=None, alignement=None, bordures=None, sur=None):
            """Une case : style final (case > style de rangée > défauts > style de la grille) et lignes."""
            maj = {k: v for k, v in (("gras", gras or style.gras), ("fond", fond or style.fond),
                                     ("alignement", style.alignement or alignement), ("bordures", style.bordures or bordures))
                   if v is not None}
            if sur is not None:                                  # style d'en-tête / de titres choisi
                maj.update({k: v for k, v in sur.model_dump(exclude_defaults=True).items() if getattr(style, k) is None})
            for k in ("police", "taille", "couleur"):            # RG-EDT-RENDU-02 : héritées de la grille
                if maj.get(k) is None and getattr(style, k) is None and getattr(g.style, k) is not None:
                    maj[k] = getattr(g.style, k)
            st = style.model_copy(update=maj)
            police, taille = self._style_police(st, txt)
            lignes = tx.decouper(tx.appliquer_casse(txt, st.casse), police, taille, max(l - 1.6, 1), multiligne=g.retour_ligne)
            return (x, l, lignes, police, taille, st)

        def poser(rangee, y) -> float:
            h = max([hl] + [tx.hauteur_lignes_mm(len(c[2]), c[4]) + 1.2 for c in rangee if g.retour_ligne])
            for x, l, lignes, police, taille, st in rangee:
                boites.append(Boite(x, y, l, h, "TEXTE", lignes, police, taille, st, source_id=g.id))
            return h

        y = g.y
        if g.entete:
            x, rangee = g.x, []
            if g.largeur_titres:
                rangee.append(preparer(x, g.largeur_titres, "", g.style))
                x += g.largeur_titres
            for c in g.colonnes:
                rangee.append(preparer(x, c.largeur, c.titre, c.style, gras=True, fond="#E8E8E8", alignement="CENTRE",
                                       bordures=bord_tete, sur=g.style_entete))
                x += c.largeur
            y += poser(rangee, y)
        for i, lg in enumerate(g.lignes):
            x, rangee = g.x, []
            dernier = i == len(g.lignes) - 1
            bord_l = "G,D,B" if (bord == "G,D" and dernier) else bord
            if g.largeur_titres:
                rangee.append(preparer(x, g.largeur_titres, lg.titre, lg.style, gras=True, fond="#F4F4F4",
                                       bordures=bord_tete or bord_l, sur=g.style_titres))
                x += g.largeur_titres
            for c in g.colonnes:
                expr = lg.valeurs.get(c.id)
                if vide or not expr:
                    txt, v = "", None
                else:
                    v = self._evaluer(expr, r, f"{g.id}.{lg.id}.{c.id}")
                    txt = ERREUR if v == ERREUR else fmt.formater(
                        v, c.affichage.masque, c.affichage.texte_avant, c.affichage.texte_apres,
                        c.affichage.valeur_si_vide if c.affichage.valeur_si_vide is not None else "",
                        self.ctx.registre_masques)
                numerique = isinstance(v, (Decimal, int, float)) and not isinstance(v, bool)
                st = c.style.model_copy(update={k: val for k, val in lg.style.model_dump(exclude_defaults=True).items()})
                rangee.append(preparer(x, c.largeur, txt, st, alignement="DROITE" if numerique else "CENTRE", bordures=bord_l))
                x += c.largeur
            y += poser(rangee, y)
        return boites

    # ---------------------------------------------------------------- données : corps et variables
    def _donnees(self, ligne: dict) -> dict:
        """RG-EDT-DONNEES : corps et variables d'une ligne principale, calculés une fois."""
        cle = id(ligne)
        if cle in self._cache_donnees:
            return self._cache_donnees[cle]
        resultat: dict = {"corps": {}, "var": {}}
        self._cache_donnees[cle] = resultat                     # garde-fou contre une référence circulaire
        rub = self.ctx.rubriques.get(str(ligne.get("id")), {})
        r = self._resolver(ligne, {}, None, None, avec_donnees=False)
        r.ligne["corps"] = resultat["corps"]                     # TOTAL_CORPS lit les corps déjà calculés
        for c in self.d.corps:
            resultat["corps"][c.code] = self._compiler_corps(c, rub, r)
        for v in self.d.variables:                              # dans l'ordre : une variable lit les précédentes
            r.ligne["var"] = resultat["var"]
            resultat["var"][v.code] = self._evaluer(v.valeur, r, f"var.{v.code}")
        return resultat

    _ATTRIBUTS = {"MOIS": {"NB": "NB", "MT": "MT", "TX": "TX", "BASE": "BASE", "PAT": "PAT", "TXP": "TXP"},
                  "CUMUL": {"NB": "CNB", "MT": "CMT", "BASE": "CBASE", "PAT": "CPAT"}}   # RG-PAIE-PATRONAL-02

    def _valeur_affectee(self, c: Corps, a, attribut: str, rub: dict, r) -> Any:
        if a.formule:
            v = self._evaluer(a.formule, r, f"corps.{c.code}")
            if v == ERREUR:
                return None
        else:
            cle = self._ATTRIBUTS[a.periode].get(attribut)
            v = (rub.get(a.rubrique.strip().upper()) or {}).get(cle) if cle and a.rubrique else None
        if v is None or v == "":
            return None
        if a.negatif:
            try:
                return -Decimal(str(v))
            except Exception:
                return v
        return v

    @staticmethod
    def _non_nul(v: Any) -> bool:
        if v is None or v == "":
            return False
        try:
            return Decimal(str(v)) != 0
        except Exception:
            return True

    @staticmethod
    def _ajouter(actuel: Any, v: Any) -> Any:
        if actuel is None:
            return v
        try:
            return Decimal(str(actuel)) + Decimal(str(v))      # RG-EDT-DONNEES-04 : somme
        except Exception:
            return v

    def _compiler_corps(self, c: Corps, rub: dict, r) -> Any:
        if c.nature == "CASES":
            cases: dict[str, dict[str, Any]] = {l.code: {col.code: None for col in c.colonnes} for l in c.lignes}
            for a in c.affectations:
                for attribut, cible in a.cibles.items():
                    ligne_code, _, col_code = cible.partition(".")
                    if ligne_code not in cases or col_code not in cases[ligne_code]:
                        continue
                    v = self._valeur_affectee(c, a, attribut, rub, r)
                    if v is not None:
                        cases[ligne_code][col_code] = self._ajouter(cases[ligne_code][col_code], v)
            return cases
        # RG-EDT-DONNEES-06 : une affectation « fusion » s'ajoute à la ligne précédente (une ligne imprimée) :
        # rubrique avec rubrique (valeurs additionnées), formule avec formule (une colonne chacune)
        blocs: list[list[tuple[int, Any]]] = []
        for i, a in enumerate(c.affectations):
            if a.fusion and blocs and bool(a.formule) == bool(blocs[-1][0][1].formule):
                blocs[-1].append((i, a))
            else:
                blocs.append([(i, a)])

        def construire(bloc) -> Optional[dict]:
            i0, a0 = bloc[0]
            code0 = (a0.rubrique or "").strip().upper()
            ligne = {"code_rubrique": "+".join((a.rubrique or "").strip().upper() for _, a in bloc if a.rubrique),
                     "groupe": a0.groupe, "_rang": i0, "_gras": a0.gras if a0.gras is not None else bool(a0.formule),
                     "libelle": a0.libelle or (self.ctx.libelles_rubriques.get(code0) or code0 if code0 else "")}
            utile = present = False
            for _, a in bloc:
                for attribut, col in a.cibles.items():
                    v = self._valeur_affectee(c, a, attribut, rub, r)
                    if v is None or v == "":
                        continue
                    present = True
                    ligne[col] = self._ajouter(ligne.get(col), v)
                    utile = utile or self._non_nul(v)
            # RG-EDT-DONNEES-05 : aucune valeur dans les attributs affectés → jamais imprimée,
            # même « Nulls » ; « Nulls » n'imprime que des valeurs à zéro
            if not present:
                return None
            if any(a.nulle for _, a in bloc):
                return ligne
            # RG-EDT-DONNEES-05 : paramétrage de la rubrique, pour une ligne d'une seule rubrique du mois
            if len(bloc) == 1 and not a0.formule and a0.periode == "MOIS" and code0:
                param = self.ctx.parametrage_rubriques.get(code0, {})
                mois = rub.get(code0) or {}
                if (param.get("ne_editer_si_mt_zero") and not self._non_nul(mois.get("MT"))) \
                        or (param.get("ne_editer_si_nb_zero") and not self._non_nul(mois.get("NB"))) \
                        or (param.get("ne_editer_si_ty_zero") and not self._non_nul(mois.get("TX"))):
                    return None
            # une ligne fusionnée s'imprime si son résultat est non nul
            if len(bloc) > 1:
                return ligne if any(self._non_nul(ligne.get(col)) for col in {c2 for _, a in bloc for c2 in a.cibles.values()}) else None
            return ligne if utile else None

        lignes = [l for b in blocs if not b[0][1].formule for l in [construire(b)] if l is not None]
        formules = [b for b in blocs if b[0][1].formule]
        if formules:
            r.ligne.setdefault("corps", {})[c.code] = list(lignes)   # provisoire : les lignes de rubriques
            lignes += [l for b in formules for l in [construire(b)] if l is not None]
            lignes.sort(key=lambda l: l["_rang"])
        if c.tri == "CODE":
            lignes.sort(key=lambda l: (l["code_rubrique"], l["_rang"]))
        elif c.tri == "PAIE":
            lignes.sort(key=lambda l: ((rub.get(l["code_rubrique"]) or {}).get("ORDRE") is None,
                                       (rub.get(l["code_rubrique"]) or {}).get("ORDRE") or 0, l["_rang"]))
        return lignes

    # ---------------------------------------------------------------- bande → tranches
    def _tranches(self, bande: Bande, ligne: Optional[dict], agregats: dict, page: int,
                  nb_pages: Optional[int]) -> list[Tranche]:
        r = self._resolver(ligne, agregats, page, nb_pages)
        if bande.condition:
            ok = self._evaluer(bande.condition, r, bande.id)
            if ok != ERREUR and not _vrai(ok):
                return []
        boites = self._elements(bande, r)
        tableaux = [e for e in bande.elements if isinstance(e, Tableau)]
        # croissance des éléments extensibles : décale ce qui est dessous
        boites = _etirer(boites, bande)
        if not tableaux:
            bas = max([b.y + b.h for b in boites] + [bande.hauteur])
            hauteur = bas if bande.extensible else bande.hauteur
            return [Tranche(hauteur, boites)]
        # un seul tableau par bande au lot 1 : au-dessus, le tableau, en dessous
        tab = tableaux[0]
        dessus = [b for b in boites if b.y < tab.y]
        dessous = [b for b in boites if b.y >= tab.y]
        tranches = [Tranche(tab.y, dessus)] if (dessus or tab.y > 0) else []
        tranches += self._tranches_tableau(tab, ligne, r, page, nb_pages)
        if dessous:
            haut = min(b.y for b in dessous)
            decale = haut - (tab.y + tab.h)
            for b in dessous:
                b.y -= haut
            bas = max(b.y + b.h for b in dessous)
            tranches.append(Tranche(max(decale, 0) + bas, [_decaler(b, max(decale, 0)) for b in dessous]))
        return tranches

    def _lignes_plan(self, sec, lignes: list[dict], rub: dict) -> list[tuple[dict, LigneRubrique, Optional[dict]]]:
        """RG-EDT-LIGNES-01 : (ligne à imprimer, entrée du plan, ligne d'origine ou None)."""
        res = []
        for lr in sec.rubriques:
            code = lr.code.strip().upper()
            trouvees = [l for l in lignes if str(l.get("code_rubrique") or "").strip().upper() == code]
            if trouvees:
                for l in trouvees:
                    res.append(({**l, "libelle": lr.libelle or l.get("libelle")}, lr, l))
                continue
            v = rub.get(code) or {}
            present = any(v.get(k) is not None and Decimal(str(v[k])) != 0 for k in ("MT", "NB", "BASE", "PAT", "TX"))
            if present or lr.toujours:
                res.append(({"code_rubrique": code,
                             "libelle": lr.libelle or self.ctx.libelles_rubriques.get(code) or code,
                             "montant": v.get("MT"), "nombre": v.get("NB"), "taux": v.get("TX"),
                             "base": v.get("BASE"), "montant_patronal": v.get("PAT"), "sens": None},
                            lr, None))
        return res

    def _tranches_tableau(self, tab: Tableau, ligne: Optional[dict], r_parent, page, nb_pages) -> list[Tranche]:
        if tab.corps:                                           # RG-EDT-DONNEES-01
            lignes = []
            if ligne:
                donnees = self._donnees(ligne)["corps"]
                for code in [tab.corps, *tab.corps_suivants]:
                    cp = self.d.corps_par_code(code)
                    titre = (cp.libelle if cp else code) if (cp is None or cp.afficher_titre) else None
                    for l in donnees.get(code) or []:
                        lignes.append({**l, "groupe": l.get("groupe") or titre})
            cle = (ligne or {}).get("id")
        else:
            jeu = self.d.jeu(tab.jeu)
            cle = (ligne or {}).get("id") if jeu else None
            lignes = self.ctx.enfants.get(tab.jeu, {}).get(cle, []) if cle is not None else []
        rub = self.ctx.rubriques.get(str(cle), {}) if cle is not None else {}
        colonnes = [c for c in tab.colonnes if not c.masquee]
        hl = tab.hauteur_ligne
        x0 = tab.x
        bord = {"COMPLET": "TOUT", "COLONNES": "G,D", "AUCUN": None}[tab.quadrillage]

        def rangee(cellules: list[tuple[Any, str]], gras=False, fond=None, genre="LIGNE_TABLEAU",
                   style_ligne=None, bordures=None) -> Tranche:
            boites, x, hauteur = [], x0, hl
            prepares = []
            for col, txt in cellules:
                maj = {"gras": gras or col.style.gras, "fond": fond or col.style.fond}
                # RG-EDT-RENDU-02 : police et taille du tableau, sauf si la colonne a les siennes
                for k in ("police", "taille", "couleur"):
                    if getattr(col.style, k) is None and getattr(tab.style, k) is not None:
                        maj[k] = getattr(tab.style, k)
                if col.style.alignement is None and _colonne_numerique(col):
                    maj["alignement"] = "DROITE"            # RG-EDT-RENDU-06
                if bordures or bord:
                    maj["bordures"] = col.style.bordures or bordures or bord
                if style_ligne is not None:
                    maj.update({k: v for k, v in style_ligne.model_dump(exclude_defaults=True).items()
                                if k not in ("alignement",) or v})
                style = col.style.model_copy(update=maj)
                police, taille = self._style_police(style, txt)
                lignes_txt = tx.decouper(tx.appliquer_casse(txt, style.casse), police, taille, max(col.largeur - 1.6, 1), multiligne=True)
                hauteur = max(hauteur, tx.hauteur_lignes_mm(len(lignes_txt), taille) + 1.2)
                prepares.append((col, lignes_txt, police, taille, style))
            for col, lignes_txt, police, taille, style in prepares:
                boites.append(Boite(x, 0, col.largeur, hauteur, "TEXTE", lignes_txt, police, taille, style,
                                    source_id=col.id))
                x += col.largeur
            return Tranche(hauteur, boites, genre, tab.id)

        def titre_section(titre: str) -> Tranche:
            t = colonnes[0].model_copy(update={"largeur": sum(c.largeur for c in colonnes)})
            return rangee([(t, titre)], gras=True, fond="#F4F4F4", bordures="TOUT" if bord else None)

        tranches = [rangee([(c, c.titre) for c in colonnes], gras=True, fond="#E8E8E8", genre="ENTETE_TABLEAU",
                           bordures="TOUT" if bord else None, style_ligne=tab.style_entete)] if tab.entete else []
        totaux = Accumulateur()
        nb_lignes = 0
        imprimees: set[int] = set()

        def imprimer(entrees, sous_totaux: Accumulateur):
            nonlocal nb_lignes
            for l, lr, origine in entrees:
                r = self._resolver(ligne, {}, page, nb_pages, l)
                cellules = []
                for c in colonnes:
                    expr = lr.valeurs.get(c.id, c.valeur) if lr is not None else c.valeur
                    v = self._evaluer(expr, r, c.id) if expr else None
                    if c.total != "AUCUN" and v not in (ERREUR, None):
                        totaux.ajouter(c.id, v)
                        sous_totaux.ajouter(c.id, v)
                    t = ERREUR if v == ERREUR else fmt.formater(
                        v, c.affichage.masque, c.affichage.texte_avant, c.affichage.texte_apres,
                        c.affichage.valeur_si_vide if c.affichage.valeur_si_vide is not None else "",
                        self.ctx.registre_masques)
                    cellules.append((c, t))
                fond = "#FAFAFA" if tab.zebre and nb_lignes % 2 else None
                style_l = lr.style if lr is not None else (Style(gras=True) if l.get("_gras") else None)
                tranches.append(rangee(cellules, fond=fond, style_ligne=style_l))
                nb_lignes += 1
                imprimees.add(id(origine if origine is not None else l))

        if tab.corps and not tab.sections and tab.grouper:
            # un titre par groupe d'affectations, dans l'ordre de première apparition
            ordre: list = []
            for l in lignes:
                if l.get("groupe") not in ordre:
                    ordre.append(l.get("groupe"))
            for g in ordre:
                du_groupe = [(l, None, l) for l in lignes if l.get("groupe") == g]
                if g:
                    tranches.append(titre_section(g))
                imprimer(du_groupe, Accumulateur())
            lignes_traitees = True
        else:
            lignes_traitees = False
        sections = [] if lignes_traitees else (list(tab.sections) or [None])
        for sec in sections:
            sous_totaux = Accumulateur()
            if sec is None:
                entrees = [(l, None, l) for l in lignes]
            elif sec.rubriques:
                entrees = self._lignes_plan(sec, lignes, rub)
            elif sec.filtre:
                entrees = [(l, None, l) for l in lignes if _vrai(self._evaluer(
                    sec.filtre, self._resolver(ligne, {}, page, nb_pages, l), sec.id))]
            else:
                entrees = [(l, None, l) for l in lignes]
            if not entrees:
                continue
            if sec is not None and sec.titre:
                tranches.append(titre_section(sec.titre))
            imprimer(entrees, sous_totaux)
            if sec is not None and sec.sous_total:
                tranches.append(rangee(self._ligne_totaux(colonnes, sous_totaux, f"Total {sec.titre or ''}".strip()),
                                       gras=True))
        # lignes restées hors des sections (RG-EDT-LIGNES-01)
        if tab.sections and tab.section_autres is not None:
            restes = [(l, None, l) for l in lignes if id(l) not in imprimees]
            if restes:
                if tab.section_autres:
                    tranches.append(titre_section(tab.section_autres))
                imprimer(restes, Accumulateur())
        # bulletin « formulaire » : lignes vides jusqu'au minimum
        for i in range(max(0, tab.lignes_min - nb_lignes)):
            fond = "#FAFAFA" if tab.zebre and (nb_lignes + i) % 2 else None
            tranches.append(rangee([(c, "") for c in colonnes], fond=fond))
        # quadrillage par colonnes : la dernière ligne ferme le tableau
        if bord == "G,D" and tranches and tranches[-1].genre != "ENTETE_TABLEAU":
            dernier = tranches[-1]
            dernier.boites = [copy.copy(b) for b in dernier.boites]
            for b in dernier.boites:
                b.style = b.style.model_copy(update={"bordures": "G,D,B"})
        if tab.ligne_total and any(c.total != "AUCUN" for c in colonnes):
            tranches.append(rangee(self._ligne_totaux(colonnes, totaux, "Total"), gras=True, fond="#E8E8E8",
                                   bordures="TOUT" if bord else None))
        return tranches

    def _ligne_totaux(self, colonnes, acc: Accumulateur, libelle: str):
        fonctions = {"SOMME": "TOTAL", "NB": "NB", "MOYENNE": "MOYENNE_SUR"}
        cellules = []
        for i, c in enumerate(colonnes):
            if c.total != "AUCUN":
                v = acc.valeur(fonctions[c.total], c.id)
                cellules.append((c, fmt.formater(v, c.affichage.masque or "MONTANT", valeur_si_vide="",
                                                 registre=self.ctx.registre_masques)))
            else:
                cellules.append((c, libelle if i == 0 else ""))
        return cellules

    # ---------------------------------------------------------------- composition
    def composer(self, nb_pages: Optional[int] = None) -> list[Page]:
        self.anomalies = []
        pages: list[Page] = []
        etat = Accumulateur()
        page_acc = Accumulateur()
        groupes = [Accumulateur() for _ in range(self.niveaux)]
        h_pied = sum(b.hauteur for b in self.bandes["PIED_PAGE"])
        etat_courant = {"page": None, "y": 0.0, "ligne": None}

        def agregats(niveau_groupe: Optional[int] = None) -> dict:
            a = dict(self.totaux_etat)
            g = groupes[(niveau_groupe or self.niveaux) - 1] if self.niveaux else None
            for f, cle, _, _ in self.specs:
                a[(f, cle, "REPORT")] = etat.valeur(f, cle)
                a[(f, cle, "PAGE")] = page_acc.valeur(f, cle)
                a[(f, cle, "GROUPE")] = (g or etat).valeur(f, cle)
            return a

        def placer(tranche: Tranche):
            page = etat_courant["page"]
            for b in tranche.boites:
                nb = copy.copy(b)
                nb.x += self.marge_gauche
                nb.y += self.marge_haut + etat_courant["y"]
                page.boites.append(nb)
            etat_courant["y"] += tranche.hauteur

        def fermer_page():
            page = etat_courant["page"]
            y_pied = self.page_h - h_pied
            for bande in self.bandes["PIED_PAGE"]:
                for t in self._tranches(bande, etat_courant["ligne"], agregats(), page.numero, nb_pages):
                    for b in t.boites:
                        nb = copy.copy(b)
                        nb.x += self.marge_gauche
                        nb.y += self.marge_haut + y_pied
                        page.boites.append(nb)
                    y_pied += t.hauteur

        def ouvrir_page():
            if etat_courant["page"] is not None:
                fermer_page()
            page = Page(len(pages) + 1)
            pages.append(page)
            etat_courant["page"], etat_courant["y"] = page, 0.0
            page_acc.__init__()
            for bande in self.bandes["FOND"]:
                for t in self._tranches(bande, etat_courant["ligne"], agregats(), page.numero, nb_pages):
                    for b in t.boites:
                        nb = copy.copy(b)
                        nb.x += self.marge_gauche
                        nb.y += self.marge_haut
                        page.boites.insert(0, nb)
            if page.numero == 1:
                for bande in self.bandes["EN_TETE_ETAT"]:
                    for t in self._tranches(bande, etat_courant["ligne"], agregats(), 1, nb_pages):
                        placer(t)
            for bande in self.bandes["EN_TETE_PAGE"]:
                for t in self._tranches(bande, etat_courant["ligne"], agregats(), page.numero, nb_pages):
                    placer(t)

        def reste() -> float:
            return self.page_h - h_pied - etat_courant["y"]

        def placer_bande(bande: Bande, ligne: Optional[dict], niveau: Optional[int] = None):
            if bande.saut_avant and etat_courant["y"] > 0:
                ouvrir_page()
            tranches = self._tranches(bande, ligne, agregats(niveau), etat_courant["page"].numero, nb_pages)
            total = sum(t.hauteur for t in tranches)
            if bande.insecable and total > reste() and total <= self.page_h - h_pied:
                ouvrir_page()
                tranches = self._tranches(bande, ligne, agregats(niveau), etat_courant["page"].numero, nb_pages)
            entete_tab: dict[str, Tranche] = {}
            for t in tranches:
                if t.genre == "ENTETE_TABLEAU":
                    entete_tab[t.tableau_id] = t
                    # un en-tête seul en bas de page part avec sa première ligne
                    if t.hauteur * 2 > reste():
                        ouvrir_page()
                elif t.hauteur > reste():
                    ouvrir_page()
                    if t.genre == "LIGNE_TABLEAU" and t.tableau_id in entete_tab:
                        placer(entete_tab[t.tableau_id])           # RG-EDT-RENDU-03
                placer(t)
            if bande.saut_apres:
                etat_courant["saut"] = True

        # ---- déroulé
        lignes = self.ctx.lignes or [None]
        etat_courant["ligne"] = lignes[0]
        ouvrir_page()
        precedent: Optional[tuple] = None
        precedent_ligne: Optional[dict] = None
        for ligne in lignes:
            if etat_courant.pop("saut", False):
                ouvrir_page()
            etat_courant["ligne"] = ligne
            cles = tuple(_valeur_groupe(ligne, g) for g in (self.principal.groupes if self.principal else []))
            if precedent is not None and cles != precedent:
                rupture = next(i for i in range(self.niveaux) if cles[i] != precedent[i])
                for niveau in range(self.niveaux, rupture, -1):
                    for b in self.bandes["PIED_GROUPE"]:
                        if b.niveau_groupe == niveau:
                            placer_bande(b, precedent_ligne, niveau)
                for niveau in range(rupture + 1, self.niveaux + 1):
                    groupes[niveau - 1].__init__()
            if ligne is not None:
                r = self._resolver(ligne, {}, None, None)
                for f, cle, _, arbre in self.specs:
                    try:
                        v = ex.EvaluateurEdition(r).eval(arbre)
                    except ex.ErreurFormule:
                        continue
                    etat.ajouter(cle, v)
                    page_acc.ajouter(cle, v)
                    for g in groupes:
                        g.ajouter(cle, v)
            if precedent is None or cles != precedent:
                debut = 0 if precedent is None else next(i for i in range(self.niveaux) if cles[i] != precedent[i])
                for niveau in range(debut + 1, self.niveaux + 1):
                    for b in self.bandes["EN_TETE_GROUPE"]:
                        if b.niveau_groupe == niveau:
                            placer_bande(b, ligne, niveau)
            for b in self.bandes["CORPS"]:
                placer_bande(b, ligne)
            precedent, precedent_ligne = cles, ligne
        etat_courant.pop("saut", None)
        if precedent is not None:
            for niveau in range(self.niveaux, 0, -1):
                for b in self.bandes["PIED_GROUPE"]:
                    if b.niveau_groupe == niveau:
                        placer_bande(b, precedent_ligne, niveau)
        for b in self.bandes["PIED_ETAT"]:
            placer_bande(b, etat_courant["ligne"])
        fermer_page()
        return pages


def composer(ctx: Contexte) -> tuple[list[Page], list[Anomalie]]:
    """Deux passes : la première compte les pages, la seconde les imprime avec
    NB_PAGES connu (les formules de pagination tiennent sur une ligne : la
    pagination ne bouge pas entre les deux passes)."""
    c = Composeur(ctx)
    pages = c.composer(None)
    if _utilise_nb_pages(ctx.definition):
        pages = c.composer(len(pages))
    return pages, c.anomalies


# =============================================================================
# Utilitaires
# =============================================================================
def _vrai(v: Any) -> bool:
    if v is None or v == "" or v == ERREUR:
        return False
    if isinstance(v, bool):
        return v
    if isinstance(v, Decimal):
        return v != 0
    return bool(v)


def _valeur_groupe(ligne: Optional[dict], chemin: str) -> Any:
    if ligne is None:
        return None
    if chemin in ligne:
        return ligne[chemin]
    v: Any = ligne
    for p in chemin.split("."):
        v = v.get(p) if isinstance(v, dict) else None
    return v


MASQUES_NUMERIQUES = {"MONTANT", "MONTANT_SANS_ZERO", "ENTIER", "POURCENTAGE", "TAUX", "QUANTITE"}


def _colonne_numerique(col) -> bool:
    """RG-EDT-RENDU-06 (Adil DAIA) : une colonne numérique (masque numérique ou
    total) s'aligne à droite, titre compris, sauf alignement choisi."""
    masque = (col.affichage.masque or "").upper()
    return col.total != "AUCUN" or masque in MASQUES_NUMERIQUES


def _decaler(b: Boite, dy: float) -> Boite:
    b.y += dy
    return b


def _etirer(boites: list[Boite], bande: Bande) -> list[Boite]:
    """Un élément qui a grandi décale les éléments situés entièrement sous lui."""
    origine = {el.id: el for el in bande.elements}
    for b in sorted(boites, key=lambda x: x.y):
        el = origine.get(b.source_id)
        if el is None:
            continue
        croissance = b.h - el.h
        if croissance > 0:
            bas_initial = el.y + el.h
            for autre in boites:
                if autre is not b and autre.y >= bas_initial - 0.01:
                    autre.y += croissance
    return boites


def _utilise_nb_pages(d: Definition) -> bool:
    return "NB_PAGES" in d.json_canonique()
