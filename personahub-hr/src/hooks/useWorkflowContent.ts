import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ── Énumérations (contraintes CHECK de la base) ──
export const TYPES_DONNEE = ["TEXTE", "NOMBRE", "DATE", "DATETIME", "BOOLEEN", "MONTANT"];
export const CANAUX = ["EMAIL", "SMS", "WHATSAPP", "NOTIFICATION", "PUSH"];
export const TYPES_DOCUMENT = ["WORD", "HTML", "PDF", "TEXTE"];
export const EXTENSIONS = ["pdf", "docx", "html"];
export const CATEGORIES_VAR = ["GENERAL", "COLLABORATEUR", "DEMANDE", "CONTRAT", "PAIE", "ORGANISATION", "WORKFLOW"];
export const TYPES_OBJET = ["generique", "cong_demande", "depart", "mouvement", "recrutement", "formation", "note_frais"];

export interface WfVariable {
  id: string; code: string; libelle: string; description: string | null;
  type_objet: string | null; type_donnee: string; categorie: string;
  exemple_valeur: string | null; source_sql: string | null; actif: boolean; ordre: number;
}
export interface WfTemplate {
  id: string; code: string; libelle: string; type_canal: string;
  sujet: string | null; corps: string; variables: any; actif: boolean;
}
export interface DocTemplate {
  id: string; code: string; libelle: string; description: string | null;
  type_objet: string | null; type_document: string; chemin_fichier: string | null;
  contenu: string | null; variables: any; extension_sortie: string; nom_fichier_pattern: string | null; actif: boolean;
}

// Jeton inséré dans les modèles
export const tokenOf = (code: string) => `{{${code}}}`;

// ── Catalogue de variables ──
export function useVariables() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["wf-variables"],
    staleTime: 2 * 60 * 1000,
    queryFn: async () => (await api.get("/db/ref_workflow_variable?order=ordre&select=id,code,libelle,description,type_objet,type_donnee,categorie,exemple_valeur,source_sql,actif,ordre")) as WfVariable[],
  });
  return { variables: data || [], loading: isLoading, refetch };
}

// ── Modèles de notification ──
export function useNotifTemplates() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["wf-templates"],
    staleTime: 2 * 60 * 1000,
    queryFn: async () => (await api.get("/db/ref_workflow_template?order=libelle&select=id,code,libelle,type_canal,sujet,corps,variables,actif")) as WfTemplate[],
  });
  return { templates: data || [], loading: isLoading, refetch };
}

// ── Modèles de documents ──
export function useDocTemplates() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["doc-templates"],
    staleTime: 2 * 60 * 1000,
    queryFn: async () => (await api.get("/db/ref_template_document?order=libelle&select=id,code,libelle,description,type_objet,type_document,chemin_fichier,contenu,variables,extension_sortie,nom_fichier_pattern,actif")) as DocTemplate[],
  });
  return { templates: data || [], loading: isLoading, refetch };
}

// Remplace les jetons {{code}} par les exemples de valeurs (aperçu en direct)
export function renderApercu(texte: string, variables: WfVariable[]): string {
  if (!texte) return "";
  const map: Record<string, string> = {};
  variables.forEach((v) => { map[v.code] = v.exemple_valeur || `«${v.libelle}»`; });
  return texte.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, code) => map[code] ?? `{{${code}}}`);
}

// Extrait les codes de variables utilisés dans un texte (pour le champ variables jsonb)
export function extractTokens(texte: string): string[] {
  const out = new Set<string>();
  const re = /\{\{\s*([\w.]+)\s*\}\}/g; let m;
  while ((m = re.exec(texte || "")) !== null) out.add(m[1]);
  return [...out];
}
