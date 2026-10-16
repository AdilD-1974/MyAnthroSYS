// ============================================================
// Sidebar.tsx — src/components/Sidebar.tsx  (v8 Premium)
// ------------------------------------------------------------
// PRINCIPE : 100% piloté par les tokens CSS du ThemeContext
//   --sidebar-background / --sidebar-foreground
//   --sidebar-primary / --sidebar-primary-foreground
//   --sidebar-accent / --sidebar-border / --destructive
//
// NOUVEAU v8 :
//   • Dégradé subtil en tête (top-to-bottom avec primary/8%)
//   • Logo-mark avec box-shadow coloré
//   • Carte utilisateur avec shimmer-line top
//   • Barre active : dégradé vertical + glow
//   • Pastilles icônes bicolores (accent bg + couleurModule)
//   • KPI cards 3 colonnes avec icône + delta tendance
//   • Barre de recherche pilotée par token
//   • Sous-items avec ligne de connexion dégradée
//   • Tooltips custom positionnés (mode mini)
//   • Chips "Nouveau" / "Bêta" thémés
//   • Animations CSS injectées (fade-in, dot-pulse)
//   • Responsive : desktop persistant, tablet mini auto,
//     mobile tiroir + voile
//   • Toute logique v5 préservée (rôles, branding, nav api)
// ============================================================

import React, { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate, useLocation }   from "react-router-dom";
import {
  LayoutDashboard, User, Users, CheckSquare, MessageSquare,
  FileText, Calendar, CalendarDays, CreditCard, GitBranch, Shield,
  ShieldCheck, Navigation, Palette, Settings, Sliders, Bell, LogOut,
  BarChart2, Building2, Briefcase, Wallet, Network, BookOpen,
  DoorOpen, ArrowRightLeft, HandCoins, Image, FileStack, UserPlus,
  GraduationCap, Target, HeartHandshake, ClipboardList,
  ChevronDown, ChevronRight, ChevronLeft, Menu, X, LucideIcon,
  LayoutGrid, Search, TrendingUp, TrendingDown, Minus,
  Activity, Clock,
} from "lucide-react";

import { useAuth }         from "@/contexts/AuthContext";
import { useNav }          from "@/contexts/NavContext";
import { useChatContext }  from "@/contexts/ChatContext";
import { useTaches }       from "@/contexts/TacheContext";
import AnthroSysLogo       from "@/components/AnthroSysLogo";
import { type NavItem, couleurModule } from "@/lib/navApi";
import { getBranding, type Branding } from "@/lib/branding";

// ─── Props ───────────────────────────────────────────────────
interface SidebarProps {
  mobileOpen?: boolean;
  onClose?: () => void;
}

// ─────────────────────────────────────────────────────────────
// Tokens CSS — toutes les couleurs viennent de ThemeContext
// Jamais de #hex ou rgba fixe sur fond / texte / bordure /
// état actif. Les modules gardent leur couleur sémantique via
// couleurModule() qui lit aussi les CSS vars si défini.
// ─────────────────────────────────────────────────────────────

