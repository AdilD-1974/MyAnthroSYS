// =====================================================================
//  Contexte global du chat.
//  Cible : src/contexts/ChatContext.tsx
//
//  But : UNE seule connexion WebSocket pour toute l'app, partagée entre
//  la page Chat et le badge de la sidebar. Le total de non-lus se met à
//  jour en temps réel partout dès qu'un message arrive.
// =====================================================================
import { createContext, useContext, type ReactNode } from "react";
import { useChat } from "@/hooks/useChat";

type ChatContextValue = ReturnType<typeof useChat> & { nonLusTotal: number };

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const chat = useChat();
  const nonLusTotal = chat.conversations.reduce((s, c) => s + (c.non_lus || 0), 0);

  return (
    <ChatContext.Provider value={{ ...chat, nonLusTotal }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error("useChatContext doit être utilisé à l'intérieur de <ChatProvider>.");
  }
  return ctx;
}
