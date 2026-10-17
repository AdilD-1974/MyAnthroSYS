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
