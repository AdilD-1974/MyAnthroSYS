"""Modèles d'exemple livrés, un par type d'état — produits sans anomalie (Adil DAIA, 19/10/2026)."""

import pytest
from sqlalchemy import text

from app.editions import service as sv
from app.editions import themes as th
from tests_editions.recette import P_SEP, base_requise
from tests_editions.test_service import ADMIN_ID, COLLAB_ID, PAIE, PAIE_ID

pytestmark = base_requise

ATTENDUS = {  # code : (catégorie, nb de documents pour septembre : 1 = un état pour tous, 2 = un par salarié)
    "BULLETIN_CLASSIQUE": ("BULLETIN", 2), "JOURNAL_PAIE": ("JOURNAL", 1), "ORDRE_VIREMENT": ("LISTE", 1),
    "ATTESTATION_TRAVAIL_SALAIRE": ("ATTESTATION", 2), "NOTIFICATION_REMUNERATION": ("COURRIER", 2),
    "ETAT_COTISATIONS_SOCIALES": ("DECLARATION", 1), "FICHE_SYNTHESE_ANNUELLE": ("AUTRE", 2),
    "BULLETIN_DETAILLE": ("BULLETIN", 2), "BULLETIN_MODERNE": ("BULLETIN", 2), "BULLETIN_FORMULAIRE": ("BULLETIN", 2),
    "ETAT_ECARTS_M_M1": ("AUTRE", 1), "CONTROLE_ANOMALIES_PAIE": ("AUTRE", 1), "CONTROLE_IR": ("AUTRE", 1),
    "MASSE_SALARIALE": ("AUTRE", 1), "ETAT_EMARGEMENT": ("LISTE", 1),
    "ECARTS_RUBRIQUES": ("AUTRE", 1), "COMPARATIF_RUBRIQUES": ("AUTRE", 1),
}
# états qui demandent d'autres paramètres que la période (code : paramètres, nb de documents)
AUTRES_PARAMETRES = {
    "CONTROLE_DEUX_PERIODES": ({"periode": P_SEP, "periode_comparaison": "aaaaaaaa-0000-0000-0000-000000000008"}, 1),
    "BULLETIN_RECAP_EXERCICE": ({"annee": 2026}, 2),
}
P_AOU = "aaaaaaaa-0000-0000-0000-000000000008"


@pytest.fixture
def s(db, tmp_path, monkeypatch):
    monkeypatch.setattr(sv, "racine_documents", lambda: tmp_path)
    for uid in (ADMIN_ID, PAIE_ID, COLLAB_ID):
        db.execute(text("INSERT INTO users (id, email) VALUES (:id, :e)"), {"id": uid, "e": f"{uid}@x.ma"})
    sv.initialiser(db)
    yield db
    db.rollback()


def test_un_exemple_par_type_produit_sans_anomalie(s):
    modeles = {m["code"]: m for m in sv.lister_modeles(s, PAIE) if m["est_systeme"]}
    assert set(modeles) == set(ATTENDUS) | set(AUTRES_PARAMETRES)
    assert {c for c, _ in ATTENDUS.values()} == set(sv.CATEGORIES)          # tous les types couverts
    lancements = [(code, {"periode": P_SEP}, nb) for code, (_c, nb) in ATTENDUS.items()]
    lancements += [(code, p, nb) for code, (p, nb) in AUTRES_PARAMETRES.items()]
    for code, parametres, nb in lancements:
        m = modeles[code]
        assert m["categorie"] == ATTENDUS.get(code, ("AUTRE",))[0]
        r = sv.lancer(s, PAIE, m["id"], parametres)
        assert len(r["documents"]) == nb, code
        assert all(not d["anomalies"] for d in r["documents"]), (code, r["documents"][0]["anomalies"])


