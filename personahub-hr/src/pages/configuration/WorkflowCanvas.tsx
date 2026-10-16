/**
 * WorkflowCanvas.tsx — Schéma visuel interactif du circuit de workflow
 * Auteur : Adil DAIA
 *
 * Branché directement sur le modèle réel de WorkflowDesignerPage.tsx :
 *  - EditEtape.decisions[].cible_code  → flèche vers l'étape cible (ou "fin" si vide)
 *  - EditEtape.si_vrai_code / si_faux_code (type CONDITION) → 2 flèches branchées
 *  - AUTOMATIQUE = nœud terminal (pas de décisions sortantes)
 *  - Glisser une carte sur une autre réordonne le tableau `etapes` (met à jour `ordre`)
 *  - Clic sur une carte → délègue la sélection au parent (onSelect) qui ouvre déjà
 *    l'accordéon existant (`openStep`) ; aucune duplication d'état d'édition ici.
 */

import React, { useLayoutEffect, useRef, useState } from "react";
import { GripVertical, CircleSlash } from "lucide-react";

export interface CanvasDecision {
  libelle: string;
  type_decision: string;
  cible_code: string;
}

export interface CanvasEtape {
  code: string;
  libelle: string;
  type_etape: string;
  actif: boolean;
  condition_sql?: string;
  si_vrai_code?: string;
  si_faux_code?: string;
  decisions: CanvasDecision[];
}

interface Props {
  etapes: CanvasEtape[];
  openIndex: number | null;
  onSelect: (index: number) => void;
  onReorder: (newOrderedEtapes: CanvasEtape[]) => void;
  metaOf: (t: string) => { label: string; color: string; Icon: any };
  decMeta: (t: string) => { label: string; color: string };
}

const NODE_W = 208;

