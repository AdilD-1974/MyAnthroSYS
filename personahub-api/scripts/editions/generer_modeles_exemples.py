"""
scripts/editions/generer_modeles_exemples.py — Génère les modèles d'exemple livrés
(un par type d'état) dans app/editions/modeles_systeme/.
Auteur : Adil DAIA — 19/10/2026

    python scripts/editions/generer_modeles_exemples.py

Chaque modèle est un exemple complet, prêt à l'emploi et à copier pour personnaliser :
    JOURNAL       Journal de paie (paysage, regroupé par plan, sous-totaux, synthèse, visas)
    LISTE         Ordre de virement des salaires (lettre à la banque, regroupé par banque)
    ATTESTATION   Attestation de travail et de salaire (un document par salarié, QR)
    COURRIER      Notification de rémunération (adresse pour enveloppe à fenêtre, repères de pliage)
    DECLARATION   État des cotisations CNSS / AMO / TFP (taux en variables modifiables)
    AUTRE         Fiche de synthèse annuelle du salarié (cumuls, moyennes, ratios)
    BULLETIN      Bulletins détaillé, moderne, formulaire ; bulletin récapitulatif de l'exercice (12 mois)
    CONTRÔLE      Écarts M / M-1, anomalies, IR, écarts par rubrique, contrôle entre deux périodes,
                  comparatif des rubriques ; SYNTHÈSE masse salariale (par direction et catégorie, par collaborateur) ; LISTE émargement
Les montants passent par les champs totaux du bulletin : aucun code de rubrique propre à un
client n'est supposé.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

if str(Path(__file__).resolve().parents[2]) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

DOSSIER = Path(__file__).resolve().parents[2] / "app" / "editions" / "modeles_systeme"

BLEU, BLEU_CLAIR, GRIS, GRIS_CLAIR, BLANC = "#0E3D5C", "#E8F1F5", "#6B7C88", "#D5DEE3", "#FFFFFF"
PARAM_PERIODE = {"code": "periode", "libelle": "Période", "type": "PERIODE"}
# RG-EDT-MOIS-01 : journaux, listes, déclarations, attestations, courriers, synthèses : année + mois de paie,
# toutes les périodes du mois (bulletins et états de contrôle gardent une période précise)
PARAM_MOIS = {"code": "periode", "libelle": "Mois de paie", "type": "MOIS"}
PARAM_COLLABS = {"code": "collaborateurs", "libelle": "Collaborateurs", "type": "COLLABORATEUR",
                 "obligatoire": False, "multiple": True}
PARAM_PLAN = {"code": "plan_paie", "libelle": "Plan de paie", "type": "PLAN_PAIE", "obligatoire": False}
MOIS = 'FORMAT(@periode.date_fin, "MOIS_ANNEE")'
# RG-EDT-COMPARAISON-01 : période de comparaison au choix (vide = mois précédent), sorties incluses
PARAM_COMPARAISON = {"code": "periode_comparaison", "libelle": "Période de comparaison (vide : mois précédent)",
                     "type": "PERIODE", "obligatoire": False}
PARAM_SORTANTS = {"code": "inclure_sortants", "libelle": "Inclure les sorties (payés dans la période de comparaison seulement)",
                  "type": "BOOLEEN", "obligatoire": False, "defaut": "VRAI"}
COMPAREE = 'SI(ESTVIDE(@periode_comparaison), "mois précédent", FORMAT(@periode_comparaison.date_fin, "MOIS_ANNEE"))'


def lit(t: str) -> str:
    return json.dumps(t, ensure_ascii=False)


def st(**k) -> dict:
    return {a: b for a, b in k.items() if b is not None}


def texte(id, x, y, l, h, t, **s):
    return {"id": id, "type": "TEXTE", "x": x, "y": y, "l": l, "h": h, "valeur": lit(t), "style": st(**s)}


def champ(id, x, y, l, h, expr, masque=None, vide=None, **s):
    e = {"id": id, "type": "CHAMP", "x": x, "y": y, "l": l, "h": h, "valeur": expr, "style": st(**s)}
    # un texte absent s'imprime vide (pas de tiret) ; un montant absent garde le rendu du masque
    aff = st(masque=masque, valeur_si_vide=vide if vide is not None else ("" if masque is None else None))
    if aff:
        e["affichage"] = aff
    return e


def riche(id, x, y, l, h, contenu, **s):
    return {"id": id, "type": "TEXTE_RICHE", "x": x, "y": y, "l": l, "h": h, "contenu": contenu,
            "extensible": True, "style": st(**s)}


def fond(id, x, y, l, h, couleur, **s):
    """Aplat de couleur sans bordure (un texte vide sur fond)."""
    return {"id": id, "type": "TEXTE", "x": x, "y": y, "l": l, "h": h, "valeur": '""', "style": st(fond=couleur, **s)}


def ligne(id, x, y, l, couleur=GRIS_CLAIR, epaisseur=0.3, trait=None):
    return {"id": id, "type": "LIGNE", "x": x, "y": y, "l": l, "h": 0.4,
            "style": st(couleur=couleur, epaisseur_bordure=epaisseur, style_trait=trait)}


def cadre(id, x, y, l, h, couleur=GRIS_CLAIR, arrondi=0, epaisseur=0.4, fond_=None):
    return {"id": id, "type": "CADRE", "x": x, "y": y, "l": l, "h": h, "arrondi": arrondi,
            "style": st(couleur_bordure=couleur, epaisseur_bordure=epaisseur, fond=fond_)}


def bande(id, type_, hauteur, elements, **k):
    return {"id": id, "type": type_, "hauteur": hauteur, "elements": elements, **k}


def entete_societe(largeur: float, titre: str, sous_titre: str, prefixe: str = "h") -> list[dict]:
    """Logo, identité de la société à gauche, titre et sous-titre à droite, filet de couleur."""
    return [
        {"id": f"{prefixe}_logo", "type": "IMAGE", "x": 0, "y": 0, "l": 28, "h": 16, "valeur": 'CHARTE("logo")'},
        champ(f"{prefixe}_societe", 31, 0, 95, 6, "societe.raison_sociale", taille=11, gras=True, couleur=BLEU),
        champ(f"{prefixe}_adresse", 31, 6, 95, 4.5, 'societe.adresse + SI(ESTVIDE(societe.ville), "", " — " + societe.ville)',
              taille=7.5, couleur=GRIS),
        champ(f"{prefixe}_ids", 31, 10.5, 95, 4.5,
              '"ICE " + SIVIDE(societe.ice, "—") + "   ·   CNSS " + SIVIDE(societe.numero_cnss, "—")', taille=7.5, couleur=GRIS),
        texte(f"{prefixe}_titre", largeur - 110, 0, 110, 8, titre, taille=14, gras=True, couleur=BLEU, alignement="DROITE",
              casse="MAJUSCULES"),
        champ(f"{prefixe}_sous_titre", largeur - 110, 8, 110, 6, sous_titre, taille=9, alignement="DROITE", couleur=GRIS),
        ligne(f"{prefixe}_filet", 0, 17.5, largeur, couleur=BLEU, epaisseur=1.2),
    ]


def pied_page(largeur: float, mention: str, prefixe: str = "p") -> list[dict]:
    return [
        ligne(f"{prefixe}_filet", 0, 0.5, largeur, couleur=GRIS_CLAIR, epaisseur=0.4),
        champ(f"{prefixe}_edition", 0, 2, largeur * 0.4, 4,
              '"Édité le " + FORMAT(DATEJOUR(), "DATE_FR") + " par " + SIVIDE(UTILISATEUR("nom"), "—")', taille=6.5, couleur=GRIS),
        texte(f"{prefixe}_mention", largeur * 0.4, 2, largeur * 0.4, 4, mention, taille=6.5, italique=True, couleur=GRIS,
              alignement="CENTRE"),
        champ(f"{prefixe}_page", largeur * 0.8, 2, largeur * 0.2, 4, '"Page " + PAGE() + " / " + NB_PAGES()', taille=6.5,
              couleur=GRIS, alignement="DROITE"),
    ]


def mentions_legales(largeur: float, y: float = 2, prefixe: str = "ml") -> list[dict]:
    return [
        ligne(f"{prefixe}_filet", 0, 0.5, largeur, couleur=BLEU, epaisseur=0.6),
        champ(f"{prefixe}_legal", 0, y, largeur, 4,
              'societe.raison_sociale + SI(ESTVIDE(societe.forme_juridique), "", " — " + societe.forme_juridique)'
              ' + SI(ESTVIDE(societe.registre_commerce), "", " — RC " + societe.registre_commerce)'
              ' + SI(ESTVIDE(societe.identifiant_fiscal), "", " — IF " + societe.identifiant_fiscal)'
              ' + SI(ESTVIDE(societe.patente), "", " — Patente " + societe.patente)'
              ' + SI(ESTVIDE(societe.ice), "", " — ICE " + societe.ice)', taille=6.5, couleur=GRIS, alignement="CENTRE"),
        champ(f"{prefixe}_contact", 0, y + 4, largeur, 4,
              'SIVIDE(societe.adresse, "") + SI(ESTVIDE(societe.telephone), "", " — Tél. " + societe.telephone)'
              ' + SI(ESTVIDE(societe.email), "", " — " + societe.email)', taille=6.5, couleur=GRIS, alignement="CENTRE"),
    ]


def tableau_colonnes(prefixe, colonnes, y, h, bande_type, valeur, style_fn):
    """Une rangée de cases alignées sur `colonnes` = [(code, titre, largeur, expr, masque, align)]."""
    x, sortie = 0.0, []
    for code, titre, l, expr, masque, align in colonnes:
        v = valeur(code, titre, expr)
        if v is not None:
            if bande_type == "TITRE":
                sortie.append(texte(f"{prefixe}_{code}", x + 0.8, y, l - 1.6, h, titre, **style_fn(align)))
            else:
                sortie.append(champ(f"{prefixe}_{code}", x + 0.8, y, l - 1.6, h, v, masque=masque, **style_fn(align)))
        x += l
    return sortie


def definition(parametres, jeux, bandes, page, sortie, variables=None, usages=None):
    d = {"schema_version": 1, "parametres": parametres, "jeux": jeux, "corps": [], "variables": variables or [],
         "usages": usages or {}, "forme_code": "standard", "forme_libelle": "Mise en forme standard",
         "page": page, "bandes": bandes, "sortie": sortie, "formes": []}
    return d


# =============================================================================
# 1. JOURNAL — Journal de paie (présentation synthétique, proposée en 2e mise en forme)
# =============================================================================
def journal_paie_synthetique() -> dict:
    L = 277.0
    cols = [  # code, titre, largeur, expression, masque, alignement
        ("mat", "Matricule", 18, "identite.matricule", None, "GAUCHE"),
        ("nom", "Nom et prénom", 50, 'identite.nom + " " + identite.prenom', None, "GAUCHE"),
        ("emploi", "Emploi", 38, 'SIVIDE(affectation.emploi_libelle, "—")', None, "GAUCHE"),
        ("brut", "Salaire brut", 22, "total_brut", "MONTANT", "DROITE"),
        ("brut_imp", "Brut imposable", 22, "total_brut_imposable", "MONTANT", "DROITE"),
        ("cot_sal", "Cot. salariales", 21, "total_cot_salariale", "MONTANT", "DROITE"),
        ("net_imp", "Net imposable", 22, "net_imposable", "MONTANT", "DROITE"),
        ("ret", "Retenues", 21, "total_retenues", "MONTANT", "DROITE"),
        ("net", "Net à payer", 23, "net_a_payer", "MONTANT", "DROITE"),
        ("cot_pat", "Cot. patronales", 20, "total_cot_patronale", "MONTANT", "DROITE"),
        ("cout", "Coût empl.", 20, "cout_employeur", "MONTANT", "DROITE"),
    ]
    montants = [c for c in cols if c[4] == "MONTANT"]

    def ligne_totaux(prefixe, portee, y, h, couleur, fond_, libelle):
        el = [fond(f"{prefixe}_fond", 0, y, L, h, fond_)]
        el.append(champ(f"{prefixe}_lib", 1, y, 105, h, libelle, taille=7.5, gras=True, couleur=couleur))
        x = 0.0
        for code, _t, l, expr, masque, _a in cols:
            if masque == "MONTANT":
                el.append(champ(f"{prefixe}_{code}", x + 0.8, y, l - 1.6, h, f"TOTAL({expr}, {portee})", masque="MONTANT",
                                taille=7.5, gras=True, couleur=couleur, alignement="DROITE"))
            x += l
        return el

    en_tete = entete_societe(L, "Journal de paie",
                             f'"Période : " + {MOIS} + SI(ESTVIDE(@plan_paie), "", "   ·   plan filtré")')
    en_tete += [fond("col_fond", 0, 21, L, 8, BLEU)]
    en_tete += tableau_colonnes("col", cols, 21, 8, "TITRE", lambda c, t, e: t,
                                lambda a: dict(taille=7, gras=True, couleur=BLANC, alignement=a if a != "GAUCHE" else "GAUCHE"))
    corps = tableau_colonnes("v", cols, 0, 5, "VALEUR", lambda c, t, e: e,
                             lambda a: dict(taille=7.5, alignement=a))
    corps.append(ligne("v_sep", 0, 4.8, L, couleur=GRIS_CLAIR, epaisseur=0.2, trait="POINTILLES"))
    groupe_tete = [
        fond("g_fond", 0, 1, L, 6, BLEU_CLAIR),
        champ("g_titre", 2, 1, 200, 6, '"Plan de paie : " + SIVIDE(plan.code, "—") + SI(ESTVIDE(plan.libelle), "", " — " + plan.libelle)',
              taille=8, gras=True, couleur=BLEU),
    ]
    groupe_pied = ligne_totaux("sg", "GROUPE", 0.5, 6, BLEU, BLEU_CLAIR,
                               '"Sous-total " + SIVIDE(plan.libelle, plan.code) + " (" + NB(matricule, GROUPE) + " salariés)"')
    synthese_y = 12
    lib = lambda id, y, t: texte(id, 2, synthese_y + y, 70, 5, t, taille=8, couleur=GRIS)
    val = lambda id, y, e, m="MONTANT": champ(id, 72, synthese_y + y, 40, 5, e, masque=m, taille=8, gras=True, alignement="DROITE")
    pied_etat = ligne_totaux("tg", "ETAT", 1, 7, BLANC, BLEU, '"TOTAL GÉNÉRAL — " + NB(matricule, ETAT) + " salariés"') + [
        texte("syn_titre", 0, synthese_y - 4, 115, 4, "Synthèse de la période", taille=8.5, gras=True, couleur=BLEU),
        cadre("syn_cadre", 0, synthese_y, 115, 37, couleur=GRIS_CLAIR, arrondi=1.5),
        lib("syn_l1", 1, "Effectif payé"), val("syn_v1", 1, "NB(matricule, ETAT)", "ENTIER"),
        lib("syn_l2", 6, "Masse salariale brute"), val("syn_v2", 6, "TOTAL(total_brut, ETAT)"),
        lib("syn_l3", 11, "Salaire brut moyen"), val("syn_v3", 11, "MOYENNE_SUR(total_brut, ETAT)"),
        lib("syn_l4", 16, "Net à payer le plus élevé"), val("syn_v4", 16, "MAX_SUR(net_a_payer, ETAT)"),
        lib("syn_l5", 21, "Net à payer le plus bas"), val("syn_v5", 21, "MIN_SUR(net_a_payer, ETAT)"),
        lib("syn_l6", 26, "Charges patronales / masse brute"),
        val("syn_v6", 26, "SI(TOTAL(total_brut, ETAT) = 0, 0, TOTAL(total_cot_patronale, ETAT) / TOTAL(total_brut, ETAT) * 100)",
            "POURCENTAGE"),
        lib("syn_l7", 31, "Coût employeur total"), val("syn_v7", 31, "TOTAL(cout_employeur, ETAT)"),
    ]
    # visas
    for i, (code, titre) in enumerate([("etabli", "Établi par"), ("verifie", "Vérifié par"), ("approuve", "Approuvé par")]):
        x = 125 + i * 51
        pied_etat += [cadre(f"visa_{code}", x, synthese_y, 48, 37, couleur=GRIS_CLAIR, arrondi=1.5),
                      texte(f"visa_{code}_t", x + 2, synthese_y + 1, 44, 5, titre, taille=8, gras=True, couleur=BLEU),
                      texte(f"visa_{code}_d", x + 2, synthese_y + 30, 44, 5, "Date et signature", taille=6.5, italique=True,
                            couleur=GRIS)]
    pied = pied_page(L, "Document confidentiel — usage interne") + [
        champ("p_report", 0, 6, 120, 4, '"Net à payer cumulé à ce stade : " + FORMAT(TOTAL(net_a_payer, REPORT), "MONTANT")',
              taille=6.5, couleur=GRIS),
    ]
    return definition(
        [PARAM_MOIS, PARAM_PLAN, PARAM_COLLABS],
        [{"code": "b", "source": "BULLETIN", "role": "PRINCIPAL", "filtres": [],
          "tri": [{"champ": "plan.code"}, {"champ": "identite.nom"}, {"champ": "identite.prenom"}], "groupes": ["plan.code"]}],
        [bande("en_tete", "EN_TETE_PAGE", 31, en_tete),
         bande("groupe_tete", "EN_TETE_GROUPE", 8, groupe_tete, niveau_groupe=1),
         bande("detail", "CORPS", 5, corps),
         bande("groupe_pied", "PIED_GROUPE", 9, groupe_pied, niveau_groupe=1),
         bande("total", "PIED_ETAT", 52, pied_etat, insecable=True),
         bande("pied", "PIED_PAGE", 11, pied)],
        {"format": "A4", "orientation": "PAYSAGE", "marges": [10, 10, 10, 10]},
        {"formats": ["PDF"], "nom_fichier": '"Journal_paie_" + @periode.code'},
        usages={"confidentialite": 3})


# =============================================================================
# 1 bis. JOURNAL — présentation « grille réglementaire » (4 lignes par salarié)
# =============================================================================
GRIS_ENTETE = "#E3E6E8"
# 4 lignes × 8 colonnes de valeurs ; (titre d'en-tête, affectation) — None : case libre, à affecter dans
# le designer (Données › corps « journal »). Les codes sont ceux du plan de paie livré (paie_seed).
GRILLE_JOURNAL = [
    [("Jrs\nTravaillés", ("NBJTRV", "NB")), ("Salaire de\nBase", ("SALBASE", "MT")), ("Jrs\nCongés", ("NBJCNG", "NB")),
     ("Salaire\nCongé Payé", ("SALCONGE", "MT")), ("Congé Payé\nPour Départ", None), ("Prime\nAncienneté", ("PRIM_ANC", "MT")),
     ("", None), ("", None)],
    [("Ind. de\nCaisse", None), ("Ind.\nTransport", ("INDTRSP", "MT")), ("Ind.\nReprésentation", ("INDREPR", "MT")),
     ("Ind. Panier", None), ("Ind. forfaitaire\nde déplacement", None), ("", None),
     ("Salaire Brut", ("=", "total_brut")), ("Brut\nImposable", ("=", "total_brut_imposable"))],
    [("CNSS", ("CNSS_SAL", "MT")), ("AMO", ("CNSS_AMO_SAL", "MT")), ("", None), ("", None), ("", None),
     ("Frais\nProfessionnel", ("FRAIS_PROF", "MT")), ("Net Imposable", ("=", "net_imposable")), ("Retenue IR", ("RET_IR", "MT"))],
    [("Remb. Frais\nDéplacement", None), ("Ret. Avance\nSur Salaire", None), ("", None), ("", None), ("", None),
     ("", None), ("", None), ("Net à Payer", ("=", "net_a_payer"))],
]


def journal_paie() -> dict:
    synthetique = journal_paie_synthetique()
    L = 277.0
    A, B = 22.0, 72.0                    # colonne Matricule/CIN/Entrée, bloc Collaborateur
    B1, B2, B3 = 24.0, 32.0, 16.0        # Dt. naissance | CNSS | Sit. fam.
    XV = A + B
    LV = (L - XV) / 8                    # largeur d'une colonne de valeurs
    HE, HL = 7.0, 5.0                    # hauteur d'une rangée d'en-tête / d'une rangée salarié
    trait = dict(bordures="TOUT", epaisseur_bordure=0.3, couleur_bordure="#555555")

    corps_cases = {
        "code": "journal", "libelle": "Journal (4 lignes × 8 colonnes)", "nature": "CASES",
        "colonnes": [{"code": f"c{j + 1}", "libelle": f"Colonne {j + 1}", "type": "MONTANT"} for j in range(8)],
        "lignes": [{"code": f"l{i + 1}", "libelle": f"Ligne {i + 1}"} for i in range(4)],
        "affectations": [], "emplacement": "MASQUE",
    }
    for i, rang in enumerate(GRILLE_JOURNAL):
        for j, (titre, aff) in enumerate(rang):
            if not aff:
                continue
            cible = f"l{i + 1}.c{j + 1}"
            lib = titre.replace("\n", " ")
            if aff[0] == "=":
                corps_cases["affectations"].append({"formule": aff[1], "cibles": {"VAL": cible}, "libelle": lib})
            else:
                corps_cases["affectations"].append({"rubrique": aff[0], "cibles": {aff[1]: cible}, "libelle": lib})

    def cellule(id, x, y, l, h, valeur, est_texte=False, **s):
        st_ = {**trait, **s}
        if est_texte:                     # intitulé sur deux lignes au besoin (texte riche : retour à la ligne)
            return {**riche(id, x, y, l, h, valeur, **st_), "extensible": False}
        return champ(id, x, y, l, h, valeur, **st_)

    # ---- en-tête de page : société, titre, période, puis les 4 rangées de titres
    lbl = dict(taille=8, gras=True)
    en_tete = [
        {"id": "logo", "type": "IMAGE", "x": 0, "y": 0, "l": 40, "h": 18, "valeur": 'CHARTE("logo")'},
        texte("l_adr", 44, 0, 32, 5, "Adresse :", **lbl), champ("v_adr", 76, 0, 120, 5,
              'SIVIDE(societe.adresse, "") + SI(ESTVIDE(societe.ville), "", ", " + MAJUSCULE(societe.ville))', taille=8),
        texte("l_if", 44, 5.5, 32, 5, "Identifiant Fiscal :", **lbl), champ("v_if", 76, 5.5, 60, 5, 'SIVIDE(societe.identifiant_fiscal, "")', taille=8),
        texte("l_cnss", 44, 11, 32, 5, "Affiliation CNSS :", **lbl), champ("v_cnss", 76, 11, 60, 5, 'SIVIDE(societe.numero_cnss, "")', taille=8),
        texte("l_date", 205, 0, 32, 5, "Date d'édition :", **lbl, alignement="DROITE"),
        champ("v_date", 239, 0, 38, 5, 'FORMAT(DATEJOUR(), "DATE_FR")', taille=8, alignement="DROITE"),
        texte("titre", 0, 20, L, 9, "JOURNAL DE PAIE", taille=15, gras=True, alignement="CENTRE"),
        texte("l_mois", 98, 31, 42, 5, "Mois de Paie :", taille=9, gras=True),
        champ("v_mois", 140, 31, 50, 5, MOIS, taille=9, gras=True, casse="INITIALES"),
        texte("l_du", 98, 38, 42, 5, "Période de Paie du :", taille=9, gras=True),
        champ("v_du", 140, 38, 25, 5, 'FORMAT(@periode.date_debut, "DATE_FR")', taille=9),
        texte("l_au", 166, 38, 9, 5, "Au", taille=9, gras=True),
        champ("v_au", 176, 38, 25, 5, 'FORMAT(@periode.date_fin, "DATE_FR")', taille=9),
    ]
    y0 = 47.0
    ent = dict(taille=7, gras=True, fond=GRIS_ENTETE, alignement="CENTRE")
    en_tete += [
        cellule("e_mat", 0, y0, A, HE, "Matricule", True, **ent),
        cellule("e_collab", A, y0, B, HE, "Collaborateur", True, **ent),
        cellule("e_cin", 0, y0 + HE, A, HE, "Cin", True, **ent),
        cellule("e_naiss", A, y0 + HE, B1, HE, "Dt.\nNaissance", True, **ent),
        cellule("e_cnss", A + B1, y0 + HE, B2, HE, "Cnss", True, **ent),
        cellule("e_sf", A + B1 + B2, y0 + HE, B3, HE, "Sit.\nFam", True, **ent),
        cellule("e_entree", 0, y0 + 2 * HE, A, 2 * HE, "Date\nd'Entrée", True, **ent),
        cellule("e_fonction", A, y0 + 2 * HE, B, 2 * HE, "Fonction", True, **ent),
    ]
    for i, rang in enumerate(GRILLE_JOURNAL):
        for j, (titre, _a) in enumerate(rang):
            en_tete.append(cellule(f"e_{i + 1}_{j + 1}", XV + j * LV, y0 + i * HE, LV, HE, titre, True, **ent))
    # ---- un salarié = 4 rangées
    val = dict(police="Courier", taille=7.5)
    corps = [
        cellule("s_mat", 0, 0, A, HL, "identite.matricule", **val, gras=True),
        cellule("s_nom", A, 0, B, HL, 'SIVIDE(identite.civilite, "") + " " + MAJUSCULE(identite.nom) + " " + identite.prenom', **val, gras=True),
        cellule("s_cin", 0, HL, A, HL, 'SIVIDE(identite.cin, "")', **val),
        cellule("s_naiss", A, HL, B1, HL, 'SI(ESTVIDE(identite.date_naissance), "", FORMAT(identite.date_naissance, "DATE_FR"))', **val, alignement="CENTRE"),
        cellule("s_cnss", A + B1, HL, B2, HL, 'SIVIDE(identite.num_cnss, "")', **val, alignement="CENTRE"),
        cellule("s_sf", A + B1 + B2, HL, B3, HL, 'MAJUSCULE(GAUCHE(SIVIDE(situation_familiale.libelle, ""), 1))', **val, gras=True, alignement="CENTRE"),
        cellule("s_entree", 0, 2 * HL, A, 2 * HL, 'SI(ESTVIDE(contrat.date_embauche), "", FORMAT(contrat.date_embauche, "DATE_FR"))', **val),
        cellule("s_fonction", A, 2 * HL, B, 2 * HL, 'SIVIDE(affectation.emploi_libelle, "")', **val, gras=True),
    ]
    for i in range(4):
        for j in range(8):
            corps.append(champ(f"s_{i + 1}_{j + 1}", XV + j * LV, i * HL, LV, HL, f"corps.journal.l{i + 1}.c{j + 1}",
                               masque="MONTANT", **trait, **val, alignement="DROITE"))
    # ---- totaux de l'état : même grille, sommes
    totaux = [texte("t_lib", 0, 2, XV - 4, 6, "TOTAUX", taille=9, gras=True, alignement="DROITE"),
              champ("t_eff", 0, 9, XV - 4, 5, '"Effectif : " + NB(matricule, ETAT) + " salarié(s)"', taille=8, alignement="DROITE",
                    couleur=GRIS)]
    for i in range(4):
        for j in range(8):
            dernier = (i, j) == (3, 7)
            totaux.append(champ(f"t_{i + 1}_{j + 1}", XV + j * LV, 2 + i * (HL + 1.5), LV, HL + 1.5,
                                f"TOTAL(corps.journal.l{i + 1}.c{j + 1}, ETAT)", masque="MONTANT_SANS_ZERO", vide="-", taille=7.5, gras=True,
                                alignement="DROITE", bordures="TOUT", epaisseur_bordure=0.4, couleur_bordure="#555555",
                                fond="#BFC5C9" if dernier else None))
    pied = [champ("p_page", L - 40, 2, 40, 4, '"Page " + PAGE() + "/" + NB_PAGES()', taille=7, gras=True, alignement="DROITE"),
            champ("p_edit", 0, 2, 150, 4, '"Édité par " + SIVIDE(UTILISATEUR("nom"), "—")', taille=6.5, couleur=GRIS)]
    d = definition(
        [PARAM_MOIS, PARAM_PLAN, PARAM_COLLABS],
        [{"code": "b", "source": "BULLETIN", "role": "PRINCIPAL", "filtres": [],
          "tri": [{"champ": "plan.code"}, {"champ": "identite.matricule"}], "groupes": ["plan.code"]}],
        [bande("en_tete", "EN_TETE_PAGE", y0 + 4 * HE + 1, en_tete),
         bande("salarie", "CORPS", 4 * HL + 1.5, corps, insecable=True),
         bande("totaux", "PIED_ETAT", 2 + 4 * (HL + 1.5) + 2, totaux, insecable=True),
         bande("pied", "PIED_PAGE", 8, pied)],
        {"format": "A4", "orientation": "PAYSAGE", "marges": [8, 10, 8, 10]},
        {"formats": ["PDF"], "nom_fichier": '"Journal_paie_" + @periode.code'},
        usages={"confidentialite": 3, "formes_au_choix": True})
    d["corps"] = [corps_cases]
    d["forme_code"], d["forme_libelle"] = "grille", "Grille réglementaire (4 lignes par salarié)"
    # l'ancienne présentation reste proposée au lancement (« Mise en forme »)
    d["formes"] = [{"code": "synthetique", "libelle": "Synthétique (une ligne par salarié, sous-totaux par plan)",
                    "page": synthetique["page"], "bandes": synthetique["bandes"], "sortie": synthetique["sortie"]}]
    return d


# =============================================================================
# 2. LISTE — Ordre de virement des salaires
# =============================================================================
def ordre_virement() -> dict:
    L = 180.0
    cols = [
        ("rang", "N°", 9, "NB(matricule, REPORT)", "ENTIER", "CENTRE"),
        ("mat", "Matricule", 18, "identite.matricule", None, "GAUCHE"),
        ("nom", "Bénéficiaire", 52, 'MAJUSCULE(identite.nom) + " " + identite.prenom', None, "GAUCHE"),
        ("agence", "Agence", 30, 'SIVIDE(paiement.nom_agence, "—")', None, "GAUCHE"),
        ("rib", "N° de compte (RIB)", 46, 'SIVIDE(paiement.numero_compte, "— à compléter —")', None, "GAUCHE"),
        ("net", "Montant (DH)", 25, "net_a_payer", "MONTANT", "DROITE"),
    ]
    lettre = [
        *entete_societe(L, "Ordre de virement", f'"Salaires de " + {MOIS}'),
        texte("dest_a", 100, 24, 80, 5, "À l'attention de Monsieur le Directeur", taille=9),
        texte("dest_b", 100, 29, 80, 5, "de l'agence bancaire teneur de notre compte", taille=9),
        champ("lieu_date", 100, 37, 80, 5, 'SIVIDE(societe.ville, "") + ", le " + FORMAT(DATEJOUR(), "DATE_LONGUE")', taille=9),
        champ("objet", 0, 46, L, 6, f'"Objet : ordre de virement des salaires — " + {MOIS}', taille=9.5, gras=True),
        riche("corps_lettre", 0, 54, L, 16,
              "Madame, Monsieur,\n\nNous vous prions de bien vouloir débiter notre compte et créditer les comptes "
              "des bénéficiaires désignés ci-dessous des montants indiqués, au titre des salaires de "
              "{FORMAT(@periode.date_fin, \"MOIS_ANNEE\")}. Le montant total de l'ordre figure en fin de liste.",
              taille=9),
    ]
    entete_col = [fond("c_fond", 0, 2, L, 7, BLEU)] + tableau_colonnes(
        "c", cols, 2, 7, "TITRE", lambda c, t, e: t, lambda a: dict(taille=7.5, gras=True, couleur=BLANC, alignement=a))
    groupe_tete = [fond("g_fond", 0, 1, L, 6, BLEU_CLAIR),
                   champ("g_titre", 2, 1, 150, 6, '"Banque : " + SIVIDE(paiement.banque_libelle, "non renseignée")',
                         taille=8.5, gras=True, couleur=BLEU)]
    corps = tableau_colonnes("v", cols, 0, 5.5, "VALEUR", lambda c, t, e: e, lambda a: dict(taille=8, alignement=a))
    corps.append(ligne("v_sep", 0, 5.3, L, couleur=GRIS_CLAIR, epaisseur=0.2))
    groupe_pied = [
        champ("sg_lib", 60, 0.5, 90, 6, '"Total " + SIVIDE(paiement.banque_libelle, "banque non renseignée") + " (" + NB(matricule, GROUPE) + ")"',
              taille=8, gras=True, alignement="DROITE", couleur=BLEU),
        champ("sg_net", 155.8, 0.5, 23.4, 6, "TOTAL(net_a_payer, GROUPE)", masque="MONTANT", taille=8, gras=True,
              alignement="DROITE", couleur=BLEU),
        ligne("sg_filet", 120, 6.6, 60, couleur=BLEU, epaisseur=0.4),
    ]
    pied_etat = [
        fond("tg_fond", 0, 2, L, 8, BLEU),
        champ("tg_lib", 2, 2, 140, 8, '"TOTAL DE L\'ORDRE — " + NB(matricule, ETAT) + " virements"', taille=9, gras=True,
              couleur=BLANC),
        champ("tg_net", 140, 2, 39, 8, "TOTAL(net_a_payer, ETAT)", masque="MONTANT", texte_apres=None, taille=10, gras=True,
              couleur=BLANC, alignement="DROITE"),
        riche("arrete", 0, 14, L, 10,
              "Arrêté le présent ordre de virement à la somme de : "
              "{MAJUSCULE(MONTANT_EN_LETTRES(TOTAL(net_a_payer, ETAT)))}.", taille=9, gras=True),
        riche("politesse", 0, 26, L, 8,
              "Nous vous prions d'agréer, Madame, Monsieur, l'expression de nos salutations distinguées.", taille=9),
        cadre("sig_cadre", 110, 38, 70, 32, couleur=GRIS_CLAIR, arrondi=1.5),
        texte("sig_titre", 112, 39, 66, 5, "Signature(s) et cachet autorisés", taille=8, gras=True, couleur=BLEU),
        champ("sig_nom", 112, 64, 66, 5, 'SIVIDE(societe.nom_gerant, "")', taille=8, alignement="CENTRE"),
    ]
    return definition(
        [PARAM_MOIS, PARAM_PLAN, PARAM_COLLABS],
        [{"code": "b", "source": "BULLETIN", "role": "PRINCIPAL",
          "filtres": ["net_a_payer > 0"],
          "tri": [{"champ": "paiement.banque_libelle"}, {"champ": "identite.nom"}, {"champ": "identite.prenom"}],
          "groupes": ["paiement.banque_libelle"]}],
        [bande("lettre", "EN_TETE_ETAT", 72, lettre, extensible=True),
         bande("colonnes", "EN_TETE_PAGE", 10, entete_col),
         bande("groupe_tete", "EN_TETE_GROUPE", 8, groupe_tete, niveau_groupe=1),
         bande("detail", "CORPS", 5.5, corps),
         bande("groupe_pied", "PIED_GROUPE", 9, groupe_pied, niveau_groupe=1),
         bande("total", "PIED_ETAT", 72, pied_etat, insecable=True, extensible=True),
         bande("pied", "PIED_PAGE", 8, pied_page(L, "Ordre de virement — document bancaire"))],
        {"format": "A4", "orientation": "PORTRAIT", "marges": [15, 15, 12, 15]},
        {"formats": ["PDF"], "nom_fichier": '"Ordre_virement_" + @periode.code'},
        usages={"confidentialite": 4})


# =============================================================================
# 3. ATTESTATION — Attestation de travail et de salaire
# =============================================================================
def attestation() -> dict:
    L = 180.0
    grille = {
        "id": "remuneration", "type": "GRILLE", "x": 15, "y": 8, "l": 150, "h": 42,
        "largeur_titres": 70, "hauteur_ligne": 6.5, "quadrillage": "COMPLET",
        "style": {"taille": 9, "couleur_bordure": GRIS_CLAIR},
        "style_entete": {"gras": True, "couleur": BLANC, "fond": BLEU, "alignement": "CENTRE"},
        "style_titres": {"couleur": BLEU},
        "colonnes": [
            {"id": "mois", "titre": "Mois de la période", "largeur": 40, "affichage": {"masque": "MONTANT"},
             "style": {"alignement": "DROITE"}},
            {"id": "cumul", "titre": "Cumul de l'année", "largeur": 40, "affichage": {"masque": "MONTANT"},
             "style": {"alignement": "DROITE"}},
        ],
        "lignes": [
            {"id": "brut", "titre": "Salaire brut", "valeurs": {"mois": "total_brut", "cumul": "cumul.total_brut"}},
            {"id": "imposable", "titre": "Salaire brut imposable",
             "valeurs": {"mois": "total_brut_imposable", "cumul": "cumul.total_brut_imposable"}},
            {"id": "cotisations", "titre": "Cotisations salariales",
             "valeurs": {"mois": "total_cot_salariale", "cumul": "cumul.total_cot_salariale"}},
            {"id": "net_imp", "titre": "Net imposable", "valeurs": {"mois": "net_imposable", "cumul": "cumul.net_imposable"}},
            {"id": "net", "titre": "Net à payer", "valeurs": {"mois": "net_a_payer", "cumul": "cumul.net_a_payer"},
             "style": {"gras": True}},
        ],
    }
    titre = [
        texte("titre", 0, 4, L, 10, "Attestation de travail et de salaire", taille=16, gras=True, couleur=BLEU,
              alignement="CENTRE", casse="PETITES_MAJUSCULES"),
        ligne("titre_filet", 65, 15, 50, couleur=BLEU, epaisseur=1),
        champ("reference", 0, 18, L, 5, '"Réf. : ATT-" + @periode.code + "-" + identite.matricule', taille=8, couleur=GRIS,
              alignement="CENTRE"),
    ]
    corps_texte = [
        riche("paragraphe", 0, 2, L, 30,
              "Nous soussignés, {societe.raison_sociale}{SI(ESTVIDE(societe.forme_juridique), \"\", \", \" + societe.forme_juridique)}, "
              "dont le siège est situé {SIVIDE(societe.adresse, \"\")}{SI(ESTVIDE(societe.ville), \"\", \" à \" + societe.ville)}, "
              "immatriculée à la CNSS sous le n° {SIVIDE(societe.numero_cnss, \"—\")}, attestons par la présente que :\n\n"
              "{SIVIDE(identite.civilite, \"\")} {MAJUSCULE(identite.nom)} {identite.prenom}, "
              "titulaire de la CIN n° {SIVIDE(identite.cin, \"—\")}, immatriculé(e) à la CNSS sous le n° "
              "{SIVIDE(identite.num_cnss, \"—\")}, matricule {identite.matricule}, fait partie de notre personnel depuis le "
              "{SI(ESTVIDE(contrat.date_embauche), \"……………\", FORMAT(contrat.date_embauche, \"DATE_LONGUE\"))} en qualité de {SIVIDE(affectation.emploi_libelle, \"salarié(e)\")}"
              "{SI(ESTVIDE(contrat.code_type_contrat), \"\", \", sous contrat \" + SIVIDE(contrat.type_contrat_libelle, contrat.code_type_contrat))}.\n\n"
              "Sa rémunération pour la période de {FORMAT(@periode.date_fin, \"MOIS_ANNEE\")} et le cumul depuis le début de "
              "l'année s'établissent comme suit :", taille=10),
    ]
    tableau = [texte("rem_titre", 15, 1, 150, 6, "Rémunération (en dirhams)", taille=9, gras=True, couleur=BLEU), grille]
    cloture = [
        riche("en_lettres", 0, 2, L, 8,
              "Soit un net à payer de {FORMAT(net_a_payer, \"MONTANT\")} DH pour le mois "
              "({MONTANT_EN_LETTRES(net_a_payer)}).", taille=10, italique=True),
        riche("usage", 0, 12, L, 8,
              "La présente attestation est délivrée à l'intéressé(e), sur sa demande, pour servir et valoir ce que de droit.",
              taille=10),
        champ("fait_a", 95, 26, 85, 6, '"Fait à " + SIVIDE(societe.ville, "………") + ", le " + FORMAT(DATEJOUR(), "DATE_LONGUE")',
              taille=10),
        texte("pour_societe", 95, 33, 85, 5, "Pour la société,", taille=10, gras=True),
        champ("signataire", 95, 38, 85, 5, 'SIVIDE(societe.nom_gerant, "La Direction")', taille=10),
        cadre("zone_signature", 95, 44, 70, 28, couleur=GRIS_CLAIR, arrondi=2),
        texte("zone_signature_t", 97, 66, 66, 5, "Signature et cachet", taille=7, italique=True, couleur=GRIS,
              alignement="CENTRE"),
        {"id": "qr", "type": "CODE_BARRE", "x": 0, "y": 44, "l": 24, "h": 24, "symbologie": "QR",
         "valeur": '"ATT|" + SIVIDE(societe.ice, "") + "|" + identite.matricule + "|" + @periode.code + "|" + FORMAT(net_a_payer, "MONTANT")'},
        {**texte("qr_t", 26, 52, 55, 10, "Code de contrôle : référence, salarié, période et net attestés", taille=6.5,
                 italique=True, couleur=GRIS), "extensible": True},
    ]
    d = definition(
        [PARAM_MOIS, PARAM_COLLABS],
        [{"code": "b", "source": "BULLETIN", "role": "PRINCIPAL", "filtres": [],
          "tri": [{"champ": "identite.nom"}, {"champ": "identite.prenom"}]}],
        [bande("en_tete", "EN_TETE_PAGE", 24, entete_societe(L, "Ressources humaines", f'"Période : " + {MOIS}')),
         bande("titre", "CORPS", 26, titre),
         bande("texte", "CORPS", 34, corps_texte, extensible=True),
         bande("tableau", "CORPS", 52, tableau, insecable=True),
         bande("cloture", "CORPS", 74, cloture, extensible=True, insecable=True),
         bande("pied", "PIED_PAGE", 12, mentions_legales(L))],
        {"format": "A4", "orientation": "PORTRAIT", "marges": [15, 15, 12, 15]},
        {"formats": ["PDF"], "nom_fichier": '"Attestation_" + identite.matricule + "_" + @periode.code',
         "eclatement": "collaborateur_id", "qr_verification": True},
        usages={"confidentialite": 3, "duplicata": True})
    return completer_attestation(d)


# RG-EDT-ATTESTATION-01 (Adil DAIA) : l'attestation se règle au lancement — date, objet (liste, ou texte libre
# qui la remplace), contenu « travail et salaire » ou « travail seulement » (sans rémunération ni montant en lettres).
OBJETS_ATTESTATION = [
    "pour servir et valoir ce que de droit",
    "pour la constitution d'un dossier de crédit bancaire",
    "pour la constitution d'un dossier de visa",
    "pour la constitution d'un dossier administratif",
    "pour la constitution d'un dossier de location",
]
PARAMS_ATTESTATION = [
    {"code": "contenu", "libelle": "Contenu", "type": "LISTE", "obligatoire": False,
     "valeurs": ["Travail et salaire", "Travail seulement"], "defaut": '"Travail et salaire"'},
    {"code": "date_attestation", "libelle": "Date de l'attestation", "type": "DATE", "obligatoire": False, "defaut": "DATEJOUR()"},
    {"code": "objet", "libelle": "Objet", "type": "LISTE", "obligatoire": False, "valeurs": OBJETS_ATTESTATION,
     "defaut": '"' + OBJETS_ATTESTATION[0] + '"'},
    {"code": "objet_libre", "libelle": "Autre objet (remplace la liste, ex. pour la constitution d'un dossier de bourse)",
     "type": "TEXTE", "obligatoire": False},
]
SALAIRE = '@contenu <> "Travail seulement"'


def completer_attestation(d: dict) -> dict:
    """Ajoute les réglages de lancement à une attestation (modèle livré ou copie) ; sans effet s'ils y sont.
    Les éléments du modèle livré servent de repères (identifiants) ; le reste de la mise en page ne bouge pas."""
    codes = {p["code"] for p in d.get("parametres", [])}
    d["parametres"] = d.get("parametres", []) + [dict(p) for p in PARAMS_ATTESTATION if p["code"] not in codes]
    objet = 'SI(ESTVIDE(@objet_libre), SIVIDE(@objet, "pour servir et valoir ce que de droit"), @objet_libre)'
    queue = ("Sa rémunération pour la période de {FORMAT(@periode.date_fin, \"MOIS_ANNEE\")} et le cumul depuis le début de "
             "l'année s'établissent comme suit :")
    queue_cond = ('{SI(' + SALAIRE + ', "Sa rémunération pour la période de " + FORMAT(@periode.date_fin, "MOIS_ANNEE") + '
                  '" et le cumul depuis le début de l\'année s\'établissent comme suit :", "")}')
    for b in d.get("bandes", []):
        if b.get("id") == "tableau" and not b.get("condition"):
            b["condition"] = SALAIRE
        for el in b.get("elements", []):
            i = el.get("id")
            if i == "titre" and el.get("type") == "TEXTE" and "@contenu" not in (el.get("valeur") or ""):
                el["valeur"] = 'SI(@contenu = "Travail seulement", "Attestation de travail", "Attestation de travail et de salaire")'
            elif i == "paragraphe" and queue in (el.get("contenu") or ""):
                el["contenu"] = el["contenu"].replace(queue, queue_cond)
            elif i == "en_lettres" and not el.get("condition"):
                el["condition"] = {"expression": SALAIRE}
            elif i == "usage" and "@objet" not in (el.get("contenu") or ""):
                el["contenu"] = "La présente attestation est délivrée à l'intéressé(e), sur sa demande, {" + objet + "}."
            elif i == "fait_a" and "DATEJOUR()" in (el.get("valeur") or "") and "@date_attestation" not in el["valeur"]:
                el["valeur"] = el["valeur"].replace("DATEJOUR()", "SIVIDE(@date_attestation, DATEJOUR())")
    return d


# =============================================================================
# 4. COURRIER — Notification de rémunération (enveloppe à fenêtre)
# =============================================================================
def notification() -> dict:
    L = 180.0
    en_tete = [
        {"id": "logo", "type": "IMAGE", "x": 0, "y": 0, "l": 32, "h": 18, "valeur": 'CHARTE("logo")'},
        champ("societe", 0, 20, 90, 6, "societe.raison_sociale", taille=10, gras=True, couleur=BLEU),
        champ("societe_adr", 0, 26, 90, 5, 'SIVIDE(societe.adresse, "")', taille=8, couleur=GRIS),
        champ("societe_ville", 0, 30.5, 90, 5, 'SIVIDE(societe.code_postal, "") + " " + SIVIDE(societe.ville, "")', taille=8,
              couleur=GRIS),
        texte("service", 0, 36, 90, 5, "Direction des ressources humaines", taille=8, italique=True, couleur=GRIS),
        # bloc adresse positionné pour une enveloppe à fenêtre (DL, fenêtre à droite)
        texte("confidentiel", 100, 32, 80, 5, "Personnel et confidentiel", taille=8, gras=True, couleur=BLEU,
              casse="MAJUSCULES"),
        champ("dest_nom", 100, 40, 80, 6, 'SIVIDE(identite.civilite, "") + " " + identite.prenom + " " + MAJUSCULE(identite.nom)',
              taille=10, gras=True),
        champ("dest_adr", 100, 46, 80, 5, 'SIVIDE(adresse.adresse, "")', taille=10),
        champ("dest_cpl", 100, 51, 80, 5, 'SIVIDE(adresse.complement_adresse, "")', taille=10),
        champ("dest_ville", 100, 56, 80, 5, 'SIVIDE(adresse.code_postal, "") + " " + MAJUSCULE(SIVIDE(adresse.ville_libelle, SIVIDE(adresse.code_ville, "")))',
              taille=10),
        champ("lieu_date", 100, 70, 80, 5, 'SIVIDE(societe.ville, "") + ", le " + FORMAT(DATEJOUR(), "DATE_LONGUE")', taille=9),
        champ("reference", 0, 70, 90, 5, '"N/Réf. : DRH/REM/" + @periode.code + "/" + identite.matricule', taille=8, couleur=GRIS),
        champ("objet", 0, 79, L, 6, f'"Objet : votre rémunération de " + {MOIS}', taille=10, gras=True),
    ]
    grille = {
        "id": "detail", "type": "GRILLE", "x": 20, "y": 2, "l": 140, "h": 36, "largeur_titres": 90, "hauteur_ligne": 6,
        "quadrillage": "AUCUN", "entete": False, "style": {"taille": 9.5},
        "style_titres": {"couleur": GRIS, "fond": BLANC},
        "colonnes": [{"id": "v", "titre": "", "largeur": 50, "affichage": {"masque": "MONTANT", "texte_apres": " DH"},
                      "style": {"alignement": "DROITE"}}],
        "lignes": [
            {"id": "brut", "titre": "Salaire brut", "valeurs": {"v": "total_brut"}},
            {"id": "cot", "titre": "Cotisations salariales", "valeurs": {"v": "0 - total_cot_salariale"}},
            {"id": "autres", "titre": "Autres retenues (impôt, avances…)",
             "valeurs": {"v": "0 - (total_retenues - total_cot_salariale)"}},
            {"id": "net", "titre": "Net à payer", "valeurs": {"v": "net_a_payer"},
             "style": {"gras": True, "couleur": BLEU, "bordures": "H", "couleur_bordure": BLEU}},
        ],
    }
    corps = [
        riche("appel", 0, 0, L, 6, "{SI(identite.civilite = \"M.\", \"Monsieur\", SI(ESTVIDE(identite.civilite), \"Madame, Monsieur\", \"Madame\"))},",
              taille=10),
        riche("intro", 0, 9, L, 18,
              "Nous avons le plaisir de vous informer que votre rémunération nette pour le mois de "
              "{FORMAT(@periode.date_fin, \"MOIS_ANNEE\")} s'élève à {FORMAT(net_a_payer, \"MONTANT\")} dirhams "
              "({MONTANT_EN_LETTRES(net_a_payer)}). Elle vous sera versée "
              "{SI(ESTVIDE(paiement.mode_libelle), \"selon le mode habituel\", \"par \" + MINUSCULE(paiement.mode_libelle))}"
              "{SI(ESTVIDE(paiement.banque_libelle), \"\", \" sur votre compte ouvert auprès de \" + paiement.banque_libelle)}.",
              taille=10),
    ]
    detail = [texte("detail_t", 20, -4, 140, 5, "Détail de votre rémunération", taille=9, gras=True, couleur=BLEU),
              cadre("detail_cadre", 18, 0, 144, 30, couleur=GRIS_CLAIR, arrondi=2), grille]
    detail[0]["y"] = 0
    detail[1]["y"] = 5
    grille["y"] = 6
    fin = [
        riche("cumul", 0, 2, L, 12,
              "Depuis le début de l'année, votre rémunération nette cumulée s'élève à "
              "{FORMAT(cumul.net_a_payer, \"MONTANT\")} dirhams pour un salaire brut cumulé de "
              "{FORMAT(cumul.total_brut, \"MONTANT\")} dirhams. Votre bulletin de paie détaillé est disponible auprès du "
              "service du personnel.", taille=10),
        riche("politesse", 0, 16, L, 12,
              "Nous vous prions d'agréer, {SI(identite.civilite = \"M.\", \"Monsieur\", SI(ESTVIDE(identite.civilite), \"Madame, Monsieur\", \"Madame\"))}, "
              "l'expression de nos salutations distinguées.", taille=10),
        texte("signature_t", 100, 34, 80, 5, "La Direction des ressources humaines", taille=10, gras=True, alignement="CENTRE"),
        champ("signature_nom", 100, 58, 80, 5, 'SIVIDE(societe.nom_gerant, "")', taille=9, alignement="CENTRE"),
    ]
    # repères de pliage en 3 (A4 → DL) : 99 mm et 198 mm du haut de la feuille, marge haute 15 mm
    reperes = [ligne("pli_1", 0, 99 - 15, 4, couleur=GRIS, epaisseur=0.3), ligne("pli_2", 0, 198 - 15, 4, couleur=GRIS, epaisseur=0.3)]
    for r in reperes:
        r["x"] = 0
    return definition(
        [PARAM_MOIS, PARAM_COLLABS],
        [{"code": "b", "source": "BULLETIN", "role": "PRINCIPAL", "filtres": [],
          "tri": [{"champ": "identite.nom"}, {"champ": "identite.prenom"}]}],
        [bande("reperes", "FOND", 0, reperes),
         bande("en_tete", "CORPS", 88, en_tete),
         bande("corps", "CORPS", 30, corps, extensible=True),
         bande("detail", "CORPS", 40, detail, insecable=True),
         bande("fin", "CORPS", 66, fin, extensible=True, insecable=True),
         bande("pied", "PIED_PAGE", 12, mentions_legales(L))],
        {"format": "A4", "orientation": "PORTRAIT", "marges": [15, 15, 12, 18]},
        {"formats": ["PDF"], "nom_fichier": '"Notification_remuneration_" + identite.matricule + "_" + @periode.code',
         "eclatement": "collaborateur_id"},
        usages={"confidentialite": 3})


# =============================================================================
# 5. DECLARATION — État des cotisations CNSS / AMO / TFP
# =============================================================================
def cotisations() -> dict:
    L = 277.0
    variables = [
        {"code": "plafond", "libelle": "Plafond CNSS (prestations sociales)", "type": "MONTANT",
         "valeur": "SIVIDE(#CNSS_PLAFOND, 6000)"},
        {"code": "tx_ps_sal", "libelle": "Taux CNSS salarial (%)", "type": "NOMBRE", "valeur": "4.48"},
        {"code": "tx_ps_pat", "libelle": "Taux CNSS patronal (%)", "type": "NOMBRE", "valeur": "8.98"},
        {"code": "tx_af", "libelle": "Allocations familiales, patronal (%)", "type": "NOMBRE", "valeur": "6.40"},
        {"code": "tx_amo_sal", "libelle": "AMO salariale (%)", "type": "NOMBRE", "valeur": "2.26"},
        {"code": "tx_amo_pat", "libelle": "AMO patronale, participation comprise (%)", "type": "NOMBRE", "valeur": "4.11"},
        {"code": "tx_tfp", "libelle": "Taxe de formation professionnelle (%)", "type": "NOMBRE", "valeur": "1.60"},
        {"code": "base_ps", "libelle": "Base plafonnée", "type": "MONTANT", "valeur": "MIN(total_brut, var.plafond)"},
        {"code": "ps_sal", "libelle": "CNSS salariale", "type": "MONTANT", "valeur": "ARRONDI(var.base_ps * var.tx_ps_sal / 100, 2)"},
        {"code": "ps_pat", "libelle": "CNSS patronale", "type": "MONTANT", "valeur": "ARRONDI(var.base_ps * var.tx_ps_pat / 100, 2)"},
        {"code": "af", "libelle": "Allocations familiales", "type": "MONTANT", "valeur": "ARRONDI(total_brut * var.tx_af / 100, 2)"},
        {"code": "amo_sal", "libelle": "AMO salariale", "type": "MONTANT", "valeur": "ARRONDI(total_brut * var.tx_amo_sal / 100, 2)"},
        {"code": "amo_pat", "libelle": "AMO patronale", "type": "MONTANT", "valeur": "ARRONDI(total_brut * var.tx_amo_pat / 100, 2)"},
        {"code": "tfp", "libelle": "TFP", "type": "MONTANT", "valeur": "ARRONDI(total_brut * var.tx_tfp / 100, 2)"},
        {"code": "total", "libelle": "Total des cotisations", "type": "MONTANT",
         "valeur": "var.ps_sal + var.ps_pat + var.af + var.amo_sal + var.amo_pat + var.tfp"},
    ]
    cols = [
        ("cnss", "N° CNSS", 22, 'SIVIDE(identite.num_cnss, "—")', None, "GAUCHE"),
        ("nom", "Nom et prénom", 45, 'MAJUSCULE(identite.nom) + " " + identite.prenom', None, "GAUCHE"),
        ("brut", "Salaire brut", 22, "total_brut", "MONTANT", "DROITE"),
        ("base", "Base plafonnée", 22, "var.base_ps", "MONTANT", "DROITE"),
        ("ps_sal", "CNSS sal.", 20, "var.ps_sal", "MONTANT", "DROITE"),
        ("ps_pat", "CNSS pat.", 20, "var.ps_pat", "MONTANT", "DROITE"),
        ("af", "Alloc. fam.", 20, "var.af", "MONTANT", "DROITE"),
        ("amo_sal", "AMO sal.", 20, "var.amo_sal", "MONTANT", "DROITE"),
        ("amo_pat", "AMO pat.", 20, "var.amo_pat", "MONTANT", "DROITE"),
        ("tfp", "TFP", 19, "var.tfp", "MONTANT", "DROITE"),
        ("total", "Total", 27, "var.total", "MONTANT", "DROITE"),
    ]
    en_tete = entete_societe(L, "État des cotisations sociales",
                             f'"CNSS · AMO · TFP — " + {MOIS} + "   ·   affiliation " + SIVIDE(societe.numero_cnss, "—")')
    en_tete += [fond("c_fond", 0, 21, L, 8, BLEU)] + tableau_colonnes(
        "c", cols, 21, 8, "TITRE", lambda c, t, e: t, lambda a: dict(taille=7, gras=True, couleur=BLANC, alignement=a))
    corps = tableau_colonnes("v", cols, 0, 5, "VALEUR", lambda c, t, e: e, lambda a: dict(taille=7.5, alignement=a))
    corps.append(ligne("v_sep", 0, 4.8, L, couleur=GRIS_CLAIR, epaisseur=0.2, trait="POINTILLES"))
    total = [fond("t_fond", 0, 1, L, 7, BLEU),
             champ("t_lib", 1, 1, 66, 7, '"TOTAL — " + NB(matricule, ETAT) + " salariés déclarés"', taille=7.5, gras=True,
                   couleur=BLANC)]
    x = 0.0
    for code, _t, l, expr, masque, _a in cols:
        if masque == "MONTANT":
            total.append(champ(f"t_{code}", x + 0.8, 1, l - 1.6, 7, f"TOTAL({expr}, ETAT)", masque="MONTANT", taille=7.5,
                               gras=True, couleur=BLANC, alignement="DROITE"))
        x += l
    # récapitulatif à verser, par organisme
    recap_x, y0 = 0, 16
    recap = [texte("r_titre", recap_x, y0 - 5, 150, 5, "Récapitulatif à verser", taille=9, gras=True, couleur=BLEU),
             cadre("r_cadre", recap_x, y0, 150, 34, couleur=GRIS_CLAIR, arrondi=1.5)]
    lignes_recap = [
        ("CNSS — prestations sociales (part salariale + patronale)", "TOTAL(var.ps_sal, ETAT) + TOTAL(var.ps_pat, ETAT)"),
        ("CNSS — allocations familiales", "TOTAL(var.af, ETAT)"),
        ("AMO (part salariale + patronale)", "TOTAL(var.amo_sal, ETAT) + TOTAL(var.amo_pat, ETAT)"),
        ("Taxe de formation professionnelle", "TOTAL(var.tfp, ETAT)"),
    ]
    for i, (lib, expr) in enumerate(lignes_recap):
        recap += [texte(f"r_l{i}", recap_x + 2, y0 + 1 + i * 6, 105, 5.5, lib, taille=8),
                  champ(f"r_v{i}", recap_x + 105, y0 + 1 + i * 6, 43, 5.5, expr, masque="MONTANT", taille=8, alignement="DROITE")]
    recap += [ligne("r_filet", recap_x + 2, y0 + 26, 146, couleur=BLEU, epaisseur=0.6),
              texte("r_tl", recap_x + 2, y0 + 27.5, 100, 6, "Total à verser", taille=9, gras=True, couleur=BLEU),
              champ("r_tv", recap_x + 105, y0 + 27.5, 43, 6, "TOTAL(var.total, ETAT)", masque="MONTANT", taille=9, gras=True,
                    couleur=BLEU, alignement="DROITE"),
              cadre("n_cadre", 160, y0, 117, 34, couleur=GRIS_CLAIR, arrondi=1.5),
              texte("n_titre", 162, y0 + 1, 113, 5, "Taux appliqués", taille=8, gras=True, couleur=BLEU),
              champ("n_t1", 162, y0 + 7, 113, 5,
                    '"CNSS : " + FORMAT(var.tx_ps_sal, "MONTANT") + " % sal. · " + FORMAT(var.tx_ps_pat, "MONTANT") + " % pat. sur " + FORMAT(var.plafond, "MONTANT") + " DH max."',
                    taille=7.5),
              champ("n_t2", 162, y0 + 12, 113, 5, '"Allocations familiales : " + FORMAT(var.tx_af, "MONTANT") + " % pat. (non plafonné)"', taille=7.5),
              champ("n_t3", 162, y0 + 17, 113, 5, '"AMO : " + FORMAT(var.tx_amo_sal, "MONTANT") + " % sal. · " + FORMAT(var.tx_amo_pat, "MONTANT") + " % pat."', taille=7.5),
              champ("n_t4", 162, y0 + 22, 113, 5, '"TFP : " + FORMAT(var.tx_tfp, "MONTANT") + " % pat."', taille=7.5),
              texte("n_t5", 162, y0 + 27.5, 113, 5, "Taux modifiables dans le designer : Données › Variables.", taille=6.5,
                    italique=True, couleur=GRIS)]
    return definition(
        [PARAM_MOIS, PARAM_PLAN, PARAM_COLLABS],
        [{"code": "b", "source": "BULLETIN", "role": "PRINCIPAL", "filtres": [],
          "tri": [{"champ": "identite.nom"}, {"champ": "identite.prenom"}]}],
        [bande("en_tete", "EN_TETE_PAGE", 31, en_tete),
         bande("detail", "CORPS", 5, corps),
         bande("total", "PIED_ETAT", 54, total + recap, insecable=True),
         bande("pied", "PIED_PAGE", 8, pied_page(L, "État de contrôle — à rapprocher des bordereaux officiels"))],
        {"format": "A4", "orientation": "PAYSAGE", "marges": [10, 10, 10, 10]},
        {"formats": ["PDF"], "nom_fichier": '"Cotisations_CNSS_AMO_" + @periode.code'},
        variables=variables, usages={"confidentialite": 3})


# =============================================================================
# 6. AUTRE — Fiche de synthèse annuelle du salarié
# =============================================================================
def fiche_synthese() -> dict:
    L = 180.0
    identite = [
        texte("titre", 0, 2, L, 9, "Fiche de synthèse annuelle", taille=15, gras=True, couleur=BLEU, alignement="CENTRE",
              casse="PETITES_MAJUSCULES"),
        champ("st", 0, 11, L, 5, '"Situation arrêtée à fin " + FORMAT(@periode.date_fin, "MOIS_ANNEE") + " — "'
                                ' + cumul.nb_bulletins + " bulletin(s) dans l\'année"', taille=8.5, couleur=GRIS,
              alignement="CENTRE"),
        cadre("id_cadre", 0, 19, L, 38, couleur=BLEU, arrondi=2, epaisseur=0.6),
        fond("id_bandeau", 0.3, 19.3, L - 0.6, 7, BLEU_CLAIR),
        champ("id_nom", 3, 19.5, 120, 7, 'MAJUSCULE(identite.nom) + " " + identite.prenom', taille=11, gras=True, couleur=BLEU),
        champ("id_mat", 120, 19.5, 57, 7, '"Matricule " + identite.matricule', taille=9, gras=True, alignement="DROITE",
              couleur=BLEU),
    ]
    infos = [("Emploi", 'SIVIDE(affectation.emploi_libelle, "—")'),
             ("Organisation", 'SIVIDE(affectation.organisation_libelle, "—")'),
             ("Date d'embauche", 'SI(ESTVIDE(contrat.date_embauche), "—", FORMAT(contrat.date_embauche, "DATE_FR"))'),
             ("Contrat", 'SIVIDE(contrat.type_contrat_libelle, SIVIDE(contrat.code_type_contrat, "—"))'),
             ("Situation familiale", 'SIVIDE(situation_familiale.libelle, "—") + " · " + SIVIDE(situation_familiale.nb_enfants_a_charge, 0) + " enfant(s)"'),
             ("Catégorie", 'SIVIDE(qualification.categorie_professionnelle_libelle, SIVIDE(qualification.classification_libelle, "—"))'),
             ("N° CNSS", 'SIVIDE(identite.num_cnss, "—")'),
             ("Ancienneté", 'SI(ESTVIDE(contrat.date_embauche), "—", ANNEES(@periode.date_fin, contrat.date_embauche) + " an(s)")')]
    for i, (lib, expr) in enumerate(infos):
        col, rang = i % 2, i // 2
        x = 3 + col * 90
        y = 29 + rang * 7
        identite += [texte(f"i_l{i}", x, y, 26, 6, lib, taille=7.5, couleur=GRIS),
                     champ(f"i_v{i}", x + 26, y, 61, 6, expr, taille=8, gras=True)]
    grille = {
        "id": "synthese", "type": "GRILLE", "x": 0, "y": 7, "l": L, "h": 72, "largeur_titres": 62, "hauteur_ligne": 6.5,
        "quadrillage": "COMPLET", "style": {"taille": 8.5, "couleur_bordure": GRIS_CLAIR},
        "style_entete": {"gras": True, "couleur": BLANC, "fond": BLEU, "alignement": "CENTRE"},
        "style_titres": {"couleur": BLEU},
        "colonnes": [
            {"id": "mois", "titre": "Mois", "largeur": 29, "affichage": {"masque": "MONTANT"}, "style": {"alignement": "DROITE"}},
            {"id": "cumul", "titre": "Cumul de l'année", "largeur": 31, "affichage": {"masque": "MONTANT"},
             "style": {"alignement": "DROITE", "gras": True}},
            {"id": "moyenne", "titre": "Moyenne mensuelle", "largeur": 30, "affichage": {"masque": "MONTANT"},
             "style": {"alignement": "DROITE"}},
            {"id": "part", "titre": "% du brut", "largeur": 28, "affichage": {"masque": "POURCENTAGE"},
             "style": {"alignement": "DROITE"}},
        ],
        "lignes": [],
    }
    for code, titre, champ_mois in [("brut", "Salaire brut", "total_brut"), ("imp", "Brut imposable", "total_brut_imposable"),
                                    ("gains", "Total des gains", "total_gains"),
                                    ("cot_sal", "Cotisations salariales", "total_cot_salariale"),
                                    ("ret", "Total des retenues", "total_retenues"), ("net_imp", "Net imposable", "net_imposable"),
                                    ("net", "Net à payer", "net_a_payer"), ("cot_pat", "Cotisations patronales", "total_cot_patronale"),
                                    ("cout", "Coût employeur", "cout_employeur")]:
        grille["lignes"].append({
            "id": code, "titre": titre,
            "valeurs": {"mois": champ_mois, "cumul": f"cumul.{champ_mois}",
                        "moyenne": f"SI(SIVIDE(cumul.nb_bulletins, 0) = 0, 0, cumul.{champ_mois} / cumul.nb_bulletins)",
                        "part": f"SI(SIVIDE(cumul.total_brut, 0) = 0, 0, cumul.{champ_mois} / cumul.total_brut * 100)"},
            "style": {"gras": True} if code in ("net", "cout") else {}})
    tableau = [texte("s_titre", 0, 1, L, 6, "Rémunération et charges (en dirhams)", taille=9.5, gras=True, couleur=BLEU), grille]
    y0 = 4
    indicateurs = [texte("k_titre", 0, 0, L, 5, "Indicateurs", taille=9.5, gras=True, couleur=BLEU)]
    cartes = [("Taux de prélèvement salarial", "SI(SIVIDE(cumul.total_brut, 0) = 0, 0, (cumul.total_brut - cumul.net_a_payer) / cumul.total_brut * 100)", "POURCENTAGE"),
              ("Coût employeur / net versé", "SI(SIVIDE(cumul.net_a_payer, 0) = 0, 0, cumul.cout_employeur / cumul.net_a_payer)", "MONTANT"),
              ("Net annuel projeté (12 mois)", "SI(SIVIDE(cumul.nb_bulletins, 0) = 0, 0, cumul.net_a_payer / cumul.nb_bulletins * 12)", "MONTANT")]
    for i, (lib, expr, masque) in enumerate(cartes):
        x = i * 61
        indicateurs += [cadre(f"k{i}_c", x, y0 + 2, 58, 20, couleur=BLEU, arrondi=2),
                        texte(f"k{i}_l", x + 2, y0 + 3, 54, 5, lib, taille=7.5, couleur=GRIS, alignement="CENTRE"),
                        champ(f"k{i}_v", x + 2, y0 + 10, 54, 9, expr, masque=masque, taille=14, gras=True, couleur=BLEU,
                              alignement="CENTRE")]
    indicateurs.append(texte("k_note", 0, y0 + 25, L, 5,
                             "Moyennes et projection calculées sur les bulletins de l'année jusqu'à la période choisie.",
                             taille=6.5, italique=True, couleur=GRIS))
    return definition(
        [PARAM_MOIS, PARAM_COLLABS],
        [{"code": "b", "source": "BULLETIN", "role": "PRINCIPAL", "filtres": [],
          "tri": [{"champ": "identite.nom"}, {"champ": "identite.prenom"}]}],
        [bande("en_tete", "EN_TETE_PAGE", 24, entete_societe(L, "Ressources humaines", f'"Exercice " + @periode.annee')),
         bande("identite", "CORPS", 60, identite),
         bande("synthese", "CORPS", 84, tableau, insecable=True, extensible=True),
         bande("indicateurs", "CORPS", 36, indicateurs, insecable=True),
         bande("pied", "PIED_PAGE", 8, pied_page(L, "Document confidentiel"))],
        {"format": "A4", "orientation": "PORTRAIT", "marges": [15, 15, 12, 15]},
        {"formats": ["PDF"], "nom_fichier": '"Synthese_annuelle_" + identite.matricule + "_" + @periode.annee',
         "eclatement": "collaborateur_id"},
        usages={"confidentialite": 3})


# =============================================================================
# 7 à 9. BULLETINS — trois présentations complètes
# =============================================================================
JEU_BULLETIN = {"code": "b", "source": "BULLETIN", "role": "PRINCIPAL", "filtres": [],
                "tri": [{"champ": "identite.nom"}, {"champ": "identite.prenom"}]}
JEU_LIGNES = {"code": "l", "source": "BULLETIN_LIGNE", "role": "SECONDAIRE", "parent": "b", "relation": "lignes",
              "filtres": ['sens = "GAIN" OU sens = "RETENUE"', "COALESCE(montant, 0) <> 0 OU COALESCE(montant_patronal, 0) <> 0"],
              "tri": [{"champ": "ordre_affichage"}]}
SECTIONS = [{"id": "sec_gains", "titre": "Éléments de rémunération", "filtre": 'sens = "GAIN"', "sous_total": True},
            {"id": "sec_retenues", "titre": "Cotisations et retenues", "filtre": 'sens = "RETENUE"', "sous_total": True}]
SORTIE_BULLETIN = {"formats": ["PDF"], "nom_fichier": '"Bulletin_" + identite.matricule + "_" + @periode.code',
                   "eclatement": "collaborateur_id", "qr_verification": True}
ANCIENNETE = 'SI(ESTVIDE(contrat.date_embauche), "—", ANNEES(@periode.date_fin, contrat.date_embauche) + " an(s)")'
RIB_MASQUE = 'SI(ESTVIDE(paiement.numero_compte), "—", "•••• •••• " + DROITE(paiement.numero_compte, 6))'
DU_AU = '"Du " + FORMAT(@periode.date_debut, "DATE_FR") + " au " + FORMAT(@periode.date_fin, "DATE_FR")'
MENTION = "Pour vous aider à faire valoir vos droits, conservez ce bulletin de paie sans limitation de durée."


def qr_bulletin(id, x, y, cote=18):
    """RG-EDT-QR-01 (Adil DAIA) : QR de contrôle du bulletin — ICE, matricule, période, net à payer."""
    return {"id": id, "type": "CODE_BARRE", "x": x, "y": y, "l": cote, "h": cote, "symbologie": "QR",
            "valeur": '"BUL|" + SIVIDE(societe.ice, "") + "|" + identite.matricule + "|" + @periode.code + "|" + FORMAT(net_a_payer, "MONTANT")'}


def col(id, titre, largeur, valeur, masque=None, total=False, **s):
    c = {"id": id, "titre": titre, "largeur": largeur, "valeur": valeur, "style": st(**s)}
    if masque:
        c["affichage"] = {"masque": masque}
    if total:
        c["total"] = "SOMME"
    return c


def tableau(id, x, y, l, colonnes, **opts):
    return {"id": id, "type": "TABLEAU", "x": x, "y": y, "l": l, "h": 20, "jeu": "l", "colonnes": colonnes,
            "sections": SECTIONS, **opts}


def paires(prefixe, x, y, largeur_lib, largeur_val, lignes, pas=4.6, taille=7.5, **s_val):
    """Libellés gris / valeurs en gras, une par ligne."""
    el = []
    for i, (lib, expr) in enumerate(lignes):
        el += [texte(f"{prefixe}_l{i}", x, y + i * pas, largeur_lib, pas, lib, taille=taille - 0.5, couleur=GRIS),
               champ(f"{prefixe}_v{i}", x + largeur_lib, y + i * pas, largeur_val, pas, expr, taille=taille, gras=True, **s_val)]
    return el


def bulletin_detaille() -> dict:
    """Parts salariale et patronale, deux blocs employeur / salarié, totaux en cases, cumuls annuels."""
    L = 190.0
    en_tete = entete_societe(L, "Bulletin de paie", f'"Période : " + {MOIS}') + [
        champ("du_au", L - 110, 13, 110, 4, DU_AU, taille=7.5, couleur=GRIS, alignement="DROITE"),
        # bloc employeur
        cadre("emp_c", 0, 21, 76, 35, couleur=GRIS_CLAIR, arrondi=1.5),
        fond("emp_b", 0.3, 21.3, 75.4, 5.5, BLEU_CLAIR),
        texte("emp_t", 2, 21.3, 72, 5.5, "Employeur", taille=8, gras=True, couleur=BLEU, casse="MAJUSCULES"),
        *paires("emp", 2, 27.5, 22, 50, [
            ("Raison sociale", "societe.raison_sociale"),
            ("Adresse", 'SIVIDE(societe.adresse, "") + SI(ESTVIDE(societe.ville), "", ", " + societe.ville)'),
            ("ICE", 'SIVIDE(societe.ice, "—")'), ("N° CNSS", 'SIVIDE(societe.numero_cnss, "—")'),
            ("IF / RC", 'SIVIDE(societe.identifiant_fiscal, "—") + " / " + SIVIDE(societe.registre_commerce, "—")'),
            ("N° CIMR", 'SIVIDE(societe.numero_cimr, "—")')], pas=4.5, taille=7.5),
        # bloc salarié
        cadre("sal_c", 79, 21, 111, 35, couleur=BLEU, arrondi=1.5, epaisseur=0.6),
        fond("sal_b", 79.3, 21.3, 110.4, 5.5, BLEU),
        champ("sal_t", 81, 21.3, 75, 5.5, 'SIVIDE(identite.civilite, "") + " " + MAJUSCULE(identite.nom) + " " + identite.prenom',
              taille=8.5, gras=True, couleur=BLANC),
        champ("sal_mat", 150, 21.3, 38, 5.5, '"Mat. " + identite.matricule', taille=8, gras=True, couleur=BLANC, alignement="DROITE"),
        *paires("sa", 81, 27.5, 21, 34, [
            ("Emploi", 'SIVIDE(affectation.emploi_libelle, "—")'),
            ("Catégorie", 'SIVIDE(qualification.categorie_professionnelle_libelle, SIVIDE(qualification.classification_libelle, "—"))'),
            ("Entrée le", 'SI(ESTVIDE(contrat.date_embauche), "—", FORMAT(contrat.date_embauche, "DATE_FR"))'),
            ("Ancienneté", ANCIENNETE),
            ("Contrat", 'SIVIDE(contrat.type_contrat_libelle, SIVIDE(contrat.code_type_contrat, "—"))'),
            ("Organisation", 'SIVIDE(affectation.organisation_libelle, "—")')], pas=4.5, taille=7.5),
        *paires("sb", 137, 27.5, 21, 31, [
            ("CIN", 'SIVIDE(identite.cin, "—")'), ("N° CNSS", 'SIVIDE(identite.num_cnss, "—")'),
            ("N° AMO", 'SIVIDE(identite.num_amo, "—")'),
            ("Sit. familiale", 'SIVIDE(situation_familiale.libelle, "—")'),
            ("Enfants", 'SIVIDE(situation_familiale.nb_enfants_a_charge, 0) + " à charge"'),
            ("Déductions", 'SIVIDE(situation_familiale.nb_deductions_fiscales, 0) + " personne(s)"')], pas=4.5, taille=7.5),
    ]
    colonnes = [
        col("lib", "Désignation", 49, "libelle"),
        col("code", "Code", 16, "code_rubrique", taille=6, couleur=GRIS),
        col("base", "Base", 22, "base", "MONTANT_SANS_ZERO", alignement="DROITE"),
        col("nb", "Nombre", 13, "nombre", "QUANTITE", alignement="DROITE"),
        col("tx", "Taux sal.", 13, "taux", "QUANTITE", alignement="DROITE"),
        col("gain", "Gains", 21, 'SI(sens = "GAIN", montant)', "MONTANT_SANS_ZERO", True, alignement="DROITE"),
        col("ret", "Retenues", 21, 'SI(sens = "RETENUE", montant)', "MONTANT_SANS_ZERO", True, alignement="DROITE"),
        col("txp", "Taux pat.", 14, "taux_patronal", "QUANTITE", alignement="DROITE", couleur=GRIS),
        col("pat", "Part patronale", 21, "montant_patronal", "MONTANT_SANS_ZERO", True, alignement="DROITE", couleur=GRIS),
    ]
    cases = [("Salaire brut", "total_brut"), ("Brut imposable", "total_brut_imposable"),
             ("Cot. salariales", "total_cot_salariale"), ("Net imposable", "net_imposable"),
             ("Cot. patronales", "total_cot_patronale"), ("Coût employeur", "cout_employeur")]
    corps = [tableau("lignes", 0, 0, L, colonnes, zebre=True, quadrillage="COLONNES", hauteur_ligne=4.8,
                     style_entete={"fond": BLEU, "couleur": BLANC, "gras": True, "taille": 7, "alignement": "CENTRE"},
                     style={"taille": 7.5})]
    largeur_case = L / 6
    for i, (lib, expr) in enumerate(cases):
        x = i * largeur_case
        corps += [cadre(f"t{i}_c", x + 0.5, 24, largeur_case - 1, 12, couleur=GRIS_CLAIR, arrondi=1),
                  texte(f"t{i}_l", x + 1, 24.5, largeur_case - 2, 4.5, lib, taille=6.5, couleur=GRIS, alignement="CENTRE"),
                  champ(f"t{i}_v", x + 1, 29.5, largeur_case - 2, 5.5, expr, masque="MONTANT", taille=9, gras=True,
                        alignement="CENTRE")]
    corps += [
        fond("net_f", 95, 39, 95, 13, BLEU),
        texte("net_l", 98, 39.5, 40, 12, "Net à payer", taille=11, gras=True, couleur=BLANC, casse="MAJUSCULES"),
        champ("net_v", 135, 39.5, 52, 12, "net_a_payer", masque="MONTANT", taille=16, gras=True, couleur=BLANC, alignement="DROITE"),
        champ("net_lettres", 95, 53, 95, 5, "MONTANT_EN_LETTRES(net_a_payer)", taille=7, italique=True, couleur=GRIS,
              alignement="DROITE"),
        *paires("pay", 0, 40, 26, 64, [
            ("Mode de paiement", 'SIVIDE(paiement.mode_libelle, "—")'),
            ("Banque", 'SIVIDE(paiement.banque_libelle, "—") + SI(ESTVIDE(paiement.nom_agence), "", " — " + paiement.nom_agence)'),
            ("Compte", RIB_MASQUE)], pas=4.6, taille=8),
    ]
    cumuls = {
        "id": "cumuls", "type": "GRILLE", "x": 0, "y": 6, "l": L, "h": 18, "largeur_titres": 30, "hauteur_ligne": 5.5,
        "quadrillage": "COMPLET", "style": {"taille": 7.5, "couleur_bordure": GRIS_CLAIR, "alignement": "DROITE"},
        "style_entete": {"fond": BLEU_CLAIR, "couleur": BLEU, "gras": True, "taille": 7, "alignement": "CENTRE"},
        "style_titres": {"gras": True, "couleur": BLEU, "alignement": "GAUCHE"},
        "colonnes": [{"id": c, "titre": t, "largeur": 26.5, "affichage": {"masque": "MONTANT"}} for c, t in
                     [("brut", "Brut"), ("imp", "Brut imposable"), ("cot", "Cot. salariales"), ("netimp", "Net imposable"),
                      ("net", "Net payé"), ("pat", "Cot. patronales")]],
        "lignes": [
            {"id": "mois", "titre": "Mois", "valeurs": {"brut": "total_brut", "imp": "total_brut_imposable", "cot": "total_cot_salariale",
                                                     "netimp": "net_imposable", "net": "net_a_payer", "pat": "total_cot_patronale"}},
            {"id": "annee", "titre": "Cumul année", "style": {"gras": True},
             "valeurs": {"brut": "cumul.total_brut", "imp": "cumul.total_brut_imposable", "cot": "cumul.total_cot_salariale",
                         "netimp": "cumul.net_imposable", "net": "cumul.net_a_payer", "pat": "cumul.total_cot_patronale"}},
        ],
    }
    bas = [texte("cumuls_t", 0, 0, 120, 5, "Cumuls de l'année civile", taille=8.5, gras=True, couleur=BLEU), cumuls]
    pied = [
        ligne("p_filet", 0, 0.5, L, couleur=BLEU, epaisseur=0.6),
        texte("p_mention", 0, 2, 150, 4, MENTION, taille=6.5, italique=True, couleur=GRIS),
        qr_bulletin("p_qr", L - 18, 1.5, 17),
        texte("p_qr_t", 120, 11, 50, 4, "Code de contrôle du bulletin", taille=6, italique=True, couleur=GRIS, alignement="DROITE"),
        champ("p_cnss", 0, 6, 150, 4, '"Cotisations versées à la CNSS sous le n° d\'affiliation " + SIVIDE(societe.numero_cnss, "—")'
                                      ' + " — en cas de litige, adressez-vous à l\'inspection du travail."', taille=6.5, couleur=GRIS),
        champ("p_page", 120, 15, 50, 4, '"Page " + PAGE() + " / " + NB_PAGES()', taille=6.5, couleur=GRIS, alignement="DROITE"),
    ]
    return definition(
        [PARAM_PERIODE, PARAM_PLAN, PARAM_COLLABS], [JEU_BULLETIN, JEU_LIGNES],
        [bande("en_tete", "EN_TETE_PAGE", 58, en_tete),
         bande("detail", "CORPS", 60, corps),
         bande("cumuls", "CORPS", 26, bas, insecable=True),
         bande("pied", "PIED_PAGE", 20, pied)],
        {"format": "A4", "orientation": "PORTRAIT", "marges": [10, 10, 10, 10]}, SORTIE_BULLETIN,
        usages={"confidentialite": 4})


def bulletin_moderne() -> dict:
    """Bandeau latéral (salarié, paiement), indicateurs en cartes, montants signés, coût employeur expliqué."""
    # marges gauche, haute et basse nulles : le bandeau va jusqu'au bord de la feuille
    L, G = 198.0, 62.0            # largeur utile, largeur du bandeau latéral
    X, LM = G + 7, 198.0 - G - 7  # zone principale
    lateral = [
        fond("lat_fond", 0, 0, G, 297, BLEU),
        {"id": "lat_logo", "type": "IMAGE", "x": 10, "y": 10, "l": 42, "h": 18, "valeur": 'CHARTE("logo")'},
        champ("lat_soc", 6, 12 + 20, G - 12, 6, "societe.raison_sociale", taille=9.5, gras=True, couleur=BLANC),
        champ("lat_adr", 6, 12 + 26, G - 12, 4, 'SIVIDE(societe.ville, "")', taille=7, couleur=GRIS_CLAIR),
        champ("lat_ice", 6, 12 + 30, G - 12, 4, '"ICE " + SIVIDE(societe.ice, "—")', taille=6.5, couleur=GRIS_CLAIR),
        champ("lat_cnss", 6, 12 + 34, G - 12, 4, '"CNSS " + SIVIDE(societe.numero_cnss, "—")', taille=6.5, couleur=GRIS_CLAIR),
        ligne("lat_f1", 6, 12 + 41, G - 14, couleur="#3D6680", epaisseur=0.5),
        texte("lat_t1", 6, 12 + 44, G - 12, 5, "Salarié", taille=7, gras=True, couleur="#7FB7D4", casse="MAJUSCULES"),
        champ("lat_nom", 6, 12 + 49, G - 12, 6, "MAJUSCULE(identite.nom)", taille=11, gras=True, couleur=BLANC),
        champ("lat_prenom", 6, 12 + 55, G - 12, 6, "identite.prenom", taille=10, couleur=BLANC),
    ]
    infos = [("Matricule", "identite.matricule"), ("Emploi", 'SIVIDE(affectation.emploi_libelle, "—")'),
             ("Entrée le", 'SI(ESTVIDE(contrat.date_embauche), "—", FORMAT(contrat.date_embauche, "DATE_FR"))'),
             ("Ancienneté", ANCIENNETE), ("N° CNSS", 'SIVIDE(identite.num_cnss, "—")'), ("CIN", 'SIVIDE(identite.cin, "—")'),
             ("Situation", 'SIVIDE(situation_familiale.libelle, "—") + " · " + SIVIDE(situation_familiale.nb_enfants_a_charge, 0) + " enf."')]
    for i, (lib, expr) in enumerate(infos):
        y = 64 + i * 9
        lateral += [texte(f"lat_il{i}", 6, 12 + y, G - 12, 4, lib, taille=6.5, couleur="#7FB7D4"),
                    champ(f"lat_iv{i}", 6, 12 + y + 4, G - 12, 4.5, expr, taille=8, couleur=BLANC)]
    y = 64 + len(infos) * 9 + 3
    lateral += [ligne("lat_f2", 6, 12 + y, G - 14, couleur="#3D6680", epaisseur=0.5),
                texte("lat_t2", 6, 12 + y + 3, G - 12, 5, "Paiement", taille=7, gras=True, couleur="#7FB7D4", casse="MAJUSCULES"),
                champ("lat_mode", 6, 12 + y + 8, G - 12, 4.5, 'SIVIDE(paiement.mode_libelle, "—")', taille=8, couleur=BLANC),
                champ("lat_banque", 6, 12 + y + 12.5, G - 12, 4.5, 'SIVIDE(paiement.banque_libelle, "")', taille=8, couleur=BLANC),
                champ("lat_rib", 6, 12 + y + 17, G - 12, 4.5, RIB_MASQUE, taille=7.5, couleur=GRIS_CLAIR),
                champ("lat_ref", 6, 12 + 262, G - 12, 4, '"Réf. " + identite.matricule + "-" + @periode.code', taille=6.5, couleur="#7FB7D4"),
                {"id": "lat_qr", "type": "CODE_BARRE", "x": 6, "y": 250, "l": 22, "h": 22, "symbologie": "QR",
                 "valeur": '"BUL|" + SIVIDE(societe.ice, "") + "|" + identite.matricule + "|" + @periode.code + "|" + FORMAT(net_a_payer, "MONTANT")',
                 "style": {"fond": BLANC}}]
    tete = [
        texte("titre", X, 12, LM, 9, "Bulletin de paie", taille=18, gras=True, couleur=BLEU),
        champ("mois", X, 21, LM, 6, f"MAJUSCULE({MOIS})", taille=10, couleur=GRIS),
        champ("du_au", X, 27, LM, 5, DU_AU, taille=7.5, couleur=GRIS),
    ]
    cartes = [("Salaire brut", "total_brut", BLEU_CLAIR, BLEU), ("Retenues", "total_retenues", BLEU_CLAIR, BLEU),
              ("Net à payer", "net_a_payer", BLEU, BLANC)]
    lc = (LM - 6) / 3
    for i, (lib, expr, f, c) in enumerate(cartes):
        x = X + i * (lc + 3)
        tete += [fond(f"k{i}_f", x, 35, lc, 18, f),
                 texte(f"k{i}_l", x + 3, 36.5, lc - 6, 5, lib, taille=7.5, couleur=c if c == BLANC else GRIS, casse="MAJUSCULES"),
                 champ(f"k{i}_v", x + 3, 42, lc - 6, 9, expr, masque="MONTANT", taille=14, gras=True, couleur=c)]
    colonnes = [
        col("lib", "Rubrique", 52, "libelle"),
        col("base", "Base", 21, "base", "MONTANT_SANS_ZERO", alignement="DROITE", couleur=GRIS),
        col("tx", "Taux / Nb", 15, 'SIVIDE(taux, nombre)', "QUANTITE", alignement="DROITE", couleur=GRIS),
        col("mt", "Montant", 31, 'SI(sens = "RETENUE", 0 - montant, montant)', "MONTANT_SANS_ZERO", True, alignement="DROITE", gras=True),
    ]
    corps = tete + [tableau("lignes", X, 58, LM, colonnes, zebre=True, quadrillage="AUCUN", hauteur_ligne=5.2, ligne_total=False,
                            style_entete={"couleur": GRIS, "gras": True, "taille": 7, "bordures": "B", "couleur_bordure": BLEU},
                            style={"taille": 8})]
    net = [fond("net_f", X, 3, LM, 14, BLEU),
           texte("net_l", X + 4, 3, 50, 14, "Net à payer", taille=12, gras=True, couleur=BLANC, casse="MAJUSCULES"),
           champ("net_v", X + 50, 3, LM - 54, 14, "net_a_payer", masque="MONTANT", taille=18, gras=True, couleur=BLANC,
                 alignement="DROITE"),
           champ("net_lt", X, 18, LM, 5, "MONTANT_EN_LETTRES(net_a_payer)", taille=7, italique=True, couleur=GRIS, alignement="DROITE")]
    cout = [texte("cout_t", X, 2, LM, 5, "Ce que votre emploi représente pour l'entreprise", taille=8.5, gras=True, couleur=BLEU),
            cadre("cout_c", X, 8, LM, 30, couleur=GRIS_CLAIR, arrondi=2)]
    lignes_cout = [("Votre net à payer", "net_a_payer"), ("+ Vos cotisations et retenues", "total_retenues"),
                   ("+ Cotisations patronales", "total_cot_patronale")]
    for i, (lib, expr) in enumerate(lignes_cout):
        cout += [texte(f"cout_l{i}", X + 3, 9 + i * 5.5, 70, 5.5, lib, taille=8, couleur=GRIS),
                 champ(f"cout_v{i}", X + LM - 45, 9 + i * 5.5, 30, 5.5, expr, masque="MONTANT", taille=8, alignement="DROITE"),
                 champ(f"cout_p{i}", X + LM - 15, 9 + i * 5.5, 13, 5.5,
                       f"SI(SIVIDE(cout_employeur, 0) = 0, 0, {expr} / cout_employeur * 100)", masque="POURCENTAGE", taille=7,
                       couleur=GRIS, alignement="DROITE")]
    cout += [ligne("cout_f", X + 3, 26, LM - 6, couleur=BLEU, epaisseur=0.5),
             texte("cout_tl", X + 3, 27.5, 70, 6, "= Coût total employeur", taille=8.5, gras=True, couleur=BLEU),
             champ("cout_tv", X + LM - 45, 27.5, 30, 6, "cout_employeur", masque="MONTANT", taille=9, gras=True, couleur=BLEU,
                   alignement="DROITE"),
             champ("cumul_l", X, 40, LM, 5,
                   '"Depuis janvier : brut " + FORMAT(cumul.total_brut, "MONTANT") + " · net imposable " + FORMAT(cumul.net_imposable, "MONTANT")'
                   ' + " · net payé " + FORMAT(cumul.net_a_payer, "MONTANT")', taille=7.5, couleur=GRIS)]
    pied = [champ("p_page", X, 2, LM, 4, '"Page " + PAGE() + " / " + NB_PAGES()', taille=6.5, couleur=GRIS, alignement="DROITE"),
            texte("p_mention", X, 6, LM, 4, MENTION, taille=6.5, italique=True, couleur=GRIS)]
    # colonnes du tableau ajustées à la zone principale
    total = sum(c["largeur"] for c in colonnes)
    for c in colonnes:
        c["largeur"] = round(c["largeur"] * LM / total, 1)
    return definition(
        [PARAM_PERIODE, PARAM_PLAN, PARAM_COLLABS], [JEU_BULLETIN, JEU_LIGNES],
        [bande("lateral", "FOND", 0, lateral),
         bande("detail", "CORPS", 72, corps),
         bande("net", "CORPS", 24, net, insecable=True),
         bande("cout", "CORPS", 46, cout, insecable=True),
         bande("pied", "PIED_PAGE", 16, pied)],
        {"format": "A4", "orientation": "PORTRAIT", "marges": [0, 12, 0, 0]}, SORTIE_BULLETIN,
        usages={"confidentialite": 4})


def bulletin_formulaire() -> dict:
    """Paysage, grille formulaire pleine page à gauche, colonne de synthèse à droite (net, cumuls, émargement)."""
    L, T = 277.0, 192.0          # largeur utile, largeur du tableau
    XD, LD = T + 5, 277.0 - T - 5
    en_tete = entete_societe(L, "Bulletin de paie", f'"Période : " + {MOIS} + "   ·   " + {DU_AU}')
    colonne_droite = [
        # identité
        cadre("id_c", XD, 21, LD, 44, couleur=BLEU, arrondi=1.5, epaisseur=0.6),
        fond("id_b", XD + 0.3, 21.3, LD - 0.6, 6, BLEU),
        champ("id_nom", XD + 2, 21.3, LD - 4, 6, 'MAJUSCULE(identite.nom) + " " + identite.prenom', taille=8.5, gras=True, couleur=BLANC),
        *paires("id", XD + 2, 28, 24, LD - 28, [
            ("Matricule", "identite.matricule"), ("Emploi", 'SIVIDE(affectation.emploi_libelle, "—")'),
            ("Entrée le", 'SI(ESTVIDE(contrat.date_embauche), "—", FORMAT(contrat.date_embauche, "DATE_FR"))'),
            ("Ancienneté", ANCIENNETE), ("N° CNSS", 'SIVIDE(identite.num_cnss, "—")'), ("CIN", 'SIVIDE(identite.cin, "—")'),
            ("Famille", 'SIVIDE(situation_familiale.libelle, "—") + " · " + SIVIDE(situation_familiale.nb_enfants_a_charge, 0) + " enf."'),
            ]), 
        # net
        fond("net_f", XD, 68, LD, 16, BLEU),
        texte("net_l", XD + 2, 68.5, LD - 4, 5, "Net à payer", taille=8, couleur=BLANC, casse="MAJUSCULES"),
        champ("net_v", XD + 2, 73.5, LD - 4, 9, "net_a_payer", masque="MONTANT", taille=15, gras=True, couleur=BLANC,
              alignement="DROITE"),
        champ("net_lt", XD, 85, LD, 9, "MONTANT_EN_LETTRES(net_a_payer)", taille=6.5, italique=True, couleur=GRIS),
        # mois et cumuls
        {"id": "synthese", "type": "GRILLE", "x": XD, "y": 96, "l": LD, "h": 45, "largeur_titres": 30, "hauteur_ligne": 5,
         "quadrillage": "COMPLET", "style": {"taille": 7, "couleur_bordure": GRIS_CLAIR, "alignement": "DROITE"},
         "style_entete": {"fond": BLEU_CLAIR, "couleur": BLEU, "gras": True, "alignement": "CENTRE"},
         "style_titres": {"couleur": BLEU, "alignement": "GAUCHE"},
         "colonnes": [{"id": "m", "titre": "Mois", "largeur": (LD - 30) / 2, "affichage": {"masque": "MONTANT"}},
                      {"id": "c", "titre": "Cumul", "largeur": (LD - 30) / 2, "affichage": {"masque": "MONTANT"}, "style": {"gras": True}}],
         "lignes": [{"id": i, "titre": t, "valeurs": {"m": f, "c": f"cumul.{f}"}} for i, t, f in [
             ("brut", "Brut", "total_brut"), ("imp", "Brut imposable", "total_brut_imposable"),
             ("cot", "Cot. salariales", "total_cot_salariale"), ("netimp", "Net imposable", "net_imposable"),
             ("ret", "Retenues", "total_retenues"), ("net", "Net payé", "net_a_payer"),
             ("pat", "Cot. patronales", "total_cot_patronale"), ("cout", "Coût employeur", "cout_employeur")]]},
        # paiement et émargement
        qr_bulletin("qr", XD + LD - 18, 144, 18),
        *paires("pay", XD, 145, 20, LD - 40, [("Paiement", 'SIVIDE(paiement.mode_libelle, "—")'),
                                             ("Banque", 'SIVIDE(paiement.banque_libelle, "—")'), ("Compte", RIB_MASQUE)], pas=4.5, taille=7),
        cadre("sig_c", XD, 164, LD, 22, couleur=GRIS_CLAIR, arrondi=1.5),
        texte("sig_t", XD + 2, 165, LD - 4, 4, "Reçu, lu et approuvé — signature du salarié", taille=6.5, italique=True, couleur=GRIS),
    ]
    colonnes = [
        col("lib", "Désignation", 58, "libelle"),
        col("code", "Code", 14, "code_rubrique", taille=6.5, couleur=GRIS),
        col("nb", "Nombre", 14, "nombre", "QUANTITE", alignement="DROITE"),
        col("base", "Base", 22, "base", "MONTANT_SANS_ZERO", alignement="DROITE"),
        col("tx", "Taux", 13, "taux", "QUANTITE", alignement="DROITE"),
        col("gain", "À payer", 22, 'SI(sens = "GAIN", montant)', "MONTANT_SANS_ZERO", True, alignement="DROITE"),
        col("ret", "À retenir", 22, 'SI(sens = "RETENUE", montant)', "MONTANT_SANS_ZERO", True, alignement="DROITE"),
        col("txp", "Tx pat.", 11, "taux_patronal", "QUANTITE", alignement="DROITE", couleur=GRIS),
        col("pat", "Part pat.", 16, "montant_patronal", "MONTANT_SANS_ZERO", True, alignement="DROITE", couleur=GRIS),
    ]
    corps = [tableau("lignes", 0, 0, T, colonnes, quadrillage="COMPLET", lignes_min=18, hauteur_ligne=5,
                     style_entete={"fond": BLEU, "couleur": BLANC, "gras": True, "taille": 7, "alignement": "CENTRE"},
                     style={"taille": 7.5, "couleur_bordure": GRIS_CLAIR})]
    pied = mentions_legales(L) + [champ("p_page", L - 40, 2, 40, 4, '"Page " + PAGE() + " / " + NB_PAGES()', taille=6.5,
                                        couleur=GRIS, alignement="DROITE")]
    pied[1]["l"] = L - 45
    pied[2]["l"] = L - 45
    return definition(
        [PARAM_PERIODE, PARAM_PLAN, PARAM_COLLABS], [JEU_BULLETIN, JEU_LIGNES],
        [bande("droite", "FOND", 0, colonne_droite),
         bande("en_tete", "EN_TETE_PAGE", 21, en_tete),
         bande("detail", "CORPS", 30, corps),
         bande("mention", "PIED_ETAT", 8, [texte("mention", 0, 2, T, 5, MENTION, taille=7, italique=True, couleur=GRIS)]),
         bande("pied", "PIED_PAGE", 12, pied)],
        {"format": "A4", "orientation": "PAYSAGE", "marges": [10, 10, 8, 10]}, SORTIE_BULLETIN,
        usages={"confidentialite": 4})


# =============================================================================
# 10 à 14. ÉTATS DE PAIE ET DE CONTRÔLE
# =============================================================================
ORANGE, ORANGE_CLAIR, ROUGE, VERT = "#B45309", "#FEF3C7", "#B91C1C", "#15803D"


def entete_colonnes(prefixe, cols, y, L, h=8):
    return [fond(f"{prefixe}_fond", 0, y, L, h, BLEU)] + tableau_colonnes(
        prefixe, cols, y, h, "TITRE", lambda c, t, e: t, lambda a: dict(taille=7, gras=True, couleur=BLANC, alignement=a))


def ligne_valeurs(prefixe, cols, h=5, taille=7.5, **s):
    el = tableau_colonnes(prefixe, cols, 0, h, "VALEUR", lambda c, t, e: e, lambda a: dict(taille=taille, alignement=a, **s))
    el.append(ligne(f"{prefixe}_sep", 0, h - 0.2, sum(c[2] for c in cols), couleur=GRIS_CLAIR, epaisseur=0.2, trait="POINTILLES"))
    return el


def totaux_colonnes(prefixe, cols, portee, y, h, couleur, fond_, libelle, x_lib=1, l_lib=100):
    L = sum(c[2] for c in cols)
    el = [fond(f"{prefixe}_fond", 0, y, L, h, fond_),
          champ(f"{prefixe}_lib", x_lib, y, l_lib, h, libelle, taille=7.5, gras=True, couleur=couleur)]
    x = 0.0
    for code, _t, l, expr, masque, _a in cols:
        if masque in ("MONTANT", "MONTANT_SANS_ZERO"):
            el.append(champ(f"{prefixe}_{code}", x + 0.8, y, l - 1.6, h, f"TOTAL({expr}, {portee})", masque="MONTANT",
                            taille=7.5, gras=True, couleur=couleur, alignement="DROITE"))
        x += l
    return el


def etat_ecarts() -> dict:
    """Écarts M / M-1 par salarié : brut, cotisations, net ; mise en évidence au-delà d'un seuil."""
    L = 277.0
    cols = [
        ("mat", "Matricule", 18, "identite.matricule", None, "GAUCHE"),
        ("nom", "Nom et prénom", 48, 'MAJUSCULE(identite.nom) + " " + identite.prenom', None, "GAUCHE"),
        ("brut_p", "Brut réf.", 22, "precedent.total_brut", "MONTANT_SANS_ZERO", "DROITE"),
        ("brut", "Brut", 22, "total_brut", "MONTANT_SANS_ZERO", "DROITE"),
        ("ec_brut", "Écart brut", 21, "ecart_brut", "MONTANT_SANS_ZERO", "DROITE"),
        ("cot_p", "Retenues réf.", 21, "precedent.total_retenues", "MONTANT_SANS_ZERO", "DROITE"),
        ("cot", "Retenues", 21, "total_retenues", "MONTANT_SANS_ZERO", "DROITE"),
        ("net_p", "Net réf.", 22, "precedent.net_a_payer", "MONTANT_SANS_ZERO", "DROITE"),
        ("net", "Net", 22, "net_a_payer", "MONTANT_SANS_ZERO", "DROITE"),
        ("ec_net", "Écart net", 21, "ecart_net", "MONTANT_SANS_ZERO", "DROITE"),
        ("pct", "Var. net", 15, 'SI(OU(precedent.existe = 0, sortant = 1), "", pct_net)', "POURCENTAGE", "DROITE"),
        ("obs", "Observation", 24, 'SI(sortant = 1, "Sortie", SI(precedent.existe = 0, "Entrée / 1re paie", SI(ABS(pct_net) >= @seuil, "À vérifier", "")))', None, "GAUCHE"),
    ]
    en_tete = entete_societe(L, "Écarts M / M-1",
                             f'{MOIS} + " comparé à " + {COMPAREE} + "   ·   seuil d\'alerte " + FORMAT(@seuil, "MONTANT") + " %"')
    en_tete += entete_colonnes("c", cols, 21, L)
    corps = [{**fond("alerte", 0, 0, L, 5, ORANGE_CLAIR),
              "condition": {"expression": "OU(precedent.existe = 0, sortant = 1, ABS(pct_net) >= @seuil)"}}]
    corps += ligne_valeurs("v", cols)
    for e in corps:
        if e["id"] in ("v_obs", "v_pct", "v_ec_net"):
            e["style"]["gras"] = True
    corps[[e["id"] for e in corps].index("v_obs")]["style"]["couleur"] = ORANGE
    total = totaux_colonnes("t", cols, "ETAT", 1, 7, BLANC, BLEU, '"TOTAL — " + NB(id, ETAT) + " salariés"', l_lib=64)
    synthese = [
        texte("s_titre", 0, 11, 150, 5, "Synthèse", taille=9, gras=True, couleur=BLEU),
        cadre("s_cadre", 0, 16, 150, 35, couleur=GRIS_CLAIR, arrondi=1.5),
        *paires("s", 2, 17, 95, 50, [
            ("Salariés payés ce mois", 'FORMAT(NB(SI(sortant = 0, 1, ""), ETAT), "ENTIER")'),
            ("dont entrées ou première paie (sans bulletin de référence)", 'FORMAT(NB(SI(precedent.existe = 0, 1, ""), ETAT), "ENTIER")'),
            ("Sorties (bulletin de référence seulement)", 'FORMAT(NB(SI(sortant = 1, 1, ""), ETAT), "ENTIER")'),
            ("Bulletins au-delà du seuil d'alerte", 'FORMAT(NB(SI(ET(precedent.existe = 1, ABS(pct_net) >= @seuil), 1, ""), ETAT), "ENTIER")'),
            ("Variation de la masse brute", 'FORMAT(TOTAL(total_brut, ETAT) - TOTAL(precedent.total_brut, ETAT), "MONTANT")'),
            ("Variation du net à payer", 'FORMAT(TOTAL(net_a_payer, ETAT) - TOTAL(precedent.net_a_payer, ETAT), "MONTANT")'),
            ("Variation du net (en %)", 'SI(TOTAL(precedent.net_a_payer, ETAT) = 0, "—", FORMAT((TOTAL(net_a_payer, ETAT) - TOTAL(precedent.net_a_payer, ETAT)) / TOTAL(precedent.net_a_payer, ETAT) * 100, "POURCENTAGE"))'),
        ], pas=4.8, taille=8),
        cadre("leg_c", 160, 16, 117, 35, couleur=GRIS_CLAIR, arrondi=1.5),
        fond("leg_f", 162, 18, 6, 4, ORANGE_CLAIR),
        texte("leg_t", 170, 17.5, 105, 5, "Ligne surlignée : écart du net au-delà du seuil, entrée ou sortie", taille=7.5),
        texte("leg_t2", 162, 24, 113, 18,
              "Les sorties du mois (bulletin M-1 sans bulletin M) n'apparaissent pas dans cet état : "
              "lancez-le sur le mois précédent pour les repérer. Le seuil se règle au lancement.", taille=7, italique=True,
              couleur=GRIS, extensible=None),
    ]
    synthese[-1] = {**riche("leg_t2", 162, 24, 113, 18,
                            "Référence : le mois précédent, ou la période de comparaison choisie au lancement. Les sorties "
                            "(bulletin de référence sans bulletin ce mois) sont listées avec un net à zéro ; décochez « Inclure "
                            "les sorties » pour les masquer. Le seuil d'alerte se règle au lancement.", taille=7,
                            italique=True, couleur=GRIS), "extensible": False}
    return definition(
        [PARAM_PERIODE, PARAM_COMPARAISON, PARAM_PLAN, PARAM_COLLABS, PARAM_SORTANTS,
         {"code": "seuil", "libelle": "Seuil d'alerte (variation du net, en %)", "type": "NOMBRE", "obligatoire": False, "defaut": "10"},
         {"code": "affichage", "libelle": "Salariés affichés", "type": "LISTE", "obligatoire": False,
          "valeurs": ["Tous", "Écarts et entrées seulement"], "defaut": '"Tous"'}],
        [{"code": "b", "source": "BULLETIN", "role": "PRINCIPAL",
          "calculs": [{"code": "ecart_brut", "expression": "total_brut - SIVIDE(precedent.total_brut, 0)"},
                      {"code": "ecart_net", "expression": "net_a_payer - SIVIDE(precedent.net_a_payer, 0)"},
                      {"code": "pct_net", "expression": "SI(SIVIDE(precedent.net_a_payer, 0) = 0, 0, (net_a_payer - precedent.net_a_payer) / precedent.net_a_payer * 100)"}],
          "filtres": ["periode_id = @periode.id",
                      'OU(@affichage <> "Écarts et entrées seulement", precedent.existe = 0, sortant = 1, ABS(pct_net) >= @seuil)'],
          "tri": [{"champ": "identite.nom"}, {"champ": "identite.prenom"}]}],
        [bande("en_tete", "EN_TETE_PAGE", 31, en_tete),
         bande("detail", "CORPS", 5, corps),
         bande("total", "PIED_ETAT", 53, total + synthese, insecable=True),
         bande("pied", "PIED_PAGE", 8, pied_page(L, "Contrôle de paie — document interne"))],
        {"format": "A4", "orientation": "PAYSAGE", "marges": [10, 10, 10, 10]},
        {"formats": ["PDF"], "nom_fichier": '"Ecarts_M_M-1_" + @periode.code'},
        usages={"confidentialite": 3})


