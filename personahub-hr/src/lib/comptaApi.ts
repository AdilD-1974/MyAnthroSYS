// src/lib/comptaApi.ts
//
// Module API du sous-module de comptabilisation de la paie.
//
// ⚠️ CORRECTIF : la version précédente importait un "./apiClient" inventé
// (api.get(path, {params}) etc.) qui n'existe pas dans ce projet. Le vrai
// client est "./api" (api.get/post/patch/put/delete sans options, qs() pour
// construire les query strings, db.list/create/update/remove pour le proxy
// générique PostgREST-like). Ce fichier est réécrit contre ce vrai client.
//
// API_BASE (dans api.ts) vaut déjà ".../api/v1" : tous les chemins ci-dessous
// sont donc relatifs à /api/v1, PAS préfixés par /api/v1 une deuxième fois.
// Le routeur backend, lui, est bien monté sur /api/v1/paie/compta/... (cf.
// app/routers/compta_paie.py, prefix="/api/v1/paie/compta") — les deux se
// rejoignent correctement.

import { api, db, qs, tokenStore, API_BASE } from "./api";

export type ModeGeneration = "GLOBAL" | "NOMINATIF";
export type StatutLot = "BROUILLON" | "GENERE" | "EXPORTE" | "COMPTABILISE";

export interface CollaborateurEcart {
  collaborateur_id: string;
  matricule: string;
  nom_complet: string;
  motif: string;
}

export interface ControleEffectif {
  plan_paie_id: string;
  periode_id: string;
  effectif_attendu: number;
  effectif_valide: number;
  ok: boolean;
  ecarts: CollaborateurEcart[];
}

export interface Lot {
  id: string;
  plan_paie_id: string;
  periode_id: string;
  mode_generation: ModeGeneration;
  statut: StatutLot;
  journal_code: string;
  date_ecriture: string | null;
  numero_piece: string | null;
  numero_generation: number;
  effectif_attendu: number | null;
  effectif_valide: number | null;
  controle_ok: boolean | null;
  force_par: string | null;
  motif_forcage: string | null;
  total_debit: number | null;
  total_credit: number | null;
  nb_lignes_exclues: number;
  genere_le: string | null;
  genere_par: string | null;
  genere_par_nom: string | null;
  genere_par_matricule: string | null;
  // Option A (05/08) : tampon date/auteur de comptabilisation sur le lot,
  // pas de statut par écriture. comptabilise_generation fige le
  // numero_generation courant au moment de la comptabilisation, pour
  // détecter un décalage si le lot est régénéré après coup.
  comptabilise_le: string | null;
  comptabilise_par: string | null;
  comptabilise_generation: number | null;
}

export interface GenerationHistorique {
  numero_generation: number;
  genere_le: string;
  genere_par: string | null;
  genere_par_nom: string | null;
  genere_par_matricule: string | null;
  effectif_attendu: number | null;
  effectif_valide: number | null;
  controle_ok: boolean | null;
  force_par: string | null;
  motif_forcage: string | null;
  total_debit: number | null;
  total_credit: number | null;
  nb_lignes_exclues: number | null;
}

export interface FormatExport {
  code: string;
  libelle: string;
  description: string | null;
}

export interface RubriqueSansImputation {
  rubrique_paie_code: string;
  libelle: string;
  categorie: string; // ASS / CALC / COT (code_type réel, corrigé le 05/08)
  montant_salarial: number | null; // null si appelé sans plan_paie_id/periode_id
  montant_patronal: number | null;
}

export interface AnomalieLigne {
  bulletin_id: string;
  rubrique_paie_code: string;
  montant: number;
  motif: string;
}

export interface AnomalieParametrage {
  bulletin_id: string;
  rubrique_paie_code: string;
  compte: string;
  sens: "D" | "C";
  axe_analytique: string | null;
  motif: string;
}

export interface EcartCollaborateurAxe {
  collaborateur_id: string;
  matricule: string;
  nom_complet: string;
  total_debit: number;
  total_credit: number;
}

export interface EcartAxe {
  axe_analytique: string | null;
  total_debit: number;
  total_credit: number;
  collaborateurs: EcartCollaborateurAxe[];
}

// Ligne brute (non persistée) — présente uniquement quand la génération est
// en déséquilibre, pour permettre un groupement compte -> rubrique ->
// matricule côté écran en plus de la ventilation par axe (05/08).
export interface LigneBrute {
  compte: string;
  sens: "D" | "C";
  montant: number;
  rubrique_paie_code: string;
  part: string;
  axe_analytique: string | null;
  collaborateur_id: string;
  matricule: string | null;
  nom_complet: string | null;
}

