// ============================================================
// Sidebar.tsx — src/components/Sidebar.tsx  (v5)
// ------------------------------------------------------------
// • Utilise les VRAIS tokens du design system (index.css) :
//     --sidebar-background / --sidebar-foreground /
//     --sidebar-primary / --sidebar-accent / --sidebar-border /
//     --destructive ...
//   → sidebar bleu nuit ANTHRO-SYS, actif teal, texte clair.
//   → pilotée par la page Apparence (ThemeContext écrit ces vars).
// • Responsive : persistante en desktop (repliable), tiroir en
//   mobile/tablette (hamburger dans AppLayout, voile, auto-close).
// • Arbre parent/enfant, filtrage par rôle actif, sélecteur de
//   rôle, badges, logo ANTHRO-SYS.
// ============================================================

import React, { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard, User, Users, CheckSquare, MessageSquare,
  FileText, Calendar, CalendarDays, CreditCard, GitBranch, Shield,
  ShieldCheck, Navigation, Palette, Settings, Sliders, Bell, LogOut,
  BarChart2, Building2, Briefcase, Wallet, Network, BookOpen,
  DoorOpen, ArrowRightLeft, HandCoins, Image, FileStack, UserPlus,
  GraduationCap, Target, HeartHandshake, ClipboardList,
  ChevronDown, ChevronRight, ChevronLeft, Menu, X, LucideIcon, LayoutGrid,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { useNav } from "@/contexts/NavContext";
import { useChatContext } from "@/contexts/ChatContext";
import { useTaches } from "@/contexts/TacheContext";
import AnthroSysLogo from "@/components/AnthroSysLogo";
import { type NavItem, couleurModule } from "@/lib/navApi";
import { getBranding, type Branding } from "@/lib/branding";

interface SidebarProps {
  mobileOpen?: boolean;
  onClose?: () => void;
}

// ── Classes tokenisées (réutilisées) ──────────────────────────
const C = {
  aside:
    "bg-[hsl(var(--sidebar-background))] text-[hsl(var(--sidebar-foreground))] border-[hsl(var(--sidebar-border))]",
  sep: "border-[hsl(var(--sidebar-border))]",
  itemBase:
    "text-[hsl(var(--sidebar-foreground)_/_0.85)] hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-foreground))]",
  itemActive:
    "bg-[hsl(var(--sidebar-primary))] text-[hsl(var(--sidebar-primary-foreground))]",
  muted: "text-[hsl(var(--sidebar-foreground)_/_0.5)]",
  accentBg: "bg-[hsl(var(--sidebar-accent))]",
  badge:
    "bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))]",
};

const ICONES: Record<string, LucideIcon> = {
  LayoutDashboard, User, Users, CheckSquare, MessageSquare,
  FileText, Calendar, CalendarDays, CreditCard, GitBranch, Shield,
  ShieldCheck, Navigation, Palette, Settings, Sliders, Bell, LogOut,
  BarChart2, Building2, Briefcase, Wallet, Network, BookOpen,
  DoorOpen, ArrowRightLeft, HandCoins, Image, FileStack, UserPlus,
  GraduationCap, Target, HeartHandshake, ClipboardList,
};


function NavIcone({ nom, size = 18, couleur }: { nom?: string; size?: number; couleur?: string }) {
  if (!nom) return null;
  const Ic = ICONES[nom];
  const style = couleur ? { color: couleur } : undefined;
  return Ic ? <Ic size={size} style={style} /> : <span className="w-5 h-5 text-xs font-mono" style={style}>{nom.slice(0, 2)}</span>;
}

function BadgeOverlay({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className={`absolute -top-1 -right-1 w-4 h-4 rounded-full ${C.badge} text-[10px] flex items-center justify-center font-medium`}>
      {count > 9 ? "9+" : count}
    </span>
  );
}

function aplatir(items: NavItem[]): NavItem[] {
  const out: NavItem[] = [];
  const walk = (arr?: NavItem[]) =>
    arr?.forEach((i) => { out.push(i); if (i.enfants?.length) walk(i.enfants); });
  walk(items);
  return out;
}

function visibleParRole(item: NavItem, role: string): boolean {
  const roles = item.roles;
  if (!roles || roles.length === 0) return true;
  return roles.includes(role);
}

function construireArbre(items: NavItem[]): NavItem[] {
  const parId = new Map<string, NavItem>();
  items.forEach((i) => parId.set(i.id, { ...i, enfants: [] }));
  const racines: NavItem[] = [];
  parId.forEach((node) => {
    const parent = node.parent_id ? parId.get(node.parent_id) : undefined;
    if (parent) parent.enfants!.push(node);
    else racines.push(node);
  });
  const trier = (arr: NavItem[]) => {
    arr.sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));
    arr.forEach((n) => n.enfants && trier(n.enfants));
  };
  trier(racines);
  return racines;
}