ANOMALIES = [  # (code, libellé court, condition)
    ("net", "Net à payer nul ou négatif", "net_a_payer <= 0"),
    ("net_brut", "Net supérieur au brut", "net_a_payer > total_brut"),
    ("smig", "Brut inférieur au SMIG", "ET(@smig > 0, total_brut < @smig)"),
    ("cnss", "Aucune cotisation salariale", "ET(total_brut > 0, SIVIDE(total_cot_salariale, 0) = 0)"),
    ("ir", "IR retenu alors que net imposable sous le seuil d'exonération",
     "ET(SIVIDE([RET_IR].MT, 0) > 0, SIVIDE(net_imposable, 0) < @seuil_ir)"),
    ("rib", "Virement sans RIB", 'ET(CONTIENT(SIVIDE(paiement.mode_libelle, ""), "irement"), ESTVIDE(paiement.numero_compte))'),
    ("num_cnss", "N° CNSS manquant", "ESTVIDE(identite.num_cnss)"),
    ("cin", "CIN manquante", "ESTVIDE(identite.cin)"),
    ("embauche", "Date d'embauche manquante", "ESTVIDE(contrat.date_embauche)"),
    ("uo", "Sans unité organisationnelle", "ESTVIDE(affectation.organisation_id)"),
]


def controle_anomalies() -> dict:
    """Bulletins présentant au moins une anomalie, avec la liste des anomalies et leur décompte."""
    L = 277.0
    condition = "OU(" + ", ".join(c for _k, _l, c in ANOMALIES) + ")"
    liste = " + ".join(f'SI({c}, "• {l}   ", "")' for _k, l, c in ANOMALIES)
    cols = [
        ("mat", "Matricule", 18, "identite.matricule", None, "GAUCHE"),
        ("nom", "Nom et prénom", 50, 'MAJUSCULE(identite.nom) + " " + identite.prenom', None, "GAUCHE"),
        ("emploi", "Emploi", 36, 'SIVIDE(affectation.emploi_libelle, "")', None, "GAUCHE"),
        ("brut", "Brut", 21, "total_brut", "MONTANT", "DROITE"),
        ("net", "Net à payer", 21, "net_a_payer", "MONTANT", "DROITE"),
        ("anomalies", "Anomalies détectées", 131, liste, None, "GAUCHE"),
    ]
    en_tete = entete_societe(L, "Contrôle des bulletins", f'"Anomalies — " + {MOIS}') + entete_colonnes("c", cols, 21, L)
    corps = ligne_valeurs("v", cols, h=5.5)
    for e in corps:
        if e["id"] == "v_anomalies":
            e["extensible"] = True
            e["style"].update(couleur=ROUGE, taille=7)
    recap = [texte("r_titre", 0, 3, 200, 6, "Décompte des anomalies", taille=9, gras=True, couleur=BLEU),
             cadre("r_cadre", 0, 9, 150, 5 + 4.6 * len(ANOMALIES), couleur=GRIS_CLAIR, arrondi=1.5)]
    for i, (k, lib, cond) in enumerate(ANOMALIES):
        recap += [texte(f"r_l{k}", 2, 10 + i * 4.6, 120, 4.6, lib, taille=7.5),
                  champ(f"r_v{k}", 122, 10 + i * 4.6, 26, 4.6, f'NB(SI({cond}, 1, ""), ETAT)', masque="ENTIER", taille=7.5,
                        gras=True, alignement="DROITE")]
    recap += [
        champ("r_total", 160, 9, 117, 8, '"Bulletins à revoir : " + NB(id, ETAT)', taille=10, gras=True, couleur=ROUGE),
        {**champ("r_aucune", 160, 18, 117, 8, '"Aucune anomalie détectée sur la période."', taille=10, gras=True, couleur=VERT),
         "condition": {"expression": "NB(id, ETAT) = 0"}},
        {**riche("r_note", 160, 28, 117, 20,
                 "SMIG et seuil d'exonération de l'IR se règlent au lancement (0 = contrôle désactivé). "
                 "Le contrôle de l'IR lit la rubrique RET_IR. La situation contrôlée est celle du salarié au calcul du bulletin.",
                 taille=7, italique=True, couleur=GRIS), "extensible": False},
    ]
    return definition(
        [PARAM_PERIODE, PARAM_PLAN, PARAM_COLLABS,
         {"code": "smig", "libelle": "SMIG mensuel brut (0 : non contrôlé)", "type": "NOMBRE", "obligatoire": False,
          "defaut": "SIVIDE(#SMIG_MENSUEL, 0)"},
         {"code": "seuil_ir", "libelle": "Seuil mensuel d'exonération de l'IR (net imposable)", "type": "NOMBRE",
          "obligatoire": False, "defaut": "3333.33"}],
        [{"code": "b", "source": "BULLETIN", "role": "PRINCIPAL", "filtres": ["periode_id = @periode.id", condition],
          "tri": [{"champ": "identite.nom"}, {"champ": "identite.prenom"}]}],
        [bande("en_tete", "EN_TETE_PAGE", 31, en_tete),
         bande("detail", "CORPS", 5.5, corps, extensible=True),
         bande("recap", "PIED_ETAT", 15 + 4.6 * len(ANOMALIES), recap, insecable=True),
         bande("pied", "PIED_PAGE", 8, pied_page(L, "Contrôle de paie — document interne"))],
        {"format": "A4", "orientation": "PAYSAGE", "marges": [10, 10, 10, 10]},
        {"formats": ["PDF"], "nom_fichier": '"Controle_bulletins_" + @periode.code'},
        usages={"confidentialite": 3})