def test_exemples_ranges_dans_le_menu_de_la_paie(s):
    a = {t["libelle"]: {m["code"] for m in t["modeles"]} for t in th.arbre(s, PAIE, "PAIE")["themes"]}
    assert a["Journaux de paie"] == {"JOURNAL_PAIE"}
    assert a["Déclarations"] == {"ETAT_COTISATIONS_SOCIALES"}
    assert a["États standard"] == {"ORDRE_VIREMENT", "ETAT_EMARGEMENT"}
    assert a["États de contrôle paie"] == {"ETAT_ECARTS_M_M1", "CONTROLE_ANOMALIES_PAIE", "CONTROLE_IR", "ECARTS_RUBRIQUES",
                                           "CONTROLE_DEUX_PERIODES", "COMPARATIF_RUBRIQUES"}
    assert a["États de synthèse"] == {"MASSE_SALARIALE", "FICHE_SYNTHESE_ANNUELLE"}
    rh = {t["libelle"]: {m["code"] for m in t["modeles"]} for t in th.arbre(s, PAIE, "RH")["themes"]}
    assert rh == {"Attestations": {"ATTESTATION_TRAVAIL_SALAIRE"}, "Courriers": {"NOTIFICATION_REMUNERATION"}}


def test_quatre_bulletins_au_choix_dans_le_menu(s):
    a = {t["libelle"]: [m["code"] for m in t["modeles"]] for t in th.arbre(s, PAIE, "PAIE")["themes"]}
    assert set(a["Bulletins de paie"]) == {"BULLETIN_CLASSIQUE", "BULLETIN_DETAILLE", "BULLETIN_MODERNE", "BULLETIN_FORMULAIRE",
                                           "BULLETIN_RECAP_EXERCICE"}


def test_fond_de_page_dans_l_ordre_des_elements(s):
    """Un aplat du FOND est dessiné avant les textes posés dessus (bandeau du bulletin moderne)."""
    from app.editions.definition import Definition
    from app.editions.moteur import executeur
    m = next(x for x in sv.lister_modeles(s, PAIE) if x["code"] == "BULLETIN_MODERNE")
    v, _ = sv.lire_version(s, PAIE, m["version_publiee_id"])
    d = Definition.model_validate(v["definition"])
    prep = executeur._preparer(s, d, {"periode": P_SEP}, sv.contexte_securite(s, PAIE, m), registre_masques=None,
                               racine_fichiers="storage", contexte_fixe=None, forme=None)
    from app.editions.moteur.mise_en_page import Contexte, composer
    pages, _ = composer(Contexte(definition=prep.definition, lignes=prep.lignes[:1], **prep.contexte))
    ids = [b.source_id for b in pages[0].boites]
    assert ids.index("lat_fond") < ids.index("lat_nom") < ids.index("titre")


def test_qr_de_controle_sur_tous_les_bulletins(s):                        # RG-EDT-QR-01
    from app.editions.definition import CodeBarre, Definition
    for m in sv.lister_modeles(s, PAIE):
        if m["categorie"] != "BULLETIN" or not m["est_systeme"]:
            continue
        d = Definition.model_validate(sv.lire_version(s, PAIE, m["version_publiee_id"])[0]["definition"])
        qr = [e for b in d.bandes for e in b.elements if isinstance(e, CodeBarre)]
        assert qr and "net_a_payer" in qr[0].valeur, m["code"]


def test_journal_grille_et_forme_synthetique(s):
    m = next(x for x in sv.lister_modeles(s, PAIE) if x["code"] == "JOURNAL_PAIE")
    for forme in (None, "synthetique"):
        r = sv.lancer(s, PAIE, m["id"], {"periode": P_SEP}, forme)
        assert len(r["documents"]) == 1 and not r["documents"][0]["anomalies"], forme


def test_ecarts_m_m1_et_mois_precedent(s):                                # RG-EDT-PRECEDENT-01
    from app.editions.sources.paie import FournisseurBulletin
    lignes = {l["matricule"]: l for l in FournisseurBulletin().lire(s, {"periode": {"id": P_SEP}}, sv.contexte_securite(s, PAIE))}
    assert lignes["M001"]["precedent"]["existe"] == 1 and float(lignes["M001"]["precedent"]["net_a_payer"]) == 8000
    assert lignes["M002"]["precedent"]["existe"] == 0                     # pas de bulletin en août : entrée
    m = next(x for x in sv.lister_modeles(s, PAIE) if x["code"] == "ETAT_ECARTS_M_M1")
    tous = sv.lancer(s, PAIE, m["id"], {"periode": P_SEP})
    ecarts = sv.lancer(s, PAIE, m["id"], {"periode": P_SEP, "seuil": 50, "affichage": "Écarts et entrées seulement"})
    assert tous["documents"] and ecarts["documents"]
    from app.editions.definition import Definition
    from app.editions.moteur import executeur
    d = Definition.model_validate(sv.lire_version(s, PAIE, m["version_publiee_id"])[0]["definition"])
    prep = executeur._preparer(s, d, {"periode": P_SEP, "seuil": 50, "affichage": "Écarts et entrées seulement"},
                               sv.contexte_securite(s, PAIE, m), registre_masques=None, racine_fichiers="storage",
                               contexte_fixe=None, forme=None)
    assert [l["matricule"] for l in prep.lignes] == ["M002"]              # Sara : +5,6 % < 50 % ; Omar : entrée


