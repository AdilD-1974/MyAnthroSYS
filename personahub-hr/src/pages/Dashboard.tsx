import React, { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  Users, Briefcase, CreditCard, BookOpen, TrendingUp, AlertCircle, CheckCircle,
  Clock, Settings2, Eye, EyeOff, CalendarRange, Shield, Wallet, User, Network,
  CalendarDays, FileText, UserCog, ArrowRight, Sparkles, TreePalm, ClipboardCheck,
  CalendarCheck2, Banknote, ReceiptText, Landmark, KeyRound, Database, Building2,
  ClipboardList, type LucideIcon,
} from "lucide-react";
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

// ------------------------------------------------------------------
// Couleurs pilotées par l'Apparence : on ne fixe plus de teintes en
// dur (hsl(H S% L%)), on référence les tokens du design system.
//   • primary / secondary / accent → personnalisables par le
//     collaborateur depuis "Apparence" (ThemeContext / user_theme_prefs)
//   • warning / info               → tokens sémantiques stables
//     (mêmes couleurs pour tout le monde, quel que soit le thème)
// Ainsi, quand un collaborateur change sa palette dans Apparence,
// le Dashboard suit automatiquement, sans code à modifier.
// ------------------------------------------------------------------
type RoleToken = "primary" | "secondary" | "accent" | "warning" | "info" | "success";
const cssVar = (token: RoleToken) => `hsl(var(--${token}))`;
const cssVarAlpha = (token: RoleToken, alpha: number) => `hsl(var(--${token}) / ${alpha})`;

// Bandeau + icône + couleur par profil
const roleBanners: Record<string, { title: string; subtitle: string; token: RoleToken; icon: React.ReactNode }> = {
  administrateur:    { title: "Espace Administrateur",     subtitle: "Vue complète du système et gestion globale",        token: "primary",   icon: <Shield size={22} /> },
  gestionnaire_rh:   { title: "Espace Gestionnaire RH",    subtitle: "Gestion des collaborateurs et des contrats",        token: "info",      icon: <Users size={22} /> },
  gestionnaire_paie: { title: "Espace Gestionnaire Paie",  subtitle: "Traitement des salaires et des cotisations",        token: "secondary", icon: <Wallet size={22} /> },
  manager:           { title: "Espace Manager",            subtitle: "Suivi de votre équipe et des performances",         token: "warning",   icon: <Briefcase size={22} /> },
  collaborateur:     { title: "Mon Espace Collaborateur",  subtitle: "Vos informations personnelles et administratives",  token: "accent",    icon: <User size={22} /> },
};

// Accès rapides propres à chaque profil (chemins réels de App.tsx)
type Lien = { label: string; path: string; token: RoleToken; icon: LucideIcon };
const roleLinks: Record<string, Lien[]> = {
  administrateur: [
    { label: "Gestion de la navigation", path: "/admin/navigation", token: "info",      icon: Network },
    { label: "Utilisateurs",             path: "/utilisateurs",      token: "accent",    icon: UserCog },
    { label: "Référentiels",             path: "/referentiels",      token: "secondary", icon: Database },
    { label: "Paramètres RH",            path: "/parametres-rh",     token: "primary",   icon: Settings2 },
  ],
  gestionnaire_rh: [
    { label: "Collaborateurs",        path: "/collaborateurs",   token: "info",      icon: Users },
    { label: "Organisations",         path: "/organisations",    token: "secondary", icon: Building2 },
    { label: "Gestion des demandes",  path: "/gestion-demandes", token: "warning",   icon: ClipboardList },
    { label: "Référentiels",          path: "/referentiels",     token: "primary",   icon: Database },
  ],
  gestionnaire_paie: [
    { label: "Traitement de la paie", path: "/paie/traitement",        token: "secondary", icon: Banknote },
    { label: "Éditions / bulletins",  path: "/paie/editions-paie",          token: "info",      icon: ReceiptText },
    { label: "Déclaration CNSS",      path: "/paie/declarations/cnss", token: "warning",   icon: Landmark },
    { label: "Salaires fixes",        path: "/paie/salaires-fixes",    token: "primary",   icon: Wallet },
  ],
  manager: [
    { label: "Mon équipe",              path: "/mon-equipe",                   token: "warning",   icon: Briefcase },
    { label: "Validation des demandes", path: "/espace-manager/demandes",      token: "info",      icon: ClipboardCheck },
    { label: "Congés de l'équipe",      path: "/espace-manager/conges",        token: "secondary", icon: TreePalm },
    { label: "Planning",                path: "/espace-manager/conges/planning", token: "primary",  icon: CalendarCheck2 },
  ],
  collaborateur: [
    { label: "Mon espace",        path: "/mon-espace",      token: "accent",    icon: User },
    { label: "Saisir un congé",   path: "/absences/saisie", token: "info",      icon: TreePalm },
    { label: "Mes tâches",        path: "/taches",          token: "secondary", icon: ClipboardList },
    { label: "Mon profil",        path: "/profile",         token: "primary",   icon: UserCog },
  ],
};

