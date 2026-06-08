/**
 * NotificationBell – Cloche de notifications dans l'AppLayout.
 * Affiche le nombre de notifications non lues + popover avec détails.
 */
import React, { useState, useRef, useEffect } from "react";
import { Bell, X, CheckCheck, Briefcase, FileText, Gift, ChevronRight, AlertTriangle, Clock, CreditCard } from "lucide-react";
import { useNotifications, Notification, NotifType } from "@/hooks/useNotifications";
import { useNavigate } from "react-router-dom";

const typeConfig: Record<NotifType, { icon: React.ReactNode; color: string; bg: string }> = {
  contrat:            { icon: <Briefcase size={14} />,     color: "hsl(var(--accent))", bg: "hsl(var(--accent) / 0.1)" },
  document:           { icon: <FileText size={14} />,      color: "hsl(38 92% 50%)",    bg: "hsl(38 92% 50% / 0.1)" },
  anniversaire:       { icon: <Gift size={14} />,          color: "hsl(280 60% 55%)",   bg: "hsl(280 60% 55% / 0.1)" },
  reprise:            { icon: <AlertTriangle size={14} />, color: "hsl(0 84% 50%)",     bg: "hsl(0 84% 50% / 0.1)" },
  depart_provisoire:  { icon: <Clock size={14} />,         color: "hsl(25 90% 48%)",    bg: "hsl(25 90% 48% / 0.1)" },
  paiement:           { icon: <CreditCard size={14} />,   color: "hsl(0 70% 50%)",     bg: "hsl(0 70% 50% / 0.1)" },
};

const urgenceColor = (daysLeft?: number): string => {
  if (daysLeft === undefined) return "hsl(var(--muted-foreground))";
  if (daysLeft === 0) return "hsl(0 84% 50%)";
  if (daysLeft <= 3) return "hsl(0 84% 50%)";
  if (daysLeft <= 7) return "hsl(38 92% 45%)";
  return "hsl(var(--muted-foreground))";
};

const NotificationItem: React.FC<{ notif: Notification; onRead: (id: string) => void; onNavigate: () => void }> = ({ notif, onRead, onNavigate }) => {
  const navigate = useNavigate();
  const cfg = typeConfig[notif.type];

  const handleClick = () => {
    onRead(notif.id);
    if (notif.type === "reprise") {
      navigate(`/absences/saisie`);
      onNavigate();
    } else if (notif.type === "depart_provisoire") {
      navigate(`/departs-provisoires`);
      onNavigate();
    } else if (notif.collaborateurId) {
      navigate(`/collaborateurs/${notif.collaborateurId}`);
      onNavigate();
    }
  };

  return (
    <div
      onClick={handleClick}
      className="flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-muted/50 border-b last:border-b-0"
      style={{
        borderColor: "hsl(var(--border))",
        background: notif.lue ? "transparent" : "hsl(var(--accent) / 0.03)",
      }}
    >
      {/* Icône type */}
      <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5" style={{ background: cfg.bg, color: cfg.color }}>
        {cfg.icon}
      </div>

      {/* Contenu */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold truncate" style={{ color: "hsl(var(--foreground))" }}>{notif.titre}</p>
          {!notif.lue && <span className="flex-shrink-0 w-2 h-2 rounded-full" style={{ background: "hsl(var(--accent))" }} />}
        </div>
        <p className="text-xs mt-0.5 line-clamp-2" style={{ color: "hsl(var(--muted-foreground))" }}>{notif.description}</p>
        {notif.daysLeft !== undefined && (
          <p className="text-[10px] mt-0.5 font-semibold" style={{ color: urgenceColor(notif.daysLeft) }}>
            {notif.daysLeft === 0 ? "Aujourd'hui !" : notif.daysLeft < 0 ? `Dépassé de ${Math.abs(notif.daysLeft)} j` : `Dans ${notif.daysLeft} jour${notif.daysLeft > 1 ? "s" : ""}`}
          </p>
        )}
      </div>
      <ChevronRight size={13} style={{ color: "hsl(var(--muted-foreground))", flexShrink: 0, marginTop: 2 }} />
    </div>
  );
};

const NotificationBell: React.FC = () => {
  const { notifications, unreadCount, markAsRead, markAllAsRead, loading } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Fermer au clic extérieur
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const grouped = {
    contrat:           notifications.filter(n => n.type === "contrat"),
    document:          notifications.filter(n => n.type === "document"),
    anniversaire:      notifications.filter(n => n.type === "anniversaire"),
    reprise:           notifications.filter(n => n.type === "reprise"),
    depart_provisoire: notifications.filter(n => n.type === "depart_provisoire"),
    paiement:          notifications.filter(n => n.type === "paiement"),
  };

  const typeLabels: Record<NotifType, string> = {
    contrat: "Contrats",
    document: "Documents",
    anniversaire: "Anniversaires",
    reprise: "Reprises congé",
    depart_provisoire: "Départs provisoires",
    paiement: "Coordonnées bancaires",
  };

  return (
    <div ref={ref} className="relative">
      {/* Bouton cloche */}
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-lg transition-colors hover:bg-muted/60"
        title="Notifications"
        style={{ color: "hsl(var(--foreground))" }}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] rounded-full text-[10px] font-bold flex items-center justify-center px-0.5"
            style={{ background: "hsl(0 84% 50%)", color: "white" }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Popover */}
      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-96 rounded-xl border shadow-2xl z-50 flex flex-col overflow-hidden"
          style={{
            background: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
            maxHeight: "80vh",
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0" style={{ borderColor: "hsl(var(--border))" }}>
            <div className="flex items-center gap-2">
              <Bell size={15} style={{ color: "hsl(var(--accent))" }} />
              <h3 className="font-semibold text-sm" style={{ color: "hsl(var(--foreground))" }}>
                Notifications
              </h3>
              {unreadCount > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--accent) / 0.12)", color: "hsl(var(--accent))" }}>
                  {unreadCount} non lue{unreadCount > 1 ? "s" : ""}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md transition-colors hover:bg-muted/60"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                  title="Tout marquer comme lu"
                >
                  <CheckCheck size={12} /> Tout lire
                </button>
              )}
              <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-muted/60" style={{ color: "hsl(var(--muted-foreground))" }}>
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="overflow-y-auto flex-1">
            {loading && (
              <div className="py-10 flex flex-col items-center gap-2">
                <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "hsl(var(--accent))", borderTopColor: "transparent" }} />
                <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Chargement…</p>
              </div>
            )}
            {!loading && notifications.length === 0 && (
              <div className="py-12 flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "hsl(var(--muted))" }}>
                  <Bell size={20} style={{ color: "hsl(var(--muted-foreground))" }} />
                </div>
                <p className="text-sm font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune alerte à venir</p>
              </div>
            )}
            {!loading && (["contrat", "document", "anniversaire", "reprise", "depart_provisoire"] as NotifType[]).map(type => {
              const items = grouped[type];
              if (items.length === 0) return null;
              return (
                <div key={type}>
                  <div className="px-4 py-2 sticky top-0 z-10" style={{ background: "hsl(var(--muted) / 0.8)", backdropFilter: "blur(4px)" }}>
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {typeLabels[type]} ({items.length})
                    </p>
                  </div>
                  {items.map(n => (
                    <NotificationItem
                      key={n.id}
                      notif={n}
                      onRead={markAsRead}
                      onNavigate={() => setOpen(false)}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
