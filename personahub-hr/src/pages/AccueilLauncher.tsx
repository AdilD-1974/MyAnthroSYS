// ============================================================
// AccueilLauncher.tsx — v11 Final
// ============================================================
// TOPBAR : dégradé bleu Anthro-Sys (#0d2d6b → #2196d3)
//   • Logo full PNG réel intégré en base64
//   • Icônes action : Messages, Notifications (badge), Chat, Paramètres
//   • Avatar utilisateur : initiales + dégradé par rôle + dot présence
//   • Dropdown : switch profil, Mon profil, Apparence, Déconnexion
//
// LAUNCHER :
//   • Sections : Principal → Mon espace → Manager → RH → Paie → Dev → Admin
//   • Tuiles frosted-glass avec icône Lucide colorée par domaine
//   • Badges notification, chips Nouveau/Bêta
//   • Hover : lift + shadow + icône rotate
//   • Pills de filtrage par section
//   • Recherche ⌘K
//   • Blobs animés en fond
//   • Responsive 2→4→6 colonnes
//   • 100% tokens CSS ThemeContext
//   • SafeBoundary pour ChatContext / TacheContext optionnels
// ============================================================

import React, {
  useEffect, useMemo, useRef, useState,
  Component, type ReactNode, type ErrorInfo,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth }        from "@/contexts/AuthContext";
import { useNav }         from "@/contexts/NavContext";
// RG-FIX-REQUIRE-01 (24/08) : import ES statique au lieu de require() —
// require() n'existe pas côté navigateur avec Vite (CommonJS vs ESM), ce
// qui faisait planter tout AccueilLauncher au premier rendu
// ("Uncaught ReferenceError: require is not defined"). Le SafeBoundary
// (getDerivedStateFromError/componentDidCatch) qui encadre déjà
// ChatBadgeReader/TacheBadgeReader capture une erreur de rendu quelle que
// soit la façon dont le hook est invoqué — l'indirection par require()
// n'apportait rien pour le cas "provider non monté", elle cassait juste
// tout le reste.
import { useChatContext } from "@/contexts/ChatContext";
import { useTaches }      from "@/contexts/TacheContext";
import Logo                from "@/components/Logo";
import SelecteurSociete    from "@/components/SelecteurSociete";
import { type NavItem, type NavSection, couleurModule } from "@/lib/navApi";
import {
  Search, Bell, Mail, MessageCircle, Settings, ChevronDown, Check,
  Palette, ShieldCheck, LogOut, UserCog, LayoutGrid,
  LayoutDashboard, User, Users, UsersRound, CheckSquare, MessageSquare,
  FileText, Calendar, CalendarDays, CalendarRange, CreditCard,
  GitBranch, Shield, Navigation, Sliders, BarChart2, Building,
  Building2, Briefcase, Wallet, Network, BookOpen, DoorOpen,
  ArrowRightLeft, HandCoins, Coins, Image, FileStack, UserPlus,
  GraduationCap, Target, HeartHandshake, ClipboardList, Database,
  KeyRound, Lock, Clock, PauseCircle, Sparkles, Star, Heart,
  ChevronRight, type LucideIcon,
  // ── Nouveau jeu d'icônes thématiques ──────────────────────
  ClipboardCheck, TreePalm, Landmark, PiggyBank, IdCard, ScrollText,
  Award, Stethoscope, BookMarked, LineChart, Settings2, FolderKanban,
  Contact, CalendarCheck2, CalendarClock, Timer, Banknote, ReceiptText,
  FileSignature, UserCheck, Fingerprint, Layers, ClipboardSignature,
  TrendingUp, HeartPulse, Compass, ListChecks, Users2, FileClock,
  Repeat2, ShieldAlert, MessagesSquare,
  CircleUserRound, FolderOpen, Rocket, ArrowLeft,
} from "lucide-react";

// ─── Logo Anthro-Sys (PNG réel base64) ───────────────────────
const LOGO_FULL = "data:image/png;base64,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";

// ─── Palette topbar (identique à la capture) ─────────────────
const TB_GRADIENT = "linear-gradient(90deg, #0d2d6b 0%, #1a4a9e 38%, #1e6bbf 72%, #2196d3 100%)";

// ─── Icônes ───────────────────────────────────────────────────
const ICONES: Record<string, LucideIcon> = {
  LayoutDashboard, LayoutGrid, User, Users, UsersRound, CheckSquare,
  MessageSquare, FileText, Calendar, CalendarDays, CalendarRange,
  CreditCard, GitBranch, Shield, ShieldCheck, Navigation, Palette,
  Settings, Sliders, Bell, BarChart2, Building, Building2, Briefcase,
  Wallet, Network, BookOpen, DoorOpen, ArrowRightLeft, HandCoins,
  Coins, Image, FileStack, UserPlus, GraduationCap, Target,
  HeartHandshake, ClipboardList, Database, KeyRound, Lock, Clock,
  PauseCircle, Star, Heart, Search, Mail, MessageCircle,
  ClipboardCheck, TreePalm, Landmark, PiggyBank, IdCard, ScrollText,
  Award, Stethoscope, BookMarked, LineChart, Settings2, FolderKanban,
  Contact, CalendarCheck2, CalendarClock, Timer, Banknote, ReceiptText,
  FileSignature, UserCheck, Fingerprint, Layers, ClipboardSignature,
  TrendingUp, HeartPulse, Compass, ListChecks, Users2, FileClock,
  Repeat2, ShieldAlert, MessagesSquare, CircleUserRound, FolderOpen, Rocket,
};

// ─── Résolveur par mot-clé (code ou libellé) ──────────────────
// Utilisé quand le champ `icone` du backend est absent, générique
// ou ne correspond à rien de connu : on devine une icône plus
// parlante à partir du code / libellé métier (FR), pour éviter le
// LayoutGrid par défaut qui rend le launcher terne et impersonnel.
const MOTCLE_ICONES: [RegExp, LucideIcon][] = [
  [/tableau.*bord|dashboard/i,            LayoutDashboard],
  [/message|chat|discussion/i,            MessagesSquare],
  [/t[aâ]che|todo|task/i,                 ListChecks],
  [/valid|approbation|approuv/i,          ClipboardCheck],
  [/organisation|organigramme|structure/i,Network],
  [/collaborateur|salari[ée]|employ[ée]/i,UsersRound],
  [/demande/i,                            FileClock],
  [/cong[ée]|absence|vacance/i,           TreePalm],
  [/mouvement|d[ée]part|entr[ée]e?\b/i,   Repeat2],
  [/pr[eê]t|avance/i,                     PiggyBank],
  [/calendrier|planning/i,                CalendarCheck2],
  [/trombinoscope|annuaire|contact/i,     Contact],
  [/paie|salaire|r[ée]mun[ée]ration/i,    Banknote],
  [/bulletin|fiche.*paie/i,               ReceiptText],
  [/virement|banque|paiement/i,           Landmark],
  [/gpec|emploi|comp[ée]tence/i,          Compass],
  [/recrutement|candidat/i,               UserPlus],
  [/formation|apprentissage/i,            GraduationCap],
  [/performance|objectif|entretien/i,     Target],
  [/relations?.*sociales?|dialogue/i,     HeartHandshake],
  [/sant[ée]|s[ée]curit[ée]|accident/i,   HeartPulse],
  [/r[ée]f[ée]rentiel/i,                 BookMarked],
  [/configuration|param[ée]trage/i,       Settings2],
  [/administration|droits|habilitation/i, ShieldAlert],
  [/pilotage|audit|reporting|analytics/i, LineChart],
  [/profil|identit[ée]/i,                 CircleUserRound],
  [/document|dossier|archive/i,           FolderOpen],
  [/signature|contrat/i,                  FileSignature],
  [/badge|pointage|temps/i,               Timer],
];
function deviner(code?: string, label?: string): LucideIcon | null {
  const cible = `${code ?? ""} ${label ?? ""}`;
  for (const [re, icon] of MOTCLE_ICONES) if (re.test(cible)) return icon;
  return null;
}

