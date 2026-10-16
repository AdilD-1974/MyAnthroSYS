// src/pages/espaces/TachesPage.tsx
import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  Plus, List, LayoutGrid, Search, X, Filter,
  CheckCircle2, Clock, Circle, RotateCcw,
  Calendar, User, Settings2, XCircle,
} from "lucide-react";
import { useTaches } from "@/hooks/useTaches";
import TacheDrawer from "./TacheDrawer";
import TacheEtapesConfig from "./TacheEtapesConfig";
import { Tache, TacheStatut, TachePriorite, TacheType } from "@/lib/tachesApi";
import { tacheEtapesApi, TacheEtape } from "@/lib/tacheEtapesApi";

// ─── Constantes ───────────────────────────────────────────────

const COLONNES: { statut: TacheStatut; label: string }[] = [
  { statut: "a_faire",  label: "À faire"  },
  { statut: "en_cours", label: "En cours" },
  { statut: "terminee", label: "Terminée" },
  { statut: "annulee",  label: "Annulée"  },
];

const PRIORITE_CFG: Record<TachePriorite, { label: string; color: string; bg: string }> = {
  urgente: { label: "Urgente", color: "hsl(0 70% 42%)",    bg: "hsl(0 70% 50% / 0.1)"   },
  haute:   { label: "Haute",   color: "hsl(38 92% 38%)",   bg: "hsl(38 92% 50% / 0.1)"  },
  normale: { label: "Normale", color: "hsl(var(--muted-foreground))", bg: "hsl(var(--muted) / 0.5)" },
  basse:   { label: "Basse",   color: "hsl(var(--muted-foreground))", bg: "hsl(var(--muted) / 0.3)" },
};

const TYPE_LABELS: Record<TacheType, string> = {
  personnelle: "Perso",
  assignee:    "Assignée",
  workflow:    "Workflow",
  rh_metier:  "RH Métier",
};

const STATUT_CFG: Record<TacheStatut, { color: string; icon: React.FC<any> }> = {
  a_faire:  { color: "hsl(var(--muted-foreground))", icon: Circle       },
  en_cours: { color: "hsl(var(--info))",             icon: Clock        },
  terminee: { color: "hsl(var(--success))",           icon: CheckCircle2 },
  annulee:  { color: "hsl(var(--muted-foreground))", icon: X            },
};

// ─── Carte Kanban draggable ───────────────────────────────────

function TacheCard({
  tache, onClick, onDragStart,
}: {
  tache: Tache;
  onClick: () => void;
  onDragStart: (e: React.DragEvent, tache: Tache) => void;
}) {
  const prio = PRIORITE_CFG[tache.priorite];
  return (
    <button
      onClick={onClick}
      draggable
      onDragStart={(e) => onDragStart(e, tache)}
      className="w-full text-left rounded-xl border transition-all duration-150 hover:shadow-md cursor-grab active:cursor-grabbing"
      style={{
        background: "hsl(var(--card))",
        borderColor: tache.en_retard ? "hsl(0 70% 50% / 0.4)" : "hsl(var(--border))",
        padding: "12px 14px",
        marginBottom: 8,
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md"
          style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
          {TYPE_LABELS[tache.type_tache]}
        </span>
        <span className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-md"
          style={{ background: prio.bg, color: prio.color }}>
          {prio.label}
        </span>
      </div>

      <p className="text-sm font-medium mb-2 line-clamp-2" style={{ color: "hsl(var(--foreground))" }}>
        {tache.titre}
      </p>

      <div className="flex items-center gap-3 flex-wrap">
        {tache.date_echeance && (
          <span className="flex items-center gap-1 text-[11px]"
            style={{ color: tache.en_retard ? "hsl(0 70% 42%)" : "hsl(var(--muted-foreground))", fontWeight: tache.en_retard ? 600 : 400 }}>
            <Calendar size={11} />
            {new Date(tache.date_echeance).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}
            {tache.en_retard && " ⚠"}
          </span>
        )}
        {(tache.assignations?.length ?? 0) > 0 && (
          <span className="flex items-center gap-1 text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>
            <User size={11} /> {tache.assignations?.length ?? 0}
          </span>
        )}
        {(tache.etiquettes ?? []).slice(0, 2).map(e => (
          <span key={e} className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ background: "hsl(var(--accent) / 0.1)", color: "hsl(var(--accent))" }}>
            {e}
          </span>
        ))}
      </div>
    </button>
  );
}

// ─── Vue Kanban avec Drag & Drop ─────────────────────────────

