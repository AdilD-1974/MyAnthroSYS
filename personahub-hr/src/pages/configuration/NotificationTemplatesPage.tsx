import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { Bell, Plus, Pencil, Save, Loader2, X, Power, Trash2, Eye } from "lucide-react";
import { useNotifTemplates, useVariables, WfTemplate, renderApercu, extractTokens, CANAUX } from "@/hooks/useWorkflowContent";
import { VariablePalette, CANAL_META, useInsert } from "@/components/workflow/WorkflowContentShared";

const canalMeta = (c: string) => CANAL_META[c] || { label: c, color: "#64748B" };
const empty = (): WfTemplate => ({ id: "", code: "", libelle: "", type_canal: "EMAIL", sujet: "", corps: "", variables: [], actif: true });

export default function NotificationTemplatesPage() {
  const qc = useQueryClient();
  const { templates, loading, refetch } = useNotifTemplates();
  const { variables } = useVariables();
  const [draft, setDraft] = useState<WfTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("ALL");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["wf-templates"] });
  const shown = tab === "ALL" ? templates : templates.filter((t) => t.type_canal === tab);

  const toggle = async (t: WfTemplate) => {
    setBusy(t.id);
    try { await api.patch(`/db/ref_workflow_template?id=eq.${t.id}`, { actif: !t.actif }); invalidate(); await refetch(); }
    catch { toast({ title: "Échec", variant: "destructive" }); }
    finally { setBusy(null); }
  };
  const remove = async (t: WfTemplate) => {
    if (!confirm(`Supprimer le modèle « ${t.libelle} » ?`)) return;
    setBusy(t.id);
    try { await (api as any).delete(`/db/ref_workflow_template?id=eq.${t.id}`); invalidate(); await refetch(); toast({ title: "Modèle supprimé" }); }
    catch { toast({ title: "Échec", variant: "destructive" }); }
    finally { setBusy(null); }
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.code.trim() || !draft.libelle.trim() || !draft.corps.trim()) { toast({ title: "Code, libellé et corps obligatoires", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const tokens = extractTokens(`${draft.sujet || ""} ${draft.corps}`);
      const fields = { code: draft.code.trim(), libelle: draft.libelle.trim(), type_canal: draft.type_canal,
        sujet: draft.sujet || null, corps: draft.corps, variables: tokens, actif: draft.actif, updated_at: new Date().toISOString() };
      if (draft.id) await api.patch(`/db/ref_workflow_template?id=eq.${draft.id}`, fields);
      else await api.post("/db/ref_workflow_template", fields);
      toast({ title: "Modèle enregistré" });
      setDraft(null); invalidate(); await refetch();
    } catch { toast({ title: "Échec de l'enregistrement", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}><Bell size={20} /> Modèles de notifications</h1>
          <p className="text-sm mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Messages envoyés par les actions de workflow (email, SMS, WhatsApp, notification interne, push).</p>
        </div>
        <Button onClick={() => setDraft(empty())} className="gap-1.5"><Plus size={15} /> Nouveau modèle</Button>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {["ALL", ...CANAUX].map((c) => {
          const active = tab === c; const m = c === "ALL" ? { label: "Tous", color: "#64748B" } : canalMeta(c);
          return <button key={c} onClick={() => setTab(c)} className="px-3 py-1 rounded-lg text-[12px] font-medium border transition-colors"
            style={{ borderColor: active ? m.color : "hsl(var(--border))", background: active ? m.color + "14" : "transparent", color: active ? m.color : "hsl(var(--muted-foreground))" }}>{m.label}</button>;
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16" style={{ color: "hsl(var(--muted-foreground))" }}><Loader2 className="animate-spin mr-2" size={20} /> Chargement…</div>
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border p-10 text-center" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>Aucun modèle.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {shown.map((t) => {
            const m = canalMeta(t.type_canal);
            return (
              <div key={t.id} className="rounded-2xl border p-4 flex flex-col gap-2" style={{ borderColor: "hsl(var(--border))", borderLeft: `4px solid ${m.color}`, opacity: t.actif ? 1 : 0.55 }}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold flex items-center gap-2 flex-wrap" style={{ color: "hsl(var(--foreground))" }}>{t.libelle}
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide" style={{ background: m.color + "1F", color: m.color }}>{m.label}</span>
                      <span className="text-[10px] font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>{t.code}</span>
                    </div>
                    {t.sujet && <div className="text-xs mt-0.5 truncate" style={{ color: "hsl(var(--muted-foreground))" }}>Sujet : {t.sujet}</div>}
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button onClick={() => toggle(t)} disabled={busy === t.id} className="p-1.5 rounded-lg hover:bg-muted/50" title={t.actif ? "Désactiver" : "Activer"} style={{ color: t.actif ? "hsl(142 64% 35%)" : "hsl(var(--muted-foreground))" }}>{busy === t.id ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}</button>
                    <button onClick={() => setDraft({ ...t, sujet: t.sujet || "", corps: t.corps || "" })} className="p-1.5 rounded-lg hover:bg-muted/50" title="Modifier" style={{ color: "hsl(var(--muted-foreground))" }}><Pencil size={14} /></button>
                    <button onClick={() => remove(t)} disabled={busy === t.id} className="p-1.5 rounded-lg hover:bg-destructive/10" title="Supprimer" style={{ color: "hsl(var(--destructive))" }}><Trash2 size={14} /></button>
                  </div>
                </div>
                <div className="text-xs whitespace-pre-wrap line-clamp-3 rounded-lg p-2" style={{ background: "hsl(var(--muted) / 0.4)", color: "hsl(var(--muted-foreground))" }}>{t.corps}</div>
              </div>
            );
          })}
        </div>
      )}

      {draft && <Editor draft={draft} setDraft={setDraft} variables={variables} onSave={save} saving={saving} onClose={() => setDraft(null)} />}
    </div>
  );
}

