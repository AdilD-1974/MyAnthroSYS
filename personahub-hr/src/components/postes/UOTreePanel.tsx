/**
 * UOTreePanel — Panneau arbre des UO avec compteurs de postes.
 * Auteur : Adil DAIA — RG-PST-ARBRE-01 (07/05/2026)
 *
 * Affiche l'arborescence des unités organisationnelles avec :
 *   - Compteurs (occupés/total + vacants) à droite de chaque nœud
 *   - Toggle "Postes directs" vs "Inclure descendants"
 *   - Recherche pour filtrer rapidement l'arbre
 *   - Sélection d'une UO qui remonte au parent via callback
 *
 * Données chargées depuis :
 *   - unites_organisationnelles (arbre)
 *   - v_uo_compteurs_postes_directs (postes directs)
 *   - v_uo_compteurs_postes_descendants (postes incluant sous-arbre)
 */
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Building2, ChevronDown, ChevronRight, Search, Layers, X,
} from "lucide-react";

interface UO {
  id: string;
  parent_id: string | null;
  code: string | null;
  libelle: string;
  type_uo: string | null;
  niveau: number | null;
}

interface Compteur {
  unite_id: string;
  nb_total_instances: number;
  nb_occupes: number;
  nb_vacants: number;
}

export interface UOTreeSelection {
  unite_id: string | null;
  mode: "directs" | "descendants";
}

interface Props {
  selection: UOTreeSelection;
  onChange: (sel: UOTreeSelection) => void;
}

