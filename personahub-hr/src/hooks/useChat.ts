// =====================================================================
//  Hook React du chat : WebSocket temps réel + reconnexion + état.
//  Cible : src/hooks/useChat.ts
// =====================================================================
import { useCallback, useEffect, useRef, useState } from "react";
import { chatApi, wsUrl, type Conversation, type Message } from "@/lib/chatApi";

type Statut = "connexion" | "en_ligne" | "hors_ligne";

export function useChat() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationActive, setConversationActive] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [statut, setStatut] = useState<Statut>("connexion");
  const [chargement, setChargement] = useState(false);
  const [monId, setMonId] = useState<string | null>(null);

  // Identité courante (pour aligner les messages à droite/gauche)
  useEffect(() => {
    chatApi.moi().then((m) => setMonId(m.collaborateur_id)).catch(() => {});
  }, []);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef(0);
  const fermetureVoulue = useRef(false);
  // garde la conversation active accessible dans les callbacks WS sans refermer la socket
  const activeRef = useRef<number | null>(null);
  activeRef.current = conversationActive;

  // --- Liste des conversations -----------------------------------------
  const rafraichirConversations = useCallback(async () => {
    try {
      setConversations(await chatApi.conversations());
    } catch (e) {
      console.error("[chat] conversations", e);
    }
  }, []);

  // --- WebSocket avec reconnexion exponentielle ------------------------
  const connecter = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return;
    setStatut("connexion");

    const ws = new WebSocket(wsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectRef.current = 0;
      setStatut("en_ligne");
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "message") {
        const msg: Message = data.message;
        // 1) si c'est la conversation ouverte → on l'ajoute au fil
        if (msg.conversation_id === activeRef.current) {
          setMessages((prev) =>
            prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]
          );
          // marquer lu immédiatement
          ws.send(
            JSON.stringify({
              type: "marquer_lu",
              conversation_id: msg.conversation_id,
              message_id: msg.id,
            })
          );
        }
        // 2) on rafraîchit la liste (dernier message + compteur de non-lus)
        rafraichirConversations();
      } else if (data.type === "erreur") {
        console.warn("[chat] erreur serveur:", data.detail);
      }
    };

    ws.onclose = () => {
      setStatut("hors_ligne");
      wsRef.current = null;
      if (fermetureVoulue.current) return;
      // backoff : 1s, 2s, 4s... plafonné à 15s
      const delai = Math.min(1000 * 2 ** reconnectRef.current, 15000);
      reconnectRef.current += 1;
      setTimeout(connecter, delai);
    };

    ws.onerror = () => ws.close();
  }, [rafraichirConversations]);

  useEffect(() => {
    fermetureVoulue.current = false;
    rafraichirConversations();
    connecter();
    return () => {
      fermetureVoulue.current = true;
      wsRef.current?.close();
    };
  }, [connecter, rafraichirConversations]);

  // --- Ouvrir une conversation -----------------------------------------
  const ouvrirConversation = useCallback(async (conversationId: number) => {
    setConversationActive(conversationId);
    setChargement(true);
    try {
      const histo = await chatApi.messages(conversationId);
      setMessages(histo);
      const dernier = histo[histo.length - 1];
      if (dernier) {
        await chatApi.marquerLu(conversationId, dernier.id);
        rafraichirConversations();
      }
    } catch (e) {
      console.error("[chat] historique", e);
      setMessages([]);
    } finally {
      setChargement(false);
    }
  }, [rafraichirConversations]);

  // --- Envoyer un message ----------------------------------------------
  const envoyer = useCallback((contenu: string) => {
    const texte = contenu.trim();
    if (!texte || activeRef.current == null) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        type: "message",
        conversation_id: activeRef.current,
        contenu: texte,
      })
    );
  }, []);

  // --- Envoyer un fichier (pièce jointe) -------------------------------
  const envoyerFichier = useCallback(
    async (file: File, contenu = "") => {
      if (activeRef.current == null) return;
      const msg = await chatApi.uploadFichier(activeRef.current, file, contenu);
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      rafraichirConversations();
    },
    [rafraichirConversations]
  );

  // --- Démarrer / ouvrir une conversation directe ----------------------
  const demarrerDirect = useCallback(
    async (collaborateurId: string) => {
      const { conversation_id } = await chatApi.creerConversation("direct", [collaborateurId]);
      await rafraichirConversations();
      await ouvrirConversation(conversation_id);
      return conversation_id;
    },
    [ouvrirConversation, rafraichirConversations]
  );

  // --- Créer un groupe -------------------------------------------------
  const creerGroupe = useCallback(
    async (titre: string, membresIds: string[]) => {
      const { conversation_id } = await chatApi.creerConversation("groupe", membresIds, titre);
      await rafraichirConversations();
      await ouvrirConversation(conversation_id);
      return conversation_id;
    },
    [ouvrirConversation, rafraichirConversations]
  );

  return {
    conversations,
    conversationActive,
    messages,
    statut,
    chargement,
    monId,
    ouvrirConversation,
    envoyer,
    envoyerFichier,
    demarrerDirect,
    creerGroupe,
    rafraichirConversations,
  };
}
