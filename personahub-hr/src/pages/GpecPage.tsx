import React, { useState } from "react";
import { useNavigate, useLocation, Outlet } from "react-router-dom";
import { Users, Briefcase, TrendingUp, BookOpen, Target, ChevronRight } from "lucide-react";

interface GpecModule {
  icon: React.ReactNode;
  label: string;
  description: string;
  path: string;
  available: boolean;
  color: string;
}

const modules: (Omit<GpecModule, "color"> & { token: string })[] = [
  {
    icon: <Briefcase size={28} />,
    label: "Postes",
    description: "Référentiel des postes par unité organisationnelle, gestion des états et des transitions.",
    path: "/gpec/postes",
    available: true,
    token: "accent",
  },
  {
    icon: <Users size={28} />,
    label: "Emplois & Métiers",
    description: "Cartographie des emplois et des métiers de l'organisation.",
    path: "/gpec/emplois",
    available: false,
    token: "primary",
  },
  {
    icon: <BookOpen size={28} />,
    label: "Compétences",
    description: "Référentiel des compétences et niveaux de maîtrise requis.",
    path: "/gpec/competences",
    available: false,
    token: "success",
  },
  {
    icon: <TrendingUp size={28} />,
    label: "Plans de développement",
    description: "Suivi des plans de carrière et de développement des collaborateurs.",
    path: "/gpec/plans",
    available: false,
    token: "warning",
  },
  {
    icon: <Target size={28} />,
    label: "Objectifs & Évaluations",
    description: "Gestion des objectifs individuels et campagnes d'évaluation.",
    path: "/gpec/evaluations",
    available: false,
    token: "secondary",
  },
];

const GpecPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="max-w-6xl mx-auto">
      {/* Fil d'Ariane */}
      <div className="flex items-center gap-1.5 px-6 pt-4 pb-2 text-[13px]" style={{ color: "hsl(var(--muted-foreground))" }}>
        <span className="font-semibold" style={{ color: "hsl(var(--foreground))" }}>GPEC</span>
        <span className="ml-1 text-[12px]" style={{ opacity: 0.7 }}>· Gestion Prévisionnelle des Emplois et des Compétences</span>
      </div>

      <div className="p-6">
      {/* Modules */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {modules.map(mod => (
          <button
            key={mod.path}
            onClick={() => mod.available && navigate(mod.path)}
            disabled={!mod.available}
            className="p-5 text-left transition-all group"
            style={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "var(--radius)",
              opacity: mod.available ? 1 : 0.5,
              cursor: mod.available ? "pointer" : "not-allowed",
              boxShadow: "none",
            }}
            onMouseEnter={e => {
              if (mod.available) {
                (e.currentTarget as HTMLElement).style.borderColor = `hsl(var(--${mod.token}))`;
                (e.currentTarget as HTMLElement).style.boxShadow = `0 4px 20px hsl(var(--${mod.token}) / 0.15)`;
              }
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.borderColor = "hsl(var(--border))";
              (e.currentTarget as HTMLElement).style.boxShadow = "none";
            }}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{ background: `hsl(var(--${mod.token}) / 0.14)`, color: `hsl(var(--${mod.token}))` }}>
                {mod.icon}
              </div>
              {mod.available && (
                <ChevronRight size={16} style={{ color: "hsl(var(--muted-foreground))", marginTop: 4 }} />
              )}
              {!mod.available && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ background: "hsl(var(--muted)/0.5)", color: "hsl(var(--muted-foreground))" }}>
                  À venir
                </span>
              )}
            </div>
            <h3 className="font-semibold text-base mb-1" style={{ color: "hsl(var(--foreground))" }}>
              {mod.label}
            </h3>
            <p className="text-xs leading-relaxed" style={{ color: "hsl(var(--muted-foreground))" }}>
              {mod.description}
            </p>
          </button>
        ))}
      </div>
      </div>
    </div>
  );
};

export default GpecPage;
