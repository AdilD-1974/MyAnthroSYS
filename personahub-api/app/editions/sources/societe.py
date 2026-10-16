"""
app/editions/sources/societe.py — Source SOCIETE : la société active, toujours disponible.
Auteur : Adil DAIA — lot 1 de la plateforme d'éditions unifiée (16/10/2026)

Accessible dans toute formule par le préfixe « societe. » (societe.raison_sociale).
Les numéros d'affiliation viennent de societe_affiliations (code_type_affiliation,
numero_affiliation), comme le bordereau CNSS — la colonne societes.affiliation_cnss
n'existe pas. Constat du 16/10 : societe_affiliations est vide en recette, le
n° CNSS employeur doit y être saisi.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.editions.sources.base import (
    ChampDecl, ContexteSecurite, ErreurSource, Fournisseur, Ligne, enregistrer, ligne_propre,
)

_COLS = ("id", "code_societe", "raison_sociale", "nom_commercial", "forme_juridique", "adresse",
         "code_postal", "ville", "telephone", "email", "site_web", "identifiant_fiscal", "ice",
         "registre_commerce", "patente", "capital_social", "code_devise_capital", "nom_gerant", "logo_path")


def _t(code, libelle, type_donnee="TEXTE"):
    return ChampDecl(code, libelle, type_donnee, "Société")


CHAMPS_SOCIETE = [
    _t("raison_sociale", "Raison sociale"), _t("nom_commercial", "Nom commercial"),
    _t("code_societe", "Code société"), _t("forme_juridique", "Forme juridique"),
    _t("adresse", "Adresse"), _t("code_postal", "Code postal"), _t("ville", "Ville"),
    _t("telephone", "Téléphone"), _t("email", "E-mail"), _t("site_web", "Site web"),
    _t("identifiant_fiscal", "Identifiant fiscal (IF)"), _t("ice", "ICE"),
    _t("registre_commerce", "Registre de commerce"), _t("patente", "Patente"),
    _t("capital_social", "Capital social", "MONTANT"), _t("code_devise_capital", "Devise du capital"),
    _t("nom_gerant", "Gérant"), _t("logo_path", "Logo (chemin)", "IMAGE"),
    _t("numero_cnss", "N° d'affiliation CNSS"), _t("numero_cimr", "N° d'adhésion CIMR"),
    _t("affiliations.*", "N° d'affiliation par organisme"),
]


class FournisseurSociete(Fournisseur):
    code = "SOCIETE"
    libelle = "Société active"
    nature = "REFERENTIEL"

    def champs(self) -> list[ChampDecl]:
        return CHAMPS_SOCIETE

    def lire(self, db: Session, parametres: Optional[dict], sec: ContexteSecurite) -> list[Ligne]:
        row = db.execute(text(f"SELECT {', '.join(_COLS)} FROM societes WHERE id = :id"),
                         {"id": sec.societe_id}).mappings().first()
        if row is None:
            raise ErreurSource("Société active introuvable")
        ligne = ligne_propre(row)
        affiliations = {}
        for r in db.execute(text("""
                SELECT code_type_affiliation, numero_affiliation FROM societe_affiliations
                WHERE societe_id = :id AND (date_fin IS NULL OR date_fin >= CURRENT_DATE)
                ORDER BY date_adhesion"""), {"id": sec.societe_id}).mappings():
            if r["code_type_affiliation"]:
                affiliations[str(r["code_type_affiliation"]).upper()] = r["numero_affiliation"]
        ligne["affiliations"] = affiliations
        ligne["numero_cnss"] = next((v for k, v in affiliations.items() if "CNSS" in k), None)
        ligne["numero_cimr"] = next((v for k, v in affiliations.items() if "CIMR" in k), None)
        return [ligne]


enregistrer(FournisseurSociete())
