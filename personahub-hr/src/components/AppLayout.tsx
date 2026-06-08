import React from "react";
import { Outlet, Navigate } from "react-router-dom";
import Sidebar from "./Sidebar";
import NotificationBell from "./NotificationBell";
import { useAuth } from "@/contexts/AuthContext";
import { ChatProvider } from "@/contexts/ChatContext";

const AppLayout: React.FC = () => {
  const { user, loading } = useAuth();

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
    <ChatProvider>
      <div className="flex h-screen overflow-hidden" style={{ background: "hsl(var(--background))" }}>
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Topbar avec cloche */}
          <header
            className="flex items-center justify-end px-4 py-2 flex-shrink-0 border-b"
            style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
          >
            <NotificationBell />
          </header>
          <main className="flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </ChatProvider>
  );
};

export default AppLayout;