def controle_ir() -> dict:
    """Du brut imposable à l'IR retenu, salarié par salarié, avec taux moyen et cumuls."""
    L = 277.0
    cols = [
        ("mat", "Matricule", 17, "identite.matricule", None, "GAUCHE"),
        ("nom", "Nom et prénom", 46, 'MAJUSCULE(identite.nom) + " " + identite.prenom', None, "GAUCHE"),
        ("sf", "Sit. / déd.", 18, 'GAUCHE(SIVIDE(situation_familiale.libelle, "-"), 1) + " / " + SIVIDE(situation_familiale.nb_deductions_fiscales, 0)', None, "CENTRE"),
        ("brut_imp", "Brut imposable", 23, "total_brut_imposable", "MONTANT", "DROITE"),
        ("fp", "Frais prof.", 21, "SIVIDE([FRAIS_PROF].MT, 0)", "MONTANT_SANS_ZERO", "DROITE"),
        ("cot", "Cot. déductibles", 22, "SIVIDE(total_cot_salariale, 0)", "MONTANT_SANS_ZERO", "DROITE"),
        ("net_imp", "Net imposable", 23, "net_imposable", "MONTANT", "DROITE"),
        ("ir", "IR retenu", 20, "SIVIDE([RET_IR].MT, 0)", "MONTANT_SANS_ZERO", "DROITE"),
        ("tx", "Taux moy.", 16, "SI(SIVIDE(net_imposable, 0) = 0, 0, SIVIDE([RET_IR].MT, 0) / net_imposable * 100)", "POURCENTAGE", "DROITE"),
        ("cum_imp", "Net imp. cumulé", 24, "cumul.net_imposable", "MONTANT", "DROITE"),
        ("cum_ir", "IR cumulé", 21, "SIVIDE([RET_IR].CMT, 0)", "MONTANT_SANS_ZERO", "DROITE"),
        ("obs", "Contrôle", 26, 'SI(ET(SIVIDE([RET_IR].MT, 0) > 0, SIVIDE(net_imposable, 0) < @seuil_ir), "IR sous le seuil", SI(SIVIDE(net_imposable, 0) > total_brut_imposable, "Net imp. > brut imp.", ""))', None, "GAUCHE"),
    ]
    en_tete = entete_societe(L, "Contrôle de l'impôt sur le revenu", f'"IR retenu à la source — " + {MOIS}') + entete_colonnes("c", cols, 21, L)
    corps = ligne_valeurs("v", cols)
    corps[[e["id"] for e in corps].index("v_obs")]["style"].update(couleur=ROUGE, gras=True)
    total = totaux_colonnes("t", cols, "ETAT", 1, 7, BLANC, BLEU, '"TOTAL — " + NB(id, ETAT) + " salariés"', l_lib=80)
    synthese = [
        texte("s_titre", 0, 11, 150, 5, "Synthèse", taille=9, gras=True, couleur=BLEU),
        cadre("s_cadre", 0, 16, 150, 22, couleur=GRIS_CLAIR, arrondi=1.5),
        *paires("s", 2, 17, 95, 50, [
            ("IR à reverser pour la période", 'FORMAT(TOTAL(SIVIDE([RET_IR].MT, 0), ETAT), "MONTANT")'),
            ("Salariés imposés (IR > 0)", 'FORMAT(NB(SI(SIVIDE([RET_IR].MT, 0) > 0, 1, ""), ETAT), "ENTIER")'),
            ("Taux moyen d'imposition", 'SI(TOTAL(net_imposable, ETAT) = 0, "—", FORMAT(TOTAL(SIVIDE([RET_IR].MT, 0), ETAT) / TOTAL(net_imposable, ETAT) * 100, "POURCENTAGE"))'),
            ("Salariés à vérifier", 'FORMAT(NB(SI(ET(SIVIDE([RET_IR].MT, 0) > 0, SIVIDE(net_imposable, 0) < @seuil_ir), 1, ""), ETAT), "ENTIER")'),
        ], pas=4.8, taille=8),
        {**riche("s_note", 160, 16, 117, 22,
                 "Rubriques lues : FRAIS_PROF (frais professionnels) et RET_IR (IR retenu, mois et cumul). "
                 "« Sit. / déd. » : situation familiale et nombre de personnes à charge déductibles. "
                 "Le seuil mensuel d'exonération se règle au lancement.", taille=7, italique=True, couleur=GRIS), "extensible": False},
    ]
    return definition(
        [PARAM_PERIODE, PARAM_PLAN, PARAM_COLLABS,
         {"code": "seuil_ir", "libelle": "Seuil mensuel d'exonération de l'IR (net imposable)", "type": "NOMBRE",
          "obligatoire": False, "defaut": "3333.33"}],
        [{"code": "b", "source": "BULLETIN", "role": "PRINCIPAL", "filtres": ["periode_id = @periode.id"],
          "tri": [{"champ": "identite.nom"}, {"champ": "identite.prenom"}]}],
        [bande("en_tete", "EN_TETE_PAGE", 31, en_tete),
         bande("detail", "CORPS", 5, corps),
         bande("total", "PIED_ETAT", 40, total + synthese, insecable=True),
         bande("pied", "PIED_PAGE", 8, pied_page(L, "Contrôle de paie — à rapprocher de l'état 9421"))],
        {"format": "A4", "orientation": "PAYSAGE", "marges": [10, 10, 10, 10]},
        {"formats": ["PDF"], "nom_fichier": '"Controle_IR_" + @periode.code'},
        usages={"confidentialite": 4})


