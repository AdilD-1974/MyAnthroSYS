// ============================================================
// TopNav.tsx — src/components/TopNav.tsx
// Menu horizontal contextuel (style Odoo) alimenté par useNav().
// Affiche les écrans de la MÊME famille (section) que la route
// courante. Les entrées à sous-menus deviennent des dropdowns
// rendus en position FIXE (échappent au rognage de la barre).
// 100% piloté par les tokens CSS du ThemeContext.
// ============================================================

import React, { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard, User, Users, CheckSquare, MessageSquare,
  FileText, Calendar, CalendarDays, CreditCard, GitBranch, Shield,
  ShieldCheck, Navigation, Palette, Settings, Sliders, Bell, LogOut,
  BarChart2, Building2, Briefcase, Wallet, Network, BookOpen,
  DoorOpen, ArrowRightLeft, HandCoins, Image, FileStack, UserPlus,
  GraduationCap, Target, HeartHandshake, ClipboardList,
  ChevronDown, ChevronRight, LayoutGrid, LucideIcon,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { useNav } from "@/contexts/NavContext";
import { type NavItem, couleurModule } from "@/lib/navApi";

// ─── Icônes (même map que la Sidebar) ─────────────────────────
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
  return Ic ? <Ic size={size} color={couleur} /> : null;
}

