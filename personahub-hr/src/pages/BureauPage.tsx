// ============================================================
// BureauPage.tsx — src/pages/BureauPage.tsx
// Vue "bureau" par niveaux : sections → modules → sous-menus.
// Navigation par drill-down (breadcrumb), recherche globale,
// retour à l'écran précédent depuis le niveau racine.
// Route : /bureau
// ============================================================

import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Search, ChevronRight, LucideIcon, X, Folder } from "lucide-react";
import {
  LayoutDashboard, User, Users, CheckSquare, MessageSquare,
  FileText, Calendar, CalendarDays, CreditCard, GitBranch, Shield,
  ShieldCheck, Navigation, Palette, Settings, Sliders, Bell,
  BarChart2, Building2, Briefcase, Wallet, Network, BookOpen,
  DoorOpen, ArrowRightLeft, HandCoins, Image, FileStack, UserPlus,
  GraduationCap, Target, HeartHandshake, ClipboardList,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { useNav } from "@/contexts/NavContext";
import { useChatContext } from "@/contexts/ChatContext";
import { useTaches } from "@/contexts/TacheContext";
import { type NavItem, couleurModule } from "@/lib/navApi";

// ── Registre icônes ───────────────────────────────────────────
const ICONES: Record<string, LucideIcon> = {
  LayoutDashboard, User, Users, CheckSquare, MessageSquare,
  FileText, Calendar, CalendarDays, CreditCard, GitBranch, Shield,
  ShieldCheck, Navigation, Palette, Settings, Sliders, Bell,
  BarChart2, Building2, Briefcase, Wallet, Network, BookOpen,
  DoorOpen, ArrowRightLeft, HandCoins, Image, FileStack, UserPlus,
  GraduationCap, Target, HeartHandshake, ClipboardList,
};

// ── Tokens (cohérents avec le design system de l'app) ─────────
const C = {
  border: "border-[hsl(var(--border))]",
  bg: "bg-[hsl(var(--background))]",
  card: "bg-[hsl(var(--card))]",
  fg: "text-[hsl(var(--foreground))]",
  muted: "text-[hsl(var(--muted-foreground))]",
  accent: "hover:bg-[hsl(var(--accent))]",
  destructiveBg: "bg-[hsl(var(--destructive))]",
  destructiveFg: "text-[hsl(var(--destructive-foreground))]",
};

// ── Helpers visibilité / arbre ─────────────────────────────────
function visibleParRole(item: NavItem, role: string): boolean {
  const roles = item.roles;
  if (!roles || roles.length === 0) return true;
  return roles.includes(role);
}

function filtrerArbre(items: NavItem[], role: string): NavItem[] {
  return items
    .map((i) => ({
      ...i,
      enfants: i.enfants?.length ? filtrerArbre(i.enfants, role) : i.enfants,
    }))
    .filter((i) => {
      const aEnfants = i.enfants && i.enfants.length > 0;
      const visible = i.chemin ? visibleParRole(i, role) : true;
      return aEnfants || visible;
    });
}

function aplatirRecherche(items: NavItem[], chemin: string[] = []): { item: NavItem; chemin: string[] }[] {
  const out: { item: NavItem; chemin: string[] }[] = [];
  items.forEach((i) => {
    if (i.chemin) out.push({ item: i, chemin });
    if (i.enfants?.length) out.push(...aplatirRecherche(i.enfants, [...chemin, i.label]));
  });
  return out;
}

// ── Icône d'un nœud (avec halo coloré) ─────────────────────────
function IconeNoeud({ nom, module, size = 28, taille = 56 }: { nom?: string; module?: string; size?: number; taille?: number }) {
  const Icone = nom ? ICONES[nom] : undefined;
  const couleur = couleurModule(module) ?? "hsl(var(--primary))";
  return (
    <div
      className="rounded-2xl flex items-center justify-center flex-shrink-0 transition-transform"
      style={{ width: taille, height: taille, backgroundColor: `${couleur}1A`, color: couleur }}
    >
      {Icone ? <Icone size={size} strokeWidth={1.75} /> : <Folder size={size} strokeWidth={1.75} />}
    </div>
  );
}

// ── Badge numérique ─────────────────────────────────────────────
function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className={`absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 rounded-full
                       ${C.destructiveBg} ${C.destructiveFg}
                       text-[11px] font-semibold flex items-center justify-center
                       ring-2 ring-[hsl(var(--background))]`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

export default function BureauPage() {
  const navigate = useNavigate();
  const { activeRole, allRoles } = useAuth();
  const { sections, loading } = useNav();
  const { nonLusTotal } = useChatContext();
  const { badge: badgeTaches } = useTaches();

  const roleActif = activeRole ?? allRoles[0] ?? "collaborateur";
  const badgeDe = (code?: string) =>
    code === "messages" ? nonLusTotal : code === "taches" ? badgeTaches.en_retard : 0;

  // ── Pile de navigation (drill-down) ───────────────────────────
  // [] = racine (sections). [sectionId] = items de la section.
  // [sectionId, itemId] = sous-menus de l'item, etc.
  const [pile, setPile] = useState<{ id: string; label: string; icone?: string; module?: string }[]>([]);
  const [recherche, setRecherche] = useState("");

  // Arbre filtré par rôle, par section
  const sectionsFiltrees = useMemo(() => {
    return (sections ?? [])
      .map((s) => ({ ...s, items: filtrerArbre(s.items ?? [], roleActif) }))
      .filter((s) => s.items.length > 0);
  }, [sections, roleActif]);

  // Niveau courant : trouver le nœud correspondant à la pile
  const niveau = useMemo(() => {
    if (pile.length === 0) return null;
    // Premier niveau = section
    let courant: NavItem[] | undefined = sectionsFiltrees.find((s) => s.id === pile[0].id)?.items;
    for (let i = 1; i < pile.length; i++) {
      const noeud = courant?.find((n) => n.id === pile[i].id);
      courant = noeud?.enfants;
    }
    return courant ?? [];
  }, [pile, sectionsFiltrees]);

  // Résultats de recherche globale (tous niveaux confondus)
  const resultatsRecherche = useMemo(() => {
    if (!recherche.trim()) return null;
    const terme = recherche.trim().toLowerCase();
    const tous = sectionsFiltrees.flatMap((s) =>
      aplatirRecherche(s.items, [s.label]).map((r) => ({ ...r, section: s.label }))
    );
    return tous.filter((r) => r.item.label.toLowerCase().includes(terme));
  }, [recherche, sectionsFiltrees]);

  // ── Navigation ─────────────────────────────────────────────────
  const ouvrirSection = (s: { id: string; label: string }) => {
    setRecherche("");
    setPile([{ id: s.id, label: s.label }]);
  };

  const ouvrirNoeud = (n: NavItem) => {
    if (n.enfants?.length) {
      setRecherche("");
      setPile((p) => [...p, { id: n.id, label: n.label, icone: n.icone, module: n.module_code }]);
    } else if (n.chemin) {
      navigate(n.chemin);
    }
  };

  const allerA = (index: number) => setPile((p) => p.slice(0, index + 1));
  const retourGeneral = () => setPile([]);
  const retourPrecedent = () => navigate(-1);

  // ── Rendu ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="px-4 sm:px-8 py-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={`aspect-[4/3] rounded-2xl ${C.card} ${C.border} border animate-pulse`} />
          ))}
        </div>
      </div>
    );
  }

  // Affichage recherche : résultats plats, indépendants de la pile
  if (recherche.trim()) {
    return (
      <div className="px-4 sm:px-8 py-6 max-w-5xl mx-auto">
        <Entete
          titre="Recherche"
          recherche={recherche}
          setRecherche={setRecherche}
          onRetour={retourPrecedent}
          fil={[]}
          onAllerA={() => {}}
          onGeneral={retourGeneral}
        />
        <div className="mt-6">
          {resultatsRecherche && resultatsRecherche.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {resultatsRecherche.map(({ item, chemin, section }) => (
                <button
                  key={item.id}
                  onClick={() => item.chemin && navigate(item.chemin)}
                  className={`flex items-center gap-3 p-3 rounded-xl border ${C.border} ${C.card}
                              ${C.accent} transition-colors text-left group`}
                >
                  <IconeNoeud nom={item.icone} module={item.module_code} taille={44} size={22} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${C.fg} truncate`}>{item.label}</p>
                    <p className={`text-xs ${C.muted} truncate`}>
                      {[section, ...chemin.slice(1)].join(" / ")}
                    </p>
                  </div>
                  <ChevronRight size={16} className={`${C.muted} group-hover:translate-x-0.5 transition-transform`} />
                </button>
              ))}
            </div>
          ) : (
            <p className={`text-sm ${C.muted} text-center py-12`}>
              Aucun résultat pour « {recherche} »
            </p>
          )}
        </div>
      </div>
    );
  }

  // Niveau racine : grandes tuiles de sections
  if (pile.length === 0) {
    return (
      <div className="px-4 sm:px-8 py-6 max-w-6xl mx-auto">
        <Entete
          titre="Bureau"
          recherche={recherche}
          setRecherche={setRecherche}
          onRetour={retourPrecedent}
          fil={[]}
          onAllerA={() => {}}
          onGeneral={retourGeneral}
        />

        <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {sectionsFiltrees.map((s) => {
            const feuilles = aplatirRecherche(s.items);
            const badgeTotal = feuilles.reduce((acc, { item }) => acc + badgeDe(item.code), 0);
            // Icône représentative = première feuille avec icône
            const iconeRepresentative = feuilles.find((f) => f.item.icone)?.item.icone;
            const moduleRepresentatif = feuilles.find((f) => f.item.module_code)?.item.module_code;

            return (
              <button
                key={s.id}
                onClick={() => ouvrirSection(s)}
                className={`group relative flex flex-col items-start gap-4 p-5 rounded-2xl border ${C.border}
                            ${C.card} ${C.accent} transition-all hover:shadow-md hover:-translate-y-0.5
                            text-left`}
              >
                <div className="relative">
                  <IconeNoeud nom={iconeRepresentative} module={moduleRepresentatif} taille={56} size={28} />
                  <Badge count={badgeTotal} />
                </div>
                <div>
                  <p className={`text-sm font-semibold ${C.fg}`}>{s.label}</p>
                  <p className={`text-xs ${C.muted} mt-0.5`}>
                    {feuilles.length} module{feuilles.length > 1 ? "s" : ""}
                  </p>
                </div>
                <ChevronRight
                  size={16}
                  className={`absolute bottom-5 right-5 ${C.muted} opacity-0 group-hover:opacity-100
                              group-hover:translate-x-0.5 transition-all`}
                />
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Niveaux suivants : grille des items du nœud courant
  return (
    <div className="px-4 sm:px-8 py-6 max-w-6xl mx-auto">
      <Entete
        titre={pile[pile.length - 1].label}
        recherche={recherche}
        setRecherche={setRecherche}
        onRetour={retourPrecedent}
        fil={pile}
        onAllerA={allerA}
        onGeneral={retourGeneral}
      />

      <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {(niveau ?? []).map((n) => {
          const estDossier = !!n.enfants?.length;
          const badge = badgeDe(n.code);
          return (
            <button
              key={n.id}
              onClick={() => ouvrirNoeud(n)}
              className={`group relative flex flex-col items-start gap-3 p-4 rounded-2xl border ${C.border}
                          ${C.card} ${C.accent} transition-all hover:shadow-md hover:-translate-y-0.5
                          text-left`}
            >
              <div className="relative">
                <IconeNoeud nom={n.icone} module={n.module_code} taille={48} size={24} />
                <Badge count={badge} />
              </div>
              <div className="flex items-center gap-1.5 w-full">
                <p className={`text-sm font-medium ${C.fg} flex-1 truncate`}>{n.label}</p>
                {estDossier && (
                  <span className={`flex items-center gap-0.5 text-[11px] ${C.muted}`}>
                    {n.enfants!.length}
                    <ChevronRight size={12} />
                  </span>
                )}
              </div>
            </button>
          );
        })}

        {(niveau ?? []).length === 0 && (
          <p className={`col-span-full text-sm ${C.muted} text-center py-12`}>
            Aucun élément dans cette section.
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================================
// En-tête : retour, fil d'Ariane, recherche
// ============================================================
function Entete({
  titre, recherche, setRecherche, onRetour, fil, onAllerA, onGeneral,
}: {
  titre: string;
  recherche: string;
  setRecherche: (v: string) => void;
  onRetour: () => void;
  fil: { id: string; label: string }[];
  onAllerA: (index: number) => void;
  onGeneral: () => void;
}) {
  return (
    <div>
      {/* Ligne 1 : retour écran précédent + recherche */}
      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={onRetour}
          className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border ${C.border}
                      ${C.fg} ${C.accent} transition-colors flex-shrink-0`}
        >
          <ArrowLeft size={16} />
          <span className="hidden sm:inline">Retour</span>
        </button>

        <div className="relative flex-1 max-w-sm">
          <Search size={15} className={`absolute left-3 top-1/2 -translate-y-1/2 ${C.muted}`} />
          <input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher un module…"
            className={`w-full text-sm pl-9 pr-8 py-2 rounded-lg border ${C.border} ${C.bg} ${C.fg}
                        outline-none focus:border-[hsl(var(--ring))] transition-colors`}
          />
          {recherche && (
            <button
              onClick={() => setRecherche("")}
              className={`absolute right-2.5 top-1/2 -translate-y-1/2 ${C.muted} hover:${C.fg}`}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Ligne 2 : fil d'Ariane / titre */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={onGeneral}
          className={`text-lg font-semibold transition-colors ${
            fil.length === 0 ? C.fg : `${C.muted} hover:${C.fg}`
          }`}
        >
          Bureau
        </button>
        {fil.map((f, i) => (
          <React.Fragment key={f.id}>
            <ChevronRight size={16} className={C.muted} />
            <button
              onClick={() => onAllerA(i)}
              className={`text-lg font-semibold transition-colors ${
                i === fil.length - 1 ? C.fg : `${C.muted} hover:${C.fg}`
              }`}
            >
              {f.label}
            </button>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
