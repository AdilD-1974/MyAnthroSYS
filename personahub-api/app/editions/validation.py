"""
app/editions/validation.py — Validation statique d'une définition et calcul de ses dépendances.
Auteur : Adil DAIA — lot 1 de la plateforme d'éditions unifiée (16/10/2026)

RG-EDT-VERSION-03 (Adil DAIA) : une version n'est publiable que si `valider()`
ne renvoie aucune erreur. Chaque erreur porte un CHEMIN dans la définition
(« bandes[2].elements[5].valeur ») et, pour une formule, la position fautive :
le designer met l'élément et le caractère en surbrillance.

Le catalogue est passé en argument (`CatalogueValidation`) : ce module ne lit
pas la base, il se teste seul. Le router le construit depuis edt_source_champ,
edt_source_relation, rubrique_paie, edt_masque et edt_asset.
"""
from __future__ import annotations

import fnmatch
import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Iterator, Optional

from pydantic import ValidationError

from app.editions import expressions as ex
from app.editions import format as fmt
from app.editions.definition import ATTRIBUTS_AFFECTABLES, COLONNES_EXERCICE, Definition, Grille, Jeu, Tableau, mettre_a_niveau

SOURCE_SOCIETE = "SOCIETE"
# totaux d'en-tête du bulletin, utilisables comme rubriques (cf. sources/paie.RUBRIQUES_EN_TETE)
RUBRIQUES_EN_TETE = {"NET_A_PAYER", "TOTAL_GAINS", "TOTAL_RETENUES", "TOTAL_BRUT", "BRUT_IMPOSABLE",
                     "NET_IMPOSABLE", "COUT_EMPLOYEUR", "COT_SALARIALES", "COT_PATRONALES"}
TYPES_ELEMENTS = {"TEXTE", "CHAMP", "TEXTE_RICHE", "IMAGE", "LIGNE", "CADRE", "CODE_BARRE", "TABLEAU", "GRILLE"}
TOLERANCE_MM = 0.01


@dataclass
class CatalogueValidation:
    # source → codes de champs ; « * » remplace un segment (regimes.*.date_affiliation)
    champs: dict[str, set[str]] = field(default_factory=dict)
    # (source, relation) → source cible
    relations: dict[tuple[str, str], str] = field(default_factory=dict)
    rubriques: Optional[set[str]] = None        # None = ne pas contrôler
    masques: Optional[set[str]] = None
    constantes: Optional[set[str]] = None

    def sources(self) -> set[str]:
        return set(self.champs)

    def champ_existe(self, source: str, code: str) -> bool:
        connus = self.champs.get(source, set())
        if code in connus:
            return True
        return any("*" in c and fnmatch.fnmatchcase(code, c) for c in connus)


@dataclass
class Erreur:
    chemin: str
    message: str
    debut: Optional[int] = None
    fin: Optional[int] = None

    def en_dict(self) -> dict:
        return {"chemin": self.chemin, "message": self.message, "debut": self.debut, "fin": self.fin}


@dataclass
class Rapport:
    erreurs: list[Erreur] = field(default_factory=list)
    dependances: set[tuple[str, str]] = field(default_factory=set)
    definition: Optional[Definition] = None

    @property
    def valide(self) -> bool:
        return not self.erreurs

    def ajouter(self, chemin: str, message: str, debut=None, fin=None):
        self.erreurs.append(Erreur(chemin, message, debut, fin))