const UOTreePanel: React.FC<Props> = ({ selection, onChange }) => {
  const [uos, setUos] = useState<UO[]>([]);
  const [comptDirects, setComptDirects] = useState<Record<string, Compteur>>({});
  const [comptDescendants, setComptDescendants] = useState<Record<string, Compteur>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  // ─── Chargement ────────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [{ data: uoData }, { data: dDirects }, { data: dDescendants }] = await Promise.all([
        supabase.from("unites_organisationnelles" as never)
          .select("id,parent_id,code,libelle,type_uo,niveau")
          .eq("actif" as never, true as never)
          .order("niveau" as never, { ascending: true }),
        supabase.from("v_uo_compteurs_postes_directs" as never)
          .select("unite_id,nb_total_instances,nb_occupes,nb_vacants"),
        supabase.from("v_uo_compteurs_postes_descendants" as never)
          .select("unite_id,nb_total_instances,nb_occupes,nb_vacants"),
      ]);

      const uoList = (uoData || []) as UO[];
      setUos(uoList);

      const mapDir: Record<string, Compteur> = {};
      ((dDirects || []) as Compteur[]).forEach(c => { mapDir[c.unite_id] = c; });
      setComptDirects(mapDir);

      const mapDesc: Record<string, Compteur> = {};
      ((dDescendants || []) as Compteur[]).forEach(c => { mapDesc[c.unite_id] = c; });
      setComptDescendants(mapDesc);

      // Pré-déplier les racines (niveau 1)
      const rootIds = new Set(uoList.filter(u => !u.parent_id).map(u => u.id));
      setExpanded(rootIds);
      setLoading(false);
    };
    load();
  }, []);

  // ─── Index : enfants par parent_id ─────────────────────────────────────
  const childrenMap = useMemo(() => {
    const m: Record<string, UO[]> = { ROOT: [] };
    uos.forEach(u => {
      const k = u.parent_id || "ROOT";
      if (!m[k]) m[k] = [];
      m[k].push(u);
    });
    Object.keys(m).forEach(k => m[k].sort((a, b) => a.libelle.localeCompare(b.libelle)));
    return m;
  }, [uos]);

  // ─── Recherche : si actif, déplier tous les ancêtres des matchs ────────
  const matchedIds = useMemo(() => {
    if (!search.trim()) return null;
    const s = search.toLowerCase();
    const matches = new Set<string>();
    uos.forEach(u => {
      if (u.libelle.toLowerCase().includes(s) || (u.code || "").toLowerCase().includes(s)) {
        matches.add(u.id);
      }
    });
    // Ajouter tous les ancêtres
    const byId = new Map(uos.map(u => [u.id, u]));
    const expand = new Set(matches);
    matches.forEach(id => {
      let cur = byId.get(id);
      while (cur?.parent_id) {
        expand.add(cur.parent_id);
        cur = byId.get(cur.parent_id);
      }
    });
    return { matches, expand };
  }, [search, uos]);

  // ─── Toggle expand ─────────────────────────────────────────────────────
  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ─── Compteurs globaux (pour la racine "Tous") ─────────────────────────
  const totalGlobal = useMemo(() => {
    const all = Object.values(comptDirects);
    return {
      nb_total: all.reduce((s, c) => s + c.nb_total_instances, 0),
      nb_occupes: all.reduce((s, c) => s + c.nb_occupes, 0),
      nb_vacants: all.reduce((s, c) => s + c.nb_vacants, 0),
    };
  }, [comptDirects]);

  // ─── Rendu récursif d'un nœud ──────────────────────────────────────────
  const renderNode = (uo: UO, depth: number): React.ReactNode => {
    const children = childrenMap[uo.id] || [];
    const hasChildren = children.length > 0;
    const isExpanded = matchedIds?.expand.has(uo.id) || expanded.has(uo.id);
    const isSelected = selection.unite_id === uo.id;
    const isMatch = matchedIds ? matchedIds.matches.has(uo.id) : true;
    if (matchedIds && !isMatch && !matchedIds.expand.has(uo.id)) return null;

    const compt = selection.mode === "descendants"
      ? comptDescendants[uo.id]
      : comptDirects[uo.id];
    const nbTotal = compt?.nb_total_instances || 0;
    const nbOccupes = compt?.nb_occupes || 0;
    const nbVacants = compt?.nb_vacants || 0;

    return (
      <div key={uo.id}>
        <div
          onClick={() => onChange({ ...selection, unite_id: uo.id })}
          className={`flex items-center gap-1 py-1.5 pr-2 rounded-md cursor-pointer transition-colors group ${
            isSelected ? "bg-accent/10" : "hover:bg-muted/50"
          }`}
          style={{ paddingLeft: `${depth * 14 + 4}px` }}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggle(uo.id); }}
            className="p-0.5 hover:bg-muted rounded flex-shrink-0"
            style={{ visibility: hasChildren ? "visible" : "hidden" }}>
            {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
          <Building2 size={12} className="flex-shrink-0"
            style={{ color: isSelected ? "hsl(var(--accent))" : "hsl(var(--muted-foreground))" }} />
          <span className={`text-xs flex-1 truncate ${isSelected ? "font-semibold text-accent" : ""}`}
            style={{ color: isSelected ? "hsl(var(--accent))" : "hsl(var(--foreground))" }}
            title={uo.libelle}>
            {uo.libelle}
          </span>
          {nbTotal > 0 && (
            <span className="flex items-center gap-0.5 text-[10px] flex-shrink-0">
              <span className="px-1 rounded" style={{
                background: "hsl(213 73% 45% / 0.15)",
                color: "hsl(213 73% 45%)",
              }} title={`${nbOccupes} occupés / ${nbTotal} total`}>
                {nbOccupes}/{nbTotal}
              </span>
              {nbVacants > 0 && (
                <span className="px-1 rounded" style={{
                  background: "hsl(39 95% 40% / 0.15)",
                  color: "hsl(39 95% 40%)",
                }} title={`${nbVacants} vacants`}>
                  {nbVacants}v
                </span>
              )}
            </span>
          )}
        </div>
        {isExpanded && hasChildren && (
          <div>{children.map(c => renderNode(c, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <div className="rounded-xl border bg-card flex flex-col" style={{
      borderColor: "hsl(var(--border))",
      maxHeight: "calc(100vh - 200px)",
      minHeight: 480,
    }}>
      {/* Header */}
      <div className="px-3 py-2.5 border-b flex items-center gap-2"
        style={{ borderColor: "hsl(var(--border))" }}>
        <Layers size={14} style={{ color: "hsl(var(--accent))" }} />
        <h3 className="text-xs font-semibold uppercase tracking-wide flex-1"
          style={{ color: "hsl(var(--muted-foreground))" }}>
          Arborescence UO
        </h3>
      </div>

      {/* Toggle directs / descendants */}
      <div className="px-3 py-2 border-b flex gap-1"
        style={{ borderColor: "hsl(var(--border))" }}>
        {[
          { v: "directs",     l: "Directs" },
          { v: "descendants", l: "+ Descendants" },
        ].map(opt => (
          <button
            key={opt.v}
            type="button"
            onClick={() => onChange({ ...selection, mode: opt.v as any })}
            className={`flex-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
              selection.mode === opt.v ? "bg-accent text-white" : "bg-muted/50 hover:bg-muted"
            }`}>
            {opt.l}
          </button>
        ))}
      </div>

      {/* Recherche */}
      <div className="px-3 py-2 border-b" style={{ borderColor: "hsl(var(--border))" }}>
        <div className="relative">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2"
            style={{ color: "hsl(var(--muted-foreground))" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher une UO…"
            className="w-full pl-7 pr-7 py-1 text-xs rounded outline-none border"
            style={{
              background: "hsl(var(--background))",
              borderColor: "hsl(var(--border))",
              color: "hsl(var(--foreground))",
            }} />
          {search && (
            <button onClick={() => setSearch("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted">
              <X size={10} style={{ color: "hsl(var(--muted-foreground))" }} />
            </button>
          )}
        </div>
      </div>

      {/* Item "Tous" */}
      <div className="px-3 pt-2">
        <div
          onClick={() => onChange({ ...selection, unite_id: null })}
          className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
            selection.unite_id === null ? "bg-accent/10" : "hover:bg-muted/50"
          }`}>
          <Layers size={13} style={{
            color: selection.unite_id === null ? "hsl(var(--accent))" : "hsl(var(--muted-foreground))",
          }} />
          <span className={`text-xs flex-1 ${selection.unite_id === null ? "font-semibold text-accent" : ""}`}
            style={{ color: selection.unite_id === null ? "hsl(var(--accent))" : "hsl(var(--foreground))" }}>
            Tous (toutes UO)
          </span>
          <span className="flex gap-0.5 text-[10px]">
            <span className="px-1 rounded" style={{
              background: "hsl(213 73% 45% / 0.15)", color: "hsl(213 73% 45%)",
            }}>
              {totalGlobal.nb_occupes}/{totalGlobal.nb_total}
            </span>
            {totalGlobal.nb_vacants > 0 && (
              <span className="px-1 rounded" style={{
                background: "hsl(39 95% 40% / 0.15)", color: "hsl(39 95% 40%)",
              }}>
                {totalGlobal.nb_vacants}v
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Arbre */}
      <div className="flex-1 overflow-y-auto px-1 py-2">
        {loading ? (
          <div className="text-xs text-center py-6" style={{ color: "hsl(var(--muted-foreground))" }}>
            Chargement…
          </div>
        ) : (childrenMap.ROOT || []).length === 0 ? (
          <div className="text-xs text-center py-6" style={{ color: "hsl(var(--muted-foreground))" }}>
            Aucune UO
          </div>
        ) : (
          (childrenMap.ROOT || []).map(uo => renderNode(uo, 0))
        )}
      </div>

      {/* Légende */}
      <div className="px-3 py-2 border-t text-[10px] flex items-center gap-3"
        style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded" style={{ background: "hsl(213 73% 45%)" }} /> Occupés/Total
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded" style={{ background: "hsl(39 95% 40%)" }} /> Vacants
        </span>
      </div>
    </div>
  );
};

export default UOTreePanel;