// ─── Icônes des GROUPES (niveau 1 du launcher) ────────────────
// Chaque groupe (section de nav : "Principal", "Ressources Humaines",
// "Gestion de la Paie", …) a une icône représentative dédiée — plus
// parlante qu'une simple reprise de l'icône du 1er module qu'il contient.
const GROUP_MOTCLE_ICONES: [RegExp, LucideIcon][] = [
  [/principal/i,                          LayoutDashboard],
  [/manager/i,                            UsersRound],
  [/ressources?\s*humaines?|^rh\b/i,      Users],
  [/paie/i,                               Wallet],
  [/gpec|emplois?/i,                      Target],
  [/pilotage|audit/i,                     BarChart2],
  [/r[ée]f[ée]rentiels?/i,                Database],
  [/configuration|param[èe]tres?/i,       Sliders],
  [/administration/i,                     ShieldCheck],
  [/mon\s*espace/i,                       User],
  [/autres?/i,                            LayoutGrid],
];
function groupIcon(label: string, fallback: LucideIcon): LucideIcon {
  for (const [re, icon] of GROUP_MOTCLE_ICONES) if (re.test(label)) return icon;
  return fallback;
}

const toPascal = (n: string) =>
  n.split(/[-_\s]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join("");
// Priorité : on tente D'ABORD de deviner une icône thématique à partir
// du code/libellé métier (ListChecks pour "tâches", ClipboardCheck pour
// "validation", etc.) — sinon deux items au champ `icone` backend
// identique (ex: tous deux "CheckSquare") se retrouvent avec la même
// icône alors qu'ils sont fonctionnellement différents. Le champ
// `icone` du backend ne sert plus que de repli si aucun mot-clé connu
// ne matche (cas des modules très spécifiques / renommés).
function resolveIcon(nom?: string, code?: string, label?: string): LucideIcon {
  const devine = deviner(code, label);
  if (devine) return devine;
  if (nom) {
    const trouve = ICONES[nom] || ICONES[toPascal(nom)];
    if (trouve) return trouve;
  }
  return Rocket;
}

// ─── Helpers nav ─────────────────────────────────────────────
function aplatir(items?: NavItem[]): NavItem[] {
  const out: NavItem[] = [];
  const walk = (arr?: NavItem[]) =>
    arr?.forEach(i => { out.push(i); if (i.enfants?.length) walk(i.enfants); });
  walk(items);
  return out;
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
function landingChemin(node: NavItem): string | undefined {
  if (node.chemin) return node.chemin;
  for (const c of node.enfants ?? []) { const l = landingChemin(c); if (l) return l; }
  return undefined;
}

// ─── SafeBoundary (contextes optionnels) ─────────────────────
class SafeBoundary extends Component<
  { children: ReactNode; onError?: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(_: Error, __: ErrorInfo) { this.props.onError?.(); }
  render() { return this.state.hasError ? null : this.props.children; }
}
function ChatBadgeReader({ onValue }: { onValue: (n: number) => void }) {
  const ctx = useChatContext();
  const n = ctx?.nonLusTotal ?? 0;
  useEffect(() => { onValue(n); }, [n, onValue]);
  return null;
}
function TacheBadgeReader({ onValue }: { onValue: (n: number) => void }) {
  const ctx = useTaches();
  const n = ctx?.badge?.en_retard ?? 0;
  useEffect(() => { onValue(n); }, [n, onValue]);
  return null;
}

// ─── Blobs décoratifs ────────────────────────────────────────
function BackgroundBlobs() {
  return (
    <div style={{ position:"fixed", inset:0, overflow:"hidden", pointerEvents:"none", zIndex:0 }}>
      {([
        { w:500, h:500, top:"-12%", left:"-8%",  anim:"blob1 22s ease-in-out infinite" },
        { w:400, h:400, top:"42%",  right:"-7%", anim:"blob2 28s ease-in-out infinite" },
        { w:350, h:350, bottom:"-5%", left:"34%", anim:"blob3 32s ease-in-out infinite" },
      ] as any[]).map((b, i) => (
        <div key={i} style={{
          position:"absolute", width:b.w, height:b.h, borderRadius:"50%",
          ...(b.top    ? { top:b.top }    : {}),
          ...(b.bottom ? { bottom:b.bottom } : {}),
          ...(b.left   ? { left:b.left }   : {}),
          ...(b.right  ? { right:b.right }  : {}),
          background: "rgba(27,73,144,0.04)",
          filter:"blur(72px)", animation:b.anim,
        }}/>
      ))}
    </div>
  );
}

// ─── Chips ────────────────────────────────────────────────────
function Chip({ label, variant }: { label: string; variant: "new"|"beta" }) {
  return (
    <span style={{
      position:"absolute", top:7, right:7,
      fontSize:7.5, fontWeight:600, letterSpacing:.3,
      padding:"1.5px 5px", borderRadius:4, textTransform:"uppercase" as const,
      background: variant === "new" ? "rgba(59,110,17,0.12)" : "rgba(83,74,183,0.12)",
      color:       variant === "new" ? "#3b6d11"              : "#534ab7",
      border:      variant === "new" ? "0.5px solid #c0dd97"  : "0.5px solid #cecbf6",
    }}>{label}</span>
  );
}

// ─── Tuile ────────────────────────────────────────────────────
function AppTile({ label, to, color, bg, moduleCode, icon: Icon, badge, isNew, isBeta }: {
  label:string; to:string; color:string; bg:string;
  moduleCode?:string; icon:LucideIcon;
  badge?:number; isNew?:boolean; isBeta?:boolean;
}) {
  const [hov, setHov] = useState(false);
  return (
    <Link to={to}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display:"flex", flexDirection:"column", alignItems:"center",
        gap:13, padding:"26px 12px 19px", borderRadius:16,
        background: hov
          ? `linear-gradient(160deg, ${color}14, #fff 65%)`
          : `linear-gradient(160deg, ${color}0a, rgba(255,255,255,0.86))`,
        border: `1px solid ${color}${hov ? "4a" : "22"}`,
        boxShadow: hov
          ? `0 10px 26px ${color}30, 0 2px 8px rgba(0,0,0,0.05)`
          : `0 2px 10px ${color}14`,
        transform: hov ? "translateY(-4px) scale(1.025)" : "none",
        transition:"all .2s cubic-bezier(.4,0,.2,1)",
        position:"relative", overflow:"hidden",
        cursor:"pointer", textDecoration:"none",
        width:158,
      }}
    >
      {/* Ligne couleur top — toujours visible, pleine intensité au survol */}
      <div style={{
        position:"absolute", top:0, left:0, right:0, height:3,
        background:`linear-gradient(90deg, ${color}, ${color}99)`,
        borderRadius:"14px 14px 0 0",
        opacity: hov ? 1 : 0.55, transition:"opacity .2s",
      }}/>

      {/* Badges */}
      {!!badge && (
        <span style={{
          position:"absolute", top:7, left:7,
          minWidth:17, height:17,
          background:"#e53935", color:"#fff",
          fontSize:9, fontWeight:600, borderRadius:999, padding:"0 3.5px",
          display:"flex", alignItems:"center", justifyContent:"center",
          border:"1.5px solid #fff", boxShadow:"0 2px 6px rgba(229,57,53,0.4)",
        }}>{badge > 99 ? "99+" : badge}</span>
      )}
      {isNew  && !badge && <Chip label="Nouveau" variant="new"  />}
      {isBeta && !badge && !isNew && <Chip label="Bêta" variant="beta" />}

      {/* Icône style Odoo — pastille pleine couleur, icône blanche, relief glossy */}
      <div style={{
        width:70, height:70, borderRadius:19, flexShrink:0,
        display:"flex", alignItems:"center", justifyContent:"center",
        background:`linear-gradient(155deg, ${color} 0%, ${color}e0 55%, ${color}c2 100%)`,
        boxShadow: hov
          ? `0 10px 20px ${color}55, 0 0 0 6px ${color}14, inset 0 1.5px 0 rgba(255,255,255,0.45), inset 0 -3px 6px rgba(0,0,0,0.16)`
          : `0 4px 10px ${color}3d, inset 0 1.5px 0 rgba(255,255,255,0.4), inset 0 -3px 6px rgba(0,0,0,0.14)`,
        transform: hov ? "translateY(-3px) scale(1.07)" : "none",
        transition:"all .22s cubic-bezier(.4,0,.2,1)",
        position:"relative", zIndex:1, overflow:"hidden",
      }}>
        {/* Reflet glossy en haut de la pastille, effet Odoo */}
        <span aria-hidden="true" style={{
          position:"absolute", top:0, left:0, right:0, height:"52%",
          background:"linear-gradient(180deg, rgba(255,255,255,0.32), rgba(255,255,255,0))",
          borderRadius:"19px 19px 50% 50% / 19px 19px 100% 100%",
          pointerEvents:"none",
        }}/>
        <Icon size={32} strokeWidth={2} color="#fff" style={{ position:"relative", zIndex:1, filter:"drop-shadow(0 1px 1px rgba(0,0,0,0.18))" }} />
      </div>

      <span style={{
        fontSize:"calc(12.5px * var(--font-scale, 1))", fontWeight:600,
        color: hov ? "#111" : "#3a3a38",
        lineHeight:1.3, textAlign:"center", zIndex:1,
        transition:"color .15s",
      }}>{label}</span>
    </Link>
  );
}

