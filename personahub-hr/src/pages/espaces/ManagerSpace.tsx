/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║              ESPACE MANAGER — ANTHRO-SYS SIRH                       ║
 * ║                                                                      ║
 * ║  Toutes les fonctionnalités d'un Manager moderne :                   ║
 * ║  • Tableau de bord équipe temps réel                                 ║
 * ║  • Gestion des absences & congés (approbation/refus)                 ║
 * ║  • Planning d'équipe (Gantt visuel)                                   ║
 * ║  • Gestion des départs & offboarding                                 ║
 * ║  • Entretiens & évaluations                                          ║
 * ║  • Alertes & notifications RH                                        ║
 * ║  • Export Excel & reporting                                          ║
 * ║                                                                      ║
 * ║  RG-MANAGER-* (Adil DAIA) — Toutes règles commentées                 ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import React, { useState, useMemo, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { db, api, tokenStore } from "@/lib/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import UoTreePicker from "@/components/UoTreePicker";
import {
  Users, Calendar, CheckCircle, XCircle, Clock, AlertTriangle,
  TrendingUp, TrendingDown, Bell, Search, Filter, Download,
  ChevronRight, ChevronLeft, ChevronDown, Eye, Edit3,
  DoorOpen, Star, Award, Target, Activity, BarChart3,
  Building2, Briefcase, UserCircle2, ArrowUpDown, ArrowUp,
  ArrowDown, RefreshCw, MessageSquare, ThumbsUp, ThumbsDown,
  CalendarDays, FileText, Plus, Zap, Info, X, Check,
  Heart, Coffee, Sunrise, Sunset, Moon, Palette, CalendarCheck,
  Sun, Monitor, LayoutGrid, List,
} from "lucide-react";
import { useManagerPopulation } from "@/hooks/useManagerPopulation";
import { format, parseISO, differenceInDays, differenceInYears,
  isToday, isTomorrow, isThisWeek, startOfWeek, endOfWeek,
  startOfMonth, endOfMonth, addDays, subDays, isSameDay,
  isWithinInterval, getDay } from "date-fns";
import { fr } from "date-fns/locale";
import * as XLSX from "xlsx";
import CongesModule from "@/pages/espaces/manager/conges/CongesPage";
import SuiviDemandeWorkflow from "@/pages/espaces/SuiviDemandeWorkflow";

// ═══════════════════════════════════════════════════════════
// DESIGN SYSTEM
// ═══════════════════════════════════════════════════════════

const DS = {
  accent:  "hsl(220 90% 56%)",
  accentL: "hsl(220 90% 56%/0.12)",
  green:   "hsl(142 71% 45%)",
  greenL:  "hsl(142 71% 45%/0.1)",
  amber:   "hsl(38 92% 50%)",
  amberL:  "hsl(38 92% 50%/0.1)",
  red:     "hsl(0 84% 55%)",
  redL:    "hsl(0 84% 55%/0.09)",
  purple:  "hsl(265 70% 58%)",
  purpleL: "hsl(265 70% 58%/0.1)",
  teal:    "hsl(174 72% 40%)",
  tealL:   "hsl(174 72% 40%/0.1)",
};

// ═══════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════

interface UO {
  id: string;
  code?: string;
  libelle: string;
  parent_id?: string | null;
  niveau?: number;
}

interface CollabAffectation {
  collaborateur_id: string;
  unite_id: string;
}

interface Collab {
  id: string;
  nom: string;
  prenom: string;
  matricule: string;
  statut_collaborateur: string;
  photo_path?: string | null;
  date_naissance?: string | null;
  genre?: string | null;
}

interface Demande {
  id: string;
  collaborateur_id: string;
  code_type_conge: string;
  date_debut: string;
  date_fin_absence: string;
  date_retour?: string | null;
  nbr_jours_decomptes: number;
  nbr_jours_calendaires: number;
  statut: string;
  commentaire_collaborateur?: string | null;
  motif_refus?: string | null;
  created_at: string;
  collaborateurs?: { nom: string; prenom: string; matricule: string; photo_path?: string };
}

interface Depart {
  id: string;
  collaborateur_id: string;
  date_depart: string;
  motif_depart: string;
  statut?: string;
  preavis_date_fin?: string | null;
  collaborateurs?: { nom: string; prenom: string; matricule: string };
}

interface SoldeConge {
  collaborateur_id: string;
  code_type_conge: string;
  solde_restant: number;
  solde_acquis: number;
  solde_pris: number;
  collaborateurs?: { nom: string; prenom: string; matricule: string };
}

// ═══════════════════════════════════════════════════════════
// SOUS-COMPOSANTS RÉUTILISABLES
// ═══════════════════════════════════════════════════════════

const KpiCard = ({ icon, label, value, sub, color, trend }: {
  icon: React.ReactNode; label: string; value: string | number;
  sub?: string; color: string; trend?: "up" | "down" | "neutral";
}) => (
  <div className="rounded-2xl p-5 flex flex-col gap-3 relative overflow-hidden"
    style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
    <div className="absolute top-0 right-0 w-24 h-24 rounded-full -mr-8 -mt-8 opacity-[0.06]"
      style={{ background: color }} />
    <div className="flex items-start justify-between">
      <div className="p-2.5 rounded-xl" style={{ background: `${color}18`, color }}>
        {icon}
      </div>
      {trend && (
        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
          style={{
            background: trend === "up" ? DS.greenL : trend === "down" ? DS.redL : DS.amberL,
            color: trend === "up" ? DS.green : trend === "down" ? DS.red : DS.amber,
          }}>
          {trend === "up" ? "↑" : trend === "down" ? "↓" : "→"}
        </span>
      )}
    </div>
    <div>
      <p className="text-2xl font-bold tracking-tight" style={{ color: "hsl(var(--foreground))" }}>
        {value}
      </p>
      <p className="text-xs font-medium mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</p>
      {sub && <p className="text-[10px] mt-1" style={{ color: "hsl(var(--muted-foreground))", opacity: 0.7 }}>{sub}</p>}
    </div>
  </div>
);

const Avatar = ({ collab, size = 36 }: { collab: any; size?: number }) => {
  const url = collab?.photo_path || collab?.photo_url;
  const initiales = `${collab?.prenom?.[0] || ""}${collab?.nom?.[0] || ""}`;
  const colors = ["hsl(220 90% 56%)", "hsl(142 71% 45%)", "hsl(265 70% 58%)", "hsl(174 72% 40%)", "hsl(38 92% 50%)"];
  const colorIdx = (collab?.matricule || "").charCodeAt(0) % colors.length;
  return url ? (
    <img src={url} className="rounded-full object-cover flex-shrink-0"
      style={{ width: size, height: size, border: "2px solid hsl(var(--border))" }}
      onError={e => { (e.target as HTMLImageElement).src = ""; }} />
  ) : (
    <div className="rounded-full flex items-center justify-center font-bold flex-shrink-0"
      style={{ width: size, height: size, fontSize: size <= 28 ? 10 : size <= 36 ? 12 : 14,
        background: `${colors[colorIdx]}20`, color: colors[colorIdx] }}>
      {initiales || "?"}
    </div>
  );
};

const StatutBadge = ({ statut }: { statut: string }) => {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    ACTIF:     { bg: DS.greenL,  color: DS.green,  label: "Actif" },
    EN_DEPART: { bg: DS.amberL,  color: DS.amber,  label: "En départ" },
    SORTI:     { bg: DS.redL,    color: DS.red,    label: "Sorti" },
    SUSPENDU:  { bg: DS.purpleL, color: DS.purple, label: "Suspendu" },
  };
  const s = map[statut] || { bg: "hsl(var(--muted)/0.4)", color: "hsl(var(--muted-foreground))", label: statut };
  return (
    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold inline-flex items-center gap-1"
      style={{ background: s.bg, color: s.color }}>
      <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: s.color }} />
      {s.label}
    </span>
  );
};

// ═══════════════════════════════════════════════════════════
// COMPOSANT PRINCIPAL
// ═══════════════════════════════════════════════════════════

