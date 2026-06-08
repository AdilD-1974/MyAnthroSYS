/**
 * MonEspacePage.tsx — Portail self-service multi-rôles
 * - Sélecteur de profil (dropdown) si plusieurs rôles
 * - Contenu et navigation adaptés selon le rôle actif
 */

import React, { useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Home, Briefcase, CalendarDays, FileText, Bell, User, Building2,
  Clock, CheckCircle2, XCircle, AlertTriangle, ChevronRight, Download,
  Plus, Send, RefreshCw, TrendingUp, Award, Phone, MapPin, Heart,
  ArrowUpRight, Sparkles, Shield, BookOpen, BarChart3, X, Check, Info,
  PieChart, Activity, Star, Users, ChevronDown, UserCircle2, Settings,
  LayoutDashboard, UserCheck, Calculator, ChevronUp,
} from "lucide-react";
import {
  format, parseISO, differenceInDays, differenceInMonths,
  differenceInYears, addDays, isAfter, isBefore,
} from "date-fns";
import { fr } from "date-fns/locale";

// ── Types ─────────────────────────────────────────────────────────────────────
type AppRole = "administrateur" | "gestionnaire_rh" | "gestionnaire_paie" | "manager" | "collaborateur";

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
  icon: React.ReactNode; redirectPath?: string;
  description: string;
}> = {
  administrateur:    { label: "Administrateur",    color: "hsl(213 73% 40%)", bg: "hsl(213 73% 40% / 0.1)", border: "hsl(213 73% 40% / 0.3)", icon: <Settings size={14} />,      redirectPath: "/",                    description: "Accès complet à toutes les fonctionnalités" },
  gestionnaire_rh:   { label: "Gestionnaire RH",   color: "hsl(197 100% 38%)",bg: "hsl(197 100% 38% / 0.1)",border: "hsl(197 100% 38% / 0.3)",icon: <UserCheck size={14} />,     redirectPath: "/collaborateurs",      description: "Gestion des collaborateurs et congés" },
  gestionnaire_paie: { label: "Gestionnaire Paie", color: "hsl(84 55% 38%)",  bg: "hsl(84 55% 38% / 0.1)",  border: "hsl(84 55% 38% / 0.3)",  icon: <Calculator size={14} />,    redirectPath: "/paie",                description: "Gestion de la paie et déclarations" },
  manager:           { label: "Manager",           color: "hsl(39 95% 42%)",  bg: "hsl(39 95% 42% / 0.1)",  border: "hsl(39 95% 42% / 0.3)",  icon: <Briefcase size={14} />,     redirectPath: "/espace-manager",      description: "Validation équipe et planning" },
  collaborateur:     { label: "Collaborateur",     color: "hsl(215 20% 45%)", bg: "hsl(215 20% 45% / 0.1)", border: "hsl(215 20% 45% / 0.3)", icon: <UserCircle2 size={14} />,   redirectPath: "/mon-espace",          description: "Espace self-service collaborateur" },
};