const WorkflowCanvas: React.FC<Props> = ({ etapes, openIndex, onSelect, onReorder, metaOf, decMeta }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [positions, setPositions] = useState<{ x: number; y: number; w: number; h: number }[]>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const cRect = containerRef.current.getBoundingClientRect();
    const next = etapes.map((_, i) => {
      const el = nodeRefs.current[i];
      if (!el) return { x: 0, y: 0, w: 0, h: 0 };
      const r = el.getBoundingClientRect();
      return { x: r.left - cRect.left, y: r.top - cRect.top, w: r.width, h: r.height };
    });
    setPositions(next);
  }, [etapes]);

  const handleDrop = (targetIdx: number) => {
    if (dragIdx === null || dragIdx === targetIdx) { setDragIdx(null); setOverIdx(null); return; }
    const next = [...etapes];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(targetIdx, 0, moved);
    onReorder(next);
    setDragIdx(null); setOverIdx(null);
  };

  const codeToIdx = (code: string) => etapes.findIndex(e => e.code === code);

  type Edge = { key: string; color: string; label?: string; fromIdx: number; toIdx: number | null; fromOffset: number; nFrom: number };
  const edges: Edge[] = [];

  etapes.forEach((etape, i) => {
    if (etape.type_etape === "CONDITION") {
      const branches: { code: string | undefined; color: string; label: string }[] = [
        { code: etape.si_vrai_code, color: "#16A34A", label: "si vrai" },
        { code: etape.si_faux_code, color: "#DC2626", label: "sinon" },
      ];
      branches.forEach((b, bi) => {
        edges.push({
          key: `cond-${i}-${bi}`, color: b.color, label: b.label, fromIdx: i,
          toIdx: b.code ? codeToIdx(b.code) : null, fromOffset: bi, nFrom: 2,
        });
      });
      return;
    }
    if (etape.type_etape === "AUTOMATIQUE") return; // nœud terminal, pas de transition sortante
    etape.decisions.forEach((dec, di) => {
      const dm = decMeta(dec.type_decision);
      edges.push({
        key: `dec-${i}-${di}`, color: dm.color, label: dec.libelle || dm.label, fromIdx: i,
        toIdx: dec.cible_code ? codeToIdx(dec.cible_code) : null, fromOffset: di, nFrom: etape.decisions.length,
      });
    });
  });

  // Profondeur de lane par chevauchement d'intervalle (évite que les arcs longs et courts
  // se croisent à la même hauteur — les arcs imbriqués descendent plus bas que les arcs courts).
  const span = (e: Edge) => e.toIdx === null ? 0.5 : Math.abs(e.toIdx - e.fromIdx);
  const sorted = [...edges].sort((a, b) => span(a) - span(b));
  const lane: Record<string, number> = {};
  sorted.forEach(e => {
    const lo = e.toIdx === null ? e.fromIdx : Math.min(e.fromIdx, e.toIdx);
    const hi = e.toIdx === null ? e.fromIdx : Math.max(e.fromIdx, e.toIdx);
    let depth = 0;
    let collision = true;
    while (collision) {
      collision = sorted.some(o => {
        if (o === e || lane[o.key] === undefined || lane[o.key] !== depth) return false;
        const olo = o.toIdx === null ? o.fromIdx : Math.min(o.fromIdx, o.toIdx);
        const ohi = o.toIdx === null ? o.fromIdx : Math.max(o.fromIdx, o.toIdx);
        return lo <= ohi && olo <= hi; // intervalles qui se chevauchent
      });
      if (collision) depth++;
    }
    lane[e.key] = depth;
  });

  type Arrow = { key: string; d: string; color: string; label?: string; toFin?: boolean };
  const arrows: Arrow[] = edges.map(e => {
    const a = positions[e.fromIdx];
    if (!a || !a.w) return null;
    const xs = a.x + (a.w * (e.fromOffset + 1)) / (e.nFrom + 1);
    const ys = a.y + a.h;
    const depth = lane[e.key] || 0;

    if (e.toIdx === null || e.toIdx < 0) {
      const y2 = ys + 22 + depth * 16;
      return { key: e.key, color: e.color, label: e.label, toFin: true,
        d: `M ${xs} ${ys} L ${xs} ${y2} L ${xs + 26} ${y2}` };
    }
    const b = positions[e.toIdx];
    if (!b || !b.w) return null;
    const xt = b.x + b.w / 2;
    const yt = b.y + b.h;
    const laneY = Math.max(ys, yt) + 26 + depth * 22;
    return { key: e.key, color: e.color, label: e.label,
      d: `M ${xs} ${ys} L ${xs} ${laneY} L ${xt} ${laneY} L ${xt} ${yt}` };
  }).filter(Boolean) as Arrow[];

  const maxDepth = Object.values(lane).reduce((m, d) => Math.max(m, d), 0);
  const svgH = positions.length && positions.some(p => p.w)
    ? Math.max(...positions.filter(p => p.w).map(p => p.y + p.h)) + 50 + maxDepth * 22
    : 220;

  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: "hsl(var(--border))" }}>
      <p className="text-[11px] mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>
        Glissez les étapes pour réordonner. Cliquez sur une étape pour l'éditer ci-dessus.
      </p>
      <div ref={containerRef} style={{ position: "relative", minHeight: svgH, overflowX: "auto" }}>
        <svg width="100%" height={svgH} style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}>
          <defs>
            {arrows.map(a => (
              <marker key={`m-${a.key}`} id={`arrow-${a.key}`} markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" fill={a.color} />
              </marker>
            ))}
          </defs>
          {arrows.map(a => (
            <path key={a.key} d={a.d} fill="none" stroke={a.color} strokeWidth={1.6}
              strokeDasharray={a.toFin ? "3,3" : "5,4"} markerEnd={`url(#arrow-${a.key})`} opacity={0.85} />
          ))}
        </svg>

        <div className="flex items-start gap-12 relative" style={{ zIndex: 1, paddingBottom: 36 }}>
          {etapes.map((etape, i) => {
            const m = metaOf(etape.type_etape);
            const selected = openIndex === i;
            return (
              <div key={etape.code + i}
                ref={el => { nodeRefs.current[i] = el; }}
                draggable
                onDragStart={() => setDragIdx(i)}
                onDragOver={e => { e.preventDefault(); setOverIdx(i); }}
                onDrop={() => handleDrop(i)}
                onClick={() => onSelect(i)}
                className="rounded-xl border cursor-pointer flex-shrink-0"
                style={{
                  width: NODE_W,
                  borderColor: selected ? m.color : "hsl(var(--border))",
                  borderWidth: selected ? 2 : 1,
                  background: "hsl(var(--card))",
                  boxShadow: selected ? `0 0 0 3px ${m.color}25` : overIdx === i ? "0 0 0 2px hsl(var(--primary)/0.3)" : "none",
                  opacity: dragIdx === i ? 0.4 : 1,
                }}>
                <div className="flex items-center gap-2 px-3 py-2.5" style={{ borderLeft: `4px solid ${m.color}`, borderRadius: "12px 12px 0 0" }}>
                  <GripVertical size={13} style={{ color: "hsl(var(--muted-foreground))" }} />
                  <span className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: m.color + "22", color: m.color }}>
                    <m.Icon size={13} />
                  </span>
                  <span className="font-medium text-sm truncate" style={{ color: "hsl(var(--foreground))" }}>{etape.libelle}</span>
                  {!etape.actif && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-mono ml-auto" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>inactif</span>
                  )}
                </div>
                <div className="px-3 pb-3">
                  <p className="text-[11px] font-mono mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>{etape.code}</p>
                  <div className="flex flex-wrap gap-1">
                    {etape.type_etape === "CONDITION" ? (
                      <>
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "#16A34A18", color: "#16A34A" }}>si vrai → {etape.si_vrai_code || "fin"}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "#DC262618", color: "#DC2626" }}>sinon → {etape.si_faux_code || "fin"}</span>
                      </>
                    ) : etape.type_etape === "AUTOMATIQUE" ? (
                      <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                        <CircleSlash size={9} /> nœud terminal
                      </span>
                    ) : etape.decisions.length === 0 ? (
                      <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                        <CircleSlash size={9} /> aucune décision
                      </span>
                    ) : etape.decisions.map((d, di) => {
                      const dm = decMeta(d.type_decision);
                      return (
                        <span key={di} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: dm.color + "18", color: dm.color }}>
                          {d.libelle || dm.label} → {d.cible_code || "fin"}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default WorkflowCanvas;