def masse_salariale() -> dict:
    """Récapitulatif sans détail nominatif : direction › catégorie professionnelle, effectifs et coûts."""
    L = 277.0
    cols = [
        ("lib", "Direction / catégorie", 75, "", None, "GAUCHE"),
        ("eff", "Effectif", 17, "id", "ENTIER", "DROITE"),
        ("brut", "Masse brute", 26, "total_brut", "MONTANT", "DROITE"),
        ("cot_sal", "Cot. salariales", 24, "total_cot_salariale", "MONTANT", "DROITE"),
        ("net", "Net à payer", 26, "net_a_payer", "MONTANT", "DROITE"),
        ("cot_pat", "Cot. patronales", 24, "total_cot_patronale", "MONTANT", "DROITE"),
        ("cout", "Coût employeur", 27, "cout_employeur", "MONTANT", "DROITE"),
        ("moy", "Coût moyen", 24, "", "MONTANT", "DROITE"),
        ("part", "% masse", 17, "", "POURCENTAGE", "DROITE"),
        ("charge", "Tx charges", 17, "", "POURCENTAGE", "DROITE"),
    ]

    def rangee(prefixe, portee, libelle, couleur, fond_, gras, y=0.5, h=6, retrait=1):
        el = [fond(f"{prefixe}_fond", 0, y, L, h, fond_)] if fond_ else []
        el.append(champ(f"{prefixe}_lib", retrait, y, 75 - retrait, h, libelle, taille=8, gras=gras, couleur=couleur))
        x = 75.0
        for code, _t, l, expr, masque, _a in cols[1:]:
            if code == "eff":
                v = f"NB(id, {portee})"
            elif code == "moy":
                v = f"SI(NB(id, {portee}) = 0, 0, TOTAL(cout_employeur, {portee}) / NB(id, {portee}))"
            elif code == "part":
                v = f"SI(TOTAL(total_brut, ETAT) = 0, 0, TOTAL(total_brut, {portee}) / TOTAL(total_brut, ETAT) * 100)"
            elif code == "charge":
                v = f"SI(TOTAL(total_brut, {portee}) = 0, 0, TOTAL(total_cot_patronale, {portee}) / TOTAL(total_brut, {portee}) * 100)"
            else:
                v = f"TOTAL({expr}, {portee})"
            el.append(champ(f"{prefixe}_{code}", x + 0.8, y, l - 1.6, h, v, masque=masque, taille=8, gras=gras,
                            couleur=couleur, alignement="DROITE"))
            x += l
        return el

    en_tete = entete_societe(L, "Masse salariale", f'"Récapitulatif par direction et catégorie — " + {MOIS}') + entete_colonnes("c", cols, 21, L)
    g1_tete = [fond("g1_fond", 0, 1, L, 6.5, BLEU_CLAIR),
               champ("g1_titre", 1.5, 1, 200, 6.5, 'SIVIDE(affectation.uo_niveau1_libelle, "Sans unité organisationnelle")',
                     taille=8.5, gras=True, couleur=BLEU)]
    g2_pied = rangee("g2", "GROUPE", 'SIVIDE(qualification.categorie_professionnelle_libelle, "Catégorie non renseignée")',
                     None, None, False, retrait=6) + [ligne("g2_sep", 0, 6.6, L, couleur=GRIS_CLAIR, epaisseur=0.2, trait="POINTILLES")]
    g1_pied = rangee("g1", "GROUPE", '"Total " + SIVIDE(affectation.uo_niveau1_libelle, "sans UO")', BLEU, None, True)
    g1_pied.append(ligne("g1_filet", 0, 0.4, L, couleur=BLEU, epaisseur=0.5))
    total = rangee("t", "ETAT", '"TOTAL SOCIÉTÉ"', BLANC, BLEU, True, y=2, h=8)
    total.append(riche("t_note", 0, 13, L, 10,
                       "Effectif : nombre de bulletins de la période. Coût moyen : coût employeur par bulletin. "
                       "% masse : part de la masse brute de la société. Taux de charges : cotisations patronales / masse brute.",
                       taille=7, italique=True, couleur=GRIS))
    return definition(
        [PARAM_MOIS, PARAM_PLAN, PARAM_COLLABS],
        [{"code": "b", "source": "BULLETIN", "role": "PRINCIPAL", "filtres": [],
          "groupes": ["affectation.uo_niveau1_libelle", "qualification.categorie_professionnelle_libelle"],
          "tri": [{"champ": "affectation.uo_niveau1_libelle"}, {"champ": "qualification.categorie_professionnelle_libelle"}]}],
        [bande("en_tete", "EN_TETE_PAGE", 31, en_tete),
         bande("g1_tete", "EN_TETE_GROUPE", 8, g1_tete, niveau_groupe=1),
         bande("detail", "CORPS", 0, []),
         bande("g2_pied", "PIED_GROUPE", 7, g2_pied, niveau_groupe=2),
         bande("g1_pied", "PIED_GROUPE", 9, g1_pied, niveau_groupe=1),
         bande("total", "PIED_ETAT", 24, total, insecable=True),
         bande("pied", "PIED_PAGE", 8, pied_page(L, "Document de synthèse — sans données nominatives"))],
        {"format": "A4", "orientation": "PAYSAGE", "marges": [10, 10, 10, 10]},
        {"formats": ["PDF"], "nom_fichier": '"Masse_salariale_" + @periode.code'},
        usages={"confidentialite": 2})


