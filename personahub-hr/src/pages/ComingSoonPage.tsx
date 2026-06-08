import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Construction, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * ComingSoonPage — Affiché pour les modules en cours de développement.
 * Remplace les routes fantômes qui menaient à une page 404.
 */
const ComingSoonPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  // Formater le chemin en titre lisible
  const pathLabel = location.pathname
    .split("/")
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, " "))
    .join(" › ");

  return (
    <div
      className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-4"
    >
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{ background: "hsl(var(--muted))" }}
      >
        <Construction size={28} style={{ color: "hsl(var(--muted-foreground))" }} />
      </div>

      <div>
        <p
          className="text-xs font-medium mb-2 uppercase tracking-widest"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Module en développement
        </p>
        <h1 className="text-xl font-semibold mb-2" style={{ color: "hsl(var(--foreground))" }}>
          {pathLabel || "Cette section"}
        </h1>
        <p className="text-sm max-w-md" style={{ color: "hsl(var(--muted-foreground))" }}>
          Ce module est en cours de développement et sera disponible prochainement.
          Les fonctionnalités existantes de l'application ne sont pas affectées.
        </p>
      </div>

      <Button
        variant="outline"
        onClick={() => navigate(-1)}
        className="flex items-center gap-2"
      >
        <ArrowLeft size={15} />
        Retour
      </Button>
    </div>
  );
};

export default ComingSoonPage;