// ─── Tuile vedette (section "Votre espace {Rôle}") ────────────
function FeaturedTile({ label, to, icon: Icon, accent, delay }: {
  label: string; to: string; icon: LucideIcon; accent: string; delay: number;
}) {
  const [hov, setHov] = useState(false);
  return (
    <Link to={to}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className="l11f"
      style={{
        position:"relative", overflow:"hidden",
        display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
        gap:12, padding:"24px 14px 18px", borderRadius:16, minHeight:132,
        textDecoration:"none", cursor:"pointer",
        background: hov
          ? `linear-gradient(150deg, ${accent}1c, rgba(255,255,255,0.94))`
          : "linear-gradient(150deg, rgba(255,255,255,0.85), rgba(255,255,255,0.6))",
        border: `1px solid ${accent}${hov ? "55" : "2a"}`,
        boxShadow: hov
          ? `0 14px 34px ${accent}30, 0 3px 10px rgba(0,0,0,0.06)`
          : `0 4px 16px ${accent}14`,
        transform: hov ? "translateY(-5px) scale(1.015)" : "none",
        transition:"all .22s cubic-bezier(.4,0,.2,1)",
        animationDelay:`${delay}ms`,
      }}
    >
      {/* Voile brillant qui balaie la tuile */}
      <span aria-hidden="true" style={{
        position:"absolute", inset:0, pointerEvents:"none",
        background:`linear-gradient(115deg, transparent 20%, ${accent}22 45%, transparent 70%)`,
        backgroundSize:"250% 100%",
        animation:"l11-shine 3.2s ease-in-out infinite",
      }}/>
      {/* Icône style Odoo — pastille pleine couleur, icône blanche */}
      <div style={{
        position:"relative", zIndex:1, width:50, height:50, borderRadius:15,
        display:"flex", alignItems:"center", justifyContent:"center",
        background:`linear-gradient(155deg, ${accent} 0%, ${accent}e0 55%, ${accent}c2 100%)`,
        boxShadow: hov
          ? `0 8px 18px ${accent}50, 0 0 0 6px ${accent}12, inset 0 1.5px 0 rgba(255,255,255,0.45), inset 0 -3px 6px rgba(0,0,0,0.16)`
          : `0 4px 10px ${accent}38, inset 0 1.5px 0 rgba(255,255,255,0.4), inset 0 -3px 6px rgba(0,0,0,0.14)`,
        transform: hov ? "translateY(-3px) scale(1.07)" : "none",
        transition:"all .22s cubic-bezier(.4,0,.2,1)",
        overflow:"hidden",
      }}>
        <span aria-hidden="true" style={{
          position:"absolute", top:0, left:0, right:0, height:"52%",
          background:"linear-gradient(180deg, rgba(255,255,255,0.32), rgba(255,255,255,0))",
          pointerEvents:"none",
        }}/>
        <Icon size={22} strokeWidth={2} color="#fff" style={{ position:"relative", zIndex:1, filter:"drop-shadow(0 1px 1px rgba(0,0,0,0.18))" }} />
      </div>
      <span style={{
        position:"relative", zIndex:1,
        fontSize:"calc(12px * var(--font-scale,1))", fontWeight:600,
        color:"#222", textAlign:"center", lineHeight:1.3,
      }}>{label}</span>
    </Link>
  );
}