/** Shorthand inline-style helper — applique directement les CSS vars */
const css = {
  bg:          { background: "hsl(var(--sidebar-background))" },
  surface:     { background: "hsl(var(--sidebar-accent) / 0.35)" },
  surfaceHov:  { background: "hsl(var(--sidebar-accent) / 0.55)" },
  border:      { border: "1px solid hsl(var(--sidebar-border))" },
  borderB:     { borderBottom: "1px solid hsl(var(--sidebar-border))" },
  borderT:     { borderTop: "1px solid hsl(var(--sidebar-border))" },
  text:        { color: "hsl(var(--sidebar-foreground))" },
  muted:       { color: "hsl(var(--sidebar-foreground) / 0.5)" },
  muted7:      { color: "hsl(var(--sidebar-foreground) / 0.7)" },
  primary:     { color: "hsl(var(--sidebar-primary))" },
  primaryFg:   { color: "hsl(var(--sidebar-primary-foreground))" },
  activeBg:    { background: "hsl(var(--sidebar-primary) / 0.14)", border: "1px solid hsl(var(--sidebar-primary) / 0.22)" },
  iconBg:      { background: "hsl(var(--sidebar-accent) / 0.7)" },
  iconActiveBg:{ background: "hsl(var(--sidebar-primary) / 0.2)" },
  rolePill: {
    background: "hsl(var(--sidebar-primary) / 0.12)",
    border: "1px solid hsl(var(--sidebar-primary) / 0.22)",
    color: "hsl(var(--sidebar-primary))",
  },
  kpiCard: {
    background: "hsl(var(--sidebar-accent) / 0.35)",
    border: "1px solid hsl(var(--sidebar-border) / 0.7)",
  },
  kpiIcon:    { background: "hsl(var(--sidebar-primary) / 0.14)" },
  searchBase: {
    background: "hsl(var(--sidebar-accent) / 0.3)",
    border: "1px solid hsl(var(--sidebar-border) / 0.8)",
  },
  searchFocused: {
    background: "hsl(var(--sidebar-primary) / 0.07)",
    border: "1px solid hsl(var(--sidebar-primary) / 0.4)",
  },
  connectorLine: { borderLeft: "1px dashed hsl(var(--sidebar-border) / 0.6)" },
  activeBar: {
    background: "linear-gradient(180deg, transparent, hsl(var(--sidebar-primary)), transparent)",
    boxShadow: "0 0 8px hsl(var(--sidebar-primary) / 0.5)",
  },
  tooltip: {
    background: "hsl(var(--sidebar-background))",
    border: "1px solid hsl(var(--sidebar-border))",
    color: "hsl(var(--sidebar-foreground))",
    boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
  },
  kbd: {
    background: "hsl(var(--sidebar-accent) / 0.5)",
    border: "1px solid hsl(var(--sidebar-border))",
    color: "hsl(var(--sidebar-foreground) / 0.35)",
  },
  chipNew: {
    background: "hsl(142 70% 45% / 0.14)",
    border: "1px solid hsl(142 70% 45% / 0.22)",
    color: "hsl(142 70% 40%)",
  },
  chipBeta: {
    background: "hsl(var(--sidebar-primary) / 0.12)",
    border: "1px solid hsl(var(--sidebar-primary) / 0.22)",
    color: "hsl(var(--sidebar-primary))",
  },
  badge: {
    background: "hsl(var(--destructive))",
    color: "hsl(var(--destructive-foreground))",
    boxShadow: "0 0 8px hsl(var(--destructive) / 0.45)",
  },
  headGradient: {
    background: "linear-gradient(180deg, hsl(var(--sidebar-primary) / 0.07) 0%, transparent 100%)",
    borderBottom: "1px solid hsl(var(--sidebar-border))",
  },
  logoGlow: {
    background: "linear-gradient(135deg, hsl(var(--sidebar-primary)), hsl(var(--sidebar-primary) / 0.7))",
    boxShadow: "0 4px 14px hsl(var(--sidebar-primary) / 0.35)",
  },
};

// ─── Icônes map ───────────────────────────────────────────────
const ICONES: Record<string, LucideIcon> = {
  LayoutDashboard, User, Users, CheckSquare, MessageSquare,
  FileText, Calendar, CalendarDays, CreditCard, GitBranch, Shield,
  ShieldCheck, Navigation, Palette, Settings, Sliders, Bell, LogOut,
  BarChart2, Building2, Briefcase, Wallet, Network, BookOpen,
  DoorOpen, ArrowRightLeft, HandCoins, Image, FileStack, UserPlus,
  GraduationCap, Target, HeartHandshake, ClipboardList,
};

function NavIcone({ nom, size = 15, couleur }: { nom?: string; size?: number; couleur?: string }) {
  if (!nom) return null;
  const Ic = ICONES[nom];
  return Ic
    ? <Ic size={size} color={couleur} />
    : <span style={{ fontSize: 10, fontFamily: "monospace", color: couleur }}>{nom.slice(0, 2)}</span>;
}

// ─── Initiales avatar ─────────────────────────────────────────
function initials(name?: string | null) {
  if (!name) return "?";
  return name.split(" ").filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");
}

