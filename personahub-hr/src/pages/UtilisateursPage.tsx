/**
 * UtilisateursPage.tsx — Gestion des accès utilisateurs
 * Migré vers api.ts (suppression supabase)
 * Fonctionnalités :
 *   - Liste des utilisateurs avec rôles et espaces
 *   - Création de compte (email + mdp + rôles + liaison collaborateur)
 *   - Invitation collaborateurs sans compte
 *   - Changement de mot de passe
 *   - Ajout / suppression de rôles
 */

import React, { useEffect, useRef, useState } from "react";
import { api, db } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import CollaborateursSansCompte from "./CollaborateursSansCompte";
import {
  Search, Shield, Mail, User, X, Plus, Check, UserPlus, Send,
  KeyRound, Eye, EyeOff, LayoutDashboard, Users, Calculator,
  Briefcase, UserCircle, Building2, Lock, ChevronDown, RefreshCw,
  AlertTriangle, CheckCircle2, UserCheck, Sparkles,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";

type AppRole = "administrateur" | "gestionnaire_rh" | "gestionnaire_paie" | "manager" | "collaborateur";

const ROLES: { value: AppRole; label: string; color: string; desc: string }[] = [
  { value: "administrateur",    label: "Administrateur",    color: "hsl(213 73% 30%)", desc: "Accès total à toutes les fonctionnalités" },
  { value: "gestionnaire_rh",   label: "Gestionnaire RH",   color: "hsl(197 100% 38%)", desc: "Gestion des collaborateurs et congés" },
  { value: "gestionnaire_paie", label: "Gestionnaire Paie", color: "hsl(84 55% 38%)",  desc: "Gestion de la paie et déclarations" },
  { value: "manager",           label: "Manager",           color: "hsl(39 95% 42%)",  desc: "Validation équipe et planning" },
  { value: "collaborateur",     label: "Collaborateur",     color: "hsl(215 20% 45%)", desc: "Espace self-service collaborateur" },
];

const WORKSPACE_MAP: Record<AppRole, { label: string; icon: React.ReactNode; color: string }[]> = {
  administrateur:    [
    { label: "Administration", icon: <LayoutDashboard size={9} />, color: "hsl(213 73% 30%)" },
    { label: "RH",             icon: <Users size={9} />,           color: "hsl(197 100% 38%)" },
    { label: "Paie",           icon: <Calculator size={9} />,      color: "hsl(84 55% 38%)" },
    { label: "Manager",        icon: <Briefcase size={9} />,       color: "hsl(39 95% 42%)" },
    { label: "Collaborateur",  icon: <UserCircle size={9} />,      color: "hsl(215 20% 45%)" },
  ],
  gestionnaire_rh:   [
    { label: "RH",             icon: <Users size={9} />,           color: "hsl(197 100% 38%)" },
    { label: "Collaborateur",  icon: <UserCircle size={9} />,      color: "hsl(215 20% 45%)" },
  ],
  gestionnaire_paie: [
    { label: "Paie",           icon: <Calculator size={9} />,      color: "hsl(84 55% 38%)" },
    { label: "Collaborateur",  icon: <UserCircle size={9} />,      color: "hsl(215 20% 45%)" },
  ],
  manager: [
    { label: "Manager",        icon: <Briefcase size={9} />,       color: "hsl(39 95% 42%)" },
    { label: "Collaborateur",  icon: <UserCircle size={9} />,      color: "hsl(215 20% 45%)" },
  ],
  collaborateur: [
    { label: "Collaborateur",  icon: <UserCircle size={9} />,      color: "hsl(215 20% 45%)" },
  ],
};

interface UserRow {
  user_id: string; email: string; prenom: string; nom: string;
  poste?: string; roles: AppRole[]; created_at: string;
  collaborateur_id?: string; matricule?: string;
  actif?: boolean;
}

interface CollaborateurItem {
  id: string; matricule: string; nom: string; prenom: string;
  email_professionnel?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getWorkspaces(roles: AppRole[]) {
  const all = roles.flatMap(r => WORKSPACE_MAP[r] ?? []);
  const seen = new Set<string>();
  return all.filter(w => { if (seen.has(w.label)) return false; seen.add(w.label); return true; });
}

function pwdStrength(p: string): number {
  if (p.length < 8) return 0;
  let s = 1;
  if (p.length >= 10) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
  if (/[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
  return s;
}

// ── Composants ────────────────────────────────────────────────────────────────
const RoleBadge: React.FC<{ role: AppRole; onRemove?: () => void; removing?: boolean }> = ({ role, onRemove, removing }) => {
  const info = ROLES.find(r => r.value === role);
  if (!info) return null;
  return (
    <span className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xs font-medium"
      style={{ background: `${info.color}20`, color: info.color, border: `1px solid ${info.color}40` }}>
      <Shield size={9} />{info.label}
      {onRemove && (
        <button onClick={onRemove} disabled={removing}
          className="ml-0.5 rounded-full p-0.5 hover:opacity-70" style={{ color: info.color }}>
          {removing
            ? <div className="w-2.5 h-2.5 rounded-full border border-t-transparent animate-spin" style={{ borderColor: info.color, borderTopColor: "transparent" }} />
            : <X size={9} />}
        </button>
      )}
    </span>
  );
};

const WorkspaceBadge: React.FC<{ label: string; icon: React.ReactNode; color: string }> = ({ label, icon, color }) => (
  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium"
    style={{ background: `${color}15`, color, border: `1px solid ${color}30` }}>
    {icon}{label}
  </span>
);

// ── Add Role Dropdown ─────────────────────────────────────────────────────────
const AddRoleDropdown: React.FC<{ userId: string; currentRoles: AppRole[]; onAdded: () => void }> = ({ userId, currentRoles, onAdded }) => {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState<AppRole | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const available = ROLES.filter(r => !currentRoles.includes(r.value));

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  if (available.length === 0) return null;

  const handleAdd = async (role: AppRole) => {
    setAdding(role);
    try {
      await api.post(`/auth/users/${userId}/roles`, { role });
      onAdded();
      toast({ title: "Rôle ajouté", description: `Rôle ${role} attribué avec succès.` });
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    } finally { setAdding(null); setOpen(false); }
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-medium border transition-all hover:opacity-80"
        style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))", background: "hsl(var(--muted))" }}>
        <Plus size={10} /> Rôle
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 rounded-xl shadow-xl border py-1.5 min-w-[200px]"
          style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
          {available.map(r => (
            <button key={r.value} onClick={() => handleAdd(r.value)} disabled={!!adding}
              className="w-full flex items-start gap-2.5 px-3 py-2 hover:bg-muted/50 transition-colors text-left">
              <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ background: `${r.color}20`, color: r.color }}>
                {adding === r.value
                  ? <div className="w-3 h-3 rounded-full border border-t-transparent animate-spin" style={{ borderColor: r.color, borderTopColor: "transparent" }} />
                  : <Shield size={10} />}
              </div>
              <div>
                <p className="text-xs font-semibold" style={{ color: r.color }}>{r.label}</p>
                <p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>{r.desc}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Change Password Dialog ────────────────────────────────────────────────────
const ChangePasswordDialog: React.FC<{ user: UserRow | null; onClose: () => void }> = ({ user, onClose }) => {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!user) return null;
  const strength = pwdStrength(password);
  const colors = ["hsl(0 84% 60%)", "hsl(39 95% 50%)", "hsl(197 100% 42%)", "hsl(84 55% 45%)"];
  const labels = ["Trop court", "Faible", "Moyen", "Fort"];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { toast({ title: "Mot de passe trop court", variant: "destructive" }); return; }
    if (password !== confirm) { toast({ title: "Les mots de passe ne correspondent pas", variant: "destructive" }); return; }
    setLoading(true);
    try {
      await api.post(`/auth/users/${user.user_id}/change-password`, { new_password: password });
      toast({ title: "Mot de passe modifié", description: `Compte de ${user.prenom} ${user.nom} mis à jour.` });
      onClose();
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative rounded-2xl shadow-2xl w-full max-w-sm mx-4"
        style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: "hsl(var(--border))" }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}>
              <KeyRound size={15} />
            </div>
            <div>
              <h2 className="font-bold text-sm" style={{ color: "hsl(var(--foreground))" }}>Changer le mot de passe</h2>
              <p className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>{user.prenom} {user.nom}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:opacity-70" style={{ color: "hsl(var(--muted-foreground))" }}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {["Nouveau mot de passe", "Confirmer"].map((label, idx) => (
            <div key={label}>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: "hsl(var(--foreground))" }}>{label}</label>
              <div className="relative">
                <input type={showPwd ? "text" : "password"}
                  value={idx === 0 ? password : confirm}
                  onChange={e => idx === 0 ? setPassword(e.target.value) : setConfirm(e.target.value)}
                  placeholder={idx === 0 ? "Min. 8 caractères" : "Répéter…"} required
                  className="w-full pr-9 pl-3 py-2 rounded-lg text-sm border outline-none"
                  style={{
                    borderColor: idx === 1 && confirm && confirm !== password ? "hsl(0 84% 60%)" : "hsl(var(--border))",
                    background: "hsl(var(--muted))", color: "hsl(var(--foreground))"
                  }} />
                {idx === 0 && (
                  <button type="button" onClick={() => setShowPwd(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }}>
                    {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                )}
              </div>
              {idx === 1 && confirm && confirm !== password && (
                <p className="text-[11px] mt-1 flex items-center gap-1" style={{ color: "hsl(0 84% 60%)" }}>
                  <AlertTriangle size={10} /> Les mots de passe ne correspondent pas
                </p>
              )}
            </div>
          ))}

          {password.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex gap-1">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-1.5 flex-1 rounded-full transition-all"
                    style={{ background: i < strength ? colors[strength - 1] : "hsl(var(--border))" }} />
                ))}
              </div>
              <p className="text-[11px]" style={{ color: strength > 0 ? colors[strength - 1] : "hsl(var(--muted-foreground))" }}>
                {strength > 0 ? labels[strength - 1] : "Trop court"}
              </p>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium border hover:bg-muted/50"
              style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>Annuler</button>
            <button type="submit" disabled={loading || password.length < 8 || password !== confirm}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ background: "hsl(var(--primary))", color: "white" }}>
              {loading ? <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin border-white" /> : <><KeyRound size={13} /> Enregistrer</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Créer un compte ───────────────────────────────────────────────────────────
const CreateUserDialog: React.FC<{ onClose: () => void; onCreated: () => void }> = ({ onClose, onCreated }) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState({
    email: "", password: "", confirm: "", prenom: "", nom: "",
    roles: ["collaborateur"] as AppRole[],
    collaborateur_id: "",
  });
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchCollab, setSearchCollab] = useState("");

  const { data: collaborateurs = [] } = useQuery<CollaborateurItem[]>({
    queryKey: ["collaborateurs-creation-compte", searchCollab],
    queryFn: async () => {
      const norm = (s: string) =>
        (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      // Charger tous les collabs actifs (filtre JS pour éviter l'encodage des % et ,)
      const data: any[] = await api.get(
        "/db/collaborateurs?select=id,matricule,nom,prenom,email_professionnel&archive=eq.false&statut_collaborateur=eq.ACTIF&order=nom&limit=500"
      ) || [];
      if (!searchCollab.trim()) return data.slice(0, 20) as CollaborateurItem[];
      const tokens = norm(searchCollab).split(/\s+/).filter(Boolean);
      return data.filter((c: any) => {
        const hay = norm(`${c.matricule} ${c.nom} ${c.prenom} ${c.email_professionnel ?? ""}`);
        return tokens.every(t => hay.includes(t));
      }).slice(0, 20) as CollaborateurItem[];
    },
  });

  const collabSelectionne = collaborateurs.find(c => c.id === form.collaborateur_id);
  const strength = pwdStrength(form.password);
  const colors = ["hsl(0 84% 60%)", "hsl(39 95% 50%)", "hsl(197 100% 42%)", "hsl(84 55% 45%)"];
  const labels = ["Trop court", "Faible", "Moyen", "Fort"];

  const toggleRole = (role: AppRole) => {
    setForm(f => ({
      ...f,
      roles: f.roles.includes(role) ? f.roles.filter(r => r !== role) : [...f.roles, role],
    }));
  };

  const handleCreate = async () => {
    if (!form.email || !form.password || !form.prenom || !form.nom) {
      toast({ title: "Champs obligatoires manquants", variant: "destructive" }); return;
    }
    if (form.password.length < 8) {
      toast({ title: "Mot de passe trop court (min. 8 caractères)", variant: "destructive" }); return;
    }
    if (form.password !== form.confirm) {
      toast({ title: "Les mots de passe ne correspondent pas", variant: "destructive" }); return;
    }
    if (form.roles.length === 0) {
      toast({ title: "Sélectionnez au moins un rôle", variant: "destructive" }); return;
    }
    setLoading(true);
    try {
      await api.post("/auth/users", {
        email: form.email,
        password: form.password,
        prenom: form.prenom,
        nom: form.nom,
        roles: form.roles,
        collaborateur_id: form.collaborateur_id || null,
      });
      toast({ title: "Compte créé !", description: `${form.prenom} ${form.nom} peut maintenant se connecter.` });
      onCreated();
      onClose();
    } catch (err: any) {
      toast({ title: "Erreur création", description: err.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative rounded-2xl shadow-2xl w-full max-w-lg"
        style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: "hsl(var(--primary) / 0.12)", color: "hsl(var(--primary))" }}>
              <UserPlus size={16} />
            </div>
            <div>
              <h2 className="font-bold text-sm" style={{ color: "hsl(var(--foreground))" }}>Créer un compte utilisateur</h2>
              <p className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>Étape {step} / 2</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:opacity-70"
            style={{ color: "hsl(var(--muted-foreground))" }}><X size={16} /></button>
        </div>

        {/* Progress */}
        <div className="h-1" style={{ background: "hsl(var(--muted))" }}>
          <div className="h-full transition-all" style={{ width: step === 1 ? "50%" : "100%", background: "hsl(var(--primary))" }} />
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">

          {step === 1 && (
            <>
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>
                Identité & connexion
              </p>

              {/* Nom / Prénom */}
              <div className="grid grid-cols-2 gap-3">
                {[["prenom", "Prénom *"], ["nom", "Nom *"]].map(([key, label]) => (
                  <div key={key}>
                    <label className="text-xs font-semibold mb-1.5 block" style={{ color: "hsl(var(--foreground))" }}>{label}</label>
                    <input value={(form as any)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                      className="w-full h-9 px-3 rounded-lg border text-sm outline-none"
                      style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
                      placeholder={key === "prenom" ? "Youssef" : "Amrani"} />
                  </div>
                ))}
              </div>

              {/* Email */}
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{ color: "hsl(var(--foreground))" }}>Email *</label>
                <div className="relative">
                  <Mail size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
                  <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    className="w-full h-9 pl-9 pr-3 rounded-lg border text-sm outline-none"
                    style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
                    placeholder="y.amrani@entreprise.ma" />
                </div>
              </div>

              {/* Mot de passe */}
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{ color: "hsl(var(--foreground))" }}>Mot de passe *</label>
                <div className="relative">
                  <Lock size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
                  <input type={showPwd ? "text" : "password"} value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    className="w-full h-9 pl-9 pr-9 rounded-lg border text-sm outline-none"
                    style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
                    placeholder="Min. 8 caractères" />
                  <button type="button" onClick={() => setShowPwd(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }}>
                    {showPwd ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
                {form.password.length > 0 && (
                  <div className="mt-1.5 space-y-1">
                    <div className="flex gap-1">
                      {[...Array(4)].map((_, i) => (
                        <div key={i} className="h-1 flex-1 rounded-full transition-all"
                          style={{ background: i < strength ? colors[strength - 1] : "hsl(var(--border))" }} />
                      ))}
                    </div>
                    <p className="text-[10px]" style={{ color: strength > 0 ? colors[strength - 1] : "hsl(var(--muted-foreground))" }}>
                      {strength > 0 ? labels[strength - 1] : "Trop court"}
                    </p>
                  </div>
                )}
              </div>

              {/* Confirmer */}
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{ color: "hsl(var(--foreground))" }}>Confirmer le mot de passe *</label>
                <input type={showPwd ? "text" : "password"} value={form.confirm}
                  onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
                  className="w-full h-9 px-3 rounded-lg border text-sm outline-none"
                  style={{
                    borderColor: form.confirm && form.confirm !== form.password ? "hsl(0 84% 60%)" : "hsl(var(--border))",
                    background: "hsl(var(--background))", color: "hsl(var(--foreground))"
                  }}
                  placeholder="Répéter le mot de passe" />
                {form.confirm && form.confirm !== form.password && (
                  <p className="text-[11px] mt-1 flex items-center gap-1" style={{ color: "hsl(0 84% 60%)" }}>
                    <AlertTriangle size={10} /> Les mots de passe ne correspondent pas
                  </p>
                )}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>
                Rôles & liaison collaborateur
              </p>

              {/* Rôles */}
              <div>
                <label className="text-xs font-semibold mb-2 block" style={{ color: "hsl(var(--foreground))" }}>
                  Rôles *
                  <span className="font-normal ml-1" style={{ color: "hsl(var(--muted-foreground))" }}>(plusieurs possibles)</span>
                </label>
                <div className="space-y-2">
                  {ROLES.map(r => {
                    const selected = form.roles.includes(r.value);
                    return (
                      <button key={r.value} type="button" onClick={() => toggleRole(r.value)}
                        className="w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all"
                        style={{
                          borderColor: selected ? r.color : "hsl(var(--border))",
                          background: selected ? `${r.color}0D` : "hsl(var(--background))",
                        }}>
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ background: `${r.color}20`, color: r.color }}>
                          <Shield size={14} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold" style={{ color: r.color }}>{r.label}</p>
                          <p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>{r.desc}</p>
                        </div>
                        <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                          style={{ background: selected ? r.color : "hsl(var(--muted))", border: `1.5px solid ${selected ? r.color : "hsl(var(--border))"}` }}>
                          {selected && <Check size={9} color="white" />}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Aperçu espaces */}
                {form.roles.length > 0 && (
                  <div className="mt-3 p-3 rounded-xl" style={{ background: "hsl(var(--muted) / 0.4)" }}>
                    <p className="text-[10px] font-semibold mb-2 uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>Espaces de travail accordés</p>
                    <div className="flex flex-wrap gap-1">
                      {getWorkspaces(form.roles).map(ws => (
                        <WorkspaceBadge key={ws.label} label={ws.label} icon={ws.icon} color={ws.color} />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Liaison collaborateur */}
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{ color: "hsl(var(--foreground))" }}>
                  Lier à un collaborateur
                  <span className="font-normal ml-1" style={{ color: "hsl(var(--muted-foreground))" }}>(optionnel — requis pour le rôle collaborateur)</span>
                </label>
                <div className="relative mb-2">
                  <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
                  <input value={searchCollab} onChange={e => setSearchCollab(e.target.value)}
                    className="w-full h-9 pl-9 pr-3 rounded-lg border text-sm outline-none"
                    style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
                    placeholder="Rechercher un collaborateur…" />
                </div>
                {collabSelectionne ? (
                  <div className="flex items-center gap-3 p-3 rounded-xl"
                    style={{ background: "hsl(142 55% 45% / 0.08)", border: "1px solid hsl(142 55% 45% / 0.25)" }}>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{ background: "hsl(142 55% 45% / 0.15)", color: "hsl(142 55% 30%)" }}>
                      {collabSelectionne.prenom[0]}{collabSelectionne.nom[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                        {collabSelectionne.prenom} {collabSelectionne.nom}
                      </p>
                      <p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                        #{collabSelectionne.matricule}
                        {collabSelectionne.email_professionnel && ` · ${collabSelectionne.email_professionnel}`}
                      </p>
                    </div>
                    <button onClick={() => setForm(f => ({ ...f, collaborateur_id: "" }))}
                      className="p-1 rounded-md hover:opacity-70" style={{ color: "hsl(var(--muted-foreground))" }}>
                      <X size={13} />
                    </button>
                  </div>
                ) : (
                  <div className="rounded-xl border overflow-hidden max-h-36 overflow-y-auto"
                    style={{ borderColor: "hsl(var(--border))" }}>
                    {collaborateurs.length === 0 ? (
                      <p className="text-xs p-3" style={{ color: "hsl(var(--muted-foreground))" }}>Tapez pour rechercher…</p>
                    ) : collaborateurs.map(c => (
                      <button key={c.id} onClick={() => { setForm(f => ({ ...f, collaborateur_id: c.id })); setSearchCollab(""); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 border-b hover:bg-muted/40 transition-colors text-left"
                        style={{ borderColor: "hsl(var(--border))" }}>
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                          style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}>
                          {c.prenom[0]}{c.nom[0]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold truncate" style={{ color: "hsl(var(--foreground))" }}>
                            {c.prenom} {c.nom}
                          </p>
                          <p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>#{c.matricule}</p>
                        </div>
                        {c.email_professionnel && (
                          <p className="text-[10px] truncate max-w-[100px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                            {c.email_professionnel}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {form.roles.includes("collaborateur") && !form.collaborateur_id && (
                  <p className="text-[11px] mt-1.5 flex items-center gap-1" style={{ color: "hsl(38 92% 40%)" }}>
                    <AlertTriangle size={10} /> Le rôle "Collaborateur" nécessite une liaison à un collaborateur
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t" style={{ borderColor: "hsl(var(--border))" }}>
          <button onClick={step === 1 ? onClose : () => setStep(1)}
            className="px-4 py-2 rounded-lg text-sm font-medium border hover:bg-muted/50"
            style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
            {step === 1 ? "Annuler" : "← Retour"}
          </button>
          {step === 1 ? (
            <button onClick={() => setStep(2)}
              disabled={!form.email || !form.prenom || !form.nom || form.password.length < 8 || form.password !== form.confirm}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
              style={{ background: "hsl(var(--primary))", color: "white" }}>
              Suivant → Rôles
            </button>
          ) : (
            <button onClick={handleCreate}
              disabled={loading || form.roles.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
              style={{ background: "hsl(var(--primary))", color: "white" }}>
              {loading
                ? <><div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin border-white" /> Création…</>
                : <><Sparkles size={14} /> Créer le compte</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Page principale ───────────────────────────────────────────────────────────
const UtilisateursPage: React.FC = () => {
  const { user: currentUser } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<AppRole | "all">("all");
  const [removingRole, setRemovingRole] = useState<{ userId: string; role: AppRole } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [changePwdUser, setChangePwdUser] = useState<UserRow | null>(null);

  // ── Chargement utilisateurs via API ──────────────────────────────────────
  const { data: users = [], isLoading, refetch } = useQuery<UserRow[]>({
    queryKey: ["utilisateurs"],
    retry: 1,
    queryFn: async () => {
      // Essai 1 : endpoint dédié users
      let raw: any[] | null = null;
      try {
        raw = await api.get<any[]>("/auth/users");
      } catch {
        // Essai 2 : fallback via vue ou table user_profiles si auth bloqué par CORS
        try {
          raw = await api.get<any[]>("/db/user_profiles?order=created_at.desc&limit=500");
        } catch {
          return [];
        }
      }
      return (raw ?? []).map((u: any) => ({
        user_id:          u.id ?? u.user_id,
        email:            u.email ?? "",
        prenom:           u.prenom ?? u.first_name ?? "",
        nom:              u.nom ?? u.last_name ?? "",
        poste:            u.poste ?? "",
        roles:            (u.roles ?? [u.role]).filter(Boolean) as AppRole[],
        created_at:       u.created_at ?? "",
        collaborateur_id: u.collaborateur_id ?? null,
        matricule:        u.matricule ?? null,
        actif:            u.actif !== false,
      }));
    },
  });

  const handleRemoveRole = async (userId: string, role: AppRole, currentRoles: AppRole[]) => {
    if (currentRoles.length <= 1) {
      toast({ title: "Impossible", description: "Un utilisateur doit avoir au moins un rôle.", variant: "destructive" });
      return;
    }
    setRemovingRole({ userId, role });
    try {
      await api.delete(`/auth/users/${userId}/roles/${role}`);
      refetch();
      toast({ title: "Rôle retiré" });
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    } finally { setRemovingRole(null); }
  };

  const filtered = users.filter(u => {
    const matchSearch = `${u.prenom} ${u.nom} ${u.email} ${u.matricule ?? ""}`.toLowerCase().includes(search.toLowerCase());
    const matchRole = filterRole === "all" || u.roles.includes(filterRole);
    return matchSearch && matchRole;
  });

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "hsl(var(--foreground))" }}>Gestion des accès</h1>
          <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
            {users.length} compte{users.length > 1 ? "s" : ""} · Rôles, espaces de travail et mots de passe
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()}
            className="p-2 rounded-lg border hover:opacity-70 transition-opacity"
            style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
            <RefreshCw size={14} />
          </button>
          <button onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:opacity-90"
            style={{ background: "hsl(var(--primary))", color: "white" }}>
            <UserPlus size={15} /> Créer un compte
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {ROLES.map(r => {
          const count = users.filter(u => u.roles.includes(r.value)).length;
          return (
            <button key={r.value} onClick={() => setFilterRole(filterRole === r.value ? "all" : r.value)}
              className="p-3 rounded-xl text-left transition-all hover:scale-105"
              style={{
                background: filterRole === r.value ? `${r.color}15` : "hsl(var(--card))",
                border: `1px solid ${filterRole === r.value ? r.color + "40" : "hsl(var(--border))"}`,
              }}>
              <p className="text-lg font-bold leading-none" style={{ color: r.color }}>{count}</p>
              <p className="text-[11px] mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>{r.label}</p>
            </button>
          );
        })}
      </div>

      {/* Filtres */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher par nom, email, matricule…"
            className="pl-9 pr-4 py-2 rounded-xl text-sm border outline-none w-full"
            style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--foreground))" }} />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={() => setFilterRole("all")}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all"
            style={{
              background: filterRole === "all" ? "hsl(var(--foreground))" : "transparent",
              borderColor: filterRole === "all" ? "hsl(var(--foreground))" : "hsl(var(--border))",
              color: filterRole === "all" ? "hsl(var(--background))" : "hsl(var(--foreground))",
            }}>Tous</button>
          {ROLES.map(r => (
            <button key={r.value} onClick={() => setFilterRole(filterRole === r.value ? "all" : r.value)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all"
              style={{
                background: filterRole === r.value ? r.color : "transparent",
                borderColor: filterRole === r.value ? r.color : "hsl(var(--border))",
                color: filterRole === r.value ? "white" : "hsl(var(--foreground))",
              }}>{r.label}</button>
          ))}
          <button onClick={() => setFilterRole("sans_compte" as any)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all"
            style={{
              background: (filterRole as any) === "sans_compte" ? "#0E9F8E" : "transparent",
              borderColor: (filterRole as any) === "sans_compte" ? "#0E9F8E" : "hsl(var(--border))",
              color: (filterRole as any) === "sans_compte" ? "white" : "hsl(var(--foreground))",
            }}>Sans compte</button>
        </div>
      </div>

      {(filterRole as any) === "sans_compte" ? (
        <CollaborateursSansCompte />
      ) : (
      <>
      {/* Tableau */}
      <div className="rounded-2xl overflow-hidden"
        style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
        {isLoading ? (
          <div className="flex items-center justify-center h-32 gap-2">
            <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "hsl(var(--primary))", borderTopColor: "transparent" }} />
            <span className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Chargement…</span>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "hsl(var(--muted) / 0.5)", borderBottom: "1px solid hsl(var(--border))" }}>
                {["Utilisateur", "Email", "Rôles", "Espaces", "Créé le", "Actions"].map(h => (
                  <th key={h} className="text-left py-3 px-4 text-[11px] font-bold uppercase tracking-wider"
                    style={{ color: "hsl(var(--muted-foreground))" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-14 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Aucun utilisateur trouvé
                </td></tr>
              ) : filtered.map(u => {
                const primaryRole = ROLES.find(r => r.value === u.roles[0]);
                const workspaces = getWorkspaces(u.roles);
                return (
                  <tr key={u.user_id} className="border-b hover:bg-muted/20 transition-all"
                    style={{ borderColor: "hsl(var(--border))" }}>
                    {/* Utilisateur */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                          style={{ background: `${primaryRole?.color ?? "hsl(var(--primary))"}20`, color: primaryRole?.color ?? "hsl(var(--primary))" }}>
                          {u.prenom?.[0]?.toUpperCase() ?? <User size={12} />}
                        </div>
                        <div>
                          <p className="font-semibold text-xs leading-tight" style={{ color: "hsl(var(--foreground))" }}>
                            {u.prenom} {u.nom}
                            {u.user_id === currentUser?.id && (
                              <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded" style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}>moi</span>
                            )}
                          </p>
                          {u.matricule && <p className="text-[10px] font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>#{u.matricule}</p>}
                        </div>
                      </div>
                    </td>

                    {/* Email */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                        <Mail size={11} />{u.email}
                      </div>
                    </td>

                    {/* Rôles */}
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap items-center gap-1">
                        {u.roles.map(role => (
                          <RoleBadge key={role} role={role}
                            onRemove={u.roles.length > 1 ? () => handleRemoveRole(u.user_id, role, u.roles) : undefined}
                            removing={removingRole?.userId === u.user_id && removingRole?.role === role} />
                        ))}
                        <AddRoleDropdown userId={u.user_id} currentRoles={u.roles} onAdded={refetch} />
                      </div>
                    </td>

                    {/* Espaces */}
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1">
                        {workspaces.map(ws => <WorkspaceBadge key={ws.label} label={ws.label} icon={ws.icon} color={ws.color} />)}
                      </div>
                    </td>

                    {/* Créé le */}
                    <td className="py-3 px-4 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {u.created_at ? format(parseISO(u.created_at), "dd/MM/yyyy", { locale: fr }) : "—"}
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4">
                      <button onClick={() => setChangePwdUser(u)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all hover:opacity-80"
                        style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
                        <KeyRound size={12} /> Mot de passe
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      </>
      )}

      {/* Dialogs */}
      {showCreate && <CreateUserDialog onClose={() => setShowCreate(false)} onCreated={refetch} />}
      <ChangePasswordDialog user={changePwdUser} onClose={() => setChangePwdUser(null)} />
    </div>
  );
};

export default UtilisateursPage;
