/**
 * OperationsWorkflowPanel.tsx
 * Auteur : Adil DAIA
 *
 * Affecte un workflow par type d'opération (annulation / report / reprise)
 * pour un type de congé donné. À monter dans l'onglet « Workflow » de
 * TypeCongesPage, sous <CongeWorkflowPanel /> :
 *
 *     <OperationsWorkflowPanel codeType={typeForm.code} />
 *
 * Trois choix par opération :
 *   - Hériter (défaut)        : utilise l'affectation globale / le workflow intégré
 *   - un workflow précis      : workflows en type_objet = OPERATION_CONGE
 *   - Aucun (direct)          : application immédiate, sans validation
 *
 * ⚠️ Adapter les imports shadcn/ui à ton projet.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const INHERIT = "__inherit__";
const DIRECT = "__direct__";

const humanErr = (e: any): string =>
  typeof e === "string" ? e
  : e?.response?.data?.detail || e?.data?.detail || e?.detail || e?.message
  || "Échec de l'appel API (vérifier que le backend est démarré).";

const OPS: { key: string; label: string }[] = [
  { key: "annulation", label: "Annulation" },
  { key: "report", label: "Report" },
  { key: "reprise", label: "Reprise anticipée" },
];

interface WorkflowItem { code: string; libelle: string; }
interface MappingRow {
  type_operation: string;
  mode: "inherit" | "direct" | "workflow";
  code_workflow: string | null;
  effectif: string | null;
  source: "type" | "defaut" | "integre";
}

export default function OperationsWorkflowPanel({ codeType }: { codeType: string }) {
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [rows, setRows] = useState<MappingRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    if (!codeType) return;
    Promise.all([
      api.get(`/cong-operations/workflows`),
      api.get(`/cong-operations/mapping/${codeType}`),
    ])
      .then(([wf, map]) => { setWorkflows(wf || []); setRows(map || []); setErr(null); })
      .catch((e) => setErr(humanErr(e)));
  };
  useEffect(load, [codeType]);

  const valueOf = (r: MappingRow) =>
    r.mode === "inherit" ? INHERIT : r.mode === "direct" ? DIRECT : (r.code_workflow || INHERIT);

  const onChange = async (op: string, value: string) => {
    const body =
      value === INHERIT ? { mode: "inherit" }
      : value === DIRECT ? { mode: "direct" }
      : { mode: "workflow", code_workflow: value };
    try {
      await api.post(`/cong-operations/mapping`, { code_type_conge: codeType, type_operation: op, ...body });
      load();
    } catch (e: any) { setErr(humanErr(e)); }
  };

  const sourceBadge = (r: MappingRow) => {
    if (r.effectif === null) return <Badge variant="outline">Application directe</Badge>;
    const label =
      r.source === "type" ? "Spécifique" : r.source === "defaut" ? "Défaut global" : "Intégré";
    return <Badge variant="secondary">{label} · {r.effectif}</Badge>;
  };

  if (!codeType) {
    return <p className="text-sm text-muted-foreground">Enregistrez d'abord le type de congé pour configurer ses workflows d'opération.</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-medium">Workflows des opérations</h4>
        <p className="text-sm text-muted-foreground">
          Processus de validation pour l'annulation, le report et la reprise anticipée de ce type de congé.
        </p>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}

      <div className="space-y-3">
        {OPS.map(({ key, label }) => {
          const r = rows.find((x) => x.type_operation === key);
          return (
            <div key={key} className="flex items-center gap-3">
              <div className="w-40 text-sm font-medium">{label}</div>
              <Select value={r ? valueOf(r) : INHERIT} onValueChange={(v) => onChange(key, v)}>
                <SelectTrigger className="w-72">
                  <SelectValue placeholder="Choisir un workflow…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={INHERIT}>Hériter (défaut)</SelectItem>
                  <SelectItem value={DIRECT}>Aucun — application directe</SelectItem>
                  {workflows.map((w) => (
                    <SelectItem key={w.code} value={w.code}>{w.libelle}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {r && sourceBadge(r)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