# ---- comparaison entre périodes (RG-EDT-COMPARAISON-01 à 06) et récapitulatif de l'exercice (RG-EDT-EXERCICE-01/02) ----
def _preparer(s, code, parametres):
    from app.editions.definition import Definition
    from app.editions.moteur import executeur
    m = next(x for x in sv.lister_modeles(s, PAIE) if x["code"] == code)
    d = Definition.model_validate(sv.lire_version(s, PAIE, m["version_publiee_id"])[0]["definition"])
    return executeur._preparer(s, d, parametres, sv.contexte_securite(s, PAIE, m), registre_masques=None,
                               racine_fichiers="storage", contexte_fixe=None, forme=None)


def test_periode_de_comparaison_choisie_et_sorties(s):
    from app.editions.sources.paie import FournisseurBulletin
    sec = sv.contexte_securite(s, PAIE)
    # août comparé à septembre : Sara présente, Omar sorti (payé en septembre seulement)
    lignes = FournisseurBulletin().lire(s, {"periode": {"id": P_AOU, "annee": 2026, "mois": 8},
                                            "periode_comparaison": {"id": P_SEP, "intitule": "Septembre 2026"},
                                            "inclure_sortants": True}, sec)
    par = {l["collaborateur_id"]: l for l in lignes}
    sara, omar = par["c0000000-0000-0000-0000-000000000001"], par["c0000000-0000-0000-0000-000000000002"]
    assert sara["mouvement"] == "PRESENT" and float(sara["precedent"]["net_a_payer"]) == 8450.50
    assert sara["precedent"]["mode"] == "Période choisie"
    assert omar["mouvement"] == "SORTIE" and omar["sortant"] == 1 and omar["id"].startswith("SORTANT:")
    assert float(omar["net_a_payer"]) == 0 and float(omar["precedent"]["net_a_payer"]) == 5100
    assert omar["periode_id"] == P_AOU                     # rattaché à la période éditée (filtre « periode_id = @periode.id »)
    # sans le paramètre : pas de sortie
    assert len(FournisseurBulletin().lire(s, {"periode": {"id": P_AOU, "annee": 2026, "mois": 8},
                                              "periode_comparaison": {"id": P_SEP}}, sec)) == 1


def test_ecarts_rubrique_par_rubrique(s):
    prep = _preparer(s, "ECARTS_RUBRIQUES", {"periode": P_SEP, "detail": "Toutes les rubriques"})
    sara = next(l for l in prep.lignes if l["matricule"] == "M001")
    ecarts = {e["code_rubrique"]: e for e in prep.contexte["enfants"]["e"][sara["id"]]}
    assert ecarts["SALBASE"]["statut"] == "MODIFIEE" and float(ecarts["SALBASE"]["p_montant"]) == 10000   # nombre : 26 / vide
    assert ecarts["PRIM_ANC"]["statut"] == "NOUVELLE" and float(ecarts["PRIM_ANC"]["effet_net"]) == 500
    assert ecarts["CNSS_SAL"]["statut"] == "NOUVELLE" and float(ecarts["CNSS_SAL"]["effet_net"]) == -268.80
    assert "AVANCE" not in ecarts and "BRUT_INTER" not in ecarts            # à zéro ; NEUTRE
    assert sara["comparaison"]["nb_nouvelles"] == 3 and sara["comparaison"]["nb_modifiees"] == 1
    # attributs P… et E… dans les formules : [SALBASE].PMT, [PRIM_ANC].EMT
    rub = prep.contexte["rubriques"][sara["id"]]
    assert float(rub["SALBASE"]["PMT"]) == 10000 and float(rub["SALBASE"]["EMT"]) == 0
    assert float(rub["PRIM_ANC"]["EMT"]) == 500 and float(rub["NET_A_PAYER"]["PMT"]) == 8000


