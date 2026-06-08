import React, { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Users, Briefcase, CreditCard, BookOpen, TrendingUp, AlertCircle, CheckCircle, Clock, Settings2, Eye, EyeOff, CalendarRange } from "lucide-react";
import { useKpiWidgets, KpiPeriodFilter } from "@/hooks/useKpiWidgets";

import { useManagerPopulation } from "@/hooks/useManagerPopulation";
import KpiWidget, { KpiWidgetsSkeleton } from "@/components/KpiWidget";
import { Button } from "@/components/ui/button";

const roleLabels: Record<string, string> = {
  administrateur: "Administrateur",
  gestionnaire_rh: "Gestionnaire RH",
  gestionnaire_paie: "Gestionnaire Paie",
  manager: "Manager",
  collaborateur: "Collaborateur",
};

const roleBanners: Record<string, { title: string; subtitle: string; color: string }> = {
  administrateur: { title: "Espace Administrateur", subtitle: "Vue complète du système et gestion globale", color: "hsl(var(--primary))" },
  gestionnaire_rh: { title: "Espace Gestionnaire RH", subtitle: "Gestion des collaborateurs et des contrats", color: "hsl(197 100% 42%)" },
  gestionnaire_paie: { title: "Espace Gestionnaire Paie", subtitle: "Traitement des salaires et des cotisations", color: "hsl(84 55% 45%)" },
  manager: { title: "Espace Manager", subtitle: "Suivi de votre équipe et des performances", color: "hsl(39 95% 50%)" },
  collaborateur: { title: "Mon Espace Collaborateur", subtitle: "Vos informations personnelles et administratives", color: "hsl(280 60% 55%)" },
};

