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
Les montants passent par les champs totaux du bulletin : aucun code de rubrique propre à un
client n'est supposé.
"""
from __future__ import annotations

import json
from pathlib import Path

DOSSIER = Path(__file__).resolve().parents[2] / "app" / "editions" / "modeles_systeme"

BLEU, BLEU_CLAIR, GRIS, GRIS_CLAIR, BLANC = "#0E3D5C", "#E8F1F5", "#6B7C88", "#D5DEE3", "#FFFFFF"
PARAM_PERIODE = {"code": "periode", "libelle": "Période", "type": "PERIODE"}
PARAM_COLLABS = {"code": "collaborateurs", "libelle": "Collaborateurs", "type": "COLLABORATEUR",
                 "obligatoire": False, "multiple": True}
PARAM_PLAN = {"code": "plan_paie", "libelle": "Plan de paie", "type": "PLAN_PAIE", "obligatoire": False}
MOIS = 'FORMAT(@periode.date_fin, "MOIS_ANNEE")'


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
# 1. JOURNAL — Journal de paie
# =============================================================================
def journal_paie() -> dict:
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
        [PARAM_PERIODE, PARAM_PLAN, PARAM_COLLABS],
        [{"code": "b", "source": "BULLETIN", "role": "PRINCIPAL", "filtres": ["periode_id = @periode.id"],
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
        [PARAM_PERIODE, PARAM_PLAN, PARAM_COLLABS],
        [{"code": "b", "source": "BULLETIN", "role": "PRINCIPAL",
          "filtres": ["periode_id = @periode.id", "net_a_payer > 0"],
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
              "{SI(ESTVIDE(contrat.code_type_contrat), \"\", \", sous contrat \" + contrat.code_type_contrat)}.\n\n"
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
    return definition(
        [PARAM_PERIODE, PARAM_COLLABS],
        [{"code": "b", "source": "BULLETIN", "role": "PRINCIPAL", "filtres": ["periode_id = @periode.id"],
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
        champ("dest_ville", 100, 56, 80, 5, 'SIVIDE(adresse.code_postal, "") + " " + MAJUSCULE(SIVIDE(adresse.code_ville, ""))',
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
        [PARAM_PERIODE, PARAM_COLLABS],
        [{"code": "b", "source": "BULLETIN", "role": "PRINCIPAL", "filtres": ["periode_id = @periode.id"],
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
        [PARAM_PERIODE, PARAM_PLAN, PARAM_COLLABS],
        [{"code": "b", "source": "BULLETIN", "role": "PRINCIPAL", "filtres": ["periode_id = @periode.id"],
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
             ("Contrat", 'SIVIDE(contrat.code_type_contrat, "—") + SI(ESTVIDE(contrat.code_temps), "", " · " + contrat.code_temps)'),
             ("Situation familiale", 'SIVIDE(situation_familiale.libelle, "—") + " · " + SIVIDE(situation_familiale.nb_enfants_a_charge, 0) + " enfant(s)"'),
             ("Catégorie", 'SIVIDE(qualification.classification_libelle, SIVIDE(qualification.code_categorie_professionnelle, "—"))'),
             ("N° CNSS", 'SIVIDE(identite.num_cnss, "—")'),
             ("Ancienneté", 'SI(ESTVIDE(contrat.date_embauche), "—", ANNEES(@periode.date_fin, contrat.date_embauche) + " an(s)")')]
    for i, (lib, expr) in enumerate(infos):
        col, rang = i % 2, i // 2
        x = 3 + col * 90
        y = 29 + rang * 7
        identite += [texte(f"i_l{i}", x, y, 30, 6, lib, taille=7.5, couleur=GRIS),
                     champ(f"i_v{i}", x + 30, y, 56, 6, expr, taille=8.5, gras=True)]
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
        [PARAM_PERIODE, PARAM_COLLABS],
        [{"code": "b", "source": "BULLETIN", "role": "PRINCIPAL", "filtres": ["periode_id = @periode.id"],
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
JEU_BULLETIN = {"code": "b", "source": "BULLETIN", "role": "PRINCIPAL", "filtres": ["periode_id = @periode.id"],
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
            ("Catégorie", 'SIVIDE(qualification.classification_libelle, SIVIDE(qualification.code_categorie_professionnelle, "—"))'),
            ("Entrée le", 'SI(ESTVIDE(contrat.date_embauche), "—", FORMAT(contrat.date_embauche, "DATE_FR"))'),
            ("Ancienneté", ANCIENNETE),
            ("Contrat", 'SIVIDE(contrat.code_type_contrat, "—")'),
            ("Organisation", 'SIVIDE(affectation.organisation_libelle, "—")')], pas=4.5, taille=7.5),
        *paires("sb", 137, 27.5, 21, 31, [
            ("CIN", 'SIVIDE(identite.cin, "—")'), ("N° CNSS", 'SIVIDE(identite.num_cnss, "—")'),
            ("N° AMO", 'SIVIDE(identite.num_amo, "—")'),
            ("Sit. familiale", 'SIVIDE(situation_familiale.libelle, "—")'),
            ("Enfants", 'SIVIDE(situation_familiale.nb_enfants_a_charge, 0) + " à charge"'),
            ("Déductions", 'SIVIDE(situation_familiale.nb_deductions_fiscales, 0) + " personne(s)"')], pas=4.5, taille=7.5),
    ]
    colonnes = [
        col("lib", "Désignation", 54, "libelle"),
        col("code", "Code", 11, "code_rubrique", taille=6, couleur=GRIS),
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
        champ("p_cnss", 0, 6, 150, 4, '"Cotisations versées à la CNSS sous le n° d\'affiliation " + SIVIDE(societe.numero_cnss, "—")'
                                      ' + " — en cas de litige, adressez-vous à l\'inspection du travail."', taille=6.5, couleur=GRIS),
        champ("p_page", 150, 2, 40, 4, '"Page " + PAGE() + " / " + NB_PAGES()', taille=6.5, couleur=GRIS, alignement="DROITE"),
    ]
    return definition(
        [PARAM_PERIODE, PARAM_PLAN, PARAM_COLLABS], [JEU_BULLETIN, JEU_LIGNES],
        [bande("en_tete", "EN_TETE_PAGE", 58, en_tete),
         bande("detail", "CORPS", 60, corps),
         bande("cumuls", "CORPS", 26, bas, insecable=True),
         bande("pied", "PIED_PAGE", 11, pied)],
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
        *paires("pay", XD, 145, 20, LD - 20, [("Paiement", 'SIVIDE(paiement.mode_libelle, "—")'),
                                             ("Banque", 'SIVIDE(paiement.banque_libelle, "—")'), ("Compte", RIB_MASQUE)], pas=4.5, taille=7),
        cadre("sig_c", XD, 160, LD, 26, couleur=GRIS_CLAIR, arrondi=1.5),
        texte("sig_t", XD + 2, 161, LD - 4, 4, "Reçu, lu et approuvé — signature du salarié", taille=6.5, italique=True, couleur=GRIS),
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
}

if __name__ == "__main__":
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from app.editions.definition import Definition
    for nom, fn in MODELES.items():
        d = Definition.model_validate(fn())                    # validation stricte avant d'écrire
        (DOSSIER / nom).write_text(json.dumps(d.model_dump(mode="json", exclude_defaults=True), ensure_ascii=False, indent=1),
                                   encoding="utf-8")
        print("écrit", nom)