NIVEAUX_UO = ["UO d'affectation (chemin complet)", "Direction (1er niveau)", "2e niveau"]


def masse_par_collaborateur() -> dict:
    """RG-EDT-MASSE-01 (Adil DAIA) : masse salariale nominative, regroupée UO › catégorie › collaborateur.
    Population au choix au lancement (UO avec ou sans les UO rattachées, catégories… : RG-EDT-FILTRE-01) ;
    niveau de regroupement des UO au choix. Une ligne par bulletin du mois (plusieurs périodes : plusieurs lignes)."""
    L = 277.0
    cols = [
        ("mat", "Matricule", 18, "identite.matricule", None, "GAUCHE"),
        ("nom", "Nom et prénom", 58, 'MAJUSCULE(identite.nom) + " " + identite.prenom', None, "GAUCHE"),
        ("emp", "Emploi / fonction", 51,
         'SIVIDE(affectation.emploi_libelle, SIVIDE(qualification.fonction_libelle, SIVIDE(qualification.emploi_libelle, "")))', None, "GAUCHE"),
        ("brut", "Masse brute", 26, "total_brut", "MONTANT_SANS_ZERO", "DROITE"),
        ("cot_sal", "Cot. salariales", 24, "total_cot_salariale", "MONTANT_SANS_ZERO", "DROITE"),
        ("net", "Net à payer", 26, "net_a_payer", "MONTANT_SANS_ZERO", "DROITE"),
        ("cot_pat", "Cot. patronales", 24, "total_cot_patronale", "MONTANT_SANS_ZERO", "DROITE"),
        ("cout", "Coût employeur", 31, "SIVIDE(cout_employeur, 0)", "MONTANT_SANS_ZERO", "DROITE"),
        ("part", "% masse", 19, "SI(TOTAL(total_brut, ETAT) = 0, 0, total_brut / TOTAL(total_brut, ETAT) * 100)",
         "POURCENTAGE", "DROITE"),
    ]
    x_montants = sum(c[2] for c in cols[:3])

    def rangee(prefixe, portee, libelle, couleur, fond_, gras, y=0.5, h=6, retrait=1):
        el = [fond(f"{prefixe}_fond", 0, y, L, h, fond_)] if fond_ else []
        el.append(champ(f"{prefixe}_lib", retrait, y, x_montants - retrait, h, libelle, taille=8, gras=gras, couleur=couleur))
        x = x_montants
        for code, _t, l, expr, _m, _a in cols[3:]:
            if code == "part":
                v = f"SI(TOTAL(total_brut, ETAT) = 0, 0, TOTAL(total_brut, {portee}) / TOTAL(total_brut, ETAT) * 100)"
                masque = "POURCENTAGE"
            else:
                v, masque = f"TOTAL({expr}, {portee})", "MONTANT"
            el.append(champ(f"{prefixe}_{code}", x + 0.8, y, l - 1.6, h, v, masque=masque, taille=8, gras=gras,
                            couleur=couleur, alignement="DROITE"))
            x += l
        return el

    en_tete = entete_societe(L, "Masse salariale par collaborateur",
                             f'"Par unité organisationnelle et catégorie — " + {MOIS}') + entete_colonnes("c", cols, 21, L)
    g1_tete = [fond("g1_fond", 0, 1, L, 6.5, BLEU_CLAIR),
               champ("g1_titre", 1.5, 1, 260, 6.5, "uo_groupe", taille=8.5, gras=True, couleur=BLEU)]
    g2_tete = [champ("g2_titre", 4, 0.5, 200, 5.5, "categorie_groupe", taille=8, gras=True, italique=True, couleur=BLEU),
               ligne("g2_filet", 4, 5.8, 120, couleur=GRIS_CLAIR, epaisseur=0.3)]
    corps = ligne_valeurs("v", cols)
    g2_pied = rangee("g2", "GROUPE", '"Total " + categorie_groupe + " — " + NB(id, GROUPE) + " bulletin(s)"',
                     None, None, True, retrait=4) + [ligne("g2_sep", 0, 6.6, L, couleur=GRIS_CLAIR, epaisseur=0.2)]
    g1_pied = rangee("g1", "GROUPE", '"Total " + uo_groupe + " — " + NB(id, GROUPE) + " bulletin(s)"', BLEU, None, True)
    g1_pied.append(ligne("g1_filet", 0, 0.4, L, couleur=BLEU, epaisseur=0.5))
    total = rangee("t", "ETAT", '"TOTAL SOCIÉTÉ — " + NB(id, ETAT) + " bulletin(s)"', BLANC, BLEU, True, y=2, h=8)
    total.append(riche("t_note", 0, 13, L, 10,
                       "Population : celle choisie au lancement (unités organisationnelles avec ou sans les UO rattachées, "
                       "catégories, classifications…). % masse : part de la masse brute de l'état. Un salarié payé sur "
                       "plusieurs périodes du mois figure sur plusieurs lignes.", taille=7, italique=True, couleur=GRIS))
    uo = ('SI(@niveau_uo = "Direction (1er niveau)", SIVIDE(affectation.uo_niveau1_libelle, "Sans unité organisationnelle"), '
          'SI(@niveau_uo = "2e niveau", SIVIDE(affectation.uo_niveau2_libelle, "Sans unité organisationnelle"), '
          'SIVIDE(affectation.uo_chemin, SIVIDE(affectation.organisation_libelle, "Sans unité organisationnelle"))))')
    return definition(
        [PARAM_MOIS, PARAM_PLAN, PARAM_COLLABS,
         {"code": "niveau_uo", "libelle": "Regrouper les UO par", "type": "LISTE", "obligatoire": False,
          "valeurs": NIVEAUX_UO, "defaut": '"' + NIVEAUX_UO[0] + '"'}],
        [{"code": "b", "source": "BULLETIN", "role": "PRINCIPAL", "filtres": [],
          "calculs": [{"code": "uo_groupe", "expression": uo},
                      {"code": "categorie_groupe", "expression":
                       'SIVIDE(qualification.categorie_professionnelle_libelle, "Catégorie non renseignée")'}],
          "groupes": ["uo_groupe", "categorie_groupe"],
          "tri": [{"champ": "uo_groupe"}, {"champ": "categorie_groupe"}, {"champ": "identite.nom"},
                  {"champ": "identite.prenom"}]}],
        [bande("en_tete", "EN_TETE_PAGE", 31, en_tete),
         bande("g1_tete", "EN_TETE_GROUPE", 8, g1_tete, niveau_groupe=1),
         bande("g2_tete", "EN_TETE_GROUPE", 6.5, g2_tete, niveau_groupe=2),
         bande("detail", "CORPS", 5, corps),
         bande("g2_pied", "PIED_GROUPE", 7, g2_pied, niveau_groupe=2),
         bande("g1_pied", "PIED_GROUPE", 9, g1_pied, niveau_groupe=1),
         bande("total", "PIED_ETAT", 24, total, insecable=True),
         bande("pied", "PIED_PAGE", 8, pied_page(L, "Masse salariale nominative — document confidentiel"))],
        {"format": "A4", "orientation": "PAYSAGE", "marges": [10, 10, 10, 10]},
        {"formats": ["PDF"], "nom_fichier": '"Masse_salariale_collaborateurs_" + @periode.code'},
        usages={"confidentialite": 3})


