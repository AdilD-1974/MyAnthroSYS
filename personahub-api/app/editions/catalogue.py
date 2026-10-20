"""
app/editions/catalogue.py — Synchronisation et lecture du catalogue des sources.
Auteur : Adil DAIA — lot 1 de la plateforme d'éditions unifiée (16/10/2026)

RG-EDT-SOURCE-04 (Adil DAIA) : le catalogue est écrit par les fournisseurs
(code), jamais par une saisie SQL. L'administrateur ne règle que le libellé,
la sensibilité et la visibilité d'un champ ; la synchronisation ne les écrase
jamais une fois modifiés.

SQL standard (SELECT puis INSERT/UPDATE), sans ON CONFLICT : portable SQL Server.
"""
from __future__ import annotations

import json
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.editions.sources import REGISTRE
from app.editions.validation import CatalogueValidation


def synchroniser(db: Session) -> dict:
    """Aligne edt_source, edt_source_champ et edt_source_relation sur les
    fournisseurs enregistrés. À appeler au démarrage de l'API. Ne valide pas
    la transaction : l'appelant fait commit()."""
    bilan = {"sources": 0, "champs_ajoutes": 0, "champs_mis_a_jour": 0, "champs_desactives": 0, "relations": 0}
    # RG-EDT-DICO-04 (migration 081) : champs ajoutés et groupes modifiés dans le dictionnaire, préservés
    dico = db.execute(text("""SELECT count(*) FROM information_schema.columns WHERE table_schema = current_schema()
                              AND table_name = 'edt_source_champ' AND column_name IN ('perso', 'groupe_modifie')""")).scalar() == 2
    for code, f in list(REGISTRE.items()):
        if getattr(f, "perso", False):                  # source personnalisée : écrite par le dictionnaire
            continue
        fournisseur = f"{type(f).__module__}.{type(f).__name__}"
        existe = db.execute(text("SELECT 1 FROM edt_source WHERE code = :c"), {"c": code}).first()
        valeurs = {"c": code, "l": f.libelle, "n": f.nature, "f": fournisseur,
                   "ctx": json.dumps(list(f.contexte_requis))}
        if existe:
            db.execute(text("""UPDATE edt_source SET libelle = :l, nature = :n, fournisseur = :f,
                               contexte_requis = CAST(:ctx AS jsonb), actif = true, synchronise_le = CURRENT_TIMESTAMP
                               WHERE code = :c"""), valeurs)
        else:
            db.execute(text("""INSERT INTO edt_source (code, libelle, nature, fournisseur, contexte_requis)
                               VALUES (:c, :l, :n, :f, CAST(:ctx AS jsonb))"""), valeurs)
        bilan["sources"] += 1

        cols = "code, libelle_modifie, perso, groupe_modifie" if dico else "code, libelle_modifie, false AS perso, false AS groupe_modifie"
        actuels = {r["code"]: dict(r) for r in db.execute(text(
            f"SELECT {cols} FROM edt_source_champ WHERE source_code = :c"), {"c": code}).mappings()}
        declares = {ch.code: (i, ch) for i, ch in enumerate(f.champs())}
        for champ, (ordre, ch) in declares.items():
            v = {"s": code, "c": champ, "l": ch.libelle, "g": ch.groupe, "t": ch.type_donnee,
                 "ch": champ, "m": ch.masque_defaut, "sens": ch.sensible, "o": ordre}
            if champ not in actuels:
                db.execute(text("""INSERT INTO edt_source_champ
                    (source_code, code, libelle, groupe, type_donnee, chemin, masque_defaut, sensible, ordre)
                    VALUES (:s, :c, :l, :g, :t, :ch, :m, :sens, :o)"""), v)
                bilan["champs_ajoutes"] += 1
            elif actuels[champ]["perso"]:
                continue                                # champ ajouté portant le même code : il reste tel quel
            else:
                maj_libelle = "" if actuels[champ]["libelle_modifie"] else "libelle = :l,"
                maj_groupe = "" if actuels[champ]["groupe_modifie"] else "groupe = :g,"
                db.execute(text(f"""UPDATE edt_source_champ SET {maj_libelle} {maj_groupe} type_donnee = :t,
                    chemin = :ch, masque_defaut = COALESCE(masque_defaut, :m), ordre = :o, actif = true
                    WHERE source_code = :s AND code = :c"""), v)
                bilan["champs_mis_a_jour"] += 1
        for champ in {c for c, a in actuels.items() if not a["perso"]} - set(declares):
            db.execute(text("UPDATE edt_source_champ SET actif = false WHERE source_code = :s AND code = :c"),
                       {"s": code, "c": champ})
            bilan["champs_desactives"] += 1

    # relations, une fois toutes les sources présentes (clé étrangère cible)
    for code, f in list(REGISTRE.items()):
        for rel in f.relations():
            v = {"s": code, "c": rel.code, "cible": rel.cible, "card": rel.cardinalite,
                 "cs": rel.cle_source, "cc": rel.cle_cible}
            if db.execute(text("SELECT 1 FROM edt_source_relation WHERE source_code = :s AND code = :c"), v).first():
                db.execute(text("""UPDATE edt_source_relation SET cible_code = :cible, cardinalite = :card,
                                   cle_source = :cs, cle_cible = :cc WHERE source_code = :s AND code = :c"""), v)
            else:
                db.execute(text("""INSERT INTO edt_source_relation
                                   (source_code, code, cible_code, cardinalite, cle_source, cle_cible)
                                   VALUES (:s, :c, :cible, :card, :cs, :cc)"""), v)
            bilan["relations"] += 1
    return bilan


def charger(db: Session, societe_id: Optional[str] = None) -> CatalogueValidation:
    """Catalogue utilisé par la validation : champs actifs (même masqués du
    designer : un modèle existant qui les utilise reste valide), relations,
    rubriques non archivées, constantes, masques de la société."""
    champs: dict[str, set[str]] = {}
    for r in db.execute(text("""SELECT c.source_code, c.code FROM edt_source_champ c
                                JOIN edt_source s ON s.code = c.source_code
                                WHERE c.actif = true AND s.actif = true""")).mappings():
        champs.setdefault(r["source_code"], set()).add(r["code"])
    relations = {(r["source_code"], r["code"]): r["cible_code"] for r in db.execute(text(
        "SELECT source_code, code, cible_code FROM edt_source_relation")).mappings()}
    filtre_soc = "AND (societe_id = :s OR societe_id IS NULL)" if societe_id else ""
    rubriques = {r[0] for r in db.execute(text(
        f"SELECT code FROM rubrique_paie WHERE archive = false AND traiter = true {filtre_soc}"),
        {"s": societe_id}).all()}
    constantes = {r[0] for r in db.execute(text(
        f"SELECT code FROM ref_constante_paie WHERE actif = true {filtre_soc}"), {"s": societe_id}).all()}
    masques = {r[0] for r in db.execute(text(
        f"SELECT code FROM edt_masque WHERE actif = true {filtre_soc}"), {"s": societe_id}).all()}
    return CatalogueValidation(champs=champs, relations=relations, rubriques=rubriques,
                               constantes=constantes, masques=masques)


def champs_sensibles(db: Session, source: str) -> set[str]:
    """Champs marqués sensibles par l'administrateur (prime sur la déclaration du fournisseur)."""
    return {r[0] for r in db.execute(text(
        "SELECT code FROM edt_source_champ WHERE source_code = :s AND sensible = true AND actif = true"),
        {"s": source}).all()}