// ─── Helpers nav ─────────────────────────────────────────────
function aplatir(items: NavItem[]): NavItem[] {
  const out: NavItem[] = [];
  const walk = (arr?: NavItem[]) =>
    arr?.forEach(i => { out.push(i); if (i.enfants?.length) walk(i.enfants); });
  walk(items);
  return out;
}
function visibleParRole(item: NavItem, role: string): boolean {
  const r = item.roles;
  return !r || r.length === 0 || r.includes(role);
}
function construireArbre(items: NavItem[]): NavItem[] {
  const byId = new Map<string, NavItem>();
  items.forEach(i => byId.set(i.id, { ...i, enfants: [] }));
  const roots: NavItem[] = [];
  byId.forEach(node => {
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
    if (parent) parent.enfants!.push(node);
    else roots.push(node);
  });
  const sort = (arr: NavItem[]) => {
    arr.sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));
    arr.forEach(n => n.enfants && sort(n.enfants));
  };
  sort(roots);
  return roots;
}
function elaguer(nodes: NavItem[]): NavItem[] {
  return nodes.filter(n => {
    if (n.enfants?.length) { n.enfants = elaguer(n.enfants); return n.enfants.length > 0; }
    return !!n.chemin;
  });
}

// ─────────────────────────────────────────────────────────────
// COMPOSANTS INTERNES
// ─────────────────────────────────────────────────────────────

/** Pastille icône — fond via token, couleur via couleurModule */
function IconPill({ nom, moduleCode, actif, size = 15 }: {
  nom?: string; moduleCode?: string; actif?: boolean; size?: number;
}) {
  const color = actif ? "hsl(var(--sidebar-primary-foreground))" : couleurModule(moduleCode);
  return (
    <span
      className="flex-shrink-0 w-[30px] h-[30px] rounded-[8px] flex items-center justify-center transition-all"
      style={actif ? css.iconActiveBg : css.iconBg}
    >
      <NavIcone nom={nom} size={size} couleur={color} />
    </span>
  );
}