def emargement() -> dict:
    """Liste des nets à payer par mode de paiement, avec colonne d'émargement (espèces, chèques)."""
    L = 180.0
    cols = [
        ("rang", "N°", 9, "NB(id, GROUPE)", "ENTIER", "CENTRE"),
        ("mat", "Matricule", 18, "identite.matricule", None, "GAUCHE"),
        ("nom", "Nom et prénom", 50, 'MAJUSCULE(identite.nom) + " " + identite.prenom', None, "GAUCHE"),
        ("cin", "CIN", 22, 'SIVIDE(identite.cin, "")', None, "GAUCHE"),
        ("net", "Net à payer", 26, "net_a_payer", "MONTANT", "DROITE"),
        ("sig", "Émargement", 55, '""', None, "GAUCHE"),
    ]
    en_tete = entete_societe(L, "État d'émargement", f'"Nets à payer — " + {MOIS}') + entete_colonnes("c", cols, 21, L)
    g_tete = [fond("g_fond", 0, 1.5, L, 6.5, BLEU_CLAIR),
              champ("g_titre", 2, 1.5, 150, 6.5, '"Mode de paiement : " + SIVIDE(paiement.mode_libelle, "non renseigné")',
                    taille=8.5, gras=True, couleur=BLEU)]
    corps = tableau_colonnes("v", cols, 0, 9, "VALEUR", lambda c, t, e: e, lambda a: dict(taille=8, alignement=a))
    corps += [cadre("v_sig_c", 126, 1, 53, 7, couleur=GRIS_CLAIR, arrondi=0.5),
              ligne("v_sep", 0, 8.8, L, couleur=GRIS_CLAIR, epaisseur=0.2)]
    g_pied = [champ("g_lib", 0, 1, 97, 6, '"Total " + SIVIDE(paiement.mode_libelle, "") + " — " + NB(id, GROUPE) + " salarié(s)"',
                    taille=8.5, gras=True, couleur=BLEU, alignement="DROITE"),
              champ("g_net", 99.8, 1, 24.4, 6, "TOTAL(net_a_payer, GROUPE)", masque="MONTANT", taille=8.5, gras=True,
                    couleur=BLEU, alignement="DROITE"),
              ligne("g_filet", 60, 0.5, 65, couleur=BLEU, epaisseur=0.5)]
    total = [fond("t_fond", 0, 2, L, 8, BLEU),
             champ("t_lib", 2, 2, 110, 8, '"TOTAL GÉNÉRAL — " + NB(id, ETAT) + " salariés"', taille=9, gras=True, couleur=BLANC),
             champ("t_net", 99.8, 2, 24.4, 8, "TOTAL(net_a_payer, ETAT)", masque="MONTANT", taille=9, gras=True, couleur=BLANC,
                   alignement="DROITE"),
             riche("t_lettres", 0, 12, L, 8, "Arrêté le présent état à la somme de {MAJUSCULE(MONTANT_EN_LETTRES(TOTAL(net_a_payer, ETAT)))}.",
                   taille=8.5, gras=True),
             cadre("vis_c1", 0, 24, 85, 26, couleur=GRIS_CLAIR, arrondi=1.5),
             texte("vis_t1", 2, 25, 81, 5, "Payé par (nom, date et signature)", taille=7.5, gras=True, couleur=BLEU),
             cadre("vis_c2", 95, 24, 85, 26, couleur=GRIS_CLAIR, arrondi=1.5),
             texte("vis_t2", 97, 25, 81, 5, "Visa de la direction", taille=7.5, gras=True, couleur=BLEU)]
    return definition(
        [PARAM_MOIS, PARAM_PLAN, PARAM_COLLABS],
        [{"code": "b", "source": "BULLETIN", "role": "PRINCIPAL", "filtres": ["net_a_payer > 0"],
          "groupes": ["paiement.mode_libelle"],
          "tri": [{"champ": "paiement.mode_libelle"}, {"champ": "identite.nom"}, {"champ": "identite.prenom"}]}],
        [bande("en_tete", "EN_TETE_PAGE", 31, en_tete),
         bande("g_tete", "EN_TETE_GROUPE", 9, g_tete, niveau_groupe=1),
         bande("detail", "CORPS", 9, corps),
         bande("g_pied", "PIED_GROUPE", 9, g_pied, niveau_groupe=1),
         bande("total", "PIED_ETAT", 52, total, insecable=True),
         bande("pied", "PIED_PAGE", 8, pied_page(L, "État d'émargement des salaires"))],
        {"format": "A4", "orientation": "PORTRAIT", "marges": [15, 15, 12, 15]},
        {"formats": ["PDF"], "nom_fichier": '"Emargement_" + @periode.code'},
        usages={"confidentialite": 3})


# =============================================================================
# 15 à 18. COMPARAISONS ENTRE PÉRIODES ET RÉCAPITULATIF DE L'EXERCICE
# =============================================================================
MOUVEMENT = 'SI(mouvement = "ENTREE", "Entrée", SI(mouvement = "SORTIE", "Sortie", "Présent"))'
STYLE_ENTETE_TAB = {"fond": BLEU, "couleur": BLANC, "gras": True, "taille": 6.5, "alignement": "CENTRE"}


def ecarts_rubriques() -> dict:
    """RG-EDT-COMPARAISON-04 : pour chaque salarié, ses rubriques comparées une à une à la période de
    référence (mois précédent ou période choisie) : nouvelles, supprimées, modifiées."""
    L = 277.0
    colonnes = [
        col("lib", "Rubrique", 66, "libelle"),
        col("code", "Code", 16, "code_rubrique", taille=6, couleur=GRIS),
        col("nb_p", "Nb réf.", 13, "p_nombre", "QUANTITE", couleur=GRIS),
        col("base_p", "Base réf.", 21, "p_base", "MONTANT_SANS_ZERO", couleur=GRIS),
        col("mt_p", "Montant réf.", 23, "p_montant", "MONTANT_SANS_ZERO", True, couleur=GRIS),
        col("nb", "Nb", 13, "nombre", "QUANTITE"),
        col("base", "Base", 21, "base", "MONTANT_SANS_ZERO"),
        col("mt", "Montant", 23, "montant", "MONTANT_SANS_ZERO", True),
        col("ecart", "Écart", 23, "ecart_montant", "MONTANT_SANS_ZERO", True, gras=True),
        col("pct", "Écart %", 15, "ecart_pct", "POURCENTAGE"),
        col("effet", "Effet net", 23, "effet_net", "MONTANT_SANS_ZERO", True),
        col("statut", "Statut", 20, "statut_libelle", gras=True, alignement="CENTRE"),
    ]
    sections = [{"id": "sec_gains", "titre": "Éléments de rémunération", "filtre": 'sens = "GAIN"', "sous_total": True},
                {"id": "sec_retenues", "titre": "Cotisations et retenues", "filtre": 'sens = "RETENUE"', "sous_total": True}]
    tab = {"id": "rubriques", "type": "TABLEAU", "x": 0, "y": 13, "l": L, "h": 20, "jeu": "e", "colonnes": colonnes,
           "sections": sections, "zebre": True, "quadrillage": "COLONNES", "hauteur_ligne": 4.6, "ligne_total": False,
           "style_entete": STYLE_ENTETE_TAB, "style": {"taille": 7}}
    corps = [
        fond("s_fond", 0, 1, L, 6.5, BLEU_CLAIR),
        champ("s_nom", 2, 1, 120, 6.5, 'identite.matricule + " — " + MAJUSCULE(identite.nom) + " " + identite.prenom',
              taille=8.5, gras=True, couleur=BLEU),
        champ("s_uo", 122, 1, 85, 6.5, 'SIVIDE(affectation.uo_niveau1_libelle, SIVIDE(affectation.organisation_libelle, ""))'
                                       ' + SI(ESTVIDE(affectation.emploi_libelle), "", " · " + affectation.emploi_libelle)',
              taille=7.5, couleur=GRIS),
        champ("s_mvt", 207, 1, 68, 6.5, '"Mouvement : " + ' + MOUVEMENT, taille=8, gras=True, couleur=ORANGE, alignement="DROITE"),
        champ("s_net", 2, 7.3, 273, 5,
              '"Net de référence " + FORMAT(SIVIDE(precedent.net_a_payer, 0), "MONTANT") + "  →  net " + FORMAT(net_a_payer, "MONTANT")'
              ' + "   (écart " + FORMAT(net_a_payer - SIVIDE(precedent.net_a_payer, 0), "MONTANT") + ")   ·   "'
              ' + comparaison.nb_ecarts + " rubrique(s) en écart : " + comparaison.nb_nouvelles + " nouvelle(s), "'
              ' + comparaison.nb_supprimees + " supprimée(s), " + comparaison.nb_modifiees + " modifiée(s)"',
              taille=7, couleur=GRIS),
        tab,
    ]
    synthese = [
        texte("s_titre", 0, 4, 150, 5, "Synthèse", taille=9, gras=True, couleur=BLEU),
        cadre("s_cadre", 0, 9, 150, 36, couleur=GRIS_CLAIR, arrondi=1.5),
        *paires("t", 2, 10, 95, 50, [
            ("Salariés listés", 'FORMAT(NB(id, ETAT), "ENTIER")'),
            ("dont entrées / sorties", 'FORMAT(NB(SI(mouvement = "ENTREE", 1, ""), ETAT), "ENTIER") + " / " + FORMAT(NB(SI(mouvement = "SORTIE", 1, ""), ETAT), "ENTIER")'),
            ("Rubriques en écart (toutes catégories)", 'FORMAT(TOTAL(comparaison.nb_ecarts, ETAT), "ENTIER")'),
            ("Nouvelles / supprimées / modifiées", 'FORMAT(TOTAL(comparaison.nb_nouvelles, ETAT), "ENTIER") + " / " + FORMAT(TOTAL(comparaison.nb_supprimees, ETAT), "ENTIER") + " / " + FORMAT(TOTAL(comparaison.nb_modifiees, ETAT), "ENTIER")'),
            ("Effet des écarts sur le net", 'FORMAT(TOTAL(comparaison.effet_net, ETAT), "MONTANT")'),
            ("Variation du net à payer", 'FORMAT(TOTAL(net_a_payer, ETAT) - TOTAL(precedent.net_a_payer, ETAT), "MONTANT")'),
            ("Variation de la masse brute", 'FORMAT(TOTAL(total_brut, ETAT) - TOTAL(precedent.total_brut, ETAT), "MONTANT")'),
        ], pas=4.8, taille=8),
        cadre("leg_c", 160, 9, 117, 36, couleur=GRIS_CLAIR, arrondi=1.5),
        {**riche("leg", 163, 11, 112, 32,
                 "Réf. : période de comparaison (le mois précédent, ou celle choisie au lancement). Nouvelle : rubrique absente "
                 "de la référence. Supprimée : présente seulement dans la référence. Modifiée : montant, nombre, base, taux ou "
                 "part patronale différents. Effet net : écart d'un gain, ou écart d'une retenue changé de signe. "
                 "Seules les rubriques imprimables (gains et retenues) sont comparées.", taille=7, italique=True, couleur=GRIS),
         "extensible": False},
    ]
    return definition(
        [PARAM_PERIODE, PARAM_COMPARAISON, PARAM_PLAN, PARAM_COLLABS, PARAM_SORTANTS,
         {"code": "affichage", "libelle": "Salariés affichés", "type": "LISTE", "obligatoire": False,
          "valeurs": ["Salariés avec écarts", "Tous les salariés"], "defaut": '"Salariés avec écarts"'},
         {"code": "detail", "libelle": "Rubriques affichées", "type": "LISTE", "obligatoire": False,
          "valeurs": ["Rubriques en écart", "Toutes les rubriques"], "defaut": '"Rubriques en écart"'},
         {"code": "seuil", "libelle": "Écart minimal d'une rubrique modifiée (montant)", "type": "NOMBRE", "obligatoire": False,
          "defaut": "0"}],
        [{"code": "b", "source": "BULLETIN", "role": "PRINCIPAL",
          "filtres": ["periode_id = @periode.id", 'OU(@affichage = "Tous les salariés", comparaison.nb_ecarts > 0)'],
          "tri": [{"champ": "identite.nom"}, {"champ": "identite.prenom"}]},
         {"code": "e", "source": "BULLETIN_ECART_LIGNE", "role": "SECONDAIRE", "parent": "b", "relation": "ecarts",
          "filtres": ['OU(@detail = "Toutes les rubriques", en_ecart = 1)',
                      'OU(@detail = "Toutes les rubriques", statut <> "MODIFIEE", ABS(SIVIDE(ecart_montant, 0)) >= @seuil)']}],
        [bande("en_tete", "EN_TETE_PAGE", 21, entete_societe(L, "Écarts par rubrique", f'{MOIS} + " comparé à " + {COMPAREE}')),
         bande("detail", "CORPS", 36, corps),
         bande("synthese", "PIED_ETAT", 47, synthese, insecable=True),
         bande("pied", "PIED_PAGE", 8, pied_page(L, "Contrôle de paie — document interne"))],
        {"format": "A4", "orientation": "PAYSAGE", "marges": [10, 10, 10, 10]},
        {"formats": ["PDF"], "nom_fichier": '"Ecarts_rubriques_" + @periode.code'},
        usages={"confidentialite": 3})


def controle_deux_periodes() -> dict:
    """RG-EDT-COMPARAISON-06 : deux périodes de paie au choix ; salariés regroupés par mouvement
    (entrées, sorties, présents) et rapprochement des masses : référence + entrées − sorties ± variations = période."""
    L = 277.0
    cols = [
        ("mat", "Matricule", 18, "identite.matricule", None, "GAUCHE"),
        ("nom", "Nom et prénom", 50, 'MAJUSCULE(identite.nom) + " " + identite.prenom', None, "GAUCHE"),
        ("brut_p", "Brut réf.", 23, "precedent.total_brut", "MONTANT_SANS_ZERO", "DROITE"),
        ("brut", "Brut", 23, "total_brut", "MONTANT_SANS_ZERO", "DROITE"),
        ("net_p", "Net réf.", 23, "precedent.net_a_payer", "MONTANT_SANS_ZERO", "DROITE"),
        ("net", "Net", 23, "net_a_payer", "MONTANT_SANS_ZERO", "DROITE"),
        ("ec_net", "Écart net", 22, "ecart_net", "MONTANT_SANS_ZERO", "DROITE"),
        ("pct", "Var. %", 15, 'SI(mouvement = "PRESENT", pct_net, "")', "POURCENTAGE", "DROITE"),
        ("cout_p", "Coût réf.", 24, "precedent.cout_employeur", "MONTANT_SANS_ZERO", "DROITE"),
        ("cout", "Coût", 24, "cout_employeur", "MONTANT_SANS_ZERO", "DROITE"),
        ("ec_cout", "Écart coût", 22, "ecart_cout", "MONTANT_SANS_ZERO", "DROITE"),
        ("rub", "Rub.", 10, 'SI(comparaison.nb_ecarts > 0, comparaison.nb_ecarts, "")', "ENTIER", "CENTRE"),
    ]
    sous_titre = 'FORMAT(@periode.date_fin, "MOIS_ANNEE") + " comparé à " + FORMAT(@periode_comparaison.date_fin, "MOIS_ANNEE")'
    en_tete = entete_societe(L, "Contrôle entre deux périodes", sous_titre) + entete_colonnes("c", cols, 21, L)
    g_tete = [fond("g_fond", 0, 1, L, 6.5, BLEU_CLAIR),
              champ("g_titre", 1.5, 1, 220, 6.5, "mvt_lib", taille=8.5, gras=True, couleur=BLEU)]
    corps = [{**fond("alerte", 0, 0, L, 5, ORANGE_CLAIR),
              "condition": {"expression": 'ET(mouvement = "PRESENT", ABS(pct_net) >= @seuil)'}}]
    corps += ligne_valeurs("v", cols)
    for e in corps:
        if e["id"] in ("v_ec_net", "v_ec_cout", "v_rub"):
            e["style"]["gras"] = True
    g_pied = totaux_colonnes("g", cols, "GROUPE", 0.5, 6, BLEU, None, '"Total — " + NB(id, GROUPE) + " salarié(s)"', l_lib=66)
    g_pied = [e for e in g_pied if e["id"] != "g_fond"] + [ligne("g_filet", 0, 0.3, L, couleur=BLEU, epaisseur=0.4)]
    # rapprochement des masses
    def r(expr):            # même expression pour brut, net, coût
        return {k: expr.replace("X", f"SIVIDE({x}, 0)").replace("SIVIDE(precedent.SIVIDE(" + x + ", 0), 0)", f"SIVIDE(precedent.{x}, 0)")
                for k, x in (("brut", "total_brut"), ("net", "net_a_payer"), ("cout", "cout_employeur"))}
    lignes = [
        {"id": "ref", "titre": "Période de référence", "valeurs": {
            "eff": 'NB(SI(precedent.existe = 1, 1, ""), ETAT)', **r("TOTAL(SIVIDE(precedent.X, 0), ETAT)")}},
        {"id": "ent", "titre": "+ Entrées", "valeurs": {
            "eff": 'NB(SI(mouvement = "ENTREE", 1, ""), ETAT)', **r('TOTAL(SI(mouvement = "ENTREE", X, 0), ETAT)')}},
        {"id": "sor", "titre": "− Sorties", "valeurs": {
            "eff": '0 - NB(SI(mouvement = "SORTIE", 1, ""), ETAT)', **r('0 - TOTAL(SI(mouvement = "SORTIE", SIVIDE(precedent.X, 0), 0), ETAT)')}},
        {"id": "var", "titre": "± Variations des présents", "valeurs": {
            **r('TOTAL(SI(mouvement = "PRESENT", X - SIVIDE(precedent.X, 0), 0), ETAT)')}},
        {"id": "per", "titre": "= Période éditée", "style": {"gras": True, "fond": BLEU_CLAIR}, "valeurs": {
            "eff": 'NB(SI(mouvement <> "SORTIE", 1, ""), ETAT)', **r("TOTAL(X, ETAT)")}},
        {"id": "ctl", "titre": "Écart de rapprochement (doit être nul)", "style": {"italique": True}, "valeurs": {
            **r('TOTAL(SIVIDE(precedent.X, 0), ETAT) + TOTAL(SI(mouvement = "ENTREE", X, 0), ETAT) - TOTAL(SI(mouvement = "SORTIE", SIVIDE(precedent.X, 0), 0), ETAT) + TOTAL(SI(mouvement = "PRESENT", X - SIVIDE(precedent.X, 0), 0), ETAT) - TOTAL(X, ETAT)')}},
    ]
    rapprochement = {
        "id": "rappro", "type": "GRILLE", "x": 0, "y": 10, "l": 190, "h": 36, "largeur_titres": 70, "hauteur_ligne": 5.5,
        "quadrillage": "COMPLET", "style": {"taille": 7.5, "couleur_bordure": GRIS_CLAIR, "alignement": "DROITE"},
        "style_entete": {"fond": BLEU, "couleur": BLANC, "gras": True, "taille": 7, "alignement": "CENTRE"},
        "style_titres": {"gras": True, "couleur": BLEU, "alignement": "GAUCHE"},
        "colonnes": [{"id": "eff", "titre": "Effectif", "largeur": 24, "affichage": {"masque": "ENTIER", "valeur_si_vide": ""}},
                     *[{"id": c, "titre": t, "largeur": 32, "affichage": {"masque": "MONTANT", "valeur_si_vide": ""}}
                       for c, t in (("brut", "Masse brute"), ("net", "Net à payer"), ("cout", "Coût employeur"))]],
        "lignes": lignes,
    }
    synthese = [
        texte("r_titre", 0, 4, 190, 5, "Rapprochement des masses entre les deux périodes", taille=9, gras=True, couleur=BLEU),
        rapprochement,
        {**riche("r_note", 198, 10, 79, 36,
                 "Référence : la période de comparaison choisie au lancement. Entrée : pas de bulletin dans la référence. "
                 "Sortie : bulletin dans la référence seulement. Ligne surlignée : variation du net au-delà du seuil. "
                 "« Rub. » : rubriques du bulletin en écart (détail dans l'état « Écarts par rubrique »).",
                 taille=7, italique=True, couleur=GRIS), "extensible": False},
    ]
    return definition(
        [PARAM_PERIODE,
         {"code": "periode_comparaison", "libelle": "Période de référence (comparée)", "type": "PERIODE"},
         PARAM_PLAN, PARAM_COLLABS, PARAM_SORTANTS,
         {"code": "seuil", "libelle": "Seuil d'alerte (variation du net, en %)", "type": "NOMBRE", "obligatoire": False, "defaut": "10"},
         {"code": "affichage", "libelle": "Salariés affichés", "type": "LISTE", "obligatoire": False,
          "valeurs": ["Tous les salariés", "Mouvements et écarts seulement"], "defaut": '"Tous les salariés"'}],
        [{"code": "b", "source": "BULLETIN", "role": "PRINCIPAL",
          "calculs": [{"code": "mvt_rang", "expression": 'SI(mouvement = "ENTREE", 1, SI(mouvement = "SORTIE", 2, 3))'},
                      {"code": "mvt_lib", "expression": 'SI(mouvement = "ENTREE", "Entrées — pas de bulletin dans la période de référence", '
                                                         'SI(mouvement = "SORTIE", "Sorties — bulletin dans la période de référence seulement", '
                                                         '"Salariés payés dans les deux périodes"))'},
                      {"code": "ecart_brut", "expression": "total_brut - SIVIDE(precedent.total_brut, 0)"},
                      {"code": "ecart_net", "expression": "net_a_payer - SIVIDE(precedent.net_a_payer, 0)"},
                      {"code": "ecart_cout", "expression": "SIVIDE(cout_employeur, 0) - SIVIDE(precedent.cout_employeur, 0)"},
                      {"code": "pct_net", "expression": "SI(SIVIDE(precedent.net_a_payer, 0) = 0, 0, (net_a_payer - precedent.net_a_payer) / precedent.net_a_payer * 100)"}],
          "filtres": ["periode_id = @periode.id"],
          "groupes": ["mvt_lib"],
          "tri": [{"champ": "mvt_rang"}, {"champ": "identite.nom"}, {"champ": "identite.prenom"}]}],
        [bande("en_tete", "EN_TETE_PAGE", 31, en_tete),
         bande("g_tete", "EN_TETE_GROUPE", 8, g_tete, niveau_groupe=1),
         bande("detail", "CORPS", 5, corps,
               condition='OU(@affichage = "Tous les salariés", mouvement <> "PRESENT", ABS(SIVIDE(ecart_net, 0)) > 0)'),
         bande("g_pied", "PIED_GROUPE", 8, g_pied, niveau_groupe=1),
         bande("synthese", "PIED_ETAT", 48, synthese, insecable=True),
         bande("pied", "PIED_PAGE", 8, pied_page(L, "Contrôle de paie — document interne"))],
        {"format": "A4", "orientation": "PAYSAGE", "marges": [10, 10, 10, 10]},
        {"formats": ["PDF"], "nom_fichier": '"Controle_" + @periode.code + "_" + @periode_comparaison.code'},
        usages={"confidentialite": 3})