const Editor: React.FC<{ draft: WfTemplate; setDraft: (t: WfTemplate) => void; variables: any[]; onSave: () => void; saving: boolean; onClose: () => void }> = ({ draft, setDraft, variables, onSave, saving, onClose }) => {
  const [field, setField] = useState<"sujet" | "corps">("corps");
  const sujet = useInsert(draft.sujet || "", (v) => setDraft({ ...draft, sujet: v }));
  const corps = useInsert(draft.corps || "", (v) => setDraft({ ...draft, corps: v }));
  const m = canalMeta(draft.type_canal);
  const hasSujet = draft.type_canal === "EMAIL" || draft.type_canal === "PUSH" || draft.type_canal === "NOTIFICATION";
  const onInsert = (token: string) => { if (field === "sujet" && hasSujet) sujet.insert(token); else corps.insert(token); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-background rounded-2xl shadow-xl w-full max-w-[min(1100px,95vw)] p-5 space-y-4 max-h-[92vh] overflow-auto" style={{ border: "1px solid hsl(var(--border))" }}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}>{draft.id ? "Modifier le modèle" : "Nouveau modèle"}
            <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide" style={{ background: m.color + "1F", color: m.color }}>{m.label}</span></h2>
          <button onClick={onClose} style={{ color: "hsl(var(--muted-foreground))" }}><X size={18} /></button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
          {/* Édition */}
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Code *"><Input value={draft.code} disabled={!!draft.id} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="notif_a_valider" /></Field>
              <Field label="Libellé *"><Input value={draft.libelle} onChange={(e) => setDraft({ ...draft, libelle: e.target.value })} /></Field>
              <Field label="Canal"><select value={draft.type_canal} onChange={(e) => setDraft({ ...draft, type_canal: e.target.value })} className="h-9 w-full rounded-md border px-2 text-sm bg-background" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>{CANAUX.map((c) => <option key={c} value={c}>{canalMeta(c).label}</option>)}</select></Field>
            </div>
            {hasSujet && (
              <Field label="Sujet"><Input ref={sujet.ref as any} value={draft.sujet || ""} onFocus={() => setField("sujet")} onChange={(e) => setDraft({ ...draft, sujet: e.target.value })} placeholder="Demande à valider : {{demande.libelle}}" /></Field>
            )}
            <Field label="Corps *">
              <textarea ref={corps.ref as any} value={draft.corps} onFocus={() => setField("corps")} onChange={(e) => setDraft({ ...draft, corps: e.target.value })} rows={9}
                placeholder={"Bonjour {{destinataire.prenom}},\n\nLa demande {{demande.reference}} de {{collaborateur.nom}} attend votre validation."}
                className="w-full rounded-md border px-3 py-2 text-sm bg-background font-mono" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }} />
            </Field>

            {/* Aperçu */}
            <div className="rounded-xl border p-3" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold mb-2" style={{ color: "hsl(var(--muted-foreground))" }}><Eye size={13} /> Aperçu (valeurs d'exemple)</div>
              {hasSujet && draft.sujet && <div className="text-sm font-semibold mb-1" style={{ color: "hsl(var(--foreground))" }}>{renderApercu(draft.sujet, variables)}</div>}
              <div className="text-sm whitespace-pre-wrap" style={{ color: "hsl(var(--foreground))" }}>{renderApercu(draft.corps, variables) || <span className="italic" style={{ color: "hsl(var(--muted-foreground))" }}>—</span>}</div>
            </div>
          </div>

          {/* Palette de variables */}
          <div>
            <div className="text-[11px] font-semibold mb-1.5" style={{ color: "hsl(var(--muted-foreground))" }}>Variables disponibles</div>
            <VariablePalette variables={variables} onInsert={onInsert} />
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <button type="button" onClick={() => setDraft({ ...draft, actif: !draft.actif })} className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: draft.actif ? "hsl(142 64% 32%)" : "hsl(var(--muted-foreground))" }}><Power size={13} /> {draft.actif ? "Actif" : "Inactif"}</button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
            <Button size="sm" onClick={onSave} disabled={saving} className="gap-1.5">{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Enregistrer</Button>
          </div>
        </div>
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="space-y-1"><label className="text-[11px] font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</label>{children}</div>
);
