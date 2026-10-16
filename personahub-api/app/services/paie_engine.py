"""
app/services/paie_engine.py — Moteur de calcul de paie (cœur)
Auteur : Adil DAIA

Calcule le bulletin d'UN collaborateur sur UNE période, à partir du
paramétrage existant (rubrique_paie, rubrique_paie_alimentation,
rubrique_paie_assiette, ref_regle_calcul_standard, regle_calcul_specifique,
regle_calcul_cotisation(_composante), bareme*, ref_constante_paie) et des
éléments variables saisis (element_variable).

Principes (modèle progiciel de paie) :
  • Une rubrique de code_type 'ASS' est un ACCUMULATEUR : elle n'est pas
    "calculée", elle est alimentée au fil de l'eau par les rubriques qui la
    référencent dans rubrique_paie_assiette (sens PLUS/MOINS).
  • Une rubrique 'CALC'/'GAIN'/'RET' est d'abord ALIMENTÉE (BASE/NOMBRE/TAUX/
    MONTANT via rubrique_paie_alimentation : TABLE / CONSTANTE / RUBRIQUE),
    puis ÉVALUÉE :
        - par une règle SPÉCIFIQUE (DSL, même code que la rubrique), sinon
        - par une règle STANDARD (ref_regle_calcul_standard via code_regle),
          sinon repli : MT = MONTANT alimenté, à défaut MT = BASE.
  • Une rubrique 'COT' est produite par le moteur de cotisation
    (app/services/cotisation_engine.py) : parts salariale/patronale plafonnées.
  • L'ordre d'exécution est TOPOLOGIQUE (une rubrique qui lit une assiette
    passe après tous ses contributeurs), départagé par ordre_calcul puis code.

Le moteur est TOLÉRANT : toute rubrique dont le calcul n'est pas (encore)
câblé produit 0 et un avertissement horodaté dans la trace, sans interrompre
le bulletin. Objectif : exécuter fidèlement le paramétrage tel qu'il est et
rendre visibles les trous.
"""
from __future__ import annotations

import re
from calendar import monthrange
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session
from fastapi import HTTPException

from app.services.cotisation_engine import calculer_cotisation
from app.schemas.cotisation import CotisationCalculRequest
from app.services import regle_dsl
from app.services.population_paie import rubriques_eligibles


D0 = Decimal("0")
Q2 = Decimal("0.01")
Q4 = Decimal("0.0001")


def _dec(v) -> Decimal:
    """Conversion tolérante en Decimal (None/'' -> 0)."""
    if v is None or v == "":
        return D0
    try:
        return Decimal(str(v))
    except (InvalidOperation, ValueError, TypeError):
        return D0


def q2(v: Decimal) -> Decimal:
    return _dec(v).quantize(Q2, rounding=ROUND_HALF_UP)


def q4(v: Decimal) -> Decimal:
    return _dec(v).quantize(Q4, rounding=ROUND_HALF_UP)


_IDENT_RE = re.compile(r"^[a-z_][a-z0-9_]*$")


def _safe_ident(name: str | None) -> bool:
    """Autorise uniquement un identifiant SQL simple (anti-injection)."""
    return bool(name) and bool(_IDENT_RE.match(name)) and len(name) <= 63


def _iso(v) -> str | None:
    """Convertit une valeur date/datetime en 'YYYY-MM-DD' ; sinon str ; None -> None."""
    if v is None or v == "":
        return None
    if isinstance(v, (date, datetime)):
        return v.isoformat()[:10]
    return str(v)