const ManagerSpace: React.FC = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();

  // ── Navigation principale (pilotable depuis le menu latéral via ?tab=) ──
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<
    "dashboard" | "equipe" | "absences" | "planning" | "departs" |
    "evaluations" | "alertes" | "calendrier" | "trombinoscope" | "apparence"
  >((searchParams.get("tab") as any) || "dashboard");

  // URL -> onglet : le menu latéral (chemin /espace-manager?tab=...) change l'onglet
  useEffect(() => {
    const t = searchParams.get("tab");
    if (t && t !== activeTab) setActiveTab(t as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  // onglet -> URL : garde l'URL en phase (deep-link + surbrillance du menu)
  useEffect(() => {
    const t = searchParams.get("tab");
    if (activeTab && activeTab !== t) {
      const next = new URLSearchParams(searchParams);
      next.set("tab", activeTab);
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // ── États globaux ─────────────────────────────────────
  const [search, setSearch] = useState("");
  const [selectedCollab, setSelectedCollab] = useState<string | null>(null);
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [motifRefus, setMotifRefus] = useState("");
  const [showRefusDialog, setShowRefusDialog] = useState<string | null>(null);
  const [currentWeek, setCurrentWeek] = useState(new Date());

  // ── États calendrier mensuel ──────────────────────────
  const [currentMonth, setCurrentMonth] = useState(new Date());

  // ── États trombinoscope ───────────────────────────────
  const [troSearch, setTroSearch] = useState("");
  const [troFilter, setTroFilter] = useState<"tous" | "absents" | "presents">("tous");

  // ── Vue équipe : par UO ou liste plate ───────────────
  const [vueEquipe, setVueEquipe] = useState<"uo" | "liste">("uo");
  const [uosOuvertes, setUosOuvertes] = useState<Set<string>>(new Set());
  const toggleUO = (id: string) => setUosOuvertes(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // ── États apparence ───────────────────────────────────
  const [themeMode, setThemeMode] = useState<"light" | "dark" | "system">("system");
  const [accentColor, setAccentColor] = useState("#3B82F6");
  const [fontSize, setFontSize] = useState<"sm" | "md" | "lg">("md");
  const [sidebarCompact, setSidebarCompact] = useState(false);
  const [congesExpanded, setCongesExpanded] = useState(false);

  // ── Périmètre manager ─────────────────────────────────
  // RG-MANAGER-PERIMETRE-01 (Adil DAIA) : useManagerPopulation résout
  // dynamiquement les collaborateurs N+1 et N+2 (liens organigramme + forcés).
  // - role === "manager"        → filtre strict sur managerCollabIds
  // - role === "administrateur" ou "gestionnaire_rh" → tous les collabs
  const { user, role } = useAuth();
  const { collaborateurIds: managerCollabIds, loading: popLoading } = useManagerPopulation();
  const isManager = role === "manager";

  const { data: equipe = [], isLoading: equipeLoading } = useQuery<Collab[]>({
    queryKey: ["manager-equipe", isManager, managerCollabIds.join(",")],
    enabled: !popLoading,
    queryFn: async () => {
      // RG-MANAGER-PERIMETRE-02 (Adil DAIA) : Manager → périmètre strict.
      // Admin/RH → périmètre global.
      if (isManager) {
        if (managerCollabIds.length === 0) return [];
        return await api.get(
          `/db/collaborateurs` +
          `?id=in.(${managerCollabIds.join(",")})` +
          `&archive=eq.false` +
          `&statut_collaborateur=in.(ACTIF,EN_DEPART)` +
          `&select=id,nom,prenom,matricule,statut_collaborateur,photo_path,date_naissance` +
          `&order=nom.asc`
        ) || [];
      }
      return await api.get(
        `/db/collaborateurs` +
        `?archive=eq.false` +
        `&statut_collaborateur=in.(ACTIF,EN_DEPART)` +
        `&select=id,nom,prenom,matricule,statut_collaborateur,photo_path,date_naissance` +
        `&order=nom.asc&limit=500`
      ) || [];
    },
  });

  const equipeIds = useMemo(() => equipe.map(c => c.id), [equipe]);

  // ── Demandes de congés en attente ─────────────────────
  // RG-MANAGER-CONGE-01 (Adil DAIA) : Le manager approuve ou refuse
  // les demandes de son périmètre. Seules les demandes EN_ATTENTE
  // requièrent une action.
  const { data: demandes = [], isLoading: demandesLoading } = useQuery<Demande[]>({
    queryKey: ["manager-demandes", equipeIds],
    enabled: equipeIds.length > 0,
    queryFn: async () => {
      if (!equipeIds.length) return [];
      return await api.get(
        `/db/cong_demande?collaborateur_id=in.(${equipeIds.join(",")})&archive=eq.false&order=created_at.desc&limit=200`
      ) || [];
    },
    refetchInterval: 60000,
  });

  const demandesEnAttente = useMemo(() =>
    demandes.filter(d => d.statut === "EN_ATTENTE" || d.statut === "BROUILLON"), [demandes]);

  // ── Soldes congés de l'équipe ─────────────────────────
  const { data: soldes = [] } = useQuery<SoldeConge[]>({
    queryKey: ["manager-soldes", equipeIds],
    enabled: equipeIds.length > 0,
    queryFn: async () => {
      if (!equipeIds.length) return [];
      return await api.get(
        `/db/cong_solde?collaborateur_id=in.(${equipeIds.join(",")})&exercice=eq.${new Date().getFullYear()}`
      ) || [];
    },
  });

  // ── Départs ───────────────────────────────────────────
  // Source unique : endpoint backend /departs/equipe, scopé selon le rôle ACTIF.
  //  - admin/RH  -> tous les départs
  //  - manager   -> périmètre RG-MGR-POP-01 INCLUANT les personnes déjà sorties
  //                 (affectations clôturées prises en compte côté serveur).
  // On ne dépend plus de `equipe` (qui exclut les collaborateurs non actifs).
  const { data: departs = [] } = useQuery<Depart[]>({
    queryKey: ["manager-departs", role],
    enabled: !!role,
    queryFn: async () => {
      return await api.get(
        `/departs/equipe?role_actif=${encodeURIComponent(role || "")}`
      ) || [];
    },
  });

  // Résolution des collaborateurs concernés par un départ (peuvent être déjà
  // sortis, donc absents de `equipe`) — fetch dédié sans filtre de statut.
  const departCollabIds = useMemo(
    () => Array.from(new Set(departs.map((d) => d.collaborateur_id).filter(Boolean))),
    [departs]
  );
  const { data: departCollabs = [] } = useQuery<Collab[]>({
    queryKey: ["depart-collabs", departCollabIds.join(",")],
    enabled: departCollabIds.length > 0,
    queryFn: async () => {
      if (!departCollabIds.length) return [];
      return await api.get(
        `/db/collaborateurs?id=in.(${departCollabIds.join(",")})` +
        `&select=id,nom,prenom,matricule,statut_collaborateur,photo_path&limit=1000`
      ) || [];
    },
  });

  // ── UOs du manager (pour regroupement) ──────────────
  const { data: uosManager = [] } = useQuery<UO[]>({
    queryKey: ["manager-uos", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      // Le proxy /db refuse le tri multi-colonnes (order=niveau,libelle → 400).
      // On trie donc sur une seule colonne côté serveur, puis on affine en JS.
      const rows: UO[] = (await api.get(
        "/db/unites_organisationnelles?actif=eq.true&order=niveau&limit=500"
      )) || [];
      return [...rows].sort(
        (a, b) =>
          ((a as any).niveau ?? 0) - ((b as any).niveau ?? 0) ||
          (a.libelle || "").localeCompare(b.libelle || "")
      );
    },
  });

  // ── Affectations actives de l'équipe (pour savoir à quelle UO appartient chaque collab) ──
  const { data: affectationsEquipe = [] } = useQuery<CollabAffectation[]>({
    queryKey: ["manager-affectations", equipeIds],
    enabled: equipeIds.length > 0,
    queryFn: async () => {
      return await api.get(
        `/db/collaborateur_affectations?collaborateur_id=in.(${equipeIds.join(",")})&archive=eq.false&date_fin_uo=is.null`
      ) || [];
    },
  });

  // ── Regroupement collaborateurs par UO ───────────────
  const equipeParUO = useMemo(() => {
    // Map collaborateur_id → unite_id
    const collabToUO = new Map<string, string>();
    affectationsEquipe.forEach(a => collabToUO.set(a.collaborateur_id, a.unite_id));

    // Grouper par unite_id
    const groups = new Map<string, Collab[]>();
    const sansUO: Collab[] = [];

    equipe.forEach(c => {
      const uniteId = collabToUO.get(c.id);
      if (!uniteId) { sansUO.push(c); return; }
      if (!groups.has(uniteId)) groups.set(uniteId, []);
      groups.get(uniteId)!.push(c);
    });

    // Construire la liste des groupes triés par niveau UO puis libellé
    const result: { uo: UO | null; collabs: Collab[] }[] = [];

    // Trier les UOs par niveau puis libellé
    const sortedUOs = [...uosManager]
      .filter(uo => groups.has(uo.id))
      .sort((a, b) => ((a.niveau ?? 99) - (b.niveau ?? 99)) || a.libelle.localeCompare(b.libelle));

    sortedUOs.forEach(uo => {
      result.push({ uo, collabs: groups.get(uo.id) || [] });
    });

    if (sansUO.length > 0) {
      result.push({ uo: null, collabs: sansUO });
    }

    return result;
  }, [equipe, affectationsEquipe, uosManager]);

  // ═══════════════════════════════════════════════════════════
  // ÉCRAN "DÉPARTS" : résolution, filtres (UO, période, motifs…), vue
  // ═══════════════════════════════════════════════════════════
  const collabById = useMemo(() => {
    const m = new Map<string, Collab>();
    equipe.forEach((c) => m.set(c.id, c));
    // Compléter avec les collaborateurs partis (absents de `equipe`)
    departCollabs.forEach((c) => { if (!m.has(c.id)) m.set(c.id, c as any); });
    return m;
  }, [equipe, departCollabs]);

  // collab → UO (depuis affectations actives)
  const collabToUoId = useMemo(() => {
    const m = new Map<string, string>();
    affectationsEquipe.forEach((a) => { if (a.unite_id) m.set(a.collaborateur_id, a.unite_id); });
    return m;
  }, [affectationsEquipe]);

  // États de filtre / vue
  const [departVue, setDepartVue] = useState<"cartes" | "liste">("cartes");
  const [departSearch, setDepartSearch] = useState("");
  const [departMotifs, setDepartMotifs] = useState<string[]>([]);          // multi-choix
  const [departStatut, setDepartStatut] = useState<"actifs" | "avenir" | "partis" | "annules" | "tous">("actifs");
  const [departTri, setDepartTri] = useState<"date_asc" | "date_desc" | "nom">("date_asc");
  const [departUoIds, setDepartUoIds] = useState<string[]>([]);            // multi (UoTreePicker)
  const [departPeriode, setDepartPeriode] =
    useState<"tous" | "ce_mois" | "30j" | "90j" | "annee" | "perso">("tous");
  const [departDateMin, setDepartDateMin] = useState("");
  const [departDateMax, setDepartDateMax] = useState("");
  const [departDetail, setDepartDetail] = useState<any | null>(null);      // modale détail

  const motifsDisponibles = useMemo(
    () => Array.from(new Set(departs.map((d) => d.motif_depart).filter(Boolean))).sort(),
    [departs]
  );

  // Étend la sélection d'UO à tous leurs descendants (arbre uosManager)
  const uoSetSelectionne = useMemo(() => {
    if (departUoIds.length === 0) return null; // null = pas de filtre UO
    const enfantsParParent = new Map<string, string[]>();
    uosManager.forEach((u) => {
      const p = u.parent_id || "";
      if (!enfantsParParent.has(p)) enfantsParParent.set(p, []);
      enfantsParParent.get(p)!.push(u.id);
    });
    const out = new Set<string>();
    const pile = [...departUoIds];
    while (pile.length) {
      const id = pile.pop()!;
      if (out.has(id)) continue;
      out.add(id);
      (enfantsParParent.get(id) || []).forEach((c) => pile.push(c));
    }
    return out;
  }, [departUoIds, uosManager]);

  // Fenêtre de dates selon le mode période
  const periodeRange = useMemo<{ min: Date | null; max: Date | null }>(() => {
    const now = new Date();
    switch (departPeriode) {
      case "ce_mois": return { min: startOfMonth(now), max: endOfMonth(now) };
      case "30j":     return { min: now, max: addDays(now, 30) };
      case "90j":     return { min: now, max: addDays(now, 90) };
      case "annee":   return { min: new Date(now.getFullYear(), 0, 1), max: new Date(now.getFullYear(), 11, 31) };
      case "perso":   return {
        min: departDateMin ? parseISO(departDateMin) : null,
        max: departDateMax ? parseISO(departDateMax) : null,
      };
      default:        return { min: null, max: null };
    }
  }, [departPeriode, departDateMin, departDateMax]);

  const departsAffiches = useMemo(() => {
    const today = new Date();
    let list = departs.map((d) => {
      const c = collabById.get(d.collaborateur_id);
      const days = d.date_depart ? differenceInDays(parseISO(d.date_depart), today) : 0;
      const statut = String(d.statut || "").toUpperCase(); // PLANIFIE | TRAITE | ANNULE
      return {
        ...d, _collab: c, _days: days, _statut: statut,
        _uo: collabToUoId.get(d.collaborateur_id) || null,
      };
    });

    const q = departSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((d) => {
        const c = d._collab;
        return (
          `${c?.prenom ?? ""} ${c?.nom ?? ""}`.toLowerCase().includes(q) ||
          (c?.matricule ?? "").toLowerCase().includes(q)
        );
      });
    }
    if (departMotifs.length) list = list.filter((d) => departMotifs.includes(d.motif_depart));

    // Statut métier (les annulés sont masqués sauf si explicitement demandés)
    if (departStatut === "actifs") list = list.filter((d) => d._statut !== "ANNULE");
    else if (departStatut === "avenir") list = list.filter((d) => d._statut === "PLANIFIE" && d._days >= 0);
    else if (departStatut === "partis") list = list.filter((d) => d._statut === "TRAITE");
    else if (departStatut === "annules") list = list.filter((d) => d._statut === "ANNULE");
    // "tous" : aucun filtre statut

    if (uoSetSelectionne) list = list.filter((d) => d._uo && uoSetSelectionne.has(d._uo));

    if (periodeRange.min || periodeRange.max) {
      list = list.filter((d) => {
        if (!d.date_depart) return false;
        const dt = parseISO(d.date_depart);
        if (periodeRange.min && dt < periodeRange.min) return false;
        if (periodeRange.max && dt > periodeRange.max) return false;
        return true;
      });
    }

    list.sort((a, b) => {
      if (departTri === "nom")
        return `${a._collab?.nom ?? ""}`.localeCompare(`${b._collab?.nom ?? ""}`);
      const da = a.date_depart || "";
      const dbb = b.date_depart || "";
      return departTri === "date_desc" ? dbb.localeCompare(da) : da.localeCompare(dbb);
    });
    return list;
  }, [departs, collabById, collabToUoId, departSearch, departMotifs, departStatut, departTri, uoSetSelectionne, periodeRange]);

  // Badge cohérent avec le vrai statut métier
  const departBadge = (d: any): { label: string; bg: string; color: string } => {
    if (d._statut === "ANNULE") return { label: "Annulé", bg: "hsl(var(--muted)/0.6)", color: "hsl(var(--muted-foreground))" };
    if (d._statut === "TRAITE") return { label: "Parti", bg: DS.greenL, color: DS.green };
    // PLANIFIE (ou autre) → échéance
    const j = d._days;
    if (j < 0) return { label: "À traiter", bg: DS.redL, color: DS.red };
    if (j === 0) return { label: "Aujourd'hui", bg: DS.redL, color: DS.red };
    if (j <= 7) return { label: `Dans ${j}j`, bg: DS.redL, color: DS.red };
    if (j <= 30) return { label: `Dans ${j}j`, bg: DS.amberL, color: DS.amber };
    return { label: `Dans ${j}j`, bg: DS.accentL, color: DS.accent };
  };

  const toggleMotif = (m: string) =>
    setDepartMotifs((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));

  const departFiltresActifs =
    !!departSearch || departMotifs.length > 0 || departStatut !== "actifs" ||
    departUoIds.length > 0 || departPeriode !== "tous";

  const resetDepartFiltres = () => {
    setDepartSearch(""); setDepartMotifs([]); setDepartStatut("actifs");
    setDepartUoIds([]); setDepartPeriode("tous"); setDepartDateMin(""); setDepartDateMax("");
  };

  // Lecture/téléchargement d'un document de départ (fetch authentifié -> blob)
  const ouvrirDocDepart = async (
    departId: string, docKey: string, mode: "view" | "download", filename?: string
  ) => {
    try {
      const base = (import.meta as any).env?.VITE_API_URL ?? "http://localhost:8000/api/v1";
      const token = tokenStore.get();
      const res = await fetch(
        `${base}/storage/depart-documents/${departId}/${docKey}?mode=${mode}&role_actif=${encodeURIComponent(role || "")}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      if (!res.ok) {
        const e = await res.json().catch(() => ({ detail: `Erreur ${res.status}` }));
        alert(e.detail || `Erreur ${res.status}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (mode === "download") {
        const a = document.createElement("a");
        a.href = url;
        a.download = filename || `${docKey}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        window.open(url, "_blank");
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err: any) {
      alert(err?.message || "Erreur lors de l'accès au document.");
    }
  };
  const peutTelecharger = role === "gestionnaire_rh" || role === "administrateur";

  // ── Absences en cours aujourd'hui ────────────────────
  const today = format(new Date(), "yyyy-MM-dd");
  const absencesAujourdhui = useMemo(() =>
    demandes.filter(d =>
      d.statut === "APPROUVEE" &&
      d.date_debut <= today &&
      (d.date_fin_absence || d.date_debut) >= today
    ), [demandes, today]);

  // ── KPIs ─────────────────────────────────────────────
  const kpis = useMemo(() => {
    const actifs = equipe.filter(c => c.statut_collaborateur === "ACTIF").length;
    const enDepart = equipe.filter(c => c.statut_collaborateur === "EN_DEPART").length;
    const absents = absencesAujourdhui.length;
    const presents = actifs - absents;
    const alertesConges = soldes.filter(s => Number(s.solde_restant) < 2).length;
    const departsProches = departs.filter(d => {
      const diff = differenceInDays(parseISO(d.date_depart), new Date());
      return diff >= 0 && diff <= 30;
    }).length;
    return { actifs, enDepart, absents, presents, alertesConges, departsProches };
  }, [equipe, absencesAujourdhui, soldes, departs]);

  // ── Mutations : approuver / refuser ──────────────────
  // RG-MANAGER-CONGE-02 (Adil DAIA) : L'approbation crée une
  // entrée dans cong_consommation et met à jour le solde.
  const approuver = useMutation({
    mutationFn: async (d: Demande) => {
      await db.update("cong_demandes", { id: d.id }, { statut: "APPROUVEE", date_validation: today });
      await db.create("cong_consommation", {
        collaborateur_id: d.collaborateur_id,
        code_type_conge: d.code_type_conge,
        demande_id: d.id,
        date_debut: d.date_debut,
        date_fin_absence: d.date_fin_absence,
        date_retour: d.date_retour,
        nbr_jours_calendaires: d.nbr_jours_calendaires || 0,
        nbr_jours_decomptes: d.nbr_jours_decomptes || 0,
        est_annulee: false,
        exercice: new Date(d.date_debut).getFullYear(),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["manager-demandes"] });
      toast({ title: "Demande approuvée ✓", description: "Le collaborateur a été notifié." });
    },
    onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const refuser = useMutation({
    mutationFn: async ({ id, motif }: { id: string; motif: string }) => {
      await db.update("cong_demandes", { id }, { statut: "REFUSEE", motif_refus: motif, date_validation: today });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["manager-demandes"] });
      setShowRefusDialog(null);
      setMotifRefus("");
      toast({ title: "Demande refusée", description: "Le motif a été enregistré." });
    },
    onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  // ── Export Excel ──────────────────────────────────────
  const exportEquipe = () => {
    const rows = equipe.map(c => ({
      "Matricule": c.matricule,
      "Nom": c.nom,
      "Prénom": c.prenom,
      "Statut": c.statut_collaborateur,
      "Absents aujourd'hui": absencesAujourdhui.some(a => a.collaborateur_id === c.id) ? "Oui" : "Non",
      "Solde restant (j)": soldes.find(s => s.collaborateur_id === c.id)?.solde_restant ?? "—",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Équipe");
    XLSX.writeFile(wb, `equipe_manager_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
  };

  const exportDemandes = () => {
    const rows = demandes.map(d => ({
      "Matricule": (d.collaborateurs as any)?.matricule || "",
      "Collaborateur": `${(d.collaborateurs as any)?.nom} ${(d.collaborateurs as any)?.prenom}`,
      "Type congé": d.code_type_conge,
      "Début": d.date_debut ? format(parseISO(d.date_debut), "dd/MM/yyyy") : "",
      "Fin absence": d.date_fin_absence ? format(parseISO(d.date_fin_absence), "dd/MM/yyyy") : "",
      "J. déduits": d.nbr_jours_decomptes,
      "Statut": d.statut,
      "Soumis le": d.created_at ? format(parseISO(d.created_at), "dd/MM/yyyy") : "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Demandes");
    XLSX.writeFile(wb, `demandes_conges_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
  };

  // ── Helpers planning ─────────────────────────────────
  const weekStart = startOfWeek(currentWeek, { locale: fr });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const getAbsenceForDay = (collabId: string, day: Date) => {
    const ds = format(day, "yyyy-MM-dd");
    return demandes.find(d =>
      d.collaborateur_id === collabId &&
      d.statut === "APPROUVEE" &&
      d.date_debut <= ds &&
      (d.date_fin_absence || d.date_debut) >= ds
    );
  };

  // ── Navigation tabs ───────────────────────────────────
  const NAV = [
    { key: "dashboard",     icon: <BarChart3 size={16} />,    label: "Tableau de bord" },
    { key: "equipe",        icon: <Users size={16} />,        label: "Mon équipe",     badge: equipe.length },
    { key: "trombinoscope", icon: <UserCircle2 size={16} />,  label: "Trombinoscope" },
    { key: "absences",      icon: <Calendar size={16} />,     label: "Congés",         badge: demandesEnAttente.length, badgeColor: DS.amber,
      children: [
        { key: "absences",          label: "Demandes",          icon: <CheckCircle size={13} /> },
        { key: "absences_encours",  label: "En congés",          icon: <Users size={13} /> },
        { key: "absences_planning", label: "Planning",           icon: <CalendarDays size={13} /> },
        { key: "absences_soldes",   label: "Soldes & reliquats", icon: <FileText size={13} /> },
        { key: "absences_taux",     label: "Taux d'absence",    icon: <BarChart3 size={13} /> },
      ],
    },
    { key: "planning",      icon: <CalendarDays size={16} />, label: "Planning" },
    { key: "calendrier",    icon: <CalendarCheck size={16} />,label: "Calendrier" },
    { key: "departs",       icon: <DoorOpen size={16} />,     label: "Départs",        badge: kpis.departsProches > 0 ? kpis.departsProches : undefined, badgeColor: DS.red },
    { key: "evaluations",   icon: <Star size={16} />,         label: "Évaluations" },
    { key: "alertes",       icon: <Bell size={16} />,         label: "Alertes",        badge: (demandesEnAttente.length + kpis.departsProches + kpis.alertesConges) || undefined, badgeColor: DS.red },
    { key: "mon-espace",    icon: <UserCircle2 size={16} />,  label: "Mon espace" },
    { key: "apparence",     icon: <Palette size={16} />,      label: "Apparence" },
  ] as const;

  const fmt = (d: string | null | undefined) =>
    d ? format(parseISO(d), "dd MMM yyyy", { locale: fr }) : "—";

  // ═══════════════════════════════════════════════════════
  // RENDU
  // ═══════════════════════════════════════════════════════
  return (
    <TooltipProvider>
    <div className="flex h-full min-h-screen" style={{ background: "hsl(var(--background))" }}>


      {/* ── Contenu principal ── */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto p-6 space-y-6">

          {/* ════════════════════════════════════════════
              TABLEAU DE BORD
          ════════════════════════════════════════════ */}
          {activeTab === "dashboard" && (
            <>
              {/* Header enrichi */}
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    {(() => {
                      const h = new Date().getHours();
                      if (h < 12) return <Sunrise size={18} style={{ color: DS.amber }} />;
                      if (h < 18) return <Sun size={18} style={{ color: DS.amber }} />;
                      return <Moon size={18} style={{ color: DS.purple }} />;
                    })()}
                    <span className="text-sm font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {(() => { const h = new Date().getHours(); return h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir"; })()}
                    </span>
                  </div>
                  <h1 className="text-2xl font-bold" style={{ color: "hsl(var(--foreground))" }}>
                    Vue d'ensemble de votre équipe
                  </h1>
                  <p className="text-sm mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                    {format(new Date(), "EEEE d MMMM yyyy", { locale: fr })}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setActiveTab("equipe")} className="gap-1.5">
                    <Users size={13} /> Mon équipe
                  </Button>
                  <Button size="sm" variant="outline" onClick={exportEquipe} className="gap-1.5">
                    <Download size={13} /> Exporter
                  </Button>
                </div>
              </div>

              {/* KPIs enrichis — 4 cartes avec action directe */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  {
                    icon: <Users size={20} />, label: "Présents aujourd'hui",
                    value: `${kpis.presents}/${kpis.actifs}`, sub: `${kpis.absents} absent(s)`,
                    color: kpis.absents > 0 ? DS.amber : DS.green,
                    bg: kpis.absents > 0 ? DS.amberL : DS.greenL,
                    action: () => setActiveTab("absences"),
                  },
                  {
                    icon: <Clock size={20} />, label: "Demandes à valider",
                    value: demandesEnAttente.length, sub: demandesEnAttente.length === 0 ? "Tout est traité 🎉" : "En attente",
                    color: demandesEnAttente.length > 0 ? DS.amber : DS.green,
                    bg: demandesEnAttente.length > 0 ? DS.amberL : DS.greenL,
                    action: () => setActiveTab("absences"),
                  },
                  {
                    icon: <DoorOpen size={20} />, label: "Départs proches",
                    value: kpis.departsProches, sub: "Dans les 30 prochains jours",
                    color: kpis.departsProches > 0 ? DS.red : DS.green,
                    bg: kpis.departsProches > 0 ? DS.redL : DS.greenL,
                    action: () => setActiveTab("departs"),
                  },
                  {
                    icon: <AlertTriangle size={20} />, label: "Soldes faibles",
                    value: kpis.alertesConges, sub: "Moins de 2j restants",
                    color: kpis.alertesConges > 0 ? DS.purple : DS.green,
                    bg: kpis.alertesConges > 0 ? DS.purpleL : DS.greenL,
                    action: () => setActiveTab("absences"),
                  },
                ].map((k, i) => (
                  <button key={i} onClick={k.action}
                    className="rounded-2xl border p-4 text-left transition-all hover:shadow-md hover:scale-[1.01] group"
                    style={{ background: "hsl(var(--card))", borderColor: `${k.color}30` }}>
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                        style={{ background: k.bg, color: k.color }}>{k.icon}</div>
                      <ChevronRight size={14} className="opacity-0 group-hover:opacity-100 transition-opacity mt-1"
                        style={{ color: k.color }} />
                    </div>
                    <p className="text-2xl font-bold" style={{ color: k.color }}>{k.value}</p>
                    <p className="text-xs font-semibold mt-0.5" style={{ color: "hsl(var(--foreground))" }}>{k.label}</p>
                    <p className="text-[11px] mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{k.sub}</p>
                  </button>
                ))}
              </div>

              {/* Alertes RH proactives */}
              {(() => {
                const today = new Date();
                const alertes: { type: string; msg: string; color: string; bg: string; icon: React.ReactNode }[] = [];

                // Anniversaires cette semaine
                equipe.forEach(c => {
                  if (!c.date_naissance) return;
                  const dn = parseISO(c.date_naissance);
                  const thisYear = new Date(today.getFullYear(), dn.getMonth(), dn.getDate());
                  if (differenceInDays(thisYear, today) >= 0 && differenceInDays(thisYear, today) <= 7) {
                    alertes.push({ type: "birthday", msg: `🎂 ${c.prenom} ${c.nom} fête son anniversaire ${differenceInDays(thisYear, today) === 0 ? "aujourd'hui" : `dans ${differenceInDays(thisYear, today)}j`}`, color: DS.purple, bg: DS.purpleL, icon: <Star size={13} /> });
                  }
                });

                // Congés qui commencent demain
                demandes.filter(d => d.statut === "APPROUVEE" && isTomorrow(parseISO(d.date_debut))).forEach(d => {
                  const col = (d as any).collaborateurs;
                  alertes.push({ type: "conge_demain", msg: `✈️ ${col?.prenom} ${col?.nom} part en congé demain (${d.nbr_jours_decomptes}j)`, color: DS.teal, bg: DS.tealL, icon: <CalendarCheck size={13} /> });
                });

                if (alertes.length === 0) return null;
                return (
                  <div className="rounded-2xl border overflow-hidden" style={{ borderColor: DS.accent + "30", background: DS.accentL }}>
                    <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: DS.accent + "25" }}>
                      <Zap size={14} style={{ color: DS.accent }} />
                      <span className="text-sm font-semibold" style={{ color: DS.accent }}>Alertes RH — Cette semaine</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold ml-auto" style={{ background: DS.accentL, color: DS.accent }}>{alertes.length}</span>
                    </div>
                    <div className="divide-y" style={{ borderColor: DS.accent + "20" }}>
                      {alertes.map((a, i) => (
                        <div key={i} className="flex items-center gap-3 px-5 py-2.5">
                          <span style={{ color: a.color }}>{a.icon}</span>
                          <p className="text-xs" style={{ color: "hsl(var(--foreground))" }}>{a.msg}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Grille 2 colonnes */}
              <div className="grid grid-cols-2 gap-5">

                {/* Demandes urgentes */}
                <div className="rounded-2xl border" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
                  <div className="px-5 py-4 border-b flex items-center justify-between"
                    style={{ borderColor: "hsl(var(--border))" }}>
                    <div className="flex items-center gap-2">
                      <Clock size={15} style={{ color: DS.amber }} />
                      <span className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                        À valider
                      </span>
                      {demandesEnAttente.length > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold"
                          style={{ background: DS.amberL, color: DS.amber }}>
                          {demandesEnAttente.length}
                        </span>
                      )}
                    </div>
                    <button onClick={() => setActiveTab("absences")}
                      className="text-xs flex items-center gap-1"
                      style={{ color: DS.accent }}>
                      Tout voir <ChevronRight size={12} />
                    </button>
                  </div>
                  <div className="divide-y" style={{ borderColor: "hsl(var(--border)/0.5)" }}>
                    {demandesEnAttente.length === 0 ? (
                      <div className="px-5 py-8 text-center">
                        <CheckCircle size={28} style={{ color: DS.green, margin: "0 auto 8px" }} />
                        <p className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>
                          Aucune demande en attente
                        </p>
                        <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                          Tout est traité 🎉
                        </p>
                      </div>
                    ) : demandesEnAttente.slice(0, 4).map(d => (
                      <div key={d.id} className="px-5 py-3 flex items-center gap-3">
                        <Avatar collab={d.collaborateurs} size={32} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold truncate" style={{ color: "hsl(var(--foreground))" }}>
                            {(d.collaborateurs as any)?.prenom} {(d.collaborateurs as any)?.nom}
                          </p>
                          <p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                            {d.code_type_conge} · {d.nbr_jours_decomptes}j · {fmt(d.date_debut)}
                          </p>
                        </div>
                        <div className="flex gap-1.5">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button onClick={() => approuver.mutate(d)}
                                className="w-7 h-7 rounded-lg flex items-center justify-center transition-opacity hover:opacity-80"
                                style={{ background: DS.greenL, color: DS.green }}>
                                <ThumbsUp size={12} />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Approuver</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button onClick={() => setShowRefusDialog(d.id)}
                                className="w-7 h-7 rounded-lg flex items-center justify-center transition-opacity hover:opacity-80"
                                style={{ background: DS.redL, color: DS.red }}>
                                <ThumbsDown size={12} />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Refuser</TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Absences aujourd'hui */}
                <div className="rounded-2xl border" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
                  <div className="px-5 py-4 border-b flex items-center justify-between"
                    style={{ borderColor: "hsl(var(--border))" }}>
                    <div className="flex items-center gap-2">
                      <Sunrise size={15} style={{ color: DS.teal }} />
                      <span className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                        Absents aujourd'hui
                      </span>
                    </div>
                    <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {absencesAujourdhui.length}/{equipe.length}
                    </span>
                  </div>
                  <div className="divide-y" style={{ borderColor: "hsl(var(--border)/0.5)" }}>
                    {absencesAujourdhui.length === 0 ? (
                      <div className="px-5 py-8 text-center">
                        <Users size={28} style={{ color: DS.teal, margin: "0 auto 8px" }} />
                        <p className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>
                          Toute l'équipe est présente
                        </p>
                      </div>
                    ) : absencesAujourdhui.map(d => (
                      <div key={d.id} className="px-5 py-3 flex items-center gap-3">
                        <Avatar collab={d.collaborateurs} size={32} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold truncate" style={{ color: "hsl(var(--foreground))" }}>
                            {(d.collaborateurs as any)?.prenom} {(d.collaborateurs as any)?.nom}
                          </p>
                          <p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                            {d.code_type_conge} · Retour le {fmt(d.date_retour)}
                          </p>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded-full"
                          style={{ background: DS.amberL, color: DS.amber }}>
                          Absent
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

              </div>

              {/* Départs à venir */}
              {kpis.departsProches > 0 && (
                <div className="rounded-2xl border p-5"
                  style={{ background: DS.redL, borderColor: `${DS.red}30` }}>
                  <div className="flex items-center gap-2 mb-3">
                    <DoorOpen size={15} style={{ color: DS.red }} />
                    <span className="text-sm font-semibold" style={{ color: DS.red }}>
                      Départs dans les 30 prochains jours
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {departs.filter(d => {
                      const diff = differenceInDays(parseISO(d.date_depart), new Date());
                      return diff >= 0 && diff <= 30;
                    }).map(d => (
                      <div key={d.id} className="rounded-xl p-3"
                        style={{ background: "hsl(var(--card))", border: `1px solid ${DS.red}20` }}>
                        <div className="flex items-center gap-2 mb-1.5">
                          <Avatar collab={d.collaborateurs} size={28} />
                          <div className="min-w-0">
                            <p className="text-xs font-semibold truncate" style={{ color: "hsl(var(--foreground))" }}>
                              {(d.collaborateurs as any)?.prenom} {(d.collaborateurs as any)?.nom}
                            </p>
                          </div>
                        </div>
                        <p className="text-[10px] font-medium" style={{ color: DS.red }}>
                          Départ le {fmt(d.date_depart)}
                        </p>
                        <p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                          Dans {differenceInDays(parseISO(d.date_depart), new Date())} jour(s)
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Grille inférieure : soldes + planning semaine */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

                {/* Soldes congés enrichis */}
                <div className="rounded-2xl border" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
                  <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: "hsl(var(--border))" }}>
                    <div className="flex items-center gap-2">
                      <Activity size={15} style={{ color: DS.accent }} />
                      <span className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>Soldes congés</span>
                    </div>
                    <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Exercice {new Date().getFullYear()}</span>
                  </div>
                  <div className="p-4 space-y-3">
                    {equipe.slice(0, 8).map(collab => {
                      const soldCollab = soldes.filter(s => s.collaborateur_id === collab.id);
                      const total = soldCollab.reduce((a, s) => a + Number(s.solde_acquis), 0);
                      const pris = soldCollab.reduce((a, s) => a + Number(s.solde_pris), 0);
                      const restant = soldCollab.reduce((a, s) => a + Number(s.solde_restant), 0);
                      const attente = soldCollab.reduce((a, s) => a + Number((s as any).solde_en_attente ?? 0), 0);
                      const pct = total > 0 ? Math.min(Math.round((pris / total) * 100), 100) : 0;
                      const pctAttente = total > 0 ? Math.min(Math.round((attente / total) * 100), 100) : 0;
                      const isLow = restant < 2 && total > 0;
                      const color = isLow ? DS.red : pct > 70 ? DS.amber : DS.green;
                      return (
                        <div key={collab.id} className="group">
                          <div className="flex items-center gap-2.5 mb-1">
                            <Avatar collab={collab} size={24} />
                            <span className="text-[11px] font-semibold flex-1 truncate" style={{ color: "hsl(var(--foreground))" }}>
                              {collab.prenom} {collab.nom}
                            </span>
                            {isLow && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: DS.redL, color: DS.red }}>Faible</span>}
                            <span className="text-[11px] font-bold" style={{ color }}>
                              {restant.toFixed(1)}j
                            </span>
                          </div>
                          {/* Barre segmentée : pris + attente + restant */}
                          <div className="h-1.5 rounded-full overflow-hidden flex gap-px" style={{ background: "hsl(var(--muted)/0.4)" }}>
                            <div className="h-full rounded-l-full transition-all" style={{ width: `${pct}%`, background: color, opacity: 0.7 }} />
                            {pctAttente > 0 && <div className="h-full transition-all" style={{ width: `${pctAttente}%`, background: DS.amber }} />}
                          </div>
                        </div>
                      );
                    })}
                    {equipe.length > 8 && (
                      <button onClick={() => setActiveTab("absences")}
                        className="w-full text-center text-[11px] py-1.5 rounded-lg hover:opacity-70 transition-opacity"
                        style={{ color: DS.accent, background: DS.accentL }}>
                        Voir tous ({equipe.length})
                      </button>
                    )}
                  </div>
                </div>

                {/* Planning semaine */}
                <div className="rounded-2xl border" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
                  <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: "hsl(var(--border))" }}>
                    <div className="flex items-center gap-2">
                      <CalendarDays size={15} style={{ color: DS.teal }} />
                      <span className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>Planning cette semaine</span>
                    </div>
                    <button onClick={() => setActiveTab("planning")}
                      className="text-xs flex items-center gap-1" style={{ color: DS.accent }}>
                      Voir tout <ChevronRight size={11} />
                    </button>
                  </div>
                  <div className="p-4">
                    {/* Jours de la semaine */}
                    {(() => {
                      const today = new Date();
                      const monday = startOfWeek(today, { weekStartsOn: 1 });
                      const days = Array.from({ length: 5 }, (_, i) => addDays(monday, i));
                      return (
                        <div className="space-y-1">
                          {/* Header jours */}
                          <div className="flex gap-1 mb-2">
                            {days.map(d => {
                              const isToday2 = isSameDay(d, today);
                              return (
                                <div key={d.toISOString()} className="flex-1 text-center">
                                  <div className="text-[9px] font-medium uppercase"
                                    style={{ color: "hsl(var(--muted-foreground))" }}>
                                    {format(d, "EEE", { locale: fr })}
                                  </div>
                                  <div className="text-[11px] font-bold mt-0.5 w-6 h-6 rounded-full flex items-center justify-center mx-auto"
                                    style={{
                                      background: isToday2 ? DS.accent : "transparent",
                                      color: isToday2 ? "white" : "hsl(var(--foreground))",
                                    }}>
                                    {format(d, "d")}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          {/* Absences par jour */}
                          {days.map(d => {
                            const absJour = demandes.filter(dem =>
                              dem.statut === "APPROUVEE" &&
                              parseISO(dem.date_debut) <= d && d <= parseISO(dem.date_fin_absence)
                            );
                            return (
                              <div key={d.toISOString()} className="flex items-center gap-1">
                                <div className="flex-1 flex gap-0.5 flex-wrap min-h-[20px]">
                                  {absJour.slice(0, 4).map(ab => {
                                    const col = (ab as any).collaborateurs;
                                    return (
                                      <div key={ab.id} className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold"
                                        style={{ background: DS.tealL, color: DS.teal }}>
                                        {col?.prenom?.[0]}{col?.nom?.[0]}
                                      </div>
                                    );
                                  })}
                                  {absJour.length > 4 && (
                                    <span className="text-[9px] self-center" style={{ color: "hsl(var(--muted-foreground))" }}>+{absJour.length - 4}</span>
                                  )}
                                  {absJour.length === 0 && (
                                    <span className="text-[9px]" style={{ color: "hsl(var(--muted-foreground) / 0.4)" }}>—</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                </div>

              </div>

              {/* Départs à venir */}
              {kpis.departsProches > 0 && (
                <div className="rounded-2xl border p-5"
                  style={{ background: DS.redL, borderColor: `${DS.red}30` }}>
                  <div className="flex items-center gap-2 mb-3">
                    <DoorOpen size={15} style={{ color: DS.red }} />
                    <span className="text-sm font-semibold" style={{ color: DS.red }}>
                      Départs dans les 30 prochains jours
                    </span>
                    <button onClick={() => setActiveTab("departs")}
                      className="ml-auto text-xs flex items-center gap-1" style={{ color: DS.red }}>
                      Voir tout <ChevronRight size={11} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {departs.filter(d => {
                      const diff = differenceInDays(parseISO(d.date_depart), new Date());
                      return diff >= 0 && diff <= 30;
                    }).slice(0, 4).map(d => (
                      <div key={d.id} className="rounded-xl p-3"
                        style={{ background: "hsl(var(--card))", border: `1px solid ${DS.red}20` }}>
                        <div className="flex items-center gap-2 mb-2">
                          <Avatar collab={d.collaborateurs} size={28} />
                          <p className="text-xs font-semibold truncate" style={{ color: "hsl(var(--foreground))" }}>
                            {(d.collaborateurs as any)?.prenom} {(d.collaborateurs as any)?.nom}
                          </p>
                        </div>
                        <div className="flex items-center justify-between">
                          <p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>{d.motif_depart}</p>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold"
                            style={{ background: DS.redL, color: DS.red }}>
                            J-{differenceInDays(parseISO(d.date_depart), new Date())}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </>
          )}

          {/* ════════════════════════════════════════════
              MON ÉQUIPE
          ════════════════════════════════════════════ */}
          {activeTab === "equipe" && (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold" style={{ color: "hsl(var(--foreground))" }}>Mon équipe</h1>
                  <p className="text-sm mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                    {equipe.length} collaborateur(s) dans votre périmètre
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={exportEquipe} className="gap-1.5">
                  <Download size={13} /> Excel
                </Button>
              </div>

              {/* Barre de recherche + toggle vue */}
              <div className="flex gap-2 items-center">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2"
                    style={{ color: "hsl(var(--muted-foreground))" }} />
                  <Input placeholder="Rechercher un collaborateur…"
                    value={search} onChange={e => setSearch(e.target.value)}
                    className="pl-9 h-10" />
                </div>
                {/* Toggle vue par UO / liste plate */}
                <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: "hsl(var(--border))" }}>
                  {([["uo", <Building2 size={13} />, "Par UO"], ["liste", <Users size={13} />, "Liste"]] as const).map(([v, icon, label]) => (
                    <button key={v} onClick={() => setVueEquipe(v as any)}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-all"
                      style={{
                        background: vueEquipe === v ? "hsl(var(--primary))" : "hsl(var(--background))",
                        color: vueEquipe === v ? "white" : "hsl(var(--muted-foreground))",
                      }}>
                      {icon}{label}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Vue par UO ─────────────────────────────────── */}
              {vueEquipe === "uo" && (
                <div className="space-y-4">
                  {equipeParUO.map(({ uo, collabs }) => {
                    const searchFiltered = collabs.filter(c =>
                      !search || `${c.nom} ${c.prenom} ${c.matricule}`.toLowerCase().includes(search.toLowerCase())
                    );
                    if (searchFiltered.length === 0) return null;
                    const uoKey = uo?.id ?? "__sans_uo__";
                    const isOpen = uosOuvertes.has(uoKey) || !search;
                    const absentsUO = searchFiltered.filter(c => absencesAujourdhui.some(a => a.collaborateur_id === c.id)).length;

                    return (
                      <div key={uoKey} className="rounded-2xl border overflow-hidden"
                        style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
                        {/* En-tête UO cliquable */}
                        <button className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-muted/20 transition-colors"
                          onClick={() => toggleUO(uoKey)}>
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ background: uo ? `${DS.accent}15` : "hsl(var(--muted))", color: uo ? DS.accent : "hsl(var(--muted-foreground))" }}>
                            <Building2 size={14} />
                          </div>
                          <div className="flex-1 text-left min-w-0">
                            <p className="text-sm font-bold truncate" style={{ color: "hsl(var(--foreground))" }}>
                              {uo ? uo.libelle : "Non affectés"}
                              {uo?.code && <span className="ml-2 text-[10px] font-mono font-normal" style={{ color: "hsl(var(--muted-foreground))" }}>({uo.code})</span>}
                            </p>
                            <div className="flex items-center gap-3 mt-0.5">
                              <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                                {searchFiltered.length} collaborateur{searchFiltered.length > 1 ? "s" : ""}
                              </span>
                              {absentsUO > 0 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                                  style={{ background: DS.amberL, color: DS.amber }}>
                                  {absentsUO} absent{absentsUO > 1 ? "s" : ""}
                                </span>
                              )}
                              {uo?.niveau !== undefined && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                                  style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                                  Niveau {uo.niveau}
                                </span>
                              )}
                            </div>
                          </div>
                          <ChevronDown size={15}
                            className={`transition-transform flex-shrink-0 ${isOpen ? "rotate-180" : ""}`}
                            style={{ color: "hsl(var(--muted-foreground))" }} />
                        </button>

                        {/* Grille collabs de cette UO */}
                        {isOpen && (
                          <div className="px-4 pb-4 grid grid-cols-2 lg:grid-cols-3 gap-3 border-t"
                            style={{ borderColor: "hsl(var(--border))", paddingTop: 12 }}>
                            {searchFiltered.map(c => {
                              const soldCollabs = soldes.filter(s => s.collaborateur_id === c.id);
                              const totalRestant = soldCollabs.reduce((a, s) => a + Number(s.solde_restant), 0);
                              const isAbsent = absencesAujourdhui.some(a => a.collaborateur_id === c.id);
                              const hasDepart = departs.some(d => d.collaborateur_id === c.id);
                              return (
                                <div key={c.id}
                                  className="rounded-xl border p-3.5 cursor-pointer transition-all hover:shadow-md"
                                  style={{
                                    background: "hsl(var(--background))",
                                    borderColor: isAbsent ? `${DS.amber}40` : hasDepart ? `${DS.red}40` : "hsl(var(--border))",
                                  }}
                                  onClick={() => { setSelectedCollab(c.id); setShowDetailPanel(true); }}>
                                  <div className="flex items-start gap-2.5 mb-2.5">
                                    <div className="relative">
                                      <Avatar collab={c} size={38} />
                                      <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2"
                                        style={{ background: isAbsent ? DS.amber : c.statut_collaborateur === "ACTIF" ? DS.green : DS.red, borderColor: "hsl(var(--background))" }} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs font-bold truncate" style={{ color: "hsl(var(--foreground))" }}>{c.prenom} {c.nom}</p>
                                      <p className="text-[10px] font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>{c.matricule}</p>
                                      <StatutBadge statut={isAbsent ? "ABSENT" : c.statut_collaborateur} />
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-2 gap-1.5 text-center">
                                    <div className="rounded-lg p-1.5" style={{ background: "hsl(var(--muted)/0.4)" }}>
                                      <p className="text-sm font-bold" style={{ color: totalRestant < 2 ? DS.red : totalRestant < 5 ? DS.amber : DS.green }}>
                                        {totalRestant.toFixed(1)}
                                      </p>
                                      <p className="text-[9px]" style={{ color: "hsl(var(--muted-foreground))" }}>j restants</p>
                                    </div>
                                    <div className="rounded-lg p-1.5" style={{ background: "hsl(var(--muted)/0.4)" }}>
                                      <p className="text-sm font-bold" style={{ color: "hsl(var(--foreground))" }}>
                                        {demandes.filter(d => d.collaborateur_id === c.id && d.statut === "APPROUVEE").length}
                                      </p>
                                      <p className="text-[9px]" style={{ color: "hsl(var(--muted-foreground))" }}>congés pris</p>
                                    </div>
                                  </div>
                                  <div className="flex gap-1 mt-1.5 flex-wrap">
                                    {isAbsent && <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: DS.amberL, color: DS.amber }}>Absent</span>}
                                    {hasDepart && <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: DS.redL, color: DS.red }}>Départ planifié</span>}
                                    {totalRestant < 2 && !isAbsent && <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: DS.purpleL, color: DS.purple }}>Solde faible</span>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ── Vue liste plate ─────────────────────────────── */}
              {vueEquipe === "liste" && (
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                  {equipe.filter(c =>
                    !search || `${c.nom} ${c.prenom} ${c.matricule}`.toLowerCase().includes(search.toLowerCase())
                  ).map(c => {
                    const soldCollabs = soldes.filter(s => s.collaborateur_id === c.id);
                    const totalRestant = soldCollabs.reduce((a, s) => a + Number(s.solde_restant), 0);
                    const isAbsent = absencesAujourdhui.some(a => a.collaborateur_id === c.id);
                    const hasDepart = departs.some(d => d.collaborateur_id === c.id);
                    return (
                      <div key={c.id}
                        className="rounded-2xl border p-4 cursor-pointer transition-all hover:shadow-md"
                        style={{ background: "hsl(var(--card))", borderColor: isAbsent ? `${DS.amber}40` : hasDepart ? `${DS.red}40` : "hsl(var(--border))" }}
                        onClick={() => { setSelectedCollab(c.id); setShowDetailPanel(true); }}>
                        <div className="flex items-start gap-3 mb-3">
                          <div className="relative">
                            <Avatar collab={c} size={44} />
                            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2"
                              style={{ background: isAbsent ? DS.amber : c.statut_collaborateur === "ACTIF" ? DS.green : DS.red, borderColor: "hsl(var(--card))" }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold truncate" style={{ color: "hsl(var(--foreground))" }}>{c.prenom} {c.nom}</p>
                            <p className="text-[10px] font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>{c.matricule}</p>
                            <StatutBadge statut={isAbsent ? "ABSENT" : c.statut_collaborateur} />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-center">
                          <div className="rounded-lg p-2" style={{ background: "hsl(var(--muted)/0.3)" }}>
                            <p className="text-base font-bold" style={{ color: totalRestant < 2 ? DS.red : totalRestant < 5 ? DS.amber : DS.green }}>{totalRestant.toFixed(1)}</p>
                            <p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>j restants</p>
                          </div>
                          <div className="rounded-lg p-2" style={{ background: "hsl(var(--muted)/0.3)" }}>
                            <p className="text-base font-bold" style={{ color: "hsl(var(--foreground))" }}>
                              {demandes.filter(d => d.collaborateur_id === c.id && d.statut === "APPROUVEE").length}
                            </p>
                            <p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>congés pris</p>
                          </div>
                        </div>
                        <div className="flex gap-1 mt-2 flex-wrap">
                          {isAbsent && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: DS.amberL, color: DS.amber }}>Absent ce jour</span>}
                          {hasDepart && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: DS.redL, color: DS.red }}>Départ planifié</span>}
                          {totalRestant < 2 && !isAbsent && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: DS.purpleL, color: DS.purple }}>Solde faible</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ════════════════════════════════════════════
              CONGÉS & ABSENCES
          ════════════════════════════════════════════ */}
          {(activeTab === "absences" || activeTab === "absences_encours" ||
            activeTab === "absences_planning" || activeTab === "absences_soldes" ||
            activeTab === "absences_taux") && (
            /* ── Module Congés complet (sous-menus : Demandes, En congés,
                   Planning, Soldes & reliquats, Taux d'absence par UO)
                   RG-MANAGER-CONGES-01 : collaborateurs directs N+1 uniquement ── */
            <div className="-mx-6 -mt-4 h-full">
              <CongesModule initialView={
                activeTab === "absences_encours"  ? "encours"  :
                activeTab === "absences_planning" ? "planning" :
                activeTab === "absences_soldes"   ? "soldes"   :
                activeTab === "absences_taux"     ? "taux"     : "demandes"
              } />
            </div>
          )}

          {/* ════════════════════════════════════════════
              PLANNING SEMAINE (Gantt visuel)
          ════════════════════════════════════════════ */}
          {activeTab === "planning" && (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold" style={{ color: "hsl(var(--foreground))" }}>
                    Planning équipe
                  </h1>
                  <p className="text-sm mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Vue hebdomadaire des présences et absences
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" className="h-8 w-8 p-0"
                    onClick={() => setCurrentWeek(d => subDays(d, 7))}>
                    <ChevronLeft size={14} />
                  </Button>
                  <span className="text-sm font-medium px-2"
                    style={{ color: "hsl(var(--foreground))" }}>
                    {format(weekStart, "d MMM", { locale: fr })} – {format(endOfWeek(currentWeek, { locale: fr }), "d MMM yyyy", { locale: fr })}
                  </span>
                  <Button size="sm" variant="outline" className="h-8 w-8 p-0"
                    onClick={() => setCurrentWeek(d => addDays(d, 7))}>
                    <ChevronRight size={14} />
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs h-8"
                    onClick={() => setCurrentWeek(new Date())}>
                    Aujourd'hui
                  </Button>
                </div>
              </div>

              <div className="rounded-2xl border overflow-hidden"
                style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
                {/* Header jours */}
                <div className="grid border-b" style={{
                  gridTemplateColumns: "180px repeat(7, 1fr)",
                  borderColor: "hsl(var(--border))",
                  background: "hsl(var(--muted)/0.3)"
                }}>
                  <div className="px-4 py-3 text-xs font-semibold"
                    style={{ color: "hsl(var(--muted-foreground))" }}>
                    Collaborateur
                  </div>
                  {weekDays.map(day => {
                    const isWeekend = getDay(day) === 0 || getDay(day) === 6;
                    const isTdy = isToday(day);
                    return (
                      <div key={day.toISOString()}
                        className="px-2 py-3 text-center border-l"
                        style={{ borderColor: "hsl(var(--border)/0.5)" }}>
                        <p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                          {format(day, "EEE", { locale: fr })}
                        </p>
                        <div className={`text-sm font-bold mx-auto w-7 h-7 rounded-full flex items-center justify-center mt-0.5 ${isTdy ? "text-white" : ""}`}
                          style={{
                            background: isTdy ? DS.accent : "transparent",
                            color: isTdy ? "white" : isWeekend ? "hsl(var(--muted-foreground)/0.5)" : "hsl(var(--foreground))",
                          }}>
                          {format(day, "d")}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Lignes collaborateurs */}
                {equipe.map((c, idx) => (
                  <div key={c.id}
                    className="grid border-b hover:bg-muted/10 transition-colors"
                    style={{
                      gridTemplateColumns: "180px repeat(7, 1fr)",
                      borderColor: "hsl(var(--border)/0.5)",
                      background: idx % 2 === 0 ? "transparent" : "hsl(var(--muted)/0.04)"
                    }}>
                    <div className="px-4 py-2.5 flex items-center gap-2 border-r"
                      style={{ borderColor: "hsl(var(--border)/0.5)" }}>
                      <Avatar collab={c} size={26} />
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate" style={{ color: "hsl(var(--foreground))" }}>
                          {c.prenom} {c.nom}
                        </p>
                        <p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                          {c.matricule}
                        </p>
                      </div>
                    </div>
                    {weekDays.map(day => {
                      const abs = getAbsenceForDay(c.id, day);
                      const isWeekend = getDay(day) === 0 || getDay(day) === 6;
                      const isTdy = isToday(day);
                      return (
                        <div key={day.toISOString()}
                          className="px-1 py-2 border-l flex items-center justify-center"
                          style={{ borderColor: "hsl(var(--border)/0.5)" }}>
                          {isWeekend ? (
                            <div className="w-full h-6 rounded" style={{ background: "hsl(var(--muted)/0.3)" }} />
                          ) : abs ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="w-full h-6 rounded text-[10px] font-bold flex items-center justify-center cursor-default"
                                  style={{ background: DS.amberL, color: DS.amber, border: `1px solid ${DS.amber}40` }}>
                                  {abs.code_type_conge.substring(0, 4)}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                {abs.code_type_conge} · {abs.nbr_jours_decomptes}j
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <div className="w-full h-6 rounded flex items-center justify-center"
                              style={{ background: isTdy ? DS.accentL : DS.greenL }}>
                              <span className="text-[10px]" style={{ color: isTdy ? DS.accent : DS.green }}>
                                ✓
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              {/* Légende */}
              <div className="flex items-center gap-4 text-xs">
                {[
                  { color: DS.greenL, border: DS.green, label: "Présent", icon: "✓" },
                  { color: DS.amberL, border: DS.amber, label: "Absent (congé approuvé)", icon: "—" },
                  { color: DS.accentL, border: DS.accent, label: "Aujourd'hui", icon: "✓" },
                  { color: "hsl(var(--muted)/0.3)", border: "hsl(var(--border))", label: "Weekend", icon: "" },
                ].map(item => (
                  <div key={item.label} className="flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded text-[9px] flex items-center justify-center"
                      style={{ background: item.color, border: `1px solid ${item.border}` }}>
                      {item.icon}
                    </div>
                    <span style={{ color: "hsl(var(--muted-foreground))" }}>{item.label}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ════════════════════════════════════════════
              DÉPARTS
          ════════════════════════════════════════════ */}
          {activeTab === "departs" && (
            <>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h1 className="text-2xl font-bold" style={{ color: "hsl(var(--foreground))" }}>
                    Départs de l'équipe
                  </h1>
                  <p className="text-sm mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Suivi des départs planifiés et traités
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2.5 py-1 rounded-full"
                    style={{ background: "hsl(var(--muted)/0.5)", color: "hsl(var(--muted-foreground))" }}>
                    {departsAffiches.length} / {departs.length} départ(s)
                  </span>
                  {/* Toggle vue cartes / liste */}
                  <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
                    {([
                      { k: "cartes", label: "Cartes", icon: <LayoutGrid size={14} /> },
                      { k: "liste",  label: "Liste",  icon: <List size={14} /> },
                    ] as const).map((opt) => (
                      <button key={opt.k} onClick={() => setDepartVue(opt.k)}
                        title={opt.label}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 transition-colors"
                        style={{
                          background: departVue === opt.k ? "hsl(var(--primary))" : "hsl(var(--background))",
                          color: departVue === opt.k ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))",
                        }}>
                        {opt.icon}{opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Barre de filtres ── */}
              <div className="rounded-2xl border p-3 space-y-2"
                style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Recherche */}
                  <div className="relative flex-1 min-w-[200px]">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2"
                      style={{ color: "hsl(var(--muted-foreground))" }} />
                    <input
                      value={departSearch}
                      onChange={(e) => setDepartSearch(e.target.value)}
                      placeholder="Rechercher (nom, matricule)…"
                      className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border outline-none"
                      style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}
                    />
                  </div>

                  {/* UO hiérarchique (multi) */}
                  <div className="min-w-[200px]">
                    <UoTreePicker selected={departUoIds} onChange={setDepartUoIds} />
                  </div>

                  {/* Statut (segmenté) */}
                  <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
                    {([
                      { k: "actifs", label: "Actifs" },
                      { k: "avenir", label: "À venir" },
                      { k: "partis", label: "Partis" },
                      { k: "annules", label: "Annulés" },
                      { k: "tous", label: "Tous" },
                    ] as const).map((opt) => (
                      <button key={opt.k} onClick={() => setDepartStatut(opt.k)}
                        className="text-xs px-3 py-1.5 transition-colors"
                        style={{
                          background: departStatut === opt.k ? "hsl(var(--primary))" : "hsl(var(--background))",
                          color: departStatut === opt.k ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))",
                        }}>
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {/* Tri */}
                  <select value={departTri} onChange={(e) => setDepartTri(e.target.value as any)}
                    className="text-sm rounded-lg border px-2.5 py-1.5 outline-none"
                    style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
                    <option value="date_asc">Date ↑</option>
                    <option value="date_desc">Date ↓</option>
                    <option value="nom">Nom (A→Z)</option>
                  </select>

                  {departFiltresActifs && (
                    <button onClick={resetDepartFiltres}
                      className="text-xs px-2.5 py-1.5 rounded-lg border"
                      style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
                      Réinitialiser
                    </button>
                  )}
                </div>

                {/* Période : raccourcis + dates perso */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Période :</span>
                  {([
                    { k: "tous",   label: "Toutes" },
                    { k: "ce_mois",label: "Ce mois" },
                    { k: "30j",    label: "30 prochains j." },
                    { k: "90j",    label: "90 prochains j." },
                    { k: "annee",  label: "Cette année" },
                    { k: "perso",  label: "Personnalisé" },
                  ] as const).map((opt) => (
                    <button key={opt.k} onClick={() => setDepartPeriode(opt.k)}
                      className="text-xs px-2.5 py-1 rounded-full border transition-colors"
                      style={{
                        background: departPeriode === opt.k ? DS.accentL : "transparent",
                        borderColor: departPeriode === opt.k ? DS.accent : "hsl(var(--border))",
                        color: departPeriode === opt.k ? DS.accent : "hsl(var(--muted-foreground))",
                      }}>
                      {opt.label}
                    </button>
                  ))}
                  {departPeriode === "perso" && (
                    <span className="flex items-center gap-1.5">
                      <input type="date" value={departDateMin} onChange={(e) => setDepartDateMin(e.target.value)}
                        className="text-xs rounded-lg border px-2 py-1 outline-none"
                        style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }} />
                      <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>→</span>
                      <input type="date" value={departDateMax} onChange={(e) => setDepartDateMax(e.target.value)}
                        className="text-xs rounded-lg border px-2 py-1 outline-none"
                        style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }} />
                    </span>
                  )}
                </div>

                {/* Motifs (multi-choix par chips) */}
                {motifsDisponibles.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Motifs :</span>
                    {motifsDisponibles.map((m) => {
                      const on = departMotifs.includes(m);
                      return (
                        <button key={m} onClick={() => toggleMotif(m)}
                          className="text-xs px-2.5 py-1 rounded-full border transition-colors"
                          style={{
                            background: on ? DS.purpleL : "transparent",
                            borderColor: on ? DS.purple : "hsl(var(--border))",
                            color: on ? DS.purple : "hsl(var(--muted-foreground))",
                          }}>
                          {m}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {departsAffiches.length === 0 ? (
                <div className="text-center py-16 rounded-2xl border"
                  style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
                  <DoorOpen size={40} style={{ color: "hsl(var(--muted-foreground))", margin: "0 auto 12px" }} />
                  <p className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>
                    {departs.length === 0 ? "Aucun départ enregistré" : "Aucun départ ne correspond aux filtres"}
                  </p>
                </div>
              ) : departVue === "cartes" ? (
                /* ── VUE CARTES ── */
                <div className="space-y-3">
                  {departsAffiches.map(d => {
                    const collab = d._collab;
                    const badge = departBadge(d);
                    const isAnnule = d._statut === "ANNULE";
                    const borderUrgent = !isAnnule && d._statut !== "TRAITE" && d._days >= 0 && d._days <= 7;
                    const borderSoon = !isAnnule && d._statut !== "TRAITE" && d._days > 7 && d._days <= 30;
                    return (
                      <button key={d.id} onClick={() => setDepartDetail(d)}
                        className="w-full text-left rounded-2xl border p-5 flex items-center gap-4 transition-shadow hover:shadow-md"
                        style={{
                          background: "hsl(var(--card))",
                          opacity: isAnnule ? 0.7 : 1,
                          borderColor: borderUrgent ? `${DS.red}40` : borderSoon ? `${DS.amber}40` : "hsl(var(--border))",
                        }}>
                        <Avatar collab={collab} size={44} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-bold" style={{ color: "hsl(var(--foreground))" }}>
                              {collab ? `${collab.prenom} ${collab.nom}` : "Collaborateur inconnu"}
                            </p>
                            {collab?.matricule && (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                                style={{ background: "hsl(var(--muted)/0.5)", color: "hsl(var(--muted-foreground))" }}>
                                {collab.matricule}
                              </span>
                            )}
                          </div>
                          <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                            {d.motif_depart} · Départ le <strong style={{ color: "hsl(var(--foreground))" }}>{fmt(d.date_depart)}</strong>
                            {d.preavis_date_fin && ` · Fin préavis : ${fmt(d.preavis_date_fin)}`}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <span className="text-xs px-3 py-1 rounded-full font-bold"
                            style={{ background: badge.bg, color: badge.color }}>
                            {badge.label}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                /* ── VUE LISTE ── */
                <div className="rounded-2xl border overflow-hidden"
                  style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: "hsl(var(--muted)/0.4)" }}>
                        <th className="text-left font-semibold px-4 py-2.5" style={{ color: "hsl(var(--muted-foreground))" }}>Collaborateur</th>
                        <th className="text-left font-semibold px-4 py-2.5" style={{ color: "hsl(var(--muted-foreground))" }}>Matricule</th>
                        <th className="text-left font-semibold px-4 py-2.5" style={{ color: "hsl(var(--muted-foreground))" }}>Motif</th>
                        <th className="text-left font-semibold px-4 py-2.5" style={{ color: "hsl(var(--muted-foreground))" }}>Date de départ</th>
                        <th className="text-left font-semibold px-4 py-2.5" style={{ color: "hsl(var(--muted-foreground))" }}>Fin préavis</th>
                        <th className="text-right font-semibold px-4 py-2.5" style={{ color: "hsl(var(--muted-foreground))" }}>Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {departsAffiches.map((d) => {
                        const collab = d._collab;
                        const badge = departBadge(d);
                        return (
                          <tr key={d.id} onClick={() => setDepartDetail(d)}
                            className="border-t cursor-pointer transition-colors hover:bg-[hsl(var(--muted)/0.3)]"
                            style={{ borderColor: "hsl(var(--border))", opacity: d._statut === "ANNULE" ? 0.7 : 1 }}>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                <Avatar collab={collab} size={28} />
                                <span className="font-medium" style={{ color: "hsl(var(--foreground))" }}>
                                  {collab ? `${collab.prenom} ${collab.nom}` : "Inconnu"}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-2.5 font-mono text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{collab?.matricule || "—"}</td>
                            <td className="px-4 py-2.5" style={{ color: "hsl(var(--foreground))" }}>{d.motif_depart || "—"}</td>
                            <td className="px-4 py-2.5" style={{ color: "hsl(var(--foreground))" }}>{fmt(d.date_depart)}</td>
                            <td className="px-4 py-2.5" style={{ color: "hsl(var(--muted-foreground))" }}>{d.preavis_date_fin ? fmt(d.preavis_date_fin) : "—"}</td>
                            <td className="px-4 py-2.5 text-right">
                              <span className="text-xs px-2.5 py-1 rounded-full font-bold"
                                style={{ background: badge.bg, color: badge.color }}>
                                {badge.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* ════════════════════════════════════════════
              ÉVALUATIONS
          ════════════════════════════════════════════ */}
          {activeTab === "evaluations" && (
            <>
              <div>
                <h1 className="text-2xl font-bold" style={{ color: "hsl(var(--foreground))" }}>Évaluations</h1>
                <p className="text-sm mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Entretiens annuels et évaluations de performance
                </p>
              </div>

              <div className="grid grid-cols-3 gap-4">
                {equipe.map(c => (
                  <div key={c.id} className="rounded-2xl border p-4"
                    style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
                    <div className="flex items-center gap-3 mb-3">
                      <Avatar collab={c} size={36} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold truncate" style={{ color: "hsl(var(--foreground))" }}>
                          {c.prenom} {c.nom}
                        </p>
                        <p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                          {c.matricule}
                        </p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {[
                        { label: "Entretien annuel", status: "planifié", date: "15/06/2026" },
                        { label: "Objectifs S1 2026", status: "en cours", date: "—" },
                      ].map(item => (
                        <div key={item.label} className="flex items-center justify-between">
                          <span className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                            {item.label}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                            style={{
                              background: item.status === "planifié" ? DS.accentL : DS.amberL,
                              color: item.status === "planifié" ? DS.accent : DS.amber,
                            }}>
                            {item.status}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-1 mt-3">
                      {[1,2,3,4,5].map(star => (
                        <Star key={star} size={12}
                          style={{ color: star <= 4 ? DS.amber : "hsl(var(--muted-foreground))", fill: star <= 4 ? DS.amber : "transparent" }} />
                      ))}
                      <span className="text-[10px] ml-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                        Note N-1
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ════════════════════════════════════════════
              ALERTES & NOTIFICATIONS
          ════════════════════════════════════════════ */}
          {activeTab === "alertes" && (
            <>
              <div>
                <h1 className="text-2xl font-bold" style={{ color: "hsl(var(--foreground))" }}>Alertes</h1>
                <p className="text-sm mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Actions et notifications requérant votre attention
                </p>
              </div>

              <div className="space-y-3">
                {demandesEnAttente.map(d => (
                  <div key={d.id} className="rounded-2xl border p-4 flex items-start gap-3"
                    style={{ background: DS.amberL, borderColor: `${DS.amber}30` }}>
                    <Clock size={18} style={{ color: DS.amber, flexShrink: 0, marginTop: 2 }} />
                    <div className="flex-1">
                      <p className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                        Demande de congé en attente
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                        {(d.collaborateurs as any)?.prenom} {(d.collaborateurs as any)?.nom} · {d.code_type_conge} · {d.nbr_jours_decomptes}j · du {fmt(d.date_debut)} au {fmt(d.date_fin_absence)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" className="h-7 text-xs gap-1"
                        style={{ background: DS.green, color: "white" }}
                        onClick={() => approuver.mutate(d)}>
                        <Check size={11} /> Approuver
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                        style={{ borderColor: DS.red, color: DS.red }}
                        onClick={() => setShowRefusDialog(d.id)}>
                        <X size={11} /> Refuser
                      </Button>
                    </div>
                  </div>
                ))}

                {soldes.filter(s => Number(s.solde_restant) < 2).map(s => (
                  <div key={`${s.collaborateur_id}-${s.code_type_conge}`}
                    className="rounded-2xl border p-4 flex items-start gap-3"
                    style={{ background: DS.purpleL, borderColor: `${DS.purple}30` }}>
                    <AlertTriangle size={18} style={{ color: DS.purple, flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <p className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                        Solde de congés faible
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                        {(s.collaborateurs as any)?.prenom} {(s.collaborateurs as any)?.nom} · {s.code_type_conge} · {Number(s.solde_restant).toFixed(1)} jour(s) restant(s)
                      </p>
                    </div>
                  </div>
                ))}

                {departs.filter(d => {
                  const diff = differenceInDays(parseISO(d.date_depart), new Date());
                  return diff >= 0 && diff <= 14;
                }).map(d => {
                  const diff = differenceInDays(parseISO(d.date_depart), new Date());
                  return (
                    <div key={d.id} className="rounded-2xl border p-4 flex items-start gap-3"
                      style={{ background: DS.redL, borderColor: `${DS.red}30` }}>
                      <DoorOpen size={18} style={{ color: DS.red, flexShrink: 0, marginTop: 2 }} />
                      <div>
                        <p className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                          Départ imminent — {diff === 0 ? "Aujourd'hui" : `Dans ${diff} jour(s)`}
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                          {(d.collaborateurs as any)?.prenom} {(d.collaborateurs as any)?.nom} · {d.motif_depart} · {fmt(d.date_depart)}
                        </p>
                      </div>
                    </div>
                  );
                })}

                {demandesEnAttente.length === 0 && soldes.filter(s => Number(s.solde_restant) < 2).length === 0 && kpis.departsProches === 0 && (
                  <div className="text-center py-16 rounded-2xl border"
                    style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
                    <CheckCircle size={40} style={{ color: DS.green, margin: "0 auto 12px" }} />
                    <p className="text-base font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                      Aucune alerte en cours
                    </p>
                    <p className="text-sm mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                      Tout est sous contrôle 🎉
                    </p>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ════════════════════════════════════════════
              TROMBINOSCOPE
          ════════════════════════════════════════════ */}
          {activeTab === "trombinoscope" && (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold" style={{ color: "hsl(var(--foreground))" }}>
                    Trombinoscope
                  </h1>
                  <p className="text-sm mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                    {equipe.length} membre(s) dans votre équipe
                  </p>
                </div>
              </div>

              {/* Filtres */}
              <div className="flex gap-3 items-center">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2"
                    style={{ color: "hsl(var(--muted-foreground))" }} />
                  <Input placeholder="Rechercher par nom, prénom ou matricule…"
                    value={troSearch} onChange={e => setTroSearch(e.target.value)}
                    className="pl-9 h-10" />
                </div>
                {(["tous", "presents", "absents"] as const).map(f => (
                  <button key={f} onClick={() => setTroFilter(f)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                    style={{
                      background: troFilter === f ? DS.accent : "hsl(var(--muted)/0.4)",
                      color: troFilter === f ? "white" : "hsl(var(--muted-foreground))",
                    }}>
                    {f === "tous" ? "Tous" : f === "presents" ? "Présents" : "Absents"}
                  </button>
                ))}
              </div>

              {/* Grille trombinoscope */}
              <div className="grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {equipe
                  .filter(c => {
                    const q = troSearch.toLowerCase();
                    const matchSearch = !q || `${c.nom} ${c.prenom} ${c.matricule}`.toLowerCase().includes(q);
                    const isAbsent = absencesAujourdhui.some(a => a.collaborateur_id === c.id);
                    const matchFilter = troFilter === "tous" ||
                      (troFilter === "absents" && isAbsent) ||
                      (troFilter === "presents" && !isAbsent);
                    return matchSearch && matchFilter;
                  })
                  .map(c => {
                    const isAbsent = absencesAujourdhui.some(a => a.collaborateur_id === c.id);
                    const absence = absencesAujourdhui.find(a => a.collaborateur_id === c.id);
                    const collabSoldes = soldes.filter(s => s.collaborateur_id === c.id);
                    const totalRestant = collabSoldes.reduce((a, s) => a + Number(s.solde_restant), 0);
                    return (
                      <div key={c.id}
                        onClick={() => { setSelectedCollab(c.id); setShowDetailPanel(true); }}
                        className="rounded-2xl border p-4 text-center cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5"
                        style={{
                          background: "hsl(var(--card))",
                          borderColor: isAbsent ? `${DS.amber}50` : "hsl(var(--border))",
                        }}>
                        <div className="relative inline-block mb-3">
                          <Avatar collab={c} size={56} />
                          <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2"
                            style={{
                              background: isAbsent ? DS.amber : DS.green,
                              borderColor: "hsl(var(--card))",
                            }} />
                        </div>
                        <p className="text-sm font-bold leading-tight" style={{ color: "hsl(var(--foreground))" }}>
                          {c.prenom}
                        </p>
                        <p className="text-sm font-bold leading-tight" style={{ color: "hsl(var(--foreground))" }}>
                          {c.nom}
                        </p>
                        <p className="text-[10px] font-mono mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                          {c.matricule}
                        </p>
                        {isAbsent && absence && (
                          <span className="inline-block text-[9px] px-1.5 py-0.5 rounded-full mt-1.5 font-semibold"
                            style={{ background: DS.amberL, color: DS.amber }}>
                            Absent · {absence.code_type_conge}
                          </span>
                        )}
                        {!isAbsent && (
                          <span className="inline-block text-[9px] px-1.5 py-0.5 rounded-full mt-1.5 font-semibold"
                            style={{ background: DS.greenL, color: DS.green }}>
                            Présent
                          </span>
                        )}
                        <div className="mt-2 flex justify-center items-center gap-1">
                          <span className="text-xs font-bold"
                            style={{ color: totalRestant < 2 ? DS.red : totalRestant < 5 ? DS.amber : "hsl(var(--foreground))" }}>
                            {totalRestant.toFixed(1)}j
                          </span>
                          <span className="text-[9px]" style={{ color: "hsl(var(--muted-foreground))" }}>restants</span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </>
          )}

          {/* ════════════════════════════════════════════
              CALENDRIER MENSUEL
          ════════════════════════════════════════════ */}
          {activeTab === "calendrier" && (() => {
            const monthStart  = startOfMonth(currentMonth);
            const monthEnd    = endOfMonth(currentMonth);
            const firstDay    = getDay(monthStart); // 0=dim
            const offset      = firstDay === 0 ? 6 : firstDay - 1; // lundi=0
            const totalCells  = Math.ceil((offset + (monthEnd.getDate())) / 7) * 7;
            const cells       = Array.from({ length: totalCells }, (_, i) =>
              addDays(monthStart, i - offset));
            const JOURS       = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

            return (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-2xl font-bold" style={{ color: "hsl(var(--foreground))" }}>
                      Calendrier équipe
                    </h1>
                    <p className="text-sm mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                      Absences et événements du mois
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" className="h-8 w-8 p-0"
                      onClick={() => setCurrentMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))}>
                      <ChevronLeft size={14} />
                    </Button>
                    <span className="text-sm font-semibold px-2 min-w-32 text-center"
                      style={{ color: "hsl(var(--foreground))" }}>
                      {format(currentMonth, "MMMM yyyy", { locale: fr })}
                    </span>
                    <Button size="sm" variant="outline" className="h-8 w-8 p-0"
                      onClick={() => setCurrentMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))}>
                      <ChevronRight size={14} />
                    </Button>
                    <Button size="sm" variant="outline" className="text-xs h-8"
                      onClick={() => setCurrentMonth(new Date())}>
                      Ce mois
                    </Button>
                  </div>
                </div>

                <div className="rounded-2xl border overflow-hidden"
                  style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>

                  {/* Jours de la semaine */}
                  <div className="grid grid-cols-7 border-b"
                    style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted)/0.3)" }}>
                    {JOURS.map(j => (
                      <div key={j} className="py-3 text-center text-xs font-semibold"
                        style={{ color: j === "Sam" || j === "Dim" ? "hsl(var(--muted-foreground)/0.5)" : "hsl(var(--muted-foreground))" }}>
                        {j}
                      </div>
                    ))}
                  </div>

                  {/* Cellules */}
                  <div className="grid grid-cols-7">
                    {cells.map((day, idx) => {
                      const inMonth = day.getMonth() === currentMonth.getMonth();
                      const isTdy = isToday(day);
                      const isWeekend = getDay(day) === 0 || getDay(day) === 6;
                      const ds = format(day, "yyyy-MM-dd");
                      const absents = equipe.filter(c =>
                        demandes.some(d =>
                          d.collaborateur_id === c.id &&
                          d.statut === "APPROUVEE" &&
                          d.date_debut <= ds &&
                          (d.date_fin_absence || d.date_debut) >= ds
                        )
                      );
                      const hasBorder = idx % 7 !== 0;
                      return (
                        <div key={day.toISOString()}
                          className="min-h-[90px] p-2 border-b"
                          style={{
                            borderColor: "hsl(var(--border)/0.4)",
                            borderLeft: hasBorder ? "1px solid hsl(var(--border)/0.4)" : "none",
                            background: !inMonth ? "hsl(var(--muted)/0.06)" : isWeekend ? "hsl(var(--muted)/0.1)" : "transparent",
                          }}>
                          {/* Numéro du jour */}
                          <div className="flex items-center justify-between mb-1">
                            <span className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full ${isTdy ? "text-white" : ""}`}
                              style={{
                                background: isTdy ? DS.accent : "transparent",
                                color: isTdy ? "white" : !inMonth ? "hsl(var(--muted-foreground)/0.3)" : isWeekend ? "hsl(var(--muted-foreground)/0.5)" : "hsl(var(--foreground))",
                              }}>
                              {format(day, "d")}
                            </span>
                            {absents.length > 0 && (
                              <span className="text-[9px] px-1 py-0.5 rounded"
                                style={{ background: DS.amberL, color: DS.amber }}>
                                {absents.length}
                              </span>
                            )}
                          </div>
                          {/* Avatars absents */}
                          <div className="flex flex-wrap gap-0.5">
                            {absents.slice(0, 3).map(c => (
                              <Tooltip key={c.id}>
                                <TooltipTrigger>
                                  <Avatar collab={c} size={20} />
                                </TooltipTrigger>
                                <TooltipContent>{c.prenom} {c.nom}</TooltipContent>
                              </Tooltip>
                            ))}
                            {absents.length > 3 && (
                              <span className="text-[9px] w-5 h-5 rounded-full flex items-center justify-center font-bold"
                                style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                                +{absents.length - 3}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Légende */}
                <div className="flex gap-4 text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-full" style={{ background: DS.accent }} />
                    <span style={{ color: "hsl(var(--muted-foreground))" }}>Aujourd'hui</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded" style={{ background: DS.amberL, border: `1px solid ${DS.amber}` }} />
                    <span style={{ color: "hsl(var(--muted-foreground))" }}>Absence approuvée</span>
                  </div>
                </div>
              </>
            );
          })()}

          {/* ════════════════════════════════════════════
              APPARENCE
          ════════════════════════════════════════════ */}
          {activeTab === "apparence" && (
            <>
              <div>
                <h1 className="text-2xl font-bold" style={{ color: "hsl(var(--foreground))" }}>Apparence</h1>
                <p className="text-sm mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Personnalisez votre interface
                </p>
              </div>

              <div className="grid grid-cols-2 gap-5">

                {/* Thème */}
                <div className="rounded-2xl border p-5"
                  style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
                  <p className="text-sm font-bold mb-3" style={{ color: "hsl(var(--foreground))" }}>
                    Thème d'affichage
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { v: "light",  l: "Clair",  icon: <Sun size={18} /> },
                      { v: "dark",   l: "Sombre", icon: <Moon size={18} /> },
                      { v: "system", l: "Système",icon: <Monitor size={18} /> },
                    ] as const).map(opt => (
                      <button key={opt.v} onClick={() => setThemeMode(opt.v)}
                        className="flex flex-col items-center gap-2 p-3 rounded-xl border transition-all"
                        style={{
                          background: themeMode === opt.v ? DS.accentL : "transparent",
                          borderColor: themeMode === opt.v ? DS.accent : "hsl(var(--border))",
                          color: themeMode === opt.v ? DS.accent : "hsl(var(--muted-foreground))",
                        }}>
                        {opt.icon}
                        <span className="text-xs font-medium">{opt.l}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Couleur d'accentuation */}
                <div className="rounded-2xl border p-5"
                  style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
                  <p className="text-sm font-bold mb-3" style={{ color: "hsl(var(--foreground))" }}>
                    Couleur d'accentuation
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      "#3B82F6", "#8B5CF6", "#10B981", "#F59E0B",
                      "#EF4444", "#EC4899", "#06B6D4", "#6366F1",
                    ].map(color => (
                      <button key={color} onClick={() => setAccentColor(color)}
                        className="w-8 h-8 rounded-full transition-all hover:scale-110"
                        style={{
                          background: color,
                          border: accentColor === color ? `3px solid hsl(var(--foreground))` : "3px solid transparent",
                          outline: accentColor === color ? `2px solid ${color}` : "none",
                          outlineOffset: "2px",
                        }} />
                    ))}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Aperçu :</span>
                    <span className="text-xs px-2 py-0.5 rounded-full text-white font-medium"
                      style={{ background: accentColor }}>
                      Bouton exemple
                    </span>
                  </div>
                </div>

                {/* Taille du texte */}
                <div className="rounded-2xl border p-5"
                  style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
                  <p className="text-sm font-bold mb-3" style={{ color: "hsl(var(--foreground))" }}>
                    Taille du texte
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { v: "sm", l: "Petit",  demo: "Aa" },
                      { v: "md", l: "Moyen",  demo: "Aa" },
                      { v: "lg", l: "Grand",  demo: "Aa" },
                    ] as const).map(opt => (
                      <button key={opt.v} onClick={() => setFontSize(opt.v)}
                        className="flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all"
                        style={{
                          background: fontSize === opt.v ? DS.accentL : "transparent",
                          borderColor: fontSize === opt.v ? DS.accent : "hsl(var(--border))",
                          color: fontSize === opt.v ? DS.accent : "hsl(var(--muted-foreground))",
                        }}>
                        <span className="font-bold" style={{
                          fontSize: opt.v === "sm" ? 14 : opt.v === "md" ? 18 : 24
                        }}>{opt.demo}</span>
                        <span className="text-[10px] font-medium">{opt.l}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Sidebar compact */}
                <div className="rounded-2xl border p-5"
                  style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
                  <p className="text-sm font-bold mb-3" style={{ color: "hsl(var(--foreground))" }}>
                    Options d'affichage
                  </p>
                  <div className="space-y-3">
                    {[
                      { label: "Sidebar compacte", desc: "Masque les libellés, icônes uniquement", state: sidebarCompact, toggle: () => setSidebarCompact(v => !v) },
                    ].map(opt => (
                      <div key={opt.label} className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-medium" style={{ color: "hsl(var(--foreground))" }}>{opt.label}</p>
                          <p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>{opt.desc}</p>
                        </div>
                        <button onClick={opt.toggle}
                          className="w-11 h-6 rounded-full transition-all relative"
                          style={{ background: opt.state ? DS.accent : "hsl(var(--muted))" }}>
                          <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all"
                            style={{ left: opt.state ? "calc(100% - 22px)" : "2px" }} />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 pt-4 border-t" style={{ borderColor: "hsl(var(--border))" }}>
                    <p className="text-[10px] text-center" style={{ color: "hsl(var(--muted-foreground))" }}>
                      Les préférences sont sauvegardées localement dans votre navigateur.
                    </p>
                  </div>
                </div>

              </div>

              {/* Bouton appliquer */}
              <div className="flex justify-end">
                <Button style={{ background: DS.accent, color: "white" }}
                  onClick={() => toast({ title: "Apparence mise à jour ✓", description: "Vos préférences ont été enregistrées." })}>
                  <Check size={14} className="mr-1.5" /> Appliquer les changements
                </Button>
              </div>
            </>
          )}

        </div>
      </main>

      {/* ── Modale détail départ (dossier complet) ── */}
      {departDetail && (() => {
        const d: any = departDetail;
        const collab = d._collab;
        const badge = departBadge(d);
        const isAnnule = d._statut === "ANNULE";
        const accent = isAnnule ? "hsl(var(--muted-foreground))" : badge.color;
        const accentSoft = isAnnule ? "hsl(var(--muted)/0.5)" : badge.bg;
        const uoLib = d._uo ? (uosManager.find((u) => u.id === d._uo)?.libelle || null) : null;
        const today = new Date();

        const money = (v: any) =>
          v === null || v === undefined || v === "" || isNaN(Number(v)) ? null
            : `${Number(v).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
        const num = (v: any) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? 0 : Number(v));
        const EMPTY = <span style={{ color: "hsl(var(--muted-foreground))", opacity: 0.7 }}>—</span>;

        // ── Étapes du processus (toutes affichées, datées ou non) ──
        const etapes = [
          { key: "notif",     label: "Notification",   date: d.date_notification,        icon: <Bell size={11} /> },
          { key: "entretien", label: "Entretien",      date: d.date_entretien_prealable, icon: <MessageSquare size={11} /> },
          { key: "preavis_d", label: "Début préavis",  date: d.preavis_date_debut,       icon: <Clock size={11} /> },
          { key: "depart",    label: "Départ",         date: d.date_depart,              icon: <DoorOpen size={12} />, pivot: true },
          { key: "preavis_f", label: "Fin préavis",    date: d.preavis_date_fin,         icon: <Clock size={11} /> },
          { key: "traite",    label: "Traité",         date: d.traite_le,                icon: <CheckCircle size={11} /> },
        ];

        // ── Indemnités ──
        const palette = [DS.accent, DS.green, DS.amber, DS.purple, DS.teal, DS.red, "hsl(220 60% 50%)", "hsl(330 65% 55%)"];
        const indemnites = [
          { label: "Perte d'emploi",   value: num(d.indemnite_perte_emploi) },
          { label: "Départ retraite",  value: num(d.indemnite_depart_retraite) },
          { label: "Congés payés",     value: num(d.indemnite_conges_payes) },
          { label: "Compensatrice",    value: num(d.indemnite_compensatrice) },
          { label: "Transactionnelle", value: num(d.indemnite_transactionnelle) },
          { label: "Ancienneté",       value: num(d.indemnite_anciennete) },
          { label: "13ème mois",       value: num(d.indemnite_13eme_mois) },
        ].filter((x) => x.value > 0).map((x, i) => ({ ...x, color: palette[i % palette.length] }));
        const totalInd = num(d.indemnite_total) || indemnites.reduce((s, x) => s + x.value, 0);
        const maxInd = Math.max(1, ...indemnites.map((x) => x.value));

        // ── Check-lists ──
        const DOCS = [
          { key: "lettre_notification", label: "Lettre de notification" },
          { key: "pv_entretien", label: "PV d'entretien" },
          { key: "accord_amiable", label: "Accord amiable" },
          { key: "attestation_travail", label: "Attestation de travail" },
          { key: "certificat_conges", label: "Certificat de congés" },
          { key: "recu_stc", label: "Reçu solde de tout compte" },
          { key: "radiation_cnss", label: "Radiation CNSS" },
          { key: "attestation_amo", label: "Attestation AMO" },
          { key: "recu_materiel", label: "Reçu de matériel" },
        ];
        const docsOk = DOCS.filter((x) => d[`doc_${x.key}`]).length;
        const materiels = [
          { label: "Badge", v: !!d.materiel_badge_restitue },
          { label: "Ordinateur", v: !!d.materiel_ordinateur_restitue },
          { label: "Véhicule", v: !!d.materiel_vehicule_restitue },
          { label: "Téléphone", v: !!d.materiel_telephone_restitue },
        ];
        const matOk = materiels.filter((x) => x.v).length;
        const acces = [
          { label: "Accès SI désactivé", v: !!d.acces_si_desactive },
          { label: "Email désactivé", v: !!d.acces_email_desactive },
        ];
        const accesOk = acces.filter((x) => x.v).length;

        // ── Sous-composants ──
        const Ring = ({ ok, total, color, label }: { ok: number; total: number; color: string; label: string }) => {
          const r = 24, c = 2 * Math.PI * r, pct = total ? ok / total : 0;
          return (
            <div className="flex flex-col items-center gap-1">
              <div className="relative" style={{ width: 58, height: 58 }}>
                <svg width="58" height="58" viewBox="0 0 58 58" className="-rotate-90">
                  <circle cx="29" cy="29" r={r} fill="none" stroke="hsl(var(--muted)/0.4)" strokeWidth="5" />
                  <circle cx="29" cy="29" r={r} fill="none" stroke={ok ? color : "hsl(var(--muted)/0.4)"} strokeWidth="5" strokeLinecap="round"
                    strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[13px] font-bold" style={{ color: "hsl(var(--foreground))" }}>{ok}/{total}</span>
                </div>
              </div>
              <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</span>
            </div>
          );
        };
        const Eyebrow = ({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) => (
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide mb-3"
            style={{ color: "hsl(var(--muted-foreground))" }}>{icon}{children}</div>
        );
        const Field = ({ label, value, full }: { label: string; value: any; full?: boolean }) => (
          <div className={full ? "col-span-2" : ""}>
            <div className="text-[10px] uppercase tracking-wide" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</div>
            <div className="text-sm mt-0.5" style={{ color: "hsl(var(--foreground))" }}>
              {value === null || value === undefined || value === "" ? EMPTY : value}
            </div>
          </div>
        );
        const Coche = ({ ok, label, path, docKey }: { ok: boolean; label: string; path?: string; docKey?: string }) => (
          <div className="flex items-center gap-2">
            {ok
              ? <CheckCircle size={15} style={{ color: DS.green, flexShrink: 0 }} />
              : <span className="inline-block rounded-full flex-shrink-0" style={{ width: 14, height: 14, border: "2px solid hsl(var(--border))" }} />}
            <span className="text-[12px] truncate" style={{ color: ok ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))" }}>{label}</span>
            {ok && docKey && (
              <span className="flex items-center gap-1 ml-auto flex-shrink-0">
                <button onClick={() => ouvrirDocDepart(d.id, docKey, "view")}
                  className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors"
                  style={{ background: DS.accentL, color: DS.accent }} title="Aperçu">
                  <Eye size={11} /> Voir
                </button>
                {peutTelecharger && (
                  <button onClick={() => ouvrirDocDepart(d.id, docKey, "download", path ? String(path).split(/[\\/]/).pop() : undefined)}
                    className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors"
                    style={{ background: DS.greenL, color: DS.green }} title="Télécharger">
                    <Download size={11} /> Télécharger
                  </button>
                )}
              </span>
            )}
          </div>
        );

        const initiales = collab ? `${collab.prenom?.[0] ?? ""}${collab.nom?.[0] ?? ""}` : "?";
        const dispenseLabel = d.preavis_dispense === true ? "Dispensé" : d.preavis_effectue === true ? "Effectué" : (d.preavis_dispense === false || d.preavis_effectue === false) ? "À effectuer" : null;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
            onClick={() => setDepartDetail(null)}>
            <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden"
              style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
              onClick={(e) => e.stopPropagation()}>

              {/* ── HÉRO ── */}
              <div className="relative flex-shrink-0 p-5"
                style={{ background: `linear-gradient(135deg, ${accentSoft}, transparent 70%)` }}>
                <div className="absolute top-0 left-0 right-0 h-1" style={{ background: accent }} />
                {/* Badge statut : en haut a droite, decale a gauche du X */}
                <span className="absolute top-3 right-12 text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap"
                  style={{ background: badge.bg, color: badge.color }}>
                  {badge.label}
                </span>
                <button onClick={() => setDepartDetail(null)}
                  className="absolute top-3 right-3 p-1.5 rounded-lg"
                  style={{ background: "hsl(var(--card))", color: "hsl(var(--muted-foreground))" }}>
                  <X size={16} />
                </button>
                <div className="flex items-start gap-4">
                  <div className="flex items-center justify-center rounded-2xl font-bold flex-shrink-0"
                    style={{ width: 60, height: 60, background: accentSoft, color: accent, fontSize: "calc(20px * var(--font-scale))", border: `2px solid ${accent}` }}>
                    {initiales}
                  </div>
                  <div className="flex-1 min-w-0 pr-24">
                    <h2 className="text-xl font-bold leading-tight" style={{ color: "hsl(var(--foreground))" }}>
                      {collab ? `${collab.prenom} ${collab.nom}` : "Collaborateur inconnu"}
                    </h2>
                    <div className="flex items-center gap-2 mt-1 flex-wrap text-[12px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {collab?.matricule && (
                        <span className="font-mono px-1.5 py-0.5 rounded" style={{ background: "hsl(var(--card))" }}>{collab.matricule}</span>
                      )}
                      {uoLib && <span className="flex items-center gap-1"><Building2 size={12} />{uoLib}</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                      <span className="text-sm font-semibold px-2.5 py-1 rounded-lg"
                        style={{ background: "hsl(var(--card))", color: "hsl(var(--foreground))" }}>
                        {d.motif_depart || "Motif non précisé"}
                      </span>
                      <span className="text-[13px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                        Départ le <strong style={{ color: "hsl(var(--foreground))" }}>{fmt(d.date_depart)}</strong>
                      </span>
                      {d.reference_decision && (
                        <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>· Réf. {d.reference_decision}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* ── CORPS scrollable ── */}
              <div className="p-5 space-y-5 overflow-y-auto">

                {/* Suivi du workflow (si départ en mode Processus) */}
                {(d as any).mode_traitement === "PROCESSUS" && (
                  <div className="rounded-xl border p-4" style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))" }}>
                    <Eyebrow icon={<Activity size={13} />}>Suivi de la validation</Eyebrow>
                    <SuiviDemandeWorkflow tableSource="collaborateur_departs" demandeId={d.id} statutDemande={d.statut} />
                  </div>
                )}

                {/* Informations du départ */}
                <div className="rounded-xl border p-4" style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))" }}>
                  <Eyebrow icon={<DoorOpen size={13} />}>Informations du départ</Eyebrow>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <Field label="Motif" value={d.motif_depart} />
                    <Field label="Code motif" value={d.code_motif_depart} />
                    <Field label="Statut" value={d.statut} />
                    <Field label="Référence décision" value={d.reference_decision} />
                    <Field label="Décision finale" value={d.decision_finale} />
                    <Field label="Date de départ" value={fmt(d.date_depart)} />
                    <Field label="Date de notification" value={d.date_notification ? fmt(d.date_notification) : null} />
                    <Field label="Entretien préalable" value={d.date_entretien_prealable ? fmt(d.date_entretien_prealable) : null} />
                  </div>
                </div>

                {/* Timeline (toutes les étapes) */}
                <div className="rounded-xl border p-4" style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))" }}>
                  <Eyebrow icon={<Activity size={13} />}>Déroulé du départ</Eyebrow>
                  <div className="flex items-start justify-between relative">
                    <div className="absolute left-0 right-0 h-0.5" style={{ top: 11, background: "hsl(var(--border))" }} />
                    {etapes.map((e) => {
                      const has = !!e.date;
                      const dt = has ? parseISO(e.date) : null;
                      const done = has && !isAnnule && dt! <= today;
                      const sz = e.pivot ? 24 : 22;
                      return (
                        <div key={e.key} className="relative flex flex-col items-center text-center px-0.5" style={{ flex: 1, zIndex: 1 }}>
                          <div className="flex items-center justify-center rounded-full"
                            style={{
                              width: sz, height: sz,
                              background: !has ? "hsl(var(--card))" : isAnnule ? "hsl(var(--muted)/0.6)" : done ? accent : "hsl(var(--card))",
                              border: `2px solid ${!has ? "hsl(var(--border))" : isAnnule ? "hsl(var(--muted-foreground))" : done ? accent : accent}`,
                              color: done && !isAnnule ? "#fff" : "hsl(var(--muted-foreground))",
                              opacity: has ? 1 : 0.6,
                            }}>
                            {e.pivot ? <DoorOpen size={12} /> : has ? (done ? <Check size={11} /> : <Clock size={10} />) : <Clock size={10} />}
                          </div>
                          <div className="mt-1.5 text-[10px] font-medium leading-tight" style={{ color: e.pivot ? accent : "hsl(var(--foreground))" }}>{e.label}</div>
                          <div className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>{has ? fmt(e.date) : "à définir"}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Chiffres-clés (toujours visibles) */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Préavis", value: d.preavis_duree_jours ? `${d.preavis_duree_jours} j` : null, hint: dispenseLabel },
                    { label: "Solde congés", value: num(d.solde_conges_jours) ? `${d.solde_conges_jours} j` : null, hint: undefined },
                    { label: "Ancienneté", value: num(d.anciennete_retenue_ans) ? `${d.anciennete_retenue_ans} ans` : null, hint: undefined },
                  ].map((s) => (
                    <div key={s.label} className="rounded-xl border p-3" style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))" }}>
                      <div className="text-[10px] uppercase tracking-wide" style={{ color: "hsl(var(--muted-foreground))" }}>{s.label}</div>
                      <div className="text-lg font-bold leading-tight mt-0.5" style={{ color: "hsl(var(--foreground))" }}>{s.value ?? EMPTY}</div>
                      {s.hint && <div className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>{s.hint}</div>}
                    </div>
                  ))}
                </div>

                {/* Préavis détaillé */}
                <div className="rounded-xl border p-4" style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))" }}>
                  <Eyebrow icon={<Clock size={13} />}>Préavis</Eyebrow>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <Field label="Catégorie" value={d.preavis_categorie} />
                    <Field label="Durée" value={d.preavis_duree_jours ? `${d.preavis_duree_jours} jours` : null} />
                    <Field label="Début" value={d.preavis_date_debut ? fmt(d.preavis_date_debut) : null} />
                    <Field label="Fin" value={d.preavis_date_fin ? fmt(d.preavis_date_fin) : null} />
                    <Field label="Statut préavis" value={dispenseLabel} />
                    <Field label="Indemnité de dispense" value={money(d.preavis_dispense_indemnite)} />
                  </div>
                </div>

                {/* Solde de tout compte */}
                <div className="rounded-xl border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
                  <div className="flex items-center justify-between px-4 py-3" style={{ background: totalInd > 0 ? DS.greenL : "hsl(var(--muted)/0.3)" }}>
                    <span className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                      <Award size={15} style={{ color: totalInd > 0 ? DS.green : "hsl(var(--muted-foreground))" }} /> Solde de tout compte
                    </span>
                    <span className="text-lg font-extrabold" style={{ color: totalInd > 0 ? DS.green : "hsl(var(--muted-foreground))" }}>
                      {money(totalInd) || "À calculer"}
                    </span>
                  </div>
                  <div className="p-4 space-y-2.5" style={{ background: "hsl(var(--background))" }}>
                    {indemnites.length > 0 ? (
                      indemnites.map((it) => (
                        <div key={it.label}>
                          <div className="flex items-center justify-between text-[12px] mb-1">
                            <span style={{ color: "hsl(var(--foreground))" }}>{it.label}</span>
                            <span className="font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>{money(it.value)}</span>
                          </div>
                          <div className="h-2 rounded-full overflow-hidden" style={{ background: "hsl(var(--muted)/0.4)" }}>
                            <div className="h-full rounded-full" style={{ width: `${Math.max(4, (it.value / maxInd) * 100)}%`, background: it.color }} />
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-[12px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                        Indemnités non encore calculées.
                      </p>
                    )}
                    <div className="pt-1 text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                      Base de calcul : {money(d.base_calcul_salaire) || "—"}
                    </div>
                  </div>
                </div>

                {/* Clôture & restitutions */}
                <div className="rounded-xl border p-4" style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))" }}>
                  <Eyebrow icon={<CheckCircle size={13} />}>Clôture & restitutions</Eyebrow>
                  <div className="flex items-center justify-around mb-4">
                    <Ring ok={docsOk} total={DOCS.length} color={DS.accent} label="Documents" />
                    <Ring ok={matOk} total={materiels.length} color={DS.purple} label="Matériel" />
                    <Ring ok={accesOk} total={acces.length} color={DS.teal} label="Accès SI" />
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4 pt-3 border-t" style={{ borderColor: "hsl(var(--border))" }}>
                    <div>
                      <div className="text-[10px] uppercase tracking-wide mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>Documents</div>
                      <div className="space-y-1.5">
                        {DOCS.map((x) => <Coche key={x.key} ok={!!d[`doc_${x.key}`]} label={x.label} path={d[`doc_${x.key}_path`]} docKey={x.key} />)}
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <div className="text-[10px] uppercase tracking-wide mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>Matériel restitué</div>
                        <div className="space-y-1.5">
                          {materiels.map((x) => <Coche key={x.label} ok={x.v} label={x.label} />)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wide mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>Accès SI</div>
                        <div className="space-y-1.5">
                          {acces.map((x) => <Coche key={x.label} ok={x.v} label={x.label} />)}
                          <Field label="Désactivés le" value={d.acces_desactivation_date ? fmt(d.acces_desactivation_date) : null} />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Démarches sociales */}
                <div className="rounded-xl border p-4" style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))" }}>
                  <Eyebrow icon={<Info size={13} />}>Démarches sociales (CNSS / AMO)</Eyebrow>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <Field label="Radiation CNSS" value={d.cnss_radiation_date ? fmt(d.cnss_radiation_date) : null} />
                    <Field label="Dernière déclaration CNSS" value={d.cnss_derniere_declaration} />
                    <Field label="Clôture AMO" value={d.amo_cloture_date ? fmt(d.amo_cloture_date) : null} />
                    <Field label="Attestation AMO" value={d.amo_attestation_delivree === true ? "Délivrée" : d.amo_attestation_delivree === false ? "Non délivrée" : null} />
                  </div>
                </div>

                {/* Commentaire */}
                <div className="rounded-xl border-l-4 p-3" style={{ borderColor: accent, background: "hsl(var(--muted)/0.3)" }}>
                  <div className="text-[10px] uppercase tracking-wide mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Commentaire</div>
                  <p className="text-sm" style={{ color: d.commentaire ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))" }}>
                    {d.commentaire || "Aucun commentaire."}
                  </p>
                </div>

                {/* Pied */}
                <div className="flex items-center justify-between text-[11px] pt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                  <span>{d.decision_finale ? `Décision : ${d.decision_finale}` : ""}</span>
                  <span>{d.traite_le ? `Traité le ${format(parseISO(d.traite_le), "dd/MM/yyyy", { locale: fr })}` : (d.created_at ? `Enregistré le ${format(parseISO(d.created_at), "dd/MM/yyyy", { locale: fr })}` : "")}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Dialog refus ── */}
      {showRefusDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-md rounded-2xl p-6 shadow-2xl"
            style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
            <div className="flex items-center gap-2 mb-4">
              <XCircle size={18} style={{ color: DS.red }} />
              <h3 className="text-base font-bold" style={{ color: "hsl(var(--foreground))" }}>
                Motif de refus
              </h3>
            </div>
            <Textarea
              placeholder="Précisez le motif de refus (sera communiqué au collaborateur)…"
              value={motifRefus}
              onChange={e => setMotifRefus(e.target.value)}
              rows={4}
              className="mb-4 text-sm resize-none"
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { setShowRefusDialog(null); setMotifRefus(""); }}>
                Annuler
              </Button>
              <Button
                disabled={!motifRefus.trim() || refuser.isPending}
                style={{ background: DS.red, color: "white" }}
                onClick={() => refuser.mutate({ id: showRefusDialog, motif: motifRefus })}>
                {refuser.isPending ? "Envoi…" : "Confirmer le refus"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Panel détail collaborateur ── */}
      {showDetailPanel && selectedCollab && (
        <div className="fixed inset-y-0 right-0 z-40 w-80 shadow-2xl border-l flex flex-col"
          style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
          <div className="flex items-center justify-between px-5 py-4 border-b"
            style={{ borderColor: "hsl(var(--border))" }}>
            <span className="text-sm font-bold" style={{ color: "hsl(var(--foreground))" }}>
              Fiche collaborateur
            </span>
            <button onClick={() => setShowDetailPanel(false)}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors">
              <X size={15} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {(() => {
              const c = equipe.find(e => e.id === selectedCollab);
              if (!c) return null;
              const collabDemandes = demandes.filter(d => d.collaborateur_id === c.id);
              const collabSoldes = soldes.filter(s => s.collaborateur_id === c.id);
              const collabDepart = departs.find(d => d.collaborateur_id === c.id);
              return (
                <>
                  <div className="text-center py-3">
                    <Avatar collab={c} size={64} />
                    <p className="text-base font-bold mt-2" style={{ color: "hsl(var(--foreground))" }}>
                      {c.prenom} {c.nom}
                    </p>
                    <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{c.matricule}</p>
                    <div className="mt-2"><StatutBadge statut={c.statut_collaborateur} /></div>
                  </div>

                  {/* Soldes */}
                  <div className="rounded-xl border p-3"
                    style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted)/0.2)" }}>
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-2"
                      style={{ color: "hsl(var(--muted-foreground))" }}>Soldes congés</p>
                    {collabSoldes.length === 0 ? (
                      <p className="text-xs italic" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun solde</p>
                    ) : collabSoldes.map(s => (
                      <div key={s.code_type_conge} className="flex justify-between text-xs mb-1">
                        <span style={{ color: "hsl(var(--muted-foreground))" }}>{s.code_type_conge}</span>
                        <span className="font-bold"
                          style={{ color: Number(s.solde_restant) < 2 ? DS.red : DS.green }}>
                          {Number(s.solde_restant).toFixed(1)}j
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Dernières demandes */}
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-2"
                      style={{ color: "hsl(var(--muted-foreground))" }}>Dernières demandes</p>
                    {collabDemandes.slice(0, 4).map(d => (
                      <div key={d.id} className="flex items-center justify-between text-xs py-1.5 border-b"
                        style={{ borderColor: "hsl(var(--border)/0.5)" }}>
                        <span style={{ color: "hsl(var(--foreground))" }}>
                          {d.code_type_conge} · {fmt(d.date_debut)}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                          style={{
                            background: d.statut === "APPROUVEE" ? DS.greenL : d.statut === "REFUSEE" ? DS.redL : DS.amberL,
                            color: d.statut === "APPROUVEE" ? DS.green : d.statut === "REFUSEE" ? DS.red : DS.amber,
                          }}>
                          {d.statut}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Départ */}
                  {collabDepart && (
                    <div className="rounded-xl border p-3"
                      style={{ background: DS.redL, borderColor: `${DS.red}30` }}>
                      <p className="text-[10px] font-bold uppercase tracking-wider mb-1"
                        style={{ color: DS.red }}>Départ planifié</p>
                      <p className="text-xs" style={{ color: "hsl(var(--foreground))" }}>
                        {collabDepart.motif_depart}
                      </p>
                      <p className="text-xs mt-0.5 font-bold" style={{ color: DS.red }}>
                        Le {fmt(collabDepart.date_depart)}
                      </p>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

    </div>
    </TooltipProvider>
  );
};

export default ManagerSpace;
