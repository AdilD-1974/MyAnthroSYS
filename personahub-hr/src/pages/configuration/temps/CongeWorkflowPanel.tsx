import React, { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { GitBranch, Save, Loader2, UserCheck, Bell, PenLine, Split, Zap, GitFork, Info, Eye, X } from "lucide-react";
import { useCongeWorkflowOptions, loadTypeWorkflow, loadFamilleWorkflow, saveTypeWorkflow } from "@/hooks/useCongeWorkflow";
import { loadWorkflowFull } from "@/hooks/useWorkflow";

const ETAPE_META: Record<string, { label: string; color: string; Icon: any }> = {
  VALIDATION: { label: "Validation", color: "#3B6FE4", Icon: UserCheck },
  INFORMATION: { label: "Information", color: "#0EA5E9", Icon: Bell },
  SIGNATURE: { label: "Signature", color: "#8B5CF6", Icon: PenLine },
  PARALLELE: { label: "Parallèle", color: "#14B8A6", Icon: Split },
  AUTOMATIQUE: { label: "Automatique", color: "#64748B", Icon: Zap },
  CONDITION: { label: "Condition", color: "#E07B39", Icon: GitFork },
};
const metaOf = (t: string) => ETAPE_META[t] || { label: t, color: "#64748B", Icon: GitBranch };
const DECISION_COLOR: Record<string, string> = { VALIDER: "#16A34A", REJETER: "#DC2626", RENVOYER: "#E07B39", DELEGUER: "#3B6FE4", VISER: "#6366F1", DEMANDER_INFO: "#64748B", ACCUSER_RECEPTION: "#14B8A6" };

export default function CongeWorkflowPanel({ codeType, codeFamille }: { codeType: string; codeFamille?: string | null }) {
  const qc = useQueryClient();
  const { options } = useCongeWorkflowOptions();
  const [obligatoire, setObligatoire] = useState(false);
  const [codeWf, setCodeWf] = useState<string>("");
  const [familleWf, setFamilleWf] = useState<{ libelle: string; code_workflow: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<any | null>(null);
  const [showSchema, setShowSchema] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const t = await loadTypeWorkflow(codeType);
      const fam = await loadFamilleWorkflow(codeFamille || t?.code_famille || "");
      if (!alive) return;
      setObligatoire(!!t?.workflow_obligatoire);
      setCodeWf(t?.code_workflow || "");
      setFamilleWf(fam ? { libelle: fam.libelle, code_workflow: fam.code_workflow } : null);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [codeType, codeFamille]);

  const effectiveCode = codeWf || familleWf?.code_workflow || "";
  const herite = !codeWf && !!familleWf?.code_workflow;
  const effectiveOpt = options.find((o) => o.code === effectiveCode);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!obligatoire || !effectiveOpt) { setPreview(null); return; }
      try { const full = await loadWorkflowFull(effectiveOpt.id); if (alive) setPreview(full); }
      catch { if (alive) setPreview(null); }
    })();
    return () => { alive = false; };
  }, [obligatoire, effectiveOpt?.id]);

  const save = async () => {
    setSaving(true);
    try {
      await saveTypeWorkflow(codeType, { workflow_obligatoire: obligatoire, code_workflow: codeWf || null });
      qc.invalidateQueries({ queryKey: ["ref-type-conge"] });
      toast({ title: "Workflow enregistré" });
    } catch { toast({ title: "Échec de l'enregistrement", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="flex items-center gap-2 py-6 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}><Loader2 className="animate-spin" size={16} /> Chargement…</div>;

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-semibold mb-1" style={{ color: "hsl(var(--foreground))" }}>Validation</div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={obligatoire} onChange={(e) => setObligatoire(e.target.checked)} className="w-9 h-5" />
          <span className="text-sm" style={{ color: "hsl(var(--foreground))" }}>Workflow de validation obligatoire</span>
        </label>
        <p className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>Lorsqu'activé, toute demande de ce type de congé suit le circuit défini ci-dessous.</p>
      </div>

      {obligatoire && (
        <>
          <div className="space-y-1 max-w-xl">
            <label className="text-[11px] font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Circuit de validation</label>
            <select value={codeWf} onChange={(e) => setCodeWf(e.target.value)} className="h-9 w-full rounded-md border px-2 text-sm bg-background" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
              <option value="">
                {familleWf?.code_workflow ? `Hériter de la famille « ${familleWf.libelle} » → ${options.find((o) => o.code === familleWf.code_workflow)?.libelle || familleWf.code_workflow}` : "Hériter de la famille (aucun défini)"}
              </option>
              {options.map((o) => <option key={o.id} value={o.code}>{o.libelle}{o.statut !== "ACTIF" ? ` (${o.statut})` : ""}</option>)}
            </select>
          </div>

          <div className="rounded-xl border p-3 flex items-center gap-2 max-w-xl" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
            <Info size={15} className="flex-shrink-0" style={{ color: "hsl(var(--muted-foreground))" }} />
            {effectiveOpt ? (
              <div className="text-sm flex-1" style={{ color: "hsl(var(--foreground))" }}>
                Circuit appliqué : <strong>{effectiveOpt.libelle}</strong>
                {herite && <span className="ml-1 text-[11px] px-1.5 py-0.5 rounded" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>hérité de la famille</span>}
              </div>
            ) : (
              <div className="text-sm flex-1" style={{ color: "hsl(var(--destructive))" }}>Aucun circuit défini — choisissez-en un, ou définissez-le au niveau de la famille.</div>
            )}
            {preview && (
              <Button size="sm" variant="outline" className="gap-1.5 flex-shrink-0" onClick={() => setShowSchema(true)}><Eye size={14} /> Voir le circuit</Button>
            )}
          </div>
        </>
      )}

      <Button onClick={save} disabled={saving} className="gap-1.5">{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Enregistrer</Button>

      {showSchema && preview && <SchemaModal wf={preview} onClose={() => setShowSchema(false)} />}
    </div>
  );
}

// ── Schéma type Visio (pavés + connecteurs SVG) ─────────────────────────────
const NODE_W = 240, NODE_H = 54, GAP_Y = 46, PAD_X = 60, PAD_Y = 40, COL_GAP = 320;

const SchemaModal: React.FC<{ wf: any; onClose: () => void }> = ({ wf, onClose }) => {
  const etapes: any[] = wf.etapes || [];
  const idx: Record<string, number> = {};
  etapes.forEach((e, i) => { idx[e.code] = i; });

  // Détection d'une colonne secondaire (cibles "retour" vers une étape déjà passée → on les met à droite)
  // Layout simple : colonne principale verticale dans l'ordre des étapes.
  const pos: Record<string, { x: number; y: number }> = {};
  etapes.forEach((e, i) => { pos[e.code] = { x: PAD_X, y: PAD_Y + i * (NODE_H + GAP_Y) }; });

  const width = PAD_X * 2 + NODE_W + COL_GAP;
  const height = PAD_Y * 2 + etapes.length * (NODE_H + GAP_Y);

  // Construire les liens (décisions + branches de condition)
  type Link = { from: string; to: string; label: string; color: string };
  const links: Link[] = [];
  etapes.forEach((e) => {
    if (e.type_etape === "CONDITION") {
      if (e.si_vrai_code) links.push({ from: e.code, to: e.si_vrai_code, label: "si vrai", color: "#16A34A" });
      if (e.si_faux_code) links.push({ from: e.code, to: e.si_faux_code, label: "sinon", color: "#DC2626" });
    }
    (e.decisions || []).forEach((d: any) => {
      if (d.cible_code) links.push({ from: e.code, to: d.cible_code, label: d.libelle || d.type_decision, color: DECISION_COLOR[d.type_decision] || "#64748B" });
    });
  });

  // Chemin d'un lien : sortie bas du "from", entrée haut du "to" ; les retours (to au-dessus) passent par la droite.
  const edgePath = (from: string, to: string) => {
    const a = pos[from], b = pos[to];
    if (!a || !b) return "";
    const ax = a.x + NODE_W / 2, ay = a.y + NODE_H;
    const bx = b.x + NODE_W / 2, by = b.y;
    if (b.y > a.y) {
      // descendant : courbe verticale douce
      const my = (ay + by) / 2;
      return `M ${ax} ${ay} C ${ax} ${my}, ${bx} ${my}, ${bx} ${by}`;
    }
    // retour vers le haut : on sort à droite et on remonte
    const rx = a.x + NODE_W + 70;
    const ry1 = a.y + NODE_H / 2, ry2 = b.y + NODE_H / 2;
    const bxr = b.x + NODE_W;
    return `M ${a.x + NODE_W} ${ry1} C ${rx} ${ry1}, ${rx} ${ry2}, ${bxr} ${ry2}`;
  };
  const edgeMid = (from: string, to: string) => {
    const a = pos[from], b = pos[to];
    if (!a || !b) return { x: 0, y: 0 };
    if (b.y > a.y) return { x: (a.x + b.x) / 2 + NODE_W / 2, y: (a.y + NODE_H + b.y) / 2 };
    return { x: a.x + NODE_W + 70, y: (a.y + b.y) / 2 + NODE_H / 2 };
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/50" onMouseDown={onClose}>
      <div className="m-auto bg-background rounded-2xl shadow-2xl w-[min(1100px,96vw)] max-h-[92vh] flex flex-col overflow-hidden" style={{ border: "1px solid hsl(var(--border))" }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "hsl(var(--border))" }}>
          <h3 className="font-semibold flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}><GitBranch size={18} /> {wf.libelle} <span className="text-xs font-normal" style={{ color: "hsl(var(--muted-foreground))" }}>· schéma du circuit</span></h3>
          <button onClick={onClose} style={{ color: "hsl(var(--muted-foreground))" }}><X size={18} /></button>
        </div>

        <div className="overflow-auto p-4" style={{ background: "hsl(var(--muted) / 0.2)" }}>
          <svg width={width} height={height} style={{ minWidth: width }}>
            <defs>
              {Array.from(new Set([...Object.values(DECISION_COLOR), "#16A34A", "#DC2626", "#94A3B8", "#64748B"])).map((c) => (
                <marker key={c} id={`arrow-${c.replace('#', '')}`} markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L7,3 L0,6 Z" fill={c} />
                </marker>
              ))}
            </defs>

            {/* Connecteurs */}
            {links.map((l, i) => {
              const c = l.color; const m = edgeMid(l.from, l.to);
              return (
                <g key={i}>
                  <path d={edgePath(l.from, l.to)} fill="none" stroke={c} strokeWidth={1.8} markerEnd={`url(#arrow-${c.replace('#', '')})`} opacity={0.85} />
                  <g transform={`translate(${m.x},${m.y})`}>
                    <rect x={-(l.label.length * 3.3 + 8)} y={-9} width={l.label.length * 6.6 + 16} height={18} rx={9} fill="hsl(var(--background))" stroke={c} strokeWidth={1} opacity={0.95} />
                    <text x={0} y={4} textAnchor="middle" fontSize={11} fill={c} fontWeight={600}>{l.label}</text>
                  </g>
                </g>
              );
            })}

            {/* Nœuds */}
            {etapes.map((e) => {
              const meta = metaOf(e.type_etape); const p = pos[e.code];
              return (
                <g key={e.code} transform={`translate(${p.x},${p.y})`}>
                  <rect width={NODE_W} height={NODE_H} rx={12} fill="hsl(var(--background))" stroke={meta.color} strokeWidth={2} />
                  <rect width={6} height={NODE_H} rx={3} fill={meta.color} />
                  <rect x={14} y={NODE_H / 2 - 13} width={26} height={26} rx={7} fill={meta.color} opacity={0.16} />
                  <text x={50} y={NODE_H / 2 - 2} fontSize={13} fontWeight={600} fill="hsl(var(--foreground))">{trunc(e.libelle, 24)}</text>
                  <text x={50} y={NODE_H / 2 + 14} fontSize={9} fontWeight={700} fill={meta.color} letterSpacing={0.5}>{meta.label.toUpperCase()}</text>
                </g>
              );
            })}
          </svg>
        </div>

        <div className="px-4 py-2.5 border-t flex flex-wrap gap-3" style={{ borderColor: "hsl(var(--border))" }}>
          {Object.entries(ETAPE_META).map(([k, v]) => (
            <span key={k} className="flex items-center gap-1.5 text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>
              <span className="w-3 h-3 rounded" style={{ background: v.color }} /> {v.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

const trunc = (s: string, n: number) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");
