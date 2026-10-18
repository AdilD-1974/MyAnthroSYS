"""Bibliothèque d'images — RG-EDT-IMAGE-01..03, RG-EDT-SECU-06 (Adil DAIA)."""
import io

import pytest
from PIL import Image

from app.editions import images as im
from app.editions.definition import Definition
from tests_editions.recette import B_SARA_SEP, P_SEP, S1, base_requise
from tests_editions.test_donnees import definition


def _png(couleur="red") -> bytes:
    b = io.BytesIO()
    Image.new("RGB", (40, 20), couleur).save(b, "PNG")
    return b.getvalue()


@pytest.fixture
def biblio(tmp_path, monkeypatch):
    monkeypatch.setenv("EDITIONS_IMAGES", str(tmp_path / "images"))
    return tmp_path


def test_depot_liste_remplacement_suppression(biblio):
    r = im.enregistrer(S1, "cachet société", _png())
    assert r["code"] == "CACHET_SOCIETE" and r["formule"] == 'ASSET("CACHET_SOCIETE")'
    with pytest.raises(im.ImageInvalide):
        im.enregistrer(S1, "CACHET_SOCIETE", _png())                 # existe déjà
    im.enregistrer(S1, "CACHET_SOCIETE", _png("blue"), remplacer=True)
    assert [i["code"] for i in im.lister(S1)] == ["CACHET_SOCIETE"]
    assert im.lister("00000000-0000-0000-0000-00000000ffff") == []   # une autre société ne la voit pas
    assert "ASSET.CACHET_SOCIETE" in im.chemins_assets(S1)
    assert im.supprimer(S1, "cachet_societe") and im.lister(S1) == []


@pytest.mark.parametrize("contenu, code", [
    (b"pas une image", "X"), (b"", "X"), (b"%PDF-1.4", "X"),
    (b"\x89PNG" + b"0" * (im.TAILLE_MAX + 1), "X"),
])
def test_depot_refuse(biblio, contenu, code):
    with pytest.raises(im.ImageInvalide):
        im.enregistrer(S1, code, contenu)


def test_code_et_societe_invalides(biblio):
    with pytest.raises(im.ImageInvalide):
        im.enregistrer(S1, "../../x", b"")
    with pytest.raises(im.ImageInvalide):
        im.lister("../etc")


@base_requise
def test_asset_imprime_et_fichier_hors_bibliotheque_refuse(db, biblio):
    from app.editions.moteur.executeur import executer
    from app.editions.sources import ContexteSecurite
    im.enregistrer(S1, "CACHET", _png())
    dehors = biblio / "dehors.png"
    dehors.write_bytes(_png())
    sec = ContexteSecurite(None, S1, donnees_sensibles=True)

    def rendu(valeur):
        d = definition()
        d["bandes"][0]["elements"].append({"id": "img", "type": "IMAGE", "x": 0, "y": 100, "l": 30, "h": 15, "valeur": valeur})
        return executer(db, Definition.model_validate(d), {"periode": P_SEP, "bulletin": B_SARA_SEP}, sec)[0].contenu

    assert b"/Subtype /Image" in rendu('ASSET("CACHET")')
    assert b"/Subtype /Image" not in rendu(f'"{dehors}"')            # RG-EDT-SECU-06


def test_polices_truetype_et_repli(tmp_path, monkeypatch):
    """RG-EDT-RENDU-02 : police TrueType du répertoire de l'entreprise, repli Helvetica sinon."""
    import shutil
    from app.editions.moteur import texte as tx
    source = next(iter(p for d in tx._dossiers_systeme() for p in d.rglob("DejaVuSans.ttf")), None)
    if source is None:
        pytest.skip("aucune police TrueType de test sur ce poste")
    monkeypatch.setenv("EDITIONS_POLICES", str(tmp_path))
    shutil.copy(source, tmp_path / "MaPolice-Regular.ttf")
    tx.rafraichir_polices()
    try:
        noms = [p["nom"] for p in tx.polices_disponibles()]
        assert noms[:3] == ["Helvetica", "Times", "Courier"] and "Ma Police" in noms
        assert tx.nom_police("Ma Police", True, False) == "Ma Police-regular"   # pas de gras : normal
        assert tx.nom_police("Absente", False, False) == "Helvetica"
        assert tx.largeur_pt("Bulletin", "Ma Police-regular", 10) > 0
    finally:
        tx.rafraichir_polices()