# ---------------------------------------------------------------------------
# Parcours des formules : (chemin, formule, jeu de contexte, est_texte_a_variables)
# ---------------------------------------------------------------------------
def formules(d: Definition) -> Iterator[tuple[str, str, Optional[str], bool]]:
    principal = d.jeu_principal().code if d.jeu_principal() else None
    for i, p in enumerate(d.parametres):
        if p.defaut:
            yield f"parametres[{i}].defaut", p.defaut, None, False
    for i, j in enumerate(d.jeux):
        for k, f in enumerate(j.filtres):
            yield f"jeux[{i}].filtres[{k}]", f, j.code, False
        for k, c in enumerate(j.calculs):
            yield f"jeux[{i}].calculs[{k}].expression", c.expression, j.code, False
        if j.a_date:
            yield f"jeux[{i}].a_date", j.a_date, None, False
    for i, c in enumerate(d.corps):
        for k, a in enumerate(c.affectations):
            if a.formule:
                yield f"corps[{i}].affectations[{k}].formule", a.formule, principal, False
    for i, var in enumerate(d.variables):
        yield f"variables[{i}].valeur", var.valeur, principal, False
    if d.page.filigrane:
        yield "page.filigrane", d.page.filigrane, None, False
    for b, bande in enumerate(d.bandes):
        base = f"bandes[{b}]"
        if bande.condition:
            yield f"{base}.condition", bande.condition, principal, False
        for e, el in enumerate(bande.elements):
            eb = f"{base}.elements[{e}]"
            if el.condition:
                yield f"{eb}.condition.expression", el.condition.expression, principal, False
            if el.type == "TEXTE_RICHE":
                yield f"{eb}.contenu", el.contenu, principal, True
            elif hasattr(el, "valeur"):
                yield f"{eb}.valeur", el.valeur, principal, False
            if isinstance(el, Tableau):
                ctx_t = f"corps:{','.join([el.corps, *el.corps_suivants])}" if el.corps else el.jeu
                for c, col in enumerate(el.colonnes):
                    yield f"{eb}.colonnes[{c}].valeur", col.valeur, ctx_t, False
                for s, sec in enumerate(el.sections):
                    if sec.filtre and not sec.rubriques:
                        yield f"{eb}.sections[{s}].filtre", sec.filtre, ctx_t, False
                    for k, lr in enumerate(sec.rubriques):
                        for col_id, expr in lr.valeurs.items():
                            yield f"{eb}.sections[{s}].rubriques[{k}].valeurs.{col_id}", expr, ctx_t, False
            if isinstance(el, Grille):
                for k, lg in enumerate(el.lignes):
                    for col_id, expr in lg.valeurs.items():
                        yield f"{eb}.lignes[{k}].valeurs.{col_id}", expr, principal, False
    yield "sortie.nom_fichier", d.sortie.nom_fichier, principal, False


def _champs_du_jeu(d: Definition, cat: CatalogueValidation, code_jeu: Optional[str]) -> tuple[Optional[str], set[str]]:
    """Source du jeu et noms de ses calculs (utilisables comme champs)."""
    if code_jeu is None:
        return None, set()
    j = d.jeu(code_jeu)
    if j is None:
        return None, set()
    return j.source, {c.code for c in j.calculs}


