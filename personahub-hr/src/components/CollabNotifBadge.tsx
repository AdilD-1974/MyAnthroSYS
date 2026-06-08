/**
 * CollabNotifBadge – Macaron affiché sur chaque carte/ligne collaborateur.
 * Affiche le nombre de notifications. Au clic, popover listant les alertes
 * avec navigation vers le processus concerné.
 */
import React, { useState, useRef, useEffect } from "react";
import { Bell, Briefcase, FileText, Gift, ChevronRight, GraduationCap, AlertTriangle, Clock, CreditCard } from "lucide-react";
import { Notification, NotifType } from "@/hooks/useNotifications";
import { useNavigate } from "react-router-dom";

const typeConfig: Record<NotifType, { icon: React.ReactNode; label: string; color: string; bg: string }> = {
  contrat:           { icon: <Briefcase size={12} />,     label: "Contrat",           color: "hsl(var(--accent))",   bg: "hsl(var(--accent) / 0.1)" },
  document:          { icon: <FileText size={12} />,      label: "Document",          color: "hsl(38 92% 50%)",      bg: "hsl(38 92% 50% / 0.1)" },
  anniversaire:      { icon: <Gift size={12} />,          label: "Anniversaire",      color: "hsl(280 60% 55%)",     bg: "hsl(280 60% 55% / 0.1)" },
  reprise:           { icon: <AlertTriangle size={12} />, label: "Reprise",           color: "hsl(0 84% 50%)",       bg: "hsl(0 84% 50% / 0.1)" },
  depart_provisoire: { icon: <Clock size={12} />,         label: "Départ provisoire", color: "hsl(25 90% 48%)",      bg: "hsl(25 90% 48% / 0.1)" },
  paiement:          { icon: <CreditCard size={12} />,   label: "Coord. bancaire",   color: "hsl(0 70% 50%)",       bg: "hsl(0 70% 50% / 0.1)" },
};

interface Props {
  collaborateurId: string;
  notifications: Notification[];
}

const CollabNotifBadge: React.FC<Props> = ({ collaborateurId, notifications }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (notifications.length === 0) return null;

  const handleNotifClick = (notif: Notification) => {
    setOpen(false);
    if (notif.type === "contrat") {
      navigate(`/collaborateurs/${collaborateurId}?tab=contrats`);
    } else if (notif.type === "document") {
      navigate(`/collaborateurs/${collaborateurId}?tab=identite`);
    } else if (notif.type === "reprise") {
      navigate(`/absences/saisie`);
    } else if (notif.type === "depart_provisoire") {
      navigate(`/departs-provisoires`);
    } else {
      navigate(`/collaborateurs/${collaborateurId}`);
    }
  };

  const urgenceColor = (daysLeft?: number): string => {
    if (daysLeft === undefined) return "hsl(var(--muted-foreground))";
    if (daysLeft <= 3) return "hsl(0 84% 50%)";
    if (daysLeft <= 7) return "hsl(38 92% 45%)";
    return "hsl(var(--muted-foreground))";
  };

  return (
    <div ref={ref} className="relative inline-flex">
      <div
        role="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="relative flex items-center gap-1 px-2 py-1 rounded-full transition-all hover:scale-105 cursor-pointer"
        style={{ background: "hsl(0 84% 50% / 0.15)", color: "hsl(0 84% 50%)", border: "1px solid hsl(0 84% 50% / 0.3)" }}
        title={`${notifications.length} alerte(s)`}
      >
        <Bell size={12} />
        <span className="text-[10px] font-bold">
          {notifications.length}
        </span>
      </div>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-full mt-1 w-72 rounded-lg border shadow-xl z-50 overflow-hidden"
          style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
        >
          <div className="px-3 py-2 border-b flex items-center gap-2" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.5)" }}>
            <Bell size={12} style={{ color: "hsl(var(--accent))" }} />
            <span className="text-xs font-semibold" style={{ color: "hsl(var(--foreground))" }}>
              {notifications.length} alerte{notifications.length > 1 ? "s" : ""}
            </span>
          </div>
          <div className="max-h-52 overflow-y-auto">
            {notifications.map((n) => {
              const cfg = typeConfig[n.type];
              return (
                <div
                  key={n.id}
                  role="button"
                  onClick={() => handleNotifClick(n)}
                  className="w-full text-left flex items-start gap-2 px-3 py-2 transition-colors hover:bg-muted/50 border-b last:border-b-0 cursor-pointer"
                  style={{ borderColor: "hsl(var(--border))" }}
                >
                  <div className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5" style={{ background: cfg.bg, color: cfg.color }}>
                    {cfg.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold truncate" style={{ color: "hsl(var(--foreground))" }}>{n.titre}</p>
                    <p className="text-[10px] line-clamp-2" style={{ color: "hsl(var(--muted-foreground))" }}>{n.description}</p>
                    {n.daysLeft !== undefined && (
                      <p className="text-[9px] font-semibold mt-0.5" style={{ color: urgenceColor(n.daysLeft) }}>
                        {n.daysLeft < 0 ? `Expiré depuis ${Math.abs(n.daysLeft)} jour${Math.abs(n.daysLeft) > 1 ? "s" : ""}` : n.daysLeft === 0 ? "Aujourd'hui !" : `Dans ${n.daysLeft} jour${n.daysLeft > 1 ? "s" : ""}`}
                      </p>
                    )}
                  </div>
                  <ChevronRight size={11} className="flex-shrink-0 mt-1" style={{ color: "hsl(var(--muted-foreground))" }} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default CollabNotifBadge;