function VueKanban({
  taches, etapes, onOpen, onStatutChange,
}: {
  taches: Tache[];
  etapes: TacheEtape[];
  onOpen: (t: Tache) => void;
  onStatutChange: (id: string, s: TacheStatut) => void;
}) {
  // Utiliser les étapes BDD si disponibles, sinon les colonnes par défaut
  const colonnes = etapes.length > 0
    ? etapes.map(e => ({ statut: e.code as TacheStatut, label: e.libelle, couleur: e.couleur }))
    : COLONNES.map(c => ({ ...c, couleur: "#6B7280" }));
  const [draggingId, setDraggingId]     = useState<string | null>(null);
  const [dragOverCol, setDragOverCol]   = useState<TacheStatut | null>(null);
  const dragTache = useRef<Tache | null>(null);

  const handleDragStart = (e: React.DragEvent, tache: Tache) => {
    dragTache.current = tache;
    setDraggingId(tache.id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, statut: TacheStatut) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverCol(statut);
  };

  const handleDrop = (e: React.DragEvent, statut: TacheStatut) => {
    e.preventDefault();
    if (dragTache.current && dragTache.current.statut !== statut) {
      onStatutChange(dragTache.current.id, statut);
    }
    setDraggingId(null);
    setDragOverCol(null);
    dragTache.current = null;
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDragOverCol(null);
    dragTache.current = null;
  };

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.max(colonnes.length, 1)}, minmax(200px, 1fr))`, overflowX: "auto" }}>
      {colonnes.map(col => {
        const items = taches.filter(t => t.statut === col.statut);
        const StatutIcon = STATUT_CFG[col.statut].icon;
        const isOver = dragOverCol === col.statut;
        return (
          <div
            key={col.statut}
            onDragOver={(e) => handleDragOver(e, col.statut)}
            onDrop={(e) => handleDrop(e, col.statut)}
            onDragLeave={() => setDragOverCol(null)}
          >
            {/* Header colonne */}
            <div className="flex items-center gap-2 mb-3 px-1">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: col.couleur }} />
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>
                {col.label}
              </span>
              <span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded-full"
                style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                {items.length}
              </span>
            </div>

            {/* Zone de dépôt */}
            <div
              className="rounded-xl p-2 min-h-32 transition-all duration-150"
              style={{
                background: isOver ? "hsl(var(--accent) / 0.08)" : "hsl(var(--muted) / 0.3)",
                border: `2px ${isOver ? "solid" : "dashed"} ${isOver ? "hsl(var(--accent))" : "hsl(var(--border))"}`,
              }}
            >
              {items.length === 0 && (
                <p className="text-center text-xs py-6" style={{ color: isOver ? "hsl(var(--accent))" : "hsl(var(--muted-foreground))" }}>
                  {isOver ? "Déposer ici" : "Aucune tâche"}
                </p>
              )}
              {items.map(t => (
                <div
                  key={t.id}
                  style={{ opacity: draggingId === t.id ? 0.4 : 1, transition: "opacity 0.15s" }}
                  onDragEnd={handleDragEnd}
                >
                  <TacheCard tache={t} onClick={() => onOpen(t)} onDragStart={handleDragStart} />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Vue Liste ────────────────────────────────────────────────

function VueListe({ taches, onOpen }: { taches: Tache[]; onOpen: (t: Tache) => void }) {
  if (taches.length === 0) {
    return (
      <div className="rounded-xl border py-16 text-center" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
        <CheckCircle2 size={36} className="mx-auto mb-3" style={{ color: "hsl(var(--muted-foreground))" }} />
        <p className="text-sm font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune tâche</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
      {taches.map((t, i) => {
        const prio = PRIORITE_CFG[t.priorite];
        const StatutIcon = STATUT_CFG[t.statut].icon;
        return (
          <button key={t.id} onClick={() => onOpen(t)}
            className="w-full text-left flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
            style={{ borderBottom: i < taches.length - 1 ? "1px solid hsl(var(--border))" : "none" }}>
            <StatutIcon size={16} style={{ color: STATUT_CFG[t.statut].color, flexShrink: 0 }} />
            <span className="flex-1 text-sm font-medium truncate" style={{
              color: t.statut === "terminee" ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))",
              textDecoration: t.statut === "terminee" ? "line-through" : "none",
            }}>
              {t.titre}
            </span>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md flex-shrink-0"
              style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
              {TYPE_LABELS[t.type_tache]}
            </span>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md flex-shrink-0"
              style={{ background: prio.bg, color: prio.color }}>
              {prio.label}
            </span>
            {t.date_echeance && (
              <span className="text-xs flex-shrink-0 flex items-center gap-1"
                style={{ color: t.en_retard ? "hsl(0 70% 42%)" : "hsl(var(--muted-foreground))", fontWeight: t.en_retard ? 600 : 400 }}>
                <Calendar size={11} />
                {new Date(t.date_echeance).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Page principale ──────────────────────────────────────────

export default function TachesPage() {
  const [etapes, setEtapes]         = useState<TacheEtape[]>([]);
  const [showConfig, setShowConfig] = useState(false);
  const [vue, setVue]               = useState<"kanban" | "liste">("kanban");
  const [drawerTache, setDrawerTache] = useState<Tache | null>(null);
  const [drawerOpen, setDrawerOpen]   = useState(false);
  const [showFiltres, setShowFiltres] = useState(false);
  const [search, setSearch]           = useState("");
  const [filterStatut, setFilterStatut]     = useState("");
  const [filterPriorite, setFilterPriorite] = useState("");
  const [filterType, setFilterType]         = useState("");
  const [incTerminees, setIncTerminees]     = useState(false);

  useEffect(() => {
    tacheEtapesApi.list().then(rows => setEtapes(rows)).catch(() => {});
  }, []);

  const { taches, loading, error, reload, create, update, changeStatut, remove } = useTaches({
    search:            search || undefined,
    statut:            filterStatut   as TacheStatut   || undefined,
    priorite:          filterPriorite as TachePriorite || undefined,
    type_tache:        filterType     as TacheType     || undefined,
    include_terminees: incTerminees,
  });

  const openTache  = (t: Tache) => { setDrawerTache(t); setDrawerOpen(true); };
  const openNouveau = () => { setDrawerTache(null); setDrawerOpen(true); };
  const closeDrawer = () => { setDrawerOpen(false); setTimeout(() => setDrawerTache(null), 300); };

  const nbFiltres = [filterStatut, filterPriorite, filterType].filter(Boolean).length + (incTerminees ? 1 : 0);

  const stats = useMemo(() => ({
    actives:  taches.filter(t => ["a_faire","en_cours"].includes(t.statut)).length,
    enRetard: taches.filter(t => t.en_retard).length,
  }), [taches]);

  // Drag & drop → changement de statut
  const handleStatutChange = async (id: string, statut: TacheStatut) => {
    await changeStatut(id, statut);
  };

  return (
    <div className="max-w-screen-xl mx-auto">
      {/* Fil d'Ariane */}
      <div className="flex items-center gap-1.5 px-6 pt-4 pb-2 text-[13px]" style={{ color: "hsl(var(--muted-foreground))" }}>
        <span className="font-semibold" style={{ color: "hsl(var(--foreground))" }}>Mes tâches</span>
        {stats.enRetard > 0 && (
          <span className="ml-1 text-[11px] px-2 py-0.5 rounded-full font-semibold" style={{ background: "hsl(var(--destructive) / 0.12)", color: "hsl(var(--destructive))" }}>
            {stats.enRetard} en retard
          </span>
        )}
      </div>

      {/* Barre d'outils */}
      <div className="flex items-center gap-2 px-6 py-2.5 flex-wrap" style={{ borderBottom: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}>
        <button onClick={openNouveau}
          className="flex items-center gap-1.5 text-[13px] font-medium h-8 px-3"
          style={{ background: "hsl(var(--primary))", color: "white", borderRadius: "var(--radius)" }}>
          <Plus size={14} /> Nouvelle tâche
        </button>
        <button onClick={() => setShowConfig(true)}
          className="flex items-center gap-1.5 h-8 px-2.5 text-[13px] font-medium transition-colors"
          style={{ color: "hsl(var(--muted-foreground))" }}>
          <Settings2 size={14} /> Étapes
        </button>

        <div className="w-px h-5 mx-1" style={{ background: "hsl(var(--border))" }} />

        <div className="flex items-center flex-1 min-w-[220px] h-8 px-2.5" style={{ border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)", background: "hsl(var(--background))", maxWidth: 320 }}>
          <Search size={13} style={{ color: "hsl(var(--muted-foreground))" }} className="flex-shrink-0 mr-1.5" />
          <input placeholder="Rechercher une tâche…" value={search} onChange={e => setSearch(e.target.value)}
            className="flex-1 text-[13px] outline-none bg-transparent" style={{ color: "hsl(var(--foreground))" }} />
          {search && <button onClick={() => setSearch("")}><X size={13} style={{ color: "hsl(var(--muted-foreground))" }} /></button>}
        </div>
        <button onClick={() => setShowFiltres(v => !v)}
          className="flex items-center gap-2 h-8 px-3 text-[13px] font-medium transition-colors"
          style={{
            color: nbFiltres > 0 ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
          }}>
          <Filter size={14} /> Filtres
          {nbFiltres > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: "hsl(var(--primary))" }}>{nbFiltres}</span>}
        </button>

        <div className="flex-1" />

        {/* Bascule Kanban / Liste */}
        <div className="flex items-center" style={{ borderLeft: "1px solid hsl(var(--border))", paddingLeft: 6 }}>
          {(["kanban","liste"] as const).map(v => (
            <button key={v} onClick={() => setVue(v)}
              title={v === "kanban" ? "Vue kanban" : "Vue liste"}
              className="p-1.5 rounded transition-colors"
              style={{
                color: vue === v ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                background: vue === v ? "hsl(var(--primary) / 0.1)" : "transparent",
              }}>
              {v === "kanban" ? <LayoutGrid size={15} /> : <List size={15} />}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
      {/* ── Filtres ── */}
      {showFiltres && (
        <div className="mb-5 p-4 rounded-xl border flex gap-4 flex-wrap items-center"
          style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
          {[
            { label: "Statut",   val: filterStatut,   set: setFilterStatut,   opts: COLONNES.map(c => ({ v: c.statut, l: c.label })) },
            { label: "Priorité", val: filterPriorite, set: setFilterPriorite, opts: Object.entries(PRIORITE_CFG).map(([k,v]) => ({ v: k, l: v.label })) },
            { label: "Type",     val: filterType,     set: setFilterType,     opts: Object.entries(TYPE_LABELS).map(([k,v]) => ({ v: k, l: v })) },
          ].map(f => (
            <div key={f.label} className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "hsl(var(--accent))" }}>{f.label}</span>
              <select value={f.val} onChange={e => f.set(e.target.value)}
                className="text-xs rounded-lg border px-2 py-1.5 outline-none"
                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--foreground))" }}>
                <option value="">Tous</option>
                {f.opts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </div>
          ))}
          <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: "hsl(var(--muted-foreground))" }}>
            <input type="checkbox" checked={incTerminees} onChange={e => setIncTerminees(e.target.checked)} />
            Inclure terminées
          </label>
          <button onClick={() => { setFilterStatut(""); setFilterPriorite(""); setFilterType(""); setIncTerminees(false); }}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border"
            style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
            <RotateCcw size={12} /> Réinitialiser
          </button>
        </div>
      )}

      {/* ── Indice drag & drop ── */}
      {vue === "kanban" && taches.length > 0 && (
        <p className="text-[11px] mb-3 flex items-center gap-1.5" style={{ color: "hsl(var(--muted-foreground))" }}>
          <span>💡</span> Glissez une carte vers une autre colonne pour changer son statut
        </p>
      )}

      {/* ── Contenu ── */}
      {loading && (
        <div className="flex flex-col gap-4 animate-pulse">
          <div className="h-8 w-48 rounded-lg bg-muted" />
          <div className="h-64 rounded-xl bg-muted" />
        </div>
      )}
      {error && (
        <div className="rounded-xl p-4 text-sm border"
          style={{ background: "hsl(0 70% 50% / 0.08)", borderColor: "hsl(0 70% 50% / 0.3)", color: "hsl(0 70% 42%)" }}>
          {error}
        </div>
      )}
      {!loading && !error && (
        vue === "kanban"
          ? <VueKanban taches={taches} etapes={etapes} onOpen={openTache} onStatutChange={handleStatutChange} />
          : <VueListe  taches={taches} onOpen={openTache} />
      )}

      {/* ── Config étapes ── */}
      {showConfig && (
        <TacheEtapesConfig onClose={() => {
          setShowConfig(false);
          tacheEtapesApi.list().then(setEtapes).catch(() => {});
        }} />
      )}

      {/* ── Drawer ── */}
      <TacheDrawer
        tache={drawerTache}
        open={drawerOpen}
        onClose={closeDrawer}
        onSave={async (data) => {
          if (drawerTache) {
            const updated = await update(drawerTache.id, data);
            setDrawerTache(updated);
          } else {
            await create(data as any);
            closeDrawer();
          }
          reload();
        }}
        onStatutChange={async (statut) => {
          if (drawerTache) {
            const updated = await changeStatut(drawerTache.id, statut);
            setDrawerTache(updated);
          }
        }}
        onDelete={async () => {
          if (drawerTache) { await remove(drawerTache.id); closeDrawer(); }
        }}
      />
      </div>
    </div>
  );
}