/** Badge rouge (inline ou dot en mode mini) */
function Badge({ count, dot = false }: { count: number; dot?: boolean }) {
  if (!count) return null;
  if (dot) return (
    <span
      className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full text-[9px] font-semibold flex items-center justify-center px-1"
      style={css.badge}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
  return (
    <span
      className="min-w-[18px] h-[18px] rounded-full text-[10px] font-semibold flex items-center justify-center px-1 flex-shrink-0"
      style={css.badge}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** Tooltip positionné à droite (mode mini) */
function Tip({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="relative group/tip flex w-full justify-center">
      {children}
      <div
        className="
          pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-[200]
          opacity-0 group-hover/tip:opacity-100
          transition-all duration-150 delay-100
          translate-x-2 group-hover/tip:translate-x-0
        "
      >
        <div
          className="relative px-2.5 py-1.5 rounded-[8px] text-[11.5px] font-medium whitespace-nowrap"
          style={css.tooltip}
        >
          <span
            className="absolute right-full top-1/2 -translate-y-1/2 border-[5px] border-transparent"
            style={{ borderRightColor: "hsl(var(--sidebar-background))" }}
          />
          {label}
        </div>
      </div>
    </div>
  );
}

/** KPI card — 1 des 3 métriques en tête */
function KPICard({ label, value, delta, trend, icon }: {
  label: string; value: string | number; delta?: string;
  trend?: "up" | "down" | "flat"; icon: React.ReactNode;
}) {
  return (
    <div
      className="flex-1 min-w-0 rounded-[10px] p-2.5 flex flex-col gap-1.5 cursor-default transition-all hover:brightness-110 overflow-hidden"
      style={css.kpiCard}
    >
      <span
        className="w-6 h-6 rounded-[6px] flex items-center justify-center flex-shrink-0"
        style={{ ...css.kpiIcon, color: "hsl(var(--sidebar-primary))" }}
      >
        {icon}
      </span>
      <div className="font-bold text-[15px] leading-none tabular-nums" style={css.text}>{value}</div>
      <div className="flex items-center justify-between gap-1">
        <span className="text-[8.5px] uppercase tracking-[0.4px] truncate leading-none" style={css.muted}>{label}</span>
        {delta && (
          <span className={`text-[8.5px] font-semibold flex items-center gap-0.5 flex-shrink-0 leading-none ${
            trend === "up" ? "text-emerald-400" : trend === "down" ? "text-rose-400" : ""
          }`} style={trend === "flat" ? css.muted : undefined}>
            {trend === "up" ? <TrendingUp size={8} /> : trend === "down" ? <TrendingDown size={8} /> : <Minus size={8} />}
            {delta}
          </span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// COMPOSANT PRINCIPAL
// ─────────────────────────────────────────────────────────────
export default function Sidebar({ mobileOpen = false, onClose = () => {} }: SidebarProps) {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { activeRole, allRoles, signOut, user } = useAuth();
  const { sections, loading }    = useNav();
  const { nonLusTotal }          = useChatContext();
  const { badge: badgeTaches }   = useTaches();

  const tabCourant = new URLSearchParams(location.search).get("tab");
  const BASE_MGR   = "/espace-manager";

  const actifPersonnalise = (chemin?: string): boolean | null => {
    if (!chemin) return null;
    const [path, query] = chemin.split("?");
    if (path === BASE_MGR) {
      if (location.pathname !== BASE_MGR) return false;
      if (query) return tabCourant === new URLSearchParams(query).get("tab");
      return !tabCourant || tabCourant === "dashboard";
    }
    return null;
  };

  const [collapsed, setCollapsed] = useState(false);
  const [fermes, setFermes]       = useState<Set<string>>(new Set());
  const [searchFocused, setFocused] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Seule section "Principal" ouverte au démarrage
  const initRepli = useRef(false);
  useEffect(() => {
    if (initRepli.current || !sections?.length) return;
    const isPrincipal = (s: { code?: string; label?: string }) =>
      [s.code, s.label].some(v => (v ?? "").toLowerCase().trim() === "principal");
    if (!sections.some(isPrincipal)) { initRepli.current = true; return; }
    setFermes(new Set(sections.filter(s => !isPrincipal(s)).map(s => s.id)));
    initRepli.current = true;
  }, [sections]);

  // Branding
  const [branding, setBranding] = useState<Branding>(getBranding());
  useEffect(() => {
    const h = () => setBranding(getBranding());
    window.addEventListener("branding:change", h);
    return () => window.removeEventListener("branding:change", h);
  }, []);

  // Responsive
  const [estDesktop, setDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const h  = () => setDesktop(mq.matches);
    h(); mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  // ⌘K → recherche
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // CSS animations (injectées une seule fois)
  useEffect(() => {
    if (document.getElementById("sb-v8-css")) return;
    const s = document.createElement("style");
    s.id = "sb-v8-css";
    s.textContent = `
      @keyframes sb8-in  { from { opacity:0; transform:translateX(-6px); } to { opacity:1; transform:none; } }
      @keyframes sb8-dot { 0%,100% { box-shadow:0 0 0 0 rgba(16,185,129,.5); } 70% { box-shadow:0 0 0 5px rgba(16,185,129,0); } }
      .sb8 { animation: sb8-in .22s ease both; }
      .sb8-dot { animation: sb8-dot 2.8s infinite; }
      .sb8-scroll { scrollbar-width:thin; scrollbar-color:hsl(var(--sidebar-border)) transparent; }
      .sb8-scroll::-webkit-scrollbar { width:3px; }
      .sb8-scroll::-webkit-scrollbar-thumb { background:hsl(var(--sidebar-border)); border-radius:3px; }
    `;
    document.head.appendChild(s);
  }, []);

  const mini          = collapsed && estDesktop;
  const toggle        = (id: string) =>
    setFermes(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const roleActif     = activeRole ?? allRoles[0] ?? "collaborateur";
  const closeMobile   = () => { if (!estDesktop) onClose(); };
  const handleLogout  = () => { closeMobile(); signOut(); navigate("/login"); };
  const badgeDe       = (code: string) =>
    code === "messages" ? nonLusTotal : code === "taches" ? badgeTaches.en_retard : 0;
  const nomComplet    = user?.prenom ? `${user.prenom} ${user.nom ?? ""}`.trim() : user?.email ?? "Utilisateur";

  // ── Nœud de navigation ──────────────────────────────────────
  const renderNode = (node: NavItem, depth: number): React.ReactNode => {
    const hasChildren = !!node.enfants?.length;

    if (hasChildren) {
      const open = !fermes.has(node.id);
      return (
        <div key={node.id}>
          <button
            onClick={() => toggle(node.id)}
            title={mini ? node.label : undefined}
            className={`w-full flex items-center gap-2 rounded-[9px] px-2 py-[7px] text-[13px] transition-all border border-transparent ${mini ? "justify-center" : ""}`}
            style={{ ...css.muted7, paddingLeft: mini ? undefined : 8 + depth * 12 }}
            onMouseEnter={e => (e.currentTarget.style.background = "hsl(var(--sidebar-accent) / 0.5)")}
            onMouseLeave={e => (e.currentTarget.style.background = "")}
          >
            <IconPill nom={node.icone} moduleCode={node.module_code} size={15} />
            {!mini && (
              <>
                <span className="flex-1 text-left truncate font-[450]" style={css.muted7}>{node.label}</span>
                <ChevronRight
                  size={13}
                  className="flex-shrink-0 transition-transform duration-200"
                  style={{ ...css.muted, transform: open ? "rotate(90deg)" : undefined }}
                />
              </>
            )}
          </button>
          {!mini && open && (
            <div className="relative ml-5 mt-0.5 mb-0.5">
              <div className="absolute left-1.5 top-0 bottom-0 w-px" style={css.connectorLine} />
              <div className="pl-4 space-y-0.5">{node.enfants!.map(c => renderNode(c, depth + 1))}</div>
            </div>
          )}
        </div>
      );
    }

    const cnt = badgeDe(node.code);
    return (
      <NavLink
        key={node.id}
        to={node.chemin ?? "#"}
        onClick={closeMobile}
        className={`relative flex items-center gap-2 rounded-[9px] px-2 py-[7px] text-[13px] transition-all ${mini ? "justify-center" : ""}`}
        style={({ isActive }) => {
          const p = actifPersonnalise(node.chemin);
          const a = p === null ? isActive : p;
          return {
            ...(a ? css.activeBg : { border: "1px solid transparent" }),
            paddingLeft: mini ? undefined : 8 + depth * 12,
          };
        }}
      >
        {({ isActive }) => {
          const p = actifPersonnalise(node.chemin);
          const a = p === null ? isActive : p;
          return (
            <>
              {a && !mini && (
                <span className="absolute left-[-1px] top-1/2 -translate-y-1/2 w-[3px] h-[55%] rounded-r-full" style={css.activeBar} />
              )}
              <IconPill nom={node.icone} moduleCode={node.module_code} actif={a} size={15} />
              {!mini && (
                <>
                  <span
                    className="flex-1 truncate font-[450]"
                    style={a ? css.primary : css.muted7}
                  >{node.label}</span>
                  {cnt > 0 && <Badge count={cnt} />}
                </>
              )}
              {mini && cnt > 0 && <Badge count={cnt} dot />}
            </>
          );
        }}
      </NavLink>
    );
  };

  // ── Icône seule (mode mini) avec tooltip ──────────────────
  const renderMini = (leaf: NavItem) => {
    const cnt = badgeDe(leaf.code);
    return (
      <Tip key={leaf.id} label={leaf.label}>
        <NavLink
          to={leaf.chemin ?? "#"}
          onClick={closeMobile}
          className="relative flex items-center justify-center w-[38px] h-[38px] rounded-[9px] transition-all"
          style={({ isActive }) => {
            const p = actifPersonnalise(leaf.chemin);
            const a = p === null ? isActive : p;
            return a ? css.activeBg : { border: "1px solid transparent" };
          }}
        >
          {({ isActive }) => {
            const p = actifPersonnalise(leaf.chemin);
            const a = p === null ? isActive : p;
            return (
              <>
                <IconPill nom={leaf.icone} moduleCode={leaf.module_code} actif={a} size={15} />
                {cnt > 0 && <Badge count={cnt} dot />}
              </>
            );
          }}
        </NavLink>
      </Tip>
    );
  };

  // ── Footer link helper ────────────────────────────────────
  const FootLink = ({ to, icon: Icon, label }: { to: string; icon: React.ElementType; label: string }) => (
    <NavLink
      to={to}
      onClick={closeMobile}
      title={mini ? label : undefined}
      className={`flex items-center rounded-[9px] px-2 py-[7px] text-[13px] transition-all ${mini ? "justify-center" : "gap-2.5"}`}
      style={({ isActive }) => isActive ? css.activeBg : { border: "1px solid transparent" }}
      onMouseEnter={e => { if (!e.currentTarget.classList.contains("active")) e.currentTarget.style.background = "hsl(var(--sidebar-accent) / 0.5)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = ""; }}
    >
      {({ isActive }) => (
        <>
          <span
            className="w-[30px] h-[30px] rounded-[8px] flex items-center justify-center flex-shrink-0"
            style={isActive ? css.iconActiveBg : css.iconBg}
          >
            <Icon size={15} style={isActive ? css.primary : css.muted7} />
          </span>
          {!mini && <span className="font-[450]" style={css.muted7}>{label}</span>}
        </>
      )}
    </NavLink>
  );

  // ─────────────────────────────────────────────────────────
  // RENDU
  // ─────────────────────────────────────────────────────────
  return (
    <>
      {/* Voile mobile */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        aria-label="Navigation principale"
        className={[
          "sb8 flex flex-col h-full transition-[width,transform] duration-200 ease-out",
          "fixed inset-y-0 left-0 z-50 w-[260px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          "lg:static lg:z-auto lg:translate-x-0",
          mini ? "lg:w-[64px]" : "lg:w-[260px]",
        ].join(" ")}
        style={{
          ...css.bg,
          borderRight: "1px solid hsl(var(--sidebar-border))",
          boxShadow: "1px 0 0 hsl(var(--sidebar-border) / 0.5), 4px 0 24px rgba(0,0,0,0.3)",
        }}
      >

        {/* ── Logo ─────────────────────────────────────── */}
        <div
          className={`flex items-center justify-between px-3 py-3 flex-shrink-0 ${mini ? "justify-center" : ""}`}
          style={css.headGradient}
        >
          <div className="flex items-center gap-2.5 overflow-hidden min-w-0">
            {branding.logoDataUrl ? (
              <img
                src={branding.logoDataUrl}
                alt={branding.clientName || "Logo"}
                className={mini ? "h-8 w-8 object-contain rounded-[8px]" : "h-9 max-w-[140px] object-contain"}
              />
            ) : mini ? (
              <div className="w-8 h-8 rounded-[9px] flex items-center justify-center flex-shrink-0" style={css.logoGlow}>
                <AnthroSysLogo variant="mark" />
              </div>
            ) : (
              <>
                <div className="w-8 h-8 rounded-[9px] flex items-center justify-center flex-shrink-0" style={css.logoGlow}>
                  <AnthroSysLogo variant="mark" />
                </div>
                <div className="overflow-hidden">
                  <div className="text-[13px] font-semibold leading-tight tracking-tight whitespace-nowrap" style={css.text}>
                    ANTHRO-SYS
                  </div>
                  <div className="text-[9px] uppercase tracking-[0.55px] whitespace-nowrap" style={css.muted}>
                    SIRH Enterprise
                  </div>
                </div>
              </>
            )}
          </div>

          {!mini && (
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <button
                className="hidden lg:flex w-7 h-7 items-center justify-center rounded-[7px] transition-colors"
                style={css.muted7}
                title="Vue bureau"
                onClick={() => { closeMobile(); navigate("/bureau"); }}
                onMouseEnter={e => (e.currentTarget.style.background = "hsl(var(--sidebar-accent) / 0.6)")}
                onMouseLeave={e => (e.currentTarget.style.background = "")}
              >
                <LayoutGrid size={14} />
              </button>
              <button
                className="hidden lg:flex w-7 h-7 items-center justify-center rounded-[7px] transition-colors"
                style={css.muted7}
                title="Réduire"
                onClick={() => setCollapsed(true)}
                onMouseEnter={e => (e.currentTarget.style.background = "hsl(var(--sidebar-accent) / 0.6)")}
                onMouseLeave={e => (e.currentTarget.style.background = "")}
              >
                <ChevronLeft size={14} />
              </button>
              <button
                className="lg:hidden flex w-7 h-7 items-center justify-center rounded-[7px] transition-colors"
                style={css.muted7}
                title="Vue bureau"
                onClick={() => { closeMobile(); navigate("/bureau"); }}
              >
                <LayoutGrid size={14} />
              </button>
              <button
                className="lg:hidden flex w-7 h-7 items-center justify-center rounded-[7px] transition-colors"
                style={css.muted7}
                title="Fermer"
                onClick={onClose}
              >
                <X size={14} />
              </button>
            </div>
          )}

          {mini && (
            <button
              className="mt-1 flex w-7 h-7 items-center justify-center rounded-[7px] transition-colors"
              style={css.muted7}
              title="Déplier"
              onClick={() => setCollapsed(false)}
              onMouseEnter={e => (e.currentTarget.style.background = "hsl(var(--sidebar-accent) / 0.6)")}
              onMouseLeave={e => (e.currentTarget.style.background = "")}
            >
              <Menu size={14} />
            </button>
          )}
        </div>

        {/* ── Carte utilisateur ────────────────────────── */}
        {!mini ? (
          <div
            className="mx-2.5 mt-3 mb-1 p-2.5 rounded-[12px] flex items-center gap-2.5 cursor-pointer transition-all flex-shrink-0 overflow-hidden relative group"
            style={css.surface}
            onClick={() => navigate("/profile")}
            onMouseEnter={e => (e.currentTarget.style.background = "hsl(var(--sidebar-accent) / 0.55)")}
            onMouseLeave={e => (e.currentTarget.style.background = "hsl(var(--sidebar-accent) / 0.35)")}
          >
            {/* Shimmer line en haut */}
            <div
              className="absolute top-0 left-0 right-0 h-px"
              style={{ background: "linear-gradient(90deg, transparent, hsl(var(--sidebar-primary) / 0.25), transparent)" }}
            />
            <div className="relative flex-shrink-0">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-semibold"
                style={{
                  background: "linear-gradient(135deg, hsl(var(--sidebar-primary) / 0.65), hsl(var(--sidebar-primary)))",
                  color: "hsl(var(--sidebar-primary-foreground))",
                  boxShadow: "0 0 0 2px hsl(var(--sidebar-primary) / 0.25)",
                }}
              >
                {initials(nomComplet)}
              </div>
              <div
                className="sb8-dot absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400"
                style={{ border: "2px solid hsl(var(--sidebar-background))" }}
              />
            </div>
            <div className="flex-1 overflow-hidden">
              <div className="text-[12.5px] font-[500] truncate leading-tight" style={css.text}>{nomComplet}</div>
              <div className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full" style={css.rolePill}>
                <ShieldCheck size={9} />
                <span className="text-[9.5px] font-medium capitalize truncate">{roleActif}</span>
              </div>
            </div>
            <ChevronRight size={13} className="flex-shrink-0 transition-colors" style={css.muted} />
          </div>
        ) : (
          <div className="flex justify-center mt-3 mb-1 flex-shrink-0">
            <Tip label={nomComplet}>
              <div
                className="sb8-dot relative w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-semibold cursor-pointer hover:opacity-80 transition-opacity"
                style={{
                  background: "linear-gradient(135deg, hsl(var(--sidebar-primary) / 0.65), hsl(var(--sidebar-primary)))",
                  color: "hsl(var(--sidebar-primary-foreground))",
                  boxShadow: "0 0 0 2px hsl(var(--sidebar-primary) / 0.25)",
                }}
                onClick={() => navigate("/profile")}
              >
                {initials(nomComplet)}
                <div
                  className="sb8-dot absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400"
                  style={{ border: "2px solid hsl(var(--sidebar-background))" }}
                />
              </div>
            </Tip>
          </div>
        )}

        {/* ── Barre de recherche ───────────────────────── */}
        {!mini && (
          <div className="mx-2.5 mt-2 mb-1 flex-shrink-0">
            <div
              className="flex items-center gap-2 h-[32px] px-2.5 rounded-[8px] cursor-text transition-all"
              style={searchFocused ? css.searchFocused : css.searchBase}
              onClick={() => searchRef.current?.focus()}
            >
              <Search size={13} style={searchFocused ? css.primary : css.muted} className="flex-shrink-0 transition-colors" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Rechercher…"
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                className="flex-1 bg-transparent text-[12.5px] outline-none min-w-0"
                style={{ ...css.text, caretColor: "hsl(var(--sidebar-primary))" }}
              />
              <kbd
                className="hidden sm:flex items-center text-[9.5px] rounded-[4px] px-1.5 py-0.5 font-mono flex-shrink-0"
                style={css.kbd}
              >⌘K</kbd>
            </div>
          </div>
        )}

        {/* ── Strip KPI ────────────────────────────────── */}
        {!mini && (
          <div className="mx-2.5 mt-2 mb-1 flex gap-1.5 flex-shrink-0">
            <KPICard label="Effectifs" value={247}   delta="+3"   trend="up"   icon={<Users size={12} />} />
            <KPICard label="En attente" value={12}   delta="+5"   trend="down" icon={<Clock size={12} />} />
            <KPICard label="Présence"  value="94%"   delta="+2%"  trend="up"   icon={<Activity size={12} />} />
          </div>
        )}

        {/* ── Navigation ───────────────────────────────── */}
        <nav className={`sb8-scroll flex-1 overflow-y-auto py-2 space-y-0.5 ${mini ? "px-1.5" : "px-2"}`}>
          {loading ? (
            <div className="space-y-1 pt-1 px-1">
              {[1, 2, 3, 4, 5].map(i => (
                <div
                  key={i}
                  className="h-9 rounded-[9px] animate-pulse"
                  style={{ background: "hsl(var(--sidebar-accent) / 0.4)", opacity: 1 - i * 0.15 }}
                />
              ))}
            </div>
          ) : (
            (sections ?? []).map(section => {
              const visibles      = aplatir(section.items ?? []).filter(i => i.chemin ? visibleParRole(i, roleActif) : true);
              const arbre         = elaguer(construireArbre(visibles));
              const feuilles      = visibles.filter(i => i.chemin);
              const empty         = (mini ? feuilles.length : arbre.length) === 0;
              if (empty) return null;
              const open          = !fermes.has(section.id);

              return (
                <div key={section.id} className="mb-1">
                  {!mini && section.label && (
                    <button
                      className="w-full flex items-center justify-between px-2 py-1.5 mb-0.5 rounded-[7px] transition-colors"
                      style={css.muted}
                      onClick={() => toggle(section.id)}
                      onMouseEnter={e => (e.currentTarget.style.background = "hsl(var(--sidebar-accent) / 0.3)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "")}
                    >
                      <span className="text-[9.5px] font-semibold uppercase tracking-[0.7px]">{section.label}</span>
                      {open
                        ? <ChevronDown size={11} />
                        : <ChevronRight size={11} />}
                    </button>
                  )}
                  {(mini || open) && (
                    <div className="space-y-0.5">
                      {mini ? feuilles.map(renderMini) : arbre.map(n => renderNode(n, 0))}
                    </div>
                  )}
                  {mini && (
                    <div className="my-1.5 mx-2" style={{ borderTop: "1px solid hsl(var(--sidebar-border) / 0.5)" }} />
                  )}
                </div>
              );
            })
          )}
        </nav>

        {/* ── Pied ─────────────────────────────────────── */}
        <div className={`px-2 py-2 space-y-0.5 flex-shrink-0`} style={css.borderT}>
          {branding.logoDataUrl && !mini && (
            <div
              className="flex items-center justify-center gap-1.5 pb-1.5 mb-1 opacity-55"
              style={css.borderB}
            >
              <span className="text-[8.5px] uppercase tracking-wider" style={css.muted}>propulsé par</span>
              <span className="w-4 h-4 flex items-center justify-center overflow-hidden">
                <AnthroSysLogo variant="mark" />
              </span>
              <span className="text-[9.5px] font-semibold" style={css.muted7}>ANTHRO-SYS</span>
            </div>
          )}

          <FootLink to="/profile"    icon={User}    label="Mon profil" />
          <FootLink to="/appearance" icon={Palette} label="Apparence" />

          <div className="my-0.5" style={{ borderTop: "1px solid hsl(var(--sidebar-border) / 0.5)" }} />

          <button
            className={`w-full flex items-center rounded-[9px] px-2 py-[7px] text-[13px] transition-all ${mini ? "justify-center" : "gap-2.5"}`}
            style={{ ...css.muted7, border: "1px solid transparent" }}
            title={mini ? "Déconnexion" : undefined}
            onClick={handleLogout}
            onMouseEnter={e => { e.currentTarget.style.color = "hsl(0 90% 70%)"; e.currentTarget.style.background = "hsl(0 90% 60% / 0.09)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = ""; e.currentTarget.style.background = ""; }}
          >
            <span
              className="w-[30px] h-[30px] rounded-[8px] flex items-center justify-center flex-shrink-0"
              style={css.iconBg}
            >
              <LogOut size={15} />
            </span>
            {!mini && <span className="font-[450]">Déconnexion</span>}
          </button>
        </div>

      </aside>
    </>
  );
}
