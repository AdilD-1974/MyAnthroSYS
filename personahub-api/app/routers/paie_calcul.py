"""
app/routers/paie_calcul.py — Endpoints de calcul & consultation des bulletins.
Auteur : Adil DAIA

Monté par app/routers/paie.py sous le préfixe /paie :
    POST   /paie/calcul/collaborateur     calcule (option persister)
    POST   /paie/simulation/bulletin      simule (UC1) — ne persiste jamais
    GET    /paie/bulletins                 liste (filtres periode/collaborateur)
    GET    /paie/bulletins/{id}            détail + lignes
    DELETE /paie/bulletins/{id}            supprime (recalcul propre)
"""
from datetime import datetime, date as _date
from calendar import monthrange
from decimal import Decimal
from uuid import UUID
import json
import re
import time
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor, as_completed

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from sqlalchemy import text
from sqlalchemy.orm import Session, selectinload

from app.core.database import get_db
from app.core.security import require_roles, get_current_user_payload, roles_from_payload, get_societe_active_id
from app.models.paie_resultat import (
    LotPaie, Bulletin, BulletinLigne, Cumul, PaieHistorique, AnneePaie,
    BulletinTemp, BulletinTempLigne, BulletinHistorique, BulletinHistoriqueLigne,
)
from app.schemas.paie_calcul import (
    CalculBulletinRequest, CalculBulletinResult, BulletinRead,
    RapportControle, ValiderRequest, ValidationResult, HistoriqueRead,
    ClotureAnneeRequest, AnneePaieRead,
    PopulationRequest, PopulationFiltres, CollaborateurCible,
    LotCalculRequest, LotCalculResult, LigneLotResultat,
    LotValiderRequest, LotValidationResult, LigneLotValidation,
    InstructionIn, ReglesValiderRequest, ReglesValiderResult,
    ReglesTesterRequest, ReglesTesterResult, ReglesTesterManuelRequest,
    PopulationPaieCriteres, PopulationPaieWrite, PopulationPaieRead,
    PopulationApercuRequest, ConditionSqlValidation,
    RubriquePopulationsWrite, RubriqueDependanceWrite, PopulationRubriquesWrite,
    LignePopulationRubrique,
)
from app.services.paie_engine import calculer_bulletin, simuler_bulletin, ContexteCalcul, ResolverPaie, ResolverManuel, _dec
from app.services.population_paie import resoudre_population, resoudre_toutes_populations_actives
from app.services import regle_dsl
from app.services.validation_engine import controler_bulletin
from app.services import rapport_engine  # ← AJOUT (module Rapports, snapshot collaborateur)
from app.services import pret_service
from app.services import population_paie as pop_service  # ← AJOUT (populations & attribution des rubriques)
from app.schemas.paie_simulation import (
    SimulationBulletinRequest, SimulationImpactRequest, SimulationImpactResult,
    SimulationEmbaucheRequest,
    ScenarioSimulationWrite, ScenarioSimulationPatch, ScenarioSimulationRead,
    GabaritEmbaucheWrite, GabaritEmbauchePatch, GabaritEmbaucheRead,
    CollaborateurOption, PlanPaieOption, PeriodeOption,
    RubriqueSimulable, ReferentielChampResult, ExportExcelRequest,
    RegimeSimulable, SurchargeRegimeSim, PopulationSimulable,
    SimulationPopulationRequest, SimulationPopulationJobCree, SimulationPopulationJobStatut,
    SimulationPopulationJobResume,
    ModeRegroupementBulletins, BulletinSimulePopulation, BulletinSimuleDetail,
    GroupeBulletinsPopulation, ListeBulletinsPopulationResult,
)  # ← AJOUT (module Simulation)

router = APIRouter(tags=["Paie — Calcul & bulletins"])

PAIE_ROLES = ("administrateur", "gestionnaire_rh", "gestionnaire_paie")
D0 = Decimal("0")


def _statut_periode_effectif(statut: str | None, date_ouverture, aujourdhui=None) -> str:
    """Statut EFFECTIF d'une période : CLOTUREE > NON_OUVERTE (date non atteinte) > OUVERTE."""
    if statut == "CLOTUREE":
        return "CLOTUREE"
    if date_ouverture is not None and date_ouverture > (aujourdhui or _date.today()):
        return "NON_OUVERTE"
    return "OUVERTE"


def _exiger_periode_ouverte(db: Session, periode_id, societe_id: str | None = None) -> None:
    """Bloque tout traitement sur une période non ouverte (ou clôturée).
    RG-MULTISOCIETE-07 (migration 057) : societe_id optionnel -- si fourni,
    la période doit en plus appartenir à cette société (calendrier_paie.societe_id
    NOT NULL), sinon 404 (pas 403, pour ne pas confirmer l'existence d'une
    période d'une autre société). None (par défaut) = comportement identique
    à avant migration, pour les rares appelants pas encore mis à jour."""
    if societe_id:
        row = db.execute(text("""
            SELECT statut, date_ouverture FROM public.calendrier_paie WHERE id = :id AND societe_id = :sid
        """), {"id": str(periode_id), "sid": societe_id}).mappings().first()
    else:
        row = db.execute(text("""
            SELECT statut, date_ouverture FROM public.calendrier_paie WHERE id = :id
        """), {"id": str(periode_id)}).mappings().first()
    if not row:
        raise HTTPException(404, "Période introuvable")
    eff = _statut_periode_effectif(row["statut"], row["date_ouverture"])
    if eff == "CLOTUREE":
        raise HTTPException(400, "Période clôturée : aucun traitement possible.")
    if eff == "NON_OUVERTE":
        raise HTTPException(400, f"Période non ouverte (ouverture le {row['date_ouverture'].isoformat()}).")


# ===========================================================================
# Déplacements du bulletin entre les trois tables (cycle de vie physique)
#
#   bulletin_temp  --valider-->  bulletin  --clôturer-->  bulletin_historique
#                  <-dévalider--           <--rouvrir----
#
# L'`id` est CONSERVÉ : les références externes (paie_historique, déclarations)
# restent valides. Le déplacement est un INSERT + DELETE dans la même
# transaction ; les triggers en base refusent tout doublon temp ↔ validé.
# ===========================================================================
_COLS_BULLETIN = """
    id, lot_id, periode_id, plan_paie_id, code_plan, collaborateur_id, matricule,
    total_brut, total_brut_imposable, total_gains, total_retenues,
    total_cot_salariale, total_cot_patronale, net_imposable, net_a_payer,
    cout_employeur, a_erreur, trace, messages, calcule_le, created_at, updated_at
"""
_COLS_LIGNE = """
    id, bulletin_id, code_rubrique, libelle, code_type, type_regle,
    ordre_calcul, ordre_affichage, base, nombre, taux, montant, montant_patronal, taux_patronal,
    sens, est_cotisation, type_periodicite, date_valeur, texte, observation, created_at
"""


def _sql_bulletins_tous(statut_col: bool = True, officiel: bool = False) -> str:
    """Union des trois tables de bulletins, en sous-requête SQL prête à être
    utilisée comme `FROM (...) b`.

    On construit cette union nous-mêmes à partir de `_COLS_BULLETIN` plutôt
    que de s'appuyer sur la vue `v_bulletin_tous` : sa définition exacte
    n'est pas dans ce fichier, et elle s'est avérée ne pas exposer toutes
    les colonnes attendues (ex. `messages`) — mieux vaut dépendre d'une
    liste de colonnes qu'on maîtrise entièrement.

    `officiel=True` exclut `bulletin_temp` (précalculs non validés) : pour
    un écran de CONSULTATION, on ne veut que du définitif (validé/clôturé).
    Un écran opérationnel (suivi du traitement en cours) veut au contraire
    voir les précalculs → `officiel=False` (défaut).

    RG-BULLETIN-DEDUP-HISTORIQUE-01 (Adil DAIA) : depuis RG-BULLETIN-COPIE-
    PERIODE-01, une période clôturée (mais pas encore clôturée annuellement)
    a SON `id` de bulletin présent à la fois dans `bulletin` (copie live,
    statut CLOTURE, pour permettre la réouverture) et dans
    `bulletin_historique` (copie figée). Sans précaution, l'UNION ALL
    remontait donc deux fois le même bulletin. On exclut ici la copie
    `bulletin_historique` tant que sa copie live existe encore dans
    `bulletin` — elle ne redevient la source unique qu'après la clôture
    annuelle (`_archiver_definitivement_bulletins`, qui supprime alors la
    ligne de `bulletin`).
    """
    cols = _COLS_BULLETIN + (", statut" if statut_col else "")
    parts = [] if officiel else [f"SELECT {cols} FROM public.bulletin_temp"]
    parts += [
        f"SELECT {cols} FROM public.bulletin",
        f"""SELECT {cols} FROM public.bulletin_historique bh
             WHERE NOT EXISTS (SELECT 1 FROM public.bulletin b WHERE b.id = bh.id)""",
    ]
    return "(" + " UNION ALL ".join(parts) + ")"


def _sql_bulletins_tous_origine(officiel: bool = False) -> str:
    """Variante de `_sql_bulletins_tous` qui tague chaque ligne avec son
    origine ('TEMP'/'VALIDE'/'CLOTURE'/'HISTORIQUE') — utile pour un écran de
    recherche transverse où l'utilisateur doit voir d'où vient le bulletin.

    RG-BULLETIN-COPIE-PERIODE-01 (Adil DAIA) : `bulletin` peut désormais
    contenir des lignes VALIDE **ou** CLOTURE (clôture de période sans
    déplacement physique) — l'origine reprend donc le vrai `statut` de la
    ligne plutôt qu'un 'VALIDE' figé, qui aurait à tort affiché un bulletin
    clôturé comme validé.

    RG-BULLETIN-DEDUP-HISTORIQUE-01 (Adil DAIA) : même anti-join que
    `_sql_bulletins_tous` — voir son docstring — pour ne pas remonter deux
    fois un bulletin dont la copie live existe encore dans `bulletin`.
    """
    cols = _COLS_BULLETIN + ", statut"
    parts = [] if officiel else [f"SELECT {cols}, 'TEMP' AS origine FROM public.bulletin_temp"]
    parts += [
        f"SELECT {cols}, statut AS origine FROM public.bulletin",
        f"""SELECT {cols}, 'HISTORIQUE' AS origine FROM public.bulletin_historique bh
             WHERE NOT EXISTS (SELECT 1 FROM public.bulletin b WHERE b.id = bh.id)""",
    ]
    return "(" + " UNION ALL ".join(parts) + ")"


# Correspondance origine → (table, modèle bulletin, modèle ligne)
# ⚠️ "origine" ici = table physique où vit la ligne, PAS son statut réel.
# Depuis RG-BULLETIN-COPIE-PERIODE-01, `bulletin` peut contenir des lignes
# VALIDE ou CLOTURE — _localiser_bulletin() renverra quand même "VALIDE"
# pour les deux (il répond juste "dans quelle table ?"). Pour un vrai statut
# affiché à l'utilisateur, lire `.statut` sur l'objet retourné, pas la clé
# "origine". Voir _sql_bulletins_tous_origine() qui, elle, expose le vrai statut.
_ETATS = {
    "TEMP":       ("bulletin_temp",       BulletinTemp,       BulletinTempLigne),
    "VALIDE":     ("bulletin",            Bulletin,           BulletinLigne),
    "HISTORIQUE": ("bulletin_historique", BulletinHistorique, BulletinHistoriqueLigne),
}


def _localiser_bulletin(db: Session, bulletin_id: UUID) -> tuple[str, object]:
    """Retrouve un bulletin dans l'une des trois tables. Renvoie (origine, instance)."""
    for origine, (_, Modele, _l) in _ETATS.items():
        obj = db.query(Modele).filter(Modele.id == bulletin_id).first()
        if obj:
            return origine, obj
    raise HTTPException(404, "Bulletin introuvable")


def _ligne_vers_dict(l) -> dict:
    """Convertit une ligne ORM (bulletin_temp_ligne / bulletin_ligne / bulletin_historique_ligne)
    en dict prêt pour la sérialisation Pydantic. `date_valeur` doit être une chaîne ISO :
    Pydantic v2 ne coerce plus silencieusement un `datetime.date` en `str` (ResponseValidationError,
    qui côté navigateur ressemble à tort à un blocage CORS puisque les en-têtes sautent sur l'erreur)."""
    d = {c.name: getattr(l, c.name) for c in l.__table__.columns}
    if d.get("date_valeur") is not None:
        d["date_valeur"] = d["date_valeur"].isoformat()
    return d


def _lire_bulletins(db: Session, periode_id: UUID | None = None,
                    collaborateur_id: UUID | None = None,
                    collaborateur_ids: list[UUID] | None = None,
                    bulletin_id: UUID | None = None,
                    societe_id: str | None = None) -> list[dict]:
    """Lecture UNIFIÉE des trois états, avec la colonne `origine`.

    L'écran de traitement affiche les précalculs à côté des validés : le
    gestionnaire voit ce qui reste à valider avant de clôturer.

    `collaborateur_ids` restreint à une population précise (ex. celle d'un
    lancement en masse filtré) — sans lui, `periode_id` seul renvoie TOUS les
    bulletins de la période, y compris ceux d'autres lancements/lots.

    RG-MULTISOCIETE-07 (migration 057) : `societe_id` optionnel -- bulletin/
    bulletin_temp/bulletin_historique n'ont pas de societe_id propre
    (catégorie A), le filtre passe par l'ensemble des periode_id de
    calendrier_paie appartenant à cette société (requête à part, pas de
    modèle ORM CalendrierPaie disponible dans ce fichier pour un join direct).
    None (par défaut) = comportement inchangé pour les rares appelants pas
    encore mis à jour.

    RG-BULLETIN-DEDUP-HISTORIQUE-01 (Adil DAIA) : même précaution que
    `_sql_bulletins_tous` — tant que la copie live existe encore dans
    `bulletin` (avant clôture annuelle), on ne renvoie pas en plus sa copie
    figée dans `bulletin_historique` (même `id`, même contenu : ça ne ferait
    que dupliquer visuellement le même bulletin).

    RG-BULLETIN-ORIGINE-VRAI-STATUT-01 (Adil DAIA) : pour une ligne de la
    table `bulletin`, `origine` reprend son vrai `.statut` ('VALIDE' ou
    'CLOTURE') au lieu d'un 'VALIDE' figé — même principe que
    `_sql_bulletins_tous_origine()`. Nécessaire depuis RG-BULLETIN-DEDUP-
    HISTORIQUE-01 : comme la copie `bulletin_historique` est masquée tant que
    la copie live existe, un 'VALIDE' figé rendrait invisible tout bulletin
    clôturé-mais-pas-encore-archivé-annuellement pour les écrans qui filtrent
    sur `origine` (ex. onglet "Archivé" de HistoriqueCollaborateurPage).
    """
    out: list[dict] = []
    ids_bulletin_vivants: set[UUID] = set()
    periode_ids_societe = None
    if societe_id:
        periode_ids_societe = [r[0] for r in db.execute(
            text("SELECT id FROM public.calendrier_paie WHERE societe_id = :sid"), {"sid": societe_id}
        )]
    for origine, (_, Modele, _l) in _ETATS.items():
        q = db.query(Modele).options(selectinload(Modele.lignes))
        if periode_ids_societe is not None:
            q = q.filter(Modele.periode_id.in_(periode_ids_societe))
        if periode_id:
            q = q.filter(Modele.periode_id == periode_id)
        if collaborateur_id:
            q = q.filter(Modele.collaborateur_id == collaborateur_id)
        if collaborateur_ids:
            q = q.filter(Modele.collaborateur_id.in_(collaborateur_ids))
        if bulletin_id:
            q = q.filter(Modele.id == bulletin_id)
        if origine == "HISTORIQUE" and ids_bulletin_vivants:
            # Capturés au passage de la table `bulletin` (loop précédente,
            # _ETATS étant ordonné TEMP/VALIDE/HISTORIQUE) : les id encore
            # présents côté live ne doivent pas ressortir une seconde fois.
            q = q.filter(~Modele.id.in_(ids_bulletin_vivants))
        for b in q.all():
            if origine == "VALIDE":
                ids_bulletin_vivants.add(b.id)
            d = {c.name: getattr(b, c.name) for c in Modele.__table__.columns}
            d["origine"] = b.statut if origine == "VALIDE" else origine
            d["lignes"] = [_ligne_vers_dict(l) for l in b.lignes]
            out.append(d)
    # Tri robuste : un `calcule_le` nul (donnée ancienne) ferait échouer le tri,
    # et un mélange naïf/aware (colonnes TIMESTAMP vs TIMESTAMPTZ selon la table)
    # ferait planter la comparaison avec un TypeError (→ 500, vu côté navigateur
    # comme un faux problème CORS / "Failed to fetch").
    from datetime import datetime as _dt, timezone as _tz

    def _cle_tri(d: dict):
        v = d.get("calcule_le")
        if v is None:
            return _dt.min
        if v.tzinfo is not None:
            v = v.astimezone(_tz.utc).replace(tzinfo=None)
        return v

    out.sort(key=_cle_tri, reverse=True)
    return out


def _deplacer_bulletin(db: Session, bulletin_id: UUID, source: str, cible: str,
                       nouveau_statut: str, extra_cols: dict | None = None) -> None:
    """Déplace un bulletin (et ses lignes) d'une table à l'autre.

    `source` / `cible` : 'bulletin_temp' | 'bulletin' | 'bulletin_historique'
    Le statut est réécrit à l'arrivée (chaque table a son propre CHECK).

    IMPORTANT — deux contraintes s'opposent et empêchent tout enchaînement
    « simple » de plusieurs instructions :
      • le trigger `f_bulletin_exclusion_temp_valide` refuse qu'une ligne
        existe simultanément dans `bulletin_temp` et `bulletin` → il faut
        que le DELETE de la source soit déjà effectif avant l'INSERT dans
        la cible ;
      • `{cible}_ligne.bulletin_id` a une FK vers `{cible}` → il faut que
        l'en-tête existe déjà dans la cible avant d'y insérer ses lignes ;
      • mais `{source}_ligne` a un ON DELETE CASCADE sur `{source}` → si
        l'en-tête source est supprimé avant que les lignes soient copiées,
        elles disparaissent avec lui.
    On ne peut donc pas y arriver avec des requêtes séparées, quel que soit
    l'ordre. Solution : une seule instruction SQL avec des CTE chaînées —
    capturer les lignes ET déplacer l'en-tête dans la même opération
    atomique, puis n'insérer les lignes dans la cible qu'après confirmation
    (EXISTS) que l'en-tête y est arrivé.
    """
    extra = extra_cols or {}
    cols_extra = ("," + ",".join(extra)) if extra else ""
    vals_extra = ("," + ",".join(f":{k}" for k in extra)) if extra else ""

    params = {"bid": str(bulletin_id), "statut": nouveau_statut, **extra}

    res = db.execute(text(f"""
        WITH lignes_capturees AS (
            DELETE FROM public.{source}_ligne WHERE bulletin_id = :bid
            RETURNING {_COLS_LIGNE}
        ),
        entete_deplace AS (
            DELETE FROM public.{source} WHERE id = :bid
            RETURNING {_COLS_BULLETIN}
        ),
        entete_insere AS (
            INSERT INTO public.{cible} ({_COLS_BULLETIN}, statut {cols_extra})
            SELECT {_COLS_BULLETIN}, :statut {vals_extra} FROM entete_deplace
            RETURNING id
        )
        INSERT INTO public.{cible}_ligne ({_COLS_LIGNE})
        SELECT {_COLS_LIGNE} FROM lignes_capturees
        WHERE EXISTS (SELECT 1 FROM entete_insere)
        RETURNING bulletin_id
    """), params)
    lignes_deplacees = res.rowcount

    # Le nombre de lignes déplacées ne dit rien sur la présence de l'en-tête
    # (un bulletin peut légitimement n'avoir aucune ligne) : on vérifie
    # explicitement que l'en-tête est bien arrivé dans la cible.
    existe = db.execute(text(f"SELECT 1 FROM public.{cible} WHERE id = :bid"),
                        {"bid": str(bulletin_id)}).scalar()
    if not existe:
        raise HTTPException(404, f"Bulletin introuvable dans « {source} »")
    _ = lignes_deplacees  # (diagnostic seulement, pas utilisé pour la validation)


def _copier_bulletin(db: Session, bulletin_id: UUID, source: str, cible: str,
                     nouveau_statut: str, extra_cols: dict | None = None) -> None:
    """
    RG-BULLETIN-COPIE-PERIODE-01 (Adil DAIA) : à la clôture d'une SEULE
    période, le bulletin n'est jamais supprimé de `bulletin` — il est
    COPIÉ dans `cible` (bulletin_historique) et son statut mis à jour sur
    place dans `source`. Le retrait physique de `bulletin` n'a lieu qu'à la
    clôture ANNUELLE (voir `_archiver_definitivement_bulletins`).

    Contrairement à `_deplacer_bulletin`, aucun DELETE sur `source` — on
    n'a donc pas besoin de l'enchaînement CTE (rien à protéger d'une perte
    de lignes CASCADE) : trois instructions simples suffisent. Nettoyage
    défensif d'une copie précédente en tête (cas d'une re-clôture après une
    réouverture de période — voir `_retirer_copie_bulletin`).
    """
    extra = extra_cols or {}
    cols_extra = ("," + ",".join(extra)) if extra else ""
    vals_extra = ("," + ",".join(f":{k}" for k in extra)) if extra else ""
    params = {"bid": str(bulletin_id), "statut": nouveau_statut, **extra}

    db.execute(text(f"DELETE FROM public.{cible}_ligne WHERE bulletin_id = :bid"), {"bid": str(bulletin_id)})
    db.execute(text(f"DELETE FROM public.{cible} WHERE id = :bid"), {"bid": str(bulletin_id)})

    db.execute(text(f"""
        INSERT INTO public.{cible} ({_COLS_BULLETIN}, statut {cols_extra})
        SELECT {_COLS_BULLETIN}, :statut {vals_extra} FROM public.{source} WHERE id = :bid
    """), params)
    db.execute(text(f"""
        INSERT INTO public.{cible}_ligne ({_COLS_LIGNE})
        SELECT {_COLS_LIGNE} FROM public.{source}_ligne WHERE bulletin_id = :bid
    """), {"bid": str(bulletin_id)})
    db.execute(text(f"UPDATE public.{source} SET statut = :statut WHERE id = :bid"),
              {"bid": str(bulletin_id), "statut": nouveau_statut})

    existe = db.execute(text(f"SELECT 1 FROM public.{cible} WHERE id = :bid"),
                        {"bid": str(bulletin_id)}).scalar()
    if not existe:
        raise HTTPException(404, f"Bulletin introuvable dans « {source} » lors de la copie")


def _retirer_copie_bulletin(db: Session, bulletin_id: UUID, table: str) -> None:
    """
    Réouverture d'une période clôturée au niveau période (copie seule, voir
    `_copier_bulletin`) : le bulletin d'origine n'a jamais quitté `bulletin`,
    il suffit de retirer la copie devenue caduque dans `table`
    (bulletin_historique) — le bulletin repasse VALIDE sur place, à part.
    """
    db.execute(text(f"DELETE FROM public.{table}_ligne WHERE bulletin_id = :bid"), {"bid": str(bulletin_id)})
    db.execute(text(f"DELETE FROM public.{table} WHERE id = :bid"), {"bid": str(bulletin_id)})


def _archiver_definitivement_bulletins(db: Session, periode_id: UUID) -> int:
    """
    RG-BULLETIN-ARCHIVE-ANNUELLE-01 (Adil DAIA) : retrait PHYSIQUE définitif
    de `bulletin` — appelé UNIQUEMENT par la clôture annuelle
    (`cloturer_annee`). Ne concerne que les bulletins déjà au statut CLOTURE
    (leur copie existe déjà dans bulletin_historique, créée par
    `_copier_bulletin` lors de la clôture de période, ou vient d'y être
    créée par `_cloturer_periode_interne` dans le même appel). Simple DELETE
    — aucune donnée n'est perdue, la copie dans bulletin_historique est déjà
    en place et complète.
    """
    n = 0
    for b in list(db.query(Bulletin).filter(Bulletin.periode_id == periode_id, Bulletin.statut == "CLOTURE").all()):
        bid = b.id
        db.execute(text("DELETE FROM public.bulletin_ligne WHERE bulletin_id = :bid"), {"bid": str(bid)})
        db.execute(text("DELETE FROM public.bulletin WHERE id = :bid"), {"bid": str(bid)})
        n += 1
    return n


def _persister(db: Session, res: dict, periode_id: UUID, collaborateur_id: UUID,
               type_lot: str) -> tuple[UUID, UUID]:
    """Crée lot + bulletin PRÉ-CALCULÉ + lignes + cumuls.

    Le calcul écrit toujours dans `bulletin_temp` (statut CALCULE | ERREUR).
    Un recalcul remplace le précalcul existant. Si le bulletin est déjà VALIDÉ,
    le recalcul est refusé : il faut d'abord le dévalider.
    """
    # Déjà validé ? le trigger d'exclusion le refuserait — on rend le message clair.
    deja_valide = db.execute(text("""
        SELECT id FROM public.bulletin
         WHERE collaborateur_id = :cid AND periode_id = :pid
    """), {"cid": str(collaborateur_id), "pid": str(periode_id)}).scalar()
    if deja_valide:
        raise HTTPException(409, "Ce bulletin est déjà validé. Dévalidez-le avant de le recalculer.")

    # Précalcul existant → on le remplace
    ancien = db.execute(text("""
        SELECT id FROM public.bulletin_temp
         WHERE collaborateur_id = :cid AND periode_id = :pid
    """), {"cid": str(collaborateur_id), "pid": str(periode_id)}).scalar()
    if ancien:
        db.execute(text("DELETE FROM public.bulletin_temp WHERE id = :id"), {"id": str(ancien)})

    lot = LotPaie(
        periode_id=periode_id, type_lot=type_lot, statut="CALCULE",
        plan_paie_id=res["periode"].get("plan_paie_id"),
        code_plan=res["periode"].get("code_plan"),
        libelle=f"{type_lot} {res['periode']['libelle']}",
        nb_bulletins=1, nb_erreurs=1 if res["a_erreur"] else 0,
        date_calcul=datetime.utcnow(),
    )
    db.add(lot)
    db.flush()

    t = res["totaux"]
    bul = BulletinTemp(
        lot_id=lot.id, periode_id=periode_id, collaborateur_id=collaborateur_id,
        plan_paie_id=res["periode"].get("plan_paie_id"),
        code_plan=res["periode"].get("code_plan"),
        matricule=res["collaborateur"].get("matricule"),
        total_brut=t["total_brut"], total_brut_imposable=t["total_brut_imposable"],
        total_gains=t["total_gains"], total_retenues=t["total_retenues"],
        total_cot_salariale=t["total_cot_salariale"], total_cot_patronale=t["total_cot_patronale"],
        net_imposable=t["net_imposable"], net_a_payer=t["net_a_payer"],
        cout_employeur=t["cout_employeur"],
        statut="ERREUR" if res["a_erreur"] else "CALCULE",
        a_erreur=res["a_erreur"], trace={"etapes": res["trace"]},
        messages=res["messages"],
    )
    db.add(bul)
    db.flush()

    # ── AJOUT (module Rapports) : snapshot figé du collaborateur au calcul ──
    # `res["periode"]` n'expose pas date_reference (seulement id/annee/mois/
    # libelle/plan_paie_id/code_plan) : on la relit depuis calendrier_paie.
    # `ancien` (calculé plus haut) indique si un précalcul existait déjà
    # pour ce (collaborateur_id, periode_id) → sert de valeur pour recalcul=.
    # Exclusion des simulations (type_lot == "SIMULATION") — même garde que
    # pour l'écriture des cumuls plus bas : une simulation n'est pas un
    # calcul réel, elle ne doit jamais figer de snapshot.
    if type_lot != "SIMULATION":
        date_ref = db.execute(
            text("SELECT date_reference FROM public.calendrier_paie WHERE id = :pid"),
            {"pid": str(periode_id)},
        ).scalar()
        rapport_engine.capturer_snapshot_collaborateur(
            session=db,
            collaborateur_id=collaborateur_id,
            bulletin_id=bul.id,
            date_reference=str(date_ref) if date_ref else str(res["periode"]["annee"]) + "-" + f'{res["periode"]["mois"]:02d}' + "-01",
            recalcul=bool(ancien),
        )
    # ──────────────────────────────────────────────────────────────────────

    annee = res["periode"]["annee"]
    mois = res["periode"]["mois"]
    code_plan = res["periode"].get("code_plan")
    for l in res["lignes"]:
        db.add(BulletinTempLigne(
            bulletin_id=bul.id, code_rubrique=l["code_rubrique"], libelle=l["libelle"],
            code_type=l["code_type"], type_regle=l["type_regle"],
            ordre_calcul=l["ordre_calcul"], ordre_affichage=l["ordre_affichage"],
            base=l["base"], nombre=l["nombre"], taux=l["taux"],
            montant=l["montant"], montant_patronal=l["montant_patronal"],
            taux_patronal=l.get("taux_patronal"),
            sens=l["sens"], est_cotisation=l["est_cotisation"],
            type_periodicite=l.get("type_periodicite"),
            date_valeur=(_date.fromisoformat(l["date_valeur"]) if l.get("date_valeur") else None),
            texte=l.get("texte"),
            observation=l.get("observation"),
        ))
        # Cumul mensuel (reconstituable → annuel par agrégation), segmenté par plan
        if type_lot != "SIMULATION":
            db.execute(text("""
                INSERT INTO public.cumul
                    (collaborateur_id, code_rubrique, type_cumul, annee, mois, code_plan,
                     periode_id, montant, nombre, base, montant_patronal)
                VALUES (:cid, :code, 'MENSUEL', :annee, :mois, :code_plan, :pid, :mt, :nb, :base, :pat)
                ON CONFLICT (collaborateur_id, code_rubrique, type_cumul, annee, mois, code_plan)
                DO UPDATE SET montant = EXCLUDED.montant, nombre = EXCLUDED.nombre,
                              base = EXCLUDED.base, montant_patronal = EXCLUDED.montant_patronal,
                              periode_id = EXCLUDED.periode_id,
                              updated_at = now()
            """), {
                "cid": str(collaborateur_id), "code": l["code_rubrique"],
                "annee": annee, "mois": mois, "code_plan": code_plan,
                "pid": str(periode_id),
                "mt": l["montant"], "nb": l["nombre"] or D0, "base": l["base"] or D0,
                "pat": l.get("montant_patronal") or D0,
            })

    db.commit()
    return bul.id, lot.id


@router.post("/calcul/collaborateur", response_model=CalculBulletinResult)
def calculer_collaborateur(
    req: CalculBulletinRequest,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
    societe_id: str = Depends(get_societe_active_id),
):
    """Calcule le bulletin d'un collaborateur pour une période (option : persister)."""
    _exiger_periode_ouverte(db, req.periode_id, societe_id)
    # RG-MULTISOCIETE-07 : le collaborateur doit lui aussi appartenir à la
    # société active -- une période valide n'implique pas que N'IMPORTE quel
    # collaborateur_id fourni en soit membre.
    if not db.execute(text("""
        SELECT 1 FROM public.collaborateur_contrats
         WHERE collaborateur_id = :cid AND societe_id = :sid AND archive = false
    """), {"cid": str(req.collaborateur_id), "sid": societe_id}).first():
        raise HTTPException(404, "Collaborateur introuvable pour cette période/société.")
    res = calculer_bulletin(db, req.collaborateur_id, req.periode_id)

    bulletin_id = lot_id = None
    if req.persister:
        bulletin_id, lot_id = _persister(
            db, res, req.periode_id, req.collaborateur_id, req.type_lot
        )

    return {"bulletin_id": bulletin_id, "lot_id": lot_id, **res}


def _construire_surcharges(req) -> tuple[dict, dict, dict]:
    """
    Factorise la conversion des 3 listes de surcharges (Pydantic) en
    dictionnaires attendus par simuler_bulletin()/ContexteCalcul — utilisée
    par les 3 endpoints de simulation (Bulletin/Impact/Embauche), pour ne
    pas tripler cette logique et risquer une divergence entre eux.

    surcharges_regime : reconstruit un dict PLAT par code_regle (voir
    ContexteCalcul.__init__ pour le détail des clés) à partir de
    SurchargeRegimeSim — même format quel que soit l'endpoint appelant.
    """
    surcharges_rubrique = {
        (s.code_rubrique.strip(), s.attribut): {"valeur": s.valeur, "mode": s.mode}
        for s in req.surcharges_rubrique
    }
    surcharges_table = {
        (s.table.strip(), s.colonne.strip()): s.valeur
        for s in req.surcharges_table
    }
    surcharges_regime = {
        s.code_regle.strip(): {
            "mode": s.mode,
            "taux_salarial": s.taux_salarial,
            "taux_patronal": s.taux_patronal,
            "forcer_affectation": s.forcer_affectation,
            "valeur_bareme_taux_simulee": s.valeur_bareme_taux_simulee,
        }
        for s in getattr(req, "surcharges_regime", [])
    }
    return surcharges_rubrique, surcharges_table, surcharges_regime