def comparatif_rubriques() -> dict:
    """RG-EDT-COMPARAISON-05 : masse de chaque rubrique sur toute la population, période éditée et
    période de comparaison, salariés concernés et mouvements ; puis les totaux du bulletin."""
    L = 277.0
    cols = [
        ("code", "Code", 20, 'SI(sens = "TOTAL", "", code_rubrique)', None, "GAUCHE"),
        ("lib", "Rubrique", 62, "libelle", None, "GAUCHE"),
        ("sal_p", "Sal. réf.", 14, "p_nb_salaries", "ENTIER", "DROITE"),
        ("mt_p", "Montant réf.", 27, "p_montant", "MONTANT_SANS_ZERO", "DROITE"),
        ("sal", "Sal.", 14, "nb_salaries", "ENTIER", "DROITE"),
        ("mt", "Montant", 27, "montant", "MONTANT_SANS_ZERO", "DROITE"),
        ("ecart", "Écart", 26, "ecart_montant", "MONTANT_SANS_ZERO", "DROITE"),
        ("pct", "Écart %", 16, "ecart_pct", "POURCENTAGE", "DROITE"),
        ("pat", "Écart patronal", 21, "ecart_patronal", "MONTANT_SANS_ZERO", "DROITE"),
        ("mvt", "Salariés + / − / ≠", 30,
         'SI(sens = "TOTAL", SI(nb_modifies > 0, "≠ " + nb_modifies, ""), "+" + nb_nouveaux + " / −" + nb_disparus + " / ≠" + nb_modifies)',
         None, "CENTRE"),
        ("statut", "Statut", 20, 'SI(statut = "IDENTIQUE", "", statut_libelle)', None, "CENTRE"),
    ]
    en_tete = entete_societe(L, "Comparatif des rubriques", f'{MOIS} + " comparé à " + {COMPAREE}') + entete_colonnes("c", cols, 21, L)
    cartes = [("Effectif de référence", "p_effectif"), ("Effectif de la période", "effectif"),
              ("Entrées", "nb_entrees"), ("Sorties", "nb_sorties")]
    etat = []
    for k, (lib, expr) in enumerate(cartes):
        x = k * 69.25
        etat += [cadre(f"e{k}_c", x + 0.5, 4, 68.25, 12, couleur=GRIS_CLAIR, arrondi=1),
                 texte(f"e{k}_l", x + 1, 4.5, 67, 4.5, lib, taille=7, couleur=GRIS, alignement="CENTRE"),
                 champ(f"e{k}_v", x + 1, 9, 67, 6, expr, masque="ENTIER", taille=11, gras=True, couleur=BLEU, alignement="CENTRE")]
    g_tete = [fond("g_fond", 0, 1.5, L, 6.5, BLEU_CLAIR),
              champ("g_titre", 1.5, 1.5, 220, 6.5, "sens_libelle", taille=8.5, gras=True, couleur=BLEU)]
    corps = [{**fond("alerte", 0, 0, L, 5, ORANGE_CLAIR),
              "condition": {"expression": 'ET(sens <> "TOTAL", OU(statut = "NOUVELLE", statut = "SUPPRIMEE", ABS(SIVIDE(ecart_pct, 0)) >= @seuil))'}}]
    corps += ligne_valeurs("v", cols)
    for e in corps:
        if e["id"] in ("v_ecart", "v_statut"):
            e["style"]["gras"] = True
    g_pied = [champ("g_lib", 1, 0.5, 120, 6, '"Total " + sens_libelle', taille=8, gras=True, couleur=BLEU),
              champ("g_mt_p", 96.8, 0.5, 25.4, 6, "TOTAL(p_montant, GROUPE)", masque="MONTANT", taille=8, gras=True, couleur=BLEU, alignement="DROITE"),
              champ("g_mt", 137.8, 0.5, 25.4, 6, "TOTAL(montant, GROUPE)", masque="MONTANT", taille=8, gras=True, couleur=BLEU, alignement="DROITE"),
              champ("g_ecart", 164.8, 0.5, 24.4, 6, "TOTAL(ecart_montant, GROUPE)", masque="MONTANT", taille=8, gras=True, couleur=BLEU, alignement="DROITE"),
              ligne("g_filet", 0, 0.3, L, couleur=BLEU, epaisseur=0.4)]
    note = etat + [{**riche("n", 0, 19, L, 14,
                     "Réf. : période de comparaison (le mois précédent, ou celle choisie au lancement). Sal. : salariés pour lesquels "
                     "la rubrique est renseignée. + / − / ≠ : salariés où la rubrique apparaît, disparaît, ou change. Les sorties "
                     "(bulletin de référence seulement) sont comptées. Ligne surlignée : rubrique nouvelle, supprimée, ou écart "
                     "au-delà du seuil. Le groupe « Totaux du bulletin » rapproche les totaux d'en-tête.",
                     taille=7, italique=True, couleur=GRIS), "extensible": False}]
    return definition(
        [PARAM_PERIODE, PARAM_COMPARAISON, PARAM_PLAN, PARAM_COLLABS,
         {"code": "affichage", "libelle": "Rubriques affichées", "type": "LISTE", "obligatoire": False,
          "valeurs": ["Toutes les rubriques", "Rubriques en écart seulement"], "defaut": '"Toutes les rubriques"'},
         {"code": "seuil", "libelle": "Seuil d'alerte (écart en %)", "type": "NOMBRE", "obligatoire": False, "defaut": "10"}],
        [{"code": "r", "source": "COMPARAISON_RUBRIQUES", "role": "PRINCIPAL",
          "filtres": ['OU(@affichage = "Toutes les rubriques", en_ecart = 1, sens = "TOTAL")'],
          "groupes": ["sens_libelle"],
          "tri": [{"champ": "rang_sens"}, {"champ": "ordre_affichage"}, {"champ": "code_rubrique"}]}],
        [bande("en_tete", "EN_TETE_PAGE", 31, en_tete),
         bande("g_tete", "EN_TETE_GROUPE", 9, g_tete, niveau_groupe=1),
         bande("detail", "CORPS", 5, corps),
         bande("g_pied", "PIED_GROUPE", 8, g_pied, niveau_groupe=1, condition='sens <> "TOTAL"'),
         bande("note", "PIED_ETAT", 34, note, insecable=True),
         bande("pied", "PIED_PAGE", 8, pied_page(L, "Contrôle de paie — sans données nominatives"))],
        {"format": "A4", "orientation": "PAYSAGE", "marges": [10, 10, 10, 10]},
        {"formats": ["PDF"], "nom_fichier": '"Comparatif_rubriques_" + @periode.code'},
        usages={"confidentialite": 2})


