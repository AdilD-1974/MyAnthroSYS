// src/pages/espaces/TachesPage.tsx
import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus, List, LayoutGrid, Search, X, Filter, CheckCircle2,
  Clock, Circle, AlertCircle, ArrowUp, Minus, ChevronDown,
  Calendar, User, Tag, RotateCcw, Check,
} from "lucide-react";
import { useTaches } from "@/hooks/useTaches";
import TacheDrawer from "./TacheDrawer";
import { Tache, TacheStatut, TachePriorite, TacheType } from "@/lib/tachesApi";

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

// ─── Carte Kanban ─────────────────────────────────────────────

function TacheCard({ tache, onClick }: { tache: Tache; onClick: () => void }) {
  const prio = PRIORITE_CFG[tache.priorite];
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl border transition-all duration-150 hover:shadow-md"
      style={{
        background: "hsl(var(--card))",
        borderColor: tache.en_retard ? "hsl(0 70% 50% / 0.4)" : "hsl(var(--border))",
        padding: "12px 14px",
        marginBottom: 8,
      }}
    >
      {/* Type + priorité */}
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

      {/* Titre */}
      <p className="text-sm font-medium mb-2 line-clamp-2" style={{ color: "hsl(var(--foreground))" }}>
        {tache.titre}
      </p>

      {/* Footer */}
      <div className="flex items-center gap-3 flex-wrap">
        {tache.date_echeance && (
          <span className="flex items-center gap-1 text-[11px]"
            style={{ color: tache.en_retard ? "hsl(0 70% 42%)" : "hsl(var(--muted-foreground))", fontWeight: tache.en_retard ? 600 : 400 }}>
            <Calendar size={11} />
            {new Date(tache.date_echeance).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}
            {tache.en_retard && " ⚠"}
          </span>
        )}
        {tache.assignations.length > 0 && (
          <span className="flex items-center gap-1 text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>
            <User size={11} /> {tache.assignations.length}
          </span>
        )}
        {tache.etiquettes.slice(0, 2).map(e => (
          <span key={e} className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ background: "hsl(var(--accent) / 0.1)", color: "hsl(var(--accent))" }}>
            {e}
          </span>
        ))}
      </div>
    </button>
  );
}

// ─── Vue Kanban ───────────────────────────────────────────────

