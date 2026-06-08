import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ── Énumérations — alignées sur les contraintes CHECK de la base ──
export const STATUTS = ["BROUILLON", "ACTIF", "ARCHIVE"];
export const TYPES_ETAPE = ["VALIDATION", "INFORMATION", "SIGNATURE", "PARALLELE", "AUTOMATIQUE", "CONDITION"];
export const MODES_VALIDATION = ["TOUS", "UN_SUFFISANT", "MAJORITE"];
export const TYPES_ACTEUR = ["DEMANDEUR", "HIERARCHIE_N1", "HIERARCHIE_N2", "UO_RESPONSABLE", "UO_PARENTE_RESPONSABLE", "UO_GRAND_PARENTE_RESPONSABLE", "UO_RACINE_RESPONSABLE", "ROLE", "GROUPE", "UTILISATEUR_FIXE", "DYNAMIQUE"];
export const TYPES_DECISION = ["VALIDER", "REJETER", "RENVOYER", "DELEGUER", "VISER", "DEMANDER_INFO", "ACCUSER_RECEPTION"];
export const DECLENCHEURS = ["ENTREE", "VALIDATION", "REJET", "TIMEOUT", "RELANCE", "COMMENTAIRE", "DELEGATION", "FINALISATION"];
export const TYPES_ACTION = ["NOTIFICATION_INTERNE", "EMAIL", "SMS", "WHATSAPP", "GENERER_DOCUMENT", "TACHE_SYSTEME", "WEBHOOK", "PUSH_MOBILE"];
export const TYPES_OBJET = ["generique", "cong_demande", "depart", "mouvement", "recrutement", "formation", "note_frais"];

// ── Modèles d'édition (références d'étapes par CODE, résolues en id à la sauvegarde) ──
export interface EditActeur {
  id?: string; type_acteur: string; valeur: string; ordre_delegation: number;
  est_observateur: boolean; peut_deleguer: boolean; delai_relance_h: number | null;
  fallback_type: string; fallback_valeur: string;
}
export interface EditDecision {
  id?: string; code: string; libelle: string; type_decision: string;
  cible_code: string; obligatoire_commentaire: boolean; couleur: string; icone: string; ordre: number;
}
export interface EditAction {
  id?: string; declencheur: string; type_action: string; ordre: number;
  configuration: Record<string, any>; condition_exec: string;
}
export interface EditEtape {
  id?: string; code: string; libelle: string; description: string; ordre: number;
  type_etape: string; mode_validation: string;
  delai_heures: number | null; delai_relance_heures: number | null;
  condition_sql: string; si_vrai_code: string; si_faux_code: string;
  obligatoire_commentaire: boolean; pj_autorisees: boolean; retour_possible: boolean;
  auto_skip_si_deja_decide: boolean; couleur: string; actif: boolean;
  acteurs: EditActeur[]; decisions: EditDecision[]; actions: EditAction[];
}
export interface EditWorkflow {
  id?: string; code: string; libelle: string; description: string; type_objet: string;
  version: number; statut: string; criteres: Record<string, any>;
  delai_global_heures: number | null; actif: boolean; couleur: string; icone: string; ordre: number;
  etapes: EditEtape[];
  _initialEtapeIds: string[];
}

// ── Liste des workflows ────────────────────────────────────────────────
export function useWorkflows() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["ref-workflows"],
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const rows = await api.get("/db/ref_workflow?order=ordre&select=id,code,libelle,type_objet,version,statut,actif,couleur,icone") as any[];
      return rows || [];
    },
  });
  return { workflows: data || [], loading: isLoading, refetch };
}

