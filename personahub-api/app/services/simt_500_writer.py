"""
simt_500_writer.py
Moteur de génération de fichiers de virement au format SIMT (GSIMT national
marocain, 500 caractères par enregistrement).

Réécrit intégralement à partir des spécifications officielles fournies :
 - BMCI  : "Les structures de fichiers SIMT" (BNP Paribas Cash Management)
 - CDM   : "Structure Virements SIMT CDM" — PARTICULARITÉ : pas d'enregistrement
           entête ; RIB émetteur + motif reportés dans l'enregistrement fin.
 - BMCE  : "Virement BMCE" — PARTICULARITÉ : enregistrement détail en code
           "30" (pas "04").
 - ATW (Attijariwafa) et SGMB : structure "simplifiée" (en-tête réduit à un
           numéro de donneur d'ordre attribué par la banque après tests).

L'enregistrement DÉTAIL (le seul qui déplace vraiment l'argent) est
identique à un octet près entre BMCI/CDM/BMCE — c'est la partie la plus
fiable de ce fichier. Les enregistrements ENTÊTE et FIN varient réellement
d'une banque à l'autre ; ils sont donc pilotés par un "profil" par banque
plutôt que codés en dur une seule fois.

⚠️ Points non couverts par les specs fournies, à vérifier avant mise en
production réelle (pas juste des tests) :
 - Code lieu de compensation : posé à "780" (Casablanca) par défaut pour
   l'émetteur ET le récepteur, conforme aux exemples CDM/BMCE — mais aucune
   banque ne confirme explicitement que 780 convient à toutes les places de
   compensation possibles.
 - "Numéro de remise" et "Référence interne" (sous-champs de la référence
   interbancaire, positions 26-43 du détail) : générés ici de façon
   séquentielle locale, aucune banque ne précise le format exact attendu
   au-delà de "renseigné par l'émetteur".
 - CIH, CFG, GCAM et les banques non listées ci-dessus : aucune spec reçue
   à ce jour — le profil "standard" (BMCI) est utilisé par défaut, à
   confirmer avant tout envoi réel à ces banques.
 - N° donneur d'ordre (profil "simplifie", ATW/SGMB) : les deux documents
   indiquent explicitement "à communiquer après la fin des tests" — laissé
   à zéro/blanc tant que vous n'avez pas ce numéro attribué par la banque.
 - Validation Modulo 97 du RIB : implémentée mais désactivée par défaut
   (voir valider_rib_modulo97), formule jamais confirmée par une banque
   réelle.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Literal


# ---------------------------------------------------------------------------
# Utilitaires de formatage — communs à tous les enregistrements/banques
# ---------------------------------------------------------------------------

def _sans_accents(texte: str) -> str:
    normalise = unicodedata.normalize("NFKD", texte or "")
    sans_accent = "".join(c for c in normalise if not unicodedata.combining(c))
    return sans_accent.encode("ascii", "ignore").decode("ascii").upper()


def champ_alphanum(valeur: str, longueur: int) -> str:
    """Aligné à gauche, complété par des espaces à droite, ASCII strict."""
    nettoye = _sans_accents(valeur or "")
    return nettoye[:longueur].ljust(longueur)


def champ_numerique(valeur: int | str, longueur: int) -> str:
    """Aligné à droite, complété par des zéros à gauche."""
    chaine = str(valeur)
    if not chaine.isdigit():
        raise ValueError(f"Valeur non numérique pour un champ numérique SIMT : {valeur!r}")
    if len(chaine) > longueur:
        raise ValueError(f"Valeur trop longue pour un champ de {longueur} positions : {valeur!r}")
    return chaine.rjust(longueur, "0")


def champ_blanc(longueur: int) -> str:
    return " " * longueur


def montant_en_centimes(montant: float, longueur: int) -> str:
    centimes = round(montant * 100)
    return champ_numerique(centimes, longueur)


def valider_rib_modulo97(rib: str) -> bool:
    """⚠️ Formule non confirmée par une banque réelle — voir avertissement en tête de fichier."""
    if not rib or not rib.isdigit() or len(rib) != 24:
        return False
    return int(rib) % 97 == 1


# ---------------------------------------------------------------------------
# Profils par banque — c'est ici que les vraies différences structurelles
# entre banques sont déclarées, pas dans le code de génération lui-même.
# ---------------------------------------------------------------------------

StyleEntete = Literal["standard", "aucun", "simplifie"]
StyleFin = Literal["standard", "avec_rib_motif"]


@dataclass
class ProfilBanque:
    code_type_detail: str = "04"          # "04" (BMCI/CDM/ATW/SGMB) ou "30" (BMCE)
    style_entete: StyleEntete = "standard"
    style_fin: StyleFin = "standard"
    code_lieu_compensation: str = "780"   # Casablanca — cf. avertissement en tête de fichier


PROFILS_PAR_BANQUE: dict[str, ProfilBanque] = {
    "CDM": ProfilBanque(code_type_detail="04", style_entete="aucun", style_fin="avec_rib_motif"),
    "BMCE": ProfilBanque(code_type_detail="30", style_entete="standard", style_fin="standard"),
    "ATTI": ProfilBanque(code_type_detail="04", style_entete="simplifie", style_fin="standard"),
    "SGMB": ProfilBanque(code_type_detail="04", style_entete="simplifie", style_fin="standard"),
    "BMCI": ProfilBanque(code_type_detail="04", style_entete="standard", style_fin="standard"),
}
PROFIL_PAR_DEFAUT = ProfilBanque()  # utilisé pour CFG/CIH/GCAM/etc. — non confirmé, voir avertissement


def profil_pour(code_banque: str) -> ProfilBanque:
    return PROFILS_PAR_BANQUE.get(code_banque.upper(), PROFIL_PAR_DEFAUT)


# ---------------------------------------------------------------------------
# Structures d'entrée
# ---------------------------------------------------------------------------

@dataclass
class CompteEmetteur:
    code_banque: str        # code ref_banque (ex. "CDM") — sert à choisir le profil
    code_simt: str          # 3 positions numériques
    rib: str                # 24 chiffres
    raison_sociale: str     # 35 car. max — nom du donneur d'ordre


@dataclass
class LigneVirementSimt:
    reference_transaction: str   # matricule/référence — utilisée pour la référence interne
    montant: float
    rib_beneficiaire: str        # 24 chiffres
    nom_beneficiaire: str        # 35 car. max
    libelle_motif: str           # 35 car. max (libellé 1 pour le bénéficiaire)


NATURE_OPERATION_CODE = "020"  # code type opération SIMT pour un virement (constant, toutes banques)


# ---------------------------------------------------------------------------
# Enregistrement DÉTAIL (code 04 ou 30) — identique à un octet près entre
# banques, seule la valeur du code type enregistrement change (profil).
# ---------------------------------------------------------------------------

def _ligne_detail(
    compte: CompteEmetteur,
    profil: ProfilBanque,
    ligne: LigneVirementSimt,
    numero_remise: int,
    reference_interne: int,
    aujourd_hui: date,
) -> str:
    code_banque_beneficiaire = ligne.rib_beneficiaire[:3]

    contenu = (
        champ_numerique(profil.code_type_detail, 2)                       # 001-002 code type enregistrement
        + champ_alphanum(NATURE_OPERATION_CODE, 3)                        # 003-005 code type opération = 020
        + champ_numerique(compte.code_simt, 3)                            # 006-008 code établissement émetteur
        + champ_numerique(code_banque_beneficiaire, 3)                    # 009-011 code établissement récepteur (banque du bénéficiaire)
        + champ_numerique(profil.code_lieu_compensation, 3)               # 012-014 lieu de compensation émetteur
        + champ_numerique(profil.code_lieu_compensation, 3)               # 015-017 lieu de compensation récepteur
        + champ_numerique(aujourd_hui.strftime("%Y%m%d"), 8)              # 018-025 date d'échange
        + champ_numerique(compte.code_simt, 3)                            # 026-028 code établissement émetteur (répété)
        + champ_numerique(numero_remise, 3)                               # 029-031 numéro de remise
        + champ_numerique(reference_interne, 12)                          # 032-043 référence interne
        + champ_alphanum("MAD2", 4)                                       # 044-047 code devise + décimales
        + montant_en_centimes(ligne.montant, 16)                          # 048-063 montant de la transaction
        + champ_numerique(aujourd_hui.strftime("%Y%m%d"), 8)              # 064-071 date de compensation
        + champ_numerique(aujourd_hui.strftime("%Y%m%d"), 8)              # 072-079 date de règlement
        + champ_blanc(3)                                                  # 080-082 code motif de rejet (vide à l'aller)
        + champ_blanc(18)                                                 # 083-100 zone réservée
        + champ_numerique("00", 2)                                        # 101-102 sous-code opération
        + champ_blanc(34)                                                 # 103-136 zone réservée
        + champ_numerique("1", 1)                                         # 137     nature du compte donneur d'ordre
        + champ_alphanum(compte.raison_sociale, 35)                       # 138-172 nom du donneur d'ordre
        + champ_alphanum(ligne.nom_beneficiaire, 35)                      # 173-207 nom du bénéficiaire
        + champ_numerique(compte.rib, 24)                                 # 208-231 RIB du donneur d'ordre
        + champ_numerique(ligne.rib_beneficiaire, 24)                     # 232-255 RIB du bénéficiaire
        + champ_numerique(aujourd_hui.strftime("%Y%m%d"), 8)              # 256-263 date de création du virement
        + champ_alphanum(ligne.libelle_motif, 35)                         # 264-298 libellé 1 (motif)
        + champ_blanc(175)                                                # 299-473 libellés 2 à 6 (non utilisés)
        + champ_numerique(ligne.reference_transaction.zfill(24)[-24:] if ligne.reference_transaction.isdigit() else "0" * 24, 24)  # 474-497 référence client donneur d'ordre
        + champ_blanc(3)                                                  # 498-500 zone réservée
    )
    assert len(contenu) == 500, f"Ligne détail SIMT malformée ({len(contenu)} caractères)"
    return contenu


# ---------------------------------------------------------------------------
# Enregistrement ENTÊTE (code 10) — 3 variantes selon le profil
# ---------------------------------------------------------------------------

def _ligne_entete_standard(compte: CompteEmetteur, reference_lot: str, maintenant: datetime) -> str:
    contenu = (
        champ_numerique("10", 2)                                          # 001-002
        + champ_alphanum(reference_lot[:5], 5)                            # 003-007 identifiant service (facultatif)
        + champ_alphanum(reference_lot[:6], 6)                            # 008-013 identifiant de la source (obligatoire)
        + champ_alphanum(reference_lot[-4:], 4)                           # 014-017 numéro unique du lot
        + champ_blanc(3)                                                  # 018-020 code participant SIMT (facultatif)
        + champ_numerique(maintenant.strftime("%Y%m%d"), 8)               # 021-028 date de création
        + champ_numerique(maintenant.strftime("%H%M%S"), 6)               # 029-034 heure de création
        + champ_alphanum("MAD", 3)                                        # 035-037 code devise
        + champ_numerique("2", 1)                                         # 038     nombre de décimales
        + champ_blanc(462)                                                # 039-500 zone réservée
    )
    assert len(contenu) == 500, f"Ligne entête SIMT (standard) malformée ({len(contenu)} caractères)"
    return contenu


def _ligne_entete_simplifie(reference_lot: str, maintenant: datetime) -> str:
    """Profil ATW/SGMB — le "N° Donneur d'ordre" (7 positions) est attribué
    par la banque après une phase de tests ; laissé à zéro tant qu'il n'est
    pas communiqué (voir avertissement en tête de fichier)."""
    contenu = (
        champ_numerique("10", 2)                                          # 001-002
        + champ_alphanum(reference_lot, 18)                               # 003-020 références remise
        + champ_numerique(maintenant.strftime("%Y%m%d"), 8)               # 021-028 date de production
        + champ_numerique(maintenant.strftime("%H%M%S"), 6)               # 029-034 heure de production
        + champ_alphanum("MAD", 3)                                        # 035-037 code devise
        + champ_numerique("2", 1)                                         # 038     décimale devise
        + champ_blanc(2)                                                  # 039-040 zone réservée
        + champ_numerique("0", 7)                                         # 041-047 N° donneur d'ordre — ⚠️ à communiquer par la banque
        + champ_blanc(453)                                                # 048-500 zone réservée
    )
    assert len(contenu) == 500, f"Ligne entête SIMT (simplifié) malformée ({len(contenu)} caractères)"
    return contenu


# ---------------------------------------------------------------------------
# Enregistrement FIN (code 11) — 2 variantes selon le profil
# ---------------------------------------------------------------------------

def _ligne_fin_standard(nb_virements: int, montant_total: float) -> str:
    contenu = (
        champ_numerique("11", 2)                                          # 001-002
        + champ_numerique(nb_virements, 5)                                # 003-007 nombre d'opérations présentées
        + montant_en_centimes(montant_total, 20)                          # 008-027 montant total des opérations
        + champ_blanc(473)                                                # 028-500 zone réservée (+ champs "retour banque", blancs à l'aller)
    )
    assert len(contenu) == 500, f"Ligne fin SIMT (standard) malformée ({len(contenu)} caractères)"
    return contenu


def _ligne_fin_avec_rib_motif(nb_virements: int, montant_total: float, compte: CompteEmetteur, motif_global: str) -> str:
    """Profil CDM — pas d'enregistrement entête, donc le RIB de l'ordonnateur
    et un motif global sont reportés dans l'enregistrement fin."""
    contenu = (
        champ_numerique("11", 2)                                          # 001-002
        + champ_numerique(nb_virements, 5)                                # 003-007
        + montant_en_centimes(montant_total, 20)                          # 008-027
        + champ_numerique(compte.rib, 24)                                 # 028-051 RIB ordonnateur
        + champ_alphanum(motif_global, 32)                                # 052-083 motif opération
        + champ_blanc(417)                                                # 084-500 zone réservée
    )
    assert len(contenu) == 500, f"Ligne fin SIMT (avec RIB/motif) malformée ({len(contenu)} caractères)"
    return contenu