@base_requise
def test_police_incorporee_au_pdf(db):
    from app.editions.moteur import texte as tx
    from app.editions.moteur.executeur import executer
    from app.editions.sources import ContexteSecurite
    if "DejaVu Sans" not in [p["nom"] for p in tx.polices_disponibles()]:
        pytest.skip("DejaVu Sans absente")
    d = definition()
    d["bandes"][0]["elements"].append({"id": "t", "type": "TEXTE", "x": 0, "y": 100, "l": 60, "h": 6,
                                       "valeur": '"Bulletin"', "style": {"police": "DejaVu Sans", "gras": True}})
    sec = ContexteSecurite(None, S1, donnees_sensibles=True)
    pdf = executer(db, Definition.model_validate(d), {"periode": P_SEP, "bulletin": B_SARA_SEP}, sec)[0].contenu
    assert b"DejaVuSans-Bold" in pdf


@base_requise
@pytest.mark.parametrize("ajustement", ["CONTENIR", "REMPLIR", "ETIRER"])
def test_ajustement_et_rognage(db, biblio, ajustement):
    """RG-EDT-IMAGE-04/05 : l'image est rognée puis ajustée au cadre."""
    from app.editions.moteur.executeur import executer
    from app.editions.sources import ContexteSecurite
    im.enregistrer(S1, "BANDEAU", _png())
    d = definition()
    d["bandes"][0]["elements"].append({"id": "img", "type": "IMAGE", "x": 0, "y": 100, "l": 30, "h": 30, "valeur": 'ASSET("BANDEAU")',
                                       "ajustement": ajustement, "rognage": {"gauche": 10, "droite": 20, "haut": 5}})
    sec = ContexteSecurite(None, S1, donnees_sensibles=True)
    pdf = executer(db, Definition.model_validate(d), {"periode": P_SEP, "bulletin": B_SARA_SEP}, sec)[0].contenu
    assert b"/Subtype /Image" in pdf


def test_rognage_borne():
    from pydantic import ValidationError
    from app.editions.definition import Rognage
    with pytest.raises(ValidationError):
        Rognage(gauche=60, droite=40)
    assert Rognage(haut=50, bas=45).bas == 45



@base_requise
def test_traits_arrondis_et_souligne(db):
    """RG-EDT-RENDU-03/04 : tirets, pointillés, coins arrondis, souligné."""
    from app.editions.moteur.executeur import executer
    from app.editions.sources import ContexteSecurite
    d = definition()
    d["bandes"][0]["elements"] += [
        {"id": "c1", "type": "CADRE", "x": 0, "y": 100, "l": 40, "h": 10, "arrondi": 3,
         "style": {"style_trait": "TIRETS", "epaisseur_bordure": 1.5, "fond": "#EEEEEE"}},
        {"id": "l1", "type": "LIGNE", "x": 0, "y": 112, "l": 60, "h": 0.3, "style": {"style_trait": "POINTILLES"}},
        {"id": "t1", "type": "TEXTE", "x": 50, "y": 100, "l": 40, "h": 6, "valeur": '"Souligné"', "style": {"souligne": True}},
    ]
    sec = ContexteSecurite(None, S1, donnees_sensibles=True)
    pdf = executer(db, Definition.model_validate(d), {"periode": P_SEP, "bulletin": B_SARA_SEP}, sec)[0].contenu
    from pypdf import PdfReader
    flux = b"".join(p.get_contents().get_data() for p in PdfReader(io.BytesIO(pdf)).pages)
    assert b"] 0 d" in flux                                       # motif de tirets posé
    assert b" c\n" in flux or b" c " in flux                      # courbes des coins arrondis
    assert flux.count(b" l") >= 3                                 # traits, dont le soulignement