# Récapitulatif de l'exercice : les rubriques sont affectées comme au bulletin, un seul attribut chacune
RECAP_AFFECTATIONS = [
    ("Éléments de rémunération", [("SALBASE", "MT", None), ("SALCONGE", "MT", None), ("PRIM_ANC", "MT", None),
                                  ("INDTRSP", "MT", None), ("INDREPR", "MT", None), ("TOTAL_BRUT", "MT", "Salaire brut")]),
    ("Cotisations et retenues", [("CNSS_SAL", "MT", None), ("CNSS_AMO_SAL", "MT", None), ("RET_IR", "MT", "Impôt sur le revenu"),
                                 ("TOTAL_RETENUES", "MT", "Total des retenues")]),
    ("Net", [("NET_A_PAYER", "MT", "Net à payer")]),
    ("Éléments fiscaux", [("BRUT_IMPOSABLE", "MT", "Brut imposable"), ("FRAIS_PROF", "MT", None),
                          ("NET_IMPOSABLE", "MT", "Net imposable")]),
    ("Charges patronales", [("CNSS_SAL", "PAT", "CNSS — part patronale"), ("CNSS_AMO_SAL", "PAT", "AMO — part patronale"),
                            ("COT_PATRONALES", "MT", "Total des charges patronales"), ("COUT_EMPLOYEUR", "MT", "Coût employeur")]),
]
TOTAUX_RECAP = {"TOTAL_BRUT", "TOTAL_RETENUES", "NET_A_PAYER", "NET_IMPOSABLE", "COT_PATRONALES", "COUT_EMPLOYEUR"}
MOIS_COURTS = ("Janv.", "Févr.", "Mars", "Avril", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc.")


def _corps_exercice(code, libelle, type_, masque, affectations):
    return {"code": code, "libelle": libelle, "nature": "EXERCICE", "afficher_titre": False,
            "colonnes": [{"code": f"m{m:02d}", "libelle": MOIS_COURTS[m - 1], "type": type_, "masque": masque, "total": True}
                         for m in range(1, 13)] + [{"code": "total", "libelle": "Total", "type": type_, "masque": masque, "total": True}],
            "affectations": affectations}


def _tableau_exercice(id_, corps, y, masque, largeur_lib, L, **opts):
    largeur_mois = round((L - largeur_lib - 26) / 12, 2)
    colonnes = [col("lib", "Rubrique", largeur_lib, "libelle")]
    colonnes += [col(f"m{m:02d}", MOIS_COURTS[m - 1], largeur_mois, f"m{m:02d}", masque, alignement="DROITE") for m in range(1, 13)]
    colonnes.append(col("total", "Total", round(L - largeur_lib - 12 * largeur_mois, 2), "total", masque, gras=True, alignement="DROITE",
                        fond=BLEU_CLAIR))
    return {"id": id_, "type": "TABLEAU", "x": 0, "y": y, "l": L, "h": 12, "jeu": "", "corps": corps, "colonnes": colonnes,
            "quadrillage": "COLONNES", "hauteur_ligne": 4.6, "ligne_total": False, "style_entete": STYLE_ENTETE_TAB,
            "style": {"taille": 6.5}, **opts}


def bulletin_recapitulatif() -> dict:
    """RG-EDT-EXERCICE-01/02 : un document par salarié, les douze mois de l'exercice en colonnes.
    Le paramétrage reprend celui du bulletin : des rubriques affectées dans des corps, chacune avec
    UN attribut (montant, nombre, base, part patronale…) ventilé sur les mois."""
    L = 277.0
    affectations = []
    for groupe, liste in RECAP_AFFECTATIONS:
        for code, attr, lib in liste:
            a = {"rubrique": code, "cibles": {attr: "mois"}, "groupe": groupe}
            if lib:
                a["libelle"] = lib
            if code in TOTAUX_RECAP:
                a["gras"] = True
            affectations.append(a)
    corps_donnees = [
        _corps_exercice("activite", "Activité", "NOMBRE", "QUANTITE",
                        [{"rubrique": "NBJTRV", "cibles": {"NB": "mois"}, "libelle": "Jours travaillés"},
                         {"rubrique": "NBJCNG", "cibles": {"NB": "mois"}, "libelle": "Jours de congé payé"}]),
        _corps_exercice("recap", "Récapitulatif", "MONTANT", "MONTANT_SANS_ZERO", affectations),
    ]
    en_tete = entete_societe(L, "Bulletin récapitulatif", '"Exercice " + exercice.annee + " — du 1er janvier au 31 décembre"') + [
        cadre("sal_c", 0, 21, L, 19, couleur=BLEU, arrondi=1.5, epaisseur=0.5),
        fond("sal_b", 0.3, 21.3, L - 0.6, 5.5, BLEU),
        champ("sal_t", 2, 21.3, 160, 5.5, 'SIVIDE(identite.civilite, "") + " " + MAJUSCULE(identite.nom) + " " + identite.prenom',
              taille=8.5, gras=True, couleur=BLANC),
        champ("sal_mat", 180, 21.3, 95, 5.5, '"Matricule " + identite.matricule', taille=8, gras=True, couleur=BLANC, alignement="DROITE"),
        *paires("sa", 2, 27.5, 22, 66, [
            ("Emploi", 'SIVIDE(affectation.emploi_libelle, "—")'),
            ("Affectation", 'SIVIDE(affectation.uo_chemin, SIVIDE(affectation.organisation_libelle, "—"))')], pas=4.5, taille=7.5),
        *paires("sb", 94, 27.5, 24, 64, [
            ("Catégorie", 'SIVIDE(qualification.categorie_professionnelle_libelle, SIVIDE(qualification.classification_libelle, "—"))'),
            ("Entrée le", 'SI(ESTVIDE(contrat.date_embauche), "—", FORMAT(contrat.date_embauche, "DATE_FR"))')], pas=4.5, taille=7.5),
        *paires("sc", 186, 27.5, 26, 63, [
            ("CIN / CNSS", 'SIVIDE(identite.cin, "—") + " / " + SIVIDE(identite.num_cnss, "—")'),
            ("Mois payés", 'exercice.mois_payes + " (" + exercice.nb_bulletins + " bulletin(s))"')], pas=4.5, taille=7.5),
    ]
    activite = [_tableau_exercice("t_activite", "activite", 1, "QUANTITE", 60, L, grouper=False)]
    recap = [_tableau_exercice("t_recap", "recap", 1, "MONTANT_SANS_ZERO", 60, L)]
    cartes = [("Salaire brut", "total_brut"), ("Net imposable", "net_imposable"), ("IR retenu", "SIVIDE([RET_IR].MT, 0)"),
              ("Net payé", "net_a_payer"), ("Coût employeur", "cout_employeur")]
    pied_etat = []
    largeur = (L - 30) / 5
    for k, (lib, expr) in enumerate(cartes):
        x = k * largeur
        pied_etat += [cadre(f"k{k}_c", x + 0.5, 3, largeur - 1, 13, couleur=GRIS_CLAIR, arrondi=1),
                      texte(f"k{k}_l", x + 1, 3.5, largeur - 2, 4.5, f"{lib} de l'exercice", taille=6.5, couleur=GRIS, alignement="CENTRE"),
                      champ(f"k{k}_v", x + 1, 8.5, largeur - 2, 6.5, expr, masque="MONTANT", taille=10, gras=True, couleur=BLEU,
                            alignement="CENTRE")]
    pied_etat += [
        {"id": "qr", "type": "CODE_BARRE", "x": L - 22, "y": 1.5, "l": 17, "h": 17, "symbologie": "QR",
         "valeur": '"REC|" + SIVIDE(societe.ice, "") + "|" + identite.matricule + "|" + exercice.annee + "|" + FORMAT(net_a_payer, "MONTANT")'},
        {**riche("note", 0, 18, L - 30, 9,
                 "Récapitulatif établi à partir des bulletins définitifs de l'exercice (périodes clôturées comprises). "
                 "Chaque colonne reprend le mois de paie ; le total est la somme des mois (vide pour un taux).",
                 taille=6.5, italique=True, couleur=GRIS), "extensible": False},
    ]
    d = definition(
        [{"code": "annee", "libelle": "Exercice (année)", "type": "ANNEE"}, PARAM_PLAN, PARAM_COLLABS],
        [{"code": "s", "source": "EXERCICE_SALARIE", "role": "PRINCIPAL",
          "tri": [{"champ": "identite.nom"}, {"champ": "identite.prenom"}]}],
        [bande("en_tete", "EN_TETE_PAGE", 42, en_tete),
         bande("activite", "CORPS", 14, activite, condition="SIVIDE([NBJTRV].NB, 0) + SIVIDE([NBJCNG].NB, 0) > 0"),
         bande("detail", "CORPS", 14, recap),
         bande("totaux", "PIED_ETAT", 28, pied_etat, insecable=True),
         bande("pied", "PIED_PAGE", 8, pied_page(L, "Bulletin récapitulatif — à conserver sans limitation de durée"))],
        {"format": "A4", "orientation": "PAYSAGE", "marges": [10, 10, 10, 10]},
        {"formats": ["PDF"], "nom_fichier": '"Recapitulatif_" + identite.matricule + "_" + exercice.annee',
         "eclatement": "collaborateur_id"},
        usages={"confidentialite": 4})
    d["corps"] = corps_donnees
    return transposer_recapitulatif(d)


# =============================================================================
# DOCUMENTS RH ADMINISTRATIFS — sortie du salarié, salaire annuel, domiciliation (RG-EDT-RH-01..05)
# =============================================================================
# facultatif : depuis la fiche d'un collaborateur, son départ suffit (RG-EDT-ECRAN-08 ne s'applique pas)
PARAM_MOIS_SORTIE = {"code": "periode", "libelle": "Mois de sortie", "type": "MOIS", "obligatoire": False}
PARAM_DATE_DOC = {"code": "date_document", "libelle": "Date du document", "type": "DATE", "obligatoire": False, "defaut": "DATEJOUR()"}
DATE_DOC = "SIVIDE(@date_document, DATEJOUR())"
SALARIE = 'SIVIDE(identite.civilite, "") + " " + MAJUSCULE(identite.nom) + " " + identite.prenom'
EMPLOI = 'SIVIDE(affectation.emploi_libelle, SIVIDE(qualification.fonction_libelle, "salarié(e)"))'


def _titre_doc(titre_expr, reference, L=180.0):
    return [champ("titre", 0, 4, L, 10, titre_expr, taille=16, gras=True, couleur=BLEU, alignement="CENTRE", casse="PETITES_MAJUSCULES"),
            ligne("titre_filet", 65, 15, 50, couleur=BLEU, epaisseur=1),
            champ("reference", 0, 18, L, 5, reference, taille=8, couleur=GRIS, alignement="CENTRE")]


def _signature(y, droite="Pour la société,", gauche=None, L=180.0):
    el = [champ("fait_a", 95, y, 85, 6, '"Fait à " + SIVIDE(societe.ville, "………") + ", le " + FORMAT(' + DATE_DOC + ', "DATE_LONGUE")',
                taille=10),
          texte("pour_societe", 95, y + 7, 85, 5, droite, taille=10, gras=True),
          champ("signataire", 95, y + 12, 85, 5, 'SIVIDE(societe.nom_gerant, "La Direction")', taille=10),
          cadre("zone_signature", 95, y + 18, 70, 26, couleur=GRIS_CLAIR, arrondi=2),
          texte("zone_signature_t", 97, y + 38, 66, 5, "Signature et cachet", taille=7, italique=True, couleur=GRIS, alignement="CENTRE")]
    if gauche:
        el += [texte("salarie_t", 0, y + 7, 85, 5, gauche[0], taille=10, gras=True),
               riche("salarie_mention", 0, y + 12, 85, 6, gauche[1], taille=7.5, italique=True, couleur=GRIS),
               cadre("salarie_signature", 0, y + 18, 70, 26, couleur=GRIS_CLAIR, arrondi=2)]
    return el


def certificat_travail() -> dict:
    """RG-EDT-RH-01 : certificat de travail remis à la sortie : dates d'entrée et de sortie, emploi(s) occupé(s)
    — et rien d'autre (ni motif de départ, ni appréciation). Mention « libre de tout engagement » au choix."""
    L = 180.0
    texte_ = riche("paragraphe", 0, 2, L, 40,
        "Nous soussignés, {societe.raison_sociale}{SI(ESTVIDE(societe.forme_juridique), \"\", \", \" + societe.forme_juridique)}, "
        "dont le siège est situé {SIVIDE(societe.adresse, \"\")}{SI(ESTVIDE(societe.ville), \"\", \" à \" + societe.ville)}, "
        "immatriculée à la CNSS sous le n° {SIVIDE(societe.numero_cnss, \"—\")}, certifions que :\n\n"
        "{" + SALARIE + "}, titulaire de la CIN n° {SIVIDE(identite.cin, \"—\")}, immatriculé(e) à la CNSS sous le n° "
        "{SIVIDE(identite.num_cnss, \"—\")}, a été employé(e) dans notre société du "
        "{SI(ESTVIDE(contrat.date_embauche), \"……………\", FORMAT(contrat.date_embauche, \"DATE_LONGUE\"))} au "
        "{FORMAT(depart.date_depart, \"DATE_LONGUE\")}, en qualité de {" + EMPLOI + "}"
        "{SI(ESTVIDE(qualification.categorie_professionnelle_libelle), \"\", \" (catégorie \" + qualification.categorie_professionnelle_libelle + \")\")}.\n\n"
        "{SI(@libre, \"L'intéressé(e) nous quitte libre de tout engagement.\", \"\")}\n\n"
        "En foi de quoi, le présent certificat lui est délivré pour servir et valoir ce que de droit.", taille=10.5)
    note = {**riche("note", 0, 50, 90, 10, "Certificat de travail délivré à la cessation du contrat, conformément au Code du travail ; "
                    "exonéré des droits de timbre et d'enregistrement.", taille=7, italique=True, couleur=GRIS), "extensible": False}
    return definition(
        [PARAM_MOIS_SORTIE, PARAM_COLLABS, PARAM_DATE_DOC,
         {"code": "libre", "libelle": "Mention « libre de tout engagement »", "type": "BOOLEEN", "obligatoire": False, "defaut": "VRAI"}],
        [{"code": "d", "source": "DEPART", "role": "PRINCIPAL", "tri": [{"champ": "identite.nom"}, {"champ": "identite.prenom"}]}],
        [bande("en_tete", "EN_TETE_PAGE", 24, entete_societe(L, "Ressources humaines", '"Sortie le " + FORMAT(depart.date_depart, "DATE_FR")')),
         bande("titre", "CORPS", 26, _titre_doc('"Certificat de travail"', '"Réf. : CT-" + identite.matricule + "-" + FORMAT(depart.date_depart, "AAAAMMJJ")')),
         bande("texte", "CORPS", 44, [texte_], extensible=True),
         bande("cloture", "CORPS", 66, _signature(4) + [note], insecable=True),
         bande("pied", "PIED_PAGE", 12, mentions_legales(L))],
        {"format": "A4", "orientation": "PORTRAIT", "marges": [15, 15, 12, 15]},
        {"formats": ["PDF"], "nom_fichier": '"Certificat_travail_" + identite.matricule', "eclatement": "collaborateur_id"},
        usages={"confidentialite": 2, "duplicata": True})


def recu_solde_tout_compte() -> dict:
    """RG-EDT-RH-02 : reçu pour solde de tout compte : somme nette du bulletin de sortie en chiffres et en lettres,
    détail des éléments payés et retenus (lignes du bulletin de sortie), mode de paiement, double exemplaire,
    délai de dénonciation de soixante jours, signature du salarié précédée de « Lu et approuvé »."""
    L = 180.0
    texte_ = riche("paragraphe", 0, 2, L, 34,
        "Je soussigné(e), {" + SALARIE + "}, titulaire de la CIN n° {SIVIDE(identite.cin, \"—\")}, matricule {identite.matricule}, "
        "ayant été employé(e) par {societe.raison_sociale} du "
        "{SI(ESTVIDE(contrat.date_embauche), \"……………\", FORMAT(contrat.date_embauche, \"DATE_LONGUE\"))} au "
        "{FORMAT(depart.date_depart, \"DATE_LONGUE\")} en qualité de {" + EMPLOI + "}, reconnais avoir reçu de mon employeur, "
        "pour solde de tout compte, la somme nette de {FORMAT(net_a_payer, \"MONTANT\")} dirhams "
        "({MONTANT_EN_LETTRES(net_a_payer)}), en paiement des salaires, accessoires de salaire, indemnités et de toutes "
        "les sommes qui m'étaient dues au titre de l'exécution et de la cessation de mon contrat de travail, "
        "selon le détail ci-dessous{SI(ESTVIDE(bulletin_periode), \"\", \" (bulletin de sortie : \" + bulletin_periode + \")\")} :",
        taille=10)
    cols = [col("c_lib", "Désignation", 100, "libelle"),
            col("c_base", "Base / nombre", 26, "SIVIDE(base, nombre)", "MONTANT_SANS_ZERO", alignement="DROITE"),
            col("c_gain", "À payer", 27, 'SI(sens = "GAIN", montant)', "MONTANT_SANS_ZERO", True, alignement="DROITE"),
            col("c_ret", "Retenu", 27, 'SI(sens = "RETENUE", montant)', "MONTANT_SANS_ZERO", True, alignement="DROITE")]
    detail = [{"id": "detail", "type": "TABLEAU", "x": 0, "y": 1, "l": L, "h": 12, "jeu": "l", "colonnes": cols,
               "quadrillage": "COLONNES", "hauteur_ligne": 5, "ligne_total": True, "style_entete": STYLE_ENTETE_TAB,
               "style": {"taille": 8.5}}]
    net = [fond("net_fond", 0, 1, L, 7, BLEU_CLAIR),
           champ("net_lib", 2, 1, 120, 7, '"Net payé pour solde de tout compte"', taille=10, gras=True, couleur=BLEU),
           champ("net_val", 120, 1, 58, 7, "net_a_payer", masque="MONTANT", taille=11, gras=True, couleur=BLEU, alignement="DROITE"),
           champ("mode", 0, 10, L, 5, '"Mode de paiement : " + SIVIDE(paiement.mode_libelle, "—") + SI(ESTVIDE(paiement.numero_compte), "", '
                 '" — compte n° " + paiement.numero_compte) + SI(ESTVIDE(paiement.banque_libelle), "", " (" + paiement.banque_libelle + ")")', taille=9)]
    mentions = [riche("mentions", 0, 2, L, 16,
        "Le présent reçu est établi en double exemplaire, dont l'un m'a été remis. Il peut être dénoncé dans un délai de "
        "soixante (60) jours suivant la date de sa signature ; passé ce délai, il devient libératoire pour l'employeur "
        "quant aux sommes qui y sont mentionnées.", taille=9, italique=True)]
    sig = _signature(2, "L'employeur,", ("Le salarié,", "Date, mention manuscrite « Lu et approuvé, bon pour solde de tout compte » et signature"))
    return definition(
        [PARAM_MOIS_SORTIE, PARAM_COLLABS, PARAM_DATE_DOC],
        [{"code": "d", "source": "DEPART", "role": "PRINCIPAL", "tri": [{"champ": "identite.nom"}, {"champ": "identite.prenom"}]},
         {"code": "l", "source": "BULLETIN_LIGNE", "role": "SECONDAIRE", "parent": "d", "relation": "lignes",
          "filtres": ['sens = "GAIN" OU sens = "RETENUE"', "COALESCE(montant, 0) <> 0"], "tri": [{"champ": "ordre_affichage"}]}],
        [bande("en_tete", "EN_TETE_PAGE", 24, entete_societe(L, "Ressources humaines", '"Sortie le " + FORMAT(depart.date_depart, "DATE_FR")')),
         bande("titre", "CORPS", 26, _titre_doc('"Reçu pour solde de tout compte"', '"Réf. : STC-" + identite.matricule + "-" + FORMAT(depart.date_depart, "AAAAMMJJ")')),
         bande("texte", "CORPS", 36, [texte_], extensible=True),
         bande("detail", "CORPS", 14, detail, extensible=True),
         bande("net", "CORPS", 17, net, insecable=True),
         bande("mentions", "CORPS", 18, mentions, extensible=True),
         bande("cloture", "CORPS", 66, sig, insecable=True),
         bande("pied", "PIED_PAGE", 12, mentions_legales(L))],
        {"format": "A4", "orientation": "PORTRAIT", "marges": [15, 15, 12, 15]},
        {"formats": ["PDF"], "nom_fichier": '"Solde_tout_compte_" + identite.matricule', "eclatement": "collaborateur_id"},
        usages={"confidentialite": 4, "nb_exemplaires": 2})


def attestation_salaire_annuelle() -> dict:
    """RG-EDT-RH-03 : attestation de salaire de l'année (banques, administrations) : un document par salarié,
    une ligne par bulletin de l'année, totaux, objet et date au choix."""
    L = 180.0
    # le mois de la période (l'intitulé du calendrier peut être vide ou libre : « Paie Janvier »…)
    cols = [("mois", "Période", 44, 'FORMAT(SIVIDE(periode.date_fin, periode.date_debut), "MOIS_ANNEE")', None, "GAUCHE"),
            ("brut", "Salaire brut", 28, "total_brut", "MONTANT", "DROITE"),
            ("imp", "Brut imposable", 28, "total_brut_imposable", "MONTANT", "DROITE"),
            ("cot", "Cotisations", 26, "total_cot_salariale", "MONTANT", "DROITE"),
            ("net_imp", "Net imposable", 27, "net_imposable", "MONTANT", "DROITE"),
            ("net", "Net payé", 27, "net_a_payer", "MONTANT", "DROITE")]
    intro = riche("paragraphe", 0, 2, L, 30,
        "Nous soussignés, {societe.raison_sociale}, immatriculée à la CNSS sous le n° {SIVIDE(societe.numero_cnss, \"—\")}, attestons que "
        "{" + SALARIE + "}, titulaire de la CIN n° {SIVIDE(identite.cin, \"—\")}, matricule {identite.matricule}, employé(e) dans notre "
        "société depuis le {SI(ESTVIDE(contrat.date_embauche), \"……………\", FORMAT(contrat.date_embauche, \"DATE_LONGUE\"))} en qualité de "
        "{" + EMPLOI + "}, a perçu au titre de l'année {@annee} les rémunérations suivantes (en dirhams) :", taille=10)
    tete = _titre_doc('"Attestation de salaire — année " + @annee', '"Réf. : AS-" + @annee + "-" + identite.matricule')
    tete += [{**intro, "y": 26}] + entete_colonnes("c", cols, 58, L)
    total = totaux_colonnes("t", cols, "ETAT", 0, 7, BLANC, BLEU, '"Total de l\'année"', l_lib=44)
    total += [riche("usage", 0, 11, L, 12,
        "Soit un salaire net annuel de {FORMAT(TOTAL(net_a_payer, ETAT), \"MONTANT\")} dirhams. La présente attestation est délivrée "
        "à l'intéressé(e), sur sa demande, {SI(ESTVIDE(@objet_libre), SIVIDE(@objet, \"pour servir et valoir ce que de droit\"), @objet_libre)}.",
        taille=10)] + _signature(26)
    return definition(
        [{"code": "annee", "libelle": "Année", "type": "ANNEE"}, PARAM_COLLABS, PARAM_DATE_DOC,
         {"code": "objet", "libelle": "Objet", "type": "LISTE", "obligatoire": False, "valeurs": OBJETS_ATTESTATION,
          "defaut": '"' + OBJETS_ATTESTATION[0] + '"'},
         {"code": "objet_libre", "libelle": "Autre objet (remplace la liste)", "type": "TEXTE", "obligatoire": False}],
        [{"code": "b", "source": "BULLETIN", "role": "PRINCIPAL", "groupes": ["collaborateur_id"],
          "tri": [{"champ": "collaborateur_id"}, {"champ": "periode.date_fin"}, {"champ": "plan.code"}]}],
        [bande("en_tete", "EN_TETE_PAGE", 24, entete_societe(L, "Ressources humaines", '"Année " + @annee')),
         {**bande("tete", "EN_TETE_GROUPE", 67, tete), "niveau_groupe": 1},
         bande("detail", "CORPS", 5, ligne_valeurs("v", cols, taille=8.5)),
         bande("total", "PIED_ETAT", 72, total, insecable=True),
         bande("pied", "PIED_PAGE", 12, mentions_legales(L))],
        {"format": "A4", "orientation": "PORTRAIT", "marges": [15, 15, 12, 15]},
        {"formats": ["PDF"], "nom_fichier": '"Attestation_salaire_" + @annee + "_" + identite.matricule', "eclatement": "collaborateur_id"},
        usages={"confidentialite": 3, "duplicata": True})


def domiciliation_salaire() -> dict:
    """RG-EDT-RH-04 : attestation de domiciliation (virement irrévocable) du salaire, adressée à la banque du salarié :
    emploi, ancienneté, salaire net du mois choisi, compte, engagement de virer le solde de tout compte."""
    L = 180.0
    dest = [champ("dest_banque", 100, 0, 80, 6, 'SIVIDE(paiement.banque_libelle, "Banque ……………")', taille=10.5, gras=True),
            champ("dest_agence", 100, 6, 80, 5, 'SI(ESTVIDE(paiement.nom_agence), "Agence ……………", "Agence " + paiement.nom_agence)', taille=10),
            champ("objet", 0, 18, L, 6, '"Objet : domiciliation irrévocable de salaire — " + ' + SALARIE, taille=10, gras=True, couleur=BLEU)]
    corps_ = riche("lettre", 0, 2, L, 70,
        "Madame, Monsieur,\n\n"
        "Nous soussignés, {societe.raison_sociale}, attestons que {" + SALARIE + "}, titulaire de la CIN n° {SIVIDE(identite.cin, \"—\")}, "
        "matricule {identite.matricule}, est employé(e) au sein de notre société depuis le "
        "{SI(ESTVIDE(contrat.date_embauche), \"……………\", FORMAT(contrat.date_embauche, \"DATE_LONGUE\"))} en qualité de {" + EMPLOI + "}"
        "{SI(ESTVIDE(contrat.type_contrat_libelle), \"\", \", sous contrat \" + contrat.type_contrat_libelle)}, et qu'il (elle) perçoit un salaire "
        "mensuel net de {FORMAT(net_a_payer, \"MONTANT\")} dirhams ({MONTANT_EN_LETTRES(net_a_payer)}) (salaire de "
        "{FORMAT(@periode.date_fin, \"MOIS_ANNEE\")}).\n\n"
        "À sa demande, nous nous engageons à virer irrévocablement son salaire mensuel au compte n° "
        "{SIVIDE(paiement.numero_compte, \"……………………………\")} ouvert en vos livres, et à ne modifier cette domiciliation qu'après "
        "mainlevée écrite de votre part.\n\n"
        "En cas de cessation de ses fonctions, pour quelque cause que ce soit, nous nous engageons à vous en informer et à virer "
        "à ce même compte les sommes qui lui resteraient dues au titre de son solde de tout compte.\n\n"
        "Nous vous prions d'agréer, Madame, Monsieur, l'expression de nos salutations distinguées.", taille=10)
    sig = _signature(4, "Pour la société,", ("Lu et accepté, le salarié,", "Signature précédée de la mention « Lu et accepté »"))
    return definition(
        [PARAM_MOIS, PARAM_COLLABS, PARAM_DATE_DOC],
        [{"code": "b", "source": "BULLETIN", "role": "PRINCIPAL", "tri": [{"champ": "identite.nom"}, {"champ": "identite.prenom"}]}],
        [bande("en_tete", "EN_TETE_PAGE", 24, entete_societe(L, "Ressources humaines", '"Domiciliation de salaire"')),
         bande("destinataire", "CORPS", 26, dest),
         bande("texte", "CORPS", 74, [corps_], extensible=True),
         bande("cloture", "CORPS", 66, sig, insecable=True),
         bande("pied", "PIED_PAGE", 12, mentions_legales(L))],
        {"format": "A4", "orientation": "PORTRAIT", "marges": [15, 15, 12, 15]},
        {"formats": ["PDF"], "nom_fichier": '"Domiciliation_salaire_" + identite.matricule', "eclatement": "collaborateur_id"},
        usages={"confidentialite": 4})


def fiche_sortie() -> dict:
    """RG-EDT-RH-05 : fiche de sortie (document interne) : dates, ancienneté, motif, préavis, indemnités, congés,
    CNSS / AMO, documents remis et matériel restitué."""
    L = 180.0
    oui = lambda c: f'SI({c}, "Oui", "Non")'
    info = [*paires("ia", 0, 2, 38, 52, [
                ("Salarié", SALARIE), ("Matricule", "identite.matricule"), ("Emploi", EMPLOI),
                ("Affectation", 'SIVIDE(affectation.uo_chemin, SIVIDE(affectation.organisation_libelle, "—"))'),
                ("Catégorie", 'SIVIDE(qualification.categorie_professionnelle_libelle, "—")')], pas=5.5, taille=8.5),
            *paires("ib", 92, 2, 38, 50, [
                ("Embauche", 'SI(ESTVIDE(contrat.date_embauche), "—", FORMAT(contrat.date_embauche, "DATE_FR"))'),
                ("Sortie", 'FORMAT(depart.date_depart, "DATE_FR")'), ("Ancienneté", 'SIVIDE(depart.anciennete_texte, "—")'),
                ("Motif", 'SIVIDE(depart.motif_libelle, "—")'), ("Décision", 'SIVIDE(depart.reference_decision, "—")')], pas=5.5, taille=8.5)]

    def grille(id_, y, titre, lignes, largeur_val=40, masque=None):
        titre = titre or "Situation"
        g = {"id": id_, "type": "GRILLE", "x": 0, "y": y, "l": 120, "h": 6 + 5.5 * len(lignes), "largeur_titres": 80,
             "hauteur_ligne": 5.5, "quadrillage": "COMPLET", "style": {"taille": 8.5, "couleur_bordure": GRIS_CLAIR},
             "style_entete": {"gras": True, "couleur": BLANC, "fond": BLEU, "alignement": "CENTRE"}, "style_titres": {"couleur": BLEU},
             "colonnes": [{"id": "v", "titre": titre, "largeur": largeur_val, **({"affichage": {"masque": masque}} if masque else {}),
                           "style": {"alignement": "DROITE" if masque else "CENTRE"}}],
             "lignes": [{"id": f"{id_}_{k}", "titre": t, "valeurs": {"v": e}} for k, (t, e) in enumerate(lignes)]}
        return g
    preavis = grille("preavis", 2, "Préavis", [
        ("Durée (jours)", 'SIVIDE(depart.preavis_duree_jours, "—")'),
        ("Du", 'SI(ESTVIDE(depart.preavis_date_debut), "—", FORMAT(depart.preavis_date_debut, "DATE_FR"))'),
        ("Au", 'SI(ESTVIDE(depart.preavis_date_fin), "—", FORMAT(depart.preavis_date_fin, "DATE_FR"))'),
        ("Effectué", oui("depart.preavis_effectue")), ("Dispensé", oui("depart.preavis_dispense"))])
    indemn = grille("indemnites", 2, "Montant (DH)", [
        ("Indemnité de préavis (dispense)", "depart.preavis_dispense_indemnite"),
        ("Indemnité de licenciement / ancienneté", "depart.indemnite_anciennete"),
        ("Indemnité pour perte d'emploi", "depart.indemnite_perte_emploi"),
        ("Indemnité de départ à la retraite", "depart.indemnite_depart_retraite"),
        ("Indemnité de congés payés", "depart.indemnite_conges_payes"),
        ("Indemnité compensatrice", "depart.indemnite_compensatrice"),
        ("Indemnité transactionnelle", "depart.indemnite_transactionnelle"),
        ("13e mois au prorata", "depart.indemnite_13eme_mois"),
        ("Total des indemnités", "depart.indemnite_total")], masque="MONTANT_SANS_ZERO")
    social = grille("social", 2, "", [
        ("Solde de congés (jours)", 'SIVIDE(depart.solde_conges_jours, "—")'),
        ("Radiation CNSS", 'SI(ESTVIDE(depart.cnss_radiation_date), "—", FORMAT(depart.cnss_radiation_date, "DATE_FR"))'),
        ("Dernière déclaration CNSS", 'SIVIDE(depart.cnss_derniere_declaration, "—")'),
        ("Clôture AMO", 'SI(ESTVIDE(depart.amo_cloture_date), "—", FORMAT(depart.amo_cloture_date, "DATE_FR"))'),
        ("Net du bulletin de sortie", 'SI(ESTVIDE(bulletin_id), "—", FORMAT(net_a_payer, "MONTANT") + " (" + SIVIDE(bulletin_periode, "") + ")")')])
    docs = grille("documents", 2, "", [(t, oui(f"depart.{c}")) for c, t in (
        ("doc_attestation_travail", "Certificat de travail remis"), ("doc_recu_stc", "Reçu pour solde de tout compte signé"),
        ("doc_radiation_cnss", "Radiation CNSS remise"), ("doc_attestation_amo", "Attestation AMO remise"),
        ("doc_certificat_conges", "Certificat de congés remis"), ("materiel_badge_restitue", "Badge restitué"),
        ("materiel_ordinateur_restitue", "Ordinateur restitué"), ("materiel_telephone_restitue", "Téléphone restitué"),
        ("materiel_vehicule_restitue", "Véhicule restitué"), ("acces_si_desactive", "Accès SI désactivés"),
        ("acces_email_desactive", "Messagerie désactivée"))])
    def bloc(id_, titre, g):
        return bande(id_, "CORPS", g["h"] + 10, [texte(f"{id_}_t", 0, 1, L, 5, titre, taille=9.5, gras=True, couleur=BLEU),
                                                  {**g, "y": 7}], insecable=True)
    return definition(
        [PARAM_MOIS_SORTIE, PARAM_COLLABS],
        [{"code": "d", "source": "DEPART", "role": "PRINCIPAL", "tri": [{"champ": "identite.nom"}, {"champ": "identite.prenom"}]}],
        [bande("en_tete", "EN_TETE_PAGE", 24, entete_societe(L, "Fiche de sortie", '"Sortie le " + FORMAT(depart.date_depart, "DATE_FR")')),
         bande("identite", "CORPS", 32, info),
         bloc("b_preavis", "Préavis", preavis), bloc("b_indemnites", "Indemnités de fin de contrat", indemn),
         bloc("b_social", "Congés, CNSS et AMO", social), bloc("b_documents", "Documents remis, matériel et accès", docs),
         bande("pied", "PIED_PAGE", 8, pied_page(L, "Fiche de sortie — document interne"))],
        {"format": "A4", "orientation": "PORTRAIT", "marges": [12, 15, 10, 15]},
        {"formats": ["PDF"], "nom_fichier": '"Fiche_sortie_" + identite.matricule', "eclatement": "collaborateur_id"},
        usages={"confidentialite": 4})


# RG-EDT-EXERCICE-03 (Adil DAIA) : rien n'est figé dans la mise en forme du récapitulatif. Tout ce qu'il
# imprime vient du paramétrage (onglet Données) : rubriques dans les corps « Activité » et
# « Récapitulatif », synthèse de l'exercice dans le corps à cases « Synthèse » (cartes du bas), fiche
# du salarié dans les Variables. La mise en forme ne fait que placer corps.… et var.… ; la bande
# « Activité » s'imprime dès que son corps a une valeur.
RECAP_VARIABLES = [
    ("salarie", "Nom du salarié", 'SIVIDE(identite.civilite, "") + " " + MAJUSCULE(identite.nom) + " " + identite.prenom'),
    ("matricule", "Matricule", "identite.matricule"),
    ("emploi", "Emploi", 'SIVIDE(affectation.emploi_libelle, "—")'),
    ("affectation", "Affectation", 'SIVIDE(affectation.uo_chemin, SIVIDE(affectation.organisation_libelle, "—"))'),
    ("categorie", "Catégorie", 'SIVIDE(qualification.categorie_professionnelle_libelle, SIVIDE(qualification.classification_libelle, "—"))'),
    ("entree", "Entrée le", 'SI(ESTVIDE(contrat.date_embauche), "—", FORMAT(contrat.date_embauche, "DATE_FR"))'),
    ("cin_cnss", "CIN / CNSS", 'SIVIDE(identite.cin, "—") + " / " + SIVIDE(identite.num_cnss, "—")'),
    ("mois_payes", "Mois payés", 'exercice.mois_payes + " (" + exercice.nb_bulletins + " bulletin(s))"'),
]
# (colonne du corps « Synthèse », libellé de la carte, affectation : rubrique + attribut, ou formule)
# RG-EDT-EXERCICE-03 : les cartes lisent des RUBRIQUES (montant de l'exercice), comme les autres corps
RECAP_SYNTHESE = [
    ("brut", "Salaire brut de l'exercice", {"rubrique": "TOTAL_BRUT", "attribut": "MT"}),
    ("net_imposable", "Net imposable de l'exercice", {"rubrique": "NET_IMPOSABLE", "attribut": "MT"}),
    ("ir", "IR retenu de l'exercice", {"rubrique": "RET_IR", "attribut": "MT"}),
    ("net", "Net payé de l'exercice", {"rubrique": "NET_A_PAYER", "attribut": "MT"}),
    ("cout", "Coût employeur de l'exercice", {"rubrique": "COUT_EMPLOYEUR", "attribut": "MT"}),
]
ANCIENNES_FORMULES_SYNTHESE = {"total_brut", "net_imposable", "net_a_payer", "cout_employeur"}


def code_section(libelle: str, pris: set) -> str:
    import re
    import unicodedata
    t = unicodedata.normalize("NFKD", libelle or "").encode("ascii", "ignore").decode().lower()
    base = re.sub(r"[^a-z0-9]+", "_", t).strip("_")[:30] or "section"
    if not base[0].isalpha():
        base = "s_" + base
    code, n = base, 1
    while code in pris:
        n += 1
        code = f"{base}_{n}"
    pris.add(code)
    return code


def groupes_en_sections(c: dict) -> dict:
    """RG-EDT-SECTION-01 : les anciens « groupes » (texte libre par rubrique) deviennent les sections du corps,
    dans l'ordre de première apparition ; chaque rubrique est rangée dans la sienne."""
    if c.get("nature") == "CASES":
        return c
    sections = c.setdefault("sections", [])
    par_libelle = {x["libelle"]: x["code"] for x in sections}
    pris = set(par_libelle.values())
    for a in c.get("affectations", []):
        g = (a.get("groupe") or "").strip()
        if not g or a.get("section"):
            continue
        if g not in par_libelle:
            par_libelle[g] = code_section(g, pris)
            sections.append({"code": par_libelle[g], "libelle": g})
        a["section"] = par_libelle[g]
        a.pop("groupe", None)
    if not sections:
        c.pop("sections", None)
    return c


def transposer_recapitulatif(d: dict) -> dict:
    """Passe un bulletin récapitulatif (modèle livré ou copie) en « tout paramétrage » ; sans effet s'il l'est déjà.
    Les identifiants des éléments du modèle livré servent de repères : une copie retouchée garde ses rubriques,
    ses libellés et sa mise en page, seules les valeurs écrites en dur sont remplacées."""
    variables = d.setdefault("variables", [])
    vus = {v["code"] for v in variables}
    anciennes = {}
    for code, lib, expr in RECAP_VARIABLES:
        anciennes[expr] = f"var.{code}"
        if code not in vus:
            variables.append({"code": code, "libelle": lib, "type": "TEXTE", "valeur": expr})
    corps = d.setdefault("corps", [])
    for c in corps:
        groupes_en_sections(c)
    for c in corps:                                    # cartes passées en formules par une 1re transposition
        if c["code"] == "synthese":
            for a in c.get("affectations", []):
                if a.get("formule") in ANCIENNES_FORMULES_SYNTHESE:
                    col = (a.get("cibles") or {}).get("VAL", "")
                    ref = next((x for x in RECAP_SYNTHESE if f"exercice.{x[0]}" == col), None)
                    if ref and "rubrique" in ref[2]:
                        a.pop("formule")
                        a["rubrique"] = ref[2]["rubrique"]
                        a["cibles"] = {ref[2]["attribut"]: col}
    if not any(c["code"] == "synthese" for c in corps):
        affectations = []
        for col_code, _lib, a in RECAP_SYNTHESE:
            if "formule" in a:
                affectations.append({"formule": a["formule"], "cibles": {"VAL": f"exercice.{col_code}"}, "libelle": _lib})
            else:
                affectations.append({"rubrique": a["rubrique"], "cibles": {a["attribut"]: f"exercice.{col_code}"}, "libelle": _lib})
        corps.append({"code": "synthese", "libelle": "Synthèse de l'exercice (cartes)", "nature": "CASES",
                      "emplacement": "MASQUE",          # imprimé par les cartes du pied (formules corps.synthese…)
                      "colonnes": [{"code": c, "libelle": lib, "type": "MONTANT", "masque": "MONTANT"} for c, lib, _ in RECAP_SYNTHESE],
                      "lignes": [{"code": "exercice", "libelle": "Exercice"}], "affectations": affectations})
    cartes = {f"k{k}_v": f"corps.synthese.exercice.{c}" for k, (c, _l, _a) in enumerate(RECAP_SYNTHESE)}
    for b in d.get("bandes", []):
        if b.get("id") == "activite" and "[NBJTRV]" in (b.get("condition") or ""):
            b["condition"] = 'TOTAL_CORPS("activite", "total") <> 0'
        for el in b.get("elements", []):
            v = el.get("valeur")
            if el.get("id") in cartes and isinstance(v, str) and not v.startswith("corps."):
                el["valeur"] = cartes[el["id"]]
            elif el.get("id") == "qr" and isinstance(v, str):
                el["valeur"] = v.replace('FORMAT(net_a_payer, "MONTANT")', 'FORMAT(corps.synthese.exercice.net, "MONTANT")')
            elif isinstance(v, str) and v in anciennes:
                el["valeur"] = anciennes[v]
            elif el.get("id") == "sal_mat" and v == '"Matricule " + identite.matricule':
                el["valeur"] = '"Matricule " + var.matricule'
    return d


# =============================================================================
# BULLETINS : TOUT LE CALCUL DANS DES CORPS (RG-EDT-BULLETIN-CORPS-01)
# =============================================================================
from app.editions import bulletins as _bul  # noqa: E402

COLONNES_LIGNES_BULLETIN = {
    'SI(sens = "GAIN", montant)': "gain", 'SI(sens = "RETENUE", montant)': "retenue",
    "montant_patronal": "patronal", "taux_patronal": "taux_patronal",
    'SI(sens = "RETENUE", 0 - montant, montant)': "SIVIDE(gain, 0) - SIVIDE(retenue, 0)",
}
PARTS_BULLETIN = {f"SI(SIVIDE(cout_employeur, 0) = 0, 0, {champ} / cout_employeur * 100)": f"corps.totaux.part.{code}"
                  for code, _l, _r, champ in _bul.TOTAUX if code in _bul.PARTS}


def _vers_corps(v: str) -> str:
    """Champs de paie du bulletin → cases du corps « Totaux » (mois ou cumul)."""
    if v in PARTS_BULLETIN:
        return PARTS_BULLETIN[v]
    for code, _l, _r, champ in _bul.TOTAUX:
        v = re.sub(rf"(?<![\w.@])cumul\.{champ}\b", f"corps.totaux.cumul.{code}", v)
    for code, _l, _r, champ in _bul.TOTAUX:
        v = re.sub(rf"(?<![\w.@]){champ}\b", f"corps.totaux.mois.{code}", v)
    return v


def transposer_bulletin(d: dict) -> dict:
    """Bulletin (livré ou copie) → corps « Rubriques » et « Totaux » ; idempotent. Les lignes du bulletin ne sont
    plus lues directement (jeu « lignes ») : le tableau imprime le corps, les totaux lisent corps.totaux.…"""
    corps = d.setdefault("corps", [])
    jeux_lignes = {j["code"] for j in d.get("jeux", []) if j.get("source") == "BULLETIN_LIGNE"}
    if not any(c["code"] == _bul.CORPS_RUBRIQUES for c in corps):
        corps.append(_bul.corps_rubriques())
    if not any(c["code"] == _bul.CORPS_TOTAUX for c in corps):
        corps.append(_bul.corps_totaux())

    def expr(v):
        return _vers_corps(v) if isinstance(v, str) else v
    for b in d.get("bandes", []):
        if b.get("condition"):
            b["condition"] = expr(b["condition"])
        for el in b.get("elements", []):
            if el.get("type") == "TABLEAU" and el.get("jeu") in jeux_lignes:
                el["jeu"], el["corps"] = "", _bul.CORPS_RUBRIQUES
                el.pop("sections", None)                   # filtres sur le sens → sections du corps
                el.pop("section_autres", None)
                for c in el["colonnes"]:
                    c["valeur"] = COLONNES_LIGNES_BULLETIN.get(c["valeur"], c["valeur"])
                continue
            if "valeur" in el:
                el["valeur"] = expr(el["valeur"])
            if isinstance(el.get("condition"), dict) and el["condition"].get("expression"):
                el["condition"]["expression"] = expr(el["condition"]["expression"])
            for l in el.get("lignes", []) if el.get("type") == "GRILLE" else []:
                l["valeurs"] = {k: expr(v) for k, v in (l.get("valeurs") or {}).items()}
    d["jeux"] = [j for j in d.get("jeux", []) if j["code"] not in jeux_lignes]
    return d


MODELES = {
    "journal_paie.json": journal_paie,
    "ordre_virement.json": ordre_virement,
    "attestation_travail_salaire.json": attestation,
    "notification_remuneration.json": notification,
    "etat_cotisations.json": cotisations,
    "fiche_synthese_annuelle.json": fiche_synthese,
    "bulletin_detaille.json": bulletin_detaille,
    "bulletin_moderne.json": bulletin_moderne,
    "bulletin_formulaire.json": bulletin_formulaire,
    "etat_ecarts.json": etat_ecarts,
    "controle_anomalies.json": controle_anomalies,
    "controle_ir.json": controle_ir,
    "masse_salariale.json": masse_salariale,
    "masse_salariale_collaborateurs.json": masse_par_collaborateur,
    "emargement.json": emargement,
    "ecarts_rubriques.json": ecarts_rubriques,
    "controle_deux_periodes.json": controle_deux_periodes,
    "comparatif_rubriques.json": comparatif_rubriques,
    "bulletin_recapitulatif.json": bulletin_recapitulatif,
    "certificat_travail.json": certificat_travail,
    "recu_solde_tout_compte.json": recu_solde_tout_compte,
    "attestation_salaire_annuelle.json": attestation_salaire_annuelle,
    "domiciliation_salaire.json": domiciliation_salaire,
    "fiche_sortie.json": fiche_sortie,
}

if __name__ == "__main__":
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from app.editions.definition import Definition
    for nom, fn in MODELES.items():
        brut = fn()
        if nom.startswith("bulletin_") and nom != "bulletin_recapitulatif.json":
            transposer_bulletin(brut)                          # RG-EDT-BULLETIN-CORPS-01
        for c in brut.get("corps", []):                      # RG-EDT-SECTION-01 : groupes → sections du corps
            groupes_en_sections(c)
        d = Definition.model_validate(brut)                    # validation stricte avant d'écrire
        (DOSSIER / nom).write_text(json.dumps(d.model_dump(mode="json", exclude_defaults=True), ensure_ascii=False, indent=1),
                                   encoding="utf-8")
        print("écrit", nom)
    # bulletin classique : fichier livré écrit à la main, passé en corps lui aussi (RG-EDT-BULLETIN-CORPS-01)
    classique = DOSSIER / "bulletin_classique.json"
    brut = transposer_bulletin(json.loads(classique.read_text(encoding="utf-8")))
    Definition.model_validate(brut)
    classique.write_text(json.dumps(brut, ensure_ascii=False, indent=1), encoding="utf-8")
    print("écrit bulletin_classique.json (corps)")