# =====================================================================
# Chargement du contexte de calcul
# =====================================================================
class ContexteCalcul:
    """Toutes les données nécessaires au calcul, chargées une fois par bulletin."""

    def __init__(self, db: Session, collaborateur_id: UUID, periode: dict,
                 surcharges_rubrique: dict[tuple[str, str], dict] | None = None,
                 surcharges_table: dict[tuple[str, str], object] | None = None,
                 inclure_rubriques_simulation: bool = False,
                 surcharges_regime: dict[str, dict] | None = None):
        """
        RG-SIM-CTX-SURCHARGE-01 (module Simulation, proposition — à valider) :
        trois paramètres optionnels, sans effet si non fournis, pour ne rien
        changer au comportement du calcul réel (`calculer_bulletin` n'appelle
        jamais `ContexteCalcul` avec ces arguments à ce jour) :

          • surcharges_rubrique : {(code_rubrique, attribut): {"valeur":...,
            "mode": "AJOUT"|"FORCAGE"}} — attribut parmi BASE/NOMBRE/TAUX/
            MONTANT (même domaine que les colonnes d'élément variable réelles,
            voir _COLONNE_PAR_ATTRIBUT plus bas). Injectées dans self.elements
            EXACTEMENT comme des éléments variables réels chargés depuis la
            base : aucune autre partie du moteur (resoudre_alimentation,
            calcul MONTANT après règle) n'a besoin d'être modifiée pour les
            prendre en compte — c'est la même mécanique attribut/sens que
            RG-SIM-IND-04 demande, appliquée en mémoire plutôt qu'en base.

          • surcharges_table : {(table, colonne): valeur} — pour les champs
            lus directement sur une table collaborateur via alimentation
            TABLE (ex. ('collaborateur_contrats', 'code_temps')), en dehors
            du mécanisme rubrique/élément variable. Voir valeur_table() et le
            traitement spécial de 'collaborateur_salaires_fixes' plus bas.

          • inclure_rubriques_simulation (False par défaut) : si True, charge
            AUSSI les rubriques marquées `simulation_seulement = true`
            (migration 061) — rubriques créées pour être testées en
            simulation, jamais utilisées dans un calcul réel. False (défaut)
            reproduit exactement le filtre déjà en place avant cette
            migration : aucun changement pour calculer_bulletin().

          • surcharges_regime : {code_regle: {"mode": "AJOUT"|"FORCAGE"|
            "POURCENTAGE", "taux_salarial":..., "taux_patronal":...,
            "forcer_affectation": bool, "valeur_bareme_taux_simulee":...}} —
            transmis tel quel à `cotisation_engine.calculer_cotisation()`
            pour chaque règle de cotisation concernée (RG-SIM-COTISATION-01).
            Clé = code de la RÈGLE de cotisation (regle_calcul_cotisation.code),
            pas le code régime — plusieurs règles peuvent porter le même
            régime (ex. part salariale/patronale séparées).

        Aucune écriture en base n'est jamais effectuée à partir de ces
        paramètres — ils ne font que remplacer ou étendre, en mémoire, une
        lecture qui aurait normalement touché la base.
        """
        self.db = db
        self.collaborateur_id = collaborateur_id
        self.periode = periode                      # ligne calendrier_paie
        self.annee: int = periode["annee"]
        self.mois: int = periode["mois"]
        self.date_reference: date = periode["date_reference"]
        self.jours_mois: int = monthrange(self.annee, self.mois)[1]
        # RG-MULTISOCIETE-01 : société de la période (calendrier_paie.societe_id,
        # migration 057) — ancre du cloisonnement du paramétrage (RG-03 : voir
        # _charger(), une valeur spécifique à cette société prévaut sur une
        # valeur générique societe_id NULL, sur bareme/constante/rubrique/regle).
        self.societe_id = periode.get("societe_id")
        self.inclure_rubriques_simulation = inclure_rubriques_simulation
        self.surcharges_regime: dict[str, dict] = surcharges_regime or {}

        self.rubriques: dict[str, dict] = {}        # code -> ligne rubrique_paie
        # Intitulés (pour les explications en langage naturel)
        self.libelles_constantes: dict[str, str] = {}
        self.libelles_baremes: dict[str, str] = {}
        self.alimentations: dict[str, list] = {}    # code -> [alimentation]
        self.assiettes_de: dict[str, list] = {}     # code_rubrique -> [(code_assiette, sens)]
        self.regles_standard: dict[str, dict] = {}  # code -> ref_regle_calcul_standard
        self.regles_spec: dict[str, list] = {}      # code_rubrique -> [instructions triées]
        self.baremes: dict[str, dict] = {}          # code -> {cles, sorties, lignes}
        self.constantes: dict[str, str] = {}        # code -> valeur (à date)
        self.salaire_fixe: dict = {}                # ligne collaborateur_salaires_fixes
        self.elements: dict[tuple, Decimal] = {}    # (code_rubrique, attribut) -> valeur
        self.regimes: set[str] = set()              # codes régimes du collaborateur
        self._ligne_table_cache: dict[str, dict] = {}  # table -> ligne du collaborateur

        # RG-SIM-CTX-SURCHARGE-01 : normalisées ici (dict vide si None) pour
        # que le reste du code n'ait jamais à tester None.
        self.surcharges_rubrique: dict[tuple[str, str], dict] = surcharges_rubrique or {}
        self.surcharges_table: dict[tuple[str, str], object] = surcharges_table or {}

        self._charger()
        self._appliquer_surcharges()

    # ---- helpers d'accès ------------------------------------------------
    def constante(self, code: str) -> Decimal:
        return _dec(self.constantes.get(code))

    # RG-PAIE-NET-IMPOSABLE-CONFIG-01 (Adil DAIA) : lecture d'une constante
    # de type TEXTE dont la valeur est un CODE DE RUBRIQUE (même principe que
    # CNSS_RUBRIQUE_SALAIRE_BRUT / CNSS_RUBRIQUE_NBR_JOURS déjà présentes dans
    # le référentiel des constantes). self.constantes contient déjà toutes les
    # constantes actives à la date de référence, quel que soit leur type
    # d'affichage (Numérique/Texte) — cette méthode se contente de ne PAS les
    # forcer en Decimal comme le fait constante().
    def constante_texte(self, code: str, defaut: str = "") -> str:
        v = self.constantes.get(code)
        return (v or defaut).strip()

    def is_assiette(self, code: str) -> bool:
        r = self.rubriques.get(code)
        return bool(r and r.get("code_type") == "ASS")

    def valeur_table(self, table: str, colonne: str):
        """
        Lit `colonne` d'une table liée au collaborateur (ex. collaborateur_contrats),
        pour la ligne valide à la date de référence. Sécurisé (identifiants validés,
        table devant posséder collaborateur_id). Résultat mis en cache par table.

        RG-SIM-CTX-SURCHARGE-01 : une surcharge de simulation sur (table, colonne)
        est prioritaire et court-circuite entièrement la lecture base — comportement
        inchangé si self.surcharges_table est vide (cas réel, non-simulation).
        """
        if (table, colonne) in self.surcharges_table:
            return self.surcharges_table[(table, colonne)]
        if not (_safe_ident(table) and _safe_ident(colonne)):
            return None
        if table not in self._ligne_table_cache:
            self._ligne_table_cache[table] = self._charger_ligne_table(table)
        return (self._ligne_table_cache[table] or {}).get(colonne)

    def _charger_ligne_table(self, table: str) -> dict:
        db, ref = self.db, self.date_reference
        cols = {r[0] for r in db.execute(text("""
            SELECT column_name FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = :t
        """), {"t": table}).all()}
        if "collaborateur_id" not in cols:
            return {}
        where = ["collaborateur_id = :cid"]
        if "archive" in cols:
            where.append("archive = false")
        if "date_debut" in cols:
            where.append("(date_debut IS NULL OR date_debut <= :ref)")
        if "date_fin" in cols:
            where.append("(date_fin IS NULL OR date_fin >= :ref)")
        order = "ORDER BY date_debut DESC" if "date_debut" in cols else ""
        sql = f'SELECT * FROM "{table}" WHERE {" AND ".join(where)} {order} LIMIT 1'
        row = db.execute(text(sql), {"cid": str(self.collaborateur_id), "ref": ref}).mappings().first()
        return dict(row) if row else {}

    # ---- chargement -----------------------------------------------------
    def _charger(self):
        db = self.db
        ref = self.date_reference

        # Rubriques actives & valides à la date de référence.
        # simulation_seulement (migration 061) : exclue par défaut (calcul
        # réel) — incluse uniquement quand inclure_rubriques_simulation=True
        # (simuler_bulletin), sans changer le filtre pour tout le reste.
        filtre_simulation = "" if self.inclure_rubriques_simulation else "AND simulation_seulement = false"
        rows = db.execute(text(f"""
            SELECT code, libelle, libelle_edition, code_type, code_flux, code_famille,
                   ordre_calcul, code_regle, type_regle, zone_fixe_key, traiter,
                   frequence_calcul, frequence_raz_cumuls, pr_cumulee, v_glissant,
                   ne_editer_si_mt_zero, ne_editer_si_nb_zero, ne_editer_si_ty_zero,
                   attribut_controle_non_zero, rubrique_en_net, societe_id
              FROM public.rubrique_paie
             WHERE archive = false AND traiter = true
               {filtre_simulation}
               AND (date_debut IS NULL OR date_debut <= :ref)
               AND (date_fin   IS NULL OR date_fin   >= :ref)
               AND (societe_id IS NULL OR societe_id = :societe_id)
             ORDER BY (societe_id IS NULL) DESC
        """), {"ref": ref, "societe_id": str(self.societe_id) if self.societe_id else None}).mappings().all()
        # RG-MULTISOCIETE-03 : générique (societe_id NULL) chargé en premier,
        # spécifique société ACTIVE ensuite -> la boucle écrase la version
        # générique par la version spécifique quand les deux existent pour le
        # même code (self.societe_id est None -> seules les lignes génériques
        # remontent, comportement identique à avant migration 057).
        for r in rows:
            self.rubriques[r["code"].strip()] = dict(r)

        # Alimentations
        for a in db.execute(text("""
            SELECT code_rubrique, code_attribut, source_type, table_source, donnee_source,
                   rubrique_source, attribut_source, valeur_constante, type_constante,
                   nbr_paies_recuperer
              FROM public.rubrique_paie_alimentation
        """)).mappings().all():
            self.alimentations.setdefault(a["code_rubrique"].strip(), []).append(dict(a))

        # Assiettes (rubrique -> assiettes alimentées)
        for a in db.execute(text("""
            SELECT code_rubrique, code_assiette, sens_assiette
              FROM public.rubrique_paie_assiette
        """)).mappings().all():
            self.assiettes_de.setdefault(a["code_rubrique"].strip(), []).append(
                (a["code_assiette"].strip(), a["sens_assiette"])
            )

        # Règles standard
        for r in db.execute(text("""
            SELECT code, formule_lisible, attribut_calcule, variable_cible, variables_requises
              FROM public.ref_regle_calcul_standard WHERE actif = true
        """)).mappings().all():
            self.regles_standard[r["code"]] = dict(r)

        # Règles spécifiques (par code de rubrique) + instructions actives, triées.
        # RG-MULTISOCIETE-03 : contrairement à bareme/constante/rubrique, une
        # règle ne se FUSIONNE pas -- si la société active a sa propre variante
        # (regle_calcul_specifique.societe_id renseigné) pour un code donné,
        # elle remplace ENTIÈREMENT la version générique pour ce code (jamais
        # les deux mélangées). DISTINCT ON choisit la ligne gagnante par code
        # avant même de joindre les instructions.
        regles_gagnantes = db.execute(text("""
            SELECT DISTINCT ON (rs.code) rs.id, rs.code AS code_rubrique
              FROM public.regle_calcul_specifique rs
             WHERE rs.actif = true AND rs.archive = false
               AND (rs.date_debut_validite IS NULL OR rs.date_debut_validite <= :ref)
               AND (rs.date_fin_validite   IS NULL OR rs.date_fin_validite   >= :ref)
               AND (rs.societe_id IS NULL OR rs.societe_id = :societe_id)
             ORDER BY rs.code, (rs.societe_id IS NULL) ASC
        """), {"ref": ref, "societe_id": str(self.societe_id) if self.societe_id else None}).mappings().all()
        ids_gagnants = [g["id"] for g in regles_gagnantes]
        code_par_regle_id = {g["id"]: g["code_rubrique"] for g in regles_gagnantes}
        if ids_gagnants:
            specs = db.execute(text("""
                SELECT i.regle_id, i.numero, i.instruction, i.label
                  FROM public.regle_specifique_instruction i
                 WHERE i.est_actif = true AND i.regle_id = ANY(CAST(:ids AS uuid[]))
                 ORDER BY i.regle_id, i.numero
            """), {"ids": ids_gagnants}).mappings().all()
            for s in specs:
                code_rubrique = code_par_regle_id[s["regle_id"]]
                self.regles_spec.setdefault(code_rubrique.strip(), []).append(
                    {"numero": s["numero"], "instruction": s["instruction"], "label": s["label"]}
                )

        # Barèmes (en-tête + clés + sorties + lignes). RG-MULTISOCIETE-03 :
        # générique (societe_id NULL) chargé en premier, spécifique société
        # ACTIVE ensuite -> écrase le générique sur même code.
        for b in db.execute(text("""
            SELECT id, code, libelle, societe_id FROM public.bareme
             WHERE archive = false AND actif = true
               AND (societe_id IS NULL OR societe_id = :societe_id)
             ORDER BY (societe_id IS NULL) DESC
        """), {"societe_id": str(self.societe_id) if self.societe_id else None}).mappings().all():
            bid = b["id"]
            self.libelles_baremes[b["code"]] = b.get("libelle")
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
            self.baremes[b["code"]] = {
                "cles": [dict(c) for c in cles],
                "sorties": [dict(s) for s in sorties],
                "lignes": [dict(l) for l in lignes],
            }

        # Constantes valides à la date de référence. RG-MULTISOCIETE-03 :
        # générique (societe_id NULL) chargé en premier (trié par updated_at
        # comme avant, doublon générique -> dernière prise), spécifique
        # société ACTIVE ensuite -> le dict retient la dernière écriture, donc
        # la valeur spécifique à la société prévaut toujours sur le générique.
        for c in db.execute(text("""
            SELECT code, libelle, valeur, societe_id FROM public.ref_constante_paie
             WHERE actif = true
               AND (date_debut IS NULL OR date_debut <= :ref)
               AND (date_fin   IS NULL OR date_fin   >= :ref)
               AND (societe_id IS NULL OR societe_id = :societe_id)
             ORDER BY (societe_id IS NULL) DESC, updated_at
        """), {"ref": ref, "societe_id": str(self.societe_id) if self.societe_id else None}).mappings().all():
            self.constantes[c["code"]] = c["valeur"]
            self.libelles_constantes[c["code"]] = c.get("libelle")

        # Salaire fixe du collaborateur valide à la date de référence
        sf = db.execute(text("""
            SELECT * FROM public.collaborateur_salaires_fixes
             WHERE collaborateur_id = :cid AND archive = false
               AND date_debut <= :ref
               AND (date_fin IS NULL OR date_fin >= :ref)
             ORDER BY date_debut DESC LIMIT 1
        """), {"cid": str(self.collaborateur_id), "ref": ref}).mappings().first()
        self.salaire_fixe = dict(sf) if sf else {}

        # Éléments variables VALIDÉS pour cette période (modèle enrichi).
        # Depuis la migration 46 : UNE ligne = UN élément variable complet,
        # avec une colonne dédiée par grandeur (valeur_base / valeur_nombre /
        # valeur_taux / valeur_montant), au lieu d'une ligne par attribut.
        # Le signe est désormais porté directement par la valeur numérique
        # (plus de colonne `sens`) — la structure interne self.elements
        # (clé (code_rubrique, attribut) -> liste de {"valeur": Decimal signé,
        # "mode":..., "type":...}) reste IDENTIQUE à avant : tout le reste du
        # moteur (resoudre_alimentation, ev_montant, cascades forçage/ajout)
        # est inchangé.
        #
        # RG-EV-VALIDITE : un EV est retenu dès que sa fenêtre de validité RECOUPE
        # la période de paie [date_debut ; date_fin] — sans prorata. Un EV valable
        # du 01 au 15 est donc pris en compte pour la totalité de sa valeur.
        # (Une date nulle = pas de borne de ce côté.)
        #
        # ⚠️ CORRECTIF (24/08) : `ev.periode_id = :pid` retiré du filtre. Cette
        # condition contredisait la règle RG-EV-VALIDITE ci-dessus : un EV saisi
        # avec une fenêtre de validité large (ex. toute l'année 2025) restait
        # malgré tout limité à la SEULE période sous laquelle il avait été créé
        # -- `date_debut`/`date_fin` n'avaient donc jamais d'effet réel au-delà
        # de cette période unique, contrairement à l'intention décrite. Un EV
        # saisi une fois avec une fenêtre couvrant plusieurs mois s'applique
        # désormais à CHAQUE bulletin qui recoupe cette fenêtre, pas seulement
        # celui de sa période de création. `periode_id` reste en base (utile
        # pour l'affichage/regroupement dans l'écran de saisie), simplement
        # plus utilisé comme filtre d'éligibilité ici.
        _COLONNE_PAR_ATTRIBUT = {
            "BASE": "valeur_base", "NOMBRE": "valeur_nombre",
            "TAUX": "valeur_taux", "MONTANT": "valeur_montant",
        }
        for e in db.execute(text("""
            SELECT ev.code_rubrique, ev.valeur_base, ev.valeur_nombre, ev.valeur_taux, ev.valeur_montant,
                   ev.code_type, COALESCE(t.mode_application, 'AJOUT') AS mode
              FROM public.element_variable ev
              LEFT JOIN public.ref_ev_type t ON t.code = ev.code_type
             WHERE ev.collaborateur_id = :cid
               AND ev.statut = 'VALIDE'
               AND (ev.date_debut IS NULL OR ev.date_debut <= :p_fin)
               AND (ev.date_fin   IS NULL OR ev.date_fin   >= :p_debut)
             ORDER BY ev.created_at
        """), {"cid": str(self.collaborateur_id),
               "p_debut": self.periode["date_debut"],
               "p_fin": self.periode["date_fin"]}).mappings().all():
            code_rub = e["code_rubrique"].strip()
            for attribut, colonne in _COLONNE_PAR_ATTRIBUT.items():
                if e[colonne] is None:
                    continue
                self.elements.setdefault((code_rub, attribut), []).append(
                    {"valeur": _dec(e[colonne]), "mode": e["mode"], "type": e["code_type"]}
                )

        # Régimes du collaborateur (affiliations actives)
        for rg in db.execute(text("""
            SELECT code_regime FROM public.collaborateur_regime
             WHERE collaborateur_id = :cid AND actif = true
        """), {"cid": str(self.collaborateur_id)}).mappings().all():
            self.regimes.add(rg["code_regime"])

    # ---- surcharges de simulation (RG-SIM-CTX-SURCHARGE-01) --------------
    def _appliquer_surcharges(self):
        """
        Appelée une fois, juste après _charger(). Sans effet si les deux
        dictionnaires de surcharge sont vides (cas réel).

        1) surcharges_rubrique -> injectées dans self.elements, au même
           format qu'un élément variable réel chargé depuis la base
           (RG-SIM-IND-04 : même grammaire attribut/sens). Ajoutées APRÈS
           les éléments réels déjà chargés : une surcharge en mode FORÇAGE
           l'emporte sur un élément variable réel existant (dernier forçage
           retenu, cf. resoudre_alimentation/appliquer()), une surcharge en
           mode AJOUT s'ajoute à l'existant — comportement identique à un EV
           saisi normalement.
        2) surcharges_table sur la table 'collaborateur_salaires_fixes' :
           appliquées directement sur self.salaire_fixe, car
           resoudre_alimentation() lit ce dict en direct pour cette table
           précise (cas particulier déjà existant dans le moteur, voir
           resoudre_alimentation), pas via valeur_table().
        """
        for (code_rubrique, attribut), surcharge in self.surcharges_rubrique.items():
            attr = (attribut or "").upper()
            if attr not in ("BASE", "NOMBRE", "TAUX", "MONTANT"):
                continue
            self.elements.setdefault((code_rubrique.strip(), attr), []).append({
                "valeur": _dec(surcharge.get("valeur")),
                "mode": (surcharge.get("mode") or "FORCAGE").upper(),
                "type": "SIMULATION",
            })

        if self.salaire_fixe:
            self.salaire_fixe = dict(self.salaire_fixe)  # copie : ne jamais muter la ligne réelle en cache
        for (table, colonne), valeur in self.surcharges_table.items():
            if table == "collaborateur_salaires_fixes":
                self.salaire_fixe[colonne] = valeur


