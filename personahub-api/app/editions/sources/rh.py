"""
app/editions/sources/rh.py — Sources RH des éditions : départs (certificat de travail, solde de tout compte).
Auteur : Adil DAIA — 20/10/2026 — RG-EDT-DEPART-01..04

RG-EDT-DEPART-01 (Adil DAIA) : source DEPART = un départ du collaborateur (collaborateur_departs), filtré par
    mois de sortie et/ou collaborateurs. Société active : le collaborateur y a un bulletin ou un contrat.
    Un départ annulé n'est jamais lu.
RG-EDT-DEPART-02 (Adil DAIA) : la ligne reprend le DERNIER bulletin du collaborateur dans la société (celui de
    la sortie, qui porte le solde de tout compte) : identité, contrat, affectation, qualification figées au
    calcul et totaux ; ses rubriques se lisent [CODE].MT… ; la relation « lignes » donne ses lignes imprimables.
    Sans bulletin, l'identité vient de la fiche collaborateur.
RG-EDT-DEPART-03 (Adil DAIA) : depart.* : date, motif (intitulé du référentiel), préavis, indemnités, solde de
    congés, CNSS / AMO, documents remis, matériel restitué ; depart.anciennete_texte calculée de l'embauche
    à la sortie (« 7 ans et 6 mois »).
RG-EDT-DEPART-04 (Adil DAIA) : champs sensibles : montants des indemnités (masqués sans le droit
    « Données sensibles », comme le reste de la paie).
"""
from __future__ import annotations

from datetime import date
from typing import Any, Optional

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from app.editions.sources.base import (ChampDecl, ContexteSecurite, ErreurSource, Fournisseur, Ligne, RelationDecl,
                                       enregistrer, propre)
from app.editions.sources.paie import CHAMPS_BULLETIN, FournisseurBulletin, _d, _m, _n, _t

G = "Départ"
CHAMPS_DEPART = [
    _d("depart.date_depart", "Date de sortie", G), _t("depart.motif_libelle", "Motif de sortie", G),
    _t("depart.code_motif_depart", "Motif (code)", G), _t("depart.reference_decision", "Référence de la décision", G),
    _t("depart.statut", "Statut du départ", G), _t("depart.commentaire", "Commentaire", G),
    _t("depart.anciennete_texte", "Ancienneté à la sortie (texte)", G), _n("depart.anciennete_mois", "Ancienneté à la sortie (mois)", G),
    _n("depart.anciennete_retenue_ans", "Ancienneté retenue (ans)", G),
    _n("depart.preavis_duree_jours", "Préavis (jours)", G), _d("depart.preavis_date_debut", "Début du préavis", G),
    _d("depart.preavis_date_fin", "Fin du préavis", G), _t("depart.preavis_categorie", "Catégorie de préavis", G),
    ChampDecl("depart.preavis_effectue", "Préavis effectué", "BOOLEEN", G),
    ChampDecl("depart.preavis_dispense", "Préavis dispensé", "BOOLEEN", G),
    _m("depart.preavis_dispense_indemnite", "Indemnité de préavis (dispense)", G, sensible=True),
    _m("depart.base_calcul_salaire", "Salaire de base de calcul", G, sensible=True),
    _m("depart.indemnite_perte_emploi", "Indemnité pour perte d'emploi", G, sensible=True),
    _m("depart.indemnite_depart_retraite", "Indemnité de départ à la retraite", G, sensible=True),
    _m("depart.indemnite_conges_payes", "Indemnité de congés payés", G, sensible=True),
    _m("depart.indemnite_compensatrice", "Indemnité compensatrice", G, sensible=True),
    _m("depart.indemnite_transactionnelle", "Indemnité transactionnelle", G, sensible=True),
    _m("depart.indemnite_anciennete", "Indemnité d'ancienneté / licenciement", G, sensible=True),
    _m("depart.indemnite_13eme_mois", "13e mois au prorata", G, sensible=True),
    _m("depart.indemnite_total", "Total des indemnités", G, sensible=True),
    _n("depart.solde_conges_jours", "Solde de congés (jours)", G),
    _d("depart.cnss_radiation_date", "Radiation CNSS", G), _t("depart.cnss_derniere_declaration", "Dernière déclaration CNSS", G),
    _d("depart.amo_cloture_date", "Clôture AMO", G), ChampDecl("depart.amo_attestation_delivree", "Attestation AMO délivrée", "BOOLEEN", G),
] + [ChampDecl(f"depart.{c}", l, "BOOLEEN", "Départ — documents et matériel") for c, l in (
    ("doc_attestation_travail", "Certificat / attestation de travail remis"), ("doc_recu_stc", "Reçu pour solde de tout compte signé"),
    ("doc_radiation_cnss", "Radiation CNSS remise"), ("doc_attestation_amo", "Attestation AMO remise"),
    ("doc_certificat_conges", "Certificat de congés remis"), ("doc_lettre_notification", "Lettre de notification"),
    ("doc_accord_amiable", "Accord amiable"), ("doc_pv_entretien", "PV d'entretien"), ("doc_recu_materiel", "Reçu de matériel"),
    ("materiel_badge_restitue", "Badge restitué"), ("materiel_ordinateur_restitue", "Ordinateur restitué"),
    ("materiel_vehicule_restitue", "Véhicule restitué"), ("materiel_telephone_restitue", "Téléphone restitué"),
    ("acces_si_desactive", "Accès SI désactivés"), ("acces_email_desactive", "Messagerie désactivée"))]

