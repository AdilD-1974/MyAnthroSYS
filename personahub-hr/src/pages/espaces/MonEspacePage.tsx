/**
 * MonEspacePage.tsx — Portail self-service collaborateur (refonte approfondie)
 * ----------------------------------------------------------------------------
 * Nouveautés :
 *  - Recherche transversale dans le dossier (index plat de tous les champs)
 *  - Calendrier mensuel des congés (posés / en attente) calculé côté client
 *  - Annulation des demandes en_attente (PATCH statut = annulee)
 *  - Formulaire de demande enrichi : décompte jours ouvrés vs calendaires,
 *    raccourcis de dates, détection de chevauchement, contrôle de solde
 *  - Compteurs : projection de fin d'exercice + reliquat à poser
 *  - Notifications : filtres par type + regroupement temporel
 *  - Densité d'affichage (confort / compact) persistée
 *  - Impression de la fiche (print:hidden / print:block)
 *  - Demande d'attestation (modal + presse-papier / mailto RH)
 *  - Sous-onglet « Mon manager & contacts » (lookup best-effort)
 *  - Feed d'activité récente sur l'accueil
 *
 * Aucune migration DB requise. Toutes les écritures s'appuient sur des
 * colonnes déjà existantes (cong_demandes.statut, notifications.lu).
 * Les lectures « bonus » (documents, manager) sont protégées par try/catch.
 */

import React, { useState, useMemo, useCallback, useEffect, createContext, useContext } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import DemandeCongeForm from "@/pages/absences/DemandeCongeForm";
import SuiviDemandeWorkflow from "@/pages/espaces/SuiviDemandeWorkflow";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Home, Briefcase, CalendarDays, FileText, Bell, User, Building2,
  Clock, CheckCircle2, XCircle, AlertTriangle, ChevronRight, ChevronLeft,
  Download, Plus, Send, RefreshCw, TrendingUp, Award, Phone, MapPin, Heart,
  ArrowUpRight, Sparkles, Shield, BookOpen, BarChart3, X, Check, Info,
  PieChart, Activity, Star, Users, ChevronDown, UserCircle2, Settings,
  UserCheck, Calculator, ChevronUp, Search, Copy, Printer, Mail, Trash2,
  Cake, Hourglass, Filter, Layers, Maximize2, Minimize2, CalendarClock,
  ClipboardList, RotateCcw,
} from "lucide-react";
import {
  format, parseISO, differenceInDays, differenceInMonths, differenceInYears,
  addDays, isAfter, isBefore, startOfMonth, endOfMonth, eachDayOfInterval,
  startOfWeek, endOfWeek, isSameMonth, isSameDay, addMonths, subMonths,
  isWithinInterval, isWeekend,
} from "date-fns";
import { fr } from "date-fns/locale";

// ── Types ─────────────────────────────────────────────────────────────────────
type AppRole = "administrateur" | "gestionnaire_rh" | "gestionnaire_paie" | "manager" | "collaborateur";
type Density = "confort" | "compact";

interface Collaborateur {
  id: string; matricule: string; nom: string; prenom: string; civilite?: string;
  date_naissance?: string; code_genre?: string; lieu_naissance?: string;
  email_professionnel?: string; telephone?: string; gsm?: string;
  statut_collaborateur: string; photo_path?: string; photo_url?: string;
  [key: string]: any;
}

// ── Config rôles ──────────────────────────────────────────────────────────────
const ROLE_CFG: Record<AppRole, {
  label: string; color: string; bg: string; border: string;
  icon: React.ReactNode; redirectPath?: string; description: string;
}> = {
  administrateur:    { label: "Administrateur",    color: "hsl(213 73% 40%)", bg: "hsl(213 73% 40% / 0.1)", border: "hsl(213 73% 40% / 0.3)", icon: <Settings size={14} />,    redirectPath: "/",               description: "Accès complet à toutes les fonctionnalités" },
  gestionnaire_rh:   { label: "Gestionnaire RH",   color: "hsl(197 100% 38%)",bg: "hsl(197 100% 38% / 0.1)",border: "hsl(197 100% 38% / 0.3)",icon: <UserCheck size={14} />,   redirectPath: "/collaborateurs", description: "Gestion des collaborateurs et congés" },
  gestionnaire_paie: { label: "Gestionnaire Paie", color: "hsl(84 55% 38%)",  bg: "hsl(84 55% 38% / 0.1)",  border: "hsl(84 55% 38% / 0.3)",  icon: <Calculator size={14} />,  redirectPath: "/paie",           description: "Gestion de la paie et déclarations" },
  manager:           { label: "Manager",           color: "hsl(39 95% 42%)",  bg: "hsl(39 95% 42% / 0.1)",  border: "hsl(39 95% 42% / 0.3)",  icon: <Briefcase size={14} />,   redirectPath: "/espace-manager", description: "Validation équipe et planning" },
  collaborateur:     { label: "Collaborateur",     color: "hsl(215 20% 45%)", bg: "hsl(215 20% 45% / 0.1)", border: "hsl(215 20% 45% / 0.3)", icon: <UserCircle2 size={14} />, redirectPath: "/mon-espace",     description: "Espace self-service collaborateur" },
};

const TABS_BY_ROLE: Record<string, { id: string; label: string; icon: React.ComponentType<{ size?: number }> }[]> = {
  collaborateur: [
    { id: "accueil",       label: "Accueil",       icon: Home },
    { id: "dossier",       label: "Mon dossier",   icon: User },
    { id: "conges",        label: "Congés",        icon: CalendarDays },
    { id: "demandes",      label: "Mes demandes",  icon: ClipboardList },
    { id: "planning",      label: "Mon planning",  icon: CalendarClock },
    { id: "compteurs",     label: "Compteurs",     icon: BarChart3 },
    { id: "parcours",      label: "Mon parcours",  icon: TrendingUp },
    { id: "documents",     label: "Documents",     icon: FileText },
    { id: "notifications", label: "Notifications", icon: Bell },
  ],
  manager: [
    { id: "accueil",       label: "Accueil",       icon: Home },
    { id: "equipe",        label: "Mon équipe",    icon: Users },
    { id: "conges",        label: "Congés équipe", icon: CalendarDays },
    { id: "dossier",       label: "Mon dossier",   icon: User },
    { id: "notifications", label: "Notifications", icon: Bell },
  ],
  default: [
    { id: "accueil",       label: "Accueil",       icon: Home },
    { id: "dossier",       label: "Mon dossier",   icon: User },
    { id: "notifications", label: "Notifications", icon: Bell },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const normTxt = (s: string) =>
  (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const fmt = (d?: string, p = "dd/MM/yyyy") => (d ? format(parseISO(d), p, { locale: fr }) : "—");

/** Décompte des jours ouvrés (hors samedi/dimanche) entre deux dates incluses. */
function joursOuvres(debut: string, fin: string): number {
  if (!debut || !fin || fin < debut) return 0;
  const days = eachDayOfInterval({ start: parseISO(debut), end: parseISO(fin) });
  return days.filter(d => !isWeekend(d)).length;
}
const joursCalendaires = (debut: string, fin: string): number =>
  !debut || !fin || fin < debut ? 0 : differenceInDays(parseISO(fin), parseISO(debut)) + 1;

/** Densité d'affichage partagée. */
const DensityCtx = createContext<Density>("confort");
const useDensity = () => useContext(DensityCtx);

function useUiPrefs() {
  const [density, setDensity] = useState<Density>(() => {
    try { return (localStorage.getItem("me_density") as Density) || "confort"; } catch { return "confort"; }
  });
  const [lastTab, setLastTab] = useState<string>(() => {
    try { return localStorage.getItem("me_lasttab") || "accueil"; } catch { return "accueil"; }
  });
  useEffect(() => { try { localStorage.setItem("me_density", density); } catch { /* */ } }, [density]);
  const persistTab = useCallback((t: string) => { try { localStorage.setItem("me_lasttab", t); } catch { /* */ } setLastTab(t); }, []);
  return { density, setDensity, lastTab, persistTab };
}

// ── Primitives UI ───────────────────────────────────────────────────────────
function CopyButton({ value, label }: { value?: string; label?: string }) {
  const [done, setDone] = useState(false);
  if (!value) return null;
  return (
    <button
      onClick={async () => { try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1200); } catch { /* */ } }}
      className="p-1 rounded-md hover:opacity-70 transition-opacity print:hidden"
      style={{ color: done ? "hsl(142 55% 40%)" : "hsl(var(--muted-foreground))" }}
      title={`Copier ${label || ""}`.trim()}>
      {done ? <Check size={11} /> : <Copy size={11} />}
    </button>
  );
}

function InfoField({ label, value, copyable }: { label: string; value?: React.ReactNode; copyable?: boolean }) {
  const txt = typeof value === "string" ? value : undefined;
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</p>
      <div className="flex items-center gap-1">
        <p className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>{value || "—"}</p>
        {copyable && txt && <CopyButton value={txt} label={label} />}
      </div>
    </div>
  );
}

function Section({ title, icon, children, action, collapsible }: {
  title: string; icon?: React.ReactNode; children: React.ReactNode; action?: React.ReactNode; collapsible?: boolean;
}) {
  const density = useDensity();
  const [open, setOpen] = useState(true);
  const pad = density === "compact" ? "p-3" : "p-4";
  const head = density === "compact" ? "px-3 py-2" : "px-4 py-3";
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}>
      <div className={`flex items-center justify-between ${head} border-b`}
        style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
        <button
          onClick={() => collapsible && setOpen(o => !o)}
          className={`flex items-center gap-2 ${collapsible ? "cursor-pointer hover:opacity-70" : "cursor-default"}`}>
          {icon && <span style={{ color: "hsl(var(--accent))" }}>{icon}</span>}
          <h3 className="text-xs font-bold uppercase tracking-wider">{title}</h3>
          {collapsible && (open ? <ChevronUp size={12} style={{ color: "hsl(var(--muted-foreground))" }} /> : <ChevronDown size={12} style={{ color: "hsl(var(--muted-foreground))" }} />)}
        </button>
        {action}
      </div>
      {open && <div className={pad}>{children}</div>}
    </div>
  );
}

function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="py-10 text-center">
      <div className="mx-auto mb-2 opacity-30">{icon}</div>
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>{hint}</p>}
    </div>
  );
}

const STATUT_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  en_attente: { label: "En attente", color: "hsl(var(--warning))",  bg: "hsl(var(--warning) / 0.12)" },
  approuvee:  { label: "Approuvée",  color: "hsl(var(--success))", bg: "hsl(var(--success) / 0.12)" },
  refusee:    { label: "Refusée",    color: "hsl(var(--destructive))",   bg: "hsl(var(--destructive) / 0.10)" },
  annulee:    { label: "Annulée",    color: "hsl(var(--muted-foreground))", bg: "hsl(var(--muted))" },
};
function StatutBadge({ statut }: { statut: string }) {
  const c = STATUT_BADGE[statut] ?? { label: statut, color: "hsl(var(--muted-foreground))", bg: "hsl(var(--muted))" };
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: c.bg, color: c.color }}>{c.label}</span>;
}

function AncienneteText({ dateDebut }: { dateDebut?: string }) {
  if (!dateDebut) return null;
  const d = parseISO(dateDebut), now = new Date();
  const ans = differenceInYears(now, d);
  const mois = differenceInMonths(now, d) % 12;
  if (ans === 0 && mois === 0) return <span>Moins d'un mois</span>;
  return <span>{ans > 0 ? `${ans} an${ans > 1 ? "s" : ""}` : ""}{ans > 0 && mois > 0 ? " et " : ""}{mois > 0 ? `${mois} mois` : ""}</span>;
}