# =====================================================================
# Barème : lookup par clé (EXACT / PLAGE)
# =====================================================================
def lookup_bareme(bareme: dict, cle_valeur: Decimal, sortie: str | None = None) -> Decimal:
    """
    Retourne la valeur de sortie du barème pour la clé donnée.
    Support mono-clé (cas courant : IR par tranche). 'sortie' = nom_technique,
    à défaut la sortie par_defaut.
    """
    if not bareme or not bareme["cles"]:
        return D0
    cle = bareme["cles"][0]
    nom_cle = cle["nom_technique"]
    mode = cle["mode"]

    # sortie cible
    nom_sortie = sortie
    if nom_sortie is None:
        defaut = next((s for s in bareme["sorties"] if s["par_defaut"]), None)
        nom_sortie = defaut["nom_technique"] if defaut else (
            bareme["sorties"][0]["nom_technique"] if bareme["sorties"] else None
        )
    if nom_sortie is None:
        return D0
    # RG-BAREME-LOOKUP-CASSE-01 (correctif) : le DSL met systématiquement le
    # nom de sortie en MAJUSCULES (BAREME(...).TAUX → "TAUX", cf. upperKeepStrings
    # côté éditeur), alors que nom_technique est TOUJOURS en minuscule côté barème
    # (contrainte du schéma Pydantic ^[a-z][a-z0-9_]*$). Sans normalisation, la
    # recherche dans valeurs_sorties échouait silencieusement (clé "TAUX"
    # introuvable dans {"taux": ...}) et retombait toujours à 0.
    nom_sortie = nom_sortie.lower()

    v = _dec(cle_valeur)
    for ligne in bareme["lignes"]:
        vc = ligne["valeurs_cles"].get(nom_cle)
        if vc is None:
            continue
        if mode == "PLAGE" and isinstance(vc, dict):
            mn = _dec(vc.get("min"))
            mx = _dec(vc.get("max"))
            if mn <= v <= mx:
                return _dec(ligne["valeurs_sorties"].get(nom_sortie))
        elif mode in ("LT", "LTE", "GT", "GTE"):
            # RG-BAREME-LOOKUP-COMPARAISON-01 (correctif) : jusqu'ici ces 4 modes
            # tombaient silencieusement dans le "else # EXACT" ci-dessous (égalité
            # stricte), qui ne matche quasiment jamais — d'où un lookup toujours à 0
            # malgré des lignes correctement renseignées. Sémantique de tranche
            # classique : les lignes sont parcourues dans l'ordre (déjà trié par
            # `ordre` au chargement), la PREMIÈRE dont le seuil satisfait la
            # comparaison l'emporte (équivalent à une table de tranches croissantes
            # où chaque ligne = plafond de la tranche).
            seuil = _dec(vc)
            correspond = (
                (mode == "LT" and v < seuil)
                or (mode == "LTE" and v <= seuil)
                or (mode == "GT" and v > seuil)
                or (mode == "GTE" and v >= seuil)
            )
            if correspond:
                return _dec(ligne["valeurs_sorties"].get(nom_sortie))
        else:  # EXACT
            if _dec(vc) == v:
                return _dec(ligne["valeurs_sorties"].get(nom_sortie))
    return D0


# =====================================================================
# DSL des règles spécifiques (port serveur de simulator.ts)
#   Registres R01..R99 ; accesseurs MT./NB./TY./BASE.<RUB> ;
#   opérateurs + - * / % , @MIN @MAX , @TAB <BAREME>[.<sortie>] ;
#   SI <cond> BRANCH <label> ; FIN/END/STOP ; sorties MT/NB/TY/BASE.
# =====================================================================
_ACCESSOR_RE = re.compile(r"\b(MT|NB|TY|BASE|MTC|NBC|MTP|NBP|TYP)\.([A-Z0-9_]+)\b")
_ARITH_OK = re.compile(r"^[\d\s+\-*/.()]+$")

# RG-DEPS-ACCESSEUR-BRACKET-01 (correctif, Adil DAIA) : _ACCESSOR_RE ci-dessus
# cible la syntaxe HISTORIQUE "MT.RUB" (encore utilisée par _resoudre_tokens
# pour les règles STANDARDS, cf. commentaire de section ci-dessus) — PAS la
# syntaxe "[RUB].MT" employée par toutes les règles SPÉCIFIQUES (regle_dsl.py,
# éditeur SmartRuleEditor). _dependances() appliquait par erreur _ACCESSOR_RE
# aux instructions des règles spécifiques, qui ne matche jamais "[RUB].MT" —
# la source (b) du graphe de dépendances (références DSL) était donc muette
# depuis le début pour toutes les règles spécifiques réelles. [RUB] seul
# (sans .ATTR, valant .MT par défaut — cf. parse_primary de regle_dsl.py) est
# aussi une dépendance valide, d'où le suffixe optionnel non capturant.
_ACCESSOR_BRACKET_RE = re.compile(r"\[([A-Z0-9_]+)\](?:\.[A-Z0-9_]+)?")
# VALEUR("RUB") lit l'attribut de la PÉRIODE COURANTE — même sémantique que
# [RUB], donc même contrainte d'ordre. À la différence de CUMUL/PREC/SOMME/
# MOYENNE qui lisent des périodes PASSÉES (aucune contrainte d'ordre requise
# sur la période en cours, volontairement non détectées ici).
_VALEUR_RE = re.compile(r'\bVALEUR\s*\(\s*"([A-Z0-9_]+)"')


def _resoudre_tokens(expr: str, registres: dict, results: dict, ctx: ContexteCalcul,
                     manquants: list, sorties: dict | None = None) -> str:
    """Remplace accesseurs, registres et identifiants nus par des valeurs (string)."""
    def repl_acc(m):
        kind, rub = m.group(1), m.group(2)
        r = results.get(rub)
        if kind in ("MTC", "NBC", "MTP", "NBP", "TYP"):
            # Cumuls / paie précédente : non alimentés dans cet incrément.
            manquants.append(f"{kind}.{rub} (cumul/antérieur non géré → 0)")
            return "0"
        if r is None:
            if ctx.is_assiette(rub):
                return "0"
            manquants.append(f"{kind}.{rub}")
            return "0"
        return str(r.get({"MT": "MT", "NB": "NB", "TY": "TY", "BASE": "BASE"}[kind], D0))

    out = _ACCESSOR_RE.sub(repl_acc, expr)
    # Registres (insensible à la casse : r01 == R01)
    out = re.sub(r"\b[Rr](\d{2})\b", lambda m: str(registres.get(f"R{m.group(1)}", D0)), out)
    # Identifiants nus MT/NB/TY/BASE = sortie courante de la règle
    if sorties is not None:
        out = re.sub(r"\b(MT|NB|TY|BASE)\b",
                     lambda m: str(_dec(sorties.get(m.group(1), D0))), out)
    return out


def _eval_arith(expr: str, ctx: ContexteCalcul) -> Decimal:
    s = expr.strip()

    # @TAB <BAREME>[.<sortie>]
    m = re.match(r"^(.+?)\s*@TAB\s+([A-Z0-9_]+)(?:\.([A-Z0-9_]+))?\s*$", s, re.I)
    if m:
        base = _eval_arith(m.group(1), ctx)
        bareme = ctx.baremes.get(m.group(2).upper()) or ctx.baremes.get(m.group(2))
        return lookup_bareme(bareme, base, m.group(3))

    # A @MIN B / A @MAX B
    m = re.match(r"^(.+?)\s*@(MIN|MAX)\s*(.+)$", s, re.I)
    if m:
        a = _eval_arith(m.group(1), ctx)
        b = _eval_arith(m.group(3), ctx)
        return min(a, b) if m.group(2).upper() == "MIN" else max(a, b)

    # A % B  ->  A * B / 100
    s = re.sub(r"(\d+(?:\.\d+)?)\s*%\s*(\d+(?:\.\d+)?)",
               lambda m: str((Decimal(m.group(1)) * Decimal(m.group(2))) / Decimal(100)), s)

    if not _ARITH_OK.match(s) or len(s) > 512:
        return D0
    try:
        # Expression entièrement filtrée (chiffres + opérateurs) → eval contrôlé.
        return _dec(eval(s, {"__builtins__": {}}, {}))  # noqa: S307
    except Exception:
        return D0


def _eval_condition(cond: str, ctx: ContexteCalcul) -> bool:
    m = re.match(r"^(.+?)\s*(=|<>|!=|<=|>=|<|>)\s*(.+)$", cond)
    if not m:
        return False
    a, op, b = _eval_arith(m.group(1), ctx), m.group(2), _eval_arith(m.group(3), ctx)
    return {
        "=": a == b, "<>": a != b, "!=": a != b,
        "<": a < b, ">": a > b, "<=": a <= b, ">=": a >= b,
    }.get(op, False)


class ResolverPaie:
    """
    Adaptateur entre le DSL (regle_dsl) et le contexte de calcul de paie.
    Fournit : valeurs des autres rubriques, constantes, dates, barèmes, cumuls et
    paies précédentes. bulletin_ligne historise BASE/NOMBRE/TAUX/MONTANT (colonnes
    base / nombre / taux / montant) : cumul / prec / somme / moyenne portent donc
    sur l'attribut demandé (MT/NB/TX/BASE), pas uniquement sur le montant.
    DATE/TEXTE ne sont pas agrégeables (SUM/AVG n'ont pas de sens) et retombent
    à 0 avec un avertissement si demandés à CUMUL/SOMME/MOYENNE/PREC.
    """
    # Attribut DSL -> colonne bulletin_ligne réellement historisée.
    _COL_ATTR = {"MT": "montant", "NB": "nombre", "TX": "taux", "BASE": "base"}

    def __init__(self, ctx: "ContexteCalcul", results: dict):
        self.ctx = ctx
        self.results = results
        self._cache: dict = {}
        self.manquants: list[str] = []

    def _colonne(self, attr: str, contexte: str) -> str:
        col = self._COL_ATTR.get(attr.upper())
        if col is None:
            self.manquant(f"{contexte} : attribut '{attr}' non historisé (MT/NB/TX/BASE uniquement)")
            return "montant"
        return col

    def attribut(self, code: str, attr: str = "MT"):
        row = self.results.get(code)
        if not row:
            self.manquant(f"[{code}]")
            return D0
        key = "TY" if attr.upper() == "TX" else attr.upper()
        v = row.get(key, D0)
        return v if attr.upper() in ("DATE", "TEXTE") else _dec(v)

    def constante(self, code: str):
        if code not in self.ctx.constantes:
            self.manquant(f"#{code}")
        return self.ctx.constante(code)

    def bareme(self, code: str, cle):
        b = self.ctx.baremes.get(code)
        if not b:
            self.manquant(f"BAREME({code})")
            return D0
        return lookup_bareme(b, _dec(cle))

    def bareme_sortie(self, code: str, cle, sortie: str) -> Decimal:
        # RG-DSL-BAREME-SORTIE-01 : BAREME("CODE", clé).SORTIE — lookup_bareme()
        # supporte déjà le paramètre sortie (utilisé par l'ancienne syntaxe
        # @TAB BAREME.SORTIE), simple délégation ici, même repli à 0 que bareme().
        b = self.ctx.baremes.get(code)
        if not b:
            self.manquant(f"BAREME({code}).{sortie}")
            return D0
        return lookup_bareme(b, _dec(cle), sortie)

    def date_paie(self) -> date:
        return self.ctx.date_reference

    def date_jour(self) -> date:
        return date.today()

    # RG-DSL-DATES-PERIODIQUES-01 (Adil DAIA) : lecture directe des flags
    # calendrier_paie.est_fin_* — self.ctx.periode est déjà la ligne
    # calendrier_paie de la période en cours de calcul (chargée une fois par
    # bulletin dans ContexteCalcul.__init__), aucune requête supplémentaire.
    def est_fin_mois(self) -> bool:
        return bool(self.ctx.periode.get("est_fin_mois"))

    def est_fin_trimestre(self) -> bool:
        return bool(self.ctx.periode.get("est_fin_trimestre"))

    def est_fin_semestre(self) -> bool:
        return bool(self.ctx.periode.get("est_fin_semestre"))

    def est_fin_annee(self) -> bool:
        return bool(self.ctx.periode.get("est_fin_annee"))

    def date_fin_contrat(self) -> date | None:
        # RG-DSL-DATES-PERIODIQUES-01 (Adil DAIA) : PAS via valeur_table() —
        # son filtre générique (date_fin IS NULL OR date_fin >= :ref) est
        # conçu pour "quelle ligne est valide À la date de référence" (ex.
        # salaire fixe courant), pas pour "quelle est sa date de fin, même
        # si elle est déjà dépassée à la date de référence". Si `ref` est
        # calée en fin de période et que le contrat se termine avant, la
        # ligne serait exclue et la fonction ne détecterait jamais rien.
        # Requête dédiée, avec la même introspection dynamique des colonnes
        # que _charger_ligne_table (pas de nom de colonne supposé en dur).
        db = self.ctx.db
        cols = {r[0] for r in db.execute(text("""
            SELECT column_name FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'collaborateur_contrats'
        """)).all()}
        if "date_fin" not in cols:
            return None
        where = ["collaborateur_id = :cid", "date_fin IS NOT NULL"]
        if "archive" in cols:
            where.append("archive = false")
        sql = f'SELECT date_fin FROM public.collaborateur_contrats WHERE {" AND ".join(where)} ORDER BY date_fin DESC LIMIT 1'
        v = db.execute(text(sql), {"cid": str(self.ctx.collaborateur_id)}).scalar()
        if v is None:
            return None
        if isinstance(v, date):
            return v
        try:
            return date.fromisoformat(str(v)[:10])
        except (ValueError, TypeError):
            return None

    def manquant(self, quoi: str) -> None:
        self.manquants.append(quoi)

    # ---- cumuls / historique (SQL sur les périodes antérieures) ----------
    def _plan(self):
        return self.ctx.periode.get("plan_paie_id")

    def cumul(self, code: str, attr: str = "MT", portee: str = "ANNEE") -> Decimal:
        col = self._colonne(attr, f'CUMUL("{code}")')
        k = ("cumul", code, attr.upper(), portee.upper())
        if k in self._cache:
            return self._cache[k]
        sql = f"""
            SELECT COALESCE(SUM(bl.{col}), 0)
              FROM public.bulletin_ligne bl
              JOIN public.bulletin b ON b.id = bl.bulletin_id
              JOIN public.calendrier_paie c ON c.id = b.periode_id
             WHERE b.collaborateur_id = :collab AND c.plan_paie_id = :plan
               AND c.date_reference < :ref AND bl.code_rubrique = :code
        """
        if portee.upper() == "ANNEE":
            sql += " AND c.annee = :annee"
        val = _dec(self.ctx.db.execute(text(sql), {
            "collab": str(self.ctx.collaborateur_id), "plan": str(self._plan()),
            "ref": self.ctx.date_reference, "code": code, "annee": self.ctx.annee,
        }).scalar())
        self._cache[k] = val
        return val

    def _historique(self, code: str, n: int, attr: str = "MT") -> list[Decimal]:
        col = self._colonne(attr, f'historique("{code}")')
        k = ("histo", code, n, attr.upper())
        if k in self._cache:
            return self._cache[k]
        rows = self.ctx.db.execute(text(f"""
            SELECT COALESCE((SELECT bl.{col} FROM public.bulletin_ligne bl
                              WHERE bl.bulletin_id = b.id AND bl.code_rubrique = :code
                              LIMIT 1), 0) AS v
              FROM public.bulletin b
              JOIN public.calendrier_paie c ON c.id = b.periode_id
             WHERE b.collaborateur_id = :collab AND c.plan_paie_id = :plan
               AND c.date_reference < :ref
             ORDER BY c.date_reference DESC
             LIMIT :n
        """), {"collab": str(self.ctx.collaborateur_id), "plan": str(self._plan()),
               "ref": self.ctx.date_reference, "code": code, "n": max(1, int(n))}).scalars().all()
        vals = [_dec(v) for v in rows]
        self._cache[k] = vals
        return vals

    def precedent(self, code: str, n: int = 1, attr: str = "MT") -> Decimal:
        h = self._historique(code, n, attr)
        return h[n - 1] if len(h) >= n else D0

    def somme(self, code: str, n: int, attr: str = "MT") -> Decimal:
        return sum(self._historique(code, n, attr), D0)

    def moyenne(self, code: str, n: int, attr: str = "MT") -> Decimal:
        h = self._historique(code, n, attr)
        return (sum(h, D0) / len(h)) if h else D0


