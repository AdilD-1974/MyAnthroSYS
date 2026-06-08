import React, { useState, useEffect } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { ChevronLeft, ChevronRight, ChevronDown, LogOut, MessageSquare, CheckSquare, Banknote } from "lucide-react"; // ✅ TACHES : ajout CheckSquare // ✅ PRÊTS : ajout Banknote
import { useAuth } from "@/contexts/AuthContext";
import { useMenuTree } from "@/hooks/useMenuTree";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useChatContext } from "@/contexts/ChatContext";
import { api } from "@/lib/api";
import Logo from "./Logo";
import { useTacheCompteurs } from "@/hooks/useTaches"; // ✅ TACHES

type AppRole = "administrateur" | "gestionnaire_rh" | "gestionnaire_paie" | "manager" | "collaborateur";

interface NavChildDef {
  icon: React.ReactNode;
  label: string;
  to: string;
  color?: string;
  roles?: AppRole[];
  children?: { icon: React.ReactNode; label: string; to: string; color?: string; roles?: AppRole[] }[];
}

interface NavItemDef {
  icon: React.ReactNode;
  label: string;
  to: string;
  color?: string;
  roles?: AppRole[];
  children?: NavChildDef[];
}

// L'arbre de navigation provient désormais de la base (menu_items + menu_role) via useMenuTree().

