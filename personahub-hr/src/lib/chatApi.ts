// =====================================================================
//  Client API du module Chat — réutilise ton client existant @/lib/api
//  Cible : src/lib/chatApi.ts
// =====================================================================
import { api, tokenStore, qs } from "@/lib/api";

// Base identique à @/lib/api (inclut déjà /api/v1)
const API_BASE =
  (import.meta as any).env?.VITE_API_URL ?? "http://localhost:8000/api/v1";

// ---------------------------------------------------------------- Types
// NB : les conversation_id / message.id sont des entiers (BIGSERIAL),
//      mais les identifiants collaborateur sont des UUID → string.
export interface Conversation {
  conversation_id: number;
  type: "direct" | "groupe";
  titre: string;
  photo_path?: string | null;
  dernier_message: string | null;
  dernier_le: string | null;
  non_lus: number;
}

export interface Message {
  id: number;
  conversation_id: number;
  expediteur_id: string;          // UUID
  expediteur_nom: string;
  contenu: string;
  cree_le: string;
  fichier_nom?: string | null;
  fichier_type?: string | null;
  fichier_taille?: number | null;
}

export interface Destinataire {
  collaborateur_id: string;       // UUID
  nom_complet: string;
  matricule: string;
  photo_path?: string | null;
}

export interface Moi {
  collaborateur_id: string;       // UUID
  nom_complet: string;
  roles: string[];
}

// ----------------------------------------------------------- Endpoints
export const chatApi = {
  moi: () => api.get<Moi>("/chat/moi"),

  conversations: () => api.get<Conversation[]>("/chat/conversations"),

  messages: (conversationId: number, avantId?: number, limite = 30) =>
    api.get<Message[]>(
      `/chat/conversations/${conversationId}/messages` +
        qs({ avant_id: avantId, limite })
    ),

  creerConversation: (type: "direct" | "groupe", membresIds: string[], titre?: string) =>
    api.post<{ conversation_id: number }>("/chat/conversations", {
      type,
      membres_ids: membresIds,
      titre: titre ?? null,
    }),

  marquerLu: (conversationId: number, messageId: number) =>
    api.post<{ ok: boolean }>(`/chat/conversations/${conversationId}/lu`, {
      message_id: messageId,
    }),

  destinataires: (q: string) =>
    api.get<Destinataire[]>("/chat/destinataires" + qs({ q })),

  // Envoi d'une pièce jointe (multipart). Renvoie le message créé.
  uploadFichier: async (
    conversationId: number,
    file: File,
    contenu = ""
  ): Promise<Message> => {
    const form = new FormData();
    form.append("fichier", file);
    form.append("contenu", contenu);
    const token = tokenStore.get() ?? "";
    const res = await fetch(
      `${API_BASE}/chat/conversations/${conversationId}/fichier`,
      {
        method: "POST",
        // NB : pas de Content-Type manuel → le navigateur pose le bon boundary multipart
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      }
    );
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e?.detail ?? `Erreur ${res.status}`);
    }
    return res.json();
  },

  // Téléchargement authentifié : récupère le fichier (auth) puis déclenche le download
  telechargerFichier: async (messageId: number, nom: string): Promise<void> => {
    const token = tokenStore.get() ?? "";
    const res = await fetch(`${API_BASE}/chat/messages/${messageId}/fichier`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) throw new Error(`Erreur ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nom;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

// URL du WebSocket : http(s)→ws(s), même base /api/v1, token en query.
export function wsUrl(): string {
  const base = API_BASE.replace(/^http/, "ws");
  const token = tokenStore.get() ?? "";
  return `${base}/chat/ws?token=${encodeURIComponent(token)}`;
}