class ResolverManuel:
    """Résolveur de SIMULATION : rubriques, cumuls et paies précédentes sont
    fournis à la main (ils dépendent d'un collaborateur réel, hors de portée
    du bac à sable) — mais constantes et barèmes sont lus RÉELLEMENT en base
    (`constantes_reelles` / `baremes_reels`, mêmes structures que
    `ContexteCalcul.constantes` / `ContexteCalcul.baremes`), pour que la
    simulation reflète fidèlement le paramétrage en vigueur.

    La saisie manuelle (`constantes`, `baremes`) reste possible et devient
    une SURCHARGE prioritaire — utile pour rejouer un cas particulier sans
    toucher au paramétrage réel — mais n'est plus obligatoire.

    Un accès non fourni ET non trouvé en base vaut 0 et est signalé en avertissement.
    """
    def __init__(self, rubriques=None, constantes=None, cumuls=None, precedents=None,
                 baremes=None, date_paie=None, date_jour=None,
                 constantes_reelles=None, baremes_reels=None):
        self.rubriques = rubriques or {}
        self.constantes = constantes or {}          # surcharge manuelle (prioritaire)
        self.cumuls = cumuls or {}
        self.precedents = precedents or {}
        self.baremes_ = baremes or {}                # surcharge manuelle (prioritaire)
        self.constantes_reelles = constantes_reelles or {}
        self.baremes_reels = baremes_reels or {}
        self._dp = date_paie
        self._dj = date_jour
        self.manquants: list[str] = []

    def attribut(self, code, attr="MT"):
        row = self.rubriques.get(code) or {}
        v = row.get(attr.upper())
        if v is None and attr.upper() == "TX":
            v = row.get("TY")
        if v is None:
            self.manquant(f"[{code}].{attr}")
            return D0
        return _dec(v) if attr.upper() not in ("DATE", "TEXTE") else v

    def constante(self, code):
        if code in self.constantes:            # surcharge manuelle explicite
            return _dec(self.constantes[code])
        if code in self.constantes_reelles:     # valeur réelle en base
            return _dec(self.constantes_reelles[code])
        self.manquant(f"#{code}")
        return D0

    def cumul(self, code, attr="MT", portee="ANNEE"):
        if code not in self.cumuls:
            self.manquant(f'CUMUL("{code}")')
        return _dec(self.cumuls.get(code, 0))

    def precedent(self, code, n=1, attr="MT"):
        v = self.precedents.get(f"{code}:{n}", self.precedents.get(code))
        if v is None:
            self.manquant(f'PREC("{code}",{n})')
            return D0
        return _dec(v)

    def somme(self, code, n, attr="MT"):
        if code not in self.cumuls:
            self.manquant(f'SOMME("{code}")')
        return _dec(self.cumuls.get(code, 0))

    def moyenne(self, code, n, attr="MT"):
        v = self.cumuls.get(code)
        if v is None:
            self.manquant(f'MOYENNE("{code}")'); return D0
        return _dec(v) / n if n else D0

    def bareme(self, code, cle):
        if code in self.baremes_:               # surcharge manuelle explicite (valeur forcée)
            return _dec(self.baremes_[code])
        if code in self.baremes_reels:           # vraie recherche par tranche/clé en base
            return lookup_bareme(self.baremes_reels[code], _dec(cle))
        self.manquant(f'BAREME("{code}")')
        return D0

    def bareme_sortie(self, code, cle, sortie):
        if code in self.baremes_:               # surcharge manuelle : valeur unique forcée,
            return _dec(self.baremes_[code])     # quelle que soit la sortie demandée (comme bareme())
        if code in self.baremes_reels:
            return lookup_bareme(self.baremes_reels[code], _dec(cle), sortie)
        self.manquant(f'BAREME("{code}").{sortie}')
        return D0

    def date_paie(self):
        return self._dp or date.today()

    def date_jour(self):
        return self._dj or date.today()

    def manquant(self, quoi):
        self.manquants.append(quoi)

def executer_specifique(instructions: list, results: dict, ctx: ContexteCalcul,
                        seed_vars: dict) -> tuple[dict, list, list]:
    """
    Exécute une règle spécifique. `seed_vars` initialise MT/NB/TY/BASE
    (issus de l'alimentation). Retourne (sorties, trace, avertissements).
    """
    registres: dict[str, Decimal] = {}
    sorties: dict[str, Decimal] = {k: _dec(v) for k, v in seed_vars.items()}
    for k in ("MT", "NB", "TY", "BASE"):
        sorties.setdefault(k, D0)
    trace, avert = [], []

    ordered = sorted([i for i in instructions if i["instruction"].strip()],
                     key=lambda x: x["numero"])
    label_index = {i["label"].upper(): idx for idx, i in enumerate(ordered) if i.get("label")}

    i, safety = 0, 0
    while i < len(ordered):
        safety += 1
        if safety > 1000:
            avert.append("Boucle d'exécution (>1000 itérations) — règle interrompue")
            break
        ligne = ordered[i]
        instr = ligne["instruction"].strip()
        # commentaire ';'
        if ";" in instr and not re.search(r"^\s*SI\b", instr, re.I):
            # ';' sépare des instructions inline (ex "r01=... ; R02=...") OU un commentaire.
            # On traite l'inline en éclatant sur ';'
            parts = [p for p in instr.split(";") if p.strip()]
            if len(parts) > 1:
                for p in parts:
                    _exec_atom(p.strip(), registres, sorties, results, ctx, trace, avert)
                i += 1
                continue
        stop = _exec_atom(instr, registres, sorties, results, ctx, trace, avert, label_index, ordered)
        if isinstance(stop, int):   # branchement -> nouvel index
            i = stop
            continue
        if stop == "FIN":
            break
        i += 1

    return sorties, trace, avert


def _exec_atom(instr, registres, sorties, results, ctx, trace, avert,
               label_index=None, ordered=None):
    """Exécute une instruction atomique. Retourne None, 'FIN', ou un index (branch)."""
    manquants: list = []

    # FIN / END / STOP
    if re.match(r"^\s*(FIN|END|STOP|FINTRT|FIN_TRT)\s*$", instr, re.I):
        trace.append({"instruction": instr, "resolu": "FIN"})
        return "FIN"

    # SI <cond> BRANCH <label>
    m = re.match(r"^SI\s+(.+?)\s+BRANCH\s+(\w+)\s*$", instr, re.I)
    if m and label_index is not None:
        cond = _resoudre_tokens(m.group(1), registres, results, ctx, manquants, sorties)
        pris = _eval_condition(cond, ctx)
        trace.append({"instruction": instr, "resolu": f"SI {cond}", "branch": {"vers": m.group(2), "pris": pris}})
        if pris:
            tgt = m.group(2).upper()
            if tgt in ("FIN", "END", "STOP"):
                return "FIN"
            idx = label_index.get(tgt)
            if idx is not None:
                return idx + 1
            avert.append(f"Label introuvable : {tgt}")
        return None

    # Affectation <CIBLE> = <expr>
    m = re.match(r"^(R\d{2}|MT|NB|TY|BASE)\s*=\s*(.+)$", instr, re.I)
    if m:
        cible = m.group(1).upper()
        resolu = _resoudre_tokens(m.group(2), registres, results, ctx, manquants, sorties)
        val = _eval_arith(resolu, ctx)
        if cible.startswith("R"):
            registres[cible] = val
        else:
            sorties[cible] = val
        entry = {"instruction": instr, "resolu": f"{cible} = {resolu}", "valeur": str(val)}
        if manquants:
            entry["avert"] = f"Accesseurs à 0 : {', '.join(manquants)}"
            avert.extend(manquants)
        trace.append(entry)
        return None

    trace.append({"instruction": instr, "resolu": instr, "avert": "Instruction non reconnue"})
    avert.append(f"Instruction non reconnue : {instr}")
    return None


# =====================================================================
# Alimentation des attributs (BASE / NOMBRE / TAUX / MONTANT)
# =====================================================================
_ATTR_MAP = {"BASE": "BASE", "NOMBRE": "NB", "NB": "NB", "TAUX": "TY", "TY": "TY",
             "MONTANT": "MT", "MT": "MT",
             "DATE": "DATE", "TEXTE": "TEXTE", "TXT": "TEXTE"}