const Sidebar: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const { role, allRoles, activeRole, switchRole, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { menu } = useMenuTree();
  const navItems = menu as unknown as NavItemDef[];

  // Total de messages non lus (temps réel via le ChatProvider)
  const { nonLusTotal } = useChatContext();

  // ✅ TACHES : compteurs pour le badge (polling 60s)
  const { en_retard: tachesEnRetard, dues_aujourd_hui: tachesDuJour } = useTacheCompteurs();

  // RG : L'administrateur a accès à l'intégralité des menus et espaces sans restriction
  const filtered = navItems.filter(item =>
    role === "administrateur" || !item.roles || (role && item.roles.includes(role as AppRole))
  );

  const toggleGroup = (to: string) => {
    setExpandedGroups(prev => ({ ...prev, [to]: !prev[to] }));
  };

  const isGroupActive = (item: NavItemDef): boolean => {
    if (location.pathname === item.to) return true;
    if (item.children) {
      return item.children.some(c => {
        if (location.pathname.startsWith(c.to) && c.to !== "/") return true;
        if (c.children) return c.children.some(gc => location.pathname.startsWith(gc.to));
        return false;
      });
    }
    return false;
  };

  // Libellés de rôles dynamiques (inclut les rôles personnalisés), chargés depuis l'API.
  const [roleLabels, setRoleLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    let annule = false;
    api
      .get<{ code: string; libelle: string }[]>("/roles/labels")
      .then((rows) => {
        if (annule) return;
        const map: Record<string, string> = {};
        rows.forEach((r) => { map[r.code] = r.libelle; });
        setRoleLabels(map);
      })
      .catch(() => { /* repli sur les libellés système ci-dessous */ });
    return () => { annule = true; };
  }, []);

  const getRoleLabel = (r: string | null) => {
    if (r && roleLabels[r]) return roleLabels[r];
    switch (r) {
      case "administrateur": return "Administrateur";
      case "gestionnaire_rh": return "Gestionnaire RH";
      case "gestionnaire_paie": return "Gestionnaire Paie";
      case "manager": return "Manager";
      case "collaborateur": return "Collaborateur";
      default: return r ?? "Collaborateur";
    }
  };

  const renderChild = (child: NavChildDef, depth = 1) => {
    if (role !== "administrateur" && child.roles && role && !child.roles.includes(role as AppRole)) return null;

    const paddingLeft = depth === 1 ? "ml-2" : "ml-4";
    const borderLeft = "border-l pl-3";
    const textSize = depth === 1 ? "text-[12px]" : "text-[11px]";

    if (child.children && !collapsed) {
      const visibleGrandChildren = child.children.filter(gc =>
        role === "administrateur" || !gc.roles || (role && gc.roles.includes(role as AppRole))
      );
      const isExpanded = expandedGroups[child.to] ?? false;
      const isActive = visibleGrandChildren.some(gc => location.pathname.startsWith(gc.to));
      return (
        <div key={child.to}>
          <button
            type="button"
            onClick={() => toggleGroup(child.to)}
            className={`nav-item w-full ${textSize} ${isActive ? "active" : ""}`}
            style={{ justifyContent: "space-between" }}
          >
            <span className="flex items-center gap-2">
              <span className="flex-shrink-0" style={{ color: child.color || "hsl(var(--sidebar-foreground) / 0.75)" }}>{child.icon}</span>
              <span className="truncate">{child.label}</span>
            </span>
            <ChevronDown
              size={11}
              style={{
                transition: "transform 0.2s",
                transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                color: "hsl(var(--sidebar-foreground) / 0.5)",
                flexShrink: 0,
              }}
            />
          </button>
          {isExpanded && (
            <div className={`${paddingLeft} mt-0.5 space-y-0.5 ${borderLeft}`} style={{ borderColor: "hsl(var(--sidebar-border))" }}>
              {visibleGrandChildren.map(gc => (
                <NavLink
                  key={gc.to}
                  to={gc.to}
                  className={({ isActive }) => `nav-item text-[11px] opacity-90 ${isActive ? "active" : ""}`}
                >
                  <span className="flex-shrink-0" style={{ color: gc.color || "hsl(var(--sidebar-foreground) / 0.65)" }}>{gc.icon}</span>
                  <span className="truncate">{gc.label}</span>
                </NavLink>
              ))}
            </div>
          )}
        </div>
      );
    }

    return (
      <NavLink
        key={child.to}
        to={child.to}
        className={({ isActive }) => `nav-item ${textSize} ${isActive ? "active" : ""}`}
      >
        <span className="flex-shrink-0" style={{ color: child.color || "hsl(var(--sidebar-foreground) / 0.75)" }}>{child.icon}</span>
        {!collapsed && <span className="truncate">{child.label}</span>}
      </NavLink>
    );
  };

  return (
    <aside
      className="flex flex-col h-screen transition-all duration-300 relative"
      style={{
        width: collapsed ? 64 : 240,
        background: "hsl(var(--sidebar-background))",
        borderRight: "1px solid hsl(var(--sidebar-border))",
        flexShrink: 0,
      }}
    >
      {/* Logo */}
      <div className="flex items-center justify-between px-4 py-5 border-b" style={{ borderColor: "hsl(var(--sidebar-border))" }}>
        <Logo collapsed={collapsed} />
      </div>

      {/* User info */}
      {!collapsed && (
        <div className="px-4 py-3 border-b" style={{ borderColor: "hsl(var(--sidebar-border))" }}>
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
              style={{ background: "hsl(var(--sidebar-primary))", color: "white" }}
            >
              {profile?.prenom?.[0]?.toUpperCase() || "U"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate" style={{ color: "hsl(var(--sidebar-foreground))" }}>
                {profile?.prenom} {profile?.nom}
              </p>
              <p className="text-xs truncate" style={{ color: "hsl(var(--sidebar-foreground) / 0.55)" }}>
                {getRoleLabel(activeRole)}
              </p>
            </div>
          </div>
          {/* RG-MULTI-ROLE-01 : Switcher d'espace */}
          {allRoles.length > 1 && (
            <div className="mt-2.5">
              <p className="text-[10px] font-medium mb-1.5" style={{ color: "hsl(var(--sidebar-foreground) / 0.4)" }}>
                CHANGER D'ESPACE
              </p>
              <Select
                value={activeRole ?? undefined}
                onValueChange={(r) => { switchRole(r as AppRole); navigate("/dashboard"); }}
              >
                <SelectTrigger
                  className="h-9 text-[13px] font-medium border-0"
                  style={{
                    background: "hsl(var(--sidebar-foreground) / 0.08)",
                    color: "hsl(var(--sidebar-foreground))",
                  }}
                >
                  <SelectValue placeholder="Choisir un espace" />
                </SelectTrigger>
                <SelectContent>
                  {allRoles.map((r) => (
                    <SelectItem key={r} value={r}>{getRoleLabel(r)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">

        {/* Lien Messages (chat) + badge de non-lus */}
        <NavLink
          to="/chat"
          className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
          title={collapsed ? "Messages" : undefined}
        >
          <span className="flex-shrink-0 relative" style={{ color: "hsl(var(--sidebar-foreground))" }}>
            <MessageSquare size={18} />
            {nonLusTotal > 0 && (
              <span
                className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none text-white"
                style={{ background: "hsl(var(--destructive))" }}
              >
                {nonLusTotal > 99 ? "99+" : nonLusTotal}
              </span>
            )}
          </span>
          {!collapsed && <span className="truncate text-[13px] font-medium">Messages</span>}
          {!collapsed && nonLusTotal > 0 && (
            <span
              className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold text-white"
              style={{ background: "hsl(var(--destructive))" }}
            >
              {nonLusTotal > 99 ? "99+" : nonLusTotal}
            </span>
          )}
        </NavLink>

        {/* ✅ TACHES : Lien Tâches + badge en retard (même pattern que Messages) */}
        <NavLink
          to="/taches"
          className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
          title={collapsed ? "Tâches" : undefined}
        >
          <span className="flex-shrink-0 relative" style={{ color: "hsl(var(--sidebar-foreground))" }}>
            <CheckSquare size={18} />
            {tachesEnRetard > 0 && (
              <span
                className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none text-white"
                style={{ background: "hsl(var(--destructive))" }}
              >
                {tachesEnRetard > 99 ? "99+" : tachesEnRetard}
              </span>
            )}
          </span>
          {!collapsed && <span className="truncate text-[13px] font-medium">Tâches</span>}
          {!collapsed && (tachesEnRetard > 0 || tachesDuJour > 0) && (
            <span
              className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold text-white"
              style={{ background: tachesEnRetard > 0 ? "hsl(var(--destructive))" : "hsl(var(--warning, 38 92% 50%))" }}
            >
              {tachesEnRetard > 0
                ? (tachesEnRetard > 99 ? "99+" : tachesEnRetard)
                : (tachesDuJour > 99 ? "99+" : tachesDuJour)
              }
            </span>
          )}
        </NavLink>

        {/* ✅ PRÊTS : Lien Mes Prêts (visible par tous les rôles) */}
        <NavLink
          to="/prets"
          className={({ isActive }) =>
            `nav-item ${isActive || location.pathname.startsWith("/prets") ? "active" : ""}`
          }
          title={collapsed ? "Mes prêts" : undefined}
        >
          <span className="flex-shrink-0" style={{ color: "hsl(var(--sidebar-foreground))" }}>
            <Banknote size={18} />
          </span>
          {!collapsed && <span className="truncate text-[13px] font-medium">Mes prêts</span>}
        </NavLink>

        {/* Menu dynamique depuis BDD */}
        {filtered.map(item => {
          if (item.children) {
            const active = isGroupActive(item);
            const expanded = expandedGroups[item.to] ?? false;
            return (
              <div key={item.to}>
                <button
                  type="button"
                  onClick={() => {
                    if (collapsed) {
                      navigate(item.to);
                    } else {
                      toggleGroup(item.to);
                    }
                  }}
                  className={`nav-item w-full ${active ? "active" : ""}`}
                  title={collapsed ? item.label : undefined}
                  style={{ justifyContent: "space-between" }}
                >
                  <span className="flex items-center gap-2">
                    <span className="flex-shrink-0" style={{ color: item.color || "hsl(var(--sidebar-foreground))" }}>{item.icon}</span>
                    {!collapsed && <span className="truncate text-[13px] font-medium">{item.label}</span>}
                  </span>
                  {!collapsed && (
                    <ChevronDown
                      size={13}
                      style={{
                        transition: "transform 0.2s",
                        transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                        color: "hsl(var(--sidebar-foreground) / 0.5)",
                        flexShrink: 0,
                      }}
                    />
                  )}
                </button>
                {!collapsed && expanded && (
                  <div className="ml-2 mt-0.5 space-y-0.5 border-l pl-3"
                    style={{ borderColor: "hsl(var(--sidebar-border))" }}>
                    {item.children.map(child => renderChild(child, 1))}
                  </div>
                )}
              </div>
            );
          }

          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
              title={collapsed ? item.label : undefined}
            >
              <span className="flex-shrink-0" style={{ color: item.color || "hsl(var(--sidebar-foreground))" }}>{item.icon}</span>
              {!collapsed && <span className="truncate text-[13px] font-medium">{item.label}</span>}
            </NavLink>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="px-2 py-3 border-t" style={{ borderColor: "hsl(var(--sidebar-border))" }}>
        <button
          onClick={() => { signOut(); navigate("/login"); }}
          className="nav-item w-full"
          title={collapsed ? "Déconnexion" : undefined}
        >
          <LogOut size={18} className="flex-shrink-0" />
          {!collapsed && <span>Déconnexion</span>}
        </button>
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-20 w-6 h-6 rounded-full flex items-center justify-center text-xs border shadow-sm z-10 transition-all"
        style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>
    </aside>
  );
};

export default Sidebar;