// ── Sélecteur de profil (multi-rôles) ─────────────────────────────────────────
function ProfileSwitcher({ roles, activeRole, onSwitch, collab }: {
  roles: AppRole[]; activeRole: AppRole; onSwitch: (r: AppRole) => void; collab: Collaborateur | null;
}) {
  const [open, setOpen] = useState(false);
  const active = ROLE_CFG[activeRole];
  const raw = collab?.photo_path || collab?.photo_url;
  const photoUrl = raw ? (raw.startsWith("http") || raw.startsWith("/") ? raw : `/api/v1/storage/${raw}`) : null;
  const initiales = collab ? `${collab.prenom?.[0] ?? ""}${collab.nom?.[0] ?? ""}` : "?";
  const nomComplet = collab ? `${collab.civilite ? collab.civilite + " " : ""}${collab.prenom} ${collab.nom}` : "Collaborateur";

  const Avatar = (
    <div className="relative">
      {photoUrl
        ? <img src={photoUrl} alt={initiales} className="w-14 h-14 rounded-2xl object-cover shadow-xl" style={{ border: "2px solid rgba(255,255,255,0.25)" }} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
        : <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-bold shadow-xl" style={{ background: "linear-gradient(135deg, hsl(200 70% 55%), hsl(220 60% 50%))", color: "white", border: "2px solid rgba(255,255,255,0.2)" }}>{initiales}</div>}
      <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white" style={{ background: "hsl(142 55% 45%)" }} />
    </div>
  );

  if (roles.length <= 1) {
    return (
      <div className="flex items-center gap-3">
        {Avatar}
        <div>
          <p className="text-2xl font-bold text-white leading-tight">{nomComplet}</p>
          <div className="flex items-center gap-1.5 mt-1 px-2 py-0.5 rounded-md w-fit" style={{ background: active.bg, border: `1px solid ${active.border}` }}>
            <span style={{ color: active.color }}>{active.icon}</span>
            <span className="text-xs font-semibold" style={{ color: active.color }}>{active.label}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-3">
        {Avatar}
        <div>
          <p className="text-xl font-bold text-white leading-tight">{nomComplet}</p>
          <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 mt-1 px-2.5 py-1 rounded-lg transition-all hover:opacity-80" style={{ background: active.bg, border: `1px solid ${active.border}` }}>
            <span style={{ color: active.color }}>{active.icon}</span>
            <span className="text-xs font-semibold" style={{ color: active.color }}>{active.label}</span>
            {open ? <ChevronUp size={11} style={{ color: active.color }} /> : <ChevronDown size={11} style={{ color: active.color }} />}
            <span className="text-[9px] ml-1 px-1 rounded-full font-bold text-white" style={{ background: active.color }}>{roles.length}</span>
          </button>
        </div>
      </div>
      {open && (
        <div className="absolute top-full left-0 mt-2 w-72 rounded-2xl shadow-2xl z-50 overflow-hidden" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
          <div className="px-4 py-3 border-b" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.5)" }}>
            <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>Changer de profil</p>
            <p className="text-[10px] mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{roles.length} profil{roles.length > 1 ? "s" : ""} disponible{roles.length > 1 ? "s" : ""}</p>
          </div>
          <div className="py-1.5">
            {roles.map(r => {
              const cfg = ROLE_CFG[r]; const isActive = r === activeRole;
              return (
                <button key={r} onClick={() => { onSwitch(r); setOpen(false); }} className="w-full flex items-center gap-3 px-4 py-3 transition-all hover:opacity-80 text-left" style={{ background: isActive ? cfg.bg : "transparent" }}>
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color }}>{cfg.icon}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold" style={{ color: isActive ? cfg.color : "hsl(var(--foreground))" }}>{cfg.label}</p>
                    <p className="text-[10px] leading-tight" style={{ color: "hsl(var(--muted-foreground))" }}>{cfg.description}</p>
                  </div>
                  {isActive && <Check size={13} style={{ color: cfg.color, flexShrink: 0 }} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Calendrier mensuel des congés ─────────────────────────────────────────────
function CongesCalendar({ demandes }: { demandes: any[] }) {
  const [mois, setMois] = useState(() => startOfMonth(new Date()));
  const grid = useMemo(() => {
    const start = startOfWeek(startOfMonth(mois), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(mois), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [mois]);

  // Index jour -> statut prioritaire (approuvee > en_attente)
  const dayStatut = useCallback((day: Date): "approuvee" | "en_attente" | null => {
    let res: "approuvee" | "en_attente" | null = null;
    for (const d of demandes) {
      if (d.statut !== "approuvee" && d.statut !== "en_attente") continue;
      try {
        if (isWithinInterval(day, { start: parseISO(d.date_debut), end: parseISO(d.date_fin_absence) })) {
          if (d.statut === "approuvee") return "approuvee";
          res = "en_attente";
        }
      } catch { /* */ }
    }
    return res;
  }, [demandes]);

  const COL = { approuvee: "hsl(142 55% 45%)", en_attente: "hsl(38 92% 50%)" } as const;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => setMois(m => subMonths(m, 1))} className="p-1.5 rounded-lg hover:opacity-70" style={{ background: "hsl(var(--muted))" }}><ChevronLeft size={14} /></button>
        <p className="text-sm font-bold capitalize">{format(mois, "MMMM yyyy", { locale: fr })}</p>
        <button onClick={() => setMois(m => addMonths(m, 1))} className="p-1.5 rounded-lg hover:opacity-70" style={{ background: "hsl(var(--muted))" }}><ChevronRight size={14} /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {["Lu", "Ma", "Me", "Je", "Ve", "Sa", "Di"].map(j => (
          <div key={j} className="text-center text-[10px] font-bold uppercase" style={{ color: "hsl(var(--muted-foreground))" }}>{j}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {grid.map((day, i) => {
          const inMonth = isSameMonth(day, mois);
          const today = isSameDay(day, new Date());
          const st = dayStatut(day);
          const we = isWeekend(day);
          return (
            <div key={i} className="aspect-square rounded-lg flex items-center justify-center text-[11px] font-medium relative"
              style={{
                background: st ? `${COL[st]}22` : we ? "hsl(var(--muted) / 0.4)" : "transparent",
                border: today ? "1.5px solid hsl(var(--primary))" : st ? `1px solid ${COL[st]}55` : "1px solid transparent",
                color: inMonth ? (st ? COL[st] : "hsl(var(--foreground))") : "hsl(var(--muted-foreground) / 0.4)",
                opacity: inMonth ? 1 : 0.5,
              }}
              title={st ? STATUT_BADGE[st].label : undefined}>
              {format(day, "d")}
              {st && <span className="absolute bottom-1 w-1 h-1 rounded-full" style={{ background: COL[st] }} />}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-4 mt-3 text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: COL.approuvee }} /> Approuvé</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: COL.en_attente }} /> En attente</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: "hsl(var(--muted))" }} /> Week-end</span>
      </div>
    </div>
  );
}

// ── Planning annuel des congés (vue 12 mois) ──────────────────────────────────
function PlanningAnnuel({ demandes }: { demandes: any[] }) {
  const [annee, setAnnee] = useState(() => new Date().getFullYear());
  const mois = useMemo(() => Array.from({ length: 12 }, (_, i) => new Date(annee, i, 1)), [annee]);

  const dayStatut = useCallback((day: Date): "approuvee" | "en_attente" | null => {
    let res: "approuvee" | "en_attente" | null = null;
    for (const d of demandes) {
      if (d.statut !== "approuvee" && d.statut !== "en_attente") continue;
      try {
        if (isWithinInterval(day, { start: parseISO(d.date_debut), end: parseISO(d.date_fin_absence) })) {
          if (d.statut === "approuvee") return "approuvee";
          res = "en_attente";
        }
      } catch { /* */ }
    }
    return res;
  }, [demandes]);

  const totaux = useMemo(() => {
    let approuve = 0, attente = 0;
    for (const d of demandes) {
      try {
        if (parseISO(d.date_debut).getFullYear() !== annee) continue;
        const j = Number(d.nbr_jours_decomptes) || 0;
        if (d.statut === "approuvee") approuve += j;
        else if (d.statut === "en_attente") attente += j;
      } catch { /* */ }
    }
    return { approuve, attente };
  }, [demandes, annee]);

  const COL = { approuvee: "hsl(142 55% 45%)", en_attente: "hsl(38 92% 50%)" } as const;

  return (
    <div>
      {/* Barre année + totaux */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setAnnee(a => a - 1)} className="p-1.5 rounded-lg hover:opacity-70" style={{ background: "hsl(var(--muted))" }}><ChevronLeft size={14} /></button>
          <p className="text-base font-bold w-16 text-center">{annee}</p>
          <button onClick={() => setAnnee(a => a + 1)} className="p-1.5 rounded-lg hover:opacity-70" style={{ background: "hsl(var(--muted))" }}><ChevronRight size={14} /></button>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5" style={{ color: COL.approuvee }}>
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: COL.approuvee }} /> {totaux.approuve} j approuvés
          </span>
          <span className="flex items-center gap-1.5" style={{ color: COL.en_attente }}>
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: COL.en_attente }} /> {totaux.attente} j en attente
          </span>
        </div>
      </div>

      {/* Grille des 12 mois */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {mois.map((m, mi) => {
          const start = startOfWeek(startOfMonth(m), { weekStartsOn: 1 });
          const end = endOfWeek(endOfMonth(m), { weekStartsOn: 1 });
          const grid = eachDayOfInterval({ start, end });
          return (
            <div key={mi} className="rounded-xl p-3" style={{ border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}>
              <p className="text-xs font-bold capitalize mb-2 text-center">{format(m, "MMMM", { locale: fr })}</p>
              <div className="grid grid-cols-7 gap-0.5 mb-0.5">
                {["L", "M", "M", "J", "V", "S", "D"].map((j, idx) => (
                  <div key={idx} className="text-center text-[9px] font-bold" style={{ color: "hsl(var(--muted-foreground))" }}>{j}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {grid.map((day, i) => {
                  const inMonth = isSameMonth(day, m);
                  const today = isSameDay(day, new Date());
                  const st = inMonth ? dayStatut(day) : null;
                  const we = isWeekend(day);
                  return (
                    <div key={i} className="aspect-square rounded flex items-center justify-center text-[9px] font-medium"
                      style={{
                        background: st ? `${COL[st]}22` : (inMonth && we ? "hsl(var(--muted) / 0.4)" : "transparent"),
                        border: today ? "1px solid hsl(var(--primary))" : st ? `1px solid ${COL[st]}55` : "1px solid transparent",
                        color: !inMonth ? "hsl(var(--muted-foreground) / 0.3)" : st ? COL[st] : "hsl(var(--foreground))",
                      }}
                      title={st ? STATUT_BADGE[st].label : undefined}>
                      {format(day, "d")}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Fiche de consultation d'un congé (lecture seule, tous les champs) ─────────
function ConsultationConge({ demande }: { demande: any }) {
  const d = demande;
  const demi = (v?: string) =>
    v === "AM" || v === "MATIN" ? "Matin" :
    v === "PM" || v === "APRESMIDI" || v === "APRES_MIDI" ? "Après-midi" :
    v === "JOURNEE" || v === "FULL" ? "Journée complète" : (v || "—");
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3">
        <InfoField label="Type de congé" value={d.libelle_type_conge || d.code_type_conge} />
        <InfoField label="Statut" value={<StatutBadge statut={d.statut} />} />
        <InfoField label="Date de début" value={d.date_debut ? fmt(d.date_debut, "dd MMM yyyy") : "—"} />
        <InfoField label="Date de fin" value={d.date_fin_absence ? fmt(d.date_fin_absence, "dd MMM yyyy") : "—"} />
        <InfoField label="Date de retour" value={d.date_retour ? fmt(d.date_retour, "dd MMM yyyy") : "—"} />
        <InfoField label="Demi-journée début" value={demi(d.debut_demi_journee)} />
        <InfoField label="Demi-journée fin" value={demi(d.fin_demi_journee)} />
        <InfoField label="Jours calendaires" value={d.nbr_jours_calendaires != null ? `${d.nbr_jours_calendaires} j` : "—"} />
        <InfoField label="Jours décomptés" value={d.nbr_jours_decomptes != null ? `${d.nbr_jours_decomptes} j` : "—"} />
        <InfoField label="Report de reliquat" value={d.est_report_reliquat ? "Oui" : "Non"} />
        <InfoField label="Reconduction n°" value={d.reconduction_numero != null ? String(d.reconduction_numero) : "—"} />
        <InfoField label="Reprise effective" value={d.date_reprise_effective ? fmt(d.date_reprise_effective, "dd MMM yyyy") : "—"} />
        <InfoField label="Date de soumission" value={d.date_soumission ? fmt(d.date_soumission, "dd/MM/yyyy HH:mm") : "—"} />
        <InfoField label="Date de validation" value={d.date_validation ? fmt(d.date_validation, "dd/MM/yyyy HH:mm") : "—"} />
        <InfoField label="Créée le" value={d.created_at ? fmt(d.created_at, "dd/MM/yyyy HH:mm") : "—"} />
      </div>

      {d.commentaire_collaborateur && (
        <div><InfoField label="Commentaire collaborateur" value={d.commentaire_collaborateur} /></div>
      )}
      {d.commentaire_gestionnaire && (
        <div><InfoField label="Commentaire gestionnaire" value={d.commentaire_gestionnaire} /></div>
      )}
      {d.motif_refus && (
        <div><InfoField label="Motif de refus" value={d.motif_refus} /></div>
      )}

      {d.piece_jointe_path && (
        <div className="flex items-center gap-2 p-2.5 rounded-lg" style={{ background: "hsl(var(--muted) / 0.4)", border: "1px solid hsl(var(--border))" }}>
          <FileText size={14} style={{ color: "hsl(var(--primary))" }} />
          <span className="text-xs flex-1 truncate" style={{ color: "hsl(var(--foreground))" }}>{String(d.piece_jointe_path).split(/[\\/]/).pop()}</span>
          <span className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>Pièce jointe</span>
        </div>
      )}
    </div>
  );
}

// ── Formulaire de demande (enrichi) ───────────────────────────────────────────
function MiniDemandeForm({ collabId, soldes, demandes, onClose, onSuccess }: {
  collabId: string; soldes: any[]; demandes: any[]; onClose: () => void; onSuccess: () => void;
}) {
  const [form, setForm] = useState({ code_type_conge: "", date_debut: "", date_fin_absence: "", motif: "" });
  const [decompteOuvres, setDecompteOuvres] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const { data: typesConge = [] } = useQuery<any[]>({
    queryKey: ["ref-type-conge-mini"],
    queryFn: async () => {
      const rows = (await api.get("/db/ref_type_conge?actif=eq.true&order=ordre")) || [];
      return [...rows].sort((a: any, b: any) => (a.ordre ?? 0) - (b.ordre ?? 0) || String(a.libelle ?? "").localeCompare(String(b.libelle ?? "")));
    },
    staleTime: 10 * 60 * 1000,
  });

  const soldeSel = soldes.find(s => s.code_type_conge === form.code_type_conge);
  const nbCal = joursCalendaires(form.date_debut, form.date_fin_absence);
  const nbOuv = joursOuvres(form.date_debut, form.date_fin_absence);
  const nbDecompte = decompteOuvres ? nbOuv : nbCal;

  // Détection de chevauchement avec une demande active
  const chevauchement = useMemo(() => {
    if (!form.date_debut || !form.date_fin_absence) return null;
    const d1 = parseISO(form.date_debut), d2 = parseISO(form.date_fin_absence);
    return demandes.find((d: any) => {
      if (d.statut !== "approuvee" && d.statut !== "en_attente") return false;
      try { return parseISO(d.date_debut) <= d2 && parseISO(d.date_fin_absence) >= d1; } catch { return false; }
    }) || null;
  }, [form.date_debut, form.date_fin_absence, demandes]);

  const setPreset = (jours: number) => {
    const debut = format(new Date(), "yyyy-MM-dd");
    const fin = format(addDays(new Date(), jours), "yyyy-MM-dd");
    setForm(f => ({ ...f, date_debut: debut, date_fin_absence: fin }));
  };

  const soldeInsuffisant = soldeSel && nbDecompte > (soldeSel.solde_restant ?? 0);

  const handleSubmit = async () => {
    if (!form.code_type_conge || !form.date_debut || !form.date_fin_absence || nbDecompte <= 0) return;
    setSubmitting(true);
    try {
      await api.post("/db/cong_demandes", {
        collaborateur_id: collabId, code_type_conge: form.code_type_conge,
        date_debut: form.date_debut, date_fin_absence: form.date_fin_absence,
        date_retour: form.date_fin_absence, statut: "en_attente",
        date_soumission: new Date().toISOString().split("T")[0],
        commentaire_collaborateur: form.motif || null,
        nbr_jours_calendaires: nbCal, nbr_jours_decomptes: nbDecompte,
      });
      toast({ title: "Demande soumise avec succès" });
      onSuccess();
    } catch (e: any) { toast({ title: "Erreur", description: e.message, variant: "destructive" }); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "hsl(var(--background) / 0.85)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-md rounded-2xl shadow-2xl overflow-hidden" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
          <div className="flex items-center gap-2"><Plus size={15} style={{ color: "hsl(var(--primary))" }} /><h2 className="text-sm font-bold">Nouvelle demande de congé</h2></div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:opacity-70" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}><X size={15} /></button>
        </div>
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div>
            <Label className="text-xs font-semibold mb-1.5 block">Type de congé *</Label>
            <select value={form.code_type_conge} onChange={e => setForm(f => ({ ...f, code_type_conge: e.target.value }))} className="w-full h-9 text-sm rounded-lg border px-3" style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
              <option value="">— Sélectionner —</option>
              {typesConge.map((t: any) => <option key={t.code} value={t.code}>{t.libelle}</option>)}
            </select>
            {soldeSel && (
              <div className="mt-1.5 flex items-center gap-2 text-[11px]">
                <span style={{ color: "hsl(var(--muted-foreground))" }}>Solde disponible :</span>
                <span className="font-bold" style={{ color: soldeSel.solde_restant > 0 ? "hsl(142 55% 35%)" : "hsl(0 70% 45%)" }}>{soldeSel.solde_restant}j</span>
                {soldeSel.solde_en_attente > 0 && <span style={{ color: "hsl(38 92% 40%)" }}>· {soldeSel.solde_en_attente}j en attente</span>}
              </div>
            )}
          </div>

          {/* Raccourcis */}
          <div className="flex flex-wrap gap-1.5">
            {[{ l: "Aujourd'hui", j: 0 }, { l: "+3 jours", j: 2 }, { l: "1 semaine", j: 6 }, { l: "2 semaines", j: 13 }].map(p => (
              <button key={p.l} onClick={() => setPreset(p.j)} className="text-[10px] px-2 py-1 rounded-md font-medium hover:opacity-70" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>{p.l}</button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs font-semibold mb-1.5 block">Date de début *</Label>
              <Input type="date" value={form.date_debut} min={format(new Date(), "yyyy-MM-dd")} onChange={e => setForm(f => ({ ...f, date_debut: e.target.value }))} className="h-9 text-sm" /></div>
            <div><Label className="text-xs font-semibold mb-1.5 block">Date de fin *</Label>
              <Input type="date" value={form.date_fin_absence} min={form.date_debut || format(new Date(), "yyyy-MM-dd")} onChange={e => setForm(f => ({ ...f, date_fin_absence: e.target.value }))} className="h-9 text-sm" /></div>
          </div>

          {/* Mode de décompte */}
          <div className="flex items-center justify-between p-2.5 rounded-lg" style={{ background: "hsl(var(--muted) / 0.3)", border: "1px solid hsl(var(--border))" }}>
            <span className="text-[11px] font-medium">Décompter les jours ouvrés (hors week-ends)</span>
            <button onClick={() => setDecompteOuvres(v => !v)} className="relative w-9 h-5 rounded-full transition-colors" style={{ background: decompteOuvres ? "hsl(var(--primary))" : "hsl(var(--muted-foreground) / 0.4)" }}>
              <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all" style={{ left: decompteOuvres ? "18px" : "2px" }} />
            </button>
          </div>

          {nbCal > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 p-2.5 rounded-lg" style={{ background: "hsl(var(--primary) / 0.07)", border: "1px solid hsl(var(--primary) / 0.2)" }}>
                <CalendarDays size={12} style={{ color: "hsl(var(--primary))" }} />
                <span className="text-xs font-medium" style={{ color: "hsl(var(--primary))" }}>
                  <strong>{nbDecompte}</strong> jour(s) décompté(s) · {nbCal} calendaire(s){decompteOuvres ? ` · ${nbCal - nbOuv} week-end(s)` : ""}
                </span>
              </div>
              {soldeInsuffisant && (
                <div className="flex items-center gap-2 p-2 rounded-lg text-[11px]" style={{ background: "hsl(0 70% 50% / 0.08)", color: "hsl(0 70% 42%)" }}>
                  <AlertTriangle size={12} /> Solde insuffisant ({soldeSel?.solde_restant}j disponibles).
                </div>
              )}
              {chevauchement && (
                <div className="flex items-center gap-2 p-2 rounded-lg text-[11px]" style={{ background: "hsl(38 92% 50% / 0.1)", color: "hsl(38 92% 35%)" }}>
                  <AlertTriangle size={12} /> Chevauchement avec une demande du {fmt(chevauchement.date_debut, "dd/MM")} au {fmt(chevauchement.date_fin_absence, "dd/MM")}.
                </div>
              )}
            </div>
          )}

          <div>
            <Label className="text-xs font-semibold mb-1.5 block">Motif (optionnel)</Label>
            <textarea value={form.motif} onChange={e => setForm(f => ({ ...f, motif: e.target.value }))} rows={2} className="w-full rounded-lg border px-3 py-2 text-sm resize-none outline-none" style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }} placeholder="Motif de la demande…" />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: "hsl(var(--border))" }}>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Annuler</Button>
          <Button onClick={handleSubmit} disabled={submitting || !form.code_type_conge || nbDecompte <= 0} style={{ background: "hsl(var(--primary))", color: "white" }}>
            <Send size={13} className="mr-1.5" />{submitting ? "Envoi…" : "Soumettre"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Modal demande d'attestation ───────────────────────────────────────────────
const TYPES_ATTESTATION = [
  "Attestation de travail",
  "Attestation de salaire",
  "Attestation de congé",
  "Bordereau de paie (duplicata)",
  "Certificat de travail",
];
function DemandeDocumentModal({ collab, rhEmail, onClose }: { collab: Collaborateur | null; rhEmail?: string; onClose: () => void }) {
  const [type, setType] = useState(TYPES_ATTESTATION[0]);
  const [note, setNote] = useState("");
  const message =
    `Bonjour,\n\nJe souhaite demander : ${type}.\n` +
    `Collaborateur : ${collab?.prenom ?? ""} ${collab?.nom ?? ""}${collab?.matricule ? ` (#${collab.matricule})` : ""}.` +
    (note ? `\nPrécisions : ${note}` : "") +
    `\n\nMerci d'avance.`;

  const copier = async () => { try { await navigator.clipboard.writeText(message); toast({ title: "Message copié" }); } catch { /* */ } };
  const mailto = `mailto:${rhEmail || ""}?subject=${encodeURIComponent("Demande de document RH")}&body=${encodeURIComponent(message)}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "hsl(var(--background) / 0.85)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-md rounded-2xl shadow-2xl overflow-hidden" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
          <div className="flex items-center gap-2"><FileText size={15} style={{ color: "hsl(var(--primary))" }} /><h2 className="text-sm font-bold">Demander un document</h2></div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:opacity-70" style={{ background: "hsl(var(--muted))" }}><X size={15} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <Label className="text-xs font-semibold mb-1.5 block">Type de document</Label>
            <select value={type} onChange={e => setType(e.target.value)} className="w-full h-9 text-sm rounded-lg border px-3" style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
              {TYPES_ATTESTATION.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs font-semibold mb-1.5 block">Précisions (optionnel)</Label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className="w-full rounded-lg border px-3 py-2 text-sm resize-none outline-none" style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }} placeholder="Ex : à destination de ma banque…" />
          </div>
          <div className="p-3 rounded-lg text-[11px] whitespace-pre-line" style={{ background: "hsl(var(--muted) / 0.4)", color: "hsl(var(--muted-foreground))" }}>{message}</div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: "hsl(var(--border))" }}>
          <Button variant="outline" onClick={copier}><Copy size={13} className="mr-1.5" />Copier</Button>
          <a href={mailto}><Button style={{ background: "hsl(var(--primary))", color: "white" }}><Mail size={13} className="mr-1.5" />Envoyer au RH</Button></a>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// RÉSOLUTION DES LIBELLÉS DE RÉFÉRENTIEL (joins JS manuels, le proxy ne fait pas de join)
// ══════════════════════════════════════════════════════════════════════════════
// Cache module-level : les référentiels sont quasi statiques, inutile de recharger.
const _refCache: Record<string, Record<string, string>> = {};
const _refPromise: Record<string, Promise<Record<string, string>>> = {};

/** Charge une map { code -> libellé } depuis une table de référentiel (best-effort, guardé).
 *  Pas de select=* (interdit par le proxy) : on récupère toutes les colonnes par défaut. */
async function loadRefMap(table: string, codeCol = "code", labelCols = ["libelle", "intitule", "nom", "designation", "libelle_fr", "nom_fr"]): Promise<Record<string, string>> {
  if (_refCache[table]) return _refCache[table];
  if (_refPromise[table]) return _refPromise[table];
  _refPromise[table] = (async () => {
    try {
      const rows: any[] = await api.get(`/db/${table}`) || [];
      const m: Record<string, string> = {};
      rows.forEach((r: any) => {
        const code = r[codeCol];
        if (code == null) return;
        const label = labelCols.map(c => r[c]).find(v => v != null && v !== "");
        m[String(code)] = label != null ? String(label) : String(code);
      });
      _refCache[table] = m;
      return m;
    } catch { return {}; }
  })();
  return _refPromise[table];
}

/** Map des libellés de types de congé (sûr : ref_type_conge possède code + libelle). */
async function refTypeCongeMap(): Promise<Record<string, string>> {
  if (_refCache["ref_type_conge"]) return _refCache["ref_type_conge"];
  if (_refPromise["ref_type_conge"]) return _refPromise["ref_type_conge"];
  _refPromise["ref_type_conge"] = (async () => {
    try {
      const rows: any[] = await api.get(`/db/ref_type_conge?select=code,libelle`) || [];
      const m: Record<string, string> = {};
      rows.forEach((r: any) => { if (r.code != null) m[String(r.code)] = r.libelle || String(r.code); });
      _refCache["ref_type_conge"] = m;
      return m;
    } catch { return {}; }
  })();
  return _refPromise["ref_type_conge"];
}

/** Essaie plusieurs noms de table candidats, retourne la première map non vide. */
async function loadRefMapAny(tables: string[]): Promise<Record<string, string>> {
  for (const t of tables) {
    const m = await loadRefMap(t);
    if (Object.keys(m).length) return m;
  }
  return {};
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPOSANT PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
export default function MonEspacePage() {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { density, setDensity, lastTab, persistTab } = useUiPrefs();
  const [activeTab, setActiveTabState] = useState(lastTab);
  const setActiveTab = (t: string) => { setActiveTabState(t); persistTab(t); };
  const [showDemandeForm, setShowDemandeForm] = useState(false);
  const [showDocModal, setShowDocModal] = useState(false);
  const [filterDemande, setFilterDemande] = useState("TOUS");
  // Filtres avancés « Mes demandes » (collaborateur)
  const [demRecherche, setDemRecherche] = useState("");
  const [demShowFiltres, setDemShowFiltres] = useState(false);
  const [demFType, setDemFType] = useState("");
  const [demFEtape, setDemFEtape] = useState("");
  const [demFDebut, setDemFDebut] = useState("");
  const [demFFin, setDemFFin] = useState("");
  const [demFRef, setDemFRef] = useState("");
  const demNbFiltres = [demFType, demFEtape, demFDebut, demFFin, demFRef].filter(Boolean).length;
  const demResetFiltres = () => { setDemFType(""); setDemFEtape(""); setDemFDebut(""); setDemFFin(""); setDemFRef(""); };
  const demSetMois = (ym: string) => {
    if (!ym) { setDemFDebut(""); setDemFFin(""); return; }
    const [y, m] = ym.split("-").map(Number);
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setDemFDebut(iso(new Date(y, m - 1, 1))); setDemFFin(iso(new Date(y, m, 0)));
  };
  const demRaccourci = (type: "ce_mois" | "mois_prochain" | "cette_annee") => {
    const now = new Date();
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (type === "ce_mois") { setDemFDebut(iso(new Date(now.getFullYear(), now.getMonth(), 1))); setDemFFin(iso(new Date(now.getFullYear(), now.getMonth() + 1, 0))); }
    else if (type === "mois_prochain") { setDemFDebut(iso(new Date(now.getFullYear(), now.getMonth() + 1, 1))); setDemFFin(iso(new Date(now.getFullYear(), now.getMonth() + 2, 0))); }
    else { setDemFDebut(iso(new Date(now.getFullYear(), 0, 1))); setDemFFin(iso(new Date(now.getFullYear(), 11, 31))); }
  };
  const demMoisValue = useMemo(() => {
    if (!demFDebut || !demFFin) return "";
    const d = new Date(demFDebut), f = new Date(demFFin);
    const dj = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    if (d.getDate() === 1 && f.getDate() === dj && d.getMonth() === f.getMonth() && d.getFullYear() === f.getFullYear())
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return "";
  }, [demFDebut, demFFin]);
  const demPeriodeMatch = (dDebut?: string | null, dFin?: string | null) => {
    if (!demFDebut && !demFFin) return true;
    const dd = dDebut ? new Date(dDebut) : null;
    const df = dFin ? new Date(dFin) : dd;
    if (!dd) return false;
    if (demFDebut && df && df < new Date(demFDebut)) return false;
    if (demFFin && dd > new Date(demFFin)) return false;
    return true;
  };
  const [congesView, setCongesView] = useState<"liste" | "calendrier">("liste");
  const [congeFiltreType, setCongeFiltreType] = useState("TOUS");
  const [congeFiltreExercice, setCongeFiltreExercice] = useState("TOUS");
  const [congeFiltreDebut, setCongeFiltreDebut] = useState("");
  const [congeFiltreFin, setCongeFiltreFin] = useState("");
  const [showCongeFiltres, setShowCongeFiltres] = useState(false);
  const [expandedDemandeId, setExpandedDemandeId] = useState<string | null>(null);
  const [notifFilter, setNotifFilter] = useState<"TOUTES" | "NON_LUES">("TOUTES");
  const [search, setSearch] = useState("");
  const exercice = new Date().getFullYear();

  // ── Rôles ───────────────────────────────────────────────────────────────
  const userRoles: AppRole[] = useMemo(() => {
    const r = (profile as any)?.roles ?? (user as any)?.roles ?? [];
    return Array.isArray(r) && r.length > 0 ? r : ["collaborateur"];
  }, [profile, user]);

  const [activeRole, setActiveRole] = useState<AppRole>(() =>
    userRoles.includes("collaborateur") ? "collaborateur" : (userRoles[0] ?? "collaborateur"));

  const tabs = TABS_BY_ROLE[activeRole] ?? TABS_BY_ROLE.default;
  const handleRoleSwitch = useCallback((role: AppRole) => { setActiveRole(role); setActiveTab("accueil"); }, []);

  // ── Résolution collaborateur ──────────────────────────────────────────────
  const collabIdFromAuth = (profile as any)?.collaborateur_id ?? (user as any)?.collaborateur_id ?? null;
  const { data: profileData } = useQuery<any>({
    queryKey: ["mon-profile", user?.id], enabled: !!user?.id && !collabIdFromAuth, staleTime: 10 * 60 * 1000,
    queryFn: async () => { try { const r: any[] = await api.get(`/db/profiles?user_id=eq.${user!.id}&limit=1`); return r?.[0] ?? null; } catch { return null; } },
  });
  const collabIdResolved = collabIdFromAuth ?? profileData?.collaborateur_id ?? null;
  const { data: collab } = useQuery<Collaborateur | null>({
    queryKey: ["mon-collab", collabIdResolved], enabled: !!collabIdResolved, staleTime: 5 * 60 * 1000,
    queryFn: async () => { const r: any[] = await api.get(`/db/collaborateurs?id=eq.${collabIdResolved}&limit=1`); return r?.[0] ?? null; },
  });
  const collabId = collabIdResolved ?? collab?.id ?? null;

  // ── Données ───────────────────────────────────────────────────────────────
  const { data: contrat } = useQuery<any>({
    queryKey: ["mon-contrat", collabId], enabled: !!collabId, staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const r: any[] = await api.get(`/db/collaborateur_contrats?collaborateur_id=eq.${collabId}&archive=eq.false&order=date_debut.desc&limit=1`) || [];
      const ct = r?.[0] ?? null;
      if (ct?.code_type_contrat) { try { const t: any[] = await api.get(`/db/ref_type_contrat?code=eq.${ct.code_type_contrat}&select=code,libelle&limit=1`); if (t?.[0]) { ct.libelle_type_contrat = t[0].libelle; ct.couleur = t[0].couleur; } } catch { /* */ } }
      return ct;
    },
  });

  const { data: affectation } = useQuery<any>({
    queryKey: ["mon-affectation", collabId], enabled: !!collabId, staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const today = new Date().toISOString().split("T")[0];
      const r: any[] = await api.get(`/db/collaborateur_affectations?collaborateur_id=eq.${collabId}&archive=eq.false&order=date_debut_uo.desc&limit=1`) || [];
      const aff = r?.[0] ?? null;
      if (!aff || (aff.date_fin_uo && aff.date_fin_uo < today)) return null;
      if (aff.unite_id) { try { const u: any[] = await api.get(`/db/unites_organisationnelles?id=eq.${aff.unite_id}&limit=1`); if (u?.[0]) { aff.libelle_uo = u[0].libelle || u[0].intitule || u[0].nom; aff.couleur_uo = u[0].couleur; aff.uo_responsable_id = u[0].responsable_id || null; aff.uo_parent_id = u[0].parent_id || null; } } catch { /* */ } }
      if (aff.code_poste) { try { const p: any[] = await api.get(`/db/ref_poste?code=eq.${String(aff.code_poste).split("-")[0]}&limit=1`); if (p?.[0]) { aff.libelle_poste = p[0].libelle || p[0].intitule; } } catch { /* */ } }
      return aff;
    },
  });

  // Hiérarchie managériale : N+1 et N+2.
  //  • Mode STATIQUE  : si forcage_manager est activé sur l'affectation → on prend manager_n1_id / manager_n2_id saisis.
  //  • Mode DYNAMIQUE : sinon, on remonte la chaîne d'UO (parent_id) et on collecte les responsables distincts
  //    différents du collaborateur lui-même. 1er = N+1, 2e = N+2.
  //    → gère le cas « le collaborateur est responsable de sa propre UO » : on saute son propre id et on prend
  //      le responsable de l'UO parente.
  const { data: managers } = useQuery<{ n1: any; n2: any; source: "statique" | "dynamique"; vacances: { uo: string; poste: string | null }[] } | null>({
    queryKey: ["mes-managers", collabId, affectation?.id], enabled: !!collabId && !!affectation, staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      if (!affectation) return null;
      let n1Id: string | null = null, n2Id: string | null = null;
      let source: "statique" | "dynamique" = "dynamique";
      const vacances: { uo: string; poste: string | null }[] = [];

      if (affectation.forcage_manager && (affectation.manager_n1_id || affectation.manager_n2_id)) {
        source = "statique";
        n1Id = affectation.manager_n1_id || null;
        n2Id = affectation.manager_n2_id || null;
      } else {
        const resp: string[] = [];
        let uoId: string | null = affectation.unite_id || null;
        let guard = 0;
        while (uoId && guard < 12) {
          guard++;
          let uo: any = null;
          try {
            const u: any[] = await api.get(`/db/unites_organisationnelles?id=eq.${uoId}&select=id,parent_id,responsable_id,poste_responsable_code,libelle&limit=1`);
            uo = u?.[0] || null;
          } catch { uo = null; }
          if (!uo) break;
          const r = uo.responsable_id || null;
          if (r && r !== collabId && r !== resp[resp.length - 1]) {
            resp.push(r);
          } else if (!r && uo.poste_responsable_code && resp.length === 0) {
            // Poste de responsable défini mais sans titulaire => vacant. On le signale et on remonte plus haut.
            vacances.push({ uo: uo.libelle || uo.code || "Unité", poste: uo.poste_responsable_code || null });
          }
          if (resp.length >= 2) break;
          uoId = uo.parent_id || null;
        }
        n1Id = resp[0] || null;
        n2Id = resp[1] || null;
      }

      // Résolution best-effort des libellés de postes vacants via ref_poste
      if (vacances.length) {
        try {
          const posteMap = await loadRefMap("ref_poste");
          vacances.forEach(v => { if (v.poste && posteMap[v.poste]) v.poste = posteMap[v.poste]; });
        } catch { /* on garde le code */ }
      }

      const fetchCollab = async (id: string | null) => {
        if (!id) return null;
        try { const r: any[] = await api.get(`/db/collaborateurs?id=eq.${id}&limit=1`); return r?.[0] ?? null; } catch { return null; }
      };
      const [n1, n2] = await Promise.all([fetchCollab(n1Id), fetchCollab(n2Id)]);
      return { n1, n2, source, vacances };
    },
  });

  const { data: soldes = [] } = useQuery<any[]>({
    queryKey: ["mes-soldes", collabId, exercice], enabled: !!collabId, staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const rows: any[] = await api.get(`/db/cong_solde?collaborateur_id=eq.${collabId}&exercice=eq.${exercice}&archive=eq.false`) || [];
      const map = await refTypeCongeMap();
      return rows.map(r => ({ ...r, libelle_type_conge: map[r.code_type_conge] || r.libelle_type_conge || r.code_type_conge }));
    },
  });

  const { data: demandes = [], refetch: refetchDemandes } = useQuery<any[]>({
    queryKey: ["mes-demandes", collabId], enabled: !!collabId, staleTime: 1 * 60 * 1000,
    queryFn: async () => {
      const rows: any[] = await api.get(`/db/cong_demandes?collaborateur_id=eq.${collabId}&archive=eq.false&order=created_at.desc`) || [];
      const map = await refTypeCongeMap();
      // Normalise le statut en minuscule (tolère les données legacy en majuscules : APPROUVEE/REFUSEE…) + résout le libellé du type
      return rows.map(r => ({ ...r, statut: (r.statut ?? "").toLowerCase(), libelle_type_conge: map[r.code_type_conge] || r.libelle_type_conge || r.code_type_conge }));
    },
  });

  // Registre unifié des demandes (tous types) — alimente l'onglet « Mes demandes »
  const { data: registreDemandes = [], refetch: refetchRegistre } = useQuery<any[]>({
    queryKey: ["mes-demandes-registre", collabId], enabled: !!collabId, staleTime: 1 * 60 * 1000,
    queryFn: async () => (await api.get(`/demandes/mes/${collabId}`)) || [],
  });

  const { data: notifications = [] } = useQuery<any[]>({
    queryKey: ["mes-notifications", collabId], enabled: !!collabId, staleTime: 1 * 60 * 1000,
    queryFn: async () => await api.get(`/db/notifications?collaborateur_id=eq.${collabId}&order=created_at.desc&limit=30`).catch(() => []) || [],
  });

  const { data: histAffectations = [] } = useQuery<any[]>({
    queryKey: ["mes-affectations-hist", collabId], enabled: !!collabId, staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const rows: any[] = await api.get(`/db/collaborateur_affectations?collaborateur_id=eq.${collabId}&archive=eq.false&order=date_debut_uo.desc`) || [];
      if (!rows.length) return [];
      const uniteIds = [...new Set(rows.map((r: any) => r.unite_id).filter(Boolean))];
      const uoMap: Record<string, any> = {};
      if (uniteIds.length) { try { const u: any[] = await api.get(`/db/unites_organisationnelles?id=in.(${uniteIds.join(",")})&select=id,libelle`) || []; u.forEach((x: any) => { uoMap[x.id] = x; }); } catch { /* */ } }
      const posteCodes = [...new Set(rows.map((r: any) => r.code_poste ? String(r.code_poste).split("-")[0] : null).filter(Boolean))];
      const posteMap: Record<string, any> = {};
      if (posteCodes.length) { try { const p: any[] = await api.get(`/db/ref_poste?code=in.(${posteCodes.join(",")})&select=code,libelle`) || []; p.forEach((x: any) => { posteMap[x.code] = x; }); } catch { /* */ } }
      return rows.map((r: any) => {
        const uo = r.unite_id ? uoMap[r.unite_id] : null;
        const pc = r.code_poste ? String(r.code_poste).split("-")[0] : null;
        return { ...r, libelle_uo: uo?.libelle || uo?.intitule || uo?.nom || null, couleur_uo: uo?.couleur || null, libelle_poste: pc ? posteMap[pc]?.libelle : null };
      });
    },
  });

  const { data: classification = [] } = useQuery<any[]>({
    queryKey: ["ma-classification", collabId], enabled: !!collabId, staleTime: 5 * 60 * 1000,
    queryFn: async () => await api.get(`/db/collaborateur_classification?collaborateur_id=eq.${collabId}&archive=eq.false&order=date_debut.desc`).catch(() => []) || [],
  });

  // Référentiels divers pour résoudre les codes en libellés (ref_nationalite → « Marocaine », ref_pays → « Maroc »)
  const { data: refMaps = { nationalite: {}, pays: {}, situationFam: {}, statutContrat: {} } } = useQuery<{ nationalite: Record<string, string>; pays: Record<string, string>; situationFam: Record<string, string>; statutContrat: Record<string, string> }>({
    queryKey: ["ref-divers-monespace"], staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const [nationalite, pays, situationFam, statutContrat] = await Promise.all([
        loadRefMapAny(["ref_nationalite"]),
        loadRefMapAny(["ref_pays"]),
        loadRefMapAny(["ref_situation_familiale", "ref_situations_familiales", "ref_situation_famille"]),
        loadRefMapAny(["ref_statut_contrat", "ref_statuts_contrat", "ref_code_statut_contrat"]),
      ]);
      return { nationalite, pays, situationFam, statutContrat };
    },
  });
  const refLabel = (map: Record<string, string>, code?: string | null) => (code ? (map?.[code] || code) : null);

  // ── Sous-onglet Mon dossier ───────────────────────────────────────────────
  const [dossierTab, setDossierTab] = useState("identite");

  const { data: adresses = [] } = useQuery<any[]>({
    queryKey: ["mes-adresses", collabId], enabled: !!collabId, staleTime: 5 * 60 * 1000,
    queryFn: async () => await api.get(`/db/collaborateur_adresses?collaborateur_id=eq.${collabId}&archive=eq.false`).catch(() => []) || [],
  });
  const { data: famille } = useQuery<any>({
    queryKey: ["ma-famille", collabId], enabled: !!collabId, staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [conjoints, enfants] = await Promise.all([
        api.get(`/db/collaborateur_conjoints?collaborateur_id=eq.${collabId}&archive=eq.false`).catch(() => []),
        api.get(`/db/collaborateur_enfants?collaborateur_id=eq.${collabId}&archive=eq.false&order=date_naissance`).catch(() => []),
      ]);
      return { conjoints: conjoints || [], enfants: enfants || [] };
    },
  });
  const { data: immatriculations = [] } = useQuery<any[]>({
    queryKey: ["mes-immat", collabId], enabled: !!collabId, staleTime: 5 * 60 * 1000,
    queryFn: async () => await api.get(`/db/collaborateur_regime?collaborateur_id=eq.${collabId}`).catch(() => []) || [],
  });
  const { data: remuneration } = useQuery<any>({
    queryKey: ["ma-remuneration", collabId], enabled: !!collabId, staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [salaires, avantages, banque] = await Promise.all([
        api.get(`/db/collaborateur_salaire_fixe?collaborateur_id=eq.${collabId}&archive=eq.false&order=date_debut.desc`).catch(() => []),
        api.get(`/db/collaborateur_avantage?collaborateur_id=eq.${collabId}&archive=eq.false`).catch(() => []),
        api.get(`/db/collaborateur_paiement?collaborateur_id=eq.${collabId}&archive=eq.false`).catch(() => []),
      ]);
      return { salaires: salaires || [], avantages: avantages || [], banque: banque || [] };
    },
  });
  const { data: formation } = useQuery<any>({
    queryKey: ["ma-formation", collabId], enabled: !!collabId, staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [diplomes, competences] = await Promise.all([
        api.get(`/db/collaborateur_diplome?collaborateur_id=eq.${collabId}&archive=eq.false&order=annee.desc`).catch(() => []),
        api.get(`/db/collaborateur_competence?collaborateur_id=eq.${collabId}&archive=eq.false`).catch(() => []),
      ]);
      return { diplomes: diplomes || [], competences: competences || [] };
    },
  });
  const { data: syndical = [] } = useQuery<any[]>({
    queryKey: ["mon-syndical", collabId], enabled: !!collabId, staleTime: 5 * 60 * 1000,
    queryFn: async () => await api.get(`/db/collaborateur_mandat_syndical?collaborateur_id=eq.${collabId}&archive=eq.false&order=date_debut.desc`).catch(() => []) || [],
  });
  const { data: divers } = useQuery<any>({
    queryKey: ["mon-divers", collabId], enabled: !!collabId, staleTime: 5 * 60 * 1000,
    queryFn: async () => { const r: any[] = await api.get(`/db/collaborateurs?id=eq.${collabId}&limit=1`).catch(() => []) || []; return r[0] ?? null; },
  });
  const { data: documents = [] } = useQuery<any[]>({
    queryKey: ["mes-documents", collabId], enabled: !!collabId, staleTime: 5 * 60 * 1000,
    queryFn: async () => await api.get(`/db/collaborateur_document?collaborateur_id=eq.${collabId}&archive=eq.false&order=created_at.desc`).catch(() => []) || [],
  });
  const { data: taches = [] } = useQuery<any[]>({
    queryKey: ["mes-taches", collabId], enabled: !!collabId, staleTime: 2 * 60 * 1000,
    queryFn: async () => await api.get(`/db/taches?collaborateur_id=eq.${collabId}&statut=neq.TERMINEE&archive=eq.false&order=date_echeance`).catch(() => []) || [],
  });

  // ── Computed ──────────────────────────────────────────────────────────────
  const nonLues = notifications.filter((n: any) => !n.lu).length;
  const demandesEnAttente = demandes.filter((d: any) => d.statut === "en_attente").length;
  const soldeTotal = soldes.reduce((acc: number, s: any) => acc + (s.solde_restant ?? 0), 0);
  const demandesFiltrees = useMemo(() => filterDemande === "TOUS" ? demandes : demandes.filter((d: any) => d.statut === filterDemande), [demandes, filterDemande]);
  const congesValides = useMemo(() => demandes.filter((d: any) => d.statut === "approuvee"), [demandes]);

  // Options de filtres (types + exercices présents dans les congés validés)
  const congeTypeOptions = useMemo(() => {
    const m = new Map<string, string>();
    congesValides.forEach((d: any) => m.set(d.code_type_conge, d.libelle_type_conge || d.code_type_conge));
    return Array.from(m, ([code, libelle]) => ({ code, libelle }));
  }, [congesValides]);
  const congeExerciceOptions = useMemo(() => {
    const s = new Set<number>();
    congesValides.forEach((d: any) => { try { s.add(parseISO(d.date_debut).getFullYear()); } catch { /* */ } });
    return Array.from(s).sort((a, b) => b - a);
  }, [congesValides]);

  // Congés validés après application des filtres (type / exercice / période)
  const congesValidesFiltres = useMemo(() => {
    return congesValides.filter((d: any) => {
      if (congeFiltreType !== "TOUS" && d.code_type_conge !== congeFiltreType) return false;
      let an: number | null = null;
      try { an = parseISO(d.date_debut).getFullYear(); } catch { /* */ }
      if (congeFiltreExercice !== "TOUS" && String(an) !== congeFiltreExercice) return false;
      // Chevauchement avec la période [début, fin] si renseignée
      if (congeFiltreDebut && d.date_fin_absence && d.date_fin_absence < congeFiltreDebut) return false;
      if (congeFiltreFin && d.date_debut && d.date_debut > congeFiltreFin) return false;
      return true;
    });
  }, [congesValides, congeFiltreType, congeFiltreExercice, congeFiltreDebut, congeFiltreFin]);

  const nbCongeFiltresActifs = (congeFiltreType !== "TOUS" ? 1 : 0) + (congeFiltreExercice !== "TOUS" ? 1 : 0) + ((congeFiltreDebut || congeFiltreFin) ? 1 : 0);
  const resetCongeFiltres = () => { setCongeFiltreType("TOUS"); setCongeFiltreExercice("TOUS"); setCongeFiltreDebut(""); setCongeFiltreFin(""); };
  const congesAVenir = useMemo(() => demandes.filter((d: any) => d.statut === "approuvee" && isAfter(parseISO(d.date_debut), new Date()) && isBefore(parseISO(d.date_debut), addDays(new Date(), 60))).sort((a: any, b: any) => a.date_debut.localeCompare(b.date_debut)), [demandes]);
  const statsAnnee = useMemo(() => {
    const a = demandes.filter((d: any) => d.date_soumission?.startsWith(String(exercice)));
    return { total: a.length, approuvees: a.filter((d: any) => d.statut === "approuvee").length, refusees: a.filter((d: any) => d.statut === "refusee").length, joursApprouves: a.filter((d: any) => d.statut === "approuvee").reduce((acc: number, d: any) => acc + (d.nbr_jours_decomptes || 0), 0) };
  }, [demandes, exercice]);

  // Feed d'activité récente (dérivé)
  const activite = useMemo(() => {
    const items: { date: string; titre: string; statut?: string; type: "demande" | "notif" }[] = [];
    demandes.slice(0, 8).forEach((d: any) => items.push({ date: d.created_at || d.date_soumission, titre: `${d.libelle_type_conge || d.code_type_conge} · ${fmt(d.date_debut, "dd/MM")}→${fmt(d.date_fin_absence, "dd/MM")}`, statut: d.statut, type: "demande" }));
    notifications.slice(0, 6).forEach((n: any) => items.push({ date: n.created_at, titre: n.titre, type: "notif" }));
    return items.filter(i => i.date).sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 6);
  }, [demandes, notifications]);

  // Anniversaire
  const anniversaireAujourdhui = useMemo(() => {
    if (!collab?.date_naissance) return false;
    const d = parseISO(collab.date_naissance), now = new Date();
    return d.getDate() === now.getDate() && d.getMonth() === now.getMonth();
  }, [collab]);

  // Index de recherche transversale (dossier)
  const searchIndex = useMemo(() => {
    if (!collab) return [];
    const idx: { label: string; value: string; section: string }[] = [];
    const push = (label: string, value: any, section: string) => { if (value != null && value !== "") idx.push({ label, value: String(value), section }); };
    push("Matricule", collab.matricule, "Identité"); push("Nom", collab.nom, "Identité"); push("Prénom", collab.prenom, "Identité");
    push("Date de naissance", collab.date_naissance, "Identité"); push("Lieu de naissance", collab.lieu_naissance, "Identité");
    push("CIN", collab.cin, "Identité"); push("Passeport", collab.passeport, "Identité"); push("Identifiant fiscal", collab.num_fiscal, "Identité");
    push("Téléphone", collab.telephone, "Coordonnées"); push("GSM", collab.gsm, "Coordonnées");
    push("Email pro", collab.email_professionnel, "Coordonnées"); push("Email perso", collab.email_personnel, "Coordonnées");
    push("Type contrat", contrat?.libelle_type_contrat || contrat?.code_type_contrat, "Contrat");
    push("N° CNSS", divers?.num_cnss, "Divers"); push("N° CIMR", divers?.num_cimr, "Divers"); push("N° AMO", divers?.num_amo, "Divers");
    push("Mutuelle", divers?.code_mutuelle, "Divers"); push("Groupe sanguin", divers?.groupe_sanguin, "Divers");
    adresses.forEach((a: any) => push(a.type_adresse || "Adresse", `${a.adresse1 || ""} ${a.ville || ""} ${a.code_postal || ""}`.trim(), "Adresses"));
    (famille?.enfants || []).forEach((e: any) => push("Enfant", `${e.prenom || ""} ${e.nom || ""}`.trim(), "Famille"));
    return idx;
  }, [collab, contrat, divers, adresses, famille]);

  const searchResults = useMemo(() => {
    const q = normTxt(search.trim());
    if (q.length < 2) return [];
    return searchIndex.filter(i => normTxt(i.label).includes(q) || normTxt(i.value).includes(q));
  }, [search, searchIndex]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const marquerLu = async (id: string) => { try { await api.patch(`/db/notifications?id=eq.${id}`, { lu: true }); qc.invalidateQueries({ queryKey: ["mes-notifications"] }); } catch { /* */ } };
  const marquerToutLu = async () => { if (!collabId) return; try { await api.patch(`/db/notifications?collaborateur_id=eq.${collabId}&lu=eq.false`, { lu: true }); qc.invalidateQueries({ queryKey: ["mes-notifications"] }); } catch { /* */ } };
  const annulerDemande = async (id: string, table: string = "cong_demandes") => {
    if (!window.confirm("Annuler cette demande ?")) return;
    try {
      await api.patch(`/db/${table}?id=eq.${id}`, { statut: "annulee" });
      toast({ title: "Demande annulée" });
      refetchDemandes(); refetchRegistre();
      qc.invalidateQueries({ queryKey: ["mes-soldes"] });
    }
    catch (e: any) { toast({ title: "Erreur", description: e.message, variant: "destructive" }); }
  };

  const nomComplet = collab
    ? `${collab.civilite ? collab.civilite + " " : ""}${collab.prenom} ${collab.nom}`
    : (profile as any) ? `${(profile as any).prenom ?? ""} ${(profile as any).nom ?? ""}` : "Collaborateur";

  // Notifications groupées
  const notifsAffichees = notifFilter === "NON_LUES" ? notifications.filter((n: any) => !n.lu) : notifications;
  const groupeNotif = (d?: string): string => {
    if (!d) return "Plus ancien";
    const dt = parseISO(d), now = new Date();
    if (isSameDay(dt, now)) return "Aujourd'hui";
    if (isAfter(dt, addDays(now, -7))) return "Cette semaine";
    return "Plus ancien";
  };
  const notifGroups = useMemo(() => {
    const g: Record<string, any[]> = { "Aujourd'hui": [], "Cette semaine": [], "Plus ancien": [] };
    notifsAffichees.forEach((n: any) => g[groupeNotif(n.created_at)].push(n));
    return g;
  }, [notifsAffichees]);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <DensityCtx.Provider value={density}>
      <div className="min-h-screen" style={{ background: "hsl(var(--background))" }}>

        {/* ── Header ── */}
        <div className="relative overflow-hidden print:hidden" style={{ background: "linear-gradient(135deg, hsl(220 60% 18%) 0%, hsl(220 50% 28%) 60%, hsl(200 55% 32%) 100%)" }}>
          <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(circle at 20% 50%, white 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
          <div className="absolute top-0 right-0 w-64 h-64 rounded-full opacity-10" style={{ background: "hsl(200 80% 60%)", transform: "translate(30%, -30%)", filter: "blur(40px)" }} />

          <div className="relative px-6 pt-5 pb-0">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-4 flex-1 min-w-0">
                <ProfileSwitcher roles={userRoles} activeRole={activeRole} onSwitch={handleRoleSwitch} collab={collab ?? null} />
                <div className="flex flex-col gap-1.5 pt-2 flex-1 min-w-0">
                  {collab?.matricule && <span className="text-[11px] font-mono px-2 py-0.5 rounded-md w-fit" style={{ background: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.75)" }}>#{collab.matricule}</span>}
                  <div className="flex flex-wrap items-center gap-3">
                    {affectation?.libelle_uo && <span className="text-[11px] flex items-center gap-1" style={{ color: affectation.couleur_uo || "rgba(255,255,255,0.7)" }}><Building2 size={10} />{affectation.libelle_uo}</span>}
                    {affectation?.libelle_poste && <span className="text-[11px] text-white/60 flex items-center gap-1"><Briefcase size={10} />{affectation.libelle_poste}</span>}
                    {contrat?.date_debut && <span className="text-[11px] text-white/55 flex items-center gap-1"><Award size={10} /><AncienneteText dateDebut={contrat.date_debut} /> d'ancienneté</span>}
                    {anniversaireAujourdhui && <span className="text-[11px] flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold" style={{ background: "hsl(38 92% 50% / 0.2)", color: "hsl(38 92% 75%)" }}><Cake size={10} /> Joyeux anniversaire !</span>}
                  </div>
                </div>
              </div>

              {/* KPIs + densité */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {[
                  { label: "Solde congés", value: `${soldeTotal}j`, color: "hsl(142 55% 65%)", tab: "conges" },
                  { label: "En attente",   value: demandesEnAttente, color: "hsl(38 92% 65%)", tab: "conges" },
                  { label: "Notifs",       value: nonLues, color: nonLues > 0 ? "hsl(0 70% 65%)" : "hsl(200 60% 65%)", tab: "notifications" },
                ].map(k => (
                  <button key={k.label} onClick={() => setActiveTab(k.tab)} className="flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all hover:scale-105" style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)" }}>
                    <span className="text-base font-bold text-white leading-none">{k.value}</span>
                    <span className="text-[9px] text-white/60 leading-none">{k.label}</span>
                  </button>
                ))}
                <button onClick={() => setDensity(density === "confort" ? "compact" : "confort")} title="Densité d'affichage" className="p-2 rounded-xl transition-all hover:scale-105" style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)", color: "white" }}>
                  {density === "confort" ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </button>
              </div>
            </div>

            {/* Onglets */}
            <div className="flex gap-0 mt-5 -mx-6 px-6 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
              {tabs.map(tab => {
                const isActive = activeTab === tab.id;
                const hasBadge = tab.id === "notifications" && nonLues > 0;
                return (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)} className="relative flex items-center gap-1.5 px-4 py-3 text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0" style={{ color: isActive ? "white" : "rgba(255,255,255,0.55)", borderBottom: isActive ? "2px solid white" : "2px solid transparent", background: isActive ? "rgba(255,255,255,0.08)" : "transparent" }}>
                    <tab.icon size={13} />{tab.label}
                    {hasBadge && <span className="w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center" style={{ background: "hsl(0 70% 50%)", color: "white" }}>{nonLues}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Contenu ── */}
        <div className="px-6 py-6 max-w-5xl mx-auto space-y-5">

          {activeRole !== "collaborateur" && (
            <div className="flex items-center gap-3 p-3.5 rounded-xl print:hidden" style={{ background: ROLE_CFG[activeRole].bg, border: `1px solid ${ROLE_CFG[activeRole].border}` }}>
              <span style={{ color: ROLE_CFG[activeRole].color }}>{ROLE_CFG[activeRole].icon}</span>
              <div className="flex-1">
                <p className="text-xs font-semibold" style={{ color: ROLE_CFG[activeRole].color }}>Vous consultez votre espace en tant que <strong>{ROLE_CFG[activeRole].label}</strong></p>
                <p className="text-[11px] mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{ROLE_CFG[activeRole].description}</p>
              </div>
              {ROLE_CFG[activeRole].redirectPath && (
                <button onClick={() => navigate(ROLE_CFG[activeRole].redirectPath!)} className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg hover:opacity-80" style={{ background: ROLE_CFG[activeRole].color, color: "white" }}>Accéder <ArrowUpRight size={11} /></button>
              )}
            </div>
          )}

          {/* ════════════ ACCUEIL ════════════ */}
          {activeTab === "accueil" && (
            <div className="space-y-5">
              {demandesEnAttente > 0 && (
                <div className="flex items-center gap-3 p-3.5 rounded-xl" style={{ background: "hsl(38 92% 50% / 0.08)", border: "1px solid hsl(38 92% 50% / 0.25)" }}>
                  <Clock size={14} style={{ color: "hsl(38 92% 40%)", flexShrink: 0 }} />
                  <p className="text-xs flex-1" style={{ color: "hsl(38 92% 35%)" }}><strong>{demandesEnAttente} demande{demandesEnAttente > 1 ? "s" : ""}</strong> en attente d'approbation.</p>
                  <button onClick={() => setActiveTab("conges")} className="text-[11px] font-semibold flex items-center gap-1 hover:opacity-70" style={{ color: "hsl(38 92% 35%)" }}>Voir <ChevronRight size={11} /></button>
                </div>
              )}

              {taches.length > 0 && (
                <Section title="Mes tâches à faire" icon={<CheckCircle2 size={14} />}>
                  <div className="space-y-2">
                    {taches.map((t: any) => {
                      const isUrgent = t.date_echeance && new Date(t.date_echeance) <= addDays(new Date(), 3);
                      const isEnRetard = t.date_echeance && new Date(t.date_echeance) < new Date();
                      return (
                        <div key={t.id} className="flex items-start gap-3 p-3 rounded-xl" style={{ background: isEnRetard ? "hsl(0 70% 50% / 0.06)" : isUrgent ? "hsl(38 92% 50% / 0.06)" : "hsl(var(--muted) / 0.3)", border: `1px solid ${isEnRetard ? "hsl(0 70% 50% / 0.2)" : isUrgent ? "hsl(38 92% 50% / 0.2)" : "hsl(var(--border))"}` }}>
                          <div className="w-5 h-5 rounded-full border-2 flex-shrink-0 mt-0.5" style={{ borderColor: isEnRetard ? "hsl(0 70% 50%)" : isUrgent ? "hsl(38 92% 45%)" : "hsl(var(--muted-foreground) / 0.5)" }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold">{t.titre || t.libelle || "Tâche"}</p>
                            {t.description && <p className="text-[11px] mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{t.description}</p>}
                            {t.date_echeance && <p className="text-[10px] mt-1 flex items-center gap-1" style={{ color: isEnRetard ? "hsl(0 70% 45%)" : isUrgent ? "hsl(38 92% 38%)" : "hsl(var(--muted-foreground))" }}><CalendarDays size={10} />{isEnRetard ? "En retard · " : isUrgent ? "Urgent · " : ""}Échéance : {fmt(t.date_echeance)}</p>}
                          </div>
                          {t.priorite && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold flex-shrink-0" style={{ background: t.priorite === "HAUTE" ? "hsl(0 70% 50% / 0.12)" : t.priorite === "MOYENNE" ? "hsl(38 92% 50% / 0.12)" : "hsl(var(--muted))", color: t.priorite === "HAUTE" ? "hsl(0 70% 40%)" : t.priorite === "MOYENNE" ? "hsl(38 92% 35%)" : "hsl(var(--muted-foreground))" }}>{t.priorite}</span>}
                        </div>
                      );
                    })}
                  </div>
                </Section>
              )}

              {congesAVenir.length > 0 && (
                <div className="p-4 rounded-xl" style={{ background: "hsl(142 55% 45% / 0.08)", border: "1px solid hsl(142 55% 45% / 0.25)" }}>
                  <div className="flex items-center gap-2 mb-2"><CalendarDays size={13} style={{ color: "hsl(142 55% 35%)" }} /><p className="text-xs font-bold" style={{ color: "hsl(142 55% 30%)" }}>Congé{congesAVenir.length > 1 ? "s" : ""} à venir (60j)</p></div>
                  <div className="space-y-1.5">
                    {congesAVenir.map((d: any) => (
                      <div key={d.id} className="flex items-center gap-3 text-xs">
                        <span className="font-bold w-20 flex-shrink-0" style={{ color: "hsl(142 55% 30%)" }}>{fmt(d.date_debut, "dd MMM")}</span>
                        <span style={{ color: "hsl(var(--muted-foreground))" }}>→</span>
                        <span>{fmt(d.date_fin_absence, "dd MMM yyyy")}</span>
                        <span className="ml-auto font-semibold" style={{ color: "hsl(142 55% 35%)" }}>{d.nbr_jours_decomptes}j</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: "Demandes", value: statsAnnee.total, icon: <FileText size={14} />, color: "hsl(210 70% 45%)" },
                  { label: "Approuvées", value: statsAnnee.approuvees, icon: <CheckCircle2 size={14} />, color: "hsl(142 55% 38%)" },
                  { label: "Refusées", value: statsAnnee.refusees, icon: <XCircle size={14} />, color: "hsl(0 70% 45%)" },
                  { label: "Jours pris", value: `${statsAnnee.joursApprouves}j`, icon: <CalendarDays size={14} />, color: "hsl(38 92% 40%)" },
                ].map(k => (
                  <div key={k.label} className="p-3.5 rounded-xl" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
                    <div style={{ color: k.color }}>{k.icon}</div>
                    <p className="text-xl font-bold mt-1 leading-none">{k.value}</p>
                    <p className="text-[10px] mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>{k.label} {exercice}</p>
                  </div>
                ))}
              </div>

              {soldes.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-bold">Mes soldes de congés</h2>
                    <button onClick={() => setActiveTab("conges")} className="text-[11px] font-medium flex items-center gap-1 hover:opacity-70" style={{ color: "hsl(var(--primary))" }}>Voir tout <ArrowUpRight size={11} /></button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {soldes.slice(0, 6).map((s: any) => {
                      const pct = s.solde_acquis > 0 ? Math.min(Math.round((s.solde_restant / s.solde_acquis) * 100), 100) : 0;
                      const color = pct <= 20 ? "hsl(0 70% 50%)" : pct <= 50 ? "hsl(38 92% 45%)" : "hsl(142 55% 45%)";
                      return (
                        <div key={s.code_type_conge} className="p-4 rounded-xl" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
                          <div className="flex items-start justify-between mb-2"><p className="text-xs font-semibold flex-1 pr-2">{s.libelle_type_conge || s.code_type_conge}</p><span className="text-lg font-bold leading-none flex-shrink-0" style={{ color }}>{s.solde_restant}j</span></div>
                          <div className="h-1.5 rounded-full overflow-hidden mb-1" style={{ background: "hsl(var(--muted))" }}><div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} /></div>
                          <div className="flex justify-between text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}><span>{s.solde_pris}j pris</span><span>{s.solde_acquis}j acquis</span></div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Activité récente */}
              {activite.length > 0 && (
                <Section title="Activité récente" icon={<Activity size={14} />} collapsible>
                  <div className="space-y-2">
                    {activite.map((a, i) => (
                      <div key={i} className="flex items-center gap-3 text-xs">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: a.type === "demande" ? "hsl(var(--primary) / 0.1)" : "hsl(210 70% 50% / 0.1)", color: a.type === "demande" ? "hsl(var(--primary))" : "hsl(210 70% 45%)" }}>
                          {a.type === "demande" ? <CalendarDays size={13} /> : <Bell size={13} />}
                        </div>
                        <div className="flex-1 min-w-0"><p className="font-medium truncate">{a.titre}</p><p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>{fmt(a.date, "dd/MM/yyyy")}</p></div>
                        {a.statut && <StatutBadge statut={a.statut} />}
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              <div>
                <h2 className="text-sm font-bold mb-3">Actions rapides</h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: "Nouvelle demande", icon: <Plus size={16} />, color: "hsl(var(--primary))", bg: "hsl(var(--primary) / 0.1)", action: () => setShowDemandeForm(true) },
                    { label: "Demander un doc.", icon: <FileText size={16} />, color: "hsl(270 50% 45%)", bg: "hsl(270 50% 50% / 0.1)", action: () => setShowDocModal(true) },
                    { label: "Mes compteurs", icon: <BarChart3 size={16} />, color: "hsl(142 55% 38%)", bg: "hsl(142 55% 45% / 0.1)", action: () => setActiveTab("compteurs") },
                    { label: "Mon dossier", icon: <User size={16} />, color: "hsl(210 70% 45%)", bg: "hsl(210 70% 50% / 0.1)", action: () => setActiveTab("dossier") },
                  ].map(a => (
                    <button key={a.label} onClick={a.action} className="flex flex-col items-center gap-2 p-4 rounded-xl transition-all hover:scale-105 hover:shadow-md" style={{ background: a.bg, border: `1px solid ${a.color}30` }}>
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `${a.color}20`, color: a.color }}>{a.icon}</div>
                      <span className="text-xs font-semibold text-center leading-tight">{a.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ════════════ MON DOSSIER ════════════ */}
          {activeTab === "dossier" && (
            <div className="space-y-4">
              {/* Barre d'actions : recherche + impression */}
              <div className="flex items-center gap-2 print:hidden">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher dans mon dossier (matricule, CNSS, adresse…)" className="w-full h-9 pl-9 pr-8 text-sm rounded-lg border outline-none" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }} />
                  {search && <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:opacity-70" style={{ color: "hsl(var(--muted-foreground))" }}><X size={13} /></button>}
                </div>
                <button onClick={() => window.print()} className="flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium border hover:opacity-80" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}><Printer size={13} /> Imprimer</button>
              </div>

              {/* Résultats de recherche */}
              {search.trim().length >= 2 ? (
                <Section title={`Résultats (${searchResults.length})`} icon={<Search size={14} />}>
                  {searchResults.length === 0
                    ? <EmptyState icon={<Search size={28} className="mx-auto" />} title="Aucun résultat" hint="Essayez un autre terme." />
                    : <div className="space-y-2">
                      {searchResults.map((r, i) => (
                        <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg" style={{ background: "hsl(var(--muted) / 0.3)" }}>
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0" style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}>{r.section}</span>
                          <div className="flex-1 min-w-0"><p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>{r.label}</p><p className="text-sm font-medium truncate">{r.value}</p></div>
                          <CopyButton value={r.value} label={r.label} />
                        </div>
                      ))}
                    </div>}
                </Section>
              ) : (
                <>
                  <div className="flex gap-0 overflow-x-auto rounded-xl border print:hidden" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))", scrollbarWidth: "none" }}>
                    {[
                      { id: "identite", label: "Identité", icon: <User size={13} /> },
                      { id: "contrats", label: "Contrats", icon: <Briefcase size={13} /> },
                      { id: "manager", label: "Manager & contacts", icon: <UserCircle2 size={13} /> },
                      { id: "adresses", label: "Adresses", icon: <MapPin size={13} /> },
                      { id: "famille", label: "Famille", icon: <Heart size={13} /> },
                      { id: "remuneration", label: "Rémunération", icon: <Star size={13} /> },
                      { id: "formation", label: "Formation & Compétences", icon: <BookOpen size={13} /> },
                      { id: "immatriculation", label: "Immatricul.", icon: <Shield size={13} /> },
                      { id: "syndical", label: "Syndical", icon: <Users size={13} /> },
                      { id: "divers", label: "Divers", icon: <Info size={13} /> },
                    ].map(t => (
                      <button key={t.id} onClick={() => setDossierTab(t.id)} className="flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-medium whitespace-nowrap transition-all flex-shrink-0 border-b-2" style={{ borderBottomColor: dossierTab === t.id ? "hsl(var(--primary))" : "transparent", color: dossierTab === t.id ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))", background: dossierTab === t.id ? "hsl(var(--primary) / 0.05)" : "transparent" }}>
                        {t.icon}{t.label}
                      </button>
                    ))}
                  </div>

                  {dossierTab === "identite" && (
                    <div className="space-y-4">
                      <Section title="État civil" icon={<User size={14} />}>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                          <InfoField label="Matricule" value={collab?.matricule ? `#${collab.matricule}` : null} copyable />
                          <InfoField label="Civilité" value={collab?.civilite} />
                          <InfoField label="Nom" value={collab?.nom} />
                          <InfoField label="Prénom" value={collab?.prenom} />
                          <InfoField label="Nom de jeune fille" value={collab?.nom_jeune_fille} />
                          <InfoField label="Genre" value={collab?.code_genre === "H" ? "Homme" : collab?.code_genre === "F" ? "Femme" : collab?.code_genre} />
                          <InfoField label="Date de naissance" value={collab?.date_naissance ? fmt(collab.date_naissance, "dd MMMM yyyy") : null} />
                          <InfoField label="Lieu de naissance" value={collab?.lieu_naissance} />
                          <InfoField label="Situation familiale" value={refLabel(refMaps.situationFam, collab?.code_situation_familiale)} />
                          <InfoField label="Depuis le" value={collab?.date_situation_familiale ? fmt(collab.date_situation_familiale) : null} />
                          <InfoField label="Nationalité" value={refLabel(refMaps.nationalite, collab?.code_nationalite)} />
                          <InfoField label="Nationalité 2" value={refLabel(refMaps.nationalite, collab?.code_nationalite2)} />
                        </div>
                      </Section>
                      <Section title="Coordonnées" icon={<Phone size={14} />}>
                        <div className="grid grid-cols-2 gap-4">
                          <InfoField label="Téléphone" value={collab?.telephone} copyable />
                          <InfoField label="GSM" value={collab?.gsm} copyable />
                          <InfoField label="Email professionnel" value={collab?.email_professionnel} copyable />
                          <InfoField label="Email personnel" value={collab?.email_personnel} copyable />
                        </div>
                      </Section>
                      <Section title="Documents d'identité" icon={<FileText size={14} />}>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {[
                            { label: "CIN", num: collab?.cin, debut: collab?.cin_date_debut, fin: collab?.cin_date_fin },
                            { label: "Passeport", num: collab?.passeport, debut: collab?.passeport_date_debut, fin: collab?.passeport_date_fin },
                            { label: "Identifiant fiscal", num: collab?.num_fiscal, debut: collab?.fiscal_date_debut, fin: collab?.fiscal_date_fin },
                          ].map(doc => (
                            <div key={doc.label} className="p-3 rounded-xl" style={{ background: "hsl(var(--muted) / 0.4)", border: "1px solid hsl(var(--border))" }}>
                              <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "hsl(var(--accent))" }}>{doc.label}</p>
                              <InfoField label="Numéro" value={doc.num} copyable />
                              <div className="grid grid-cols-2 gap-2 mt-2"><InfoField label="Début" value={doc.debut ? fmt(doc.debut) : null} /><InfoField label="Fin" value={doc.fin ? fmt(doc.fin) : null} /></div>
                            </div>
                          ))}
                        </div>
                      </Section>
                    </div>
                  )}

                  {dossierTab === "contrats" && (
                    <Section title="Mes contrats" icon={<Briefcase size={14} />}>
                      {!contrat ? <EmptyState icon={<Briefcase size={28} className="mx-auto" />} title="Aucun contrat" />
                        : <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                          <InfoField label="Type de contrat" value={contrat.libelle_type_contrat || contrat.code_type_contrat} />
                          <InfoField label="Statut" value={refLabel(refMaps.statutContrat, contrat.code_statut_contrat)} />
                          <InfoField label="Date de début" value={fmt(contrat.date_debut, "dd MMMM yyyy")} />
                          <InfoField label="Date de fin" value={contrat.date_fin ? fmt(contrat.date_fin, "dd MMMM yyyy") : "Indéterminée"} />
                          <InfoField label="Ancienneté" value={<AncienneteText dateDebut={contrat.date_debut} />} />
                          <InfoField label="Référence" value={contrat.reference_contrat} copyable />
                          <InfoField label="Intitulé poste" value={contrat.intitule_poste} />
                        </div>}
                    </Section>
                  )}

                  {/* Manager & contacts */}
                  {dossierTab === "manager" && (() => {
                    const ManagerCard = ({ niveau, m }: { niveau: string; m: any }) => (
                      <div className="p-3 rounded-xl" style={{ background: "hsl(var(--muted) / 0.3)", border: "1px solid hsl(var(--border))" }}>
                        <div className="flex items-center gap-1.5 mb-3">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "hsl(var(--primary) / 0.12)", color: "hsl(var(--primary))" }}>{niveau}</span>
                        </div>
                        {!m ? <p className="text-xs italic" style={{ color: "hsl(var(--muted-foreground))" }}>Non renseigné</p>
                          : <div className="flex items-center gap-4">
                            <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-sm font-bold flex-shrink-0" style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}>{m.prenom?.[0]}{m.nom?.[0]}</div>
                            <div className="flex-1 grid grid-cols-2 gap-3">
                              <InfoField label="Nom" value={`${m.prenom || ""} ${m.nom || ""}`.trim()} />
                              <InfoField label="Email" value={m.email_professionnel} copyable />
                              <InfoField label="Téléphone" value={m.telephone || m.gsm} copyable />
                            </div>
                          </div>}
                      </div>
                    );
                    return (
                    <div className="space-y-4">
                      <Section title="Ma ligne hiérarchique" icon={<UserCircle2 size={14} />}>
                        {!managers?.n1 && !managers?.n2
                          ? <EmptyState icon={<UserCircle2 size={28} className="mx-auto" />} title="Responsable non renseigné" hint="Rapprochez-vous du service RH si besoin." />
                          : <div className="space-y-3">
                              <div className="flex items-center gap-1.5 mb-1">
                                <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>
                                  {managers?.source === "statique" ? "Hiérarchie définie manuellement" : "Hiérarchie calculée via l'organigramme"}
                                </span>
                              </div>
                              {!!managers?.vacances?.length && (
                                <div className="flex items-start gap-2 p-2.5 rounded-xl text-[11px]" style={{ background: "hsl(38 92% 50% / 0.1)", border: "1px solid hsl(38 92% 50% / 0.25)", color: "hsl(38 92% 32%)" }}>
                                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                                  <span>
                                    {managers.vacances.map((v, i) => (
                                      <span key={i}>{i > 0 && " · "}Poste de responsable vacant{v.poste ? ` (${v.poste})` : ""} — {v.uo}</span>
                                    ))}
                                    . Rattachement au niveau supérieur.
                                  </span>
                                </div>
                              )}
                              <ManagerCard niveau="N+1 · Responsable direct" m={managers?.n1} />
                              <ManagerCard niveau="N+2 · Responsable supérieur" m={managers?.n2} />
                            </div>}
                      </Section>
                      <Section title="Mon unité organisationnelle" icon={<Building2 size={14} />}>
                        <div className="grid grid-cols-2 gap-4">
                          <InfoField label="Unité" value={affectation?.libelle_uo} />
                          <InfoField label="Poste" value={affectation?.libelle_poste} />
                          <InfoField label="Depuis le" value={affectation?.date_debut_uo ? fmt(affectation.date_debut_uo) : null} />
                        </div>
                      </Section>
                    </div>
                    );
                  })()}

                  {dossierTab === "adresses" && (
                    <Section title="Adresses" icon={<MapPin size={14} />}>
                      {adresses.length === 0 ? <EmptyState icon={<MapPin size={28} className="mx-auto" />} title="Aucune adresse" />
                        : <div className="space-y-3">
                          {adresses.map((a: any) => (
                            <div key={a.id} className="p-3 rounded-xl" style={{ background: "hsl(var(--muted) / 0.3)", border: "1px solid hsl(var(--border))" }}>
                              <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "hsl(var(--accent))" }}>{a.type_adresse || "Adresse"}</p>
                              <div className="grid grid-cols-2 gap-3">
                                {a.adresse1 && <InfoField label="Adresse" value={`${a.adresse1}${a.adresse2 ? `, ${a.adresse2}` : ""}`} />}
                                {a.code_postal && <InfoField label="Code postal" value={a.code_postal} />}
                                {a.ville && <InfoField label="Ville" value={a.ville} />}
                                {a.pays && <InfoField label="Pays" value={refLabel(refMaps.pays, a.pays)} />}
                                {a.telephone && <InfoField label="Téléphone" value={a.telephone} copyable />}
                              </div>
                            </div>
                          ))}
                        </div>}
                    </Section>
                  )}

                  {dossierTab === "famille" && (
                    <div className="space-y-4">
                      <Section title="Conjoint(e)" icon={<Heart size={14} />}>
                        {!famille?.conjoints?.length ? <p className="text-xs italic" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun conjoint enregistré</p>
                          : famille.conjoints.map((c: any) => (
                            <div key={c.id} className="grid grid-cols-2 gap-3 p-3 rounded-lg" style={{ background: "hsl(var(--muted) / 0.3)" }}>
                              <InfoField label="Nom complet" value={`${c.prenom ?? ""} ${c.nom ?? ""}`.trim() || null} />
                              <InfoField label="Date de naissance" value={c.date_naissance ? fmt(c.date_naissance) : null} />
                              <InfoField label="Profession" value={c.profession} />
                              <InfoField label="Employeur" value={c.employeur} />
                            </div>
                          ))}
                      </Section>
                      <Section title="Enfants" icon={<Users size={14} />}>
                        {!famille?.enfants?.length ? <p className="text-xs italic" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun enfant enregistré</p>
                          : <div className="space-y-2">
                            {famille.enfants.map((e: any) => (
                              <div key={e.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg" style={{ background: "hsl(var(--muted) / 0.3)", border: "1px solid hsl(var(--border))" }}>
                                <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0" style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}>{e.prenom?.[0]}{e.nom?.[0]}</div>
                                <div className="flex-1 min-w-0"><p className="text-xs font-semibold">{e.prenom} {e.nom}</p>{e.date_naissance && <p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>{fmt(e.date_naissance)} · {differenceInYears(new Date(), parseISO(e.date_naissance))} ans</p>}</div>
                                <div className="flex gap-1">
                                  {e.a_charge && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: "hsl(142 55% 45% / 0.12)", color: "hsl(142 55% 30%)" }}>À charge</span>}
                                  {e.situation_scolaire && <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>{e.situation_scolaire}</span>}
                                </div>
                              </div>
                            ))}
                          </div>}
                      </Section>
                    </div>
                  )}

                  {dossierTab === "remuneration" && (
                    <div className="space-y-4">
                      <Section title="Salaire" icon={<Star size={14} />}>
                        {!remuneration?.salaires?.length ? <p className="text-xs italic" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune donnée salariale</p>
                          : <div className="space-y-2">
                            {remuneration.salaires.map((s: any) => (
                              <div key={s.id} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: "hsl(var(--muted) / 0.3)", border: "1px solid hsl(var(--border))" }}>
                                <div className="flex-1"><p className="text-xs font-semibold">{s.libelle || s.code_element}</p><p className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>Depuis le {s.date_debut ? fmt(s.date_debut) : "—"}</p></div>
                                <span className="text-sm font-bold" style={{ color: "hsl(var(--accent))" }}>{s.valeur ? `${parseFloat(s.valeur).toLocaleString("fr-MA")} MAD` : "—"}</span>
                              </div>
                            ))}
                          </div>}
                      </Section>
                      {remuneration?.avantages?.length > 0 && (
                        <Section title="Avantages en nature" icon={<Sparkles size={14} />}>
                          <div className="grid grid-cols-2 gap-3">
                            {remuneration.avantages.map((a: any) => (
                              <div key={a.id} className="p-3 rounded-lg" style={{ background: "hsl(var(--muted) / 0.3)" }}><p className="text-xs font-semibold">{a.libelle || a.code_avantage}</p>{a.valeur && <p className="text-[11px] mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{parseFloat(a.valeur).toLocaleString("fr-MA")} MAD</p>}</div>
                            ))}
                          </div>
                        </Section>
                      )}
                      {remuneration?.banque?.length > 0 && (
                        <Section title="Coordonnées bancaires" icon={<Shield size={14} />}>
                          <div className="space-y-2">
                            {remuneration.banque.map((b: any) => (
                              <div key={b.id} className="grid grid-cols-2 gap-3 p-3 rounded-lg" style={{ background: "hsl(var(--muted) / 0.3)" }}>
                                <InfoField label="Banque" value={b.banque || b.code_banque} />
                                <InfoField label="RIB / IBAN" value={b.rib || b.iban} copyable />
                                <InfoField label="Agence" value={b.agence} />
                                <InfoField label="Titulaire" value={b.titulaire} />
                              </div>
                            ))}
                          </div>
                        </Section>
                      )}
                    </div>
                  )}

                  {dossierTab === "formation" && (
                    <div className="space-y-4">
                      <Section title="Diplômes" icon={<Award size={14} />}>
                        {!formation?.diplomes?.length ? <p className="text-xs italic" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun diplôme enregistré</p>
                          : <div className="space-y-2">
                            {formation.diplomes.map((d: any) => (
                              <div key={d.id} className="flex items-start gap-3 p-2.5 rounded-lg" style={{ background: "hsl(var(--muted) / 0.3)" }}>
                                <Award size={13} style={{ color: "hsl(var(--accent))", flexShrink: 0, marginTop: 1 }} />
                                <div className="flex-1"><p className="text-xs font-semibold">{d.libelle || d.intitule || d.code_diplome}</p><p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>{d.etablissement && `${d.etablissement}`}{d.annee && ` · ${d.annee}`}</p></div>
                                {d.niveau && <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}>{d.niveau}</span>}
                              </div>
                            ))}
                          </div>}
                      </Section>
                      {formation?.competences?.length > 0 && (
                        <Section title="Compétences" icon={<BookOpen size={14} />}>
                          <div className="flex flex-wrap gap-2">
                            {formation.competences.map((c: any) => (
                              <span key={c.id} className="text-[11px] px-2.5 py-1 rounded-full font-medium" style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))", border: "1px solid hsl(var(--primary) / 0.2)" }}>{c.libelle || c.code_competence}{c.niveau && <span className="ml-1 opacity-60">· {c.niveau}</span>}</span>
                            ))}
                          </div>
                        </Section>
                      )}
                    </div>
                  )}

                  {dossierTab === "immatriculation" && (
                    <Section title="Régimes & immatriculations sociales" icon={<Shield size={14} />}>
                      {immatriculations.length === 0 ? <p className="text-xs italic py-4 text-center" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune immatriculation</p>
                        : <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead><tr className="border-b" style={{ borderColor: "hsl(var(--border))" }}>{["Régime", "N° immatriculation", "Affiliation", "Radiation", "Statut"].map(h => <th key={h} className="text-left py-2 pr-4 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>{h}</th>)}</tr></thead>
                            <tbody>
                              {immatriculations.map((r: any) => (
                                <tr key={r.id} className="border-b" style={{ borderColor: "hsl(var(--border) / 0.5)" }}>
                                  <td className="py-2 pr-4 font-semibold">{r.code_regime}</td>
                                  <td className="py-2 pr-4 font-mono text-[11px]">{r.matricule_organisme || "—"}</td>
                                  <td className="py-2 pr-4">{r.date_affiliation ? fmt(r.date_affiliation) : "—"}</td>
                                  <td className="py-2 pr-4">{r.date_radiation ? fmt(r.date_radiation) : "—"}</td>
                                  <td className="py-2"><span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: r.actif ? "hsl(142 55% 45% / 0.12)" : "hsl(var(--muted))", color: r.actif ? "hsl(142 55% 30%)" : "hsl(var(--muted-foreground))" }}>{r.actif ? "Actif" : "Inactif"}</span></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>}
                    </Section>
                  )}

                  {dossierTab === "syndical" && (
                    <Section title="Mandats syndicaux" icon={<Users size={14} />}>
                      {syndical.length === 0 ? <p className="text-xs italic py-4 text-center" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun mandat syndical</p>
                        : <div className="space-y-2">
                          {syndical.map((m: any) => (
                            <div key={m.id} className="flex items-start gap-3 p-3 rounded-lg" style={{ background: "hsl(var(--muted) / 0.3)", border: "1px solid hsl(var(--border))" }}>
                              <div className="flex-1"><p className="text-xs font-semibold">{m.libelle_mandat || m.code_mandat}</p><p className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>{m.organisation_syndicale && `${m.organisation_syndicale} · `}{m.date_debut ? fmt(m.date_debut) : "—"}{m.date_fin ? ` → ${fmt(m.date_fin)}` : " → En cours"}</p></div>
                              {!m.date_fin && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: "hsl(142 55% 45% / 0.12)", color: "hsl(142 55% 30%)" }}>En cours</span>}
                            </div>
                          ))}
                        </div>}
                    </Section>
                  )}

                  {dossierTab === "divers" && (
                    <Section title="Informations diverses" icon={<Info size={14} />}>
                      <div className="grid grid-cols-2 gap-4">
                        <InfoField label="N° CNSS" value={divers?.num_cnss} copyable />
                        <InfoField label="N° CIMR" value={divers?.num_cimr} copyable />
                        <InfoField label="N° AMO" value={divers?.num_amo} copyable />
                        <InfoField label="N° CIMR Retraite" value={divers?.num_cimr_retraite} copyable />
                        <InfoField label="Mutuelle" value={divers?.code_mutuelle} />
                        <InfoField label="N° Mutuelle" value={divers?.num_mutuelle} copyable />
                        <InfoField label="Groupe sanguin" value={divers?.groupe_sanguin} />
                        <InfoField label="Médecin traitant" value={divers?.medecin_traitant} />
                      </div>
                    </Section>
                  )}
                </>
              )}
            </div>
          )}

          {/* ════════════ CONGÉS (validés uniquement) ════════════ */}
          {activeTab === "conges" && (
            <div className="space-y-5">
              <div className="flex items-center justify-end flex-wrap gap-2">
                <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
                  {(["liste", "calendrier"] as const).map(v => (
                    <button key={v} onClick={() => setCongesView(v)} className="px-2.5 py-1 text-[11px] font-medium capitalize transition-all" style={{ background: congesView === v ? "hsl(var(--primary))" : "transparent", color: congesView === v ? "white" : "hsl(var(--muted-foreground))" }}>{v}</button>
                  ))}
                </div>
                <Button onClick={() => setShowDemandeForm(true)} className="flex items-center gap-1.5 text-xs h-8 px-4" style={{ background: "hsl(var(--primary))", color: "white" }}><Plus size={13} /> Nouvelle demande</Button>
              </div>

              {soldes.length > 0 && (
                <Section title="Mes soldes" icon={<BarChart3 size={14} />}>
                  <div className="space-y-3">
                    {soldes.map((s: any) => {
                      const pct = s.solde_acquis > 0 ? Math.min(Math.round((s.solde_restant / s.solde_acquis) * 100), 100) : 0;
                      const color = pct <= 20 ? "hsl(0 70% 50%)" : pct <= 50 ? "hsl(38 92% 45%)" : "hsl(142 55% 45%)";
                      return (
                        <div key={s.code_type_conge}>
                          <div className="flex items-center justify-between mb-1"><span className="text-xs font-semibold">{s.libelle_type_conge || s.code_type_conge}</span><span className="text-sm font-bold" style={{ color }}>{s.solde_restant}j</span></div>
                          <div className="h-2 rounded-full overflow-hidden" style={{ background: "hsl(var(--muted))" }}><div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} /></div>
                          <div className="flex justify-between mt-0.5 text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}><span>{s.solde_pris}j pris {s.solde_en_attente > 0 ? `· ${s.solde_en_attente}j attente` : ""}</span><span>{s.solde_acquis}j acquis</span></div>
                        </div>
                      );
                    })}
                  </div>
                </Section>
              )}

              {/* Bouton Filtres avancés (style maison, panneau latéral) */}
              <div className="flex justify-end">
                <button
                  onClick={() => setShowCongeFiltres(true)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-colors relative"
                  style={{
                    borderColor: nbCongeFiltresActifs > 0 ? "hsl(var(--accent))" : "hsl(var(--border))",
                    background: nbCongeFiltresActifs > 0 ? "hsl(var(--accent) / 0.08)" : "transparent",
                    color: nbCongeFiltresActifs > 0 ? "hsl(var(--accent))" : "hsl(var(--foreground))",
                  }}
                  type="button"
                >
                  <Filter size={14} /> Filtres avancés
                  {nbCongeFiltresActifs > 0 && (
                    <span className="ml-1 inline-flex items-center justify-center text-[10px] font-bold rounded-full w-5 h-5" style={{ background: "hsl(var(--accent))", color: "white" }}>
                      {nbCongeFiltresActifs}
                    </span>
                  )}
                </button>
              </div>

              {congesView === "calendrier" ? (
                <Section title="Calendrier des congés" icon={<CalendarClock size={14} />}>
                  <CongesCalendar demandes={congesValidesFiltres} />
                </Section>
              ) : (
                <Section title={`Mes congés validés (${congesValidesFiltres.length})`} icon={<CheckCircle2 size={14} />}>
                  {congesValidesFiltres.length === 0 ? <EmptyState icon={<CalendarDays size={28} className="mx-auto" />} title="Aucun congé validé" hint="Aucun congé ne correspond aux filtres." />
                    : <div className="space-y-2">
                      {congesValidesFiltres.map((d: any) => (
                        <div key={d.id} className="rounded-xl overflow-hidden" style={{ background: "hsl(var(--muted) / 0.3)", border: "1px solid hsl(var(--border))" }}>
                          <div className="flex items-start gap-3 p-3 cursor-pointer transition-colors hover:bg-[hsl(var(--muted)/0.5)]"
                               onClick={() => setExpandedDemandeId(id => id === d.id ? null : d.id)}>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap"><span className="text-xs font-semibold">{d.libelle_type_conge || d.code_type_conge}</span><StatutBadge statut={d.statut} /></div>
                              <p className="text-[11px] mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{fmt(d.date_debut, "dd MMM yyyy")} → {fmt(d.date_fin_absence, "dd MMM yyyy")} · <strong>{d.nbr_jours_decomptes}j</strong></p>
                            </div>
                            <ChevronDown size={14} style={{ color: "hsl(var(--muted-foreground))", transform: expandedDemandeId === d.id ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
                          </div>
                          {expandedDemandeId === d.id && (
                            <div className="px-4 pb-4 pt-3 border-t" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
                              <ConsultationConge demande={d} />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>}
                </Section>
              )}
            </div>
          )}

          {/* ════════════ MES DEMANDES (registre, tous types/statuts) ════════════ */}
          {activeTab === "demandes" && (
            <div className="space-y-5">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex gap-1.5 flex-wrap">
                  {["TOUS", "en_attente", "approuvee", "refusee", "annulee"].map(s => {
                    const actif = filterDemande === s;
                    const badge = STATUT_BADGE[s];
                    const col = s === "TOUS" ? "hsl(var(--primary))" : (badge?.color ?? "hsl(var(--primary))");
                    const bgInactif = s === "TOUS" ? "transparent" : (badge?.bg ?? "transparent");
                    return (
                      <button key={s} onClick={() => setFilterDemande(s)} className="px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all"
                        style={{
                          background: actif ? col : bgInactif,
                          borderColor: actif ? col : (s === "TOUS" ? "hsl(var(--border))" : col),
                          color: actif ? "white" : col,
                        }}>
                        {s === "TOUS" ? "Toutes" : STATUT_BADGE[s]?.label ?? s} {s !== "TOUS" && `(${registreDemandes.filter((d: any) => d.statut === s).length})`}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Recherche + Filtres avancés */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
                  <Input value={demRecherche} onChange={e => setDemRecherche(e.target.value)} placeholder="Rechercher un type, une référence, une étape…" className="pl-8 h-9 text-sm" />
                </div>
                <button onClick={() => setDemShowFiltres(true)}
                  className="flex items-center gap-2 px-3 h-9 rounded-xl text-sm font-medium border transition-colors flex-shrink-0"
                  style={{ background: demNbFiltres > 0 ? "hsl(var(--primary) / 0.1)" : "hsl(var(--card))", borderColor: demNbFiltres > 0 ? "hsl(var(--primary))" : "hsl(var(--border))", color: demNbFiltres > 0 ? "hsl(var(--primary))" : "hsl(var(--foreground))" }}>
                  <Filter size={14} /> Filtres
                  {demNbFiltres > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: "hsl(var(--primary))" }}>{demNbFiltres}</span>}
                </button>
              </div>

              {(() => {
                const q = demRecherche.trim().toLowerCase();
                let liste = filterDemande === "TOUS" ? registreDemandes : registreDemandes.filter((d: any) => d.statut === filterDemande);
                if (q) liste = liste.filter((d: any) => `${d.type_libelle || d.type_demande || ""} ${d.reference || ""} ${d.resume?.etape_courante_libelle || ""} ${d.resume?.libelle_type_conge || ""}`.toLowerCase().includes(q));
                if (demFType) liste = liste.filter((d: any) => d.type_demande === demFType);
                if (demFEtape) liste = liste.filter((d: any) => (d.resume?.etape_courante_libelle || "") === demFEtape);
                if (demFDebut || demFFin) liste = liste.filter((d: any) => demPeriodeMatch(d.resume?.date_debut, d.resume?.date_fin_absence));
                if (demFRef) liste = liste.filter((d: any) => (d.reference || "").toLowerCase().includes(demFRef.trim().toLowerCase()));
                return (
                  <Section title={`Mes demandes (${liste.length})`} icon={<ClipboardList size={14} />}>
                    {liste.length === 0 ? <EmptyState icon={<ClipboardList size={28} className="mx-auto" />} title="Aucune demande" />
                      : <div className="space-y-2">
                        {liste.map((d: any) => {
                          const r = d.resume || {};
                          const key = d.id_objet || d.id;
                          return (
                            <div key={d.id} className="rounded-xl overflow-hidden" style={{ background: "hsl(var(--muted) / 0.3)", border: "1px solid hsl(var(--border))" }}>
                              <div className="flex items-start gap-3 p-3 cursor-pointer transition-colors hover:bg-[hsl(var(--muted)/0.5)]"
                                   onClick={() => setExpandedDemandeId(id => id === key ? null : key)}>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-semibold">{d.type_libelle || d.type_demande}</span>
                                    <StatutBadge statut={d.statut} />
                                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>{d.reference}</span>
                                  </div>
                                  {(r.date_debut || r.libelle_type_conge) && (
                                    <p className="text-[11px] mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                                      {r.libelle_type_conge ? `${r.libelle_type_conge} · ` : ""}
                                      {r.date_debut ? `${fmt(r.date_debut, "dd MMM yyyy")} → ${fmt(r.date_fin_absence, "dd MMM yyyy")} · ` : ""}
                                      {r.nbr_jours_decomptes != null ? <strong>{r.nbr_jours_decomptes}j</strong> : null}
                                    </p>
                                  )}
                                  {r.commentaire_collaborateur && <p className="text-[10px] mt-0.5 italic" style={{ color: "hsl(var(--muted-foreground))" }}>"{r.commentaire_collaborateur}"</p>}
                                  {r.motif_refus && d.statut === "refusee" && <p className="text-[10px] mt-0.5" style={{ color: "hsl(var(--destructive))" }}>Motif : {r.motif_refus}</p>}
                                </div>
                                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                                  <div className="flex items-center gap-2">
                                    <p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>{d.date_soumission && fmt(d.date_soumission, "dd/MM/yy")}</p>
                                    <ChevronDown size={14} style={{ color: "hsl(var(--muted-foreground))", transform: expandedDemandeId === key ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
                                  </div>
                                  {d.statut === "en_attente" && (
                                    <button onClick={(e) => { e.stopPropagation(); annulerDemande(d.id_objet, d.table_objet); }} className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-md hover:opacity-70" style={{ background: "hsl(var(--destructive) / 0.1)", color: "hsl(var(--destructive))" }}><Trash2 size={10} /> Annuler</button>
                                  )}
                                </div>
                              </div>
                              {expandedDemandeId === key && (
                                <div className="px-4 pb-4 pt-3 border-t space-y-4" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
                                  {/* Fiche de consultation selon le type */}
                                  {d.type_demande === "CONGE" && d.resume && (
                                    <div>
                                      <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "hsl(var(--accent))" }}>Détail de la demande</p>
                                      <ConsultationConge demande={d.resume} />
                                    </div>
                                  )}
                                  {/* Suivi du workflow (générique : table_objet dynamique) */}
                                  <div>
                                    <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "hsl(var(--accent))" }}>Suivi de la demande</p>
                                    <SuiviDemandeWorkflow tableSource={d.table_objet} demandeId={d.id_objet} statutDemande={d.statut} />
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>}
                  </Section>
                );
              })()}

              {/* Panneau latéral : Filtres avancés (Mes demandes) */}
              {demShowFiltres && (() => {
                const types = new Map<string, string>();
                const etapes = new Set<string>();
                registreDemandes.forEach((d: any) => {
                  if (d.type_demande) types.set(d.type_demande, d.type_libelle || d.type_demande);
                  const et = d.resume?.etape_courante_libelle;
                  if (et) etapes.add(et);
                });
                const typesArr = [...types.entries()].sort((a, b) => a[1].localeCompare(b[1], "fr"));
                const etapesArr = [...etapes].sort((a, b) => a.localeCompare(b, "fr"));
                return (
                  <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "rgba(0,0,0,0.4)" }} onClick={() => setDemShowFiltres(false)}>
                    <div className="w-full max-w-md h-full flex flex-col" style={{ background: "hsl(var(--card))" }} onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "hsl(var(--border))" }}>
                        <h3 className="font-bold text-lg flex items-center gap-2"><Filter size={18} style={{ color: "hsl(var(--primary))" }} /> Filtres avancés</h3>
                        <button onClick={() => setDemShowFiltres(false)} className="p-1 rounded-lg" style={{ color: "hsl(var(--muted-foreground))" }}><X size={18} /></button>
                      </div>
                      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                        {/* Type */}
                        <div>
                          <label className="text-[12px] font-semibold uppercase tracking-wider block mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>Type de demande</label>
                          <div className="flex flex-wrap gap-1.5">
                            {typesArr.length === 0 && <span className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun</span>}
                            {typesArr.map(([val, lib]) => (
                              <button key={val} onClick={() => setDemFType(demFType === val ? "" : val)}
                                className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all"
                                style={{ background: demFType === val ? "hsl(var(--primary))" : "transparent", borderColor: demFType === val ? "hsl(var(--primary))" : "hsl(var(--border))", color: demFType === val ? "white" : "hsl(var(--foreground))" }}>
                                {lib}
                              </button>
                            ))}
                          </div>
                        </div>
                        {/* Étape courante */}
                        <div>
                          <label className="text-[12px] font-semibold uppercase tracking-wider block mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>Étape courante</label>
                          <div className="flex flex-wrap gap-1.5">
                            {etapesArr.length === 0 && <span className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune</span>}
                            {etapesArr.map(et => (
                              <button key={et} onClick={() => setDemFEtape(demFEtape === et ? "" : et)}
                                className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all"
                                style={{ background: demFEtape === et ? "hsl(var(--primary))" : "transparent", borderColor: demFEtape === et ? "hsl(var(--primary))" : "hsl(var(--border))", color: demFEtape === et ? "white" : "hsl(var(--foreground))" }}>
                                {et}
                              </button>
                            ))}
                          </div>
                        </div>
                        {/* Période */}
                        <div>
                          <label className="text-[12px] font-semibold uppercase tracking-wider block mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>Période</label>
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {([["ce_mois", "Ce mois"], ["mois_prochain", "Mois prochain"], ["cette_annee", "Cette année"]] as const).map(([k, lib]) => (
                              <button key={k} onClick={() => demRaccourci(k)} className="px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all"
                                style={{ background: "transparent", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>{lib}</button>
                            ))}
                          </div>
                          <div className="mb-2">
                            <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>Mois</span>
                            <input type="month" value={demMoisValue} onChange={e => demSetMois(e.target.value)}
                              className="w-full h-9 px-2.5 rounded-xl text-sm outline-none mt-0.5"
                              style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }} />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>Du</span>
                              <input type="date" value={demFDebut} onChange={e => setDemFDebut(e.target.value)}
                                className="w-full h-9 px-2.5 rounded-xl text-sm outline-none mt-0.5"
                                style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }} />
                            </div>
                            <div>
                              <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>Au</span>
                              <input type="date" value={demFFin} onChange={e => setDemFFin(e.target.value)}
                                className="w-full h-9 px-2.5 rounded-xl text-sm outline-none mt-0.5"
                                style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }} />
                            </div>
                          </div>
                        </div>
                        {/* Référence */}
                        <div>
                          <label className="text-[12px] font-semibold uppercase tracking-wider block mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>Référence</label>
                          <input value={demFRef} onChange={e => setDemFRef(e.target.value)} placeholder="DEM-2026-…"
                            className="w-full h-9 px-2.5 rounded-xl text-sm outline-none"
                            style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }} />
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 px-5 py-4 border-t" style={{ borderColor: "hsl(var(--border))" }}>
                        <button onClick={demResetFiltres} className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-xl" style={{ color: "hsl(var(--muted-foreground))" }}>
                          <RotateCcw size={14} /> Réinitialiser
                        </button>
                        <Button size="sm" onClick={() => setDemShowFiltres(false)} className="text-white" style={{ background: "hsl(var(--primary))" }}>
                          Appliquer{demNbFiltres > 0 ? ` (${demNbFiltres})` : ""}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
          {activeTab === "planning" && (
            <div className="space-y-5">
              <Section title="Mon planning des congés" icon={<CalendarClock size={14} />}>
                {demandes.length === 0
                  ? <EmptyState icon={<CalendarClock size={28} className="mx-auto" />} title="Aucun congé planifié" hint="Vos congés approuvés et en attente apparaîtront ici." />
                  : <PlanningAnnuel demandes={demandes} />}
              </Section>
            </div>
          )}

          {/* ════════════ COMPTEURS ════════════ */}
          {activeTab === "compteurs" && (
            <div className="space-y-5">
              <Section title={`Compteurs — Exercice ${exercice}`} icon={<PieChart size={14} />}>
                {soldes.length === 0 ? <EmptyState icon={<BarChart3 size={28} className="mx-auto" />} title="Aucun compteur" />
                  : <div className="space-y-5">
                    {soldes.map((s: any) => {
                      const acquis = s.solde_acquis || 0, pris = s.solde_pris || 0, attente = s.solde_en_attente || 0, restant = s.solde_restant || 0;
                      const pct = acquis > 0 ? Math.round((restant / acquis) * 100) : 0;
                      const color = pct <= 20 ? "hsl(0 70% 50%)" : pct <= 50 ? "hsl(38 92% 45%)" : "hsl(142 55% 45%)";
                      const joursRestantsAnnee = differenceInDays(endOfMonth(new Date(exercice, 11, 1)), new Date());
                      const aPoser = restant > 0 && joursRestantsAnnee < 90;
                      return (
                        <div key={s.code_type_conge} className="p-4 rounded-xl border" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.15)" }}>
                          <div className="flex items-center justify-between mb-3"><p className="text-sm font-bold">{s.libelle_type_conge || s.code_type_conge}</p><span className="text-2xl font-bold" style={{ color }}>{restant}j</span></div>
                          <div className="h-3 rounded-full overflow-hidden flex" style={{ background: "hsl(var(--muted))" }}>
                            {acquis > 0 && <>
                              <div className="h-full" style={{ width: `${Math.min((pris / acquis) * 100, 100)}%`, background: "hsl(var(--muted-foreground) / 0.4)" }} />
                              {attente > 0 && <div className="h-full" style={{ width: `${Math.min((attente / acquis) * 100, 100)}%`, background: "hsl(38 92% 50%)" }} />}
                              <div className="h-full flex-1" style={{ background: color, opacity: 0.3 + (pct / 100) * 0.7 }} />
                            </>}
                          </div>
                          <div className="grid grid-cols-4 gap-2 mt-3">
                            {[{ l: "Acquis", v: `${acquis}j`, c: "hsl(var(--foreground))" }, { l: "Pris", v: `${pris}j`, c: "hsl(var(--muted-foreground))" }, { l: "Attente", v: `${attente}j`, c: "hsl(38 92% 40%)" }, { l: "Restant", v: `${restant}j`, c: color }].map(x => (
                              <div key={x.l} className="text-center"><p className="text-sm font-bold" style={{ color: x.c }}>{x.v}</p><p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>{x.l}</p></div>
                            ))}
                          </div>
                          {aPoser && (
                            <div className="flex items-center gap-2 mt-3 p-2 rounded-lg text-[11px]" style={{ background: "hsl(38 92% 50% / 0.08)", color: "hsl(38 92% 35%)" }}>
                              <Hourglass size={12} /> Pensez à poser vos <strong>{restant}j</strong> avant la fin de l'exercice ({joursRestantsAnnee}j restants).
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>}
              </Section>
              <Section title="Statistiques annuelles" icon={<Activity size={14} />}>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: "Total demandes", value: statsAnnee.total, icon: <FileText size={13} />, color: "hsl(210 70% 45%)" },
                    { label: "Taux approbation", value: statsAnnee.total > 0 ? `${Math.round((statsAnnee.approuvees / statsAnnee.total) * 100)}%` : "—", icon: <Activity size={13} />, color: "hsl(142 55% 38%)" },
                    { label: "Jours approuvés", value: `${statsAnnee.joursApprouves}j`, icon: <CheckCircle2 size={13} />, color: "hsl(142 55% 38%)" },
                    { label: "Solde total restant", value: `${soldeTotal}j`, icon: <CalendarDays size={13} />, color: "hsl(var(--primary))" },
                  ].map(k => (
                    <div key={k.label} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: "hsl(var(--muted) / 0.3)", border: "1px solid hsl(var(--border))" }}>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${k.color}15`, color: k.color }}>{k.icon}</div>
                      <div><p className="text-base font-bold">{k.value}</p><p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>{k.label}</p></div>
                    </div>
                  ))}
                </div>
              </Section>
            </div>
          )}

          {/* ════════════ MON PARCOURS ════════════ */}
          {activeTab === "parcours" && (
            <div className="space-y-5">
              <Section title="Évolution de carrière" icon={<TrendingUp size={14} />}>
                {histAffectations.length === 0 ? <EmptyState icon={<TrendingUp size={28} className="mx-auto" />} title="Aucune évolution" />
                  : <div className="space-y-0">
                    {histAffectations.map((a: any, idx: number) => (
                      <div key={a.id} className="relative flex gap-3 pb-4">
                        {idx < histAffectations.length - 1 && <div className="absolute left-[9px] top-5 bottom-0 w-0.5" style={{ background: "hsl(var(--border))" }} />}
                        <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-1 z-10" style={{ background: idx === 0 ? "hsl(var(--primary))" : "hsl(var(--muted))", border: "2px solid hsl(var(--card))" }}><div className="w-2 h-2 rounded-full" style={{ background: idx === 0 ? "white" : "hsl(var(--muted-foreground))" }} /></div>
                        <div className="flex-1 pt-0.5">
                          {idx === 0 && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold mb-1 inline-block" style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}>EN COURS</span>}
                          <p className="text-xs font-semibold">{a.libelle_poste || a.code_poste || "Poste non renseigné"}</p>
                          <p className="text-[11px]" style={{ color: a.couleur_uo || "hsl(var(--muted-foreground))" }}>{a.libelle_uo || "—"}</p>
                          <p className="text-[10px] mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{a.date_debut_uo && fmt(a.date_debut_uo, "MMMM yyyy")}{a.date_fin_uo ? ` → ${fmt(a.date_fin_uo, "MMMM yyyy")}` : " → Aujourd'hui"}</p>
                        </div>
                      </div>
                    ))}
                  </div>}
              </Section>
              {classification.length > 0 && (
                <Section title="Classification" icon={<Star size={14} />}>
                  <div className="space-y-2">
                    {classification.map((c: any) => (
                      <div key={c.id} className="flex items-start gap-3 p-3 rounded-lg" style={{ background: "hsl(var(--muted) / 0.3)", border: "1px solid hsl(var(--border))" }}>
                        <div className="flex-1">
                          <p className="text-xs font-semibold">{c.libelle_categorie || c.code_categorie_pro || "Classification"}</p>
                          <div className="flex gap-4 mt-1">
                            {c.libelle_college && <InfoField label="Collège" value={c.libelle_college || c.code_college} />}
                            {c.libelle_niveau && <InfoField label="Niveau" value={c.libelle_niveau || c.code_niveau} />}
                            {c.libelle_echelon && <InfoField label="Échelon" value={c.libelle_echelon || c.code_echelon} />}
                          </div>
                          <p className="text-[10px] mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>Depuis le {c.date_debut ? fmt(c.date_debut) : "—"}{!c.date_fin && <span className="ml-2 px-1.5 py-0.5 rounded-full font-medium" style={{ background: "hsl(142 55% 45% / 0.12)", color: "hsl(142 55% 30%)" }}>Actuelle</span>}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </div>
          )}

          {/* ════════════ DOCUMENTS ════════════ */}
          {activeTab === "documents" && (
            <Section title="Mes documents" icon={<FileText size={14} />} action={
              <button onClick={() => setShowDocModal(true)} className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg hover:opacity-80" style={{ background: "hsl(var(--primary))", color: "white" }}><Plus size={11} /> Demander</button>
            }>
              {documents.length === 0
                ? <EmptyState icon={<FileText size={32} className="mx-auto" />} title="Aucun document disponible" hint="Vos bulletins de paie et attestations apparaîtront ici. Vous pouvez en faire la demande via le bouton ci-dessus." />
                : <div className="space-y-2">
                  {documents.map((doc: any) => (
                    <div key={doc.id} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: "hsl(var(--muted) / 0.3)", border: "1px solid hsl(var(--border))" }}>
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}><FileText size={16} /></div>
                      <div className="flex-1 min-w-0"><p className="text-xs font-semibold truncate">{doc.libelle || doc.nom_fichier || doc.type_document || "Document"}</p><p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>{doc.created_at && fmt(doc.created_at, "dd/MM/yyyy")}{doc.type_document ? ` · ${doc.type_document}` : ""}</p></div>
                      {(doc.fichier_path || doc.url) && <a href={doc.url || `/api/v1/storage/${doc.fichier_path}`} target="_blank" rel="noreferrer" className="p-2 rounded-lg hover:opacity-70" style={{ background: "hsl(var(--muted))", color: "hsl(var(--foreground))" }}><Download size={14} /></a>}
                    </div>
                  ))}
                </div>}
            </Section>
          )}

          {/* ════════════ NOTIFICATIONS ════════════ */}
          {activeTab === "notifications" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{nonLues} non lue{nonLues > 1 ? "s" : ""} · {notifications.length} au total</p>
                  <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
                    {(["TOUTES", "NON_LUES"] as const).map(f => (
                      <button key={f} onClick={() => setNotifFilter(f)} className="px-2 py-0.5 text-[10px] font-medium transition-all" style={{ background: notifFilter === f ? "hsl(var(--primary))" : "transparent", color: notifFilter === f ? "white" : "hsl(var(--muted-foreground))" }}>{f === "TOUTES" ? "Toutes" : "Non lues"}</button>
                    ))}
                  </div>
                </div>
                {nonLues > 0 && <button onClick={marquerToutLu} className="text-[11px] font-medium flex items-center gap-1 hover:opacity-70" style={{ color: "hsl(var(--primary))" }}><Check size={11} /> Tout marquer lu</button>}
              </div>
              {notifsAffichees.length === 0
                ? <EmptyState icon={<Bell size={32} className="mx-auto" />} title="Aucune notification" />
                : <div className="space-y-4">
                  {(["Aujourd'hui", "Cette semaine", "Plus ancien"] as const).map(grp => notifGroups[grp].length > 0 && (
                    <div key={grp}>
                      <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>{grp}</p>
                      <div className="space-y-2">
                        {notifGroups[grp].map((n: any) => {
                          const cfgN: Record<string, { color: string; bg: string }> = { success: { color: "hsl(142 55% 30%)", bg: "hsl(142 55% 45% / 0.08)" }, warning: { color: "hsl(38 92% 38%)", bg: "hsl(38 92% 50% / 0.08)" }, error: { color: "hsl(0 70% 42%)", bg: "hsl(0 70% 50% / 0.07)" }, info: { color: "hsl(210 70% 40%)", bg: "hsl(210 70% 50% / 0.08)" } };
                          const cn = cfgN[n.type] ?? cfgN.info;
                          return (
                            <div key={n.id} className="flex items-start gap-3 p-3 rounded-xl transition-all" style={{ background: n.lu ? "hsl(var(--muted) / 0.2)" : cn.bg, border: `1px solid ${n.lu ? "hsl(var(--border))" : cn.color + "33"}`, opacity: n.lu ? 0.7 : 1 }}>
                              <div className="flex-1 min-w-0"><p className="text-xs font-semibold">{n.titre}</p><p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: "hsl(var(--muted-foreground))" }}>{n.message}</p><p className="text-[10px] mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>{n.created_at && fmt(n.created_at, "dd/MM/yyyy HH:mm")}</p></div>
                              {!n.lu && <button onClick={() => marquerLu(n.id)} className="p-1 rounded-md hover:opacity-70 flex-shrink-0" style={{ color: "hsl(var(--muted-foreground))" }}><Check size={12} /></button>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>}
            </div>
          )}

        </div>

        {showDemandeForm && collabId && (
          <Dialog open={showDemandeForm} onOpenChange={setShowDemandeForm}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Nouvelle demande de congé</DialogTitle>
              </DialogHeader>
              <DemandeCongeForm
                collaborateurId={collabId}
                exercice={exercice}
                onCancel={() => setShowDemandeForm(false)}
                onSuccess={() => { setShowDemandeForm(false); refetchDemandes(); qc.invalidateQueries({ queryKey: ["mes-soldes"] }); }}
              />
            </DialogContent>
          </Dialog>
        )}
        {showDocModal && (
          <DemandeDocumentModal collab={collab ?? null} rhEmail={(profile as any)?.rh_email} onClose={() => setShowDocModal(false)} />
        )}

        {/* Panneau Filtres avancés — Congés (style maison, calqué sur Collaborateurs) */}
        {showCongeFiltres && (
          <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "hsl(0 0% 0% / 0.5)" }} onClick={(e) => { if (e.target === e.currentTarget) setShowCongeFiltres(false); }}>
            <div className="w-full max-w-md h-full flex flex-col shadow-2xl" style={{ background: "hsl(var(--card))", borderLeft: "1px solid hsl(var(--border))" }}>
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "hsl(var(--border))" }}>
                <div className="flex items-center gap-2">
                  <Filter size={18} style={{ color: "hsl(var(--accent))" }} />
                  <h2 className="font-semibold text-base" style={{ color: "hsl(var(--foreground))" }}>Filtres avancés</h2>
                </div>
                <button onClick={() => setShowCongeFiltres(false)} className="p-1.5 rounded-lg hover:bg-muted transition-colors" type="button">
                  <X size={16} style={{ color: "hsl(var(--muted-foreground))" }} />
                </button>
              </div>

              {/* Body scrollable */}
              <div className="overflow-y-auto flex-1 px-6 py-5 space-y-6">
                {/* Type de congé */}
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider mb-2.5" style={{ color: "hsl(var(--accent))" }}>Type de congé</p>
                  <div className="flex gap-2 flex-wrap">
                    {[{ code: "TOUS", libelle: "Tous les types" }, ...congeTypeOptions].map(t => (
                      <button key={t.code} onClick={() => setCongeFiltreType(t.code)} className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all" type="button"
                        style={{ background: congeFiltreType === t.code ? "hsl(var(--accent))" : "transparent", borderColor: congeFiltreType === t.code ? "hsl(var(--accent))" : "hsl(var(--border))", color: congeFiltreType === t.code ? "white" : "hsl(var(--foreground))" }}>
                        {t.libelle}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Exercice */}
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider mb-2.5" style={{ color: "hsl(var(--accent))" }}>Exercice</p>
                  <div className="flex gap-2 flex-wrap">
                    {["TOUS", ...congeExerciceOptions.map(String)].map(a => (
                      <button key={a} onClick={() => setCongeFiltreExercice(a)} className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all" type="button"
                        style={{ background: congeFiltreExercice === a ? "hsl(var(--accent))" : "transparent", borderColor: congeFiltreExercice === a ? "hsl(var(--accent))" : "hsl(var(--border))", color: congeFiltreExercice === a ? "white" : "hsl(var(--foreground))" }}>
                        {a === "TOUS" ? "Toutes les années" : a}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Période */}
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider mb-2.5" style={{ color: "hsl(var(--accent))" }}>Période</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Du</label>
                      <Input type="date" value={congeFiltreDebut} onChange={e => setCongeFiltreDebut(e.target.value)} className="text-sm" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Au</label>
                      <Input type="date" value={congeFiltreFin} onChange={e => setCongeFiltreFin(e.target.value)} className="text-sm" />
                    </div>
                  </div>
                  <p className="text-[10px] mt-1.5" style={{ color: "hsl(var(--muted-foreground))" }}>Affiche les congés qui recoupent cette période.</p>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-6 py-4 border-t" style={{ borderColor: "hsl(var(--border))" }}>
                <button onClick={resetCongeFiltres} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors" type="button" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
                  <RotateCcw size={12} /> Réinitialiser
                </button>
                <button onClick={() => setShowCongeFiltres(false)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors" type="button" style={{ background: "hsl(var(--accent))", color: "white" }}>
                  <Check size={14} /> Appliquer
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DensityCtx.Provider>
  );
}