const Dashboard: React.FC = () => {
  const { role, profile, user } = useAuth();
  const roleKey = role || "collaborateur";
  const banner = roleBanners[roleKey] ?? roleBanners.collaborateur;
  const liens = roleLinks[roleKey] ?? roleLinks.collaborateur;

  const [editMode, setEditMode] = useState(false);
  const currentYear = new Date().getFullYear();
  const [periodFilter, setPeriodFilter] = useState<KpiPeriodFilter>({
    dateDebut: `${currentYear}-01-01`,
    dateFin: `${currentYear}-12-31`,
  });

  // RG-KPI-MANAGER-01 : population du manager pour filtrer les KPIs (périmètre)
  const isManager = role === "manager";
  const { collaborateurIds: managerCollabIds, loading: popLoading } = useManagerPopulation();
  const kpiReady = !isManager || !popLoading;

  // RG-KPI-WIDGET-PERSO-01 : KPIs du rôle + périmètre + préférences utilisateur
  const { widgets, allPublications, loading: kpiLoading, toggleWidget, isVisible } = useKpiWidgets(
    roleKey,
    user?.id,
    isManager ? managerCollabIds : undefined,
    periodFilter
  );

  // Résumé (KPIs clés en tête) vs détail (le reste, dans la grille personnalisable)
  const resume = widgets.slice(0, 4);
  const detail = widgets.slice(4);

  const activities: { icon: React.ReactNode; text: string; time: string; token: RoleToken }[] = [
    { icon: <CheckCircle size={14} />, text: "Référentiels initialisés avec succès", time: "À l'instant", token: "success" },
    { icon: <Clock size={14} />, text: "En attente de données collaborateurs", time: "—", token: "warning" },
    { icon: <AlertCircle size={14} />, text: "Configurez vos paramètres d'apparence", time: "—", token: "info" },
  ];

  const hasKpiContent = kpiLoading || allPublications.length > 0;

  return (
    <div className="p-6 space-y-6">
      {/* ====================== BANNER (par profil) ====================== */}
      <style>{`
        @keyframes db-glow{0%,100%{opacity:.5}50%{opacity:1}}
        @keyframes db-shine{0%{background-position:200% 0}100%{background-position:-100% 0}}
        @keyframes db-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        .db-anim{animation:db-in .35s ease both}
      `}</style>
      <div className="db-anim rounded-2xl p-6 text-white relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${cssVar(banner.token)}, hsl(var(--primary)))` }}>
        <div className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none">
          <div className="absolute top-0 right-0 w-64 h-64 rounded-full opacity-10" style={{ background: "white", transform: "translate(30%, -30%)" }} />
          <div className="absolute bottom-0 left-10 w-40 h-40 rounded-full" style={{ background: "white", opacity: 0.07, animation: "db-glow 5s ease-in-out infinite" }} />
          {/* Voile brillant qui balaie le bandeau */}
          <div className="absolute inset-0" style={{ background: "linear-gradient(110deg, transparent 25%, rgba(255,255,255,0.14) 45%, transparent 65%)", backgroundSize: "250% 100%", animation: "db-shine 5s ease-in-out infinite" }} />
        </div>
        <div className="relative flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: "rgba(255,255,255,0.18)", border: "1px solid rgba(255,255,255,0.3)", boxShadow: "0 4px 16px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.25)" }}>
              {banner.icon}
            </div>
            <div>
              <p className="text-sm font-medium mb-1 opacity-80">Bonjour, {profile?.prenom || "Utilisateur"} 👋</p>
              <h1 className="text-2xl font-bold" style={{ fontFamily: "Poppins, sans-serif" }}>{banner.title}</h1>
              <p className="text-sm mt-1 opacity-70">{banner.subtitle}</p>
            </div>
          </div>
          <span className="relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: "rgba(255,255,255,0.16)", border: "1px solid rgba(255,255,255,0.28)" }}>
            <Sparkles size={12} /> {roleLabels[roleKey]}
          </span>
        </div>
      </div>

      {/* ====================== RÉSUMÉ (KPIs clés du rôle) ====================== */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold flex items-center gap-2" style={{ fontFamily: "Poppins, sans-serif", color: "hsl(var(--foreground))" }}>
            <TrendingUp size={16} style={{ color: cssVar(banner.token) }} />
            En un coup d'œil — {roleLabels[roleKey]}
          </h2>
          {isManager && (
            <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: cssVarAlpha("warning", 0.12), color: cssVar("warning") }}>
              Périmètre : votre équipe ({managerCollabIds?.length ?? 0})
            </span>
          )}
        </div>

        {(kpiLoading || !kpiReady) ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="card-stat animate-pulse" style={{ minHeight: 110 }} />
            ))}
          </div>
        ) : resume.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {resume.map(widget => <KpiWidget key={widget.id} widget={widget} />)}
          </div>
        ) : (
          <div className="rounded-xl p-6 text-center" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
            <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
              Aucun indicateur publié pour le profil « {roleLabels[roleKey]} ».{" "}
              {role === "administrateur" && "Publiez des KPIs depuis la configuration des indicateurs."}
            </p>
          </div>
        )}
      </div>

      {/* ====================== INDICATEURS DÉTAILLÉS (personnalisables) ====================== */}
      {hasKpiContent && (
        <div>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
            <h2 className="text-base font-semibold" style={{ fontFamily: "Poppins, sans-serif", color: "hsl(var(--foreground))" }}>
              Indicateurs détaillés
            </h2>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs" style={{ background: "hsl(var(--muted))", border: "1px solid hsl(var(--border))" }}>
                <CalendarRange size={13} style={{ color: "hsl(var(--muted-foreground))" }} />
                <label className="font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Du</label>
                <input type="date" value={periodFilter.dateDebut || ""} onChange={e => setPeriodFilter(p => ({ ...p, dateDebut: e.target.value }))}
                  className="px-2 py-1 rounded border text-xs outline-none" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }} />
                <label className="font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Au</label>
                <input type="date" value={periodFilter.dateFin || ""} onChange={e => setPeriodFilter(p => ({ ...p, dateFin: e.target.value }))}
                  className="px-2 py-1 rounded border text-xs outline-none" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }} />
              </div>
              {allPublications.length > 0 && !kpiLoading && (
                <Button variant={editMode ? "default" : "outline"} size="sm" onClick={() => setEditMode(e => !e)} className="gap-1 text-xs">
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
                    <div key={pub.id} className="flex items-center justify-between p-3 rounded-lg transition-all"
                      style={{ background: visible ? "hsl(var(--primary)/0.06)" : "hsl(var(--muted))", border: `1px solid ${visible ? "hsl(var(--primary)/0.2)" : "hsl(var(--border))"}` }}>
                      <div>
                        <p className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>{kpi.libelle}</p>
                        {kpi.description && <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{kpi.description}</p>}
                      </div>
                      <button onClick={() => toggleWidget(pub.id, visible)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                        style={{ background: visible ? "hsl(var(--primary))" : "hsl(var(--muted-foreground)/0.15)", color: visible ? "white" : "hsl(var(--muted-foreground))" }}>
                        {visible ? <Eye size={12} /> : <EyeOff size={12} />}
                        {visible ? "Visible" : "Masqué"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : detail.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {detail.map(widget => <KpiWidget key={widget.id} widget={widget} />)}
            </div>
          ) : (
            <div className="rounded-xl p-6 text-center" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
              <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                Les indicateurs clés sont déjà affichés dans le résumé ci-dessus.{" "}
                <button onClick={() => setEditMode(true)} className="underline" style={{ color: "hsl(var(--primary))" }}>Personnaliser</button>
              </p>
            </div>
          )}
        </div>
      )}

      {/* ====================== ACTIVITÉ + ACCÈS RAPIDES (par profil) ====================== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl p-5" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", boxShadow: "var(--shadow-sm)" }}>
          <h2 className="text-base font-semibold mb-4" style={{ fontFamily: "Poppins, sans-serif" }}>Activité récente</h2>
          <div className="relative">
            {activities.map((a, i) => (
              <div key={i} className="relative flex items-start gap-3 pb-4 last:pb-0">
                {i < activities.length - 1 && (
                  <div className="absolute left-[11px] top-6 bottom-0 w-px" style={{ background: "hsl(var(--border))" }} />
                )}
                <div className="relative w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 z-10" style={{ background: cssVarAlpha(a.token, 0.12), color: cssVar(a.token), border: `1px solid ${cssVarAlpha(a.token, 0.3)}` }}>{a.icon}</div>
                <div className="flex-1 flex items-center justify-between gap-3 pt-0.5">
                  <p className="text-sm">{a.text}</p>
                  <p className="text-xs flex-shrink-0" style={{ color: "hsl(var(--muted-foreground))" }}>{a.time}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl p-5" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", boxShadow: "var(--shadow-sm)" }}>
          <h2 className="text-base font-semibold mb-4" style={{ fontFamily: "Poppins, sans-serif" }}>Accès rapides</h2>
          <div className="space-y-2">
            {liens.map(link => {
              const LinkIcon = link.icon;
              return (
                <a key={link.path} href={link.path}
                  className="group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all hover:translate-x-1"
                  style={{ background: cssVarAlpha(link.token, 0.08), border: `1px solid ${cssVarAlpha(link.token, 0.22)}` }}>
                  <span className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110 group-hover:-rotate-3"
                    style={{ background: cssVarAlpha(link.token, 0.16), color: cssVar(link.token) }}>
                    <LinkIcon size={17} strokeWidth={1.9} />
                  </span>
                  <span className="flex-1" style={{ color: cssVar(link.token) }}>{link.label}</span>
                  <ArrowRight size={15} className="flex-shrink-0 transition-transform group-hover:translate-x-0.5" style={{ color: cssVar(link.token) }} />
                </a>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
