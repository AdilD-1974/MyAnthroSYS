/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║              TROMBINOSCOPE — ANTHRO-SYS SIRH                        ║
 * ║                                                                      ║
 * ║  Fonctionnalités :                                                   ║
 * ║  • Vue grille (cartes) / vue liste / vue alphabétique               ║
 * ║  • Recherche full-text (nom, prénom, poste, UO, email, tél)         ║
 * ║  • Filtres : Genre, UO, Poste, Statut                               ║
 * ║  • Tri : Nom, Prénom, Matricule, UO                                 ║
 * ║  • Carte avec flip 3D (recto identité / verso coordonnées)          ║
 * ║  • Export Excel                                                      ║
 * ║  • Statistiques équipe temps réel                                    ║
 * ║  • Panel détail coulissant                                           ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import React, { useEffect, useState, useMemo } from "react";
import { api } from "@/lib/api";
import {
  Search, Users, ChevronRight, ChevronDown, Building2,
  Mail, Phone, Briefcase, Grid3X3, List, AlignLeft,
  Download, SlidersHorizontal, X, ArrowUpDown, ArrowUp,
  ArrowDown, UserCircle2, MapPin, RefreshCw, Filter,
  ChevronLeft,
} from "lucide-react";
import * as XLSX from "xlsx";

// ── Interface UO avec hiérarchie ─────────────────────────────────────────
interface UO {
  id: string;
  libelle: string;
  parent_id: string | null;
  niveau: number;   // calculé
  children?: UO[];
}

// ── Interface enrichie ────────────────────────────────────────────────────
interface Collab {
  id: string;
  matricule: string;
  nom: string;
  prenom: string;
  photo_path: string | null;
  email_professionnel: string | null;
  gsm: string | null;
  code_genre: string;
  statut_collaborateur: string;
  date_naissance: string | null;
  poste?: string;
  code_poste?: string;
  unite?: string;
  unite_id?: string;
  date_anciennete?: string | null;
}

type ViewMode = "grille" | "liste" | "alpha";
type SortKey  = "nom" | "prenom" | "matricule" | "unite" | "poste";
type SortDir  = "asc" | "desc";

// ── Palette de couleurs par initiales ────────────────────────────────────
const AVATAR_COLORS = [
  { bg: "#EFF6FF", text: "#1D4ED8" },
  { bg: "#F0FDF4", text: "#15803D" },
  { bg: "#FFF7ED", text: "#C2410C" },
  { bg: "#FAF5FF", text: "#7E22CE" },
  { bg: "#ECFDF5", text: "#065F46" },
  { bg: "#FEF2F2", text: "#B91C1C" },
  { bg: "#FFFBEB", text: "#92400E" },
  { bg: "#F0F9FF", text: "#0369A1" },
];

const avatarColor = (matricule: string) =>
  AVATAR_COLORS[(matricule?.charCodeAt(0) || 65) % AVATAR_COLORS.length];

// ── Calcul ancienneté ─────────────────────────────────────────────────────
const calcAnciennete = (date: string | null | undefined): string => {
  if (!date) return "—";
  const d = new Date(date);
  const now = new Date();
  const ans = now.getFullYear() - d.getFullYear() -
    (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate()) ? 1 : 0);
  if (ans === 0) {
    const mois = Math.floor((now.getTime() - d.getTime()) / (30 * 24 * 3600 * 1000));
    return `${mois} mois`;
  }
  return `${ans} an${ans > 1 ? "s" : ""}`;
};

// ── Avatar composant ──────────────────────────────────────────────────────
const Avatar = ({ collab, size = 48, className = "" }: { collab: Collab; size?: number; className?: string }) => {
  const photoUrl = collab.photo_path?.startsWith("http") ? collab.photo_path : null;
  const col = avatarColor(collab.matricule);
  return photoUrl ? (
    <img src={photoUrl} alt={`${collab.prenom} ${collab.nom}`}
      className={`rounded-full object-cover flex-shrink-0 ${className}`}
      style={{ width: size, height: size, border: "2px solid #e2e8f0" }}
      onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
  ) : (
    <div className={`rounded-full flex items-center justify-center font-bold flex-shrink-0 ${className}`}
      style={{ width: size, height: size, background: col.bg, color: col.text, fontSize: size * 0.33, border: "2px solid #e2e8f0" }}>
      {collab.prenom?.[0]}{collab.nom?.[0]}
    </div>
  );
};

// ── Badge genre ───────────────────────────────────────────────────────────
const GenreBadge = ({ genre }: { genre: string }) => (
  <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
    style={{
      background: genre === "F" ? "#FDF2F8" : "#EFF6FF",
      color: genre === "F" ? "#9D174D" : "#1E40AF",
    }}>
    {genre === "F" ? "♀ Femme" : genre === "H" ? "♂ Homme" : genre}
  </span>
);

