"""
app/editions/bulletins.py — Corps des bulletins de paie : tout le calcul dans le paramétrage.
Auteur : Adil DAIA — 20/10/2026 — RG-EDT-BULLETIN-CORPS-01..03

RG-EDT-BULLETIN-CORPS-01 : un bulletin imprime deux corps, manipulables dans l'onglet Données du designer :
    * « Rubriques » (corps lignes) : une affectation par rubrique, rangée dans sa section
      (éléments de rémunération, cotisations sociales, autres retenues), avec ses colonnes
      nombre, base, taux, à payer, à retenir, taux et montant patronaux ;
    * « Totaux » (corps cases) : brut, brut imposable, cotisations, net imposable, retenues, net à payer,
      coût employeur — du mois, cumulés sur l'année, et en part du coût employeur.
    La mise en forme ne lit que ces corps (corps.totaux.mois.net…), plus aucune donnée de paie en dur.

RG-EDT-BULLETIN-CORPS-02 : un bulletin livré reçoit, à l'installation, les rubriques du plan de paie de
    l'installation (rubrique_paie, plus les rubriques déjà payées) : section d'après le sens de la rubrique
    — même règle que le moteur de paie (flux GAIN → gain ; flux RET ou type COT → retenue) —, cotisation
    si elle a une part patronale. Une nouvelle rubrique du plan publie une nouvelle version du modèle livré.
    Une copie garde ses affectations : on les complète dans le designer (« Ajouter des rubriques »).
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

CORPS_RUBRIQUES = "rubriques"
CORPS_TOTAUX = "totaux"

SECTIONS = (("gains", "Éléments de rémunération"), ("cotisations", "Cotisations sociales"),
            ("retenues", "Autres retenues"))
CIBLES = {
    "gains": {"NB": "nombre", "BASE": "base", "TX": "taux", "MT": "gain"},
    "cotisations": {"BASE": "base", "TX": "taux", "MT": "retenue", "TXP": "taux_patronal", "PAT": "patronal"},
    "retenues": {"NB": "nombre", "BASE": "base", "TX": "taux", "MT": "retenue"},
}

# colonne du corps « Totaux » : (code, libellé, rubrique d'en-tête du bulletin, champ du bulletin remplacé)
TOTAUX = (("brut", "Salaire brut", "TOTAL_BRUT", "total_brut"),
          ("brut_imposable", "Brut imposable", "BRUT_IMPOSABLE", "total_brut_imposable"),
          ("cot_sal", "Cotisations salariales", "COT_SALARIALES", "total_cot_salariale"),
          ("net_imposable", "Net imposable", "NET_IMPOSABLE", "net_imposable"),
          ("cot_pat", "Cotisations patronales", "COT_PATRONALES", "total_cot_patronale"),
          ("retenues", "Total des retenues", "TOTAL_RETENUES", "total_retenues"),
          ("net", "Net à payer", "NET_A_PAYER", "net_a_payer"),
          ("cout", "Coût employeur", "COUT_EMPLOYEUR", "cout_employeur"))
PARTS = ("net", "retenues", "cot_pat")          # part du coût employeur (%)


def corps_rubriques(affectations: list | None = None) -> dict:
    return {"code": CORPS_RUBRIQUES, "libelle": "Rubriques du bulletin", "nature": "LIGNES", "tri": "PAIE",
            "emplacement": "DETAIL",
            "colonnes": [{"code": "nombre", "libelle": "Nombre", "type": "NOMBRE"},
                         {"code": "base", "libelle": "Base", "type": "MONTANT"},
                         {"code": "taux", "libelle": "Taux", "type": "TAUX"},
                         {"code": "gain", "libelle": "À payer", "type": "MONTANT", "total": True},
                         {"code": "retenue", "libelle": "À retenir", "type": "MONTANT", "total": True},
                         {"code": "taux_patronal", "libelle": "Taux patronal", "type": "TAUX"},
                         {"code": "patronal", "libelle": "Part patronale", "type": "MONTANT", "total": True}],
            "sections": [{"code": c, "libelle": l} for c, l in SECTIONS],
            "affectations": list(affectations or [])}


def corps_totaux() -> dict:
    aff = []
    for code, lib, rub, _ in TOTAUX:
        aff.append({"rubrique": rub, "cibles": {"MT": f"mois.{code}"}, "libelle": lib})
        aff.append({"rubrique": rub, "periode": "CUMUL", "cibles": {"MT": f"cumul.{code}"}, "libelle": f"{lib} (cumul)"})
    for code in PARTS:
        rub = next(t[2] for t in TOTAUX if t[0] == code)
        aff.append({"formule": f"SI(SIVIDE([COUT_EMPLOYEUR].MT, 0) = 0, 0, SIVIDE([{rub}].MT, 0) / [COUT_EMPLOYEUR].MT * 100)",
                    "cibles": {"VAL": f"part.{code}"}, "libelle": f"Part du coût employeur — {code}"})
    return {"code": CORPS_TOTAUX, "libelle": "Totaux du bulletin", "nature": "CASES", "emplacement": "MASQUE",
            "colonnes": [{"code": c, "libelle": l, "type": "MONTANT", "masque": "MONTANT"} for c, l, _r, _f in TOTAUX],
            "lignes": [{"code": "mois", "libelle": "Mois"}, {"code": "cumul", "libelle": "Cumul de l'année"},
                       {"code": "part", "libelle": "Part du coût employeur (%)"}],
            "affectations": aff}


def _table(db: Session, table: str) -> set:
    return {r[0] for r in db.execute(text("""SELECT column_name FROM information_schema.columns
                                             WHERE table_schema = current_schema() AND table_name = :t"""), {"t": table}).all()}


def affectations_du_plan(db: Session) -> list[dict]:
    """RG-EDT-BULLETIN-CORPS-02 : une affectation par rubrique imprimable (gain ou retenue), dans sa section."""
    rubriques: dict[str, dict] = {}
    cols = _table(db, "rubrique_paie")
    if {"code", "archive", "traiter"} <= cols:
        sel = ", ".join(c if c in cols else f"NULL AS {c}" for c in ("code_flux", "code_type", "ordre_calcul"))
        for r in db.execute(text(f"""SELECT code, {sel} FROM rubrique_paie
                                     WHERE archive = false AND traiter = true ORDER BY code""")).mappings():
            code = str(r["code"]).strip().upper()
            rubriques.setdefault(code, {"flux": (r["code_flux"] or "").strip().upper(),
                                        "type": (r["code_type"] or "").strip().upper(), "ordre": r["ordre_calcul"]})
    plan = bool(rubriques) or {"code", "archive", "traiter"} <= cols
    lignes = _table(db, "bulletin_ligne")
    if {"code_rubrique", "sens"} <= lignes:                 # rubriques déjà payées (sens réel des lignes)
        pat = "montant_patronal" if "montant_patronal" in lignes else "NULL"
        ordre = "ordre_affichage" if "ordre_affichage" in lignes else "NULL"
        for r in db.execute(text(f"""SELECT UPPER(TRIM(code_rubrique)) AS code, MAX(sens) AS sens,
                                            BOOL_OR({pat} IS NOT NULL AND {pat} <> 0) AS patronal, MIN({ordre}) AS ordre
                                     FROM bulletin_ligne WHERE sens IN ('GAIN', 'RETENUE')
                                     GROUP BY UPPER(TRIM(code_rubrique))""")).mappings():
            if plan and r["code"] not in rubriques:
                continue                                   # rubrique hors plan (archivée…) : on n'en tire que le sens
            e = rubriques.setdefault(r["code"], {"flux": "", "type": "", "ordre": None})
            e["sens"], e["patronal"] = r["sens"], bool(r["patronal"])
            e["ordre"] = e["ordre"] if e["ordre"] is not None else r["ordre"]
    res = []
    for code, e in rubriques.items():
        if e["flux"] == "GAIN":
            sens = "GAIN"
        elif e["flux"] == "RET" or e["type"] == "COT":
            sens = "RETENUE"
        else:
            sens = e.get("sens")                           # rubrique sans sens au plan : celui de ses lignes payées
        if sens not in ("GAIN", "RETENUE"):
            continue                                       # rubrique neutre (calcul intermédiaire) : jamais imprimée
        section = "gains" if sens == "GAIN" else ("cotisations" if e["type"] == "COT" or e.get("patronal") else "retenues")
        res.append((section, e["ordre"] if e["ordre"] is not None else 10 ** 6, code,
                    {"rubrique": code, "cibles": dict(CIBLES[section]), "section": section}))
    rang = {c: k for k, (c, _l) in enumerate(SECTIONS)}
    return [a for _s, _o, _c, a in sorted(res, key=lambda x: (rang[x[0]], x[1], x[2]))]


def instancier(d: dict, db: Session) -> dict:
    """Remplit le corps « Rubriques » laissé vide d'un bulletin livré avec les rubriques de l'installation."""
    for c in d.get("corps") or []:
        if c.get("code") == CORPS_RUBRIQUES and c.get("nature") == "LIGNES" and not c.get("affectations"):
            c["affectations"] = affectations_du_plan(db)
    return d


def garder_rubriques_de(d: dict, rubriques: set | None) -> dict:
    """Copie d'un bulletin livré : seules les rubriques du plan de la société restent affectées."""
    if rubriques is None:
        return d
    connues = {str(x).strip().upper() for x in rubriques}
    for c in d.get("corps") or []:
        if c.get("code") == CORPS_RUBRIQUES:
            c["affectations"] = [a for a in c.get("affectations", [])
                                 if not a.get("rubrique") or str(a["rubrique"]).strip().upper() in connues]
    return d