function VueKanban({ taches, onOpen }: { taches: Tache[]; onOpen: (t: Tache) => void }) {
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
      {COLONNES.map(col => {
        const items = taches.filter(t => t.statut === col.statut);
        const StatutIcon = STATUT_CFG[col.statut].icon;
        return (
          <div key={col.statut}>
            <div className="flex items-center gap-2 mb-3 px-1">
              <StatutIcon size={14} style={{ color: STATUT_CFG[col.statut].color }} />
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>
                {col.label}
              </span>
              <span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded-full"
                style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                {items.length}
              </span>
            </div>
            <div className="rounded-xl p-2 min-h-32"
              style={{ background: "hsl(var(--muted) / 0.3)", border: "1px dashed hsl(var(--border))" }}>
              {items.length === 0 && (
                <p className="text-center text-xs py-6" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Aucune tâche
                </p>
              )}
              {items.map(t => <TacheCard key={t.id} tache={t} onClick={() => onOpen(t)} />)}
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
  const [vue, setVue]               = useState<"kanban" | "liste">("kanban");
  const [drawerTache, setDrawerTache] = useState<Tache | null>(null);
  const [drawerOpen, setDrawerOpen]   = useState(false);
  const [showFiltres, setShowFiltres] = useState(false);
  const [search, setSearch]           = useState("");
  const [filterStatut, setFilterStatut]     = useState("");
  const [filterPriorite, setFilterPriorite] = useState("");
  const [filterType, setFilterType]         = useState("");
  const [incTerminees, setIncTerminees]     = useState(false);

  const { taches, loading, error, reload, create, update, changeStatut, remove } = useTaches({
    search:            search || undefined,
    statut:            filterStatut   as TacheStatut   || undefined,
    priorite:          filterPriorite as TachePriorite || undefined,
    type_tache:        filterType     as TacheType     || undefined,
    include_terminees: incTerminees,
  });

  const openTache = (t: Tache) => { setDrawerTache(t); setDrawerOpen(true); };
  const openNouveau = () => { setDrawerTache(null); setDrawerOpen(true); };
  const closeDrawer = () => { setDrawerOpen(false); setTimeout(() => setDrawerTache(null), 300); };

  const nbFiltres = [filterStatut, filterPriorite, filterType].filter(Boolean).length + (incTerminees ? 1 : 0);
  const resetFiltres = () => { setFilterStatut(""); setFilterPriorite(""); setFilterType(""); setIncTerminees(false); };

  const stats = useMemo(() => ({
    actives:   taches.filter(t => ["a_faire","en_cours"].includes(t.statut)).length,
    enRetard:  taches.filter(t => t.en_retard).length,
    terminees: taches.filter(t => t.statut === "terminee").length,
  }), [taches]);

  return (
    <div className="p-6 max-w-screen-xl mx-auto">

      {/* ── En-tête ── */}
      <div className="page-header flex-row items-start justify-between" style={{ display: "flex", marginBottom: 24 }}>
        <div>
          <h1 className="page-title">Mes tâches</h1>
          <p className="page-subtitle">
            {stats.actives} tâche{stats.actives > 1 ? "s" : ""} active{stats.actives > 1 ? "s" : ""}
            {stats.enRetard > 0 && (
              <span className="ml-2 font-semibold" style={{ color: "hsl(0 70% 42%)" }}>
                · {stats.enRetard} en retard
              </span>
            )}
            {stats.terminees > 0 && (
              <span className="ml-2" style={{ color: "hsl(var(--success))" }}>
                · {stats.terminees} terminée{stats.terminees > 1 ? "s" : ""}
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Bascule vue */}
          <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "hsl(var(--border))" }}>
            {(["kanban", "liste"] as const).map(v => (
              <button key={v} onClick={() => setVue(v)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors"
                style={{
                  background: vue === v ? "hsl(var(--accent))" : "hsl(var(--card))",
                  color: vue === v ? "white" : "hsl(var(--muted-foreground))",
                  borderRight: v === "kanban" ? "1px solid hsl(var(--border))" : "none",
                }}>
                {v === "kanban" ? <LayoutGrid size={14} /> : <List size={14} />}
                {v === "kanban" ? "Kanban" : "Liste"}
              </button>
            ))}
          </div>

          {/* Nouvelle tâche */}
          <button onClick={openNouveau}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={{ background: "hsl(var(--accent))", color: "white" }}>
            <Plus size={15} /> Nouvelle tâche
          </button>
        </div>
      </div>

      {/* ── Barre recherche + filtres ── */}
      <div className="flex gap-3 mb-5 items-center">
        <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border"
          style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
          <Search size={14} style={{ color: "hsl(var(--muted-foreground))" }} />
          <input
            placeholder="Rechercher une tâche…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: "hsl(var(--foreground))" }}
          />
          {search && (
            <button onClick={() => setSearch("")}>
              <X size={13} style={{ color: "hsl(var(--muted-foreground))" }} />
            </button>
          )}
        </div>

        <button onClick={() => setShowFiltres(v => !v)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors"
          style={{
            background: nbFiltres > 0 ? "hsl(var(--accent) / 0.1)" : "hsl(var(--card))",
            borderColor: nbFiltres > 0 ? "hsl(var(--accent) / 0.5)" : "hsl(var(--border))",
            color: nbFiltres > 0 ? "hsl(var(--accent))" : "hsl(var(--muted-foreground))",
          }}>
          <Filter size={14} />
          Filtres
          {nbFiltres > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white"
              style={{ background: "hsl(var(--accent))" }}>
              {nbFiltres}
            </span>
          )}
        </button>
      </div>

      {/* ── Panneau filtres ── */}
      {showFiltres && (
        <div className="mb-5 p-4 rounded-xl border flex gap-4 flex-wrap items-center"
          style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
          {/* Statut */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "hsl(var(--accent))" }}>Statut</span>
            <select value={filterStatut} onChange={e => setFilterStatut(e.target.value)}
              className="text-xs rounded-lg border px-2 py-1.5 outline-none"
              style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--foreground))" }}>
              <option value="">Tous</option>
              {COLONNES.map(c => <option key={c.statut} value={c.statut}>{c.label}</option>)}
            </select>
          </div>

          {/* Priorité */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "hsl(var(--accent))" }}>Priorité</span>
            <select value={filterPriorite} onChange={e => setFilterPriorite(e.target.value)}
              className="text-xs rounded-lg border px-2 py-1.5 outline-none"
              style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--foreground))" }}>
              <option value="">Toutes</option>
              {Object.entries(PRIORITE_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>

          {/* Type */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "hsl(var(--accent))" }}>Type</span>
            <select value={filterType} onChange={e => setFilterType(e.target.value)}
              className="text-xs rounded-lg border px-2 py-1.5 outline-none"
              style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--foreground))" }}>
              <option value="">Tous</option>
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>

          {/* Inclure terminées */}
          <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: "hsl(var(--muted-foreground))" }}>
            <input type="checkbox" checked={incTerminees} onChange={e => setIncTerminees(e.target.checked)} className="rounded" />
            Inclure terminées / annulées
          </label>

          <button onClick={resetFiltres}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
            style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
            <RotateCcw size={12} /> Réinitialiser
          </button>
        </div>
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
          ? <VueKanban taches={taches} onOpen={openTache} />
          : <VueListe  taches={taches} onOpen={openTache} />
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
  );
}