// ─── Helpers nav (repris de la Sidebar) ───────────────────────
function aplatir(items: NavItem[]): NavItem[] {
  const out: NavItem[] = [];
  const walk = (arr?: NavItem[]) =>
    arr?.forEach(i => { out.push(i); if (i.enfants?.length) walk(i.enfants); });
  walk(items);
  return out;
}
function visibleParRoles(item: NavItem, roles: string[]): boolean {
  const r = item.roles;
  return !r || r.length === 0 || r.some(x => roles.includes(x));
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
const cheminBase = (c?: string) => (c || "").split("?")[0];

// Réutilisée aussi bien par TopNav (onglets) que par PanelNode (sous-menus imbriqués)
function estCheminActif(chemin: string | undefined, pathname: string): boolean {
  const b = cheminBase(chemin);
  if (!b) return false;
  return pathname === b || (b !== "/" && pathname.startsWith(b + "/"));
}

type OpenState = { id: string; left: number; top: number } | null;

type PanelStyle = {
  background: string;
  border: string;
  boxShadow: string;
};

// ─── Ligne de panneau récursive : gère un nombre illimité de niveaux ──
// Niveau feuille (pas d'enfants + chemin défini) → lien.
// Niveau avec enfants → bouton qui ouvre un flyout vers la droite,
// lequel réutilise PanelNode pour ses propres enfants (récursion).
function PanelNode({
  node,
  menuPanel,
  pathname,
  onNavigate,
}: {
  node: NavItem;
  menuPanel: PanelStyle;
  pathname: string;
  onNavigate: () => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const hasChildren = !!node.enfants?.length;
  const actif = estCheminActif(node.chemin, pathname);

  if (!hasChildren) {
    return (
      <NavLink
        to={node.chemin ?? "#"}
        onClick={onNavigate}
        className="flex items-center gap-2 px-2.5 py-2 rounded-[8px] text-[13px] transition-colors"
        style={() => (actif
          ? { color: "hsl(var(--primary))", background: "hsl(var(--primary) / 0.10)" }
          : { color: "hsl(var(--foreground))" })}
        onMouseEnter={e => { if (!actif) e.currentTarget.style.background = "hsl(var(--accent) / 0.45)"; }}
        onMouseLeave={e => { if (!actif) e.currentTarget.style.background = ""; }}
      >
        <span className="w-6 h-6 rounded-[7px] flex items-center justify-center flex-shrink-0" style={{ background: "hsl(var(--accent) / 0.55)" }}>
          <NavIcone nom={node.icone} size={13} couleur={couleurModule(node.module_code)} />
        </span>
        <span className="truncate">{node.label}</span>
      </NavLink>
    );
  }

  const ouvrir = () => { clearTimeout(timer.current); setOuvert(true); };
  const fermer = () => { timer.current = setTimeout(() => setOuvert(false), 150); };

  return (
    <div className="relative" onMouseEnter={ouvrir} onMouseLeave={fermer}>
      <button
        type="button"
        onClick={() => setOuvert(v => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-2 rounded-[8px] text-[13px] transition-colors"
        style={{
          color: ouvert ? "hsl(var(--primary))" : "hsl(var(--foreground))",
          background: ouvert ? "hsl(var(--primary) / 0.10)" : "transparent",
        }}
      >
        <span className="w-6 h-6 rounded-[7px] flex items-center justify-center flex-shrink-0" style={{ background: "hsl(var(--accent) / 0.55)" }}>
          <NavIcone nom={node.icone} size={13} couleur={couleurModule(node.module_code)} />
        </span>
        <span className="truncate flex-1 text-left">{node.label}</span>
        <ChevronRight size={13} />
      </button>

      {ouvert && (
        <div
          className="absolute top-0 left-full ml-1 min-w-[220px] rounded-[12px] p-1.5 z-[130]"
          style={menuPanel}
        >
          {node.enfants!.map(enfant => (
            <PanelNode key={enfant.id} node={enfant} menuPanel={menuPanel} pathname={pathname} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function TopNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeRole, allRoles } = useAuth();
  const { sections, loading } = useNav();
  // Union des profils du collaborateur : le menu cumule les droits de TOUS ses rôles.
  // activeRole reste conservé par ailleurs comme contexte « j'agis en tant que… ».
  const roles = useMemo<string[]>(
    () => {
      const list = (allRoles && allRoles.length ? allRoles : [activeRole]).filter(Boolean) as string[];
      return list.length ? list : ["collaborateur"];
    },
    [allRoles, activeRole]
  );

  const [open, setOpen] = useState<OpenState>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Fermer au changement de route
  useEffect(() => setOpen(null), [location.pathname, location.search]);
  // Fermer au clic extérieur (barre + panneau exemptés)
  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (barRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(null);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // ── Détecter la SECTION active depuis la route courante ──
  const { activeSection, activeLeafId } = useMemo(() => {
    const path = location.pathname;
    const isPrincipal = (s: any) =>
      [s?.code, s?.label].some(v => (v ?? "").toLowerCase().trim() === "principal");

    let chosen: any = null, chosenSec: any = null, bestLen = -1;
    (sections ?? []).forEach(sec => {
      aplatir(sec.items ?? []).forEach(it => {
        const c = cheminBase(it.chemin);
        if (!c) return;
        if (path === c) { chosen = it; chosenSec = sec; bestLen = Infinity; }
        else if (c !== "/" && path.startsWith(c + "/") && c.length > bestLen) {
          chosen = it; chosenSec = sec; bestLen = c.length;
        }
      });
    });

    const fallback = (sections ?? []).find(isPrincipal) ?? (sections ?? [])[0] ?? null;
    return { activeSection: chosenSec ?? fallback, activeLeafId: chosen?.id ?? null };
  }, [sections, location.pathname]);

  // ── Construire l'arbre horizontal de la section active ──
  const items = useMemo(() => {
    if (!activeSection) return [];
    const visibles = aplatir(activeSection.items ?? []).filter(i => i.chemin ? visibleParRoles(i, roles) : true);
    return elaguer(construireArbre(visibles));
  }, [activeSection, roles]);

  const accent = couleurModule(activeSection?.items?.[0]?.module_code);

  const css = {
    item: { color: "hsl(var(--muted-foreground))" },
    itemActive: {
      color: "hsl(var(--primary))",
      background: "hsl(var(--primary) / 0.10)",
      border: "1px solid hsl(var(--primary) / 0.20)",
    },
    itemIdle: { border: "1px solid transparent" },
    menuPanel: {
      background: "hsl(var(--card))",
      border: "1px solid hsl(var(--border))",
      boxShadow: "0 12px 30px rgba(0,0,0,0.18)",
    },
  } as const;

  const isActiveChemin = (c?: string) => estCheminActif(c, location.pathname);
  const nodeContientActif = (node: NavItem): boolean =>
    aplatir(node.enfants ?? []).some(d => d.id === activeLeafId || isActiveChemin(d.chemin));

  const toggleDropdown = (e: React.MouseEvent, id: string) => {
    if (open?.id === id) { setOpen(null); return; }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const left = Math.min(r.left, window.innerWidth - 252);
    setOpen({ id, left: Math.max(8, left), top: r.bottom + 6 });
  };

  // Nœud actuellement déroulé (toujours un parent de 1er niveau)
  const openNode = open ? items.find(n => n.id === open.id) : null;

  return (
    <div ref={barRef} className="flex items-center gap-1 min-w-0 flex-1">
      {/* Bouton grille → launcher */}
      <button
        onClick={() => navigate("/accueil")}
        title="Toutes les applications"
        className="flex items-center justify-center w-9 h-9 rounded-[9px] flex-shrink-0 transition-colors"
        style={{ color: "hsl(var(--muted-foreground))", border: "1px solid hsl(var(--border))" }}
        onMouseEnter={e => (e.currentTarget.style.background = "hsl(var(--accent) / 0.4)")}
        onMouseLeave={e => (e.currentTarget.style.background = "")}
      >
        <LayoutGrid size={17} />
      </button>

      {/* Nom de la famille active */}
      {activeSection?.label && (
        <div className="flex items-center gap-2 px-2.5 flex-shrink-0">
          <span
            className="w-7 h-7 rounded-[8px] flex items-center justify-center"
            style={{ background: "hsl(var(--accent) / 0.5)", color: accent }}
          >
            <NavIcone nom={activeSection.items?.[0]?.icone} size={15} couleur={accent} />
          </span>
          <span className="text-[13.5px] font-semibold truncate max-w-[170px]" style={{ color: "hsl(var(--foreground))" }}>
            {activeSection.label}
          </span>
        </div>
      )}

      <div className="w-px h-6 mx-1 flex-shrink-0" style={{ background: "hsl(var(--border))" }} />

      {/* Onglets horizontaux */}
      <nav className="flex items-center gap-0.5 overflow-x-auto overflow-y-visible min-w-0" style={{ scrollbarWidth: "none" }}>
        {loading ? (
          <div className="flex gap-2 px-2">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-7 w-20 rounded-[8px] animate-pulse" style={{ background: "hsl(var(--accent) / 0.4)" }} />
            ))}
          </div>
        ) : (
          items.map(node => {
            const hasChildren = !!node.enfants?.length;

            if (!hasChildren) {
              return (
                <NavLink
                  key={node.id}
                  to={node.chemin ?? "#"}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[9px] text-[13px] font-medium whitespace-nowrap transition-all"
                  style={() => (isActiveChemin(node.chemin) ? css.itemActive : { ...css.item, ...css.itemIdle })}
                  onMouseEnter={e => { if (!isActiveChemin(node.chemin)) e.currentTarget.style.background = "hsl(var(--accent) / 0.4)"; }}
                  onMouseLeave={e => { if (!isActiveChemin(node.chemin)) e.currentTarget.style.background = ""; }}
                >
                  <NavIcone nom={node.icone} size={14} couleur={couleurModule(node.module_code)} />
                  {node.label}
                </NavLink>
              );
            }

            const ouvert = open?.id === node.id;
            const actifGroupe = nodeContientActif(node);
            return (
              <button
                key={node.id}
                onClick={e => toggleDropdown(e, node.id)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[9px] text-[13px] font-medium whitespace-nowrap transition-all flex-shrink-0"
                style={actifGroupe || ouvert ? css.itemActive : { ...css.item, ...css.itemIdle }}
                onMouseEnter={e => { if (!(actifGroupe || ouvert)) e.currentTarget.style.background = "hsl(var(--accent) / 0.4)"; }}
                onMouseLeave={e => { if (!(actifGroupe || ouvert)) e.currentTarget.style.background = ""; }}
              >
                <NavIcone nom={node.icone} size={14} couleur={couleurModule(node.module_code)} />
                {node.label}
                <ChevronDown size={13} style={{ transform: ouvert ? "rotate(180deg)" : undefined, transition: "transform .15s" }} />
              </button>
            );
          })
        )}
      </nav>

      {/* Panneau déroulant — position FIXE (hors rognage de la barre) */}
      {open && openNode && (
        <div
          ref={panelRef}
          className="fixed min-w-[240px] rounded-[12px] p-1.5 z-[120]"
          style={{ left: open.left, top: open.top, ...css.menuPanel }}
        >
          {!openNode.enfants?.length ? (
            <div className="px-3 py-2 text-[12.5px]" style={{ color: "hsl(var(--muted-foreground))" }}>
              Aucun écran disponible
            </div>
          ) : openNode.enfants.map(enfant => (
            <PanelNode
              key={enfant.id}
              node={enfant}
              menuPanel={css.menuPanel}
              pathname={location.pathname}
              onNavigate={() => setOpen(null)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