// ─── Tuile de GROUPE (niveau 1 du launcher, façon écran d'accueil
// Odoo : on choisit d'abord son domaine, puis on entre dedans) ──
function GroupTile({ label, count, icon: Icon, color, onClick, delay }: {
  label: string; count: number; icon: LucideIcon; color: string; onClick: () => void; delay: number;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className="l11f"
      style={{
        position:"relative", overflow:"hidden", width:"100%",
        display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
        gap:13, padding:"28px 14px 22px", borderRadius:19, minHeight:158,
        border: `1px solid ${color}${hov ? "50" : "26"}`, cursor:"pointer",
        background: hov
          ? `linear-gradient(150deg, ${color}1e, rgba(255,255,255,0.95))`
          : "linear-gradient(150deg, rgba(255,255,255,0.86), rgba(255,255,255,0.62))",
        boxShadow: hov
          ? `0 16px 38px ${color}30, 0 3px 12px rgba(0,0,0,0.06)`
          : `0 4px 16px ${color}16`,
        transform: hov ? "translateY(-5px) scale(1.015)" : "none",
        transition:"all .22s cubic-bezier(.4,0,.2,1)",
        animationDelay:`${delay}ms`,
      }}
    >
      {/* Voile brillant qui balaie la tuile au survol */}
      <span aria-hidden="true" style={{
        position:"absolute", inset:0, pointerEvents:"none",
        background:`linear-gradient(115deg, transparent 20%, ${color}22 45%, transparent 70%)`,
        backgroundSize:"250% 100%",
        animation: hov ? "l11-shine 1.6s ease-in-out infinite" : "none",
      }}/>
      {/* Pastille Odoo — plus grande que les tuiles de modules, c'est le "app icon" du groupe */}
      <div style={{
        position:"relative", zIndex:1, width:64, height:64, borderRadius:19,
        display:"flex", alignItems:"center", justifyContent:"center",
        background:`linear-gradient(155deg, ${color} 0%, ${color}e0 55%, ${color}c2 100%)`,
        boxShadow: hov
          ? `0 12px 24px ${color}55, inset 0 1.5px 0 rgba(255,255,255,0.45), inset 0 -3px 6px rgba(0,0,0,0.16)`
          : `0 4px 12px ${color}3d, inset 0 1.5px 0 rgba(255,255,255,0.4), inset 0 -3px 6px rgba(0,0,0,0.14)`,
        transform: hov ? "translateY(-3px) scale(1.06)" : "none",
        transition:"all .22s cubic-bezier(.4,0,.2,1)",
        overflow:"hidden",
      }}>
        <span aria-hidden="true" style={{
          position:"absolute", top:0, left:0, right:0, height:"52%",
          background:"linear-gradient(180deg, rgba(255,255,255,0.32), rgba(255,255,255,0))",
          pointerEvents:"none",
        }}/>
        <Icon size={29} strokeWidth={2} color="#fff" style={{ position:"relative", zIndex:1, filter:"drop-shadow(0 1px 1px rgba(0,0,0,0.18))" }} />
      </div>
      <div style={{ position:"relative", zIndex:1, textAlign:"center" }}>
        <div style={{ fontSize:"calc(13.5px * var(--font-scale,1))", fontWeight:600, color: hov ? "#111" : "#2a2a28" }}>
          {label}
        </div>
        <div style={{ fontSize:"calc(11px * var(--font-scale,1))", color:"#999", marginTop:3 }}>
          {count} module{count !== 1 ? "s" : ""}
        </div>
      </div>
    </button>
  );
}


function initials(name?: string | null) {
  if (!name) return "?";
  return name.split(" ").filter(Boolean).slice(0,2).map(w => w[0].toUpperCase()).join("");
}

// ─── Couleur avatar par rôle ─────────────────────────────────
const AV_BG: Record<string, string> = {
  drh:               "linear-gradient(135deg,#1b4990,#3b7dd8)",
  gestionnaire_rh:   "linear-gradient(135deg,#993556,#d4537e)",
  gestionnaire_paie: "linear-gradient(135deg,#0f6e56,#2dd4bf)",
  manager:           "linear-gradient(135deg,#0f6e56,#1d9e75)",
  collaborateur:     "linear-gradient(135deg,#185fa5,#3b7dd8)",
  administrateur:    "linear-gradient(135deg,#534ab7,#8b5cf6)",
};

// ─── Accent uni par rôle (glow, bordures, badges de la section vedette) ─
const ROLE_ACCENT: Record<string, string> = {
  drh:               "#3b7dd8",
  gestionnaire_rh:   "#d4537e",
  gestionnaire_paie: "#2dd4bf",
  manager:           "#1d9e75",
  collaborateur:     "#3b7dd8",
  administrateur:    "#8b5cf6",
};

// ─── Un module est-il dans le périmètre du rôle actif ? ──────
// Un item sans `roles` (ou tableau vide) est considéré universel
// (ex: profil, apparence) et reste toujours visible.
function pourRoleActif(roles: string[] | undefined, role: string): boolean {
  if (!roles || roles.length === 0) return true;
  return roles.includes(role);
}

// ─── Couleurs des tuiles par module (tokens fixes) ───────────
// Priorité : couleurModule() de navApi, sinon fallback ci-dessous
// ─── Palette de secours (si aucun module_code connu) ──────────
const FALLBACK_PALETTE = [
  "#3b7dd8", "#8b5cf6", "#d4537e", "#0f6e56", "#ba7517",
  "#534ab7", "#993556", "#185fa5", "#2dd4bf", "#d85a30",
];
// En dessous de ce nombre total de modules accessibles, l'écran
// intermédiaire "groupes" (niveau 1) est sauté — inutile de faire
// naviguer un profil qui n'a de toute façon que 3-4 modules.
const FLAT_THRESHOLD = 8;

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// Chaque module a désormais SA couleur (via couleurModule, alignée
// sur navApi.MODULES) et un fond DÉRIVÉ DE CETTE MÊME COULEUR (teinte
// douce, alpha hex) — fini le bleu pâle uniforme sur toutes les
// tuiles : l'icône et son halo sont toujours de la même famille de
// teinte, ce qui rend chaque domaine immédiatement identifiable.
function tileColors(moduleCode?: string, code?: string): { color: string; bg: string } {
  const navColor = moduleCode ? couleurModule(moduleCode) : undefined;
  const color = (navColor && navColor !== "#94A3B8")
    ? navColor
    : FALLBACK_PALETTE[hashStr(moduleCode ?? code ?? "x") % FALLBACK_PALETTE.length];
  return { color, bg: `${color}1A` };
}