// Réponse de POST /lots/{id}/generer : soit `lot` rempli (succès), soit
// `desequilibre` rempli (débit ≠ crédit, ventilé par axe puis collaborateur
// — rien n'est persisté côté serveur dans ce cas). `lignes_brutes` accompagne
// `desequilibre` pour le groupement compte -> rubrique -> matricule.
export interface GenererLotResult {
  lot: Lot | null;
  desequilibre: EcartAxe[] | null;
  lignes_brutes?: LigneBrute[] | null;
}

// Lot enrichi des libellés plan/période — pas de colonnes de ce genre sur
// lot_ecriture_paie (seulement plan_paie_id/periode_id), jointure faite ici
// côté client via le proxy générique /api/v1/db/... (même mécanisme que
// GenerationEcrituresPage.tsx pour plan_paie/calendrier_paie), pas un nouvel
// endpoint FastAPI dédié.
export interface LotAvecLibelles extends Lot {
  plan_paie_code: string;
  annee: number | null;
  numero_periode: number | null;
  periode_intitule: string | null;
}

// Lignes persistées d'un lot GENERE/EXPORTE/COMPTABILISE, lues via le proxy
// générique /db (ecriture_ligne en mode GLOBAL, ecriture_ligne_detail en
// NOMINATIF) — pour la balance Compte -> Rubrique -> Matricule consultable
// directement sur l'écran de génération et, plus tard, sur VueComptabilitePage.tsx
// (05/08). Filtrage lot_id ET numero_generation faits CÔTÉ CLIENT en plus du
// filtre serveur : constaté peu fiable seul (une génération antérieure ou un
// autre lot pouvait se mélanger sans ce filtrage défensif).
export interface EcritureLigneBrute {
  lot_id: string;
  compte: string;
  sens: "D" | "C";
  montant: number;
  axe_analytique: string | null;
  numero_generation: number;
}

export interface EcritureLigneDetailBrute extends EcritureLigneBrute {
  rubrique_paie_code: string;
  matricule_agent: string | null;
  collaborateur_id: string | null;
}

// Ligne prête à afficher : libellés de compte/rubrique résolus, montant
// éclaté en deux colonnes Débit/Crédit.
export interface EcritureAffichage {
  compte: string;
  compte_libelle: string;
  montant_debit: number;
  montant_credit: number;
  axe_analytique: string | null;
  axe_libelle: string | null;
  rubrique_paie_code: string | null;
  rubrique_libelle: string | null;
  matricule: string | null;
  collaborateur_nom: string | null;
}

export interface DetailEcrituresLot {
  nominatif: boolean;
  lignes: EcritureAffichage[];
}

// Historique des exports d'un lot — table export_ecriture_paie (id, lot_id,
// format_code, exporte_le, exporte_par, nom_fichier), confirmée le 04/08.
export interface ExportHistorique {
  id: string;
  lot_id: string;
  format_code: string;
  exporte_le: string;
  exporte_par: string;
  exporte_par_nom: string | null;
  exporte_par_matricule: string | null;
  nom_fichier: string;
}

const BASE = "/paie/compta";