// ── Catalogues globaux (variables) pour aider à la saisie des conditions ──
export function useWorkflowVariables() {
  const { data } = useQuery({
    queryKey: ["ref-workflow-variables"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => (await api.get("/db/ref_workflow_variable?actif=eq.true&order=ordre&select=code,libelle,type_donnee,categorie,type_objet").catch(() => [])) as any[],
  });
  return data || [];
}

// ── Chargement complet d'un workflow (étapes + acteurs + décisions + actions) ──
export async function loadWorkflowFull(id: string): Promise<EditWorkflow> {
  const wf = ((await api.get(`/db/ref_workflow?id=eq.${id}&select=id,code,libelle,description,type_objet,version,statut,criteres,delai_global_heures,actif,couleur,icone,ordre`)) as any[])[0];
  const etapes = (await api.get(`/db/ref_workflow_etape?id_workflow=eq.${id}&order=ordre&select=id,code,libelle,description,ordre,type_etape,mode_validation,delai_heures,delai_relance_heures,condition_sql,etape_si_vrai_id,etape_si_faux_id,obligatoire_commentaire,pj_autorisees,retour_possible,auto_skip_si_deja_decide,couleur,actif`)) as any[];
  const ids = etapes.map((e) => e.id);
  let acteurs: any[] = [], decisions: any[] = [], actions: any[] = [];
  if (ids.length) {
    const inlist = `in.(${ids.join(",")})`;
    [acteurs, decisions, actions] = await Promise.all([
      api.get(`/db/ref_workflow_acteur?id_etape=${inlist}&order=ordre_delegation&select=id,id_etape,type_acteur,valeur,ordre_delegation,est_observateur,peut_deleguer,delai_relance_h,fallback_type,fallback_valeur`).catch(() => []) as Promise<any[]>,
      api.get(`/db/ref_workflow_decision?id_etape=${inlist}&order=ordre&select=id,id_etape,code,libelle,type_decision,etape_cible_id,obligatoire_commentaire,couleur,icone,ordre`).catch(() => []) as Promise<any[]>,
      api.get(`/db/ref_workflow_action?id_etape=${inlist}&order=ordre&select=id,id_etape,declencheur,type_action,ordre,configuration,condition_exec`).catch(() => []) as Promise<any[]>,
    ]);
  }
  const idToCode: Record<string, string> = {};
  etapes.forEach((e) => { idToCode[e.id] = e.code; });

  return {
    id: wf.id, code: wf.code, libelle: wf.libelle, description: wf.description || "", type_objet: wf.type_objet,
    version: wf.version, statut: wf.statut, criteres: wf.criteres || {}, delai_global_heures: wf.delai_global_heures,
    actif: wf.actif, couleur: wf.couleur || "", icone: wf.icone || "", ordre: wf.ordre || 0,
    _initialEtapeIds: ids,
    etapes: etapes.map((e) => ({
      id: e.id, code: e.code, libelle: e.libelle, description: e.description || "", ordre: e.ordre,
      type_etape: e.type_etape, mode_validation: e.mode_validation,
      delai_heures: e.delai_heures, delai_relance_heures: e.delai_relance_heures,
      condition_sql: e.condition_sql || "",
      si_vrai_code: e.etape_si_vrai_id ? (idToCode[e.etape_si_vrai_id] || "") : "",
      si_faux_code: e.etape_si_faux_id ? (idToCode[e.etape_si_faux_id] || "") : "",
      obligatoire_commentaire: e.obligatoire_commentaire, pj_autorisees: e.pj_autorisees,
      retour_possible: e.retour_possible, auto_skip_si_deja_decide: e.auto_skip_si_deja_decide,
      couleur: e.couleur || "", actif: e.actif,
      acteurs: acteurs.filter((a) => a.id_etape === e.id).map((a) => ({
        id: a.id, type_acteur: a.type_acteur, valeur: a.valeur || "", ordre_delegation: a.ordre_delegation,
        est_observateur: a.est_observateur, peut_deleguer: a.peut_deleguer, delai_relance_h: a.delai_relance_h,
        fallback_type: a.fallback_type || "", fallback_valeur: a.fallback_valeur || "",
      })),
      decisions: decisions.filter((d) => d.id_etape === e.id).map((d) => ({
        id: d.id, code: d.code, libelle: d.libelle, type_decision: d.type_decision,
        cible_code: d.etape_cible_id ? (idToCode[d.etape_cible_id] || "") : "",
        obligatoire_commentaire: d.obligatoire_commentaire, couleur: d.couleur || "", icone: d.icone || "", ordre: d.ordre,
      })),
      actions: actions.filter((ac) => ac.id_etape === e.id).map((ac) => ({
        id: ac.id, declencheur: ac.declencheur, type_action: ac.type_action, ordre: ac.ordre,
        configuration: ac.configuration || {}, condition_exec: ac.condition_exec || "",
      })),
    })),
  };
}

// ── Sauvegarde complète (workflow + étapes + enfants), refs résolues par code ──
export interface SaveWorkflowResult {
  id: string;
  etapesDesactivees: string[]; // libellés des étapes désactivées au lieu d'être supprimées (utilisées par des demandes)
}

export async function saveWorkflowFull(wf: EditWorkflow): Promise<SaveWorkflowResult> {
  const now = new Date().toISOString();
  const del = (path: string) => (api as any).delete(path);

  // 1) Workflow
  const wfFields = {
    code: wf.code.trim(), libelle: wf.libelle.trim(), description: wf.description || null, type_objet: wf.type_objet,
    version: wf.version, statut: wf.statut, criteres: wf.criteres || {}, delai_global_heures: wf.delai_global_heures,
    actif: wf.actif, couleur: wf.couleur || null, icone: wf.icone || null, ordre: wf.ordre,
  };
  let wfId = wf.id;
  if (wfId) await api.patch(`/db/ref_workflow?id=eq.${wfId}`, { ...wfFields, updated_at: now });
  else {
    await api.post("/db/ref_workflow", wfFields);
    wfId = ((await api.get(`/db/ref_workflow?code=eq.${wfFields.code}&version=eq.${wf.version}&select=id`)) as any[])[0].id;
  }

  // 2) Étapes supprimées → suppression sûre côté backend (détache les
  //    références entrantes, refuse si des instances utilisent l'étape → 409,
  //    auquel cas on désactive l'étape pour préserver l'historique).
  const currentIds = wf.etapes.filter((e) => e.id).map((e) => e.id as string);
  const idToLibelle: Record<string, string> = {};
  wf.etapes.forEach((e) => { if (e.id) idToLibelle[e.id] = e.libelle || e.code; });
  const etapesDesactivees: string[] = [];
  for (const id of wf._initialEtapeIds.filter((x) => !currentIds.includes(x))) {
    try {
      await (api as any).delete(`/workflow/etapes/${id}`);
    } catch (err: any) {
      // 409 = étape utilisée par des demandes → on désactive au lieu de supprimer
      const status = err?.status ?? err?.response?.status;
      if (status === 409) {
        try {
          await api.patch(`/workflow/etapes/${id}/desactiver`, {});
          etapesDesactivees.push(idToLibelle[id] || id);
        } catch { /* on ignore : l'enregistrement global continue */ }
      } else {
        throw err; // autre erreur → on laisse remonter
      }
    }
  }

  // 3) Upsert étapes — ordre normalisé par position (1, 2, 3…) pour respecter
  //    la contrainte UNIQUE(id_workflow, ordre). Écriture en 2 passes afin
  //    d'éviter toute collision transitoire pendant les UPDATE :
  //    passe A) on décale les étapes EXISTANTES dans une plage haute (+1000) ;
  //    passe B) on réécrit l'ordre final (index+1) + tous les champs.
  const existantes = wf.etapes.filter((e) => e.id);
  // Passe A : éloigner les ordres des étapes existantes (évite les doublons en cours de route)
  for (let i = 0; i < existantes.length; i++) {
    await api.patch(`/db/ref_workflow_etape?id=eq.${existantes[i].id}`, { ordre: 1000 + i });
  }
  // Passe B : écrire l'état final (ordre = position dans la liste)
  for (let i = 0; i < wf.etapes.length; i++) {
    const e = wf.etapes[i];
    const ordreFinal = i + 1;
    const f = {
      id_workflow: wfId, code: e.code, libelle: e.libelle, description: e.description || null, ordre: ordreFinal,
      type_etape: e.type_etape, mode_validation: e.mode_validation,
      delai_heures: e.delai_heures, delai_relance_heures: e.delai_relance_heures,
      condition_sql: e.condition_sql || null, obligatoire_commentaire: e.obligatoire_commentaire,
      pj_autorisees: e.pj_autorisees, retour_possible: e.retour_possible,
      auto_skip_si_deja_decide: e.auto_skip_si_deja_decide, couleur: e.couleur || null, actif: e.actif,
    };
    if (e.id) await api.patch(`/db/ref_workflow_etape?id=eq.${e.id}`, { ...f, updated_at: now });
    else await api.post("/db/ref_workflow_etape", f);
    // Tenir l'état local à jour pour les étapes-cibles (aperçu / branches)
    e.ordre = ordreFinal;
  }

  // 4) code → id (inclut les nouvelles étapes)
  const all = (await api.get(`/db/ref_workflow_etape?id_workflow=eq.${wfId}&select=id,code`)) as any[];
  const codeToId: Record<string, string> = {};
  all.forEach((e) => { codeToId[e.code] = e.id; });

  // 5) Branches conditionnelles (résolues par code)
  for (const e of wf.etapes) {
    if (e.type_etape === "CONDITION") {
      await api.patch(`/db/ref_workflow_etape?id=eq.${codeToId[e.code]}`, {
        etape_si_vrai_id: e.si_vrai_code ? codeToId[e.si_vrai_code] || null : null,
        etape_si_faux_id: e.si_faux_code ? codeToId[e.si_faux_code] || null : null,
      });
    }
  }

  // 6) Enfants : remplacement complet par étape
  for (const e of wf.etapes) {
    const eid = codeToId[e.code];
    await del(`/db/ref_workflow_acteur?id_etape=eq.${eid}`);
    for (let i = 0; i < e.acteurs.length; i++) {
      const a = e.acteurs[i];
      await api.post("/db/ref_workflow_acteur", {
        id_etape: eid, type_acteur: a.type_acteur, valeur: a.valeur || null, ordre_delegation: a.ordre_delegation ?? i,
        est_observateur: a.est_observateur, peut_deleguer: a.peut_deleguer, delai_relance_h: a.delai_relance_h,
        fallback_type: a.fallback_type || null, fallback_valeur: a.fallback_valeur || null, actif: true,
      });
    }
    await del(`/db/ref_workflow_decision?id_etape=eq.${eid}`);
    for (const d of e.decisions) {
      await api.post("/db/ref_workflow_decision", {
        id_etape: eid, code: d.code, libelle: d.libelle, type_decision: d.type_decision,
        etape_cible_id: d.cible_code ? codeToId[d.cible_code] || null : null,
        obligatoire_commentaire: d.obligatoire_commentaire, couleur: d.couleur || null, icone: d.icone || null, ordre: d.ordre, actif: true,
      });
    }
    await del(`/db/ref_workflow_action?id_etape=eq.${eid}`);
    for (const ac of e.actions) {
      await api.post("/db/ref_workflow_action", {
        id_etape: eid, declencheur: ac.declencheur, type_action: ac.type_action, ordre: ac.ordre,
        configuration: ac.configuration || {}, condition_exec: ac.condition_exec || null, actif: true,
      });
    }
  }
  return { id: wfId as string, etapesDesactivees };
}
