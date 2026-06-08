/**
 * EquipeManagerView.tsx
 * Vue "Mon équipe" pour le manager — réutilise la logique de CollaborateursPage
 * mais en lecture seule, avec :
 *   - Regroupement hiérarchique par UO (UO directe → sous-UOs)
 *   - Filtre multi-UO avec sélecteur d'UO sous-tutelle
 *   - Navigation vers CollaborateurFicheManager (lecture seule, 5 onglets)
 *   - Recherche + filtres statut + filtre UO
 * RG-MANAGER-EQUIPE-UO-01 (Adil DAIA)
 */

import React, { useEffect, useState, useMemo } from "react";
import { db } from "@/lib/api";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useManagerPopulation } from "@/hooks/useManagerPopulation";
import {
  Search, Building2, ChevronDown, ChevronRight,
  LayoutGrid, List, Download, Briefcase, Mail,
  Users, Filter, X, Check,
} from "lucide-react";

// ── Interfaces ────────────────────────────────────────────────────────────────

interface Collaborateur {
  id: string; matricule: string; nom: string; prenom: string;
  code_genre: string; statut_collaborateur: string;
  email_professionnel?: string; photo_path?: string; date_naissance?: string;
}

interface ListeInfo {
  poste_libelle?: string; uo_id?: string; uo_libelle?: string;
  type_contrat_libelle?: string; date_embauche?: string;
  etablissement_libelle?: string; societe_libelle?: string;
}

