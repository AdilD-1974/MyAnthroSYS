import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { Search, Save, Loader2, Check, Shield, ChevronRight, ChevronDown } from "lucide-react";

// Rôles gérés. L'administrateur voit tout par règle → colonne en lecture seule.
const ROLES: { code: string; label: string; lockedOn?: boolean }[] = [
  { code: "administrateur", label: "Administrateur", lockedOn: true },
  { code: "gestionnaire_rh", label: "Gestionnaire RH" },
  { code: "gestionnaire_paie", label: "Gestionnaire Paie" },
  { code: "manager", label: "Manager" },
  { code: "collaborateur", label: "Collaborateur" },
];

// Espaces personnels/manager : non accessibles à l'administrateur.
const ADMIN_MENUS_CACHES = ["mon_espace", "mon_equipe", "espace_manager"];

interface MenuRow { id: string; parent_id: string | null; code: string; libelle: string; ordre: number; actif: boolean; }

export default function RolesAccessPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [assign, setAssign] = useState<Record<string, Set<string>>>({});
  const [initial, setInitial] = useState<Record<string, Set<string>>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // ── Chargement menus + affectations ───────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ["acces-roles-data"],
    queryFn: async () => {
      const [items, roles] = await Promise.all([
        api.get("/db/menu_items?order=ordre&select=id,parent_id,code,libelle,ordre,actif") as Promise<MenuRow[]>,
        api.get("/db/menu_role?select=menu_id,role") as Promise<{ menu_id: string; role: string }[]>,
      ]);
      return { items: items || [], roles: roles || [] };
    },
  });

  // Initialise la matrice à partir des données
  useEffect(() => {
    if (!data) return;
    const m: Record<string, Set<string>> = {};
    data.items.forEach((it) => { m[it.id] = new Set(); });
    data.roles.forEach((r) => { (m[r.menu_id] = m[r.menu_id] || new Set()).add(r.role); });
    setAssign(structuredCloneSets(m));
    setInitial(structuredCloneSets(m));
  }, [data]);

  // ── Arbre ordonné (DFS + profondeur) ──────────────────────────────────────
  const { childrenOf, ordered } = useMemo(() => {
    const items = data?.items || [];
    const byId: Record<string, MenuRow> = {};
    items.forEach((i) => { byId[i.id] = i; });
    const ch: Record<string, MenuRow[]> = {};
    const roots: MenuRow[] = [];
    items.forEach((i) => {
      if (i.parent_id && byId[i.parent_id]) (ch[i.parent_id] = ch[i.parent_id] || []).push(i);
      else roots.push(i);
    });
    const sortFn = (a: MenuRow, b: MenuRow) => a.ordre - b.ordre;
    roots.sort(sortFn);
    const out: { node: MenuRow; depth: number }[] = [];
    const walk = (n: MenuRow, depth: number) => {
      out.push({ node: n, depth });
      (ch[n.id] || []).slice().sort(sortFn).forEach((c) => walk(c, depth + 1));
    };
    roots.forEach((r) => walk(r, 0));
    return { childrenOf: ch, ordered: out };
  }, [data]);

  const descendants = (id: string): string[] => {
    const acc = [id]; const stack = [id];
    while (stack.length) { const cur = stack.pop()!; (childrenOf[cur] || []).forEach((c) => { acc.push(c.id); stack.push(c.id); }); }
    return acc;
  };

  // ── Toggles ────────────────────────────────────────────────────────────────
  const toggleCell = (menuId: string, role: string) => {
    setAssign((prev) => {
      const next = structuredCloneSets(prev);
      const ids = descendants(menuId);            // cascade hiérarchique
      const turningOn = !next[menuId]?.has(role);
      ids.forEach((id) => {
        next[id] = next[id] || new Set();
        turningOn ? next[id].add(role) : next[id].delete(role);
      });
      return next;
    });
  };
  const toggleColumn = (role: string) => {
    setAssign((prev) => {
      const next = structuredCloneSets(prev);
      const allOn = ordered.every(({ node }) => next[node.id]?.has(role));
      ordered.forEach(({ node }) => {
        next[node.id] = next[node.id] || new Set();
        allOn ? next[node.id].delete(role) : next[node.id].add(role);
      });
      return next;
    });
  };
  const toggleCollapse = (id: string) =>
    setCollapsed((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Une ligne est cachée si un de ses ancêtres est replié
  const isHidden = (depth: number, idx: number): boolean => {
    if (collapsed.size === 0) return false;
    // remonter : un parent replié rend les descendants cachés
    for (let i = idx - 1; i >= 0; i--) {
      const prev = ordered[i];
      if (prev.depth < depth) {
        if (collapsed.has(prev.node.id)) return true;
        depth = prev.depth;
        if (depth === 0) break;
      }
    }
    return false;
  };

  // ── Recherche ────────────────────────────────────────────────────────────
  const q = search.trim().toLowerCase();
  const matchSet = useMemo(() => {
    if (!q) return null;
    const keep = new Set<string>();
    const byId: Record<string, MenuRow> = {};
    (data?.items || []).forEach((i) => { byId[i.id] = i; });
    (data?.items || []).forEach((i) => {
      if (i.libelle.toLowerCase().includes(q) || i.code.toLowerCase().includes(q)) {
        keep.add(i.id);
        let p = i.parent_id;            // garder les ancêtres pour le contexte
        while (p && byId[p]) { keep.add(p); p = byId[p].parent_id; }
      }
    });
    return keep;
  }, [q, data]);

  // ── Diff & sauvegarde ──────────────────────────────────────────────────────
  const dirty = useMemo(() => {
    let n = 0;
    Object.keys(assign).forEach((id) => {
      const a = assign[id] || new Set(); const b = initial[id] || new Set();
      ROLES.forEach((r) => { if (r.lockedOn) return; if (a.has(r.code) !== b.has(r.code)) n++; });
    });
    return n;
  }, [assign, initial]);

  const save = async () => {
    setSaving(true);
    const adds: { menu_id: string; role: string }[] = [];
    const dels: { menu_id: string; role: string }[] = [];
    Object.keys(assign).forEach((id) => {
      const a = assign[id] || new Set(); const b = initial[id] || new Set();
      ROLES.forEach((r) => {
        if (r.lockedOn) return;
        const was = b.has(r.code), now = a.has(r.code);
        if (now && !was) adds.push({ menu_id: id, role: r.code });
        if (!now && was) dels.push({ menu_id: id, role: r.code });
      });
    });
    try {
      for (const a of adds) await api.post("/db/menu_role", a);
      for (const d of dels) await (api as any).delete(`/db/menu_role?menu_id=eq.${d.menu_id}&role=eq.${d.role}`);
      toast({ title: "Accès enregistrés", description: `${adds.length} ajout(s), ${dels.length} retrait(s).` });
      setInitial(structuredCloneSets(assign));
      qc.invalidateQueries({ queryKey: ["acces-roles-data"] });
      qc.invalidateQueries({ queryKey: ["menu-tree"] }); // rafraîchit le Sidebar
    } catch (e) {
      toast({ title: "Échec de l'enregistrement", description: "Vérifiez que le proxy autorise DELETE sur /db/menu_role.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-5 space-y-4">
      {/* En-tête */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}>
            <Shield size={20} /> Gestion des accès — Rôles
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
            Définit les menus visibles par rôle. L'administrateur a accès à tout (non modifiable).
          </p>
        </div>
        <Button onClick={save} disabled={saving || dirty === 0} className="gap-1.5">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          Enregistrer{dirty > 0 ? ` (${dirty})` : ""}
        </Button>
      </div>

      {/* Recherche */}
      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un menu…" className="pl-9" />
      </div>

      {/* Matrice */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16" style={{ color: "hsl(var(--muted-foreground))" }}>
          <Loader2 size={20} className="animate-spin mr-2" /> Chargement…
        </div>
      ) : (
        <div className="rounded-2xl border overflow-auto" style={{ borderColor: "hsl(var(--border))" }}>
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10" style={{ background: "hsl(var(--muted))" }}>
              <tr style={{ borderBottom: "1px solid hsl(var(--border))" }}>
                <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))", minWidth: 280 }}>
                  Menu
                </th>
                {ROLES.map((r) => (
                  <th key={r.code} className="px-3 py-2 text-center" style={{ minWidth: 120 }}>
                    <div className="text-[11px] font-bold" style={{ color: "hsl(var(--foreground))" }}>{r.label}</div>
                    {!r.lockedOn ? (
                      <button type="button" onClick={() => toggleColumn(r.code)}
                        className="text-[10px] mt-0.5 hover:underline" style={{ color: "hsl(var(--primary))" }}>
                        tout / rien
                      </button>
                    ) : (
                      <div className="text-[10px] mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>verrouillé</div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ordered.map(({ node, depth }, idx) => {
                if (matchSet ? !matchSet.has(node.id) : isHidden(depth, idx)) return null;
                const hasChildren = (childrenOf[node.id] || []).length > 0;
                const isCollapsed = collapsed.has(node.id);
                return (
                  <tr key={node.id} className="hover:bg-accent/5 transition-colors"
                    style={{ borderBottom: "1px solid hsl(var(--border))", background: depth === 0 ? "hsl(var(--muted) / 0.25)" : undefined }}>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1.5" style={{ paddingLeft: `${depth * 18}px` }}>
                        {hasChildren && !matchSet ? (
                          <button type="button" onClick={() => toggleCollapse(node.id)} style={{ color: "hsl(var(--muted-foreground))" }}>
                            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                          </button>
                        ) : <span className="w-[14px] inline-block" />}
                        <span className={depth === 0 ? "font-semibold" : ""} style={{ color: "hsl(var(--foreground))" }}>{node.libelle}</span>
                        <span className="text-[10px] font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>{node.code}</span>
                        {!node.actif && <span className="text-[9px] px-1 rounded" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>inactif</span>}
                      </div>
                    </td>
                    {ROLES.map((r) => {
                      const adminHidden = r.lockedOn && ADMIN_MENUS_CACHES.includes(node.code);
                      const on = r.lockedOn ? !adminHidden : assign[node.id]?.has(r.code);
                      return (
                        <td key={r.code} className="text-center px-3 py-2">
                          <button type="button" disabled={r.lockedOn} onClick={() => toggleCell(node.id, r.code)}
                            className="w-5 h-5 rounded inline-flex items-center justify-center transition-colors mx-auto"
                            style={{
                              background: on ? "hsl(var(--primary))" : "transparent",
                              border: `1.5px solid ${on ? "hsl(var(--primary))" : "hsl(var(--border))"}`,
                              cursor: r.lockedOn ? "not-allowed" : "pointer",
                              opacity: r.lockedOn ? 0.6 : 1,
                            }}>
                            {on && <Check size={12} color="white" />}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>
        Cocher un menu parent applique le droit à tous ses sous-menus. Les modifications ne sont appliquées qu'au clic sur « Enregistrer ».
      </p>
    </div>
  );
}

// Clone profond d'un Record<string, Set>
function structuredCloneSets(src: Record<string, Set<string>>): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  Object.keys(src).forEach((k) => { out[k] = new Set(src[k]); });
  return out;
}