# ---------------------------------------------------------------------------
# Point d'entrée
# ---------------------------------------------------------------------------

def generer_fichier_simt(
    reference_lot: str,
    compte: CompteEmetteur,
    type_ordre: str,
    lignes: list[LigneVirementSimt],
    maintenant: datetime | None = None,
) -> str:
    if not lignes:
        raise ValueError("Impossible de générer un fichier SIMT sans aucune ligne de virement")

    maintenant = maintenant or datetime.now()
    aujourd_hui = maintenant.date()
    profil = profil_pour(compte.code_banque)

    for l in lignes:
        if not l.rib_beneficiaire or len(l.rib_beneficiaire) != 24 or not l.rib_beneficiaire.isdigit():
            raise ValueError(f"RIB bénéficiaire invalide (24 chiffres attendus) : {l.rib_beneficiaire!r}")
        # if not valider_rib_modulo97(l.rib_beneficiaire):
        #     raise ValueError(f"Clé RIB invalide (Modulo 97) : {l.rib_beneficiaire!r}")
        #     # ↑ désactivé tant que la formule n'est pas confirmée en production

    montant_total = sum(l.montant for l in lignes)
    numero_remise = 1  # un seul lot par fichier dans notre cas ; incrémenter si plusieurs lots/jour

    corps: list[str] = []

    if profil.style_entete == "standard":
        corps.append(_ligne_entete_standard(compte, reference_lot, maintenant))
    elif profil.style_entete == "simplifie":
        corps.append(_ligne_entete_simplifie(reference_lot, maintenant))
    # style "aucun" (CDM) : pas de ligne entête, on passe directement au détail

    for i, l in enumerate(lignes, start=1):
        corps.append(_ligne_detail(compte, profil, l, numero_remise, i, aujourd_hui))

    if profil.style_fin == "avec_rib_motif":
        motif_global = lignes[0].libelle_motif if len(set(l.libelle_motif for l in lignes)) == 1 else f"VIREMENTS {type_ordre}"
        corps.append(_ligne_fin_avec_rib_motif(len(lignes), montant_total, compte, motif_global))
    else:
        corps.append(_ligne_fin_standard(len(lignes), montant_total))

    return "\r\n".join(corps) + "\r\n"
