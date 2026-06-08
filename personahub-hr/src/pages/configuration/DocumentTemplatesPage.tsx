import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { FileText, Plus, Pencil, Save, Loader2, X, Power, Trash2, Eye } from "lucide-react";
import { useDocTemplates, useVariables, DocTemplate, renderApercu, extractTokens, TYPES_DOCUMENT, EXTENSIONS, TYPES_OBJET } from "@/hooks/useWorkflowContent";
import { VariablePalette, DOC_META, useInsert } from "@/components/workflow/WorkflowContentShared";

const docMeta = (c: string) => DOC_META[c] || { label: c, color: "#64748B" };
const empty = (): DocTemplate => ({ id: "", code: "", libelle: "", description: "", type_objet: "generique", type_document: "HTML", chemin_fichier: "", contenu: "", variables: [], extension_sortie: "pdf", nom_fichier_pattern: "", actif: true });

export default function DocumentTemplatesPage() {
  const qc = useQueryClient();
  const { templates, loading, refetch } = useDocTemplates();
  const { variables } = useVariables();
  const [draft, setDraft] = useState<DocTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["doc-templates"] });

  const toggle = async (t: DocTemplate) => {
    setBusy(t.id);
    try { await api.patch(`/db/ref_template_document?id=eq.${t.id}`, { actif: !t.actif }); invalidate(); await refetch(); }
    catch { toast({ title: "Échec", variant: "destructive" }); }
    finally { setBusy(null); }
  };
  const remove = async (t: DocTemplate) => {
    if (!confirm(`Supprimer le modèle « ${t.libelle} » ?`)) return;
    setBusy(t.id);
    try { await (api as any).delete(`/db/ref_template_document?id=eq.${t.id}`); invalidate(); await refetch(); toast({ title: "Modèle supprimé" }); }
    catch { toast({ title: "Échec", variant: "destructive" }); }
    finally { setBusy(null); }
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.code.trim() || !draft.libelle.trim()) { toast({ title: "Code et libellé obligatoires", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const tokens = extractTokens(`${draft.contenu || ""} ${draft.nom_fichier_pattern || ""}`);
      const fields = { code: draft.code.trim(), libelle: draft.libelle.trim(), description: draft.description || null,
        type_objet: draft.type_objet || null, type_document: draft.type_document, chemin_fichier: draft.chemin_fichier || null,
        contenu: draft.contenu || null, variables: tokens, extension_sortie: draft.extension_sortie,
        nom_fichier_pattern: draft.nom_fichier_pattern || null, actif: draft.actif, updated_at: new Date().toISOString() };
      if (draft.id) await api.patch(`/db/ref_template_document?id=eq.${draft.id}`, fields);
      else await api.post("/db/ref_template_document", fields);
      toast({ title: "Modèle enregistré" });
      setDraft(null); invalidate(); await refetch();
    } catch { toast({ title: "Échec de l'enregistrement", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}><FileText size={20} /> Modèles de documents</h1>
          <p className="text-sm mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Documents générés par les workflows (attestations, décisions…) avec variables et sortie PDF/Word/HTML.</p>
        </div>
        <Button onClick={() => setDraft(empty())} className="gap-1.5"><Plus size={15} /> Nouveau modèle</Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16" style={{ color: "hsl(var(--muted-foreground))" }}><Loader2 className="animate-spin mr-2" size={20} /> Chargement…</div>
      ) : templates.length === 0 ? (
        <div className="rounded-2xl border p-10 text-center" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>Aucun modèle de document.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {templates.map((t) => {
            const m = docMeta(t.type_document);
            return (
              <div key={t.id} className="rounded-2xl border p-4 flex flex-col gap-2" style={{ borderColor: "hsl(var(--border))", borderLeft: `4px solid ${m.color}`, opacity: t.actif ? 1 : 0.55 }}>
                <div className="flex items-start gap-2">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: m.color + "1F", color: m.color }}><FileText size={18} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold flex items-center gap-2 flex-wrap" style={{ color: "hsl(var(--foreground))" }}>{t.libelle}
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide" style={{ background: m.color + "1F", color: m.color }}>{m.label}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>→ .{t.extension_sortie}</span>
                    </div>
                    <div className="text-[10px] font-mono mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{t.code}</div>
                    {t.description && <div className="text-xs mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>{t.description}</div>}
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button onClick={() => toggle(t)} disabled={busy === t.id} className="p-1.5 rounded-lg hover:bg-muted/50" title={t.actif ? "Désactiver" : "Activer"} style={{ color: t.actif ? "hsl(142 64% 35%)" : "hsl(var(--muted-foreground))" }}>{busy === t.id ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}</button>
                    <button onClick={() => setDraft({ ...t, description: t.description || "", contenu: t.contenu || "", chemin_fichier: t.chemin_fichier || "", nom_fichier_pattern: t.nom_fichier_pattern || "", type_objet: t.type_objet || "generique" })} className="p-1.5 rounded-lg hover:bg-muted/50" title="Modifier" style={{ color: "hsl(var(--muted-foreground))" }}><Pencil size={14} /></button>
                    <button onClick={() => remove(t)} disabled={busy === t.id} className="p-1.5 rounded-lg hover:bg-destructive/10" title="Supprimer" style={{ color: "hsl(var(--destructive))" }}><Trash2 size={14} /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {draft && <Editor draft={draft} setDraft={setDraft} variables={variables} onSave={save} saving={saving} onClose={() => setDraft(null)} />}
    </div>
  );
}

const Editor: React.FC<{ draft: DocTemplate; setDraft: (t: DocTemplate) => void; variables: any[]; onSave: () => void; saving: boolean; onClose: () => void }> = ({ draft, setDraft, variables, onSave, saving, onClose }) => {
  const contenu = useInsert(draft.contenu || "", (v) => setDraft({ ...draft, contenu: v }));
  const m = docMeta(draft.type_document);
  const isHtml = draft.type_document === "HTML" || draft.type_document === "PDF";
  const rendered = renderApercu(draft.contenu || "", variables);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-background rounded-2xl shadow-xl w-full max-w-[min(1150px,96vw)] p-5 space-y-4 max-h-[92vh] overflow-auto" style={{ border: "1px solid hsl(var(--border))" }}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}>{draft.id ? "Modifier le modèle" : "Nouveau modèle"}
            <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide" style={{ background: m.color + "1F", color: m.color }}>{m.label}</span></h2>
          <button onClick={onClose} style={{ color: "hsl(var(--muted-foreground))" }}><X size={18} /></button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Code *"><Input value={draft.code} disabled={!!draft.id} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="attestation_conges" /></Field>
          <Field label="Libellé *"><Input value={draft.libelle} onChange={(e) => setDraft({ ...draft, libelle: e.target.value })} /></Field>
          <Field label="Type"><select value={draft.type_document} onChange={(e) => setDraft({ ...draft, type_document: e.target.value })} className="h-9 w-full rounded-md border px-2 text-sm bg-background" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>{TYPES_DOCUMENT.map((c) => <option key={c} value={c}>{docMeta(c).label}</option>)}</select></Field>
          <Field label="Sortie"><select value={draft.extension_sortie} onChange={(e) => setDraft({ ...draft, extension_sortie: e.target.value })} className="h-9 w-full rounded-md border px-2 text-sm bg-background" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>{EXTENSIONS.map((c) => <option key={c} value={c}>.{c}</option>)}</select></Field>
          <Field label="Objet métier"><select value={draft.type_objet || "generique"} onChange={(e) => setDraft({ ...draft, type_objet: e.target.value })} className="h-9 w-full rounded-md border px-2 text-sm bg-background" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>{TYPES_OBJET.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
          <Field label="Nom de fichier (pattern)"><Input value={draft.nom_fichier_pattern || ""} onChange={(e) => setDraft({ ...draft, nom_fichier_pattern: e.target.value })} placeholder="attestation_{{collaborateur.matricule}}" /></Field>
          <div className="md:col-span-2"><Field label="Chemin fichier (gabarit Word, option)"><Input value={draft.chemin_fichier || ""} onChange={(e) => setDraft({ ...draft, chemin_fichier: e.target.value })} placeholder="/templates/attestation.docx" /></Field></div>
        </div>
        <Field label="Description"><Input value={draft.description || ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
          <div className="space-y-3">
            <Field label={`Contenu ${isHtml ? "(HTML)" : ""}`}>
              <textarea ref={contenu.ref as any} value={draft.contenu || ""} onChange={(e) => setDraft({ ...draft, contenu: e.target.value })} rows={12}
                placeholder={isHtml ? "<h1>Attestation</h1>\n<p>Je soussigné… {{collaborateur.nom}}…</p>" : "Attestation pour {{collaborateur.nom}}…"}
                className="w-full rounded-md border px-3 py-2 text-sm bg-background font-mono" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }} />
            </Field>
            <div className="rounded-xl border p-3" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold mb-2" style={{ color: "hsl(var(--muted-foreground))" }}><Eye size={13} /> Aperçu (valeurs d'exemple)</div>
              {isHtml
                ? <div className="text-sm prose prose-sm max-w-none" style={{ color: "hsl(var(--foreground))" }} dangerouslySetInnerHTML={{ __html: rendered || "<em>—</em>" }} />
                : <div className="text-sm whitespace-pre-wrap" style={{ color: "hsl(var(--foreground))" }}>{rendered || <span className="italic" style={{ color: "hsl(var(--muted-foreground))" }}>—</span>}</div>}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-semibold mb-1.5" style={{ color: "hsl(var(--muted-foreground))" }}>Variables disponibles</div>
            <VariablePalette variables={variables} typeObjet={draft.type_objet} onInsert={(token) => contenu.insert(token)} />
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