const Dashboard: React.FC = () => {
  const { role, profile, user } = useAuth();
  const banner = roleBanners[role || "collaborateur"];
  const [editMode, setEditMode] = useState(false);
  const currentYear = new Date().getFullYear();
  const [periodFilter, setPeriodFilter] = useState<KpiPeriodFilter>({
    dateDebut: `${currentYear}-01-01`,
    dateFin: `${currentYear}-12-31`,
  });

  // RG-KPI-MANAGER-01 : Charger la population du manager pour filtrer les KPIs
  const isManager = role === "manager";
  const { collaborateurIds: managerCollabIds, loading: popLoading } = useManagerPopulation();

  // RG-KPI-WIDGET-PERSO-01 : Charger les KPIs avec préférences utilisateur
  // Pour le manager : attendre la population avant de charger
  const kpiReady = !isManager || !popLoading;
  const { widgets, allPublications, loading: kpiLoading, toggleWidget, isVisible } = useKpiWidgets(
    role || "collaborateur",
    user?.id,
    isManager ? managerCollabIds : undefined,
    periodFilter
  );

  const stats = [
    { label: "Collaborateurs actifs", value: "—", icon: <Users size={20} />, color: "hsl(197 100% 47%)" },
    { label: "Contrats en cours", value: "—", icon: <Briefcase size={20} />, color: "hsl(84 55% 50%)" },
    { label: "Bulletins ce mois", value: "—", icon: <CreditCard size={20} />, color: "hsl(var(--primary))" },
    { label: "Référentiels", value: "33", icon: <BookOpen size={20} />, color: "hsl(39 95% 55%)" },
  ];

  const activities = [
    { icon: <CheckCircle size={14} />, text: "Référentiels initialisés avec succès", time: "À l'instant", color: "hsl(84 55% 50%)" },
    { icon: <Clock size={14} />, text: "En attente de données collaborateurs", time: "—", color: "hsl(39 95% 55%)" },
    { icon: <AlertCircle size={14} />, text: "Configurez vos paramètres d'apparence", time: "—", color: "hsl(197 100% 47%)" },
  ];

  const hasKpiContent = kpiLoading || allPublications.length > 0;

  return (
    <div className="p-6 space-y-6">
      {/* Banner */}
      <div
        className="rounded-2xl p-6 text-white relative overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${banner.color}, hsl(var(--primary)))` }}
      >
        <div className="absolute top-0 right-0 w-64 h-64 rounded-full opacity-10" style={{ background: "white", transform: "translate(30%, -30%)" }} />
        <div className="relative">
          <p className="text-sm font-medium mb-1 opacity-80">Bonjour, {profile?.prenom || "Utilisateur"} 👋</p>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "Poppins, sans-serif" }}>{banner.title}</h1>
          <p className="text-sm mt-1 opacity-70">{banner.subtitle}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map(stat => (
          <div key={stat.label} className="card-stat">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>{stat.label}</p>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${stat.color}1A`, color: stat.color }}>
                {stat.icon}
              </div>
            </div>
            <p className="card-stat-value">{stat.value}</p>
            <div className="flex items-center gap-1 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
              <TrendingUp size={11} />
              <span>À alimenter</span>
            </div>
          </div>
        ))}
      </div>

      {/* =====================================================
           RG-KPI-WIDGET-PERSO-01 : Widgets KPI personnalisables
           L'utilisateur peut activer/désactiver les widgets
           autorisés par l'admin pour son rôle
           ===================================================== */}
      {hasKpiContent && (
        <div>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
            <h2 className="text-base font-semibold" style={{ fontFamily: "Poppins, sans-serif", color: "hsl(var(--foreground))" }}>
              Indicateurs RH
            </h2>
            <div className="flex items-center gap-3 flex-wrap">
              {/* Filtre période */}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs" style={{ background: "hsl(var(--muted))", border: "1px solid hsl(var(--border))" }}>
                <CalendarRange size={13} style={{ color: "hsl(var(--muted-foreground))" }} />
                <label className="font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Du</label>
                <input
                  type="date"
                  value={periodFilter.dateDebut || ""}
                  onChange={e => setPeriodFilter(p => ({ ...p, dateDebut: e.target.value }))}
                  className="px-2 py-1 rounded border text-xs outline-none"
                  style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
                />
                <label className="font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Au</label>
                <input
                  type="date"
                  value={periodFilter.dateFin || ""}
                  onChange={e => setPeriodFilter(p => ({ ...p, dateFin: e.target.value }))}
                  className="px-2 py-1 rounded border text-xs outline-none"
                  style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
                />
              </div>
              {/* Bouton mode édition */}
              {allPublications.length > 0 && !kpiLoading && (
                <Button
                  variant={editMode ? "default" : "outline"}
                  size="sm"
                  onClick={() => setEditMode(e => !e)}
                  className="gap-1 text-xs"
                >
                  <Settings2 size={13} />
                  {editMode ? "Terminer" : "Personnaliser"}
                </Button>
              )}
            </div>
          </div>

          {kpiLoading ? (
            <div className="rounded-xl p-4" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
              <KpiWidgetsSkeleton />
            </div>
          ) : editMode ? (
            // Mode édition : afficher TOUS les widgets autorisés avec toggle
            <div className="rounded-xl p-4 space-y-3" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
              <p className="text-xs mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>
                Activez ou désactivez les indicateurs visibles sur votre tableau de bord.
              </p>
              <div className="space-y-2">
                {allPublications.map((pub: any) => {
                  const kpi = pub.kpi_configs;
                  if (!kpi) return null;
                  const visible = isVisible(pub.id);
                  return (
                    <div
                      key={pub.id}
                      className="flex items-center justify-between p-3 rounded-lg transition-all"
                      style={{
                        background: visible ? "hsl(var(--primary)/0.06)" : "hsl(var(--muted))",
                        border: `1px solid ${visible ? "hsl(var(--primary)/0.2)" : "hsl(var(--border))"}`,
                      }}
                    >
                      <div>
                        <p className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>{kpi.libelle}</p>
                        {kpi.description && (
                          <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{kpi.description}</p>
                        )}
                      </div>
                      <button
                        onClick={() => toggleWidget(pub.id, visible)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                        style={{
                          background: visible ? "hsl(var(--primary))" : "hsl(var(--muted-foreground)/0.15)",
                          color: visible ? "white" : "hsl(var(--muted-foreground))",
                        }}
                      >
                        {visible ? <Eye size={12} /> : <EyeOff size={12} />}
                        {visible ? "Visible" : "Masqué"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : widgets.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {widgets.map(widget => (
                <KpiWidget key={widget.id} widget={widget} />
              ))}
            </div>
          ) : (
            <div className="rounded-xl p-6 text-center" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
              <EyeOff size={24} className="mx-auto mb-2" style={{ color: "hsl(var(--muted-foreground))" }} />
              <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                Tous les indicateurs sont masqués.{" "}
                <button onClick={() => setEditMode(true)} className="underline" style={{ color: "hsl(var(--primary))" }}>
                  Personnaliser
                </button>
              </p>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Activité récente */}
        <div className="lg:col-span-2 rounded-xl p-5" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", boxShadow: "var(--shadow-sm)" }}>
          <h2 className="text-base font-semibold mb-4" style={{ fontFamily: "Poppins, sans-serif" }}>Activité récente</h2>
          <div className="space-y-3">
            {activities.map((a, i) => (
              <div key={i} className="flex items-center gap-3 py-2 border-b last:border-0" style={{ borderColor: "hsl(var(--border))" }}>
                <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: `${a.color}1A`, color: a.color }}>
                  {a.icon}
                </div>
                <p className="text-sm flex-1">{a.text}</p>
                <p className="text-xs flex-shrink-0" style={{ color: "hsl(var(--muted-foreground))" }}>{a.time}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Accès rapides */}
        <div className="rounded-xl p-5" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", boxShadow: "var(--shadow-sm)" }}>
          <h2 className="text-base font-semibold mb-4" style={{ fontFamily: "Poppins, sans-serif" }}>Accès rapides</h2>
          <div className="space-y-2">
            {[
              { label: "Gérer les référentiels", path: "/referentiels", color: "hsl(197 100% 47%)" },
              { label: "Mon apparence", path: "/apparence", color: "hsl(84 55% 50%)" },
              { label: "Mon profil", path: "/profil", color: "hsl(var(--primary))" },
            ].map(link => (
              <a
                key={link.path} href={link.path}
                className="flex items-center justify-between px-4 py-3 rounded-lg text-sm font-medium transition-all hover:translate-x-1"
                style={{ background: `${link.color}12`, color: link.color, border: `1px solid ${link.color}30` }}
              >
                {link.label}
                <span>→</span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