// Onglets selon le rôle
const TABS_BY_ROLE: Record<string, { id: string; label: string; icon: React.ComponentType<{size?: number}> }[]> = {
  collaborateur: [
    { id: "accueil",       label: "Accueil",        icon: Home },
    { id: "dossier",       label: "Mon dossier",    icon: User },
    { id: "conges",        label: "Congés",         icon: CalendarDays },
    { id: "compteurs",     label: "Compteurs",      icon: BarChart3 },
    { id: "parcours",      label: "Mon parcours",   icon: TrendingUp },
    { id: "documents",     label: "Documents",      icon: FileText },
    { id: "notifications", label: "Notifications",  icon: Bell },
  ],
  manager: [
    { id: "accueil",       label: "Accueil",        icon: Home },
    { id: "equipe",        label: "Mon équipe",     icon: Users },
    { id: "conges",        label: "Congés équipe",  icon: CalendarDays },
    { id: "dossier",       label: "Mon dossier",    icon: User },
    { id: "notifications", label: "Notifications",  icon: Bell },
  ],
  default: [
    { id: "accueil",       label: "Accueil",        icon: Home },
    { id: "dossier",       label: "Mon dossier",    icon: User },
    { id: "notifications", label: "Notifications",  icon: Bell },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const normTxt = (s: string) =>
  (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function AncienneteText({ dateDebut }: { dateDebut?: string }) {
  if (!dateDebut) return null;
  const d = parseISO(dateDebut);
  const now = new Date();
  const ans = differenceInYears(now, d);
  const mois = differenceInMonths(now, d) % 12;
  if (ans === 0 && mois === 0) return <span>Moins d'un mois</span>;
  return <span>{ans > 0 ? `${ans} an${ans > 1 ? "s" : ""}` : ""}{ans > 0 && mois > 0 ? " et " : ""}{mois > 0 ? `${mois} mois` : ""}</span>;
}

function InfoField({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</p>
      <p className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>{value || "—"}</p>
    </div>
  );
}

function Section({ title, icon, children, action }: {
  title: string; icon?: React.ReactNode; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}>
      <div className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
        <div className="flex items-center gap-2">
          {icon && <span style={{ color: "hsl(var(--accent))" }}>{icon}</span>}
          <h3 className="text-xs font-bold uppercase tracking-wider">{title}</h3>
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

const STATUT_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  EN_ATTENTE: { label: "En attente",  color: "hsl(38 92% 38%)",  bg: "hsl(38 92% 50% / 0.12)" },
  APPROUVEE:  { label: "Approuvée",   color: "hsl(142 55% 30%)", bg: "hsl(142 55% 45% / 0.12)" },
  REFUSEE:    { label: "Refusée",     color: "hsl(0 70% 42%)",   bg: "hsl(0 70% 50% / 0.10)" },
  ANNULEE:    { label: "Annulée",     color: "hsl(var(--muted-foreground))", bg: "hsl(var(--muted))" },
};
function StatutBadge({ statut }: { statut: string }) {
  const c = STATUT_BADGE[statut] ?? { label: statut, color: "hsl(var(--muted-foreground))", bg: "hsl(var(--muted))" };
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{ background: c.bg, color: c.color }}>{c.label}</span>
  );
}

// ── Sélecteur de profil (dropdown multi-rôles) ────────────────────────────────
function ProfileSwitcher({
  roles, activeRole, onSwitch, collab,
}: {
  roles: AppRole[]; activeRole: AppRole; onSwitch: (r: AppRole) => void; collab: Collaborateur | null;
}) {
  const [open, setOpen] = useState(false);
  const active = ROLE_CFG[activeRole];
  const photoUrl = collab?.photo_path || collab?.photo_url
    ? ((collab.photo_path || collab.photo_url)!.startsWith("http") || (collab.photo_path || collab.photo_url)!.startsWith("/")
      ? (collab.photo_path || collab.photo_url)
      : `/api/v1/storage/${collab.photo_path || collab.photo_url}`)
    : null;
  const initiales = collab ? `${collab.prenom?.[0] ?? ""}${collab.nom?.[0] ?? ""}` : "?";
  const nomComplet = collab ? `${collab.civilite ? collab.civilite + " " : ""}${collab.prenom} ${collab.nom}` : "Collaborateur";

  if (roles.length <= 1) {
    return (
      <div className="flex items-center gap-3">
        <div className="relative">
          {photoUrl
            ? <img src={photoUrl} alt={initiales} className="w-14 h-14 rounded-2xl object-cover shadow-xl" style={{ border: "2px solid rgba(255,255,255,0.25)" }} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
            : <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-bold shadow-xl" style={{ background: "linear-gradient(135deg, hsl(200 70% 55%), hsl(220 60% 50%))", color: "white", border: "2px solid rgba(255,255,255,0.2)" }}>{initiales}</div>
          }
          <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white" style={{ background: "hsl(142 55% 45%)" }} />
        </div>
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
        <div className="relative">
          {photoUrl
            ? <img src={photoUrl} alt={initiales} className="w-14 h-14 rounded-2xl object-cover shadow-xl" style={{ border: "2px solid rgba(255,255,255,0.25)" }} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
            : <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-bold shadow-xl" style={{ background: "linear-gradient(135deg, hsl(200 70% 55%), hsl(220 60% 50%))", color: "white", border: "2px solid rgba(255,255,255,0.2)" }}>{initiales}</div>
          }
          <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white" style={{ background: "hsl(142 55% 45%)" }} />
        </div>
        <div>
          <p className="text-xl font-bold text-white leading-tight">{nomComplet}</p>
          {/* Dropdown trigger */}
          <button
            onClick={() => setOpen(o => !o)}
            className="flex items-center gap-1.5 mt-1 px-2.5 py-1 rounded-lg transition-all hover:opacity-80"
            style={{ background: active.bg, border: `1px solid ${active.border}` }}>
            <span style={{ color: active.color }}>{active.icon}</span>
            <span className="text-xs font-semibold" style={{ color: active.color }}>{active.label}</span>
            {open ? <ChevronUp size={11} style={{ color: active.color }} /> : <ChevronDown size={11} style={{ color: active.color }} />}
            <span className="text-[9px] ml-1 px-1 rounded-full font-bold text-white" style={{ background: active.color }}>{roles.length}</span>
          </button>
        </div>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 mt-2 w-72 rounded-2xl shadow-2xl z-50 overflow-hidden"
          style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
          <div className="px-4 py-3 border-b" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.5)" }}>
            <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>
              Changer de profil
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
              {roles.length} profil{roles.length > 1 ? "s" : ""} disponible{roles.length > 1 ? "s" : ""}
            </p>
          </div>
          <div className="py-1.5">
            {roles.map(r => {
              const cfg = ROLE_CFG[r];
              const isActive = r === activeRole;
              return (
                <button key={r}
                  onClick={() => { onSwitch(r); setOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-3 transition-all hover:opacity-80 text-left"
                  style={{ background: isActive ? cfg.bg : "transparent" }}>
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color }}>
                    {cfg.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold" style={{ color: isActive ? cfg.color : "hsl(var(--foreground))" }}>
                      {cfg.label}
                    </p>
                    <p className="text-[10px] leading-tight" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {cfg.description}
                    </p>
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

// ── Mini formulaire demande ───────────────────────────────────────────────────
function MiniDemandeForm({ collabId, soldes, onClose, onSuccess }: {
  collabId: string; soldes: any[]; onClose: () => void; onSuccess: () => void;
}) {
  const [form, setForm] = useState({ code_type_conge: "", date_debut: "", date_fin_absence: "", motif: "" });
  const [submitting, setSubmitting] = useState(false);
  const { data: typesConge = [] } = useQuery<any[]>({
    queryKey: ["ref-type-conge-mini"],
    queryFn: async () => await api.get("/db/ref_type_conge?actif=eq.true&order=ordre,libelle") || [],
    staleTime: 10 * 60 * 1000,
  });
  const soldeSelectionne = soldes.find(s => s.code_type_conge === form.code_type_conge);
  const nbJours = form.date_debut && form.date_fin_absence && form.date_fin_absence >= form.date_debut
    ? differenceInDays(parseISO(form.date_fin_absence), parseISO(form.date_debut)) + 1 : 0;
  const handleSubmit = async () => {
    if (!form.code_type_conge || !form.date_debut || !form.date_fin_absence || nbJours <= 0) return;
    setSubmitting(true);
    try {
      await api.post("/db/cong_demande", {
        collaborateur_id: collabId, code_type_conge: form.code_type_conge,
        date_debut: form.date_debut, date_fin_absence: form.date_fin_absence,
        date_retour: form.date_fin_absence, statut: "EN_ATTENTE",
        date_soumission: new Date().toISOString().split("T")[0],
        commentaire_collaborateur: form.motif || null,
        nbr_jours_calendaires: nbJours, nbr_jours_decomptes: nbJours,
      });
      toast({ title: "Demande soumise avec succès" });
      onSuccess();
    } catch (e: any) { toast({ title: "Erreur", description: e.message, variant: "destructive" }); }
    finally { setSubmitting(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "hsl(var(--background) / 0.85)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
          <div className="flex items-center gap-2"><Plus size={15} style={{ color: "hsl(var(--primary))" }} /><h2 className="text-sm font-bold">Nouvelle demande de congé</h2></div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:opacity-70" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}><X size={15} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <Label className="text-xs font-semibold mb-1.5 block">Type de congé *</Label>
            <select value={form.code_type_conge} onChange={e => setForm(f => ({ ...f, code_type_conge: e.target.value }))}
              className="w-full h-9 text-sm rounded-lg border px-3"
              style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
              <option value="">— Sélectionner —</option>
              {typesConge.map((t: any) => <option key={t.code} value={t.code}>{t.libelle}</option>)}
            </select>
            {soldeSelectionne && (
              <div className="mt-1.5 flex items-center gap-2 text-[11px]">
                <span style={{ color: "hsl(var(--muted-foreground))" }}>Solde disponible :</span>
                <span className="font-bold" style={{ color: soldeSelectionne.solde_restant > 0 ? "hsl(142 55% 35%)" : "hsl(0 70% 45%)" }}>{soldeSelectionne.solde_restant}j</span>
                {soldeSelectionne.solde_en_attente > 0 && <span style={{ color: "hsl(38 92% 40%)" }}>· {soldeSelectionne.solde_en_attente}j en attente</span>}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs font-semibold mb-1.5 block">Date de début *</Label>
              <Input type="date" value={form.date_debut} min={format(new Date(), "yyyy-MM-dd")} onChange={e => setForm(f => ({ ...f, date_debut: e.target.value }))} className="h-9 text-sm" /></div>
            <div><Label className="text-xs font-semibold mb-1.5 block">Date de fin *</Label>
              <Input type="date" value={form.date_fin_absence} min={form.date_debut || format(new Date(), "yyyy-MM-dd")} onChange={e => setForm(f => ({ ...f, date_fin_absence: e.target.value }))} className="h-9 text-sm" /></div>
          </div>
          {nbJours > 0 && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg" style={{ background: "hsl(var(--primary) / 0.07)", border: "1px solid hsl(var(--primary) / 0.2)" }}>
              <CalendarDays size={12} style={{ color: "hsl(var(--primary))" }} />
              <span className="text-xs font-medium" style={{ color: "hsl(var(--primary))" }}>
                <strong>{nbJours}</strong> jour(s) calendaires
                {soldeSelectionne && nbJours > soldeSelectionne.solde_restant && <span className="ml-2" style={{ color: "hsl(0 70% 45%)" }}>⚠ Solde insuffisant</span>}
              </span>
            </div>
          )}
          <div>
            <Label className="text-xs font-semibold mb-1.5 block">Motif (optionnel)</Label>
            <textarea value={form.motif} onChange={e => setForm(f => ({ ...f, motif: e.target.value }))} rows={2}
              className="w-full rounded-lg border px-3 py-2 text-sm resize-none outline-none"
              style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}
              placeholder="Motif de la demande…" />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: "hsl(var(--border))" }}>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Annuler</Button>
          <Button onClick={handleSubmit} disabled={submitting || !form.code_type_conge || nbJours <= 0} style={{ background: "hsl(var(--primary))", color: "white" }}>
            <Send size={13} className="mr-1.5" />{submitting ? "Envoi…" : "Soumettre"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPOSANT PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
export default function MonEspacePage() {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("accueil");
  const [showDemandeForm, setShowDemandeForm] = useState(false);
  const [filterDemande, setFilterDemande] = useState("TOUS");
  const exercice = new Date().getFullYear();

  // ── Rôles de l'utilisateur ────────────────────────────────────────────────
  const userRoles: AppRole[] = useMemo(() => {
    const r = (profile as any)?.roles ?? (user as any)?.roles ?? [];
    return Array.isArray(r) && r.length > 0 ? r : ["collaborateur"];
  }, [profile, user]);

  const [activeRole, setActiveRole] = useState<AppRole>(() => {
    // Priorité : collaborateur si disponible pour cet espace
    if (userRoles.includes("collaborateur")) return "collaborateur";
    return userRoles[0] ?? "collaborateur";
  });

  const tabs = TABS_BY_ROLE[activeRole] ?? TABS_BY_ROLE.default;

  // Quand le rôle change, rediriger si nécessaire ou rester sur Mon espace
  const handleRoleSwitch = useCallback((role: AppRole) => {
    setActiveRole(role);
    setActiveTab("accueil");
    const cfg = ROLE_CFG[role];
    // Si le rôle n'est pas collaborateur, proposer la redirection
    if (role !== "collaborateur" && cfg.redirectPath && cfg.redirectPath !== "/mon-espace") {
      // On reste dans MonEspace mais on change l'affichage
    }
  }, [navigate]);

  // ── Résolution collaborateur ──────────────────────────────────────────────
  const collabIdFromAuth = (profile as any)?.collaborateur_id ?? (user as any)?.collaborateur_id ?? null;
  const { data: profileData } = useQuery<any>({
    queryKey: ["mon-profile", user?.id],
    enabled: !!user?.id && !collabIdFromAuth,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      try { const r: any[] = await api.get(`/db/profiles?user_id=eq.${user!.id}&limit=1`); return r?.[0] ?? null; }
      catch { return null; }
    },
  });
  const collabIdResolved = collabIdFromAuth ?? profileData?.collaborateur_id ?? null;
  const { data: collab } = useQuery<Collaborateur | null>({
    queryKey: ["mon-collab", collabIdResolved],
    enabled: !!collabIdResolved,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => { const r: any[] = await api.get(`/db/collaborateurs?id=eq.${collabIdResolved}&limit=1`); return r?.[0] ?? null; },
  });
  const collabId = collabIdResolved ?? collab?.id ?? null;

  // ── Données ───────────────────────────────────────────────────────────────
  const { data: contrat } = useQuery<any>({
    queryKey: ["mon-contrat", collabId], enabled: !!collabId, staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const r: any[] = await api.get(`/db/collaborateur_contrats?collaborateur_id=eq.${collabId}&archive=eq.false&order=date_debut.desc&limit=1`) || [];
      const ct = r?.[0] ?? null;
      if (ct?.code_type_contrat) {
        try { const t: any[] = await api.get(`/db/ref_type_contrat?code=eq.${ct.code_type_contrat}&select=code,libelle,couleur&limit=1`); if (t?.[0]) { ct.libelle_type_contrat = t[0].libelle; ct.couleur = t[0].couleur; } } catch { /* */ }
      }
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
      if (aff.unite_id) { try { const u: any[] = await api.get(`/db/unites_organisationnelles?id=eq.${aff.unite_id}&limit=1`); if (u?.[0]) { aff.libelle_uo = u[0].libelle || u[0].intitule || u[0].nom; aff.couleur_uo = u[0].couleur; } } catch { /* */ } }
      if (aff.code_poste) { try { const p: any[] = await api.get(`/db/ref_poste?code=eq.${String(aff.code_poste).split("-")[0]}&limit=1`); if (p?.[0]) { aff.libelle_poste = p[0].libelle || p[0].intitule; } } catch { /* */ } }
      return aff;
    },
  });

  const { data: soldes = [] } = useQuery<any[]>({
    queryKey: ["mes-soldes", collabId, exercice], enabled: !!collabId, staleTime: 2 * 60 * 1000,
    queryFn: async () => await api.get(`/db/cong_solde?collaborateur_id=eq.${collabId}&exercice=eq.${exercice}&archive=eq.false`) || [],
  });

  const { data: demandes = [], refetch: refetchDemandes } = useQuery<any[]>({
    queryKey: ["mes-demandes", collabId], enabled: !!collabId, staleTime: 1 * 60 * 1000,
    queryFn: async () => await api.get(`/db/cong_demande?collaborateur_id=eq.${collabId}&archive=eq.false&order=created_at.desc`) || [],
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
      if (uniteIds.length) { try { const u: any[] = await api.get(`/db/unites_organisationnelles?id=in.(${uniteIds.join(",")})&select=id,libelle,intitule,nom,couleur`) || []; u.forEach((x: any) => { uoMap[x.id] = x; }); } catch { /* */ } }
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

  // Dossier complet
  const { data: adresses = [] } = useQuery<any[]>({ queryKey: ["mes-adresses", collabId], enabled: !!collabId && activeTab === "dossier", staleTime: 5 * 60 * 1000, queryFn: async () => await api.get(`/db/collaborateur_adresses?collaborateur_id=eq.${collabId}&archive=eq.false&order=type_adresse`).catch(() => []) || [] });
  const { data: famille } = useQuery<any>({ queryKey: ["ma-famille", collabId], enabled: !!collabId && activeTab === "dossier", staleTime: 5 * 60 * 1000, queryFn: async () => { const [conjoints, enfants] = await Promise.all([api.get(`/db/collaborateur_conjoints?collaborateur_id=eq.${collabId}&archive=eq.false`).catch(() => []), api.get(`/db/collaborateur_enfants?collaborateur_id=eq.${collabId}&archive=eq.false&order=date_naissance`).catch(() => [])]); return { conjoints: conjoints || [], enfants: enfants || [] }; } });
  const { data: immatriculations = [] } = useQuery<any[]>({ queryKey: ["mes-immat", collabId], enabled: !!collabId && activeTab === "dossier", staleTime: 5 * 60 * 1000, queryFn: async () => await api.get(`/db/collaborateur_regime?collaborateur_id=eq.${collabId}`).catch(() => []) || [] });

  // ── Computed ──────────────────────────────────────────────────────────────
  const nonLues = notifications.filter((n: any) => !n.lu).length;
  const demandesEnAttente = demandes.filter((d: any) => d.statut === "EN_ATTENTE").length;
  const soldeTotal = soldes.reduce((acc: number, s: any) => acc + (s.solde_restant ?? 0), 0);
  const demandesFiltrees = useMemo(() => filterDemande === "TOUS" ? demandes : demandes.filter((d: any) => d.statut === filterDemande), [demandes, filterDemande]);
  const congesAVenir = useMemo(() => demandes.filter((d: any) => d.statut === "APPROUVEE" && isAfter(parseISO(d.date_debut), new Date()) && isBefore(parseISO(d.date_debut), addDays(new Date(), 60))).sort((a: any, b: any) => a.date_debut.localeCompare(b.date_debut)), [demandes]);
  const statsAnnee = useMemo(() => {
    const a = demandes.filter((d: any) => d.date_soumission?.startsWith(String(exercice)));
    return { total: a.length, approuvees: a.filter((d: any) => d.statut === "APPROUVEE").length, refusees: a.filter((d: any) => d.statut === "REFUSEE").length, joursApprouves: a.filter((d: any) => d.statut === "APPROUVEE").reduce((acc: number, d: any) => acc + (d.nbr_jours_decomptes || 0), 0) };
  }, [demandes, exercice]);

  const marquerLu = async (id: string) => { try { await api.patch(`/db/notifications?id=eq.${id}`, { lu: true }); qc.invalidateQueries({ queryKey: ["mes-notifications"] }); } catch { /* */ } };
  const marquerToutLu = async () => { if (!collabId) return; try { await api.patch(`/db/notifications?collaborateur_id=eq.${collabId}&lu=eq.false`, { lu: true }); qc.invalidateQueries({ queryKey: ["mes-notifications"] }); } catch { /* */ } };

  // ── Render helpers ────────────────────────────────────────────────────────
  const photoUrl = collab?.photo_path || collab?.photo_url
    ? ((collab.photo_path || collab.photo_url)!.startsWith("http") || (collab.photo_path || collab.photo_url)!.startsWith("/")
      ? (collab.photo_path || collab.photo_url)
      : `/api/v1/storage/${collab?.photo_path || collab?.photo_url}`)
    : null;

  const nomComplet = collab
    ? `${collab.civilite ? collab.civilite + " " : ""}${collab.prenom} ${collab.nom}`
    : (profile as any) ? `${(profile as any).prenom ?? ""} ${(profile as any).nom ?? ""}` : "Collaborateur";

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ background: "hsl(var(--background))" }}>

      {/* ── Header ── */}
      <div className="relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, hsl(220 60% 18%) 0%, hsl(220 50% 28%) 60%, hsl(200 55% 32%) 100%)" }}>
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(circle at 20% 50%, white 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
        <div className="absolute top-0 right-0 w-64 h-64 rounded-full opacity-10" style={{ background: "hsl(200 80% 60%)", transform: "translate(30%, -30%)", filter: "blur(40px)" }} />

        <div className="relative px-6 pt-5 pb-0">
          <div className="flex items-start justify-between gap-4">
            {/* Profile Switcher */}
            <div className="flex items-start gap-4 flex-1 min-w-0">
              <ProfileSwitcher
                roles={userRoles}
                activeRole={activeRole}
                onSwitch={handleRoleSwitch}
                collab={collab ?? null}
              />

              {/* Infos contextuelles */}
              <div className="flex flex-col gap-1.5 pt-2 flex-1 min-w-0">
                {collab?.matricule && (
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-md w-fit" style={{ background: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.75)" }}>#{collab.matricule}</span>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  {affectation?.libelle_uo && (
                    <span className="text-[11px] flex items-center gap-1" style={{ color: affectation.couleur_uo || "rgba(255,255,255,0.7)" }}>
                      <Building2 size={10} />{affectation.libelle_uo}
                    </span>
                  )}
                  {affectation?.libelle_poste && (
                    <span className="text-[11px] text-white/60 flex items-center gap-1">
                      <Briefcase size={10} />{affectation.libelle_poste}
                    </span>
                  )}
                  {contrat?.date_debut && (
                    <span className="text-[11px] text-white/55 flex items-center gap-1">
                      <Award size={10} /><AncienneteText dateDebut={contrat.date_debut} /> d'ancienneté
                    </span>
                  )}
                </div>

                {/* Lien vers espace dédié si rôle non-collaborateur */}
                {activeRole !== "collaborateur" && ROLE_CFG[activeRole]?.redirectPath && (
                  <button onClick={() => navigate(ROLE_CFG[activeRole].redirectPath!)}
                    className="mt-1 flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg w-fit hover:opacity-80 transition-all"
                    style={{ background: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.8)", border: "1px solid rgba(255,255,255,0.2)" }}>
                    <ArrowUpRight size={11} />
                    Accéder à l'espace {ROLE_CFG[activeRole].label}
                  </button>
                )}
              </div>
            </div>

            {/* KPIs */}
            <div className="flex gap-2 flex-shrink-0">
              {[
                { label: "Solde congés", value: `${soldeTotal}j`, color: "hsl(142 55% 65%)", tab: "conges" },
                { label: "En attente",   value: demandesEnAttente, color: "hsl(38 92% 65%)",  tab: "conges" },
                { label: "Notifs",       value: nonLues, color: nonLues > 0 ? "hsl(0 70% 65%)" : "hsl(200 60% 65%)", tab: "notifications" },
              ].map(k => (
                <button key={k.label} onClick={() => { setActiveTab(k.tab); }}
                  className="flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all hover:scale-105"
                  style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)" }}>
                  <span className="text-base font-bold text-white leading-none">{k.value}</span>
                  <span className="text-[9px] text-white/60 leading-none">{k.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Onglets */}
          <div className="flex gap-0 mt-5 -mx-6 px-6 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            {tabs.map(tab => {
              const isActive = activeTab === tab.id;
              const hasBadge = tab.id === "notifications" && nonLues > 0;
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className="relative flex items-center gap-1.5 px-4 py-3 text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0"
                  style={{ color: isActive ? "white" : "rgba(255,255,255,0.55)", borderBottom: isActive ? "2px solid white" : "2px solid transparent", background: isActive ? "rgba(255,255,255,0.08)" : "transparent" }}>
                  <tab.icon size={13} />
                  {tab.label}
                  {hasBadge && <span className="w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center" style={{ background: "hsl(0 70% 50%)", color: "white" }}>{nonLues}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Contenu ── */}
      <div className="px-6 py-6 max-w-5xl mx-auto space-y-5">

        {/* Bandeau rôle actif non-collaborateur */}
        {activeRole !== "collaborateur" && (
          <div className="flex items-center gap-3 p-3.5 rounded-xl"
            style={{ background: ROLE_CFG[activeRole].bg, border: `1px solid ${ROLE_CFG[activeRole].border}` }}>
            <span style={{ color: ROLE_CFG[activeRole].color }}>{ROLE_CFG[activeRole].icon}</span>
            <div className="flex-1">
              <p className="text-xs font-semibold" style={{ color: ROLE_CFG[activeRole].color }}>
                Vous consultez votre espace en tant que <strong>{ROLE_CFG[activeRole].label}</strong>
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                {ROLE_CFG[activeRole].description}
              </p>
            </div>
            {ROLE_CFG[activeRole].redirectPath && (
              <button onClick={() => navigate(ROLE_CFG[activeRole].redirectPath!)}
                className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg hover:opacity-80"
                style={{ background: ROLE_CFG[activeRole].color, color: "white" }}>
                Accéder <ArrowUpRight size={11} />
              </button>
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
            {congesAVenir.length > 0 && (
              <div className="p-4 rounded-xl" style={{ background: "hsl(142 55% 45% / 0.08)", border: "1px solid hsl(142 55% 45% / 0.25)" }}>
                <div className="flex items-center gap-2 mb-2"><CalendarDays size={13} style={{ color: "hsl(142 55% 35%)" }} /><p className="text-xs font-bold" style={{ color: "hsl(142 55% 30%)" }}>Congé{congesAVenir.length > 1 ? "s" : ""} à venir (60j)</p></div>
                <div className="space-y-1.5">
                  {congesAVenir.map((d: any) => (
                    <div key={d.id} className="flex items-center gap-3 text-xs">
                      <span className="font-bold w-20 flex-shrink-0" style={{ color: "hsl(142 55% 30%)" }}>{format(parseISO(d.date_debut), "dd MMM", { locale: fr })}</span>
                      <span style={{ color: "hsl(var(--muted-foreground))" }}>→</span>
                      <span>{format(parseISO(d.date_fin_absence), "dd MMM yyyy", { locale: fr })}</span>
                      <span className="ml-auto font-semibold" style={{ color: "hsl(142 55% 35%)" }}>{d.nbr_jours_decomptes}j</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Stats */}
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
            {/* Soldes */}
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
                        <div className="flex items-start justify-between mb-2">
                          <p className="text-xs font-semibold flex-1 pr-2">{s.libelle_type_conge || s.code_type_conge}</p>
                          <span className="text-lg font-bold leading-none flex-shrink-0" style={{ color }}>{s.solde_restant}j</span>
                        </div>
                        <div className="h-1.5 rounded-full overflow-hidden mb-1" style={{ background: "hsl(var(--muted))" }}>
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                        </div>
                        <div className="flex justify-between text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                          <span>{s.solde_pris}j pris</span><span>{s.solde_acquis}j acquis</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {/* Actions rapides */}
            <div>
              <h2 className="text-sm font-bold mb-3">Actions rapides</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Nouvelle demande", icon: <Plus size={16} />,    color: "hsl(var(--primary))",  bg: "hsl(var(--primary) / 0.1)", action: () => setShowDemandeForm(true) },
                  { label: "Mes compteurs",    icon: <BarChart3 size={16} />, color: "hsl(142 55% 38%)", bg: "hsl(142 55% 45% / 0.1)", action: () => setActiveTab("compteurs") },
                  { label: "Mon dossier",      icon: <User size={16} />,      color: "hsl(210 70% 45%)", bg: "hsl(210 70% 50% / 0.1)", action: () => setActiveTab("dossier") },
                  { label: "Mes documents",    icon: <FileText size={16} />,  color: "hsl(270 50% 45%)", bg: "hsl(270 50% 50% / 0.1)", action: () => setActiveTab("documents") },
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
            <Section title="État civil" icon={<User size={14} />}>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <InfoField label="Matricule" value={collab?.matricule ? `#${collab.matricule}` : null} />
                <InfoField label="Civilité" value={collab?.civilite} />
                <InfoField label="Nom" value={collab?.nom} />
                <InfoField label="Prénom" value={collab?.prenom} />
                <InfoField label="Nom de jeune fille" value={collab?.nom_jeune_fille} />
                <InfoField label="Genre" value={collab?.code_genre === "H" ? "Homme" : collab?.code_genre === "F" ? "Femme" : collab?.code_genre} />
                <InfoField label="Date de naissance" value={collab?.date_naissance ? format(parseISO(collab.date_naissance), "dd MMMM yyyy", { locale: fr }) : null} />
                <InfoField label="Lieu de naissance" value={collab?.lieu_naissance} />
                <InfoField label="Situation familiale" value={collab?.code_situation_familiale} />
                <InfoField label="Nationalité" value={collab?.code_nationalite} />
                <InfoField label="Nationalité 2" value={collab?.code_nationalite2} />
                <InfoField label="CIN" value={collab?.cin} />
              </div>
            </Section>
            <Section title="Coordonnées" icon={<Phone size={14} />}>
              <div className="grid grid-cols-2 gap-4">
                <InfoField label="Téléphone" value={collab?.telephone} />
                <InfoField label="GSM" value={collab?.gsm} />
                <InfoField label="Email professionnel" value={collab?.email_professionnel} />
                <InfoField label="Email personnel" value={collab?.email_personnel} />
              </div>
            </Section>
            {contrat && (
              <Section title="Contrat actif" icon={<Briefcase size={14} />}>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <InfoField label="Type" value={contrat.libelle_type_contrat || contrat.code_type_contrat} />
                  <InfoField label="Statut" value={contrat.code_statut_contrat} />
                  <InfoField label="Début" value={format(parseISO(contrat.date_debut), "dd/MM/yyyy")} />
                  <InfoField label="Fin" value={contrat.date_fin ? format(parseISO(contrat.date_fin), "dd/MM/yyyy") : "Indéterminée"} />
                  <InfoField label="Ancienneté" value={<AncienneteText dateDebut={contrat.date_debut} />} />
                  <InfoField label="Référence" value={contrat.reference_contrat} />
                </div>
              </Section>
            )}
            {adresses.length > 0 && (
              <Section title="Adresses" icon={<MapPin size={14} />}>
                <div className="space-y-3">
                  {adresses.map((a: any) => (
                    <div key={a.id} className="p-3 rounded-xl" style={{ background: "hsl(var(--muted) / 0.3)", border: "1px solid hsl(var(--border))" }}>
                      <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "hsl(var(--accent))" }}>{a.type_adresse || "Adresse"}</p>
                      <div className="grid grid-cols-2 gap-2">
                        {a.adresse1 && <InfoField label="Adresse" value={`${a.adresse1}${a.adresse2 ? `, ${a.adresse2}` : ""}`} />}
                        {a.code_postal && <InfoField label="Code postal" value={a.code_postal} />}
                        {a.ville && <InfoField label="Ville" value={a.ville} />}
                        {a.pays && <InfoField label="Pays" value={a.pays} />}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}
            {(famille?.conjoints?.length > 0 || famille?.enfants?.length > 0) && (
              <Section title="Famille" icon={<Heart size={14} />}>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    {[{ label: "Conjoints", value: famille?.conjoints?.length ?? 0 }, { label: "Enfants", value: famille?.enfants?.length ?? 0 }].map(k => (
                      <div key={k.label} className="p-3 rounded-xl text-center" style={{ background: "hsl(var(--muted) / 0.3)", border: "1px solid hsl(var(--border))" }}>
                        <p className="text-xl font-bold" style={{ color: "hsl(var(--accent))" }}>{k.value}</p>
                        <p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>{k.label}</p>
                      </div>
                    ))}
                  </div>
                  {famille?.enfants?.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold">Enfants</p>
                      {famille.enfants.map((e: any) => (
                        <div key={e.id} className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: "hsl(var(--muted) / 0.3)" }}>
                          <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}>{e.prenom?.[0]}{e.nom?.[0]}</div>
                          <span className="text-xs font-medium flex-1">{e.prenom} {e.nom}</span>
                          {e.date_naissance && <span className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>{format(parseISO(e.date_naissance), "dd/MM/yyyy")}</span>}
                          {e.a_charge && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: "hsl(142 55% 45% / 0.12)", color: "hsl(142 55% 30%)" }}>À charge</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Section>
            )}
            {immatriculations.length > 0 && (
              <Section title="Immatriculations sociales" icon={<Shield size={14} />}>
                <div className="space-y-2">
                  {immatriculations.map((r: any) => (
                    <div key={r.id} className="grid grid-cols-3 gap-3 p-3 rounded-lg" style={{ background: "hsl(var(--muted) / 0.3)" }}>
                      <InfoField label="Régime" value={r.code_regime} />
                      <InfoField label="N° immatriculation" value={r.matricule_organisme} />
                      <InfoField label="Affiliation" value={r.date_affiliation ? format(parseISO(r.date_affiliation), "dd/MM/yyyy") : null} />
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </div>
        )}

        {/* ════════════ CONGÉS ════════════ */}
        {activeTab === "conges" && (
          <div className="space-y-5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex gap-1.5 flex-wrap">
                {["TOUS", "EN_ATTENTE", "APPROUVEE", "REFUSEE", "ANNULEE"].map(s => (
                  <button key={s} onClick={() => setFilterDemande(s)}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all"
                    style={{ background: filterDemande === s ? "hsl(var(--primary))" : "transparent", borderColor: filterDemande === s ? "hsl(var(--primary))" : "hsl(var(--border))", color: filterDemande === s ? "white" : "hsl(var(--foreground))" }}>
                    {s === "TOUS" ? "Toutes" : STATUT_BADGE[s]?.label ?? s} {s !== "TOUS" && `(${demandes.filter((d: any) => d.statut === s).length})`}
                  </button>
                ))}
              </div>
              <Button onClick={() => setShowDemandeForm(true)} className="flex items-center gap-1.5 text-xs h-8 px-4" style={{ background: "hsl(var(--primary))", color: "white" }}>
                <Plus size={13} /> Nouvelle demande
              </Button>
            </div>
            {/* Soldes */}
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
            {/* Liste demandes */}
            <Section title={`Mes demandes (${demandesFiltrees.length})`} icon={<CalendarDays size={14} />}>
              {demandesFiltrees.length === 0 ? (
                <div className="py-8 text-center"><CalendarDays size={28} className="mx-auto mb-2 opacity-30" /><p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune demande</p></div>
              ) : (
                <div className="space-y-2">
                  {demandesFiltrees.map((d: any) => (
                    <div key={d.id} className="flex items-start gap-3 p-3 rounded-xl" style={{ background: "hsl(var(--muted) / 0.3)", border: "1px solid hsl(var(--border))" }}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap"><span className="text-xs font-semibold">{d.libelle_type_conge || d.code_type_conge}</span><StatutBadge statut={d.statut} /></div>
                        <p className="text-[11px] mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                          {format(parseISO(d.date_debut), "dd MMM yyyy", { locale: fr })} → {format(parseISO(d.date_fin_absence), "dd MMM yyyy", { locale: fr })} · <strong>{d.nbr_jours_decomptes}j</strong>
                        </p>
                        {d.commentaire_collaborateur && <p className="text-[10px] mt-0.5 italic" style={{ color: "hsl(var(--muted-foreground))" }}>"{d.commentaire_collaborateur}"</p>}
                      </div>
                      <p className="text-[10px] flex-shrink-0" style={{ color: "hsl(var(--muted-foreground))" }}>{d.date_soumission && format(parseISO(d.date_soumission), "dd/MM/yy")}</p>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </div>
        )}

        {/* ════════════ COMPTEURS ════════════ */}
        {activeTab === "compteurs" && (
          <div className="space-y-5">
            <Section title={`Compteurs — Exercice ${exercice}`} icon={<PieChart size={14} />}>
              {soldes.length === 0 ? <div className="py-8 text-center"><BarChart3 size={28} className="mx-auto mb-2 opacity-30" /><p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun compteur</p></div>
                : <div className="space-y-5">
                  {soldes.map((s: any) => {
                    const acquis = s.solde_acquis || 0; const pris = s.solde_pris || 0; const attente = s.solde_en_attente || 0; const restant = s.solde_restant || 0;
                    const pct = acquis > 0 ? Math.round((restant / acquis) * 100) : 0;
                    const color = pct <= 20 ? "hsl(0 70% 50%)" : pct <= 50 ? "hsl(38 92% 45%)" : "hsl(142 55% 45%)";
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
              {histAffectations.length === 0
                ? <div className="py-8 text-center"><TrendingUp size={28} className="mx-auto mb-2 opacity-30" /><p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune évolution</p></div>
                : <div className="space-y-0">
                  {histAffectations.map((a: any, idx: number) => (
                    <div key={a.id} className="relative flex gap-3 pb-4">
                      {idx < histAffectations.length - 1 && <div className="absolute left-[9px] top-5 bottom-0 w-0.5" style={{ background: "hsl(var(--border))" }} />}
                      <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-1 z-10"
                        style={{ background: idx === 0 ? "hsl(var(--primary))" : "hsl(var(--muted))", border: "2px solid hsl(var(--card))" }}>
                        <div className="w-2 h-2 rounded-full" style={{ background: idx === 0 ? "white" : "hsl(var(--muted-foreground))" }} />
                      </div>
                      <div className="flex-1 pt-0.5">
                        {idx === 0 && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold mb-1 inline-block" style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}>EN COURS</span>}
                        <p className="text-xs font-semibold">{a.libelle_poste || a.code_poste || "Poste non renseigné"}</p>
                        <p className="text-[11px]" style={{ color: a.couleur_uo || "hsl(var(--muted-foreground))" }}>{a.libelle_uo || "—"}</p>
                        <p className="text-[10px] mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                          {a.date_debut_uo && format(parseISO(a.date_debut_uo), "MMMM yyyy", { locale: fr })}
                          {a.date_fin_uo ? ` → ${format(parseISO(a.date_fin_uo), "MMMM yyyy", { locale: fr })}` : " → Aujourd'hui"}
                        </p>
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
                        <p className="text-[10px] mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                          Depuis le {c.date_debut ? format(parseISO(c.date_debut), "dd/MM/yyyy") : "—"}
                          {!c.date_fin && <span className="ml-2 px-1.5 py-0.5 rounded-full font-medium" style={{ background: "hsl(142 55% 45% / 0.12)", color: "hsl(142 55% 30%)" }}>Actuelle</span>}
                        </p>
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
          <Section title="Mes documents" icon={<FileText size={14} />}>
            <div className="py-12 text-center"><FileText size={32} className="mx-auto mb-3 opacity-30" /><p className="text-sm font-medium">Aucun document disponible</p><p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>Vos bulletins de paie et attestations apparaîtront ici.</p></div>
          </Section>
        )}

        {/* ════════════ NOTIFICATIONS ════════════ */}
        {activeTab === "notifications" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{nonLues} non lue{nonLues > 1 ? "s" : ""} · {notifications.length} au total</p>
              {nonLues > 0 && <button onClick={marquerToutLu} className="text-[11px] font-medium flex items-center gap-1 hover:opacity-70" style={{ color: "hsl(var(--primary))" }}><Check size={11} /> Tout marquer lu</button>}
            </div>
            {notifications.length === 0
              ? <div className="py-12 text-center"><Bell size={32} className="mx-auto mb-3 opacity-30" /><p className="text-sm">Aucune notification</p></div>
              : <div className="space-y-2">
                {notifications.map((n: any) => {
                  const cfgN: Record<string, { color: string; bg: string }> = { success: { color: "hsl(142 55% 30%)", bg: "hsl(142 55% 45% / 0.08)" }, warning: { color: "hsl(38 92% 38%)", bg: "hsl(38 92% 50% / 0.08)" }, error: { color: "hsl(0 70% 42%)", bg: "hsl(0 70% 50% / 0.07)" }, info: { color: "hsl(210 70% 40%)", bg: "hsl(210 70% 50% / 0.08)" } };
                  const cn = cfgN[n.type] ?? cfgN.info;
                  return (
                    <div key={n.id} className="flex items-start gap-3 p-3 rounded-xl transition-all"
                      style={{ background: n.lu ? "hsl(var(--muted) / 0.2)" : cn.bg, border: `1px solid ${n.lu ? "hsl(var(--border))" : cn.color + "33"}`, opacity: n.lu ? 0.7 : 1 }}>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold">{n.titre}</p>
                        <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: "hsl(var(--muted-foreground))" }}>{n.message}</p>
                        <p className="text-[10px] mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>{n.created_at && format(parseISO(n.created_at), "dd/MM/yyyy HH:mm")}</p>
                      </div>
                      {!n.lu && <button onClick={() => marquerLu(n.id)} className="p-1 rounded-md hover:opacity-70 flex-shrink-0" style={{ color: "hsl(var(--muted-foreground))" }}><Check size={12} /></button>}
                    </div>
                  );
                })}
              </div>}
          </div>
        )}

      </div>

      {showDemandeForm && collabId && (
        <MiniDemandeForm collabId={collabId} soldes={soldes} onClose={() => setShowDemandeForm(false)}
          onSuccess={() => { setShowDemandeForm(false); refetchDemandes(); qc.invalidateQueries({ queryKey: ["mes-soldes"] }); }} />
      )}
    </div>
  );
}
