/**
 * GestionRolesPage.tsx
 * Administration des rôles : création, édition, affectation d'espace,
 * gestion des accès menus.
 *
 * Sécurité côté client (complément du contrôle serveur) :
 *  - La page est rendue uniquement si l'utilisateur est administrateur
 *    (guard dans App.tsx / route protégée).
 *  - Les rôles système sont signalés visuellement et leurs actions bloquées.
 *  - Toute mutation passe par l'API (le serveur re-vérifie le rôle admin
 *    via JWT à chaque appel).
 *  - Aucun ID sensible n'est exposé dans l'URL côté client.
 */

import { useEffect, useState, useCallback } from "react";
import { Shield, Plus, Edit2, Trash2, Lock, Users, Grid, ChevronRight, AlertTriangle, Check, X, Layers } from "lucide-react";
import { api } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Espace {
  id: number;
  code: string;
  libelle: string;
  chemin: string;
}

interface MenuAcces {
  menu_code: string;
  libelle: string;
  parent_code: string | null;
  ordre: number;
  actif: boolean;
}

interface Role {
  id: number;
  code: string;
  libelle: string;
  description: string | null;
  couleur: string | null;
  icone: string | null;
  est_systeme: boolean;
  actif: boolean;
  nb_utilisateurs: number;
  espaces?: Espace[];
  acces_menus?: MenuAcces[];
}

interface RoleUser {
  user_id: string;
  prenom: string;
  nom: string;
  email: string;
  date_debut: string | null;
  date_fin: string | null;
}

interface Candidat {
  user_id: string;
  prenom: string;
  nom: string;
  email: string;
}

type Tab = "roles" | "espaces" | "acces" | "utilisateurs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_COLORS = ["#3B82F6", "#10B981", "#8B5CF6", "#F59E0B", "#EF4444", "#06B6D4", "#EC4899"];