def resoudre_alimentation(ctx: ContexteCalcul, code: str, results: dict) -> tuple[dict, list]:
    """
    Construit {BASE,NB,TY,MT} à partir des alimentations paramétrées, puis
    applique les éléments variables sur BASE/NB/TY selon leur mode :
      • AJOUT   : valeur_alimentée + Σ(éléments)
      • FORCAGE : remplace par le dernier forçage
    Les éléments sur MONTANT sont renvoyés à part (ev_montant) pour être
    appliqués APRÈS le calcul de la rubrique (forçage/ajout du résultat).
    Retourne (vals, avert, ev_montant).
    """
    vals = {"BASE": D0, "NB": D0, "TY": D0, "MT": D0, "DATE": None, "TEXTE": None}
    avert: list = []

    for a in ctx.alimentations.get(code, []):
        cible = _ATTR_MAP.get((a["code_attribut"] or "").upper())
        if cible is None:
            continue
        zone = cible in ("DATE", "TEXTE")   # valeur non numérique
        stype = a["source_type"]
        if stype == "TABLE":
            tbl = (a.get("table_source") or "").strip()
            if tbl and tbl != "collaborateur_salaires_fixes":
                src = ctx.valeur_table(tbl, a["donnee_source"]) if a["donnee_source"] else None
            else:
                src = ctx.salaire_fixe.get(a["donnee_source"]) if a["donnee_source"] else None
            if src is None and a["donnee_source"]:
                avert.append(f"{code}: '{a['donnee_source']}' introuvable dans {tbl or 'salaire fixe'}")
            vals[cible] = src if zone else _dec(src)
        elif stype == "CONSTANTE":
            if zone:
                vals[cible] = a["valeur_constante"]
            else:
                vals[cible] = ctx.constante(a["valeur_constante"]) if a["valeur_constante"] else D0
        elif stype == "RUBRIQUE":
            rub = a["rubrique_source"]
            attr = _ATTR_MAP.get((a["attribut_source"] or "MT").upper(), "MT")
            if rub and rub.strip() in results:
                v = results[rub.strip()].get(attr, D0)
                vals[cible] = v if zone else _dec(v)
            elif rub:
                avert.append(f"{code}: rubrique source '{rub}' non encore calculée")

    # Éléments variables sur BASE / NOMBRE / TAUX (entrées de calcul)
    def appliquer(cible: str, attr_saisi: str):
        elems = ctx.elements.get((code, attr_saisi))
        if not elems:
            return
        forcages = [e for e in elems if e["mode"] == "FORCAGE"]
        ajouts = [e for e in elems if e["mode"] != "FORCAGE"]
        if forcages:
            vals[cible] = forcages[-1]["valeur"]      # dernier forçage l'emporte
        for e in ajouts:
            vals[cible] = vals[cible] + e["valeur"]

    appliquer("BASE", "BASE")
    appliquer("NB", "NOMBRE")
    appliquer("TY", "TAUX")

    # Éléments sur MONTANT : appliqués après le calcul de la rubrique
    ev_montant = ctx.elements.get((code, "MONTANT"), [])

    return vals, avert, ev_montant


# =====================================================================
# Calcul d'une rubrique STANDARD via ref_regle_calcul_standard
# =====================================================================
def calc_standard(regle_code: str, vals: dict, ctx: ContexteCalcul) -> tuple[dict, list]:
    """Applique une formule standard. Retourne (sorties {MT,NB,TY,BASE}, avert)."""
    out = dict(vals)
    avert: list = []
    regle = ctx.regles_standard.get(regle_code)
    if not regle:
        avert.append(f"Règle standard '{regle_code}' introuvable")
        return out, avert

    b, nb, tx, mt = _dec(vals["BASE"]), _dec(vals["NB"]), _dec(vals["TY"]), _dec(vals["MT"])
    code = regle_code.upper()

    if code == "MT_EQ_NB_X_TX":
        out["MT"] = nb * tx
    elif code == "MT_EQ_NB_X_TX_DIV_100":
        out["MT"] = nb * tx / Decimal(100)
    elif code == "MT_EQ_BASE_X_TX_DIV_100":
        out["MT"] = b * tx / Decimal(100)
    elif code == "MT_PLUS_NB":
        out["MT"] = mt + nb
    elif code == "MT_MOINS_NB":
        out["MT"] = mt - nb
    elif code == "MT_PLUS_PCT_TX":
        out["MT"] = mt + (mt * tx / Decimal(100))
    elif code == "MT_MOINS_PCT_TX":
        out["MT"] = mt - (mt * tx / Decimal(100))
    elif code == "NB_EQ_MT_DIV_TX":
        out["NB"] = mt / tx if tx else D0
    elif code == "TX_EQ_MT_DIV_NB":
        out["TY"] = mt / nb if nb else D0
    elif code == "TX_EQ_MT_DIV_BASE_X100":
        out["TY"] = (mt / b * Decimal(100)) if b else D0
    elif code == "PRORATA_TEMPOREL":
        out["MT"] = b * ctx.jours_mois_presents() / Decimal(ctx.jours_mois) if hasattr(ctx, "jours_mois_presents") else b
    elif code in ("PLAFONNEMENT",):
        pl = ctx.constante("PLAFOND")  # placeholder ; plafond réel via alimentation TAUX/param
        out["MT"] = min(mt, pl) if pl else mt
    elif code == "PAS_DE_CALCUL":
        pass  # conserve les valeurs alimentées
    else:
        avert.append(f"Formule standard '{regle_code}' non prise en charge par le moteur (valeurs conservées)")
    return out, avert


# =====================================================================
# Ordre topologique
# =====================================================================
def _dependances(ctx: ContexteCalcul, code: str, contributeurs_assiette: dict) -> set:
    deps: set = set()
    r = ctx.rubriques.get(code, {})
    # RG-DEPS-SPECKEY-01 (correctif, Adil DAIA) : une rubrique peut pointer
    # vers une règle spécifique PARTAGÉE, dont le code diffère du sien (ex.
    # SALBASE.code_regle = "PRORATA", réutilisée par plusieurs rubriques) —
    # exactement la même résolution que la boucle de calcul principale
    # (spec_key), jusqu'ici DUPLIQUÉE INCORRECTEMENT ici : cette fonction
    # cherchait `ctx.regles_spec[code]` (le code de la RUBRIQUE) au lieu de
    # `ctx.regles_spec[code_regle]` (le code de la RÈGLE), ne trouvait donc
    # RIEN dès que les deux codes différaient, et ne détectait alors AUCUNE
    # dépendance DSL pour cette rubrique — silencieusement, sans erreur.
    _cr = (r.get("code_regle") or "").strip()
    spec_key = _cr if (r.get("type_regle") == "SPECIFIQUE" and _cr) else code
    # (a) alimentations RUBRIQUE + lecture d'assiette
    for a in ctx.alimentations.get(code, []):
        if a["source_type"] == "RUBRIQUE" and a["rubrique_source"]:
            src = a["rubrique_source"].strip()
            if ctx.is_assiette(src):
                deps |= contributeurs_assiette.get(src, set())
            else:
                deps.add(src)
    # (b) DSL spécifique : [RUB].ATTR ou [RUB] seul, + VALEUR("RUB") — syntaxe
    # réelle des règles spécifiques (RG-DEPS-ACCESSEUR-BRACKET-01), PAS
    # _ACCESSOR_RE qui cible l'ancienne syntaxe "MT.RUB" des règles standards
    for instr in ctx.regles_spec.get(spec_key, []):
        refs = _ACCESSOR_BRACKET_RE.findall(instr["instruction"]) + _VALEUR_RE.findall(instr["instruction"])
        for rub in refs:
            rub = rub.strip()
            if ctx.is_assiette(rub):
                deps |= contributeurs_assiette.get(rub, set())
            else:
                deps.add(rub)
    # (c) COT : assiette des composantes
    if r.get("code_type") == "COT":
        for a in _composantes_assiettes(ctx, code):
            deps |= contributeurs_assiette.get(a, set())
    deps.discard(code)
    return {d for d in deps if d in ctx.rubriques and not ctx.is_assiette(d)}


def _composantes_assiettes(ctx: ContexteCalcul, code_rubrique_cot: str) -> set:
    """Assiettes lues par les composantes qui alimentent cette rubrique COT."""
    rows = ctx.db.execute(text("""
        SELECT DISTINCT c.code_rubrique_assiette AS ass
          FROM public.regle_calcul_cotisation_composante c
         WHERE (TRIM(c.code_rubrique_part_salariale) = :code
             OR TRIM(c.code_rubrique_part_patronale) = :code)
           AND c.code_rubrique_assiette IS NOT NULL AND c.actif = true
    """), {"code": code_rubrique_cot}).mappings().all()
    return {r["ass"].strip() for r in rows if r["ass"]}


def _tri_topologique(ctx: ContexteCalcul, a_calculer: list) -> list:
    # contributeurs de chaque assiette
    contributeurs: dict[str, set] = {}
    for rub, liste in ctx.assiettes_de.items():
        for (ass, _sens) in liste:
            contributeurs.setdefault(ass, set()).add(rub)

    deps = {c: _dependances(ctx, c, contributeurs) & set(a_calculer) for c in a_calculer}
    ordre_hint = {c: (ctx.rubriques[c].get("ordre_calcul")
                      if ctx.rubriques[c].get("ordre_calcul") is not None else 10_000)
                  for c in a_calculer}

    # Kahn avec départage stable (ordre_calcul puis code)
    restants = set(a_calculer)
    resultat: list = []
    while restants:
        prets = sorted([c for c in restants if not (deps[c] & restants)],
                       key=lambda c: (ordre_hint[c], c))
        if not prets:  # cycle : on force le plus prioritaire
            prets = [sorted(restants, key=lambda c: (ordre_hint[c], c))[0]]
        for c in prets:
            resultat.append(c)
            restants.discard(c)
    return resultat


# =====================================================================
# Calcul du bulletin
# =====================================================================
def calculer_bulletin(db: Session, collaborateur_id: UUID, periode_id: UUID,
                       surcharges_rubrique: dict[tuple[str, str], dict] | None = None,
                       surcharges_table: dict[tuple[str, str], object] | None = None,
                       ignorer_statut_periode: bool = False,
                       inclure_rubriques_simulation: bool = False,
                       surcharges_regime: dict[str, dict] | None = None,
                       cumuls_simules_precedents: dict[str, list[tuple[int, Decimal, Decimal]]] | None = None) -> dict:
    """
    Point d'entrée public — signature INCHANGÉE sur les 3 premiers paramètres
    positionnels pour tous les appelants existants (routeurs, tests de règle,
    etc.) : aucun appel existant à `calculer_bulletin(db, collaborateur_id,
    periode_id)` n'est affecté.

    Les 5 derniers paramètres, réservés au module Simulation, sont
    mot-clé uniquement, tous par défaut à une valeur neutre (None / False) —
    voir `_calculer_bulletin_coeur` pour leur détail. Pour une simulation,
    préférer `simuler_bulletin()` plutôt qu'activer ces drapeaux ici
    directement.

    RG-RUB-EN-NET-01 (Adil DAIA) : si une ou plusieurs rubriques sont
    paramétrées `rubrique_en_net = true` et reçoivent une valeur non nulle
    depuis leur source normale (élément variable MONTANT ou alimentation
    TABLE directe sur MT), cette valeur est un NET À GARANTIR, pas le
    montant final. Le brut équivalent est recherché par dichotomie : à
    chaque itération, LE BULLETIN COMPLET est recalculé avec ce brut deviné
    injecté à la place de la rubrique — nécessaire puisque son propre
    traitement (cotisations, IR…) découle de son paramétrage habituel, pas
    d'une formule isolée qu'on pourrait inverser analytiquement.

    S'il y a plusieurs rubriques concernées, elles sont résolues UNE PAR
    UNE, dans l'ordre où `_calculer_bulletin_coeur` les détecte (l'ordre
    topologique du calcul) — chaque rubrique déjà résolue est figée à son
    brut trouvé avant de passer à la suivante. Pas de résolution simultanée
    multi-variables (hors de portée du besoin exprimé).

    Cas normal (aucune rubrique `rubrique_en_net` avec une valeur à ce jour) :
    un seul appel à la fonction cœur, aucun surcoût.
    """
    _kw = dict(surcharges_rubrique=surcharges_rubrique, surcharges_table=surcharges_table,
               ignorer_statut_periode=ignorer_statut_periode,
               inclure_rubriques_simulation=inclure_rubriques_simulation,
               surcharges_regime=surcharges_regime,
               cumuls_simules_precedents=cumuls_simules_precedents)
    resultat, net_demande = _calculer_bulletin_coeur(db, collaborateur_id, periode_id, **_kw)
    if not net_demande:
        return resultat

    overrides: dict[str, Decimal] = {}
    for code, montant_net in net_demande.items():
        # 1) "Bulletin sans cette rubrique" (elle est forcée à 0, les autres
        #    rubriques en_net déjà résolues restent figées à leur brut trouvé).
        base_sans, _ = _calculer_bulletin_coeur(db, collaborateur_id, periode_id,
                                                  {**overrides, code: D0}, **_kw)
        net_cible = _dec(base_sans["totaux"]["net_a_payer"]) + montant_net

        def net_pour(brut: Decimal, _code=code) -> Decimal:
            res, _ = _calculer_bulletin_coeur(db, collaborateur_id, periode_id,
                                                {**overrides, _code: brut}, **_kw)
            return _dec(res["totaux"]["net_a_payer"])

        overrides[code] = _bruter_par_dichotomie(net_pour, net_cible, montant_net)

    resultat_final, _ = _calculer_bulletin_coeur(db, collaborateur_id, periode_id, overrides, **_kw)
    return resultat_final


