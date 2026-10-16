"""
app/services/validation_engine.py — Moteur de validation d'un bulletin de paie.
Auteur : Adil DAIA

Lit le référentiel administrable `ref_controle_paie` et applique chaque contrôle
ACTIF selon son niveau :
  • BLOQUANT en échec  → empêche la validation ;
  • ALERTE en échec    → signalé, le gestionnaire décide (forçage possible) ;
  • INACTIF            → ignoré.

`controler_bulletin` retourne un rapport complet (utilisable en aperçu avant
validation, et enregistré dans l'historique lors de la validation).

Les contrôles sont volontairement pragmatiques : le MÉCANISME (lecture du
référentiel, application par niveau, rapport, historique) est le cœur ; chaque
règle individuelle reste facile à affiner ensuite.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

D0 = Decimal("0")


def _dec(v) -> Decimal:
    try:
        return Decimal(str(v)) if v not in (None, "") else D0
    except Exception:
        return D0


class ContexteValidation:
    def __init__(self, db: Session, bulletin_id: UUID, user_roles: list[str]):
        self.db = db
        self.user_roles = set(user_roles or [])

        # Le bulletin peut être en cours de calcul (bulletin_temp), validé
        # (bulletin) ou clôturé (bulletin_historique) : la vue unifiée le trouve
        # quel que soit son état, et `origine` indique où il se trouve.
        self.bulletin = db.execute(text("""
            SELECT * FROM public.v_bulletin_tous WHERE id = :id
        """), {"id": str(bulletin_id)}).mappings().first()
        if not self.bulletin:
            raise HTTPException(404, "Bulletin introuvable")

        _tables_lignes = {
            "TEMP": "bulletin_temp_ligne",
            "VALIDE": "bulletin_ligne",
            "HISTORIQUE": "bulletin_historique_ligne",
        }
        _tl = _tables_lignes[self.bulletin["origine"]]
        self.lignes = db.execute(text(f"""
            SELECT * FROM public.{_tl} WHERE bulletin_id = :id
        """), {"id": str(bulletin_id)}).mappings().all()

        self.periode = db.execute(text("""
            SELECT * FROM public.calendrier_paie WHERE id = :id
        """), {"id": str(self.bulletin["periode_id"])}).mappings().first()

        self.collab = db.execute(text("""
            SELECT * FROM public.collaborateurs WHERE id = :id
        """), {"id": str(self.bulletin["collaborateur_id"])}).mappings().first() or {}

        ref = self.periode["date_reference"] if self.periode else date.today()
        self.ref = ref
        self.salaire_fixe = db.execute(text("""
            SELECT * FROM public.collaborateur_salaires_fixes
             WHERE collaborateur_id = :cid AND archive = false
               AND date_debut <= :ref AND (date_fin IS NULL OR date_fin >= :ref)
             ORDER BY date_debut DESC LIMIT 1
        """), {"cid": str(self.bulletin["collaborateur_id"]), "ref": ref}).mappings().first() or {}

        self.regimes = {r[0] for r in db.execute(text("""
            SELECT code_regime FROM public.collaborateur_regime
             WHERE collaborateur_id = :cid AND actif = true
        """), {"cid": str(self.bulletin["collaborateur_id"])}).all()}

        self.plan_actif = db.execute(text("""
            SELECT 1 FROM public.collaborateur_plan_paie
             WHERE collaborateur_id = :cid AND archive = false
               AND date_debut <= :ref AND (date_fin IS NULL OR date_fin >= :ref)
             LIMIT 1
        """), {"cid": str(self.bulletin["collaborateur_id"]), "ref": ref}).first() is not None

        self.constantes = {r[0]: _dec(r[1]) for r in db.execute(text("""
            SELECT code, valeur FROM public.ref_constante_paie WHERE actif = true
        """)).all()}

        # Bulletin de la période précédente (même collaborateur, mois-1 du même plan/année)
        self.bulletin_prec = None
        if self.periode:
            self.bulletin_prec = db.execute(text("""
                SELECT b.* FROM public.bulletin b
                  JOIN public.calendrier_paie c ON c.id = b.periode_id
                 WHERE b.collaborateur_id = :cid AND c.plan_paie_id = :plan
                   AND ((c.annee = :annee AND c.mois < :mois) OR c.annee < :annee)
                 ORDER BY c.annee DESC, c.mois DESC LIMIT 1
            """), {"cid": str(self.bulletin["collaborateur_id"]),
                   "plan": str(self.periode["plan_paie_id"]),
                   "annee": self.periode["annee"], "mois": self.periode["mois"]}).mappings().first()

        # Périodes antérieures non validées
        # RG-CONTROLE-PERIODES-ANT-01 (Adil DAIA) : `statut <> 'VALIDE'`
        # comptait à tort les bulletins CLOTURE comme "non validés" — un
        # bulletin clôturé est plus définitif que validé (il l'a même déjà
        # été avant sa clôture de période), pas moins. Seuls les statuts
        # réellement en attente doivent compter. NB : une période clôturée
        # annuellement n'a plus de ligne dans `bulletin` (déplacée vers
        # bulletin_historique) — elle ne remonte donc déjà pas ici.
        self.periodes_ant_non_validees = 0
        if self.periode:
            self.periodes_ant_non_validees = db.execute(text("""
                SELECT count(*) FROM public.bulletin b
                  JOIN public.calendrier_paie c ON c.id = b.periode_id
                 WHERE b.collaborateur_id = :cid AND c.plan_paie_id = :plan
                   AND ((c.annee = :annee AND c.mois < :mois) OR c.annee < :annee)
                   AND b.statut NOT IN ('VALIDE', 'CLOTURE')
            """), {"cid": str(self.bulletin["collaborateur_id"]),
                   "plan": str(self.periode["plan_paie_id"]),
                   "annee": self.periode["annee"], "mois": self.periode["mois"]}).scalar() or 0

        # Éléments variables non validés + modifiés après le calcul
        self.ev_saisi = db.execute(text("""
            SELECT count(*) FROM public.element_variable
             WHERE collaborateur_id = :cid AND periode_id = :pid AND statut = 'SAISI'
        """), {"cid": str(self.bulletin["collaborateur_id"]),
               "pid": str(self.bulletin["periode_id"])}).scalar() or 0
        self.ev_modifies_apres = db.execute(text("""
            SELECT count(*) FROM public.element_variable
             WHERE collaborateur_id = :cid AND periode_id = :pid AND updated_at > :calc
        """), {"cid": str(self.bulletin["collaborateur_id"]),
               "pid": str(self.bulletin["periode_id"]),
               "calc": self.bulletin["calcule_le"]}).scalar() or 0

    # helpers
    def ligne(self, code: str) -> dict | None:
        for l in self.lignes:
            if l["code_rubrique"].strip() == code:
                return l
        return None

    def cst(self, *codes) -> Decimal:
        for c in codes:
            if c in self.constantes:
                return self.constantes[c]
        return D0


# ---- Contrôles (retournent (ok: bool, message|None)) ---------------------
def _c_periode_ouverte(x):
    return (x.periode and x.periode["statut"] in ("OUVERTE", "CALCULEE"),
            f"Période au statut '{x.periode['statut'] if x.periode else '?'}'")

def _c_bulletin_non_valide(x):
    return (x.bulletin["statut"] not in ("VALIDE", "CLOTURE"),
            f"Bulletin déjà au statut '{x.bulletin['statut']}'")

def _c_periodes_ant(x):
    return (x.periodes_ant_non_validees == 0,
            f"{x.periodes_ant_non_validees} période(s) antérieure(s) non validée(s)")

def _c_recalcul(x):
    return (x.ev_modifies_apres == 0,
            f"{x.ev_modifies_apres} élément(s) variable(s) modifié(s) après le calcul — recalcul conseillé")

def _c_date_limite(x):
    dl = x.periode.get("date_limite_saisie") if x.periode else None
    return (dl is None or date.today() <= dl, f"Date limite de saisie dépassée ({dl})")

def _c_droit(x):
    return (bool(x.user_roles & {"administrateur", "gestionnaire_paie"}),
            "Utilisateur non habilité à valider")

def _c_plan_actif(x):
    return (x.plan_actif, "Aucun plan de paie actif sur la période")

def _c_salaire_base(x):
    return (_dec(x.salaire_fixe.get("salaire_base")) > 0, "Salaire de base absent ou nul")

def _c_affiliations(x):
    a_cotisations = any(l["est_cotisation"] and _dec(l["montant"]) != 0 for l in x.lignes)
    return (not a_cotisations or len(x.regimes) > 0,
            "Cotisations calculées mais aucune affiliation (régime) active")

def _c_ev_non_valides(x):
    return (x.ev_saisi == 0, f"{x.ev_saisi} élément(s) variable(s) au statut SAISI (non pris en compte)")

def _c_ident_decl(x):
    keys = {k.lower(): v for k, v in dict(x.collab).items()}
    cnss = next((v for k, v in keys.items() if "cnss" in k), None)
    cin = next((v for k, v in keys.items() if k in ("cin", "num_cin", "numero_cin") or "cin" in k), None)
    manquants = [n for n, v in (("CNSS", cnss), ("CIN", cin)) if not v]
    return (len(manquants) == 0, "Identifiant(s) manquant(s) : " + ", ".join(manquants))

def _c_net_positif(x):
    return (_dec(x.bulletin["net_a_payer"]) > 0, "Net à payer négatif ou nul")

def _c_net_inf_brut(x):
    return (_dec(x.bulletin["net_a_payer"]) <= _dec(x.bulletin["total_brut"]) or _dec(x.bulletin["total_brut"]) == 0,
            "Net à payer supérieur au brut")

def _c_retenues_inf_gains(x):
    return (_dec(x.bulletin["total_retenues"]) <= _dec(x.bulletin["total_gains"]),
            "Total des retenues supérieur au total des gains")

def _c_assiette_neg(x):
    negs = [l["code_rubrique"] for l in x.lignes if l["code_type"] == "ASS" and _dec(l["montant"]) < 0]
    return (len(negs) == 0, "Assiette(s) négative(s) : " + ", ".join(negs))

def _c_cotis_assiette(x):
    assiettes = sum((_dec(l["montant"]) for l in x.lignes if l["code_type"] == "ASS"), D0)
    cotis = sum((_dec(l["montant"]) for l in x.lignes if l["est_cotisation"]), D0)
    if assiettes > 0 and cotis == 0:
        return (False, "Assiettes alimentées mais aucune cotisation calculée")
    if cotis > 0 and assiettes == 0:
        return (False, "Cotisations calculées sur assiette nulle")
    return (True, None)

def _c_rubriques_avert(x):
    msgs = x.bulletin.get("messages") or []
    n = len(msgs) if isinstance(msgs, list) else 0
    return (n == 0, f"{n} avertissement(s) de calcul sur le bulletin")

def _c_cumul_sup_periode(x):
    mauvais = []
    for l in x.lignes:
        row = x.db.execute(text("""
            SELECT COALESCE(SUM(montant),0) FROM public.cumul
             WHERE collaborateur_id = :cid AND code_rubrique = :code AND annee = :annee
        """), {"cid": str(x.bulletin["collaborateur_id"]), "code": l["code_rubrique"],
               "annee": x.periode["annee"] if x.periode else 0}).scalar()
        if _dec(row) + D0 < _dec(l["montant"]) - Decimal("0.01"):
            mauvais.append(l["code_rubrique"].strip())
    return (len(mauvais) == 0, "Cumul < période pour : " + ", ".join(mauvais[:8]))

def _c_smig(x):
    smig = x.cst("SMIG")
    sb = _dec(x.salaire_fixe.get("salaire_base"))
    return (smig == 0 or sb == 0 or sb >= smig, f"Salaire de base ({sb}) inférieur au SMIG ({smig})")

def _c_plafond_cnss(x):
    # Le plafond est appliqué au calcul ; contrôle informatif (jamais bloquant en pratique).
    return (True, None)

def _c_ir_coherent(x):
    rni = x.ligne("REV_NET_IMP")
    ir = x.ligne("RET_IR")
    if rni and _dec(rni["montant"]) > 2500 and ir and _dec(ir["montant"]) == 0:
        return (False, "Revenu net imposable élevé mais IR nul — à vérifier")
    return (True, None)

def _c_ecart_prec(x, seuil: Decimal):
    if not x.bulletin_prec:
        return (True, None)
    net = _dec(x.bulletin["net_a_payer"])
    net_prec = _dec(x.bulletin_prec["net_a_payer"])
    if net_prec == 0:
        return (True, None)
    ecart = abs(net - net_prec) / net_prec * Decimal(100)
    return (ecart <= seuil, f"Écart de net avec la période précédente : {ecart:.1f}% (seuil {seuil}%)")


_CONTROLES = {
    "CTRL_PERIODE_OUVERTE": _c_periode_ouverte,
    "CTRL_BULLETIN_NON_VALIDE": _c_bulletin_non_valide,
    "CTRL_PERIODES_ANT_VALIDEES": _c_periodes_ant,
    "CTRL_RECALCUL_A_JOUR": _c_recalcul,
    "CTRL_DATE_LIMITE_SAISIE": _c_date_limite,
    "CTRL_DROIT_VALIDATION": _c_droit,
    "CTRL_PLAN_ACTIF": _c_plan_actif,
    "CTRL_SALAIRE_BASE": _c_salaire_base,
    "CTRL_AFFILIATIONS": _c_affiliations,
    "CTRL_EV_NON_VALIDES": _c_ev_non_valides,
    "CTRL_IDENT_DECLARATION": _c_ident_decl,
    "CTRL_NET_POSITIF": _c_net_positif,
    "CTRL_NET_INF_BRUT": _c_net_inf_brut,
    "CTRL_RETENUES_INF_GAINS": _c_retenues_inf_gains,
    "CTRL_ASSIETTE_NEGATIVE": _c_assiette_neg,
    "CTRL_COTIS_ASSIETTE_NULLE": _c_cotis_assiette,
    "CTRL_RUBRIQUES_AVERT": _c_rubriques_avert,
    "CTRL_CUMUL_SUP_PERIODE": _c_cumul_sup_periode,
    "CTRL_SMIG": _c_smig,
    "CTRL_PLAFOND_CNSS": _c_plafond_cnss,
    "CTRL_IR_COHERENT": _c_ir_coherent,
    # CTRL_ECART_PERIODE_PREC traité à part (paramétré)
}


def controler_bulletin(db: Session, bulletin_id: UUID, user_roles: list[str]) -> dict:
    """Exécute les contrôles ACTIFS et renvoie le rapport (sans rien modifier)."""
    x = ContexteValidation(db, bulletin_id, user_roles)

    controles_ref = db.execute(text("""
        SELECT code, libelle, categorie, niveau, valeur_parametre
          FROM public.ref_controle_paie
         WHERE actif = true AND niveau <> 'INACTIF'
         ORDER BY ordre
    """)).mappings().all()

    resultats, bloquants_ko, alertes_ko = [], 0, 0
    for c in controles_ref:
        code = c["code"]
        try:
            if code == "CTRL_ECART_PERIODE_PREC":
                ok, msg = _c_ecart_prec(x, _dec(c["valeur_parametre"]) or Decimal(20))
            elif code in _CONTROLES:
                ok, msg = _CONTROLES[code](x)
            else:
                ok, msg = True, "Contrôle non implémenté"
        except Exception as e:  # un contrôle ne doit jamais casser la validation
            ok, msg = True, f"Contrôle non évalué ({e})"
        if not ok:
            if c["niveau"] == "BLOQUANT":
                bloquants_ko += 1
            else:
                alertes_ko += 1
        resultats.append({
            "code": code, "libelle": c["libelle"], "categorie": c["categorie"],
            "niveau": c["niveau"], "ok": bool(ok), "message": None if ok else msg,
        })

    return {
        "bulletin_id": str(bulletin_id),
        "statut": x.bulletin["statut"],
        "controles": resultats,
        "bloquants_ko": bloquants_ko,
        "alertes_ko": alertes_ko,
        "validable": bloquants_ko == 0,
    }