function Badge({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={color ? { backgroundColor: color + "22", color } : undefined}
    >
      {children}
    </span>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal création / édition d'un rôle
// ---------------------------------------------------------------------------

function RoleModal({
  role,
  onClose,
  onSaved,
}: {
  role: Role | null; // null = création
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!role;

  const [form, setForm] = useState({
    code: role?.code ?? "",
    libelle: role?.libelle ?? "",
    description: role?.description ?? "",
    couleur: role?.couleur ?? DEFAULT_COLORS[0],
    icone: role?.icone ?? "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: string, val: string) =>
    setForm((f) => ({ ...f, [key]: val }));

  const handleSubmit = async () => {
    setError(null);
    if (!form.libelle.trim()) { setError("Le libellé est obligatoire."); return; }
    if (!isEdit && !form.code.trim()) { setError("Le code est obligatoire."); return; }
    setLoading(true);
    try {
      if (isEdit) {
        await api.patch(`/roles/${role!.id}`, {
          libelle: form.libelle,
          description: form.description || null,
          couleur: form.couleur,
          icone: form.icone || null,
        });
      } else {
        await api.post("/roles", form);
      }
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Erreur lors de l'enregistrement.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden border border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <h2 className="font-semibold text-foreground">
              {isEdit ? "Modifier le rôle" : "Créer un rôle"}
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Code (création uniquement) */}
          {!isEdit && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Code <span className="text-destructive">*</span>
              </label>
              <input
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="ex. responsable_site"
                value={form.code}
                onChange={(e) => set("code", e.target.value.toLowerCase().replace(/\s/g, "_"))}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Minuscules, chiffres et underscore uniquement. Non modifiable après création.
              </p>
            </div>
          )}

          {/* Libellé */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Libellé <span className="text-destructive">*</span>
            </label>
            <input
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="ex. Responsable de site"
              value={form.libelle}
              onChange={(e) => set("libelle", e.target.value)}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Description</label>
            <textarea
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="Rôle destiné à…"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </div>

          {/* Couleur */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Couleur</label>
            <div className="flex items-center gap-2 flex-wrap">
              {DEFAULT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => set("couleur", c)}
                  className="w-7 h-7 rounded-full border-2 transition-transform hover:scale-110"
                  style={{
                    backgroundColor: c,
                    borderColor: form.couleur === c ? "#000" : "transparent",
                    transform: form.couleur === c ? "scale(1.2)" : undefined,
                  }}
                />
              ))}
              <input
                type="color"
                className="w-8 h-8 rounded cursor-pointer border border-border"
                value={form.couleur}
                onChange={(e) => set("couleur", e.target.value)}
                title="Couleur personnalisée"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-muted/30">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-muted transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {loading && <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
            {isEdit ? "Enregistrer" : "Créer le rôle"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel d'édition d'un rôle (espaces + accès menus)
// ---------------------------------------------------------------------------

function RolePanel({
  role,
  espaces,
  onClose,
  onSaved,
}: {
  role: Role;
  espaces: Espace[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tab, setTab] = useState<Tab>("espaces");
  const [detail, setDetail] = useState<Role | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Espaces sélectionnés (IDs)
  const [selectedEspaces, setSelectedEspaces] = useState<Set<number>>(new Set());
  // Accès menus : menu_code → actif
  const [acces, setAcces] = useState<Map<string, boolean>>(new Map());

  // Utilisateurs ayant ce rôle
  const [users, setUsers] = useState<RoleUser[]>([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [busyUser, setBusyUser] = useState<string | null>(null);

  // Ajout : recherche de candidats
  const [candSearch, setCandSearch] = useState("");
  const [candidats, setCandidats] = useState<Candidat[]>([]);
  const [candLoading, setCandLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true); setError(null);
    try {
      const data = await api.get<RoleUser[]>(`/roles/${role.id}/utilisateurs`);
      setUsers(data);
      setUsersLoaded(true);
    } catch (e: any) {
      setError(e?.message ?? "Impossible de charger les utilisateurs.");
    } finally {
      setUsersLoading(false);
    }
  }, [role.id]);

  useEffect(() => {
    if (tab === "utilisateurs" && !usersLoaded && !usersLoading) loadUsers();
  }, [tab, usersLoaded, usersLoading, loadUsers]);

  // Recherche de candidats (utilisateurs sans ce rôle), debouncée
  useEffect(() => {
    if (!showAdd) return;
    let annule = false;
    setCandLoading(true);
    const h = setTimeout(async () => {
      try {
        const data = await api.get<Candidat[]>(
          `/roles/${role.id}/utilisateurs/candidats${candSearch.trim() ? `?q=${encodeURIComponent(candSearch.trim())}` : ""}`
        );
        if (!annule) setCandidats(data);
      } catch {
        if (!annule) setCandidats([]);
      } finally {
        if (!annule) setCandLoading(false);
      }
    }, 250);
    return () => { annule = true; clearTimeout(h); };
  }, [candSearch, showAdd, role.id]);

  const ajouter = async (c: Candidat) => {
    setBusyUser(c.user_id); setError(null);
    try {
      await api.post(`/roles/${role.id}/utilisateurs`, { user_id: c.user_id });
      setShowAdd(false); setCandSearch("");
      await loadUsers();
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? "Ajout impossible.");
    } finally {
      setBusyUser(null);
    }
  };

  const retirer = async (u: RoleUser) => {
    setBusyUser(u.user_id); setError(null);
    try {
      await api.delete(`/roles/${role.id}/utilisateurs/${u.user_id}`);
      setUsers((prev) => prev.filter((x) => x.user_id !== u.user_id));
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? "Retrait impossible.");
    } finally {
      setBusyUser(null);
    }
  };

  const majDates = async (u: RoleUser, champ: "date_debut" | "date_fin", valeur: string) => {
    const nouvelle = valeur || null;
    setUsers((prev) => prev.map((x) => (x.user_id === u.user_id ? { ...x, [champ]: nouvelle } : x)));
    try {
      await api.patch(`/roles/${role.id}/utilisateurs/${u.user_id}`, {
        date_debut: champ === "date_debut" ? nouvelle : u.date_debut,
        date_fin: champ === "date_fin" ? nouvelle : u.date_fin,
      });
    } catch (e: any) {
      setError(e?.message ?? "Mise à jour des dates impossible.");
      loadUsers(); // resynchronise en cas d'échec
    }
  };

  const loadDetail = useCallback(async () => {
    setLoadingDetail(true);
    try {
      const data = await api.get<Role>(`/roles/${role.id}`);
      setDetail(data);
      setSelectedEspaces(new Set((data.espaces ?? []).map((e) => e.id)));
      const m = new Map<string, boolean>();
      (data.acces_menus ?? []).forEach((a) => m.set(a.menu_code, a.actif));
      setAcces(m);
    } finally {
      setLoadingDetail(false);
    }
  }, [role.id]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  const toggleEspace = (id: number) => {
    setSelectedEspaces((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleMenu = (code: string) => {
    if (role.code === "administrateur") return; // immuable
    setAcces((prev) => {
      const next = new Map(prev);
      next.set(code, !prev.get(code));
      return next;
    });
  };

  const saveEspaces = async () => {
    setSaving(true); setError(null); setSaveMsg(null);
    try {
      await api.put(`/roles/${role.id}/espaces`, { espace_ids: [...selectedEspaces] });
      setSaveMsg("Espaces enregistrés ✓");
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? "Erreur.");
    } finally {
      setSaving(false);
    }
  };

  const saveAcces = async () => {
    setSaving(true); setError(null); setSaveMsg(null);
    const payload = (detail?.acces_menus ?? []).map((m) => ({
      menu_code: m.menu_code,
      actif: acces.get(m.menu_code) ?? false,
    }));
    try {
      await api.put(`/roles/${role.id}/acces`, { acces: payload });
      setSaveMsg("Accès enregistrés ✓");
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? "Erreur.");
    } finally {
      setSaving(false);
    }
  };

  // Grouper les menus par parent
  const menusParents = (detail?.acces_menus ?? []).filter((m) => !m.parent_code);
  const menusEnfants = (detail?.acces_menus ?? []).filter((m) => !!m.parent_code);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "espaces",      label: "Espaces",      icon: <Layers className="w-4 h-4" /> },
    { id: "acces",        label: "Accès menus",  icon: <Grid   className="w-4 h-4" /> },
    { id: "utilisateurs", label: "Utilisateurs", icon: <Users  className="w-4 h-4" /> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col overflow-hidden border border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm"
              style={{ backgroundColor: role.couleur ?? "#6366F1" }}
            >
              {role.libelle.charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="font-semibold text-foreground">{role.libelle}</h2>
              <p className="text-xs text-muted-foreground font-mono">{role.code}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-3 border-b border-border shrink-0">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setSaveMsg(null); setError(null); }}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                tab === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loadingDetail ? (
            <Spinner />
          ) : tab === "espaces" ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Sélectionnez les espaces de travail accessibles par ce rôle. Un espace non coché ne sera pas proposé lors de la connexion.
              </p>
              {espaces.map((e) => (
                <label
                  key={e.id}
                  className="flex items-center gap-4 p-4 rounded-xl border border-border hover:bg-muted/50 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selectedEspaces.has(e.id)}
                    onChange={() => toggleEspace(e.id)}
                    className="w-4 h-4 rounded accent-primary"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{e.libelle}</p>
                    <p className="text-xs text-muted-foreground font-mono">{e.chemin}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground/40" />
                </label>
              ))}
            </div>
          ) : tab === "acces" ? (
            <div className="space-y-4">
              {role.code === "administrateur" && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm text-primary">
                  <Lock className="w-4 h-4 shrink-0" />
                  L'administrateur a accès à tous les menus (non modifiable pour raisons de sécurité).
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                Activez ou désactivez l'accès à chaque menu pour ce rôle.
              </p>

              {menusParents.map((menu) => {
                const enfants = menusEnfants.filter((m) => m.parent_code === menu.menu_code);
                const isActive = acces.get(menu.menu_code) ?? false;
                return (
                  <div key={menu.menu_code} className="rounded-xl border border-border overflow-hidden">
                    {/* Menu parent */}
                    <div className="flex items-center justify-between px-4 py-3 bg-muted/30">
                      <span className="text-sm font-semibold text-foreground">{menu.libelle}</span>
                      <button
                        disabled={role.code === "administrateur"}
                        onClick={() => toggleMenu(menu.menu_code)}
                        className={`w-11 h-6 rounded-full transition-colors relative ${
                          isActive ? "bg-primary" : "bg-muted"
                        } ${role.code === "administrateur" ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                      >
                        <span
                          className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${
                            isActive ? "left-[22px]" : "left-0.5"
                          }`}
                        />
                      </button>
                    </div>

                    {/* Sous-menus */}
                    {enfants.length > 0 && (
                      <div className="divide-y divide-border">
                        {enfants.map((enfant) => {
                          const enfantActif = acces.get(enfant.menu_code) ?? false;
                          return (
                            <div key={enfant.menu_code} className="flex items-center justify-between px-4 py-2.5 pl-8">
                              <span className="text-sm text-muted-foreground">{enfant.libelle}</span>
                              <button
                                disabled={role.code === "administrateur"}
                                onClick={() => toggleMenu(enfant.menu_code)}
                                className={`w-9 h-5 rounded-full transition-colors relative ${
                                  enfantActif ? "bg-primary/80" : "bg-muted"
                                } ${role.code === "administrateur" ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                              >
                                <span
                                  className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${
                                    enfantActif ? "left-[18px]" : "left-0.5"
                                  }`}
                                />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            /* Onglet Utilisateurs */
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  Utilisateurs possédant ce rôle. Les dates de validité et les ajouts/retraits sont enregistrés immédiatement.
                </p>
                <button
                  onClick={() => { setShowAdd((v) => !v); setCandSearch(""); }}
                  className="shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" /> Ajouter
                </button>
              </div>

              {/* Zone d'ajout */}
              {showAdd && (
                <div className="rounded-xl border border-border p-3 space-y-2 bg-muted/20">
                  <input
                    autoFocus
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder="Rechercher un utilisateur à ajouter…"
                    value={candSearch}
                    onChange={(e) => setCandSearch(e.target.value)}
                  />
                  <div className="max-h-56 overflow-y-auto divide-y divide-border rounded-lg border border-border bg-background">
                    {candLoading ? (
                      <div className="text-center py-6 text-sm text-muted-foreground">Recherche…</div>
                    ) : candidats.length === 0 ? (
                      <div className="text-center py-6 text-sm text-muted-foreground">Aucun utilisateur disponible.</div>
                    ) : (
                      candidats.map((c) => (
                        <button
                          key={c.user_id}
                          disabled={busyUser === c.user_id}
                          onClick={() => ajouter(c)}
                          className="w-full text-left flex items-center gap-3 px-3 py-2 hover:bg-muted/40 transition-colors disabled:opacity-50"
                        >
                          <Plus className="w-4 h-4 text-primary shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">
                              {(c.prenom || c.nom) ? `${c.prenom} ${c.nom}`.trim() : c.email}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">{c.email}</p>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Liste des utilisateurs ayant le rôle */}
              {usersLoading ? (
                <Spinner />
              ) : users.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground rounded-xl border border-border">
                  Aucun utilisateur n'a ce rôle pour le moment.
                </div>
              ) : (
                <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
                  {users.map((u) => (
                    <div key={u.user_id} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors">
                      <div className="flex-1 min-w-[180px]">
                        <p className="text-sm font-medium text-foreground truncate">
                          {(u.prenom || u.nom) ? `${u.prenom} ${u.nom}`.trim() : u.email}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex flex-col">
                          <span className="text-[11px] text-muted-foreground">Début</span>
                          <input
                            type="date"
                            value={u.date_debut ?? ""}
                            onChange={(e) => majDates(u, "date_debut", e.target.value)}
                            className="px-2 py-1 rounded-md border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
                          />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[11px] text-muted-foreground">Fin</span>
                          <input
                            type="date"
                            value={u.date_fin ?? ""}
                            onChange={(e) => majDates(u, "date_fin", e.target.value)}
                            className="px-2 py-1 rounded-md border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
                          />
                        </div>
                        <button
                          title="Retirer ce rôle à l'utilisateur"
                          disabled={busyUser === u.user_id}
                          onClick={() => retirer(u)}
                          className="self-end p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {!loadingDetail && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-muted/30 shrink-0">
            <div className="text-sm">
              {saveMsg && (
                <span className="flex items-center gap-1 text-emerald-600">
                  <Check className="w-4 h-4" /> {saveMsg}
                </span>
              )}
              {error && (
                <span className="flex items-center gap-1 text-destructive">
                  <AlertTriangle className="w-4 h-4" /> {error}
                </span>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm hover:bg-muted transition-colors">
                Fermer
              </button>
              {role.code !== "administrateur" && tab !== "utilisateurs" && (
                <button
                  onClick={tab === "espaces" ? saveEspaces : saveAcces}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {saving && <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                  Enregistrer
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page principale
// ---------------------------------------------------------------------------

export default function GestionRolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [espaces, setEspaces] = useState<Espace[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editRole, setEditRole] = useState<Role | null>(null);
  const [panelRole, setPanelRole] = useState<Role | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rolesData = await api.get<Role[]>("/roles");
      setRoles(rolesData);
      try {
        const espacesData = await api.get<Espace[]>("/roles/espaces");
        setEspaces(espacesData);
      } catch {
        // Les espaces ne sont pas bloquants pour la gestion des rôles
        setEspaces([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = roles.filter(
    (r) =>
      r.libelle.toLowerCase().includes(search.toLowerCase()) ||
      r.code.toLowerCase().includes(search.toLowerCase())
  );

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await api.delete(`/roles/${deleteTarget.id}`);
      setDeleteTarget(null);
      load();
    } catch (e: any) {
      setDeleteError(e?.message ?? "Erreur lors de la suppression.");
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* En-tête */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <Shield className="w-7 h-7 text-primary" />
            Gestion des accès — Rôles
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Créez des rôles personnalisés, affectez-leur des espaces et gérez leurs accès menus.
            Les rôles système sont verrouillés.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" /> Nouveau rôle
        </button>
      </div>

      {/* Barre de recherche */}
      <div className="relative">
        <input
          className="w-full pl-4 pr-4 py-2.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          placeholder="Rechercher un rôle…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Liste */}
      {loading ? (
        <Spinner />
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          {/* En-tête tableau */}
          <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-5 py-3 bg-muted/40 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            <span>Rôle</span>
            <span className="text-right">Utilisateurs</span>
            <span className="text-right">Statut</span>
            <span className="text-right">Actions</span>
          </div>

          {filtered.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Aucun rôle trouvé.
            </div>
          )}

          <div className="divide-y divide-border">
            {filtered.map((role) => (
              <div
                key={role.id}
                className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-5 py-4 hover:bg-muted/20 transition-colors"
              >
                {/* Rôle */}
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0"
                    style={{ backgroundColor: role.couleur ?? "#6366F1" }}
                  >
                    {role.libelle.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-foreground text-sm">{role.libelle}</span>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono truncate">{role.code}</p>
                    {role.description && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{role.description}</p>
                    )}
                  </div>
                </div>

                {/* Nb utilisateurs */}
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Users className="w-3.5 h-3.5" />
                  {role.nb_utilisateurs}
                </div>

                {/* Statut */}
                <div>
                  {role.actif ? (
                    <Badge color="#10B981"><Check className="w-3 h-3" /> Actif</Badge>
                  ) : (
                    <Badge color="#6B7280">Inactif</Badge>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                  {/* Espaces + accès */}
                  <button
                    title="Gérer les espaces et accès"
                    onClick={() => setPanelRole(role)}
                    className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Grid className="w-4 h-4" />
                  </button>
                  {/* Édition */}
                  <button
                    title="Modifier le rôle"
                    onClick={() => setEditRole(role)}
                    className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  {/* Suppression (sauf administrateur, structurel) */}
                  {role.code !== "administrateur" ? (
                    <button
                      title="Supprimer le rôle"
                      onClick={() => { setDeleteTarget(role); setDeleteError(null); }}
                      className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  ) : (
                    <div className="p-2 text-muted-foreground/30" title="Le rôle administrateur ne peut pas être supprimé">
                      <Lock className="w-4 h-4" />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Modal création */}
      {showCreate && (
        <RoleModal role={null} onClose={() => setShowCreate(false)} onSaved={load} />
      )}

      {/* Modal édition */}
      {editRole && (
        <RoleModal role={editRole} onClose={() => setEditRole(null)} onSaved={load} />
      )}

      {/* Panel espaces + accès */}
      {panelRole && (
        <RolePanel
          role={panelRole}
          espaces={espaces}
          onClose={() => setPanelRole(null)}
          onSaved={load}
        />
      )}

      {/* Modal suppression */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-background rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden border border-border">
            <div className="px-6 py-5 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-destructive" />
                </div>
                <h2 className="font-semibold text-foreground">Supprimer le rôle</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Êtes-vous sûr de vouloir supprimer le rôle{" "}
                <strong>{deleteTarget.libelle}</strong> ?
                Cette action est irréversible. Si des utilisateurs ont encore ce rôle assigné, la suppression sera refusée.
              </p>
              {deleteError && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {deleteError}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-border bg-muted/30">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 rounded-lg text-sm hover:bg-muted transition-colors">
                Annuler
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteLoading}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-destructive text-white hover:bg-destructive/90 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {deleteLoading && <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