def _champ_ok(d: Definition, cat: CatalogueValidation, code_jeu: Optional[str], champ: str) -> bool:
    # données de l'état : variables et cases des corps (RG-EDT-DONNEES-01)
    if champ.startswith("var."):
        return champ[4:] in {v.code for v in d.variables}
    if champ.startswith("corps."):
        p = champ.split(".")
        c = d.corps_par_code(p[1]) if len(p) > 1 else None
        return (c is not None and c.nature == "CASES" and len(p) == 4
                and p[2] in {l.code for l in c.lignes} and p[3] in {col.code for col in c.colonnes})
    if code_jeu and code_jeu.startswith("corps:"):
        cols = {col.code for code in code_jeu[6:].split(",") for c in [d.corps_par_code(code)] if c for col in c.colonnes}
        if champ in {"code_rubrique", "libelle", "groupe"} | cols:
            return True
        principal = d.jeu_principal()                      # la ligne du bulletin reste lisible
        code_jeu = principal.code if principal else None
    source, calculs = _champs_du_jeu(d, cat, code_jeu)
    if champ in calculs:
        return True
    if source and cat.champ_existe(source, champ):
        return True
    # société active : toujours disponible sous le préfixe « societe. »
    if champ.startswith("societe.") and cat.champ_existe(SOURCE_SOCIETE, champ.split(".", 1)[1]):
        return True
    return False


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
def valider(brut: Any, cat: CatalogueValidation) -> Rapport:
    rapport = Rapport()

    # 1) Structure (Pydantic)
    if isinstance(brut, Definition):
        d = brut
    else:
        try:
            d = Definition.model_validate(mettre_a_niveau(dict(brut)))
        except ValidationError as e:
            for err in e.errors():
                # les unions discriminées ajoutent le type dans le chemin (…elements.0.IMAGE.x) : retiré
                loc = [p for p in err["loc"] if not (isinstance(p, str) and p in TYPES_ELEMENTS)]
                chemin = ".".join(f"[{p}]" if isinstance(p, int) else str(p) for p in loc).replace(".[", "[")
                rapport.ajouter(chemin, err["msg"])
            return rapport
        except ValueError as e:
            rapport.ajouter("schema_version", str(e))
            return rapport
    rapport.definition = d

    # 2) Identifiants uniques
    def doublons(valeurs: Iterable[tuple[str, str]], quoi: str):
        vus: dict[str, str] = {}
        for chemin, v in valeurs:
            if v in vus:
                rapport.ajouter(chemin, f"{quoi} « {v} » déjà utilisé ({vus[v]})")
            else:
                vus[v] = chemin
    doublons(((f"parametres[{i}].code", p.code) for i, p in enumerate(d.parametres)), "Paramètre")
    doublons(((f"jeux[{i}].code", j.code) for i, j in enumerate(d.jeux)), "Jeu")
    doublons(((f"bandes[{i}].id", b.id) for i, b in enumerate(d.bandes)), "Identifiant de bande")
    ids_elements = []
    for b, bande in enumerate(d.bandes):
        for e, el in enumerate(bande.elements):
            ids_elements.append((f"bandes[{b}].elements[{e}].id", el.id))
            if isinstance(el, Tableau):
                ids_elements += [(f"bandes[{b}].elements[{e}].colonnes[{c}].id", col.id)
                                 for c, col in enumerate(el.colonnes)]
                ids_elements += [(f"bandes[{b}].elements[{e}].sections[{s}].id", sec.id)
                                 for s, sec in enumerate(el.sections)]
            if isinstance(el, Grille):
                ids_elements += [(f"bandes[{b}].elements[{e}].colonnes[{c}].id", col.id)
                                 for c, col in enumerate(el.colonnes)]
                ids_elements += [(f"bandes[{b}].elements[{e}].lignes[{k}].id", lg.id)
                                 for k, lg in enumerate(el.lignes)]
    doublons(ids_elements, "Identifiant d'élément")

    # 3) Jeux de données
    principaux = [j for j in d.jeux if j.role == "PRINCIPAL"]
    if len(principaux) != 1:
        rapport.ajouter("jeux", f"Il faut exactement un jeu PRINCIPAL ({len(principaux)} trouvé(s))")
    for i, j in enumerate(d.jeux):
        base = f"jeux[{i}]"
        if j.source not in cat.sources():
            rapport.ajouter(f"{base}.source", f"Source inconnue : {j.source}")
            continue
        rapport.dependances.add(("SOURCE", j.source))
        if j.role == "SECONDAIRE":
            parent = d.jeu(j.parent) if j.parent else None
            if parent is None:
                rapport.ajouter(f"{base}.parent", "Un jeu SECONDAIRE désigne un jeu parent existant")
            elif (parent.source, j.relation or "") not in cat.relations:
                rapport.ajouter(f"{base}.relation", f"Relation inconnue entre {parent.source} et {j.source} : {j.relation}")
            elif cat.relations[(parent.source, j.relation)] != j.source:
                rapport.ajouter(f"{base}.relation", f"La relation {j.relation} mène à "
                                f"{cat.relations[(parent.source, j.relation)]}, pas à {j.source}")
        for k, c in enumerate(j.champs):
            if not cat.champ_existe(j.source, c):
                rapport.ajouter(f"{base}.champs[{k}]", f"Champ inconnu dans {j.source} : {c}")
            else:
                rapport.dependances.add(("CHAMP", f"{j.source}.{c}"))
        calculs = {c.code for c in j.calculs}
        for k, t in enumerate(j.tri):
            if t.champ not in calculs and not cat.champ_existe(j.source, t.champ):
                rapport.ajouter(f"{base}.tri[{k}].champ", f"Champ de tri inconnu : {t.champ}")
        for k, g in enumerate(j.groupes):
            if g not in calculs and not cat.champ_existe(j.source, g):
                rapport.ajouter(f"{base}.groupes[{k}]", f"Champ de groupement inconnu : {g}")

    # 3 bis) Données : corps, affectations, variables, mises en forme (RG-EDT-DONNEES)
    doublons(((f"corps[{i}].code", c.code) for i, c in enumerate(d.corps)), "Corps")
    doublons(((f"variables[{i}].code", x.code) for i, x in enumerate(d.variables)), "Variable")
    doublons([("forme_code", d.forme_code)] + [(f"formes[{i}].code", f.code) for i, f in enumerate(d.formes)],
             "Mise en forme")
    defaut = d.usages.forme_par_defaut
    if defaut and defaut != d.forme_code and defaut not in {f.code for f in d.formes}:
        rapport.ajouter("usages.forme_par_defaut", f"Mise en forme par défaut inconnue : {defaut}")
    for i, c in enumerate(d.corps):
        base = f"corps[{i}]"
        doublons(((f"{base}.colonnes[{k}].code", col.code) for k, col in enumerate(c.colonnes)), "Colonne")
        doublons(((f"{base}.lignes[{k}].code", l.code) for k, l in enumerate(c.lignes)), "Ligne")
        cols = {col.code for col in c.colonnes}
        if c.nature == "CASES" and not c.lignes:
            rapport.ajouter(f"{base}.lignes", "Un corps « cases » a au moins une ligne")
        if c.nature == "EXERCICE" and not set(COLONNES_EXERCICE) <= cols:          # RG-EDT-EXERCICE-01
            rapport.ajouter(f"{base}.colonnes", "Un corps « exercice » a les colonnes m01 à m12 et total")
        cases = {f"{l.code}.{col}" for l in c.lignes for col in cols}
        for k, a in enumerate(c.affectations):
            ch = f"{base}.affectations[{k}]"
            # RG-EDT-DONNEES-06 : rubrique avec rubrique (somme), formule avec formule (colonnes de la même ligne)
            if a.fusion and (k == 0 or bool(a.formule) != bool(c.affectations[k - 1].formule)):
                rapport.ajouter(f"{ch}.fusion", "Une ligne fusionnée rejoint la ligne au-dessus de même nature "
                                                "(rubrique avec rubrique, formule avec formule)")
            if bool(a.rubrique) == bool(a.formule):
                rapport.ajouter(ch, "Une affectation porte une rubrique OU une formule")
                continue
            if not a.cibles:
                rapport.ajouter(f"{ch}.cibles", "Aucune colonne ne reçoit de valeur")
            permis = {"VAL"} if a.formule else set(ATTRIBUTS_AFFECTABLES)
            if c.nature == "EXERCICE":                                                # RG-EDT-EXERCICE-01
                if len(a.cibles) > 1:
                    rapport.ajouter(f"{ch}.cibles", "Corps « exercice » : un seul attribut par ligne, ventilé sur les douze mois")
                if a.periode != "MOIS":
                    rapport.ajouter(f"{ch}.periode", "Corps « exercice » : la valeur est celle de chaque mois (période « Mois »)")
                for attribut in a.cibles:
                    if attribut not in permis:
                        rapport.ajouter(f"{ch}.cibles", f"Attribut {attribut} impossible ici (attendu : {', '.join(sorted(permis))})")
                if a.rubrique:
                    code = a.rubrique.strip().upper()
                    if cat.rubriques is not None and code not in cat.rubriques and code not in RUBRIQUES_EN_TETE:
                        rapport.ajouter(f"{ch}.rubrique", f"Rubrique inconnue ou archivée : {code}")
                    rapport.dependances.add(("RUBRIQUE", code))
                continue
            for attribut, cible in a.cibles.items():
                if attribut not in permis:
                    rapport.ajouter(f"{ch}.cibles", f"Attribut {attribut} impossible ici (attendu : {', '.join(sorted(permis))})")
                elif a.periode == "CUMUL" and attribut in ("TX", "TXP"):
                    rapport.ajouter(f"{ch}.cibles", f"Pas de cumul pour un taux ({attribut}) : seulement Nb, Mt, Base, Patronal")
                if (c.nature == "LIGNES" and cible not in cols) or (c.nature == "CASES" and cible not in cases):
                    attendu = "une colonne" if c.nature == "LIGNES" else "ligne.colonne"
                    rapport.ajouter(f"{ch}.cibles", f"Cible inconnue : {cible} ({attendu} du corps)")
            if a.rubrique:
                code = a.rubrique.strip().upper()
                if cat.rubriques is not None and code not in cat.rubriques and code not in RUBRIQUES_EN_TETE:
                    rapport.ajouter(f"{ch}.rubrique", f"Rubrique inconnue ou archivée : {code}")
                rapport.dependances.add(("RUBRIQUE", code))

    # 3 ter) TOTAL_CORPS("corps", "colonne") : le corps et la colonne doivent exister (RG-EDT-DONNEES-08)
    par_code = {**{c.libelle.strip().lower(): c for c in d.corps}, **{c.code.lower(): c for c in d.corps}}
    for chemin, f, _, _ in formules(d):
        for m in re.finditer(r'TOTAL_CORPS\(\s*"([^"]*)"\s*,\s*"([^"]*)"', f or "", flags=re.IGNORECASE):
            cp = par_code.get(m.group(1).strip().lower())
            if cp is None:
                rapport.ajouter(chemin, f"TOTAL_CORPS : corps inconnu « {m.group(1)} » ({', '.join(c.code for c in d.corps) or 'aucun corps'})")
            elif m.group(2).strip().lower() not in {x.lower() for col in cp.colonnes for x in (col.code, col.libelle.strip())}:
                rapport.ajouter(chemin, f"TOTAL_CORPS : colonne inconnue « {m.group(2)} » dans « {cp.code} » "
                                        f"(colonnes : {', '.join(col.code for col in cp.colonnes)})")

    # 4) Tableaux : jeu SECONDAIRE ou corps « lignes » ; plan des lignes et grilles cohérents
    for b, bande in enumerate(d.bandes):
        for e, el in enumerate(bande.elements):
            eb = f"bandes[{b}].elements[{e}]"
            if isinstance(el, Tableau) and el.corps:
                for code in [el.corps, *el.corps_suivants]:
                    cp = d.corps_par_code(code)
                    if cp is None or cp.nature not in ("LIGNES", "EXERCICE"):
                        rapport.ajouter(f"{eb}.corps", f"Un tableau affiche un corps « lignes » existant, ou « exercice » (« {code} »)")
            elif isinstance(el, Tableau):
                jt = d.jeu(el.jeu)
                if jt is None or jt.role != "SECONDAIRE":
                    rapport.ajouter(f"{eb}.jeu", f"Un tableau affiche un jeu SECONDAIRE existant (« {el.jeu} »)")
                ids_col = {c.id for c in el.colonnes}
                for s_, sec in enumerate(el.sections):
                    vus: set[str] = set()
                    for k, lr in enumerate(sec.rubriques):
                        chemin = f"{eb}.sections[{s_}].rubriques[{k}]"
                        code = lr.code.strip().upper()
                        if code in vus:
                            rapport.ajouter(f"{chemin}.code", f"Rubrique {code} déjà dans ce groupe")
                        vus.add(code)
                        if cat.rubriques is not None and code not in cat.rubriques \
                                and code not in RUBRIQUES_EN_TETE:
                            rapport.ajouter(f"{chemin}.code", f"Rubrique inconnue ou archivée : {code}")
                        rapport.dependances.add(("RUBRIQUE", code))
                        for col_id in lr.valeurs:
                            if col_id not in ids_col:
                                rapport.ajouter(f"{chemin}.valeurs", f"Colonne inconnue : {col_id}")
            if isinstance(el, Grille):
                ids_col = {c.id for c in el.colonnes}
                for k, lg in enumerate(el.lignes):
                    for col_id in lg.valeurs:
                        if col_id not in ids_col:
                            rapport.ajouter(f"{eb}.lignes[{k}].valeurs", f"Colonne inconnue : {col_id}")

    # 5) Formules
    params = {p.code for p in d.parametres}
    for chemin, src, code_jeu, est_texte in formules(d):
        sources = []
        if est_texte:
            try:
                sources = [(s, debut + 1) for debut, _, s in ex.extraire_variables(src)]
            except ex.ErreurFormule as err:
                rapport.ajouter(chemin, err.message, err.debut, err.fin)
                continue
        else:
            sources = [(src, 0)]
        for s, decalage in sources:
            a = ex.analyser(s, parametres_connus=params)
            for err in a.erreurs:
                rapport.ajouter(chemin, err.message,
                                None if err.debut is None else err.debut + decalage,
                                None if err.fin is None else err.fin + decalage)
            for c in sorted(a.champs):
                if not _champ_ok(d, cat, code_jeu, c):
                    contexte = f"le jeu « {code_jeu} »" if code_jeu else "ce contexte (aucun jeu)"
                    rapport.ajouter(chemin, f"Champ inconnu dans {contexte} : {c}")
                else:
                    source, calculs = _champs_du_jeu(d, cat, code_jeu)
                    if c.startswith("societe."):
                        rapport.dependances.add(("CHAMP", f"{SOURCE_SOCIETE}.{c.split('.', 1)[1]}"))
                    elif c not in calculs and source:
                        rapport.dependances.add(("CHAMP", f"{source}.{c}"))
            for code in a.rubriques:
                if cat.rubriques is not None and code not in cat.rubriques and code not in RUBRIQUES_EN_TETE:
                    rapport.ajouter(chemin, f"Rubrique inconnue ou archivée : {code}")
                rapport.dependances.add(("RUBRIQUE", code))
            for code in a.constantes:
                if cat.constantes is not None and code not in cat.constantes:
                    rapport.ajouter(chemin, f"Constante inconnue : #{code}")
                rapport.dependances.add(("CONSTANTE", code))

    # 6) Masques
    connus = set(fmt.MASQUES_STANDARD) | (cat.masques or set())
    for b, bande in enumerate(d.bandes):
        for e, el in enumerate(bande.elements):
            aff = [(f"bandes[{b}].elements[{e}].affichage.masque", getattr(el, "affichage", None))]
            if isinstance(el, (Tableau, Grille)):
                aff += [(f"bandes[{b}].elements[{e}].colonnes[{c}].affichage.masque", col.affichage)
                        for c, col in enumerate(el.colonnes)]
            for chemin, a in aff:
                if a is not None and a.masque:
                    if a.masque.upper() not in connus:
                        rapport.ajouter(chemin, f"Masque inconnu : {a.masque}")
                    else:
                        rapport.dependances.add(("MASQUE", a.masque.upper()))

    for i, c in enumerate(d.corps):
        for k, col in enumerate(c.colonnes):
            if col.masque:
                if col.masque.upper() not in connus:
                    rapport.ajouter(f"corps[{i}].colonnes[{k}].masque", f"Masque inconnu : {col.masque}")
                else:
                    rapport.dependances.add(("MASQUE", col.masque.upper()))

    # 7) Géométrie
    largeur = d.page.largeur_utile()
    hauteur = d.page.hauteur_utile()
    total_fixe = sum(b.hauteur for b in d.bandes if b.type in ("EN_TETE_PAGE", "PIED_PAGE"))
    if total_fixe > hauteur + TOLERANCE_MM:
        rapport.ajouter("bandes", f"En-tête et pied de page ({total_fixe:.1f} mm) dépassent la hauteur utile ({hauteur:.1f} mm)")
    for b, bande in enumerate(d.bandes):
        if bande.type in ("EN_TETE_GROUPE", "PIED_GROUPE") and bande.niveau_groupe is None:
            rapport.ajouter(f"bandes[{b}].niveau_groupe", "Niveau de groupe obligatoire pour une bande de groupe")
        if bande.hauteur > hauteur + TOLERANCE_MM:
            rapport.ajouter(f"bandes[{b}].hauteur", f"Bande plus haute que la page utile ({hauteur:.1f} mm)")
        for e, el in enumerate(bande.elements):
            chemin = f"bandes[{b}].elements[{e}]"
            if el.x + el.l > largeur + TOLERANCE_MM:
                rapport.ajouter(chemin, f"Déborde à droite : {el.x + el.l:.1f} mm pour {largeur:.1f} mm utiles")
            if not bande.extensible and el.y + el.h > bande.hauteur + TOLERANCE_MM:
                rapport.ajouter(chemin, f"Déborde de sa bande : {el.y + el.h:.1f} mm pour {bande.hauteur:.1f} mm")
            if isinstance(el, Grille):
                somme = el.largeur_titres + sum(c.largeur for c in el.colonnes)
                if somme > el.l + TOLERANCE_MM:
                    rapport.ajouter(f"{chemin}.colonnes", f"Colonnes ({somme:.1f} mm) plus larges que la grille ({el.l:.1f} mm)")
            if isinstance(el, Tableau):
                somme = sum(c.largeur for c in el.colonnes if not c.masquee)
                if somme > el.l + TOLERANCE_MM:
                    rapport.ajouter(f"{chemin}.colonnes", f"Colonnes ({somme:.1f} mm) plus larges que le tableau ({el.l:.1f} mm)")

    # 8) Sortie
    p = d.jeu_principal()
    if d.sortie.eclatement and p and not _champ_ok(d, cat, p.code, d.sortie.eclatement):
        rapport.ajouter("sortie.eclatement", f"Champ d'éclatement inconnu : {d.sortie.eclatement}")

    # 9) Autres mises en forme : mêmes contrôles sur leurs bandes, page et sortie
    for i, f in enumerate(d.formes):
        autre = valider(d.avec_forme(f.code).model_copy(update={"formes": []}), cat)
        for err in autre.erreurs:
            if err.chemin.startswith(("bandes", "page", "sortie")):
                rapport.ajouter(f"formes[{i}].{err.chemin}", err.message, err.debut, err.fin)
        rapport.dependances |= autre.dependances

    return rapport
