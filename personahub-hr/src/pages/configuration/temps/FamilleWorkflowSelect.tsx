import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { Save, Loader2 } from "lucide-react";
import { useCongeWorkflowOptions, loadFamilleWorkflow, saveFamilleWorkflow } from "@/hooks/useCongeWorkflow";

// À placer dans le panneau d'édition d'une famille de congé.
export default function FamilleWorkflowSelect({ codeFamille }: { codeFamille: string }) {
  const { options } = useCongeWorkflowOptions();
  const [codeWf, setCodeWf] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => { setLoading(true); const f = await loadFamilleWorkflow(codeFamille); if (alive) { setCodeWf(f?.code_workflow || ""); setLoading(false); } })();
    return () => { alive = false; };
  }, [codeFamille]);

  const save = async () => {
    setSaving(true);
    try { await saveFamilleWorkflow(codeFamille, codeWf || null); toast({ title: "Workflow par défaut enregistré" }); }
    catch { toast({ title: "Échec", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="flex items-center gap-2 py-2 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}><Loader2 className="animate-spin" size={14} /> Chargement…</div>;

  return (
    <div className="space-y-2 max-w-xl">
      <div className="space-y-1">
        <label className="text-[11px] font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>Circuit de validation par défaut (hérité par les types de la famille)</label>
        <select value={codeWf} onChange={(e) => setCodeWf(e.target.value)} className="h-9 w-full rounded-md border px-2 text-sm bg-background" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
          <option value="">— Aucun —</option>
          {options.map((o) => <option key={o.id} value={o.code}>{o.libelle}{o.statut !== "ACTIF" ? ` (${o.statut})` : ""}</option>)}
        </select>
      </div>
      <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Enregistrer</Button>
    </div>
  );
}