def simuler_bulletin(db: Session, collaborateur_id: UUID, periode_id: UUID,
                      surcharges_rubrique: dict[tuple[str, str], dict] | None = None,
                      surcharges_table: dict[tuple[str, str], object] | None = None,
                      surcharges_regime: dict[str, dict] | None = None,
                      cumuls_simules_precedents: dict[str, list[tuple[int, Decimal, Decimal]]] | None = None) -> dict:
    """
    Point d'entrée public du module SIMULATION (UC1 — bulletin d'un
    collaborateur existant, cf. proposition de module Simulation, §9bis du
    document de besoins). Ne modifie ni n'ajoute AUCUNE règle de calcul :
    délègue entièrement à `calculer_bulletin()`, avec `ignorer_statut_periode
    = True` (RG-SIM-IND-02 — le statut de la période, y compris CLOTUREE, ne
    bloque jamais une simulation) et les surcharges ponctuelles fournies
    (RG-SIM-IND-04).

    Ne persiste RIEN — exactement comme `calculer_bulletin()`, qui ne
    persiste déjà rien : la persistance d'un bulletin réel est de la seule
    responsabilité du routeur appelant (jamais de ce module). Ce point
    d'entrée dédié existe pour que l'intention "ceci est une simulation, pas
    un calcul réel" soit explicite et non ambiguë côté appelant — au lieu
    d'activer `ignorer_statut_periode` directement sur `calculer_bulletin()`.

    Inclut également les rubriques `simulation_seulement` (migration 061) —
    c'est précisément l'endroit où elles doivent apparaître, jamais dans un
    calcul réel (`calculer_bulletin()` sans ce point d'entrée les exclut
    toujours par défaut).

    surcharges_rubrique : {(code_rubrique, attribut): {"valeur":..., "mode":
    "AJOUT"|"FORCAGE"}}, attribut parmi BASE/NOMBRE/TAUX/MONTANT.
    surcharges_table : {(table, colonne): valeur} pour les champs de contrat
    simulables (ex. ('collaborateur_contrats', 'code_temps')).
    surcharges_regime : {code_regle: {"mode":..., "taux_salarial":...,
    "taux_patronal":..., "forcer_affectation":..., "valeur_bareme_taux_simulee":...}}
    — RG-SIM-COTISATION-01, voir ContexteCalcul.__init__.
    """
    return calculer_bulletin(db, collaborateur_id, periode_id,
                              surcharges_rubrique=surcharges_rubrique,
                              surcharges_table=surcharges_table,
                              ignorer_statut_periode=True,
                              inclure_rubriques_simulation=True,
                              surcharges_regime=surcharges_regime,
                              cumuls_simules_precedents=cumuls_simules_precedents)


def _bruter_par_dichotomie(net_pour, net_cible: Decimal, estimation_depart: Decimal,
                            tolerance: Decimal = Decimal("0.01"), max_iter: int = 30) -> Decimal:
    """
    Cherche par dichotomie le montant BRUT tel que net_pour(brut) ≈ net_cible.
    Hypothèse : net_pour est croissante avec brut (vrai en pratique tant que
    les cotisations/l'IR ne sont pas dégressifs — cas normal en paie).
    Borne basse = 0 (jamais de brut négatif) ; borne haute doublée tant
    qu'elle ne suffit pas à dépasser la cible (au plus 20 doublements — un
    brut > 1000× le net demandé signale un paramétrage anormal plutôt
    qu'une vraie limite à repousser indéfiniment).
    """
    lo, hi = D0, max(_dec(estimation_depart), Decimal("100"))
    tours = 0
    while net_pour(hi) < net_cible and tours < 20:
        hi *= 2
        tours += 1
    for _ in range(max_iter):
        mid = (lo + hi) / 2
        n = net_pour(mid)
        if abs(n - net_cible) <= tolerance:
            return q2(mid)
        if n < net_cible:
            lo = mid
        else:
            hi = mid
    return q2((lo + hi) / 2)


