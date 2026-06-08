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

const modules: GpecModule[] = [
  {
    icon: <Briefcase size={28} />,
    label: "Postes",
    description: "Référentiel des postes par unité organisationnelle, gestion des états et des transitions.",
    path: "/gpec/postes",
    available: true,
    color: "hsl(var(--accent))",
  },
  {
    icon: <Users size={28} />,
    label: "Emplois & Métiers",
    description: "Cartographie des emplois et des métiers de l'organisation.",
    path: "/gpec/emplois",
    available: false,
    color: "hsl(213 73% 45%)",
  },
  {
    icon: <BookOpen size={28} />,
    label: "Compétences",
    description: "Référentiel des compétences et niveaux de maîtrise requis.",
    path: "/gpec/competences",
    available: false,
    color: "hsl(142 70% 40%)",
  },
  {
    icon: <TrendingUp size={28} />,
    label: "Plans de développement",
    description: "Suivi des plans de carrière et de développement des collaborateurs.",
    path: "/gpec/plans",
    available: false,
    color: "hsl(39 95% 40%)",
  },
  {
    icon: <Target size={28} />,
    label: "Objectifs & Évaluations",
    description: "Gestion des objectifs individuels et campagnes d'évaluation.",
    path: "/gpec/evaluations",
    available: false,
    color: "hsl(280 65% 50%)",
  },
];

const GpecPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* En-tête */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "hsl(var(--accent)/0.15)", color: "hsl(var(--accent))" }}>
            <Target size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold" style={{ color: "hsl(var(--foreground))" }}>
              GPEC
            </h1>
            <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
              Gestion Prévisionnelle des Emplois et des Compétences
            </p>
          </div>
        </div>
      </div>

      {/* Modules */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {modules.map(mod => (
          <button
            key={mod.path}
            onClick={() => mod.available && navigate(mod.path)}
            disabled={!mod.available}
            className="rounded-xl border p-5 text-left transition-all group"
            style={{
              background: "hsl(var(--card))",
              borderColor: mod.available ? "hsl(var(--border))" : "hsl(var(--border))",
              opacity: mod.available ? 1 : 0.5,
              cursor: mod.available ? "pointer" : "not-allowed",
              boxShadow: "none",
            }}
            onMouseEnter={e => {
              if (mod.available) {
                (e.currentTarget as HTMLElement).style.borderColor = mod.color;
                (e.currentTarget as HTMLElement).style.boxShadow = `0 4px 20px ${mod.color}20`;
              }
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.borderColor = "hsl(var(--border))";
              (e.currentTarget as HTMLElement).style.boxShadow = "none";
            }}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{ background: `${mod.color}18`, color: mod.color }}>
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
  );
};

export default GpecPage;