export const comptaApi = {
  controlerEffectif: (planPaieId: string, periodeId: string) =>
    api.get<ControleEffectif>(`${BASE}/controle-effectif${qs({ plan_paie_id: planPaieId, periode_id: periodeId })}`),

  creerLot: (payload: {
    plan_paie_id: string;
    periode_id: string;
    mode_generation: ModeGeneration;
    journal_code?: string;
    date_ecriture?: string;
    numero_piece?: string;
  }) => api.post<Lot>(`${BASE}/lots`, payload),

  // Relit un lot existant sans en créer un nouveau — à utiliser pour tout
  // rafraîchissement de statut après une action serveur (génération, export).
  // ⚠️ Ne JAMAIS appeler creerLot() à des fins de rafraîchissement : chaque
  // appel insère une nouvelle ligne (cf. GenerationEcrituresPage.handleExporter,
  // corrigé pour utiliser obtenirLot à la place).
  obtenirLot: (lotId: string) => api.get<Lot>(`${BASE}/lots/${lotId}`),

  // Historique des exports d'un lot — table export_ecriture_paie, pas
  // paie_historique (conçue pour tracer les transitions de statut PAR
  // BULLETIN, pas par lot).
  listerHistoriqueExports: (lotId: string) =>
    db.list<ExportHistorique>("export_ecriture_paie", {
      lot_id: lotId,
      select: "*",
      order: "exporte_le.desc",
    }),

  // Réservé aux lots EXPORTE — le backend refuse (409) pour tout autre
  // statut, cf. comptabiliser_lot() dans compta_paie.py.
  comptabiliserLot: (lotId: string) => api.post<Lot>(`${BASE}/lots/${lotId}/comptabiliser`, {}),

  // Réservé aux lots BROUILLON — le backend refuse (409) pour tout autre
  // statut, cf. supprimer_lot() dans compta_paie.py.
  supprimerLot: (lotId: string) => api.delete<void>(`${BASE}/lots/${lotId}`),

  // Tous les lots, enrichis des libellés plan/période. Jointure côté client
  // (voir LotAvecLibelles) : trois lectures via le proxy générique, jamais
  // plus de 3 - pas de N+1, plan_paie et calendrier_paie sont chacun chargés
  // une seule fois puis indexés par id avant la jointure.
  async listerLots(): Promise<LotAvecLibelles[]> {
    const [lots, plans, periodes] = await Promise.all([
      db.list<Lot>("lot_ecriture_paie", { select: "*" }),
      db.list<{ id: string; code: string }>("plan_paie", { select: "id,code" }),
      db.list<{ id: string; annee: number; numero_periode: number; intitule: string | null }>(
        "calendrier_paie", { select: "id,annee,numero_periode,intitule" }
      ),
    ]);
    const planParId = new Map(plans.map((p) => [p.id, p.code]));
    const periodeParId = new Map(periodes.map((p) => [p.id, p]));
    return lots.map((l) => {
      const periode = periodeParId.get(l.periode_id);
      return {
        ...l,
        plan_paie_code: planParId.get(l.plan_paie_id) ?? "—",
        annee: periode?.annee ?? null,
        numero_periode: periode?.numero_periode ?? null,
        periode_intitule: periode?.intitule ?? null,
      };
    });
  },

  listerGenerations: (lotId: string) =>
    api.get<GenerationHistorique[]>(`${BASE}/lots/${lotId}/generations`),

  genererLot: (lotId: string, forcer = false, motifForcage?: string) =>
    api.post<GenererLotResult>(`${BASE}/lots/${lotId}/generer`, { forcer, motif_forcage: motifForcage }),

  listerAnomalies: (lotId: string) =>
    api.get<AnomalieLigne[]>(`${BASE}/lots/${lotId}/anomalies`),

  // Cohérence axe analytique / nature de compte (ref_imputation_comptable,
  // 01/08) — jamais bloquant, signal de paramétrage à corriger.
  listerAnomaliesParametrage: (lotId: string) =>
    api.get<AnomalieParametrage[]>(`${BASE}/lots/${lotId}/anomalies-parametrage`),

  listerFormats: () => api.get<FormatExport[]>(`${BASE}/formats`),

  // Sans arguments : comportement legacy (toutes les rubriques sans
  // imputation, montants=null). Avec planPaieId+periodeId (05/08) : ne
  // renvoie que celles ayant un montant réel sur cette période, triées par
  // montant décroissant côté backend. Avec collaborateurId en plus :
  // restreint aux lignes de ce seul collaborateur (bouton du relevé).
  imputationsManquantes: (planPaieId?: string, periodeId?: string, collaborateurId?: string) =>
    api.get<RubriqueSansImputation[]>(
      `${BASE}/imputations/manquantes${
        planPaieId && periodeId
          ? qs({ plan_paie_id: planPaieId, periode_id: periodeId, ...(collaborateurId ? { collaborateur_id: collaborateurId } : {}) })
          : ""
      }`
    ),

  // Détail persisté d'un lot déjà généré (Compte -> Rubrique -> Matricule),
  // pour la balance consultable sur l'écran de génération et, plus tard,
  // VueComptabilitePage.tsx (05/08). Ne s'appelle qu'une fois le lot GENERE
  // (sinon rien n'est encore persisté — utiliser lignes_brutes/desequilibre
  // de genererLot() pour l'état BROUILLON en déséquilibre).
  async listerEcritures(lotId: string, modeGeneration: ModeGeneration, numeroGeneration: number): Promise<DetailEcrituresLot> {
    const nominatif = modeGeneration === "NOMINATIF";

    const [lignesBrutes, imputations, rubriques, collaborateurs, uos] = await Promise.all([
      nominatif
        ? db.list<EcritureLigneDetailBrute>("ecriture_ligne_detail", { lot_id: lotId, select: "*" })
        : db.list<EcritureLigneBrute>("ecriture_ligne", { lot_id: lotId, select: "*" }),
      db.list<{ code_compte: string; intitule_compte: string }>("ref_imputation_comptable", {
        actif: true,
        select: "code_compte,intitule_compte",
      }).catch(() => []),
      nominatif
        ? db.list<{ code: string; libelle: string }>("rubrique_paie", { select: "code,libelle" }).catch(() => [])
        : Promise.resolve([] as { code: string; libelle: string }[]),
      nominatif
        ? db.list<{ id: string; nom: string; prenom: string }>("collaborateurs", { select: "id,nom,prenom" }).catch(() => [])
        : Promise.resolve([] as { id: string; nom: string; prenom: string }[]),
      // unites_organisationnelles : l'axe_analytique persisté peut être soit
      // l'id (UUID) soit le code de l'UO selon ce que contient réellement
      // affectations.organisation_id (constaté incohérent le 05/08) — on
      // indexe donc par les deux et on essaie les deux à la résolution,
      // même logique défensive que le correctif de comptabilisation_engine.py.
      db.list<{ id: string; code: string; libelle: string }>("unites_organisationnelles", {
        select: "id,code,libelle",
      }).catch(() => []),
    ]);

    const libelleParCompte = new Map(imputations.map((i) => [i.code_compte, i.intitule_compte]));
    const libelleParRubrique = new Map(rubriques.map((r) => [r.code, r.libelle]));
    const nomParCollaborateur = new Map(collaborateurs.map((c) => [c.id, `${c.prenom ?? ""} ${c.nom ?? ""}`.trim()]));
    const uoParId = new Map(uos.map((u) => [u.id, `${u.code} — ${u.libelle}`]));
    const uoParCode = new Map(uos.map((u) => [u.code, `${u.code} — ${u.libelle}`]));

    // ⚠️ Filtrage CLIENT sur lot_id ET numero_generation, en plus du filtre
    // serveur ci-dessus — voir le commentaire sur EcritureLigneBrute.
    const lignesDuLot = (lignesBrutes as any[]).filter(
      (l) => String(l.lot_id) === String(lotId) && Number(l.numero_generation) === Number(numeroGeneration)
    );

    const lignes: EcritureAffichage[] = lignesDuLot.map((l) => ({
      compte: l.compte,
      compte_libelle: libelleParCompte.get(l.compte) ?? "",
      montant_debit: l.sens === "D" ? Number(l.montant) : 0,
      montant_credit: l.sens === "C" ? Number(l.montant) : 0,
      axe_analytique: l.axe_analytique ?? null,
      axe_libelle: l.axe_analytique ? (uoParId.get(l.axe_analytique) ?? uoParCode.get(l.axe_analytique) ?? null) : null,
      rubrique_paie_code: nominatif ? l.rubrique_paie_code : null,
      rubrique_libelle: nominatif ? libelleParRubrique.get(l.rubrique_paie_code) ?? null : null,
      matricule: nominatif ? l.matricule_agent : null,
      collaborateur_nom: nominatif && l.collaborateur_id ? nomParCollaborateur.get(l.collaborateur_id) ?? null : null,
    }));

    return { nominatif, lignes };
  },

  // Réponse binaire (fichier à télécharger) : ne peut pas passer par
  // api.post (qui fait toujours response.json()) — fetch dédié, calqué sur
  // uploadFile() de api.ts.
  async exporterLot(lotId: string, formatCode: string): Promise<{ blob: Blob; filename: string }> {
    const token = tokenStore.get();
    const response = await fetch(`${API_BASE}${BASE}/lots/${lotId}/exporter`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ format_code: formatCode }),
    });
    if (response.status === 401) {
      tokenStore.clear();
      window.location.href = "/login";
      throw new Error("Session expirée");
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Erreur inconnue" }));
      throw new Error(error.detail ?? `Erreur ${response.status}`);
    }
    // Nom réel calculé et persisté côté serveur (cf. export_compta.py) —
    // ne PAS en reconstruire un côté client, ça a produit des noms erronés
    // par le passé (06/08 : "ecritures_generique_xlsx_..." avec une
    // extension .csv, sans rapport avec le vrai nom en base).
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
    const filename = match?.[1] ? decodeURIComponent(match[1]) : `export_${formatCode}_${lotId}`;
    const blob = await response.blob();
    return { blob, filename };
  },
};

/** Déclenche le téléchargement d'un Blob déjà récupéré (aucun appel réseau ici). */
export function declencherTelechargement(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