def _safe(m):
    import zlib
    try:
        zlib.decompress(m)
        return True
    except Exception:
        return False



@base_requise
def test_page_paysage_personnalisee_police_par_defaut(db):
    """RG-EDT-PAGE-01 : orientation, format personnalisé, police/taille de l'état, fond de page."""
    from pypdf import PdfReader
    from pydantic import ValidationError
    from app.editions.moteur.executeur import executer
    from app.editions.sources import ContexteSecurite
    sec = ContexteSecurite(None, S1, donnees_sensibles=True)
    d = definition()
    d["page"] = {"format": "A4", "orientation": "PAYSAGE", "marges": [10, 10, 10, 10], "police": "Times", "taille": 11,
                 "couleur_fond": "#FFF2CC"}
    pdf = executer(db, Definition.model_validate(d), {"periode": P_SEP, "bulletin": B_SARA_SEP}, sec)[0].contenu
    p0 = PdfReader(io.BytesIO(pdf)).pages[0]
    assert round(float(p0.mediabox.width)) == 842 and round(float(p0.mediabox.height)) == 595
    assert b"Times-Roman" in pdf or b"Times-Bold" in pdf
    d["page"] = {"format": "PERSONNALISE", "largeur": 100, "hauteur": 150, "marges": [5, 5, 5, 5]}
    d["bandes"][0]["hauteur"] = 50
    for e in d["bandes"][0]["elements"]:
        e["x"], e["l"] = 0, min(e.get("l", 10), 90)
    pdf = executer(db, Definition.model_validate(d), {"periode": P_SEP, "bulletin": B_SARA_SEP}, sec)[0].contenu
    p0 = PdfReader(io.BytesIO(pdf)).pages[0]
    assert round(float(p0.mediabox.width)) == round(100 * 72 / 25.4)
    with pytest.raises(ValidationError):
        Definition.model_validate({**d, "page": {"format": "PERSONNALISE"}})



def test_casse_d_affichage():
    """RG-EDT-RENDU-05 : majuscules, minuscules, initiales ; arabe inchangé."""
    from app.editions.moteur import texte as tx
    assert tx.appliquer_casse("bulletin de paie", "MAJUSCULES") == "BULLETIN DE PAIE"
    assert tx.appliquer_casse("NET À PAYER", "MINUSCULES") == "net à payer"
    assert tx.appliquer_casse("jEAN-pierre d'alami ben (said)", "INITIALES") == "Jean-Pierre D'Alami Ben (Said)"
    assert tx.appliquer_casse("Net", "PETITES_MAJUSCULES") == "Net"
    assert tx.appliquer_casse("صافي الأجر", "MAJUSCULES") == "صافي الأجر"
    assert tx.largeur_petites_capitales("Net", "Helvetica", 10) > tx.largeur_pt("Net", "Helvetica", 10)


@base_requise
def test_casse_au_pdf(db):
    from app.editions.moteur.executeur import executer
    from app.editions.sources import ContexteSecurite
    d = definition()
    d["bandes"][0]["elements"] += [
        {"id": "t1", "type": "TEXTE", "x": 0, "y": 100, "l": 80, "h": 6, "valeur": '"bulletin de paie"', "style": {"casse": "MAJUSCULES"}},
        {"id": "t2", "type": "TEXTE", "x": 0, "y": 108, "l": 80, "h": 6, "valeur": '"net à payer"', "style": {"casse": "PETITES_MAJUSCULES"}},
    ]
    sec = ContexteSecurite(None, S1, donnees_sensibles=True)
    pdf = executer(db, Definition.model_validate(d), {"periode": P_SEP, "bulletin": B_SARA_SEP}, sec)[0].contenu
    from pypdf import PdfReader
    t = PdfReader(io.BytesIO(pdf)).pages[0].extract_text()
    assert "BULLETIN DE PAIE" in t and "bulletin de paie" not in t
