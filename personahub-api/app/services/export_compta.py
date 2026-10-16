"""
Adaptateurs d'export des écritures comptables.

Le moteur de génération (comptabilisation_engine.py) produit un modèle
interne normalisé (compte, libellé, sens, montant, axe). Chaque adaptateur ne
fait QUE la mise en forme finale à partir de ce modèle + du `mapping` JSONB
de `ref_format_export_compta` — ajouter un logiciel cible ne doit jamais
toucher au moteur de génération (cf. MODULE_COMPTA_PAIE.md §4.1).
"""
from __future__ import annotations

import csv
import io
from datetime import date
from decimal import Decimal
from typing import Any, Protocol


class LigneExport(Protocol):
    compte: str
    libelle: str | None
    sens: str
    montant: Decimal
    axe_analytique: str | None


def _fmt_montant(montant: Decimal, decimal_sep: str) -> str:
    s = f"{montant:.2f}"
    return s.replace(".", decimal_sep) if decimal_sep != "." else s


def _fmt_date(d: date, fmt: str) -> str:
    return d.strftime(fmt)


# ---------------------------------------------------------------------------
# Adaptateur générique piloté par mapping JSONB — couvre SAGE_CSV,
# GENERIQUE_CSV et FEC, qui ne diffèrent que par colonnes/séparateur/format.
# ---------------------------------------------------------------------------
def exporter_csv(
    lignes: list[dict[str, Any]],
    mapping: dict[str, Any],
    *,
    journal_code: str,
    date_ecriture: date,
    numero_piece: str | None,
) -> bytes:
    """
    lignes : sortie de comptabilisation_engine.agreger() ou détail nominatif,
             chaque dict a au moins compte/libelle/sens/montant/axe_analytique.
    mapping : `ref_format_export_compta.mapping` (voir 23_comptabilite_paie.sql
              pour les valeurs par défaut de SAGE_CSV / FEC / GENERIQUE_CSV).
    """
    separateur = mapping.get("separateur", ";")
    decimal_sep = mapping.get("decimal", ",")
    date_fmt = mapping.get("date_format", "%d%m%Y")
    colonnes = mapping["colonnes"]

    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=separateur, lineterminator="\r\n")
    writer.writerow(colonnes)

    for ligne in lignes:
        valeurs_disponibles = {
            "JournalCode": journal_code,
            "JournalLib": "Paie",
            "EcritureNum": "",
            "EcritureDate": _fmt_date(date_ecriture, date_fmt),
            "Date": _fmt_date(date_ecriture, date_fmt),
            "CompteNum": ligne["compte"],
            # compte_libelle = ref_imputation_comptable.intitule_compte, résolu
            # par le routeur (01/08) — distinct de "libelle" (code rubrique, qui
            # sert de description de ligne, pas d'intitulé de compte). Repli sur
            # "libelle" seulement si aucune imputation n'est paramétrée pour ce
            # compte, pour ne jamais laisser CompteLib totalement vide.
            "CompteLib": ligne.get("compte_libelle") or ligne.get("libelle", ""),
            # 01/08 : résolus en amont dans compta_paie.py::exporter_lot (jointure
            # ref_imputation_comptable + collaborateurs), jamais ici — cet
            # adaptateur reste volontairement agnostique de la base, cf. docstring
            # du module. Vide si le compte ne nécessite pas d'auxiliaire, ou si le
            # type d'auxiliaire n'est pas encore résolvable (ex. ORGANISME).
            "CompAuxNum": ligne.get("comp_aux_num") or "",
            "CompAuxLib": ligne.get("comp_aux_lib") or "",
            "PieceRef": numero_piece or "",
            "PieceDate": _fmt_date(date_ecriture, date_fmt),
            "EcritureLib": ligne.get("libelle", ""),
            "Libelle": ligne.get("libelle", ""),
            "Debit": _fmt_montant(ligne["montant"], decimal_sep) if ligne["sens"] == "D" else "0",
            "Credit": _fmt_montant(ligne["montant"], decimal_sep) if ligne["sens"] == "C" else "0",
            "compte": ligne["compte"],
            "sens": ligne["sens"],
            "montant": _fmt_montant(ligne["montant"], decimal_sep),
            "axe_analytique": ligne.get("axe_analytique") or "",
        }
        writer.writerow([valeurs_disponibles.get(col, "") for col in colonnes])

    encodage = mapping.get("encodage", "utf-8")
    return buffer.getvalue().encode(encodage, errors="replace")


# ---------------------------------------------------------------------------
# Export XLSX générique (pour vérification manuelle avant import)
# ---------------------------------------------------------------------------
def exporter_xlsx(lignes: list[dict[str, Any]], mapping: dict[str, Any]) -> bytes:
    from openpyxl import Workbook  # import différé : dépendance optionnelle

    wb = Workbook()
    ws = wb.active
    ws.title = "Ecritures"
    colonnes = mapping["colonnes"]
    ws.append(colonnes)
    for ligne in lignes:
        ws.append([ligne.get(col, "") for col in colonnes])

    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


# ---------------------------------------------------------------------------
# Point d'entrée unique utilisé par le routeur
# ---------------------------------------------------------------------------
def exporter(
    format_code: str,
    lignes: list[dict[str, Any]],
    mapping: dict[str, Any],
    *,
    journal_code: str,
    date_ecriture: date,
    numero_piece: str | None,
    annee: int,
    mois: int,
    numero_periode: int,
) -> tuple[bytes, str, str]:
    """Retourne (contenu, nom_fichier, content_type).

    ⚠️ 06/08 : le suffixe du nom de fichier est basé sur la PÉRIODE DU LOT
    (annee/mois/numero_periode, cf. calendrier_paie), pas sur date_ecriture —
    ce dernier retombait sur date.today() quand le lot n'avait pas de date
    d'écriture explicite, produisant un suffixe correspondant à la date de
    génération/export plutôt qu'à la période comptabilisée (ex. un lot de
    juillet exporté le 6 août se retrouvait suffixé "202608").
    """
    suffixe = f"{annee}_{mois:02d}_PER_{numero_periode:02d}"

    if format_code == "GENERIQUE_XLSX":
        contenu = exporter_xlsx(lignes, mapping)
        return contenu, f"ecritures_paie_{suffixe}.xlsx", (
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )

    contenu = exporter_csv(
        lignes, mapping, journal_code=journal_code,
        date_ecriture=date_ecriture, numero_piece=numero_piece,
    )
    ext = "txt" if format_code == "FEC" else "csv"
    return contenu, f"ecritures_paie_{format_code.lower()}_{suffixe}.{ext}", "text/csv"