interface UO {
  id: string; code?: string; libelle: string;
  parent_id?: string | null; niveau?: number; actif?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const getStatutStyle = (s: string) => {
  if (s === "ACTIF")     return { bg: "hsl(84 55% 50% / 0.15)",   color: "hsl(84 55% 35%)" };
  if (s === "EN_DEPART") return { bg: "hsl(39 95% 50% / 0.15)",   color: "hsl(39 95% 35%)" };
  if (s === "SORTI")     return { bg: "hsl(0 70% 50% / 0.12)",    color: "hsl(0 70% 40%)" };
  return                        { bg: "hsl(215 20% 55% / 0.15)",  color: "hsl(215 20% 40%)" };
};

const getInitials = (prenom: string, nom: string) =>
  `${prenom?.[0] || ""}${nom?.[0] || ""}`.toUpperCase();

/** Retourne tous les IDs descendants d'une UO (récursif) */
function getDescendantIds(uoId: string, allUOs: UO[]): string[] {
  const result: string[] = [uoId];
  const children = allUOs.filter(u => u.parent_id === uoId);
  children.forEach(child => result.push(...getDescendantIds(child.id, allUOs)));
  return result;
}

// ── Composant carte collaborateur ─────────────────────────────────────────────

const CollabCard = ({
  c, info, onClick,
}: { c: Collaborateur; info: ListeInfo; onClick: () => void }) => {
  const statut = getStatutStyle(c.statut_collaborateur);
  return (
    <div onClick={onClick}
      className="rounded-xl border p-3.5 cursor-pointer transition-all hover:shadow-md group"
      style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
      <div className="flex items-start gap-3 mb-2.5">
        {c.photo_path ? (
          <img src={c.photo_path} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0 border"
            style={{ borderColor: "hsl(var(--border))" }} />
        ) : (
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
            style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}>
            {getInitials(c.prenom, c.nom)}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate" style={{ color: "hsl(var(--foreground))" }}>
            {c.prenom} {c.nom}
          </p>
          <p className="text-xs font-bold font-mono" style={{ color: "hsl(var(--accent))" }}>#{c.matricule}</p>
        </div>
        <ChevronRight size={13} className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-1"
          style={{ color: "hsl(var(--accent))" }} />
      </div>
      <div className="space-y-1">
        {info.poste_libelle && (
          <div className="flex items-center gap-1.5 text-xs truncate" style={{ color: "hsl(var(--muted-foreground))" }}>
            <Briefcase size={10} /><span className="truncate">{info.poste_libelle}</span>
          </div>
        )}
        {c.email_professionnel && (
          <div className="flex items-center gap-1.5 text-xs truncate" style={{ color: "hsl(var(--muted-foreground))" }}>
            <Mail size={10} /><span className="truncate">{c.email_professionnel}</span>
          </div>
        )}
      </div>
      <div className="mt-2.5 flex items-center justify-between">
        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
          style={{ background: statut.bg, color: statut.color }}>
          {c.statut_collaborateur}
        </span>
        {info.type_contrat_libelle && (
          <span className="text-[10px] truncate max-w-[90px]" style={{ color: "hsl(var(--muted-foreground))" }}>
            {info.type_contrat_libelle}
          </span>
        )}
      </div>
    </div>
  );
};

// ── Composant groupe UO ───────────────────────────────────────────────────────

const UOGroup = ({
  uo, collabs, listeInfoMap, depth = 0, subUOs, allUOs, onCollabClick,
}: {
  uo: UO | null;
  collabs: Collaborateur[];
  listeInfoMap: Record<string, ListeInfo>;
  depth?: number;
  subUOs: UO[];
  allUOs: UO[];
  onCollabClick: (id: string) => void;
}) => {
  const [open, setOpen] = useState(depth === 0);
  const directCollabs = collabs.filter(c => (listeInfoMap[c.id]?.uo_id ?? null) === (uo?.id ?? null));
  const totalCount = collabs.length;
  if (totalCount === 0) return null;

  const indent = depth * 16;

  return (
    <div className="rounded-2xl border overflow-hidden mb-3"
      style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))", marginLeft: indent }}>
      {/* En-tête UO */}
      <button
        className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-muted/20 transition-colors text-left"
        onClick={() => setOpen(v => !v)}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{
            background: depth === 0 ? "hsl(var(--primary) / 0.12)" : "hsl(var(--muted))",
            color: depth === 0 ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
          }}>
          <Building2 size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold truncate" style={{ color: "hsl(var(--foreground))" }}>
              {uo ? uo.libelle : "Non affectés"}
            </p>
            {uo?.code && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                {uo.code}
              </span>
            )}
            {depth > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ background: "hsl(var(--muted) / 0.5)", color: "hsl(var(--muted-foreground))" }}>
                Niveau {uo?.niveau ?? depth}
              </span>
            )}
          </div>
          <p className="text-[11px] mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
            {directCollabs.length > 0 && `${directCollabs.length} direct${directCollabs.length > 1 ? "s" : ""}`}
            {directCollabs.length > 0 && subUOs.length > 0 && " · "}
            {totalCount > directCollabs.length && `${totalCount} au total`}
          </p>
        </div>
        <ChevronDown size={15} className={`transition-transform flex-shrink-0 ${open ? "rotate-180" : ""}`}
          style={{ color: "hsl(var(--muted-foreground))" }} />
      </button>

      {open && (
        <div className="border-t" style={{ borderColor: "hsl(var(--border))" }}>
          {/* Collabs directs de cette UO */}
          {directCollabs.length > 0 && (
            <div className="p-4 grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {directCollabs.map(c => (
                <CollabCard key={c.id} c={c} info={listeInfoMap[c.id] || {}} onClick={() => onCollabClick(c.id)} />
              ))}
            </div>
          )}
          {/* Sous-UOs récursives */}
          {subUOs.map(subUO => {
            const subSubUOs = allUOs.filter(u => u.parent_id === subUO.id);
            const subCollabs = collabs.filter(c => {
              const uoId = listeInfoMap[c.id]?.uo_id;
              return uoId && getDescendantIds(subUO.id, allUOs).includes(uoId);
            });
            return (
              <div key={subUO.id} className="px-4 pb-4">
                <UOGroup
                  uo={subUO} collabs={subCollabs} listeInfoMap={listeInfoMap}
                  depth={depth + 1} subUOs={subSubUOs} allUOs={allUOs}
                  onCollabClick={onCollabClick} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── Sélecteur d'UO multi ──────────────────────────────────────────────────────

const UOSelector = ({
  allUOs, selectedIds, onChange, rootIds,
}: {
  allUOs: UO[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  rootIds: string[];
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const relevant = useMemo(() => {
    const allDescendants = new Set<string>();
    rootIds.forEach(id => getDescendantIds(id, allUOs).forEach(d => allDescendants.add(d)));
    return allUOs.filter(u => allDescendants.has(u.id));
  }, [allUOs, rootIds]);

  const filtered = search
    ? relevant.filter(u => u.libelle.toLowerCase().includes(search.toLowerCase()) || u.code?.toLowerCase().includes(search.toLowerCase()))
    : relevant;

  const toggle = (id: string) => {
    const withDesc = getDescendantIds(id, allUOs);
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter(x => !withDesc.includes(x)));
    } else {
      onChange([...new Set([...selectedIds, ...withDesc])]);
    }
  };

  const clearAll = () => onChange([]);
  const selectAll = () => onChange(relevant.map(u => u.id));

  return (
    <div className="relative">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all"
        style={{
          borderColor: selectedIds.length > 0 ? "hsl(var(--primary))" : "hsl(var(--border))",
          background: selectedIds.length > 0 ? "hsl(var(--primary) / 0.08)" : "hsl(var(--card))",
          color: selectedIds.length > 0 ? "hsl(var(--primary))" : "hsl(var(--foreground))",
        }}>
        <Building2 size={13} />
        {selectedIds.length === 0 ? "Toutes les UOs" : `${selectedIds.length} UO${selectedIds.length > 1 ? "s" : ""}`}
        <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 w-72 rounded-2xl shadow-2xl border overflow-hidden"
          style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
          <div className="p-3 border-b" style={{ borderColor: "hsl(var(--border))" }}>
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Rechercher une UO…" className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border outline-none"
                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }} />
            </div>
            <div className="flex gap-2 mt-2">
              <button onClick={selectAll} className="text-[10px] px-2 py-0.5 rounded hover:opacity-70"
                style={{ color: "hsl(var(--primary))" }}>Tout sélectionner</button>
              <button onClick={clearAll} className="text-[10px] px-2 py-0.5 rounded hover:opacity-70"
                style={{ color: "hsl(var(--muted-foreground))" }}>Effacer</button>
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto p-2 space-y-0.5">
            {filtered.map(uo => {
              const depth = uo.niveau ?? 0;
              const checked = selectedIds.includes(uo.id);
              return (
                <button key={uo.id} onClick={() => toggle(uo.id)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/40 text-left transition-colors"
                  style={{ paddingLeft: 8 + depth * 12 }}>
                  <div className="w-4 h-4 rounded border flex items-center justify-center flex-shrink-0"
                    style={{
                      borderColor: checked ? "hsl(var(--primary))" : "hsl(var(--border))",
                      background: checked ? "hsl(var(--primary))" : "transparent",
                    }}>
                    {checked && <Check size={10} color="white" />}
                  </div>
                  <span className="text-xs truncate flex-1" style={{ color: "hsl(var(--foreground))" }}>{uo.libelle}</span>
                  {uo.code && <span className="text-[10px] font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>{uo.code}</span>}
                </button>
              );
            })}
          </div>
          <div className="p-2 border-t" style={{ borderColor: "hsl(var(--border))" }}>
            <button onClick={() => setOpen(false)}
              className="w-full py-1.5 rounded-lg text-xs font-semibold text-center"
              style={{ background: "hsl(var(--primary))", color: "white" }}>
              Appliquer
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Composant principal ───────────────────────────────────────────────────────

const EquipeManagerView: React.FC = () => {
  const navigate = useNavigate();
  const { collaborateurIds: managerCollabIds, uoIds: managerUoIds, loading: popLoading } = useManagerPopulation();

  const [collaborateurs, setCollaborateurs] = useState<Collaborateur[]>([]);
  const [listeInfoMap, setListeInfoMap] = useState<Record<string, ListeInfo>>({});
  const [allUOs, setAllUOs] = useState<UO[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatut, setFilterStatut] = useState<"tous" | "ACTIF" | "EN_DEPART">("ACTIF");
  const [selectedUOIds, setSelectedUOIds] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<"uo" | "carte" | "liste">("uo");

  const rootUoIds = useMemo(() => {
    // Les UOs racines du manager = celles qui n'ont pas de parent dans managerUoIds
    return managerUoIds.filter(id => {
      const uo = allUOs.find(u => u.id === id);
      return !uo?.parent_id || !managerUoIds.includes(uo.parent_id);
    });
  }, [managerUoIds, allUOs]);

  useEffect(() => {
    if (popLoading) return;
    loadData();
  }, [popLoading, managerCollabIds.join(",")]);

  const loadData = async () => {
    if (!managerCollabIds.length) { setLoading(false); return; }
    setLoading(true);
    try {
      const [collabs, affectations, contrats, refUOs, refTypeContrats, refPostes] = await Promise.all([
        db.list<Collaborateur>("collaborateurs", {
          select: "id,matricule,nom,prenom,code_genre,statut_collaborateur,email_professionnel,photo_path,date_naissance",
          archive: false,
          "id": `in.(${managerCollabIds.join(",")})`,
          order: "nom",
        }),
        db.list<any>("collaborateur_affectations", {
          select: "collaborateur_id,unite_id,code_poste,intitule_poste,date_fin_uo",
          archive: false,
          "collaborateur_id": `in.(${managerCollabIds.join(",")})`,
        }),
        db.list<any>("collaborateur_contrats", {
          archive: false,
          "collaborateur_id": `in.(${managerCollabIds.join(",")})`,
        }),
        db.list<UO>("unites_organisationnelles", { select: "id,code,libelle,parent_id,niveau", order: "niveau" }),
        db.list<any>("ref_type_contrat"),
        db.list<any>("ref_poste"),
      ]);

      setAllUOs(refUOs);
      setCollaborateurs(collabs);

      // Build info maps
      const posteMap: Record<string, string> = {};
      refPostes.forEach((r: any) => { posteMap[r.code] = r.libelle; });
      const tcMap: Record<string, string> = {};
      refTypeContrats.forEach((r: any) => { tcMap[r.code] = r.libelle; });
      const uoMap: Record<string, string> = {};
      refUOs.forEach((u: UO) => { uoMap[u.id] = u.libelle; });

      const infoMap: Record<string, ListeInfo> = {};
      const today = new Date().toISOString().split("T")[0];

      affectations.forEach((a: any) => {
        const cid = a.collaborateur_id;
        if (!infoMap[cid]) infoMap[cid] = {};
        if (!a.date_fin_uo || a.date_fin_uo >= today) {
          infoMap[cid].uo_id = a.unite_id;
          infoMap[cid].uo_libelle = a.unite_id ? uoMap[a.unite_id] : undefined;
          // Priorité : intitule_poste (saisi librement) > libelle du référentiel > code brut
          infoMap[cid].poste_libelle = a.intitule_poste || (a.code_poste ? (posteMap[a.code_poste] || undefined) : undefined);
        }
      });

      contrats.forEach((ct: any) => {
        const cid = ct.collaborateur_id;
        if (!infoMap[cid]) infoMap[cid] = {};
        if (ct.code_statut_contrat === "ACTIF") {
          infoMap[cid].type_contrat_libelle = ct.code_type_contrat ? (tcMap[ct.code_type_contrat] || ct.code_type_contrat) : undefined;
          if (!infoMap[cid].date_embauche) infoMap[cid].date_embauche = ct.date_debut;
        }
      });

      setListeInfoMap(infoMap);
    } finally {
      setLoading(false);
    }
  };

  // Filtrage global
  const filtered = useMemo(() => {
    let result = collaborateurs;

    // Statut
    if (filterStatut !== "tous") result = result.filter(c => c.statut_collaborateur === filterStatut);

    // Texte
    if (search) {
      const t = search.toLowerCase();
      result = result.filter(c =>
        `${c.nom} ${c.prenom} ${c.matricule} ${c.email_professionnel || ""} ${listeInfoMap[c.id]?.poste_libelle || ""} ${listeInfoMap[c.id]?.uo_libelle || ""}`.toLowerCase().includes(t)
      );
    }

    // Filtre UO sélectionnées
    if (selectedUOIds.length > 0) {
      result = result.filter(c => {
        const uoId = listeInfoMap[c.id]?.uo_id;
        return uoId && selectedUOIds.includes(uoId);
      });
    }

    return result;
  }, [collaborateurs, filterStatut, search, selectedUOIds, listeInfoMap]);

  // Groupes UO pour la vue hiérarchique
  const uoGroups = useMemo(() => {
    if (!rootUoIds.length) return [];
    return rootUoIds.map(rootId => {
      const uo = allUOs.find(u => u.id === rootId) ?? null;
      const allDesc = getDescendantIds(rootId, allUOs);
      const groupCollabs = filtered.filter(c => {
        const uoId = listeInfoMap[c.id]?.uo_id;
        return uoId && allDesc.includes(uoId);
      });
      const subUOs = allUOs.filter(u => u.parent_id === rootId && managerUoIds.includes(u.id));
      return { uo, collabs: groupCollabs, subUOs };
    }).filter(g => g.collabs.length > 0);
  }, [rootUoIds, allUOs, filtered, listeInfoMap, managerUoIds]);

  const handleCollabClick = (id: string) => {
    navigate(`/espace-manager/collaborateur/${id}`);
  };

  if (popLoading || loading) {
    return (
      <div className="flex items-center justify-center h-48 gap-2">
        <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: "hsl(var(--primary))", borderTopColor: "transparent" }} />
        <span className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Chargement de votre équipe…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "hsl(var(--foreground))" }}>Mon équipe</h1>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {/* KPI collaborateurs */}
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold"
              style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))", border: "1px solid hsl(var(--primary) / 0.25)" }}>
              <Users size={11} />
              {collaborateurs.length} collaborateur{collaborateurs.length > 1 ? "s" : ""}
              {filtered.length !== collaborateurs.length && (
                <span className="font-normal opacity-70">({filtered.length} affichés)</span>
              )}
            </span>
            {/* KPI UOs */}
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold"
              style={{ background: "hsl(142 55% 45% / 0.1)", color: "hsl(142 55% 30%)", border: "1px solid hsl(142 55% 45% / 0.25)" }}>
              <Building2 size={11} />
              {managerUoIds.length} UO{managerUoIds.length > 1 ? "s" : ""}
            </span>
            {/* KPI absents */}
            {(() => {
              const actifs = collaborateurs.filter(c => c.statut_collaborateur === "ACTIF").length;
              const enDepart = collaborateurs.filter(c => c.statut_collaborateur === "EN_DEPART").length;
              return (
                <>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold"
                    style={{ background: "hsl(84 55% 45% / 0.1)", color: "hsl(84 55% 30%)", border: "1px solid hsl(84 55% 45% / 0.25)" }}>
                    {actifs} actif{actifs > 1 ? "s" : ""}
                  </span>
                  {enDepart > 0 && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold"
                      style={{ background: "hsl(38 92% 50% / 0.1)", color: "hsl(38 92% 35%)", border: "1px solid hsl(38 92% 50% / 0.25)" }}>
                      {enDepart} en départ
                    </span>
                  )}
                </>
              );
            })()}
          </div>
        </div>
        {/* Toggle vue */}
        <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: "hsl(var(--border))" }}>
          {([
            ["uo",    <Building2 size={13} />, "Par UO"],
            ["carte", <LayoutGrid size={13} />, "Cartes"],
            ["liste", <List size={13} />,      "Liste"],
          ] as const).map(([v, icon, label]) => (
            <button key={v} onClick={() => setViewMode(v as any)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-all"
              style={{
                background: viewMode === v ? "hsl(var(--primary))" : "hsl(var(--card))",
                color: viewMode === v ? "white" : "hsl(var(--muted-foreground))",
              }}>
              {icon}{label}
            </button>
          ))}
        </div>
      </div>

      {/* Barre de filtres */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Recherche */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Nom, matricule, poste, UO…"
            className="w-full pl-9 pr-4 py-2 rounded-xl text-sm border outline-none"
            style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--foreground))" }} />
        </div>

        {/* Filtre statut */}
        <div className="flex gap-1.5">
          {([["ACTIF","Actifs"], ["EN_DEPART","En départ"], ["tous","Tous"]] as const).map(([v, l]) => (
            <button key={v} onClick={() => setFilterStatut(v)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all"
              style={{
                background: filterStatut === v ? "hsl(var(--primary))" : "transparent",
                borderColor: filterStatut === v ? "hsl(var(--primary))" : "hsl(var(--border))",
                color: filterStatut === v ? "white" : "hsl(var(--foreground))",
              }}>{l}</button>
          ))}
        </div>

        {/* Filtre UO */}
        <UOSelector allUOs={allUOs} selectedIds={selectedUOIds} onChange={setSelectedUOIds} rootIds={rootUoIds} />

        {/* Reset filtres */}
        {(selectedUOIds.length > 0 || search || filterStatut !== "ACTIF") && (
          <button onClick={() => { setSearch(""); setSelectedUOIds([]); setFilterStatut("ACTIF"); }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs hover:opacity-70"
            style={{ color: "hsl(var(--muted-foreground))", border: "1px solid hsl(var(--border))" }}>
            <X size={11} /> Réinitialiser
          </button>
        )}
      </div>

      {/* Contenu */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 rounded-2xl"
          style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
          <Users size={28} className="mb-2" style={{ color: "hsl(var(--muted-foreground))" }} />
          <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun collaborateur trouvé</p>
        </div>
      ) : viewMode === "uo" ? (
        /* ── Vue hiérarchique par UO ── */
        <div>
          {uoGroups.map(({ uo, collabs, subUOs }) => (
            <UOGroup key={uo?.id ?? "__root__"}
              uo={uo} collabs={collabs} listeInfoMap={listeInfoMap}
              depth={0} subUOs={subUOs} allUOs={allUOs}
              onCollabClick={handleCollabClick} />
          ))}
          {/* Collabs sans UO dans le périmètre */}
          {(() => {
            const sansUO = filtered.filter(c => !listeInfoMap[c.id]?.uo_id || !managerUoIds.includes(listeInfoMap[c.id]?.uo_id!));
            if (!sansUO.length) return null;
            return <UOGroup uo={null} collabs={sansUO} listeInfoMap={listeInfoMap} depth={0} subUOs={[]} allUOs={allUOs} onCollabClick={handleCollabClick} />;
          })()}
        </div>
      ) : viewMode === "carte" ? (
        /* ── Vue cartes plate ── */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(c => (
            <CollabCard key={c.id} c={c} info={listeInfoMap[c.id] || {}} onClick={() => handleCollabClick(c.id)} />
          ))}
        </div>
      ) : (
        /* ── Vue liste (tableau) ── */
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "hsl(var(--muted))", borderBottom: "1px solid hsl(var(--border))" }}>
                {["Collaborateur", "Matricule", "UO", "Poste", "Type contrat", "Statut"].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider"
                    style={{ color: "hsl(var(--muted-foreground))" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, idx) => {
                const info = listeInfoMap[c.id] || {};
                const statut = getStatutStyle(c.statut_collaborateur);
                return (
                  <tr key={c.id} onClick={() => handleCollabClick(c.id)}
                    className="cursor-pointer group hover:bg-accent/5 transition-colors"
                    style={{ borderBottom: "1px solid hsl(var(--border))", background: idx % 2 === 0 ? "hsl(var(--card))" : "hsl(var(--muted) / 0.2)" }}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        {c.photo_path ? (
                          <img src={c.photo_path} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                            style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}>
                            {getInitials(c.prenom, c.nom)}
                          </div>
                        )}
                        <span className="text-xs font-semibold" style={{ color: "hsl(var(--foreground))" }}>{c.prenom} {c.nom}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs font-mono font-bold" style={{ color: "hsl(var(--accent))" }}>#{c.matricule}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{info.uo_libelle ?? "—"}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{info.poste_libelle ?? "—"}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{info.type_contrat_libelle ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                        style={{ background: statut.bg, color: statut.color }}>
                        {c.statut_collaborateur}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default EquipeManagerView;
