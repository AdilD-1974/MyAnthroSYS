// =====================================================================
//  Page Chat — messagerie collaborateurs
//  Cible : src/pages/espaces/ChatPage.tsx
//
//  Style : composants shadcn/ui + tokens de thème (bg-primary, text-muted-
//  foreground, etc.) → respecte automatiquement la page Apparence.
//  Couleurs en dur volontairement évitées.
// =====================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileText, MessageSquarePlus, Paperclip, Search, Send, Users, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

import { chatApi, type Destinataire } from "@/lib/chatApi";
import { useChatContext } from "@/contexts/ChatContext";

function initiales(nom: string): string {
  return nom
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

function heure(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatTaille(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

// Avatar : photo si photo_path est une URL http (logique identique au Trombinoscope),
// sinon repli sur les initiales. Pour un groupe, icône dédiée.
function ChatAvatar({
  nom,
  photoPath,
  isGroup = false,
  size = 36,
}: {
  nom: string;
  photoPath?: string | null;
  isGroup?: boolean;
  size?: number;
}) {
  const [erreur, setErreur] = useState(false);
  const url = photoPath && photoPath.startsWith("http") ? photoPath : null;
  const dim = { width: size, height: size };

  if (isGroup) {
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary"
        style={dim}
      >
        <Users className="h-4 w-4" />
      </div>
    );
  }
  if (url && !erreur) {
    return (
      <img
        src={url}
        alt={nom}
        onError={() => setErreur(true)}
        className="shrink-0 rounded-full object-cover"
        style={dim}
      />
    );
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-medium text-primary"
      style={dim}
    >
      {initiales(nom)}
    </div>
  );
}

export default function ChatPage() {
  const {
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
  } = useChatContext();

  const [saisie, setSaisie] = useState("");
  const [filtreListe, setFiltreListe] = useState("");
  const finRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const onPickFile = () => fileInputRef.current?.click();
  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ""; // permet de re-sélectionner le même fichier ensuite
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) {
      alert("Fichier trop volumineux (max 10 Mo).");
      return;
    }
    try {
      await envoyerFichier(f, "");
    } catch {
      alert("Échec de l'envoi du fichier.");
    }
  };

  // auto-scroll vers le bas à chaque nouveau message
  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const conversationsFiltrees = useMemo(
    () =>
      conversations.filter((c) =>
        c.titre.toLowerCase().includes(filtreListe.trim().toLowerCase())
      ),
    [conversations, filtreListe]
  );

  const convCourante = conversations.find((c) => c.conversation_id === conversationActive);

  const onEnvoyer = () => {
    if (!saisie.trim()) return;
    envoyer(saisie);
    setSaisie("");
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] overflow-hidden rounded-xl border bg-card">
      {/* ---------------- Volet gauche : conversations ---------------- */}
      <aside className="flex w-80 shrink-0 flex-col border-r bg-muted/30">
        <div className="flex items-center justify-between gap-2 border-b p-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold">Messages</span>
            <span
              className={`h-2 w-2 rounded-full ${
                statut === "en_ligne"
                  ? "bg-[hsl(var(--success))]"
                  : statut === "connexion"
                  ? "bg-[hsl(var(--warning))]"
                  : "bg-[hsl(var(--destructive))]"
              }`}
              title={statut}
            />
          </div>
          <NouvelleConversation
            onDirect={demarrerDirect}
            onGroupe={creerGroupe}
          />
        </div>

        <div className="p-2">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={filtreListe}
              onChange={(e) => setFiltreListe(e.target.value)}
              placeholder="Rechercher une conversation"
              className="pl-8"
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          <ul className="space-y-1 p-2">
            {conversationsFiltrees.map((c) => {
              const actif = c.conversation_id === conversationActive;
              return (
                <li key={c.conversation_id}>
                  <button
                    onClick={() => ouvrirConversation(c.conversation_id)}
                    className={`flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors ${
                      actif ? "bg-primary/10" : "hover:bg-accent"
                    }`}
                  >
                    <ChatAvatar
                      nom={c.titre}
                      photoPath={c.photo_path}
                      isGroup={c.type === "groupe"}
                      size={36}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{c.titre}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {heure(c.dernier_le)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-muted-foreground">
                          {c.dernier_message ?? "Nouvelle conversation"}
                        </span>
                        {c.non_lus > 0 && (
                          <Badge className="h-5 min-w-5 justify-center px-1.5">{c.non_lus}</Badge>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
            {conversationsFiltrees.length === 0 && (
              <li className="px-3 py-8 text-center text-sm text-muted-foreground">
                Aucune conversation.
              </li>
            )}
          </ul>
        </ScrollArea>
      </aside>

      {/* ---------------- Volet droit : fil de messages ---------------- */}
      <section className="flex min-w-0 flex-1 flex-col">
        {conversationActive == null ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
            <MessageSquarePlus className="h-10 w-10 opacity-40" />
            <p>Sélectionne une conversation ou démarres-en une nouvelle.</p>
          </div>
        ) : (
          <>
            <header className="flex items-center gap-3 border-b p-3">
              <ChatAvatar
                nom={convCourante?.titre ?? ""}
                photoPath={convCourante?.photo_path}
                isGroup={convCourante?.type === "groupe"}
                size={36}
              />
              <div className="font-medium">{convCourante?.titre}</div>
            </header>

            <ScrollArea className="flex-1 p-4">
              {chargement ? (
                <p className="text-center text-sm text-muted-foreground">Chargement…</p>
              ) : (
                <div className="space-y-3">
                  {messages.map((m) => {
                    const moi = m.expediteur_id === monId;
                    return (
                      <div
                        key={m.id}
                        className={`flex flex-col ${moi ? "items-end" : "items-start"}`}
                      >
                        {!moi && convCourante?.type === "groupe" && (
                          <span className="mb-0.5 px-1 text-[11px] text-muted-foreground">
                            {m.expediteur_nom}
                          </span>
                        )}
                        <div
                          className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                            moi
                              ? "rounded-br-sm bg-primary text-primary-foreground"
                              : "rounded-bl-sm bg-muted text-foreground"
                          }`}
                        >
                          {m.contenu && (
                            <div className="whitespace-pre-wrap break-words">{m.contenu}</div>
                          )}
                          {m.fichier_nom && (
                            <button
                              type="button"
                              onClick={() => chatApi.telechargerFichier(m.id, m.fichier_nom!)}
                              title="Télécharger"
                              className={`mt-1 flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                                moi
                                  ? "bg-primary-foreground/15 hover:bg-primary-foreground/25"
                                  : "bg-background hover:bg-accent"
                              }`}
                            >
                              <FileText className="h-4 w-4 shrink-0" />
                              <span className="min-w-0">
                                <span className="block max-w-[180px] truncate text-xs font-medium">
                                  {m.fichier_nom}
                                </span>
                                {m.fichier_taille != null && (
                                  <span className="block text-[10px] opacity-70">
                                    {formatTaille(m.fichier_taille)}
                                  </span>
                                )}
                              </span>
                              <Download className="ml-1 h-3.5 w-3.5 shrink-0 opacity-70" />
                            </button>
                          )}
                        </div>
                        <span className="mt-0.5 px-1 text-[10px] text-muted-foreground">
                          {heure(m.cree_le)}
                        </span>
                      </div>
                    );
                  })}
                  <div ref={finRef} />
                </div>
              )}
            </ScrollArea>

            <footer className="flex items-center gap-2 border-t p-3">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={onFileChange}
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={onPickFile}
                title="Joindre un fichier"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <Input
                value={saisie}
                onChange={(e) => setSaisie(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onEnvoyer();
                  }
                }}
                placeholder="Écris un message…"
                disabled={statut !== "en_ligne"}
              />
              <Button onClick={onEnvoyer} disabled={!saisie.trim() || statut !== "en_ligne"}>
                <Send className="h-4 w-4" />
              </Button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}

// =====================================================================
//  Modale « Nouvelle conversation » (direct ou groupe)
// =====================================================================
function NouvelleConversation({
  onDirect,
  onGroupe,
}: {
  onDirect: (collaborateurId: string) => Promise<number>;
  onGroupe: (titre: string, membres: string[]) => Promise<number>;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [resultats, setResultats] = useState<Destinataire[]>([]);
  const [selection, setSelection] = useState<Destinataire[]>([]);
  const [titre, setTitre] = useState("");

  // recherche serveur avec petit debounce
  useEffect(() => {
    if (!ouvert) return;
    const id = setTimeout(() => {
      chatApi.destinataires(recherche).then(setResultats).catch(() => setResultats([]));
    }, 250);
    return () => clearTimeout(id);
  }, [recherche, ouvert]);

  const reset = () => {
    setRecherche("");
    setResultats([]);
    setSelection([]);
    setTitre("");
  };

  const ajouter = (d: Destinataire) => {
    if (!selection.some((s) => s.collaborateur_id === d.collaborateur_id)) {
      setSelection((prev) => [...prev, d]);
    }
  };
  const retirer = (id: string) =>
    setSelection((prev) => prev.filter((s) => s.collaborateur_id !== id));

  const valider = async () => {
    if (selection.length === 0) return;
    if (selection.length === 1) {
      await onDirect(selection[0].collaborateur_id);
    } else {
      if (!titre.trim()) return;
      await onGroupe(
        titre.trim(),
        selection.map((s) => s.collaborateur_id)
      );
    }
    setOuvert(false);
    reset();
  };

  const estGroupe = selection.length > 1;

  return (
    <Dialog
      open={ouvert}
      onOpenChange={(o) => {
        setOuvert(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" title="Nouvelle conversation">
          <MessageSquarePlus className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouvelle conversation</DialogTitle>
          <DialogDescription className="sr-only">
            Recherchez un collègue par nom ou matricule pour démarrer une discussion ou créer un groupe.
          </DialogDescription>
        </DialogHeader>

        {/* Sélection courante (chips) */}
        {selection.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selection.map((s) => (
              <Badge key={s.collaborateur_id} variant="secondary" className="gap-1">
                {s.nom_complet}
                <button onClick={() => retirer(s.collaborateur_id)}>
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}

        {/* Titre obligatoire si groupe */}
        {estGroupe && (
          <Input
            value={titre}
            onChange={(e) => setTitre(e.target.value)}
            placeholder="Nom du groupe"
          />
        )}

        {/* Recherche de destinataires */}
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher par nom ou matricule"
            className="pl-8"
          />
        </div>

        <ScrollArea className="max-h-60">
          <ul className="space-y-1">
            {resultats.map((d) => (
              <li key={d.collaborateur_id}>
                <button
                  onClick={() => ajouter(d)}
                  className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-accent"
                >
                  <ChatAvatar nom={d.nom_complet} photoPath={d.photo_path} size={32} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{d.nom_complet}</div>
                    <div className="text-xs text-muted-foreground">{d.matricule}</div>
                  </div>
                </button>
              </li>
            ))}
            {recherche && resultats.length === 0 && (
              <li className="py-4 text-center text-sm text-muted-foreground">
                Aucun collaborateur autorisé trouvé.
              </li>
            )}
          </ul>
        </ScrollArea>

        <DialogFooter>
          <Button
            onClick={valider}
            disabled={selection.length === 0 || (estGroupe && !titre.trim())}
          >
            {estGroupe ? "Créer le groupe" : "Démarrer la discussion"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