def _calculer_bulletin_coeur(db: Session, collaborateur_id: UUID, periode_id: UUID,
                              overrides_brut: dict[str, Decimal] | None = None,
                              surcharges_rubrique: dict[tuple[str, str], dict] | None = None,
                              surcharges_table: dict[tuple[str, str], object] | None = None,
                              ignorer_statut_periode: bool = False,
                              inclure_rubriques_simulation: bool = False,
                              surcharges_regime: dict[str, dict] | None = None,
                              cumuls_simules_precedents: dict[str, list[tuple[int, Decimal, Decimal]]] | None = None) -> tuple[dict, dict[str, Decimal]]:
    """
    Calcule (sans persister) le bulletin d'un collaborateur pour une période.
    Retourne (résultat, net_demande) :
      - résultat : dict prêt à sérialiser (voir schemas/paie_calcul.py) ;
      - net_demande : {code_rubrique: montant} pour chaque rubrique
        `rubrique_en_net` dont la valeur brute normale (alimentation TABLE
        directe sur MT, ou élément variable MONTANT) est non nulle — à
        interpréter comme un NET à garantir, pas comme le montant final.
        Vide si aucune rubrique de ce type n'est concernée cette passe.

    `overrides_brut` : {code_rubrique: montant} — force le MT final de ces
    rubriques (bypass alimentation/règle/EV), utilisé par calculer_bulletin()
    pour injecter le brut deviné pendant la recherche par dichotomie, ou 0
    pour la passe "bulletin sans cette rubrique". Ne PAS appeler directement
    depuis un routeur — passer par calculer_bulletin() (RG-RUB-EN-NET-01).

    Les quatre derniers paramètres sont réservés au module Simulation
    (RG-SIM-*, proposition — sans effet, donc sans risque de régression, tant
    qu'ils ne sont pas fournis) :
      • `surcharges_rubrique` / `surcharges_table` sont simplement transmis à
        `ContexteCalcul` (voir RG-SIM-CTX-SURCHARGE-01) ;
      • `ignorer_statut_periode=True` autorise le calcul sur une période dans
        n'importe quel statut (CLOTUREE comprise) — RG-SIM-IND-02 : le statut
        de la période ne doit jamais bloquer une simulation, contrairement à
        un calcul réel. Passer par `simuler_bulletin()` plutôt que d'activer
        ce drapeau directement depuis un routeur.
      • `inclure_rubriques_simulation=True` inclut les rubriques
        `simulation_seulement` (migration 061) dans le contexte de calcul.
      • `surcharges_regime` : voir ContexteCalcul.__init__ pour le détail —
        simplement transmis tel quel.
      • `cumuls_simules_precedents` (RG-SIM-POPULATION-08, Adil DAIA :
        "le système doit prendre en compte le cumul des périodes
        précédentes du même exercice, même principe qu'une paie normale")
        — {code_rubrique: [(mois, montant, nombre), ...]}, MÊME structure
        que `cumuls_ant` (interne, alimentée depuis public.cumul, qui ne
        contient QUE des périodes réellement clôturées). Une simulation
        multi-périodes (population) ne persiste JAMAIS ses résultats dans
        public.cumul — sans ce paramètre, la période 2 simulée d'un exercice
        ne verrait donc PAS l'apport de la période 1 simulée du même
        exercice, sous-évaluant tous les cumuls au fil de l'enchaînement.
        L'appelant (population job) est responsable de construire et faire
        progresser ce dict, période par période, en y ajoutant le
        montant/nombre de CHAQUE ligne du résultat qu'il vient de calculer.
        Fusionné ici avec `cumuls_ant` (les deux sources cohabitent : réel
        avant le début de la simulation, simulé pendant).
    """
    overrides_brut = overrides_brut or {}
    net_demande: dict[str, Decimal] = {}
    periode = db.execute(text("""
        SELECT id, plan_paie_id, annee, mois, numero_periode, date_debut, date_fin,
               date_reference, statut, est_fin_mois, est_fin_trimestre, est_fin_semestre, est_fin_annee,
               societe_id
          FROM public.calendrier_paie WHERE id = :pid
    """), {"pid": str(periode_id)}).mappings().first()
    if not periode:
        raise HTTPException(404, "Période (calendrier_paie) introuvable")
    if not ignorer_statut_periode and periode["statut"] not in ("OUVERTE", "CALCULEE"):
        raise HTTPException(400, f"Période au statut '{periode['statut']}' : calcul non autorisé")

    collab = db.execute(text("""
        SELECT id, matricule, nom, prenom FROM public.collaborateurs WHERE id = :cid
    """), {"cid": str(collaborateur_id)}).mappings().first()
    if not collab:
        raise HTTPException(404, "Collaborateur introuvable")

    # Plan de paie de la période (figé sur les résultats)
    plan = db.execute(text("""
        SELECT id, code, libelle FROM public.plan_paie WHERE id = :pid
    """), {"pid": str(periode["plan_paie_id"])}).mappings().first() if periode["plan_paie_id"] else None
    plan_id = str(plan["id"]) if plan else None
    code_plan = plan["code"] if plan else None

    ctx = ContexteCalcul(db, collaborateur_id, dict(periode),
                         surcharges_rubrique=surcharges_rubrique,
                         surcharges_table=surcharges_table,
                         inclure_rubriques_simulation=inclure_rubriques_simulation,
                         surcharges_regime=surcharges_regime)

    # Cumuls des périodes ANTÉRIEURES (même année, même plan), DÉTAILLÉS par mois,
    # pour reconstituer le cumul « à date » selon la fréquence de RAZ de la rubrique.
    cumuls_ant: dict[str, list] = {}
    for row in db.execute(text("""
        SELECT code_rubrique, mois,
               COALESCE(SUM(montant), 0) AS mt,
               COALESCE(SUM(nombre), 0)  AS nb
          FROM public.cumul
         WHERE collaborateur_id = :cid AND annee = :annee
           AND (mois IS NULL OR mois < :mois)
           AND (:cp IS NULL OR code_plan = :cp)
         GROUP BY code_rubrique, mois
    """), {"cid": str(collaborateur_id), "annee": ctx.annee, "mois": ctx.mois,
           "cp": code_plan}).mappings().all():
        cumuls_ant.setdefault(row["code_rubrique"].strip(), []).append(
            (row["mois"] or 0, _dec(row["mt"]), _dec(row["nb"])))

    # RG-SIM-POPULATION-08 : ajoute les cumuls SIMULÉS des périodes
    # précédentes du même exercice (jamais présents dans public.cumul,
    # puisqu'une simulation ne persiste rien) — même structure, mêmes
    # clés, simple extension de la liste par code_rubrique.
    if cumuls_simules_precedents:
        for code, entrees in cumuls_simules_precedents.items():
            cumuls_ant.setdefault(code, []).extend(entrees)

    def cumul_a_date(code: str, freq_raz, mt_periode: Decimal, nb_periode: Decimal) -> tuple[Decimal, Decimal]:
        # Mois de reprise du cumul selon la fréquence de RAZ paramétrée sur la rubrique
        mois_debut = _mois_debut_raz(freq_raz, ctx.mois)
        mt, nb = _dec(mt_periode), _dec(nb_periode)
        for (m, cmt, cnb) in cumuls_ant.get(code, []):
            if m >= mois_debut:            # dans la fenêtre courante de cumul
                mt += cmt
                nb += cnb
        return mt, nb

    # Rubriques à calculer = toutes sauf les assiettes (accumulateurs, jamais
    # concernées par les populations — ce sont des accumulateurs internes,
    # pas des rubriques auxquelles un collaborateur "a droit").
    #
    # RG-POPULATION-RUBRIQUE-01 (Adil DAIA) : opt-in strict — une rubrique
    # sans AUCUNE population qui lui soit attribuée (directement ou via la
    # cascade rubrique_paie_dependance_acces) n'est calculée pour PERSONNE.
    # Toutes les rubriques actives ont été rattachées à la population "TOUS"
    # par la migration 24_population_paie.sql, donc rien ne change tant
    # qu'une rubrique n'est pas explicitement restreinte.
    # RG-MULTISOCIETE-07 (migration 057) : societe_id obligatoire --
    # populations_du_collaborateur() (population_paie.py) ne fonctionne
    # plus sans lui depuis le correctif de fuite inter-société.
    eligibles = rubriques_eligibles(db, collaborateur_id, ctx.date_reference, str(ctx.societe_id))
    a_calculer = [c for c, r in ctx.rubriques.items() if r.get("code_type") != "ASS" and c in eligibles]
    ordre = _tri_topologique(ctx, a_calculer)

    results: dict[str, dict] = {}       # code -> {MT,NB,TY,BASE}
    assiettes: dict[str, dict] = {}     # code_assiette -> {MT,NB,TY,BASE} cumulés
    lignes: list = []
    trace_globale: list = []
    messages: list = []

    # RG-CONFIG-INCOMPLETE-01 (24/08) : un bulletin à 0,00 MAD PARTOUT sans
    # le moindre message est indiscernable d'un vrai résultat nul (ex. un
    # collaborateur en congé sans solde tout le mois) -- vécu en usage réel
    # lors de la mise en service d'une 2e société : `eligibles` vide car
    # aucune population de paie ne couvrait encore ce collaborateur, et rien
    # ne le signalait avant que ça n'arrive jusqu'à l'écran. Avertissement
    # explicite désormais pour COURT-CIRCUITER ce diagnostic à l'avenir --
    # ne bloque jamais le calcul (reste un avertissement, pas une erreur),
    # mais rend le bulletin "avec_avert" (déjà remonté dans /paie/synthese
    # et le filtre "Anomalies" de /bulletins/recherche).
    # ⚠️ `messages` est une LISTE DE CHAÎNES (confirmé : paie_calcul.py fait
    # "; ".join(res["messages"][:2]) — un objet {niveau, code, texte} ici
    # cassait ce join avec TypeError, d'où le "Failed to fetch" en usage réel
    # le 24/08). Chaîne simple uniquement, jamais de dict/objet structuré.
    if not eligibles:
        messages.append(
            "AVERTISSEMENT — Aucune rubrique éligible pour ce collaborateur sur cette "
            "période : il n'appartient à aucune population de paie active pour sa "
            "société, ou les populations qui le couvrent n'ont aucune rubrique "
            "attribuée. Le bulletin sera calculé à 0,00 MAD partout tant que ce "
            "paramétrage n'est pas complété (Paramétrage > Populations)."
        )

    def pousser_assiettes(code: str, res: dict):
        """
        Alimente les assiettes de la rubrique `code` : à CHAQUE traitement d'une
        rubrique contributrice, on cumule ses NB, TY et MT (et BASE) dans
        l'assiette, avec le sens PLUS/MOINS.
            assiette.NB = assiette.NB + (± NB_rubrique)   (idem TY, MT, BASE)
        L'assiette est exposée dans `results` pour que le DSL puisse lire
        NB.<ASS> / TY.<ASS> / MT.<ASS>.
        """
        for (ass, sens) in ctx.assiettes_de.get(code, []):
            signe = Decimal(1) if sens == "PLUS" else Decimal(-1)
            acc = assiettes.setdefault(ass, {"MT": D0, "NB": D0, "TY": D0, "BASE": D0})
            for g in ("MT", "NB", "TY", "BASE"):
                acc[g] = acc[g] + signe * _dec(res.get(g, D0))
            results[ass] = dict(acc)   # snapshot lisible par le DSL/alimentation

    for code in ordre:
        r = ctx.rubriques[code]
        code_type = r.get("code_type")
        type_regle = r.get("type_regle")
        # Clé de résolution d'une règle SPÉCIFIQUE : soit la règle explicitement
        # associée (code_regle quand type_regle = SPECIFIQUE), soit — rétrocompat —
        # une règle spécifique nommée comme la rubrique.
        _cr = (r.get("code_regle") or "").strip()
        spec_key = _cr if (type_regle == "SPECIFIQUE" and _cr) else code
        etape = {"rubrique": code, "libelle": r.get("libelle"), "type": code_type,
                 "type_regle": type_regle, "detail": [], "algo": [], "avert": []}

        vals, av0, ev_montant = resoudre_alimentation(ctx, code, results)
        etape["avert"] += av0

        mt_pat = None  # part patronale (cotisations)

        # ---- COTISATION -------------------------------------------------
        if code_type == "COT":
            assiettes_cot = _composantes_assiettes(ctx, code)
            base_cot = sum((assiettes.get(a, {}).get("MT", D0) for a in assiettes_cot), D0)
            # règles de cotisation dont une composante alimente CETTE rubrique
            regles = db.execute(text("""
                SELECT DISTINCT rc.code
                  FROM public.regle_calcul_cotisation rc
                  JOIN public.regle_calcul_cotisation_composante c ON c.id_regle = rc.id
                 WHERE (TRIM(c.code_rubrique_part_salariale) = :code
                     OR TRIM(c.code_rubrique_part_patronale) = :code)
                   AND rc.actif = true AND rc.archive = false
            """), {"code": code}).mappings().all()
            tot_sal, tot_pat = D0, D0
            # RG-COTISATION-BASE-TAUX-01 (Adil DAIA) : jusqu'ici seuls les
            # montants (compo.montant_salarial/patronal) étaient récupérés —
            # base et taux, pourtant renvoyés par calculer_cotisation(),
            # étaient jetés. Résultat : bulletin_ligne.base/.taux restaient
            # NULL pour toutes les lignes de cotisation, alors que montant
            # était rempli — impossible d'expliquer le calcul (montant =
            # base × taux / 100) à la lecture du bulletin.
            # `base_appliquee` (pas le `base_cot` brut plus haut) est la
            # bonne valeur à afficher : c'est l'assiette APRÈS plafond,
            # celle réellement multipliée par le taux pour obtenir le
            # montant — sinon Montant ≠ Base × Taux dès qu'un plafond
            # (ex. plafond CNSS) tronque l'assiette.
            base_retenue, taux_retenu = None, None
            for rg in regles:
                try:
                    # ctx.surcharges_regime[code_regle] est un dict PLAT :
                    # {"mode":..., "taux_salarial":..., "taux_patronal":...,
                    #  "forcer_affectation":..., "valeur_bareme_taux_simulee":...}
                    # — reconstruit ici la forme attendue par calculer_cotisation()
                    # (surcharge_taux imbriqué, ou None si aucun taux fourni).
                    surcharge_regle = ctx.surcharges_regime.get(rg["code"]) or {}
                    surcharge_taux = None
                    if surcharge_regle.get("taux_salarial") is not None or surcharge_regle.get("taux_patronal") is not None:
                        surcharge_taux = {
                            "mode": surcharge_regle.get("mode", "AJOUT"),
                            "taux_salarial": surcharge_regle.get("taux_salarial"),
                            "taux_patronal": surcharge_regle.get("taux_patronal"),
                        }
                    req = CotisationCalculRequest(
                        code_regle=rg["code"], collaborateur_id=collaborateur_id,
                        assiette_montant=base_cot, periode_mois=ctx.date_reference,
                        jours_presents=None, jours_du_mois=ctx.jours_mois,
                    )
                    res = calculer_cotisation(
                        db, req,
                        surcharge_taux=surcharge_taux,
                        forcer_affectation=bool(surcharge_regle.get("forcer_affectation")),
                        valeur_bareme_taux_simulee=surcharge_regle.get("valeur_bareme_taux_simulee"),
                        # RG-MULTISOCIETE-03 (migration 057) : societe_id de
                        # la période en cours de calcul (self.societe_id,
                        # déjà porté par ContexteCalcul) -- sans ça,
                        # _resoudre_taux_bareme_exact() dans cotisation_engine
                        # ne verrait jamais une surcharge de barème CIMR
                        # propre à une société, même appelée depuis un calcul
                        # de paie réel.
                        societe_id=str(ctx.societe_id) if ctx.societe_id else None,
                    )
                    for compo in res.composantes:
                        if compo.code_rubrique_part_salariale and compo.code_rubrique_part_salariale.strip() == code:
                            tot_sal += _dec(compo.montant_salarial)
                            base_retenue = _dec(compo.base_appliquee)
                            if compo.taux_salarial is not None:
                                taux_retenu = _dec(compo.taux_salarial)
                        if compo.code_rubrique_part_patronale and compo.code_rubrique_part_patronale.strip() == code:
                            tot_pat += _dec(compo.montant_patronal)
                            base_retenue = _dec(compo.base_appliquee)
                            if compo.taux_patronal is not None:
                                taux_retenu = _dec(compo.taux_patronal)
                    etape["detail"].append(f"règle {rg['code']} sur assiette {q2(base_cot)}")
                except HTTPException as e:
                    etape["avert"].append(f"cotisation {rg['code']}: {e.detail}")
            vals["MT"] = tot_sal
            if base_retenue is not None:
                vals["BASE"] = base_retenue
            if taux_retenu is not None:
                vals["TY"] = taux_retenu
            # NB (nombre) reste vide pour une cotisation : il n'y a pas
            # d'équivalent "nombre" pour un taux appliqué à une assiette —
            # contrairement à Base/Taux/Montant, qui, eux, expliquent
            # entièrement le calcul.
            mt_pat = tot_pat

        # ---- SPÉCIFIQUE (DSL) ------------------------------------------
        elif spec_key in ctx.regles_spec:
            _seed = {"MT": vals["MT"], "NB": vals["NB"], "TX": vals["TY"], "BASE": vals["BASE"],
                     "DATE": vals.get("DATE"), "TEXTE": vals.get("TEXTE")}
            _rslv = ResolverPaie(ctx, results)
            sorties, tr, av = regle_dsl.executer(ctx.regles_spec[spec_key], _rslv, _seed)
            vals["MT"] = _dec(sorties.get("MT"))
            vals["NB"] = _dec(sorties.get("NB"))
            vals["TY"] = _dec(sorties.get("TX"))
            vals["BASE"] = _dec(sorties.get("BASE"))
            if sorties.get("DATE") is not None:
                vals["DATE"] = sorties.get("DATE")
            if sorties.get("TEXTE") not in (None, ""):
                vals["TEXTE"] = sorties.get("TEXTE")
            etape["detail"] += [t.get("resolu", "") for t in tr]
            _libs = {
                "rubriques": {c: (rr.get("libelle_edition") or rr.get("libelle"))
                              for c, rr in ctx.rubriques.items()},
                "constantes": ctx.libelles_constantes,
                "baremes": ctx.libelles_baremes,
            }
            etape["algo"] = [{"instruction": t.get("instruction", ""),
                              "resolu": t.get("resolu", ""),
                              "explication": regle_dsl.expliquer(t.get("instruction", ""), _libs),
                              "avert": t.get("avert")} for t in tr]
            etape["avert"] += av

        # ---- STANDARD (formule) ----------------------------------------
        elif r.get("code_regle") and type_regle != "SPECIFIQUE":
            vals, av = calc_standard(r["code_regle"], vals, ctx)
            etape["avert"] += av

        # ---- BARÈME direct ---------------------------------------------
        elif type_regle == "BAREME":
            etape["avert"].append("Rubrique BARÈME sans règle spécifique de lookup — valeur conservée")

        # ---- Repli : aucun calcul câblé --------------------------------
        # RG-PAIE-REPLI-BASE-01 (correctif, révisé — Adil DAIA, décision
        # explicite) : la BASE est une information (ex. capital restant
        # d'un prêt), jamais une source de calcul automatique du MONTANT.
        # Le repli MT = BASE ne doit donc être sauté QUE si un FORÇAGE est
        # sur le point de s'appliquer juste après (il écrasera MT de toute
        # façon, quelle que soit sa valeur de départ — calculer le repli
        # avant serait un travail inutile, jamais une erreur).
        #
        # Un simple AJOUT (surcharge/EV en mode AJOUT, sans forçage), lui,
        # DOIT partir de MT = BASE, jamais de zéro : une surcharge "+25%"
        # sur l'Indemnité de Responsabilité (BASE=1000, aucune règle
        # câblée) doit donner 1000 + 250 = 1250, jamais 250 seul — sinon la
        # base d'origine de la rubrique est purement et simplement perdue.
        # Concilie les deux cas connus :
        #   • Retenue de prêt (BASE=4000 capital restant, MONTANT=1000
        #     échéance en FORÇAGE) → 1000 (le forçage écrase, comme avant).
        #   • Indemnité de Responsabilité (BASE=1000, +25% en AJOUT via
        #     scénario) → 1250 (le repli s'applique, puis l'ajout).
        else:
            if vals["MT"] == D0 and vals["BASE"] != D0 and not any(e["mode"] == "FORCAGE" for e in ev_montant):
                vals["MT"] = vals["BASE"]
                etape["detail"].append("repli : MT = BASE (aucune règle définie)")
            elif vals["MT"] == D0 and not ev_montant:
                etape["avert"].append("aucune règle de calcul câblée (MT = 0)")

        # ---- Éléments variables sur MONTANT : agissent sur le RÉSULTAT ----
        #      FORCAGE remplace le montant calculé ; AJOUT s'y ajoute (en
        #      partant de vals["MT"] tel qu'il est à ce stade — 0 si le repli
        #      ci-dessus a été sauté faute de règle câblée, jamais BASE).
        if ev_montant:
            forcages = [e for e in ev_montant if e["mode"] == "FORCAGE"]
            ajouts = [e for e in ev_montant if e["mode"] != "FORCAGE"]
            if forcages:
                vals["MT"] = forcages[-1]["valeur"]
                etape["detail"].append(f"forçage montant → {q2(vals['MT'])}")
            for e in ajouts:
                vals["MT"] = _dec(vals["MT"]) + e["valeur"]
                etape["detail"].append(f"ajout montant {q2(e['valeur'])} → {q2(vals['MT'])}")

        # ---- RG-RUB-EN-NET-01 (Adil DAIA) : brut de net ------------------
        # Point d'injection unique, volontairement placé APRÈS tout le reste
        # (alimentation, règle, EV) : couvre aussi bien la "zone fixe" (MT
        # posé directement par l'alimentation TABLE, jamais retouché par une
        # règle si la rubrique n'en a pas) que l'élément variable MONTANT
        # (posé juste au-dessus). Un override présent gagne toujours — c'est
        # le brut deviné par calculer_bulletin() pendant la dichotomie, ou 0
        # pour la passe "bulletin sans cette rubrique".
        if code in overrides_brut:
            vals["MT"] = _dec(overrides_brut[code])
            etape["detail"].append(f"brut équivalent (recherche par dichotomie) : {q2(vals['MT'])}")
        elif r.get("rubrique_en_net") and _dec(vals["MT"]) != D0:
            # Détection seule cette passe : le brut n'est pas encore connu,
            # `vals["MT"]` reste la valeur NETTE saisie — calculer_bulletin()
            # relance avec le bon override une fois le brut trouvé ; cette
            # passe de détection n'est jamais renvoyée telle quelle à l'appelant.
            net_demande[code] = _dec(vals["MT"])

        # Enregistrer le résultat + propager (NB/TY/MT/BASE) aux assiettes
        results[code] = {k: _dec(vals[k]) for k in ("MT", "NB", "TY", "BASE")}
        results[code]["DATE"] = vals.get("DATE")
        results[code]["TEXTE"] = vals.get("TEXTE")
        pousser_assiettes(code, results[code])

        etape["resultat"] = {"BASE": str(q2(vals["BASE"])), "NB": str(q4(vals["NB"])),
                             "TY": str(q4(vals["TY"])), "MT": str(q2(vals["MT"])),
                             "MT_PAT": str(q2(mt_pat)) if mt_pat is not None else None}
        trace_globale.append(etape)
        messages += [f"[{code}] {m}" for m in etape["avert"]]

        if not _doit_editer(r, vals["MT"], vals["NB"], vals["TY"], vals["BASE"]):
            continue  # rubrique non éditée (grandeurs nulles selon paramétrage)

        lignes.append({
            "code_rubrique": code, "libelle": r.get("libelle_edition") or r.get("libelle"),
            "code_type": code_type, "type_regle": type_regle,
            "ordre_calcul": r.get("ordre_calcul"),
            "base": q2(vals["BASE"]) if vals["BASE"] else None,
            "nombre": q4(vals["NB"]) if vals["NB"] else None,
            "taux": q4(vals["TY"]) if vals["TY"] else None,
            "montant": q2(vals["MT"]),
            "montant_cumul": q2(cumul_a_date(code, r.get("frequence_raz_cumuls"), vals["MT"], vals["NB"])[0]),
            "nombre_cumul": q4(cumul_a_date(code, r.get("frequence_raz_cumuls"), vals["MT"], vals["NB"])[1]),
            "montant_patronal": q2(mt_pat) if mt_pat is not None else None,
            "sens": _sens_rubrique(r), "est_cotisation": code_type == "COT",
            "type_periodicite": _periodicite(r),
            "frequence_raz": r.get("frequence_raz_cumuls"),
            "date_valeur": _iso(vals.get("DATE")),
            "texte": (str(vals["TEXTE"]) if vals.get("TEXTE") not in (None, "") else None),
            "observation": ("; ".join(etape["avert"])[:250] or None),
        })

    # Lignes d'assiette / totaux (affichage) — on montre NB, TY et MT cumulés
    for code, r in ctx.rubriques.items():
        if r.get("code_type") == "ASS":
            acc = assiettes.get(code, {"MT": D0, "NB": D0, "TY": D0, "BASE": D0})
            if not _doit_editer(r, acc["MT"], acc["NB"], acc["TY"], acc["BASE"]):
                continue
            lignes.append({
                "code_rubrique": code, "libelle": r.get("libelle_edition") or r.get("libelle"),
                "code_type": "ASS", "type_regle": r.get("type_regle"),
                "ordre_calcul": r.get("ordre_calcul"),
                "base": q2(acc["BASE"]) if acc["BASE"] else None,
                "nombre": q4(acc["NB"]) if acc["NB"] else None,
                "taux": q4(acc["TY"]) if acc["TY"] else None,
                "montant": q2(acc["MT"]), "montant_patronal": None,
                "montant_cumul": q2(cumul_a_date(code, r.get("frequence_raz_cumuls"), acc["MT"], acc["NB"])[0]),
                "nombre_cumul": q4(cumul_a_date(code, r.get("frequence_raz_cumuls"), acc["MT"], acc["NB"])[1]),
                "sens": "NEUTRE", "est_cotisation": False,
                "type_periodicite": _periodicite(r),
                "frequence_raz": r.get("frequence_raz_cumuls"),
                "date_valeur": None, "texte": None, "observation": None,
            })

    # Ordre d'affichage
    lignes.sort(key=lambda l: (l["ordre_calcul"] if l["ordre_calcul"] is not None else 9999, l["code_rubrique"]))
    for idx, l in enumerate(lignes):
        l["ordre_affichage"] = idx

    # Totaux "photo"
    code_rub_net_imp = ctx.constante_texte("NET_IMPOSABLE_RUBRIQUE", "REV_NET_IMP")
    tot = _totaux(lignes, assiettes, results, code_rub_net_imp)

    return {
        "collaborateur": {"id": str(collaborateur_id), "matricule": collab["matricule"],
                          "nom": collab["nom"], "prenom": collab["prenom"]},
        "periode": {"id": str(periode_id), "annee": ctx.annee, "mois": ctx.mois,
                    "libelle": f"{ctx.mois:02d}/{ctx.annee}",
                    "plan_paie_id": plan_id, "code_plan": code_plan},
        "totaux": tot,
        "lignes": lignes,
        "trace": trace_globale,
        "messages": messages,
        "a_erreur": False,
    }, net_demande