@router.post("/simulation/bulletin", response_model=CalculBulletinResult)
def simuler_bulletin_collaborateur(
    req: SimulationBulletinRequest,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    """
    Module Simulation — UC1 : simule le bulletin d'un collaborateur existant,
    avec surcharges ponctuelles (rubrique/attribut, champ de contrat, ou
    taux/affiliation de régime — RG-SIM-COTISATION-01).

    Différences volontaires avec /calcul/collaborateur ci-dessus :
      • RG-SIM-IND-01 — ne persiste JAMAIS : aucun appel à `_persister()`,
        `bulletin_id`/`lot_id` valent toujours None dans la réponse. Pas de
        champ `persister` dans la requête (SimulationBulletinRequest ne le
        propose même pas) : impossible d'activer la persistance par erreur
        depuis cet endpoint.
      • RG-SIM-IND-02 — PAS d'appel à `_exiger_periode_ouverte()` : une
        période CLOTUREE (ou tout autre statut) est autorisée. Le blocage de
        statut, côté moteur, est levé via `simuler_bulletin()` (qui appelle
        `calculer_bulletin(..., ignorer_statut_periode=True)`).
      • RG-SIM-IND-04 — les surcharges ne sont JAMAIS écrites en base : elles
        sont converties ici en dictionnaires en mémoire, transmis à
        `simuler_bulletin()`, qui les injecte dans `ContexteCalcul` pour la
        durée du calcul uniquement.
    """
    surcharges_rubrique, surcharges_table, surcharges_regime = _construire_surcharges(req)
    res = simuler_bulletin(
        db, req.collaborateur_id, req.periode_id,
        surcharges_rubrique=surcharges_rubrique,
        surcharges_table=surcharges_table,
        surcharges_regime=surcharges_regime,
    )
    return {"bulletin_id": None, "lot_id": None, **res}


def _calculer_ecarts_bulletins(avant: dict, apres: dict) -> dict:
    """
    Compare deux résultats de simuler_bulletin() (même structure que
    calculer_bulletin()) ligne à ligne (par code_rubrique) et sur les
    totaux.

    CORRECTIF (signalé par Adil DAIA) : la version précédente ne comparait
    que `montant` (part salariale) par ligne — une composante de cotisation
    à 100% patronale (ex. taxe de formation professionnelle) dont le taux
    change n'apparaissait JAMAIS dans le détail, alors même que les totaux
    agrégés (total_cot_patronale, cout_employeur) l'intégraient déjà
    correctement. Le filtre "ligne sans changement, on l'omet" ne testait
    lui aussi que la part salariale — une ligne 100% patronale était donc
    filtrée à tort. Les deux parts sont maintenant comparées indépendamment.

    Les lignes où salarial ET patronal valent 0 avant ET après sont omises
    (bruit inutile dans le comparateur écran). `delta_pct`/`delta_pct_patronal`
    valent None si la valeur `avant` correspondante est 0 (division
    impossible, pas 0 — un delta depuis 0 n'a pas de %).
    """
    lignes_avant = {l["code_rubrique"]: (_dec(l["montant"]), _dec(l.get("montant_patronal"))) for l in avant["lignes"]}
    lignes_apres = {l["code_rubrique"]: (_dec(l["montant"]), _dec(l.get("montant_patronal"))) for l in apres["lignes"]}
    libelles = {l["code_rubrique"]: l["libelle"] for l in apres["lignes"]}
    libelles.update({l["code_rubrique"]: l["libelle"] for l in avant["lignes"]})

    lignes_ecarts = []
    for code in sorted(set(lignes_avant) | set(lignes_apres)):
        va, va_pat = lignes_avant.get(code, (D0, D0))
        vp, vp_pat = lignes_apres.get(code, (D0, D0))
        if va == D0 and vp == D0 and va_pat == D0 and vp_pat == D0:
            continue
        lignes_ecarts.append({
            "code_rubrique": code, "libelle": libelles.get(code, code),
            "avant": str(va), "apres": str(vp), "delta": str(vp - va),
            "delta_pct": str((vp - va) / va * 100) if va else None,
            "avant_patronal": str(va_pat), "apres_patronal": str(vp_pat), "delta_patronal": str(vp_pat - va_pat),
            "delta_pct_patronal": str((vp_pat - va_pat) / va_pat * 100) if va_pat else None,
        })

    totaux_ecarts = {}
    for cle in ("total_brut", "total_gains", "total_retenues", "total_cot_salariale",
                "total_cot_patronale", "net_imposable", "net_a_payer", "cout_employeur"):
        va, vp = _dec(avant["totaux"].get(cle)), _dec(apres["totaux"].get(cle))
        totaux_ecarts[cle] = {"avant": str(va), "apres": str(vp), "delta": str(vp - va)}

    return {"lignes": lignes_ecarts, "totaux": totaux_ecarts}


@router.post("/simulation/impact", response_model=SimulationImpactResult)
def simuler_impact_collaborateur(
    req: SimulationImpactRequest,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    """
    Module Simulation — UC2 : compare la situation ACTUELLE d'un
    collaborateur (aucune surcharge — photo fidèle de l'état réel) à une
    situation APRÈS changement (les surcharges fournies), sur la même
    période. Même garde-fous que /simulation/bulletin (RG-SIM-IND-01/02) :
    aucune persistance, aucun blocage de statut de période.

    Le motif de l'évolution (référentiel encore à trancher — voir
    CONCEPTION_ECRANS_SIMULATION.md §2.2/§6.5) n'est PAS demandé ici : il n'a
    de sens qu'au moment de sauvegarder le scénario (POST /simulation/scenarios),
    pas pour un simple calcul de comparaison.
    """
    avant = simuler_bulletin(db, req.collaborateur_id, req.periode_id)

    surcharges_rubrique, surcharges_table, surcharges_regime = _construire_surcharges(req)
    apres = simuler_bulletin(
        db, req.collaborateur_id, req.periode_id,
        surcharges_rubrique=surcharges_rubrique,
        surcharges_table=surcharges_table,
        surcharges_regime=surcharges_regime,
    )
    return {"avant": avant, "apres": apres, "ecarts": _calculer_ecarts_bulletins(avant, apres)}


@router.post("/simulation/embauche", response_model=CalculBulletinResult)
def simuler_embauche_collaborateur(
    req: SimulationEmbaucheRequest,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    """
    Module Simulation — UC3 : simule le bulletin prévisionnel d'une embauche,
    construit sur un COLLABORATEUR DE RÉFÉRENCE réel plutôt qu'un profil
    entièrement virtuel.

    Pourquoi pas un profil virtuel (sans aucune ligne réelle en base) :
    la branche COT de `_calculer_bulletin_coeur` appelle
    `cotisation_engine.calculer_cotisation()` en lui passant `collaborateur_id`
    directement (voir paie_engine.py). Ce module n'a pas été fourni pour
    cette session — impossible de garantir qu'il ne fait aucune lecture
    propre en base à partir de cet ID (régime, affiliation, historique...).
    Un ID inventé de toutes pièces ferait courir le risque de cotisations
    calculées silencieusement à 0 : un coût employeur faux affiché en
    négociation d'embauche serait pire qu'une fonctionnalité absente — même
    logique de prudence que pour le point AF/TFP/AMO déjà réglé.

    En s'appuyant sur un collaborateur réel EXISTANT comme gabarit (même
    régime de cotisation que le futur poste) et en ne surchargeant que ce qui
    diffère (salaire proposé, poste, temps de travail, type de contrat, via
    surcharges_table/surcharges_rubrique — mêmes mécanismes qu'UC1/UC2), le
    Pourquoi pas un profil virtuel (sans aucune ligne réelle en base) : la
    branche COT de `_calculer_bulletin_coeur` appelle
    `cotisation_engine.calculer_cotisation()` en lui passant `collaborateur_id`
    directement. Ce module, lu depuis (module Simulation, point 2), vérifie
    l'affiliation du collaborateur au régime en base — un ID inventé de
    toutes pièces ferait échouer cette vérification pour CHAQUE régime, sauf
    à activer `forcer_affectation` sur CHAQUE composante COT du bulletin, ce
    qui reviendrait à simuler un profil entièrement fictif sans aucune
    garantie de cohérence. Un collaborateur de référence réel reste
    l'approche la plus sûre pour un coût employeur fiable.

    RG-SIM-IND-06 : l'identité réelle du collaborateur de référence
    n'apparaît jamais dans la réponse — remplacée par un placeholder.
    """
    surcharges_rubrique, surcharges_table, surcharges_regime = _construire_surcharges(req)
    res = simuler_bulletin(
        db, req.collaborateur_reference_id, req.periode_id,
        surcharges_rubrique=surcharges_rubrique,
        surcharges_table=surcharges_table,
        surcharges_regime=surcharges_regime,
    )
    # RG-SIM-IND-06 : masquage de l'identité du collaborateur de référence —
    # seul son paramétrage (poste/plan/régime/cotisations) a servi de gabarit,
    # jamais son nom, prénom ou matricule réel.
    res["collaborateur"] = {
        "id": None, "matricule": "SIMULATION",
        "nom": "Candidat", "prenom": "(simulation d'embauche)",
    }
    return {"bulletin_id": None, "lot_id": None, **res}


# ===========================================================================
# Scénarios sauvegardés (table simulation_individuelle — voir migration
# 057_simulation_individuelle.sql). CRUD volontairement simple : pas de
# service dédié, cohérent avec le style déjà utilisé pour les populations
# (SQL direct via text(), archivage plutôt que suppression physique).
# ===========================================================================
_COLS_SCENARIO = """
    id, type_simulation, nom, created_by, collaborateur_id, population_id, periode_id,
    periode_reference, hypotheses, resultat_calcule, partage, archive, date_application,
    created_at, updated_at
"""


@router.get("/simulation/collaborateurs/recherche", response_model=list[CollaborateurOption])
def rechercher_collaborateurs_simulation(
    q: str = Query(..., min_length=2, max_length=100),
    limite: int = Query(20, ge=1, le=50),
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    """
    Recherche par matricule OU nom/prénom (ILIKE), pour l'autocomplete des
    écrans Simulation (UC1/UC2 : collaborateur réel ; UC3 : collaborateur de
    référence). `q` doit faire au moins 2 caractères pour éviter de charger
    toute la base sur une requête vide.
    """
    motif = f"%{q.strip()}%"
    return db.execute(text("""
        SELECT id, matricule, nom, prenom
          FROM public.collaborateurs
         WHERE matricule ILIKE :motif OR nom ILIKE :motif OR prenom ILIKE :motif
            OR (nom || ' ' || prenom) ILIKE :motif
         ORDER BY nom, prenom
         LIMIT :limite
    """), {"motif": motif, "limite": limite}).mappings().all()


@router.get("/simulation/plans-paie", response_model=list[PlanPaieOption])
def lister_plans_paie_simulation(
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    """
    Sélection MANUELLE du plan de paie pour l'instant — la table reliant un
    collaborateur à un plan par défaut n'a pas été identifiée (le moteur lit
    toujours le plan depuis la période choisie, jamais depuis le
    collaborateur). Point à lever avec Adil DAIA pour automatiser cette
    étape de la cascade.
    """
    return db.execute(text("""
        SELECT id, code, libelle FROM public.plan_paie ORDER BY libelle
    """)).mappings().all()


@router.get("/simulation/periodes", response_model=list[PeriodeOption])
def lister_periodes_simulation(
    plan_paie_id: UUID = Query(...),
    annee: int | None = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    """
    RG-SIM-PERIODE-01 : ne renvoie que les périodes au statut OUVERTE, pour
    un sélecteur ergonomique par défaut — n'empêche pas le moteur de
    simuler sur une période CLOTUREE si un scénario existant y fait
    référence (RG-SIM-IND-02, non concerné par cet endpoint de listing).
    """
    where = "plan_paie_id = :pid AND statut = 'OUVERTE'"
    params: dict = {"pid": str(plan_paie_id)}
    if annee is not None:
        where += " AND annee = :annee"
        params["annee"] = annee
    return db.execute(text(f"""
        SELECT id, annee, mois, numero_periode, statut
          FROM public.calendrier_paie
         WHERE {where}
         ORDER BY annee DESC, mois DESC
    """), params).mappings().all()


@router.get("/simulation/rubriques", response_model=list[RubriqueSimulable])
def lister_rubriques_simulables(
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    """
    Liste des rubriques proposées pour une surcharge « Rubrique »
    (EditeurSurcharges.tsx) — exclut code_type IN ('COT', 'ASS') :
      • COT — pilotées par cotisation_engine, pas par une surcharge directe ;
      • ASS — accumulateurs internes (assiettes), jamais une cible de saisie.
    Mêmes conditions de validité que le moteur réel (archive=false,
    traiter=true, date_debut/date_fin), pour ne proposer que des rubriques
    réellement actives aujourd'hui.
    """
    return db.execute(text("""
        SELECT code, libelle, code_type, code_famille
          FROM public.rubrique_paie
         WHERE archive = false AND traiter = true
           AND code_type NOT IN ('COT', 'ASS')
           AND (date_debut IS NULL OR date_debut <= CURRENT_DATE)
           AND (date_fin   IS NULL OR date_fin   >= CURRENT_DATE)
         ORDER BY code_famille NULLS LAST, libelle
    """)).mappings().all()


@router.get("/simulation/regimes", response_model=list[RegimeSimulable])
def lister_regimes_simulables(
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    """
    Liste des règles de cotisation proposées pour une surcharge de taux de
    régime (EditeurSurcharges.tsx / futur sélecteur dédié). `code` est le
    code de la RÈGLE (regle_calcul_cotisation.code), la clé technique
    réellement utilisée par cotisation_engine.calculer_cotisation() — pas le
    code régime, qu'une même règle peut partager avec d'autres (part
    salariale/patronale séparées).
    """
    return db.execute(text("""
        SELECT code, libelle, code_regime
          FROM public.regle_calcul_cotisation
         WHERE actif = true AND archive = false
         ORDER BY libelle
    """)).mappings().all()


@router.get("/simulation/populations", response_model=list[PopulationSimulable])
def lister_populations_simulables(
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    """Populations actives proposées pour le sélecteur de lancement en masse."""
    return db.execute(text("""
        SELECT id, libelle, mode FROM public.population_paie
         WHERE actif = true AND archive = false
         ORDER BY libelle
    """)).mappings().all()


_IDENTIFIANT_SQL = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


@router.get("/simulation/referentiel-valeurs", response_model=ReferentielChampResult)
def valeurs_referentiel_champ(
    table: str = Query(..., max_length=63),
    colonne: str = Query(..., max_length=63),
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
    societe_id: str = Depends(get_societe_active_id),
):
    """
    Pour un champ de contrat simulable (table, colonne) — EditeurSurcharges.tsx
    §2.4 — détermine PAR INTROSPECTION (contrainte FOREIGN KEY réelle,
    information_schema) si ce champ pointe vers un référentiel, et si oui
    renvoie ses valeurs. Aucune liste de référentiels connus à l'avance :
    un nouveau champ simulable pointant vers une nouvelle table référentielle
    fonctionne sans modifier cet endpoint, tant qu'une vraie FK existe en base.

    `a_un_referentiel=False` (ex. salaire_base, date_debut) → le front doit
    afficher une saisie libre adaptée au type, pas une liste déroulante.

    SECOURS EXPLICITE (RG-POPULATION-REFERENTIEL-01, Adil DAIA) : certaines
    colonnes référencent RÉELLEMENT un référentiel applicatif (confirmé par
    lecture de FicheCollaborateur.tsx, qui les interroge directement) SANS
    qu'une vraie contrainte FOREIGN KEY existe en base — l'introspection
    ci-dessus échoue alors à tort. Cette table de correspondance comble
    précisément ces cas connus, avant de retomber sur l'introspection.
    """
    if not (_IDENTIFIANT_SQL.match(table) and _IDENTIFIANT_SQL.match(colonne)):
        raise HTTPException(400, "Nom de table/colonne invalide")

    SECOURS_REFERENTIEL: dict[tuple[str, str], str] = {
        ("collaborateur_contrats", "code_type_contrat"): "ref_type_contrat",
        ("collaborateur_contrats", "code_temps"): "ref_temps_travail",
        ("collaborateurs", "code_nationalite"): "ref_nationalite",
        ("collaborateur_regime", "code_regime"): "ref_regime_cotisation",
        # Classification (RG-POPULATION-REFERENTIEL-01, confirmé par lecture
        # de ClassificationForm.tsx — tables réelles, sans vraie FK en base).
        ("collaborateur_qualifications", "code_fonction"): "ref_fonction",
        ("collaborateur_qualifications", "code_categorie_professionnelle"): "ref_categorie_professionnelle",
        ("collaborateur_qualifications", "code_college"): "ref_college",
        ("collaborateur_qualifications", "code_responsabilite"): "ref_responsabilite",
        ("collaborateur_qualifications", "code_niveau"): "ref_niveau_qualification",
        ("collaborateur_qualifications", "code_grade"): "ref_grade",
        ("collaborateur_qualifications", "code_echelle"): "ref_echelle",
        ("collaborateur_qualifications", "code_classe"): "ref_classe",
        ("collaborateur_qualifications", "echelon_actuel"): "ref_echelon",
        ("collaborateur_qualifications", "code_filiere"): "ref_filiere",
        ("collaborateur_qualifications", "code_activite"): "ref_activite",
        # Emploi (RG-POPULATION-EMPLOI-01, Adil DAIA) : remplace l'ancien
        # critère "Postes" (correspondance exacte sur l'instance de poste,
        # ex. "DEV-001") par un critère sur l'EMPLOI d'affiliation — voir
        # _construire_conditions_criteres() dans population_paie.py pour la
        # résolution réelle (jointure via ref_poste, pas une simple FK).
        # Clé virtuelle (aucune vraie colonne "code_emploi" sur
        # collaborateur_affectations) — sert uniquement à faire pointer le
        # menu déroulant vers ref_emploi.
        ("collaborateur_affectations", "code_emploi"): "ref_emploi",
    }
    ref_table_secours = SECOURS_REFERENTIEL.get((table, colonne))

    try:
        if ref_table_secours:
            ref_table, ref_column = ref_table_secours, "code"
        else:
            fk = db.execute(text("""
                SELECT ccu.table_name AS ref_table, ccu.column_name AS ref_column
                  FROM information_schema.table_constraints tc
                  JOIN information_schema.key_column_usage kcu
                    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
                  JOIN information_schema.constraint_column_usage ccu
                    ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
                 WHERE tc.constraint_type = 'FOREIGN KEY'
                   AND tc.table_schema = 'public'
                   AND tc.table_name = :table
                   AND kcu.column_name = :colonne
                 LIMIT 1
            """), {"table": table, "colonne": colonne}).mappings().first()

            if not fk:
                return {"a_un_referentiel": False, "valeurs": []}
            ref_table, ref_column = fk["ref_table"], fk["ref_column"]

        # ref_table/ref_column viennent soit du catalogue Postgres, soit de la
        # table de secours ci-dessus (jamais de l'utilisateur) : interpolation
        # sûre malgré l'absence de paramètre lié possible sur un identifiant SQL.
        a_libelle = db.execute(text("""
            SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = :t AND column_name = 'libelle'
        """), {"t": ref_table}).first() is not None
        colonne_libelle = "libelle" if a_libelle else ref_column

        a_parent = db.execute(text("""
            SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = :t AND column_name = 'parent_id'
        """), {"t": ref_table}).first() is not None
        colonne_parent = ", parent_id" if a_parent else ""

        # RG-MULTISOCIETE-07 (migration 065 et suivantes) : cet endpoint sert
        # potentiellement N'IMPORTE quelle table référentielle par introspection
        # -- certaines (unites_organisationnelles depuis la 065, d'autres
        # demain) ont désormais societe_id. Même logique que get_societe_id_info()
        # dans le proxy générique (generic.py), dupliquée ici faute d'un module
        # utilitaire commun à ce stade -- si societe_id apparaît un jour sur
        # une nouvelle table référentielle, ce filtre s'applique automatiquement
        # sans modification de cet endpoint (même esprit que l'introspection FK
        # ci-dessus : rien à coder au cas par cas).
        col_societe = db.execute(text("""
            SELECT is_nullable FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = :t AND column_name = 'societe_id'
        """), {"t": ref_table}).first()
        if col_societe is None:
            clause_societe = ""
        elif col_societe[0] == "YES":
            clause_societe = f" WHERE (societe_id IS NULL OR societe_id = '{societe_id}')"
        else:
            clause_societe = f" WHERE societe_id = '{societe_id}'"
        # societe_id vient de get_societe_active_id() (claim JWT, jamais d'un
        # paramètre utilisateur) -- interpolation sûre, même raisonnement que
        # ref_table/ref_column juste au-dessus.

        lignes = db.execute(text(f"""
            SELECT {ref_column} AS code, {colonne_libelle} AS libelle{colonne_parent}
              FROM public.{ref_table}
             {clause_societe}
             ORDER BY {colonne_libelle}
             LIMIT 1000
        """)).mappings().all()
        return {
            "a_un_referentiel": True,
            "table": ref_table,
            "valeurs": [
                {"code": str(l["code"]), "libelle": str(l["libelle"]), "parent_id": str(l["parent_id"]) if a_parent and l.get("parent_id") else None}
                for l in lignes
            ],
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        # Erreur réelle remontée (au lieu d'un crash opaque masqué en faux
        # CORS côté navigateur) — même correctif appliqué aux endpoints
        # précédents ayant présenté le même symptôme.
        raise HTTPException(400, f"Erreur de résolution du référentiel ({table}.{colonne}) : {type(e).__name__}: {e}")


# ===========================================================================
# Export Excel (KPI + détail) — POST /simulation/export-excel
# ===========================================================================
_POLICE = "Arial"
_FOND_ENTETE = PatternFill("solid", fgColor="1F2937")
_POLICE_ENTETE = Font(name=_POLICE, bold=True, color="FFFFFF")
_FOND_KPI = PatternFill("solid", fgColor="EEF2FF")
_FMT_MONTANT = '#,##0.00 "MAD"'
_FMT_ECART = '#,##0.00;[RED]-#,##0.00'


def _f(valeur) -> float:
    """Conversion tolérante — une valeur absente/vide devient 0 plutôt que de faire planter l'export."""
    try:
        return float(valeur) if valeur not in (None, "") else 0.0
    except (TypeError, ValueError):
        return 0.0


def _entetes(ws, ligne: int, libelles: list[str]):
    for i, h in enumerate(libelles, start=1):
        c = ws.cell(row=ligne, column=i, value=h)
        c.font = _POLICE_ENTETE
        c.fill = _FOND_ENTETE
        c.alignment = Alignment(horizontal="center")


def _feuille_bulletin(ws, resultat: dict, titre: str):
    ws.column_dimensions["A"].width = 16
    ws.column_dimensions["B"].width = 42
    for col in "CDEF":
        ws.column_dimensions[col].width = 16

    ws["A1"] = titre
    ws["A1"].font = Font(name=_POLICE, bold=True, size=14)
    collab = resultat.get("collaborateur") or {}
    periode = resultat.get("periode") or {}
    ws["A2"] = f"{collab.get('nom', '')} {collab.get('prenom', '')} ({collab.get('matricule', '')}) — {periode.get('libelle', '')}"
    ws["A2"].font = Font(name=_POLICE, italic=True, color="6B7280")

    totaux = resultat.get("totaux") or {}
    kpis = [
        ("Total brut", "total_brut"), ("Cotisations salariales", "total_cot_salariale"),
        ("Cotisations patronales", "total_cot_patronale"), ("Net imposable", "net_imposable"),
        ("Net à payer", "net_a_payer"), ("Coût employeur", "cout_employeur"),
    ]
    ligne = 4
    ws.cell(row=ligne, column=1, value="Indicateurs clés").font = Font(name=_POLICE, bold=True)
    ligne += 1
    for label, cle in kpis:
        c1 = ws.cell(row=ligne, column=1, value=label)
        c1.font = Font(name=_POLICE)
        c1.fill = _FOND_KPI
        c2 = ws.cell(row=ligne, column=2, value=_f(totaux.get(cle)))
        c2.number_format = _FMT_MONTANT
        c2.font = Font(name=_POLICE, bold=True)
        c2.fill = _FOND_KPI
        ligne += 1

    ligne += 1
    _entetes(ws, ligne, ["Code", "Libellé", "Base", "Nombre", "Taux", "Montant", "Montant patronal"])
    ligne_entete = ligne
    ligne += 1
    for l in resultat.get("lignes") or []:
        ws.cell(row=ligne, column=1, value=l.get("code_rubrique")).font = Font(name=_POLICE)
        ws.cell(row=ligne, column=2, value=l.get("libelle")).font = Font(name=_POLICE)
        for col, cle in ((3, "base"), (4, "nombre"), (5, "taux"), (6, "montant"), (7, "montant_patronal")):
            v = l.get(cle)
            cell = ws.cell(row=ligne, column=col, value=_f(v) if v not in (None, "") else None)
            cell.number_format = "#,##0.00"
            cell.font = Font(name=_POLICE)
        ligne += 1
    ws.column_dimensions["G"].width = 16
    ws.freeze_panes = ws.cell(row=ligne_entete + 1, column=1).coordinate


def _feuille_ecarts(ws, ecarts: dict, titre: str):
    ws.column_dimensions["A"].width = 26
    ws.column_dimensions["B"].width = 30
    for col in "CDEF":
        ws.column_dimensions[col].width = 16

    ws["A1"] = f"{titre} — Écarts"
    ws["A1"].font = Font(name=_POLICE, bold=True, size=14)

    ligne = 3
    ws.cell(row=ligne, column=1, value="Totaux").font = Font(name=_POLICE, bold=True)
    ligne += 1
    _entetes(ws, ligne, ["Indicateur", "Avant", "Après", "Écart"])
    ligne += 1
    for cle, v in (ecarts.get("totaux") or {}).items():
        ws.cell(row=ligne, column=1, value=cle).font = Font(name=_POLICE)
        ws.cell(row=ligne, column=2, value=_f(v.get("avant"))).number_format = "#,##0.00"
        ws.cell(row=ligne, column=3, value=_f(v.get("apres"))).number_format = "#,##0.00"
        c4 = ws.cell(row=ligne, column=4, value=_f(v.get("delta")))
        c4.number_format = _FMT_ECART
        c4.font = Font(name=_POLICE, bold=True)
        ligne += 1

    ligne += 2
    ws.cell(row=ligne, column=1, value="Détail par rubrique").font = Font(name=_POLICE, bold=True)
    ligne += 1
    _entetes(ws, ligne, ["Code", "Libellé", "Avant", "Après", "Écart", "%", "Avant (patr.)", "Après (patr.)", "Écart (patr.)"])
    ligne_entete = ligne
    ligne += 1
    for l in ecarts.get("lignes") or []:
        ws.cell(row=ligne, column=1, value=l.get("code_rubrique")).font = Font(name=_POLICE)
        ws.cell(row=ligne, column=2, value=l.get("libelle")).font = Font(name=_POLICE)
        ws.cell(row=ligne, column=3, value=_f(l.get("avant"))).number_format = "#,##0.00"
        ws.cell(row=ligne, column=4, value=_f(l.get("apres"))).number_format = "#,##0.00"
        c5 = ws.cell(row=ligne, column=5, value=_f(l.get("delta")))
        c5.number_format = _FMT_ECART
        pct = l.get("delta_pct")
        c6 = ws.cell(row=ligne, column=6, value=(_f(pct) / 100 if pct not in (None, "") else None))
        c6.number_format = "0.0%"
        ws.cell(row=ligne, column=7, value=_f(l.get("avant_patronal"))).number_format = "#,##0.00"
        ws.cell(row=ligne, column=8, value=_f(l.get("apres_patronal"))).number_format = "#,##0.00"
        c9 = ws.cell(row=ligne, column=9, value=_f(l.get("delta_patronal")))
        c9.number_format = _FMT_ECART
        ligne += 1
    for col in "GHI":
        ws.column_dimensions[col].width = 16
    ws.freeze_panes = ws.cell(row=ligne_entete + 1, column=1).coordinate


def _feuille_population(ws, resultat: dict, titre: str):
    """resultat = SimulationPopulationResult (job TERMINE) tel que renvoyé par
    GET /simulation/population/jobs/{id} — double vue fusion + par scénario."""
    scenarios = resultat.get("scenarios") or []
    nb_scenarios = len(scenarios)

    ws.column_dimensions["A"].width = 16
    ws.column_dimensions["B"].width = 26
    ws.column_dimensions["C"].width = 18
    for col_idx in range(4, 9 + nb_scenarios * 2):
        ws.column_dimensions[get_column_letter(col_idx)].width = 16

    ws["A1"] = titre
    ws["A1"].font = Font(name=_POLICE, bold=True, size=14)
    scenarios_noms = ", ".join(s.get("nom", "") for s in scenarios)
    periode_debut = resultat.get("periode_debut_libelle", "")
    periode_fin = resultat.get("periode_fin_libelle", "")
    plage = periode_debut if periode_debut == periode_fin else f"{periode_debut} → {periode_fin}"
    ws["A2"] = f"{resultat.get('population_nom', '')} — {plage} — scénario(s) : {scenarios_noms}"
    ws["A2"].font = Font(name=_POLICE, italic=True, color="6B7280")

    resume = resultat.get("resume_fusion") or {}
    kpis = [
        ("Collaborateurs", str(resultat.get("nb_collaborateurs", 0))),
        ("Erreurs", str(resultat.get("nb_erreurs", 0))),
        ("Net à payer — avant", _f(resume.get("net_avant"))),
        ("Net à payer — après (fusion)", _f(resume.get("net_apres"))),
        ("Écart net à payer (fusion)", _f(resume.get("ecart_net"))),
        ("Coût employeur — écart (fusion)", _f(resume.get("ecart_cout_employeur"))),
    ]
    ligne = 4
    ws.cell(row=ligne, column=1, value="Résumé — fusion de tous les scénarios").font = Font(name=_POLICE, bold=True)
    ligne += 1
    for label, valeur in kpis:
        c1 = ws.cell(row=ligne, column=1, value=label)
        c1.font = Font(name=_POLICE)
        c1.fill = _FOND_KPI
        c2 = ws.cell(row=ligne, column=2, value=valeur)
        if isinstance(valeur, float):
            c2.number_format = _FMT_MONTANT
        c2.font = Font(name=_POLICE, bold=True)
        c2.fill = _FOND_KPI
        ligne += 1

    ligne += 1
    ws.cell(row=ligne, column=1, value="Résumé — par scénario (isolé)").font = Font(name=_POLICE, bold=True)
    ligne += 1
    _entetes(ws, ligne, ["Scénario", "Net après", "Écart net", "Coût après", "Écart coût"])
    ligne += 1
    for rs in resultat.get("resume_par_scenario") or []:
        ws.cell(row=ligne, column=1, value=rs.get("scenario_nom")).font = Font(name=_POLICE)
        ws.cell(row=ligne, column=2, value=_f(rs.get("net_apres"))).number_format = "#,##0.00"
        c3 = ws.cell(row=ligne, column=3, value=_f(rs.get("ecart_net")))
        c3.number_format = _FMT_ECART
        ws.cell(row=ligne, column=4, value=_f(rs.get("cout_employeur_apres"))).number_format = "#,##0.00"
        c5 = ws.cell(row=ligne, column=5, value=_f(rs.get("ecart_cout_employeur")))
        c5.number_format = _FMT_ECART
        ligne += 1

    ligne += 1
    entetes_detail = ["Matricule", "Nom", "Prénom", "Net avant", "Net après (fusion)", "Écart net (fusion)"]
    for s in scenarios:
        entetes_detail += [f"Net après — {s.get('nom')}", f"Écart net — {s.get('nom')}"]
    _entetes(ws, ligne, entetes_detail)
    ligne_entete = ligne
    ligne += 1
    for l in resultat.get("lignes") or []:
        ws.cell(row=ligne, column=1, value=l.get("matricule")).font = Font(name=_POLICE)
        ws.cell(row=ligne, column=2, value=l.get("nom")).font = Font(name=_POLICE)
        ws.cell(row=ligne, column=3, value=l.get("prenom")).font = Font(name=_POLICE)
        if l.get("a_erreur"):
            c4 = ws.cell(row=ligne, column=4, value=f"Erreur : {l.get('message_erreur', '')}")
            c4.font = Font(name=_POLICE, color="D85A30", italic=True)
        else:
            ws.cell(row=ligne, column=4, value=_f(l.get("net_avant"))).number_format = "#,##0.00"
            ws.cell(row=ligne, column=5, value=_f(l.get("net_apres_fusion"))).number_format = "#,##0.00"
            c6 = ws.cell(row=ligne, column=6, value=_f(l.get("ecart_net_fusion")))
            c6.number_format = _FMT_ECART
            par_scenario_par_id = {ps.get("scenario_id"): ps for ps in (l.get("par_scenario") or [])}
            col = 7
            for s in scenarios:
                ps = par_scenario_par_id.get(s.get("id"))
                ws.cell(row=ligne, column=col, value=_f(ps.get("net_apres")) if ps else None).number_format = "#,##0.00"
                c_ecart = ws.cell(row=ligne, column=col + 1, value=_f(ps.get("ecart_net")) if ps else None)
                c_ecart.number_format = _FMT_ECART
                col += 2
        ligne += 1
    ws.freeze_panes = ws.cell(row=ligne_entete + 1, column=1).coordinate


@router.post("/simulation/export-excel")
def exporter_excel_simulation(
    req: ExportExcelRequest,
    _=Depends(require_roles(*PAIE_ROLES)),
):
    """
    Génère un .xlsx à partir d'un résultat de simulation déjà calculé (jamais
    recalculé ici — le payload est celui que le front a déjà reçu d'un des
    endpoints de calcul, ou repris de ScenarioSimulation.resultat_calcule).

      • BULLETIN / EMBAUCHE → 1 feuille (KPI + détail des lignes).
      • IMPACT → 3 feuilles (Avant, Après, Écarts).
      • POPULATION → 1 feuille (résumé agrégé + détail par collaborateur).

    Police Arial partout (cohérent avec les exigences de présentation), en-têtes
    sur fond sombre, montants au format monétaire, panneau KPI mis en évidence.
    """
    wb = Workbook()
    ws0 = wb.active

    if req.type_simulation == "IMPACT":
        wb.remove(ws0)
        avant = req.resultat.get("avant") or {}
        apres = req.resultat.get("apres") or {}
        ecarts = req.resultat.get("ecarts") or {}
        _feuille_bulletin(wb.create_sheet("Avant"), avant, f"{req.titre} — Avant")
        _feuille_bulletin(wb.create_sheet("Après"), apres, f"{req.titre} — Après")
        _feuille_ecarts(wb.create_sheet("Écarts"), ecarts, req.titre)
    elif req.type_simulation == "POPULATION":
        ws0.title = "Population"
        _feuille_population(ws0, req.resultat, req.titre)
    else:
        ws0.title = "Bulletin"
        _feuille_bulletin(ws0, req.resultat, req.titre)

    tampon = BytesIO()
    wb.save(tampon)
    tampon.seek(0)

    nom_fichier = re.sub(r"[^\w\-]+", "_", req.titre).strip("_")[:100] or "simulation"
    return Response(
        content=tampon.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{nom_fichier}.xlsx"'},
    )


@router.get("/simulation/scenarios", response_model=list[ScenarioSimulationRead])
def lister_scenarios_simulation(
    type_simulation: str | None = Query(None),
    inclure_partages: bool = Query(True),
    db: Session = Depends(get_db),
    payload=Depends(get_current_user_payload),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    """
    Liste les scénarios de l'utilisateur courant + (si `inclure_partages`)
    ceux partagés par d'autres. Jamais les scénarios archivés.
    """
    user_id = payload.get("sub") or payload.get("user_id")
    where = ["archive = false", "(created_by = :uid" + (" OR partage = true)" if inclure_partages else ")")]
    if type_simulation:
        where.append("type_simulation = :ts")
    sql = f"""
        SELECT {_COLS_SCENARIO} FROM public.simulation_individuelle
         WHERE {" AND ".join(where)}
         ORDER BY updated_at DESC
    """
    params = {"uid": str(user_id)}
    if type_simulation:
        params["ts"] = type_simulation
    return db.execute(text(sql), params).mappings().all()


# ===========================================================================
# Lancement en masse par population (RG-SIM-POPULATION-01, proposition —
# Adil DAIA) — écran séparé (SimulationPopulationPage.tsx), PAS un mode de
# plus dans l'écran Simulation individuelle. Résout une population (ou
# l'ensemble des populations actives) via app/services/population_paie.py.
#
# Produit destiné à des clients pouvant dépasser 300 collaborateurs :
# lancement ASYNCHRONE (job en tâche de fond via FastAPI BackgroundTasks,
# table simulation_population_job — migration 062). L'écran crée le job,
# reçoit immédiatement un job_id, puis interroge
# GET /simulation/population/jobs/{id} jusqu'à TERMINE/ERREUR.
#
# Double vue TOUJOURS calculée et affichée ensemble (jamais un choix
# exclusif) :
#   • Fusion       : toutes les surcharges des scénarios sélectionnés,
#                    combinées en UN SEUL calcul par collaborateur.
#   • Par scénario : CHAQUE scénario appliqué séparément (isolé des autres),
#                    pour comparer leur impact individuel côte à côte.
# Coût : (2 + nb_scénarios) appels à simuler_bulletin() par collaborateur —
# jamais persisté, exactement comme les 3 autres modes du module Simulation.
# ===========================================================================
def _fusionner_surcharges_scenarios(scenarios: list[dict]) -> tuple[dict, dict, dict]:
    """
    Fusionne les hypotheses (JSON brut, tel que stocké par
    POST /simulation/scenarios) de un ou plusieurs scénarios en un seul jeu
    de surcharges — même format de sortie que _construire_surcharges(), pour
    être directement transmis à simuler_bulletin(). Contrairement à
    _construire_surcharges() (qui lit des objets Pydantic), ceci lit des
    dicts JSON bruts issus de la colonne `hypotheses` (jsonb) de
    simulation_individuelle — les clés sont les mêmes (mêmes noms de champs
    que SurchargeRubriqueSim/SurchargeTableSim/SurchargeRegimeSim), donc
    `.get()` au lieu d'accès par attribut.

    Appelée avec UN SEUL scénario dans la liste pour la vue "par scénario"
    (isolé) et avec TOUS les scénarios sélectionnés pour la vue "fusion" —
    même fonction, pas de logique dupliquée entre les deux vues.

    Aucune déduplication : si deux scénarios surchargent tous les deux la
    même rubrique, les deux surcharges s'appliquent l'une après l'autre
    (même logique que si l'utilisateur avait ajouté deux lignes identiques
    dans l'éditeur de surcharges d'un scénario unique).
    """
    surcharges_rubrique: dict = {}
    surcharges_table: dict = {}
    surcharges_regime: dict = {}
    for s in scenarios:
        hyp = s.get("hypotheses") or {}
        for sr in hyp.get("surcharges_rubrique") or []:
            code = str(sr.get("code_rubrique", "")).strip()
            attribut = sr.get("attribut")
            if code and attribut:
                surcharges_rubrique[(code, attribut)] = {"valeur": sr.get("valeur"), "mode": sr.get("mode", "AJOUT")}
        for st in hyp.get("surcharges_table") or []:
            table = str(st.get("table", "")).strip()
            colonne = str(st.get("colonne", "")).strip()
            if table and colonne:
                surcharges_table[(table, colonne)] = st.get("valeur")
        for sg in hyp.get("surcharges_regime") or []:
            code_regle = str(sg.get("code_regle", "")).strip()
            if code_regle:
                surcharges_regime[code_regle] = {
                    "mode": sg.get("mode", "AJOUT"),
                    "taux_salarial": sg.get("taux_salarial"),
                    "taux_patronal": sg.get("taux_patronal"),
                    "forcer_affectation": bool(sg.get("forcer_affectation")),
                    "valeur_bareme_taux_simulee": sg.get("valeur_bareme_taux_simulee"),
                }
    return surcharges_rubrique, surcharges_table, surcharges_regime


# ===========================================================================
# Date d'application d'un scénario (RG-SIM-SCENARIO-06, Adil DAIA) — filtre
# OPTIONNEL, par PÉRIODE (pas par collaborateur) : un scénario sans
# date_application s'applique dès la première période simulée (comportement
# historique) ; avec une date_application, il ne s'applique qu'à partir de
# la première période (année/mois) qui contient cette date — comparaison
# UNIQUEMENT sur année/mois (les périodes de paie sont mensuelles, jamais
# sur le jour exact).
# ===========================================================================
def _scenario_applicable_a_periode(scenario: dict, annee_periode: int, mois_periode: int) -> bool:
    date_app = scenario.get("date_application")
    if date_app is None:
        return True
    return (annee_periode, mois_periode) >= (date_app.year, date_app.month)


# ===========================================================================
# Résolution du mode "Pourcentage" PAR COLLABORATEUR (RG-SIM-SCENARIO-02,
# proposition — Adil DAIA : "vrai comportement en pourcentage par personne").
#
# Contrairement à AJOUT/FORCAGE (valeurs fixes, identiques pour tout le
# monde), une surcharge "+X% sur le montant actuel de la rubrique" n'a de
# sens QUE rapportée au montant RÉEL de CE collaborateur précis — deux
# personnes touchant des montants différents pour la même rubrique
# obtiennent donc des deltas différents avec la MÊME surcharge en %.
#
# Ne peut donc PAS être résolue une fois pour toutes à l'enregistrement du
# scénario (contrairement à ce qui avait été fait dans une version
# précédente, en approximant contre un seul collaborateur de référence) —
# résolue ICI, à chaque lancement, séparément pour chaque collaborateur, à
# partir de SON PROPRE calcul "tel quel" déjà effectué (aucun appel
# supplémentaire au moteur de calcul).
# ===========================================================================
def _resoudre_pourcentages_rubrique(surcharges_rubrique: dict, lignes_avant: list[dict]) -> dict:
    """
    `surcharges_rubrique` : dict {(code_rubrique, attribut): {"valeur":..., "mode":...}}
    tel que produit par _fusionner_surcharges_scenarios() — peut contenir des
    entrées en mode "POURCENTAGE" (transmis tel quel depuis les hypotheses
    JSON d'un scénario, jamais résolu par le backend jusqu'ici).

    `lignes_avant` = résultat "tel quel" DE CE collaborateur précis (déjà
    calculé juste avant l'appel — aucun calcul supplémentaire). Une rubrique
    en pourcentage introuvable dans lignes_avant (jamais calculée pour ce
    collaborateur, ex. rubrique non applicable à son profil) résout à un
    delta de 0 — traité comme "rien à ajouter", pas une erreur bloquante.
    """
    montants_actuels = {l["code_rubrique"]: _dec(l["montant"]) for l in lignes_avant}
    resolu: dict = {}
    for cle, s in surcharges_rubrique.items():
        if s.get("mode") == "POURCENTAGE":
            code_rubrique = cle[0]
            montant_actuel = montants_actuels.get(code_rubrique, D0)
            pourcentage = _dec(s["valeur"])
            delta = montant_actuel * pourcentage / Decimal("100")
            resolu[cle] = {"valeur": delta, "mode": "AJOUT"}
        else:
            resolu[cle] = s
    return resolu


# ===========================================================================
# Projection prévisionnelle retraite / fin de contrat (RG-SIM-PROJECTION-01,
# proposition — Adil DAIA) : pour un lancement en masse SANS aucun scénario
# (calcul "tel quel" pur), le système doit pouvoir déterminer si un
# collaborateur serait encore actif à la date d'une période FUTURE simulée —
# sans ça, une simulation sur 2028 calculerait un bulletin pour quelqu'un
# déjà parti à la retraite ou dont le CDD serait déjà terminé.
#
# Colonnes confirmées par Adil DAIA (captures d'écran, pas des suppositions) :
#   • collaborateurs.date_naissance, collaborateurs.code_genre
#   • collaborateur_contrats.code_type_contrat, .date_debut,
#     .date_depart_previsionnelle, .duree_contrat, .code_unite_duree
#
# ⚠️ _TABLE_PARAMETRES_RH : SEULE pièce non confirmée directement — le nom
# exact de la table "Paramètres RH" (écran Configuration, codes AGE_RETRAITE
# / AGE_RETRAITE_FEMME) n'a jamais été donné malgré plusieurs demandes.
# Isolé ici en UNE SEULE constante pour que la correction, si le nom est
# faux, tienne en une ligne plutôt qu'une refonte de toute cette section.
# ===========================================================================
_TABLE_PARAMETRES_RH = "parametres_rh"  # confirmé (capture Adil DAIA, 2026-08-09)


def _lire_parametre_rh(db: Session, code: str) -> Decimal | None:
    """Lit un paramètre numérique (ex. AGE_RETRAITE) — None si la table ou le code n'existe pas."""
    try:
        val = db.execute(text(f"SELECT valeur FROM public.{_TABLE_PARAMETRES_RH} WHERE code = :code"), {"code": code}).scalar()
        return Decimal(str(val)) if val is not None else None
    except Exception:
        return None


def _projeter_date_retraite(date_naissance: _date | None, code_genre: str | None, age_homme: Decimal | None, age_femme: Decimal | None) -> _date | None:
    """Date de départ à la retraite projetée = date de naissance + âge légal (selon le genre). None si donnée manquante."""
    if not date_naissance:
        return None
    age = age_femme if (code_genre or "").upper().startswith("F") and age_femme is not None else age_homme
    if age is None:
        return None
    try:
        return date_naissance.replace(year=date_naissance.year + int(age))
    except ValueError:
        # 29 février sur une année non bissextile après ajout de l'âge
        return date_naissance.replace(year=date_naissance.year + int(age), day=28)


def _projeter_date_fin_contrat(contrat: dict) -> _date | None:
    """
    Date de fin prévisionnelle d'un contrat — None pour un CDI (jamais de
    fin prévisionnelle) ou si aucune donnée exploitable.

    Priorité (confirmée par Adil DAIA) :
      1. date_depart_previsionnelle si saisie ;
      2. sinon date_debut + duree_contrat (convertie selon code_unite_duree).

    code_unite_duree : valeurs exactes non confirmées — reconnaît les formes
    usuelles (JOUR/JOURS, MOIS, AN/ANNEE/ANNEES), insensible à la casse. Une
    unité non reconnue est ignorée (retourne None) plutôt que de deviner.
    """
    if (contrat.get("code_type_contrat") or "").upper() == "CDI":
        return None
    if contrat.get("date_depart_previsionnelle"):
        return contrat["date_depart_previsionnelle"]
    date_debut, duree = contrat.get("date_debut"), contrat.get("duree_contrat")
    if not date_debut or not duree:
        return None
    unite = (contrat.get("code_unite_duree") or "").upper()
    try:
        if unite in ("JOUR", "JOURS", "J"):
            from datetime import timedelta
            return date_debut + timedelta(days=int(duree))
        if unite in ("MOIS", "M"):
            mois_total = date_debut.month - 1 + int(duree)
            annee = date_debut.year + mois_total // 12
            mois = mois_total % 12 + 1
            jour = min(date_debut.day, monthrange(annee, mois)[1])
            return _date(annee, mois, jour)
        if unite in ("AN", "ANNEE", "ANNEES", "ANS", "A"):
            return date_debut.replace(year=date_debut.year + int(duree))
    except (ValueError, TypeError):
        return None
    return None  # unité non reconnue — pas de projection plutôt qu'une supposition


def _collaborateur_actif_prevu(db: Session, collaborateur_id: UUID, date_simulee: _date) -> tuple[bool, str | None]:
    """
    Le collaborateur serait-il encore actif à date_simulee (retraite +
    fin de contrat prévisionnelle) ? Retourne (actif, motif_si_inactif).
    Silencieux (considère actif) si une donnée est indisponible — ne bloque
    jamais un lancement pour une projection qu'on ne peut pas calculer.
    """
    collab = db.execute(text("""
        SELECT date_naissance, code_genre FROM public.collaborateurs WHERE id = :id
    """), {"id": str(collaborateur_id)}).mappings().first()
    if collab:
        age_h = _lire_parametre_rh(db, "AGE_RETRAITE")
        age_f = _lire_parametre_rh(db, "AGE_RETRAITE_FEMME")
        date_retraite = _projeter_date_retraite(collab["date_naissance"], collab["code_genre"], age_h, age_f)
        if date_retraite and date_simulee >= date_retraite:
            return False, f"Retraite prévisionnelle atteinte le {date_retraite.isoformat()}"

    contrat = db.execute(text("""
        SELECT code_type_contrat, date_debut, date_depart_previsionnelle, duree_contrat, code_unite_duree
          FROM public.collaborateur_contrats
         WHERE collaborateur_id = :id AND archive = false
           AND (date_fin IS NULL OR date_fin >= :ref)
         ORDER BY date_debut DESC LIMIT 1
    """), {"id": str(collaborateur_id), "ref": date_simulee}).mappings().first()
    if contrat:
        date_fin_prevue = _projeter_date_fin_contrat(dict(contrat))
        if date_fin_prevue and date_simulee > date_fin_prevue:
            return False, f"Fin de contrat prévisionnelle le {date_fin_prevue.isoformat()}"

    return True, None


_NB_THREADS_JOB_POPULATION = 12
# Parallélisme raisonnable pour un travail dominé par des allers-retours DB
# (I/O-bound — le GIL Python ne bloque pas ce genre d'attente, contrairement
# à du calcul CPU pur) : chaque thread ouvre SA PROPRE session SQLAlchemy
# (jamais partagée entre threads — non thread-safe) via next(get_db()).
#
# ⚠️ Échelle réelle visée (Adil DAIA, 2026-08-09) : jusqu'à 100 000
# collaborateurs sur 3 ans (36 périodes) chez certains clients — soit
# potentiellement des MILLIONS de bulletins par lancement. Ce parallélisme
# par threads, à lui seul, ramène un ordre de grandeur de ~150h séquentielles
# à ~10-15h avec 12 threads (estimation, pas mesurée en conditions réelles) —
# une AMÉLIORATION, pas une solution complète à cette échelle. Descendre à
# quelques heures nécessiterait une vraie parallélisation multi-processus
# (plusieurs workers indépendants, ex. Celery+Redis ou équivalent) — non
# implémentée ici faute de confirmation qu'une telle infrastructure existe
# déjà dans le déploiement. À la charge d'Adil DAIA de confirmer.


def _traiter_collaborateur_population(
    job_id: UUID, c: dict, periode_ids: list, periodes_info: dict,
    scenarios: list[dict], scenarios_restreints: dict[str, set], surcharges_par_scenario: dict,
    calculer_avant: bool = True,
) -> dict:
    """
    Traite UN collaborateur sur toute la plage de périodes — exécuté dans un
    thread séparé (ThreadPoolExecutor), avec SA PROPRE session DB (jamais
    partagée). Retourne la ligne de résumé cumulée pour ce collaborateur ;
    écrit elle-même ses lignes dans simulation_population_bulletin (un
    INSERT multi-lignes par collaborateur, pas un par période — moins
    d'allers-retours DB à cette échelle).

    `calculer_avant=False` (RG-SIM-POPULATION-10, Adil DAIA) : saute le
    calcul "tel quel" (baseline sans scénario) — seuls les résultats "après
    scénario" (fusion + par scénario isolé) sont calculés, net_avant/
    cout_employeur_avant et tous les champs d'écart valent None. Le CALLER
    (_executer_job_population) est responsable de garantir calculer_avant=True
    dès qu'un scénario du job a une surcharge rubrique en mode Pourcentage
    (résolution impossible sans le résultat "tel quel", voir
    _resoudre_pourcentages_rubrique) — cette fonction ne revérifie pas cette
    condition, elle applique le calculer_avant qu'on lui donne tel quel.

    RG-SIM-POPULATION-04 (Adil DAIA) : ne stocke PLUS le détail des
    rubriques (lignes_avant/lignes_apres_fusion) — à 100 000 collaborateurs
    × 36 périodes, stocker le détail de CHAQUE bulletin représenterait des
    dizaines de Go de JSON par lancement. Le détail est recalculé À LA
    DEMANDE (GET /simulation/population/bulletins/{id}), seulement pour les
    quelques bulletins qu'un utilisateur clique réellement — jamais pour les
    millions qui ne seront jamais consultés.

    RG-SIM-SCENARIO-05 : un scénario restreint à une population (voir
    scenarios_restreints) n'est appliqué QUE si CE collaborateur en fait
    partie — sinon totalement ignoré pour lui (comme s'il n'avait jamais été
    coché), aussi bien dans la vue fusion que dans la vue "par scénario".
    La fusion est donc recalculée ICI, PROPRE À CE COLLABORATEUR (le
    sous-ensemble de scénarios qui lui sont réellement applicables diffère
    d'un collaborateur à l'autre dès qu'au moins un scénario est restreint).
    """
    db_gen_local = get_db()
    db_local: Session = next(db_gen_local)
    try:
        # RG-SIM-SCENARIO-06 (Adil DAIA) : filtre population (par collaborateur,
        # calculé une fois) — le filtre par date_application, lui, dépend de
        # CHAQUE période (voir _scenario_applicable_a_periode), donc recalculé
        # à chaque itération de la boucle ci-dessous, pas ici.
        scenarios_applicables_collab = [
            s for s in scenarios
            if str(s["id"]) not in scenarios_restreints or c["id"] in scenarios_restreints[str(s["id"])]
        ]

        net_avant_cumul = cout_avant_cumul = D0
        net_apres_fusion_cumul = cout_apres_fusion_cumul = D0
        # RG-SIM-POPULATION-07 (Adil DAIA) : Total Brut Imposable et Total
        # des Charges Patronales — le moteur les produit déjà par bulletin
        # (totaux.total_brut_imposable / totaux.total_cot_patronale,
        # paie_engine.py), suivis ici EN PARALLÈLE EXACT de net/coût
        # employeur (même cumul, même persistance, même logique).
        brut_imposable_avant_cumul = cot_patronale_avant_cumul = D0
        brut_imposable_apres_fusion_cumul = cot_patronale_apres_fusion_cumul = D0
        par_scenario_cumul: dict[str, dict] = {str(s["id"]): {"net_apres": D0, "cout_apres": D0} for s in scenarios}
        nb_periodes_calculees = 0
        note_projection: str | None = None
        lignes_a_inserer: list[dict] = []

        # RG-SIM-POPULATION-08 (Adil DAIA) : cumuls SIMULÉS, propagés d'une
        # période simulée à la suivante DANS CE MÊME EXERCICE — une
        # simulation ne persiste jamais dans public.cumul (voir
        # paie_engine.py, cumuls_simules_precedents), donc sans ce suivi
        # explicite, la période 2 simulée d'un exercice ne verrait jamais
        # l'apport de la période 1 simulée. Deux chaînes SÉPARÉES ("tel
        # quel" et "avec scénarios fusionnés") : un scénario qui change un
        # montant change aussi son cumul dans les périodes suivantes.
        # Remise à zéro au changement d'exercice (même logique que
        # public.cumul, filtré par année civile).
        #
        # Chaque scénario ISOLÉ a SA PROPRE chaîne de cumul (indépendante de
        # "avant" et de "fusion") — initialement non suivie ("vue secondaire
        # de comparaison"), corrigé ici (Adil DAIA) : sans elle, chaque
        # période d'un scénario isolé était calculée comme si c'était la
        # première période de l'exercice (assiette annuelle progressive,
        # plafonds CNSS/AMO repartant de zéro à chaque période), ce qui
        # produisait des écarts totalement faux sur une plage de plusieurs
        # périodes — ex. un écart NÉGATIF pour un scénario de revalorisation
        # salariale, alors qu'une hausse de salaire ne peut pas faire
        # baisser le net cumulé.
        cumuls_simules_avant: dict[str, list] = {}
        cumuls_simules_apres_fusion: dict[str, list] = {}
        cumuls_simules_par_scenario: dict[str, dict[str, list]] = {str(s["id"]): {} for s in scenarios}
        annee_courante_cumul: int | None = None

        for pid in periode_ids:
            pinfo = periodes_info.get(str(pid))
            date_periode = pinfo["date_reference"] if pinfo else None

            if pinfo and pinfo["annee"] != annee_courante_cumul:
                annee_courante_cumul = pinfo["annee"]
                cumuls_simules_avant = {}
                cumuls_simules_apres_fusion = {}
                cumuls_simules_par_scenario = {sid: {} for sid in cumuls_simules_par_scenario}

            # RG-SIM-SCENARIO-06 : un scénario avec date_application ne
            # s'applique qu'à partir de la première période (année/mois) qui
            # contient cette date — recalculé À CHAQUE période, car ce
            # sous-ensemble peut changer d'une période à l'autre (un
            # scénario "démarre" à un moment donné dans la plage simulée).
            scenarios_applicables_periode = (
                [s for s in scenarios_applicables_collab if _scenario_applicable_a_periode(s, pinfo["annee"], pinfo["mois"])]
                if pinfo else []
            )
            surcharges_fusion_periode = _fusionner_surcharges_scenarios(scenarios_applicables_periode)

            unite = None
            if date_periode is not None:
                unite = db_local.execute(text("""
                    SELECT u.id AS unite_id, u.libelle AS unite_libelle
                      FROM public.collaborateur_affectations a
                      JOIN public.unites_organisationnelles u ON u.id = a.unite_id
                     WHERE a.collaborateur_id = :cid AND a.archive = false
                       AND (a.date_debut_uo IS NULL OR a.date_debut_uo <= :ref)
                       AND (a.date_fin_uo   IS NULL OR a.date_fin_uo   >= :ref)
                     ORDER BY a.date_debut_uo DESC NULLS LAST
                     LIMIT 1
                """), {"cid": str(c["id"]), "ref": date_periode}).mappings().first()

            if date_periode is not None:
                actif, motif = _collaborateur_actif_prevu(db_local, c["id"], date_periode)
                if not actif:
                    if note_projection is None:
                        note_projection = motif
                    if pinfo:
                        lignes_a_inserer.append({
                            "unite_id": str(unite["unite_id"]) if unite else None,
                            "unite_libelle": unite["unite_libelle"] if unite else None,
                            "periode_id": str(pid), "periode_annee": pinfo["annee"], "periode_mois": pinfo["mois"],
                            "exclu_projection": True, "motif_exclusion": motif,
                            "net_avant": None, "net_apres_fusion": None, "cout_employeur_avant": None, "cout_employeur_apres_fusion": None,
                            "brut_imposable_avant": None, "brut_imposable_apres_fusion": None,
                            "cot_patronale_avant": None, "cot_patronale_apres_fusion": None,
                            "par_scenario": None, "a_erreur": False, "message_erreur": None,
                        })
                    continue

            nb_periodes_calculees += 1

            if calculer_avant:
                avant = simuler_bulletin(db_local, c["id"], pid, cumuls_simules_precedents=cumuls_simules_avant)
                net_avant_p = _dec(avant["totaux"]["net_a_payer"])
                cout_avant_p = _dec(avant["totaux"]["cout_employeur"])
                brut_imposable_avant_p = _dec(avant["totaux"]["total_brut_imposable"])
                cot_patronale_avant_p = _dec(avant["totaux"]["total_cot_patronale"])
                net_avant_cumul += net_avant_p
                cout_avant_cumul += cout_avant_p
                brut_imposable_avant_cumul += brut_imposable_avant_p
                cot_patronale_avant_cumul += cot_patronale_avant_p
                for l in avant["lignes"]:
                    cumuls_simules_avant.setdefault(l["code_rubrique"], []).append(
                        (pinfo["mois"], _dec(l["montant"]), _dec(l.get("nombre") or 0), _dec(l.get("montant_patronal") or 0)))
                lignes_pour_pourcentage = avant["lignes"]
                net_apres_fusion_p, cout_apres_fusion_p = net_avant_p, cout_avant_p
                brut_imposable_apres_fusion_p, cot_patronale_apres_fusion_p = brut_imposable_avant_p, cot_patronale_avant_p
            else:
                # RG-SIM-POPULATION-10 (Adil DAIA) : "avant" pas calculé —
                # le caller (_executer_job_population) garantit qu'aucune
                # surcharge Pourcentage n'existe dans ce job dès que
                # calculer_avant=False (seul cas où "avant" serait
                # structurellement nécessaire pour résoudre "après" — voir
                # _resoudre_pourcentages_rubrique). L'ensemble des scénarios
                # applicables PEUT varier période par période ou
                # collaborateur par collaborateur (date_application,
                # population restreinte) : chaque branche de repli plus bas
                # (fusion ET par-scénario isolé) sait gérer ce cas via son
                # propre calcul "tel quel" dédié, sur sa PROPRE chaîne de
                # cumuls — aucun objet "avant" partagé n'est nécessaire.
                net_avant_p = cout_avant_p = brut_imposable_avant_p = cot_patronale_avant_p = None
                # Jamais utilisé pour résoudre une surcharge Pourcentage ici :
                # le caller garantit qu'aucun scénario du job n'en a une
                # (seul cas où lignes_avant serait réellement nécessaire).
                lignes_pour_pourcentage = []
                net_apres_fusion_p = cout_apres_fusion_p = None
                brut_imposable_apres_fusion_p = cot_patronale_apres_fusion_p = None

            if scenarios_applicables_periode:
                sr, st_, sg = surcharges_fusion_periode
                sr_resolu = _resoudre_pourcentages_rubrique(sr, lignes_pour_pourcentage)
                apres_fusion = simuler_bulletin(
                    db_local, c["id"], pid, surcharges_rubrique=sr_resolu, surcharges_table=st_, surcharges_regime=sg,
                    cumuls_simules_precedents=cumuls_simules_apres_fusion,
                )
                net_apres_fusion_p = _dec(apres_fusion["totaux"]["net_a_payer"])
                cout_apres_fusion_p = _dec(apres_fusion["totaux"]["cout_employeur"])
                brut_imposable_apres_fusion_p = _dec(apres_fusion["totaux"]["total_brut_imposable"])
                cot_patronale_apres_fusion_p = _dec(apres_fusion["totaux"]["total_cot_patronale"])
                for l in apres_fusion["lignes"]:
                    cumuls_simules_apres_fusion.setdefault(l["code_rubrique"], []).append(
                        (pinfo["mois"], _dec(l["montant"]), _dec(l.get("nombre") or 0), _dec(l.get("montant_patronal") or 0)))
            elif calculer_avant:
                # Sans scénario applicable, "après fusion" == "avant" à
                # l'identique (déjà le cas plus haut) — la chaîne de cumul
                # "après fusion" doit donc aussi progresser avec CE résultat,
                # sinon elle prendrait du retard sur "avant" dès la période
                # suivante où un scénario redeviendrait applicable.
                for l in avant["lignes"]:
                    cumuls_simules_apres_fusion.setdefault(l["code_rubrique"], []).append(
                        (pinfo["mois"], _dec(l["montant"]), _dec(l.get("nombre") or 0), _dec(l.get("montant_patronal") or 0)))
            else:
                # calculer_avant=False ET aucun scénario applicable à CE
                # collaborateur POUR CETTE période (peut varier période par
                # période, ex. date_application, ou être constant, ex.
                # population restreinte qui l'exclut entièrement — les deux
                # cas sont gérés correctement ici, la chaîne de cumul
                # "après fusion" restant continue et cohérente dans tous les
                # cas) : "après" == "tel quel", calculé ici SANS être
                # comptabilisé comme "avant" (pas de net_avant_cumul, pas
                # d'écart).
                tel_quel = simuler_bulletin(db_local, c["id"], pid, cumuls_simules_precedents=cumuls_simules_apres_fusion)
                net_apres_fusion_p = _dec(tel_quel["totaux"]["net_a_payer"])
                cout_apres_fusion_p = _dec(tel_quel["totaux"]["cout_employeur"])
                brut_imposable_apres_fusion_p = _dec(tel_quel["totaux"]["total_brut_imposable"])
                cot_patronale_apres_fusion_p = _dec(tel_quel["totaux"]["total_cot_patronale"])
                for l in tel_quel["lignes"]:
                    cumuls_simules_apres_fusion.setdefault(l["code_rubrique"], []).append(
                        (pinfo["mois"], _dec(l["montant"]), _dec(l.get("nombre") or 0), _dec(l.get("montant_patronal") or 0)))
            net_apres_fusion_cumul += net_apres_fusion_p
            cout_apres_fusion_cumul += cout_apres_fusion_p
            brut_imposable_apres_fusion_cumul += brut_imposable_apres_fusion_p
            cot_patronale_apres_fusion_cumul += cot_patronale_apres_fusion_p

            par_scenario_periode = []
            ids_scenarios_applicables_periode = {str(s["id"]) for s in scenarios_applicables_periode}
            for s in scenarios:
                sid = str(s["id"])
                if sid in ids_scenarios_applicables_periode:
                    sr2, st2, sg2 = surcharges_par_scenario[sid]
                    sr2_resolu = _resoudre_pourcentages_rubrique(sr2, lignes_pour_pourcentage)
                    apres_s = simuler_bulletin(
                        db_local, c["id"], pid, surcharges_rubrique=sr2_resolu, surcharges_table=st2, surcharges_regime=sg2,
                        cumuls_simules_precedents=cumuls_simules_par_scenario[sid],
                    )
                    net_apres_s = _dec(apres_s["totaux"]["net_a_payer"])
                    cout_apres_s = _dec(apres_s["totaux"]["cout_employeur"])
                    for l in apres_s["lignes"]:
                        cumuls_simules_par_scenario[sid].setdefault(l["code_rubrique"], []).append(
                            (pinfo["mois"], _dec(l["montant"]), _dec(l.get("nombre") or 0), _dec(l.get("montant_patronal") or 0)))
                    par_scenario_periode.append({
                        "scenario_id": str(s["id"]), "scenario_nom": s["nom"],
                        "net_apres": str(net_apres_s),
                        "ecart_net": str(net_apres_s - net_avant_p) if net_avant_p is not None else None,
                        "cout_employeur_apres": str(cout_apres_s),
                        "ecart_cout_employeur": str(cout_apres_s - cout_avant_p) if cout_avant_p is not None else None,
                    })
                else:
                    # Scénario pas applicable à CE collaborateur pour CETTE
                    # période — deux raisons possibles : (a) date_application
                    # future dans la plage simulée, ou (b) scénario restreint
                    # à une population qui exclut ce collaborateur
                    # (scenarios_restreints). Aucune des deux ne force plus
                    # calculer_avant (voir _executer_job_population) : le
                    # repli ci-dessous fonctionne dans TOUS les cas, avec ou
                    # sans "avant" disponible.
                    if calculer_avant:
                        # "avant" déjà calculé plus haut cette période (pour
                        # une autre raison, ex. surcharge Pourcentage
                        # ailleurs dans le job) — réutilisé tel quel, aucun
                        # appel supplémentaire au moteur.
                        lignes_tel_quel_s = avant["lignes"]
                        net_apres_s, cout_apres_s = net_avant_p, cout_avant_p
                    else:
                        # "avant" pas calculé pour ce job (avec_ecarts=False,
                        # aucune surcharge Pourcentage) : un tel-quel DÉDIÉ à
                        # CE scénario est calculé ici, sur SA PROPRE chaîne
                        # de cumuls (cumuls_simules_par_scenario[sid]) — pas
                        # celle de "avant" (qui n'existe pas) ni celle de la
                        # fusion (qui a pu recevoir d'autres surcharges) :
                        # chaque chaîne doit rester cohérente avec sa propre
                        # histoire cumulée.
                        tel_quel_s = simuler_bulletin(db_local, c["id"], pid, cumuls_simules_precedents=cumuls_simules_par_scenario[sid])
                        net_apres_s = _dec(tel_quel_s["totaux"]["net_a_payer"])
                        cout_apres_s = _dec(tel_quel_s["totaux"]["cout_employeur"])
                        lignes_tel_quel_s = tel_quel_s["lignes"]
                    # Indispensable sur les DEUX plans : 1) la chaîne de
                    # cumul de ce scénario doit quand même progresser,
                    # sinon elle prend du retard s'il redevient applicable
                    # (cas date_application) ; 2) son total net_apres cumulé
                    # doit lui aussi inclure CETTE période/CE collaborateur,
                    # sinon le total sous-compte alors que net_avant_cumul
                    # (utilisé pour l'écart) inclut TOUJOURS TOUT LE MONDE —
                    # c'est CE sous-comptage, pour le cas (b), qui produisait
                    # l'écart énorme et faux dans le "Résumé par scénario"
                    # pour un scénario restreint à une sous-population.
                    for l in lignes_tel_quel_s:
                        cumuls_simules_par_scenario[sid].setdefault(l["code_rubrique"], []).append(
                            (pinfo["mois"], _dec(l["montant"]), _dec(l.get("nombre") or 0), _dec(l.get("montant_patronal") or 0)))
                par_scenario_cumul[sid]["net_apres"] += net_apres_s
                par_scenario_cumul[sid]["cout_apres"] += cout_apres_s

            lignes_a_inserer.append({
                "unite_id": str(unite["unite_id"]) if unite else None,
                "unite_libelle": unite["unite_libelle"] if unite else None,
                "periode_id": str(pid), "periode_annee": pinfo["annee"], "periode_mois": pinfo["mois"],
                "exclu_projection": False, "motif_exclusion": None,
                "net_avant": net_avant_p, "net_apres_fusion": net_apres_fusion_p,
                "cout_employeur_avant": cout_avant_p, "cout_employeur_apres_fusion": cout_apres_fusion_p,
                "brut_imposable_avant": brut_imposable_avant_p, "brut_imposable_apres_fusion": brut_imposable_apres_fusion_p,
                "cot_patronale_avant": cot_patronale_avant_p, "cot_patronale_apres_fusion": cot_patronale_apres_fusion_p,
                "par_scenario": par_scenario_periode, "a_erreur": False, "message_erreur": None,
            })

        # INSERT multi-lignes UNIQUE pour tout le collaborateur (pas un par
        # période) — réduit fortement les allers-retours DB à grande échelle.
        if lignes_a_inserer:
            db_local.execute(text("""
                INSERT INTO public.simulation_population_bulletin
                    (job_id, collaborateur_id, matricule, nom, prenom, unite_id, unite_libelle,
                     periode_id, periode_annee, periode_mois, exclu_projection, motif_exclusion,
                     net_avant, net_apres_fusion, cout_employeur_avant, cout_employeur_apres_fusion,
                     brut_imposable_avant, brut_imposable_apres_fusion, cot_patronale_avant, cot_patronale_apres_fusion,
                     par_scenario, a_erreur, message_erreur)
                VALUES (:job_id, :cid, :matricule, :nom, :prenom, CAST(:unite_id AS uuid), :unite_libelle,
                        CAST(:periode_id AS uuid), :periode_annee, :periode_mois, :exclu_projection, :motif_exclusion,
                        :net_avant, :net_apres_fusion, :cout_employeur_avant, :cout_employeur_apres_fusion,
                        :brut_imposable_avant, :brut_imposable_apres_fusion, :cot_patronale_avant, :cot_patronale_apres_fusion,
                        CAST(:par_scenario AS jsonb), :a_erreur, :message_erreur)
            """), [
                {
                    "job_id": str(job_id), "cid": str(c["id"]), "matricule": c["matricule"],
                    "nom": c["nom"], "prenom": c["prenom"],
                    "par_scenario": json.dumps(l["par_scenario"], default=str) if l["par_scenario"] is not None else None,
                    **{k: v for k, v in l.items() if k != "par_scenario"},
                }
                for l in lignes_a_inserer
            ])
            db_local.commit()

        par_scenario_resume = []
        for s in scenarios:
            sid = str(s["id"])
            par_scenario_resume.append({
                "scenario_id": s["id"], "scenario_nom": s["nom"],
                "net_apres": str(par_scenario_cumul[sid]["net_apres"]),
                "ecart_net": str(par_scenario_cumul[sid]["net_apres"] - net_avant_cumul) if calculer_avant else None,
                "cout_employeur_apres": str(par_scenario_cumul[sid]["cout_apres"]),
                "ecart_cout_employeur": str(par_scenario_cumul[sid]["cout_apres"] - cout_avant_cumul) if calculer_avant else None,
                "_net_apres_dec": par_scenario_cumul[sid]["net_apres"], "_cout_apres_dec": par_scenario_cumul[sid]["cout_apres"],
            })

        return {
            "a_erreur": False,
            "ligne": {
                "collaborateur_id": c["id"], "matricule": c["matricule"], "nom": c["nom"], "prenom": c["prenom"],
                "a_erreur": False, "message_erreur": None,
                "net_avant": str(net_avant_cumul) if calculer_avant else None,
                "cout_employeur_avant": str(cout_avant_cumul) if calculer_avant else None,
                "net_apres_fusion": str(net_apres_fusion_cumul),
                "ecart_net_fusion": str(net_apres_fusion_cumul - net_avant_cumul) if calculer_avant else None,
                "cout_employeur_apres_fusion": str(cout_apres_fusion_cumul),
                "ecart_cout_employeur_fusion": str(cout_apres_fusion_cumul - cout_avant_cumul) if calculer_avant else None,
                "brut_imposable_avant": str(brut_imposable_avant_cumul) if calculer_avant else None,
                "brut_imposable_apres_fusion": str(brut_imposable_apres_fusion_cumul),
                "ecart_brut_imposable": str(brut_imposable_apres_fusion_cumul - brut_imposable_avant_cumul) if calculer_avant else None,
                "cot_patronale_avant": str(cot_patronale_avant_cumul) if calculer_avant else None,
                "cot_patronale_apres_fusion": str(cot_patronale_apres_fusion_cumul),
                "ecart_cot_patronale": str(cot_patronale_apres_fusion_cumul - cot_patronale_avant_cumul) if calculer_avant else None,
                "par_scenario": par_scenario_resume,
                "nb_periodes_calculees": nb_periodes_calculees,
                "note_projection": note_projection,
            },
            "net_avant": net_avant_cumul if calculer_avant else None, "net_apres_fusion": net_apres_fusion_cumul,
            "cout_avant": cout_avant_cumul if calculer_avant else None, "cout_apres_fusion": cout_apres_fusion_cumul,
            "brut_imposable_avant": brut_imposable_avant_cumul if calculer_avant else None, "brut_imposable_apres_fusion": brut_imposable_apres_fusion_cumul,
            "cot_patronale_avant": cot_patronale_avant_cumul if calculer_avant else None, "cot_patronale_apres_fusion": cot_patronale_apres_fusion_cumul,
            "par_scenario_dec": {sid: v for sid, v in par_scenario_cumul.items()},
        }
    except HTTPException as e:
        db_local.rollback()
        db_local.execute(text("""
            INSERT INTO public.simulation_population_bulletin
                (job_id, collaborateur_id, matricule, nom, prenom, periode_id, periode_annee, periode_mois, a_erreur, message_erreur)
            SELECT :job_id, :cid, :matricule, :nom, :prenom, id, annee, mois, true, :msg
              FROM public.calendrier_paie WHERE id = ANY(CAST(:pids AS uuid[]))
        """), {
            "job_id": str(job_id), "cid": str(c["id"]), "matricule": c["matricule"],
            "nom": c["nom"], "prenom": c["prenom"], "msg": str(e.detail), "pids": periode_ids,
        })
        db_local.commit()
        return {
            "a_erreur": True,
            "ligne": {
                "collaborateur_id": c["id"], "matricule": c["matricule"], "nom": c["nom"], "prenom": c["prenom"],
                "a_erreur": True, "message_erreur": str(e.detail),
                "net_avant": None, "cout_employeur_avant": None, "net_apres_fusion": None, "ecart_net_fusion": None,
                "cout_employeur_apres_fusion": None, "ecart_cout_employeur_fusion": None, "par_scenario": [],
            },
        }
    except Exception as e:  # défense en profondeur : un collaborateur en erreur ne doit jamais faire échouer tout le job
        db_local.rollback()
        try:
            db_local.execute(text("""
                INSERT INTO public.simulation_population_bulletin
                    (job_id, collaborateur_id, matricule, nom, prenom, periode_id, periode_annee, periode_mois, a_erreur, message_erreur)
                SELECT :job_id, :cid, :matricule, :nom, :prenom, id, annee, mois, true, :msg
                  FROM public.calendrier_paie WHERE id = ANY(CAST(:pids AS uuid[]))
            """), {
                "job_id": str(job_id), "cid": str(c["id"]), "matricule": c["matricule"],
                "nom": c["nom"], "prenom": c["prenom"], "msg": f"Erreur inattendue : {e}", "pids": periode_ids,
            })
            db_local.commit()
        except Exception:
            pass
        return {
            "a_erreur": True,
            "ligne": {
                "collaborateur_id": c["id"], "matricule": c["matricule"], "nom": c["nom"], "prenom": c["prenom"],
                "a_erreur": True, "message_erreur": f"Erreur inattendue : {e}",
                "net_avant": None, "cout_employeur_avant": None, "net_apres_fusion": None, "ecart_net_fusion": None,
                "cout_employeur_apres_fusion": None, "ecart_cout_employeur_fusion": None, "par_scenario": [],
            },
        }
    finally:
        try:
            next(db_gen_local)
        except StopIteration:
            pass


def _executer_job_population(job_id: UUID):
    """
    Tâche de fond (FastAPI BackgroundTasks) — s'exécute APRÈS que la réponse
    HTTP de POST /simulation/population/lancer a déjà été envoyée.

    Parallélisé par threads (_NB_THREADS_JOB_POPULATION) — voir le
    commentaire au-dessus de _traiter_collaborateur_population pour le
    détail et les limites de cette approche à très grande échelle.
    """
    db_gen = get_db()
    db: Session = next(db_gen)
    try:
        job = db.execute(text("""
            SELECT * FROM public.simulation_population_job WHERE id = :id
        """), {"id": str(job_id)}).mappings().first()
        if not job:
            return

        db.execute(text("UPDATE public.simulation_population_job SET statut = 'EN_COURS' WHERE id = :id"), {"id": str(job_id)})
        db.commit()

        periode_ids = job["periode_ids"]
        collaborateur_ids = job["collaborateur_ids"]
        scenario_ids = job["scenario_ids"]

        periodes_info = {
            str(row["id"]): row
            for row in db.execute(text("""
                SELECT id, annee, mois, date_reference, societe_id FROM public.calendrier_paie WHERE id = ANY(CAST(:ids AS uuid[]))
            """), {"ids": periode_ids}).mappings().all()
        }

        scenarios = db.execute(text("""
            SELECT id, nom, hypotheses, population_id, date_application FROM public.simulation_individuelle
             WHERE id = ANY(CAST(:ids AS uuid[]))
        """), {"ids": scenario_ids}).mappings().all()
        scenarios = [dict(s) for s in scenarios]

        # RG-SIM-SCENARIO-05 (Adil DAIA — "population optionnelle : si
        # choisie, restreint ; sinon libre") : pour chaque scénario ayant un
        # population_id, résout UNE FOIS (avant la boucle par collaborateur,
        # jamais recalculé par thread) l'ensemble des collaborateurs de
        # cette population — même date de référence que la résolution de la
        # population PRINCIPALE du job (date_reference de la période de
        # DÉBUT de la plage), pour rester cohérent.
        premiere_periode = periodes_info.get(str(periode_ids[0])) if periode_ids else None
        ref_date_restriction = premiere_periode["date_reference"] if premiere_periode else None
        # RG-MULTISOCIETE-07 : job de fond, pas de JWT -- société dérivée de
        # la 1ère période du job (toutes les périodes d'un même job
        # appartiennent à la même société, RG-07).
        societe_id_job = str(premiere_periode["societe_id"]) if premiere_periode else None
        scenarios_restreints: dict[str, set] = {}
        if ref_date_restriction is not None and societe_id_job:
            for s in scenarios:
                if s.get("population_id"):
                    scenarios_restreints[str(s["id"])] = resoudre_population(db, s["population_id"], ref_date_restriction, societe_id_job)

        surcharges_par_scenario = {str(s["id"]): _fusionner_surcharges_scenarios([s]) for s in scenarios}

        # RG-SIM-POPULATION-10 (Adil DAIA) : avec_ecarts contrôle UNIQUEMENT
        # l'affichage des écarts, jamais la nécessité technique de calculer
        # "avant" en interne — deux notions découplées :
        #   • calculer_avant (interne) : le calcul "tel quel" a-t-il
        #     réellement lieu ce job ? Forcé à True SEULEMENT si une
        #     surcharge rubrique est en mode Pourcentage — ce mode a
        #     structurellement besoin du résultat "tel quel" pour résoudre
        #     le %, voir _resoudre_pourcentages_rubrique (sans lui, "après"
        #     lui-même serait mal calculé, pas seulement l'écart).
        #   • afficher_ecarts (externe) : reflète tel quel avec_ecarts,
        #     jamais réétabli à True par autre chose — si l'utilisateur a
        #     décoché "Calculer les écarts", les écarts restent MASQUÉS même
        #     si "avant" a dû être calculé en interne pour une autre raison.
        # Un scénario avec date_application ou restreint à une population
        # (population_id) NE force plus calculer_avant : les branches de
        # repli "tel quel" (fusion ET par-scénario isolé, voir
        # _traiter_collaborateur_population) savent désormais calculer un
        # résultat "tel quel" dédié, sur leur PROPRE chaîne de cumuls, sans
        # avoir besoin d'un objet "avant" partagé.
        a_surcharge_pourcentage = any(
            st.get("mode") == "POURCENTAGE"
            for s in scenarios
            for st in (s.get("hypotheses") or {}).get("surcharges_rubrique") or []
        )
        calculer_avant = bool(job["avec_ecarts"]) or a_surcharge_pourcentage
        afficher_ecarts = bool(job["avec_ecarts"])

        collabs = db.execute(text("""
            SELECT id, matricule, nom, prenom FROM public.collaborateurs
             WHERE id = ANY(CAST(:ids AS uuid[]))
             ORDER BY matricule
        """), {"ids": collaborateur_ids}).mappings().all()
        collabs = [dict(c) for c in collabs]

        lignes: list[dict] = []
        nb_erreurs = 0
        tot_net_avant = tot_net_apres_fusion = tot_cout_avant = tot_cout_apres_fusion = D0
        tot_brut_imposable_avant = tot_brut_imposable_apres_fusion = D0
        tot_cot_patronale_avant = tot_cot_patronale_apres_fusion = D0
        totaux_par_scenario: dict[str, dict] = {str(s["id"]): {"net_apres": D0, "cout_apres": D0} for s in scenarios}

        # nb_traites mis à jour tous les 25 collaborateurs OU toutes les
        # 1,5s (le premier des deux) OU à la fin — jamais à chaque
        # completion : à 100 000 collaborateurs, un UPDATE par personne
        # saturerait la DB de requêtes inutiles pour du feedback de
        # progression qui n'a pas besoin d'une telle granularité. Le
        # déclencheur temporel est indispensable pour les PETITES
        # populations (ex. 3 collaborateurs) : sans lui, le seuil de 25
        # n'est jamais atteint avant la toute fin, et l'écran de suivi
        # (SuiviProgressionJob) reste bloqué à 0% tout du long avant de
        # sauter directement à 100% — aucune progression visible.
        SEUIL_MAJ_PROGRESSION = 25
        INTERVALLE_MAJ_PROGRESSION_S = 1.5
        i = 0
        dernier_maj_temps = time.time()
        with ThreadPoolExecutor(max_workers=_NB_THREADS_JOB_POPULATION) as executor:
            futures = {
                executor.submit(
                    _traiter_collaborateur_population, job_id, c, periode_ids, periodes_info,
                    scenarios, scenarios_restreints, surcharges_par_scenario, calculer_avant,
                ): c
                for c in collabs
            }
            for future in as_completed(futures):
                i += 1
                resultat = future.result()
                lignes.append(resultat["ligne"])
                if resultat["a_erreur"]:
                    nb_erreurs += 1
                else:
                    if calculer_avant:
                        tot_net_avant += resultat["net_avant"]; tot_cout_avant += resultat["cout_avant"]
                        tot_brut_imposable_avant += resultat["brut_imposable_avant"]
                        tot_cot_patronale_avant += resultat["cot_patronale_avant"]
                    tot_net_apres_fusion += resultat["net_apres_fusion"]; tot_cout_apres_fusion += resultat["cout_apres_fusion"]
                    tot_brut_imposable_apres_fusion += resultat["brut_imposable_apres_fusion"]
                    tot_cot_patronale_apres_fusion += resultat["cot_patronale_apres_fusion"]
                    for sid, v in resultat["par_scenario_dec"].items():
                        totaux_par_scenario[sid]["net_apres"] += v["net_apres"]
                        totaux_par_scenario[sid]["cout_apres"] += v["cout_apres"]

                maintenant = time.time()
                if (
                    i % SEUIL_MAJ_PROGRESSION == 0
                    or i == len(collabs)
                    or (maintenant - dernier_maj_temps) >= INTERVALLE_MAJ_PROGRESSION_S
                ):
                    db.execute(text("UPDATE public.simulation_population_job SET nb_traites = :n WHERE id = :id"),
                               {"n": i, "id": str(job_id)})
                    db.commit()
                    dernier_maj_temps = maintenant

        resultat_final = {
            "population_id": job["population_id"],
            "population_nom": job["population_nom"],
            "periode_debut_id": job["periode_debut_id"],
            "periode_fin_id": job["periode_fin_id"],
            "periode_debut_libelle": job["periode_debut_libelle"],
            "periode_fin_libelle": job["periode_fin_libelle"],
            "nb_periodes": len(periode_ids),
            "scenarios": [{"id": s["id"], "nom": s["nom"]} for s in scenarios],
            "nb_collaborateurs": len(collabs),
            "nb_erreurs": nb_erreurs,
            "avec_ecarts": afficher_ecarts,
            "resume_fusion": {
                "net_avant": str(tot_net_avant) if afficher_ecarts else None, "net_apres": str(tot_net_apres_fusion),
                "ecart_net": str(tot_net_apres_fusion - tot_net_avant) if afficher_ecarts else None,
                "cout_employeur_avant": str(tot_cout_avant) if afficher_ecarts else None, "cout_employeur_apres": str(tot_cout_apres_fusion),
                "ecart_cout_employeur": str(tot_cout_apres_fusion - tot_cout_avant) if afficher_ecarts else None,
                "brut_imposable_avant": str(tot_brut_imposable_avant) if afficher_ecarts else None, "brut_imposable_apres": str(tot_brut_imposable_apres_fusion),
                "ecart_brut_imposable": str(tot_brut_imposable_apres_fusion - tot_brut_imposable_avant) if afficher_ecarts else None,
                "cot_patronale_avant": str(tot_cot_patronale_avant) if afficher_ecarts else None, "cot_patronale_apres": str(tot_cot_patronale_apres_fusion),
                "ecart_cot_patronale": str(tot_cot_patronale_apres_fusion - tot_cot_patronale_avant) if afficher_ecarts else None,
            },
            "resume_par_scenario": [
                {
                    "scenario_id": s["id"], "scenario_nom": s["nom"],
                    "net_apres": str(totaux_par_scenario[str(s["id"])]["net_apres"]),
                    "ecart_net": str(totaux_par_scenario[str(s["id"])]["net_apres"] - tot_net_avant) if afficher_ecarts else None,
                    "cout_employeur_apres": str(totaux_par_scenario[str(s["id"])]["cout_apres"]),
                    "ecart_cout_employeur": str(totaux_par_scenario[str(s["id"])]["cout_apres"] - tot_cout_avant) if afficher_ecarts else None,
                }
                for s in scenarios
            ],
            "lignes": lignes,
        }

        db.execute(text("""
            UPDATE public.simulation_population_job
               SET statut = 'TERMINE', resultat = CAST(:r AS jsonb), termine_at = now(), avant_calcule = :ac
             WHERE id = :id
        """), {"r": json.dumps(resultat_final, default=str), "id": str(job_id), "ac": calculer_avant})
        db.commit()

    except Exception as e:
        try:
            db.rollback()
            db.execute(text("""
                UPDATE public.simulation_population_job
                   SET statut = 'ERREUR', erreur = :e, termine_at = now()
                 WHERE id = :id
            """), {"e": str(e), "id": str(job_id)})
            db.commit()
        except Exception:
            pass
    finally:
        try:
            next(db_gen)
        except StopIteration:
            pass


@router.post("/simulation/population/lancer", response_model=SimulationPopulationJobCree, status_code=202)
def lancer_simulation_population(
    req: SimulationPopulationRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    payload=Depends(get_current_user_payload),
    _=Depends(require_roles(*PAIE_ROLES)),
    societe_id: str = Depends(get_societe_active_id),
):
    """
    Crée le job (résout la population et la plage de périodes TOUT DE SUITE
    pour connaître nb_total et détecter les erreurs de validation
    immédiatement), puis délègue le calcul à _executer_job_population en
    tâche de fond. Réponse 202 : le traitement n'est pas terminé, l'écran
    doit interroger GET /simulation/population/jobs/{job_id}.

    `ref_date` pour la résolution de la population = date_reference de la
    période de DÉBUT (choix délibéré, pas neutre : un collaborateur parti en
    cours de plage reste inclus s'il était éligible au début — cohérent avec
    "simuler l'impact sur la population telle qu'elle était au lancement").
    """
    debut = db.execute(text("""
        SELECT id, plan_paie_id, annee, mois, date_reference,
               (SELECT libelle FROM public.plan_paie WHERE id = c.plan_paie_id) AS plan_libelle
          FROM public.calendrier_paie c WHERE c.id = :pid AND c.societe_id = :societe_id
    """), {"pid": str(req.periode_debut_id), "societe_id": societe_id}).mappings().first()
    if not debut:
        raise HTTPException(404, "Période de début introuvable")
    fin = db.execute(text("""
        SELECT id, plan_paie_id, annee, mois FROM public.calendrier_paie WHERE id = :pid AND societe_id = :societe_id
    """), {"pid": str(req.periode_fin_id), "societe_id": societe_id}).mappings().first()
    if not fin:
        raise HTTPException(404, "Période de fin introuvable")
    if fin["plan_paie_id"] != debut["plan_paie_id"]:
        raise HTTPException(400, "Les périodes de début et de fin doivent appartenir au même plan de paie")
    cle_debut = debut["annee"] * 12 + debut["mois"]
    cle_fin = fin["annee"] * 12 + fin["mois"]
    if cle_fin < cle_debut:
        raise HTTPException(400, "La période de fin doit être postérieure ou égale à la période de début")

    periodes_plage = db.execute(text("""
        SELECT id, annee, mois FROM public.calendrier_paie
         WHERE plan_paie_id = :plan AND societe_id = :societe_id AND (annee * 12 + mois) BETWEEN :cd AND :cf
         ORDER BY annee, mois
    """), {"plan": str(debut["plan_paie_id"]), "societe_id": societe_id, "cd": cle_debut, "cf": cle_fin}).mappings().all()
    if not periodes_plage:
        raise HTTPException(400, "Aucune période dans cette plage")

    ref_date = debut["date_reference"]

    if req.population_id:
        pop = db.execute(text("""
            SELECT id, libelle FROM public.population_paie
             WHERE id = :pid AND actif = true AND archive = false AND societe_id = :societe_id
        """), {"pid": str(req.population_id), "societe_id": societe_id}).mappings().first()
        if not pop:
            raise HTTPException(404, "Population introuvable ou inactive")
        collaborateur_ids = resoudre_population(db, req.population_id, ref_date, societe_id)
        population_nom = pop["libelle"]
    else:
        collaborateur_ids = resoudre_toutes_populations_actives(db, ref_date, societe_id)
        population_nom = "Toutes les populations"

    if not collaborateur_ids:
        raise HTTPException(400, "Aucun collaborateur ne correspond à cette population pour cette période")

    trouves = {row[0] for row in db.execute(text("""
        SELECT id FROM public.simulation_individuelle WHERE id = ANY(CAST(:ids AS uuid[])) AND archive = false
    """), {"ids": [str(i) for i in req.scenario_ids]}).all()}
    manquants = [str(i) for i in req.scenario_ids if i not in trouves]
    if manquants:
        raise HTTPException(404, f"Scénario(s) introuvable(s) ou archivé(s) : {', '.join(manquants)}")

    user_id = UUID(payload["sub"])
    nb_total = len(collaborateur_ids)
    periode_debut_libelle = f"{MOIS_LIBELLES[debut['mois']]} {debut['annee']}"
    periode_fin_libelle = f"{MOIS_LIBELLES[fin['mois']]} {fin['annee']}"

    job_id = db.execute(text("""
        INSERT INTO public.simulation_population_job
            (population_id, population_nom, periode_debut_id, periode_fin_id,
             periode_debut_libelle, periode_fin_libelle, periode_ids,
             scenario_ids, collaborateur_ids, nb_total, created_by, avec_ecarts)
        VALUES (:pop_id, :pop_nom, :pdid, :pfid, :pdlib, :pflib, CAST(:pids AS jsonb),
                CAST(:sids AS jsonb), CAST(:cids AS jsonb), :nb, :uid, :avec_ecarts)
        RETURNING id
    """), {
        "pop_id": str(req.population_id) if req.population_id else None,
        "pop_nom": population_nom,
        "pdid": str(req.periode_debut_id), "pfid": str(req.periode_fin_id),
        "pdlib": periode_debut_libelle, "pflib": periode_fin_libelle,
        "pids": json.dumps([str(p["id"]) for p in periodes_plage]),
        "sids": json.dumps([str(i) for i in req.scenario_ids]),
        "cids": json.dumps([str(i) for i in collaborateur_ids]),
        "nb": nb_total,
        "uid": str(user_id),
        "avec_ecarts": req.avec_ecarts,
    }).scalar()
    db.commit()

    background_tasks.add_task(_executer_job_population, job_id)

    return {"job_id": job_id, "nb_total": nb_total}


@router.get("/simulation/population/jobs/{job_id}", response_model=SimulationPopulationJobStatut)
def lire_job_population(
    job_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    """Interrogé en polling par l'écran pendant EN_ATTENTE/EN_COURS, jusqu'à TERMINE/ERREUR."""
    job = db.execute(text("""
        SELECT * FROM public.simulation_population_job WHERE id = :id
    """), {"id": str(job_id)}).mappings().first()
    if not job:
        raise HTTPException(404, "Lancement introuvable")
    return {
        "id": job["id"], "statut": job["statut"], "population_nom": job["population_nom"],
        "nb_total": job["nb_total"], "nb_traites": job["nb_traites"], "erreur": job["erreur"],
        "resultat": job["resultat"], "created_at": job["created_at"], "termine_at": job["termine_at"],
    }


_MOIS_LIBELLES_BULLETIN = ["", "Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."]


@router.get("/simulation/population/jobs", response_model=list[SimulationPopulationJobResume])
def lister_jobs_population(
    statut: str | None = Query(None, description="Filtre optionnel : EN_ATTENTE | EN_COURS | TERMINE | ERREUR"),
    limite: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    payload=Depends(get_current_user_payload),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    """
    Historique des lancements en masse (RG-SIM-POPULATION-06, proposition —
    Adil DAIA : "écrans de consultation des simulations"). Tous les
    lancements sont visibles (pas seulement ceux du demandeur — même
    logique que les scénarios partagés, un lancement en masse concerne
    potentiellement toute l'équipe paie), avec le nom du créateur pour
    traçabilité. Résumé LÉGER (sans le `resultat` complet, potentiellement
    volumineux) — le détail se récupère via GET .../jobs/{id} au clic.
    """
    where = []
    params: dict = {"limite": limite}
    if statut:
        where.append("j.statut = :statut")
        params["statut"] = statut
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    try:
        rows = db.execute(text(f"""
            SELECT j.id, j.statut, j.population_nom, j.periode_debut_libelle, j.periode_fin_libelle,
                   j.nb_total, j.nb_traites, j.created_by, j.created_at, j.termine_at,
                   COALESCE(
                       COALESCE(p.prenom, c.prenom) || ' ' || COALESCE(p.nom, c.nom),
                       'Inconnu'
                   ) AS created_by_nom,
                   COALESCE((
                       SELECT array_agg(s.nom ORDER BY s.nom)
                         FROM public.simulation_individuelle s
                        WHERE s.id::text IN (SELECT jsonb_array_elements_text(j.scenario_ids))
                   ), ARRAY[]::text[]) AS scenario_noms
              FROM public.simulation_population_job j
              LEFT JOIN public.profiles p ON p.user_id = j.created_by
              LEFT JOIN public.collaborateurs c ON c.id = p.collaborateur_id
             {clause}
             ORDER BY j.created_at DESC
             LIMIT :limite
        """), params).mappings().all()
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        # Erreur réelle remontée (au lieu d'un crash opaque masqué en faux
        # CORS côté navigateur) — même correctif appliqué aux endpoints
        # précédents ayant présenté le même symptôme.
        raise HTTPException(400, f"Erreur de chargement de l'historique : {type(e).__name__}: {e}")
    return rows


@router.delete("/simulation/population/jobs/{job_id}", status_code=204)
def purger_job_population(
    job_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    """
    Purge un lancement (RG-SIM-POPULATION-06) — supprime le job ET tous ses
    bulletins détaillés (ON DELETE CASCADE, migration 066). Jamais de
    restriction au créateur : n'importe quel utilisateur PAIE_ROLES peut
    purger un lancement (même logique de visibilité partagée que la liste).
    Aucune vérification de statut : un job encore EN_COURS peut être purgé,
    le thread en tâche de fond en cours d'exécution continuera ses calculs
    en arrière-plan mais échouera silencieusement sur ses derniers INSERT
    (job_id inexistant) — acceptable, pas d'usage réel de purger un job actif.
    """
    resultat = db.execute(text("DELETE FROM public.simulation_population_job WHERE id = :id"), {"id": str(job_id)})
    db.commit()
    if resultat.rowcount == 0:
        raise HTTPException(404, "Lancement introuvable")



def _situation_actuelle_collaborateurs(db: Session, ids: list[str], ref) -> dict[str, dict]:
    """
    État ACTUEL (à la date `ref`, généralement aujourd'hui) de chaque
    collaborateur pour la consultation des simulations (demande Adil DAIA) :
    type de contrat, collège, catégorie professionnelle, emploi (code +
    libellé). Même principe que RG-POPULATION-APERCU-ENRICHI-01 (un seul
    aller-retour par dimension pour TOUS les collaborateurs demandés, jamais
    une requête par personne).

    Ce n'est PAS un instantané historique par période — pour la paie réelle,
    collaborateur_contrats/_qualifications/_affectations sont déjà
    historisées par date_debut/date_fin, donc interroger "à la date de la
    période" y suffit ; ici, en simulation, on affiche l'état actuel du
    collaborateur (confirmé acceptable par Adil DAIA), charge à "après" de
    refléter un éventuel changement simulé par le scénario.
    """
    situ: dict[str, dict] = {str(i): {} for i in ids}
    if not ids:
        return situ

    for row in db.execute(text("""
        SELECT DISTINCT ON (k.collaborateur_id) k.collaborateur_id, rt.libelle
          FROM public.collaborateur_contrats k
          JOIN public.ref_type_contrat rt ON rt.code = k.code_type_contrat
         WHERE k.collaborateur_id = ANY(CAST(:ids AS uuid[])) AND k.archive = false
           AND k.date_debut <= :ref AND (k.date_fin IS NULL OR k.date_fin >= :ref)
         ORDER BY k.collaborateur_id, k.date_debut DESC
    """), {"ids": ids, "ref": ref}).mappings().all():
        situ[str(row["collaborateur_id"])]["type_contrat"] = row["libelle"]

    # Collège et catégorie professionnelle : reconstruction colonne par
    # colonne (comme RG-POPULATION-RUBRIQUE-03) — jamais "la ligne la plus
    # récente", qui perdrait une colonne renseignée par un autre motif à la
    # même date_evolution.
    for row in db.execute(text("""
        SELECT qc.collaborateur_id, rcp.libelle
          FROM (
              SELECT collaborateur_id,
                     (array_agg(code_categorie_professionnelle ORDER BY date_evolution DESC, created_at DESC)
                      FILTER (WHERE code_categorie_professionnelle IS NOT NULL))[1] AS code_categorie_professionnelle
                FROM public.collaborateur_qualifications
               WHERE collaborateur_id = ANY(CAST(:ids AS uuid[])) AND archive = false AND date_evolution <= :ref
               GROUP BY collaborateur_id
          ) qc
          JOIN public.ref_categorie_professionnelle rcp ON rcp.code = qc.code_categorie_professionnelle
    """), {"ids": ids, "ref": ref}).mappings().all():
        situ[str(row["collaborateur_id"])]["categorie_professionnelle"] = row["libelle"]

    for row in db.execute(text("""
        SELECT qc.collaborateur_id, rc.libelle
          FROM (
              SELECT collaborateur_id,
                     (array_agg(code_college ORDER BY date_evolution DESC, created_at DESC)
                      FILTER (WHERE code_college IS NOT NULL))[1] AS code_college
                FROM public.collaborateur_qualifications
               WHERE collaborateur_id = ANY(CAST(:ids AS uuid[])) AND archive = false AND date_evolution <= :ref
               GROUP BY collaborateur_id
          ) qc
          JOIN public.ref_college rc ON rc.code = qc.code_college
    """), {"ids": ids, "ref": ref}).mappings().all():
        situ[str(row["collaborateur_id"])]["college"] = row["libelle"]

    # Emploi : résolu via ref_poste (l'instance de poste affectée pointe vers
    # un poste "parent" par troncature du suffixe d'instance, ex. "DEV-001"
    # → "DEV" — même résolution que _resoudre_population()/RG-POPULATION-
    # EMPLOI-01), puis ref_poste.code_emploi → ref_emploi.
    for row in db.execute(text("""
        SELECT DISTINCT ON (a.collaborateur_id) a.collaborateur_id, re.code, re.libelle
          FROM public.collaborateur_affectations a
          JOIN public.ref_poste rp ON rp.code = regexp_replace(a.code_poste, '-[^-]*$', '')
          JOIN public.ref_emploi re ON re.code = rp.code_emploi
         WHERE a.collaborateur_id = ANY(CAST(:ids AS uuid[])) AND a.archive = false
           AND (a.date_debut_poste IS NULL OR a.date_debut_poste <= :ref)
           AND (a.date_fin_poste   IS NULL OR a.date_fin_poste   >= :ref)
         ORDER BY a.collaborateur_id, a.date_debut_poste DESC NULLS LAST
    """), {"ids": ids, "ref": ref}).mappings().all():
        situ[str(row["collaborateur_id"])]["code_emploi"] = row["code"]
        situ[str(row["collaborateur_id"])]["libelle_emploi"] = row["libelle"]

    return situ


def _surcharges_apres_job(db: Session, job_id: UUID) -> dict:
    """
    Résout, pour l'affichage "après" de la situation collaborateur (contrat/
    collège/catégorie/emploi) dans la consultation des simulations, les
    surcharges_table des scénarios sélectionnés pour ce job.

    SIMPLIFICATION ASSUMÉE (à valider avec Adil DAIA si besoin d'une
    précision totale) : contrairement au calcul net_avant/net_apres_fusion
    (qui applique le filtrage exact scénario-par-scénario, par collaborateur
    ET par période — population_id, _scenario_applicable_a_periode), cette
    résolution fusionne TOUS les scénarios du job SANS ce filtrage fin : si
    UN scénario du job surcharge un de ces 4 champs, la valeur surchargée
    s'affiche pour TOUT le job. Un scénario restreint à une sous-population
    ou à certaines périodes du job affichera donc "après" y compris pour les
    collaborateurs/périodes qu'il ne concerne pas réellement. Compromis
    délibéré : ces 4 champs sont un résumé de situation, pas un calcul de
    paie — le refaire à l'identique du net/coût (par bulletin) demanderait
    de le stocker à l'exécution du job (colonnes supplémentaires +
    migration), pas seulement à la lecture.
    """
    job = db.execute(text("""
        SELECT scenario_ids FROM public.simulation_population_job WHERE id = :id
    """), {"id": str(job_id)}).mappings().first()
    scenario_ids = job["scenario_ids"] if job else []
    if not scenario_ids:
        return {}
    scenarios = db.execute(text("""
        SELECT id, nom, hypotheses, population_id, date_application
          FROM public.simulation_individuelle WHERE id = ANY(CAST(:ids AS uuid[]))
    """), {"ids": scenario_ids}).mappings().all()
    _, surcharges_table, _ = _fusionner_surcharges_scenarios([dict(s) for s in scenarios])
    return surcharges_table


def _resoudre_situation_apres(db: Session, situ_avant: dict, surcharges_table: dict) -> dict:
    """
    Applique surcharges_table (issu de _surcharges_apres_job) à une situation
    "avant" (issue de _situation_actuelle_collaborateurs) pour produire
    l'équivalent "après" — même valeur qu'avant sur chaque champ non
    surchargé par un scénario du job.
    """
    apres = dict(situ_avant)
    if ("collaborateur_contrats", "code_type_contrat") in surcharges_table:
        code = surcharges_table[("collaborateur_contrats", "code_type_contrat")]
        row = db.execute(text("SELECT libelle FROM public.ref_type_contrat WHERE code = :c"), {"c": code}).mappings().first()
        apres["type_contrat"] = row["libelle"] if row else code
    if ("collaborateur_qualifications", "code_categorie_professionnelle") in surcharges_table:
        code = surcharges_table[("collaborateur_qualifications", "code_categorie_professionnelle")]
        row = db.execute(text("SELECT libelle FROM public.ref_categorie_professionnelle WHERE code = :c"), {"c": code}).mappings().first()
        apres["categorie_professionnelle"] = row["libelle"] if row else code
    if ("collaborateur_qualifications", "code_college") in surcharges_table:
        code = surcharges_table[("collaborateur_qualifications", "code_college")]
        row = db.execute(text("SELECT libelle FROM public.ref_college WHERE code = :c"), {"c": code}).mappings().first()
        apres["college"] = row["libelle"] if row else code
    # ⚠️ PAS "code_emploi" : cette colonne n'existe pas réellement sur
    # collaborateur_affectations (clé virtuelle, voir SECOURS_REFERENTIEL) —
    # la vraie colonne surchargeable est code_poste (l'instance de poste,
    # ex. "DEV-001"), résolue vers son emploi via ref_poste → ref_emploi,
    # exactement comme _situation_actuelle_collaborateurs().
    if ("collaborateur_affectations", "code_poste") in surcharges_table:
        code_poste = surcharges_table[("collaborateur_affectations", "code_poste")]
        row = db.execute(text("""
            SELECT re.code, re.libelle
              FROM public.ref_poste rp
              JOIN public.ref_emploi re ON re.code = rp.code_emploi
             WHERE rp.code = regexp_replace(:cp, '-[^-]*$', '')
        """), {"cp": code_poste}).mappings().first()
        apres["code_emploi"] = row["code"] if row else None
        apres["libelle_emploi"] = row["libelle"] if row else None
    return apres


@router.get("/simulation/population/jobs/{job_id}/bulletins", response_model=ListeBulletinsPopulationResult)
def lister_bulletins_population(
    job_id: UUID,
    groupby: ModeRegroupementBulletins = Query("aucun"),
    unite_libelle: str | None = Query(None, description="Filtre de drill-down après clic sur un groupe UO"),
    periode_id: UUID | None = Query(None, description="Filtre de drill-down après clic sur un groupe période"),
    annee: int | None = Query(None, description="Filtre de drill-down après clic sur un groupe année"),
    mois: int | None = Query(None, description="Filtre de drill-down après clic sur un groupe mois"),
    collaborateur_id: UUID | None = Query(None, description="Filtre de drill-down après clic sur un groupe collaborateur"),
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    """
    Liste (RG-SIM-POPULATION-03) des bulletins simulés d'un job — table
    simulation_population_bulletin (un par collaborateur × période).

    Sans filtre de drill-down ET groupby != "aucun" → renvoie les GROUPES
    agrégés (uo/periode/annee/mois/collaborateur). Avec un filtre (après
    clic sur un groupe), ou groupby="aucun" → renvoie la liste PLATE des
    bulletins individuels correspondants, pour affichage détaillé et clic
    vers le détail des rubriques (GET .../bulletins/{id}).

    "annee" cumule TOUS les mois de cette année civile ; "mois" isole chaque
    couple (année, mois) de la plage (ex. juillet 2026 et juillet 2027
    forment deux groupes distincts, chacun affichant son année) — ne cumule
    JAMAIS un même mois calendaire à travers plusieurs années civiles.
    "periode" isole chaque periode_id précisément : pour un plan de paie
    mensuel c'est équivalent à "mois" (une période = un mois), mais pour un
    plan hebdomadaire/quinzaine, PLUSIEURS périodes distinctes partagent le
    même (année, mois) — periode_mois reste le mois civil de rattachement,
    ce n'est PAS un identifiant de période unique à lui seul. Le libellé et
    l'ordre de ce mode s'appuient donc sur calendrier_paie.numero_periode
    (et son intitulé s'il existe) pour lever l'ambiguïté entre ces
    sous-périodes.
    """
    where = ["job_id = :job_id"]
    params: dict = {"job_id": str(job_id)}
    # RG-SIM-POPULATION-10 (Adil DAIA) : avant_disponible reflète la
    # préférence AFFICHÉE (avec_ecarts), jamais la nécessité technique
    # interne (qui peut avoir forcé le calcul de "avant" pour une autre
    # raison, ex. surcharge Pourcentage — voir _executer_job_population,
    # calculer_avant vs afficher_ecarts). Si l'utilisateur a décoché
    # "Calculer les écarts", net_avant/écarts restent MASQUÉS ici même si
    # "avant" existe réellement en base pour ce job — sinon,
    # COALESCE(SUM(net_avant), 0) fabriquerait un FAUX écart (net_apres - 0)
    # au lieu de "non affiché", pour les cas où net_avant est bien NULL.
    avec_ecarts_job = db.execute(text("""
        SELECT avec_ecarts FROM public.simulation_population_job WHERE id = :id
    """), {"id": str(job_id)}).scalar()
    avant_disponible = bool(avec_ecarts_job)
    if unite_libelle is not None:
        where.append("unite_libelle = :ulib")
        params["ulib"] = unite_libelle
    if periode_id is not None:
        where.append("periode_id = :pid")
        params["pid"] = str(periode_id)
    if annee is not None:
        where.append("periode_annee = :annee")
        params["annee"] = annee
    if mois is not None:
        where.append("periode_mois = :mois")
        params["mois"] = mois
    if collaborateur_id is not None:
        where.append("collaborateur_id = :cid")
        params["cid"] = str(collaborateur_id)
    clause = " AND ".join(where)

    drill_down = unite_libelle is not None or periode_id is not None or annee is not None or mois is not None or collaborateur_id is not None

    if groupby != "aucun" and not drill_down:
        if groupby == "uo":
            group_cols, cle_filtre_expr = "unite_libelle", "COALESCE(unite_libelle, '')"
        elif groupby == "periode":
            group_cols, cle_filtre_expr = "periode_id, periode_annee, periode_mois", "periode_id::text"
        elif groupby == "annee":
            group_cols, cle_filtre_expr = "periode_annee", "periode_annee::text"
        elif groupby == "mois":
            group_cols, cle_filtre_expr = "periode_annee, periode_mois", "periode_annee::text || '-' || periode_mois::text"
        else:  # collaborateur
            group_cols, cle_filtre_expr = "collaborateur_id, matricule, nom, prenom", "collaborateur_id::text"

        # order_cols distinct de group_cols : le tri "naturel" (avant toute
        # action de tri de l'utilisateur côté frontend) doit rester
        # chronologique, au lieu de suivre periode_id (UUID, donc un ordre
        # arbitraire) qui est en tête de group_cols pour "periode". Pour ce
        # mode, l'ordre définitif est de toute façon recalculé en Python
        # plus bas via calendrier_paie.numero_periode (nécessaire pour les
        # plans hebdomadaires/quinzaine où plusieurs périodes partagent le
        # même (année, mois) — periode_annee/periode_mois seuls ne suffisent
        # pas à les départager) ; ce tri SQL n'est qu'une valeur de repli.
        order_cols = "periode_annee, periode_mois, periode_id" if groupby == "periode" else group_cols

        try:
            rows = db.execute(text(f"""
                SELECT {group_cols},
                       COUNT(*) AS nb_bulletins,
                       COUNT(*) FILTER (WHERE a_erreur) AS nb_erreurs,
                       COUNT(*) FILTER (WHERE exclu_projection) AS nb_exclus_projection,
                       COALESCE(SUM(net_avant), 0) AS net_avant,
                       COALESCE(SUM(net_apres_fusion), 0) AS net_apres_fusion,
                       COALESCE(SUM(cout_employeur_avant), 0) AS cout_employeur_avant,
                       COALESCE(SUM(cout_employeur_apres_fusion), 0) AS cout_employeur_apres_fusion,
                       COALESCE(SUM(brut_imposable_avant), 0) AS brut_imposable_avant,
                       COALESCE(SUM(brut_imposable_apres_fusion), 0) AS brut_imposable_apres_fusion,
                       COALESCE(SUM(cot_patronale_avant), 0) AS cot_patronale_avant,
                       COALESCE(SUM(cot_patronale_apres_fusion), 0) AS cot_patronale_apres_fusion
                  FROM public.simulation_population_bulletin
                 WHERE {clause}
                 GROUP BY {group_cols}
                 ORDER BY {order_cols}
            """), params).mappings().all()

            # Pour "periode", periode_annee/periode_mois seuls ne distinguent
            # pas les plans non-mensuels (hebdomadaire, quinzaine, ...) où
            # plusieurs périodes tombent dans le même mois civil — on va
            # chercher numero_periode (et l'intitulé s'il existe) dans
            # calendrier_paie pour lever l'ambiguïté du libellé ET du tri.
            infos_periode: dict = {}
            if groupby == "periode" and rows:
                infos_rows = db.execute(text("""
                    SELECT id, numero_periode, intitule
                      FROM public.calendrier_paie
                     WHERE id = ANY(CAST(:ids AS uuid[]))
                """), {"ids": [str(r["periode_id"]) for r in rows]}).mappings().all()
                infos_periode = {str(i["id"]): i for i in infos_rows}

            # Situation collaborateur (RG demandée par Adil DAIA) : uniquement
            # pertinente en mode "collaborateur" (une ligne = une personne).
            situ_avant_par_collab: dict[str, dict] = {}
            situ_apres_par_collab: dict[str, dict] = {}
            if groupby == "collaborateur" and rows:
                ids_collab = [str(r["collaborateur_id"]) for r in rows]
                situ_avant_par_collab = _situation_actuelle_collaborateurs(db, ids_collab, _date.today())
                surcharges_apres = _surcharges_apres_job(db, job_id)
                situ_apres_par_collab = {
                    cid: _resoudre_situation_apres(db, situ, surcharges_apres)
                    for cid, situ in situ_avant_par_collab.items()
                }

            groupes = []
            for r in rows:
                if groupby == "uo":
                    cle = r["unite_libelle"] or "Sans unité"
                    cle_filtre = r["unite_libelle"] or ""
                elif groupby == "periode":
                    info = infos_periode.get(str(r["periode_id"])) or {}
                    numero_periode = info.get("numero_periode") or 0
                    intitule = info.get("intitule")
                    libelle_mois_annee = f"{_MOIS_LIBELLES_BULLETIN[r['periode_mois']]} {r['periode_annee']}"
                    # Intitulé de calendrier_paie s'il existe (ex. "Semaine
                    # 27") pour distinguer les sous-périodes d'un même mois,
                    # toujours accompagné de l'année pour éviter toute
                    # ambiguïté entre années civiles différentes.
                    cle = f"{intitule} {r['periode_annee']}" if intitule else libelle_mois_annee
                    # Préfixe numérique AAAA+MM+NNNN (numero_periode, 4
                    # chiffres) utilisé par le frontend comme clé de tri
                    # chronologique réelle ; periode_id après "::" reste le
                    # filtre de drill-down.
                    cle_filtre = f"{r['periode_annee']:04d}{r['periode_mois']:02d}{numero_periode:04d}::{r['periode_id']}"
                elif groupby == "annee":
                    cle = str(r["periode_annee"])
                    cle_filtre = str(r["periode_annee"])
                elif groupby == "mois":
                    cle = f"{_MOIS_LIBELLES_BULLETIN[r['periode_mois']]} {r['periode_annee']}"
                    cle_filtre = f"{r['periode_annee']}-{r['periode_mois']}"
                else:
                    cle = f"{r['matricule']} — {r['nom']} {r['prenom']}"
                    cle_filtre = str(r["collaborateur_id"])
                net_avant, net_apres = _dec(r["net_avant"]), _dec(r["net_apres_fusion"])
                cout_avant, cout_apres = _dec(r["cout_employeur_avant"]), _dec(r["cout_employeur_apres_fusion"])
                brut_imp_avant, brut_imp_apres = _dec(r["brut_imposable_avant"]), _dec(r["brut_imposable_apres_fusion"])
                cot_pat_avant, cot_pat_apres = _dec(r["cot_patronale_avant"]), _dec(r["cot_patronale_apres_fusion"])
                groupes.append({
                    "cle": cle, "cle_filtre": cle_filtre,
                    "nb_bulletins": r["nb_bulletins"], "nb_erreurs": r["nb_erreurs"], "nb_exclus_projection": r["nb_exclus_projection"],
                    "net_avant": str(net_avant) if avant_disponible else None, "net_apres_fusion": str(net_apres),
                    "ecart_net_fusion": str(net_apres - net_avant) if avant_disponible else None,
                    "cout_employeur_avant": str(cout_avant) if avant_disponible else None, "cout_employeur_apres_fusion": str(cout_apres),
                    "ecart_cout_employeur_fusion": str(cout_apres - cout_avant) if avant_disponible else None,
                    "brut_imposable_avant": str(brut_imp_avant) if avant_disponible else None, "brut_imposable_apres_fusion": str(brut_imp_apres),
                    "ecart_brut_imposable_fusion": str(brut_imp_apres - brut_imp_avant) if avant_disponible else None,
                    "cot_patronale_avant": str(cot_pat_avant) if avant_disponible else None, "cot_patronale_apres_fusion": str(cot_pat_apres),
                    "ecart_cot_patronale_fusion": str(cot_pat_apres - cot_pat_avant) if avant_disponible else None,
                })
                if groupby == "collaborateur":
                    cid = str(r["collaborateur_id"])
                    sav, sap = situ_avant_par_collab.get(cid, {}), situ_apres_par_collab.get(cid, {})
                    groupes[-1].update({
                        "type_contrat_avant": sav.get("type_contrat"), "type_contrat_apres": sap.get("type_contrat"),
                        "college_avant": sav.get("college"), "college_apres": sap.get("college"),
                        "categorie_professionnelle_avant": sav.get("categorie_professionnelle"),
                        "categorie_professionnelle_apres": sap.get("categorie_professionnelle"),
                        "code_emploi_avant": sav.get("code_emploi"), "libelle_emploi_avant": sav.get("libelle_emploi"),
                        "code_emploi_apres": sap.get("code_emploi"), "libelle_emploi_apres": sap.get("libelle_emploi"),
                    })
            if groupby == "periode":
                groupes.sort(key=lambda g: g["cle_filtre"].split("::")[0])
            return {"mode_regroupement": groupby, "groupes": groupes, "bulletins": None}
        except HTTPException:
            raise
        except Exception as e:
            db.rollback()
            # Erreur réelle remontée (au lieu d'un crash opaque masqué en
            # faux CORS côté navigateur) — même correctif que pour la
            # création de scénario, appliqué ici après un bug non identifié
            # à la lecture seule du code pour groupby=periode/mois.
            raise HTTPException(400, f"Erreur de regroupement ({groupby}) : {e}")

    rows = db.execute(text(f"""
        SELECT id, collaborateur_id, matricule, nom, prenom, unite_libelle,
               periode_id, periode_annee, periode_mois,
               a_erreur, message_erreur, exclu_projection, motif_exclusion,
               net_avant, net_apres_fusion, cout_employeur_avant, cout_employeur_apres_fusion,
               brut_imposable_avant, brut_imposable_apres_fusion, cot_patronale_avant, cot_patronale_apres_fusion
          FROM public.simulation_population_bulletin
         WHERE {clause}
         ORDER BY periode_annee, periode_mois, matricule
         LIMIT 2000
    """), params).mappings().all()

    # Situation collaborateur (RG demandée par Adil DAIA) : un seul
    # aller-retour par dimension pour les collaborateurs DISTINCTS de cette
    # page (pas un par ligne — plusieurs bulletins/lignes partagent souvent
    # le même collaborateur, une ligne par période).
    ids_collab = list({str(r["collaborateur_id"]) for r in rows})
    situ_avant_par_collab = _situation_actuelle_collaborateurs(db, ids_collab, _date.today())
    surcharges_apres = _surcharges_apres_job(db, job_id)
    situ_apres_par_collab = {
        cid: _resoudre_situation_apres(db, situ, surcharges_apres)
        for cid, situ in situ_avant_par_collab.items()
    }

    bulletins = []
    for r in rows:
        net_avant = _dec(r["net_avant"]) if avant_disponible and r["net_avant"] is not None else None
        net_apres = _dec(r["net_apres_fusion"]) if r["net_apres_fusion"] is not None else None
        cout_avant = _dec(r["cout_employeur_avant"]) if avant_disponible and r["cout_employeur_avant"] is not None else None
        cout_apres = _dec(r["cout_employeur_apres_fusion"]) if r["cout_employeur_apres_fusion"] is not None else None
        brut_imp_avant = _dec(r["brut_imposable_avant"]) if avant_disponible and r["brut_imposable_avant"] is not None else None
        brut_imp_apres = _dec(r["brut_imposable_apres_fusion"]) if r["brut_imposable_apres_fusion"] is not None else None
        cot_pat_avant = _dec(r["cot_patronale_avant"]) if avant_disponible and r["cot_patronale_avant"] is not None else None
        cot_pat_apres = _dec(r["cot_patronale_apres_fusion"]) if r["cot_patronale_apres_fusion"] is not None else None
        bulletins.append({
            "id": r["id"], "collaborateur_id": r["collaborateur_id"], "matricule": r["matricule"],
            "nom": r["nom"], "prenom": r["prenom"], "unite_libelle": r["unite_libelle"],
            "periode_id": r["periode_id"], "periode_annee": r["periode_annee"], "periode_mois": r["periode_mois"],
            "a_erreur": r["a_erreur"], "message_erreur": r["message_erreur"],
            "exclu_projection": r["exclu_projection"], "motif_exclusion": r["motif_exclusion"],
            "net_avant": str(net_avant) if net_avant is not None else None,
            "net_apres_fusion": str(net_apres) if net_apres is not None else None,
            "ecart_net_fusion": str(net_apres - net_avant) if net_avant is not None and net_apres is not None else None,
            "cout_employeur_avant": str(cout_avant) if cout_avant is not None else None,
            "cout_employeur_apres_fusion": str(cout_apres) if cout_apres is not None else None,
            "ecart_cout_employeur_fusion": str(cout_apres - cout_avant) if cout_avant is not None and cout_apres is not None else None,
            "brut_imposable_avant": str(brut_imp_avant) if brut_imp_avant is not None else None,
            "brut_imposable_apres_fusion": str(brut_imp_apres) if brut_imp_apres is not None else None,
            "ecart_brut_imposable_fusion": str(brut_imp_apres - brut_imp_avant) if brut_imp_avant is not None and brut_imp_apres is not None else None,
            "cot_patronale_avant": str(cot_pat_avant) if cot_pat_avant is not None else None,
            "cot_patronale_apres_fusion": str(cot_pat_apres) if cot_pat_apres is not None else None,
            "ecart_cot_patronale_fusion": str(cot_pat_apres - cot_pat_avant) if cot_pat_avant is not None and cot_pat_apres is not None else None,
        })
        cid = str(r["collaborateur_id"])
        sav, sap = situ_avant_par_collab.get(cid, {}), situ_apres_par_collab.get(cid, {})
        bulletins[-1].update({
            "type_contrat_avant": sav.get("type_contrat"), "type_contrat_apres": sap.get("type_contrat"),
            "college_avant": sav.get("college"), "college_apres": sap.get("college"),
            "categorie_professionnelle_avant": sav.get("categorie_professionnelle"),
            "categorie_professionnelle_apres": sap.get("categorie_professionnelle"),
            "code_emploi_avant": sav.get("code_emploi"), "libelle_emploi_avant": sav.get("libelle_emploi"),
            "code_emploi_apres": sap.get("code_emploi"), "libelle_emploi_apres": sap.get("libelle_emploi"),
        })
    return {"mode_regroupement": groupby, "groupes": None, "bulletins": bulletins}


@router.get("/simulation/population/bulletins/{bulletin_id}", response_model=BulletinSimuleDetail)
def lire_bulletin_population(
    bulletin_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    """
    Détail complet d'UN bulletin simulé — RG-SIM-POPULATION-04 : les
    rubriques (lignes_avant/lignes_apres_fusion) ne sont PLUS stockées en
    base (voir _traiter_collaborateur_population) — à 100 000 collaborateurs
    × 36 périodes, stocker le détail de chaque bulletin serait ingérable.
    Recalculées ICI, à la demande, uniquement pour le bulletin consulté —
    simuler_bulletin() est déterministe (même collaborateur/période/
    surcharges ⇒ même résultat), donc ce recalcul reproduit exactement ce
    qui avait été utilisé pour les totaux déjà stockés.
    """
    r = db.execute(text("""
        SELECT * FROM public.simulation_population_bulletin WHERE id = :id
    """), {"id": str(bulletin_id)}).mappings().first()
    if not r:
        raise HTTPException(404, "Bulletin simulé introuvable")

    lignes_avant = None
    lignes_apres_fusion = None
    totaux_avant = None
    totaux_apres_fusion = None
    if not r["a_erreur"] and not r["exclu_projection"]:
        avant = simuler_bulletin(db, r["collaborateur_id"], r["periode_id"])
        lignes_avant = avant["lignes"]
        totaux_avant = avant["totaux"]

        job = db.execute(text("""
            SELECT scenario_ids FROM public.simulation_population_job WHERE id = :id
        """), {"id": str(r["job_id"])}).mappings().first()
        scenario_ids = job["scenario_ids"] if job else []
        if scenario_ids:
            scenarios = db.execute(text("""
                SELECT id, nom, hypotheses, population_id, date_application
                  FROM public.simulation_individuelle WHERE id = ANY(CAST(:ids AS uuid[]))
            """), {"ids": scenario_ids}).mappings().all()
            scenarios = [dict(s) for s in scenarios]

            # RG-SIM-SCENARIO-05/06 : même filtrage EXACT que la boucle du job
            # (_traiter_collaborateur_population) — sinon ce détail recalculé
            # en direct pourrait montrer un scénario "appliqué" que le job a
            # en réalité exclu pour ce collaborateur/cette période, en
            # contradiction avec le résumé déjà stocké.
            pinfo = db.execute(text("""
                SELECT annee, mois, date_reference, societe_id FROM public.calendrier_paie WHERE id = :id
            """), {"id": str(r["periode_id"])}).mappings().first()
            scenarios_applicables = scenarios
            if pinfo:
                scenarios_applicables = []
                for s in scenarios:
                    if s.get("population_id"):
                        membres = resoudre_population(db, s["population_id"], pinfo["date_reference"], str(pinfo["societe_id"]))
                        if r["collaborateur_id"] not in membres:
                            continue
                    if not _scenario_applicable_a_periode(s, pinfo["annee"], pinfo["mois"]):
                        continue
                    scenarios_applicables.append(s)

            sr, st_, sg = _fusionner_surcharges_scenarios(scenarios_applicables)
            sr_resolu = _resoudre_pourcentages_rubrique(sr, avant["lignes"])
            apres_fusion = simuler_bulletin(db, r["collaborateur_id"], r["periode_id"], surcharges_rubrique=sr_resolu, surcharges_table=st_, surcharges_regime=sg)
            lignes_apres_fusion = apres_fusion["lignes"]
            totaux_apres_fusion = apres_fusion["totaux"]

    # RG-SIM-POPULATION-10 : le résumé net_avant/écart de ce détail suit la
    # même règle que les vues liste (avant_disponible = avec_ecarts affiché,
    # jamais la nécessité technique interne) — la répartition par rubrique
    # (lignes_avant/totaux_avant ci-dessus) reste, elle, toujours calculée à
    # la demande pour inspection : ce n'est pas un "écart" agrégé, juste le
    # détail d'un calcul tel-quel que l'utilisateur a explicitement demandé
    # en cliquant sur ce bulletin.
    avec_ecarts_job = db.execute(text("""
        SELECT avec_ecarts FROM public.simulation_population_job WHERE id = :id
    """), {"id": str(r["job_id"])}).scalar()
    avant_disponible = bool(avec_ecarts_job)
    net_avant = _dec(r["net_avant"]) if avant_disponible and r["net_avant"] is not None else None
    net_apres = _dec(r["net_apres_fusion"]) if r["net_apres_fusion"] is not None else None
    cout_avant = _dec(r["cout_employeur_avant"]) if avant_disponible and r["cout_employeur_avant"] is not None else None
    cout_apres = _dec(r["cout_employeur_apres_fusion"]) if r["cout_employeur_apres_fusion"] is not None else None
    return {
        "id": r["id"], "collaborateur_id": r["collaborateur_id"], "matricule": r["matricule"],
        "nom": r["nom"], "prenom": r["prenom"], "unite_libelle": r["unite_libelle"],
        "periode_id": r["periode_id"], "periode_annee": r["periode_annee"], "periode_mois": r["periode_mois"],
        "a_erreur": r["a_erreur"], "message_erreur": r["message_erreur"],
        "exclu_projection": r["exclu_projection"], "motif_exclusion": r["motif_exclusion"],
        "net_avant": str(net_avant) if net_avant is not None else None,
        "net_apres_fusion": str(net_apres) if net_apres is not None else None,
        "ecart_net_fusion": str(net_apres - net_avant) if net_avant is not None and net_apres is not None else None,
        "cout_employeur_avant": str(cout_avant) if cout_avant is not None else None,
        "cout_employeur_apres_fusion": str(cout_apres) if cout_apres is not None else None,
        "ecart_cout_employeur_fusion": str(cout_apres - cout_avant) if cout_avant is not None and cout_apres is not None else None,
        "lignes_avant": lignes_avant, "lignes_apres_fusion": lignes_apres_fusion, "par_scenario": r["par_scenario"],
        "totaux_avant": totaux_avant, "totaux_apres_fusion": totaux_apres_fusion,
    }


# ===========================================================================
# Export Excel COMPLET d'un job de simulation par population — RG-SIM-
# POPULATION-05 (Adil DAIA : "au niveau des export il faut me faire l'export
# de l'ensemble des onglets"). Un onglet par vue de l'écran (Résumé, Par UO,
# Par période, Par année, Par mois, Par collaborateur, Liste à plat) —
# construit DIRECTEMENT depuis simulation_population_job/_bulletin en base,
# jamais depuis ce que l'écran a déjà chargé (potentiellement filtré/
# paginé) — endpoint DÉDIÉ, distinct de /simulation/export-excel (générique,
# à un seul onglet, utilisé par les 3 autres modes).
# ===========================================================================
def _feuille_population_resume(ws, resultat: dict, titre: str):
    ws.column_dimensions["A"].width = 32
    ws.column_dimensions["B"].width = 20
    ws["A1"] = titre
    ws["A1"].font = Font(name=_POLICE, bold=True, size=14)
    scenarios_noms = ", ".join(s.get("nom", "") for s in (resultat.get("scenarios") or []))
    pd, pf = resultat.get("periode_debut_libelle", ""), resultat.get("periode_fin_libelle", "")
    plage = pd if pd == pf else f"{pd} → {pf}"
    ws["A2"] = f"{resultat.get('population_nom', '')} — {plage} — scénario(s) : {scenarios_noms}"
    ws["A2"].font = Font(name=_POLICE, italic=True, color="6B7280")

    resume = resultat.get("resume_fusion") or {}
    avant_disponible_resume = resume.get("net_avant") is not None
    ligne = 4
    ws.cell(row=ligne, column=1, value="Résumé — fusion").font = Font(name=_POLICE, bold=True)
    ligne += 1
    for label, valeur in [
        ("Collaborateurs", str(resultat.get("nb_collaborateurs", 0))),
        ("Erreurs", str(resultat.get("nb_erreurs", 0))),
        ("Périodes cumulées", str(resultat.get("nb_periodes", 0))),
        ("Net à payer — avant", _f(resume.get("net_avant")) if avant_disponible_resume else "—"),
        ("Net à payer — après (fusion)", _f(resume.get("net_apres"))),
        ("Écart net à payer (fusion)", _f(resume.get("ecart_net")) if avant_disponible_resume else "—"),
        ("Coût employeur — avant", _f(resume.get("cout_employeur_avant")) if avant_disponible_resume else "—"),
        ("Coût employeur — après (fusion)", _f(resume.get("cout_employeur_apres"))),
        ("Écart coût employeur (fusion)", _f(resume.get("ecart_cout_employeur")) if avant_disponible_resume else "—"),
        ("Total Brut Imposable — avant", _f(resume.get("brut_imposable_avant")) if avant_disponible_resume else "—"),
        ("Total Brut Imposable — après (fusion)", _f(resume.get("brut_imposable_apres"))),
        ("Écart Total Brut Imposable (fusion)", _f(resume.get("ecart_brut_imposable")) if avant_disponible_resume else "—"),
        ("Total Charges Patronales — avant", _f(resume.get("cot_patronale_avant")) if avant_disponible_resume else "—"),
        ("Total Charges Patronales — après (fusion)", _f(resume.get("cot_patronale_apres"))),
        ("Écart Total Charges Patronales (fusion)", _f(resume.get("ecart_cot_patronale")) if avant_disponible_resume else "—"),
    ]:
        c1 = ws.cell(row=ligne, column=1, value=label); c1.font = Font(name=_POLICE); c1.fill = _FOND_KPI
        c2 = ws.cell(row=ligne, column=2, value=valeur)
        if isinstance(valeur, float):
            c2.number_format = _FMT_MONTANT
        c2.font = Font(name=_POLICE, bold=True); c2.fill = _FOND_KPI
        ligne += 1

    ligne += 1
    ws.cell(row=ligne, column=1, value="Résumé — par scénario (chacun isolé)").font = Font(name=_POLICE, bold=True)
    ligne += 1
    _entetes(ws, ligne, ["Scénario", "Net après", "Écart net", "Coût après", "Écart coût"])
    ligne += 1
    for rs in resultat.get("resume_par_scenario") or []:
        ws.cell(row=ligne, column=1, value=rs.get("scenario_nom")).font = Font(name=_POLICE)
        ws.cell(row=ligne, column=2, value=_f(rs.get("net_apres"))).number_format = "#,##0.00"
        c3 = ws.cell(row=ligne, column=3, value=_f(rs.get("ecart_net")) if rs.get("ecart_net") is not None else "—")
        if rs.get("ecart_net") is not None:
            c3.number_format = _FMT_ECART
        ws.cell(row=ligne, column=4, value=_f(rs.get("cout_employeur_apres"))).number_format = "#,##0.00"
        c5 = ws.cell(row=ligne, column=5, value=_f(rs.get("ecart_cout_employeur")) if rs.get("ecart_cout_employeur") is not None else "—")
        if rs.get("ecart_cout_employeur") is not None:
            c5.number_format = _FMT_ECART
        ligne += 1


def _feuille_population_groupe(ws, db: Session, job_id: UUID, group_cols: str, colonne_cle: str, avant_disponible: bool = True):
    """Réplique exactement l'agrégation SQL de lister_bulletins_population() (groupby != 'aucun')."""
    # Même remarque que côté endpoint JSON : pour "Par période", group_cols
    # commence par periode_id (UUID) — trier dessus donnerait un ordre
    # arbitraire dans le classeur Excel, donc on force un ordre chronologique.
    order_cols = "periode_annee, periode_mois, periode_id" if "periode_id" in group_cols else group_cols
    rows = db.execute(text(f"""
        SELECT {group_cols},
               COUNT(*) AS nb_bulletins,
               COUNT(*) FILTER (WHERE a_erreur) AS nb_erreurs,
               COUNT(*) FILTER (WHERE exclu_projection) AS nb_exclus_projection,
               COALESCE(SUM(net_avant), 0) AS net_avant,
               COALESCE(SUM(net_apres_fusion), 0) AS net_apres_fusion,
               COALESCE(SUM(cout_employeur_avant), 0) AS cout_employeur_avant,
               COALESCE(SUM(cout_employeur_apres_fusion), 0) AS cout_employeur_apres_fusion,
               COALESCE(SUM(brut_imposable_avant), 0) AS brut_imposable_avant,
               COALESCE(SUM(brut_imposable_apres_fusion), 0) AS brut_imposable_apres_fusion,
               COALESCE(SUM(cot_patronale_avant), 0) AS cot_patronale_avant,
               COALESCE(SUM(cot_patronale_apres_fusion), 0) AS cot_patronale_apres_fusion
          FROM public.simulation_population_bulletin
         WHERE job_id = :job_id
         GROUP BY {group_cols}
         ORDER BY {order_cols}
    """), {"job_id": str(job_id)}).mappings().all()

    # Même enrichissement que côté endpoint JSON (voir lister_bulletins_population)
    # : pour l'onglet "Par période", periode_annee/periode_mois seuls ne
    # distinguent pas les sous-périodes d'un même mois (hebdomadaire, quinzaine).
    infos_periode: dict = {}
    if "periode_id" in group_cols and rows:
        infos_rows = db.execute(text("""
            SELECT id, numero_periode, intitule
              FROM public.calendrier_paie
             WHERE id = ANY(CAST(:ids AS uuid[]))
        """), {"ids": [str(r["periode_id"]) for r in rows]}).mappings().all()
        infos_periode = {str(i["id"]): i for i in infos_rows}

    _entetes(ws, 1, [
        colonne_cle, "Bulletins", "Erreurs", "Exclus (projection)", "Net avant", "Net après (fusion)", "Écart net", "Écart coût employeur",
        "Brut imposable avant", "Brut imposable après", "Écart brut imposable", "Charges patronales avant", "Charges patronales après", "Écart charges patronales",
    ])
    ws.column_dimensions["A"].width = 28
    for col in "BCDEFGHIJKLMN":
        ws.column_dimensions[col].width = 18
    ligne = 2
    if "periode_id" in group_cols:
        # Tri chronologique fiable (année, mois, numero_periode) — l'ORDER BY
        # SQL ne connaît pas numero_periode, récupéré séparément ci-dessus.
        rows = sorted(rows, key=lambda r: (
            r["periode_annee"], r["periode_mois"],
            (infos_periode.get(str(r["periode_id"])) or {}).get("numero_periode") or 0,
        ))
    for r in rows:
        if "periode_id" in group_cols:
            info = infos_periode.get(str(r["periode_id"])) or {}
            intitule = info.get("intitule")
            cle = f"{intitule} {r['periode_annee']}" if intitule else f"{_MOIS_LIBELLES_BULLETIN[r['periode_mois']]} {r['periode_annee']}"
        elif "periode_mois" in group_cols and "periode_annee" in group_cols:
            cle = f"{_MOIS_LIBELLES_BULLETIN[r['periode_mois']]} {r['periode_annee']}"
        elif "periode_mois" in group_cols:
            cle = _MOIS_LIBELLES_BULLETIN[r["periode_mois"]]
        elif "periode_annee" in group_cols:
            cle = str(r["periode_annee"])
        elif "matricule" in group_cols:
            cle = f"{r['matricule']} — {r['nom']} {r['prenom']}"
        else:
            cle = r.get("unite_libelle") or "Sans unité"
        net_avant, net_apres = _f(r["net_avant"]), _f(r["net_apres_fusion"])
        cout_avant, cout_apres = _f(r["cout_employeur_avant"]), _f(r["cout_employeur_apres_fusion"])
        brut_imp_avant, brut_imp_apres = _f(r["brut_imposable_avant"]), _f(r["brut_imposable_apres_fusion"])
        cot_pat_avant, cot_pat_apres = _f(r["cot_patronale_avant"]), _f(r["cot_patronale_apres_fusion"])
        ws.cell(row=ligne, column=1, value=cle).font = Font(name=_POLICE)
        ws.cell(row=ligne, column=2, value=r["nb_bulletins"]).font = Font(name=_POLICE)
        ws.cell(row=ligne, column=3, value=r["nb_erreurs"]).font = Font(name=_POLICE)
        ws.cell(row=ligne, column=4, value=r["nb_exclus_projection"]).font = Font(name=_POLICE)
        if avant_disponible:
            ws.cell(row=ligne, column=5, value=net_avant).number_format = "#,##0.00"
            ws.cell(row=ligne, column=6, value=net_apres).number_format = "#,##0.00"
            c7 = ws.cell(row=ligne, column=7, value=net_apres - net_avant); c7.number_format = _FMT_ECART
            c8 = ws.cell(row=ligne, column=8, value=cout_apres - cout_avant); c8.number_format = _FMT_ECART
            ws.cell(row=ligne, column=9, value=brut_imp_avant).number_format = "#,##0.00"
            ws.cell(row=ligne, column=10, value=brut_imp_apres).number_format = "#,##0.00"
            c11 = ws.cell(row=ligne, column=11, value=brut_imp_apres - brut_imp_avant); c11.number_format = _FMT_ECART
            ws.cell(row=ligne, column=12, value=cot_pat_avant).number_format = "#,##0.00"
            ws.cell(row=ligne, column=13, value=cot_pat_apres).number_format = "#,##0.00"
            c14 = ws.cell(row=ligne, column=14, value=cot_pat_apres - cot_pat_avant); c14.number_format = _FMT_ECART
        else:
            # RG-SIM-POPULATION-10 : "avant" pas calculé pour ce job (lancé
            # avec avec_ecarts=False) — "—" plutôt qu'un 0 qui laisserait
            # croire à un écart nul au lieu d'une donnée non calculée.
            ws.cell(row=ligne, column=5, value="—")
            ws.cell(row=ligne, column=6, value=net_apres).number_format = "#,##0.00"
            ws.cell(row=ligne, column=7, value="—")
            ws.cell(row=ligne, column=8, value="—")
            ws.cell(row=ligne, column=9, value="—")
            ws.cell(row=ligne, column=10, value=brut_imp_apres).number_format = "#,##0.00"
            ws.cell(row=ligne, column=11, value="—")
            ws.cell(row=ligne, column=12, value="—")
            ws.cell(row=ligne, column=13, value=cot_pat_apres).number_format = "#,##0.00"
            ws.cell(row=ligne, column=14, value="—")
        ligne += 1
    ws.freeze_panes = "A2"


def _feuille_population_detail(ws, db: Session, job_id: UUID):
    """Liste à plat — un bulletin par ligne (collaborateur × période), plafonnée
    à 200 000 lignes (bien au-delà de l'échelle réelle visée — 5000 collaborateurs
    × 36 périodes max = 180 000)."""
    rows = db.execute(text("""
        SELECT matricule, nom, prenom, unite_libelle, periode_annee, periode_mois,
               a_erreur, message_erreur, exclu_projection, motif_exclusion,
               net_avant, net_apres_fusion, cout_employeur_avant, cout_employeur_apres_fusion,
               brut_imposable_avant, brut_imposable_apres_fusion, cot_patronale_avant, cot_patronale_apres_fusion
          FROM public.simulation_population_bulletin
         WHERE job_id = :job_id
         ORDER BY periode_annee, periode_mois, matricule
         LIMIT 200000
    """), {"job_id": str(job_id)}).mappings().all()

    _entetes(ws, 1, [
        "Matricule", "Nom", "Prénom", "Unité", "Année", "Mois", "Statut",
        "Net avant", "Net après (fusion)", "Écart net", "Coût employeur avant", "Coût employeur après", "Écart coût",
        "Brut imposable avant", "Brut imposable après", "Écart brut imposable",
        "Charges patronales avant", "Charges patronales après", "Écart charges patronales",
    ])
    ws.column_dimensions["A"].width = 12
    ws.column_dimensions["B"].width = 20
    ws.column_dimensions["C"].width = 16
    ws.column_dimensions["D"].width = 24
    for col in "EFGHIJKLMNOPQRS":
        ws.column_dimensions[col].width = 15
    ligne = 2
    for r in rows:
        statut = "Erreur" if r["a_erreur"] else ("Exclu (projection)" if r["exclu_projection"] else "OK")
        ws.cell(row=ligne, column=1, value=r["matricule"]).font = Font(name=_POLICE)
        ws.cell(row=ligne, column=2, value=r["nom"]).font = Font(name=_POLICE)
        ws.cell(row=ligne, column=3, value=r["prenom"]).font = Font(name=_POLICE)
        ws.cell(row=ligne, column=4, value=r["unite_libelle"]).font = Font(name=_POLICE)
        ws.cell(row=ligne, column=5, value=r["periode_annee"]).font = Font(name=_POLICE)
        ws.cell(row=ligne, column=6, value=_MOIS_LIBELLES_BULLETIN[r["periode_mois"]]).font = Font(name=_POLICE)
        c7 = ws.cell(row=ligne, column=7, value=statut)
        if statut != "OK":
            c7.font = Font(name=_POLICE, color="D85A30" if r["a_erreur"] else "BA7517")
        else:
            c7.font = Font(name=_POLICE)
        if r["net_avant"] is not None:
            ws.cell(row=ligne, column=8, value=_f(r["net_avant"])).number_format = "#,##0.00"
            ws.cell(row=ligne, column=9, value=_f(r["net_apres_fusion"])).number_format = "#,##0.00"
            c10 = ws.cell(row=ligne, column=10, value=_f(r["net_apres_fusion"]) - _f(r["net_avant"])); c10.number_format = _FMT_ECART
            ws.cell(row=ligne, column=11, value=_f(r["cout_employeur_avant"])).number_format = "#,##0.00"
            ws.cell(row=ligne, column=12, value=_f(r["cout_employeur_apres_fusion"])).number_format = "#,##0.00"
            c13 = ws.cell(row=ligne, column=13, value=_f(r["cout_employeur_apres_fusion"]) - _f(r["cout_employeur_avant"])); c13.number_format = _FMT_ECART
            ws.cell(row=ligne, column=14, value=_f(r["brut_imposable_avant"])).number_format = "#,##0.00"
            ws.cell(row=ligne, column=15, value=_f(r["brut_imposable_apres_fusion"])).number_format = "#,##0.00"
            c16 = ws.cell(row=ligne, column=16, value=_f(r["brut_imposable_apres_fusion"]) - _f(r["brut_imposable_avant"])); c16.number_format = _FMT_ECART
            ws.cell(row=ligne, column=17, value=_f(r["cot_patronale_avant"])).number_format = "#,##0.00"
            ws.cell(row=ligne, column=18, value=_f(r["cot_patronale_apres_fusion"])).number_format = "#,##0.00"
            c19 = ws.cell(row=ligne, column=19, value=_f(r["cot_patronale_apres_fusion"]) - _f(r["cot_patronale_avant"])); c19.number_format = _FMT_ECART
        ligne += 1
    ws.freeze_panes = "A2"


# Plafond de sécurité (RG-SIM-POPULATION-10, Adil DAIA : "l'ensemble des
# rubriques prises en charge dans le calcul") — cet onglet recalcule CHAQUE
# bulletin EN DIRECT (aucun détail par rubrique n'est jamais stocké, voir
# RG-SIM-POPULATION-04 : des dizaines de Go à l'échelle visée sinon). Un gros
# lancement (dizaines de milliers de bulletins) rendrait cet onglet
# extrêmement lent à générer — plafonné, avec une note claire si dépassé,
# plutôt que de bloquer tout l'export.
_MAX_BULLETINS_FEUILLE_RUBRIQUES = 3000


def _feuille_population_rubriques(ws, db: Session, job_id: UUID) -> bool:
    """Retourne False si le plafond est dépassé (feuille non remplie, note
    laissée à la place) — True sinon."""
    total = db.execute(text(
        "SELECT count(*) FROM public.simulation_population_bulletin WHERE job_id = :id"
    ), {"id": str(job_id)}).scalar()

    _entetes(ws, 1, [
        "Matricule", "Nom", "Prénom", "Année", "Mois", "Code rubrique", "Libellé", "Catégorie",
        "Base", "Nb", "Taux", "Montant (part salariale)", "Montant patronal",
        "Nb cumul", "Montant cumul", "Date", "Observation",
    ])
    for col, w in zip("ABCDEFGHIJKLMNOPQ", [12, 20, 16, 8, 8, 16, 30, 14, 14, 10, 10, 16, 16, 10, 14, 12, 24]):
        ws.column_dimensions[col].width = w

    if total and total > _MAX_BULLETINS_FEUILLE_RUBRIQUES:
        ws.cell(row=2, column=1, value=(
            f"Lancement trop volumineux ({total} bulletins) pour recalculer le détail par rubrique de "
            f"chacun à l'export — plafond fixé à {_MAX_BULLETINS_FEUILLE_RUBRIQUES}. "
            "Consulte le détail bulletin par bulletin depuis l'écran de consultation à la place."
        )).font = Font(name=_POLICE, italic=True, color="BA7517")
        ws.freeze_panes = "A2"
        return False

    rows = db.execute(text("""
        SELECT collaborateur_id, matricule, nom, prenom, periode_id, periode_annee, periode_mois
          FROM public.simulation_population_bulletin
         WHERE job_id = :id AND a_erreur = false AND exclu_projection = false
         ORDER BY periode_annee, periode_mois, matricule
    """), {"id": str(job_id)}).mappings().all()

    job = db.execute(text("SELECT scenario_ids FROM public.simulation_population_job WHERE id = :id"), {"id": str(job_id)}).mappings().first()
    scenario_ids = job["scenario_ids"] if job else []
    scenarios = []
    if scenario_ids:
        scenarios = [dict(s) for s in db.execute(text("""
            SELECT id, nom, hypotheses, population_id, date_application
              FROM public.simulation_individuelle WHERE id = ANY(CAST(:ids AS uuid[]))
        """), {"ids": scenario_ids}).mappings().all()]

    ligne = 2
    # RG-MULTISOCIETE-07 (migration 057) : société dérivée du job (via ses
    # périodes) -- pas de JWT ici (fonction d'export Excel appelée en
    # interne, pas un endpoint direct).
    societe_id_job = db.execute(text("""
        SELECT cal.societe_id FROM public.simulation_population_job j
        JOIN public.calendrier_paie cal ON cal.id = (j.periode_ids)[1]
        WHERE j.id = :id
    """), {"id": str(job_id)}).scalar()
    # ⚠️ Suppose periode_ids stocké en tableau Postgres natif (uuid[]),
    # indexation 1-based -- cohérent avec l'usage déjà vu ailleurs
    # (population_paie.unite_ids etc.), non re-vérifié spécifiquement ici.
    for r in rows:
        # Filtre population/date d'application PAR bulletin (même logique que
        # le détail live du modal) — jamais un scénario appliqué à tort ici
        # alors qu'il ne l'était pas réellement pour ce collaborateur/période.
        scenarios_applicables = scenarios
        if scenarios:
            pinfo = {"annee": r["periode_annee"], "mois": r["periode_mois"]}
            scenarios_applicables = []
            for s in scenarios:
                if s.get("population_id"):
                    membres = resoudre_population(db, s["population_id"], _date(r["periode_annee"], r["periode_mois"], 1), str(societe_id_job))
                    if r["collaborateur_id"] not in membres:
                        continue
                if not _scenario_applicable_a_periode(s, pinfo["annee"], pinfo["mois"]):
                    continue
                scenarios_applicables.append(s)

        if scenarios_applicables:
            avant = simuler_bulletin(db, r["collaborateur_id"], r["periode_id"])
            sr, st_, sg = _fusionner_surcharges_scenarios(scenarios_applicables)
            sr_resolu = _resoudre_pourcentages_rubrique(sr, avant["lignes"])
            resultat = simuler_bulletin(db, r["collaborateur_id"], r["periode_id"], surcharges_rubrique=sr_resolu, surcharges_table=st_, surcharges_regime=sg)
        else:
            resultat = simuler_bulletin(db, r["collaborateur_id"], r["periode_id"])

        for l in resultat["lignes"]:
            ws.cell(row=ligne, column=1, value=r["matricule"]).font = Font(name=_POLICE)
            ws.cell(row=ligne, column=2, value=r["nom"]).font = Font(name=_POLICE)
            ws.cell(row=ligne, column=3, value=r["prenom"]).font = Font(name=_POLICE)
            ws.cell(row=ligne, column=4, value=r["periode_annee"]).font = Font(name=_POLICE)
            ws.cell(row=ligne, column=5, value=_MOIS_LIBELLES_BULLETIN[r["periode_mois"]]).font = Font(name=_POLICE)
            ws.cell(row=ligne, column=6, value=l["code_rubrique"]).font = Font(name=_POLICE)
            ws.cell(row=ligne, column=7, value=l["libelle"]).font = Font(name=_POLICE)
            if l.get("est_cotisation"):
                categorie = "Cotisation"
            elif l.get("sens") == "GAIN":
                categorie = "Gain"
            elif l.get("sens") == "RETENUE":
                categorie = "Retenue"
            else:
                categorie = "Élément / base"
            ws.cell(row=ligne, column=8, value=categorie).font = Font(name=_POLICE)
            if l.get("base") is not None:
                ws.cell(row=ligne, column=9, value=_f(l["base"])).number_format = "#,##0.00"
            if l.get("nombre") is not None:
                ws.cell(row=ligne, column=10, value=_f(l["nombre"])).number_format = "#,##0.00"
            if l.get("taux") is not None:
                ws.cell(row=ligne, column=11, value=_f(l["taux"])).number_format = "#,##0.00"
            ws.cell(row=ligne, column=12, value=_f(l["montant"])).number_format = "#,##0.00"
            if l.get("montant_patronal") is not None:
                ws.cell(row=ligne, column=13, value=_f(l["montant_patronal"])).number_format = "#,##0.00"
            if l.get("nombre_cumul") is not None:
                ws.cell(row=ligne, column=14, value=_f(l["nombre_cumul"])).number_format = "#,##0.00"
            if l.get("montant_cumul") is not None:
                ws.cell(row=ligne, column=15, value=_f(l["montant_cumul"])).number_format = "#,##0.00"
            ws.cell(row=ligne, column=16, value=l.get("date_valeur")).font = Font(name=_POLICE)
            obs = l.get("observation") or l.get("texte")
            if obs:
                ws.cell(row=ligne, column=17, value=obs).font = Font(name=_POLICE, color="BA7517")
            ligne += 1
    ws.freeze_panes = "A2"
    return True


@router.get("/simulation/population/jobs/{job_id}/export-excel")
def exporter_excel_population_complet(
    job_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    """Export Excel complet d'un job de simulation par population — un onglet
    par vue de l'écran, voir bloc de commentaires ci-dessus."""
    job = db.execute(text("SELECT * FROM public.simulation_population_job WHERE id = :id"), {"id": str(job_id)}).mappings().first()
    if not job:
        raise HTTPException(404, "Lancement introuvable")
    if job["statut"] != "TERMINE" or not job["resultat"]:
        raise HTTPException(400, "Ce lancement n'est pas terminé — rien à exporter")

    resultat = job["resultat"]
    # RG-SIM-POPULATION-10 : avec_ecarts (préférence affichée), pas
    # avant_calcule (nécessité technique interne — peut être True même
    # écarts masqués, ex. surcharge Pourcentage).
    avant_disponible = bool(job["avec_ecarts"])
    try:
        wb = Workbook()
        ws_resume = wb.active
        ws_resume.title = "Résumé"
        _feuille_population_resume(ws_resume, resultat, f"Simulation — {resultat.get('population_nom', '')}")

        _feuille_population_groupe(wb.create_sheet("Par UO"), db, job_id, "unite_libelle", "Unité organisationnelle", avant_disponible)
        _feuille_population_groupe(wb.create_sheet("Par période"), db, job_id, "periode_id, periode_annee, periode_mois", "Période", avant_disponible)
        _feuille_population_groupe(wb.create_sheet("Par année"), db, job_id, "periode_annee", "Année", avant_disponible)
        _feuille_population_groupe(wb.create_sheet("Par mois"), db, job_id, "periode_annee, periode_mois", "Mois", avant_disponible)
        _feuille_population_groupe(wb.create_sheet("Par collaborateur"), db, job_id, "collaborateur_id, matricule, nom, prenom", "Collaborateur", avant_disponible)
        _feuille_population_detail(wb.create_sheet("Liste à plat"), db, job_id)
        _feuille_population_rubriques(wb.create_sheet("Rubriques (détail)"), db, job_id)

        tampon = BytesIO()
        wb.save(tampon)
        tampon.seek(0)
        nom_fichier = re.sub(r"[^\w\-]+", "_", f"Simulation_Population_{resultat.get('population_nom', '')}").strip("_")[:100] or "simulation_population"
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        # Erreur réelle remontée (au lieu d'un crash opaque masqué en faux
        # CORS côté navigateur) — même correctif appliqué aux endpoints
        # précédents ayant présenté le même symptôme.
        raise HTTPException(400, f"Erreur d'export : {type(e).__name__}: {e}")

    return Response(
        content=tampon.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{nom_fichier}.xlsx"'},
    )


@router.post("/simulation/scenarios", response_model=ScenarioSimulationRead, status_code=201)
def creer_scenario_simulation(
    data: ScenarioSimulationWrite,
    db: Session = Depends(get_db),
    payload=Depends(get_current_user_payload),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    """
    Sauvegarde un scénario (BULLETIN / IMPACT / EMBAUCHE — les 3 cas d'usage
    sont désormais livrés). Pour EMBAUCHE, `hypotheses` doit contenir
    `collaborateur_reference_id` (voir SimulationEmbaucheRequest) et
    `collaborateur_id` doit rester None : le candidat n'a pas encore de
    fiche collaborateur réelle.
    """
    user_id = payload.get("sub") or payload.get("user_id")
    try:
        row = db.execute(text(f"""
            INSERT INTO public.simulation_individuelle
                (type_simulation, nom, created_by, collaborateur_id, population_id, periode_id,
                 periode_reference, hypotheses, resultat_calcule, partage, date_application)
            VALUES (:type_simulation, :nom, :created_by, :collaborateur_id, :population_id, :periode_id,
                    CAST(:periode_reference AS jsonb), CAST(:hypotheses AS jsonb), CAST(:resultat_calcule AS jsonb), :partage, :date_application)
            RETURNING {_COLS_SCENARIO}
        """), {
            "type_simulation": data.type_simulation, "nom": data.nom,
            "created_by": str(user_id),
            "collaborateur_id": str(data.collaborateur_id) if data.collaborateur_id else None,
            "population_id": str(data.population_id) if data.population_id else None,
            "periode_id": str(data.periode_id) if data.periode_id else None,
            "periode_reference": json.dumps(data.periode_reference, default=str),
            "hypotheses": json.dumps(data.hypotheses, default=str),
            "resultat_calcule": json.dumps(data.resultat_calcule, default=str) if data.resultat_calcule else None,
            "partage": data.partage,
            "date_application": data.date_application,
        }).mappings().first()
        db.commit()
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        # RG-SIM-SCENARIO-03 (Adil DAIA) : un scénario orienté population
        # enregistre désormais collaborateur_id=NULL même pour type_simulation
        # BULLETIN (auparavant réservé au type EMBAUCHE) — si une contrainte
        # de base (CHECK/trigger) l'interdisait encore, l'erreur SQL réelle
        # remonte ici au lieu d'un crash opaque (masqué en faux CORS côté
        # navigateur) — message clair pour diagnostiquer sans deviner.
        raise HTTPException(400, f"Impossible d'enregistrer le scénario : {e}")
    return row


@router.get("/simulation/scenarios/{scenario_id}", response_model=ScenarioSimulationRead)
def lire_scenario_simulation(
    scenario_id: UUID,
    db: Session = Depends(get_db),
    payload=Depends(get_current_user_payload),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    user_id = payload.get("sub") or payload.get("user_id")
    row = db.execute(text(f"""
        SELECT {_COLS_SCENARIO} FROM public.simulation_individuelle
         WHERE id = :id AND archive = false AND (created_by = :uid OR partage = true)
    """), {"id": str(scenario_id), "uid": str(user_id)}).mappings().first()
    if not row:
        raise HTTPException(404, "Scénario introuvable")
    return row


@router.patch("/simulation/scenarios/{scenario_id}", response_model=ScenarioSimulationRead)
def modifier_scenario_simulation(
    scenario_id: UUID,
    data: ScenarioSimulationPatch,
    db: Session = Depends(get_db),
    payload=Depends(get_current_user_payload),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    """Seul le créateur peut modifier son scénario (renommer/partager/archiver) —
    un scénario partagé reste en LECTURE pour les autres, jamais en écriture."""
    user_id = payload.get("sub") or payload.get("user_id")
    existant = db.execute(text("""
        SELECT created_by FROM public.simulation_individuelle WHERE id = :id AND archive = false
    """), {"id": str(scenario_id)}).mappings().first()
    if not existant:
        raise HTTPException(404, "Scénario introuvable")
    if str(existant["created_by"]) != str(user_id):
        raise HTTPException(403, "Seul le créateur du scénario peut le modifier")

    champs = data.model_dump(exclude_unset=True)
    if not champs:
        row = db.execute(text(f"SELECT {_COLS_SCENARIO} FROM public.simulation_individuelle WHERE id = :id"),
                         {"id": str(scenario_id)}).mappings().first()
        return row

    # `hypotheses` (jsonb) traité à part : le mécanisme générique ci-dessous
    # passe les valeurs telles quelles (correct pour nom/text, partage/archive
    # booléens) — un dict Python pour une colonne jsonb a besoin d'un
    # json.dumps() explicite + CAST(... AS jsonb), jamais `:param::jsonb`
    # (piège de syntaxe déjà rencontré et documenté — le `::` juste après un
    # paramètre nommé casse le parseur SQLAlchemy). `population_id` (UUID)
    # stringifié explicitement, par cohérence avec le reste du fichier
    # (collaborateur_id/periode_id le sont déjà partout ailleurs), même si
    # psycopg2 gère probablement un objet UUID natif sans broncher.
    params = {**champs, "id": str(scenario_id)}
    sets = []
    for k in champs:
        if k == "hypotheses":
            sets.append("hypotheses = CAST(:hypotheses AS jsonb)")
            params["hypotheses"] = json.dumps(champs["hypotheses"], default=str)
        elif k == "population_id":
            sets.append("population_id = :population_id")
            params["population_id"] = str(champs["population_id"]) if champs["population_id"] else None
        else:
            sets.append(f"{k} = :{k}")
    sets_sql = ", ".join(sets) + ", updated_at = now()"
    row = db.execute(text(f"""
        UPDATE public.simulation_individuelle SET {sets_sql}
         WHERE id = :id RETURNING {_COLS_SCENARIO}
    """), params).mappings().first()
    db.commit()
    return row


@router.delete("/simulation/scenarios/{scenario_id}", status_code=204)
def archiver_scenario_simulation(
    scenario_id: UUID,
    db: Session = Depends(get_db),
    payload=Depends(get_current_user_payload),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    """Archive (jamais de suppression physique — convention déjà en place partout ailleurs)."""
    user_id = payload.get("sub") or payload.get("user_id")
    existant = db.execute(text("""
        SELECT created_by FROM public.simulation_individuelle WHERE id = :id AND archive = false
    """), {"id": str(scenario_id)}).mappings().first()
    if not existant:
        raise HTTPException(404, "Scénario introuvable")
    if str(existant["created_by"]) != str(user_id):
        raise HTTPException(403, "Seul le créateur du scénario peut l'archiver")
    db.execute(text("UPDATE public.simulation_individuelle SET archive = true, updated_at = now() WHERE id = :id"),
              {"id": str(scenario_id)})
    db.commit()


@router.post("/simulation/scenarios/{scenario_id}/dupliquer", response_model=ScenarioSimulationRead, status_code=201)
def dupliquer_scenario_simulation(
    scenario_id: UUID,
    db: Session = Depends(get_db),
    payload=Depends(get_current_user_payload),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    """Duplique un scénario visible (personnel ou partagé) comme nouveau
    scénario PERSONNEL (jamais partagé par défaut) appartenant à l'appelant —
    utile pour comparer plusieurs variantes (ex. UC3 futur : Offre A / Offre B)."""
    user_id = payload.get("sub") or payload.get("user_id")
    src = db.execute(text(f"""
        SELECT {_COLS_SCENARIO} FROM public.simulation_individuelle
         WHERE id = :id AND archive = false AND (created_by = :uid OR partage = true)
    """), {"id": str(scenario_id), "uid": str(user_id)}).mappings().first()
    if not src:
        raise HTTPException(404, "Scénario introuvable")
    row = db.execute(text(f"""
        INSERT INTO public.simulation_individuelle
            (type_simulation, nom, created_by, collaborateur_id, population_id, periode_id,
             periode_reference, hypotheses, resultat_calcule, partage, date_application)
        VALUES (:type_simulation, :nom, :created_by, :collaborateur_id, :population_id, :periode_id,
                CAST(:periode_reference AS jsonb), CAST(:hypotheses AS jsonb), CAST(:resultat_calcule AS jsonb), false, :date_application)
        RETURNING {_COLS_SCENARIO}
    """), {
        "type_simulation": src["type_simulation"], "nom": f"{src['nom']} (copie)",
        "created_by": str(user_id),
        "collaborateur_id": str(src["collaborateur_id"]) if src["collaborateur_id"] else None,
        "population_id": str(src["population_id"]) if src["population_id"] else None,
        "periode_id": str(src["periode_id"]) if src["periode_id"] else None,
        "periode_reference": json.dumps(src["periode_reference"], default=str),
        "hypotheses": json.dumps(src["hypotheses"], default=str),
        "date_application": src["date_application"],
        "resultat_calcule": json.dumps(src["resultat_calcule"], default=str) if src["resultat_calcule"] else None,
    }).mappings().first()
    db.commit()
    return row


# ===========================================================================
# Référentiel Gabarits d'embauche (table simulation_gabarit_embauche — voir
# migration 058_simulation_gabarits_embauche.sql). Lecture ouverte à
# PAIE_ROLES (UC3 en a besoin pour gestionnaire_rh comme gestionnaire_paie),
# écriture réservée à administrateur/gestionnaire_paie — même logique que le
# référentiel Populations plus haut dans ce fichier. Point encore ouvert
# (CONCEPTION_ECRANS_SIMULATION.md §6.2) : à ajuster si le gestionnaire RH
# doit aussi pouvoir administrer ses propres gabarits.
# ===========================================================================
_COLS_GABARIT = """
    id, nom, collaborateur_reference_id, code_poste, plan_paie_id, type_contrat,
    salaire_indicatif_min, salaire_indicatif_max, actif, archive, created_at, updated_at
"""


@router.get("/simulation/gabarits", response_model=list[GabaritEmbaucheRead])
def lister_gabarits_embauche(
    inclure_inactifs: bool = Query(False),
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
):
    where = "archive = false" + ("" if inclure_inactifs else " AND actif = true")
    return db.execute(text(f"""
        SELECT {_COLS_GABARIT} FROM public.simulation_gabarit_embauche
         WHERE {where} ORDER BY nom
    """)).mappings().all()


@router.post("/simulation/gabarits", response_model=GabaritEmbaucheRead, status_code=201)
def creer_gabarit_embauche(
    data: GabaritEmbaucheWrite,
    db: Session = Depends(get_db),
    _=Depends(require_roles("administrateur", "gestionnaire_paie")),
):
    if not db.execute(text("SELECT 1 FROM public.collaborateurs WHERE id = :id"),
                      {"id": str(data.collaborateur_reference_id)}).first():
        raise HTTPException(404, "Collaborateur de référence introuvable")
    row = db.execute(text(f"""
        INSERT INTO public.simulation_gabarit_embauche
            (nom, collaborateur_reference_id, code_poste, plan_paie_id, type_contrat,
             salaire_indicatif_min, salaire_indicatif_max, actif)
        VALUES (:nom, :ref_id, :code_poste, :plan_paie_id, :type_contrat,
                :sal_min, :sal_max, :actif)
        RETURNING {_COLS_GABARIT}
    """), {
        "nom": data.nom, "ref_id": str(data.collaborateur_reference_id),
        "code_poste": data.code_poste,
        "plan_paie_id": str(data.plan_paie_id) if data.plan_paie_id else None,
        "type_contrat": data.type_contrat,
        "sal_min": data.salaire_indicatif_min, "sal_max": data.salaire_indicatif_max,
        "actif": data.actif,
    }).mappings().first()
    db.commit()
    return row


@router.patch("/simulation/gabarits/{gabarit_id}", response_model=GabaritEmbaucheRead)
def modifier_gabarit_embauche(
    gabarit_id: UUID,
    data: GabaritEmbauchePatch,
    db: Session = Depends(get_db),
    _=Depends(require_roles("administrateur", "gestionnaire_paie")),
):
    if not db.execute(text("SELECT 1 FROM public.simulation_gabarit_embauche WHERE id = :id AND archive = false"),
                      {"id": str(gabarit_id)}).first():
        raise HTTPException(404, "Gabarit introuvable")
    champs = data.model_dump(exclude_unset=True)
    if "collaborateur_reference_id" in champs and champs["collaborateur_reference_id"]:
        if not db.execute(text("SELECT 1 FROM public.collaborateurs WHERE id = :id"),
                          {"id": str(champs["collaborateur_reference_id"])}).first():
            raise HTTPException(404, "Collaborateur de référence introuvable")
        champs["collaborateur_reference_id"] = str(champs["collaborateur_reference_id"])
    if "plan_paie_id" in champs and champs["plan_paie_id"]:
        champs["plan_paie_id"] = str(champs["plan_paie_id"])
    if not champs:
        return db.execute(text(f"SELECT {_COLS_GABARIT} FROM public.simulation_gabarit_embauche WHERE id = :id"),
                          {"id": str(gabarit_id)}).mappings().first()
    sets = ", ".join(f"{k} = :{k}" for k in champs) + ", updated_at = now()"
    row = db.execute(text(f"""
        UPDATE public.simulation_gabarit_embauche SET {sets}
         WHERE id = :id RETURNING {_COLS_GABARIT}
    """), {**champs, "id": str(gabarit_id)}).mappings().first()
    db.commit()
    return row


@router.delete("/simulation/gabarits/{gabarit_id}", status_code=204)
def archiver_gabarit_embauche(
    gabarit_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_roles("administrateur", "gestionnaire_paie")),
):
    if not db.execute(text("""
        UPDATE public.simulation_gabarit_embauche SET archive = true, actif = false, updated_at = now()
         WHERE id = :id AND archive = false RETURNING id
    """), {"id": str(gabarit_id)}).first():
        raise HTTPException(404, "Gabarit introuvable")
    db.commit()


@router.get("/bulletins", response_model=list[BulletinRead])
def lister_bulletins(
    periode_id: UUID | None = Query(None),
    collaborateur_id: UUID | None = Query(None),
    collaborateur_ids: list[UUID] | None = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
    societe_id: str = Depends(get_societe_active_id),
):
    return _lire_bulletins(db, periode_id=periode_id, collaborateur_id=collaborateur_id,
                           collaborateur_ids=collaborateur_ids, societe_id=societe_id)


@router.get("/bulletins/recherche", response_model=dict)
def rechercher_bulletins(
    plan_paie_id: list[UUID] = Query(...),
    annee: int = Query(...),
    q: str | None = Query(None, description="Recherche libre : matricule, nom ou prénom."),
    statut: list[str] = Query(default=[]),
    origine: list[str] = Query(default=[], description="VALIDE / HISTORIQUE / TEMP."),
    seulement_avec_probleme: bool = Query(False, description="Ne montrer que les bulletins en erreur ou avec des messages."),
    officiel: bool = Query(False),
    unite_id: list[UUID] = Query(default=[], description="Filtre par UO (hiérarchie incluse)."),
    type_contrat: list[str] = Query(default=[], description="Filtre par type de contrat."),
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db), _=Depends(require_roles(*PAIE_ROLES)),
    societe_id: str = Depends(get_societe_active_id),
):
    """
    Recherche transverse de bulletins (tous collaborateurs confondus) pour un
    ou plusieurs plans sur une année : texte libre, statut, origine,
    organisation/contrat, et bulletins en anomalie uniquement.

    Complète HistoriqueCollaborateurPage (carnet par collaborateur) avec une
    vue "recherche / audit" côté gestionnaire — et sert aussi de base à
    l'écran Anomalies (même endpoint, `seulement_avec_probleme=true`).
    """
    plan_ids = [str(p) for p in plan_paie_id]
    inlist = ", ".join(f":p{i}" for i in range(len(plan_ids)))
    params: dict = {f"p{i}": pid for i, pid in enumerate(plan_ids)}
    params["annee"] = annee
    params["q"] = f"%{q.strip()}%" if q and q.strip() else None
    params["statuts"] = list(statut) or None
    params["origines"] = list(origine) or None
    params["unite_ids"] = [str(x) for x in unite_id] or None
    params["types_contrat"] = list(type_contrat) or None
    params["societe_id"] = societe_id
    filtre_b = _sql_filtre_pop("b.collaborateur_id", "cal.date_reference")

    where_commun = f"""
        WHERE cal.plan_paie_id IN ({inlist}) AND cal.annee = :annee AND cal.societe_id = :societe_id
          AND (:q IS NULL OR b.matricule ILIKE :q OR col.nom ILIKE :q OR col.prenom ILIKE :q)
          AND (CAST(:statuts AS text[]) IS NULL OR b.statut = ANY(CAST(:statuts AS text[])))
          AND (CAST(:origines AS text[]) IS NULL OR b.origine = ANY(CAST(:origines AS text[])))
          {"AND (b.a_erreur = true OR COALESCE(jsonb_array_length(b.messages), 0) > 0)" if seulement_avec_probleme else ""}
          {filtre_b}
    """

    total = db.execute(text(f"""
        SELECT count(*)
          FROM {_sql_bulletins_tous_origine(officiel=officiel)} b
          JOIN public.calendrier_paie cal ON cal.id = b.periode_id
          LEFT JOIN public.collaborateurs col ON col.id = b.collaborateur_id
        {where_commun}
    """), params).scalar() or 0

    lignes = db.execute(text(f"""
        SELECT b.id, b.origine, b.statut, b.matricule, col.nom, col.prenom,
               b.code_plan AS plan_code, cal.mois, cal.annee AS periode_annee,
               cal.intitule, b.net_a_payer, b.cout_employeur, b.a_erreur,
               COALESCE(jsonb_array_length(b.messages), 0) AS nb_messages, b.messages
          FROM {_sql_bulletins_tous_origine(officiel=officiel)} b
          JOIN public.calendrier_paie cal ON cal.id = b.periode_id
          LEFT JOIN public.collaborateurs col ON col.id = b.collaborateur_id
        {where_commun}
         ORDER BY cal.mois DESC, col.nom NULLS LAST, col.prenom NULLS LAST
         LIMIT :limit OFFSET :offset
    """), {**params, "limit": limit, "offset": offset}).mappings().all()

    return {"lignes": [dict(l) for l in lignes], "total": total}


@router.get("/bulletins/{bulletin_id}", response_model=BulletinRead)
def lire_bulletin(
    bulletin_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_roles(*PAIE_ROLES)),
    societe_id: str = Depends(get_societe_active_id),
):
    trouve = _lire_bulletins(db, bulletin_id=bulletin_id, societe_id=societe_id)
    bul = trouve[0] if trouve else None
    if not bul:
        raise HTTPException(404, "Bulletin introuvable")
    return bul


@router.delete("/bulletins/{bulletin_id}", status_code=204)
def supprimer_bulletin(
    bulletin_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_roles("administrateur", "gestionnaire_paie")),
):
    # Seul un PRÉCALCUL est supprimable : un bulletin validé sert de base aux
    # échanges, un bulletin clôturé est une archive.
    origine, bul = _localiser_bulletin(db, bulletin_id)
    if origine != "TEMP":
        raise HTTPException(
            400,
            "Un bulletin validé ne peut pas être supprimé : dévalidez-le d'abord."
            if origine == "VALIDE" else
            "Un bulletin clôturé est une archive : rouvrez la période pour le modifier.",
        )
    db.delete(bul)
    db.commit()


# ============================ Validation & historique =====================
def _historiser(db: Session, bul: Bulletin | BulletinTemp | BulletinHistorique,
                action: str, avant: str, apres: str,
                rapport: dict | None, decision: str | None, commentaire: str | None,
                user_id):
    db.add(PaieHistorique(
        periode_id=bul.periode_id, bulletin_id=bul.id, collaborateur_id=bul.collaborateur_id,
        action=action, statut_avant=avant, statut_apres=apres,
        rapport=rapport, decision=decision, commentaire=commentaire, utilisateur_id=user_id,
    ))


@router.post("/bulletins/{bulletin_id}/controler", response_model=RapportControle)
def controler(bulletin_id: UUID, db: Session = Depends(get_db),
              payload=Depends(get_current_user_payload),
              _=Depends(require_roles(*PAIE_ROLES))):
    """Aperçu des contrôles (sans rien valider)."""
    return controler_bulletin(db, bulletin_id, list(roles_from_payload(payload)))


@router.post("/bulletins/{bulletin_id}/valider", response_model=ValidationResult)
def valider(bulletin_id: UUID, req: ValiderRequest = ValiderRequest(),
            db: Session = Depends(get_db),
            payload=Depends(get_current_user_payload),
            _=Depends(require_roles("administrateur", "gestionnaire_paie"))):
    """
    Valide le bulletin après contrôles :
      • un contrôle BLOQUANT en échec → validation refusée (non validé) ;
      • des ALERTES en échec → confirmation requise (forcer_alertes=true pour passer outre) ;
      • sinon → validation.
    """
    bul = db.query(BulletinTemp).filter(BulletinTemp.id == bulletin_id).first()
    if not bul:
        # Déjà validé ? on le signale plutôt que « introuvable ».
        if db.query(Bulletin).filter(Bulletin.id == bulletin_id).first():
            raise HTTPException(400, "Ce bulletin est déjà validé")
        raise HTTPException(404, "Bulletin introuvable")

    user_id = payload.get("sub") or payload.get("user_id")
    rapport = controler_bulletin(db, bulletin_id, list(roles_from_payload(payload)))

    if rapport["bloquants_ko"] > 0:
        return {"valide": False, "confirmation_requise": False, "statut": bul.statut, "rapport": rapport}

    if rapport["alertes_ko"] > 0 and not req.forcer_alertes:
        return {"valide": False, "confirmation_requise": True, "statut": bul.statut, "rapport": rapport}

    avant = bul.statut
    decision = "Validé malgré alertes" if rapport["alertes_ko"] > 0 else "Validé"
    action = "FORCAGE" if rapport["alertes_ko"] > 0 else "VALIDATION"

    # bulletin_temp → bulletin D'ABORD : paie_historique.bulletin_id référence
    # la table `bulletin`, pas `bulletin_temp`. Historiser avant de déplacer
    # met en attente un INSERT ORM dont l'autoflush (déclenché par le premier
    # db.execute() de _deplacer_bulletin) part alors que le bulletin n'existe
    # encore que dans bulletin_temp → ForeignKeyViolation.
    _deplacer_bulletin(db, bulletin_id, "bulletin_temp", "bulletin", "VALIDE",
                       {"valide_par": str(user_id) if user_id else None})
    _historiser(db, bul, action, avant, "VALIDE", rapport, decision, req.commentaire, user_id)
    db.commit()
    return {"valide": True, "confirmation_requise": False, "statut": "VALIDE", "rapport": rapport}


@router.post("/bulletins/{bulletin_id}/devalider", response_model=ValidationResult)
def devalider(bulletin_id: UUID, req: ValiderRequest = ValiderRequest(),
              db: Session = Depends(get_db),
              payload=Depends(get_current_user_payload),
              _=Depends(require_roles("administrateur", "gestionnaire_paie"))):
    """Repasse un bulletin validé en temporaire (CALCULE) et trace l'action."""
    bul = db.query(Bulletin).filter(Bulletin.id == bulletin_id).first()
    if not bul:
        raise HTTPException(404, "Bulletin introuvable ou non validé")

    # RG-BULLETIN-DEVALIDATION-VIREMENT-01 (Adil DAIA) : un virement déjà
    # généré à partir de ce bulletin (table ligne_virement, FK bulletin_id)
    # empêche physiquement le déplacement bulletin → bulletin_temp (le
    # DELETE échoue avec ForeignKeyViolation). Message clair plutôt que
    # laisser planter en 500 — dévalider un bulletin déjà viré rendrait de
    # toute façon le virement obsolète si le recalcul change les montants.
    nb_virements = db.execute(text(
        "SELECT COUNT(*) FROM public.ligne_virement WHERE bulletin_id = :bid"
    ), {"bid": str(bulletin_id)}).scalar()
    if nb_virements:
        raise HTTPException(400, f"Impossible de dévalider : {nb_virements} ligne(s) de virement "
                                  "ont déjà été générées à partir de ce bulletin. Annulez ou supprimez "
                                  "d'abord le virement correspondant.")

    user_id = payload.get("sub") or payload.get("user_id")
    _historiser(db, bul, "DEVALIDATION", "VALIDE", "CALCULE", None, "Dévalidation", req.commentaire, user_id)

    # bulletin → bulletin_temp : le bulletin redevient modifiable / recalculable.
    db.flush()
    _deplacer_bulletin(db, bulletin_id, "bulletin", "bulletin_temp", "CALCULE")
    db.commit()
    rapport = controler_bulletin(db, bulletin_id, list(roles_from_payload(payload)))
    return {"valide": False, "confirmation_requise": False, "statut": "CALCULE", "rapport": rapport}


@router.get("/bulletins/{bulletin_id}/historique", response_model=list[HistoriqueRead])
def historique_bulletin(bulletin_id: UUID, db: Session = Depends(get_db),
                        _=Depends(require_roles(*PAIE_ROLES))):
    return (db.query(PaieHistorique)
            .filter(PaieHistorique.bulletin_id == bulletin_id)
            .order_by(PaieHistorique.created_at.desc()).all())


@router.get("/periodes/{periode_id}/historique", response_model=list[HistoriqueRead])
def historique_periode(periode_id: UUID, db: Session = Depends(get_db),
                       _=Depends(require_roles(*PAIE_ROLES))):
    return (db.query(PaieHistorique)
            .filter(PaieHistorique.periode_id == periode_id)
            .order_by(PaieHistorique.created_at.desc()).all())


# RG-EV-ARCHIVAGE-CLOTURE-01 (Adil DAIA) : archivage/désarchivage des éléments
# variables d'une période, en miroir exact de la clôture/réouverture des
# bulletins. Simple UPDATE ciblé — pas de déplacement de table comme pour les
# bulletins, `archive` suffit à distinguer un EV verrouillé d'un EV actif.
def _archiver_ev_periode(db: Session, periode_id) -> int:
    res = db.execute(text("""
        UPDATE public.element_variable
           SET archive = true, archive_le = now()
         WHERE periode_id = :pid AND archive = false
    """), {"pid": str(periode_id)})
    return res.rowcount or 0


def _desarchiver_ev_periode(db: Session, periode_id) -> int:
    res = db.execute(text("""
        UPDATE public.element_variable
           SET archive = false, archive_le = NULL
         WHERE periode_id = :pid AND archive = true
    """), {"pid": str(periode_id)})
    return res.rowcount or 0


# RG-PRET-CLOTURE-AUTO-01 (Adil DAIA) : prélèvement automatique des échéances
# de prêt à la clôture d'un bulletin. On NE recalcule PAS indépendamment une
# capacité de retenue : on fait confiance au montant réellement calculé par
# le moteur de paie sur la ligne du bulletin (ligne.montant) — c'est cette
# valeur qui sert de "salaire disponible" à prelever_echeance(), qui gère
# lui-même le plafonnement/reliquat si elle est inférieure à l'échéance due.
#
# RG-PRET-CLOTURE-SIGNATURE-01 (Adil DAIA) : prelever_echeance() n'acceptait
# à l'origine que (db, pret_id, salaire_net_disponible, reference_paie,
# operateur, security_level) — ni periode_paie_code/mois_paie/annee_paie
# (jamais implémentés), ni commit. Le TypeError résultant bloquait TOUTE
# clôture de période comportant un prêt à prélever. Deux correctifs dans
# pret_service.py, en plus du retrait des 3 arguments inexistants ici :
#   1. Recherche élargie aux échéances 'forcee' (pas seulement 'planifiee')
#      — sinon une échéance forcée n'était jamais réellement prélevée,
#      silencieusement, malgré le contrôle ci-dessous qui la considère due
#      (RG-PRET-RECUP-STATUT-01).
#   2. Paramètre `commit: bool = True` ajouté — `commit=False` ici pour que
#      le prélèvement fasse partie de la transaction de clôture, committée
#      une seule fois à la fin par l'appelant, plutôt que d'être validé
#      indépendamment même si une étape ultérieure de la clôture échoue.
def _prelever_prets_bulletin(db: Session, bulletin: "Bulletin", mois: int, annee: int) -> int:
    prets = db.execute(text("""
        SELECT id, rubrique_paie_code FROM public.prets
         WHERE collaborateur_id = :cid AND imputable_paie = true AND pret_suspendu = false
           AND rubrique_paie_code IS NOT NULL
    """), {"cid": str(bulletin.collaborateur_id)}).mappings().all()
    if not prets:
        return 0
    rub_vers_pret = {p["rubrique_paie_code"]: p["id"] for p in prets}
    periode_code = f"{mois:02d}/{annee}"
    n = 0
    for ligne in bulletin.lignes:
        pret_id = rub_vers_pret.get(ligne.code_rubrique)
        if not pret_id or not ligne.montant or float(ligne.montant) <= 0:
            continue
        # RG-PRET-RECUP-STATUT-01 (Adil DAIA) : une échéance "forcee" reste
        # due au même titre qu'une "planifiee" — sinon elle n'est jamais
        # prélevée automatiquement une fois forcée. prelever_echeance()
        # recherche désormais bien les deux statuts (pret_service.py).
        a_a_traiter = db.execute(text("""
            SELECT 1 FROM public.pret_echeances WHERE pret_id = :pid AND statut IN ('planifiee', 'forcee') LIMIT 1
        """), {"pid": str(pret_id)}).scalar()
        if not a_a_traiter:
            continue
        pret_service.prelever_echeance(
            db, pret_id,
            salaire_net_disponible=Decimal(str(ligne.montant)),
            reference_paie=periode_code,
            operateur="SYSTEME (clôture de paie)",
            security_level=100,
            commit=False,
        )
        n += 1
    return n


# ============================ Clôture de période ==========================
@router.post("/periodes/{periode_id}/cloturer", response_model=dict)
def cloturer_periode(periode_id: UUID, req: ValiderRequest = ValiderRequest(),
                     db: Session = Depends(get_db),
                     payload=Depends(get_current_user_payload),
                     _=Depends(require_roles("administrateur", "gestionnaire_paie")),
                     societe_id: str = Depends(get_societe_active_id)):
    """
    Clôture une période : tous ses bulletins validés passent en CLOTURE et la
    période passe CLOTUREE. Refusé s'il reste des bulletins non validés
    (sauf forcer_alertes=true). Chaque clôture est tracée dans l'historique.
    """
    # RG-MULTISOCIETE-07 (migration 057) : une période ne peut être clôturée
    # que par un utilisateur dont la société active EST la société de la
    # période (calendrier_paie.societe_id NOT NULL) -- 404 plutôt que 403
    # pour ne pas confirmer l'existence d'une période d'une autre société.
    periode = db.execute(text("SELECT id, statut, mois, annee FROM public.calendrier_paie WHERE id = :id AND societe_id = :sid"),
                         {"id": str(periode_id), "sid": societe_id}).mappings().first()
    if not periode:
        raise HTTPException(404, "Période introuvable")
    if periode["statut"] == "CLOTUREE":
        raise HTTPException(400, "Période déjà clôturée")

    # Seuls les bulletins VALIDÉS sont clôturables ; un précalcul restant est bloquant.
    en_cours = db.query(BulletinTemp).filter(BulletinTemp.periode_id == periode_id).count()
    if en_cours:
        raise HTTPException(400, f"{en_cours} bulletin(s) non validé(s) : clôture impossible.")
    bulletins = db.query(Bulletin).filter(Bulletin.periode_id == periode_id).all()
    if en_cours and not req.forcer_alertes:
        return {"cloturee": False, "confirmation_requise": True,
                "nb_bulletins": len(bulletins), "nb_non_valides": en_cours,
                "message": f"{en_cours} bulletin(s) non validé(s) restent en précalcul."}

    user_id = payload.get("sub") or payload.get("user_id")
    n = 0
    n_prets = 0
    for b in list(bulletins):
        bid = b.id
        n_prets += _prelever_prets_bulletin(db, b, periode["mois"], periode["annee"])
        _historiser(db, b, "CLOTURE", "VALIDE", "CLOTURE", None, "Clôture de période", req.commentaire, user_id)
        db.flush()
        # bulletin → COPIE dans bulletin_historique ; le bulletin reste dans
        # `bulletin` (statut CLOTURE) jusqu'à la clôture annuelle (RG-BULLETIN-COPIE-PERIODE-01)
        _copier_bulletin(db, bid, "bulletin", "bulletin_historique", "CLOTURE",
                         {"cloture_par": str(user_id) if user_id else None})
        n += 1
    db.execute(text("UPDATE public.calendrier_paie SET statut = 'CLOTUREE' WHERE id = :id"),
               {"id": str(periode_id)})
    n_ev = _archiver_ev_periode(db, periode_id)
    db.add(PaieHistorique(periode_id=periode_id, action="CLOTURE",
                          statut_avant=periode["statut"], statut_apres="CLOTUREE",
                          decision=f"{n} bulletin(s) clôturé(s), {n_ev} élément(s) variable(s) archivé(s), {n_prets} échéance(s) de prêt prélevée(s)", commentaire=req.commentaire,
                          utilisateur_id=user_id))
    db.commit()
    return {"cloturee": True, "confirmation_requise": False,
            "nb_bulletins": len(bulletins), "nb_cloturees": n, "nb_ev_archives": n_ev, "nb_prets_preleves": n_prets}


@router.post("/periodes/{periode_id}/rouvrir", response_model=dict)
def rouvrir_periode(periode_id: UUID, req: ValiderRequest = ValiderRequest(),
                    db: Session = Depends(get_db),
                    payload=Depends(get_current_user_payload),
                    _=Depends(require_roles("administrateur", "gestionnaire_paie")),
                    societe_id: str = Depends(get_societe_active_id)):
    """Réouvre une période clôturée : les bulletins CLOTURE repassent VALIDE."""
    # RG-MULTISOCIETE-07 : même borne société qu'à la clôture.
    periode = db.execute(text("SELECT id, statut FROM public.calendrier_paie WHERE id = :id AND societe_id = :sid"),
                         {"id": str(periode_id), "sid": societe_id}).mappings().first()
    if not periode:
        raise HTTPException(404, "Période introuvable")
    if periode["statut"] != "CLOTUREE":
        raise HTTPException(400, "La période n'est pas clôturée")

    user_id = payload.get("sub") or payload.get("user_id")
    # RG-BULLETIN-COPIE-PERIODE-01 : le bulletin n'a jamais quitté `bulletin`
    # à la clôture de période (copie seule) — on le retrouve donc ici, pas
    # dans bulletin_historique.
    bulletins = db.query(Bulletin).filter(
        Bulletin.periode_id == periode_id, Bulletin.statut == "CLOTURE").all()
    if not bulletins:
        # Aucun bulletin CLOTURE dans `bulletin` alors que la période est
        # marquée CLOTUREE : signe que la clôture ANNUELLE est déjà passée
        # par là (retrait physique définitif, voir _archiver_definitivement_bulletins).
        # Rouvrir une seule période n'a alors plus de sens — il faut rouvrir
        # l'exercice entier (/annees/rouvrir).
        archives = db.query(BulletinHistorique).filter(BulletinHistorique.periode_id == periode_id).count()
        if archives:
            raise HTTPException(400, "Ces bulletins ont été archivés définitivement à la clôture annuelle : "
                                      "rouvrez l'exercice entier plutôt que cette seule période.")
    for b in list(bulletins):
        bid = b.id
        _retirer_copie_bulletin(db, bid, "bulletin_historique")
        db.execute(text("UPDATE public.bulletin SET statut = 'VALIDE' WHERE id = :bid"), {"bid": str(bid)})
        _historiser(db, b, "REOUVERTURE", "CLOTURE", "VALIDE", None, "Réouverture de période", req.commentaire, user_id)
        db.flush()
    db.execute(text("UPDATE public.calendrier_paie SET statut = 'OUVERTE' WHERE id = :id"),
               {"id": str(periode_id)})
    n_ev = _desarchiver_ev_periode(db, periode_id)
    db.add(PaieHistorique(periode_id=periode_id, action="REOUVERTURE",
                          statut_avant="CLOTUREE", statut_apres="OUVERTE",
                          decision=f"{len(bulletins)} bulletin(s) réouvert(s), {n_ev} élément(s) variable(s) désarchivé(s)", commentaire=req.commentaire,
                          utilisateur_id=user_id))
    db.commit()
    return {"reouverte": True, "nb_bulletins": len(bulletins), "nb_ev_desarchives": n_ev}


# ============================ Clôture annuelle ============================
def _cloturer_periode_interne(db: Session, periode_id, statut_periode: str, user_id, commentaire, mois: int, annee: int) -> int:
    """Clôture une période non encore clôturée, dans le cadre d'une clôture
    annuelle (bulletins VALIDE→CLOTURE, copiés dans bulletin_historique,
    période→CLOTUREE). Retourne le nb de bulletins traités. Le retrait
    physique définitif de `bulletin` est fait séparément par
    `_archiver_definitivement_bulletins`, appelée par `cloturer_annee` pour
    CHAQUE période de l'exercice (déjà clôturée individuellement ou non)."""
    n = 0
    n_prets = 0
    for b in list(db.query(Bulletin).filter(Bulletin.periode_id == periode_id).all()):
        bid = b.id
        n_prets += _prelever_prets_bulletin(db, b, mois, annee)
        _historiser(db, b, "CLOTURE", "VALIDE", "CLOTURE", None, "Clôture annuelle", commentaire, user_id)
        db.flush()
        _copier_bulletin(db, bid, "bulletin", "bulletin_historique", "CLOTURE",
                         {"cloture_par": str(user_id) if user_id else None})
        n += 1
    db.execute(text("UPDATE public.calendrier_paie SET statut = 'CLOTUREE' WHERE id = :id"),
               {"id": str(periode_id)})
    n_ev = _archiver_ev_periode(db, periode_id)
    db.add(PaieHistorique(periode_id=periode_id, action="CLOTURE",
                          statut_avant=statut_periode, statut_apres="CLOTUREE",
                          decision=f"{n} bulletin(s) clôturé(s), {n_ev} élément(s) variable(s) archivé(s), {n_prets} échéance(s) de prêt prélevée(s)", commentaire=commentaire,
                          utilisateur_id=user_id))
    return n


@router.get("/annees", response_model=list[AnneePaieRead])
def lister_annees(plan_paie_id: UUID | None = None, db: Session = Depends(get_db),
                  _=Depends(require_roles(*PAIE_ROLES))):
    # NB : AnneePaie n'a pas de societe_id direct dans les fichiers fournis --
    # si plan_paie_id n'est PAS lui-même borné à une société (à vérifier,
    # modèle plan_paie non fourni), cette liste peut remonter des exercices
    # d'autres sociétés que l'active. Filtre non ajouté ici faute de savoir
    # si plan_paie_id est société-scopé -- à trancher avec Adil avant mise en
    # production multi-société réelle (RG-MULTISOCIETE-07, point ouvert).
    q = db.query(AnneePaie)
    if plan_paie_id:
        q = q.filter(AnneePaie.plan_paie_id == plan_paie_id)
    return q.order_by(AnneePaie.annee.desc()).all()


@router.post("/annees/cloturer", response_model=dict)
def cloturer_annee(req: ClotureAnneeRequest, db: Session = Depends(get_db),
                   payload=Depends(get_current_user_payload),
                   _=Depends(require_roles("administrateur", "gestionnaire_paie")),
                   societe_id: str = Depends(get_societe_active_id)):
    """
    Clôture annuelle : verrouille l'exercice. Toutes les périodes du plan/année
    sont clôturées et l'année passe CLOTUREE. Refusé s'il reste des bulletins
    non validés (sauf forcer_alertes=true). La RAZ des cumuls est logique
    (bornage par année + fréquence de RAZ des rubriques) — pas d'effacement.
    """
    # RG-MULTISOCIETE-07 : périodes filtrées à la société active EN PLUS de
    # plan_paie_id/annee -- si un plan_paie_id d'une autre société est passé
    # par erreur (ou malveillance), la liste renvoyée est vide -> 404 plus bas,
    # jamais une clôture d'un exercice hors périmètre.
    periodes = db.execute(text("""
        SELECT id, statut, mois FROM public.calendrier_paie
         WHERE plan_paie_id = :plan AND annee = :annee AND societe_id = :sid ORDER BY mois
    """), {"plan": str(req.plan_paie_id), "annee": req.annee, "sid": societe_id}).mappings().all()
    if not periodes:
        raise HTTPException(404, "Aucune période pour ce plan/année")

    ids = [str(p["id"]) for p in periodes]
    # Non validés = précalculs subsistants sur les périodes de l'année
    non_valides = db.query(BulletinTemp).filter(
        BulletinTemp.periode_id.in_(ids)
    ).count()
    if non_valides > 0 and not req.forcer_alertes:
        return {"cloturee": False, "confirmation_requise": True,
                "nb_periodes": len(periodes), "nb_bulletins_non_valides": non_valides,
                "message": f"{non_valides} bulletin(s) non validé(s) sur l'exercice."}

    user_id = payload.get("sub") or payload.get("user_id")
    n_periodes, n_bulletins, n_archives = 0, 0, 0
    for p in periodes:
        if p["statut"] != "CLOTUREE":
            n_bulletins += _cloturer_periode_interne(db, p["id"], p["statut"], user_id, req.commentaire, p["mois"], req.annee)
            n_periodes += 1
        # RG-BULLETIN-ARCHIVE-ANNUELLE-01 : retrait physique définitif de
        # `bulletin`, que la période ait été clôturée individuellement avant
        # (copie déjà en place dans bulletin_historique) ou à l'instant par
        # _cloturer_periode_interne ci-dessus (copie tout juste créée).
        n_archives += _archiver_definitivement_bulletins(db, p["id"])

    db.execute(text("""
        INSERT INTO public.annee_paie (plan_paie_id, annee, statut, cloture_le, cloture_par, commentaire)
        VALUES (:plan, :annee, 'CLOTUREE', now(), :uid, :com)
        ON CONFLICT (plan_paie_id, annee) DO UPDATE
           SET statut='CLOTUREE', cloture_le=now(), cloture_par=:uid,
               commentaire=:com, updated_at=now()
    """), {"plan": str(req.plan_paie_id), "annee": req.annee,
           "uid": str(user_id) if user_id else None, "com": req.commentaire})
    db.commit()
    return {"cloturee": True, "confirmation_requise": False,
            "nb_periodes_cloturees": n_periodes, "nb_bulletins_clotures": n_bulletins,
            "nb_bulletins_archives": n_archives}


@router.post("/annees/rouvrir", response_model=dict)
def rouvrir_annee(req: ClotureAnneeRequest, db: Session = Depends(get_db),
                  payload=Depends(get_current_user_payload),
                  _=Depends(require_roles("administrateur", "gestionnaire_paie")),
                  societe_id: str = Depends(get_societe_active_id)):
    """Réouvre un exercice clôturé : périodes CLOTUREE→OUVERTE, bulletins CLOTURE→VALIDE."""
    # RG-MULTISOCIETE-07 : même borne société qu'à la clôture (cloturer_annee).
    periodes = db.execute(text("""
        SELECT id FROM public.calendrier_paie WHERE plan_paie_id = :plan AND annee = :annee AND societe_id = :sid
    """), {"plan": str(req.plan_paie_id), "annee": req.annee, "sid": societe_id}).mappings().all()
    if not periodes:
        raise HTTPException(404, "Aucune période pour ce plan/année")
    user_id = payload.get("sub") or payload.get("user_id")
    ids = [str(p["id"]) for p in periodes]
    n = 0
    for b in list(db.query(BulletinHistorique).filter(BulletinHistorique.periode_id.in_(ids)).all()):
        bid = b.id
        # bulletin_historique → bulletin : à ce stade (année clôturée), le
        # bulletin a été physiquement retiré de `bulletin` par
        # _archiver_definitivement_bulletins — il faut le restaurer, contrairement
        # à rouvrir_periode où il n'a jamais quitté `bulletin` (copie seule).
        _deplacer_bulletin(db, bid, "bulletin_historique", "bulletin", "VALIDE")
        _historiser(db, b, "REOUVERTURE", "CLOTURE", "VALIDE", None, "Réouverture annuelle", req.commentaire, user_id)
        db.flush()
        n += 1
    db.execute(text("UPDATE public.calendrier_paie SET statut='OUVERTE' WHERE plan_paie_id=:plan AND annee=:annee AND societe_id=:sid"),
               {"plan": str(req.plan_paie_id), "annee": req.annee, "sid": societe_id})
    n_ev = 0
    for pid in ids:
        n_ev += _desarchiver_ev_periode(db, pid)
    db.execute(text("UPDATE public.annee_paie SET statut='OUVERTE', updated_at=now() WHERE plan_paie_id=:plan AND annee=:annee"),
               {"plan": str(req.plan_paie_id), "annee": req.annee})
    db.commit()
    return {"reouverte": True, "nb_bulletins": n, "nb_ev_desarchives": n_ev}


MOIS_LIBELLES = ["", "Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."]


# ===========================================================================
# Génération des périodes d'un nouvel exercice (RG-CALENDRIER-GENERATION-01,
# proposition — Adil DAIA) : AUCUN mécanisme équivalent n'existait avant
# cette livraison (confirmé explicitement par Adil DAIA).
#
# Approche retenue (suite à la remarque d'Adil DAIA) : NE PLUS deviner la
# structure (numéro de période, drapeaux fin de trimestre/semestre/année,
# décalages de dates) — la COPIER depuis l'exercice existant le plus récent
# de ce même plan de paie. Si ce plan a déjà des années en base, la nouvelle
# année reproduit exactement le même schéma mois par mois :
#   • numero_periode : copié tel quel pour chaque mois (le mois 1 de la
#     nouvelle année reprend le numero_periode du mois 1 de l'année source).
#   • est_fin_mois / est_fin_trimestre / est_fin_semestre / est_fin_annee :
#     copiés tels quels pour chaque mois.
#   • date_debut / date_fin : le JOUR du mois est reproduit à l'identique,
#     sauf si la période source se termine/commence exactement au dernier/
#     premier jour calendaire de son mois — auquel cas ce même calage "fin
#     de mois" est reproduit dans la nouvelle année (gère correctement
#     février 28 vs 29, mois de 30 vs 31 jours).
#   • date_reference : reproduit le même ÉCART (en jours) par rapport à
#     date_fin que dans la période source, plutôt qu'une valeur fixe.
#   • statut = 'OUVERTE', date_ouverture = maintenant — TOUJOURS, quel que
#     soit le statut actuel (probablement CLOTUREE) de la période source :
#     une période nouvellement générée est par définition à son tout début
#     de vie, jamais un état hérité.
#
# Si AUCUNE période n'existe encore pour ce plan (tout premier exercice,
# aucune source à copier) : repli sur un schéma mensuel simple par défaut
# (numero_periode = mois, fins de trimestre en mars/juin/sept/déc, etc.),
# signalé explicitement dans la réponse (`source_annee: null`) pour que
# l'écran puisse avertir l'utilisateur que ce cas n'a pas de précédent à
# reproduire.
# ===========================================================================
class GenererAnneeRequest(BaseModel):
    plan_paie_id: UUID
    annee: int = Field(..., ge=2000, le=2100)
    annee_source: int | None = None  # None = l'exercice existant le plus récent pour ce plan


class PeriodeGeneree(BaseModel):
    id: UUID
    annee: int
    mois: int
    date_debut: _date
    date_fin: _date


class GenererAnneeResult(BaseModel):
    annee: int
    annee_source: int | None  # None = aucun exercice existant, schéma par défaut appliqué
    nb_periodes_creees: int
    periodes: list[PeriodeGeneree]


def _dernier_jour_mois(annee: int, mois: int) -> int:
    return monthrange(annee, mois)[1]


@router.post("/calendrier/generer-annee", response_model=GenererAnneeResult, status_code=201)
def generer_annee_calendrier(
    req: GenererAnneeRequest,
    db: Session = Depends(get_db),
    _=Depends(require_roles("administrateur", "gestionnaire_paie")),
    societe_id: str = Depends(get_societe_active_id),
):
    """Génère les périodes d'un exercice pour un plan de paie, en reproduisant
    la structure exacte de l'exercice existant le plus récent de ce même plan
    (voir le bloc de commentaires juste au-dessus). Refuse si des périodes
    existent déjà pour ce (plan, année) — jamais d'écrasement silencieux.

    RG-MULTISOCIETE-07 (migration 057, URGENT) : calendrier_paie.societe_id
    est NOT NULL -- cet INSERT échouait purement et simplement sans ce patch.
    Les nouvelles périodes sont créées avec la SOCIÉTÉ ACTIVE de la session.
    ⚠️ Hypothèse à valider avec Adil : si `plan_paie` porte lui-même un
    societe_id (modèle non fourni, non vérifié), il faudrait plutôt dériver
    la société du plan que de la session -- et refuser si elles divergent.
    """
    if not db.execute(text("SELECT 1 FROM public.plan_paie WHERE id = :id"), {"id": str(req.plan_paie_id)}).first():
        raise HTTPException(404, "Plan de paie introuvable")

    if db.execute(text("""
        SELECT 1 FROM public.calendrier_paie WHERE plan_paie_id = :plan AND annee = :annee AND societe_id = :sid LIMIT 1
    """), {"plan": str(req.plan_paie_id), "annee": req.annee, "sid": societe_id}).first():
        raise HTTPException(400, f"Des périodes existent déjà pour l'année {req.annee} sur ce plan")

    if req.annee_source is not None:
        annee_source = req.annee_source
    else:
        annee_source = db.execute(text("""
            SELECT MAX(annee) FROM public.calendrier_paie WHERE plan_paie_id = :plan AND societe_id = :sid
        """), {"plan": str(req.plan_paie_id), "sid": societe_id}).scalar()

    source_par_mois: dict[int, dict] = {}
    if annee_source is not None:
        lignes_source = db.execute(text("""
            SELECT mois, numero_periode, date_debut, date_fin, date_reference,
                   est_fin_mois, est_fin_trimestre, est_fin_semestre, est_fin_annee
              FROM public.calendrier_paie
             WHERE plan_paie_id = :plan AND annee = :annee AND societe_id = :sid
             ORDER BY mois
        """), {"plan": str(req.plan_paie_id), "annee": annee_source, "sid": societe_id}).mappings().all()
        source_par_mois = {l["mois"]: dict(l) for l in lignes_source}
        if not source_par_mois:
            annee_source = None  # année demandée explicitement en source, mais introuvable

    periodes = []
    for mois in range(1, 13):
        src = source_par_mois.get(mois)

        if src:
            numero_periode = src["numero_periode"]
            est_fin_mois = src["est_fin_mois"]
            est_fin_trimestre = src["est_fin_trimestre"]
            est_fin_semestre = src["est_fin_semestre"]
            est_fin_annee = src["est_fin_annee"]

            dernier_jour_source = _dernier_jour_mois(annee_source, mois)
            dernier_jour_cible = _dernier_jour_mois(req.annee, mois)
            if src["date_debut"].day == 1:
                date_debut = _date(req.annee, mois, 1)
            else:
                date_debut = _date(req.annee, mois, min(src["date_debut"].day, dernier_jour_cible))
            if src["date_fin"].day == dernier_jour_source:
                date_fin = _date(req.annee, mois, dernier_jour_cible)
            else:
                date_fin = _date(req.annee, mois, min(src["date_fin"].day, dernier_jour_cible))
            # date_reference reproduit le même écart (en jours, positif ou
            # négatif) par rapport à date_fin que dans la période source.
            date_reference = date_fin + (src["date_reference"] - src["date_fin"])
        else:
            # Aucun exercice source (tout premier exercice de ce plan) —
            # repli par défaut, signalé via annee_source=None dans la réponse.
            numero_periode = mois
            est_fin_mois = True
            est_fin_trimestre = mois in (3, 6, 9, 12)
            est_fin_semestre = mois in (6, 12)
            est_fin_annee = mois == 12
            date_debut = _date(req.annee, mois, 1)
            date_fin = _date(req.annee, mois, _dernier_jour_mois(req.annee, mois))
            date_reference = date_fin

        row = db.execute(text("""
            INSERT INTO public.calendrier_paie
                (plan_paie_id, annee, mois, numero_periode, date_debut, date_fin, date_reference,
                 statut, est_fin_mois, est_fin_trimestre, est_fin_semestre, est_fin_annee, date_ouverture,
                 societe_id)
            VALUES (:plan, :annee, :mois, :numero_periode, :date_debut, :date_fin, :date_reference,
                    'OUVERTE', :fin_mois, :fin_trim, :fin_sem, :fin_annee, now(), :societe_id)
            RETURNING id, annee, mois, date_debut, date_fin
        """), {
            "plan": str(req.plan_paie_id), "annee": req.annee, "mois": mois,
            "numero_periode": numero_periode, "date_debut": date_debut, "date_fin": date_fin,
            "date_reference": date_reference,
            "fin_mois": est_fin_mois, "fin_trim": est_fin_trimestre, "fin_sem": est_fin_semestre, "fin_annee": est_fin_annee,
            "societe_id": societe_id,
        }).mappings().first()
        periodes.append(dict(row))

    # Même contrainte ON CONFLICT (plan_paie_id, annee) que /annees/cloturer
    # (confirmée existante par lecture du code, pas une supposition).
    db.execute(text("""
        INSERT INTO public.annee_paie (plan_paie_id, annee, statut)
        VALUES (:plan, :annee, 'OUVERTE')
        ON CONFLICT (plan_paie_id, annee) DO NOTHING
    """), {"plan": str(req.plan_paie_id), "annee": req.annee})
    db.commit()

    return {"annee": req.annee, "annee_source": annee_source, "nb_periodes_creees": len(periodes), "periodes": periodes}


# ============================ Lancement en masse ==========================
def _in(col: str, values: list, prefix: str, params: dict) -> str | None:
    """Construit une clause 'col IN (:p0,:p1,...)' paramétrée, ou None si vide."""
    vals = [v for v in (values or [])]
    if not vals:
        return None
    keys = []
    for i, v in enumerate(vals):
        k = f"{prefix}{i}"
        params[k] = str(v)
        keys.append(f":{k}")
    return f"{col} IN ({', '.join(keys)})"


def _resoudre_population(db: Session, plan_id, ref_date, f: PopulationFiltres, societe_id: str | None = None) -> list[dict]:
    """Collaborateurs rattachés au plan (actif à la date) affinés par les filtres.
    RG-MULTISOCIETE-07 (migration 057) : societe_id optionnel -- si fourni,
    ne remonte que les collaborateurs dont un contrat actif porte cette
    société (même logique que partout ailleurs : contrat = ancre société).
    None (par défaut) préserve le comportement d'avant migration pour les
    rares appelants pas encore mis à jour."""
    params = {"plan": str(plan_id), "ref": ref_date}
    conds = [
        "c.archive = false",
        "cpp.plan_paie_id = :plan AND cpp.archive = false",
        "cpp.date_debut <= :ref AND (cpp.date_fin IS NULL OR cpp.date_fin >= :ref)",
    ]
    if societe_id:
        conds.append("""
            EXISTS (SELECT 1 FROM public.collaborateur_contrats scc
                     WHERE scc.collaborateur_id = c.id AND scc.societe_id = :societe_id_pop AND scc.archive = false)
        """)
        params["societe_id_pop"] = societe_id

    ids = _in("c.id", f.collaborateur_ids, "cid", params)
    if ids:
        conds.append(ids)
    stat = _in("c.statut_collaborateur", f.statuts_collaborateur, "sc", params)
    if stat:
        conds.append(stat)
    nat = _in("c.code_nationalite", f.nationalites, "nat", params)
    if nat:
        conds.append(nat)
    if f.matricule:
        params["matric"] = f"%{f.matricule}%"
        conds.append("c.matricule ILIKE :matric")

    # Affectation valide à la date de référence.
    #
    # Source : `collaborateur_affectations` (unite_id → unites_organisationnelles,
    # code_poste → ref_poste). L'ancienne table `affectations` (organisation_id,
    # poste_id) n'est plus alimentée : elle rendait tout filtre inopérant.
    #
    # L'UO et le poste ont leurs propres périodes de validité dans cette table,
    # d'où deux sous-requêtes distinctes.
    if f.unite_ids:
        # Une UO cochée inclut ses sous-unités (hiérarchie parent_id).
        params["uo"] = [str(x) for x in f.unite_ids]
        conds.append("""
            EXISTS (
                WITH RECURSIVE descendance AS (
                    SELECT id FROM public.unites_organisationnelles WHERE id = ANY(CAST(:uo AS uuid[]))
                    UNION          -- UNION (et non UNION ALL) : termine même si
                                   -- parent_id contenait un cycle par erreur.
                    SELECT u.id FROM public.unites_organisationnelles u
                      JOIN descendance d ON u.parent_id = d.id
                )
                SELECT 1 FROM public.collaborateur_affectations a
                 WHERE a.collaborateur_id = c.id AND a.archive = false
                   AND a.unite_id IN (SELECT id FROM descendance)
                   AND (a.date_debut_uo IS NULL OR a.date_debut_uo <= :ref)
                   AND (a.date_fin_uo   IS NULL OR a.date_fin_uo   >= :ref)
            )""")

    # RG-POPULATION-EMPLOI-01 (Adil DAIA) : même logique que
    # population_paie.py — critère sur l'EMPLOI d'affiliation (via ref_poste,
    # résolution de l'instance vers son poste parent), pas sur l'instance de
    # poste exacte. Renommage terminé (app/schemas/paie_calcul.py reçu,
    # PopulationFiltres.codes_emploi confirmé) — SQL et attribut Python alignés.
    if f.codes_emploi:
        params["pos"] = list(f.codes_emploi)
        conds.append("""
            EXISTS (
                SELECT 1 FROM public.collaborateur_affectations a
                JOIN public.ref_poste rp ON rp.code = regexp_replace(a.code_poste, '-[^-]*$', '')
                 WHERE a.collaborateur_id = c.id AND a.archive = false
                   AND rp.code_emploi = ANY(:pos)
                   AND (a.date_debut_poste IS NULL OR a.date_debut_poste <= :ref)
                   AND (a.date_fin_poste   IS NULL OR a.date_fin_poste   >= :ref)
            )""")

    # Contrat valide à la date (type / temps) — statut retiré
    # (RG-POPULATION-STATUT-01, Adil DAIA : "le statut entre déjà dans le
    # calcul", critère redondant).
    ctr = []
    tc = _in("k.code_type_contrat", f.types_contrat, "tc", params)
    if tc:
        ctr.append(tc)
    tmp = _in("k.code_temps", f.temps, "tmp", params)
    if tmp:
        ctr.append(tmp)
    if ctr:
        conds.append(
            "EXISTS (SELECT 1 FROM public.collaborateur_contrats k WHERE k.collaborateur_id = c.id "
            "AND k.archive = false AND k.date_debut <= :ref AND (k.date_fin IS NULL OR k.date_fin >= :ref) AND "
            + " AND ".join(ctr) + ")")

    # Régime de cotisation
    reg = _in("r.code_regime", f.regimes, "reg", params)
    if reg:
        conds.append(
            "EXISTS (SELECT 1 FROM public.collaborateur_regime r WHERE r.collaborateur_id = c.id "
            "AND r.actif = true AND " + reg + ")")

    sql = ("SELECT DISTINCT c.id, c.matricule, c.nom, c.prenom "
           "FROM public.collaborateurs c "
           "JOIN public.collaborateur_plan_paie cpp ON cpp.collaborateur_id = c.id "
           "WHERE " + " AND ".join(conds) + " ORDER BY c.nom, c.prenom")
    return [dict(r) for r in db.execute(text(sql), params).mappings().all()]


@router.post("/population", response_model=list[CollaborateurCible])
def apercu_population(req: PopulationRequest, db: Session = Depends(get_db),
                     _=Depends(require_roles(*PAIE_ROLES)),
                     societe_id: str = Depends(get_societe_active_id)):
    """Aperçu de la population ciblée (pour compter/valider avant de lancer)."""
    periode = db.execute(text("SELECT date_reference FROM public.calendrier_paie WHERE id = :id AND societe_id = :sid"),
                         {"id": str(req.periode_id), "sid": societe_id}).mappings().first()
    if not periode:
        raise HTTPException(404, "Période introuvable")
    return _resoudre_population(db, req.plan_paie_id, periode["date_reference"], req.filtres, societe_id)


# ── Populations de paie (attribution des rubriques) — RG-POPULATION-RUBRIQUE-01 ──

def _population_vers_dict(pop: dict) -> dict:
    """Aplatit les critères (colonnes de population_paie) sous la clé `criteres`
    attendue par PopulationPaieRead, plutôt que de dupliquer les colonnes."""
    criteres = {
        k: (pop.get(k) or []) for k in
        ("unite_ids", "codes_emploi", "types_contrat",
         "temps", "statuts_collaborateur", "regimes", "nationalites",
         "codes_fonction", "codes_categorie_professionnelle", "codes_college",
         "codes_responsabilite", "codes_niveau", "codes_grade", "codes_echelle",
         "codes_classe", "echelons", "codes_filiere", "codes_activite")
    }
    return {**pop, "criteres": criteres}


@router.get("/populations", response_model=list[PopulationPaieRead])
def lister_populations(inclure_archivees: bool = Query(False),
                       db: Session = Depends(get_db), _=Depends(require_roles(*PAIE_ROLES)),
                       societe_id: str = Depends(get_societe_active_id)):
    # RG-MULTISOCIETE-07 (migration 057) : population_paie.societe_id est
    # désormais NOT NULL -- filtrage strict à la société active, endpoint
    # dédié donc hors périmètre du proxy générique /db/{table}.
    where = "WHERE p.societe_id = :sid" if inclure_archivees else "WHERE p.societe_id = :sid AND archive = false"
    rows = db.execute(text(f"""
        SELECT p.*,
               (SELECT count(*) FROM public.population_paie_rubrique pr
                 WHERE pr.population_id = p.id AND pr.type_attribution = 'ATTRIBUEE') AS nb_rubriques,
               (SELECT count(*) FROM public.population_paie_rubrique pr
                 WHERE pr.population_id = p.id AND pr.type_attribution = 'RETIREE') AS nb_retirees
          FROM public.population_paie p {where}
         ORDER BY p.libelle
    """), {"sid": societe_id}).mappings().all()
    return [_population_vers_dict(dict(r)) for r in rows]


def _criteres_params(criteres: PopulationPaieCriteres) -> dict:
    """Aplatit PopulationPaieCriteres vers les paramètres nommés des requêtes
    INSERT/UPDATE de population_paie — factorisé pour ne pas dupliquer les 18
    champs entre créer_population et modifier_population."""
    return {
        "unite_ids": [str(x) for x in criteres.unite_ids] or None,
        # Clé SQL "codes_emploi" (colonne déjà renommée, migration 071) —
        # renommage terminé (app/schemas/paie_calcul.py reçu,
        # PopulationPaieCriteres.codes_emploi confirmé).
        "codes_emploi": criteres.codes_emploi or None,
        "types_contrat": criteres.types_contrat or None,
        "temps": criteres.temps or None,
        "statuts_collaborateur": criteres.statuts_collaborateur or None,
        "regimes": criteres.regimes or None,
        "nationalites": criteres.nationalites or None,
        # RG-POPULATION-RUBRIQUE-03 (Adil DAIA) : classification
        "codes_fonction": criteres.codes_fonction or None,
        "codes_categorie_professionnelle": criteres.codes_categorie_professionnelle or None,
        "codes_college": criteres.codes_college or None,
        "codes_responsabilite": criteres.codes_responsabilite or None,
        "codes_niveau": criteres.codes_niveau or None,
        "codes_grade": criteres.codes_grade or None,
        "codes_echelle": criteres.codes_echelle or None,
        "codes_classe": criteres.codes_classe or None,
        "echelons": criteres.echelons or None,
        "codes_filiere": criteres.codes_filiere or None,
        "codes_activite": criteres.codes_activite or None,
    }


@router.post("/populations", response_model=PopulationPaieRead, status_code=201)
def creer_population(data: PopulationPaieWrite, db: Session = Depends(get_db),
                    _=Depends(require_roles("administrateur", "gestionnaire_paie")),
                    societe_id: str = Depends(get_societe_active_id)):
    # RG-MULTISOCIETE-07 : unicité du code scopée à la société active (deux
    # sociétés du groupe peuvent vouloir un même code de population, ex.
    # "CADRES") -- comportement différent d'avant migration 057 (code
    # globalement unique), à valider avec Adil si une unicité globale était
    # en réalité voulue.
    if db.execute(text("SELECT 1 FROM public.population_paie WHERE code = :c AND societe_id = :sid"),
                  {"c": data.code, "sid": societe_id}).first():
        raise HTTPException(400, f"Le code « {data.code} » existe déjà pour cette société")
    if data.mode == "SQL":
        pop_service.valider_condition_sql(data.condition_sql or "")
    row = db.execute(text("""
        INSERT INTO public.population_paie
            (code, libelle, mode, unite_ids, codes_emploi, types_contrat,
             temps, statuts_collaborateur, regimes, nationalites, condition_sql, actif,
             codes_fonction, codes_categorie_professionnelle, codes_college, codes_responsabilite,
             codes_niveau, codes_grade, codes_echelle, codes_classe, echelons, codes_filiere, codes_activite,
             societe_id)
        VALUES (:code, :libelle, :mode,
                CAST(:unite_ids AS uuid[]), CAST(:codes_emploi AS text[]), CAST(:types_contrat AS text[]),
                CAST(:temps AS text[]), CAST(:statuts_collaborateur AS text[]),
                CAST(:regimes AS text[]), CAST(:nationalites AS text[]), :condition_sql, :actif,
                CAST(:codes_fonction AS text[]), CAST(:codes_categorie_professionnelle AS text[]),
                CAST(:codes_college AS text[]), CAST(:codes_responsabilite AS text[]),
                CAST(:codes_niveau AS text[]), CAST(:codes_grade AS text[]), CAST(:codes_echelle AS text[]),
                CAST(:codes_classe AS text[]), CAST(:echelons AS text[]), CAST(:codes_filiere AS text[]),
                CAST(:codes_activite AS text[]), :societe_id)
        RETURNING *
    """), {
        "code": data.code, "libelle": data.libelle, "mode": data.mode,
        "condition_sql": data.condition_sql, "actif": data.actif,
        "societe_id": societe_id,
        **_criteres_params(data.criteres),
    }).mappings().first()
    db.commit()
    return _population_vers_dict({**dict(row), "nb_rubriques": 0, "nb_retirees": 0})


@router.patch("/populations/{population_id}", response_model=PopulationPaieRead)
def modifier_population(population_id: UUID, data: PopulationPaieWrite,
                        db: Session = Depends(get_db),
                        _=Depends(require_roles("administrateur", "gestionnaire_paie")),
                        societe_id: str = Depends(get_societe_active_id)):
    # RG-MULTISOCIETE-07 : la vérification d'existence est bornée à la
    # société active -- une population d'une autre société renvoie 404
    # (jamais 403, pour ne pas confirmer son existence à qui n'y a pas accès).
    if not db.execute(text("SELECT 1 FROM public.population_paie WHERE id = :id AND societe_id = :sid"),
                      {"id": str(population_id), "sid": societe_id}).first():
        raise HTTPException(404, "Population introuvable")
    if data.mode == "SQL":
        pop_service.valider_condition_sql(data.condition_sql or "")
    row = db.execute(text("""
        UPDATE public.population_paie SET
            libelle = :libelle, mode = :mode,
            unite_ids = CAST(:unite_ids AS uuid[]), codes_emploi = CAST(:codes_emploi AS text[]),
            types_contrat = CAST(:types_contrat AS text[]),
            temps = CAST(:temps AS text[]),
            statuts_collaborateur = CAST(:statuts_collaborateur AS text[]), regimes = CAST(:regimes AS text[]),
            nationalites = CAST(:nationalites AS text[]), condition_sql = :condition_sql, actif = :actif,
            codes_fonction = CAST(:codes_fonction AS text[]),
            codes_categorie_professionnelle = CAST(:codes_categorie_professionnelle AS text[]),
            codes_college = CAST(:codes_college AS text[]), codes_responsabilite = CAST(:codes_responsabilite AS text[]),
            codes_niveau = CAST(:codes_niveau AS text[]), codes_grade = CAST(:codes_grade AS text[]),
            codes_echelle = CAST(:codes_echelle AS text[]),
            codes_classe = CAST(:codes_classe AS text[]), echelons = CAST(:echelons AS text[]),
            codes_filiere = CAST(:codes_filiere AS text[]),
            codes_activite = CAST(:codes_activite AS text[])
        WHERE id = :id AND societe_id = :sid
        RETURNING *
    """), {
        "id": str(population_id), "libelle": data.libelle, "mode": data.mode,
        "condition_sql": data.condition_sql, "actif": data.actif, "sid": societe_id,
        **_criteres_params(data.criteres),
    }).mappings().first()
    nb = db.execute(text("SELECT count(*) FROM public.population_paie_rubrique WHERE population_id = :id AND type_attribution = 'ATTRIBUEE'"),
                    {"id": str(population_id)}).scalar()
    nb_ret = db.execute(text("SELECT count(*) FROM public.population_paie_rubrique WHERE population_id = :id AND type_attribution = 'RETIREE'"),
                    {"id": str(population_id)}).scalar()
    db.commit()
    return _population_vers_dict({**dict(row), "nb_rubriques": nb, "nb_retirees": nb_ret})


@router.delete("/populations/{population_id}", status_code=204)
def archiver_population(population_id: UUID, db: Session = Depends(get_db),
                        _=Depends(require_roles("administrateur", "gestionnaire_paie")),
                        societe_id: str = Depends(get_societe_active_id)):
    # Archive plutôt que supprime : une rubrique qui référence cette
    # population (population_paie_rubrique) ne doit pas perdre l'historique
    # de ce qui expliquait pourquoi elle a été calculée à une période donnée.
    # RG-MULTISOCIETE-07 : bornée à la société active.
    if not db.execute(text("UPDATE public.population_paie SET actif = false, archive = true WHERE id = :id AND societe_id = :sid RETURNING id"),
                      {"id": str(population_id), "sid": societe_id}).first():
        raise HTTPException(404, "Population introuvable")
    db.commit()


@router.post("/populations/valider-sql", response_model=ConditionSqlValidation)
def valider_condition_sql_endpoint(condition_sql: str = Query(...),
                                   _=Depends(require_roles("administrateur", "gestionnaire_paie"))):
    """Validation syntaxique seule (liste noire de mots-clés) — pas d'exécution,
    donc pas besoin d'un collaborateur réel. Utilisé par l'écran à la frappe."""
    try:
        pop_service.valider_condition_sql(condition_sql)
        return {"ok": True, "erreur": None}
    except HTTPException as e:
        return {"ok": False, "erreur": e.detail}


@router.post("/populations/apercu", response_model=list[CollaborateurCible])
def apercu_population_paie(req: PopulationApercuRequest, limite: int = Query(500, le=2000),
                           db: Session = Depends(get_db), _=Depends(require_roles(*PAIE_ROLES)),
                           societe_id: str = Depends(get_societe_active_id)):
    """
    Aperçu d'une population de paie — enregistrée (population_id) ou ad hoc
    (mode + criteres/condition_sql, avant même de l'enregistrer). Teste TOUS
    les collaborateurs actifs (pas de notion de plan ici, contrairement à
    l'aperçu de lancement en masse) : `rubriques_eligibles` s'applique à
    n'importe quel collaborateur, indépendamment d'un plan de paie précis.
    """
    if req.population_id:
        # RG-MULTISOCIETE-07 : population_paie.societe_id est NOT NULL --
        # borné à la société active, 404 sinon (pas de fuite d'existence).
        pop = db.execute(text("SELECT * FROM public.population_paie WHERE id = :id AND societe_id = :sid"),
                         {"id": str(req.population_id), "sid": societe_id}).mappings().first()
        if not pop:
            raise HTTPException(404, "Population introuvable")
        mode, criteres, condition_sql = pop["mode"], dict(pop), pop["condition_sql"]
    else:
        if not req.mode:
            raise HTTPException(400, "mode requis (CRITERES ou SQL) sans population_id")
        mode = req.mode
        criteres = (req.criteres or PopulationPaieCriteres()).model_dump()
        condition_sql = req.condition_sql
        if mode == "SQL":
            pop_service.valider_condition_sql(condition_sql or "")

    ref = _date.today()
    # RG-MULTISOCIETE-07 : candidats bornés à la société active (auparavant
    # TOUS les collaborateurs actifs, toutes sociétés confondues).
    candidats = db.execute(text("""
        SELECT c.id, c.matricule, c.nom, c.prenom FROM public.collaborateurs c
         WHERE c.archive = false
           AND EXISTS (SELECT 1 FROM public.collaborateur_contrats cc
                        WHERE cc.collaborateur_id = c.id AND cc.societe_id = :sid AND cc.archive = false)
         ORDER BY c.nom, c.prenom LIMIT :lim
    """), {"lim": limite, "sid": societe_id}).mappings().all()

    # RG-POPULATION-APERCU-ENRICHI-01 (Adil DAIA) : UO / catégorie
    # professionnelle / type de contrat courants — un SEUL aller-retour par
    # dimension pour TOUS les candidats (pas une requête par collaborateur,
    # coûteux à l'échelle). Fusionné en Python ensuite.
    # ⚠️ EN ATTENTE de app/schemas/paie_calcul.py pour ajouter ces 3 champs
    # à CollaborateurCible (response_model) — sans ça, FastAPI les retire
    # silencieusement de la réponse même si calculés correctement ici.
    ids_candidats = [str(c["id"]) for c in candidats]
    unites_par_collab: dict[str, str] = {}
    if ids_candidats:
        for row in db.execute(text("""
            SELECT DISTINCT ON (a.collaborateur_id) a.collaborateur_id, u.libelle
              FROM public.collaborateur_affectations a
              JOIN public.unites_organisationnelles u ON u.id = a.unite_id
             WHERE a.collaborateur_id = ANY(CAST(:ids AS uuid[])) AND a.archive = false
               AND (a.date_debut_uo IS NULL OR a.date_debut_uo <= :ref)
               AND (a.date_fin_uo   IS NULL OR a.date_fin_uo   >= :ref)
             ORDER BY a.collaborateur_id, a.date_debut_uo DESC NULLS LAST
        """), {"ids": ids_candidats, "ref": ref}).mappings().all():
            unites_par_collab[str(row["collaborateur_id"])] = row["libelle"]

        types_contrat_par_collab: dict[str, str] = {}
        for row in db.execute(text("""
            SELECT DISTINCT ON (k.collaborateur_id) k.collaborateur_id, rt.libelle
              FROM public.collaborateur_contrats k
              JOIN public.ref_type_contrat rt ON rt.code = k.code_type_contrat
             WHERE k.collaborateur_id = ANY(CAST(:ids AS uuid[])) AND k.archive = false
               AND k.date_debut <= :ref AND (k.date_fin IS NULL OR k.date_fin >= :ref)
             ORDER BY k.collaborateur_id, k.date_debut DESC
        """), {"ids": ids_candidats, "ref": ref}).mappings().all():
            types_contrat_par_collab[str(row["collaborateur_id"])] = row["libelle"]

        # Catégorie professionnelle : reconstruction colonne par colonne
        # (RG-POPULATION-RUBRIQUE-03 déjà en place plus bas dans ce fichier)
        # — jamais "la ligne la plus récente", qui perdrait des colonnes
        # renseignées par un autre motif à la même date_evolution.
        categories_par_collab: dict[str, str] = {}
        for row in db.execute(text("""
            SELECT qc.collaborateur_id, rcp.libelle
              FROM (
                  SELECT collaborateur_id,
                         (array_agg(code_categorie_professionnelle ORDER BY date_evolution DESC, created_at DESC)
                          FILTER (WHERE code_categorie_professionnelle IS NOT NULL))[1] AS code_categorie_professionnelle
                    FROM public.collaborateur_qualifications
                   WHERE collaborateur_id = ANY(CAST(:ids AS uuid[])) AND archive = false AND date_evolution <= :ref
                   GROUP BY collaborateur_id
              ) qc
              JOIN public.ref_categorie_professionnelle rcp ON rcp.code = qc.code_categorie_professionnelle
        """), {"ids": ids_candidats, "ref": ref}).mappings().all():
            categories_par_collab[str(row["collaborateur_id"])] = row["libelle"]

    resultat = []
    for c in candidats:
        ok = (pop_service._tester_condition_sql(db, c["id"], condition_sql) if mode == "SQL"
              else pop_service._collaborateur_correspond_criteres(db, c["id"], ref, criteres))
        if ok:
            cid = str(c["id"])
            resultat.append({
                **dict(c),
                "unite_libelle": unites_par_collab.get(cid),
                "type_contrat": types_contrat_par_collab.get(cid),
                "categorie_professionnelle": categories_par_collab.get(cid),
            })
    return resultat


@router.get("/rubriques/{code}/populations", response_model=list[dict])
def lire_populations_rubrique(code: str, db: Session = Depends(get_db),
                              _=Depends(require_roles(*PAIE_ROLES))):
    """Renvoie {population_id, type_attribution} par ligne (pas juste l'id) —
    l'écran affiche différemment une population qui ATTRIBUE cette rubrique
    de celle qui la RETIRE (RG-POPULATION-RUBRIQUE-04)."""
    return [{"population_id": str(r[0]), "type_attribution": r[1]} for r in db.execute(
        text("SELECT population_id, type_attribution FROM public.population_paie_rubrique WHERE code_rubrique = :c"),
        {"c": code}).all()]


@router.patch("/rubriques/{code}/populations", status_code=204)
def definir_populations_rubrique(code: str, data: RubriquePopulationsWrite,
                                 db: Session = Depends(get_db),
                                 _=Depends(require_roles("administrateur", "gestionnaire_paie"))):
    """Conservé pour usage programmatique, mais plus appelé depuis
    RubriqueForm.tsx (RG-POPULATION-RUBRIQUE-02) — l'écran édite désormais
    depuis la population, via PATCH /populations/{id}/rubriques ci-dessous."""
    if not db.execute(text("SELECT 1 FROM public.rubrique_paie WHERE code = :c"), {"c": code}).first():
        raise HTTPException(404, "Rubrique introuvable")
    db.execute(text("DELETE FROM public.population_paie_rubrique WHERE code_rubrique = :c"), {"c": code})
    for pid in data.population_ids:
        db.execute(text("""
            INSERT INTO public.population_paie_rubrique (population_id, code_rubrique)
            VALUES (:pid, :c) ON CONFLICT DO NOTHING
        """), {"pid": str(pid), "c": code})
    db.commit()


@router.get("/populations/{population_id}/rubriques", response_model=list[LignePopulationRubrique])
def lire_rubriques_population(population_id: UUID, db: Session = Depends(get_db),
                              _=Depends(require_roles(*PAIE_ROLES))):
    if not db.execute(text("SELECT 1 FROM public.population_paie WHERE id = :id"),
                      {"id": str(population_id)}).first():
        raise HTTPException(404, "Population introuvable")
    return [{"code_rubrique": r[0], "type_attribution": r[1]} for r in db.execute(
        text("SELECT code_rubrique, type_attribution FROM public.population_paie_rubrique WHERE population_id = :id ORDER BY code_rubrique"),
        {"id": str(population_id)}).all()]


@router.patch("/populations/{population_id}/rubriques", status_code=204)
def definir_rubriques_population(population_id: UUID, data: PopulationRubriquesWrite,
                                 db: Session = Depends(get_db),
                                 _=Depends(require_roles("administrateur", "gestionnaire_paie"))):
    """Sens d'édition retenu pour l'écran des populations (RG-POPULATION-
    RUBRIQUE-02, Adil DAIA) : remplace intégralement les rubriques attribuées
    à CETTE population, sans toucher à ce que les AUTRES populations
    attribuent à ces mêmes rubriques — pas de risque de retirer par erreur
    une rubrique d'une population gérée par quelqu'un d'autre.

    RG-POPULATION-RUBRIQUE-04 : chaque ligne porte un type ATTRIBUEE/RETIREE
    — voir rubriques_eligibles() (population_paie.py) pour la règle de
    priorité (le retrait prime, quelle que soit l'autre population)."""
    if not db.execute(text("SELECT 1 FROM public.population_paie WHERE id = :id"),
                      {"id": str(population_id)}).first():
        raise HTTPException(404, "Population introuvable")
    db.execute(text("DELETE FROM public.population_paie_rubrique WHERE population_id = :id"),
              {"id": str(population_id)})
    for ligne in data.lignes:
        if not db.execute(text("SELECT 1 FROM public.rubrique_paie WHERE code = :c"), {"c": ligne.code_rubrique}).first():
            raise HTTPException(400, f"Rubrique introuvable : {ligne.code_rubrique}")
        if ligne.type_attribution not in ("ATTRIBUEE", "RETIREE"):
            raise HTTPException(400, f"type_attribution invalide : {ligne.type_attribution}")
        db.execute(text("""
            INSERT INTO public.population_paie_rubrique (population_id, code_rubrique, type_attribution)
            VALUES (:pid, :c, :t) ON CONFLICT (population_id, code_rubrique) DO UPDATE SET type_attribution = :t
        """), {"pid": str(population_id), "c": ligne.code_rubrique, "t": ligne.type_attribution})
    db.commit()


@router.get("/rubriques/{code}/declencheurs", response_model=list[str])
def lire_declencheurs_rubrique(code: str, db: Session = Depends(get_db),
                               _=Depends(require_roles(*PAIE_ROLES))):
    return [r[0] for r in db.execute(
        text("SELECT code_rubrique_declencheur FROM public.rubrique_paie_dependance_acces WHERE code_rubrique = :c"),
        {"c": code}).all()]


@router.patch("/rubriques/{code}/declencheurs", status_code=204)
def definir_declencheurs_rubrique(code: str, data: RubriqueDependanceWrite,
                                  db: Session = Depends(get_db),
                                  _=Depends(require_roles("administrateur", "gestionnaire_paie"))):
    if code in data.codes_declencheurs:
        raise HTTPException(400, "Une rubrique ne peut pas être son propre déclencheur")
    db.execute(text("DELETE FROM public.rubrique_paie_dependance_acces WHERE code_rubrique = :c"), {"c": code})
    for decl in data.codes_declencheurs:
        db.execute(text("""
            INSERT INTO public.rubrique_paie_dependance_acces (code_rubrique, code_rubrique_declencheur)
            VALUES (:c, :d) ON CONFLICT DO NOTHING
        """), {"c": code, "d": decl})
    db.commit()


@router.post("/calcul/lot", response_model=LotCalculResult)
def calculer_lot(req: LotCalculRequest, db: Session = Depends(get_db),
                 _=Depends(require_roles("administrateur", "gestionnaire_paie")),
                 societe_id: str = Depends(get_societe_active_id)):
    """
    Lance le calcul de la paie pour toute la population ciblée (plan + filtres).
    Chaque bulletin est temporaire (statut CALCULE) ; la validation reste une
    étape ultérieure. Retourne un récapitulatif (réussites, erreurs, totaux).
    """
    _exiger_periode_ouverte(db, req.periode_id, societe_id)
    periode = db.execute(text("SELECT date_reference FROM public.calendrier_paie WHERE id = :id AND societe_id = :sid"),
                         {"id": str(req.periode_id), "sid": societe_id}).mappings().first()
    if not periode:
        raise HTTPException(404, "Période introuvable")

    population = _resoudre_population(db, req.plan_paie_id, periode["date_reference"], req.filtres, societe_id)
    resultats, nb_ok, nb_err = [], 0, 0
    total_net, total_cout = Decimal("0"), Decimal("0")
    nb_ignores = 0   # bulletins déjà validés, laissés intacts

    for c in population:
        ligne = {"collaborateur_id": c["id"], "matricule": c.get("matricule"),
                 "nom": f'{c.get("nom") or ""} {c.get("prenom") or ""}'.strip()}
        try:
            res = calculer_bulletin(db, c["id"], req.periode_id)
            if req.persister:
                _persister(db, res, req.periode_id, c["id"], "MASSE")
                # Commit PAR collaborateur : un échec isolé ne doit pas annuler
                # les bulletins déjà persistés (sinon un seul 409 en fin de lot
                # ferait perdre tout le travail précédent).
                db.commit()
            net = Decimal(str(res["totaux"]["net_a_payer"]))
            cout = Decimal(str(res["totaux"]["cout_employeur"]))
            total_net += net
            total_cout += cout
            ligne.update({"net_a_payer": net, "a_erreur": res.get("a_erreur", False),
                          "message": "; ".join(res.get("messages", [])[:2]) or None})
            nb_ok += 1
        except HTTPException as e:
            # Cas métier attendu : bulletin déjà validé (409) → on l'ignore sans échouer.
            db.rollback()
            ligne.update({"a_erreur": e.status_code != 409, "message": e.detail})
            if e.status_code == 409:
                nb_ignores += 1
            else:
                nb_err += 1
        except Exception as e:
            db.rollback()
            ligne.update({"a_erreur": True, "message": str(e)})
            nb_err += 1
        resultats.append(ligne)

    return {"nb_total": len(population), "nb_ok": nb_ok, "nb_erreur": nb_err,
            "nb_ignores": nb_ignores,
            "total_net": total_net, "total_cout": total_cout, "resultats": resultats}


@router.post("/lot/valider", response_model=LotValidationResult)
def valider_lot(req: LotValiderRequest, db: Session = Depends(get_db),
                payload=Depends(get_current_user_payload),
                _=Depends(require_roles("administrateur", "gestionnaire_paie")),
                societe_id: str = Depends(get_societe_active_id)):
    """
    Validation EN MASSE de la paie d'une population (processus : temporaire → validée).
    Pour chaque bulletin CALCULE : applique les contrôles ; un bloquant en échec
    empêche la validation, des alertes demandent confirmation (forcer_alertes),
    sinon le bulletin passe VALIDE et l'action est historisée.
    """
    periode = db.execute(text("SELECT date_reference FROM public.calendrier_paie WHERE id = :id AND societe_id = :sid"),
                         {"id": str(req.periode_id), "sid": societe_id}).mappings().first()
    if not periode:
        raise HTTPException(404, "Période introuvable")

    roles = list(roles_from_payload(payload))
    user_id = payload.get("sub") or payload.get("user_id")
    population = _resoudre_population(db, req.plan_paie_id, periode["date_reference"], req.filtres, societe_id)

    # RG-LOT-DEJA-VALIDE-01 (Adil DAIA) : "DEJA_VALIDE" existait déjà comme
    # statut par ligne, mais n'était compté nulle part dans les totaux
    # renvoyés (nb_total/nb_valides/nb_bloques/nb_alertes/nb_sans_bulletin) —
    # il disparaissait silencieusement. Résultat côté écran : après une
    # validation en plusieurs temps (ex. un lot d'abord, une alerte forcée
    # ensuite), le message "N validé(s)" ne comptait que les bulletins
    # BASCULÉS PENDANT CET APPEL précis, jamais le total réellement validé
    # sur la période — d'où l'impression trompeuse d'un décompte incohérent
    # avec la Vue d'ensemble (qui, elle, lit le vrai statut en base).
    resultats, nb_val, nb_bloq, nb_alerte, nb_sans, nb_deja = [], 0, 0, 0, 0, 0
    for c in population:
        ligne = {"collaborateur_id": c["id"], "matricule": c.get("matricule"),
                 "nom": f'{c.get("nom") or ""} {c.get("prenom") or ""}'.strip(),
                 "statut": "SANS_BULLETIN", "bloquants": 0, "alertes": 0, "message": None}
        # La validation part TOUJOURS d'un précalcul (bulletin_temp).
        bul = db.query(BulletinTemp).filter(
            BulletinTemp.collaborateur_id == c["id"], BulletinTemp.periode_id == req.periode_id
        ).first()
        if not bul:
            # Déjà validé (ou clôturé) ? on le signale sans le recompter comme absent.
            deja = db.query(Bulletin).filter(
                Bulletin.collaborateur_id == c["id"], Bulletin.periode_id == req.periode_id
            ).first()
            if deja:
                ligne["statut"] = "DEJA_VALIDE"
                nb_deja += 1
                resultats.append(ligne)
                continue
            nb_sans += 1
            ligne["message"] = "Aucun bulletin calculé"
            resultats.append(ligne)
            continue
        rapport = controler_bulletin(db, bul.id, roles)
        ligne["bloquants"] = rapport["bloquants_ko"]
        ligne["alertes"] = rapport["alertes_ko"]
        if rapport["bloquants_ko"] > 0:
            ligne["statut"] = "BLOQUE"
            ligne["message"] = "; ".join(x["message"] for x in rapport["controles"]
                                         if not x["ok"] and x["niveau"] == "BLOQUANT" and x["message"])[:200]
            nb_bloq += 1
        elif rapport["alertes_ko"] > 0 and not req.forcer_alertes:
            ligne["statut"] = "ALERTE"
            ligne["message"] = "; ".join(x["message"] for x in rapport["controles"]
                                         if not x["ok"] and x["message"])[:200]
            nb_alerte += 1
        else:
            avant = bul.statut
            bid = bul.id
            decision = "Validé malgré alertes" if rapport["alertes_ko"] > 0 else "Validé (lot)"
            action = "FORCAGE" if rapport["alertes_ko"] > 0 else "VALIDATION"
            # bulletin_temp → bulletin D'ABORD (cf. commentaire dans l'endpoint
            # de validation unitaire) : sinon l'autoflush de l'historique en
            # attente part avant le déplacement → ForeignKeyViolation.
            _deplacer_bulletin(db, bid, "bulletin_temp", "bulletin", "VALIDE",
                               {"valide_par": str(user_id) if user_id else None})
            _historiser(db, bul, action, avant, "VALIDE", rapport, decision, None, user_id)
            db.flush()
            ligne["statut"] = "VALIDE"
            nb_val += 1
        resultats.append(ligne)

    db.commit()
    return {"nb_total": len(population), "nb_valides": nb_val, "nb_deja_valide": nb_deja,
            "nb_bloques": nb_bloq, "nb_alertes": nb_alerte, "nb_sans_bulletin": nb_sans,
            "resultats": resultats}


# ============================ Vue d'ensemble (tableau de bord) =============
def _sql_filtre_pop(alias_collab: str, alias_date: str) -> str:
    """Fragment EXISTS pour restreindre à une/des organisation(s) (UO, hiérarchie
    incluse) et/ou un/des type(s) de contrat. `alias_collab` / `alias_date` sont les
    expressions SQL du collaborateur_id et de la date de référence dans la requête
    appelante (permet de réutiliser ce fragment dans des contextes différents).

    Attend toujours les paramètres `unite_ids` et `types_contrat` (None si pas de
    filtre — `IS NULL` court-circuite alors la sous-requête).
    """
    return f"""
        AND (CAST(:unite_ids AS uuid[]) IS NULL OR EXISTS (
            WITH RECURSIVE descendance AS (
                SELECT id FROM public.unites_organisationnelles WHERE id = ANY(CAST(:unite_ids AS uuid[]))
                UNION
                SELECT u.id FROM public.unites_organisationnelles u JOIN descendance d ON u.parent_id = d.id
            )
            SELECT 1 FROM public.collaborateur_affectations a
             WHERE a.collaborateur_id = {alias_collab} AND a.archive = false
               AND a.unite_id IN (SELECT id FROM descendance)
               AND (a.date_debut_uo IS NULL OR a.date_debut_uo <= {alias_date})
               AND (a.date_fin_uo IS NULL OR a.date_fin_uo >= {alias_date})
        ))
        AND (CAST(:types_contrat AS text[]) IS NULL OR EXISTS (
            SELECT 1 FROM public.collaborateur_contrats k
             WHERE k.collaborateur_id = {alias_collab} AND k.archive = false
               AND k.code_type_contrat = ANY(CAST(:types_contrat AS text[]))
               AND k.date_debut <= {alias_date} AND (k.date_fin IS NULL OR k.date_fin >= {alias_date})
        ))
    """


@router.get("/synthese", response_model=dict)
def synthese(plan_paie_id: list[UUID] = Query(...), annee: int | None = Query(None),
             officiel: bool = Query(False, description=(
                 "Si vrai : ne compte que les bulletins validés/clôturés (hors "
                 "précalculs bulletin_temp). À utiliser pour les écrans de "
                 "CONSULTATION. Un écran opérationnel (suivi du traitement en "
                 "cours, ex. Vue d'ensemble du traitement) laisse à false pour "
                 "voir aussi les précalculs.")),
             unite_id: list[UUID] = Query(default=[], description="Filtre par UO (hiérarchie incluse)."),
             type_contrat: list[str] = Query(default=[], description="Filtre par type de contrat."),
             detail_periodes: bool = Query(False, description=(
                 "Si vrai : une ligne par période réelle du calendrier (ex. "
                 "chaque quinzaine séparément) au lieu d'une ligne agrégée par "
                 "mois. Pensé pour le détail d'UN plan (vue développée par "
                 "plan) ; sur plusieurs plans à la fois, laisser à false pour "
                 "la ligne mensuelle consolidée.")),
             db: Session = Depends(get_db), _=Depends(require_roles(*PAIE_ROLES)),
             societe_id: str = Depends(get_societe_active_id)):
    """
    Tableau de bord du traitement : synthèse mensuelle de l'année en cours
    (consolidée sur un ou plusieurs plans) + récap des deux années précédentes.

    RG-MULTISOCIETE-07 (migration 057) : `societe_id_synth` injecté dans
    TOUTES les clauses WHERE portant sur calendrier_paie (alias c/c2) --
    sans ça, un plan_paie_id d'une autre société passé en paramètre (par
    erreur ou intentionnellement) remonterait des montants/effectifs d'une
    société non autorisée. Défense en profondeur : reste valable même si
    `plan_paie_id` s'avère déjà société-scopé par ailleurs (point ouvert,
    modèle plan_paie non fourni).
    """
    plan_ids = [str(p) for p in plan_paie_id]
    inlist = ", ".join(f":p{i}" for i in range(len(plan_ids)))
    pbase = {f"p{i}": pid for i, pid in enumerate(plan_ids)}
    pbase["unite_ids"] = [str(x) for x in unite_id] or None
    pbase["types_contrat"] = list(type_contrat) or None
    pbase["societe_id_synth"] = societe_id
    filtre_b = _sql_filtre_pop("b.collaborateur_id", "c.date_reference")
    filtre_cpp = _sql_filtre_pop("cpp.collaborateur_id", "c2.date_reference")

    if annee is None:
        annee = db.execute(text(f"""
            SELECT COALESCE(max(annee), EXTRACT(YEAR FROM now())::int)
              FROM public.calendrier_paie WHERE plan_paie_id IN ({inlist}) AND societe_id = :societe_id_synth
        """), pbase).scalar()

    prm = {**pbase, "annee": annee}

    # Détail mensuel (avec effectif payé par période)
    #
    # - "nb"/"calcules"/"valides"/"clotures" : lus depuis `v_bulletin_tous`
    #   (union bulletin_temp + bulletin + bulletin_historique) — sinon les
    #   bulletins temporaires (« paie temporaire », pas encore validés)
    #   n'apparaissaient jamais.
    # - "effectif" : population RÉELLEMENT concernée par la paie ce mois-ci
    #   (rattachée au plan, statut `actif_paie` dans le référentiel), pas
    #   seulement les collaborateurs qui ont déjà un bulletin — sinon un mois
    #   pas encore traité affichait 0 alors que l'effectif existe bel et bien.
    _groupe_par = "c.id, c.mois, c.numero_periode" if detail_periodes else "c.mois"
    periodes = db.execute(text(f"""
        SELECT c.mois,
               MIN(c.id::text)::uuid AS periode_id,
               MIN(c.numero_periode) AS numero_periode,
               CASE
                 WHEN bool_and(c.statut = 'CLOTUREE') THEN 'CLOTUREE'
                 WHEN bool_or(c.date_ouverture IS NOT NULL AND c.date_ouverture > CURRENT_DATE) THEN 'NON_OUVERTE'
                 ELSE 'OUVERTE'
               END                                           AS statut_periode,
               string_agg(
                   DISTINCT NULLIF(btrim(c.intitule), ''), ' / '
                   ORDER BY NULLIF(btrim(c.intitule), '')
               )                                             AS intitule,
               count(b.id)                                   AS nb,
               (
                   SELECT count(DISTINCT cpp.collaborateur_id)
                     FROM public.collaborateur_plan_paie cpp
                     JOIN public.collaborateurs col ON col.id = cpp.collaborateur_id
                     JOIN public.ref_statut_collaborateur rsc ON rsc.code = col.statut_collaborateur
                    WHERE cpp.plan_paie_id IN ({inlist}) AND cpp.archive = false
                      AND col.archive = false AND col.societe_id = :societe_id_synth AND rsc.actif_paie = true
                      AND EXISTS (
                          SELECT 1 FROM public.calendrier_paie c2
                           WHERE c2.plan_paie_id IN ({inlist}) AND c2.societe_id = :societe_id_synth AND c2.mois = c.mois AND c2.annee = :annee
                             AND cpp.date_debut <= c2.date_reference
                             AND (cpp.date_fin IS NULL OR cpp.date_fin >= c2.date_reference)
                             {filtre_cpp}
                      )
               )                                             AS effectif,
               count(*) FILTER (WHERE b.statut = 'CALCULE')  AS calcules,
               count(*) FILTER (WHERE b.statut = 'VALIDE')   AS valides,
               count(*) FILTER (WHERE b.statut = 'CLOTURE')  AS clotures,
               COALESCE(sum(b.net_a_payer), 0)               AS net,
               COALESCE(sum(b.cout_employeur), 0)            AS cout
          FROM public.calendrier_paie c
          LEFT JOIN {_sql_bulletins_tous(officiel=officiel)} b
                 ON b.periode_id = c.id {filtre_b}
         WHERE c.plan_paie_id IN ({inlist}) AND c.societe_id = :societe_id_synth AND c.annee = :annee
         GROUP BY {_groupe_par} ORDER BY c.mois, MIN(c.numero_periode)
    """), prm).mappings().all()
    periodes = [dict(p) for p in periodes]

    # Effectif « concerné par la paie » sur l'année entière (au moins une
    # période où le rattachement plan + statut actif_paie était valide).
    effectif_annee = db.execute(text(f"""
        SELECT count(DISTINCT cpp.collaborateur_id)
          FROM public.collaborateur_plan_paie cpp
          JOIN public.collaborateurs col ON col.id = cpp.collaborateur_id
          JOIN public.ref_statut_collaborateur rsc ON rsc.code = col.statut_collaborateur
         WHERE cpp.plan_paie_id IN ({inlist}) AND cpp.archive = false
           AND col.archive = false AND col.societe_id = :societe_id_synth AND rsc.actif_paie = true
           AND EXISTS (
               SELECT 1 FROM public.calendrier_paie c2
                WHERE c2.plan_paie_id IN ({inlist}) AND c2.societe_id = :societe_id_synth AND c2.annee = :annee
                  AND cpp.date_debut <= c2.date_reference
                  AND (cpp.date_fin IS NULL OR cpp.date_fin >= c2.date_reference)
                  {filtre_cpp}
           )
    """), prm).scalar() or 0

    # KPI de l'année en cours (mêmes bulletins unifiés que le détail mensuel)
    k = db.execute(text(f"""
        SELECT COALESCE(sum(b.total_gains), 0)                              AS brut,
               COALESCE(sum(b.net_a_payer), 0)                              AS net,
               COALESCE(sum(b.cout_employeur), 0)                           AS cout,
               COALESCE(sum(b.total_cot_salariale + b.total_cot_patronale), 0) AS cotisations,
               COALESCE(sum(b.total_cot_salariale), 0)                      AS cot_sal,
               COALESCE(sum(b.total_cot_patronale), 0)                      AS cot_pat,
               COALESCE(sum(b.total_retenues), 0)                           AS retenues,
               COALESCE(sum(b.total_brut_imposable), 0)                     AS brut_imposable,
               COALESCE(sum(b.net_imposable), 0)                            AS net_imposable,
               count(b.id)                                                  AS nb,
               count(*) FILTER (WHERE b.statut = 'VALIDE')                  AS valides,
               count(*) FILTER (WHERE b.statut = 'CLOTURE')                 AS clotures,
               count(*) FILTER (WHERE b.statut = 'CALCULE')                 AS a_valider,
               count(*) FILTER (WHERE b.a_erreur)                           AS en_erreur,
               count(*) FILTER (WHERE jsonb_array_length(COALESCE(b.messages, '[]'::jsonb)) > 0) AS avec_avert
          FROM {_sql_bulletins_tous(officiel=officiel)} b
          JOIN public.calendrier_paie c ON c.id = b.periode_id
         WHERE c.plan_paie_id IN ({inlist}) AND c.societe_id = :societe_id_synth AND c.annee = :annee {filtre_b}
    """), prm).mappings().first() or {}

    brut = float(k.get("brut") or 0); cotis = float(k.get("cotisations") or 0)
    eff = int(effectif_annee or 0); net = float(k.get("net") or 0); cout = float(k.get("cout") or 0)
    totaux = {
        "nb": int(k.get("nb") or 0), "effectif": eff,
        "brut": brut, "net": net, "cout": cout, "cotisations": cotis,
        "cot_salariale": float(k.get("cot_sal") or 0), "cot_patronale": float(k.get("cot_pat") or 0),
        "retenues": float(k.get("retenues") or 0),
        "brut_imposable": float(k.get("brut_imposable") or 0),
        "net_imposable": float(k.get("net_imposable") or 0),
        "net_moyen": (net / eff) if eff else 0,
        "cout_moyen": (cout / eff) if eff else 0,
        "brut_moyen": (brut / eff) if eff else 0,
        "taux_charges": (cotis / brut * 100) if brut else 0,
        "ratio_net_brut": (net / brut * 100) if brut else 0,
        "valides": int(k.get("valides") or 0), "clotures": int(k.get("clotures") or 0),
        "a_valider": int(k.get("a_valider") or 0), "en_erreur": int(k.get("en_erreur") or 0),
        "avec_avertissement": int(k.get("avec_avert") or 0),
    }

    def _rep(sql: str) -> list[dict]:
        try:
            return [dict(r) for r in db.execute(text(sql), prm).mappings().all()]
        except Exception:
            db.rollback()
            return []

    rep_org = _rep(f"""
        SELECT COALESCE(u.libelle, 'Non affecté') AS libelle,
               COALESCE(sum(b.net_a_payer), 0) AS net,
               COALESCE(sum(b.cout_employeur), 0) AS cout, count(*) AS nb
          FROM {_sql_bulletins_tous(officiel=officiel)} b
          JOIN public.calendrier_paie c ON c.id = b.periode_id
          LEFT JOIN LATERAL (
              SELECT a.unite_id FROM public.collaborateur_affectations a
               WHERE a.collaborateur_id = b.collaborateur_id AND a.archive = false
                 AND (a.date_debut_uo IS NULL OR a.date_debut_uo <= c.date_reference)
                 AND (a.date_fin_uo IS NULL OR a.date_fin_uo >= c.date_reference)
               ORDER BY a.date_debut_uo DESC NULLS LAST LIMIT 1
          ) aff ON true
          LEFT JOIN public.unites_organisationnelles u ON u.id = aff.unite_id
         WHERE c.plan_paie_id IN ({inlist}) AND c.societe_id = :societe_id_synth AND c.annee = :annee {filtre_b}
         GROUP BY COALESCE(u.libelle, 'Non affecté') ORDER BY net DESC
    """)

    rep_contrat = _rep(f"""
        SELECT COALESCE(rtc.libelle, ctr.code_type_contrat, 'Non renseigné') AS libelle,
               COALESCE(sum(b.net_a_payer), 0) AS net,
               COALESCE(sum(b.cout_employeur), 0) AS cout, count(*) AS nb
          FROM {_sql_bulletins_tous(officiel=officiel)} b
          JOIN public.calendrier_paie c ON c.id = b.periode_id
          LEFT JOIN LATERAL (
              SELECT k2.code_type_contrat FROM public.collaborateur_contrats k2
               WHERE k2.collaborateur_id = b.collaborateur_id AND k2.archive = false
                 AND k2.date_debut <= c.date_reference
                 AND (k2.date_fin IS NULL OR k2.date_fin >= c.date_reference)
               ORDER BY k2.date_debut DESC LIMIT 1
          ) ctr ON true
          LEFT JOIN public.ref_type_contrat rtc ON rtc.code = ctr.code_type_contrat
         WHERE c.plan_paie_id IN ({inlist}) AND c.societe_id = :societe_id_synth AND c.annee = :annee {filtre_b}
         GROUP BY COALESCE(rtc.libelle, ctr.code_type_contrat, 'Non renseigné') ORDER BY net DESC
    """)

    # Top rubriques : pas de vue unifiée pour les lignes, donc UNION ALL
    # manuel des trois tables de détail (même principe que v_bulletin_tous).
    _branches_top_rub = [("bulletin_temp_ligne", "bulletin_temp")] if not officiel else []
    _branches_top_rub += [("bulletin_ligne", "bulletin"), ("bulletin_historique_ligne", "bulletin_historique")]
    _sql_top_rub = " UNION ALL ".join(
        f"""SELECT bl.libelle, bl.code_rubrique, bl.montant
              FROM public.{tbl_l} bl JOIN public.{tbl_b} b ON b.id = bl.bulletin_id
              JOIN public.calendrier_paie c ON c.id = b.periode_id
             WHERE c.plan_paie_id IN ({inlist}) AND c.societe_id = :societe_id_synth AND c.annee = :annee AND bl.sens = 'GAIN' {filtre_b}"""
        for tbl_l, tbl_b in _branches_top_rub
    )
    top_rub = _rep(f"""
        SELECT libelle, code_rubrique AS code, COALESCE(sum(montant), 0) AS total FROM (
            {_sql_top_rub}
        ) tout
        GROUP BY libelle, code_rubrique ORDER BY total DESC LIMIT 20
    """)

    # Deux années précédentes
    precedentes = db.execute(text(f"""
        SELECT c.annee,
               count(b.id)                                   AS nb,
               count(*) FILTER (WHERE b.statut = 'VALIDE')   AS valides,
               count(*) FILTER (WHERE b.statut = 'CLOTURE')  AS clotures,
               COALESCE(sum(b.net_a_payer), 0)               AS net,
               COALESCE(sum(b.cout_employeur), 0)            AS cout
          FROM public.calendrier_paie c
          LEFT JOIN {_sql_bulletins_tous(officiel=officiel)} b
                 ON b.periode_id = c.id {filtre_b}
         WHERE c.plan_paie_id IN ({inlist}) AND c.societe_id = :societe_id_synth AND c.annee IN (:a1, :a2)
         GROUP BY c.annee ORDER BY c.annee DESC
    """), {**pbase, "a1": annee - 1, "a2": annee - 2}).mappings().all()

    return {
        "annee": annee, "periodes": periodes, "totaux": totaux,
        "precedentes": [dict(p) for p in precedentes],
        "repartition_organisation": rep_org,
        "repartition_contrat": rep_contrat,
        "top_rubriques": top_rub,
    }


# ============================ Éditeur de règles spécifiques ================
def _instr_dicts(instructions) -> list[dict]:
    return [{"numero": i.numero, "instruction": i.instruction, "label": i.label} for i in instructions]


def _json_val(v):
    from decimal import Decimal as _D
    if isinstance(v, _D):
        return str(v)
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return v


@router.post("/regles/valider", response_model=ReglesValiderResult)
def regles_valider(req: ReglesValiderRequest, db: Session = Depends(get_db),
                   _=Depends(require_roles("administrateur", "gestionnaire_paie"))):
    """
    Contrôle d'une règle spécifique, sans exécution :
      • SYNTAXE  → `erreurs`        (bloquant : la règle ne peut pas tourner)
      • SÉMANTIQUE → `avertissements` (rubrique / constante / barème introuvable)
    """
    instrs = _instr_dicts(req.instructions)
    erreurs = regle_dsl.valider_programme(instrs)

    # --- Vérification d'existence des références (sémantique) ---
    avert: list[str] = []
    try:
        refs = regle_dsl.references(instrs)

        def _connus(table: str, codes: list[str]) -> set[str]:
            if not codes:
                return set()
            rows = db.execute(
                text(f"SELECT upper(code) AS code FROM public.{table} WHERE upper(code) = ANY(:codes)"),
                {"codes": codes},
            ).scalars().all()
            return set(rows)

        manquants_rub = set(refs["rubriques"]) - _connus("rubrique_paie", refs["rubriques"])
        manquants_cst = set(refs["constantes"]) - _connus("ref_constante_paie", refs["constantes"])
        manquants_bar = set(refs["baremes"]) - _connus("bareme", refs["baremes"])

        # On rattache l'avertissement à la ligne qui cite la référence
        for i in instrs:
            src = (i.get("instruction") or "").upper()
            num = i.get("numero")
            for c in sorted(manquants_rub):
                if f"[{c}]" in src or f'"{c}"' in src:
                    avert.append(f"Ligne {num}: rubrique « {c} » introuvable")
            for c in sorted(manquants_cst):
                if f"#{c}" in src:
                    avert.append(f"Ligne {num}: constante « {c} » introuvable "
                                 f"(un code ne peut contenir que lettres, chiffres et « _ »)")
            for c in sorted(manquants_bar):
                if f'"{c}"' in src:
                    avert.append(f"Ligne {num}: barème « {c} » introuvable")
    except Exception:
        pass  # la validation sémantique ne doit jamais bloquer la syntaxique

    return {"ok": not erreurs, "erreurs": erreurs, "avertissements": avert}


@router.post("/regles/tester", response_model=ReglesTesterResult)
def regles_tester(req: ReglesTesterRequest, db: Session = Depends(get_db),
                  _=Depends(require_roles("administrateur", "gestionnaire_paie"))):
    """
    Exécute une règle sur un collaborateur / période réels et renvoie la trace
    pas-à-pas + les sorties. Le bulletin est calculé pour fournir au DSL les
    valeurs des autres rubriques (accesseurs [CODE].attr, cumuls, etc.).
    """
    periode = db.execute(text("""
        SELECT id, plan_paie_id, annee, mois, numero_periode, date_debut, date_fin,
               date_reference, statut, est_fin_mois, est_fin_trimestre, est_fin_semestre, est_fin_annee,
               societe_id
          FROM public.calendrier_paie WHERE id = :id
    """), {"id": str(req.periode_id)}).mappings().first()
    if not periode:
        raise HTTPException(404, "Période introuvable")

    # Valeurs des rubriques (pour les accesseurs) via un calcul du bulletin
    results: dict = {}
    try:
        res = calculer_bulletin(db, req.collaborateur_id, req.periode_id)
        for l in res.get("lignes", []):
            results[l["code_rubrique"]] = {
                "MT": _dec(l.get("montant")), "NB": _dec(l.get("nombre")),
                "TY": _dec(l.get("taux")), "BASE": _dec(l.get("base")),
            }
    except Exception as e:
        # le test reste possible même si le bulletin ne calcule pas (accès → 0)
        results = {}

    ctx = ContexteCalcul(db, req.collaborateur_id, dict(periode))
    resolver = ResolverPaie(ctx, results)

    seed = {"MT": D0, "NB": D0, "TX": D0, "BASE": D0, "DATE": None, "TEXTE": ""}
    if req.seed:
        for k, v in req.seed.items():
            seed[k.upper()] = v

    sorties, trace, avert = regle_dsl.executer(_instr_dicts(req.instructions), resolver, seed)
    sorties = {k: _json_val(v) for k, v in sorties.items()}
    return {"sorties": sorties, "trace": trace, "avertissements": avert}


def _charger_baremes_et_constantes(db: Session, ref: _date, societe_id: UUID | None = None) -> tuple[dict, dict]:
    """Charge constantes et barèmes RÉELS valides à la date `ref`, sans dépendre
    d'un collaborateur (contrairement à `ContexteCalcul`, qui charge aussi le
    contexte d'un collaborateur précis). Mêmes requêtes que `ContexteCalcul`,
    pour que la simulation isolée (`/regles/tester-manuel`) reflète fidèlement
    le paramétrage réel plutôt que d'obliger une saisie manuelle de tout.

    RG-MULTISOCIETE-03 (migration 057) : `societe_id` optionnel -- si fourni,
    une valeur spécifique à cette société prévaut sur la valeur générique
    (societe_id NULL) pour le même code, même logique que ContexteCalcul._charger().
    `societe_id=None` (comportement par défaut, ex. appelant qui ne connaît pas
    encore de société active) ne remonte QUE les valeurs génériques -- identique
    au comportement d'avant migration 057, aucune régression.
    """
    sid = str(societe_id) if societe_id else None
    constantes: dict[str, str] = {}
    for c in db.execute(text("""
        SELECT code, valeur FROM public.ref_constante_paie
         WHERE actif = true
           AND (date_debut IS NULL OR date_debut <= :ref)
           AND (date_fin   IS NULL OR date_fin   >= :ref)
           AND (societe_id IS NULL OR societe_id = :societe_id)
         ORDER BY (societe_id IS NULL) DESC, updated_at
    """), {"ref": ref, "societe_id": sid}).mappings().all():
        constantes[c["code"]] = c["valeur"]

    baremes: dict[str, dict] = {}
    for b in db.execute(text("""
        SELECT id, code FROM public.bareme
         WHERE archive = false AND actif = true
           AND (societe_id IS NULL OR societe_id = :societe_id)
         ORDER BY (societe_id IS NULL) DESC
    """), {"societe_id": sid}).mappings().all():
        bid = b["id"]
        cles = db.execute(text("""
            SELECT nom_technique, type, mode, ordre FROM public.bareme_cle
             WHERE bareme_id = :id ORDER BY ordre
        """), {"id": bid}).mappings().all()
        sorties = db.execute(text("""
            SELECT nom_technique, type, par_defaut, ordre FROM public.bareme_sortie
             WHERE bareme_id = :id ORDER BY ordre
        """), {"id": bid}).mappings().all()
        lignes = db.execute(text("""
            SELECT ordre, valeurs_cles, valeurs_sorties FROM public.bareme_ligne
             WHERE bareme_id = :id ORDER BY ordre
        """), {"id": bid}).mappings().all()
        baremes[b["code"]] = {
            "cles": [dict(c) for c in cles],
            "sorties": [dict(s) for s in sorties],
            "lignes": [dict(l) for l in lignes],
        }
    return constantes, baremes


@router.post("/regles/tester-manuel", response_model=ReglesTesterResult)
def regles_tester_manuel(req: ReglesTesterManuelRequest, db: Session = Depends(get_db),
                         _=Depends(require_roles("administrateur", "gestionnaire_paie"))):
    """
    Exécute une règle en ISOLATION : rubriques, cumuls et paies précédentes
    sont saisis à la main (aucun collaborateur réel), mais CONSTANTES et
    BARÈMES sont lus RÉELLEMENT en base à la date de simulation — la saisie
    manuelle de ces deux-là reste possible et prend le pas si fournie
    (utile pour rejouer un cas particulier sans toucher au paramétrage réel).
    """
    from datetime import date as _date

    def _d(x):
        try:
            return _date.fromisoformat(x) if x else None
        except Exception:
            return None

    ref = _d(req.date_paie) or _date.today()
    # RG-MULTISOCIETE-03 : `societe_id` optionnel sur ReglesTesterManuelRequest
    # -- champ à AJOUTER au schéma Pydantic (non trouvé dans les fichiers
    # fournis, getattr() reste donc sans effet tant que le champ n'existe pas
    # : comportement générique par défaut, aucune régression).
    societe_id_test = getattr(req, "societe_id", None)
    constantes_reelles, baremes_reels = _charger_baremes_et_constantes(db, ref, societe_id_test)

    resolver = ResolverManuel(
        rubriques=req.rubriques or {}, constantes=req.constantes or {},
        cumuls=req.cumuls or {}, precedents=req.precedents or {},
        baremes=req.baremes or {}, date_paie=_d(req.date_paie), date_jour=_d(req.date_jour),
        constantes_reelles=constantes_reelles, baremes_reels=baremes_reels,
    )
    seed = {"MT": D0, "NB": D0, "TX": D0, "BASE": D0, "DATE": None, "TEXTE": ""}
    if req.seed:
        for k, v in req.seed.items():
            seed[k.upper()] = v
    sorties, trace, avert = regle_dsl.executer(_instr_dicts(req.instructions), resolver, seed)
    sorties = {k: _json_val(v) for k, v in sorties.items()}
    return {"sorties": sorties, "trace": trace, "avertissements": avert}


@router.get("/regles/catalogue")
def regles_catalogue(_=Depends(require_roles("administrateur", "gestionnaire_paie"))):
    """
    Catalogue RÉEL du moteur DSL : fonctions effectivement enregistrées
    (nom, catégorie, signature, description) + grammaire du langage.
    L'éditeur de règles lit ce catalogue : rien n'est codé en dur côté front.
    """
    return regle_dsl.catalogue()


# ============================ Consultation / historique ====================
@router.get("/historique/collaborateur")
def historique_collaborateur(
    collaborateur_id: UUID,
    annee: int,
    plan_paie_id: UUID | None = None,
    code_rubrique: list[str] = Query(default=[]),
    db: Session = Depends(get_db),
    _=Depends(require_roles("administrateur", "gestionnaire_rh", "gestionnaire_paie")),
):
    """
    Évolution historique de paie d'un collaborateur sur une année.
    Renvoie, période par période : le détail des rubriques (montant, nombre,
    taux, base) et les totaux du bulletin. Filtrable sur une ou plusieurs rubriques.
    """
    params: dict = {"cid": str(collaborateur_id), "annee": annee}
    where_plan = ""
    if plan_paie_id:
        where_plan = " AND c.plan_paie_id = :plan"
        params["plan"] = str(plan_paie_id)
    where_rub = ""
    if code_rubrique:
        where_rub = " AND bl.code_rubrique = ANY(:rub)"
        params["rub"] = code_rubrique

    lignes = db.execute(text(f"""
        SELECT c.id            AS periode_id,
               c.plan_paie_id,
               c.annee, c.mois, c.numero_periode,
               c.date_reference,
               b.id            AS bulletin_id,
               b.statut        AS statut_bulletin,
               bl.code_rubrique, bl.libelle, bl.code_type, bl.sens, bl.est_cotisation,
               bl.base, bl.nombre, bl.taux, bl.montant, bl.montant_patronal
          FROM public.calendrier_paie c
          JOIN public.bulletin b        ON b.periode_id = c.id AND b.collaborateur_id = :cid
          JOIN public.bulletin_ligne bl ON bl.bulletin_id = b.id
         WHERE c.annee = :annee {where_plan} {where_rub}
         ORDER BY c.annee, c.mois, c.numero_periode, bl.ordre_affichage, bl.code_rubrique
    """), params).mappings().all()

    # Toutes les périodes des plans concernés (colonnes complètes, même sans bulletin)
    plans_concernes = db.execute(text(f"""
        SELECT DISTINCT c.plan_paie_id
          FROM public.calendrier_paie c
          JOIN public.bulletin b ON b.periode_id = c.id AND b.collaborateur_id = :cid
         WHERE c.annee = :annee {where_plan}
    """), {k: v for k, v in params.items() if k != "rub"}).scalars().all()

    colonnes = []
    if plans_concernes:
        colonnes = db.execute(text("""
            SELECT c.id AS periode_id, c.plan_paie_id, p.code AS plan_code, p.libelle AS plan_libelle,
                   c.annee, c.mois, c.numero_periode, c.intitule
              FROM public.calendrier_paie c
              JOIN public.plan_paie p ON p.id = c.plan_paie_id
             WHERE c.annee = :annee AND c.plan_paie_id = ANY(CAST(:plans AS uuid[]))
             ORDER BY p.code, c.mois, c.numero_periode
        """), {"annee": annee, "plans": [str(x) for x in plans_concernes]}).mappings().all()

    totaux = db.execute(text(f"""
        SELECT c.id AS periode_id, c.plan_paie_id, c.annee, c.mois, c.numero_periode,
               b.statut,
               b.total_brut, b.total_brut_imposable, b.net_imposable, b.total_retenues,
               b.net_a_payer, b.cout_employeur
          FROM public.calendrier_paie c
          JOIN public.bulletin b ON b.periode_id = c.id AND b.collaborateur_id = :cid
         WHERE c.annee = :annee {where_plan}
         ORDER BY c.annee, c.mois, c.numero_periode
    """), {k: v for k, v in params.items() if k != "rub"}).mappings().all()

    def _f(v):
        return float(v) if v is not None else None

    return {
        "plans": [{
            "plan_paie_id": str(c["plan_paie_id"]), "code": c["plan_code"], "libelle": c["plan_libelle"],
        } for c in {str(x["plan_paie_id"]): x for x in colonnes}.values()],
        "colonnes": [{
            "periode_id": str(c["periode_id"]), "plan_paie_id": str(c["plan_paie_id"]),
            "annee": c["annee"], "mois": c["mois"], "numero_periode": c["numero_periode"],
            "intitule": c["intitule"],
        } for c in colonnes],
        "lignes": [{
            "periode_id": str(r["periode_id"]), "plan_paie_id": str(r["plan_paie_id"]),
            "annee": r["annee"], "mois": r["mois"],
            "numero_periode": r["numero_periode"], "date_reference": r["date_reference"].isoformat(),
            "bulletin_id": str(r["bulletin_id"]), "statut_bulletin": r["statut_bulletin"],
            "code_rubrique": r["code_rubrique"], "libelle": r["libelle"], "code_type": r["code_type"],
            "base": _f(r["base"]), "nombre": _f(r["nombre"]), "taux": _f(r["taux"]),
            "montant": _f(r["montant"]), "montant_patronal": _f(r["montant_patronal"]),
        } for r in lignes],
        "totaux": [{
            "periode_id": str(t["periode_id"]), "plan_paie_id": str(t["plan_paie_id"]),
            "annee": t["annee"], "mois": t["mois"],
            "numero_periode": t["numero_periode"], "statut": t["statut"],
            "total_brut": _f(t["total_brut"]), "total_brut_imposable": _f(t["total_brut_imposable"]),
            "net_imposable": _f(t["net_imposable"]), "net_a_payer": _f(t["net_a_payer"]),
            "cout_employeur": _f(t["cout_employeur"]),
        } for t in totaux],
    }
