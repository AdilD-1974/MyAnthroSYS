import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { Hash, Plus, Pencil, Save, Loader2, X, Power, Trash2, Copy, Search } from "lucide-react";
import { useVariables, WfVariable, TYPES_DONNEE, CATEGORIES_VAR, TYPES_OBJET } from "@/hooks/useWorkflowContent";
import { varCatColor, DONNEE_LABEL } from "@/components/workflow/WorkflowContentShared";

const empty = (ordre: number): WfVariable => ({
  id: "", code: "", libelle: "", description: "", type_objet: "generique", type_donnee: "TEXTE",
  categorie: "GENERAL", exemple_valeur: "", source_sql: "", actif: true, ordre,
});

export default function CatalogueVariablesPage() {
  const qc = useQueryClient();
  const { variables, loading, refetch } = useVariables();
  const [draft, setDraft] = useState<WfVariable | null>(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["wf-variables"] });
  const ql = q.toLowerCase();
  const filtered = ql ? variables.filter((v) => v.code.toLowerCase().includes(ql) || v.libelle.toLowerCase().includes(ql)) : variables;
  const byCat: Record<string, WfVariable[]> = {};
  filtered.forEach((v) => { (byCat[v.categorie] = byCat[v.categorie] || []).push(v); });

  const copy = (code: string) => { navigator.clipboard?.writeText(`{{${code}}}`); toast({ title: "Jeton copié", description: `{{${code}}}` }); };

  const toggle = async (v: WfVariable) => {
    setBusy(v.id);
    try { await api.patch(`/db/ref_workflow_variable?id=eq.${v.id}`, { actif: !v.actif }); invalidate(); await refetch(); }
    catch { toast({ title: "Échec", variant: "destructive" }); }
    finally { setBusy(null); }
  };
  const remove = async (v: WfVariable) => {
    if (!confirm(`Supprimer la variable « ${v.libelle} » ?`)) return;
    setBusy(v.id);
    try { await (api as any).delete(`/db/ref_workflow_variable?id=eq.${v.id}`); invalidate(); await refetch(); toast({ title: "Variable supprimée" }); }
    catch { toast({ title: "Échec de la suppression", variant: "destructive" }); }
    finally { setBusy(null); }
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.code.trim() || !draft.libelle.trim()) { toast({ title: "Code et libellé obligatoires", variant: "destructive" }); return; }
    if (!/^[\w.]+$/.test(draft.code)) { toast({ title: "Code invalide", description: "Lettres, chiffres, _ et . uniquement.", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const fields = { code: draft.code.trim(), libelle: draft.libelle.trim(), description: draft.description || null,
        type_objet: draft.type_objet || null, type_donnee: draft.type_donnee, categorie: draft.categorie,
        exemple_valeur: draft.exemple_valeur || null, source_sql: draft.source_sql || null, actif: draft.actif, ordre: draft.ordre };
      if (draft.id) await api.patch(`/db/ref_workflow_variable?id=eq.${draft.id}`, fields);
      else await api.post("/db/ref_workflow_variable", fields);
      toast({ title: "Variable enregistrée" });
      setDraft(null); invalidate(); await refetch();
    } catch { toast({ title: "Échec de l'enregistrement", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}><Hash size={20} /> Catalogue de variables</h1>
          <p className="text-sm mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Jetons <code className="px-1 rounded bg-muted text-xs">{"{{code}}"}</code> insérables dans les modèles de notification et de documents.</p>
        </div>
        <Button onClick={() => setDraft(empty((variables.at(-1)?.ordre ?? 0) + 1))} className="gap-1.5"><Plus size={15} /> Nouvelle variable</Button>
      </div>

      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…" className="pl-8" />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16" style={{ color: "hsl(var(--muted-foreground))" }}><Loader2 className="animate-spin mr-2" size={20} /> Chargement…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border p-10 text-center" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>Aucune variable.</div>
      ) : (
        <div className="space-y-5">
          {Object.entries(byCat).map(([cat, vars]) => {
            const col = varCatColor(cat);
            return (
              <div key={cat}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2.5 h-2.5 rounded" style={{ background: col }} />
                  <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: col }}>{cat}</h3>
                  <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>({vars.length})</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {vars.map((v) => (
                    <div key={v.id} className="rounded-xl border p-3 flex items-start gap-3" style={{ borderColor: "hsl(var(--border))", borderLeft: `4px solid ${col}`, opacity: v.actif ? 1 : 0.55 }}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium" style={{ color: "hsl(var(--foreground))" }}>{v.libelle}</span>
                          <code className="text-xs px-1.5 py-0.5 rounded font-mono" style={{ background: col + "14", color: col }}>{`{{${v.code}}}`}</code>
                          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>{DONNEE_LABEL[v.type_donnee] || v.type_donnee}</span>
                          {v.type_objet && v.type_objet !== "generique" && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>{v.type_objet}</span>}
                        </div>
                        {v.exemple_valeur && <div className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>ex. {v.exemple_valeur}</div>}
                        {v.source_sql && <div className="text-[11px] mt-1 font-mono truncate" style={{ color: "hsl(var(--muted-foreground))" }} title={v.source_sql}>{v.source_sql}</div>}
                      </div>
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button onClick={() => copy(v.code)} className="p-1.5 rounded-lg hover:bg-muted/50" title="Copier le jeton" style={{ color: "hsl(var(--muted-foreground))" }}><Copy size={14} /></button>
                        <button onClick={() => toggle(v)} disabled={busy === v.id} className="p-1.5 rounded-lg hover:bg-muted/50" title={v.actif ? "Désactiver" : "Activer"} style={{ color: v.actif ? "hsl(142 64% 35%)" : "hsl(var(--muted-foreground))" }}>{busy === v.id ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}</button>
                        <button onClick={() => setDraft({ ...v, description: v.description || "", exemple_valeur: v.exemple_valeur || "", source_sql: v.source_sql || "", type_objet: v.type_objet || "generique" })} className="p-1.5 rounded-lg hover:bg-muted/50" title="Modifier" style={{ color: "hsl(var(--muted-foreground))" }}><Pencil size={14} /></button>
                        <button onClick={() => remove(v)} disabled={busy === v.id} className="p-1.5 rounded-lg hover:bg-destructive/10" title="Supprimer" style={{ color: "hsl(var(--destructive))" }}><Trash2 size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-background rounded-2xl shadow-xl w-full max-w-2xl p-5 space-y-4 max-h-[90vh] overflow-auto" style={{ border: "1px solid hsl(var(--border))" }}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold" style={{ color: "hsl(var(--foreground))" }}>{draft.id ? "Modifier la variable" : "Nouvelle variable"}</h2>
              <button onClick={() => setDraft(null)} style={{ color: "hsl(var(--muted-foreground))" }}><X size={18} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Code *"><Input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="collaborateur.nom" /></Field>
              <Field label="Libellé *"><Input value={draft.libelle} onChange={(e) => setDraft({ ...draft, libelle: e.target.value })} placeholder="Nom du collaborateur" /></Field>
              <Field label="Catégorie"><Select value={draft.categorie} onChange={(v) => setDraft({ ...draft, categorie: v })} options={CATEGORIES_VAR} /></Field>
              <Field label="Objet métier"><Select value={draft.type_objet || "generique"} onChange={(v) => setDraft({ ...draft, type_objet: v })} options={TYPES_OBJET} /></Field>
              <Field label="Type de donnée"><Select value={draft.type_donnee} onChange={(v) => setDraft({ ...draft, type_donnee: v })} options={TYPES_DONNEE} /></Field>
              <Field label="Ordre"><Input type="number" value={draft.ordre} onChange={(e) => setDraft({ ...draft, ordre: parseInt(e.target.value) || 0 })} /></Field>
            </div>
            <Field label="Valeur d'exemple (utilisée pour l'aperçu des modèles)"><Input value={draft.exemple_valeur || ""} onChange={(e) => setDraft({ ...draft, exemple_valeur: e.target.value })} placeholder="DAIA Adil" /></Field>
            <Field label="Source SQL (résolution par le moteur)"><Input value={draft.source_sql || ""} onChange={(e) => setDraft({ ...draft, source_sql: e.target.value })} placeholder="SELECT nom FROM collaborateurs WHERE id = :collaborateur_id" /></Field>
            <Field label="Description"><Input value={draft.description || ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
            <div className="flex items-center justify-between pt-1">
              <button type="button" onClick={() => setDraft({ ...draft, actif: !draft.actif })} className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: draft.actif ? "hsl(142 64% 32%)" : "hsl(var(--muted-foreground))" }}><Power size={13} /> {draft.actif ? "Active" : "Inactive"}</button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setDraft(null)}>Annuler</Button>
                <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Enregistrer</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="space-y-1"><label className="text-[11px] font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</label>{children}</div>
);
const Select: React.FC<{ value: string; onChange: (v: string) => void; options: string[] }> = ({ value, onChange, options }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-full rounded-md border px-2 text-sm bg-background" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
    {options.map((o) => <option key={o} value={o}>{o}</option>)}
  </select>
);