def _sens_rubrique(r: dict) -> str:
    flux = (r.get("code_flux") or "").upper()
    ctype = (r.get("code_type") or "").upper()
    if flux == "GAIN":
        return "GAIN"
    if flux == "RET" or ctype == "COT":
        return "RETENUE"
    return "NEUTRE"


def _periodicite(r: dict) -> str:
    """Type de la rubrique : GLISSANT > CUMUL > PERIODIQUE (d'après pr_cumulee / v_glissant)."""
    if r.get("v_glissant"):
        return "GLISSANT"
    if r.get("pr_cumulee"):
        return "CUMUL"
    return "PERIODIQUE"


def _mois_debut_raz(freq_raz, mois: int) -> int:
    """
    Mois (1-12) à partir duquel le cumul redémarre, selon la fréquence de RAZ
    paramétrée sur la rubrique. Toutes les fenêtres démarrent dans l'année civile.
      ANNUELLE → janvier ; SEMESTRIELLE → 1 ou 7 ; TRIMESTRIELLE → 1/4/7/10 ;
      MENSUELLE / PERIODIQUE → le mois courant (cumul = période seule).
    """
    f = (freq_raz or "ANNUELLE").upper()
    if f in ("MENSUELLE", "PERIODIQUE"):
        return mois
    if f == "TRIMESTRIELLE":
        return ((mois - 1) // 3) * 3 + 1
    if f == "SEMESTRIELLE":
        return 1 if mois <= 6 else 7
    return 1  # ANNUELLE (défaut)


def _doit_editer(r: dict, mt: Decimal, nb: Decimal, ty: Decimal, base: Decimal = None) -> bool:
    """
    Édition conditionnelle : la ligne est écartée si TOUTES les conditions
    cochées (MT=0 / NB=0 / TY=0) sont réunies. Aucune condition cochée →
    toujours éditer sur ce volet.

    RG-RUB-EDITION-COND-01 (Adil DAIA) : contrôle distinct et additionnel —
    un unique attribut sélectionnable (BASE/NOMBRE/TAUX/MONTANT) dans l'écran
    « Condition d'enregistrement » de la rubrique. La ligne est écartée si cet
    attribut vaut 0, indépendamment du volet ci-dessus. `base` est optionnel
    (les deux points d'appel existants ne le passaient pas avant ce correctif)
    pour ne rien casser si jamais un appelant tiers oublie de le fournir.
    """
    conditions = []
    if r.get("ne_editer_si_mt_zero"):
        conditions.append(_dec(mt) == D0)
    if r.get("ne_editer_si_nb_zero"):
        conditions.append(_dec(nb) == D0)
    if r.get("ne_editer_si_ty_zero"):
        conditions.append(_dec(ty) == D0)
    if conditions and all(conditions):
        return False

    attribut_ctrl = (r.get("attribut_controle_non_zero") or "").strip().upper()
    if attribut_ctrl:
        valeurs = {"BASE": base, "NOMBRE": nb, "TAUX": ty, "MONTANT": mt}
        valeur_ctrl = valeurs.get(attribut_ctrl)
        if valeur_ctrl is not None and _dec(valeur_ctrl) == D0:
            return False

    return True


def _totaux(lignes: list, assiettes: dict, results: dict, code_rubrique_net_imposable: str = "REV_NET_IMP") -> dict:
    gains = sum((l["montant"] for l in lignes if l["sens"] == "GAIN"), D0)
    retenues_recalc = sum((l["montant"] for l in lignes if l["sens"] == "RETENUE"), D0)
    cot_sal = sum((l["montant"] for l in lignes if l["est_cotisation"]), D0)
    cot_pat = sum((l["montant_patronal"] or D0 for l in lignes if l["est_cotisation"]), D0)

    def ass(*codes):
        for c in codes:
            if c in assiettes:
                return _dec(assiettes[c].get("MT", D0))
        return D0

    # RG-PAIE-NET-IMPOSABLE-CONFIG-01 (suite) : contrairement à TOTAL_GAIN /
    # BRUT_IMP / TOTAL_RETENUE (de vraies rubriques ASSIETTE, alimentées par
    # accumulation des rubriques qui les référencent), la rubrique visée par
    # NET_IMPOSABLE_RUBRIQUE (ex. REV_NET_IMP) est une rubrique CALCULÉE
    # ordinaire : son résultat vit dans `results[code]`, pas dans
    # `assiettes[code]`. On cherche donc dans les deux, assiette d'abord
    # (au cas où quelqu'un configurerait un jour un vrai code d'assiette).
    def valeur_rubrique_ou_assiette(code: str):
        if code in assiettes:
            return _dec(assiettes[code].get("MT", D0))
        if code in results:
            return _dec(results[code].get("MT", D0))
        return D0

    brut = ass("TOTAL_GAIN")
    brut_imp = ass("BRUT_IMP")
    # RG-PAIE-TOTAL-RETENUE-01 (correctif) : comme pour TOTAL_GAIN/BRUT_IMP,
    # on fait confiance à la rubrique de synthèse TOTAL_RETENUE quand elle
    # est câblée, plutôt que de resommer les lignes par sens=="RETENUE" — ce
    # recalcul divergeait silencieusement des rubriques dont code_flux n'est
    # pas exactement 'RET' dans le référentiel (elles ne sont alors comptées
    # ni comme retenue ni ailleurs, faussant le total à la baisse).
    ass_total_retenue = ass("TOTAL_RETENUE")
    retenues = ass_total_retenue if ass_total_retenue else retenues_recalc
    net = gains - retenues
    return {
        "total_brut": q2(brut if brut else gains),
        "total_brut_imposable": q2(brut_imp),
        "total_gains": q2(gains),
        "total_retenues": q2(retenues),
        "total_cot_salariale": q2(cot_sal),
        "total_cot_patronale": q2(cot_pat),
        # RG-PAIE-NET-IMPOSABLE-CONFIG-01 (Adil DAIA) : la rubrique source du
        # "Net imposable" est désormais paramétrable via la constante TEXTE
        # NET_IMPOSABLE_RUBRIQUE (Paramétrage > Constantes), au lieu du code
        # "REV_NET_IMP" figé en dur. Repli sur "REV_NET_IMP" si la constante
        # est absente, pour ne rien casser sur les installations existantes.
        "net_imposable": q2(valeur_rubrique_ou_assiette(code_rubrique_net_imposable)),
        "net_a_payer": q2(net),
        "cout_employeur": q2(gains + cot_pat),
    }