// ── Composant principal ───────────────────────────────────────────────────
const TrombinoscopePage: React.FC = () => {
  // États données
  const [collabs, setCollabs]   = useState<Collab[]>([]);
  const [uoTree, setUoTree]     = useState<UO[]>([]);   // arbre UO hiérarchique
  const [uoFlat, setUoFlat]     = useState<UO[]>([]);   // liste plate triée
  const [loading, setLoading]   = useState(true);

  // États UI
  const [viewMode, setViewMode]               = useState<ViewMode>("grille");
  const [search, setSearch]                   = useState("");

  // Filtres multi-select (Set d'IDs/valeurs sélectionnés)
  const [filterGenres, setFilterGenres]       = useState<Set<string>>(new Set());
  const [filterUniteIds, setFilterUniteIds]   = useState<Set<string>>(new Set());
  const [filterPostes, setFilterPostes]       = useState<Set<string>>(new Set());
  const [filterStatuts, setFilterStatuts]     = useState<Set<string>>(new Set());

  // Dropdowns ouverts
  const [openDropdown, setOpenDropdown]       = useState<string | null>(null);

  const [sortKey, setSortKey]                 = useState<SortKey>("nom");
  const [sortDir, setSortDir]                 = useState<SortDir>("asc");
  const [showFilters, setShowFilters]         = useState(false);
  const [expandedLetters, setExpandedLetters] = useState<string[]>([]);
  const [flippedId, setFlippedId]             = useState<string | null>(null);
  const [detailId, setDetailId]               = useState<string | null>(null);

  // UO ouvertes dans le dropdown hiérarchique
  const [expandedUo, setExpandedUo]           = useState<Set<string>>(new Set());

  // ── Chargement ────────────────────────────────────────────────────────
  useEffect(() => { loadCollabs(); }, []);

  const loadCollabs = async () => {
    setLoading(true);
    try {
      // ── 5 requêtes parallèles via api.get() ─────────────────────────────
      const [raw, affectations, refPostes, unitesRaw, contrats] = await Promise.all([

        // RG-TROMBI-COLLAB-01 (Adil DAIA) : Collaborateurs actifs non sortis
        api.get(
          "/db/collaborateurs" +
          "?archive=eq.false" +
          "&statut_collaborateur=neq.SORTI" +
          "&select=id,matricule,nom,prenom,photo_path,email_professionnel,gsm,code_genre,statut_collaborateur,date_naissance" +
          "&order=nom.asc"
        ) as Promise<any[]>,

        // RG-TROMBI-AFF-01 (Adil DAIA) : Affectations actives (non archivées)
        api.get(
          "/db/collaborateur_affectations" +
          "?archive=eq.false" +
          "&select=collaborateur_id,code_poste,unite_id,date_fin_uo,date_debut_uo"
        ) as Promise<any[]>,

        // RG-TROMBI-POSTE-01 (Adil DAIA) : Référentiel postes
        api.get(
          "/db/ref_poste?select=code,libelle"
        ) as Promise<any[]>,

        // RG-TROMBI-UO-01 (Adil DAIA) : UO avec parent_id pour hiérarchie
        api.get(
          "/db/unites_organisationnelles?select=id,libelle,parent_id"
        ) as Promise<any[]>,

        // RG-TROMBI-CONTRAT-01 (Adil DAIA) : Contrats ACTIF pour ancienneté
        api.get(
          "/db/collaborateur_contrats" +
          "?archive=eq.false" +
          "&code_statut_contrat=eq.ACTIF" +
          "&select=collaborateur_id,date_debut"
        ) as Promise<any[]>,
      ]);

      // ── Maps de résolution ───────────────────────────────────────────────
      const posteMap: Record<string, string> = {};
      (refPostes || []).forEach((r: any) => { posteMap[r.code] = r.libelle; });

      // Construire l'arbre UO hiérarchique
      const uoRaw: UO[] = (unitesRaw || []).map((u: any) => ({
        id: u.id, libelle: u.libelle, parent_id: u.parent_id || null, niveau: 0,
      }));
      const uoById: Record<string, UO> = {};
      uoRaw.forEach(u => { uoById[u.id] = { ...u, children: [] }; });

      const roots: UO[] = [];
      uoRaw.forEach(u => {
        if (u.parent_id && uoById[u.parent_id]) {
          uoById[u.parent_id].children!.push(uoById[u.id]);
        } else {
          roots.push(uoById[u.id]);
        }
      });

      const setNiveaux = (nodes: UO[], niveau: number) => {
        nodes.forEach(n => { n.niveau = niveau; if (n.children?.length) setNiveaux(n.children, niveau + 1); });
      };
      setNiveaux(roots, 0);

      const flatDFS = (nodes: UO[]): UO[] => nodes.flatMap(n => [n, ...flatDFS(n.children || [])]);
      setUoTree(roots);
      setUoFlat(flatDFS(roots));

      const uniteMap: Record<string, string> = {};
      uoRaw.forEach(u => { uniteMap[u.id] = u.libelle; });

      const contratMap: Record<string, string> = {};
      (contrats || []).forEach((c: any) => {
        if (!contratMap[c.collaborateur_id]) contratMap[c.collaborateur_id] = c.date_debut;
      });

      const resolvePoste = (code: string) => {
        if (posteMap[code]) return posteMap[code];
        const parent = code.includes("-") ? code.split("-").slice(0, -1).join("-") : code;
        return posteMap[parent] || code;
      };

      // ── Construction de l'index affectations par collaborateur ───────────
      const today = new Date().toISOString().split("T")[0];
      const affByCollab: Record<string, any[]> = {};
      (affectations || [])
        .filter((a: any) => !a.date_fin_uo || a.date_fin_uo >= today)
        .forEach((a: any) => {
          if (!affByCollab[a.collaborateur_id]) affByCollab[a.collaborateur_id] = [];
          affByCollab[a.collaborateur_id].push(a);
        });

      // ── Assemblage final ─────────────────────────────────────────────────
      setCollabs((raw || []).map((c: any) => {
        const affs = affByCollab[c.id] || [];
        const aff = affs.sort((a: any, b: any) =>
          (b.date_debut_uo || "").localeCompare(a.date_debut_uo || ""))[0];
        return {
          id: c.id,
          matricule: c.matricule,
          nom: c.nom,
          prenom: c.prenom,
          photo_path: c.photo_path,
          email_professionnel: c.email_professionnel,
          gsm: c.gsm,
          code_genre: c.code_genre,
          statut_collaborateur: c.statut_collaborateur,
          date_naissance: c.date_naissance,
          poste: aff?.code_poste ? resolvePoste(aff.code_poste) : "—",
          code_poste: aff?.code_poste || "",
          unite: aff?.unite_id ? uniteMap[aff.unite_id] : "—",
          unite_id: aff?.unite_id || "",
          date_anciennete: contratMap[c.id] || null,
        };
      }));

    } catch (e) {
      console.error("Erreur chargement trombinoscope :", e);
    }
    setLoading(false);
  };

  // ── Listes de filtres ─────────────────────────────────────────────────
  const postesList = useMemo(() =>
    Array.from(new Set(collabs.map(c => c.poste || "—").filter(Boolean))).sort(), [collabs]);

  // Toggle multi-select générique
  const toggleSet = (set: Set<string>, val: string): Set<string> => {
    const next = new Set(set);
    if (next.has(val)) next.delete(val); else next.add(val);
    return next;
  };

  // Sélectionner/désélectionner une UO + tous ses descendants
  const toggleUoWithChildren = (uo: UO) => {
    const ids = new Set<string>();
    const collect = (node: UO) => { ids.add(node.id); (node.children || []).forEach(collect); };
    collect(uo);
    setFilterUniteIds(prev => {
      const next = new Set(prev);
      if (next.has(uo.id)) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
  };

  const clearAll = () => {
    setFilterGenres(new Set());
    setFilterUniteIds(new Set());
    setFilterPostes(new Set());
    setFilterStatuts(new Set());
  };

  const activeFilterCount =
    filterGenres.size + filterUniteIds.size + filterPostes.size + filterStatuts.size;

  // ── Filtrage et tri ───────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return collabs
      .filter(c => {
        if (q && !`${c.prenom} ${c.nom} ${c.matricule} ${c.poste} ${c.unite} ${c.email_professionnel || ""} ${c.gsm || ""}`.toLowerCase().includes(q)) return false;
        if (filterGenres.size > 0 && !filterGenres.has(c.code_genre)) return false;
        if (filterUniteIds.size > 0 && !filterUniteIds.has(c.unite_id || "")) return false;
        if (filterPostes.size > 0 && !filterPostes.has(c.poste || "")) return false;
        if (filterStatuts.size > 0 && !filterStatuts.has(c.statut_collaborateur)) return false;
        return true;
      })
      .sort((a, b) => {
        const get = (c: Collab): string => ({ nom: c.nom, prenom: c.prenom, matricule: c.matricule, unite: c.unite || "", poste: c.poste || "" }[sortKey]);
        return sortDir === "asc" ? get(a).localeCompare(get(b), "fr") : get(b).localeCompare(get(a), "fr");
      });
  }, [collabs, search, filterGenres, filterUniteIds, filterPostes, filterStatuts, sortKey, sortDir]);

  // ── Groupement alphabétique ───────────────────────────────────────────
  const grouped = useMemo(() => {
    const g: Record<string, Collab[]> = {};
    filtered.forEach(c => {
      const l = (c.nom[0] || "#").toUpperCase();
      if (!g[l]) g[l] = [];
      g[l].push(c);
    });
    return g;
  }, [filtered]);

  // ── Actions ───────────────────────────────────────────────────────────
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey !== k ? <ArrowUpDown size={12} className="opacity-30" /> :
    sortDir === "asc" ? <ArrowUp size={12} className="text-blue-600" /> :
    <ArrowDown size={12} className="text-blue-600" />;

  const exportExcel = () => {
    const rows = filtered.map(c => ({
      "Matricule": c.matricule,
      "Nom": c.nom,
      "Prénom": c.prenom,
      "Genre": c.code_genre === "F" ? "Femme" : "Homme",
      "Poste": c.poste || "",
      "Unité": c.unite || "",
      "Email": c.email_professionnel || "",
      "Téléphone": c.gsm || "",
      "Ancienneté": calcAnciennete(c.date_anciennete),
      "Statut": c.statut_collaborateur,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Trombinoscope");
    XLSX.writeFile(wb, `trombinoscope_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  // ── Stats ─────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total: filtered.length,
    uo: new Set(filtered.map(c => c.unite_id)).size,
  }), [filtered]);

  // ── Détail collab ─────────────────────────────────────────────────────
  const detail = useMemo(() => collabs.find(c => c.id === detailId), [collabs, detailId]);

  // ═══════════════════════════════════════════════════════════
  // RENDU
  // ═══════════════════════════════════════════════════════════
  return (
    <div className="flex h-full bg-gray-50/40" style={{ minHeight: "100vh" }}
      onClick={() => setOpenDropdown(null)}>

      {/* ── Panel principal ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* ── Header ── */}
        <div className="bg-white border-b px-6 py-4 flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ background: "#EFF6FF" }}>
                <Users size={18} className="text-blue-700" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-800">Trombinoscope</h1>
                <p className="text-xs text-slate-500">
                  {collabs.length} collaborateur(s) · {stats.uo} unité(s) organisationnelle(s)
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              {/* Vue */}
              <div className="flex border rounded-lg overflow-hidden">
                {([
                  { v: "grille", icon: <Grid3X3 size={14} /> },
                  { v: "liste",  icon: <List size={14} /> },
                  { v: "alpha",  icon: <AlignLeft size={14} /> },
                ] as const).map(opt => (
                  <button key={opt.v} onClick={() => setViewMode(opt.v)}
                    className="px-3 py-1.5 transition-colors"
                    style={{
                      background: viewMode === opt.v ? "#1D4ED8" : "white",
                      color: viewMode === opt.v ? "white" : "#64748B",
                    }}>
                    {opt.icon}
                  </button>
                ))}
              </div>

              <button onClick={() => setShowFilters(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-colors relative"
                style={{
                  background: showFilters ? "#EFF6FF" : "white",
                  borderColor: showFilters ? "#1D4ED8" : "#e2e8f0",
                  color: showFilters ? "#1D4ED8" : "#64748B",
                }}>
                <SlidersHorizontal size={14} />
                Filtres
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center text-white"
                    style={{ background: "#1D4ED8" }}>
                    {activeFilterCount}
                  </span>
                )}
              </button>

              <button onClick={exportExcel}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm text-slate-600 hover:bg-slate-50 transition-colors">
                <Download size={14} /> Excel
              </button>

              <button onClick={loadCollabs}
                className="p-1.5 rounded-lg border text-slate-500 hover:bg-slate-50 transition-colors">
                <RefreshCw size={14} />
              </button>
            </div>
          </div>

          {/* Barre de recherche */}
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher par nom, prénom, poste, unité, email, téléphone…"
              className="w-full pl-9 pr-10 py-2.5 rounded-xl border text-sm outline-none transition-all"
              style={{ borderColor: search ? "#1D4ED8" : "#e2e8f0", boxShadow: search ? "0 0 0 3px #DBEAFE" : "none" }} />
            {search && (
              <button onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={14} />
              </button>
            )}
          </div>

          {/* Filtres actifs (badges) */}
          {activeFilterCount > 0 && (
            <div className="flex gap-2 mt-2 flex-wrap">
              {[...filterGenres].map(g => (
                <span key={g} className="text-[11px] px-2 py-0.5 rounded-full font-medium text-blue-700 flex items-center gap-1"
                  style={{ background: "#DBEAFE" }}>
                  Genre : {g === "F" ? "Femme" : "Homme"}
                  <button onClick={() => setFilterGenres(s => toggleSet(s, g))}><X size={9} /></button>
                </span>
              ))}
              {[...filterUniteIds].map(id => {
                const uo = uoFlat.find(u => u.id === id);
                return uo ? (
                  <span key={id} className="text-[11px] px-2 py-0.5 rounded-full font-medium text-emerald-700 flex items-center gap-1"
                    style={{ background: "#D1FAE5" }}>
                    UO : {uo.libelle}
                    <button onClick={() => setFilterUniteIds(s => toggleSet(s, id))}><X size={9} /></button>
                  </span>
                ) : null;
              })}
              {[...filterPostes].map(p => (
                <span key={p} className="text-[11px] px-2 py-0.5 rounded-full font-medium text-purple-700 flex items-center gap-1"
                  style={{ background: "#EDE9FE" }}>
                  Poste : {p}
                  <button onClick={() => setFilterPostes(s => toggleSet(s, p))}><X size={9} /></button>
                </span>
              ))}
              {[...filterStatuts].map(s => (
                <span key={s} className="text-[11px] px-2 py-0.5 rounded-full font-medium text-orange-700 flex items-center gap-1"
                  style={{ background: "#FFEDD5" }}>
                  Statut : {s}
                  <button onClick={() => setFilterStatuts(prev => toggleSet(prev, s))}><X size={9} /></button>
                </span>
              ))}
              <button onClick={clearAll}
                className="text-[11px] px-2 py-0.5 rounded-full text-red-600 hover:bg-red-50 transition-colors">
                ✕ Tout effacer
              </button>
            </div>
          )}

          {/* Panneau filtres multi-select */}
          {showFilters && (
            <div className="mt-3 pt-3 border-t grid grid-cols-4 gap-3 relative" style={{ borderColor: "#e2e8f0" }}
              onClick={() => setOpenDropdown(null)}>

              {/* ── Genre ── */}
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Genre</label>
                <div className="border rounded-lg overflow-hidden" style={{ borderColor: filterGenres.size > 0 ? "#1D4ED8" : "#e2e8f0" }}>
                  {[{ v: "F", l: "♀ Femme" }, { v: "H", l: "♂ Homme" }].map(opt => (
                    <label key={opt.v}
                      className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-blue-50 transition-colors border-b last:border-0"
                      style={{ borderColor: "#f1f5f9" }}
                      onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={filterGenres.has(opt.v)}
                        onChange={() => setFilterGenres(s => toggleSet(s, opt.v))}
                        className="rounded" />
                      <span className="text-xs text-slate-700">{opt.l}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* ── UO hiérarchique ── */}
              <div className="relative" onClick={e => e.stopPropagation()}>
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1 block">
                  Unité Organisationnelle
                </label>
                <button
                  onClick={() => setOpenDropdown(d => d === "uo" ? null : "uo")}
                  className="w-full flex items-center justify-between px-3 py-1.5 border rounded-lg text-xs text-left"
                  style={{ borderColor: filterUniteIds.size > 0 ? "#1D4ED8" : "#e2e8f0", background: "white" }}>
                  <span className="text-slate-700">
                    {filterUniteIds.size === 0 ? "Toutes les UO" : `${filterUniteIds.size} UO sélectionnée(s)`}
                  </span>
                  <ChevronDown size={12} className={openDropdown === "uo" ? "rotate-180" : ""} style={{ color: "#64748B", transition: "transform 0.2s" }} />
                </button>
                {openDropdown === "uo" && (
                  <div className="absolute top-full left-0 w-72 mt-1 border rounded-xl shadow-xl bg-white z-50 max-h-64 overflow-y-auto"
                    style={{ borderColor: "#e2e8f0" }}>
                    {/* Boutons globaux */}
                    <div className="flex gap-2 px-3 py-2 border-b sticky top-0 bg-white" style={{ borderColor: "#f1f5f9" }}>
                      <button onClick={() => setFilterUniteIds(new Set(uoFlat.map(u => u.id)))}
                        className="text-[10px] text-blue-600 hover:underline">Tout sélect.</button>
                      <span className="text-slate-300">|</span>
                      <button onClick={() => setFilterUniteIds(new Set())}
                        className="text-[10px] text-slate-500 hover:underline">Tout effacer</button>
                    </div>
                    {/* Arbre UO récursif */}
                    {(() => {
                      const renderNode = (node: UO): React.ReactNode => {
                        const hasChildren = (node.children || []).length > 0;
                        const isOpen = expandedUo.has(node.id);
                        const nbCollab = collabs.filter(c => c.unite_id === node.id).length;
                        return (
                          <div key={node.id}>
                            <label
                              className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-blue-50 transition-colors"
                              style={{ paddingLeft: `${12 + node.niveau * 16}px` }}>
                              {hasChildren && (
                                <button type="button"
                                  onClick={e => { e.preventDefault(); setExpandedUo(prev => { const n = new Set(prev); if (n.has(node.id)) n.delete(node.id); else n.add(node.id); return n; }); }}
                                  className="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-slate-600 flex-shrink-0">
                                  {isOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                                </button>
                              )}
                              {!hasChildren && <span className="w-4 flex-shrink-0" />}
                              <input type="checkbox"
                                checked={filterUniteIds.has(node.id)}
                                onChange={() => toggleUoWithChildren(node)}
                                className="rounded flex-shrink-0" />
                              <span className="text-xs text-slate-700 flex-1 leading-tight">{node.libelle}</span>
                              {nbCollab > 0 && (
                                <span className="text-[9px] px-1 rounded ml-auto flex-shrink-0"
                                  style={{ background: "#EFF6FF", color: "#1D4ED8" }}>
                                  {nbCollab}
                                </span>
                              )}
                            </label>
                            {hasChildren && isOpen && (node.children || []).map(renderNode)}
                          </div>
                        );
                      };
                      return uoTree.map(renderNode);
                    })()}
                  </div>
                )}
              </div>

              {/* ── Postes ── */}
              <div className="relative" onClick={e => e.stopPropagation()}>
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Poste</label>
                <button
                  onClick={() => setOpenDropdown(d => d === "poste" ? null : "poste")}
                  className="w-full flex items-center justify-between px-3 py-1.5 border rounded-lg text-xs text-left"
                  style={{ borderColor: filterPostes.size > 0 ? "#1D4ED8" : "#e2e8f0", background: "white" }}>
                  <span className="text-slate-700">
                    {filterPostes.size === 0 ? "Tous les postes" : `${filterPostes.size} poste(s)`}
                  </span>
                  <ChevronDown size={12} className={openDropdown === "poste" ? "rotate-180" : ""} style={{ color: "#64748B" }} />
                </button>
                {openDropdown === "poste" && (
                  <div className="absolute top-full left-0 w-64 mt-1 border rounded-xl shadow-xl bg-white z-50 max-h-56 overflow-y-auto"
                    style={{ borderColor: "#e2e8f0" }}>
                    <div className="flex gap-2 px-3 py-1.5 border-b sticky top-0 bg-white" style={{ borderColor: "#f1f5f9" }}>
                      <button onClick={() => setFilterPostes(new Set())}
                        className="text-[10px] text-slate-500 hover:underline">Tout effacer</button>
                    </div>
                    {postesList.map(p => (
                      <label key={p}
                        className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-blue-50 transition-colors border-b last:border-0"
                        style={{ borderColor: "#f1f5f9" }}>
                        <input type="checkbox" checked={filterPostes.has(p)}
                          onChange={() => setFilterPostes(s => toggleSet(s, p))}
                          className="rounded flex-shrink-0" />
                        <span className="text-xs text-slate-700 leading-tight">{p}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Statut ── */}
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Statut</label>
                <div className="border rounded-lg overflow-hidden" style={{ borderColor: filterStatuts.size > 0 ? "#1D4ED8" : "#e2e8f0" }}>
                  {["ACTIF", "EN_DEPART", "SUSPENDU"].map(s => (
                    <label key={s}
                      className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-blue-50 transition-colors border-b last:border-0"
                      style={{ borderColor: "#f1f5f9" }}
                      onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={filterStatuts.has(s)}
                        onChange={() => setFilterStatuts(prev => toggleSet(prev, s))}
                        className="rounded" />
                      <span className="text-xs text-slate-700">{s}</span>
                    </label>
                  ))}
                </div>
              </div>

            </div>
          )}
        </div>

        {/* ── Stats rapides ── */}
        <div className="px-6 py-3 border-b bg-white flex items-center gap-6 text-xs flex-shrink-0">
          <span className="font-semibold text-slate-700">
            <span className="text-blue-700 text-sm font-bold">{stats.total}</span> résultat(s)
          </span>
          <span className="text-slate-500">
            <strong>{stats.uo}</strong> UO distincte(s)
          </span>
          {activeFilterCount > 0 && (
            <span className="text-blue-600 font-medium">
              {activeFilterCount} filtre(s) actif(s)
            </span>
          )}
        </div>

        {/* ── Contenu ── */}
        <div className="flex-1 overflow-auto p-6">

          {loading ? (
            <div className="flex flex-col items-center justify-center py-32 gap-3">
              <div className="w-10 h-10 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-slate-500">Chargement du trombinoscope…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-32 gap-3">
              <UserCircle2 size={48} className="text-slate-300" />
              <p className="text-base font-semibold text-slate-600">Aucun collaborateur trouvé</p>
              <p className="text-sm text-slate-400">Modifiez vos critères de recherche</p>
              <button onClick={() => { setSearch(""); setFilterGenre("TOUS"); setFilterUnite("TOUS"); setFilterPoste("TOUS"); setFilterStatut("TOUS"); }}
                className="text-sm text-blue-600 hover:underline">
                Réinitialiser les filtres
              </button>
            </div>
          ) : (

            <>
              {/* ── VUE GRILLE (cartes avec flip) ── */}
              {viewMode === "grille" && (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  {filtered.map(c => {
                    const isFlipped = flippedId === c.id;
                    return (
                      <div key={c.id} className="relative" style={{ height: 220, perspective: 800 }}>
                        <div className="w-full h-full transition-transform duration-500"
                          style={{ transformStyle: "preserve-3d", transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)" }}>

                          {/* ── RECTO ── */}
                          <div className="absolute inset-0 rounded-2xl border bg-white shadow-sm overflow-hidden cursor-pointer"
                            style={{ backfaceVisibility: "hidden", borderColor: "#e2e8f0" }}
                            onClick={() => { setFlippedId(isFlipped ? null : c.id); }}>
                            {/* Bandeau couleur haut */}
                            <div className="h-16 relative"
                              style={{ background: `linear-gradient(135deg, ${avatarColor(c.matricule).bg}, ${avatarColor(c.matricule).text}22)` }}>
                              <div className="absolute -bottom-7 left-1/2 -translate-x-1/2">
                                <Avatar collab={c} size={52} className="ring-4 ring-white" />
                              </div>
                            </div>
                            {/* Infos */}
                            <div className="pt-10 px-3 pb-3 text-center">
                              <p className="text-sm font-bold text-slate-800 leading-tight mt-1">
                                {c.prenom} {c.nom}
                              </p>
                              <p className="text-[10px] font-mono text-slate-400 mb-1">{c.matricule}</p>
                              <p className="text-[10px] text-slate-500 mt-1.5 truncate" title={c.poste}>
                                <Briefcase size={9} className="inline mr-0.5" /> {c.poste}
                              </p>
                              <p className="text-[10px] text-slate-500 truncate" title={c.unite}>
                                <Building2 size={9} className="inline mr-0.5" /> {c.unite}
                              </p>
                            </div>
                            {/* Hint flip */}
                            <div className="absolute bottom-2 right-2 text-[9px] text-slate-300">
                              ↻ infos
                            </div>
                          </div>

                          {/* ── VERSO (flip) ── */}
                          <div className="absolute inset-0 rounded-2xl border bg-blue-700 shadow-sm overflow-hidden cursor-pointer p-4"
                            style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
                            onClick={() => setFlippedId(null)}>
                            <div className="flex items-center gap-2 mb-3">
                              <Avatar collab={c} size={28} />
                              <div>
                                <p className="text-xs font-bold text-white">{c.prenom} {c.nom}</p>
                                <p className="text-[9px] text-blue-200">{c.matricule}</p>
                              </div>
                            </div>
                            <div className="space-y-2">
                              {c.email_professionnel ? (
                                <a href={`mailto:${c.email_professionnel}`}
                                  onClick={e => e.stopPropagation()}
                                  className="flex items-center gap-1.5 text-[10px] text-white hover:text-blue-200 transition-colors">
                                  <div className="w-5 h-5 rounded bg-white/20 flex items-center justify-center flex-shrink-0">
                                    <Mail size={10} />
                                  </div>
                                  <span className="truncate">{c.email_professionnel}</span>
                                </a>
                              ) : (
                                <div className="flex items-center gap-1.5 text-[10px] text-blue-300 italic">
                                  <div className="w-5 h-5 rounded bg-white/10 flex items-center justify-center flex-shrink-0">
                                    <Mail size={10} />
                                  </div>
                                  Email non renseigné
                                </div>
                              )}
                              {c.gsm ? (
                                <a href={`tel:${c.gsm}`}
                                  onClick={e => e.stopPropagation()}
                                  className="flex items-center gap-1.5 text-[10px] text-white hover:text-blue-200 transition-colors">
                                  <div className="w-5 h-5 rounded bg-white/20 flex items-center justify-center flex-shrink-0">
                                    <Phone size={10} />
                                  </div>
                                  {c.gsm}
                                </a>
                              ) : (
                                <div className="flex items-center gap-1.5 text-[10px] text-blue-300 italic">
                                  <div className="w-5 h-5 rounded bg-white/10 flex items-center justify-center flex-shrink-0">
                                    <Phone size={10} />
                                  </div>
                                  N° non renseigné
                                </div>
                              )}
                              <div className="flex items-center gap-1.5 text-[10px] text-blue-100">
                                <div className="w-5 h-5 rounded bg-white/20 flex items-center justify-center flex-shrink-0">
                                  <Briefcase size={10} />
                                </div>
                                <span className="truncate">{c.poste}</span>
                              </div>
                              <div className="flex items-center gap-1.5 text-[10px] text-blue-100">
                                <div className="w-5 h-5 rounded bg-white/20 flex items-center justify-center flex-shrink-0">
                                  <Building2 size={10} />
                                </div>
                                <span className="truncate">{c.unite}</span>
                              </div>
                            </div>
                            <div className="mt-2 pt-2 border-t border-white/20 flex items-center justify-between">
                              <span className="text-[9px] text-blue-200">
                                Ancienneté : {calcAnciennete(c.date_anciennete)}
                              </span>
                              <button onClick={(e) => { e.stopPropagation(); setDetailId(c.id); setFlippedId(null); }}
                                className="text-[9px] text-white underline hover:no-underline">
                                Voir fiche →
                              </button>
                            </div>
                          </div>

                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ── VUE LISTE ── */}
              {viewMode === "liste" && (
                <div className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: "#e2e8f0" }}>
                  {/* Entête triable */}
                  <div className="grid border-b px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider"
                    style={{ gridTemplateColumns: "2.5fr 2fr 2fr 1.5fr 1.5fr 1fr", borderColor: "#e2e8f0", background: "#F8FAFC" }}>
                    {[
                      { k: "nom" as SortKey, l: "Collaborateur" },
                      { k: "poste" as SortKey, l: "Poste" },
                      { k: "unite" as SortKey, l: "Unité" },
                      { k: "nom" as SortKey, l: "Email" },
                      { k: "nom" as SortKey, l: "Téléphone" },
                      { k: "matricule" as SortKey, l: "Matricule" },
                    ].map(({ k, l }, i) => (
                      <button key={i} onClick={() => toggleSort(k)}
                        className="flex items-center gap-1 hover:text-slate-700 transition-colors text-left">
                        {l} {i < 3 && <SortIcon k={k} />}
                      </button>
                    ))}
                  </div>

                  {/* Lignes */}
                  {filtered.map((c, idx) => (
                    <div key={c.id}
                      className="grid items-center px-4 py-3 hover:bg-blue-50/30 transition-colors cursor-pointer border-b"
                      style={{
                        gridTemplateColumns: "2.5fr 2fr 2fr 1.5fr 1.5fr 1fr",
                        borderColor: "#f1f5f9",
                        background: idx % 2 === 0 ? "white" : "#FAFBFC",
                      }}
                      onClick={() => setDetailId(c.id)}>

                      {/* Identité */}
                      <div className="flex items-center gap-2.5">
                        <Avatar collab={c} size={34} />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">
                            {c.prenom} {c.nom}
                          </p>
                          <p className="text-[10px] font-mono text-slate-400">{c.matricule}</p>
                        </div>
                      </div>

                      {/* Poste */}
                      <div className="min-w-0">
                        <span className="text-xs text-slate-600 truncate block" title={c.poste}>
                          {c.poste}
                        </span>
                      </div>

                      {/* UO */}
                      <div className="min-w-0">
                        <span className="text-xs text-slate-600 truncate block" title={c.unite}>
                          {c.unite}
                        </span>
                      </div>

                      {/* Email */}
                      <div>
                        {c.email_professionnel ? (
                          <a href={`mailto:${c.email_professionnel}`}
                            onClick={e => e.stopPropagation()}
                            className="text-[10px] text-blue-600 hover:underline truncate block"
                            title={c.email_professionnel}>
                            {c.email_professionnel}
                          </a>
                        ) : (
                          <span className="text-[10px] text-slate-300 italic">—</span>
                        )}
                      </div>

                      {/* Tél */}
                      <div>
                        {c.gsm ? (
                          <a href={`tel:${c.gsm}`}
                            onClick={e => e.stopPropagation()}
                            className="text-[10px] text-slate-600 hover:text-blue-600 transition-colors">
                            {c.gsm}
                          </a>
                        ) : (
                          <span className="text-[10px] text-slate-300 italic">—</span>
                        )}
                      </div>

                      {/* Matricule */}
                      <div>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded"
                          style={{ background: "#EFF6FF", color: "#1D4ED8" }}>
                          {c.matricule}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── VUE ALPHABÉTIQUE ── */}
              {viewMode === "alpha" && (
                <div className="space-y-3">
                  {/* Lettres rapides */}
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {Object.keys(grouped).sort().map(l => (
                      <button key={l} onClick={() => setExpandedLetters(prev =>
                        prev.includes(l) ? prev.filter(x => x !== l) : [...prev, l])}
                        className="w-8 h-8 rounded-lg text-xs font-bold transition-all"
                        style={{
                          background: expandedLetters.includes(l) ? "#1D4ED8" : "#EFF6FF",
                          color: expandedLetters.includes(l) ? "white" : "#1D4ED8",
                        }}>
                        {l}
                      </button>
                    ))}
                    <button onClick={() => setExpandedLetters(Object.keys(grouped))}
                      className="px-3 h-8 rounded-lg text-xs font-medium text-blue-600 hover:bg-blue-50 border"
                      style={{ borderColor: "#DBEAFE" }}>
                      Tout ouvrir
                    </button>
                    <button onClick={() => setExpandedLetters([])}
                      className="px-3 h-8 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-50 border"
                      style={{ borderColor: "#e2e8f0" }}>
                      Tout fermer
                    </button>
                  </div>

                  {Object.keys(grouped).sort().map(letter => {
                    const isOpen = expandedLetters.includes(letter);
                    const count = grouped[letter].length;
                    return (
                      <div key={letter} className="border rounded-2xl bg-white overflow-hidden shadow-sm"
                        style={{ borderColor: "#e2e8f0" }}>
                        <button onClick={() => setExpandedLetters(prev =>
                          prev.includes(letter) ? prev.filter(l => l !== letter) : [...prev, letter])}
                          className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors">
                          <div className="flex items-center gap-3">
                            <span className="w-10 h-10 flex items-center justify-center rounded-xl font-bold text-lg text-white shadow-sm"
                              style={{ background: "#1D4ED8" }}>
                              {letter}
                            </span>
                            <div className="text-left">
                              <span className="text-sm font-semibold text-slate-700">
                                {count} collaborateur{count > 1 ? "s" : ""}
                              </span>
                              <p className="text-[10px] text-slate-400">
                                {grouped[letter].slice(0, 3).map(c => `${c.prenom} ${c.nom}`).join(", ")}
                                {count > 3 ? ` +${count - 3}` : ""}
                              </p>
                            </div>
                          </div>
                          {isOpen
                            ? <ChevronDown size={18} className="text-blue-600" />
                            : <ChevronRight size={18} className="text-slate-400" />}
                        </button>

                        {isOpen && (
                          <div className="border-t p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3"
                            style={{ borderColor: "#f1f5f9", background: "#FAFBFC" }}>
                            {grouped[letter].map(c => (
                              <div key={c.id}
                                onClick={() => setDetailId(c.id)}
                                className="flex flex-col gap-2.5 p-4 bg-white border rounded-xl shadow-sm cursor-pointer transition-all hover:border-blue-400 hover:shadow-md hover:-translate-y-0.5"
                                style={{ borderColor: "#e2e8f0" }}>
                                {/* Identité */}
                                <div className="flex items-center gap-3">
                                  <Avatar collab={c} size={44} />
                                  <div>
                                    <p className="text-sm font-bold text-slate-800">{c.prenom} {c.nom}</p>
                                    <p className="text-[10px] font-mono text-slate-400">{c.matricule}</p>
                                  </div>
                                </div>
                                {/* Badges */}
                                <div className="flex flex-wrap gap-1.5">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold"
                                    style={{ background: "#EFF6FF", color: "#1D4ED8" }}>
                                    <Briefcase size={9} /> {c.poste}
                                  </span>
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold"
                                    style={{ background: "#F0FDF4", color: "#15803D" }}>
                                    <Building2 size={9} /> {c.unite}
                                  </span>
                                  {c.email_professionnel && (
                                    <a href={`mailto:${c.email_professionnel}`}
                                      onClick={e => e.stopPropagation()}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold transition-colors hover:text-white"
                                      style={{ background: "#F8FAFC", color: "#475569", border: "1px solid #e2e8f0" }}
                                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#1D4ED8"; (e.currentTarget as HTMLElement).style.color = "white"; }}
                                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#F8FAFC"; (e.currentTarget as HTMLElement).style.color = "#475569"; }}>
                                      <Mail size={9} /> {c.email_professionnel}
                                    </a>
                                  )}
                                  {c.gsm && (
                                    <a href={`tel:${c.gsm}`}
                                      onClick={e => e.stopPropagation()}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold"
                                      style={{ background: "#FFF7ED", color: "#C2410C", border: "1px solid #FED7AA" }}>
                                      <Phone size={9} /> {c.gsm}
                                    </a>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Panel détail latéral ── */}
      {detailId && detail && (
        <div className="w-80 border-l bg-white flex flex-col flex-shrink-0 shadow-xl"
          style={{ borderColor: "#e2e8f0" }}>
          <div className="flex items-center justify-between px-5 py-4 border-b"
            style={{ borderColor: "#e2e8f0" }}>
            <span className="text-sm font-bold text-slate-700">Fiche collaborateur</span>
            <button onClick={() => setDetailId(null)}
              className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-400">
              <X size={15} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* Bandeau couleur + photo */}
            <div className="h-24 relative"
              style={{ background: `linear-gradient(135deg, ${avatarColor(detail.matricule).bg}, ${avatarColor(detail.matricule).text}33)` }}>
              <div className="absolute -bottom-8 left-5">
                <Avatar collab={detail} size={64} className="ring-4 ring-white" />
              </div>
            </div>

            <div className="px-5 pt-12 pb-5 space-y-4">
              <div>
                <h2 className="text-base font-bold text-slate-800">{detail.prenom} {detail.nom}</h2>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs font-mono text-slate-400">{detail.matricule}</span>
                </div>
              </div>

              {/* Infos */}
              {[
                { icon: <Briefcase size={13} />, label: "Poste", value: detail.poste },
                { icon: <Building2 size={13} />, label: "Unité", value: detail.unite },
                { icon: <Mail size={13} />, label: "Email", value: detail.email_professionnel, href: `mailto:${detail.email_professionnel}` },
                { icon: <Phone size={13} />, label: "Téléphone", value: detail.gsm, href: `tel:${detail.gsm}` },
                { icon: <MapPin size={13} />, label: "Ancienneté", value: calcAnciennete(detail.date_anciennete) },
              ].map(row => (
                <div key={row.label} className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ background: "#EFF6FF", color: "#1D4ED8" }}>
                    {row.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{row.label}</p>
                    {row.href && row.value ? (
                      <a href={row.href} className="text-sm text-blue-600 hover:underline truncate block">{row.value}</a>
                    ) : (
                      <p className="text-sm text-slate-700 truncate">{row.value || "—"}</p>
                    )}
                  </div>
                </div>
              ))}

              {/* Statut */}
              <div className="pt-3 border-t" style={{ borderColor: "#f1f5f9" }}>
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Statut RH</span>
                <div className="mt-1">
                  <span className="text-xs px-2.5 py-1 rounded-full font-semibold"
                    style={{
                      background: detail.statut_collaborateur === "ACTIF" ? "#F0FDF4" : "#FFF7ED",
                      color: detail.statut_collaborateur === "ACTIF" ? "#15803D" : "#C2410C",
                    }}>
                    {detail.statut_collaborateur}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TrombinoscopePage;