function elaguer(nodes: NavItem[]): NavItem[] {
  return nodes.filter((n) => {
    if (n.enfants && n.enfants.length) {
      n.enfants = elaguer(n.enfants);
      return n.enfants.length > 0;
    }
    return !!n.chemin;
  });
}

export default function Sidebar({ mobileOpen = false, onClose = () => {} }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeRole, allRoles, signOut } = useAuth();
  const { sections, loading } = useNav();
  const { nonLusTotal } = useChatContext();
  const { badge: badgeTaches } = useTaches();

  // Onglet courant pour les ecrans pilotes par ?tab= (ex. /espace-manager)
  const tabCourant = new URLSearchParams(location.search).get("tab");

  // Actif "personnalise" : la famille "/espace-manager" partage le meme pathname
  // et se distingue par ?tab=. NavLink (matching natif par prefixe) en allumerait
  // plusieurs a la fois -> on tranche nous-memes pour cette famille.
  //  - retourne null  -> pas concerne : on laisse le isActive natif de NavLink
  //  - retourne bool  -> on force l'etat actif/inactif (definitif)
  const BASE_MGR = "/espace-manager";
  const actifPersonnalise = (chemin?: string): boolean | null => {
    if (!chemin) return null;
    const [path, query] = chemin.split("?");

    // Famille "/espace-manager" (la base exacte, avec ou sans ?tab=) :
    // traitement DEFINITIF pour eviter le prefix-matching (qui allumerait
    // ces entrees aussi sur /espace-manager/delegations, /espace-manager/conges/...).
    if (path === BASE_MGR) {
      if (location.pathname !== BASE_MGR) return false;   // on est sur une sous-route -> inactif
      if (query) {                                         // /espace-manager?tab=X
        const tabLien = new URLSearchParams(query).get("tab");
        return tabCourant === tabLien;
      }
      // "Vue d'ensemble" -> /espace-manager : actif si aucun onglet ou onglet par defaut
      return !tabCourant || tabCourant === "dashboard";
    }

    // Tout le reste (sous-routes, autres pages) -> comportement natif de NavLink
    return null;
  };

  const [collapsed, setCollapsed] = useState(false);
  const [fermes, setFermes] = useState<Set<string>>(new Set());

  // À la connexion : ne laisser dépliée que la section « Principal »,
  // replier toutes les autres. Appliqué une seule fois (au montage),
  // pour ne pas écraser les choix manuels lors d'un rafraîchissement.
  const initRepli = useRef(false);
  useEffect(() => {
    if (initRepli.current) return;
    if (!sections || sections.length === 0) return;
    const estPrincipal = (sec: { code?: string; label?: string }) =>
      [sec.code, sec.label].some((v) => (v ?? "").toLowerCase().trim() === "principal");
    if (!sections.some(estPrincipal)) { initRepli.current = true; return; }
    setFermes(new Set(sections.filter((sec) => !estPrincipal(sec)).map((sec) => sec.id)));
    initRepli.current = true;
  }, [sections]);

  // Marque client (titulaire de la licence) — globale, mise à jour en direct
  const [branding, setBrandingState] = useState<Branding>(getBranding());
  useEffect(() => {
    const maj = () => setBrandingState(getBranding());
    window.addEventListener("branding:change", maj);
    return () => window.removeEventListener("branding:change", maj);
  }, []);

  const [estDesktop, setEstDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const maj = () => setEstDesktop(mq.matches);
    maj();
    mq.addEventListener("change", maj);
    return () => mq.removeEventListener("change", maj);
  }, []);

  const mini = collapsed && estDesktop;

  const toggleFerme = (id: string) =>
    setFermes((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const roleActif = activeRole ?? allRoles[0] ?? "collaborateur";

  const fermerSiMobile = () => { if (!estDesktop) onClose(); };
  const handleLogout = () => { fermerSiMobile(); signOut(); navigate("/login"); };
  const badgeDe = (code: string) =>
    code === "messages" ? nonLusTotal : code === "taches" ? badgeTaches.en_retard : 0;

  const renderNode = (node: NavItem, depth: number): React.ReactNode => {
    const aEnfants = !!node.enfants?.length;
    const indent = { paddingLeft: 8 + depth * 14 };

    if (aEnfants) {
      const ouvert = !fermes.has(node.id);
      return (
        <div key={node.id}>
          <button
            onClick={() => toggleFerme(node.id)}
            style={indent}
            className={`w-full flex items-center gap-2.5 rounded-lg pr-2 py-2 text-sm transition-colors ${C.itemBase}`}
          >
            <span className="flex-shrink-0"><NavIcone nom={node.icone} size={18} couleur={couleurModule(node.module_code)} /></span>
            <span className="flex-1 truncate text-left">{node.label}</span>
            {ouvert ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {ouvert && (
            <div className="space-y-0.5">{node.enfants!.map((c) => renderNode(c, depth + 1))}</div>
          )}
        </div>
      );
    }

    const badgeCount = badgeDe(node.code);
    return (
      <NavLink
        key={node.id}
        to={node.chemin ?? "#"}
        style={indent}
        onClick={fermerSiMobile}
        className={({ isActive }) => {
          const perso = actifPersonnalise(node.chemin);
          const actif = perso === null ? isActive : perso;
          return `flex items-center gap-2.5 rounded-lg pr-2 py-2 text-sm transition-colors ${actif ? C.itemActive : C.itemBase}`;
        }}
      >
        <span className="relative flex-shrink-0">
          <NavIcone nom={node.icone} size={18} couleur={couleurModule(node.module_code)} />
          <BadgeOverlay count={badgeCount} />
        </span>
        <span className="flex-1 truncate">{node.label}</span>
        {badgeCount > 0 && (
          <span className={`ml-auto text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center ${C.badge}`}>
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        )}
      </NavLink>
    );
  };

  const renderIconeSeule = (leaf: NavItem) => {
    const badgeCount = badgeDe(leaf.code);
    return (
      <NavLink
        key={leaf.id}
        to={leaf.chemin ?? "#"}
        title={leaf.label}
        onClick={fermerSiMobile}
        className={({ isActive }) => {
          const perso = actifPersonnalise(leaf.chemin);
          const actif = perso === null ? isActive : perso;
          return `flex items-center justify-center rounded-lg py-2 transition-colors relative ${actif ? C.itemActive : C.itemBase}`;
        }}
      >
        <NavIcone nom={leaf.icone} size={18} couleur={couleurModule(leaf.module_code)} />
        <BadgeOverlay count={badgeCount} />
      </NavLink>
    );
  };

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={onClose} aria-hidden="true" />
      )}

      <aside
        className={[
          "flex flex-col h-full border-r transition-transform duration-200",
          C.aside,
          "fixed inset-y-0 left-0 z-50 w-64",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          "lg:static lg:z-auto lg:translate-x-0",
          collapsed ? "lg:w-16" : "lg:w-56",
        ].join(" ")}
        aria-label="Navigation principale"
      >
        {/* Logo + actions */}
        <div className={`flex items-center justify-between px-3 py-3 border-b ${C.sep}`}>
          <div className="flex items-center overflow-hidden">
            {branding.logoDataUrl ? (
              <img
                src={branding.logoDataUrl}
                alt={branding.clientName || "Logo client"}
                className={mini ? "h-8 w-8 object-contain rounded" : "h-9 max-w-[150px] object-contain"}
              />
            ) : mini ? (
              <AnthroSysLogo variant="mark" />
            ) : (
              <AnthroSysLogo variant="full" />
            )}
          </div>
          <button
            onClick={() => { fermerSiMobile(); navigate("/bureau"); }}
            className={`hidden lg:inline-flex p-1.5 rounded-lg transition-colors ${C.itemBase}`}
            aria-label="Vue bureau (grille des modules)"
            title="Vue bureau"
          >
            <LayoutGrid size={18} />
          </button>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className={`hidden lg:inline-flex p-1.5 rounded-lg transition-colors ${C.itemBase}`}
            aria-label={collapsed ? "Déplier la sidebar" : "Replier la sidebar"}
          >
            {collapsed ? <Menu size={18} /> : <ChevronLeft size={18} />}
          </button>
          <button
            onClick={() => { fermerSiMobile(); navigate("/bureau"); }}
            className={`lg:hidden p-1.5 rounded-lg transition-colors ${C.itemBase}`}
            aria-label="Vue bureau"
          >
            <LayoutGrid size={18} />
          </button>
          <button
            onClick={onClose}
            className={`lg:hidden p-1.5 rounded-lg transition-colors ${C.itemBase}`}
            aria-label="Fermer le menu"
          >
            <X size={18} />
          </button>
        </div>


        {/* Navigation dynamique (filtrée par rôle actif) */}
        <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
          {loading ? (
            <div className="space-y-1 px-1 pt-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className={`h-8 rounded-lg animate-pulse ${C.accentBg}`} />
              ))}
            </div>
          ) : (
            (sections ?? []).map((section) => {
              const visibles = aplatir(section.items ?? []).filter((i) =>
                i.chemin ? visibleParRole(i, roleActif) : true
              );
              const arbre = elaguer(construireArbre(visibles));
              const feuillesVisibles = visibles.filter((i) => i.chemin);
              const rienAMontrer = (mini ? feuillesVisibles.length : arbre.length) === 0;
              if (rienAMontrer) return null;

              const sectionOuverte = !fermes.has(section.id);

              return (
                <div key={section.id}>
                  {!mini && section.label && (
                    <button
                      onClick={() => toggleFerme(section.id)}
                      className={`w-full flex items-center justify-between px-2 mb-1 transition-colors ${C.muted} hover:text-[hsl(var(--sidebar-foreground)_/_0.8)]`}
                    >
                      <span className="text-[10px] font-semibold uppercase tracking-wider">{section.label}</span>
                      {sectionOuverte ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                  )}
                  {(mini || sectionOuverte) && (
                    <div className="space-y-0.5">
                      {mini
                        ? feuillesVisibles.map(renderIconeSeule)
                        : arbre.map((node) => renderNode(node, 0))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </nav>

        {/* Pied de sidebar */}
        <div className={`px-2 py-2 border-t space-y-0.5 ${C.sep}`}>
          {branding.logoDataUrl && !mini && (
            <div className={`flex items-center justify-center gap-1.5 pb-1.5 mb-1 border-b ${C.sep} opacity-70`}>
              <span className="text-[9px] uppercase tracking-wider text-[hsl(var(--sidebar-foreground)_/_0.5)]">propulsé par</span>
              <span className="w-5 h-5 flex items-center justify-center overflow-hidden [&_*]:max-w-full [&_*]:max-h-full">
                <AnthroSysLogo variant="mark" />
              </span>
              <span className="text-[10px] font-semibold text-[hsl(var(--sidebar-foreground)_/_0.75)]">ANTHRO-SYS</span>
            </div>
          )}
          <NavLink
            to="/profile"
            onClick={fermerSiMobile}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors ${isActive ? C.itemActive : C.itemBase}`
            }
            title={mini ? "Mon profil" : undefined}
          >
            <User size={18} />
            {!mini && <span>Mon profil</span>}
          </NavLink>

          <NavLink
            to="/appearance"
            onClick={fermerSiMobile}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors ${isActive ? C.itemActive : C.itemBase}`
            }
            title={mini ? "Apparence" : undefined}
          >
            <Palette size={18} />
            {!mini && <span>Apparence</span>}
          </NavLink>

          <button
            onClick={handleLogout}
            className={`w-full flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors ${C.itemBase}`}
            title={mini ? "Déconnexion" : undefined}
          >
            <LogOut size={18} />
            {!mini && <span>Déconnexion</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
