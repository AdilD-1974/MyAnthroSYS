import React from "react";
import { Outlet, Navigate } from "react-router-dom";
import TopNav from "./TopNav";
import { ReturnTrail } from "@/components/navigation/ReturnTrail";
import NotificationBell from "./NotificationBell";
import BadgeIdentite from "@/components/BadgeIdentite";
import SelecteurEspace from "@/components/SelecteurEspace";
import SelecteurSociete from "@/components/SelecteurSociete";
import { useAuth } from "@/contexts/AuthContext";
import { ChatProvider } from "@/contexts/ChatContext";
import { TacheProvider } from "@/contexts/TacheContext";

const AppLayout: React.FC = () => {
  const { user, loading } = useAuth();

  // RG-HABILLAGE-HEADER-01 (24/08) : même dégradé que AccueilLauncher.tsx
  // (TB_GRADIENT) — copié en dur ici plutôt qu'importé, pour ne pas créer
  // une dépendance entre une page (AccueilLauncher) et un layout partagé
  // (AppLayout) pour une simple constante de couleur. À centraliser dans un
  // fichier de constantes de thème si un 3e endroit en a besoin un jour.
  const TB_GRADIENT = "linear-gradient(90deg, #0d2d6b 0%, #1a4a9e 38%, #1e6bbf 72%, #2196d3 100%)";

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: "hsl(var(--background))" }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: "hsl(var(--accent))", borderTopColor: "transparent" }} />
          <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Chargement…</p>
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  return (
      <TacheProvider>
        <ChatProvider>
          <div className="flex flex-col h-screen overflow-hidden" style={{ background: "hsl(var(--background))" }}>
            {/* Barre supérieure : fond dégradé (même habillage que
                AccueilLauncher.tsx) ; TopNav posé sur une pastille claire
                flottante, car son texte/icônes sont pensés pour un fond
                clair (variables --foreground/--card du thème) — pas
                touché en interne, juste encapsulé. */}
            <header
              className="flex items-center gap-3 px-4 py-2 flex-shrink-0"
              style={{ background: TB_GRADIENT, boxShadow: "0 2px 12px rgba(0,0,0,0.22), 0 1px 0 rgba(255,255,255,0.06)" }}
            >
              <div
                className="flex items-center min-w-0 flex-1 rounded-[10px] px-2 py-1"
                style={{ background: "hsl(var(--card))", boxShadow: "0 1px 3px rgba(0,0,0,0.15)" }}
              >
                <TopNav />
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <SelecteurSociete className="w-44 hidden lg:block" />
                <SelecteurEspace className="w-44 hidden md:block" />
                <BadgeIdentite variant="sombre" size={34} showRole={false} className="hidden sm:flex" />
                <NotificationBell variant="sombre" />
              </div>
            </header>

            <main className="flex-1 overflow-y-auto">
              <ReturnTrail />
              <Outlet />
            </main>
          </div>
        </ChatProvider>
      </TacheProvider>
  );
};

export default AppLayout;