def test_comparatif_des_rubriques(s):
    prep = _preparer(s, "COMPARATIF_RUBRIQUES", {"periode": P_SEP})
    r = {l["code_rubrique"]: l for l in prep.lignes}
    assert float(r["SALBASE"]["montant"]) == 16000 and float(r["SALBASE"]["p_montant"]) == 10000
    assert r["SALBASE"]["nb_salaries"] == 2 and r["SALBASE"]["p_nb_salaries"] == 1 and r["SALBASE"]["nb_nouveaux"] == 1
    assert r["PRIM_ANC"]["statut"] == "NOUVELLE"
    assert float(r["NET_A_PAYER"]["ecart_montant"]) == 5550.50 and r["NET_A_PAYER"]["sens"] == "TOTAL"
    assert (r["SALBASE"]["effectif"], r["SALBASE"]["p_effectif"], r["SALBASE"]["nb_entrees"]) == (2, 1, 1)


def test_rapprochement_entre_deux_periodes_equilibre(s):
    from app.editions.moteur.mise_en_page import Composeur, Contexte
    for per, comp in ((P_SEP, P_AOU), (P_AOU, P_SEP)):
        prep = _preparer(s, "CONTROLE_DEUX_PERIODES", {"periode": per, "periode_comparaison": comp})
        comp_ = Composeur(Contexte(definition=prep.definition, lignes=prep.lignes, **prep.contexte))
        ctl = next(lg for b in prep.definition.bandes for e in b.elements if e.type == "GRILLE" for lg in e.lignes if lg.id == "ctl")
        r = comp_._resolver(prep.lignes[0], comp_.totaux_etat, 1, 1)
        from app.editions import expressions as ex
        assert all(float(ex.evaluer(f, r)) == 0 for f in ctl.valeurs.values()), (per, comp)


def test_recapitulatif_de_l_exercice(s):
    prep = _preparer(s, "BULLETIN_RECAP_EXERCICE", {"annee": 2026})
    sara = next(l for l in prep.lignes if l["matricule"] == "M001")
    assert sara["exercice"]["nb_bulletins"] == 2 and sara["exercice"]["mois_payes"] == "août à septembre"
    assert float(sara["total_brut"]) == 20500
    from app.editions.moteur.mise_en_page import Composeur, Contexte
    comp = Composeur(Contexte(definition=prep.definition, lignes=[sara], **prep.contexte))
    recap = {l["libelle"]: l for l in comp._donnees(sara)["corps"]["recap"]}
    base = recap["Salaire de base"]
    assert (float(base["m08"]), float(base["m09"]), float(base["total"]), base["m10"]) == (10000, 10000, 20000, None)
    assert float(recap["Net à payer"]["total"]) == 16450.50 and float(recap["CNSS — part patronale"]["m09"]) == 1077.12
    assert "Indemnité de transport" not in recap and comp._donnees(sara)["corps"]["activite"] == []   # rubriques absentes


def test_corps_exercice_valide(s):
    from app.editions.validation import CatalogueValidation, valider
    from app.editions.definition import COLONNES_EXERCICE
    d = {"jeux": [{"code": "s", "source": "EXERCICE_SALARIE", "role": "PRINCIPAL"}],
         "corps": [{"code": "x", "libelle": "X", "nature": "EXERCICE",
                    "colonnes": [{"code": c, "libelle": c} for c in COLONNES_EXERCICE[:5]],
                    "affectations": [{"rubrique": "SALBASE", "cibles": {"MT": "mois", "NB": "mois"}},
                                     {"rubrique": "SALBASE", "periode": "CUMUL", "cibles": {"MT": "mois"}}]}],
         "bandes": [{"id": "c", "type": "CORPS", "hauteur": 5, "elements": []}]}
    msgs = [e.message for e in valider(d, CatalogueValidation()).erreurs]
    assert any("m01 à m12" in m for m in msgs) and any("un seul attribut" in m for m in msgs) and any("période « Mois »" in m for m in msgs)