_TECHNIQUES = {"id", "collaborateur_id", "created_at", "updated_at", "created_by", "updated_by", "traite_le"}


def table_existe(db: Session, table: str) -> bool:
    return db.execute(text("""SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema()
                              AND table_name = :t"""), {"t": table}).first() is not None


def anciennete(debut: Any, fin: Any) -> tuple[Optional[int], str]:
    if not isinstance(debut, date) or not isinstance(fin, date) or fin < debut:
        return None, ""
    mois = (fin.year - debut.year) * 12 + fin.month - debut.month - (1 if fin.day < debut.day else 0)
    ans, reste = divmod(max(mois, 0), 12)
    morceaux = ([f"{ans} an{'s' if ans > 1 else ''}"] if ans else []) + ([f"{reste} mois"] if reste else [])
    return mois, " et ".join(morceaux) or "moins d'un mois"


def _date(v: Any) -> Optional[date]:
    if isinstance(v, date):
        return v
    if isinstance(v, str) and len(v) >= 10:
        try:
            return date.fromisoformat(v[:10])
        except ValueError:
            return None
    return None


class FournisseurDepart(Fournisseur):
    code = "DEPART"
    libelle = "Départs des collaborateurs (sortie, solde de tout compte)"
    nature = "RH_DATE"
    contexte_requis = ("periode|collaborateurs",)

    def champs(self) -> list[ChampDecl]:
        exclus = ("precedent.", "comparaison.", "periode.")
        base = [c for c in CHAMPS_BULLETIN if not c.code.startswith(exclus) and c.code not in ("id", "mouvement", "sortant")]
        return [_t("id", "Identifiant du départ", "Ligne"), _t("bulletin_id", "Bulletin de sortie (identifiant)", "Ligne"),
                _t("bulletin_periode", "Période du bulletin de sortie", "Ligne")] + base + CHAMPS_DEPART

    def relations(self) -> list[RelationDecl]:
        # lignes du bulletin de sortie (détail du solde de tout compte)
        return [RelationDecl("lignes", "BULLETIN_LIGNE", "PLUSIEURS", "bulletin_id", "bulletin_id")]

    def lire(self, db: Session, parametres: dict, sec: ContexteSecurite) -> list[Ligne]:
        if not table_existe(db, "collaborateur_departs"):
            raise ErreurSource("Module des départs absent (table collaborateur_departs)")
        p = parametres or {}
        conds, binds, expanding = [], {"s": sec.societe_id}, []
        mois = p.get("periode") if isinstance(p.get("periode"), dict) else None
        collabs = [str(x.get("id") if isinstance(x, dict) else x) for x in
                   (p.get("collaborateurs") or ([p["collaborateur"]] if p.get("collaborateur") else []))]
        if not mois and not collabs:
            raise ErreurSource("Paramètre requis : le mois de sortie ou les collaborateurs")
        if mois:
            conds.append("d.date_depart BETWEEN :d1 AND :d2")
            binds.update(d1=mois["date_debut"], d2=mois["date_fin"])
        if collabs:
            conds.append("CAST(d.collaborateur_id AS text) IN :collabs")
            binds["collabs"] = collabs
            expanding.append("collabs")
        societe = ["EXISTS (SELECT 1 FROM bulletin b JOIN calendrier_paie c ON c.id = b.periode_id "
                   "WHERE b.collaborateur_id = d.collaborateur_id AND c.societe_id = :s)"]
        if table_existe(db, "bulletin_historique"):
            societe.append("EXISTS (SELECT 1 FROM bulletin_historique b JOIN calendrier_paie c ON c.id = b.periode_id "
                           "WHERE b.collaborateur_id = d.collaborateur_id AND c.societe_id = :s)")
        if table_existe(db, "collaborateur_contrats"):
            societe.append("EXISTS (SELECT 1 FROM collaborateur_contrats k WHERE k.collaborateur_id = d.collaborateur_id "
                           "AND k.societe_id = :s)")
        motif = "LEFT JOIN ref_motif_depart rm ON rm.code = d.code_motif_depart" if table_existe(db, "ref_motif_depart") else ""
        q = text(f"""SELECT d.*, {"rm.libelle" if motif else "NULL"} AS motif_ref FROM collaborateur_departs d {motif}
                     WHERE ({' OR '.join(societe)}) AND UPPER(COALESCE(d.statut, '')) NOT IN ('ANNULE', 'ANNULÉ')
                     {''.join(' AND ' + c for c in conds)} ORDER BY d.date_depart, d.collaborateur_id""")
        if expanding:
            q = q.bindparams(*(bindparam(n, expanding=True) for n in expanding))
        lignes = []
        for r in db.execute(q, binds).mappings():
            lignes.append(self._ligne(db, dict(r), sec))
        return lignes

    def _dernier_bulletin(self, db: Session, collab: str, sortie: Optional[date], societe: str) -> Optional[str]:
        tables = ["bulletin"] + (["bulletin_historique"] if table_existe(db, "bulletin_historique") else [])
        union = " UNION ALL ".join(
            f"SELECT b.id, c.date_debut, c.date_fin FROM {t} b JOIN calendrier_paie c ON c.id = b.periode_id "
            f"WHERE CAST(b.collaborateur_id AS text) = :c AND CAST(c.societe_id AS text) = :s" for t in tables)
        r = db.execute(text(f"""SELECT CAST(id AS text) FROM ({union}) x
                                WHERE (CAST(:d AS date) IS NULL OR date_debut <= CAST(:d AS date))
                                ORDER BY date_fin DESC LIMIT 1"""), {"c": collab, "s": societe, "d": sortie}).scalar()
        return r

    def _ligne(self, db: Session, d: dict, sec: ContexteSecurite) -> Ligne:
        collab = str(d["collaborateur_id"])
        bid = self._dernier_bulletin(db, collab, d.get("date_depart"), sec.societe_id)
        base: Ligne = {}
        if bid:
            lus = FournisseurBulletin().lire(db, {"bulletin": bid, "_sans_comparaison": True}, sec)
            base = lus[0] if lus else {}
        if not base.get("identite") and table_existe(db, "collaborateurs"):
            c = db.execute(text("""SELECT matricule, civilite, nom, prenom, cin, num_cnss, date_naissance, lieu_naissance
                                   FROM collaborateurs WHERE CAST(id AS text) = :c"""), {"c": collab}).mappings().first()
            if c:
                base["identite"] = {k: propre(v) for k, v in dict(c).items()}
        depart = {k: propre(v) for k, v in d.items() if k not in _TECHNIQUES and not k.endswith("_path") and k != "motif_ref"}
        depart["motif_libelle"] = d.get("motif_ref") or d.get("motif_depart")
        embauche = _date((base.get("contrat") or {}).get("date_embauche"))
        depart["anciennete_mois"], depart["anciennete_texte"] = anciennete(embauche, _date(d.get("date_depart")))
        periode = base.get("periode") or {}
        return {**base, "id": str(d["id"]), "collaborateur_id": collab, "bulletin_id": bid,
                "bulletin_periode": periode.get("intitule"), "depart": depart}


enregistrer(FournisseurDepart())