// ─────────────────────────────────────────────────────────────
// COMPOSANT PRINCIPAL
// ─────────────────────────────────────────────────────────────
export default function AccueilLauncher() {
  const navigate = useNavigate();
  const auth: any = useAuth();
  const { sections, loading } = useNav();

  const prenom: string =
    auth?.user?.prenom || auth?.profile?.prenom || auth?.user?.user_metadata?.prenom || "";
  const nomComplet: string =
    [auth?.profile?.prenom || auth?.user?.prenom, auth?.profile?.nom || auth?.user?.nom]
      .filter(Boolean).join(" ") || auth?.user?.email || "Utilisateur";
  const email: string = auth?.user?.email ?? "";
  const activeRole: string = auth?.activeRole ?? auth?.role ?? "";
  const profils: string[] = auth?.allRoles?.length ? auth.allRoles : activeRole ? [activeRole] : [];
  const nomInit = initials(nomComplet);
  const roleLabel = activeRole.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
  const avBg = AV_BG[activeRole] ?? AV_BG.collaborateur;
  const roleAccent = ROLE_ACCENT[activeRole] ?? ROLE_ACCENT.collaborateur;

  const switchProfil = (r: string) => { auth?.switchRole?.(r); setUserOpen(false); };
  const onLogout = async () => { try { await auth?.signOut?.(); } finally { navigate("/login"); } };

  const [q, setQ]           = useState("");
  // Niveau de groupe piloté par l'URL (?groupe=paie) — permet le
  // retour navigateur, le rafraîchissement et le partage d'un lien
  // direct vers le launcher d'un groupe précis (comportement Odoo).
  const [searchParams, setSearchParams] = useSearchParams();
  const secId = searchParams.get("groupe") || "all";
  const setSecId = (id: string) => {
    setSearchParams((prev: URLSearchParams) => {
      const next = new URLSearchParams(prev);
      if (id === "all") next.delete("groupe"); else next.set("groupe", id);
      return next;
    });
  };
  const [userOpen, setUserOpen] = useState(false);
  const userRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Badges optionnels
  const [msgBadge,  setMsgBadge]  = useState(0);
  const [tachBadge, setTachBadge] = useState(0);
  const onMsgCb  = useMemo(() => (n: number) => setMsgBadge(n),  []);
  const onTachCb = useMemo(() => (n: number) => setTachBadge(n), []);
  const badgeDe = (code?: string) => {
    if (!code) return 0;
    if (code === "messages") return msgBadge;
    if (code === "taches")   return tachBadge;
    return 0;
  };

  // Fermer dropdown
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // ⌘K
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // Animations CSS
  useEffect(() => {
    if (document.getElementById("l11-css")) return;
    const s = document.createElement("style");
    s.id = "l11-css";
    s.textContent = `
      @keyframes blob1{0%,100%{transform:translate(0,0)scale(1)}33%{transform:translate(28px,-18px)scale(1.05)}66%{transform:translate(-12px,14px)scale(.96)}}
      @keyframes blob2{0%,100%{transform:translate(0,0)scale(1)}33%{transform:translate(-18px,12px)scale(1.04)}66%{transform:translate(12px,-8px)scale(.97)}}
      @keyframes blob3{0%,100%{transform:translate(0,0)scale(1)}33%{transform:translate(12px,-12px)scale(1.04)}66%{transform:translate(-16px,7px)scale(.97)}}
      @keyframes l11-tile{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
      @keyframes l11-hero{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
      @keyframes l11-shine{0%{background-position:200% 0}100%{background-position:-100% 0}}
      @keyframes l11-pop{0%{opacity:0;transform:translateY(16px) scale(.94)}70%{opacity:1;transform:translateY(-2px) scale(1.015)}100%{opacity:1;transform:none}}
      @keyframes l11-glow{0%,100%{opacity:.55}50%{opacity:1}}
      .l11t{animation:l11-tile .28s ease both}
      .l11h{animation:l11-hero .32s ease both}
      .l11f{animation:l11-pop .5s cubic-bezier(.2,.9,.25,1) both}
      .l11s{scrollbar-width:thin;scrollbar-color:rgba(0,0,0,0.12) transparent}
      .l11s::-webkit-scrollbar{height:3px}
      .l11s::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.12);border-radius:3px}
    `;
    document.head.appendChild(s);
  }, []);

  // Groupes filtrés — ne conserve QUE les modules accessibles à
  // l'utilisateur ET pertinents pour le rôle actif (les items liés
  // à un AUTRE rôle sont masqués intégralement, pas juste grisés).
  const groupes = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (sections ?? [])
      .filter((s: NavSection) => secId === "all" || s.id === secId)
      .map((s: NavSection) => {
        const roots  = construireArbre(s.items ?? []);
        const tuiles = roots
          .filter(r => pourRoleActif((r as any).roles, activeRole))
          .map(r => ({ root: r, to: landingChemin(r) }))
          .filter(t => !!t.to)
          .filter(t => !needle ||
            t.root.label.toLowerCase().includes(needle) ||
            aplatir(t.root.enfants).some(d => d.label.toLowerCase().includes(needle)));
        return { sec: s, tuiles };
      })
      .filter(g => g.tuiles.length > 0);
  }, [sections, secId, q, activeRole]);

  // Résumé par GROUPE (niveau 1 du launcher) — toujours calculé sur
  // TOUS les groupes, indépendamment du pill/de la recherche actifs,
  // pour peupler l'écran "choisissez votre domaine".
  const groupesSummary = useMemo(() => {
    return (sections ?? [])
      .map((s: NavSection) => {
        const roots  = construireArbre(s.items ?? []);
        const tuiles = roots
          .filter(r => pourRoleActif((r as any).roles, activeRole))
          .map(r => ({ root: r, to: landingChemin(r) }))
          .filter(t => !!t.to);
        if (!tuiles.length) return null;
        const first = tuiles[0].root;
        const { color } = tileColors(first.module_code, first.code);
        const Icon = groupIcon(s.label, resolveIcon(first.icone, first.code, first.label));
        return { sec: s, count: tuiles.length, color, icon: Icon };
      })
      .filter((g): g is { sec: NavSection; count: number; color: string; icon: LucideIcon } => !!g);
  }, [sections, activeRole]);

  const totalAll = useMemo(() => groupesSummary.reduce((a, g) => a + g.count, 0), [groupesSummary]);

  // Écran "groupes" (niveau 1) affiché seulement si : plusieurs
  // groupes existent, le total de modules justifie l'étape
  // intermédiaire, aucun groupe n'est déjà sélectionné et aucune
  // recherche n'est en cours (une recherche redevient transversale
  // et court-circuite directement la vue à plat, comme dans Odoo).
  const showGroupGrid = groupesSummary.length > 1 && totalAll >= FLAT_THRESHOLD && secId === "all" && !q.trim();

  // Sélection "vedette" : les premiers modules du rôle actif, tous
  // ordres de sections confondus — mis en avant dans le panneau
  // "Votre espace {Rôle}". Masqué pendant une recherche/filtre pour
  // ne pas dupliquer visuellement le contenu.
  const featured = useMemo(() => {
    if (q.trim() || secId !== "all") return [];
    const tout = groupes.flatMap(g => g.tuiles);
    return tout.slice(0, 6);
  }, [groupes, q, secId]);

  const total = groupes.reduce((a, g) => a + g.tuiles.length, 0);
  const heure = new Date().getHours();
  const salut = heure < 12 ? "Bonjour" : heure < 18 ? "Bon après-midi" : "Bonsoir";

  // ── Styles partagés ────────────────────────────────────────
  const tbActionStyle: React.CSSProperties = {
    position:"relative", width:38, height:38, borderRadius:8,
    display:"flex", alignItems:"center", justifyContent:"center",
    background:"rgba(255,255,255,0.1)", border:"none", cursor:"pointer",
    transition:"background .13s", flexShrink:0,
  };

  // ─────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:"100vh", width:"100%", display:"flex", flexDirection:"column", position:"relative" }}>
      <BackgroundBlobs />
      <SafeBoundary><ChatBadgeReader  onValue={onMsgCb}  /></SafeBoundary>
      <SafeBoundary><TacheBadgeReader onValue={onTachCb} /></SafeBoundary>

      {/* Fond page */}
      <div style={{ position:"fixed", inset:0, zIndex:0, background:"linear-gradient(150deg,rgba(240,244,248,0.9) 0%,#f0f0ee 55%,rgba(235,240,248,0.85) 100%)" }}/>

      {/* ══════════════════════════════════════════════════════
          TOPBAR ANTHRO-SYS
          ══════════════════════════════════════════════════ */}
      <header
        role="banner"
        style={{
          position:"sticky", top:0, zIndex:20,
          height:60, padding:"0 22px",
          display:"flex", alignItems:"center", gap:12,
          background: TB_GRADIENT,
          boxShadow:"0 2px 12px rgba(0,0,0,0.22), 0 1px 0 rgba(255,255,255,0.06)",
        }}
      >
        {/* Logo Anthro-Sys — composant partagé (src/components/Logo.tsx), vrai fichier image */}
        <div style={{ display:"flex", alignItems:"center", flexShrink:0 }}>
          <Logo heightClass="h-12" />
        </div>

        {/* Spacer */}
        <div style={{ flex:1 }}/>

        {/* RG-05 : société active — composant interactif partagé avec
            AppLayout.tsx (pas un badge statique dupliqué) : un utilisateur
            multi-société doit pouvoir basculer depuis N'IMPORTE quel écran
            qui affiche la société active, pas seulement depuis AppLayout. */}
        <SelecteurSociete className="w-40 flex-shrink-0" />

        {/* Icônes d'action */}
        <div role="toolbar" aria-label="Actions" style={{ display:"flex", alignItems:"center", gap:3, marginRight:14 }}>

          {/* Messages */}
          <button
            style={tbActionStyle}
            title="Messages"
            aria-label="Messages"
            onClick={() => navigate("/messages")}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.18)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.10)")}
          >
            <Mail size={19} color="rgba(255,255,255,0.92)" />
          </button>

          {/* Notifications */}
          <button
            style={{ ...tbActionStyle, position:"relative" }}
            title="Notifications"
            aria-label={`${msgBadge + tachBadge || 3} notifications`}
            onClick={() => navigate("/notifications")}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.18)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.10)")}
          >
            <Bell size={19} color="rgba(255,255,255,0.92)" />
            <span style={{
              position:"absolute", top:5, right:5,
              width:17, height:17, borderRadius:"50%",
              background:"#e53935", color:"#fff",
              fontSize:9.5, fontWeight:700,
              display:"flex", alignItems:"center", justifyContent:"center",
              border:"2px solid #fff",
              boxShadow:"0 1px 4px rgba(229,57,53,0.5)",
            }} aria-hidden="true">
              {msgBadge + tachBadge || 3}
            </span>
          </button>

          {/* Chat */}
          <button
            style={tbActionStyle}
            title="Chat interne"
            aria-label="Chat interne"
            onClick={() => navigate("/messages")}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.18)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.10)")}
          >
            <MessageCircle size={19} color="rgba(255,255,255,0.92)" />
          </button>

          {/* Paramètres */}
          <button
            style={tbActionStyle}
            title="Paramètres"
            aria-label="Paramètres système"
            onClick={() => navigate("/parametres")}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.18)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.10)")}
          >
            <Settings size={19} color="rgba(255,255,255,0.92)" />
          </button>
        </div>

        {/* Séparateur */}
        <div style={{ width:1, height:30, background:"rgba(255,255,255,0.22)", flexShrink:0 }} role="separator"/>

        {/* Profil utilisateur */}
        <div ref={userRef} style={{ position:"relative", flexShrink:0 }}>
          <button
            onClick={() => setUserOpen(o => !o)}
            aria-haspopup="true"
            aria-expanded={userOpen}
            style={{
              display:"flex", alignItems:"center", gap:9,
              padding:"5px 10px 5px 5px", borderRadius:10,
              background: userOpen ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.1)",
              border:"none", cursor:"pointer", transition:"background .13s",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.18)")}
            onMouseLeave={e => { if (!userOpen) e.currentTarget.style.background = "rgba(255,255,255,0.10)"; }}
          >
            {/* Avatar */}
            <div style={{
              width:36, height:36, borderRadius:"50%", flexShrink:0,
              background:avBg, position:"relative",
              border:"2px solid rgba(255,255,255,0.45)",
              boxShadow:"0 2px 8px rgba(0,0,0,0.22)",
              display:"flex", alignItems:"center", justifyContent:"center",
            }}>
              <span style={{ fontSize:"calc(13px * var(--font-scale,1))", fontWeight:600, color:"#fff", letterSpacing:"-.2px", zIndex:1 }}>
                {nomInit}
              </span>
              {/* Dot présence */}
              <div style={{ position:"absolute", bottom:0, right:0, width:10, height:10, borderRadius:"50%", background:"#22c55e", border:"2px solid #1a4a9e", zIndex:2 }}/>
            </div>

            {/* Nom + rôle */}
            <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-start", lineHeight:1.25 }}>
              <span style={{ fontSize:"calc(13px * var(--font-scale,1))", fontWeight:600, color:"#fff", whiteSpace:"nowrap", textShadow:"0 1px 2px rgba(0,0,0,0.2)" }}>
                {nomComplet}
              </span>
              <span style={{ fontSize:"calc(10.5px * var(--font-scale,1))", color:"rgba(255,255,255,0.72)", textTransform:"capitalize" as const }}>
                {roleLabel}
              </span>
            </div>

            <ChevronDown size={14} color="rgba(255,255,255,0.75)"
              style={{ transform:userOpen?"rotate(180deg)":"none", transition:"transform .15s", flexShrink:0 }}/>
          </button>

          {/* Dropdown */}
          {userOpen && (
            <div style={{
              position:"absolute", right:0, top:"calc(100% + 8px)", zIndex:50,
              width:264, borderRadius:14,
              background:"#fff", border:"0.5px solid rgba(0,0,0,0.1)",
              boxShadow:"0 20px 50px rgba(0,0,0,0.16), 0 4px 16px rgba(0,0,0,0.08)",
              overflow:"hidden",
            }} role="menu">

              {/* Header dropdown */}
              <div style={{ background:TB_GRADIENT, padding:"14px 16px", display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:44, height:44, borderRadius:"50%", flexShrink:0, background:avBg, display:"flex", alignItems:"center", justifyContent:"center", border:"2px solid rgba(255,255,255,0.4)", fontSize:"calc(16px * var(--font-scale,1))", fontWeight:600, color:"#fff" }}>
                  {nomInit}
                </div>
                <div>
                  <div style={{ fontSize:"calc(13.5px * var(--font-scale,1))", fontWeight:600, color:"#fff" }}>{nomComplet}</div>
                  <div style={{ fontSize:"calc(11px * var(--font-scale,1))", color:"rgba(255,255,255,0.65)", marginTop:2 }}>{email}</div>
                </div>
              </div>

              {/* Switch profil */}
              {profils.length > 0 && (
                <div style={{ padding:"8px 8px 4px", borderBottom:"0.5px solid rgba(0,0,0,0.07)" }}>
                  <div style={{ fontSize:"calc(9.5px * var(--font-scale,1))", fontWeight:700, letterSpacing:".6px", textTransform:"uppercase" as const, color:"#aaa", padding:"2px 8px 5px" }}>
                    {profils.length > 1 ? "Mes profils" : "Profil actif"}
                  </div>
                  {profils.map((r: string) => {
                    const actif = r === activeRole;
                    return (
                      <button key={r} onClick={() => switchProfil(r)} role="menuitem" style={{
                        width:"100%", padding:"7px 10px", borderRadius:9, border:"none", cursor:"pointer",
                        background: actif ? "rgba(27,73,144,0.09)" : "transparent",
                        color: actif ? "#1b4990" : "#333",
                        fontSize:"calc(12.5px * var(--font-scale,1))", fontWeight:actif?600:500,
                        textAlign:"left" as const, display:"flex", alignItems:"center", gap:8,
                      }}
                        onMouseEnter={e => { if (!actif) e.currentTarget.style.background = "#f5f5f3"; }}
                        onMouseLeave={e => { if (!actif) e.currentTarget.style.background = "transparent"; }}
                      >
                        <ShieldCheck size={14} color={actif ? "#1b4990" : "#bbb"} style={{ flexShrink:0 }}/>
                        <span style={{ flex:1, textTransform:"capitalize" as const, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {r.replace(/_/g," ")}
                        </span>
                        {actif && <Check size={13} color="#1b4990" style={{ flexShrink:0 }}/>}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Actions */}
              <div style={{ padding:8 }}>
                {([
                  ["/profile",    "Mon profil",  UserCog],
                  ["/appearance", "Apparence",   Palette],
                  ["/parametres", "Paramètres",  Settings],
                ] as [string, string, React.ElementType][]).map(([to, lbl, Icon]) => (
                  <Link key={to} to={to} onClick={() => setUserOpen(false)} role="menuitem"
                    style={{ padding:"8px 10px", borderRadius:9, color:"#333", fontSize:"calc(12.5px * var(--font-scale,1))", display:"flex", alignItems:"center", gap:9, textDecoration:"none" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#f5f5f3")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    <Icon size={15} color="#999" /> {lbl}
                  </Link>
                ))}
                <div style={{ height:"0.5px", background:"rgba(0,0,0,0.08)", margin:"4px 0" }}/>
                <button onClick={onLogout} role="menuitem" style={{ width:"100%", padding:"8px 10px", borderRadius:9, border:"none", cursor:"pointer", background:"transparent", color:"#e53935", fontSize:"calc(12.5px * var(--font-scale,1))", fontWeight:500, display:"flex", alignItems:"center", gap:9 }}
                  onMouseEnter={e => (e.currentTarget.style.background = "rgba(229,57,53,0.07)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  <LogOut size={15} color="#e53935"/> Déconnexion
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* ══════════════════════════════════════════════════════
          LAUNCHER
          ══════════════════════════════════════════════════ */}
      <div style={{ position:"relative", zIndex:1, flex:1, display:"flex", flexDirection:"column" }}>

        {/* Hero */}
        <div className="l11h" style={{ textAlign:"center", padding:"36px 20px 20px" }}>
          <h1 style={{ fontSize:"calc(22px * var(--font-scale,1))", fontWeight:500, color:"#1a1a18", letterSpacing:"-.4px" }}>
            {salut}{prenom ? `, ${prenom}` : ""} 👋
          </h1>
          <p style={{ fontSize:"calc(13px * var(--font-scale,1))", color:"#777", marginTop:4 }}>
            Que souhaitez-vous faire aujourd'hui ?
          </p>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, marginTop:12, flexWrap:"wrap" }}>
            {activeRole && (
              <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 12px", borderRadius:999, background:"rgba(27,73,144,0.09)", border:"0.5px solid rgba(27,73,144,0.2)", color:"#1b4990", fontSize:"calc(11px * var(--font-scale,1))", fontWeight:600 }}>
                <ShieldCheck size={11}/> {roleLabel}
              </span>
            )}
            {!loading && (
              <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 12px", borderRadius:999, background:"rgba(0,0,0,0.05)", border:"0.5px solid rgba(0,0,0,0.1)", color:"#888", fontSize:"calc(11px * var(--font-scale,1))", fontWeight:500 }}>
                <Sparkles size={11}/> {total} module{total!==1?"s":""} accessibles
              </span>
            )}
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════
            VOTRE ESPACE {RÔLE} — panneau vedette premium
            ══════════════════════════════════════════════════ */}
        {featured.length > 0 && (
          <div style={{ padding:"0 clamp(14px,4vw,52px) 8px", maxWidth:1440, margin:"0 auto", width:"100%" }}>
            <div style={{
              position:"relative", overflow:"hidden", borderRadius:22,
              padding:"22px clamp(16px,3vw,28px) 24px",
              background:`linear-gradient(135deg, ${roleAccent}14, rgba(255,255,255,0.55) 55%, ${roleAccent}0c)`,
              border:`1px solid ${roleAccent}2e`,
              boxShadow:`0 18px 46px ${roleAccent}1c, 0 2px 10px rgba(0,0,0,0.04)`,
            }}>
              {/* Halo décoratif animé */}
              <div aria-hidden="true" style={{
                position:"absolute", top:-70, right:-60, width:220, height:220, borderRadius:"50%",
                background:`radial-gradient(circle, ${roleAccent}33, transparent 70%)`,
                animation:"l11-glow 5s ease-in-out infinite",
              }}/>
              <div aria-hidden="true" style={{
                position:"absolute", bottom:-80, left:"18%", width:180, height:180, borderRadius:"50%",
                background:`radial-gradient(circle, ${roleAccent}22, transparent 70%)`,
                animation:"l11-glow 6.5s ease-in-out infinite 1.2s",
              }}/>

              <div style={{ position:"relative", display:"flex", alignItems:"center", gap:9, marginBottom:16, flexWrap:"wrap" }}>
                <div style={{
                  width:30, height:30, borderRadius:9, flexShrink:0,
                  display:"flex", alignItems:"center", justifyContent:"center",
                  background:`${roleAccent}20`, border:`1px solid ${roleAccent}45`,
                }}>
                  <Sparkles size={15} color={roleAccent} />
                </div>
                <h2 style={{ fontSize:"calc(15.5px * var(--font-scale,1))", fontWeight:600, color:"#1a1a18", letterSpacing:"-.2px" }}>
                  Votre espace <span style={{ color:roleAccent }}>{roleLabel}</span>
                </h2>
                <span style={{
                  fontSize:"calc(10.5px * var(--font-scale,1))", fontWeight:600, letterSpacing:".4px",
                  color:roleAccent, background:`${roleAccent}15`, border:`0.5px solid ${roleAccent}35`,
                  padding:"2px 9px", borderRadius:999, textTransform:"uppercase" as const,
                }}>
                  Sélection pour vous
                </span>
              </div>

              <div style={{
                position:"relative", display:"grid",
                gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))", gap:12,
              }}>
                {featured.map(({ root, to }, i) => {
                  const Icon = resolveIcon(root.icone, root.code, root.label);
                  return (
                    <FeaturedTile
                      key={root.id} label={root.label} to={to!}
                      icon={Icon} accent={roleAccent} delay={i * 55}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Barre recherche — toujours visible, transversale à tous les groupes */}
        <div style={{ padding:"0 clamp(14px,4vw,52px) 20px", maxWidth:1440, margin:"0 auto", width:"100%" }}>

          {/* Recherche */}
          <div style={{ display:"flex", alignItems:"center", gap:7, padding:"0 12px", height:34, background:"rgba(255,255,255,0.8)", border:"0.5px solid rgba(0,0,0,0.12)", borderRadius:9, marginBottom: showGroupGrid ? 0 : 14 }}>
            <Search size={14} color="#aaa" style={{ flexShrink:0 }}/>
            <input
              ref={searchRef}
              value={q} onChange={e => setQ(e.target.value)}
              placeholder="Rechercher un module… (⌘K)"
              className="bg-transparent outline-none placeholder:text-gray-400 flex-1"
              style={{ fontSize:"calc(13px * var(--font-scale,1))", color:"#222", minWidth:0, border:"none", background:"transparent" }}
            />
            {q && (
              <button onClick={() => setQ("")} style={{ background:"none", border:"none", cursor:"pointer", color:"#bbb", fontSize:17, lineHeight:1 }}>×</button>
            )}
          </div>

          {/* Retour au launcher précédent — simple icône, plus de barre de
              pills listant tous les groupes (redondant avec le niveau 1) */}
          {secId !== "all" && (
            <button
              onClick={() => setSecId("all")}
              title="Retour au launcher principal"
              aria-label="Retour au launcher principal"
              style={{
                display:"flex", alignItems:"center", justifyContent:"center",
                width:36, height:36, borderRadius:11, marginTop:14,
                border:"0.5px solid rgba(0,0,0,0.13)", background:"#fff",
                cursor:"pointer", color:"#555", transition:"all .15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "#f2f2f0"; e.currentTarget.style.color = "#1b4990"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.color = "#555"; }}
            >
              <ArrowLeft size={17}/>
            </button>
          )}
        </div>

        {/* Écran "groupes" (niveau 1) — façon écran d'accueil des apps Odoo :
            on choisit d'abord son domaine avant d'entrer dans son launcher */}
        {showGroupGrid && (
          <div style={{ padding:"4px clamp(14px,4vw,52px) 60px", maxWidth:1440, margin:"0 auto", width:"100%" }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:14 }}>
              {groupesSummary.map((g, i) => (
                <GroupTile
                  key={g.sec.id}
                  label={g.sec.label} count={g.count}
                  icon={g.icon} color={g.color}
                  onClick={() => setSecId(g.sec.id)}
                  delay={i * 45}
                />
              ))}
            </div>
          </div>
        )}

        {/* Grille de modules (niveau 2 — "Tous les modules" ou un groupe précis) */}
        {!showGroupGrid && (
        <div style={{ padding:"0 clamp(14px,4vw,52px) 60px", maxWidth:1440, margin:"0 auto", width:"100%" }}>
          {loading ? (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(124px,1fr))", gap:9 }}>
              {Array.from({length:10}).map((_,i) => (
                <div key={i} className="animate-pulse l11t" style={{ height:124, borderRadius:12, background:"rgba(255,255,255,0.6)", animationDelay:`${i*35}ms` }}/>
              ))}
            </div>
          ) : groupes.length === 0 ? (
            <div style={{ textAlign:"center", padding:"52px 0", color:"#999", fontSize:"calc(14px * var(--font-scale,1))" }}>
              <div style={{ fontSize:44, marginBottom:12 }}>🔍</div>Aucun module trouvé.
            </div>
          ) : groupes.map((g, gi) => (
            <React.Fragment key={g.sec.id}>
              {/* En-tête de section */}
              <div style={{ display:"flex", alignItems:"center", gap:10, margin:gi===0?"0 0 14px":"24px 0 14px" }}>
                <div style={{ width:3, height:15, borderRadius:2, background:"linear-gradient(180deg,#1b4990,#3b7dd8 60%,rgba(59,125,216,0.3))" }}/>
                <span style={{ fontSize:"calc(10.5px * var(--font-scale,1))", fontWeight:600, letterSpacing:".7px", textTransform:"uppercase" as const, color:"#999" }}>
                  {g.sec.label}
                </span>
                <div style={{ flex:1, height:"0.5px", background:"rgba(0,0,0,0.1)" }}/>
                <span style={{ fontSize:"calc(10px * var(--font-scale,1))", color:"#bbb" }}>
                  {g.tuiles.length} module{g.tuiles.length!==1?"s":""}
                </span>
              </div>

              <div style={{ display:"flex", flexWrap:"wrap", justifyContent:"center", gap:14, marginBottom:4 }}>
                {g.tuiles.map(({root,to},ti) => {
                  const { color, bg } = tileColors(root.module_code, root.code);
                  const Icon = resolveIcon(root.icone, root.code, root.label);
                  const badge = badgeDe(root.module_code ?? root.code);
                  return (
                    <div key={root.id} className="l11t" style={{ animationDelay:`${(gi*7+ti)*28}ms` }}>
                      <AppTile
                        label={root.label} to={to!}
                        color={color} bg={bg}
                        moduleCode={root.module_code} icon={Icon}
                        badge={badge}
                        isNew={(root as any).is_new}
                        isBeta={(root as any).is_beta}
                      />
                    </div>
                  );
                })}
              </div>
            </React.Fragment>
          ))}
        </div>
        )}

        <footer style={{ textAlign:"center", padding:"16px 20px", fontSize:"calc(11px * var(--font-scale,1))", color:"rgba(0,0,0,0.3)", letterSpacing:".3px", borderTop:"0.5px solid rgba(0,0,0,0.07)" }}>
          ANTHRO-SYS SIRH Enterprise · © {new Date().getFullYear()}
        </footer>
      </div>
    </div>
  );
}
